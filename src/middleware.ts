import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME, canRoleAccess } from '@/lib/auth';

// Runs on the Edge runtime. Uses Web Crypto via @/lib/auth — the cookie is an
// HMAC-signed session id, not the raw secret.

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/api/auth/login',
]);

/**
 * Public prefixes — anything under these paths is reachable without a
 * valid cifra session cookie.
 *
 * /portal/*       → client approval portal (fund manager, no login)
 * /api/portal/*   → the endpoints the portal page calls
 * /marketing/*    → stint-11 landing page under cifracompliance.com root
 * /_landing/*     → landing assets (images, fonts)
 */
const PUBLIC_PREFIXES = ['/portal/', '/api/portal/', '/marketing/', '/_landing/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next();
  // Landing at the root (/) is public — but only when served via the
  // marketing page handler. The app's /app/page.tsx home route is
  // different. We rely on the landing being a separate subpath
  // ('/marketing' or the root subdomain). For the main app subdomain
  // (app.cifracompliance.com) the root route remains authenticated.

  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (!session.valid) {
    // For API requests, return 401 JSON rather than a redirect so callers
    // see a real error instead of the login HTML.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based deny list — currently active for 'junior' + 'client' roles
  // (see canRoleAccess in lib/auth.ts). Admin + reviewer pass.
  if (!canRoleAccess(session.role, pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'forbidden', reason: 'role_restricted' }, { status: 403 });
    }
    // Redirect junior/client to the home page with a banner flag.
    const home = new URL('/', request.url);
    home.searchParams.set('role_blocked', pathname);
    return NextResponse.redirect(home);
  }

  // Thread the role into the downstream app via a request header the
  // layout / server components can read.
  const response = NextResponse.next();
  response.headers.set('x-cifra-role', session.role);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)'],
};
