// Cookie-based session auth using HMAC-SHA256 via the Web Crypto API, so
// the same code works in both Node (API routes) and Edge (middleware).
//
// Cookie format (v2, introduced stint 11 — 2026-04-19):
//
//   {role}.{sessionId}.{hmacHex}
//
// where {role} is one of 'admin' | 'reviewer' | 'junior' | 'client' and
// {hmacHex} is the HMAC-SHA256 of "{role}.{sessionId}" under AUTH_SECRET.
//
// Backward compatibility: cookies without a role prefix (i.e. just
// "{sessionId}.{hmac}") are accepted as role='admin' — that's what
// every cookie issued before stint 11 is. On next login the cookie is
// re-issued in the new format.
//
// Previous design stored AUTH_SECRET as the cookie value. A leak would
// have compromised the platform permanently. Now the secret never
// leaves the server; the cookie carries only signed ids.

const COOKIE_NAME = 'cifra_auth';
const revoked = new Set<string>();

const enc = new TextEncoder();

export type Role = 'admin' | 'reviewer' | 'junior' | 'client';
const VALID_ROLES: readonly Role[] = ['admin', 'reviewer', 'junior', 'client'] as const;
const isRole = (x: unknown): x is Role =>
  typeof x === 'string' && (VALID_ROLES as readonly string[]).includes(x);

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
  // base64url
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

/**
 * Issue a fresh session cookie for the given role. Defaults to 'admin'
 * for call sites that haven't been updated yet (back-compat).
 */
export async function issueSessionCookie(
  role: Role = 'admin',
): Promise<{ name: string; value: string; maxAge: number }> {
  const sessionId = randomSessionId();
  const payload = `${role}.${sessionId}`;
  const signature = await signPayload(payload);
  return {
    name: COOKIE_NAME,
    value: `${payload}.${signature}`,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

export interface SessionInfo {
  valid: boolean;
  role: Role;
  sessionId: string | null;
}

/**
 * Verify the session cookie. Returns the role (admin default for
 * legacy 2-part cookies) and whether the HMAC checks out. Never
 * throws.
 */
export async function verifySession(raw: string | undefined | null): Promise<SessionInfo> {
  if (!raw) return { valid: false, role: 'admin', sessionId: null };
  const parts = raw.split('.');

  // Legacy 2-part format: sessionId.signature — treat role='admin'
  if (parts.length === 2) {
    const [sessionId, sig] = parts;
    if (!sessionId || !sig) return { valid: false, role: 'admin', sessionId: null };
    if (revoked.has(sessionId)) return { valid: false, role: 'admin', sessionId };
    let expected: string;
    try { expected = await signPayload(sessionId); } catch { return { valid: false, role: 'admin', sessionId: null }; }
    return { valid: timingSafeEqual(sig, expected), role: 'admin', sessionId };
  }

  // New 3-part format: role.sessionId.signature
  if (parts.length === 3) {
    const [role, sessionId, sig] = parts;
    if (!role || !sessionId || !sig || !isRole(role)) {
      return { valid: false, role: 'admin', sessionId: null };
    }
    if (revoked.has(sessionId)) return { valid: false, role, sessionId };
    let expected: string;
    try { expected = await signPayload(`${role}.${sessionId}`); }
    catch { return { valid: false, role, sessionId: null }; }
    return { valid: timingSafeEqual(sig, expected), role, sessionId };
  }

  return { valid: false, role: 'admin', sessionId: null };
}

/**
 * Back-compat boolean wrapper for callers that only need a yes/no.
 * @deprecated Use verifySession() to also read the role.
 */
export async function verifySessionCookie(raw: string | undefined | null): Promise<boolean> {
  const info = await verifySession(raw);
  return info.valid;
}

export function revokeSession(raw: string): void {
  const parts = raw.split('.');
  const sessionId = parts.length === 2 ? parts[0] : parts.length === 3 ? parts[1] : null;
  if (sessionId) revoked.add(sessionId);
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;

// ─────────────────── Route-level role gating ───────────────────
// Used by middleware.ts to decide whether a given role can visit
// a given path. The default is PERMISSIVE (admin + reviewer can
// hit everything); the strict list below is the junior's deny list
// — pages a final client would NOT see.
//
// The 'client' role is reserved for a future multi-tenant flow; today
// it inherits junior's restrictions.

const JUNIOR_DENIED_PREFIXES: readonly string[] = [
  '/settings',          // full /settings tree (classifier, logs, users, feedback)
  '/metrics',           // API cost dashboard
  '/legal-watch',       // legal-sources review surface
  '/legal-overrides',   // manual overrides table
  '/audit',             // raw audit-log explorer
  '/registrations',     // pending-registration lifecycle list
  '/api/metrics',       // cost endpoints
  '/api/users',         // user management
  '/api/feedback',      // feedback admin triage
  '/api/legal-overrides',
  '/api/app-logs',      // logger explorer
];

/**
 * Can `role` visit `pathname`? Returns true when the path is allowed,
 * false when it's role-restricted.
 */
export function canRoleAccess(role: Role, pathname: string): boolean {
  if (role === 'admin' || role === 'reviewer') return true;
  // junior + client → apply deny list
  return !JUNIOR_DENIED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}
