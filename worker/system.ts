import { D1_DAILY_WRITES, D1_DB_BYTES, DAY, MAX_SHARDS, shardDb, utcDay, type Env } from './env';

export type SignupStatus = 'open' | 'waitlist' | 'closed';

export async function getSystem(env: Env, key: string, fallback: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM system WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

async function setSystem(env: Env, key: string, value: string) {
  await env.DB.prepare('INSERT INTO system (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function purgeTenant(env: Env, tenantId: string, shard: number, maxRounds: number): Promise<boolean> {
  const db = shardDb(env, shard);
  for (let i = 0; i < maxRounds; i++) {
    const res = await db
      .prepare('DELETE FROM records WHERE seq IN (SELECT seq FROM records WHERE tenant_id = ? LIMIT 1000)')
      .bind(tenantId)
      .run();
    if (res.meta.changes < 1000) return true;
  }
  return false;
}

export async function runDailyMaintenance(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invites WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(utcDay(now - 7 * DAY)),
  ]);

  const deleted = await env.DB.prepare('SELECT id, shard FROM tenants WHERE deleted_at IS NOT NULL').all<{ id: string; shard: number }>();
  for (const t of deleted.results) {
    if (await purgeTenant(env, t.id, t.shard, 20)) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM usage WHERE tenant_id = ?').bind(t.id),
        env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(t.id),
      ]);
    }
  }

  const today = await env.DB.prepare('SELECT COALESCE(SUM(entries), 0) AS n FROM usage WHERE day = ?').bind(utcDay(now)).first<{ n: number }>();
  // Each entry costs roughly 3 written rows: the row plus two indexes.
  const writeShare = ((today?.n ?? 0) * 3) / D1_DAILY_WRITES;
  const hotDays = writeShare > 0.7 ? Number(await getSystem(env, 'hot_days', '0')) + 1 : 0;
  await setSystem(env, 'hot_days', String(hotDays));

  let activeShard = -1;
  for (let s = 0; s <= MAX_SHARDS; s++) {
    if (s > 0 && !env[`DB_SHARD_${s}`]) break;
    const probe = await shardDb(env, s).prepare('SELECT 1').run();
    const size = probe.meta.size_after ?? 0;
    await setSystem(env, `shard_size_${s}`, String(size));
    if (activeShard < 0 && size < D1_DB_BYTES * 0.8) activeShard = s;
  }

  const status: SignupStatus = activeShard < 0 ? 'closed' : hotDays >= 3 ? 'waitlist' : 'open';
  await setSystem(env, 'signup', status);
  if (activeShard >= 0) await setSystem(env, 'active_shard', String(activeShard));
}
