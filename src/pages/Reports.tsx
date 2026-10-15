import { useState } from 'preact/hooks';
import { BUCKET_LABEL, cashflow, dayRange, debtRows, monthly, profit, shiftRows, todayKey, type Range } from '../domain/reports';
import { addDays, dayStart, fmtDate, fmtDateTime, fmtMonth, monthStart, nextMonth, weekStart } from '../domain/util';
import { catById, categories, contactById, debts, entries, ledger, liveAccounts, settings, shifts, tz } from '../store/data';
import { activeWs, updateMeta } from '../store/meta';
import { Money, Segmented, Sheet, TopBar } from '../ui/kit';
import { describe } from '../ui/describe';
import { go } from '../ui/router';
import type { ExportInput } from '../export/report';
import { Download, FileSpreadsheet, Info, Printer } from 'lucide-preact';

type Tab = 'profit' | 'flow' | 'debts' | 'shift' | 'monthly';
type Period = 'today' | 'week' | 'month' | 'lastmonth' | 'custom';

export function Reports() {
  const zone = tz.value;
  const today = todayKey(zone);
  const s = settings.value!;
  const [tab, setTab] = useState<Tab>('profit');
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [askSignup, setAskSignup] = useState<null | (() => void)>(null);

  let range: Range;
  let label: string;
  if (period === 'today') {
    range = dayRange(today, zone);
    label = fmtDate(today, true);
  } else if (period === 'week') {
    const w = weekStart(today);
    range = { from: dayStart(w, zone), to: dayStart(addDays(w, 7), zone) };
    label = `${fmtDate(w)} – ${fmtDate(addDays(w, 6))}`;
  } else if (period === 'month') {
    const m = monthStart(today);
    range = { from: dayStart(m, zone), to: dayStart(nextMonth(m), zone) };
    label = fmtMonth(m);
  } else if (period === 'lastmonth') {
    const m = monthStart(addDays(monthStart(today), -1));
    range = { from: dayStart(m, zone), to: dayStart(nextMonth(m), zone) };
    label = fmtMonth(m);
  } else {
    const a = from <= to ? from : to;
    const b = from <= to ? to : from;
    range = { from: dayStart(a, zone), to: dayStart(addDays(b, 1), zone) };
    label = `${fmtDate(a)} – ${fmtDate(b)}`;
  }

  const exportInput = (): ExportInput => ({
    settings: s,
    entries: entries.value,
    accounts: liveAccounts.value,
    cats: catById.value,
    contacts: contactById.value,
    debts: debts.value,
    ledger: ledger.value,
    range,
    rangeLabel: label,
    todayKey: today,
    describe,
  });

  const guarded = (fn: () => void) => () => {
    if (activeWs()?.role === 'guest') setAskSignup(() => fn);
    else fn();
    updateMeta((m) => {
      m.exportReminderAt = Date.now();
    });
  };

  const doExcel = guarded(async () => (await import('../export/report')).exportExcel(exportInput()));
  const doCsv = guarded(async () => (await import('../export/report')).exportAllCsv(exportInput()));
  const doPrint = guarded(() => setTimeout(() => window.print(), 50));

  const tabs = [
    ['profit', 'Untung / Rugi'],
    ['flow', 'Arus Kas'],
    ['debts', 'Umur Utang'],
    ['monthly', 'Bulanan'],
    ...(s.shiftEnabled || shifts.value.length ? [['shift', 'Shift Kasir']] : []),
  ] as [Tab, string][];

  return (
    <div>
      <TopBar
        title="Laporan"
        backTo={false}
        right={
          <div class="only-wide row no-print">
            <button class="btn small" onClick={doExcel}>
              <FileSpreadsheet size={15} aria-hidden="true" /> Excel
            </button>
            <button class="btn small" onClick={doPrint}>
              <Printer size={15} aria-hidden="true" /> Cetak
            </button>
          </div>
        }
      />
      <div class="page">
        <div class="stack no-print">
          <Segmented label="Jenis laporan" scroll value={tab} onChange={setTab} options={tabs} />
          {(tab === 'profit' || tab === 'flow') && (
            <Segmented
              label="Periode"
              scroll
              value={period}
              onChange={setPeriod}
              options={[
                ['today', 'Hari ini'],
                ['week', 'Minggu ini'],
                ['month', 'Bulan ini'],
                ['lastmonth', 'Bulan lalu'],
                ['custom', 'Pilih tanggal'],
              ]}
            />
          )}
          {period === 'custom' && (tab === 'profit' || tab === 'flow') && (
            <div class="btn-pair">
              <label class="field">
                Dari
                <input class="input" type="date" value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
              </label>
              <label class="field">
                Sampai
                <input class="input" type="date" value={to} onInput={(e) => setTo(e.currentTarget.value)} />
              </label>
            </div>
          )}
        </div>

        <div class="print-only">
          <h1>{s.name}</h1>
          <div>Periode Laporan: {label}</div>
        </div>

        {tab === 'profit' && <ProfitView range={range} label={label} />}
        {tab === 'flow' && <FlowView range={range} label={label} />}
        {tab === 'debts' && <DebtsView />}
        {tab === 'monthly' && <MonthlyView />}
        {tab === 'shift' && <ShiftView />}

        <div class="card stack no-print">
          <div class="row loose">
            <span class="set-icon green" aria-hidden="true">
              <Download size={17} />
            </span>
            <div class="grow">
              <h3>Unduh salinan laporan</h3>
              <p class="small muted">Rapi, siap cetak, atau dilampirkan untuk pengajuan modal/KUR.</p>
            </div>
          </div>
          <div class="btn-pair">
            <button class="btn primary" onClick={doExcel}>
              <FileSpreadsheet size={16} aria-hidden="true" /> Excel (.xlsx)
            </button>
            <button class="btn" onClick={doPrint}>
              <Printer size={16} aria-hidden="true" /> Cetak / PDF
            </button>
          </div>
          <button class="btn small ghost" onClick={doCsv}>
            Unduh arsip mentah CSV (semua transaksi)
          </button>
        </div>
      </div>
      {askSignup && (
        <Sheet title="Simpan juga di cloud?" onClose={() => setAskSignup(null)}>
          <p class="small muted">Biar data aman walau HP hilang atau rusak, simpan juga di cloud. Daftarnya gratis.</p>
          <button class="btn primary block large" onClick={() => (setAskSignup(null), go('/register'))}>
            Daftar gratis
          </button>
          <button
            class="btn block"
            onClick={() => {
              const fn = askSignup;
              setAskSignup(null);
              fn();
            }}
          >
            Lanjut ekspor saja
          </button>
        </Sheet>
      )}
    </div>
  );
}

function ShareRows(props: { rows: { cat: { id: string; name: string }; amount: number }[]; total: number; tone: 'green' | 'red'; empty: string }) {
  if (props.rows.length === 0) return <div class="small muted">{props.empty}</div>;
  return (
    <div class="share-list">
      {props.rows.map((r) => {
        const pct = props.total > 0 ? Math.round((r.amount / props.total) * 100) : 0;
        return (
          <div class="share" key={r.cat.id}>
            <div class="row between">
              <span class="ellipsis">{r.cat.name}</span>
              <span class="tabular-nums bold">
                <Money v={r.amount} /> <span class="muted tiny">{pct}%</span>
              </span>
            </div>
            <div class={`bar ${props.tone === 'red' ? 'red' : ''}`} role="img" aria-label={`${r.cat.name} ${pct}%`}>
              <div style={`width:${Math.max(pct, 1)}%`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfitView(props: { range: Range; label: string }) {
  const p = profit(entries.value, catById.value, props.range);
  return (
    <>
      <div class="card stack">
        <div class="card-head">
          <div class="metric-label">{p.profit >= 0 ? 'Laba bersih' : 'Rugi bersih'}</div>
          <span class="badge">{props.label}</span>
        </div>
        <div class={`metric-hero ${p.profit > 0 ? 'pos' : p.profit < 0 ? 'neg' : ''}`}>
          <Money v={p.profit} sign />
        </div>
        <div class="tiles">
          <div class="tile">
            <span class="metric-label">Pendapatan</span>
            <span class="metric-md pos">
              <Money v={p.totalIncome} />
            </span>
          </div>
          <div class="tile">
            <span class="metric-label">Biaya usaha</span>
            <span class="metric-md neg">
              <Money v={p.totalExpense} />
            </span>
          </div>
        </div>
      </div>

      <div class="report-cols">
        <div class="card stack">
          <h3>Rincian pendapatan</h3>
          <ShareRows rows={p.income} total={p.totalIncome} tone="green" empty="Belum ada pendapatan di periode ini." />
        </div>
        <div class="card stack">
          <h3>Rincian biaya</h3>
          <ShareRows rows={p.expense} total={p.totalExpense} tone="red" empty="Belum ada biaya operasional di periode ini." />
        </div>
      </div>

      <div class="hint with-icon">
        <Info size={15} aria-hidden="true" />
        <span>
          Jualan yang dicatat tempo sudah dihitung dalam laba periode ini. Pengambilan pribadi (prive), setor modal, pinjaman, dan pembelian aset tidak
          mengurangi untung operasional.
        </span>
      </div>
    </>
  );
}

function FlowView(props: { range: Range; label: string }) {
  const rows = cashflow(entries.value, liveAccounts.value, props.range);
  const sum = (k: 'opening' | 'in' | 'out' | 'closing') => rows.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <div class="card stack">
        <div class="card-head">
          <div class="metric-label">Total saldo akhir semua akun</div>
          <span class="badge">{props.label}</span>
        </div>
        <div class="metric-hero">
          <Money v={sum('closing')} />
        </div>
        <div class="tiles">
          <div class="tile">
            <span class="metric-label">Masuk</span>
            <span class="metric-md pos">
              <Money v={sum('in')} />
            </span>
          </div>
          <div class="tile">
            <span class="metric-label">Keluar</span>
            <span class="metric-md neg">
              <Money v={sum('out')} />
            </span>
          </div>
        </div>
      </div>
      <div class="report-cols">
        {rows.map((r) => (
          <div key={r.account.id} class="card stack">
            <h3>{r.account.name}</h3>
            <div class="kv">
              <div>
                <span>Saldo awal</span>
                <Money v={r.opening} />
              </div>
              <div>
                <span>Masuk</span>
                <span class="pos">
                  <Money v={r.in} />
                </span>
              </div>
              <div>
                <span>Keluar</span>
                <span class="neg">
                  <Money v={r.out} />
                </span>
              </div>
              <div class="total">
                <span>Saldo akhir</span>
                <Money v={r.closing} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div class="hint">Pindah uang antar akun ikut terhitung di masing-masing akun.</div>
    </>
  );
}

function formatPlain(v: number) {
  return `Rp${v.toLocaleString('id-ID')}`;
}

function DebtsView() {
  const today = todayKey(tz.value);
  const rows = debtRows(debts.value, ledger.value, entries.value, today);
  const sections: [string, typeof rows][] = [
    ['Pelanggan belum bayar (piutang)', rows.filter((r) => r.debt.dir === 'recv')],
    ['Utang ke supplier', rows.filter((r) => r.debt.dir === 'pay')],
    ['Pinjaman', rows.filter((r) => r.debt.dir === 'loan')],
  ];
  const recv = sections[0][1];
  const buckets = (['none', 'notdue', 'd1_30', 'd30plus'] as const).map((b) => [b, recv.filter((r) => r.bucket === b).reduce((s, r) => s + r.remaining, 0)] as const);
  return (
    <>
      <div class="card stack">
        <h3>Umur piutang</h3>
        <div class="kv">
          {buckets.map(([b, v]) => (
            <div key={b}>
              <span class={b === 'd1_30' || b === 'd30plus' ? 'neg' : ''}>{BUCKET_LABEL[b]}</span>
              <Money v={v} />
            </div>
          ))}
        </div>
      </div>
      <div class="report-cols three">
        {sections.map(([title, list]) => (
          <div class="card stack" key={title}>
            <div class="card-head">
              <h3>{title}</h3>
              <b class="tabular-nums nowrap">
                <Money v={list.reduce((s, r) => s + r.remaining, 0)} />
              </b>
            </div>
            {list.length === 0 ? (
              <div class="small muted">Tidak ada.</div>
            ) : (
              <div class="kv">
                {list.map((r) => (
                  <div key={r.debt.id}>
                    <span>
                      <span class="bold ink">{contactById.value.get(r.debt.contactId)?.name}</span>
                      <div class="tiny">{r.debt.dueDate ? `Jatuh tempo ${fmtDate(r.debt.dueDate)}` : 'Tanpa jatuh tempo'}</div>
                    </span>
                    <Money v={r.remaining} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function MonthlyView() {
  const zone = tz.value;
  const [months, setMonths] = useState(6);
  const rows = monthly(entries.value, catById.value, zone, todayKey(zone), months);
  const s = settings.value!;
  return (
    <div class="card stack">
      <div class="card-head">
        <h3>Ringkasan bulanan</h3>
        <select class="input no-print auto" value={months} onChange={(e) => setMonths(Number(e.currentTarget.value))}>
          <option value={3}>3 bulan</option>
          <option value={6}>6 bulan</option>
          <option value={12}>12 bulan</option>
        </select>
      </div>
      <div class="small muted">{s.name} · format ringkas yang biasa diminta saat pengajuan KUR/pinjaman usaha.</div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Bulan</th>
              <th class="r">Pendapatan</th>
              <th class="r">Biaya</th>
              <th class="r">Untung</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td>{fmtMonth(r.month)}</td>
                <td class="r">{formatPlain(r.income)}</td>
                <td class="r">{formatPlain(r.expense)}</td>
                <td class={`r ${r.profit < 0 ? 'neg' : ''}`}>{formatPlain(r.profit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Rata-rata</td>
              <td class="r">{formatPlain(Math.round(rows.reduce((a, r) => a + r.income, 0) / rows.length))}</td>
              <td class="r">{formatPlain(Math.round(rows.reduce((a, r) => a + r.expense, 0) / rows.length))}</td>
              <td class="r">{formatPlain(Math.round(rows.reduce((a, r) => a + r.profit, 0) / rows.length))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ShiftView() {
  const cashIds = new Set(liveAccounts.value.filter((a) => a.kind === 'cash').map((a) => a.id));
  const salesIds = new Set(categories.value.filter((c) => c.kind === 'income').map((c) => c.id));
  const rows = shiftRows(shifts.value, entries.value, cashIds, salesIds).slice(0, 60);
  const zone = tz.value;
  return (
    <div class="card stack">
      <h3>Shift kasir</h3>
      {rows.length === 0 ? (
        <div class="small muted">Belum ada shift.</div>
      ) : (
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Buka</th>
                <th>Kasir</th>
                <th class="r">Jualan</th>
                <th class="r">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.shift.id}>
                  <td>
                    {fmtDateTime(r.shift.openedAt, zone)}
                    {!r.shift.closedAt && <div class="badge blue">masih buka</div>}
                  </td>
                  <td>{r.shift.by}</td>
                  <td class="r">{formatPlain(r.sales)}</td>
                  <td class={`r ${(r.shift.diff ?? 0) < 0 ? 'neg' : ''}`}>{r.shift.closedAt ? formatPlain(r.shift.diff ?? 0) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

