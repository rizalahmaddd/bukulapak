import { useState } from 'preact/hooks';
import type { Debt, DebtDir } from '../domain/types';
import { debtKey, debtPayment, debtPaymentMulti, debtRemaining, writeOff } from '../domain/ledger';
import { BUCKET_LABEL, debtRows, todayKey, type DebtRow } from '../domain/reports';
import { displayPhone, fmtDate, fromLocalInput, normalizePhone, rp, toLocalInput } from '../domain/util';
import { contactById, ctx, debts, entries, isOwner, ledger, liveAccounts, save, settings, tz } from '../store/data';
import { Empty, Money, MoneyInput, Segmented, Sheet, TopBar, toast, waLink } from '../ui/kit';
import { device } from '../ui/device';
import { EntryRow } from './History';
import { go, query, route } from '../ui/router';
import { Check, ChevronRight, HandCoins, MessageSquare, Phone, Plus, X } from 'lucide-preact';

const TABS = [
  ['recv', 'Piutang'],
  ['pay', 'Utang'],
  ['loan', 'Pinjaman'],
] as const;

const TAB_SUB: Record<DebtDir, string> = {
  recv: 'Pelanggan yang belum bayar',
  pay: 'Utang belanja ke supplier',
  loan: 'Sisa pokok pinjaman modal',
};

interface Group {
  contactId: string;
  rows: DebtRow[];
  remaining: number;
  worst: DebtRow['bucket'];
}

const BUCKET_RANK: Record<DebtRow['bucket'], number> = { none: 0, notdue: 1, d1_30: 2, d30plus: 3 };

function groupsFor(dir: DebtDir): Group[] {
  const rows = debtRows(
    debts.value.filter((d) => d.dir === dir),
    ledger.value,
    entries.value,
    todayKey(tz.value),
  );
  const map = new Map<string, Group>();
  for (const r of rows) {
    const g = map.get(r.debt.contactId) ?? { contactId: r.debt.contactId, rows: [], remaining: 0, worst: 'none' as const };
    g.rows.push(r);
    g.remaining += r.remaining;
    if (BUCKET_RANK[r.bucket] > BUCKET_RANK[g.worst]) g.worst = r.bucket;
    map.set(r.debt.contactId, g);
  }
  return [...map.values()].sort((a, b) => BUCKET_RANK[b.worst] - BUCKET_RANK[a.worst] || b.remaining - a.remaining);
}

export function Debts() {
  const q = query(route.value);
  const [tab, setTab] = useState<DebtDir>((q.get('tab') as DebtDir) ?? 'recv');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const groups = groupsFor(tab);
  const total = groups.reduce((s, g) => s + g.remaining, 0);

  const activeContactId = selectedContactId ?? groups[0]?.contactId ?? null;

  return (
    <div>
      <TopBar title="Utang & Piutang" backTo={false} />
      <div class="page">
        <Segmented
          label="Jenis catatan"
          full
          value={tab}
          options={TABS}
          onChange={(v) => {
            setTab(v);
            setSelectedContactId(null);
          }}
        />

        <div class="split">
          <div class="stack">
            <div class="card row between">
              <div>
                <div class="metric-label">{TAB_SUB[tab]}</div>
                <div class="metric-lg">
                  <Money v={total} />
                </div>
              </div>
              <span class="badge">{groups.length} kontak</span>
            </div>

            {groups.length === 0 ? (
              <div class="card">
                <Empty icon={<HandCoins size={24} aria-hidden="true" />}>
                  {tab === 'recv'
                    ? 'Tidak ada pelanggan yang berutang saat ini.'
                    : tab === 'pay'
                      ? 'Tidak ada utang ke supplier yang belum lunas.'
                      : 'Belum ada pinjaman modal yang aktif.'}
                </Empty>
              </div>
            ) : (
              <div class="card flush">
                <div class="list with-icons">
                  {groups.map((g) => {
                    const c = contactById.value.get(g.contactId);
                    const isSelected = device.value !== 'mobile' && g.contactId === activeContactId;
                    const isOverdue = g.worst === 'd1_30' || g.worst === 'd30plus';
                    const open = () => {
                      if (device.value === 'mobile') go(`/debts/c/${g.contactId}?dir=${tab}`);
                      else setSelectedContactId(g.contactId);
                    };
                    return (
                      <div
                        class={`item ${isSelected ? 'active' : ''}`}
                        key={g.contactId}
                        role="button"
                        tabIndex={0}
                        onClick={open}
                        onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), open())}
                      >
                        <span class="avatar" aria-hidden="true">
                          {(c?.name ?? '?').slice(0, 1).toUpperCase()}
                        </span>
                        <div class="grow">
                          <div class="item-title ellipsis">{c?.name ?? 'Tanpa nama'}</div>
                          <div class="item-sub ellipsis">
                            {g.rows.length} catatan · <span class={isOverdue ? 'neg' : ''}>{BUCKET_LABEL[g.worst]}</span>
                          </div>
                        </div>
                        <span class="item-value">
                          <Money v={g.remaining} />
                        </span>
                        <ChevronRight size={16} class="chev only-mobile" aria-hidden="true" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <a class="btn block tinted" href={tab === 'recv' ? '#/tx/in?pay=credit' : tab === 'pay' ? '#/tx/out?pay=credit' : '#/tx/in'}>
              <Plus size={17} aria-hidden="true" />
              {tab === 'recv' ? 'Catat pelanggan ngutang' : tab === 'pay' ? 'Catat utang belanja' : 'Catat pinjaman baru'}
            </a>
          </div>

          <div class="pane-detail">
            {activeContactId ? (
              <ContactDebtsContent contactId={activeContactId} dir={tab} />
            ) : (
              <div class="card">
                <Empty icon={<HandCoins size={24} aria-hidden="true" />}>Pilih kontak untuk melihat rincian tagihan & pembayaran.</Empty>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DebtRedirect(props: { id: string }) {
  const d = debts.value.find((x) => x.id === props.id);
  if (!d) return <Empty>Catatan utang/piutang tidak ditemukan.</Empty>;
  go(`/debts/c/${d.contactId}?dir=${d.dir}`, true);
  return null;
}

function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function ContactDebtsContent(props: { contactId: string; dir: DebtDir; onClose?: () => void }) {
  const dir = props.dir;
  const contact = contactById.value.get(props.contactId);
  const l = ledger.value;
  const zone = tz.value;
  const owner = isOwner.value;
  const all = debts.value.filter((d) => d.contactId === props.contactId && d.dir === dir).sort((a, b) => a.createdAt - b.createdAt);
  const open = all.filter((d) => debtRemaining(l, d) > 0);
  const remaining = open.reduce((s, d) => s + debtRemaining(l, d), 0);
  const keys = new Set(all.map(debtKey));
  const history = l.list.filter((e) => e.lines.some(([k]) => keys.has(k)));
  const accs = liveAccounts.value;

  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState(0);
  const [interest, setInterest] = useState(0);
  const [accountId, setAccountId] = useState(accs.find((a) => a.kind === 'cash')?.id ?? accs[0]?.id ?? '');
  const [initialAt] = useState(() => toLocalInput(Date.now(), zone));
  const [at, setAt] = useState(initialAt);
  const [editDue, setEditDue] = useState<Debt | null>(null);
  const [dueValue, setDueValue] = useState('');
  const [writingOff, setWritingOff] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phone, setPhone] = useState(displayPhone(contact?.phone));
  const [busy, setBusy] = useState(false);

  const earliestDue = open.map((d) => d.dueDate).filter(Boolean).sort()[0];
  const waText = fillTemplate(settings.value!.waTemplate, {
    nama: contact?.name ?? '',
    usaha: settings.value!.name,
    sisa: rp(remaining),
    jatuh_tempo: earliestDue ? ` yang jatuh tempo ${fmtDate(earliestDue, true)}` : '',
  });

  const pay = async () => {
    if (!amount || busy) return;
    setBusy(true);
    try {
      const c = ctx();
      const when = at === initialAt ? Date.now() : fromLocalInput(at, zone);
      if (dir === 'loan') {
        const d = open[0];
        await save(debtPayment(c, { debt: d, amount, accountId, at: when, interest }));
      } else {
        let left = amount;
        const allocations = open.map((d) => {
          const take = Math.min(left, debtRemaining(l, d));
          left -= take;
          return { debt: d, amount: take };
        });
        await save(debtPaymentMulti(c, { dir, allocations, accountId, at: when }));
      }
      toast('Pembayaran berhasil dicatat.');
      setPaying(false);
      setAmount(0);
      setInterest(0);
    } finally {
      setBusy(false);
    }
  };

  const doWriteOff = async () => {
    const c = ctx();
    await save(...open.map((d) => writeOff(c, d, debtRemaining(l, d))));
    toast('Sisa tagihan telah diikhlaskan.');
    setWritingOff(false);
  };

  const savePhone = async () => {
    if (!contact) return;
    const clean = normalizePhone(phone);
    await save({ ...contact, phone: clean || undefined, updatedAt: Date.now() });
    setEditingPhone(false);
    toast('Nomor WhatsApp diperbarui.');
  };

  const saveDue = async () => {
    if (!editDue) return;
    await save({ ...editDue, dueDate: dueValue || undefined, updatedAt: Date.now() });
    setEditDue(null);
    toast('Jatuh tempo diperbarui.');
  };

  if (!contact) return <Empty>Kontak tidak ditemukan.</Empty>;

  return (
    <div class="stack">
      <div class="card stack">
        <div class="row loose">
          <span class="avatar lg" aria-hidden="true">
            {contact.name.slice(0, 1).toUpperCase()}
          </span>
          <div class="grow">
            <div class="metric-label">{dir === 'recv' ? 'Piutang pelanggan' : dir === 'pay' ? 'Utang ke supplier' : 'Pinjaman modal'}</div>
            <h2 class="ellipsis">{contact.name}</h2>
          </div>
          {props.onClose && (
            <button class="icon-btn" aria-label="Tutup" onClick={props.onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div class="tile">
          <span class="metric-label">Sisa belum lunas</span>
          <span class="metric-lg">
            <Money v={remaining} />
          </span>
        </div>

        <div class="row between">
          <span class="small muted row tight">
            <Phone size={14} aria-hidden="true" />
            {contact.phone ? displayPhone(contact.phone) : 'Belum ada nomor WhatsApp'}
          </span>
          <button class="btn small ghost" onClick={() => setEditingPhone(true)}>
            {contact.phone ? 'Ubah' : 'Tambah nomor'}
          </button>
        </div>

        {remaining > 0 && (
          <div class={dir === 'recv' ? 'btn-pair' : 'stack'}>
            <button
              class="btn green"
              onClick={() => {
                setAmount(dir === 'loan' ? 0 : remaining);
                setPaying(true);
              }}
            >
              <Check size={16} aria-hidden="true" />
              {dir === 'recv' ? 'Terima bayaran' : 'Catat bayar'}
            </button>
            {dir === 'recv' && (
              <a class="btn" href={waLink(contact.phone, waText)} target="_blank" rel="noopener">
                <MessageSquare size={16} aria-hidden="true" />
                Tagih via WA
              </a>
            )}
          </div>
        )}
      </div>

      {open.length > 0 && (
        <div class="card flush">
          <div class="card-head">
            <h3>Belum lunas</h3>
          </div>
          <div class="list">
            {open.map((d) => (
              <div class="item static" key={d.id}>
                <div class="grow">
                  <div class="item-title">Sejak {fmtDate(new Date(d.createdAt).toISOString().slice(0, 10))}</div>
                  <div class="item-sub">{d.dueDate ? `Jatuh tempo ${fmtDate(d.dueDate)}` : 'Tanpa jatuh tempo'}</div>
                </div>
                <div class="stack tight end">
                  <span class="item-value">
                    <Money v={debtRemaining(l, d)} />
                  </span>
                  <button class="btn small ghost" onClick={() => (setEditDue(d), setDueValue(d.dueDate ?? ''))}>
                    Atur tempo
                  </button>
                </div>
              </div>
            ))}
          </div>
          {owner && remaining > 0 && (
            <div class="card-pad">
              <button class="btn small ghost danger-text" onClick={() => setWritingOff(true)}>
                {dir === 'recv' ? 'Ikhlaskan sisa piutang' : 'Bebaskan utang ini'}
              </button>
            </div>
          )}
        </div>
      )}

      <div class="card flush">
        <div class="card-head">
          <h3>Riwayat</h3>
        </div>
        {history.length === 0 ? (
          <Empty>Belum ada riwayat pembayaran untuk kontak ini.</Empty>
        ) : (
          <div class="list with-icons">
            {history.map((e) => (
              <EntryRow e={e} key={e.id} showDate />
            ))}
          </div>
        )}
      </div>

      {paying && (
        <Sheet title={dir === 'recv' ? 'Terima bayaran pelanggan' : 'Catat pembayaran utang'} onClose={() => setPaying(false)}>
          <MoneyInput label="Nominal yang dibayar" value={amount} onChange={setAmount} autoFocus />
          {dir === 'loan' && <MoneyInput label="Termasuk bunga (opsional)" value={interest} onChange={setInterest} hint="Bunga dihitung sebagai biaya usaha." />}
          <label class="field">
            {dir === 'recv' ? 'Masuk ke akun' : 'Dibayar dari akun'}
            <select class="input" value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>
              {accs.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            Waktu pembayaran
            <input class="input" type="datetime-local" value={at} onInput={(e) => setAt(e.currentTarget.value)} />
          </label>
          <button class="btn green block large" disabled={!amount || busy} onClick={pay}>
            {busy ? 'Menyimpan…' : `Simpan${amount ? ` ${rp(amount)}` : ''}`}
          </button>
        </Sheet>
      )}

      {editingPhone && (
        <Sheet title="Nomor WhatsApp" onClose={() => setEditingPhone(false)}>
          <label class="field">
            Diawali 08 atau 62
            <input class="input" inputMode="tel" value={phone} placeholder="08xxxxxxxxxx" onInput={(e) => setPhone(e.currentTarget.value)} autoFocus />
          </label>
          <button class="btn primary block large" onClick={savePhone}>
            Simpan nomor
          </button>
        </Sheet>
      )}

      {editDue && (
        <Sheet title="Atur jatuh tempo" onClose={() => setEditDue(null)}>
          <label class="field">
            Tanggal jatuh tempo (kosongkan jika tanpa tempo)
            <input class="input" type="date" value={dueValue} onInput={(e) => setDueValue(e.currentTarget.value)} />
          </label>
          <button class="btn primary block large" onClick={saveDue}>
            Simpan tanggal
          </button>
        </Sheet>
      )}

      {writingOff && (
        <Sheet title="Ikhlaskan sisa piutang?" onClose={() => setWritingOff(false)}>
          <p class="small">
            Sisa tagihan <b>{rp(remaining)}</b> akan dicatat sebagai beban usaha dan ditutup dari daftar piutang aktif.
          </p>
          <button class="btn red block large" onClick={doWriteOff}>
            Ya, ikhlaskan sisa
          </button>
        </Sheet>
      )}
    </div>
  );
}

export function ContactDebts(props: { contactId: string }) {
  const q = query(route.value);
  const dir = (q.get('dir') as DebtDir) ?? 'recv';
  const contact = contactById.value.get(props.contactId);
  const title = dir === 'recv' ? 'Piutang' : dir === 'pay' ? 'Utang' : 'Pinjaman';

  return (
    <div>
      <TopBar title={contact?.name ?? title} backTo={`/debts?tab=${dir}`} />
      <div class="page detail">
        <ContactDebtsContent contactId={props.contactId} dir={dir} />
      </div>
    </div>
  );
}
