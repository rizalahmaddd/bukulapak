import { activeWs } from '../store/meta';
import { hoursSinceSync, syncState } from '../store/sync';

export function SyncBadge() {
  const ws = activeWs();
  const s = syncState.value;
  if (!ws?.tenantId) return <span class="badge amber dot">Data hanya di HP ini</span>;
  const h = hoursSinceSync();
  if (s.status === 'revoked') return <span class="badge red dot">Akses dicabut</span>;
  if (s.status === 'syncing') return <span class="badge blue dot">Menyinkron…</span>;
  if (s.pending === 0 && s.status === 'idle') return <span class="badge green dot">Tersinkron</span>;
  if (s.status === 'quota') return <span class="badge amber dot">Lanjut sinkron besok</span>;
  if (h !== null && h >= 24) return <span class="badge red dot">Belum sinkron {h} jam</span>;
  return <span class="badge amber dot">{s.pending > 0 ? `${s.pending} belum terkirim` : 'Tersimpan di HP'}</span>;
}
