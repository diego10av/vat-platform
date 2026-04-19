import { NextRequest, NextResponse } from 'next/server';
import { issueSessionCookie, type Role } from '@/lib/auth';

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

/**
 * Match the submitted password against configured role passwords.
 *
 *   AUTH_PASSWORD           → role 'admin'  (Diego, full access)
 *   AUTH_PASSWORD_REVIEWER  → role 'reviewer' (internal colleague)
 *   AUTH_PASSWORD_JUNIOR    → role 'junior' (client-facing view only)
 *
 * Returns null when no configured password matches.
 */
function matchRole(submitted: string): Role | null {
  const candidates: Array<[string | undefined, Role]> = [
    [process.env.AUTH_PASSWORD, 'admin'],
    [process.env.AUTH_PASSWORD_REVIEWER, 'reviewer'],
    [process.env.AUTH_PASSWORD_JUNIOR, 'junior'],
  ];
  for (const [expected, role] of candidates) {
    if (expected && timingSafeEqualString(submitted, expected)) return role;
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

  let body: { password?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const password = typeof body.password === 'string' ? body.password : '';

  const role = matchRole(password);
  if (!role) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const cookie = await issueSessionCookie(role);
  const response = NextResponse.json({ success: true, role });
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return response;
}
