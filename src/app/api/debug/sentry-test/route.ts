// ════════════════════════════════════════════════════════════════════════
// GET /api/debug/sentry-test
//
// TEMPORARY verification endpoint. Throws an intentional error so we
// can confirm Sentry is wired correctly + receiving events from the
// production deploy. Remove once verified.
//
// Not gated by auth on purpose — we want the test to work even without
// logging in (it's a dumb single endpoint, not a surface for actual
// app data). Once Sentry is verified, delete this route.
// ════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export async function GET() {
  // Unhandled throw — Next's onRequestError hook in instrumentation.ts
  // forwards to Sentry.captureRequestError which reports the event.
  throw new Error(
    'Sentry test from cifra (intentional). ' +
    'If you see this in Sentry → /issues, the wiring is correct. ' +
    'This endpoint will be removed after verification.',
  );
}
