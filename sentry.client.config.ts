// ════════════════════════════════════════════════════════════════════════
// Sentry — browser runtime init.
//
// Runs in the user's browser when pages load. Captures JS errors,
// unhandled promise rejections, and React error boundary triggers.
//
// Activates ONLY when NEXT_PUBLIC_SENTRY_DSN is set in the env. With
// the variable missing (local dev, staging without Sentry, fresh
// deploys before Diego pastes the DSN), this is a complete no-op —
// no network calls, no perf overhead, no warnings.
//
// See also:
//   - sentry.server.config.ts  — Node runtime (API routes, RSC)
//   - sentry.edge.config.ts    — Edge runtime (middleware / edge routes)
//   - instrumentation.ts       — loads the two above based on runtime
// ════════════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,

    // Tracing — sample 10% of transactions in production, 100% in dev.
    // Keeps Sentry cost down while still giving signal on hot paths.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Session Replay — disabled for now. Client data (invoice contents,
    // provider names) is sensitive. We can turn it on with
    // replaysSessionSampleRate + network & DOM masking once we have a
    // Sentry org-wide DPA signed.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    // Don't send events for the Next dev overlay's own errors (they're
    // noisy and not cifra's problem).
    ignoreErrors: [
      /Hydration failed/i,
      /NEXT_NOT_FOUND/i,
      /NEXT_REDIRECT/i,
    ],

    // Low-priority debug output in dev only.
    debug: false,
  });
}
