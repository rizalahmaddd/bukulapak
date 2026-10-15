import { effect } from '@preact/signals';
import { activeWs, meta } from './meta';
import { syncNow } from './sync';

// Keeps a socket open to the tenant's Durable Object while the app is on screen. The server only sends
// "sync" hints; records still travel through the normal push/pull, so a dropped socket just means slower updates.
const PING_MS = 30_000;
const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;
const STALE_MS = 10_000;

let sock: WebSocket | null = null;
let key = '';
let retry = MIN_RETRY_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;

/** Identifies the connection the app should have right now, or '' for none. */
function wanted(): string {
  const ws = activeWs();
  if (!ws?.tenantId || !ws.token || ws.revoked) return '';
  // Hidden tabs get frozen by mobile browsers anyway; the visibility handler in sync.ts catches up on return.
  if (!navigator.onLine || document.visibilityState !== 'visible') return '';
  return `${ws.id}|${ws.tenantId}`;
}

function disconnect() {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  retryTimer = undefined;
  const s = sock;
  sock = null;
  if (s) {
    s.onclose = null;
    s.close(1000);
  }
}

function getWsUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL;
  if (apiBase) {
    try {
      const u = new URL(apiBase);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${u.host}/api/sync/live`;
    } catch {
      /* fallback */
    }
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sync/live`;
}

function connect() {
  const token = activeWs()?.token;
  if (!token) return;
  const url = getWsUrl();
  const s = new WebSocket(url, ['bukulapak', token]);
  sock = s;
  s.onopen = () => {
    retry = MIN_RETRY_MS;
    pingTimer = setInterval(() => s.readyState === WebSocket.OPEN && s.send('ping'), PING_MS);
    // Hints sent while this device was disconnected are lost, so catch up unless a sync just ran.
    if (Date.now() - (activeWs()?.lastSyncAt ?? 0) > STALE_MS) void syncNow();
  };
  s.onmessage = (e) => {
    if (e.data === 'sync') void syncNow();
  };
  s.onclose = () => {
    clearInterval(pingTimer);
    if (sock !== s) return;
    sock = null;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (key && wanted() === key && !sock) connect();
    }, retry);
    retry = Math.min(retry * 2, MAX_RETRY_MS);
  };
}

function reconcile() {
  const next = wanted();
  if (next === key) return;
  disconnect();
  key = next;
  retry = MIN_RETRY_MS;
  if (key) connect();
}

let started = false;
export function startLiveSync() {
  if (started) return;
  started = true;
  effect(() => {
    void meta.value;
    reconcile();
  });
  window.addEventListener('online', reconcile);
  window.addEventListener('offline', reconcile);
  document.addEventListener('visibilitychange', reconcile);
}
