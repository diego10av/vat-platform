'use client';

// ════════════════════════════════════════════════════════════════════════
// Per-segment error boundary.
//
// Next.js automatically wraps every route segment with this component.
// When a render throws, React catches it and renders this instead of
// the whole app crashing to the browser's default error screen.
//
// The previous Rules-of-Hooks crash on /declarations/[id] blew up to a
// "This page could not load" screen because there was no boundary to
// catch it. This file ensures the rest of the app stays usable and
// gives the user a clear retry path.
//
// Why not Sentry? Sentry requires a paid account + env vars + client
// integration. That's a permission + cost decision for Diego. Until
// then, we log to console.error (surfaces in Vercel logs) and give the
// user the option to copy the error message for support.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangleIcon, RefreshCwIcon, HomeIcon, ClipboardIcon, CheckIcon } from 'lucide-react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Structured log for Vercel's drawer. When Sentry is wired in, this
    // is the first place we call Sentry.captureException.
    console.error('[app/error] caught render error', {
      digest: error.digest,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 6).join(' | '),
    });
  }, [error]);

  async function copyDetails() {
    const payload = [
      `Error: ${error.message}`,
      error.digest ? `Digest: ${error.digest}` : null,
      `URL: ${typeof window !== 'undefined' ? window.location.href : '(ssr)'}`,
      `Time: ${new Date().toISOString()}`,
      '',
      'Stack:',
      error.stack ?? '(no stack)',
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied — noop
    }
  }

  return (
    <div className="max-w-[640px] mx-auto mt-10 px-4">
      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-warning-50 text-warning-700 inline-flex items-center justify-center shrink-0">
            <AlertTriangleIcon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[16px] font-semibold text-ink tracking-tight">Something went wrong on this page</h1>
            <p className="text-[12.5px] text-ink-soft mt-1.5 leading-relaxed">
              The rest of the app is still working — go back home, retry this
              page, or copy the error details if you want to ask Diego to look.
            </p>

            {error.message && (
              <div className="mt-3 font-mono text-[11.5px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 break-words">
                {error.message}
                {error.digest && (
                  <div className="mt-1 text-ink-muted">digest: {error.digest}</div>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => reset()}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 transition-colors"
              >
                <RefreshCwIcon size={13} /> Retry
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-colors"
              >
                <HomeIcon size={13} /> Go home
              </Link>
              <button
                onClick={copyDetails}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-colors"
              >
                {copied ? <CheckIcon size={13} /> : <ClipboardIcon size={13} />}
                {copied ? 'Copied' : 'Copy error details'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
