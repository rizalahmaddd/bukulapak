import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Env } from './env';
import { authRoutes, meRoutes, requireUser } from './auth';
import { deleteTenant, tenantRoutes } from './tenants';
import { syncRoutes } from './sync';
import { getSystem, runDailyMaintenance } from './system';

export { TenantLive } from './live';

const app = new Hono<AppEnv>().basePath('/api');

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

app.onError((err, c) => {
  // c.req.json() throws SyntaxError on a malformed body; that's the client's fault, not a server error.
  if (err instanceof SyntaxError) return c.json({ error: 'invalid' }, 400);
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

// Per-IP throttle on unauthenticated endpoints; per-account lockout alone lets one IP lock out many accounts.
const throttle = createMiddleware<AppEnv>(async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const res = await c.env.AUTH_LIMIT?.limit({ key: ip });
  if (res && !res.success) return c.json({ error: 'rate_limited' }, 429);
  await next();
});
app.use('/auth/*', throttle);
app.use('/tenants/invites/accept', throttle);

app.get('/config', async (c) =>
  c.json({
    googleClientId: c.env.GOOGLE_CLIENT_ID || null,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    adminWa: c.env.ADMIN_WA || null,
    signup: await getSystem(c.env, 'signup', 'open'),
  }),
);

app.get('/status', async (c) => c.json({ signup: await getSystem(c.env, 'signup', 'open') }));

app.delete('/me', requireUser, async (c) => {
  const user = { id: c.get('user').u };
  const owned = await c.env.DB.prepare(
    "SELECT t.id, t.shard FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? AND m.role = 'owner'",
  )
    .bind(user.id)
    .all<{ id: string; shard: number }>();
  for (const t of owned.results) await deleteTenant(c.env, t.id, t.shard);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM memberships WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM devices WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return c.json({ ok: true });
});

app.route('/auth', authRoutes);
app.route('/me', meRoutes);
app.route('/tenants', tenantRoutes);
app.route('/sync', syncRoutes);

app.all('*', (c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
