// ════════════════════════════════════════════════════════════════════════
// Sentry — Node server runtime init.
//
// Runs in the Vercel serverless / Node process for every request to an
// API route or Server Component. Captures thrown errors, uncaught
// rejections, and structured logger.error calls.
//
// SENTRY_DSN (server-only) overrides NEXT_PUBLIC_SENTRY_DSN if both are
// set — lets us split browser errors from server errors into separate
// Sentry projects if we ever want to. For now we use the same DSN.
// ════════════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // Don't spam Sentry with 404 / 4xx noise. Focus on actual errors.
    beforeSend(event, hint) {
      const err = hint?.originalException as { statusCode?: number } | undefined;
      if (err?.statusCode && err.statusCode < 500) return null;
      return event;
    },

    // Temporarily on while we debug the serverless-flush issue.
    // Flip back to false once events arrive in the Sentry dashboard.
    debug: true,

    // Vercel serverless: make the transport as resilient as possible.
    // Sentry's queueSize defaults to 30; we want to drain everything we
    // have before the Lambda freezes. shutdownTimeout gives the
    // transport 3s to flush on process shutdown.
    shutdownTimeout: 3000,
  });
}
