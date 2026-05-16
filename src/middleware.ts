import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME } from '@/lib/auth';

// ────────── Host-based domain split — collapsed (2026-05-16, stint 92) ──
//
// Previously: cifracompliance.com served a public landing at /marketing
// (re-introduced in the 2026-05-05 reset Fase 9). Diego decided post-
// dogfood-experience that the public surface adds attack surface
// without benefit — there's nothing to sell, no SEO purpose, and the
// fewer endpoints the better. So now:
//
//   cifracompliance.com / www.cifracompliance.com  → 308 redirect to
//                                                    app.cifracompliance.com/login
//   app.cifracompliance.com                         → the authenticated workspace
//
// The /marketing route was deleted entirely. Everything reachable from
// the root domain (favicon, robots.txt, /api/*) now redirects to the
// app subdomain — there is no longer ANY public surface on cifra-
// compliance.com. Branding strings in PDFs / User-Agent headers
// (lib/audit-trail-pdf.ts, lib/legal-watch-*.ts) are unchanged — they're
// labels, not routing.
const ROOT_DOMAIN_HOSTS = new Set<string>([
  'cifracompliance.com',
  'www.cifracompliance.com',
]);

const PUBLIC_PATHS = new Set<string>(['/login', '/api/auth/login']);

// Tag the response so the server-component AppShell can render without
// the operator chrome on public surfaces (login).
function withNoShellHeader(request: NextRequest): { request: { headers: Headers } } {
  const headers = new Headers(request.headers);
  headers.set('x-cifra-no-shell', '1');
  return { request: { headers } };
}

export async function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];

  // ───── Root domain: 308 to the app subdomain login ─────
  if (ROOT_DOMAIN_HOSTS.has(host)) {
    const target = new URL('https://app.cifracompliance.com/login');
    return NextResponse.redirect(target, 308);
  }

  // ───── Default path: app.* or local dev ─────
  const { pathname } = request.nextUrl;

  // Public paths (login) render bare (no operator chrome).
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next(withNoShellHeader(request));

  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (!session.valid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    if (pathname && pathname !== '/login' && pathname !== '/') {
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)'],
};
