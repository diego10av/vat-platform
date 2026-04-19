// ════════════════════════════════════════════════════════════════════════
// GET /api/debug/sentry-test
//
// TEMPORARY verification endpoint. Three layers of Sentry signal:
//
//   1. Sentry.captureMessage('...')    — simplest possible event
//   2. Sentry.captureException(new Error(...)) — explicit error capture
//   3. throw new Error(...)            — unhandled, exercises onRequestError
//   (plus) await Sentry.flush()        — serverless: must flush before
//                                         the Lambda freezes or events get
//                                         dropped at the network boundary.
//
// Returns whether each step fired successfully — so the HTTP response
// itself tells us which part of the chain works vs. doesn't, without
// needing to rely on Sentry's UI to diagnose.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { reportMessage, reportError } from '@/lib/sentry-send';

export const dynamic = 'force-dynamic';

/**
 * POST-fix verification. This exercises the *new* envelope helper
 * (src/lib/sentry-send.ts) instead of the busted @sentry/nextjs SDK.
 * Both calls should return event ids that then appear in the Sentry
 * dashboard within a couple of seconds.
 */
export async function GET() {
  const diagnostics: Record<string, string | null> = {
    dsn_present: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN ? 'yes' : 'no',
    vercel_env: process.env.VERCEL_ENV ?? 'unknown',
  };

  diagnostics.message_id = await reportMessage(
    'cifra Sentry verification — envelope helper (message path)',
    'info',
    { tags: { source: 'debug-endpoint' } },
  );

  diagnostics.error_id = await reportError(
    new Error('cifra Sentry verification — envelope helper (exception path)'),
    { tags: { source: 'debug-endpoint' } },
  );

  return NextResponse.json({
    ok: true,
    message:
      'Two events sent via the envelope helper. Both should appear in Sentry within seconds. ' +
      'If they don\'t, it\'s the ingest URL or DSN (not the SDK). Remove this endpoint once verified.',
    diagnostics,
  });
}
