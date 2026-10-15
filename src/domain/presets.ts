import type { Account, BusinessType, Category, CategoryKind, Dir, Settings, SysCategory, Tz } from './types';
import { ulid } from './util';

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'kelontong', label: 'Toko Kelontong / Warung' },
  { value: 'fnb', label: 'Kuliner / Makanan & Minuman' },
  { value: 'fashion', label: 'Fashion / Jahit / Konveksi' },
  { value: 'jasa', label: 'Jasa (servis, salon, laundry, dll.)' },
  { value: 'grosir', label: 'Grosir / Supplier' },
  { value: 'lainnya', label: 'Lainnya' },
];

export const DEFAULT_WA_TEMPLATE =
  'Halo {nama}, semoga sehat selalu. Kami dari {usaha} ingin mengingatkan catatan belanja yang belum lunas sebesar {sisa}{jatuh_tempo}. Kalau sudah bayar, mohon abaikan pesan ini. Terima kasih banyak.';

export const DEFAULT_WA_ORDER_TEMPLATE =
  'Halo {nama}, pesanan Anda di {usaha} sudah kami catat: {pesanan}. Total {total}, DP diterima {dp}, sisa {sisa}{ambil}. Terima kasih.';

type Spec = [name: string, kind: CategoryKind, dir: Dir, sys?: SysCategory, hidden?: boolean];

const COMMON: Spec[] = [
  ['Pendapatan Lain', 'income', 'in', 'other_income'],
  ['Retur Jualan', 'income', 'out', 'sales_return'],
  ['Operasional', 'expense', 'out'],
  ['Gaji Karyawan', 'expense', 'out'],
  ['Sewa Tempat', 'expense', 'out'],
  ['Listrik, Air & Internet', 'expense', 'out'],
  ['Transport & Bensin', 'expense', 'out'],
  ['Biaya Admin QRIS', 'expense', 'out', 'qris_fee'],
  ['Biaya Admin Bank', 'expense', 'out', 'bank_fee'],
  ['Selisih Kas', 'expense', 'out', 'cash_diff', true],
  ['Piutang Tak Tertagih', 'expense', 'out', 'bad_debt', true],
  ['Bunga Pinjaman', 'expense', 'out', 'interest', true],
  ['Tambah Modal dari Uang Pribadi', 'personal', 'in', 'modal_in'],
  ['Ambil untuk Pribadi', 'personal', 'out', 'prive'],
  ['Terima Pinjaman (KUR/Koperasi)', 'loan', 'in', 'loan_in'],
  ['Bayar Cicilan Pinjaman', 'loan', 'out', 'loan_pay'],
  ['Beli Peralatan / Aset', 'asset', 'out', 'asset'],
  ['DP Pesanan', 'deposit', 'in', 'dp'],
];

const BY_TYPE: Record<BusinessType, Spec[]> = {
  kelontong: [
    ['Jualan', 'income', 'in', 'sales'],
    ['Beli Stok Barang', 'expense', 'out'],
    ['Kantong & Kemasan', 'expense', 'out'],
  ],
  fnb: [
    ['Jualan', 'income', 'in', 'sales'],
    ['Beli Bahan Baku', 'expense', 'out'],
    ['Gas & Air Galon', 'expense', 'out'],
    ['Kemasan', 'expense', 'out'],
  ],
  fashion: [
    ['Jualan', 'income', 'in', 'sales'],
    ['Beli Kain / Stok', 'expense', 'out'],
    ['Ongkos Jahit', 'expense', 'out'],
    ['Ongkos Kirim', 'expense', 'out'],
  ],
  jasa: [
    ['Pendapatan Jasa', 'income', 'in', 'sales'],
    ['Beli Bahan / Sparepart', 'expense', 'out'],
  ],
  grosir: [
    ['Jualan', 'income', 'in', 'sales'],
    ['Beli Stok Barang', 'expense', 'out'],
    ['Ongkos Kirim', 'expense', 'out'],
  ],
  lainnya: [
    ['Jualan', 'income', 'in', 'sales'],
    ['Beli Bahan / Stok', 'expense', 'out'],
  ],
};

export function presetCategories(type: BusinessType, now = Date.now()): Category[] {
  return [...BY_TYPE[type], ...COMMON].map(([name, kind, dir, sys, hidden]) => ({
    id: ulid(now),
    type: 'category',
    name,
    kind,
    dir,
    ...(sys ? { sys } : {}),
    ...(hidden ? { hidden } : {}),
    updatedAt: now,
  }));
}

export function presetAccounts(now = Date.now()): Account[] {
  return [
    { id: ulid(now), type: 'account', name: 'Laci Kasir (Tunai)', kind: 'cash', sort: 0, updatedAt: now },
    { id: ulid(now), type: 'account', name: 'Rekening Bank', kind: 'bank', sort: 1, updatedAt: now },
    { id: ulid(now), type: 'account', name: 'Saldo QRIS / E-Wallet', kind: 'qris', sort: 2, updatedAt: now },
  ];
}

export function presetSettings(name: string, businessType: BusinessType, tz: Tz = 'WIB', now = Date.now()): Settings {
  return {
    id: 'settings',
    type: 'settings',
    name,
    businessType,
    tz,
    mdr: 0,
    ordersEnabled: businessType === 'fnb' || businessType === 'fashion' || businessType === 'jasa',
    shiftEnabled: false,
    waTemplate: DEFAULT_WA_TEMPLATE,
    waOrderTemplate: DEFAULT_WA_ORDER_TEMPLATE,
    createdAt: now,
    updatedAt: now,
  };
}

export function guessTz(): Tz {
  const offset = -new Date().getTimezoneOffset() / 60;
  return offset === 8 ? 'WITA' : offset === 9 ? 'WIT' : 'WIB';
}

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', 'iloveyou', '11111111', '00000000',
  '87654321', 'abcd1234', 'admin123', 'bismillah', 'indonesia', 'sayang123', 'qwertyuiop', '1q2w3e4r', 'asdf1234',
  'passw0rd', 'rahasia123', 'katasandi', 'jakarta123', 'bukulapak',
]);

export function passwordProblem(pw: string, context: string[] = []): string | null {
  if (pw.length < 8) return 'Password minimal 8 karakter.';
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(pw) || /^\d+$/.test(pw) && new Set(pw).size <= 2) {
    return 'Password ini terlalu umum, gampang ditebak orang.';
  }
  for (const c of context) {
    const word = c.toLowerCase().replace(/\s+/g, '');
    if (word.length >= 4 && lower.replace(/\s+/g, '').includes(word)) return 'Jangan pakai nama usaha atau email sebagai password.';
  }
  return null;
}
