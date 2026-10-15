import { accountBalance, orderHeld } from '../domain/ledger';
import { debtRows, dayRange, pendingSince, profit, todayKey } from '../domain/reports';
import { addDays, dayKey, fmtDate, fmtTime, rp } from '../domain/util';
import { catById, debts, entries, isOwner, ledger, liveAccounts, openShift, orders, settings, tz } from '../store/data';
import { activeWs, meta, updateMeta } from '../store/meta';
import { syncState } from '../store/sync';
import { SyncBadge } from '../ui/sync-badge';
import { device } from '../ui/device';
import { EntryRow } from './History';
import { InstallBanner } from '../ui/install';
import { Empty, Money, TopBar } from '../ui/kit';
import { SignupNudge } from './Nudge';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  Cloud,
  Download,
  Info,
  Landmark,
  QrCode,
  ReceiptText,
  ShieldOff,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-preact';


const ACC_ICON = { cash: Wallet, bank: Landmark, qris: QrCode } as const;

export function Dashboard() {
  const s = settings.value!;
  const zone = tz.value;
  const today = todayKey(zone);
  const owner = isOwner.value;
  const dev = device.value;
  const p = profit(entries.value, catById.value, dayRange(today, zone));
  // Cashiers only need the drawer balance; bank and e-wallet balances stay with the owner.
  const accs = owner ? liveAccounts.value : liveAccounts.value.filter((a) => a.kind === 'cash');
  const l = ledger.value;
  const total = accs.reduce((sum, a) => sum + accountBalance(l, a.id), 0);
  const rows = debtRows(debts.value, l, entries.value, today);
  const recv = rows.filter((r) => r.debt.dir === 'recv');
  const pay = rows.filter((r) => r.debt.dir !== 'recv');
  const overdue = recv.filter((r) => r.bucket === 'd1_30' || r.bucket === 'd30plus').length;
  const openOrders = orders.value.filter((o) => o.status === 'open');
  const held = openOrders.reduce((sum, o) => sum + orderHeld(l, o), 0);
  const soon = openOrders.filter((o) => o.pickupDate && o.pickupDate <= addDays(today, 1));
  const qrisAcc = owner ? accs.find((a) => a.kind === 'qris') : undefined;
  const qrisBal = qrisAcc ? accountBalance(l, qrisAcc.id) : 0;
  const qrisSince = qrisAcc && qrisBal > 0 ? pendingSince(entries.value, qrisAcc.id) : null;
  const recent = l.list.slice(0, dev === 'desktop' ? 8 : 6);
  const ws = activeWs();
  const shift = openShift.value;
  const showExportReminder =
    owner && entries.value.length > 30 && Date.now() - (meta.value.exportReminderAt ?? ws?.createdAt ?? Date.now()) > 30 * 86_400_000;

  return (
    <div>
      <TopBar
        title={dev === 'mobile' ? s.name : 'Beranda'}
        subtitle={fmtDate(today, true)}
        backTo={false}
        right={
          dev !== 'desktop' ? (
            <a href="#/settings/sync" class={dev === 'tablet' ? 'tablet-sync' : ''} aria-label="Status sinkronisasi">
              <SyncBadge />
            </a>
          ) : undefined
        }
      />
      <div class="page">
        {ws?.revoked && (
          <div class="banner soft red">
            <span class="banner-icon">
              <ShieldOff size={16} aria-hidden="true" />
            </span>
            <div class="grow">Akses perangkat ini ke usaha sudah dicabut pemilik. Data yang belum terkirim tetap aman di penyimpanan lokal.</div>
          </div>
        )}
        {ws?.migration && <MigrationProgress />}
        <SignupNudge />
        <InstallBanner />
        {showExportReminder && (
          <div class="banner">
            <span class="banner-icon blue">
              <Download size={16} aria-hidden="true" />
            </span>
            <div class="grow">
              Sudah sebulan belum unduh backup. Simpan salinan ke Excel supaya punya arsip sendiri.{' '}
              <a href="#/settings/sync" class="bold">
                Unduh sekarang
              </a>
            </div>
            <button
              class="icon-btn plain"
              aria-label="Tutup"
              onClick={() =>
                updateMeta((m) => {
                  m.exportReminderAt = Date.now();
                })
              }
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {dev !== 'desktop' && (
          <div class="quick-entry">
            <a class="qe in" href="#/tx/in">
              <span class="qe-icon">
                <ArrowDownLeft size={20} strokeWidth={2.4} aria-hidden="true" />
              </span>
              Uang Masuk
            </a>
            <a class="qe out" href="#/tx/out">
              <span class="qe-icon">
                <ArrowUpRight size={20} strokeWidth={2.4} aria-hidden="true" />
              </span>
              Uang Keluar
            </a>
            <a class="qe move" href="#/tx/transfer">
              <span class="qe-icon">
                <ArrowLeftRight size={18} aria-hidden="true" />
              </span>
              <span class="grow">
                <div>Pindah Saldo</div>
                <div class="qe-sub">Setor ke bank, tarik tunai, cairkan QRIS</div>
              </span>
              <ChevronRight size={18} class="muted" aria-hidden="true" />
            </a>
          </div>
        )}

        <div class="bento">
          {owner && (
            <div class="card stack span-2">
              <div class="card-head">
                <div class="metric-label">Untung hari ini</div>
                <a href="#/reports" class="link-more">
                  Laporan <ChevronRight size={15} aria-hidden="true" />
                </a>
              </div>
              <div class={`metric-hero ${p.profit > 0 ? 'pos' : p.profit < 0 ? 'neg' : ''}`}>
                <Money v={p.profit} sign />
              </div>
              <div class="tiles">
                <div class="tile">
                  <span class="metric-label">Jualan</span>
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
              <div class="hint with-icon">
                <Info size={15} aria-hidden="true" />
                <span>Jualan dikurangi biaya usaha, termasuk penjualan yang dicatat tempo.</span>
              </div>
            </div>
          )}

          <div class="card flush">
            <div class="card-head">
              <div>
                <div class="metric-label">{owner ? 'Uang ada' : 'Uang di laci'}</div>
                <div class="metric-lg">
                  <Money v={total} />
                </div>
              </div>
            </div>
            <div class="list with-icons">
              {accs.map((a) => {
                const Icon = ACC_ICON[a.kind];
                return (
                  <a class="item" key={a.id} href={`#/history?acc=${a.id}`} title={`Riwayat ${a.name}`}>
                    <span class="tx-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span class="grow item-title ellipsis">{a.name}</span>
                    <span class="item-value">
                      <Money v={accountBalance(l, a.id)} />
                    </span>
                    <ChevronRight size={16} class="chev" aria-hidden="true" />
                  </a>
                );
              })}
            </div>
            {qrisSince && (
              <div class="card-pad">
                <a class="banner soft amber" href={`#/tx/transfer?from=${qrisAcc!.id}&settle=1`}>
                  <div class="grow">
                    Dana QRIS <b>{rp(qrisBal)}</b> sejak {fmtDate(dayKey(qrisSince, zone))}. Ketuk kalau sudah cair ke bank.
                  </div>
                  <ChevronRight size={16} aria-hidden="true" />
                </a>
              </div>
            )}
          </div>

          <div class="card flush span-2">
            <div class="card-head">
              <h3>Terakhir dicatat</h3>
              <a href="#/history" class="link-more">
                Semua <ChevronRight size={15} aria-hidden="true" />
              </a>
            </div>
            {recent.length === 0 ? (
              <Empty icon={<ReceiptText size={24} aria-hidden="true" />}>
                Belum ada transaksi. Ketuk <b>Uang Masuk</b> untuk mulai mencatat.
              </Empty>
            ) : (
              <div class="list with-icons">
                {recent.map((e) => (
                  <EntryRow e={e} key={e.id} showDate={dayKey(e.at, zone) !== today} />
                ))}
              </div>
            )}
          </div>

          <div class="card stack">
            <div class="card-head">
              <h3>Utang & piutang</h3>
              <a href="#/debts" class="link-more">
                Kelola <ChevronRight size={15} aria-hidden="true" />
              </a>
            </div>
            <a class="tile" href="#/debts">
              <span class="tile-top">
                <span class="metric-label">Pelanggan belum bayar</span>
                {overdue > 0 && <span class="badge red">{overdue} lewat tempo</span>}
              </span>
              <span class="metric-md">
                <Money v={recv.reduce((x, r) => x + r.remaining, 0)} />
              </span>
              <span class="tiny muted">{recv.length} catatan piutang</span>
            </a>
            <a class="tile" href="#/debts?tab=pay">
              <span class="metric-label">Utang ke supplier & pinjaman</span>
              <span class="metric-md">
                <Money v={pay.reduce((x, r) => x + r.remaining, 0)} />
              </span>
              <span class="tiny muted">{pay.length} catatan</span>
            </a>
          </div>

          {s.shiftEnabled && (
            <div class="card stack">
              <div class="card-head">
                <h3>Kasir</h3>
                <span class={`badge dot ${shift ? 'green' : ''}`}>{shift ? 'Buka' : 'Tutup'}</span>
              </div>
              <p class="small muted">
                {shift ? (
                  <>
                    Dibuka {fmtTime(shift.openedAt, zone)} oleh <b>{shift.by}</b>. Hitung uang laci saat ganti shift.
                  </>
                ) : (
                  'Buka kasir untuk mencatat modal kembalian awal.'
                )}
              </p>
              <a href="#/shift" class={`btn block ${shift ? '' : 'tinted'}`}>
                {shift ? 'Tutup kasir' : 'Buka kasir'}
              </a>
            </div>
          )}

          {s.ordersEnabled && (
            <a class="card stack" href="#/orders">
              <div class="card-head">
                <h3>Pesanan berjalan</h3>
                <ChevronRight size={18} class="muted" aria-hidden="true" />
              </div>
              <div class="tiles">
                <div class="tile">
                  <span class="metric-label">Aktif</span>
                  <span class="metric-md">{openOrders.length}</span>
                </div>
                <div class="tile">
                  <span class="metric-label">DP disimpan</span>
                  <span class="metric-md">
                    <Money v={held} />
                  </span>
                </div>
              </div>
              {soon.length > 0 && (
                <div class="banner soft red">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{soon.length} pesanan diambil hari ini / besok</span>
                </div>
              )}
            </a>
          )}

          {!meta.value.userToken && activeWs()?.role === 'guest' && (
            <div class="card span-full">
              <div class="promo">
                <div class="promo-body">
                  <span class="set-icon blue" aria-hidden="true">
                    <Cloud size={17} />
                  </span>
                  <div class="grow">
                    <h3>Simpan pembukuan di cloud, gratis</h3>
                    <p class="small muted">Sekarang data hanya ada di perangkat ini. Dengan akun, data aman walau HP hilang dan bisa dipakai bersama kasir.</p>
                  </div>
                </div>
                <a class="btn primary" href="#/register">
                  Daftar gratis
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MigrationProgress() {
  const ws = activeWs()!;
  const total = ws.migration?.total ?? 0;
  const done = Math.min(total, syncState.value.uploaded ?? Math.max(0, total - syncState.value.pending));
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div class="banner">
      <span class="banner-icon blue">
        <UploadCloud size={16} aria-hidden="true" />
      </span>
      <div class="grow stack tight">
        <div>
          Mengunggah data lama ke cloud: <b>{done.toLocaleString('id-ID')}</b> dari {total.toLocaleString('id-ID')}. Aplikasi tetap bisa dipakai normal.
        </div>
        <div class="progress" aria-label={`${pct}%`}>
          <div style={`width:${pct}%`} />
        </div>
        {syncState.value.status === 'quota' && <div class="tiny">Kapasitas harian free tier penuh, dilanjutkan otomatis besok pagi.</div>}
        {syncState.value.status === 'offline' && <div class="tiny">Menunggu koneksi internet…</div>}
      </div>
    </div>
  );
}
