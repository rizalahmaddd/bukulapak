import { Hono } from 'hono';
import { DAY, type AppEnv, type Env, type Role, type TenantToken } from './env';
import { randomDigits, randomId, sha256, signToken } from './crypto';
import { requireUser, verifyTurnstile } from './auth';
import { getSystem, purgeTenant } from './system';

const OWNER_TOKEN_TTL = 30 * DAY;
const CASHIER_TOKEN_TTL = 365 * DAY;
const INVITE_TTL = 10 * 60_000;
const MIGRATION_WINDOW = 7 * DAY;
const BUSINESS_TYPES = ['kelontong', 'fnb', 'fashion', 'jasa', 'grosir', 'lainnya'];

export async function tenantToken(env: Env, p: Omit<TenantToken, 'k' | 'exp'>) {
  const ttl = p.r === 'owner' ? OWNER_TOKEN_TTL : CASHIER_TOKEN_TTL;
  return signToken(env.SESSION_SECRET, { k: 't', ...p, exp: Date.now() + ttl } satisfies TenantToken);
}

async function ownedTenant(env: Env, userId: string, tenantId: string) {
  return env.DB.prepare(
    `SELECT t.id, t.shard FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? AND m.tenant_id = ? AND m.role = 'owner' AND t.deleted_at IS NULL`,
  )
    .bind(userId, tenantId)
    .first<{ id: string; shard: number }>();
}

export async function deleteTenant(env: Env, tenantId: string, shard: number) {
  await env.DB.batch([
    env.DB.prepare('UPDATE tenants SET deleted_at = ? WHERE id = ?').bind(Date.now(), tenantId),
    env.DB.prepare('DELETE FROM memberships WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('DELETE FROM invites WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE tenant_id = ?').bind(Date.now(), tenantId),
  ]);
  // Whatever doesn't fit in this request is finished by the daily cron.
  await purgeTenant(env, tenantId, shard, 20);
}

export const tenantRoutes = new Hono<AppEnv>();

tenantRoutes.post('/invites/accept', async (c) => {
  const body = await c.req.json<{ code: string; label?: string; turnstile?: string }>();
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header('cf-connecting-ip')))) return c.json({ error: 'turnstile' }, 400);
  const code = String(body.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) return c.json({ error: 'invalid_code' }, 400);
  const hash = await sha256(code);
  const invite = await c.env.DB.prepare(
    `SELECT i.tenant_id, i.role, t.name, t.business_type, t.shard FROM invites i JOIN tenants t ON t.id = i.tenant_id
     WHERE i.code_hash = ? AND i.expires_at > ? AND t.deleted_at IS NULL`,
  )
    .bind(hash, Date.now())
    .first<{ tenant_id: string; role: Role; name: string; business_type: string; shard: number }>();
  if (!invite) return c.json({ error: 'invalid_code' }, 404);
  const deviceId = randomId(12);
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : 'HP Kasir';
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM invites WHERE code_hash = ?').bind(hash),
    c.env.DB.prepare('INSERT INTO devices (id, tenant_id, role, label, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      deviceId,
      invite.tenant_id,
      invite.role,
      label,
      Date.now(),
    ),
  ]);
  const token = await tenantToken(c.env, { d: deviceId, t: invite.tenant_id, r: invite.role, s: invite.shard });
  return c.json({ token, tenant: { id: invite.tenant_id, name: invite.name, businessType: invite.business_type, role: invite.role } });
});

tenantRoutes.use('*', requireUser);

tenantRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string; businessType: string; migrate?: boolean }>();
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name || !BUSINESS_TYPES.includes(body.businessType)) return c.json({ error: 'invalid' }, 400);
  if ((await getSystem(c.env, 'signup', 'open')) === 'closed') return c.json({ error: 'signup_paused', signup: 'closed' }, 403);
  const { u, d } = c.get('user');
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ? AND role = 'owner'").bind(u).first<{ n: number }>();
  if ((count?.n ?? 0) >= 10) return c.json({ error: 'too_many_tenants' }, 400);
  const id = randomId(12);
  const shard = Number(await getSystem(c.env, 'active_shard', '0'));
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO tenants (id, name, business_type, shard, migrate_until, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      name,
      body.businessType,
      shard,
      body.migrate ? now + MIGRATION_WINDOW : null,
      now,
    ),
    c.env.DB.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')").bind(u, id),
  ]);
  const token = await tenantToken(c.env, { u, d, t: id, r: 'owner', s: shard });
  return c.json({ tenant: { id, name, businessType: body.businessType, role: 'owner' }, token });
});

tenantRoutes.post('/:id/session', async (c) => {
  const { u, d } = c.get('user');
  const row = await c.env.DB.prepare(
    `SELECT m.role, t.shard FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? AND m.tenant_id = ? AND t.deleted_at IS NULL`,
  )
    .bind(u, c.req.param('id'))
    .first<{ role: Role; shard: number }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ token: await tenantToken(c.env, { u, d, t: c.req.param('id'), r: row.role, s: row.shard }), role: row.role });
});

tenantRoutes.patch('/:id', async (c) => {
  const t = await ownedTenant(c.env, c.get('user').u, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json<{ name?: string; businessType?: string }>();
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (name) await c.env.DB.prepare('UPDATE tenants SET name = ? WHERE id = ?').bind(name, t.id).run();
  if (body.businessType && BUSINESS_TYPES.includes(body.businessType)) {
    await c.env.DB.prepare('UPDATE tenants SET business_type = ? WHERE id = ?').bind(body.businessType, t.id).run();
  }
  return c.json({ ok: true });
});

tenantRoutes.post('/:id/migrate', async (c) => {
  const t = await ownedTenant(c.env, c.get('user').u, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare('UPDATE tenants SET migrate_until = ? WHERE id = ?').bind(Date.now() + MIGRATION_WINDOW, t.id).run();
  return c.json({ ok: true });
});

tenantRoutes.delete('/:id', async (c) => {
  const t = await ownedTenant(c.env, c.get('user').u, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  await deleteTenant(c.env, t.id, t.shard);
  return c.json({ ok: true });
});

tenantRoutes.post('/:id/invites', async (c) => {
  const { u } = c.get('user');
  const t = await ownedTenant(c.env, u, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  const code = randomDigits(6);
  const expiresAt = Date.now() + INVITE_TTL;
  await c.env.DB.prepare("INSERT OR REPLACE INTO invites (code_hash, tenant_id, role, created_by, expires_at) VALUES (?, ?, 'cashier', ?, ?)")
    .bind(await sha256(code), t.id, u, expiresAt)
    .run();
  return c.json({ code, expiresAt });
});

tenantRoutes.get('/:id/devices', async (c) => {
  const t = await ownedTenant(c.env, c.get('user').u, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT id, label, role, created_at AS createdAt, last_sync_at AS lastSyncAt, revoked_at AS revokedAt FROM devices
     WHERE tenant_id = ?1 OR user_id IN (SELECT user_id FROM memberships WHERE tenant_id = ?1)
     ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(t.id)
    .all();
  return c.json({ devices: rows.results });
});

tenantRoutes.delete('/:id/devices/:deviceId', async (c) => {
  const t = await ownedTenant(c.env, c.get('user').u, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  const res = await c.env.DB.prepare(
    `UPDATE devices SET revoked_at = ?1 WHERE id = ?2
     AND (tenant_id = ?3 OR user_id IN (SELECT user_id FROM memberships WHERE tenant_id = ?3))`,
  )
    .bind(Date.now(), c.req.param('deviceId'), t.id)
    .run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});
