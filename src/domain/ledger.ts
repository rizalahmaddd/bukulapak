import type { Account, Category, Debt, Entry, EntryKind, Line, Order, SysCategory } from './types';
import { ulid } from './util';

export interface Ctx {
  now: number;
  by: string;
  device: string;
  shiftId?: string;
  mdr: number;
  sys: (key: SysCategory) => Category;
  account: (id: string) => Account | undefined;
}

export function mdrFee(amount: number, percent: number): number {
  return Math.max(0, Math.round((amount * percent) / 100));
}

function clean(lines: Line[]): Line[] {
  const merged = new Map<string, number>();
  for (const [k, v] of lines) merged.set(k, (merged.get(k) ?? 0) + v);
  return [...merged].filter(([, v]) => v !== 0);
}

function make(ctx: Ctx, kind: EntryKind, amount: number, at: number, lines: Line[], extra: Partial<Entry> = {}): Entry {
  const out = clean(lines);
  const sum = out.reduce((s, [, v]) => s + v, 0);
  if (sum !== 0) throw new Error(`unbalanced entry (${sum})`);
  return {
    id: ulid(ctx.now),
    type: 'entry',
    kind,
    at,
    createdAt: ctx.now,
    by: ctx.by,
    device: ctx.device,
    amount,
    lines: out,
    ...(ctx.shiftId ? { shiftId: ctx.shiftId } : {}),
    ...(Math.abs(ctx.now - at) > 10 * 60_000 ? { backdated: true } : {}),
    ...extra,
  };
}

function receiveInto(ctx: Ctx, accountId: string, paid: number, fee: number | undefined): Line[] {
  if (paid <= 0) return [];
  const acc = ctx.account(accountId);
  const f = acc?.kind === 'qris' ? Math.min(paid, fee ?? mdrFee(paid, ctx.mdr)) : 0;
  const lines: Line[] = [[`a:${accountId}`, paid - f]];
  if (f > 0) lines.push([`p:${ctx.sys('qris_fee').id}`, f]);
  return lines;
}

export interface MoneyInInput {
  cat: Category;
  amount: number;
  at: number;
  accountId?: string;
  paid: number;
  fee?: number;
  debtId?: string;
  contactId?: string;
  orderId?: string;
  note?: string;
}

export function moneyIn(ctx: Ctx, i: MoneyInInput): Entry {
  const { cat, amount } = i;
  if (amount <= 0) throw new Error('amount');
  const paid = Math.min(i.paid, amount);
  if (paid > 0 && !i.accountId) throw new Error('account');
  const lines = receiveInto(ctx, i.accountId ?? '', paid, i.fee);
  const rest = amount - paid;
  switch (cat.kind) {
    case 'income':
      lines.push([`p:${cat.id}`, -amount]);
      if (rest > 0) {
        if (!i.debtId) throw new Error('debt');
        lines.push([`r:${i.debtId}`, rest]);
      }
      break;
    case 'personal':
      if (rest) throw new Error('paid');
      lines.push(['e', -amount]);
      break;
    case 'loan':
      if (rest || !i.debtId) throw new Error('loan');
      lines.push([`l:${i.debtId}`, -amount]);
      break;
    case 'deposit':
      if (rest || !i.orderId) throw new Error('order');
      lines.push([`d:${i.orderId}`, -amount]);
      break;
    default:
      throw new Error('category');
  }
  return make(ctx, cat.kind === 'deposit' ? 'dp' : 'in', amount, i.at, lines, {
    catId: cat.id,
    accountId: i.accountId,
    debtId: i.debtId,
    contactId: i.contactId,
    orderId: i.orderId,
    note: i.note || undefined,
  });
}

export interface MoneyOutInput {
  cat: Category;
  amount: number;
  at: number;
  /** account id, 'personal' (paid from the owner's own pocket), or undefined when nothing is paid yet */
  source?: string;
  paid: number;
  interest?: number;
  debtId?: string;
  contactId?: string;
  note?: string;
}

export function moneyOut(ctx: Ctx, i: MoneyOutInput): Entry {
  const { cat, amount } = i;
  if (amount <= 0) throw new Error('amount');
  const paid = Math.min(i.paid, amount);
  if (paid > 0 && !i.source) throw new Error('source');
  const lines: Line[] = [];
  if (paid > 0) lines.push(i.source === 'personal' ? ['e', -paid] : [`a:${i.source}`, -paid]);
  const rest = amount - paid;
  switch (cat.kind) {
    case 'expense':
    case 'income':
    case 'asset':
      lines.push([cat.kind === 'asset' ? `s:${cat.id}` : `p:${cat.id}`, amount]);
      if (rest > 0) {
        if (!i.debtId) throw new Error('debt');
        lines.push([`u:${i.debtId}`, -rest]);
      }
      break;
    case 'personal':
      if (rest || i.source === 'personal') throw new Error('source');
      lines.push(['e', amount]);
      break;
    case 'loan': {
      if (rest || !i.debtId || i.source === 'personal') throw new Error('loan');
      const interest = Math.min(Math.max(0, i.interest ?? 0), amount);
      lines.push([`l:${i.debtId}`, amount - interest]);
      if (interest) lines.push([`p:${ctx.sys('interest').id}`, interest]);
      return make(ctx, 'loan_pay', amount, i.at, lines, { catId: cat.id, accountId: i.source, debtId: i.debtId, contactId: i.contactId, note: i.note || undefined });
    }
    default:
      throw new Error('category');
  }
  return make(ctx, 'out', amount, i.at, lines, {
    catId: cat.id,
    accountId: i.source === 'personal' ? undefined : i.source,
    debtId: i.debtId,
    contactId: i.contactId,
    note: [i.source === 'personal' ? 'Dibayar pakai uang pribadi' : '', i.note ?? ''].filter(Boolean).join(' · ') || undefined,
  });
}

export function transfer(ctx: Ctx, i: { from: string; to: string; amount: number; fee: number; at: number; note?: string }): Entry {
  if (i.amount <= 0 || i.from === i.to) throw new Error('transfer');
  const lines: Line[] = [
    [`a:${i.from}`, -(i.amount + i.fee)],
    [`a:${i.to}`, i.amount],
  ];
  if (i.fee > 0) lines.push([`p:${ctx.sys('bank_fee').id}`, i.fee]);
  return make(ctx, 'transfer', i.amount, i.at, lines, { accountId: i.from, toAccountId: i.to, note: i.note || undefined });
}

export function debtPayment(ctx: Ctx, i: { debt: Debt; amount: number; accountId: string; at: number; fee?: number; interest?: number; note?: string }): Entry {
  const { debt, amount } = i;
  if (amount <= 0) throw new Error('amount');
  let lines: Line[];
  let kind: EntryKind = 'debt_pay';
  if (debt.dir === 'recv') {
    lines = [...receiveInto(ctx, i.accountId, amount, i.fee), [`r:${debt.id}`, -amount]];
  } else if (debt.dir === 'pay') {
    lines = [[`a:${i.accountId}`, -amount], [`u:${debt.id}`, amount]];
  } else {
    const interest = Math.min(Math.max(0, i.interest ?? 0), amount);
    lines = [[`a:${i.accountId}`, -amount], [`l:${debt.id}`, amount - interest]];
    if (interest) lines.push([`p:${ctx.sys('interest').id}`, interest]);
    kind = 'loan_pay';
  }
  return make(ctx, kind, amount, i.at, lines, { debtId: debt.id, contactId: debt.contactId, accountId: i.accountId, note: i.note || undefined });
}

/** One payment spread over several receivables/payables of the same person, oldest first. */
export function debtPaymentMulti(
  ctx: Ctx,
  i: { dir: 'recv' | 'pay'; allocations: { debt: Debt; amount: number }[]; accountId: string; at: number; fee?: number; note?: string },
): Entry {
  const allocs = i.allocations.filter((a) => a.amount > 0);
  const amount = allocs.reduce((s, a) => s + a.amount, 0);
  if (amount <= 0) throw new Error('amount');
  const lines: Line[] =
    i.dir === 'recv' ? receiveInto(ctx, i.accountId, amount, i.fee) : [[`a:${i.accountId}`, -amount]];
  for (const a of allocs) lines.push(i.dir === 'recv' ? [`r:${a.debt.id}`, -a.amount] : [`u:${a.debt.id}`, a.amount]);
  return make(ctx, 'debt_pay', amount, i.at, lines, {
    debtId: allocs[0].debt.id,
    contactId: allocs[0].debt.contactId,
    accountId: i.accountId,
    note: i.note || undefined,
  });
}

export function writeOff(ctx: Ctx, debt: Debt, remaining: number): Entry {
  if (remaining <= 0) throw new Error('amount');
  const lines: Line[] =
    debt.dir === 'recv'
      ? [[`p:${ctx.sys('bad_debt').id}`, remaining], [`r:${debt.id}`, -remaining]]
      : [[debt.dir === 'pay' ? `u:${debt.id}` : `l:${debt.id}`, remaining], [`p:${ctx.sys('other_income').id}`, -remaining]];
  return make(ctx, 'writeoff', remaining, ctx.now, lines, { debtId: debt.id, contactId: debt.contactId });
}

export function orderDone(
  ctx: Ctx,
  i: { order: Order; held: number; paid: number; accountId?: string; fee?: number; debtId?: string; at: number },
): Entry {
  const { order, held } = i;
  const total = order.total;
  const lines: Line[] = [];
  if (held > 0) lines.push([`d:${order.id}`, held]);
  lines.push([`p:${ctx.sys('sales').id}`, -total]);
  const due = total - held;
  if (due < 0) {
    if (!i.accountId) throw new Error('account');
    lines.push([`a:${i.accountId}`, due]);
  } else {
    const paid = Math.min(i.paid, due);
    if (paid > 0) {
      if (!i.accountId) throw new Error('account');
      lines.push(...receiveInto(ctx, i.accountId, paid, i.fee));
    }
    if (due - paid > 0) {
      if (!i.debtId) throw new Error('debt');
      lines.push([`r:${i.debtId}`, due - paid]);
    }
  }
  return make(ctx, 'order_done', total, i.at, lines, {
    catId: ctx.sys('sales').id,
    orderId: order.id,
    contactId: order.contactId,
    accountId: i.accountId,
    debtId: i.debtId,
    note: order.note,
  });
}

export function orderCancel(ctx: Ctx, i: { order: Order; held: number; refund: boolean; accountId?: string }): Entry {
  const lines: Line[] = [];
  if (i.held > 0) {
    lines.push([`d:${i.order.id}`, i.held]);
    if (i.refund) {
      if (!i.accountId) throw new Error('account');
      lines.push([`a:${i.accountId}`, -i.held]);
    } else {
      lines.push([`p:${ctx.sys('other_income').id}`, -i.held]);
    }
  }
  return make(ctx, 'order_cancel', i.held, ctx.now, lines, {
    orderId: i.order.id,
    contactId: i.order.contactId,
    accountId: i.refund ? i.accountId : undefined,
    note: i.refund ? 'DP dikembalikan' : 'DP hangus',
  });
}

export function opening(ctx: Ctx, accountId: string, amount: number): Entry {
  return make(ctx, 'opening', amount, ctx.now, [[`a:${accountId}`, amount], ['e', -amount]], { accountId, opening: true });
}

/** Balance correction that is not profit or loss (e.g. money added from the owner's pocket). */
export function adjust(ctx: Ctx, accountId: string, delta: number, note?: string): Entry {
  return make(ctx, 'adjust', Math.abs(delta), ctx.now, [[`a:${accountId}`, delta], ['e', -delta]], { accountId, note });
}

/** Counted cash vs expected: shortage is an expense, surplus is other income (same category). */
export function cashDiff(ctx: Ctx, accountId: string, diff: number, note?: string): Entry {
  return make(ctx, 'shift_diff', Math.abs(diff), ctx.now, [[`a:${accountId}`, diff], [`p:${ctx.sys('cash_diff').id}`, -diff]], {
    accountId,
    catId: ctx.sys('cash_diff').id,
    note,
  });
}

export function voidEntry(ctx: Ctx, orig: Entry, reason: string): Entry {
  return {
    ...make(ctx, 'void', orig.amount, orig.at, orig.lines.map(([k, v]) => [k, -v] as Line), {
      reverses: orig.id,
      voidReason: reason,
      catId: orig.catId,
      accountId: orig.accountId,
      toAccountId: orig.toAccountId,
      contactId: orig.contactId,
      debtId: orig.debtId,
      orderId: orig.orderId,
    }),
    backdated: undefined,
  };
}

export interface Ledger {
  bal: Map<string, number>;
  voided: Map<string, Entry>;
  byId: Map<string, Entry>;
  /** newest first */
  list: Entry[];
}

export function buildLedger(entries: Entry[]): Ledger {
  const bal = new Map<string, number>();
  const voided = new Map<string, Entry>();
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    byId.set(e.id, e);
    if (e.reverses) voided.set(e.reverses, e);
    for (const [k, v] of e.lines) bal.set(k, (bal.get(k) ?? 0) + v);
  }
  const list = [...entries].sort((a, b) => b.at - a.at || (b.id < a.id ? -1 : 1));
  return { bal, voided, byId, list };
}

export function debtKey(d: Debt): string {
  return `${d.dir === 'recv' ? 'r' : d.dir === 'pay' ? 'u' : 'l'}:${d.id}`;
}

export function debtRemaining(l: Ledger, d: Debt): number {
  const v = l.bal.get(debtKey(d)) ?? 0;
  return d.dir === 'recv' ? v : -v || 0;
}

export function debtPrincipal(entries: Entry[], d: Debt): number {
  const key = debtKey(d);
  let total = 0;
  for (const e of entries) {
    if (e.kind === 'void') continue;
    for (const [k, v] of e.lines) if (k === key && (d.dir === 'recv' ? v > 0 : v < 0)) total += Math.abs(v);
  }
  return total;
}

export function orderHeld(l: Ledger, o: Order): number {
  return -(l.bal.get(`d:${o.id}`) ?? 0) || 0;
}

/** Reason the entry can't be voided, or null. Prevents a void from leaving a debt or deposit below zero. */
export function voidBlocker(l: Ledger, e: Entry): string | null {
  if (e.kind === 'void') return 'Ini sudah transaksi pembatalan.';
  if (l.voided.has(e.id)) return 'Transaksi ini sudah dibatalkan.';
  for (const [k, v] of e.lines) {
    const after = (l.bal.get(k) ?? 0) - v;
    if ((k.startsWith('r:') && after < 0) || ((k.startsWith('u:') || k.startsWith('l:') || k.startsWith('d:')) && after > 0)) {
      return 'Batalkan dulu cicilan/pelunasan yang terkait transaksi ini.';
    }
  }
  return null;
}

export function accountBalance(l: Ledger, accountId: string): number {
  return l.bal.get(`a:${accountId}`) ?? 0;
}
