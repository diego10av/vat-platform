// ════════════════════════════════════════════════════════════════════════
// Next.js instrumentation hook.
//
// Next looks for this file at the project root and calls `register()`
// exactly once per runtime at startup. We use it to load the correct
// Sentry config for whichever runtime we're in (nodejs vs edge).
//
// The browser-side init lives in sentry.client.config.ts which Next
// auto-injects into the client bundle.
// ════════════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Next.js (15+) calls this hook for any unhandled error in a route
// handler or server action. We forward to Sentry.captureRequestError
// (the SDK v10 export). Wrapped so it no-ops if Sentry is absent.
export async function onRequestError(
  err: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  try {
    const captureFn = (Sentry as unknown as {
      captureRequestError?: (err: unknown, req: unknown, ctx: unknown) => void;
    }).captureRequestError;
    if (typeof captureFn === 'function') {
      captureFn(err, request, context);
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // Never let telemetry break request handling.
  }
}
