import { computed, signal } from '@preact/signals';
import type { Account, AnyRecord, Category, Contact, Debt, Entry, Order, Settings, Shift, SysCategory } from '../domain/types';
import { buildLedger, type Ctx } from '../domain/ledger';
import { WorkspaceDb } from './idb';
import { activeWs, meta } from './meta';

export const settings = signal<Settings | null>(null);
export const accounts = signal<Account[]>([]);
export const categories = signal<Category[]>([]);
export const contacts = signal<Contact[]>([]);
export const debts = signal<Debt[]>([]);
export const orders = signal<Order[]>([]);
export const shifts = signal<Shift[]>([]);
export const entries = signal<Entry[]>([]);
export const loaded = signal(false);

export const ledger = computed(() => buildLedger(entries.value));
export const catById = computed(() => new Map(categories.value.map((c) => [c.id, c])));
export const accById = computed(() => new Map(accounts.value.map((a) => [a.id, a])));
export const contactById = computed(() => new Map(contacts.value.map((c) => [c.id, c])));
export const debtById = computed(() => new Map(debts.value.map((d) => [d.id, d])));
export const orderById = computed(() => new Map(orders.value.map((o) => [o.id, o])));
export const liveAccounts = computed(() => accounts.value.filter((a) => !a.archived).sort((a, b) => a.sort - b.sort));
export const tz = computed(() => settings.value?.tz ?? 'WIB');
export const isOwner = computed(() => activeWs()?.role !== 'cashier' && !!meta.value.active);
export const openShift = computed(() => shifts.value.find((s) => !s.closedAt && s.device === meta.value.deviceId) ?? null);

let db: WorkspaceDb | null = null;
let dbWs: string | null = null;
const listeners = new Set<() => void>();

export function onLocalChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function put<T extends { id: string }>(list: T[], items: T[]): T[] {
  if (!items.length) return list;
  const map = new Map(list.map((x) => [x.id, x]));
  for (const it of items) map.set(it.id, it);
  return [...map.values()];
}

function distribute(records: AnyRecord[]) {
  const by: Record<string, AnyRecord[]> = {};
  for (const r of records) (by[r.type] ??= []).push(r);
  if (by.settings) settings.value = by.settings[by.settings.length - 1] as Settings;
  if (by.account) accounts.value = put(accounts.value, by.account as Account[]);
  if (by.category) categories.value = put(categories.value, by.category as Category[]);
  if (by.contact) contacts.value = put(contacts.value, by.contact as Contact[]);
  if (by.debt) debts.value = put(debts.value, by.debt as Debt[]);
  if (by.order) orders.value = put(orders.value, by.order as Order[]);
  if (by.shift) shifts.value = put(shifts.value, by.shift as Shift[]);
  if (by.entry) entries.value = put(entries.value, by.entry as Entry[]);
}

function reset() {
  settings.value = null;
  accounts.value = [];
  categories.value = [];
  contacts.value = [];
  debts.value = [];
  orders.value = [];
  shifts.value = [];
  entries.value = [];
}

export async function openWorkspace(wsId: string | undefined) {
  loaded.value = false;
  db?.close();
  db = null;
  dbWs = null;
  reset();
  if (wsId) {
    db = await WorkspaceDb.open(wsId);
    dbWs = wsId;
    distribute(await db.all());
  }
  loaded.value = true;
}

export function currentDb(): WorkspaceDb {
  if (!db) throw new Error('no workspace');
  return db;
}

export function currentDbWs() {
  return dbWs;
}

export async function save(...records: AnyRecord[]) {
  const now = Date.now();
  const stamped = records.map((r) => (r.type === 'entry' ? r : { ...r, updatedAt: now }));
  await currentDb().save(stamped);
  distribute(stamped);
  listeners.forEach((fn) => fn());
}

export function applyRemoteToState(records: AnyRecord[]) {
  distribute(records);
}

export function sysCat(key: SysCategory): Category {
  const c = categories.value.find((x) => x.sys === key);
  if (!c) throw new Error(`missing category ${key}`);
  return c;
}

export function userName(): string {
  const ws = activeWs();
  if (ws?.role === 'cashier') return meta.value.deviceLabel;
  return meta.value.user?.name ?? 'Pemilik';
}

export function ctx(): Ctx {
  return {
    now: Date.now(),
    by: userName(),
    device: meta.value.deviceId,
    shiftId: openShift.value?.id,
    mdr: settings.value?.mdr ?? 0,
    sys: sysCat,
    account: (id) => accById.value.get(id),
  };
}
