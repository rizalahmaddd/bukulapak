import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';

// Each call gets its own client IP so the per-IP auth throttle doesn't trip unrelated tests.
const randomIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;

async function call(path: string, opts: { method?: string; body?: unknown; token?: string; ip?: string } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'cf-connecting-ip': opts.ip ?? randomIp(),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
// Real clients derive the key with PBKDF2; the server only ever sees the derived hex.
const keyFor = (pw: string, salt: string) => hex(`${salt}:${pw}`);

async function newUser(name: string) {
  const email = `${name}-${randomUUID().slice(0, 8)}@contoh.id`;
  const salt = randomUUID().replace(/-/g, '');
  const code = 'ABCD2345WXYZ';
  const r = await call('/auth/register', { body: { name, email, salt, verifier: keyFor('rahasia-kuat-1', salt), recoveryVerifier: hex(code), deviceLabel: 'test' } });
  expect(r.status).toBe(200);
  return { email, salt, code, token: r.body.token as string };
}

async function newTenant(userToken: string, name: string, migrate = false) {
  const r = await call('/tenants', { token: userToken, body: { name, businessType: 'fnb', migrate } });
  expect(r.status).toBe(200);
  return { id: r.body.tenant.id as string, token: r.body.token as string };
}

const entry = (id: string, amount: number) => ({ id, type: 'entry', data: { id, type: 'entry', amount, lines: [] } });

describe('api', () => {
  it('serves config', async () => {
    const r = await call('/config');
    expect(r.status).toBe(200);
    expect(r.body.signup).toBe('open');
  });

  it('login, wrong password, fake salt for unknown emails, lockout', async () => {
    const u = await newUser('ani');
    const salt = await call('/auth/salt', { body: { email: u.email } });
    expect(salt.body.salt).toBe(u.salt);
    const fake1 = await call('/auth/salt', { body: { email: 'tidak-ada@contoh.id' } });
    const fake2 = await call('/auth/salt', { body: { email: 'tidak-ada@contoh.id' } });
    expect(fake1.body.salt).toBe(fake2.body.salt);

    expect((await call('/auth/login', { body: { email: u.email, key: keyFor('salah', u.salt) } })).status).toBe(401);
    expect((await call('/auth/login', { body: { email: u.email, key: keyFor('rahasia-kuat-1', u.salt) } })).status).toBe(200);
    for (let i = 0; i < 5; i++) await call('/auth/login', { body: { email: u.email, key: keyFor('salah', u.salt) } });
    expect((await call('/auth/login', { body: { email: u.email, key: keyFor('rahasia-kuat-1', u.salt) } })).status).toBe(423);
  });

  it('recovery code resets the password', async () => {
    const u = await newUser('budi');
    const salt = randomUUID().replace(/-/g, '');
    const bad = await call('/auth/recover', { body: { email: u.email, code: 'XXXX-XXXX-XXXX', salt, verifier: keyFor('baru-sekali-9', salt), recoveryVerifier: hex('NEW') } });
    expect(bad.status).toBe(401);
    const ok = await call('/auth/recover', { body: { email: u.email, code: 'abcd-2345-wxyz', salt, verifier: keyFor('baru-sekali-9', salt), recoveryVerifier: hex('NEXTCODE') } });
    expect(ok.status).toBe(200);
    expect((await call('/auth/login', { body: { email: u.email, key: keyFor('rahasia-kuat-1', u.salt) } })).status).toBe(401);
    expect((await call('/auth/login', { body: { email: u.email, key: keyFor('baru-sekali-9', salt) } })).status).toBe(200);
  });

  it('isolates tenants: data, sessions and forged tokens', async () => {
    const a = await newUser('a');
    const b = await newUser('b');
    const ta = await newTenant(a.token, 'Warung A');
    const tb = await newTenant(b.token, 'Warung B');
    const push = await call('/sync/push', { token: ta.token, body: { ops: [entry('ENTRY-A-000001', 5000)] } });
    expect(push.status).toBe(200);

    const pullB = await call('/sync/pull?since=0', { token: tb.token });
    expect(pullB.body.records).toEqual([]);
    const pullA = await call('/sync/pull?since=0', { token: ta.token });
    expect(pullA.body.records.map((r: any) => r.id)).toEqual(['ENTRY-A-000001']);

    expect((await call(`/tenants/${ta.id}/session`, { method: 'POST', token: b.token })).status).toBe(404);
    expect((await call(`/tenants/${ta.id}/invites`, { method: 'POST', token: b.token })).status).toBe(404);
    expect((await call(`/tenants/${ta.id}/devices`, { token: b.token })).status).toBe(404);
    expect((await call(`/tenants/${ta.id}`, { method: 'DELETE', token: b.token })).status).toBe(404);

    const [body] = ta.token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = `${Buffer.from(JSON.stringify({ ...payload, t: tb.id })).toString('base64url')}.${ta.token.split('.')[1]}`;
    expect((await call('/sync/pull?since=0', { token: forged })).status).toBe(401);
    expect((await call('/sync/pull?since=0', { token: a.token })).status).toBe(401);
  });

  it('entries are immutable, master data is last-write-wins', async () => {
    const u = await newUser('c');
    const t = await newTenant(u.token, 'Toko C');
    await call('/sync/push', { token: t.token, body: { ops: [entry('ENTRY-C-000001', 1000)] } });
    await call('/sync/push', { token: t.token, body: { ops: [entry('ENTRY-C-000001', 9999)] } });
    const acc = (name: string) => ({ id: 'ACCOUNT-C-01', type: 'account', data: { id: 'ACCOUNT-C-01', type: 'account', name } });
    await call('/sync/push', { token: t.token, body: { ops: [acc('Laci')] } });
    await call('/sync/push', { token: t.token, body: { ops: [acc('Laci Depan')] } });
    await call('/sync/push', { token: t.token, body: { ops: [{ id: 'ENTRY-C-000001', type: 'account', data: { hijack: true } }] } });
    const pull = await call('/sync/pull?since=0', { token: t.token });
    const byId = Object.fromEntries(pull.body.records.map((r: any) => [r.id, r]));
    expect(byId['ENTRY-C-000001'].data.amount).toBe(1000);
    expect(byId['ENTRY-C-000001'].type).toBe('entry');
    expect(byId['ACCOUNT-C-01'].data.name).toBe('Laci Depan');
    expect(pull.body.records.length).toBe(2);
  });

  it('pull pages through large histories', async () => {
    const u = await newUser('d');
    const t = await newTenant(u.token, 'Toko D', true);
    for (let i = 0; i < 4; i++) {
      const ops = Array.from({ length: 200 }, (_, j) => entry(`ENTRY-D-${String(i * 200 + j).padStart(6, '0')}`, 1));
      expect((await call('/sync/push', { token: t.token, body: { ops, migration: true } })).status).toBe(200);
    }
    let since = 0;
    let total = 0;
    for (;;) {
      const p = await call(`/sync/pull?since=${since}`, { token: t.token });
      total += p.body.records.length;
      since = p.body.next;
      if (!p.body.more) break;
    }
    expect(total).toBe(800);
  });

  it('enforces the daily entry quota outside migrations', async () => {
    const u = await newUser('e');
    const t = await newTenant(u.token, 'Toko E');
    for (let i = 0; i < 2; i++) {
      const ops = Array.from({ length: 150 }, (_, j) => entry(`ENTRY-E-${String(i * 150 + j).padStart(6, '0')}`, 1));
      expect((await call('/sync/push', { token: t.token, body: { ops } })).status).toBe(200);
    }
    const over = await call('/sync/push', { token: t.token, body: { ops: [entry('ENTRY-E-999999', 1)] } });
    expect(over.status).toBe(429);
    const masterOnly = await call('/sync/push', { token: t.token, body: { ops: [{ id: 'CONTACT-E-1', type: 'contact', data: { id: 'CONTACT-E-1', type: 'contact', name: 'x' } }] } });
    expect(masterOnly.status).toBe(200);
  });

  it('cashier invite, role limits and revocation', async () => {
    const u = await newUser('f');
    const t = await newTenant(u.token, 'Toko F');
    const inv = await call(`/tenants/${t.id}/invites`, { method: 'POST', token: u.token });
    expect(inv.body.code).toMatch(/^\d{6}$/);
    const join = await call('/tenants/invites/accept', { body: { code: inv.body.code, label: 'Rina' } });
    expect(join.status).toBe(200);
    expect((await call('/tenants/invites/accept', { body: { code: inv.body.code, label: 'Lagi' } })).status).toBe(404);
    const ct = join.body.token as string;
    expect((await call('/sync/push', { token: ct, body: { ops: [entry('ENTRY-F-000001', 1)] } })).status).toBe(200);
    expect((await call('/sync/push', { token: ct, body: { ops: [{ id: 'settings', type: 'settings', data: {} }] } })).status).toBe(403);
    // Clients store the record from `data`, so a cashier must not smuggle a settings record inside an allowed type.
    const smuggled = { id: 'CONTACT-F-01', type: 'contact', data: { id: 'SETTINGS-F-01', type: 'settings', name: 'Diambil alih' } };
    expect((await call('/sync/push', { token: ct, body: { ops: [smuggled] } })).status).toBe(400);
    const devices = await call(`/tenants/${t.id}/devices`, { token: u.token });
    const cashier = devices.body.devices.find((d: any) => d.role === 'cashier');
    expect(cashier.label).toBe('Rina');
    expect((await call(`/tenants/${t.id}/devices/${cashier.id}`, { method: 'DELETE', token: u.token })).status).toBe(200);
    expect((await call('/sync/pull?since=0', { token: ct })).status).toBe(401);
  });

  it('deleting a business removes access and data', async () => {
    const u = await newUser('g');
    const t = await newTenant(u.token, 'Toko G');
    await call('/sync/push', { token: t.token, body: { ops: [entry('ENTRY-G-000001', 1)] } });
    expect((await call(`/tenants/${t.id}`, { method: 'DELETE', token: u.token })).status).toBe(200);
    expect((await call('/sync/pull?since=0', { token: t.token })).status).toBe(401);
    const me = await call('/me', { token: u.token });
    expect(me.body.tenants).toEqual([]);
  });

  it('throttles auth requests per IP', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await call('/auth/salt', { ip, body: { email: 'banjir@contoh.id' } })).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await call('/auth/salt', { body: { email: 'banjir@contoh.id' } })).status).toBe(200);
  });

  it('rejects malformed pushes', async () => {
    const u = await newUser('h');
    const t = await newTenant(u.token, 'Toko H');
    expect((await call('/sync/push', { token: t.token, body: { ops: [{ id: 'x', type: 'entry', data: {} }] } })).status).toBe(400);
    expect((await call('/sync/push', { token: t.token, body: { ops: [{ id: 'VALID-ID-1', type: 'evil', data: {} }] } })).status).toBe(400);
    const garbled = await fetch(`${BASE}/api/auth/salt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' });
    expect(garbled.status).toBe(400);
    const big = 'x'.repeat(20_000);
    expect((await call('/sync/push', { token: t.token, body: { ops: [{ id: 'VALID-ID-2', type: 'contact', data: { id: 'VALID-ID-2', type: 'contact', big } }] } })).status).toBe(413);
  });

  it('live socket tells other devices to pull, not the sender', async () => {
    const u = await newUser('i');
    const t = await newTenant(u.token, 'Toko I');
    const inv = await call(`/tenants/${t.id}/invites`, { method: 'POST', token: u.token });
    const cashier = (await call('/tenants/invites/accept', { body: { code: inv.body.code, label: 'Kasir' } })).body.token as string;

    const open = (token: string) =>
      new Promise<{ ws: WebSocket; got: string[] }>((resolve, reject) => {
        const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/sync/live`, ['bukulapak', token]);
        const got: string[] = [];
        ws.onmessage = (e) => got.push(String(e.data));
        ws.onopen = () => resolve({ ws, got });
        ws.onerror = () => reject(new Error('socket failed'));
      });
    const owner = await open(t.token);
    const sender = await open(cashier);
    expect(owner.ws.protocol).toBe('bukulapak');

    expect((await call('/sync/push', { token: cashier, body: { ops: [entry('ENTRY-I-000001', 1)] } })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(owner.got).toEqual(['sync']);
    expect(sender.got).toEqual([]);

    // A resent entry changes nothing on the server, so nobody needs to pull.
    await call('/sync/push', { token: cashier, body: { ops: [entry('ENTRY-I-000001', 1)] } });
    await new Promise((r) => setTimeout(r, 500));
    expect(owner.got).toEqual(['sync']);

    owner.ws.close();
    sender.ws.close();
    await expect(open('bukan.token')).rejects.toThrow();
  });
});
