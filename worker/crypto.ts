const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const keyCache = new Map<string, CryptoKey>();
async function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function hmac(secret: string, text: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(text)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(secret: string, payload: object): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken<T extends { exp: number }>(secret: string, token: string): Promise<T | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function randomId(len = 16): string {
  return b64url(crypto.getRandomValues(new Uint8Array(len)));
}

export function randomDigits(n: number): string {
  const buf = crypto.getRandomValues(new Uint32Array(n));
  return [...buf].map((v) => String(v % 10)).join('');
}

type Jwk = JsonWebKey & { kid: string };
let googleKeys: { keys: Jwk[]; until: number } | null = null;

async function loadGoogleKeys(): Promise<Jwk[]> {
  if (googleKeys && googleKeys.until > Date.now()) return googleKeys.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  googleKeys = { keys, until: Date.now() + 3600_000 };
  return keys;
}

export interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  aud: string;
  iss: string;
  exp: number;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleClaims | null> {
  const [h, p, s] = idToken.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h))) as { kid: string; alg: string };
  if (header.alg !== 'RS256') return null;
  const jwk = (await loadGoogleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), enc.encode(`${h}.${p}`));
  if (!valid) return null;
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p))) as GoogleClaims;
  if (claims.aud !== clientId) return null;
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null;
  if (claims.exp * 1000 < Date.now()) return null;
  return claims;
}
