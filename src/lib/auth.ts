// Cookie-based session auth using HMAC-SHA256 via the Web Crypto API, so
// the same code works in both Node (API routes) and Edge (middleware).
//
// Cookie format (v3, introduced stint 61 — 2026-04-27):
//
//   {username}.{role}.{sessionId}.{hmacHex}
//
// where {username} matches an entry in AUTH_USERS, {role} is one of
// 'admin' | 'reviewer' | 'junior' | 'client', and {hmacHex} is the
// HMAC-SHA256 of "{username}.{role}.{sessionId}" under AUTH_SECRET.
//
// Backward compatibility:
//   • 3-part cookie (stint 11): "{role}.{sessionId}.{hmac}" → kept valid,
//     username defaults to 'diego' so legacy sessions don't break during
//     the username rollout deploy.
//   • 2-part cookie (legacy pre-stint-11): "{sessionId}.{hmac}" → kept
//     valid, role defaults to 'admin', username to 'diego'.
// On next login both legacy formats are reissued in v3.
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

// Default username assumed for legacy cookies issued before stint 61.
// Hardcoded because legacy single-tenant only ever had one human user.
const LEGACY_USERNAME = 'diego';

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
 * Validate that a username string is safe to put in a cookie payload.
 * Allow letters, digits, dot, hyphen, underscore — same restrictive set
 * as a Postgres identifier-ish. NOT a security boundary (the cookie is
 * signed regardless), just a sanity check that prevents collisions with
 * the cookie separator '.'.
 */
function isSafeUsername(u: unknown): u is string {
  return typeof u === 'string'
    && u.length > 0
    && u.length <= 32
    && /^[a-z0-9_-]+$/i.test(u);
}

/**
 * Issue a fresh session cookie for the given (username, role) pair.
 * Defaults to 'diego' / 'admin' for call sites that haven't been updated
 * (back-compat with stint-11 single-user deploys).
 */
export async function issueSessionCookie(
  username: string = LEGACY_USERNAME,
  role: Role = 'admin',
): Promise<{ name: string; value: string; maxAge: number }> {
  if (!isSafeUsername(username)) {
    throw new Error(`unsafe username: ${username}`);
  }
  const sessionId = randomSessionId();
  const payload = `${username}.${role}.${sessionId}`;
  const signature = await signPayload(payload);
  return {
    name: COOKIE_NAME,
    value: `${payload}.${signature}`,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

export interface SessionInfo {
  valid: boolean;
  username: string;
  role: Role;
  sessionId: string | null;
}

/**
 * Verify the session cookie. Returns the (username, role) pair plus
 * whether the HMAC checks out. Never throws.
 *
 * Three formats supported:
 *   • 4-part v3 (current):   username.role.sessionId.signature
 *   • 3-part v2 (stint 11):  role.sessionId.signature  → username='diego'
 *   • 2-part v1 (pre-11):    sessionId.signature       → username='diego', role='admin'
 */
export async function verifySession(raw: string | undefined | null): Promise<SessionInfo> {
  if (!raw) return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId: null };
  const parts = raw.split('.');

  // Legacy 2-part: sessionId.signature → role='admin', username='diego'
  if (parts.length === 2) {
    const [sessionId, sig] = parts;
    if (!sessionId || !sig) return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId: null };
    if (revoked.has(sessionId)) return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId };
    let expected: string;
    try { expected = await signPayload(sessionId); } catch { return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId: null }; }
    return {
      valid: timingSafeEqual(sig, expected),
      username: LEGACY_USERNAME,
      role: 'admin',
      sessionId,
    };
  }

  // Stint-11 3-part: role.sessionId.signature → username='diego'
  if (parts.length === 3) {
    const [role, sessionId, sig] = parts;
    if (!role || !sessionId || !sig || !isRole(role)) {
      return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId: null };
    }
    if (revoked.has(sessionId)) return { valid: false, username: LEGACY_USERNAME, role, sessionId };
    let expected: string;
    try { expected = await signPayload(`${role}.${sessionId}`); }
    catch { return { valid: false, username: LEGACY_USERNAME, role, sessionId: null }; }
    return {
      valid: timingSafeEqual(sig, expected),
      username: LEGACY_USERNAME,
      role,
      sessionId,
    };
  }

  // Stint-61 v3: username.role.sessionId.signature
  if (parts.length === 4) {
    const [username, role, sessionId, sig] = parts;
    if (!username || !role || !sessionId || !sig
        || !isSafeUsername(username) || !isRole(role)) {
      return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId: null };
    }
    if (revoked.has(sessionId)) return { valid: false, username, role, sessionId };
    let expected: string;
    try { expected = await signPayload(`${username}.${role}.${sessionId}`); }
    catch { return { valid: false, username, role, sessionId: null }; }
    return {
      valid: timingSafeEqual(sig, expected),
      username,
      role,
      sessionId,
    };
  }

  return { valid: false, username: LEGACY_USERNAME, role: 'admin', sessionId: null };
}

/**
 * Back-compat boolean wrapper for callers that only need a yes/no.
 * @deprecated Use verifySession() to also read the role + username.
 */
export async function verifySessionCookie(raw: string | undefined | null): Promise<boolean> {
  const info = await verifySession(raw);
  return info.valid;
}

export function revokeSession(raw: string): void {
  const parts = raw.split('.');
  let sessionId: string | null = null;
  if (parts.length === 2) sessionId = parts[0];
  else if (parts.length === 3) sessionId = parts[1];
  else if (parts.length === 4) sessionId = parts[2];
  if (sessionId) revoked.add(sessionId);
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;

// ─────────────────── Username + password directory ───────────────────
//
// Stint 61 — username/password auth.
//
// Configured via two env vars:
//
//   AUTH_USERS = "diego:admin,demo:junior"
//     Comma-separated list of "<username>:<role>" pairs. Defines who can
//     log in and what role they get. Username must match isSafeUsername().
//
//   AUTH_PASS_<UPPERCASE_USERNAME>
//     Per-username password env var. E.g. AUTH_PASS_DIEGO, AUTH_PASS_DEMO.
//     Compared against submitted password using timingSafeEqual.
//
// Stint 62 (2026-04-27) removed the stint-11 single-password legacy
// fallback. The login route at src/app/api/auth/login/route.ts now
// rejects any submission that doesn't match an AUTH_USERS entry — the
// AUTH_PASSWORD / AUTH_PASSWORD_REVIEWER / AUTH_PASSWORD_JUNIOR env
// vars are no longer read and can be deleted from Vercel. Existing
// session cookies issued under the legacy 2-/3-part formats remain
// valid via verifySession() until they expire (30 days).
//
// To rotate Diego's password: change AUTH_PASS_DIEGO in Vercel env vars
// → redeploy → next login uses the new password. Old session cookies
// stay valid until they expire (30 days) or until rotated via the
// admin /api/auth/logout-all endpoint (TODO future).

interface AuthUserEntry { username: string; role: Role }

/**
 * Parse the AUTH_USERS env var. Returns an empty array if unset or
 * malformed — in which case login is impossible (post-stint-62 there
 * is no legacy fallback). Used by the login route, /api/system, and
 * /api/health to gate the auth-configured signal.
 */
export function parseAuthUsers(): AuthUserEntry[] {
  const raw = process.env.AUTH_USERS;
  if (!raw) return [];
  const out: AuthUserEntry[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [username, role] = trimmed.split(':').map(s => s.trim());
    if (!isSafeUsername(username) || !isRole(role)) continue;
    out.push({ username, role });
  }
  return out;
}

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
