import { signal } from '@preact/signals';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown>) {
    super(code);
  }
}

export interface PublicConfig {
  googleClientId: string | null;
  turnstileSiteKey: string | null;
  adminWa: string | null;
  signup: 'open' | 'waitlist' | 'closed';
}

export const config = signal<PublicConfig | null>(null);

const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<{ data: T; res: Response }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${apiBase}/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? 'network'), data);
  return { data: data as T, res };
}

export async function loadConfig() {
  try {
    config.value = (await api<PublicConfig>('/config')).data;
  } catch {
    /* offline: auth screens show an offline message */
  }
  return config.value;
}

const enc = new TextEncoder();

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export const PBKDF2_ITERATIONS = 600_000;

export async function derivePasswordKey(password: string, salt: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS }, base, 256);
  return hex(bits);
}

export function newSalt(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export async function recoveryVerifier(code: string) {
  return sha256Hex(code.replace(/[^0-9A-Za-z]/g, '').toUpperCase());
}
