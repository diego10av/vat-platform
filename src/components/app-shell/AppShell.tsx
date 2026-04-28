// Stint 64.D — AppShell is now a Server Component that decides whether
// to render the operator chrome (sidebar + topbar) based on a header
// the middleware sets. The actual UI (badges, chat drawer, feedback
// widget, sidebar, topbar) lives in AppShellInner.tsx — a client
// component.
//
// Why server-side gate:
//   • The previous client-side check used `usePathname()` against a
//     BARE_ROUTES allowlist. That failed for the root-domain rewrite:
//     when a visitor hit `cifracompliance.com/`, middleware rewrote to
//     /marketing but `usePathname()` returned `/`, so the allowlist
//     never matched and the operator sidebar leaked onto the public
//     landing. Diego: "todavía sigo viendo la sidebar y lo de arriba."
//   • A server-component gate reads request headers (`x-cifra-no-shell`
//     set by middleware) BEFORE any client JS runs. No flash, no
//     hydration-time mismatch, no leak.

import { headers } from 'next/headers';
import { AppShellInner } from './AppShellInner';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const h = await headers();
  if (h.get('x-cifra-no-shell') === '1') {
    // Public surface (landing / login / portal). Render content only;
    // each surface brings its own minimal layout chrome (e.g. the
    // marketing sticky top-nav, the login card frame).
    return <>{children}</>;
  }
  return <AppShellInner>{children}</AppShellInner>;
}
