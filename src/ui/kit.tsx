import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { ChevronLeft, X, Delete } from 'lucide-preact';
import { QuickActions } from './quick';
import { back } from './router';
import { num, rp, normalizePhone, displayPhone } from '../domain/util';
import type { Contact } from '../domain/types';
import { contacts, save } from '../store/data';
import { ulid } from '../domain/util';
import { config } from '../store/api';

export function TopBar(props: { title: string; backTo?: string | false; right?: ComponentChildren; subtitle?: string; large?: boolean }) {
  const large = props.large ?? props.backTo === false;
  return (
    <header class={`topbar ${large ? 'large' : ''}`}>
      {props.backTo !== false && (
        <button class="back" aria-label="Kembali" onClick={() => back(props.backTo || '/')}>
          <ChevronLeft size={26} strokeWidth={2.4} aria-hidden="true" />
          <span>Kembali</span>
        </button>
      )}
      <div class="grow">
        {props.subtitle && <div class="subtitle ellipsis">{props.subtitle}</div>}
        <h1 class="title">{props.title}</h1>
      </div>
      {props.right && <div class="actions-slot">{props.right}</div>}
      <QuickActions />
    </header>
  );
}

export function Money(props: { v: number; sign?: boolean; class?: string }) {
  const cls = props.sign ? (props.v > 0 ? 'pos' : props.v < 0 ? 'neg' : '') : '';
  return <span class={`${cls} tabular-nums ${props.class ?? ''}`}>{props.sign && props.v > 0 ? '+' : ''}{rp(props.v)}</span>;
}

export function Sheet(props: { onClose: () => void; title: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return props.onClose();
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (x) => !x.hasAttribute('disabled'),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
        <div class="grabber" aria-hidden="true" />
        <div class="sheet-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" aria-label="Tutup" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

interface AskOptions {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
}

const asking = signal<(AskOptions & { resolve: (ok: boolean) => void }) | null>(null);

/** In-app replacement for window.confirm(); resolves true only when the user taps the confirm button. */
export function ask(opts: AskOptions): Promise<boolean> {
  return new Promise((resolve) => (asking.value = { ...opts, resolve }));
}

export function AskDialog() {
  const a = asking.value;
  if (!a) return null;
  const close = (ok: boolean) => {
    asking.value = null;
    a.resolve(ok);
  };
  return (
    <Sheet title={a.title} onClose={() => close(false)}>
      {a.body && <p class="small muted">{a.body}</p>}
      <div class="stack tight">
        <button class={`btn block large ${a.danger ? 'red' : 'primary'}`} onClick={() => close(true)}>
          {a.confirm}
        </button>
        <button class="btn block" onClick={() => close(false)}>
          Batal
        </button>
      </div>
    </Sheet>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
  full?: boolean;
  scroll?: boolean;
  class?: string;
}) {
  return (
    <div class={`segmented ${props.full ? 'full' : ''} ${props.scroll ? 'scroll' : ''} ${props.class ?? ''}`} role="group" aria-label={props.label}>
      {props.options.map(([v, label]) => (
        <button key={String(v)} type="button" class={props.value === v ? 'on' : ''} aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const updateReady = signal(false);

export function UpdateBanner() {
  if (!updateReady.value) return null;
  return (
    <div class="toast update" role="status">
      <span>Versi baru tersedia.</span>
      <button class="btn small" onClick={() => location.reload()}>
        Muat ulang
      </button>
    </div>
  );
}

export const toastMsg = signal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  toastMsg.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = null), 3000);
}

export function Toast() {
  return toastMsg.value ? (
    <div class="toast" role="status" key={toastMsg.value}>
      {toastMsg.value}
    </div>
  ) : null;
}

const QUICK_ADD: [number, string][] = [
  [10_000, '+10rb'],
  [20_000, '+20rb'],
  [50_000, '+50rb'],
  [100_000, '+100rb'],
];

export function AmountPad(props: { value: number; onChange: (v: number) => void; label?: string }) {
  // Fast taps can land before a re-render, so track the latest value outside of props.
  const latest = useRef(props.value);
  latest.current = props.value;
  const set = (next: number) => {
    latest.current = next;
    props.onChange(next);
  };
  const press = (k: string) => {
    const s = String(latest.current || '');
    if (k === '⌫') return set(Number(s.slice(0, -1)) || 0);
    const digits = s + k;
    if (digits.length > 12) return;
    set(Number(digits) || 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && t.closest('input, textarea, select, [contenteditable]'))) return;
      if (document.querySelector('.sheet-backdrop')) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="stack">
      {props.label && <div class="amount-label">{props.label}</div>}
      <div class={`amount-display ${props.value ? '' : 'is-empty'}`} aria-live="polite">
        <span class="cur">Rp</span>
        <span class="val">{num(props.value)}</span>
      </div>
      <div class="amount-quick">
        {QUICK_ADD.map(([val, label]) => (
          <button key={label} type="button" class="chip" onClick={() => set((latest.current || 0) + val)}>
            {label}
          </button>
        ))}
        {props.value > 0 && (
          <button type="button" class="chip reset" aria-label="Reset nominal" title="Reset" onClick={() => set(0)}>
            <X size={15} strokeWidth={2.6} aria-hidden="true" />
          </button>
        )}
      </div>
      <div class="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'DEL'].map((k) => (
          <button
            type="button"
            class={`key ${k === '000' || k === 'DEL' ? 'fn' : ''}`}
            key={k}
            onClick={() => press(k === 'DEL' ? '⌫' : k)}
            aria-label={k === 'DEL' ? 'Hapus' : k}
          >
            {k === 'DEL' ? <Delete size={22} aria-hidden="true" /> : k}
          </button>
        ))}
      </div>
      <div class="keyboard-hint hint center">Bisa langsung ketik angka di keyboard.</div>
    </div>
  );
}

export function MoneyInput(props: { value: number; onChange: (v: number) => void; label: string; hint?: string; autoFocus?: boolean }) {
  return (
    <label class="field">
      {props.label}
      <input
        class="input tabular-nums"
        inputMode="numeric"
        autoFocus={props.autoFocus}
        value={props.value ? num(props.value) : ''}
        placeholder="0"
        onInput={(e) => {
          const digits = (e.currentTarget.value || '').replace(/\D/g, '');
          props.onChange(digits ? Math.min(Number(digits), 999_999_999_999) : 0);
        }}
      />
      {props.hint && <span class="hint">{props.hint}</span>}
    </label>
  );
}

export function ContactPicker(props: {
  role: Contact['role'];
  value: string | null;
  onChange: (id: string | null, draft?: { name: string; phone?: string }) => void;
  label: string;
  draft?: { name: string; phone?: string };
}) {
  const [q, setQ] = useState(props.draft?.name ?? '');
  const [phone, setPhone] = useState(props.draft?.phone ?? '');
  const selected = contacts.value.find((c) => c.id === props.value);
  const term = q.trim().toLowerCase();
  const matches = term
    ? contacts.value.filter((c) => c.name.toLowerCase().includes(term) || (c.phone ?? '').includes(term.replace(/^0/, '62'))).slice(0, 5)
    : [];
  if (selected) {
    return (
      <div class="stack tight">
        <span class="eyebrow">{props.label}</span>
        <div class="row picked">
          <span class="avatar" aria-hidden="true">{selected.name.slice(0, 1).toUpperCase()}</span>
          <div class="grow">
            <div class="bold ellipsis">{selected.name}</div>
            {selected.phone && <div class="tiny muted">{displayPhone(selected.phone)}</div>}
          </div>
          <button type="button" class="btn small" onClick={() => props.onChange(null)}>
            Ganti
          </button>
        </div>
      </div>
    );
  }
  return (
    <div class="stack">
      <label class="field">
        {props.label}
        <input
          class="input"
          value={q}
          placeholder="Ketik nama"
          onInput={(e) => {
            setQ(e.currentTarget.value);
            props.onChange(null, { name: e.currentTarget.value, phone });
          }}
        />
      </label>
      {matches.length > 0 && (
        <div class="chips">
          {matches.map((c) => (
            <button type="button" class="chip" key={c.id} onClick={() => props.onChange(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {term && (
        <label class="field">
          No. WhatsApp (opsional)
          <input
            class="input"
            inputMode="tel"
            value={phone}
            placeholder="08xx"
            onInput={(e) => {
              setPhone(e.currentTarget.value);
              props.onChange(null, { name: q, phone: e.currentTarget.value });
            }}
          />
        </label>
      )}
    </div>
  );
}

export async function resolveContact(id: string | null, draft: { name: string; phone?: string } | undefined, role: Contact['role']) {
  if (id) return id;
  const name = draft?.name.trim();
  if (!name) return null;
  const phone = normalizePhone(draft?.phone);
  const same = contacts.value.find((c) => c.name.toLowerCase() === name.toLowerCase() && (c.phone ?? '') === (phone ?? ''));
  if (same) return same.id;
  const c: Contact = { id: ulid(), type: 'contact', name, ...(phone ? { phone } : {}), role, updatedAt: Date.now() };
  await save(c);
  return c.id;
}

let turnstileLoading: Promise<void> | null = null;
function loadTurnstile() {
  turnstileLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
  return turnstileLoading;
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
    google?: {
      accounts: {
        id: {
          initialize: (opts: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export function Turnstile(props: { onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = config.value?.turnstileSiteKey;
  useEffect(() => {
    if (!siteKey) return;
    let id: string | undefined;
    void loadTurnstile().then(() => {
      if (ref.current && window.turnstile) id = window.turnstile.render(ref.current, { sitekey: siteKey, callback: props.onToken, language: 'id' });
    });
    return () => id && window.turnstile?.remove(id);
  }, [siteKey]);
  return siteKey ? <div ref={ref} /> : null;
}

let gsiLoading: Promise<void> | null = null;
function loadGsi() {
  gsiLoading ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
  return gsiLoading;
}

export function GoogleButton(props: { onCredential: (c: string) => void; text?: 'signin_with' | 'continue_with' }) {
  const ref = useRef<HTMLDivElement>(null);
  const clientId = config.value?.googleClientId;
  useEffect(() => {
    if (!clientId) return;
    void loadGsi().then(() => {
      if (!ref.current || !window.google) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => props.onCredential(r.credential) });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 300, text: props.text ?? 'continue_with', locale: 'id' });
    });
  }, [clientId]);
  return clientId ? <div ref={ref} class="row" style="justify-content:center;min-height:44px" /> : null;
}

export function Empty(props: { children: ComponentChildren; icon?: ComponentChildren }) {
  return (
    <div class="empty">
      {props.icon && <div class="empty-icon">{props.icon}</div>}
      <div>{props.children}</div>
    </div>
  );
}

export function waLink(phone: string | undefined, text: string) {
  const p = normalizePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}
