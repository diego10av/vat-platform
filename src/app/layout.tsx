import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/app-shell/AppShell';
import { PostHogProvider } from '@/components/PostHogProvider';
import { ToastProvider } from '@/components/Toaster';
import { ShortcutsProvider } from '@/components/keyboard/ShortcutsProvider';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'cifra — Luxembourg tax & compliance',
  description: 'Luxembourg tax & compliance, in one workspace. AI reads, humans review. Starting with VAT.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

// ─── Stint 67.B — kill the static-prerender Suspense trap ──────────────
//
// Diagnosed live (2026-05-04): every authenticated page that uses
// `useSearchParams()` (directly, or via useListState / PostHog's
// PageviewTracker) renders its Suspense fallback as the FINAL HTML on
// fresh navigation. The HTML response ends with `<!--$?-->` (pending
// Suspense) — Next.js statically prerendered the route at build time,
// useSearchParams() suspended (no params at build time), and the
// streaming output baked the fallback in permanently. Hydration cannot
// resolve a Suspense boundary the server marked as "still pending and
// closed" — the bundle loads but the React tree stays frozen on the
// skeleton forever. Symptom Diego saw: /clients (and every other list
// page) stuck on the loading skeleton on direct visit; client-side
// SPA nav worked because that path never hits the bad SSR.
//
// The fix at page level is `export const dynamic = 'force-dynamic'`,
// but the bug afflicts ~12 pages and any future page that touches
// useSearchParams. Applying it on the root layout makes every route
// under it dynamic, so the trap can never re-emerge as the app grows.
// /marketing and /login still render correctly — they read cookies/
// headers and were never truly "static" anyway.
//
// Stint 67.A through 67.A.e tried five narrower angles (rewriting
// useListState, dropping useSearchParams, page-level force-dynamic on
// 4 pages) and reverted them all because the verification claimed
// /declarations broke too. It didn't — /declarations was *also* stuck
// on direct visits all along; testing via the sidebar (client-side
// nav) made it look fine. Doing the layout-level fix once kills the
// whole class.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="min-h-full bg-canvas text-ink antialiased">
        <PostHogProvider>
          <ToastProvider>
            <ShortcutsProvider>
              <AppShell>{children}</AppShell>
            </ShortcutsProvider>
          </ToastProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
