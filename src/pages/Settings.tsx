import { useEffect, useState } from 'preact/hooks';
import type { Account, AccountType, Category, CategoryKind, Dir, Tz } from '../domain/types';
import { accountBalance, adjust, cashDiff } from '../domain/ledger';
import { BUSINESS_TYPES, DEFAULT_WA_ORDER_TEMPLATE, DEFAULT_WA_TEMPLATE, passwordProblem } from '../domain/presets';
import { fmtDateTime, rp, ulid } from '../domain/util';
import { accounts, categories, ctx, isOwner, ledger, save, settings, tz } from '../store/data';
import { api, ApiError, config, loadConfig } from '../store/api';
import { activeWs, meta, updateMeta } from '../store/meta';
import {
  changePassword,
  deleteAccount,
  deleteBusiness,
  fetchMe,
  linkGoogle,
  logout,
  openTenant,
  regenerateRecoveryCode,
  switchWorkspace,
  type TenantInfo,
} from '../store/session';
import { syncNow, syncState } from '../store/sync';
import { GoogleButton, Money, MoneyInput, Sheet, TopBar, ask, toast } from '../ui/kit';
import { InstallHelp } from '../ui/install';
import { go } from '../ui/router';
import { SyncBadge } from '../ui/sync-badge';
import { device } from '../ui/device';
import { RecoveryCodeView } from './Auth';
import { exportAllForWorkspace } from './exportAll';
import { setPin, clearPin, hasPin } from '../ui/lock';
import {
  ChevronRight,
  Clock,
  Landmark,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Tags,
  UserRound,
  Users,
  Wallet,
} from 'lucide-preact';

type IconColor = 'green' | 'blue' | 'orange' | 'red' | 'purple' | 'gray' | 'teal' | 'indigo';

function Link(props: { href: string; title: string; sub?: string; icon: typeof Store; color: IconColor; active?: string }) {
  const on = props.active === props.href.slice(1);
  return (
    <a class={`item ${on ? 'active' : ''}`} href={props.href} aria-current={on ? 'page' : undefined}>
      <span class={`set-icon ${props.color}`} aria-hidden="true">
        <props.icon size={17} />
      </span>
      <div class="grow">
        <div class="item-title">{props.title}</div>
        {props.sub && <div class="item-sub">{props.sub}</div>}
      </div>
      <ChevronRight size={16} class="chev" aria-hidden="true" />
    </a>
  );
}

export function SettingsHome(props: { active?: string }) {
  const ws = activeWs();
  const owner = isOwner.value;
  const m = meta.value;
  const others = m.workspaces.filter((w) => w.id !== ws?.id);
  const act = props.active;
  return (
    <div>
      <TopBar title={device.value === 'mobile' ? 'Lainnya' : 'Pengaturan'} backTo={false} />
      <div class="page">
        <div class="group list settings">
          {settings.value?.ordersEnabled && <Link href="#/orders" title="Pesanan & DP" icon={ShoppingBag} color="orange" />}
          <Link href="#/shift" title="Buka / Tutup Kasir" sub="Modal kembalian & selisih kas" icon={Clock} color="blue" />
          {!owner && <Link href="#/settings/sync" title="Sinkronisasi" icon={RefreshCw} color="teal" active={act} />}
        </div>
        {owner && (
          <div class="group list settings">
            <Link href="#/settings/business" title="Pengaturan usaha" sub="Nama, zona waktu, QRIS, template WA" icon={Store} color="green" active={act} />
            <Link href="#/settings/accounts" title="Akun uang" sub="Laci, rekening, QRIS" icon={Wallet} color="teal" active={act} />
            <Link href="#/settings/categories" title="Kategori" icon={Tags} color="purple" active={act} />
            <Link href="#/settings/team" title="Kasir & perangkat" sub="Undang kasir, cabut akses HP" icon={Users} color="indigo" active={act} />
          </div>
        )}
        <div class="group list settings">
          {ws?.role !== 'cashier' && (
            <Link
              href="#/settings/security"
              title={m.userToken ? 'Akun & keamanan' : 'Daftar / masuk'}
              sub={m.user?.email ?? m.user?.googleEmail ?? (m.userToken ? undefined : 'Simpan data di cloud, pakai di banyak HP')}
              icon={UserRound}
              color="gray"
              active={act}
            />
          )}
          {owner && <Link href="#/settings/sync" title="Sinkronisasi & backup" icon={RefreshCw} color="blue" active={act} />}
          <Link href="#/settings/pin" title="PIN aplikasi" sub={hasPin() ? 'Aktif' : 'Kunci aplikasi di HP bersama'} icon={Lock} color="red" active={act} />
          <Link href="#/settings/install" title="Pasang di layar utama" icon={Smartphone} color="green" active={act} />
          <Link href="#/privacy" title="Privasi & data" icon={ShieldCheck} color="gray" />
        </div>
        {(others.length > 0 || m.userToken) && (
          <>
            <div class="group-label">Usaha lain</div>
            <div class="group list">
              {others.map((w) => (
                <button class="item" key={w.id} onClick={() => void switchWorkspace(w.id).then(() => go('/'))}>
                  <span class="grow item-title ellipsis">{w.name}</span>
                  <span class="badge">{w.role === 'guest' ? 'di HP ini' : w.role === 'cashier' ? 'kasir' : 'pemilik'}</span>
                </button>
              ))}
              {m.userToken && (
                <>
                  <a class="item" href="#/switch">
                    <span class="grow item-title">Usaha lain di akun</span>
                    <ChevronRight size={16} class="chev" aria-hidden="true" />
                  </a>
                  <a class="item" href="#/new-business">
                    <Plus size={18} class="pos" aria-hidden="true" />
                    <span class="grow item-title pos">Usaha baru</span>
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function BusinessSettings() {
  const s = settings.value!;
  const ws = activeWs();
  const [name, setName] = useState(s.name);
  const [type, setType] = useState(s.businessType);
  const [zone, setZone] = useState<Tz>(s.tz);
  const [mdr, setMdr] = useState(String(s.mdr).replace('.', ','));
  const [orders, setOrders] = useState(s.ordersEnabled);
  const [shift, setShift] = useState(s.shiftEnabled);
  const [wa, setWa] = useState(s.waTemplate);
  const [waOrder, setWaOrder] = useState(s.waOrderTemplate);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mdrNum = Number(mdr.replace(',', '.'));
  const valid = name.trim() && Number.isFinite(mdrNum) && mdrNum >= 0 && mdrNum <= 10;

  const submit = async () => {
    if (!valid) return;
    await save({ ...s, name: name.trim(), businessType: type, tz: zone, mdr: mdrNum, ordersEnabled: orders, shiftEnabled: shift, waTemplate: wa, waOrderTemplate: waOrder });
    if (ws?.tenantId && meta.value.userToken && (name.trim() !== s.name || type !== s.businessType)) {
      try {
        await api(`/tenants/${ws.tenantId}`, { method: 'PATCH', token: meta.value.userToken, body: { name: name.trim(), businessType: type } });
      } catch {
        /* name on server is cosmetic; local settings already saved */
      }
    }
    updateMeta((m) => {
      const w = m.workspaces.find((x) => x.id === ws?.id);
      if (w) w.name = name.trim();
    });
    toast('Tersimpan');
    go('/settings', true);
  };

  return (
    <div>
      <TopBar title="Pengaturan Usaha" backTo="/settings" />
      <div class="page">
        <div class="card stack">
          <label class="field">
            Nama usaha
            <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label class="field">
            Jenis usaha
            <select class="input" value={type} onChange={(e) => setType(e.currentTarget.value as typeof type)}>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            Zona waktu
            <select class="input" value={zone} onChange={(e) => setZone(e.currentTarget.value as Tz)}>
              <option value="WIB">WIB</option>
              <option value="WITA">WITA</option>
              <option value="WIT">WIT</option>
            </select>
          </label>
          <label class="field">
            Potongan QRIS / MDR (%)
            <input class="input" inputMode="decimal" value={mdr} onInput={(e) => setMdr(e.currentTarget.value)} />
            <span class="hint">
              Lihat di aplikasi/kontrak QRIS-mu. Tarif bisa berbeda per jenis merchant dan nominal; isi 0 kalau tidak ada potongan.
            </span>
          </label>
        </div>
        <div class="group-label">Fitur</div>
        <div class="group list">
          <label class="item">
            <div class="grow">
              <div class="item-title">Pesanan & DP</div>
              <div class="item-sub">Katering, kue, jahit, jasa</div>
            </div>
            <input type="checkbox" class="switch" checked={orders} onChange={(e) => setOrders(e.currentTarget.checked)} />
          </label>
          <label class="item">
            <div class="grow">
              <div class="item-title">Buka / tutup kasir</div>
              <div class="item-sub">Hitung uang laci tiap hari</div>
            </div>
            <input type="checkbox" class="switch" checked={shift} onChange={(e) => setShift(e.currentTarget.checked)} />
          </label>
        </div>
        <div class="card stack">
          <label class="field">
            Template pesan tagih WA
            <textarea class="input" rows={4} value={wa} onInput={(e) => setWa(e.currentTarget.value)} />
            <span class="hint">
              Kata otomatis: {'{nama} {usaha} {sisa} {jatuh_tempo}'}
            </span>
          </label>
          <button class="btn small ghost" onClick={() => setWa(DEFAULT_WA_TEMPLATE)}>
            Kembalikan ke bawaan
          </button>
          <label class="field">
            Template pesan pesanan WA
            <textarea class="input" rows={4} value={waOrder} onInput={(e) => setWaOrder(e.currentTarget.value)} />
            <span class="hint">
              Kata otomatis: {'{nama} {usaha} {pesanan} {total} {dp} {sisa} {ambil}'}
            </span>
          </label>
          <button class="btn small ghost" onClick={() => setWaOrder(DEFAULT_WA_ORDER_TEMPLATE)}>
            Kembalikan ke bawaan
          </button>
        </div>
        <button class="btn green block large" disabled={!valid} onClick={submit}>
          Simpan perubahan
        </button>
        <div class="card stack">
          <h3 class="neg">Hapus usaha</h3>
          <p class="small muted">
            Semua data usaha ini (transaksi, kontak, pesanan) dihapus dari HP ini{ws?.tenantId ? ' dan dari server' : ''}. Ekspor dulu kalau masih perlu.
          </p>
          <button class="btn danger-text" onClick={() => setConfirmDelete(true)}>
            Hapus usaha ini
          </button>
        </div>
      </div>
      {confirmDelete && ws && (
        <DeleteConfirm
          title={`Hapus “${s.name}”?`}
          word={s.name}
          onClose={() => setConfirmDelete(false)}
          onExport={() => void exportAllForWorkspace(ws.id)}
          onConfirm={async () => {
            await deleteBusiness(ws);
            toast('Usaha dihapus');
            go('/', true);
          }}
        />
      )}
    </div>
  );
}

function DeleteConfirm(props: { title: string; word: string; onClose: () => void; onConfirm: () => Promise<void>; onExport?: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      {props.onExport && (
        <button class="btn block" onClick={props.onExport}>
          Ekspor semua data dulu (Excel)
        </button>
      )}
      <label class="field">
        Ketik “{props.word}” untuk konfirmasi
        <input class="input" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} />
      </label>
      <button
        class="btn red block"
        disabled={typed.trim().toLowerCase() !== props.word.trim().toLowerCase() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await props.onConfirm();
          } catch (e) {
            toast(e instanceof ApiError ? 'Gagal menghapus di server. Pastikan online.' : 'Gagal.');
            setBusy(false);
          }
        }}
      >
        Hapus permanen
      </button>
    </Sheet>
  );
}

export function AccountsSettings() {
  const l = ledger.value;
  const list = [...accounts.value].sort((a, b) => a.sort - b.sort);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountType>('bank');
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const [actual, setActual] = useState(0);
  const [asProfit, setAsProfit] = useState(false);

  const saveAccount = async () => {
    if (!name.trim()) return;
    if (editing && editing.id) await save({ ...editing, name: name.trim() });
    else await save({ id: ulid(), type: 'account', name: name.trim(), kind, sort: list.length, updatedAt: Date.now() });
    setEditing(null);
  };

  const doAdjust = async () => {
    if (!adjusting) return;
    const delta = actual - accountBalance(l, adjusting.id);
    if (delta !== 0) await save(asProfit ? cashDiff(ctx(), adjusting.id, delta, 'Penyesuaian saldo') : adjust(ctx(), adjusting.id, delta, 'Penyesuaian saldo'));
    toast('Saldo disesuaikan');
    setAdjusting(null);
  };

  return (
    <div>
      <TopBar title="Akun Uang" backTo="/settings" />
      <div class="page">
        <div class="group list with-icons">
          {list.map((a) => (
            <div class="item static" key={a.id}>
              <span class="tx-icon" aria-hidden="true">
                {a.kind === 'cash' ? <Wallet size={18} /> : a.kind === 'bank' ? <Landmark size={18} /> : <QrCode size={18} />}
              </span>
              <div class="grow">
                <div class={`item-title ${a.archived ? 'strike' : ''}`}>{a.name}</div>
                <div class="item-sub">
                  {a.kind === 'cash' ? 'Tunai' : a.kind === 'bank' ? 'Bank' : 'QRIS / e-wallet'} · <Money v={accountBalance(l, a.id)} />
                </div>
              </div>
              <button class="btn small" onClick={() => (setAdjusting(a), setActual(accountBalance(l, a.id)), setAsProfit(false))}>
                Sesuaikan
              </button>
              <button class="btn small ghost" onClick={() => (setEditing(a), setName(a.name))}>
                Ubah
              </button>
            </div>
          ))}
        </div>
        <button class="btn block" onClick={() => (setEditing({} as Account), setName(''), setKind('bank'))}>
          <Plus size={16} aria-hidden="true" />
          <span>Tambah akun (rekening/e-wallet lain)</span>
        </button>
      </div>
      {editing && (
        <Sheet title={editing.id ? 'Ubah akun' : 'Akun baru'} onClose={() => setEditing(null)}>
          <label class="field">
            Nama
            <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="cth. BRI Usaha, GoPay" />
          </label>
          {!editing.id && (
            <div class="chips">
              {(
                [
                  ['cash', 'Tunai'],
                  ['bank', 'Bank'],
                  ['qris', 'QRIS / E-wallet'],
                ] as [AccountType, string][]
              ).map(([k, l2]) => (
                <button key={k} class={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
                  {l2}
                </button>
              ))}
            </div>
          )}
          <button class="btn primary block" disabled={!name.trim()} onClick={saveAccount}>
            Simpan
          </button>
          {editing.id && accountBalance(l, editing.id) === 0 && (
            <button
              class="btn block danger-text"
              onClick={async () => {
                await save({ ...editing, archived: !editing.archived });
                setEditing(null);
              }}
            >
              {editing.archived ? 'Aktifkan lagi' : 'Sembunyikan akun ini'}
            </button>
          )}
        </Sheet>
      )}
      {adjusting && (
        <Sheet title={`Sesuaikan saldo ${adjusting.name}`} onClose={() => setAdjusting(null)}>
          <div class="small">Saldo di aplikasi: {rp(accountBalance(l, adjusting.id))}</div>
          <MoneyInput label="Saldo sebenarnya sekarang" value={actual} onChange={setActual} autoFocus />
          <div class="chips">
            <button class={`chip ${!asProfit ? 'on' : ''}`} onClick={() => setAsProfit(false)}>
              Koreksi (bukan untung/rugi)
            </button>
            <button class={`chip ${asProfit ? 'on' : ''}`} onClick={() => setAsProfit(true)}>
              Selisih kas (masuk untung/rugi)
            </button>
          </div>
          <div class="tiny muted">
            Pakai “Koreksi” untuk saldo awal yang salah atau uang pribadi yang ditambahkan. Pakai “Selisih kas” kalau uangnya memang hilang/lebih tanpa sebab.
          </div>
          <button class="btn primary block" onClick={doAdjust}>
            Simpan
          </button>
        </Sheet>
      )}
    </div>
  );
}

const KIND_LABEL: Record<CategoryKind, string> = {
  income: 'Pendapatan usaha',
  expense: 'Biaya usaha',
  personal: 'Uang pribadi',
  loan: 'Pinjaman',
  asset: 'Beli aset/alat',
  deposit: 'DP pesanan',
};

export function CategoriesSettings() {
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [dir, setDir] = useState<Dir>('out');
  const [business, setBusiness] = useState(true);
  const [kind, setKind] = useState<CategoryKind>('personal');
  const groups = (['income', 'expense', 'personal', 'loan', 'asset', 'deposit'] as CategoryKind[]).map((k) => [k, categories.value.filter((c) => c.kind === k && !c.hidden)] as const);

  const submit = async () => {
    if (!name.trim()) return;
    if (editing?.id) await save({ ...editing, name: name.trim() });
    else {
      const k: CategoryKind = business ? (dir === 'in' ? 'income' : 'expense') : kind;
      const d: Dir = k === 'asset' ? 'out' : dir;
      await save({ id: ulid(), type: 'category', name: name.trim(), kind: k, dir: d, updatedAt: Date.now() });
    }
    setEditing(null);
  };

  return (
    <div>
      <TopBar title="Kategori" backTo="/settings" />
      <div class="page">
        {groups.map(([k, list]) => (
          <section class="stack" key={k}>
            <div class="group-label">{KIND_LABEL[k]}</div>
            <div class="group list">
              {list.map((c) => (
                <button class="item" key={c.id} onClick={() => (setEditing(c), setName(c.name))}>
                  <span class={`grow item-title ${c.archived ? 'strike' : ''}`}>{c.name}</span>
                  <span class={`badge ${c.dir === 'in' ? 'green' : 'red'}`}>{c.dir === 'in' ? 'masuk' : 'keluar'}</span>
                  <ChevronRight size={16} class="chev" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ))}
        <button class="btn block" onClick={() => (setEditing({} as Category), setName(''), setDir('out'), setBusiness(true))}>
          <Plus size={16} aria-hidden="true" />
          <span>Kategori baru</span>
        </button>
      </div>
      {editing && (
        <Sheet title={editing.id ? 'Ubah kategori' : 'Kategori baru'} onClose={() => setEditing(null)}>
          <label class="field">
            Nama
            <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          {!editing.id && (
            <>
              <div class="eyebrow">Uangnya masuk atau keluar?</div>
              <div class="chips">
                <button class={`chip ${dir === 'in' ? 'on' : ''}`} onClick={() => setDir('in')}>
                  Masuk
                </button>
                <button class={`chip ${dir === 'out' ? 'on' : ''}`} onClick={() => setDir('out')}>
                  Keluar
                </button>
              </div>
              <div class="eyebrow">Ini uang usaha?</div>
              <div class="chips">
                <button class={`chip ${business ? 'on' : ''}`} onClick={() => setBusiness(true)}>
                  Ya, untuk jualan/operasional
                </button>
                <button class={`chip ${!business ? 'on' : ''}`} onClick={() => setBusiness(false)}>
                  Bukan: pribadi / pinjaman / beli alat
                </button>
              </div>
              {!business && (
                <div class="chips">
                  {(['personal', 'loan', ...(dir === 'out' ? ['asset'] : [])] as CategoryKind[]).map((k) => (
                    <button key={k} class={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
              <div class="tiny muted">{business ? 'Dihitung ke untung/rugi.' : 'Tidak dihitung ke untung/rugi.'}</div>
            </>
          )}
          <button class="btn primary block" disabled={!name.trim()} onClick={submit}>
            Simpan
          </button>
          {editing.id && !editing.sys && (
            <button
              class="btn block danger-text"
              onClick={async () => {
                await save({ ...editing, archived: !editing.archived });
                setEditing(null);
              }}
            >
              {editing.archived ? 'Tampilkan lagi' : 'Sembunyikan'}
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}

interface Device {
  id: string;
  label: string;
  role: string;
  createdAt: number;
  lastSyncAt: number | null;
  revokedAt: number | null;
}

export function TeamSettings() {
  const ws = activeWs();
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const token = meta.value.userToken;

  const loadDevices = async () => {
    if (!ws?.tenantId || !token) return;
    try {
      setDevices((await api<{ devices: Device[] }>(`/tenants/${ws.tenantId}/devices`, { token })).data.devices);
    } catch {
      setError('Butuh internet untuk melihat daftar perangkat.');
    }
  };
  useEffect(() => {
    void loadDevices();
  }, [ws?.tenantId]);

  if (!ws?.tenantId || !token) {
    return (
      <div>
        <TopBar title="Kasir & Perangkat" backTo="/settings" />
        <div class="page">
          <div class="card stack">
            <h3>Perlu akun dulu</h3>
            <p class="small muted">
              Supaya kasir bisa mencatat dari HP-nya sendiri dan datanya menyatu dengan HP-mu, usaha ini perlu disimpan di cloud. Daftarnya gratis dan data yang sudah ada ikut dibawa.
            </p>
            <a class="btn primary" href="#/register">
              Daftar gratis
            </a>
            <a href="#/login">Sudah punya akun? Masuk</a>
          </div>
        </div>
      </div>
    );
  }

  const makeInvite = async () => {
    try {
      setInvite((await api<{ code: string; expiresAt: number }>(`/tenants/${ws.tenantId}/invites`, { method: 'POST', token })).data);
    } catch {
      toast('Butuh internet untuk membuat kode.');
    }
  };

  return (
    <div>
      <TopBar title="Kasir & Perangkat" backTo="/settings" />
      <div class="page">
        <div class="card stack">
          <h3>Tambah kasir</h3>
          <p class="small muted">
            Di HP kasir: buka aplikasi ini → “Saya kasir, punya kode” → masukkan kode. Kasir bisa mencatat transaksi dan buka/tutup kasir, tapi tidak melihat untung & laporan.
          </p>
          {invite ? (
            <>
              <div class="code-box">{invite.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
              <div class="tiny muted center">Berlaku sampai {new Date(invite.expiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · sekali pakai</div>
            </>
          ) : (
            <button class="btn primary" onClick={makeInvite}>
              Buat kode undangan
            </button>
          )}
        </div>
        <div class="card stack">
          <div class="row between">
            <h3>Perangkat terhubung</h3>
            <button class="btn small ghost" onClick={loadDevices}>
              Muat ulang
            </button>
          </div>
          {error && <div class="small muted">{error}</div>}
          <div class="list plain">
            {devices?.map((d) => (
              <div class="item static" key={d.id}>
                <div class="grow">
                  <div class={d.revokedAt ? 'strike' : ''}>{d.label}</div>
                  <div class="tiny muted">
                    {d.role === 'cashier' ? 'Kasir' : 'Pemilik'} · {d.lastSyncAt ? `terakhir sinkron ${fmtDateTime(d.lastSyncAt, tz.value)}` : 'belum pernah sinkron'}
                  </div>
                </div>
                {!d.revokedAt && (
                  <button
                    class="btn small danger-text"
                    onClick={async () => {
                      if (!(await ask({ title: `Cabut akses ${d.label}?`, body: 'HP itu tidak bisa sinkron lagi dan harus diundang ulang.', confirm: 'Cabut akses', danger: true }))) return;
                      await api(`/tenants/${ws.tenantId}/devices/${d.id}`, { method: 'DELETE', token });
                      void loadDevices();
                    }}
                  >
                    Cabut
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SecuritySettings() {
  const m = meta.value;
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!config.value) void loadConfig();
    if (m.userToken) void fetchMe().catch(() => undefined);
  }, []);

  if (!m.userToken) {
    return (
      <div>
        <TopBar title="Daftar / Masuk" backTo="/settings" />
        <div class="page">
          <div class="card stack">
            <p class="small">
              Dengan akun, datamu tersimpan aman di cloud, bisa dipakai di beberapa HP, dan bisa menambah kasir. Data yang sudah dicatat di HP ini bisa dibawa.
            </p>
            <a class="btn primary" href="#/register">
              Daftar gratis
            </a>
            <a class="btn" href="#/login">
              Masuk
            </a>
          </div>
        </div>
      </div>
    );
  }

  const user = m.user;
  const pwProblem = password ? passwordProblem(password, [user?.email?.split('@')[0] ?? '']) : null;

  return (
    <div>
      <TopBar title="Akun & Keamanan" backTo="/settings" />
      <div class="page">
        <div class="card row loose">
          <span class="avatar lg" aria-hidden="true">{(user?.name ?? '?').slice(0, 1).toUpperCase()}</span>
          <div class="grow">
            <h2 class="ellipsis">{user?.name}</h2>
            <div class="small muted ellipsis">{user?.email ?? 'Belum ada login email'}</div>
            <div class="small muted ellipsis">Google: {user?.googleEmail ?? 'belum ditautkan'}</div>
          </div>
        </div>
        <div class="card stack">
          <h3>{user?.hasPassword ? 'Ganti password' : 'Buat login email + password'}</h3>
          <p class="hint">Tidak perlu password lama karena kamu sudah masuk di HP ini.</p>
          {!user?.email && (
            <label class="field">
              Email
              <input class="input" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
            </label>
          )}
          <label class="field">
            Password baru
            <input class="input" type="password" autoComplete="new-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
          </label>
          {pwProblem && <div class="small neg">{pwProblem}</div>}
          <button
            class="btn primary"
            disabled={!password || !!pwProblem || busy || (!user?.email && !email)}
            onClick={async () => {
              setBusy(true);
              try {
                await changePassword(password, user?.email ? undefined : email);
                setPassword('');
                toast('Password tersimpan');
              } catch (e) {
                toast(e instanceof ApiError && e.code === 'email_taken' ? 'Email sudah dipakai akun lain.' : 'Gagal, pastikan online.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan password
          </button>
        </div>
        {user?.hasPassword && (
          <div class="card stack">
            <h3>Kode pemulihan</h3>
            {code ? (
              <RecoveryCodeView code={code} email={user.email ?? ''} onDone={() => setCode(null)} />
            ) : (
              <>
                <p class="small muted">Buat kode baru kalau kode lama hilang. Kode lama otomatis tidak berlaku.</p>
                <button
                  class="btn"
                  onClick={async () => {
                    try {
                      setCode(await regenerateRecoveryCode());
                    } catch {
                      toast('Butuh internet.');
                    }
                  }}
                >
                  Buat kode pemulihan baru
                </button>
              </>
            )}
          </div>
        )}
        {!user?.googleEmail && config.value?.googleClientId && (
          <div class="card stack">
            <h3>Tautkan Google (cadangan)</h3>
            <p class="small muted">Kalau lupa password, cukup masuk dengan Google.</p>
            <GoogleButton
              text="continue_with"
              onCredential={async (c) => {
                try {
                  await linkGoogle(c);
                  toast('Google tertaut');
                } catch (e) {
                  toast(e instanceof ApiError && e.code === 'google_taken' ? 'Akun Google ini sudah dipakai akun lain.' : 'Gagal menautkan.');
                }
              }}
            />
          </div>
        )}
        <button
          class="btn block"
          onClick={async () => {
            const pending = syncState.value.pending;
            if (
              pending > 0 &&
              !(await ask({ title: 'Tetap keluar?', body: `Ada ${pending} catatan belum terkirim dan akan hilang dari HP ini.`, confirm: 'Keluar & hapus dari HP', danger: true }))
            )
              return;
            await logout();
            go('/', true);
          }}
        >
          Keluar dari akun
        </button>
        <button class="btn block ghost danger-text" onClick={() => setConfirmDelete(true)}>
          Hapus akun & semua usaha
        </button>
      </div>
      {confirmDelete && (
        <DeleteConfirm
          title="Hapus akun?"
          word="HAPUS"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteAccount();
            toast('Akun dihapus');
            go('/', true);
          }}
        />
      )}
    </div>
  );
}

export function SyncSettings() {
  const ws = activeWs();
  const s = syncState.value;
  return (
    <div>
      <TopBar title="Sinkronisasi & Backup" backTo="/settings" />
      <div class="page">
        <div class="card stack">
          <div class="card-head">
            <h3>Status</h3>
            <SyncBadge />
          </div>
          {ws?.tenantId ? (
            <>
              <div class="kv">
                <div>
                  <span>Belum terkirim</span>
                  <span>{s.pending}</span>
                </div>
                <div>
                  <span>Terakhir sinkron</span>
                  <span>{ws.lastSyncAt ? fmtDateTime(ws.lastSyncAt, tz.value) : '–'}</span>
                </div>
              </div>
              {s.status === 'quota' && <div class="banner soft amber">Batas harian tercapai. Data aman di HP dan dikirim otomatis besok.</div>}
              <button class="btn" onClick={() => void syncNow()}>
                Sinkron sekarang
              </button>
            </>
          ) : (
            <>
              <p class="small muted">Data hanya ada di HP ini. Daftar supaya otomatis tersimpan di cloud.</p>
              <a class="btn primary" href="#/register">
                Daftar gratis
              </a>
            </>
          )}
        </div>
        {isOwner.value && ws && (
          <div class="card stack">
            <h3>Backup manual</h3>
            <p class="small muted">Unduh semua data ke Excel. Disarankan sebulan sekali.</p>
            <button
              class="btn"
              onClick={() => {
                updateMeta((m) => {
                  m.exportReminderAt = Date.now();
                });
                void exportAllForWorkspace(ws.id);
              }}
            >
              Unduh semua data (Excel)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PinSettings() {
  const [pin, setPinValue] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const active = hasPin();
  return (
    <div>
      <TopBar title="PIN Aplikasi" backTo="/settings" />
      <div class="page">
        <div class="card stack">
          <p class="small muted">
            PIN dipakai untuk mengunci aplikasi saat dibuka di HP bersama. PIN hanya tersimpan di HP ini.
          </p>
          <label class="field">
            PIN baru (4–6 angka)
            <input class="input" type="password" inputMode="numeric" maxLength={6} value={pin} onInput={(e) => setPinValue(e.currentTarget.value.replace(/\D/g, ''))} />
          </label>
          <label class="field">
            Ulangi PIN
            <input class="input" type="password" inputMode="numeric" maxLength={6} value={confirmPin} onInput={(e) => setConfirmPin(e.currentTarget.value.replace(/\D/g, ''))} />
          </label>
          <button
            class="btn primary"
            disabled={pin.length < 4 || pin !== confirmPin}
            onClick={async () => {
              await setPin(pin);
              toast('PIN aktif');
              go('/settings', true);
            }}
          >
            {active ? 'Ganti PIN' : 'Aktifkan PIN'}
          </button>
          {active && (
            <button
              class="btn danger-text"
              onClick={() => {
                clearPin();
                toast('PIN dimatikan');
                go('/settings', true);
              }}
            >
              Matikan PIN
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function InstallPage() {
  return (
    <div>
      <TopBar title="Pasang Aplikasi" backTo="/settings" />
      <div class="page">
        <InstallHelp />
      </div>
    </div>
  );
}

export function SwitchBusiness() {
  const [tenants, setTenants] = useState<TenantInfo[] | null>(null);
  useEffect(() => {
    void fetchMe()
      .then((me) => setTenants(me?.tenants ?? []))
      .catch(() => setTenants([]));
  }, []);
  return (
    <div>
      <TopBar title="Pilih Usaha" backTo="/settings" />
      <div class="page">
        <div class="group list">
          {tenants === null && <div class="item static muted">Memuat…</div>}
          {tenants?.map((t) => (
            <button class="item" key={t.id} onClick={() => void openTenant(t).then(() => go('/', true))}>
              <span class="grow item-title">{t.name}</span>
              <span class="badge">{t.role === 'owner' ? 'pemilik' : 'kasir'}</span>
            </button>
          ))}
        </div>
        <a class="btn block" href="#/new-business">
          <Plus size={16} aria-hidden="true" />
          <span>Usaha baru</span>
        </a>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  const cfg = config.value;
  return (
    <div>
      <TopBar title="Privasi & Data" backTo="/settings" />
      <div class="page">
        <div class="card prose">
          <h3>Data apa yang disimpan</h3>
          <p>
            Catatan keuangan usaha, nama & nomor WhatsApp pelanggan/supplier yang kamu masukkan, serta email/nama akun. Tanpa akun, semua data hanya ada di HP ini.
          </p>
          <h3>Untuk apa</h3>
          <p>
            Hanya untuk menjalankan aplikasi: menyimpan dan menyinkronkan catatanmu. Nomor pelanggan hanya dipakai saat kamu menekan tombol tagih/kirim WA. Kami tidak menjual atau membagikan data.
          </p>
          <h3>Hakmu</h3>
          <p>
            Kamu bisa mengunduh semua data kapan saja (Lainnya → Sinkronisasi & backup), menghapus usaha (Pengaturan usaha → Hapus), atau menghapus akun beserta semua usaha (Akun & keamanan). Sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi.
          </p>
          <h3>Keamanan</h3>
          <p>
            Password diacak di HP sebelum dikirim. Server hanya menyimpan hasil acakannya, tidak pernah password aslinya.
          </p>
          {cfg?.adminWa && (
            <a class="btn" target="_blank" rel="noopener" href={`https://wa.me/${cfg.adminWa}`}>
              Hubungi admin
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

