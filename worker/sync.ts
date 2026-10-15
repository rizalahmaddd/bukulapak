import { Hono } from 'hono';
import { D1_DAILY_WRITES, DAY, ENTRY_DAILY_QUOTA, PULL_MAX, PUSH_MAX, shardDb, utcDay, type AppEnv } from './env';
import { requireTenant } from './auth';
import { tenantToken } from './tenants';

const TYPES = new Set(['settings', 'account', 'category', 'contact', 'entry', 'debt', 'order', 'shift']);
const CASHIER_TYPES = new Set(['entry', 'contact', 'debt', 'order', 'shift']);
const MAX_RECORD_BYTES = 16_000;
// Leave headroom in the shared daily write budget for regular syncing before accepting bulk migrations.
const MIGRATION_GLOBAL_LIMIT = Math.floor((D1_DAILY_WRITES * 0.6) / 3);

interface Op {
  id: string;
  type: string;
  data: unknown;
}

export const syncRoutes = new Hono<AppEnv>();
syncRoutes.use('*', requireTenant);

syncRoutes.use('*', async (c, next) => {
  const tok = c.get('tenant');
  const row = await c.env.DB.prepare(
    'SELECT d.revoked_at, d.last_sync_at, t.deleted_at, t.migrate_until FROM devices d, tenants t WHERE d.id = ? AND t.id = ?',
  )
    .bind(tok.d, tok.t)
    .first<{ revoked_at: number | null; last_sync_at: number | null; deleted_at: number | null; migrate_until: number | null }>();
  if (!row || row.revoked_at || row.deleted_at) return c.json({ error: 'revoked' }, 401);
  if (tok.u) {
    const member = await c.env.DB.prepare('SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?').bind(tok.u, tok.t).first();
    if (!member) return c.json({ error: 'revoked' }, 401);
  }
  // Touch last_sync_at at most daily; a write on every sync would eat the free write budget.
  if (!row.last_sync_at || utcDay(row.last_sync_at) !== utcDay()) {
    await c.env.DB.prepare('UPDATE devices SET last_sync_at = ? WHERE id = ?').bind(Date.now(), tok.d).run();
  }
  // A 101 response can't hand a renewed token to the page; the next push/pull renews it instead.
  if (tok.exp - Date.now() < 7 * DAY && c.req.header('upgrade') !== 'websocket') {
    c.header('X-New-Token', await tenantToken(c.env, { u: tok.u, d: tok.d, t: tok.t, r: tok.r, s: tok.s }));
  }
  c.set('tenant', { ...tok, migrating: !!row.migrate_until && row.migrate_until > Date.now() });
  await next();
});

syncRoutes.post('/push', async (c) => {
  const tok = c.get('tenant');
  const body = await c.req.json<{ ops: Op[]; migration?: boolean }>();
  if (!Array.isArray(body.ops) || body.ops.length === 0) return c.json({ accepted: [] });
  if (body.ops.length > PUSH_MAX) return c.json({ error: 'too_many' }, 413);

  const entries: { id: string; type: string; data: string }[] = [];
  const others: { id: string; type: string; data: string }[] = [];
  for (const op of body.ops) {
    if (typeof op?.id !== 'string' || op.id.length < 8 || op.id.length > 40 || !TYPES.has(op.type)) return c.json({ error: 'invalid_op' }, 400);
    if (tok.r === 'cashier' && !CASHIER_TYPES.has(op.type)) return c.json({ error: 'forbidden', id: op.id }, 403);
    // Devices store the record found in `data`, so it must be the record the op claims to be.
    const rec = op.data as { id?: unknown; type?: unknown } | null;
    if (!rec || typeof rec !== 'object' || rec.id !== op.id || rec.type !== op.type) return c.json({ error: 'invalid_op', id: op.id }, 400);
    const data = JSON.stringify(op.data);
    if (!data || data.length > MAX_RECORD_BYTES) return c.json({ error: 'too_large', id: op.id }, 413);
    (op.type === 'entry' ? entries : others).push({ id: op.id, type: op.type, data });
  }

  const today = utcDay();
  const db = shardDb(c.env, tok.s);
  const bulk = !!body.migration && !!tok.migrating;
  if (entries.length) {
    if (bulk) {
      const global = await c.env.DB.prepare('SELECT COALESCE(SUM(entries), 0) AS n FROM usage WHERE day = ?').bind(today).first<{ n: number }>();
      if ((global?.n ?? 0) + entries.length > MIGRATION_GLOBAL_LIMIT) return c.json({ error: 'budget', retry: 'tomorrow' }, 429);
    } else {
      const used = await c.env.DB.prepare('SELECT entries FROM usage WHERE tenant_id = ? AND day = ?').bind(tok.t, today).first<{ entries: number }>();
      if ((used?.entries ?? 0) >= ENTRY_DAILY_QUOTA) return c.json({ error: 'quota', retry: 'tomorrow' }, 429);
    }
  }

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (entries.length) {
    // Entries are append-only: a resent entry is ignored, never overwritten.
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO records (tenant_id, id, type, data, received_at)
           SELECT ?1, json_extract(value, '$.id'), 'entry', json_extract(value, '$.data'), ?2 FROM json_each(?3)`,
        )
        .bind(tok.t, now, JSON.stringify(entries)),
    );
  }
  if (others.length) {
    const payload = JSON.stringify(others);
    // Delete + insert gives the record a fresh seq so other devices pull the newest version.
    stmts.push(
      db
        .prepare(
          `DELETE FROM records WHERE tenant_id = ?1 AND type <> 'entry'
           AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
        )
        .bind(tok.t, payload),
      db
        .prepare(
          `INSERT OR IGNORE INTO records (tenant_id, id, type, data, received_at)
           SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.type'), json_extract(value, '$.data'), ?2 FROM json_each(?3)`,
        )
        .bind(tok.t, now, payload),
    );
  }
  const results = await db.batch(stmts);
  const inserted = entries.length ? results[0].meta.changes : 0;
  if (inserted > 0) {
    await c.env.DB.prepare(
      'INSERT INTO usage (tenant_id, day, entries) VALUES (?, ?, ?) ON CONFLICT (tenant_id, day) DO UPDATE SET entries = entries + excluded.entries',
    )
      .bind(tok.t, today, inserted)
      .run();
  }
  if (inserted > 0 || others.length) {
    // Fire-and-forget: devices that miss the hint still catch up on their next regular sync.
    const hint = c.env.LIVE.get(c.env.LIVE.idFromName(tok.t)).notify(tok.d).catch((err) => console.error('live notify', err));
    c.executionCtx.waitUntil(hint);
  }
  return c.json({ accepted: body.ops.map((o) => o.id), serverTime: now });
});

// Hands the socket to the tenant's Durable Object after the middleware above has checked the token and device.
syncRoutes.get('/live', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') return c.json({ error: 'expected_websocket' }, 426);
  const tok = c.get('tenant');
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-device', tok.d);
  return c.env.LIVE.get(c.env.LIVE.idFromName(tok.t)).fetch(new Request(c.req.url, { headers }));
});

syncRoutes.get('/pull', async (c) => {
  const tok = c.get('tenant');
  const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
  const rows = await shardDb(c.env, tok.s)
    .prepare('SELECT seq, id, type, data, received_at FROM records WHERE tenant_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(tok.t, since, PULL_MAX + 1)
    .all<{ seq: number; id: string; type: string; data: string; received_at: number }>();
  const more = rows.results.length > PULL_MAX;
  const page = more ? rows.results.slice(0, PULL_MAX) : rows.results;
  return c.json({
    records: page.map((r) => ({ id: r.id, type: r.type, data: JSON.parse(r.data), receivedAt: r.received_at })),
    next: page.length ? page[page.length - 1].seq : since,
    more,
    role: tok.r,
    serverTime: Date.now(),
  });
});
