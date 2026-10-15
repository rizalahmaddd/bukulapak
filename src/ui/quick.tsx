import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus } from 'lucide-preact';
import { SyncBadge } from './sync-badge';
import { Sheet } from './kit';
import { device } from './device';

export const InAppShell = createContext(false);

const ACTIONS = [
  { href: '#/tx/in', label: 'Uang Masuk', sub: 'Jualan, pelunasan, modal', cls: 'in', Icon: ArrowDownLeft },
  { href: '#/tx/out', label: 'Uang Keluar', sub: 'Belanja stok, biaya, gaji', cls: 'out', Icon: ArrowUpRight },
  { href: '#/tx/transfer', label: 'Pindah Saldo', sub: 'Setor bank, cairkan QRIS', cls: 'move', Icon: ArrowLeftRight },
] as const;

export function QuickActions() {
  const inApp = useContext(InAppShell);
  if (!inApp || device.value !== 'desktop') return null;
  return (
    <div class="quick-actions-bar">
      <a class="btn green" href="#/tx/in">
        <Plus size={16} aria-hidden="true" /> Masuk
      </a>
      <a class="btn red" href="#/tx/out">
        <Plus size={16} aria-hidden="true" /> Keluar
      </a>
      <a class="btn" href="#/tx/transfer">
        <ArrowLeftRight size={15} aria-hidden="true" /> Pindah
      </a>
      <span class="sep" aria-hidden="true" />
      <a href="#/settings/sync" aria-label="Status sinkronisasi">
        <SyncBadge />
      </a>
    </div>
  );
}

export function AddSheet(props: { onClose: () => void }) {
  return (
    <Sheet title="Catat Transaksi" onClose={props.onClose}>
      <div class="action-list">
        {ACTIONS.map(({ href, label, sub, cls, Icon }) => (
          <a key={href} class="action-row" href={href} onClick={props.onClose}>
            <span class={`tx-icon ${cls}`}>
              <Icon size={22} aria-hidden="true" />
            </span>
            <span class="grow">
              <div>{label}</div>
              <div class="sub">{sub}</div>
            </span>
          </a>
        ))}
      </div>
    </Sheet>
  );
}

export function AddMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div class="menu-wrap" ref={ref}>
      <button class="round-glass accent" aria-label="Catat transaksi" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={22} aria-hidden="true" />
      </button>
      {open && (
        <div class="menu" role="menu">
          {ACTIONS.map(({ href, label, cls, Icon }) => (
            <a key={href} role="menuitem" href={href} onClick={() => setOpen(false)}>
              <span class={`tx-icon ${cls}`}>
                <Icon size={18} aria-hidden="true" />
              </span>
              {label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
