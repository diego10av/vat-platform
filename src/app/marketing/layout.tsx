// Landing-page layout — deliberately lean.
//
// Served at /marketing/* and bypasses middleware auth (PUBLIC_PREFIXES
// includes '/marketing/'). No sidebar, no topbar, no auth chrome. The
// app shell's chrome belongs inside the product; the landing gets its
// own typographic identity.
//
// Stint 11 (2026-04-19): Diego's instruction — "muy top para una
// primera landing, inspirada en Factorial / Veeva / Linear / Stripe,
// sin nombre / sin about us / sin marketing distribution".

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'cifra — operating system for recurring compliance',
  description:
    'cifra is the operating system for recurring compliance for private capital structures in Europe. Tax filings, deadlines, sign-off cascade, audit trail — one workspace.',
  // No Open Graph image yet — intentional, Diego doesn't want the page
  // surfaced in link previews until he's ready to distribute.
  robots: {
    index: false,
    follow: false,
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FBFAF7] text-ink antialiased">
      {children}
    </div>
  );
}
