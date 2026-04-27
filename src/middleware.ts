import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME, canRoleAccess } from '@/lib/auth';

// Runs on the Edge runtime. Uses Web Crypto via @/lib/auth — the cookie is an
// HMAC-signed session id, not the raw secret.

// ─────────────────── Host-based domain splitting ───────────────────
// cifracompliance.com (root + www)      → public landing page
// app.cifracompliance.com               → authenticated workspace
//
// Both domains are served by the same Next.js deployment. The middleware
// inspects the Host header and rewrites / redirects accordingly. Added
// stint 11 (2026-04-19) so visiting cifracompliance.com loads the
// landing at the root path, not "/marketing".
const ROOT_DOMAIN_HOSTS = new Set<string>([
  'cifracompliance.com',
  'www.cifracompliance.com',
]);
const APP_URL_ORIGIN = 'https://app.cifracompliance.com';

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/api/auth/login',
  '/marketing',   // exact match — prefix below covers nested paths
]);

/**
 * Public prefixes — anything under these paths is reachable without a
 * valid cifra session cookie.
 *
 * /portal/*       → client approval portal (fund manager, no login)
 * /api/portal/*   → the endpoints the portal page calls
 * /marketing/*    → stint-11 landing page (served at cifracompliance.com/
 *                   via host-based rewrite, and at app.cifracompliance.com/marketing)
 * /_landing/*     → landing assets (images, fonts)
 */
const PUBLIC_PREFIXES = ['/portal/', '/api/portal/', '/marketing/', '/_landing/'];

function handleRootDomain(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Static assets + Next.js internals pass through untouched on both domains.
  if (pathname.startsWith('/_next/') || pathname.startsWith('/_landing/')
      || pathname === '/favicon.ico' || pathname === '/favicon.svg'
      || pathname === '/robots.txt') {
    return NextResponse.next();
  }

  // Root '/' → serve the landing by rewriting to /marketing. The URL in
  // the browser stays as cifracompliance.com (no visible /marketing).
  if (pathname === '/' || pathname === '') {
    const url = request.nextUrl.clone();
    url.pathname = '/marketing';
    return NextResponse.rewrite(url);
  }

  // /marketing (either the index or nested) serves as-is.
  if (pathname === '/marketing' || pathname.startsWith('/marketing/')) {
    return NextResponse.next();
  }

  // Anything else on the root domain (e.g. /login, /clients, /api/*)
  // redirects to the equivalent path on the app subdomain. Keeps the
  // public-facing root purely the landing.
  const target = new URL(APP_URL_ORIGIN);
  target.pathname = pathname;
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 307);
}

export async function middleware(request: NextRequest) {
  // Read host without port (Vercel sends "cifracompliance.com", local dev
  // sends "localhost:3000" — strip the port for cleaner matching).
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];

  if (ROOT_DOMAIN_HOSTS.has(host)) {
    return handleRootDomain(request);
  }

  // ─────────────────── Default path: app.* or local dev ───────────────────
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next();

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

  // Thread the role + username into the downstream app via request
  // headers the layout / server components can read. Stint 61 added
  // username so future audit trails can record "who" not just "what role".
  const response = NextResponse.next();
  response.headers.set('x-cifra-role', session.role);
  response.headers.set('x-cifra-username', session.username);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)'],
};
