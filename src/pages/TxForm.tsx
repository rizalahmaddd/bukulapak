import { useMemo, useState } from 'preact/hooks';
import type { Category, Debt, Dir, Entry, Order } from '../domain/types';
import { debtRemaining, mdrFee, moneyIn, moneyOut, voidEntry } from '../domain/ledger';
import { fmtDate, fromLocalInput, rp, toLocalInput, ulid, dayKey } from '../domain/util';
import { accById, categories, contactById, ctx, debts, entries, isOwner, ledger, liveAccounts, save, settings, shifts, tz } from '../store/data';
import { AmountPad, ContactPicker, MoneyInput, TopBar, ask, resolveContact, toast } from '../ui/kit';
import { go, query, route } from '../ui/router';
import { ChevronRight } from 'lucide-preact';

type Pay = string | 'credit' | 'personal';

function usageOrder(dir: Dir): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries.value.slice(-300)) {
    if (e.catId && (e.kind === 'in' || e.kind === 'out' || e.kind === 'dp' || e.kind === 'loan_pay')) counts.set(e.catId, (counts.get(e.catId) ?? 0) + 1);
  }
  for (const c of categories.value) if (c.dir === dir && c.sys === 'sales') counts.set(c.id, (counts.get(c.id) ?? 0) + 0.5);
  return counts;
}

export function TxForm(props: { dir: Dir }) {
  const q = query(route.value);
  const editId = q.get('edit');
  const original = editId ? ledger.value.byId.get(editId) : undefined;
  const zone = tz.value;
  const s = settings.value!;
  const owner = isOwner.value;
  const dir = props.dir;

  const cats = useMemo(() => {
    const usage = usageOrder(dir);
    return categories.value
      .filter((c) => c.dir === dir && !c.hidden && !c.archived)
      .filter((c) => c.kind !== 'deposit' || s.ordersEnabled)
      .filter((c) => owner || c.kind === 'income' || c.kind === 'expense' || c.kind === 'deposit')
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0));
  }, [dir]);

  const accs = liveAccounts.value;
  const cashAcc = accs.find((a) => a.kind === 'cash') ?? accs[0];
  const [amount, setAmount] = useState(original?.amount ?? 0);
  const [catId, setCatId] = useState<string>(original?.catId ?? q.get('cat') ?? cats[0]?.id ?? '');
  const [showAllCats, setShowAllCats] = useState(false);
  const [pay, setPay] = useState<Pay>(original?.accountId ?? q.get('pay') ?? cashAcc?.id ?? 'credit');
  const [partial, setPartial] = useState(false);
  const [paidNow, setPaidNow] = useState(0);
  const [contactId, setContactId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; phone?: string } | undefined>();
  const [due, setDue] = useState('');
  const [note, setNote] = useState(original?.note ?? q.get('note') ?? '');
  const [showDetail, setShowDetail] = useState(!!original);
  const [initialAt] = useState(() => toLocalInput(original?.at ?? Date.now(), zone));
  const [at, setAt] = useState(initialAt);
  const [feeOverride, setFeeOverride] = useState<number | null>(null);
  const [orderTotal, setOrderTotal] = useState(0);
  const [pickup, setPickup] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [loanId, setLoanId] = useState('');
  const [interest, setInterest] = useState(0);
  const [busy, setBusy] = useState(false);

  const cat: Category | undefined = categories.value.find((c) => c.id === catId);
  const kind = cat?.kind;
  const allowCredit = kind === 'income' || kind === 'expense' || kind === 'asset';
  const allowPersonal = dir === 'out' && (kind === 'expense' || kind === 'asset' || (kind === 'income' && dir === 'out'));
  const isCredit = allowCredit && (pay === 'credit' || partial);
  const effectivePay = pay === 'credit' && !allowCredit ? cashAcc?.id ?? '' : pay === 'personal' && !allowPersonal ? cashAcc?.id ?? '' : pay;
  const paid = effectivePay === 'credit' ? 0 : partial ? Math.min(paidNow, amount) : amount;
  const qris = accById.value.get(effectivePay)?.kind === 'qris';
  const autoFee = qris && dir === 'in' ? mdrFee(paid, s.mdr) : 0;
  const loans = debts.value.filter((d) => d.dir === 'loan' && debtRemaining(ledger.value, d) > 0);
  const contactRole = kind === 'income' || kind === 'deposit' ? 'customer' : kind === 'loan' ? 'lender' : 'supplier';
  const needsContact = isCredit || kind === 'deposit' || (kind === 'loan' && dir === 'in');
  const atTs = at === initialAt ? original?.at ?? Date.now() : fromLocalInput(at, zone);
  const closedShift = shifts.value.find((sh) => sh.closedAt && atTs >= sh.openedAt && atTs <= sh.closedAt);

  const visibleCats = showAllCats ? cats : cats.slice(0, 6);
  if (cat && !visibleCats.includes(cat)) visibleCats.push(cat);

  const problem = (() => {
    if (!amount) return 'Isi nominal dulu.';
    if (!cat) return 'Pilih kategori.';
    if (needsContact && !contactId && !draft?.name.trim()) return kind === 'deposit' ? 'Isi nama pemesan.' : 'Isi nama orangnya, supaya tahu siapa yang belum bayar.';
    if (kind === 'deposit' && orderTotal && orderTotal < amount) return 'Total pesanan tidak boleh lebih kecil dari DP.';
    if (kind === 'loan' && dir === 'out' && !loanId) return 'Pilih pinjaman yang dibayar.';
    if (kind === 'loan' && dir === 'out' && interest > amount) return 'Bunga tidak boleh lebih besar dari total bayar.';
    if (effectivePay !== 'credit' && effectivePay !== 'personal' && !accById.value.get(effectivePay)) return 'Pilih dibayar pakai apa.';
    return null;
  })();

  const submit = async () => {
    if (problem || busy || !cat) return;
    const dup = entries.value.find(
      (e) => !original && e.catId === cat.id && e.amount === amount && Date.now() - e.createdAt < 60_000 && !ledger.value.voided.has(e.id),
    );
    if (dup && !(await ask({ title: 'Catat lagi?', body: `Barusan sudah ada ${cat.name} ${rp(amount)}. Yakin mau mencatat transaksi yang sama?`, confirm: 'Ya, catat lagi' }))) return;
    setBusy(true);
    try {
      const c = ctx();
      const records: (Entry | Debt | Order)[] = [];
      const cid = needsContact ? await resolveContact(contactId, draft, contactRole) : null;
      let entry: Entry;
      if (dir === 'in') {
        let debtId: string | undefined;
        let orderId: string | undefined;
        if ((kind === 'income' && paid < amount) || kind === 'loan') {
          const d: Debt = { id: ulid(), type: 'debt', contactId: cid!, dir: kind === 'loan' ? 'loan' : 'recv', ...(due ? { dueDate: due } : {}), createdAt: c.now, updatedAt: c.now };
          records.push(d);
          debtId = d.id;
        }
        if (kind === 'deposit') {
          const o: Order = {
            id: ulid(),
            type: 'order',
            contactId: cid!,
            total: Math.max(orderTotal, amount),
            ...(pickup ? { pickupDate: pickup } : {}),
            note: orderNote.trim(),
            status: 'open',
            createdAt: c.now,
            updatedAt: c.now,
          };
          records.push(o);
          orderId = o.id;
        }
        entry = moneyIn(c, {
          cat,
          amount,
          at: atTs,
          accountId: effectivePay === 'credit' ? undefined : effectivePay,
          paid: kind === 'income' ? paid : amount,
          fee: qris && feeOverride !== null ? feeOverride : undefined,
          debtId,
          orderId,
          contactId: cid ?? undefined,
          note: note.trim(),
        });
      } else {
        let debtId: string | undefined = kind === 'loan' ? loanId : undefined;
        if ((kind === 'expense' || kind === 'asset' || kind === 'income') && paid < amount) {
          const d: Debt = { id: ulid(), type: 'debt', contactId: cid!, dir: 'pay', ...(due ? { dueDate: due } : {}), createdAt: c.now, updatedAt: c.now };
          records.push(d);
          debtId = d.id;
        }
        const loan = kind === 'loan' ? debts.value.find((d) => d.id === loanId) : undefined;
        entry = moneyOut(c, {
          cat,
          amount,
          at: atTs,
          source: effectivePay === 'credit' ? undefined : effectivePay,
          paid: kind === 'loan' || kind === 'personal' ? amount : paid,
          interest,
          debtId,
          contactId: cid ?? loan?.contactId,
          note: note.trim(),
        });
      }
      if (original) records.push(voidEntry(c, original, 'Salah input (diubah)'));
      records.push(entry);
      await save(...records);
      toast(original ? 'Perubahan tersimpan' : `Tersimpan: ${cat.name} ${rp(amount)}`);
      go(original ? `/entry/${entry.id}` : '/', true);
    } catch (e) {
      console.error(e);
      toast('Gagal menyimpan, periksa isian.');
      setBusy(false);
    }
  };

  const loanRemaining = (d: Debt) => debtRemaining(ledger.value, d);

  const kindHint =
    kind === 'personal'
      ? 'Tidak memengaruhi laba/rugi usaha, hanya mengubah saldo kas/rekening.'
      : kind === 'loan'
        ? 'Pinjaman bukan pendapatan. Hanya bunganya yang dihitung beban usaha.'
        : kind === 'asset'
          ? 'Pembelian alat/aset modal tidak memotong laba operasional bulan ini.'
          : kind === 'deposit'
            ? 'DP disimpan sebagai titipan sampai pesanan pelanggan diselesaikan.'
            : null;

  return (
    <div>
      <TopBar title={original ? 'Ubah Transaksi' : dir === 'in' ? 'Uang Masuk' : 'Uang Keluar'} />
      <div class="page">
        {q.get('first') && (
          <div class="banner soft green">Siap! Coba catat transaksi pertamamu. Isi nominal, pilih kategori, lalu Simpan.</div>
        )}
        {original && <div class="banner soft blue">Transaksi lama akan ditandai batal (tetap terlihat di riwayat) dan diganti yang baru.</div>}

        <div class="form-grid">
          <div class="card">
            <AmountPad
              value={amount}
              onChange={setAmount}
              label={kind === 'deposit' ? 'DP yang diterima' : kind === 'loan' && dir === 'out' ? 'Total yang dibayar' : dir === 'in' ? 'Nominal uang masuk' : 'Nominal uang keluar'}
            />
          </div>

          <div class="stack">
            <div class="card stack">
              <div class="eyebrow">Kategori</div>
              <div class="chips">
                {visibleCats.map((c) => (
                  <button key={c.id} type="button" class={`chip ${catId === c.id ? `on ${dir === 'in' ? 'green' : 'red'}` : ''}`} onClick={() => setCatId(c.id)}>
                    {c.name}
                  </button>
                ))}
                {cats.length > 6 && (
                  <button type="button" class="chip" onClick={() => setShowAllCats(!showAllCats)}>
                    {showAllCats ? 'Lebih sedikit' : 'Lainnya…'}
                  </button>
                )}
              </div>
              {kindHint && <div class="hint">{kindHint}</div>}
            </div>

            {kind === 'deposit' && (
              <div class="card form-section">
                <ContactPicker role="customer" label="Nama pemesan" value={contactId} draft={draft} onChange={(id, d) => (setContactId(id), setDraft(d))} />
                <MoneyInput label="Total harga pesanan" value={orderTotal} onChange={setOrderTotal} hint={orderTotal > amount ? `Sisa yang belum dibayar: ${rp(orderTotal - amount)}` : undefined} />
                <label class="field">
                  Rincian pesanan
                  <input class="input" value={orderNote} placeholder="cth. 50 nasi kotak ayam bakar" onInput={(e) => setOrderNote(e.currentTarget.value)} />
                </label>
                <label class="field">
                  Tanggal diambil (opsional)
                  <input class="input" type="date" value={pickup} onInput={(e) => setPickup(e.currentTarget.value)} />
                </label>
              </div>
            )}

            {kind === 'loan' && dir === 'out' && (
              <div class="card form-section">
                <div class="eyebrow">Pinjaman yang dibayar</div>
                {loans.length === 0 ? (
                  <div class="small muted">Belum ada pinjaman tercatat. Catat dulu lewat Uang Masuk → Terima Pinjaman.</div>
                ) : (
                  <div class="stack tight">
                    {loans.map((d) => (
                      <button key={d.id} type="button" class={`chip option ${loanId === d.id ? 'on' : ''}`} onClick={() => setLoanId(d.id)}>
                        <span class="grow">{contactById.value.get(d.contactId)?.name ?? 'Pinjaman'}</span>
                        <span class="tabular-nums">sisa {rp(loanRemaining(d))}</span>
                      </button>
                    ))}
                  </div>
                )}
                <MoneyInput label="Termasuk bunga (opsional)" value={interest} onChange={setInterest} hint="Bunga dihitung sebagai biaya; sisanya mengurangi pokok pinjaman." />
              </div>
            )}

            {kind === 'loan' && dir === 'in' && (
              <div class="card form-section">
                <ContactPicker role="lender" label="Pinjam dari siapa?" value={contactId} draft={draft} onChange={(id, d) => (setContactId(id), setDraft(d))} />
                <label class="field">
                  Jatuh tempo (opsional)
                  <input class="input" type="date" value={due} onInput={(e) => setDue(e.currentTarget.value)} />
                </label>
              </div>
            )}

            <div class="card form-section">
              <div class="eyebrow">{dir === 'in' ? 'Diterima lewat' : 'Dibayar dari'}</div>
              <div class="chips">
                {accs.map((a) => (
                  <button key={a.id} type="button" class={`chip ${effectivePay === a.id ? 'on' : ''}`} onClick={() => setPay(a.id)}>
                    {a.name}
                  </button>
                ))}
                {allowPersonal && (
                  <button type="button" class={`chip ${effectivePay === 'personal' ? 'on' : ''}`} onClick={() => (setPay('personal'), setPartial(false))}>
                    Uang pribadi
                  </button>
                )}
                {allowCredit && (
                  <button type="button" class={`chip ${effectivePay === 'credit' ? 'on' : ''}`} onClick={() => (setPay('credit'), setPartial(false))}>
                    Belum dibayar (tempo)
                  </button>
                )}
              </div>
              {effectivePay === 'personal' && <div class="hint">Tetap dihitung biaya usaha, tapi saldo laci/rekening tidak berkurang.</div>}
              {qris && dir === 'in' && (
                <div class="hint">
                  Potongan QRIS {s.mdr}%: {rp(feeOverride ?? autoFee)} · Masuk bersih {rp(paid - (feeOverride ?? autoFee))}
                </div>
              )}
              {allowCredit && effectivePay !== 'credit' && amount > 0 && (
                <label class="check-row">
                  <span class="grow">Baru dibayar sebagian (DP/cicilan)</span>
                  <input type="checkbox" class="switch" checked={partial} onChange={(e) => setPartial(e.currentTarget.checked)} />
                </label>
              )}
              {partial && effectivePay !== 'credit' && (
                <MoneyInput
                  label="Nominal dibayar sekarang"
                  value={paidNow}
                  onChange={setPaidNow}
                  hint={amount > paidNow ? `Sisa ${rp(amount - Math.min(paidNow, amount))} dicatat sebagai ${dir === 'in' ? 'piutang' : 'utang'}` : undefined}
                />
              )}
              {isCredit && (
                <>
                  <ContactPicker
                    role={contactRole}
                    label={dir === 'in' ? 'Nama pelanggan (yang belum bayar)' : 'Nama supplier (utang ke siapa)'}
                    value={contactId}
                    draft={draft}
                    onChange={(id, d) => (setContactId(id), setDraft(d))}
                  />
                  <label class="field">
                    Batas jatuh tempo
                    <input class="input" type="date" value={due} onInput={(e) => setDue(e.currentTarget.value)} />
                  </label>
                </>
              )}
            </div>

            <div class="card form-section">
              <button type="button" class={`disclosure ${showDetail ? 'open' : ''}`} aria-expanded={showDetail} onClick={() => setShowDetail(!showDetail)}>
                <span>Catatan & waktu</span>
                {!showDetail && note && <span class="small muted ellipsis disclosure-peek">{note}</span>}
                <ChevronRight size={18} class="chev" aria-hidden="true" />
              </button>
              {showDetail && (
                <>
                  <label class="field">
                    Catatan
                    <input class="input" value={note} maxLength={200} placeholder="cth. tambah es, nomor meja" onInput={(e) => setNote(e.currentTarget.value)} />
                  </label>
                  <label class="field">
                    Tanggal & jam
                    <input class="input" type="datetime-local" value={at} onInput={(e) => setAt(e.currentTarget.value)} />
                  </label>
                  {Math.abs(atTs - Date.now()) > 10 * 60_000 && <div class="hint">Dicatat susulan untuk {fmtDate(dayKey(atTs, zone))}. Waktu input asli tetap tersimpan.</div>}
                  {closedShift && <div class="banner soft amber">Waktu ini masuk ke shift kasir yang sudah ditutup.</div>}
                  {qris && dir === 'in' && (
                    <MoneyInput
                      label="Potongan QRIS sebenarnya"
                      value={feeOverride ?? autoFee}
                      onChange={(v) => setFeeOverride(v)}
                      hint="Dihitung otomatis dari persentase MDR di Pengaturan."
                    />
                  )}
                </>
              )}
            </div>

            <div class="save-bar">
              {problem && amount > 0 && <div class="error-text">{problem}</div>}
              <button class={`btn block large ${dir === 'in' ? 'green' : 'red'}`} disabled={!!problem || busy} onClick={submit}>
                {busy ? 'Menyimpan…' : `Simpan${amount ? ` ${rp(amount)}` : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
