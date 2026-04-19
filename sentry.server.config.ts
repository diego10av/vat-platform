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

    debug: false,

    // ══════════════════════════════════════════════════════════════════
    // Serverless flush fix (2026-04-19 diagnostic session)
    //
    // Symptom: captureMessage/captureException returned event ids but
    //   Sentry.flush(5000) always timed out. Events never arrived.
    // Diagnosis: a direct fetch to the Sentry ingest endpoint from the
    //   same Lambda returned 200 in 81ms — so network is fine, but the
    //   default @sentry/nextjs transport (Node's http module) hangs
    //   between Vercel Lambda invocations.
    // Fix: force the fetch-based transport instead. Vercel's runtime
    //   fetch has proper lifecycle hooks for serverless; HTTP connections
    //   don't leak across freeze/thaw boundaries.
    // ══════════════════════════════════════════════════════════════════
    transport: Sentry.makeFetchTransport,

    // shutdownTimeout: how long the SDK waits for the transport to drain
    // when the process is shutting down. 3s is aggressive but gives the
    // fetch transport time to finish in-flight POSTs.
    shutdownTimeout: 3000,
  });
}
