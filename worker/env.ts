import type { TenantLive } from './live';

export interface Env {
  DB: D1Database;
  LIVE: DurableObjectNamespace<TenantLive>;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ADMIN_WA?: string;
  AUTH_LIMIT?: RateLimit;
  [shard: `DB_SHARD_${number}`]: D1Database | undefined;
}

export interface UserToken {
  k: 'u';
  u: string;
  d: string;
  exp: number;
}

export interface TenantToken {
  k: 't';
  u?: string;
  d: string;
  t: string;
  r: Role;
  s: number;
  exp: number;
}

export type Role = 'owner' | 'cashier';

export type AppEnv = {
  Bindings: Env;
  Variables: { user: UserToken; tenant: TenantToken & { migrating?: boolean } };
};

export const DAY = 86_400_000;
export const ENTRY_DAILY_QUOTA = 300;
export const PUSH_MAX = 200;
export const PULL_MAX = 500;
export const D1_DAILY_WRITES = 100_000;
export const D1_DB_BYTES = 500 * 1024 * 1024;
export const MAX_SHARDS = 9;

export function shardDb(env: Env, shard: number): D1Database {
  return (shard > 0 && env[`DB_SHARD_${shard}`]) || env.DB;
}

export function utcDay(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}
