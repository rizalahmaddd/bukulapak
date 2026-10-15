import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { sha256Hex } from '../store/api';
import { settings } from '../store/data';
import { Lock } from 'lucide-preact';

const KEY = 'bukulapak:pin';
const LOCK_AFTER_MS = 2 * 60_000;

interface Stored {
  salt: string;
  hash: string;
}

function stored(): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function hasPin() {
  return !!stored();
}

export const locked = signal(hasPin());

export async function setPin(pin: string) {
  const salt = crypto.randomUUID();
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await sha256Hex(salt + pin) }));
}

export function clearPin() {
  localStorage.removeItem(KEY);
  locked.value = false;
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hasPin() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) locked.value = true;
});

export function LockScreen() {
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [name, setName] = useState('');
  const s = stored();
  if (!locked.value || !s) return null;
  const check = async (value: string) => {
    setPinValue(value);
    setError('');
    if (value.length >= 4 && (await sha256Hex(s.salt + value)) === s.hash) {
      locked.value = false;
      setPinValue('');
    } else if (value.length === 6) {
      setError('PIN salah');
      setPinValue('');
    }
  };
  return (
    <div class="lock">
      <div class="lock-card">
        <span class="app-icon" aria-hidden="true">
          <Lock size={28} />
        </span>
        <h2>Masukkan PIN</h2>
        <input
          class="input"
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={pin}
          onInput={(e) => void check(e.currentTarget.value.replace(/\D/g, ''))}
          aria-label="PIN"
        />
        {error && <div class="error-text">{error}</div>}
        {!forgot ? (
          <button class="btn ghost small" onClick={() => setForgot(true)}>
            Lupa PIN?
          </button>
        ) : (
          <div class="stack full">
            <div class="small muted">Ketik nama usaha persis untuk mematikan PIN.</div>
            <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} />
            <button
              class="btn block"
              disabled={!settings.value || name.trim().toLowerCase() !== settings.value.name.trim().toLowerCase()}
              onClick={() => clearPin()}
            >
              Matikan PIN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
