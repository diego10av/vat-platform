import { NextRequest, NextResponse } from 'next/server';
import { issueSessionCookie, parseAuthUsers, type Role } from '@/lib/auth';

// Per-instance rate limit. Ephemeral on cold start but slows brute-force
// while a container is warm.
const attempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface MatchResult { username: string; role: Role }

/**
 * Match (username, password) against AUTH_USERS / AUTH_PASS_<USER> env
 * vars (stint-61 model). Returns null when no entry matches.
 */
function matchUserPass(submittedUser: string, submittedPass: string): MatchResult | null {
  const entries = parseAuthUsers();
  for (const { username, role } of entries) {
    if (username !== submittedUser) continue;
    const expected = process.env[`AUTH_PASS_${username.toUpperCase()}`];
    if (!expected) continue;
    if (timingSafeEqualString(submittedPass, expected)) {
      return { username, role };
    }
    // Username matched but password didn't — keep looping in case there
    // are duplicate username entries (shouldn't happen, but defensive).
  }
  return null;
}

/**
 * Stint-11 fallback: pre-username model where the only input was a
 * password and the role was inferred from which env var matched.
 *
 *   AUTH_PASSWORD           → admin
 *   AUTH_PASSWORD_REVIEWER  → reviewer
 *   AUTH_PASSWORD_JUNIOR    → junior
 *
 * Used when AUTH_USERS is unset OR the submitted username doesn't match
 * any entry there. Keeps Diego logged in during the rollout deploy:
 * the form already sends `username='diego'` after stint 61, but env
 * vars for the new model take a moment to propagate; meanwhile the old
 * AUTH_PASSWORD continues to work.
 */
function matchLegacyPass(submittedPass: string): MatchResult | null {
  const candidates: Array<[string | undefined, Role]> = [
    [process.env.AUTH_PASSWORD, 'admin'],
    [process.env.AUTH_PASSWORD_REVIEWER, 'reviewer'],
    [process.env.AUTH_PASSWORD_JUNIOR, 'junior'],
  ];
  for (const [expected, role] of candidates) {
    if (expected && timingSafeEqualString(submittedPass, expected)) {
      // Legacy auth had no username concept — emit cookies as 'diego' so
      // the new code path treats them uniformly.
      return { username: 'diego', role };
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // Try the stint-61 model first (username + per-user password env var).
  // If that fails, try the stint-11 legacy fallback so Diego doesn't get
  // locked out while Vercel env vars roll out. Once AUTH_USERS is fully
  // configured and Diego has rotated to the new password, the legacy
  // env vars can be deleted (stint 62 cleanup).
  let match: MatchResult | null = null;
  if (username) {
    match = matchUserPass(username, password);
  }
  if (!match) {
    match = matchLegacyPass(password);
  }
  if (!match) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const cookie = await issueSessionCookie(match.username, match.role);
  const response = NextResponse.json({ success: true, username: match.username, role: match.role });
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return response;
}
