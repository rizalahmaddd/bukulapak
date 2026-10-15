import { loaded, isOwner, settings, openShift } from './store/data';
import { meta, activeWs } from './store/meta';
import { match, route } from './ui/router';
import { AskDialog, Toast, UpdateBanner } from './ui/kit';
import { LockScreen, locked, hasPin } from './ui/lock';
import { Dashboard } from './pages/Dashboard';
import { SyncBadge } from './ui/sync-badge';
import { device } from './ui/device';
import { AddMenu, AddSheet, InAppShell } from './ui/quick';
import { useState } from 'preact/hooks';
import { Onboarding, Welcome } from './pages/Welcome';
import { TxForm } from './pages/TxForm';
import { TransferForm } from './pages/Transfer';
import { EntryDetail, History } from './pages/History';
import { ContactDebts, DebtRedirect, Debts } from './pages/Debts';
import { OrderDetail, Orders } from './pages/Orders';
import { ShiftPage } from './pages/Shift';
import { Reports } from './pages/Reports';
import {
  AccountsSettings,
  BusinessSettings,
  CategoriesSettings,
  InstallPage,
  PinSettings,
  PrivacyPage,
  SecuritySettings,
  SettingsHome,
  SwitchBusiness,
  SyncSettings,
  TeamSettings,
} from './pages/Settings';
import { JoinPage, LoginPage, MigratePage, RecoverPage, RecoveryCodePage, RegisterPage } from './pages/Auth';
import {
  Home,
  Clock,
  ReceiptText,
  HandCoins,
  ShoppingBag,
  BarChart3,
  Settings as SettingsIcon,
  Lock,
  ChevronsUpDown,
  Plus,
} from 'lucide-preact';
import type { JSX, ComponentChildren } from 'preact';

type Page = (p: Record<string, string>) => JSX.Element | null;

const PUBLIC: [string, Page][] = [
  ['/start', () => <Onboarding mode="guest" />],
  ['/login', () => <LoginPage />],
  ['/register', () => <RegisterPage />],
  ['/recover', () => <RecoverPage />],
  ['/join', () => <JoinPage />],
  ['/recovery-code', () => <RecoveryCodePage />],
  ['/migrate', () => <MigratePage />],
  ['/new-business', () => <Onboarding mode={meta.value.userToken ? 'tenant' : 'guest'} />],
  ['/privacy', () => <PrivacyPage />],
];

const TABS: [string, Page][] = [
  ['/', () => <Dashboard />],
  ['/history', () => <History />],
  ['/debts', () => <Debts />],
  ['/reports', () => (isOwner.value ? <Reports /> : <Dashboard />)],
  ['/settings', () => <SettingsHome />],
];

const INNER: [string, Page][] = [
  ['/tx/in', () => <TxForm dir="in" />],
  ['/tx/out', () => <TxForm dir="out" />],
  ['/tx/transfer', () => <TransferForm />],
  ['/entry/:id', (p) => <EntryDetail id={p.id} />],
  ['/debts/c/:id', (p) => <ContactDebts contactId={p.id} />],
  ['/debts/:id', (p) => <DebtRedirect id={p.id} />],
  ['/orders', () => <Orders />],
  ['/orders/:id', (p) => <OrderDetail id={p.id} />],
  ['/shift', () => <ShiftPage />],
  ['/switch', () => <SwitchBusiness />],
  ['/settings/business', () => <BusinessSettings />],
  ['/settings/accounts', () => <AccountsSettings />],
  ['/settings/categories', () => <CategoriesSettings />],
  ['/settings/team', () => <TeamSettings />],
  ['/settings/security', () => <SecuritySettings />],
  ['/settings/sync', () => <SyncSettings />],
  ['/settings/pin', () => <PinSettings />],
  ['/settings/install', () => <InstallPage />],
];

function find(table: [string, Page][], path: string) {
  for (const [pattern, page] of table) {
    const params = match(pattern, path);
    if (params) return () => page(params);
  }
  return null;
}

type NavItem = { href: string; label: string; short: string; Icon: typeof Home; match: (p: string) => boolean };

function navItems(): NavItem[] {
  const s = settings.value;
  const owner = isOwner.value;
  return [
    { href: '/', label: 'Beranda', short: 'Beranda', Icon: Home, match: (p) => p === '/' },
    { href: '/history', label: 'Riwayat', short: 'Riwayat', Icon: ReceiptText, match: (p) => p === '/history' || p.startsWith('/entry/') },
    { href: '/debts', label: 'Utang Piutang', short: 'Utang', Icon: HandCoins, match: (p) => p.startsWith('/debts') },
    ...(s?.ordersEnabled ? [{ href: '/orders', label: 'Pesanan DP', short: 'Pesanan', Icon: ShoppingBag, match: (p: string) => p.startsWith('/orders') }] : []),
    ...(owner ? [{ href: '/reports', label: 'Laporan', short: 'Laporan', Icon: BarChart3, match: (p: string) => p === '/reports' }] : []),
    { href: '/settings', label: 'Pengaturan', short: 'Lainnya', Icon: SettingsIcon, match: (p) => p.startsWith('/settings') || p === '/switch' },
  ];
}

function Sidebar(props: { path: string }) {
  const p = props.path.split('?')[0];
  const s = settings.value;
  const owner = isOwner.value;
  const shift = openShift.value;
  const items = navItems();
  const link = (it: NavItem) => (
    <a key={it.href} href={`#${it.href}`} class={`side-link ${it.match(p) ? 'on' : ''}`} aria-current={it.match(p) ? 'page' : undefined}>
      <it.Icon size={18} aria-hidden="true" />
      <span class="grow ellipsis">{it.label}</span>
    </a>
  );
  return (
    <aside class="sidebar" aria-label="Navigasi utama">
      <div class="sidebar-panel">
        <div class="sidebar-head">
          <div class="brand">
            <span class="app-icon sm" aria-hidden="true">B</span>
            BukuLapak
          </div>
          {s && (
            <a href="#/switch" class="tenant-switch" title="Ganti usaha">
              <span class="grow">
                <div class="t-name ellipsis">{s.name}</div>
                <div class="t-role">{owner ? 'Pemilik' : 'Kasir'} · {activeWs()?.tenantId ? 'Tersambung' : 'Di perangkat ini'}</div>
              </span>
              <ChevronsUpDown size={15} class="muted" aria-hidden="true" />
            </a>
          )}
        </div>
        <nav class="sidebar-nav">
          {items.slice(0, 1).map(link)}
          {s?.shiftEnabled && (
            <a href="#/shift" class={`side-link ${p === '/shift' ? 'on' : ''}`}>
              <Clock size={18} aria-hidden="true" />
              <span class="grow">Kasir / Shift</span>
              {shift && <span class="badge green">Buka</span>}
            </a>
          )}
          <div class="side-group">Pembukuan</div>
          {items.filter((it) => ['/history', '/debts', '/orders'].includes(it.href)).map(link)}
          {owner && <div class="side-group">Analisis</div>}
          {items.filter((it) => it.href === '/reports').map(link)}
          <div class="side-group">Sistem</div>
          {items.filter((it) => it.href === '/settings').map(link)}
        </nav>
        <div class="sidebar-foot">
          <span class="avatar" aria-hidden="true">{(meta.value.user?.name ?? (owner ? 'P' : 'K')).slice(0, 1).toUpperCase()}</span>
          <div class="grow">
            <div class="small bold ellipsis">{meta.value.user?.name ?? (owner ? 'Pemilik Toko' : 'Kasir')}</div>
            <div class="tiny muted ellipsis">{activeWs()?.tenantId ? 'Akun tersambung' : 'Mode tamu'}</div>
          </div>
          {hasPin() && (
            <button class="icon-btn" title="Kunci layar" aria-label="Kunci layar" onClick={() => (locked.value = true)}>
              <Lock size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function IpadBar(props: { path: string }) {
  const p = props.path.split('?')[0];
  const s = settings.value;
  const items = navItems().filter((it) => it.href !== '/orders');
  return (
    <div class="ipad-bar">
      <div class="left">
        {s && (
          <a href="#/switch" class="tenant-btn" title="Ganti usaha">
            <span class="app-icon sm" aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span>
            <span class="ellipsis">{s.name}</span>
          </a>
        )}
      </div>
      <nav class="ipad-tabs" aria-label="Navigasi utama">
        {items.map((it) => (
          <a key={it.href} href={`#${it.href}`} class={it.match(p) ? 'on' : ''} aria-current={it.match(p) ? 'page' : undefined}>
            {it.short}
          </a>
        ))}
      </nav>
      <div class="right">
        <a href="#/settings/sync" class="sync-link" aria-label="Status sinkronisasi">
          <SyncBadge />
        </a>
        {hasPin() && (
          <button class="round-glass" aria-label="Kunci layar" onClick={() => (locked.value = true)}>
            <Lock size={18} aria-hidden="true" />
          </button>
        )}
        <AddMenu />
      </div>
    </div>
  );
}

function MobileTabBar(props: { path: string }) {
  const p = props.path.split('?')[0];
  const [adding, setAdding] = useState(false);
  const items = navItems().filter((it) => it.href !== '/orders');
  return (
    <>
      <nav class="tabbar" aria-label="Navigasi utama">
        <div class="tabbar-pill">
          {items.map((it) => (
            <a key={it.href} href={`#${it.href}`} class={`tab ${it.match(p) ? 'on' : ''}`} aria-current={it.match(p) ? 'page' : undefined}>
              <it.Icon size={22} strokeWidth={it.match(p) ? 2.3 : 1.9} aria-hidden="true" />
              {it.short}
            </a>
          ))}
        </div>
        <button class="fab" aria-label="Catat transaksi" onClick={() => setAdding(true)}>
          <Plus size={28} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </nav>
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </>
  );
}

const SETTINGS_PAGES: Record<string, () => JSX.Element> = {
  '/settings/business': () => <BusinessSettings />,
  '/settings/accounts': () => <AccountsSettings />,
  '/settings/categories': () => <CategoriesSettings />,
  '/settings/team': () => <TeamSettings />,
  '/settings/security': () => <SecuritySettings />,
  '/settings/sync': () => <SyncSettings />,
  '/settings/pin': () => <PinSettings />,
  '/settings/install': () => <InstallPage />,
};

function SettingsSplit(props: { path: string }) {
  const p = props.path.split('?')[0];
  const sub = p === '/settings' ? (isOwner.value ? '/settings/business' : '/settings/sync') : p;
  const page = SETTINGS_PAGES[sub];
  return (
    <div class="settings-split">
      <div class="settings-nav">
        <InAppShell.Provider value={false}>
          <SettingsHome active={sub} />
        </InAppShell.Provider>
      </div>
      <div class="settings-detail">{page ? page() : null}</div>
    </div>
  );
}

function PublicShell(props: { children: ComponentChildren }) {
  return (
    <div class="public-shell">
      <div class="public-brand" aria-hidden="true">
        <span class="app-icon">B</span>
        <div class="hero-title">Pembukuan warung yang beres sendiri.</div>
        <p class="lead">Catat uang masuk & keluar, langsung tahu untung berapa dan uangnya ada di mana. Gratis, jalan tanpa sinyal.</p>
      </div>
      <div class="public-side">
        <div class="public-container">{props.children}</div>
      </div>
    </div>
  );
}

export function App() {
  if (!loaded.value) return <div class="loading-screen">Memuat data BukuLapak…</div>;
  const path = route.value;
  const dev = device.value;
  const pub = find(PUBLIC, path);
  if (pub) {
    return (
      <Shell>
        <PublicShell>{pub()}</PublicShell>
      </Shell>
    );
  }

  if (!meta.value.active || !settings.value) {
    return (
      <Shell>
        <PublicShell>
          <Welcome />
        </PublicShell>
      </Shell>
    );
  }

  const p = path.split('?')[0];
  const tab = find(TABS, path);
  const inner = find(INNER, path);
  const splitSettings = dev !== 'mobile' && (p === '/settings' || p.startsWith('/settings/'));
  const content = splitSettings ? <SettingsSplit path={path} /> : tab ? tab() : inner ? inner() : TABS[0][1]({});
  const showTabbar = dev === 'mobile' && !!tab;

  return (
    <Shell>
      <InAppShell.Provider value={true}>
        <div class="app-layout">
          {dev === 'desktop' && <Sidebar path={path} />}
          <div class="app-main">
            {dev === 'tablet' && <IpadBar path={path} />}
            <main class={`app-content ${showTabbar ? '' : 'no-tabbar'}`}>{content}</main>
          </div>
          {showTabbar && <MobileTabBar path={path} />}
        </div>
      </InAppShell.Provider>
    </Shell>
  );
}

function Shell(props: { children: ComponentChildren }) {
  return (
    <>
      {props.children}
      <AskDialog />
      <Toast />
      <UpdateBanner />
      <LockScreen />
    </>
  );
}
