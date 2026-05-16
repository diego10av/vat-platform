import { NextRequest, NextResponse } from 'next/server';
import { issueSessionCookie, verifyPassword } from '@/lib/auth';
import { execute } from '@/lib/db';

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

/**
 * Stint 91 — append a row to auth_login_log (mig 091) for every
 * attempt. Wrapped in try/catch so a DB hiccup never blocks login.
 */
async function logLoginAttempt(
  ip: string,
  userAgent: string | null,
  success: boolean,
  failureReason: string | null,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO auth_login_log (ip, user_agent, success, failure_reason)
       VALUES ($1, $2, $3, $4)`,
      [ip, userAgent, success, failureReason],
    );
  } catch {
    // Intentionally swallow — auth is more important than audit. The
    // attempt still goes through; observability gap will surface if
    // login_log starts looking sparse vs. real traffic.
  }
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = request.headers.get('user-agent');

  if (!checkRateLimit(ip)) {
    await logLoginAttempt(ip, userAgent, false, 'rate_limited');
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let body: { password?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const password = typeof body.password === 'string' ? body.password : '';

  if (!verifyPassword(password)) {
    await logLoginAttempt(ip, userAgent, false, 'bad_password');
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const cookie = await issueSessionCookie();
  const response = NextResponse.json({ success: true });
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: cookie.maxAge,
  });
  await logLoginAttempt(ip, userAgent, true, null);
  return response;
}
