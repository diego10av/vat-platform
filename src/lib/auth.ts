// Single-user cookie auth using HMAC-SHA256 via Web Crypto, so the same
// code runs in both Node (API routes) and Edge (middleware).
//
// Cookie format: {sessionId}.{hmacHex}
// Diego is the only user; ADMIN_PASSWORD env var gates login.

const COOKIE_NAME = 'cifra_auth';
const revoked = new Set<string>();

const enc = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET not set');
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function randomSessionId(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signPayload(payload: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toHex(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSessionCookie(): Promise<{ name: string; value: string; maxAge: number }> {
  const sessionId = randomSessionId();
  const signature = await signPayload(sessionId);
  return {
    name: COOKIE_NAME,
    value: `${sessionId}.${signature}`,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

export interface SessionInfo {
  valid: boolean;
  sessionId: string | null;
}

export async function verifySession(raw: string | undefined | null): Promise<SessionInfo> {
  if (!raw) return { valid: false, sessionId: null };
  const parts = raw.split('.');
  if (parts.length !== 2) return { valid: false, sessionId: null };
  const [sessionId, sig] = parts;
  if (!sessionId || !sig) return { valid: false, sessionId: null };
  if (revoked.has(sessionId)) return { valid: false, sessionId };
  let expected: string;
  try { expected = await signPayload(sessionId); } catch { return { valid: false, sessionId: null }; }
  return { valid: timingSafeEqual(sig, expected), sessionId };
}

export async function verifySessionCookie(raw: string | undefined | null): Promise<boolean> {
  return (await verifySession(raw)).valid;
}

export function revokeSession(raw: string): void {
  const [sessionId] = raw.split('.');
  if (sessionId) revoked.add(sessionId);
}

export function verifyPassword(submitted: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(submitted, expected);
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
