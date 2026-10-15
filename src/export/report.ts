import type { Account, Category, Contact, Debt, Entry, Settings } from '../domain/types';
import type { Ledger } from '../domain/ledger';
import { BUCKET_LABEL, cashflow, debtRows, monthly, profit, type Range } from '../domain/reports';
import { dayKey, fmtMonth, fmtTime } from '../domain/util';
import { buildXlsx, download, toCsv, type Cell, type SheetData } from './xlsx';
import type { Desc } from '../ui/describe';

export interface ExportInput {
  settings: Settings;
  entries: Entry[];
  accounts: Account[];
  cats: Map<string, Category>;
  contacts: Map<string, Contact>;
  debts: Debt[];
  ledger: Ledger;
  range: Range;
  rangeLabel: string;
  todayKey: string;
  describe: (e: Entry) => Desc;
}

function transactionRows(x: ExportInput, onlyRange: boolean): Cell[][] {
  const tz = x.settings.tz;
  const rows: Cell[][] = [['Tanggal', 'Jam', 'Keterangan', 'Masuk', 'Keluar', 'Akun', 'Kontak', 'Catatan', 'Status', 'Dicatat oleh']];
  const list = [...x.entries].sort((a, b) => a.at - b.at).filter((e) => !onlyRange || (e.at >= x.range.from && e.at < x.range.to));
  for (const e of list) {
    const d = x.describe(e);
    const status = e.kind === 'void' ? `Pembatalan (${e.voidReason})` : x.ledger.voided.has(e.id) ? 'Dibatalkan' : '';
    rows.push([
      dayKey(e.at, tz),
      fmtTime(e.at, tz),
      d.title,
      d.sign > 0 ? e.amount : null,
      d.sign < 0 ? e.amount : null,
      e.accountId ? x.accounts.find((a) => a.id === e.accountId)?.name : '',
      e.contactId ? x.contacts.get(e.contactId)?.name : '',
      e.note ?? '',
      status,
      e.by,
    ]);
  }
  return rows;
}

export function exportExcel(x: ExportInput) {
  const s = x.settings;
  const p = profit(x.entries, x.cats, x.range);
  const summary: Cell[][] = [
    ['Laporan Keuangan Usaha'],
    ['Nama usaha', s.name],
    ['Periode', x.rangeLabel],
    ['Dibuat', new Date().toLocaleString('id-ID')],
    [],
    ['UNTUNG / RUGI', 'Nominal'],
    ['Pendapatan'],
    ...p.income.map((r) => [`  ${r.cat.name}`, r.amount]),
    ['Total pendapatan', p.totalIncome],
    ['Biaya'],
    ...p.expense.map((r) => [`  ${r.cat.name}`, r.amount]),
    ['Total biaya', p.totalExpense],
    ['UNTUNG BERSIH', p.profit],
  ];
  const flow: Cell[][] = [['Akun', 'Saldo awal', 'Masuk', 'Keluar', 'Saldo akhir']];
  for (const r of cashflow(x.entries, x.accounts, x.range)) flow.push([r.account.name, r.opening, r.in, r.out, r.closing]);
  const debts: Cell[][] = [['Nama', 'Jenis', 'Sisa', 'Jatuh tempo', 'Status']];
  for (const r of debtRows(x.debts, x.ledger, x.entries, x.todayKey)) {
    debts.push([
      x.contacts.get(r.debt.contactId)?.name ?? '',
      r.debt.dir === 'recv' ? 'Piutang pelanggan' : r.debt.dir === 'pay' ? 'Utang usaha' : 'Pinjaman',
      r.remaining,
      r.debt.dueDate ?? '',
      BUCKET_LABEL[r.bucket],
    ]);
  }
  const months: Cell[][] = [['Bulan', 'Pendapatan', 'Biaya', 'Untung', 'Uang masuk', 'Uang keluar']];
  for (const m of monthly(x.entries, x.cats, s.tz, x.todayKey, 12)) months.push([fmtMonth(m.month), m.income, m.expense, m.profit, m.cashIn, m.cashOut]);

  const sheets: SheetData[] = [
    { name: 'Ringkasan', rows: summary, widths: [34, 18] },
    { name: 'Transaksi', rows: transactionRows(x, true), widths: [12, 7, 30, 14, 14, 22, 20, 30, 18, 16] },
    { name: 'Arus Uang', rows: flow, widths: [26, 16, 16, 16, 16] },
    { name: 'Utang Piutang', rows: debts, widths: [24, 18, 16, 14, 20] },
    { name: '12 Bulan', rows: months, widths: [18, 16, 16, 16, 16, 16] },
  ];
  download(buildXlsx(sheets), `${slug(s.name)}-${x.rangeLabel.replace(/\s+/g, '_')}.xlsx`);
}

export function exportAllCsv(x: ExportInput) {
  download(toCsv(transactionRows(x, false)), `${slug(x.settings.name)}-semua-transaksi.csv`);
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bukulapak';
}
