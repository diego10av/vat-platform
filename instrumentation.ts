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

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Next.js (15+) calls this hook for any unhandled error in a route
// handler or server action.
//
// We used to forward to Sentry.captureRequestError / Sentry.captureException
// from @sentry/nextjs. Those functions return event ids but the SDK's
// internal transport hangs on Vercel Lambdas (diagnosed 2026-04-19 via
// the /api/debug/sentry-test diagnostic endpoint). So we bypass the SDK
// entirely and send a raw envelope over fetch — proven to work in the
// same environment.
//
// See src/lib/sentry-send.ts for the envelope logic.
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
    const { reportError } = await import('@/lib/sentry-send');
    // Normalise headers — only keep string values; Sentry rejects arrays.
    const headerMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers || {})) {
      if (typeof v === 'string') headerMap[k] = v;
    }
    await reportError(err, {
      tags: {
        route: context.routePath ?? 'unknown',
        route_type: context.routeType ?? 'unknown',
        router: context.routerKind ?? 'unknown',
      },
      request: {
        url: request.path,
        method: request.method,
        headers: headerMap,
      },
    });
  } catch {
    // Never let telemetry break request handling.
  }
}
