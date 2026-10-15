import { useState } from 'preact/hooks';
import type { Debt } from '../domain/types';
import { moneyIn, orderCancel, orderDone, orderHeld, mdrFee } from '../domain/ledger';
import { addDays, fmtDate, rp, ulid } from '../domain/util';
import { todayKey } from '../domain/reports';
import { accById, contactById, ctx, isOwner, ledger, liveAccounts, orders, save, settings, sysCat, tz } from '../store/data';
import { Empty, Money, MoneyInput, Segmented, Sheet, TopBar, toast, waLink } from '../ui/kit';
import { device } from '../ui/device';
import { EntryRow } from './History';
import { Check, ChevronRight, MessageSquare, Plus, ShoppingBag } from 'lucide-preact';

export function Orders() {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const l = ledger.value;
  const today = todayKey(tz.value);
  const list = orders.value
    .filter((o) => (tab === 'open' ? o.status === 'open' : o.status !== 'open'))
    .sort((a, b) => (tab === 'open' ? (a.pickupDate ?? '9999').localeCompare(b.pickupDate ?? '9999') : (b.closedAt ?? 0) - (a.closedAt ?? 0)));
  return (
    <div>
      <TopBar title="Pesanan & DP" backTo={device.value === 'desktop' ? false : '/'} />
      <div class="page">
        <Segmented
          label="Status pesanan"
          full
          value={tab}
          onChange={setTab}
          options={[
            ['open', 'Berjalan'],
            ['closed', 'Selesai / Batal'],
          ]}
        />
        {list.length === 0 ? (
          <div class="card">
            <Empty icon={<ShoppingBag size={24} aria-hidden="true" />}>{tab === 'open' ? 'Belum ada pesanan berjalan.' : 'Belum ada pesanan yang selesai.'}</Empty>
          </div>
        ) : (
          <div class="group list with-icons">
            {list.map((o) => {
              const soon = o.status === 'open' && o.pickupDate && o.pickupDate <= addDays(today, 1);
              const name = contactById.value.get(o.contactId)?.name ?? 'Pemesan';
              return (
                <a class="item" key={o.id} href={`#/orders/${o.id}`}>
                  <span class="avatar" aria-hidden="true">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <div class="grow">
                    <div class="item-title ellipsis">{name}</div>
                    <div class="item-sub ellipsis">{o.note || 'Tanpa keterangan'}</div>
                    <div class={`tiny ${soon ? 'neg bold' : 'muted'}`}>
                      {o.status === 'open'
                        ? o.pickupDate
                          ? `Diambil ${fmtDate(o.pickupDate)}`
                          : 'Tanggal ambil belum ditentukan'
                        : o.status === 'done'
                          ? 'Selesai'
                          : 'Batal'}
                    </div>
                  </div>
                  <div class="stack tight end">
                    <span class="item-value">{rp(o.total)}</span>
                    {o.status === 'open' && <span class="tiny muted">DP {rp(orderHeld(l, o))}</span>}
                  </div>
                  <ChevronRight size={16} class="chev" aria-hidden="true" />
                </a>
              );
            })}
          </div>
        )}
        <a class="btn green block large" href={`#/tx/in?cat=${sysCat('dp').id}`}>
          <Plus size={18} aria-hidden="true" />
          Terima DP pesanan baru
        </a>
      </div>
    </div>
  );
}

export function OrderDetail(props: { id: string }) {
  const order = orders.value.find((o) => o.id === props.id);
  const l = ledger.value;
  const accs = liveAccounts.value;
  const owner = isOwner.value;
  const s = settings.value!;
  const [sheet, setSheet] = useState<null | 'done' | 'cancel' | 'dp' | 'edit'>(null);
  const [paid, setPaid] = useState(0);
  const [accountId, setAccountId] = useState(accs.find((a) => a.kind === 'cash')?.id ?? accs[0]?.id ?? '');
  const [refund, setRefund] = useState(true);
  const [extra, setExtra] = useState(0);
  const [total, setTotal] = useState(order?.total ?? 0);
  const [note, setNote] = useState(order?.note ?? '');
  const [pickup, setPickup] = useState(order?.pickupDate ?? '');
  const [busy, setBusy] = useState(false);
  if (!order) return <Empty>Pesanan tidak ditemukan.</Empty>;
  const contact = contactById.value.get(order.contactId);
  const held = orderHeld(l, order);
  const due = order.total - held;
  const history = l.list.filter((e) => e.orderId === order.id);
  const qris = accById.value.get(accountId)?.kind === 'qris';

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setSheet(null);
    } catch (e) {
      console.error(e);
      toast('Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  };

  const finish = () =>
    run(async () => {
      const c = ctx();
      const pay = Math.min(paid, Math.max(due, 0));
      let debt: Debt | undefined;
      if (due - pay > 0) debt = { id: ulid(), type: 'debt', contactId: order.contactId, dir: 'recv', createdAt: c.now, updatedAt: c.now };
      const entry = orderDone(c, { order, held, paid: pay, accountId, debtId: debt?.id, at: c.now });
      await save(...(debt ? [debt] : []), entry, { ...order, status: 'done', closedAt: c.now });
      toast(debt ? `Selesai. Sisa ${rp(due - pay)} masuk piutang.` : 'Pesanan selesai & lunas');
    });

  const cancel = () =>
    run(async () => {
      const c = ctx();
      await save(orderCancel(c, { order, held, refund, accountId }), { ...order, status: 'cancelled', closedAt: c.now });
      toast('Pesanan dibatalkan');
    });

  const addDp = () =>
    run(async () => {
      const c = ctx();
      await save(moneyIn(c, { cat: sysCat('dp'), amount: extra, at: c.now, accountId, paid: extra, orderId: order.id, contactId: order.contactId }));
      setExtra(0);
      toast('DP tambahan tercatat');
    });

  const saveEdit = () =>
    run(async () => {
      const { pickupDate: _p, ...rest } = order;
      await save({ ...rest, total: Math.max(total, held), note: note.trim(), ...(pickup ? { pickupDate: pickup } : {}) });
    });

  const wa = s.waOrderTemplate.replace(/\{(\w+)\}/g, (m, k: string) =>
    (
      ({
        nama: contact?.name ?? '',
        usaha: s.name,
        pesanan: order.note || 'pesanan',
        total: rp(order.total),
        dp: rp(held),
        sisa: rp(Math.max(due, 0)),
        ambil: order.pickupDate ? `. Jadwal ambil ${fmtDate(order.pickupDate, true)}` : '',
      }) as Record<string, string>
    )[k] ?? m,
  );

  const AccountChips = () => (
    <div class="chips">
      {accs.map((a) => (
        <button key={a.id} class={`chip ${accountId === a.id ? 'on' : ''}`} onClick={() => setAccountId(a.id)}>
          {a.name}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <TopBar title="Detail Pesanan" backTo="/orders" />
      <div class="page cols-2">
        <div class="card stack main-col">
          <div class="row loose">
            <span class="avatar lg" aria-hidden="true">
              {(contact?.name ?? 'P').slice(0, 1).toUpperCase()}
            </span>
            <div class="grow">
              <h2 class="ellipsis">{contact?.name ?? 'Pemesan'}</h2>
              <div class="small muted">{order.note || 'Tanpa keterangan'}</div>
            </div>
            <span class={`badge ${order.status === 'open' ? 'blue' : order.status === 'done' ? 'green' : 'red'}`}>
              {order.status === 'open' ? 'Berjalan' : order.status === 'done' ? 'Selesai' : 'Batal'}
            </span>
          </div>
          <div class="kv">
            <div>
              <span>Total harga</span>
              <Money v={order.total} />
            </div>
            <div>
              <span>DP diterima</span>
              <Money v={held} />
            </div>
            {order.status === 'open' && (
              <div class="total">
                <span>Sisa dibayar saat ambil</span>
                <Money v={Math.max(due, 0)} />
              </div>
            )}
            <div>
              <span>Tanggal ambil</span>
              <span>{order.pickupDate ? fmtDate(order.pickupDate, true) : '–'}</span>
            </div>
          </div>
          {order.status === 'open' && (
            <div class="stack tight">
              <button class="btn green block large" onClick={() => (setPaid(Math.max(due, 0)), setSheet('done'))}>
                <Check size={18} aria-hidden="true" />
                Pesanan selesai / diambil
              </button>
              <div class="btn-pair">
                <button class="btn" onClick={() => setSheet('dp')}>
                  <Plus size={16} aria-hidden="true" />
                  DP tambahan
                </button>
                <a class="btn" href={waLink(contact?.phone, wa)} target="_blank" rel="noopener">
                  <MessageSquare size={16} aria-hidden="true" />
                  Kirim WA
                </a>
              </div>
              <div class="btn-pair">
                <button class="btn" onClick={() => (setTotal(order.total), setNote(order.note), setPickup(order.pickupDate ?? ''), setSheet('edit'))}>
                  Ubah pesanan
                </button>
                {owner && (
                  <button class="btn danger-text" onClick={() => setSheet('cancel')}>
                    Batalkan
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div class="card flush">
          <div class="card-head">
            <h3>Riwayat uang</h3>
          </div>
          {history.length === 0 ? (
            <Empty>Belum ada.</Empty>
          ) : (
            <div class="list with-icons">
              {history.map((e) => (
                <EntryRow e={e} key={e.id} showDate />
              ))}
            </div>
          )}
        </div>
      </div>

      {sheet === 'done' && (
        <Sheet title="Pesanan selesai" onClose={() => setSheet(null)}>
          <p class="small">
            Jualan {rp(order.total)} dicatat sekarang dan masuk ke untung. DP {rp(held)} otomatis dipotong.
          </p>
          {due > 0 ? (
            <>
              <MoneyInput label="Dibayar sekarang" value={paid} onChange={(v) => setPaid(Math.min(v, due))} hint={paid < due ? `Sisa ${rp(due - paid)} dicatat sebagai piutang ${contact?.name ?? ''}` : 'Lunas'} />
              {paid > 0 && <AccountChips />}
              {paid > 0 && qris && <div class="hint">Potongan QRIS {rp(mdrFee(paid, s.mdr))}</div>}
            </>
          ) : due < 0 ? (
            <>
              <div class="small">DP lebih besar dari total. Kembalikan {rp(-due)} dari:</div>
              <AccountChips />
            </>
          ) : (
            <div class="small">Sudah lunas dari DP.</div>
          )}
          <button class="btn green block large" disabled={busy} onClick={finish}>
            Simpan
          </button>
        </Sheet>
      )}
      {sheet === 'cancel' && (
        <Sheet title="Batalkan pesanan?" onClose={() => setSheet(null)}>
          {held > 0 ? (
            <>
              <div class="chips">
                <button class={`chip ${refund ? 'on' : ''}`} onClick={() => setRefund(true)}>
                  DP dikembalikan
                </button>
                <button class={`chip ${!refund ? 'on' : ''}`} onClick={() => setRefund(false)}>
                  DP hangus
                </button>
              </div>
              <div class="hint">
                {refund ? `Uang ${rp(held)} keluar, untung tidak berubah.` : `DP ${rp(held)} dicatat sebagai pendapatan lain.`}
              </div>
              {refund && <AccountChips />}
            </>
          ) : (
            <div class="small">Belum ada DP yang diterima.</div>
          )}
          <button class="btn red block large" disabled={busy} onClick={cancel}>
            Batalkan pesanan
          </button>
        </Sheet>
      )}
      {sheet === 'dp' && (
        <Sheet title="DP tambahan" onClose={() => setSheet(null)}>
          <MoneyInput label="Nominal" value={extra} autoFocus onChange={setExtra} />
          <AccountChips />
          <button class="btn green block large" disabled={!extra || busy} onClick={addDp}>
            Simpan
          </button>
        </Sheet>
      )}
      {sheet === 'edit' && (
        <Sheet title="Ubah pesanan" onClose={() => setSheet(null)}>
          <MoneyInput label="Total harga" value={total} onChange={setTotal} hint={total < held ? 'Total tidak boleh di bawah DP yang sudah diterima.' : undefined} />
          <label class="field">
            Pesanannya apa?
            <input class="input" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </label>
          <label class="field">
            Tanggal ambil
            <input class="input" type="date" value={pickup} onInput={(e) => setPickup(e.currentTarget.value)} />
          </label>
          <button class="btn primary block large" disabled={busy || total < held} onClick={saveEdit}>
            Simpan
          </button>
        </Sheet>
      )}
    </div>
  );
}

