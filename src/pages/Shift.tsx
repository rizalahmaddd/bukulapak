import { useState } from 'preact/hooks';
import type { Shift } from '../domain/types';
import { accountBalance, adjust, cashDiff } from '../domain/ledger';
import { fmtDateTime, rp, ulid } from '../domain/util';
import { shiftRows } from '../domain/reports';
import { ctx, entries, ledger, liveAccounts, openShift, save, shifts, tz, userName, categories } from '../store/data';
import { meta } from '../store/meta';
import { Empty, Money, MoneyInput, TopBar, toast } from '../ui/kit';
import { go } from '../ui/router';
import { CheckCircle2, ChevronRight } from 'lucide-preact';

const DENOMS = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000];

export function ShiftPage() {
  const shift = openShift.value;
  const accs = liveAccounts.value;
  const cash = accs.find((a) => a.kind === 'cash');
  const bank = accs.find((a) => a.kind === 'bank');
  const l = ledger.value;
  const zone = tz.value;
  const expected = cash ? accountBalance(l, cash.id) : 0;
  const [count, setCount] = useState(0);
  const [counted, setCounted] = useState(false);
  const [showDenoms, setShowDenoms] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, number>>({});
  const [coinCount, setCoinCount] = useState(0);
  const [diffMode, setDiffMode] = useState<'personal' | 'diff'>('diff');
  const [keep, setKeep] = useState(0);
  const [closed, setClosed] = useState<Shift | null>(null);
  const [busy, setBusy] = useState(false);

  if (!cash)
    return (
      <div>
        <TopBar title="Kasir" backTo="/" />
        <div class="page">
          <div class="card">
            <Empty>Belum ada akun tunai (laci kasir). Tambahkan di Pengaturan → Akun Uang.</Empty>
          </div>
        </div>
      </div>
    );

  const diff = count - expected;

  const updateDenom = (denom: number, qty: number) => {
    const updated = { ...denomCounts, [denom]: Math.max(0, qty) };
    setDenomCounts(updated);
    let total = coinCount;
    for (const d of DENOMS) {
      total += (updated[d] || 0) * d;
    }
    setCount(total);
    setCounted(true);
  };

  const updateCoin = (val: number) => {
    setCoinCount(val);
    let total = val;
    for (const d of DENOMS) {
      total += (denomCounts[d] || 0) * d;
    }
    setCount(total);
    setCounted(true);
  };

  const open = async () => {
    setBusy(true);
    try {
      const c = ctx();
      const s: Shift = { id: ulid(), type: 'shift', device: meta.value.deviceId, by: userName(), openedAt: c.now, openingCount: count, updatedAt: c.now };
      const recs = [];
      if (diff !== 0) {
        const withShift = { ...c, shiftId: s.id };
        recs.push(
          diffMode === 'personal' && diff > 0
            ? adjust(withShift, cash.id, diff, 'Tambahan modal kembalian dari uang pribadi')
            : cashDiff(withShift, cash.id, diff, 'Selisih saat buka kasir'),
        );
      }
      await save(s, ...recs);
      toast('Shift kasir berhasil dibuka.');
      go('/', true);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!shift) return;
    setBusy(true);
    try {
      const c = ctx();
      const recs = [];
      if (diff !== 0) recs.push(cashDiff(c, cash.id, diff, `Selisih tutup kasir (${shift.by})`));
      const done: Shift = { ...shift, closedAt: c.now, closingCount: count, expected, diff };
      await save(...recs, done);
      setClosed(done);
      setKeep(Math.min(count, shift.openingCount));
      toast(diff === 0 ? 'Kasir ditutup, uang pas!' : `Kasir ditutup, selisih ${rp(diff)}`);
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    const cd = closed.diff ?? 0;
    return (
      <div>
        <TopBar title="Kasir Ditutup" backTo="/" />
        <div class="page cols-2">
          <div class="card stack main-col">
            <div class="row loose">
              <span class={`set-icon ${cd === 0 ? 'green' : 'orange'}`} aria-hidden="true">
                <CheckCircle2 size={18} />
              </span>
              <h2>{cd === 0 ? 'Uang pas, kasir ditutup' : 'Kasir ditutup'}</h2>
            </div>
            <div class="kv">
              <div>
                <span>Uang fisik dihitung</span>
                <b>{rp(closed.closingCount ?? 0)}</b>
              </div>
              <div>
                <span>Seharusnya di sistem</span>
                <span>{rp(closed.expected ?? 0)}</span>
              </div>
              <div class="total">
                <span>Selisih kas</span>
                <Money v={cd} sign />
              </div>
            </div>
          </div>

          {bank && (
            <div class="card form-section">
              <div>
                <h3>Setor tunai ke bank?</h3>
                <p class="small muted">Pindahkan sebagian hasil jualan tunai ke rekening supaya lebih aman.</p>
              </div>
              <MoneyInput label="Sisakan di laci untuk modal kembalian besok" value={keep} onChange={(v) => setKeep(Math.min(v, closed.closingCount ?? 0))} />
              <button
                class="btn green block"
                disabled={(closed.closingCount ?? 0) - keep <= 0}
                onClick={() => go(`/tx/transfer?from=${cash.id}&to=${bank.id}&amount=${(closed.closingCount ?? 0) - keep}`, true)}
              >
                Setor {rp((closed.closingCount ?? 0) - keep)} ke {bank.name}
              </button>
            </div>
          )}

          <a class="btn block" href="#/">
            Kembali ke Beranda
          </a>
        </div>
      </div>
    );
  }

  const salesIds = new Set(categories.value.filter((c) => c.kind === 'income').map((c) => c.id));
  const current = shift ? shiftRows([shift], entries.value, new Set([cash.id]), salesIds)[0] : null;
  const recent = shiftRows(
    shifts.value.filter((s) => s.closedAt),
    entries.value,
    new Set([cash.id]),
    salesIds,
  ).slice(0, 5);

  return (
    <div>
      <TopBar title={shift ? 'Tutup Kasir' : 'Buka Kasir'} backTo="/" />
      <div class="page cols-2">
        {shift && current && (
          <div class="card stack">
            <div class="card-head">
              <div>
                <div class="metric-label">Shift aktif</div>
                <h3>Dibuka oleh {shift.by}</h3>
              </div>
              <span class="badge blue">{fmtDateTime(shift.openedAt, zone)}</span>
            </div>
            <div class="kv">
              <div>
                <span>Modal kembalian awal</span>
                <span>{rp(shift.openingCount)}</span>
              </div>
              <div>
                <span>Tunai masuk</span>
                <span class="pos">+{rp(current.cashIn)}</span>
              </div>
              <div>
                <span>Tunai keluar</span>
                <span class="neg">−{rp(current.cashOut)}</span>
              </div>
            </div>
          </div>
        )}

        <div class="card form-section main-col">
          <h3>{shift ? 'Hitung uang fisik di laci' : 'Hitung modal kembalian di laci'}</h3>
          <MoneyInput
            label="Total uang dihitung"
            value={count}
            autoFocus
            onChange={(v) => {
              setCount(v);
              setCounted(true);
            }}
          />

          <button type="button" class={`disclosure ${showDenoms ? 'open' : ''}`} aria-expanded={showDenoms} onClick={() => setShowDenoms(!showDenoms)}>
            <span>Hitung per pecahan uang</span>
            <ChevronRight size={18} class="chev" aria-hidden="true" />
          </button>

          {showDenoms && (
            <div class="denoms">
              {DENOMS.map((d) => (
                <label class="denom" key={d}>
                  Rp{d.toLocaleString('id-ID')}
                  <input
                    type="number"
                    class="input tabular-nums"
                    inputMode="numeric"
                    placeholder="0 lembar"
                    min="0"
                    value={denomCounts[d] || ''}
                    onInput={(e) => updateDenom(d, Number(e.currentTarget.value) || 0)}
                  />
                </label>
              ))}
              <label class="denom">
                Total koin (Rp)
                <input
                  type="number"
                  class="input tabular-nums"
                  inputMode="numeric"
                  placeholder="0"
                  min="0"
                  value={coinCount || ''}
                  onInput={(e) => updateCoin(Number(e.currentTarget.value) || 0)}
                />
              </label>
            </div>
          )}

          {counted && (
            <div class={`banner soft ${diff === 0 ? 'green' : diff > 0 ? 'blue' : 'amber'}`}>
              {diff === 0 && <CheckCircle2 size={18} aria-hidden="true" />}
              <div class="grow">
                Seharusnya di sistem <b>{rp(expected)}</b>.{' '}
                {diff === 0 ? 'Uang pas.' : diff > 0 ? <>Uang fisik <b>lebih {rp(diff)}</b>.</> : <>Uang fisik <b>kurang {rp(-diff)}</b>.</>}
              </div>
            </div>
          )}

          {!shift && counted && diff > 0 && (
            <div class="stack tight">
              <button class={`chip option ${diffMode === 'personal' ? 'on' : ''}`} onClick={() => setDiffMode('personal')}>
                Ada tambahan dari uang pribadi
              </button>
              <button class={`chip option ${diffMode === 'diff' ? 'on' : ''}`} onClick={() => setDiffMode('diff')}>
                Catat sebagai selisih kasir
              </button>
            </div>
          )}

          {counted && diff !== 0 && (shift || diffMode === 'diff' || diff < 0) && (
            <div class="hint">Selisih otomatis dicatat ke kategori “Selisih Kas” atas nama kasir {shift?.by ?? userName()}.</div>
          )}

          <button class={`btn block large ${shift ? 'red' : 'green'}`} disabled={!counted || busy} onClick={shift ? close : open}>
            {busy ? 'Memproses…' : shift ? 'Tutup kasir' : 'Buka kasir'}
          </button>
        </div>

        {!shift && recent.length === 0 && (
          <div class="card stack">
            <h3>Cara kerja kasir</h3>
            <ol class="howto small">
              <li>Saat buka, hitung uang kembalian di laci lalu simpan.</li>
              <li>Catat semua transaksi seperti biasa selama shift.</li>
              <li>Saat tutup, hitung lagi uang fisik. Selisihnya dicatat otomatis.</li>
            </ol>
          </div>
        )}

        {recent.length > 0 && (
          <div class="card flush">
            <div class="card-head">
              <h3>Shift sebelumnya</h3>
            </div>
            <div class="list">
              {recent.map((r) => (
                <div class="item static" key={r.shift.id}>
                  <div class="grow">
                    <div class="item-title">{fmtDateTime(r.shift.openedAt, zone)}</div>
                    <div class="item-sub">Kasir: {r.shift.by}</div>
                  </div>
                  <span class="item-value">
                    <Money v={r.shift.diff ?? 0} sign />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
