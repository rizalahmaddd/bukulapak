import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { DAY, type AppEnv, type Env, type TenantToken, type UserToken } from './env';
import { hmac, randomId, sha256, signToken, timingSafeEqual, verifyGoogleIdToken, verifyToken } from './crypto';
import { getSystem } from './system';

const LOCK_AFTER = 5;
const TURNSTILE_AFTER = 3;
const LOCK_MS = 15 * 60_000;
const USER_TOKEN_TTL = 90 * DAY;

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  google_sub: string | null;
  google_email: string | null;
  pw_salt: string | null;
  pw_verifier: string | null;
  recovery_verifier: string | null;
  failed_logins: number;
  locked_until: number | null;
}

function bearer(c: Context): string | null {
  const h = c.req.header('authorization');
  if (h?.startsWith('Bearer ')) return h.slice(7);
  // Browsers can't set headers on a WebSocket, so the live socket offers `bukulapak, <token>` as subprotocols.
  // That keeps the token out of the URL and request logs.
  if (c.req.header('upgrade') === 'websocket') {
    const [name, token] = (c.req.header('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
    if (name === 'bukulapak' && token) return token;
  }
  return null;
}

export async function requireUser(c: Context<AppEnv>, next: Next) {
  const token = bearer(c);
  const payload = token ? await verifyToken<UserToken>(c.env.SESSION_SECRET, token) : null;
  if (!payload || payload.k !== 'u') return c.json({ error: 'unauthorized' }, 401);
  const device = await c.env.DB.prepare('SELECT revoked_at FROM devices WHERE id = ?').bind(payload.d).first<{ revoked_at: number | null }>();
  if (!device || device.revoked_at) return c.json({ error: 'revoked' }, 401);
  c.set('user', payload);
  await next();
}

export async function requireTenant(c: Context<AppEnv>, next: Next) {
  const token = bearer(c);
  const payload = token ? await verifyToken<TenantToken>(c.env.SESSION_SECRET, token) : null;
  if (!payload || payload.k !== 't') return c.json({ error: 'unauthorized' }, 401);
  c.set('tenant', payload);
  await next();
}

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = (await res.json()) as { success: boolean };
  return out.success;
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

function isHex64(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

function cleanLabel(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : 'HP';
}

async function issueUserToken(env: Env, userId: string, label: string) {
  const deviceId = randomId(12);
  await env.DB.prepare('INSERT INTO devices (id, user_id, role, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(deviceId, userId, 'owner', label, Date.now())
    .run();
  return signToken(env.SESSION_SECRET, { k: 'u', u: userId, d: deviceId, exp: Date.now() + USER_TOKEN_TTL } satisfies UserToken);
}

function publicUser(u: UserRow) {
  return { id: u.id, name: u.name, email: u.email, hasPassword: !!u.pw_verifier, googleEmail: u.google_email };
}

async function recordFailure(env: Env, u: UserRow) {
  const failed = u.failed_logins + 1;
  if (failed >= LOCK_AFTER) {
    await env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(TURNSTILE_AFTER, Date.now() + LOCK_MS, u.id)
      .run();
  } else {
    await env.DB.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(failed, u.id).run();
  }
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/salt', async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  const e = normalizeEmail(email);
  if (!e) return c.json({ error: 'email_invalid' }, 400);
  const u = await c.env.DB.prepare('SELECT pw_salt, failed_logins FROM users WHERE email = ?').bind(e).first<{ pw_salt: string | null; failed_logins: number }>();
  // Unknown emails get a stable fake salt so this endpoint can't be used to probe registrations.
  const salt = u?.pw_salt ?? (await hmac(c.env.SESSION_SECRET, `salt:${e}`)).slice(0, 22);
  return c.json({ salt, needTurnstile: !!c.env.TURNSTILE_SECRET && (u?.failed_logins ?? 0) >= TURNSTILE_AFTER });
});

authRoutes.post('/register', async (c) => {
  const body = await c.req.json<{ name: string; email: string; salt: string; verifier: string; recoveryVerifier: string; turnstile?: string; deviceLabel?: string }>();
  const signup = await getSystem(c.env, 'signup', 'open');
  if (signup !== 'open') return c.json({ error: 'signup_paused', signup }, 403);
  const email = normalizeEmail(body.email);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!email || !name || typeof body.salt !== 'string' || body.salt.length < 16 || !isHex64(body.verifier) || !isHex64(body.recoveryVerifier)) {
    return c.json({ error: 'invalid' }, 400);
  }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header('cf-connecting-ip')))) return c.json({ error: 'turnstile' }, 400);
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) return c.json({ error: 'email_taken' }, 409);
  const id = randomId(12);
  await c.env.DB.prepare(
    'INSERT INTO users (id, name, email, pw_salt, pw_verifier, recovery_verifier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, name, email, body.salt, await sha256(body.verifier), await sha256(body.recoveryVerifier), Date.now())
    .run();
  const token = await issueUserToken(c.env, id, cleanLabel(body.deviceLabel));
  return c.json({ token });
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; key: string; turnstile?: string; deviceLabel?: string }>();
  const email = normalizeEmail(body.email);
  if (!email || !isHex64(body.key)) return c.json({ error: 'invalid' }, 400);
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!u || !u.pw_verifier) return c.json({ error: 'wrong_credentials' }, 401);
  if (u.locked_until && u.locked_until > Date.now()) return c.json({ error: 'locked', until: u.locked_until }, 423);
  if (u.failed_logins >= TURNSTILE_AFTER && !(await verifyTurnstile(c.env, body.turnstile, c.req.header('cf-connecting-ip')))) {
    return c.json({ error: 'turnstile' }, 400);
  }
  if (!timingSafeEqual(await sha256(body.key), u.pw_verifier)) {
    await recordFailure(c.env, u);
    return c.json({ error: 'wrong_credentials' }, 401);
  }
  if (u.failed_logins > 0) await c.env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
  return c.json({ token: await issueUserToken(c.env, u.id, cleanLabel(body.deviceLabel)) });
});

authRoutes.post('/recover', async (c) => {
  const body = await c.req.json<{ email: string; code: string; salt: string; verifier: string; recoveryVerifier: string; deviceLabel?: string }>();
  const email = normalizeEmail(body.email);
  if (!email || typeof body.code !== 'string' || typeof body.salt !== 'string' || !isHex64(body.verifier) || !isHex64(body.recoveryVerifier)) {
    return c.json({ error: 'invalid' }, 400);
  }
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!u || !u.recovery_verifier) return c.json({ error: 'wrong_code' }, 401);
  if (u.locked_until && u.locked_until > Date.now()) return c.json({ error: 'locked', until: u.locked_until }, 423);
  const code = body.code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!timingSafeEqual(await sha256(await sha256(code)), u.recovery_verifier)) {
    await recordFailure(c.env, u);
    return c.json({ error: 'wrong_code' }, 401);
  }
  await c.env.DB.prepare(
    'UPDATE users SET pw_salt = ?, pw_verifier = ?, recovery_verifier = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
  )
    .bind(body.salt, await sha256(body.verifier), await sha256(body.recoveryVerifier), u.id)
    .run();
  return c.json({ token: await issueUserToken(c.env, u.id, cleanLabel(body.deviceLabel)) });
});

authRoutes.post('/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'google_disabled' }, 404);
  const body = await c.req.json<{ credential: string; deviceLabel?: string }>();
  const claims = await verifyGoogleIdToken(body.credential, c.env.GOOGLE_CLIENT_ID);
  if (!claims) return c.json({ error: 'google_invalid' }, 401);
  let u = await c.env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(claims.sub).first<UserRow>();
  if (!u) {
    // Never merge into an email+password account with the same address: those emails are unverified.
    const signup = await getSystem(c.env, 'signup', 'open');
    if (signup !== 'open') return c.json({ error: 'signup_paused', signup }, 403);
    const id = randomId(12);
    const name = (claims.name || claims.email?.split('@')[0] || 'Pemilik').slice(0, 80);
    await c.env.DB.prepare('INSERT INTO users (id, name, google_sub, google_email, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, claims.sub, claims.email ?? null, Date.now())
      .run();
    u = { id } as UserRow;
  }
  return c.json({ token: await issueUserToken(c.env, u.id, cleanLabel(body.deviceLabel)) });
});

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireUser);

meRoutes.get('/', async (c) => {
  const { u } = c.get('user');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u).first<UserRow>();
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const tenants = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.business_type AS businessType, m.role
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? AND t.deleted_at IS NULL ORDER BY t.created_at`,
  )
    .bind(u)
    .all();
  return c.json({ user: publicUser(user), tenants: tenants.results });
});

meRoutes.post('/password', async (c) => {
  const body = await c.req.json<{ salt: string; verifier: string; email?: string }>();
  if (typeof body.salt !== 'string' || body.salt.length < 16 || !isHex64(body.verifier)) return c.json({ error: 'invalid' }, 400);
  const { u } = c.get('user');
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(u).first<{ email: string | null }>();
  let email = user?.email ?? null;
  if (!email) {
    email = normalizeEmail(body.email);
    if (!email) return c.json({ error: 'email_invalid' }, 400);
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').bind(email, u).first();
    if (taken) return c.json({ error: 'email_taken' }, 409);
  }
  await c.env.DB.prepare('UPDATE users SET email = ?, pw_salt = ?, pw_verifier = ?, failed_logins = 0, locked_until = NULL WHERE id = ?')
    .bind(email, body.salt, await sha256(body.verifier), u)
    .run();
  return c.json({ ok: true });
});

meRoutes.post('/recovery', async (c) => {
  const { recoveryVerifier } = await c.req.json<{ recoveryVerifier: string }>();
  if (!isHex64(recoveryVerifier)) return c.json({ error: 'invalid' }, 400);
  await c.env.DB.prepare('UPDATE users SET recovery_verifier = ? WHERE id = ?').bind(await sha256(recoveryVerifier), c.get('user').u).run();
  return c.json({ ok: true });
});

meRoutes.post('/link-google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'google_disabled' }, 404);
  const { credential } = await c.req.json<{ credential: string }>();
  const claims = await verifyGoogleIdToken(credential, c.env.GOOGLE_CLIENT_ID);
  if (!claims) return c.json({ error: 'google_invalid' }, 401);
  const owner = await c.env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(claims.sub).first<{ id: string }>();
  if (owner && owner.id !== c.get('user').u) return c.json({ error: 'google_taken' }, 409);
  await c.env.DB.prepare('UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?').bind(claims.sub, claims.email ?? null, c.get('user').u).run();
  return c.json({ ok: true, googleEmail: claims.email ?? null });
});

meRoutes.post('/logout', async (c) => {
  await c.env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').bind(Date.now(), c.get('user').d).run();
  return c.json({ ok: true });
});
