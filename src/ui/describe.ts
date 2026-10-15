import type { Entry } from '../domain/types';
import { accById, catById, contactById, debtById } from '../store/data';

export interface Desc {
  title: string;
  sub: string;
  sign: 1 | -1 | 0;
}

const KIND_TITLE: Partial<Record<Entry['kind'], string>> = {
  transfer: 'Pindah Uang',
  writeoff: 'Diikhlaskan',
  dp: 'DP Pesanan',
  order_done: 'Pesanan Selesai',
  order_cancel: 'Pesanan Batal',
  opening: 'Saldo Awal',
  shift_diff: 'Selisih Kas',
  adjust: 'Koreksi Saldo',
  loan_pay: 'Bayar Cicilan Pinjaman',
};

export function describe(e: Entry): Desc {
  const cat = e.catId ? catById.value.get(e.catId) : undefined;
  const acc = e.accountId ? accById.value.get(e.accountId)?.name : undefined;
  const to = e.toAccountId ? accById.value.get(e.toAccountId)?.name : undefined;
  const contact = e.contactId ? contactById.value.get(e.contactId)?.name : undefined;
  const debt = e.debtId ? debtById.value.get(e.debtId) : undefined;

  let title = KIND_TITLE[e.kind] ?? cat?.name ?? 'Transaksi';
  let sign: Desc['sign'] = 0;
  switch (e.kind) {
    case 'in':
    case 'dp':
    case 'order_done':
      sign = 1;
      break;
    case 'out':
    case 'loan_pay':
      sign = -1;
      break;
    case 'debt_pay':
      sign = debt?.dir === 'recv' ? 1 : -1;
      title = debt?.dir === 'recv' ? 'Terima Cicilan Piutang' : 'Bayar Utang';
      break;
    case 'shift_diff':
    case 'adjust':
      sign = (e.lines.find(([k]) => k.startsWith('a:'))?.[1] ?? 0) >= 0 ? 1 : -1;
      break;
    case 'order_cancel':
      sign = e.accountId ? -1 : 0;
      break;
    case 'opening':
      sign = 1;
      break;
    case 'void':
      title = `Batal: ${title}`;
      break;
  }
  const parts = [contact, e.kind === 'transfer' ? `${acc ?? '?'} → ${to ?? '?'}` : acc].filter(Boolean);
  const hasCredit = e.lines.some(([k, v]) => (k.startsWith('r:') && v > 0) || (k.startsWith('u:') && v < 0));
  if (hasCredit && e.kind !== 'void') parts.push('ada yang belum dibayar');
  return { title, sub: parts.join(' · '), sign };
}
