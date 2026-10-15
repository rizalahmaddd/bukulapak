import { describe, expect, it } from 'vitest';
import * as L from '../src/domain/ledger';
import { cashflow, monthly, pendingSince, profit } from '../src/domain/reports';
import { presetAccounts, presetCategories } from '../src/domain/presets';
import type { Category, Debt, Entry, Order, SysCategory } from '../src/domain/types';

const now = Date.parse('2026-10-14T05:00:00Z');
const cats = presetCategories('fnb', now);
const accounts = presetAccounts(now);
const [cash, bank, qris] = accounts;
const catMap = new Map(cats.map((c) => [c.id, c]));
const sys = (k: SysCategory) => cats.find((c) => c.sys === k)!;
const byName = (n: string) => cats.find((c) => c.name === n) as Category;
const ctx: L.Ctx = { now, by: 'Ani', device: 'dev1', mdr: 0.7, sys, account: (id) => accounts.find((a) => a.id === id) };
const day = { from: Date.parse('2026-10-13T17:00:00Z'), to: Date.parse('2026-10-14T17:00:00Z') };
const debt = (dir: Debt['dir']): Debt => ({ id: `debt-${dir}-0001`, type: 'debt', contactId: 'c1', dir, createdAt: now, updatedAt: now });

function sumLines(e: Entry) {
  return e.lines.reduce((s, [, v]) => s + v, 0);
}

describe('ledger', () => {
  it('cash sale, qris sale with MDR, and expense produce the right profit and balances', () => {
    const entries = [
      L.moneyIn(ctx, { cat: sys('sales'), amount: 50_000, at: now, accountId: cash.id, paid: 50_000 }),
      L.moneyIn(ctx, { cat: sys('sales'), amount: 100_000, at: now, accountId: qris.id, paid: 100_000 }),
      L.moneyOut(ctx, { cat: byName('Beli Bahan Baku'), amount: 30_000, at: now, source: cash.id, paid: 30_000 }),
    ];
    entries.forEach((e) => expect(sumLines(e)).toBe(0));
    const l = L.buildLedger(entries);
    expect(L.accountBalance(l, cash.id)).toBe(20_000);
    expect(L.accountBalance(l, qris.id)).toBe(99_300);
    const p = profit(entries, catMap, day);
    expect(p.totalIncome).toBe(150_000);
    expect(p.totalExpense).toBe(30_700);
    expect(p.profit).toBe(119_300);
    expect(pendingSince(entries, qris.id)).toBe(now);
  });

  it('prive, owner capital, loans, assets and transfers never touch profit', () => {
    const loan = debt('loan');
    const entries = [
      L.opening(ctx, cash.id, 200_000),
      L.moneyIn(ctx, { cat: sys('modal_in'), amount: 100_000, at: now, accountId: cash.id, paid: 100_000 }),
      L.moneyOut(ctx, { cat: sys('prive'), amount: 50_000, at: now, source: cash.id, paid: 50_000 }),
      L.moneyIn(ctx, { cat: sys('loan_in'), amount: 5_000_000, at: now, accountId: bank.id, paid: 5_000_000, debtId: loan.id }),
      L.moneyOut(ctx, { cat: sys('asset'), amount: 1_500_000, at: now, source: bank.id, paid: 1_500_000 }),
      L.transfer(ctx, { from: cash.id, to: bank.id, amount: 100_000, fee: 0, at: now }),
    ];
    const p = profit(entries, catMap, day);
    expect(p.profit).toBe(0);
    const l = L.buildLedger(entries);
    expect(L.accountBalance(l, cash.id)).toBe(150_000);
    expect(L.accountBalance(l, bank.id)).toBe(3_600_000);
    expect(L.debtRemaining(l, loan)).toBe(5_000_000);
    const pay = L.debtPayment(ctx, { debt: loan, amount: 600_000, accountId: bank.id, at: now, interest: 100_000 });
    const l2 = L.buildLedger([...entries, pay]);
    expect(L.debtRemaining(l2, loan)).toBe(4_500_000);
    expect(profit([...entries, pay], catMap, day).profit).toBe(-100_000);
  });

  it('expense paid from personal pocket counts as cost but leaves the drawer alone', () => {
    const e = L.moneyOut(ctx, { cat: byName('Operasional'), amount: 25_000, at: now, source: 'personal', paid: 25_000 });
    const l = L.buildLedger([e]);
    expect(L.accountBalance(l, cash.id)).toBe(0);
    expect(profit([e], catMap, day).profit).toBe(-25_000);
  });

  it('partial credit sale books full profit, collects the rest later', () => {
    const d = debt('recv');
    const sale = L.moneyIn(ctx, { cat: sys('sales'), amount: 100_000, at: now, accountId: cash.id, paid: 40_000, debtId: d.id });
    const pay = L.debtPayment(ctx, { debt: d, amount: 60_000, accountId: cash.id, at: now });
    const l = L.buildLedger([sale]);
    expect(L.debtRemaining(l, d)).toBe(60_000);
    expect(profit([sale], catMap, day).profit).toBe(100_000);
    const l2 = L.buildLedger([sale, pay]);
    expect(L.debtRemaining(l2, d)).toBe(0);
    expect(L.accountBalance(l2, cash.id)).toBe(100_000);
    expect(profit([sale, pay], catMap, day).profit).toBe(100_000);
    expect(L.debtPrincipal([sale, pay], d)).toBe(60_000);
    expect(L.voidBlocker(l2, sale)).toMatch(/cicilan/);
  });

  it('order deposit is not profit until the order is done', () => {
    const order: Order = { id: 'order-000001', type: 'order', contactId: 'c1', total: 1_000_000, note: '50 nasi kotak', status: 'open', createdAt: now, updatedAt: now };
    const d = debt('recv');
    const dp = L.moneyIn(ctx, { cat: sys('dp'), amount: 300_000, at: now, accountId: cash.id, paid: 300_000, orderId: order.id });
    expect(profit([dp], catMap, day).profit).toBe(0);
    const l = L.buildLedger([dp]);
    expect(L.orderHeld(l, order)).toBe(300_000);
    const done = L.orderDone(ctx, { order, held: 300_000, paid: 500_000, accountId: cash.id, debtId: d.id, at: now });
    const l2 = L.buildLedger([dp, done]);
    expect(L.orderHeld(l2, order)).toBe(0);
    expect(L.debtRemaining(l2, d)).toBe(200_000);
    expect(L.accountBalance(l2, cash.id)).toBe(800_000);
    expect(profit([dp, done], catMap, day).profit).toBe(1_000_000);

    const forfeit = L.orderCancel(ctx, { order, held: 300_000, refund: false });
    expect(profit([dp, forfeit], catMap, day).profit).toBe(300_000);
    const refund = L.orderCancel(ctx, { order, held: 300_000, refund: true, accountId: cash.id });
    const l3 = L.buildLedger([dp, refund]);
    expect(L.accountBalance(l3, cash.id)).toBe(0);
    expect(profit([dp, refund], catMap, day).profit).toBe(0);
  });

  it('void reverses everything in the same period and is excluded from flow totals', () => {
    const sale = L.moneyIn(ctx, { cat: sys('sales'), amount: 70_000, at: now, accountId: cash.id, paid: 70_000 });
    const v = L.voidEntry({ ...ctx, now: now + 3 * 86_400_000 }, sale, 'Salah input');
    expect(v.at).toBe(sale.at);
    const l = L.buildLedger([sale, v]);
    expect(L.accountBalance(l, cash.id)).toBe(0);
    expect(profit([sale, v], catMap, day).profit).toBe(0);
    const cf = cashflow([sale, v], accounts, day).find((r) => r.account.id === cash.id)!;
    expect(cf.in).toBe(0);
    expect(cf.out).toBe(0);
    expect(L.voidBlocker(l, sale)).toMatch(/sudah dibatalkan/);
  });

  it('cash count difference lands in Selisih Kas', () => {
    const short = L.cashDiff(ctx, cash.id, -5_000);
    expect(profit([short], catMap, day).profit).toBe(-5_000);
    const over = L.cashDiff(ctx, cash.id, 2_000);
    expect(profit([over], catMap, day).profit).toBe(2_000);
  });

  it('write-off turns remaining receivable into an expense', () => {
    const d = debt('recv');
    const sale = L.moneyIn(ctx, { cat: sys('sales'), amount: 80_000, at: now, paid: 0, debtId: d.id });
    const wo = L.writeOff(ctx, d, 80_000);
    const l = L.buildLedger([sale, wo]);
    expect(L.debtRemaining(l, d)).toBe(0);
    expect(profit([sale, wo], catMap, day).profit).toBe(0);
  });

  it('rejects unbalanced or invalid input', () => {
    expect(() => L.moneyIn(ctx, { cat: sys('sales'), amount: 10_000, at: now, paid: 0 })).toThrow();
    expect(() => L.moneyOut(ctx, { cat: sys('prive'), amount: 10_000, at: now, source: 'personal', paid: 10_000 })).toThrow();
    expect(() => L.transfer(ctx, { from: cash.id, to: cash.id, amount: 1, fee: 0, at: now })).toThrow();
  });

  it('monthly summary splits by month in the business timezone', () => {
    const late = Date.parse('2026-09-30T18:00:00Z');
    const e1 = L.moneyIn(ctx, { cat: sys('sales'), amount: 10_000, at: late, accountId: cash.id, paid: 10_000 });
    const rows = monthly([e1], catMap, 'WIB', '2026-10-14', 2);
    expect(rows.map((r) => r.month)).toEqual(['2026-09-01', '2026-10-01']);
    expect(rows[1].income).toBe(10_000);
  });
});
