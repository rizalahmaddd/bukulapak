import { signal } from '@preact/signals';
import type { AnyRecord } from '../domain/types';
import { api, ApiError } from './api';
import { WorkspaceDb } from './idb';
import { applyRemoteToState, currentDb, currentDbWs, onLocalChange } from './data';
import { activeWs, meta, updateMeta, updateWs, type Workspace } from './meta';

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'quota' | 'revoked' | 'error';

export const syncState = signal<{ status: SyncStatus; pending: number; uploaded?: number }>({ status: 'local', pending: 0 });

const PUSH_BATCH = 200;
// Short enough that other devices see a new entry almost immediately, long enough to batch rapid input.
const DEBOUNCE_MS = 2_000;
const RETRY_MS = 60_000;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function nextUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) + 60_000;
}

async function refreshPending() {
  const pending = currentDbWs() ? await currentDb().outboxCount() : 0;
  syncState.value = { ...syncState.value, pending };
  return pending;
}

function takeToken(ws: Workspace, res: Response) {
  const t = res.headers.get('X-New-Token');
  if (t) updateWs(ws.id, { token: t });
}

async function push(ws: Workspace): Promise<boolean> {
  const db = currentDb();
  let uploaded = 0;
  for (;;) {
    const { items, records } = await db.outbox(PUSH_BATCH);
    if (!items.length) return true;
    const live = activeWs();
    if (!live?.token) return false;
    const { res } = await api<{ accepted: string[] }>('/sync/push', {
      token: live.token,
      body: { ops: records.map((r) => ({ id: r.id, type: r.type, data: r })), migration: !!live.migration },
    });
    takeToken(ws, res);
    await db.ack(items);
    uploaded += items.length;
    syncState.value = { ...syncState.value, uploaded, pending: Math.max(0, syncState.value.pending - items.length) };
  }
}

async function pull(ws: Workspace) {
  const db = currentDb();
  let cursor = ws.cursor;
  for (;;) {
    const token = activeWs()?.token;
    if (!token) return;
    const { data, res } = await api<{ records: { id: string; type: string; data: AnyRecord }[]; next: number; more: boolean; role: 'owner' | 'cashier' }>(
      `/sync/pull?since=${cursor}`,
      { token },
    );
    takeToken(ws, res);
    const valid = data.records.filter((r) => r.data && r.data.id === r.id && r.data.type === r.type);
    const applied = await db.applyRemote(valid.map((r) => r.data));
    applyRemoteToState(applied);
    cursor = data.next;
    updateWs(ws.id, { cursor, role: data.role, lastSyncAt: Date.now() });
    if (!data.more) return;
  }
}

async function finishMigration(ws: Workspace) {
  const from = ws.migration?.fromWs;
  updateWs(ws.id, { migration: undefined });
  if (from && from !== ws.id) {
    await WorkspaceDb.destroy(from);
    updateMeta((m) => {
      m.workspaces = m.workspaces.filter((w) => w.id !== from);
    });
  }
}

async function renewTenantToken(ws: Workspace): Promise<boolean> {
  const userToken = meta.value.userToken;
  if (ws.role === 'cashier' || !userToken || !ws.tenantId) return false;
  try {
    const { data } = await api<{ token: string }>(`/tenants/${ws.tenantId}/session`, { method: 'POST', token: userToken });
    updateWs(ws.id, { token: data.token });
    again = true;
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const ws = activeWs();
  if (!ws || currentDbWs() !== ws.id) return;
  if (!ws.tenantId || !ws.token) {
    syncState.value = { status: 'local', pending: 0 };
    return;
  }
  if (ws.revoked) {
    syncState.value = { status: 'revoked', pending: await refreshPending() };
    return;
  }
  if (!navigator.onLine) {
    syncState.value = { status: 'offline', pending: await refreshPending() };
    return;
  }
  if (ws.quotaUntil && ws.quotaUntil > Date.now()) {
    syncState.value = { status: 'quota', pending: await refreshPending() };
    return;
  }
  syncState.value = { status: 'syncing', pending: await refreshPending() };
  try {
    const pushed = await push(ws);
    if (pushed && ws.migration) await finishMigration(ws);
    await pull(activeWs() ?? ws);
    syncState.value = { status: 'idle', pending: await refreshPending() };
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      updateWs(ws.id, { quotaUntil: nextUtcMidnight() });
      syncState.value = { status: 'quota', pending: await refreshPending() };
    } else if (err instanceof ApiError && err.status === 401 && !(await renewTenantToken(ws))) {
      updateWs(ws.id, { revoked: true });
      syncState.value = { status: 'revoked', pending: await refreshPending() };
    } else {
      syncState.value = { status: navigator.onLine ? 'error' : 'offline', pending: await refreshPending() };
      if (navigator.onLine) scheduleSync(RETRY_MS);
    }
  }
}

export function syncNow(): Promise<void> {
  clearTimeout(timer);
  if (running) {
    again = true;
    return running;
  }
  running = run().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

export function scheduleSync(delay = DEBOUNCE_MS) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

let started = false;
export function startSyncEngine() {
  if (started) return;
  started = true;
  onLocalChange(() => {
    void refreshPending();
    scheduleSync();
  });
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const last = activeWs()?.lastSyncAt ?? 0;
      if (Date.now() - last > 60_000) void syncNow();
    } else if (syncState.value.pending > 0) {
      void syncNow();
    }
  });
}

export function hoursSinceSync(): number | null {
  const ws = activeWs();
  if (!ws?.lastSyncAt) return null;
  return Math.floor((Date.now() - ws.lastSyncAt) / 3600_000);
}

