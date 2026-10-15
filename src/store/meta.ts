import { signal } from '@preact/signals';
import { ulid } from '../domain/util';

export type WsRole = 'guest' | 'owner' | 'cashier';

export interface Workspace {
  id: string;
  name: string;
  role: WsRole;
  tenantId?: string;
  token?: string;
  cursor: number;
  createdAt: number;
  migration?: { total: number; mode: 'new' | 'merge'; fromWs?: string };
  revoked?: boolean;
  quotaUntil?: number;
  lastSyncAt?: number;
}

export interface Meta {
  deviceId: string;
  deviceLabel: string;
  workspaces: Workspace[];
  active?: string;
  userToken?: string;
  user?: { id: string; name: string; email: string | null; hasPassword: boolean; googleEmail: string | null };
  nudgeAt?: number;
  installDismissedAt?: number;
  exportReminderAt?: number;
}

const KEY = 'bukulapak:meta';

function guessLabel(): string {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (m) return m[1].replace(/ Build.*/, '').trim().slice(0, 40);
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return 'Browser';
}

function load(): Meta {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Meta;
  } catch {
    /* corrupted meta falls back to a fresh device */
  }
  return { deviceId: ulid(), deviceLabel: guessLabel(), workspaces: [] };
}

export const meta = signal<Meta>(load());

// Another tab wrote meta; adopt it so this tab doesn't later overwrite it with a stale copy.
// Switching the active business swaps the open database, so a reload is the safe way to follow it.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  const next = JSON.parse(e.newValue) as Meta;
  const switched = next.active !== meta.value.active;
  meta.value = next;
  if (switched) location.reload();
});

export function updateMeta(fn: (m: Meta) => Meta | void) {
  const draft = structuredClone(meta.value);
  const next = fn(draft) ?? draft;
  localStorage.setItem(KEY, JSON.stringify(next));
  meta.value = next;
}

export function updateWs(id: string, patch: Partial<Workspace>) {
  updateMeta((m) => {
    const ws = m.workspaces.find((w) => w.id === id);
    if (ws) Object.assign(ws, patch);
  });
}

export function activeWs(): Workspace | undefined {
  const m = meta.value;
  return m.workspaces.find((w) => w.id === m.active);
}
