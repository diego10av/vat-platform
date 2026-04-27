import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, revokeSession } from '@/lib/auth';

/**
 * POST /api/auth/logout — clears the cifra_auth cookie.
 *
 * Stint 61.B (2026-04-27). Closes Diego's "habría que añadir la
 * posibilidad de hacer logout, no?" — until now the only way out was
 * deleting the cookie via DevTools.
 *
 * Server-side revokeSession() also adds the session id to an in-memory
 * deny-list so a leaked cookie can't be replayed against the same
 * server instance. (Across cold starts the deny-list resets — for a
 * persistent revoke we'd need a DB-backed store, deferred.)
 *
 * Allows GET as well so a plain anchor `<a href="/api/auth/logout">`
 * works as a fallback if JS fails for some reason. The route always
 * issues a 303 → /login redirect on GET; the JSON form on POST is for
 * client-side fetch handlers that prefer to handle redirect themselves.
 */

function clearCookie(response: NextResponse): NextResponse {
  // Set the cookie to empty + maxAge 0 so the browser drops it. Match
  // the Path / SameSite / Secure flags used at issue time so the
  // browser actually overwrites the right cookie.
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function POST(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookie) revokeSession(cookie);
  return clearCookie(NextResponse.json({ success: true }));
}

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookie) revokeSession(cookie);
  const loginUrl = new URL('/login', request.url);
  return clearCookie(NextResponse.redirect(loginUrl, 303));
}
