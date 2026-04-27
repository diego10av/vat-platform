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
 * vars. Returns null when no entry matches.
 *
 * Stint 62 (2026-04-27) removed the stint-11 single-password legacy
 * fallback (AUTH_PASSWORD / _REVIEWER / _JUNIOR). After Diego confirmed
 * the new model works in stint 61.A, the legacy env vars are no longer
 * read; he can safely delete them from Vercel env vars.
 *
 * Existing session cookies issued under the legacy model (2-part or
 * 3-part formats) remain valid until expiry — verifySession() in
 * lib/auth.ts still accepts them. Only LOGIN is locked to the new model.
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

  const match = username ? matchUserPass(username, password) : null;
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
