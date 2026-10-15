import type { Account, Category, Debt, Entry, Shift, Tz } from './types';
import { debtPrincipal, debtRemaining, type Ledger } from './ledger';
import { addDays, dayKey, dayStart, monthStart, nextMonth } from './util';

export interface Range {
  from: number;
  to: number;
}

export function dayRange(key: string, tz: Tz): Range {
  return { from: dayStart(key, tz), to: dayStart(addDays(key, 1), tz) };
}

/** Drops voided entries together with their reversals; both share the same `at`, so totals stay identical. */
export function live(entries: Entry[]): Entry[] {
  const reversed = new Set<string>();
  for (const e of entries) if (e.reverses) reversed.add(e.reverses);
  return entries.filter((e) => !e.reverses && !reversed.has(e.id));
}

export function inRange(e: Entry, r: Range) {
  return e.at >= r.from && e.at < r.to;
}

export interface ProfitRow {
  cat: Category;
  amount: number;
}

export interface Profit {
  income: ProfitRow[];
  expense: ProfitRow[];
  totalIncome: number;
  totalExpense: number;
  profit: number;
}

export function profit(entries: Entry[], cats: Map<string, Category>, r: Range): Profit {
  const sums = new Map<string, number>();
  for (const e of entries) {
    if (!inRange(e, r)) continue;
    for (const [k, v] of e.lines) if (k.startsWith('p:')) sums.set(k.slice(2), (sums.get(k.slice(2)) ?? 0) + v);
  }
  const income: ProfitRow[] = [];
  const expense: ProfitRow[] = [];
  for (const [id, v] of sums) {
    const cat = cats.get(id);
    if (!cat || v === 0) continue;
    if (cat.kind === 'income') income.push({ cat, amount: -v });
    else expense.push({ cat, amount: v });
  }
  income.sort((a, b) => b.amount - a.amount);
  expense.sort((a, b) => b.amount - a.amount);
  const totalIncome = income.reduce((s, x) => s + x.amount, 0);
  const totalExpense = expense.reduce((s, x) => s + x.amount, 0);
  return { income, expense, totalIncome, totalExpense, profit: totalIncome - totalExpense };
}

export interface CashflowRow {
  account: Account;
  opening: number;
  in: number;
  out: number;
  closing: number;
}

export function cashflow(entries: Entry[], accounts: Account[], r: Range): CashflowRow[] {
  const rows = new Map(accounts.map((a) => [a.id, { account: a, opening: 0, in: 0, out: 0, closing: 0 }]));
  for (const e of live(entries)) {
    if (e.at >= r.to) continue;
    for (const [k, v] of e.lines) {
      if (!k.startsWith('a:')) continue;
      const row = rows.get(k.slice(2));
      if (!row) continue;
      if (e.at < r.from) row.opening += v;
      else if (v > 0) row.in += v;
      else row.out += -v;
    }
  }
  for (const row of rows.values()) row.closing = row.opening + row.in - row.out;
  return [...rows.values()];
}

export type AgeBucket = 'none' | 'notdue' | 'd1_30' | 'd30plus';

export interface DebtRow {
  debt: Debt;
  remaining: number;
  principal: number;
  bucket: AgeBucket;
  overdueDays: number;
}

export function debtRows(debts: Debt[], l: Ledger, entries: Entry[], todayKey: string): DebtRow[] {
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  return debts
    .map((debt) => {
      const remaining = debtRemaining(l, debt);
      let bucket: AgeBucket = 'none';
      let overdueDays = 0;
      if (debt.dueDate) {
        overdueDays = Math.floor((today - Date.parse(`${debt.dueDate}T00:00:00Z`)) / 86_400_000);
        bucket = overdueDays <= 0 ? 'notdue' : overdueDays <= 30 ? 'd1_30' : 'd30plus';
      }
      return { debt, remaining, principal: debtPrincipal(entries, debt), bucket, overdueDays };
    })
    .filter((r) => r.remaining > 0);
}

export const BUCKET_LABEL: Record<AgeBucket, string> = {
  none: 'Tanpa jatuh tempo',
  notdue: 'Belum jatuh tempo',
  d1_30: 'Lewat 1–30 hari',
  d30plus: 'Lewat > 30 hari',
};

/** Oldest still-unsettled QRIS money: walks the account history and restarts whenever it drained to zero. */
export function pendingSince(entries: Entry[], accountId: string): number | null {
  const key = `a:${accountId}`;
  const moves = entries
    .flatMap((e) => e.lines.filter(([k]) => k === key).map(([, v]) => ({ at: e.at, v })))
    .sort((a, b) => a.at - b.at);
  let bal = 0;
  let since: number | null = null;
  for (const m of moves) {
    bal += m.v;
    if (bal <= 0) since = null;
    else if (since === null) since = m.at;
  }
  return since;
}

export interface ShiftRow {
  shift: Shift;
  sales: number;
  cashIn: number;
  cashOut: number;
}

export function shiftRows(shifts: Shift[], entries: Entry[], cashIds: Set<string>, salesCatIds: Set<string>): ShiftRow[] {
  const rows = new Map(shifts.map((s) => [s.id, { shift: s, sales: 0, cashIn: 0, cashOut: 0 }]));
  for (const e of live(entries)) {
    const row = e.shiftId ? rows.get(e.shiftId) : undefined;
    if (!row || e.kind === 'shift_diff') continue;
    for (const [k, v] of e.lines) {
      if (k.startsWith('p:') && salesCatIds.has(k.slice(2))) row.sales -= v;
      if (k.startsWith('a:') && cashIds.has(k.slice(2))) {
        if (v > 0) row.cashIn += v;
        else row.cashOut -= v;
      }
    }
  }
  return [...rows.values()].sort((a, b) => b.shift.openedAt - a.shift.openedAt);
}

export interface MonthRow {
  month: string;
  income: number;
  expense: number;
  profit: number;
  cashIn: number;
  cashOut: number;
}

export function monthly(entries: Entry[], cats: Map<string, Category>, tz: Tz, endKey: string, months: number): MonthRow[] {
  const rows: MonthRow[] = [];
  entries = live(entries);
  let start = monthStart(endKey);
  for (let i = 1; i < months; i++) {
    const [y, m] = start.split('-').map(Number);
    start = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
  }
  for (let i = 0; i < months; i++) {
    const r = { from: dayStart(start, tz), to: dayStart(nextMonth(start), tz) };
    const p = profit(entries, cats, r);
    let cashIn = 0;
    let cashOut = 0;
    for (const e of entries) {
      if (!inRange(e, r) || e.kind === 'transfer') continue;
      for (const [k, v] of e.lines) if (k.startsWith('a:')) v > 0 ? (cashIn += v) : (cashOut -= v);
    }
    rows.push({ month: start, income: p.totalIncome, expense: p.totalExpense, profit: p.profit, cashIn, cashOut });
    start = nextMonth(start);
  }
  return rows;
}

export function todayKey(tz: Tz) {
  return dayKey(Date.now(), tz);
}
