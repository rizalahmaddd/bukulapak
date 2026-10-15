export type BusinessType = 'kelontong' | 'fnb' | 'fashion' | 'jasa' | 'grosir' | 'lainnya';
export type Tz = 'WIB' | 'WITA' | 'WIT';
export type CategoryKind = 'income' | 'expense' | 'personal' | 'loan' | 'asset' | 'deposit';
export type Dir = 'in' | 'out';
export type AccountType = 'cash' | 'bank' | 'qris';
export type DebtDir = 'recv' | 'pay' | 'loan';

export type SysCategory =
  | 'sales'
  | 'sales_return'
  | 'other_income'
  | 'qris_fee'
  | 'bank_fee'
  | 'cash_diff'
  | 'bad_debt'
  | 'interest'
  | 'modal_in'
  | 'prive'
  | 'loan_in'
  | 'loan_pay'
  | 'asset'
  | 'dp';

interface Base {
  id: string;
  updatedAt: number;
}

export interface Settings extends Base {
  type: 'settings';
  name: string;
  businessType: BusinessType;
  tz: Tz;
  mdr: number;
  ordersEnabled: boolean;
  shiftEnabled: boolean;
  waTemplate: string;
  waOrderTemplate: string;
  createdAt: number;
}

export interface Account extends Base {
  type: 'account';
  name: string;
  kind: AccountType;
  archived?: boolean;
  sort: number;
}

export interface Category extends Base {
  type: 'category';
  name: string;
  kind: CategoryKind;
  dir: Dir;
  sys?: SysCategory;
  hidden?: boolean;
  archived?: boolean;
}

export interface Contact extends Base {
  type: 'contact';
  name: string;
  phone?: string;
  role: 'customer' | 'supplier' | 'lender';
}

export interface Debt extends Base {
  type: 'debt';
  contactId: string;
  dir: DebtDir;
  dueDate?: string;
  note?: string;
  createdAt: number;
}

export interface Order extends Base {
  type: 'order';
  contactId: string;
  total: number;
  pickupDate?: string;
  note: string;
  status: 'open' | 'done' | 'cancelled';
  createdAt: number;
  closedAt?: number;
}

export interface Shift extends Base {
  type: 'shift';
  device: string;
  by: string;
  openedAt: number;
  openingCount: number;
  closedAt?: number;
  closingCount?: number;
  expected?: number;
  diff?: number;
}

/**
 * Hidden double-entry line: [key, amount]. Positive means money/claims going up on our side
 * (money in an account, a receivable, an expense); every entry's lines sum to zero.
 * Keys: a:<account> p:<category> e (owner) r:<debt> u:<debt> l:<debt> s:<category> d:<order>
 */
export type Line = [string, number];

export type EntryKind =
  | 'in'
  | 'out'
  | 'transfer'
  | 'debt_pay'
  | 'loan_pay'
  | 'writeoff'
  | 'dp'
  | 'order_done'
  | 'order_cancel'
  | 'opening'
  | 'shift_diff'
  | 'adjust'
  | 'void';

export interface Entry {
  id: string;
  type: 'entry';
  kind: EntryKind;
  at: number;
  createdAt: number;
  by: string;
  device: string;
  amount: number;
  lines: Line[];
  catId?: string;
  accountId?: string;
  toAccountId?: string;
  contactId?: string;
  debtId?: string;
  orderId?: string;
  shiftId?: string;
  reverses?: string;
  voidReason?: string;
  note?: string;
  opening?: boolean;
  backdated?: boolean;
}

export type AnyRecord = Settings | Account | Category | Contact | Debt | Order | Shift | Entry;
export type RecordType = AnyRecord['type'];
