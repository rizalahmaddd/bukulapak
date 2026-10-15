import type { AnyRecord, BusinessType, Category, Contact, Entry, Tz } from '../domain/types';
import { presetAccounts, presetCategories, presetSettings } from '../domain/presets';
import { opening } from '../domain/ledger';
import { ulid } from '../domain/util';
import { api, derivePasswordKey, newRecoveryCode, newSalt, recoveryVerifier } from './api';
import { WorkspaceDb } from './idb';
import { activeWs, meta, updateMeta, updateWs, type Workspace } from './meta';
import { ctx, currentDb, openWorkspace, save } from './data';
import { syncNow } from './sync';

export interface TenantInfo {
  id: string;
  name: string;
  businessType: BusinessType;
  role: 'owner' | 'cashier';
}

export interface Me {
  user: NonNullable<typeof meta.value.user>;
  tenants: TenantInfo[];
}

function addWorkspace(ws: Workspace) {
  updateMeta((m) => {
    m.workspaces.push(ws);
    m.active = ws.id;
  });
}

export async function switchWorkspace(id: string) {
  updateMeta((m) => {
    m.active = id;
  });
  await openWorkspace(id);
  void syncNow();
}

async function seed(name: string, businessType: BusinessType, tz: Tz, balances: Record<string, number>) {
  const now = Date.now();
  const accs = presetAccounts(now);
  const cats = presetCategories(businessType, now);
  const records: AnyRecord[] = [presetSettings(name, businessType, tz, now), ...accs, ...cats];
  await save(...records);
  const c = ctx();
  const kinds = ['cash', 'bank', 'qris'] as const;
  const openings: Entry[] = [];
  kinds.forEach((k) => {
    const amount = balances[k] ?? 0;
    const acc = accs.find((a) => a.kind === k)!;
    if (amount > 0) openings.push(opening({ ...c, account: (id) => accs.find((a) => a.id === id) }, acc.id, amount));
  });
  if (openings.length) await save(...openings);
}

export async function createGuestWorkspace(name: string, businessType: BusinessType, tz: Tz, balances: Record<string, number>) {
  const ws: Workspace = { id: ulid(), name, role: 'guest', cursor: 0, createdAt: Date.now() };
  addWorkspace(ws);
  await openWorkspace(ws.id);
  await seed(name, businessType, tz, balances);
}

export async function createTenantWorkspace(name: string, businessType: BusinessType, tz: Tz, balances: Record<string, number>) {
  const token = meta.value.userToken;
  if (!token) throw new Error('login');
  const { data } = await api<{ tenant: TenantInfo; token: string }>('/tenants', { token, body: { name, businessType } });
  const ws: Workspace = { id: ulid(), name, role: 'owner', tenantId: data.tenant.id, token: data.token, cursor: 0, createdAt: Date.now() };
  addWorkspace(ws);
  await openWorkspace(ws.id);
  await seed(name, businessType, tz, balances);
  void syncNow();
}

export async function fetchMe(): Promise<Me | null> {
  const token = meta.value.userToken;
  if (!token) return null;
  const { data } = await api<Me>('/me', { token });
  updateMeta((m) => {
    m.user = data.user;
    for (const ws of m.workspaces) {
      const t = data.tenants.find((x) => x.id === ws.tenantId);
      if (t) ws.name = t.name;
    }
  });
  return data;
}

export async function openTenant(t: TenantInfo, opts: { waitPull?: boolean } = {}) {
  const existing = meta.value.workspaces.find((w) => w.tenantId === t.id && w.role !== 'cashier');
  if (existing) {
    await switchWorkspace(existing.id);
    if (opts.waitPull) await syncNow();
    return existing.id;
  }
  const { data } = await api<{ token: string; role: 'owner' | 'cashier' }>(`/tenants/${t.id}/session`, { method: 'POST', token: meta.value.userToken });
  const ws: Workspace = { id: ulid(), name: t.name, role: data.role, tenantId: t.id, token: data.token, cursor: 0, createdAt: Date.now() };
  addWorkspace(ws);
  await openWorkspace(ws.id);
  await syncNow();
  return ws.id;
}

export function guestWorkspace(): Workspace | undefined {
  return meta.value.workspaces.find((w) => w.role === 'guest');
}

export interface GuestSummary {
  name: string;
  entries: number;
  contacts: number;
  orders: number;
  first?: number;
  last?: number;
}

export async function summarizeGuest(): Promise<GuestSummary | null> {
  const ws = guestWorkspace();
  if (!ws) return null;
  const db = await WorkspaceDb.open(ws.id);
  const all = await db.all();
  db.close();
  const entries = all.filter((r): r is Entry => r.type === 'entry');
  const ats = entries.map((e) => e.at).sort((a, b) => a - b);
  return {
    name: ws.name,
    entries: entries.length,
    contacts: all.filter((r) => r.type === 'contact').length,
    orders: all.filter((r) => r.type === 'order').length,
    first: ats[0],
    last: ats[ats.length - 1],
  };
}

function deviceLabel() {
  return meta.value.deviceLabel;
}

async function storeUserToken(token: string) {
  updateMeta((m) => {
    m.userToken = token;
  });
  return fetchMe();
}

export async function register(name: string, email: string, password: string, turnstile?: string) {
  const salt = newSalt();
  const code = newRecoveryCode();
  const verifier = await derivePasswordKey(password, salt);
  const { data } = await api<{ token: string }>('/auth/register', {
    body: { name, email, salt, verifier, recoveryVerifier: await recoveryVerifier(code), turnstile, deviceLabel: deviceLabel() },
  });
  return { me: await storeUserToken(data.token), recoveryCode: code };
}

export async function login(email: string, password: string, turnstile?: string) {
  const { data: s } = await api<{ salt: string }>('/auth/salt', { body: { email } });
  const key = await derivePasswordKey(password, s.salt);
  const { data } = await api<{ token: string }>('/auth/login', { body: { email, key, turnstile, deviceLabel: deviceLabel() } });
  return storeUserToken(data.token);
}

export async function loginGoogle(credential: string) {
  const { data } = await api<{ token: string }>('/auth/google', { body: { credential, deviceLabel: deviceLabel() } });
  return storeUserToken(data.token);
}

export async function recover(email: string, code: string, newPassword: string) {
  const salt = newSalt();
  const nextCode = newRecoveryCode();
  const verifier = await derivePasswordKey(newPassword, salt);
  const { data } = await api<{ token: string }>('/auth/recover', {
    body: { email, code, salt, verifier, recoveryVerifier: await recoveryVerifier(nextCode), deviceLabel: deviceLabel() },
  });
  return { me: await storeUserToken(data.token), recoveryCode: nextCode };
}

export async function changePassword(password: string, email?: string) {
  const salt = newSalt();
  const verifier = await derivePasswordKey(password, salt);
  await api('/me/password', { token: meta.value.userToken, body: { salt, verifier, email } });
  await fetchMe();
}

export async function regenerateRecoveryCode() {
  const code = newRecoveryCode();
  await api('/me/recovery', { token: meta.value.userToken, body: { recoveryVerifier: await recoveryVerifier(code) } });
  return code;
}

export async function linkGoogle(credential: string) {
  await api('/me/link-google', { token: meta.value.userToken, body: { credential } });
  await fetchMe();
}

export async function joinAsCashier(code: string, label: string, turnstile?: string) {
  const { data } = await api<{ token: string; tenant: TenantInfo }>('/tenants/invites/accept', { body: { code, label, turnstile } });
  updateMeta((m) => {
    m.deviceLabel = label || m.deviceLabel;
  });
  const ws: Workspace = { id: ulid(), name: data.tenant.name, role: 'cashier', tenantId: data.tenant.id, token: data.token, cursor: 0, createdAt: Date.now() };
  addWorkspace(ws);
  await openWorkspace(ws.id);
  await syncNow();
}

export async function migrateGuestAsNew() {
  const guest = guestWorkspace();
  if (!guest) return;
  const db = await WorkspaceDb.open(guest.id);
  const all = await db.all();
  const s = all.find((r) => r.type === 'settings');
  const name = s?.type === 'settings' ? s.name : guest.name;
  const businessType = s?.type === 'settings' ? s.businessType : 'lainnya';
  const { data } = await api<{ tenant: TenantInfo; token: string }>('/tenants', {
    token: meta.value.userToken,
    body: { name, businessType, migrate: true },
  });
  await db.queueAll();
  const total = await db.outboxCount();
  db.close();
  updateWs(guest.id, { role: 'owner', tenantId: data.tenant.id, token: data.token, name, migration: { total, mode: 'new' } });
  await switchWorkspace(guest.id);
}

function norm(s: string | undefined) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Merges guest data into an existing business: matching accounts/categories/contacts are reused, opening balances are skipped. */
export async function migrateGuestInto(target: TenantInfo) {
  const guest = guestWorkspace();
  if (!guest) return;
  await openTenant(target, { waitPull: true });
  const targetWs = activeWs()!;
  await api(`/tenants/${target.id}/migrate`, { method: 'POST', token: meta.value.userToken });

  const existing = await currentDb().all();
  const gdb = await WorkspaceDb.open(guest.id);
  const incoming = await gdb.all();
  gdb.close();

  const remap = new Map<string, string>();
  const findMatch = (r: AnyRecord): string | undefined => {
    if (r.type === 'account') return existing.find((x) => x.type === 'account' && norm(x.name) === norm(r.name))?.id;
    if (r.type === 'category') {
      return existing.find(
        (x) => x.type === 'category' && x.kind === r.kind && x.dir === r.dir && ((r.sys && x.sys === r.sys) || norm(x.name) === norm(r.name)),
      )?.id;
    }
    if (r.type === 'contact') {
      const c = r as Contact;
      return existing.find((x) => x.type === 'contact' && ((c.phone && x.phone === c.phone) || (!c.phone && norm(x.name) === norm(c.name))))?.id;
    }
    return undefined;
  };
  const out: AnyRecord[] = [];
  for (const r of incoming) {
    if (r.type === 'settings') continue;
    if (r.type === 'account' || r.type === 'category' || r.type === 'contact') {
      const match = findMatch(r);
      if (match) remap.set(r.id, match);
      else out.push(r);
    }
  }
  const m = (id: string | undefined) => (id ? remap.get(id) ?? id : id);
  const mapKey = (k: string) => {
    const i = k.indexOf(':');
    return i < 0 ? k : `${k.slice(0, i + 1)}${m(k.slice(i + 1))}`;
  };
  for (const r of incoming) {
    if (r.type === 'entry') {
      if (r.opening) continue;
      out.push({
        ...r,
        lines: r.lines.map(([k, v]) => [mapKey(k), v]),
        catId: m(r.catId),
        accountId: m(r.accountId),
        toAccountId: m(r.toAccountId),
        contactId: m(r.contactId),
      } as Entry);
    } else if (r.type === 'debt' || r.type === 'order') {
      out.push({ ...r, contactId: m(r.contactId)! });
    } else if (r.type === 'shift') {
      out.push(r);
    }
  }
  const voidedOpenings = new Set(incoming.filter((r): r is Entry => r.type === 'entry' && !!r.opening).map((r) => r.id));
  const filtered = out.filter((r) => !(r.type === 'entry' && r.reverses && voidedOpenings.has(r.reverses)));
  await currentDb().save(filtered.map((r) => (r.type === 'category' ? ({ ...r } as Category) : r)));
  updateWs(targetWs.id, { migration: { total: filtered.length, mode: 'merge', fromWs: guest.id } });
  await openWorkspace(targetWs.id);
  void syncNow();
}

export async function discardGuest() {
  const guest = guestWorkspace();
  if (!guest) return;
  await WorkspaceDb.destroy(guest.id);
  updateMeta((m) => {
    m.workspaces = m.workspaces.filter((w) => w.id !== guest.id);
    if (m.active === guest.id) m.active = undefined;
  });
}

export async function logout() {
  try {
    if (meta.value.userToken) await api('/me/logout', { method: 'POST', token: meta.value.userToken });
  } catch {
    /* offline logout still clears this device */
  }
  for (const ws of meta.value.workspaces.filter((w) => w.role !== 'guest')) await WorkspaceDb.destroy(ws.id);
  updateMeta((m) => {
    m.workspaces = m.workspaces.filter((w) => w.role === 'guest');
    m.userToken = undefined;
    m.user = undefined;
    m.active = m.workspaces[0]?.id;
  });
  await openWorkspace(meta.value.active);
}

export async function deleteBusiness(ws: Workspace) {
  if (ws.tenantId && ws.role === 'owner') await api(`/tenants/${ws.tenantId}`, { method: 'DELETE', token: meta.value.userToken });
  await WorkspaceDb.destroy(ws.id);
  updateMeta((m) => {
    m.workspaces = m.workspaces.filter((w) => w.id !== ws.id);
    m.active = m.workspaces[0]?.id;
  });
  await openWorkspace(meta.value.active);
}

export async function deleteAccount() {
  await api('/me', { method: 'DELETE', token: meta.value.userToken });
  for (const ws of meta.value.workspaces.filter((w) => w.role !== 'guest')) await WorkspaceDb.destroy(ws.id);
  updateMeta((m) => {
    m.workspaces = m.workspaces.filter((w) => w.role === 'guest');
    m.userToken = undefined;
    m.user = undefined;
    m.active = m.workspaces[0]?.id;
  });
  await openWorkspace(meta.value.active);
}
