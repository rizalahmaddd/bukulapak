import { useState } from 'preact/hooks';
import { accountBalance, transfer } from '../domain/ledger';
import { fromLocalInput, rp, toLocalInput } from '../domain/util';
import { ctx, isOwner, ledger, liveAccounts, save, tz } from '../store/data';
import { MoneyInput, TopBar, toast } from '../ui/kit';
import { go, query, route } from '../ui/router';
import { ArrowUpDown, Info } from 'lucide-preact';

export function TransferForm() {
  const q = query(route.value);
  const accs = liveAccounts.value;
  const owner = isOwner.value;
  const l = ledger.value;
  const zone = tz.value;
  const qrisAcc = accs.find((a) => a.kind === 'qris');
  const bankAcc = accs.find((a) => a.kind === 'bank');
  const cashAcc = accs.find((a) => a.kind === 'cash');
  const initialFrom = q.get('from') ?? cashAcc?.id ?? accs[0]?.id ?? '';
  const settle = q.get('settle') === '1';
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(q.get('to') ?? (initialFrom === bankAcc?.id ? cashAcc?.id : bankAcc?.id) ?? '');
  const [amount, setAmount] = useState(Number(q.get('amount')) || (settle && qrisAcc ? Math.max(0, accountBalance(l, qrisAcc.id)) : 0));
  const [fee, setFee] = useState(0);
  const [note, setNote] = useState('');
  const [initialAt] = useState(() => toLocalInput(Date.now(), zone));
  const [at, setAt] = useState(initialAt);
  const [busy, setBusy] = useState(false);

  const presets = [
    cashAcc && bankAcc && { label: 'Setor tunai ke bank', from: cashAcc.id, to: bankAcc.id },
    bankAcc && cashAcc && { label: 'Tarik dari bank / ATM', from: bankAcc.id, to: cashAcc.id },
    qrisAcc && bankAcc && { label: 'Pencairan QRIS ke bank', from: qrisAcc.id, to: bankAcc.id, fill: true },
  ].filter(Boolean) as { label: string; from: string; to: string; fill?: boolean }[];

  const problem = !amount ? 'Isi nominal.' : !from || !to ? 'Pilih akun asal & tujuan.' : from === to ? 'Akun asal dan tujuan harus beda.' : null;
  const fromBal = accountBalance(l, from);

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      await save(transfer(ctx(), { from, to, amount, fee, at: at === initialAt ? Date.now() : fromLocalInput(at, zone), note: note.trim() }));
      toast('Pindah uang tersimpan');
      go('/', true);
    } catch {
      toast('Gagal menyimpan.');
      setBusy(false);
    }
  };

  return (
    <div>
      <TopBar title="Pindah Saldo" />
      <div class="page">
        {presets.length > 0 && (
          <div class="stack tight">
            <div class="group-label">Pilihan cepat</div>
            <div class="chips scroll">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  class={`chip ${from === p.from && to === p.to ? 'on' : ''}`}
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                    if (p.fill) setAmount(Math.max(0, accountBalance(l, p.from)));
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div class="form-grid even">
          <div class="card form-section">
            <div class="transfer-pair">
              <label class="field">
                Dari
                <select class="input" value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
                  {accs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {owner ? `${a.name} (${rp(accountBalance(l, a.id))})` : a.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                class="icon-btn swap"
                aria-label="Tukar asal dan tujuan"
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
              >
                <ArrowUpDown size={16} aria-hidden="true" />
              </button>
              <label class="field">
                Ke
                <select class="input" value={to} onChange={(e) => setTo(e.currentTarget.value)}>
                  {accs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <MoneyInput label="Nominal" value={amount} onChange={setAmount} autoFocus={!amount} hint={owner && amount > fromBal ? `Saldo ${rp(fromBal)} di aplikasi lebih kecil. Tetap boleh disimpan.` : undefined} />
            <MoneyInput label="Biaya admin / transfer (opsional)" value={fee} onChange={setFee} hint="Dicatat sebagai biaya usaha." />
          </div>
          <div class="stack">
            <div class="card form-section">
              <label class="field">
                Catatan
                <input class="input" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
              </label>
              <label class="field">
                Tanggal & jam
                <input class="input" type="datetime-local" value={at} onInput={(e) => setAt(e.currentTarget.value)} />
              </label>
            </div>
            <div class="hint with-icon">
              <Info size={15} aria-hidden="true" />
              <span>Pindah saldo tidak memengaruhi untung/rugi, hanya memindahkan posisi uang.</span>
            </div>
            <div class="save-bar">
              {problem && amount > 0 && <div class="error-text">{problem}</div>}
              <button class="btn primary block large" disabled={!!problem || busy} onClick={submit}>
                {busy ? 'Menyimpan…' : `Simpan${amount ? ` ${rp(amount)}` : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
