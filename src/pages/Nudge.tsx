import { entries } from '../store/data';
import { activeWs, meta, updateMeta } from '../store/meta';
import { isIos, isStandalone } from '../ui/install';
import { CloudOff } from 'lucide-preact';

const DAY = 86_400_000;

export function shouldNudge(reason?: 'export' | 'cashier' | 'device'): boolean {
  const ws = activeWs();
  if (!ws || ws.role !== 'guest') return false;
  if (reason) return true;
  const last = meta.value.nudgeAt ?? 0;
  if (Date.now() - last < DAY) return false;
  return entries.value.length >= 20 || Date.now() - ws.createdAt >= 7 * DAY || (isIos() && !isStandalone());
}

export function dismissNudge() {
  updateMeta((m) => {
    m.nudgeAt = Date.now();
  });
}

export function SignupNudge() {
  if (!shouldNudge()) return null;
  const ios = isIos() && !isStandalone();
  return (
    <div class={`banner ${ios ? 'red' : 'amber'}`}>
      <span class="banner-icon">
        <CloudOff size={16} aria-hidden="true" />
      </span>
      <div class="grow">
        <div>
          {ios
            ? 'Di iPhone, data bisa terhapus otomatis kalau aplikasi jarang dibuka. Daftar gratis supaya catatanmu tersimpan aman di cloud.'
            : `Sudah ${entries.value.length} transaksi tercatat, tapi semuanya hanya ada di HP ini. Daftar gratis supaya aman walau HP hilang atau rusak.`}
        </div>
        <div class="banner-actions">
          <a class="btn small primary" href="#/register">
            Daftar gratis
          </a>
          <button class="btn small ghost" onClick={dismissNudge}>
            Nanti saja
          </button>
        </div>
      </div>
    </div>
  );
}
