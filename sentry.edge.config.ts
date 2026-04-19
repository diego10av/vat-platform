// ════════════════════════════════════════════════════════════════════════
// Sentry — Edge runtime init.
//
// Runs in Vercel Edge (middleware, edge routes). Limited API surface
// compared to Node, so we pass a minimal config.
// ════════════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0.05,
    environment: process.env.VERCEL_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
