import { useState } from 'preact/hooks';
import type { Entry } from '../domain/types';
import { voidBlocker, voidEntry } from '../domain/ledger';
import { addDays, dayKey, dayStart, fmtDate, fmtDateTime, fmtTime, monthStart, rp } from '../domain/util';
import { accById, catById, contactById, ctx, isOwner, ledger, openShift, save, sysCat, tz } from '../store/data';
import { meta } from '../store/meta';
import { Empty, Money, Segmented, Sheet, TopBar, toast } from '../ui/kit';
import { device } from '../ui/device';
import { describe } from '../ui/describe';
import { go, query, route } from '../ui/router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, ChevronRight, Pencil, ReceiptText, Undo2, X } from 'lucide-preact';

type Period = 'today' | '7d' | 'month' | 'all';

export function History() {
  const q = query(route.value);
  const zone = tz.value;
  const l = ledger.value;
  const accFilter = q.get('acc');
  const [period, setPeriod] = useState<Period>(accFilter ? 'all' : '7d');
  const [dirFilter, setDirFilter] = useState<'all' | 'in' | 'out'>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(150);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const today = dayKey(Date.now(), zone);
  const from = period === 'today' ? dayStart(today, zone) : period === '7d' ? dayStart(addDays(today, -6), zone) : period === 'month' ? dayStart(monthStart(today), zone) : 0;
  const term = search.trim().toLowerCase();

  const list = l.list.filter((e) => {
    if (e.at < from) return false;
    if (accFilter && !e.lines.some(([k]) => k === `a:${accFilter}`)) return false;
    const d = describe(e);
    if (dirFilter === 'in' && d.sign <= 0) return false;
    if (dirFilter === 'out' && d.sign >= 0) return false;
    if (term) {
      const hay = `${d.title} ${d.sub} ${e.note ?? ''} ${e.amount}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  let totalIn = 0;
  let totalOut = 0;
  for (const e of list) {
    const d = describe(e);
    const voided = l.voided.has(e.id) || e.kind === 'void';
    if (!voided) {
      if (d.sign > 0) totalIn += e.amount;
      else if (d.sign < 0) totalOut += e.amount;
    }
  }

  const groups: [string, Entry[]][] = [];
  for (const e of list.slice(0, limit)) {
    const k = dayKey(e.at, zone);
    const last = groups[groups.length - 1];
    if (last && last[0] === k) last[1].push(e);
    else groups.push([k, [e]]);
  }

  const activeEntryId = selectedId ?? list[0]?.id ?? null;
  const activeEntry = activeEntryId ? l.byId.get(activeEntryId) : undefined;
  const net = totalIn - totalOut;

  return (
    <div>
      <TopBar title={accFilter ? `Riwayat ${accById.value.get(accFilter)?.name ?? ''}` : 'Riwayat'} backTo={accFilter ? '/' : false} />
      <div class="page">
        <div class="stack">
          <input
            class="input search"
            type="search"
            placeholder="Cari catatan, kategori, kontak, nominal"
            aria-label="Cari transaksi"
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="toolbar-row">
            <Segmented
              label="Periode"
              scroll
              value={period}
              onChange={setPeriod}
              options={[
                ['today', 'Hari ini'],
                ['7d', '7 hari'],
                ['month', 'Bulan ini'],
                ['all', 'Semua'],
              ]}
            />
            <Segmented
              label="Arah uang"
              value={dirFilter}
              onChange={setDirFilter}
              options={[
                ['all', 'Semua'],
                ['in', 'Masuk'],
                ['out', 'Keluar'],
              ]}
            />
          </div>
        </div>

        <div class="summary-strip">
          <div>
            <span class="tiny muted">Masuk</span>
            <span class="v pos">{rp(totalIn)}</span>
          </div>
          <div>
            <span class="tiny muted">Keluar</span>
            <span class="v neg">{rp(totalOut)}</span>
          </div>
          <div>
            <span class="tiny muted">Bersih</span>
            <span class={`v ${net >= 0 ? 'pos' : 'neg'}`}>{rp(net)}</span>
          </div>
        </div>

        <div class="split">
          <div class="stack loose">
            {groups.length === 0 && (
              <div class="card">
                <Empty icon={<ReceiptText size={24} aria-hidden="true" />}>Tidak ada transaksi pada periode ini.</Empty>
              </div>
            )}
            {groups.map(([day, items]) => (
              <section class="stack" key={day}>
                <div class="day-head">
                  <span>{fmtDate(day, true)}</span>
                  <span class="tabular-nums">{items.length} transaksi</span>
                </div>
                <div class="card flush">
                  <div class="list with-icons">
                    {items.map((e) => (
                      <EntryRow e={e} key={e.id} isActive={device.value !== 'mobile' && e.id === activeEntryId} onSelect={() => setSelectedId(e.id)} />
                    ))}
                  </div>
                </div>
              </section>
            ))}
            {list.length > limit && (
              <button class="btn block" onClick={() => setLimit(limit + 150)}>
                Tampilkan lebih banyak
              </button>
            )}
          </div>

          <div class="pane-detail">
            {activeEntry ? (
              <EntryDetailContent e={activeEntry} />
            ) : (
              <div class="card">
                <Empty icon={<ReceiptText size={24} aria-hidden="true" />}>Pilih transaksi untuk melihat rinciannya.</Empty>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TxIcon(props: { sign: number; size?: number }) {
  const Icon = props.sign > 0 ? ArrowDownLeft : props.sign < 0 ? ArrowUpRight : ArrowLeftRight;
  return (
    <span class={`tx-icon ${props.sign > 0 ? 'in' : props.sign < 0 ? 'out' : 'move'}`} aria-hidden="true">
      <Icon size={props.size ?? 18} strokeWidth={2.2} />
    </span>
  );
}

export function EntryRow(props: { e: Entry; isActive?: boolean; onSelect?: () => void; showDate?: boolean }) {
  const { e, isActive, onSelect } = props;
  const d = describe(e);
  const voided = ledger.value.voided.has(e.id) || e.kind === 'void';
  const open = () => {
    if (onSelect && device.value !== 'mobile') onSelect();
    else go(`/entry/${e.id}`);
  };

  return (
    <div
      class={`item ${isActive ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'true' : undefined}
      onClick={open}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), open())}
    >
      <TxIcon sign={voided ? 0 : d.sign} />
      <div class="grow">
        <div class={`item-title ellipsis ${voided ? 'strike' : ''}`}>{d.title}</div>
        <div class="item-sub ellipsis">
          {props.showDate ? fmtDateTime(e.at, tz.value) : fmtTime(e.at, tz.value)}
          {d.sub && ` · ${d.sub}`}
          {e.backdated && ' · susulan'}
        </div>
      </div>
      <div class={`item-value ${d.sign > 0 ? 'pos' : d.sign < 0 ? 'neg' : ''} ${voided ? 'strike' : ''}`}>
        {d.sign > 0 ? '+' : d.sign < 0 ? '−' : ''}
        <Money v={e.amount} />
      </div>
    </div>
  );
}

const REASONS = ['Salah input nominal', 'Retur barang / jasa', 'Pesanan dibatalkan', 'Lainnya'];

function lineLabel(k: string): string | null {
  const [p, id] = k.split(':');
  if (p === 'a') return accById.value.get(id)?.name ?? 'Akun';
  if (p === 'p') {
    const c = catById.value.get(id);
    return c ? `Untung (${c.kind === 'income' ? 'pendapatan' : 'biaya'} ${c.name})` : 'Untung';
  }
  if (p === 'e') return 'Uang pribadi pemilik';
  if (p === 'r') return 'Piutang pelanggan';
  if (p === 'u') return 'Utang usaha';
  if (p === 'l') return 'Pinjaman';
  if (p === 's') return 'Aset / peralatan';
  if (p === 'd') return 'DP pesanan (titipan)';
  return null;
}

export function EntryDetailContent(props: { e: Entry; onClose?: () => void }) {
  const l = ledger.value;
  const e = props.e;
  const zone = tz.value;
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState('');

  const d = describe(e);
  const voidedBy = l.voided.get(e.id);
  const original = e.reverses ? l.byId.get(e.reverses) : undefined;
  const owner = isOwner.value;
  const shift = openShift.value;
  const cashierCanVoid = !owner && e.device === meta.value.deviceId && !!shift && e.shiftId === shift.id;
  const blocker = voidBlocker(l, e);
  const canVoid = (owner || cashierCanVoid) && !blocker;
  const canEdit = canVoid && (e.kind === 'in' || e.kind === 'out') && !e.debtId && !e.orderId;
  const contact = e.contactId ? contactById.value.get(e.contactId) : undefined;
  const isSale = e.kind === 'in' && e.catId && catById.value.get(e.catId)?.kind === 'income';

  const doVoid = async () => {
    const r = reason === 'Lainnya' ? other.trim() || 'Lainnya' : reason;
    await save(voidEntry(ctx(), e, r));
    toast('Transaksi berhasil dibatalkan.');
    setVoiding(false);
  };

  const isVoided = !!voidedBy || e.kind === 'void';
  const related: [string, string][] = [
    ...(original ? ([[`#/entry/${original.id}`, 'Transaksi awal yang dibatalkan']] as [string, string][]) : []),
    ...(voidedBy ? ([[`#/entry/${voidedBy.id}`, 'Catatan pembatalannya']] as [string, string][]) : []),
    ...(e.debtId ? ([[`#/debts/${e.debtId}`, 'Kartu utang/piutang terkait']] as [string, string][]) : []),
    ...(e.orderId ? ([[`#/orders/${e.orderId}`, 'Rincian pesanan']] as [string, string][]) : []),
  ];

  return (
    <div class="stack">
      <div class="card stack">
        <div class="row between">
          <TxIcon sign={isVoided ? 0 : d.sign} size={22} />
          <div class="row">
            {e.kind === 'void' ? (
              <span class="badge red">Pembatalan</span>
            ) : voidedBy ? (
              <span class="badge red">Dibatalkan</span>
            ) : (
              d.sub && <span class="badge trunc">{d.sub}</span>
            )}
            {props.onClose && (
              <button class="icon-btn" aria-label="Tutup" onClick={props.onClose}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div class="stack tight">
          <h2 class={voidedBy ? 'strike' : ''}>{d.title}</h2>
          <div class={`metric-lg ${d.sign > 0 ? 'pos' : d.sign < 0 ? 'neg' : ''} ${voidedBy ? 'strike' : ''}`}>
            {d.sign > 0 ? '+' : d.sign < 0 ? '−' : ''}
            <Money v={e.amount} />
          </div>
          {isVoided && <div class="small neg">Alasan: {e.kind === 'void' ? e.voidReason : voidedBy?.voidReason}</div>}
        </div>

        <div class="kv">
          <div>
            <span>Waktu</span>
            <span>{fmtDateTime(e.at, zone)}</span>
          </div>
          {(e.backdated || e.kind === 'void') && (
            <div>
              <span>Dicatat pada</span>
              <span>{fmtDateTime(e.createdAt, zone)}</span>
            </div>
          )}
          <div>
            <span>Dicatat oleh</span>
            <span>{e.by}</span>
          </div>
          {contact && (
            <div>
              <span>Kontak</span>
              <a href={`#/debts/c/${contact.id}`} class="bold">
                {contact.name}
              </a>
            </div>
          )}
          {e.note && (
            <div>
              <span>Catatan</span>
              <span>{e.note}</span>
            </div>
          )}
        </div>

        {related.length > 0 && (
          <div class="list plain">
            {related.map(([href, label]) => (
              <a key={href} class="item" href={href}>
                <span class="grow small bold">{label}</span>
                <ChevronRight size={16} class="chev" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </div>

      {owner && (
        <div class="card stack">
          <h3>Pengaruh ke kas & laba</h3>
          <div class="kv">
            {e.lines.map(([k, v]) => {
              const label = lineLabel(k);
              if (!label) return null;
              const shown = k.startsWith('p:') || k.startsWith('u:') || k.startsWith('l:') || k.startsWith('d:') || k === 'e' ? -v : v;
              return (
                <div key={k}>
                  <span>{label}</span>
                  <Money v={shown} sign />
                </div>
              );
            })}
          </div>
          <div class="hint">Pendapatan/biaya memengaruhi untung bersih. Akun kas memengaruhi saldo uang riil.</div>
        </div>
      )}

      {!voidedBy && e.kind !== 'void' && (
        <div class="stack tight">
          {canEdit && (
            <button class="btn block" onClick={() => go(`/tx/${e.kind === 'in' ? 'in' : 'out'}?edit=${e.id}`)}>
              <Pencil size={16} aria-hidden="true" /> Ubah transaksi
            </button>
          )}
          {isSale && owner && (
            <button
              class="btn block"
              onClick={() => go(`/tx/out?cat=${sysCat('sales_return').id}&note=${encodeURIComponent(`Retur dari ${d.title} ${fmtDateTime(e.at, zone)}`)}`)}
            >
              <Undo2 size={16} aria-hidden="true" /> Catat retur sebagian
            </button>
          )}
          {canVoid ? (
            <button class="btn block danger-text" onClick={() => setVoiding(true)}>
              <Ban size={16} aria-hidden="true" /> Batalkan transaksi
            </button>
          ) : (
            <div class="hint center">{blocker ?? (owner ? '' : 'Kasir hanya bisa membatalkan transaksinya sendiri saat shift kasir masih buka.')}</div>
          )}
        </div>
      )}

      {voiding && (
        <Sheet title="Batalkan transaksi ini?" onClose={() => setVoiding(false)}>
          <p class="small muted">Transaksi tidak dihapus supaya pembukuan tetap transparan. Sistem mencatat transaksi pembalik.</p>
          <div class="stack tight">
            {REASONS.map((r) => (
              <button key={r} class={`chip option ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          {reason === 'Lainnya' && (
            <input class="input" placeholder="Tulis alasan pembatalan…" value={other} onInput={(ev) => setOther(ev.currentTarget.value)} />
          )}
          <button class="btn red block large" onClick={doVoid}>
            Ya, batalkan transaksi
          </button>
        </Sheet>
      )}
    </div>
  );
}

export function EntryDetail(props: { id: string }) {
  const l = ledger.value;
  const e = l.byId.get(props.id);
  return (
    <div>
      <TopBar title="Detail Transaksi" backTo="/history" />
      <div class="page detail">{e ? <EntryDetailContent e={e} /> : <Empty>Transaksi tidak ditemukan.</Empty>}</div>
    </div>
  );
}
