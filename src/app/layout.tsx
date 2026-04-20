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
