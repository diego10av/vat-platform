import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/app-shell/AppShell';
import { ToastProvider } from '@/components/Toaster';
import { ShortcutsProvider } from '@/components/keyboard/ShortcutsProvider';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'cifra — Luxembourg tax & compliance',
  description: 'Luxembourg tax & compliance, in one workspace. AI reads, humans review.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

// Chrome / Safari / Edge use this for the browser chrome around the
// page (toolbar tint on mobile, address bar on desktop). Matches the
// favicon background — navy primary from globals.css --color-brand-500.
export const viewport: Viewport = {
  themeColor: '#1F2D55',
};

// force-dynamic on root layout: every authenticated page using
// `useSearchParams()` would otherwise be statically prerendered and
// hang on the Suspense fallback forever (Next bakes a "still pending"
// boundary into the SSR HTML that hydration cannot resolve). Layout-
// level dynamic forces every nested route to render at request time.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="min-h-full bg-canvas text-ink antialiased">
        <ToastProvider>
          <ShortcutsProvider>
            <AppShell>{children}</AppShell>
          </ShortcutsProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
