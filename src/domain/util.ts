import type { Tz } from './types';

const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ULID_CHARS[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let r = '';
  for (const b of rand) r += ULID_CHARS[b % 32];
  return time + r;
}

const rupiahFmt = new Intl.NumberFormat('id-ID');

export function rp(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}Rp${rupiahFmt.format(Math.abs(Math.round(n)))}`;
}

export function num(n: number): string {
  return rupiahFmt.format(Math.round(n));
}

export function parseAmount(s: string): number {
  const digits = s.replace(/\D/g, '');
  return digits ? Math.min(Number(digits), 999_999_999_999) : 0;
}

export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let d = raw.replace(/\D/g, '');
  if (!d) return undefined;
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return d;
}

export function displayPhone(p: string | undefined): string {
  if (!p) return '';
  return p.startsWith('62') ? '0' + p.slice(2) : p;
}

export const TZ_OFFSET: Record<Tz, number> = { WIB: 7, WITA: 8, WIT: 9 };

function shift(ts: number, tz: Tz) {
  return new Date(ts + TZ_OFFSET[tz] * 3600_000);
}

export function dayKey(ts: number, tz: Tz): string {
  return shift(ts, tz).toISOString().slice(0, 10);
}

export function dayStart(key: string, tz: Tz): number {
  return Date.parse(`${key}T00:00:00Z`) - TZ_OFFSET[tz] * 3600_000;
}

export function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function weekStart(key: string): string {
  const dow = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(key, -dow);
}

export function monthStart(key: string): string {
  return key.slice(0, 8) + '01';
}

export function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function fmtDate(key: string, long = false): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

export function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function fmtTime(ts: number, tz: Tz): string {
  return shift(ts, tz).toISOString().slice(11, 16);
}

export function fmtDateTime(ts: number, tz: Tz): string {
  return `${fmtDate(dayKey(ts, tz))} ${fmtTime(ts, tz)}`;
}

export function toLocalInput(ts: number, tz: Tz): string {
  return shift(ts, tz).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string, tz: Tz): number {
  return Date.parse(`${v}:00Z`) - TZ_OFFSET[tz] * 3600_000;
}
