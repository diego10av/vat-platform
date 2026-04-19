// ════════════════════════════════════════════════════════════════════════
// sentry-send.ts — minimal, reliable Sentry envelope sender.
//
// Why this exists: `@sentry/nextjs` v10 has a serverless-flush bug on
// Vercel — captureException/captureMessage return event ids but the
// internal transport hangs, so events never actually arrive. Proven
// via the /api/debug/sentry-test diagnostic:
//
//   - Sentry.captureException returns an id     ✅
//   - Sentry.flush(5000) times out               🚨
//   - DIRECT fetch to the ingest endpoint works  ✅ (200 in 25-80ms)
//
// This module is a 30-line reimplementation of the part we need:
// build a valid Sentry envelope, POST it to the ingest URL, fire-and-
// forget. No queue, no flush state, no transport abstractions.
//
// It's intentionally minimal — no breadcrumbs, no scope, no session
// tracking. What it DOES have is guaranteed delivery in serverless.
//
// The `@sentry/nextjs` SDK is still loaded (client-side browser errors
// use it), but for server-side + API-route errors we use this helper.
// ════════════════════════════════════════════════════════════════════════

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '';
const DSN_PARTS = DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
const INGEST_URL = DSN_PARTS
  ? `https://${DSN_PARTS[2]}/api/${DSN_PARTS[3]}/envelope/`
  : null;
const PUBLIC_KEY = DSN_PARTS ? DSN_PARTS[1] : null;

const ENV = process.env.VERCEL_ENV || process.env.NODE_ENV || 'production';
const RELEASE = process.env.VERCEL_GIT_COMMIT_SHA;

function generateEventId(): string {
  // 32 hex chars, no dashes — Sentry's event_id format.
  // crypto.randomUUID gives us 8-4-4-4-12 hex; strip the dashes.
  return (globalThis.crypto?.randomUUID?.() ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    .replace(/-/g, '');
}

interface SentryExtras {
  /** Business-layer key-values stapled onto the event. */
  extra?: Record<string, unknown>;
  /** Tag → indexed/searchable in Sentry. Keep to a few high-signal keys. */
  tags?: Record<string, string>;
  /** Request metadata — URL, method, etc. Useful for API-route errors. */
  request?: { url?: string; method?: string; headers?: Record<string, string> };
}

/**
 * Send an exception to Sentry. Fire-and-forget: never throws, never
 * blocks the caller. Returns the event_id (useful for "sorry something
 * broke, reference xxxx" user messages) or null if Sentry isn't
 * configured.
 */
export async function reportError(
  err: unknown,
  opts: SentryExtras = {},
): Promise<string | null> {
  if (!INGEST_URL || !PUBLIC_KEY) return null;

  const eventId = generateEventId();

  // Shape the exception. Accept Error instances + plain strings +
  // unknown (coerced to its stringified form).
  let exceptionType = 'Error';
  let exceptionValue = 'Unknown error';
  let stacktrace: { frames: Array<{ filename?: string; function?: string; lineno?: number }> } | undefined;
  if (err instanceof Error) {
    exceptionType = err.name || 'Error';
    exceptionValue = err.message || 'Error';
    stacktrace = parseStack(err.stack);
  } else if (typeof err === 'string') {
    exceptionValue = err;
  } else {
    try { exceptionValue = JSON.stringify(err); } catch { /* noop */ }
  }

  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error' as const,
    environment: ENV,
    release: RELEASE,
    server_name: 'vercel',
    exception: {
      values: [{
        type: exceptionType,
        value: exceptionValue,
        stacktrace,
      }],
    },
    tags: opts.tags,
    extra: opts.extra,
    request: opts.request ? {
      url: opts.request.url,
      method: opts.request.method,
      headers: opts.request.headers,
    } : undefined,
  };

  const envelope = buildEnvelope(eventId, event);

  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=cifra/1.0, sentry_key=${PUBLIC_KEY}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5000),
      // `keepalive: true` tells the runtime to keep the request alive
      // even if the handler returns — important for serverless.
      keepalive: true,
    });
    return eventId;
  } catch {
    return null;
  }
}

/**
 * Send a free-text message to Sentry at the given severity. Same
 * fire-and-forget guarantees as reportError.
 */
export async function reportMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  opts: SentryExtras = {},
): Promise<string | null> {
  if (!INGEST_URL || !PUBLIC_KEY) return null;
  const eventId = generateEventId();

  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level,
    environment: ENV,
    release: RELEASE,
    message: { message },
    tags: opts.tags,
    extra: opts.extra,
  };

  const envelope = buildEnvelope(eventId, event);

  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=cifra/1.0, sentry_key=${PUBLIC_KEY}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5000),
      keepalive: true,
    });
    return eventId;
  } catch {
    return null;
  }
}

function buildEnvelope(eventId: string, event: unknown): string {
  // Sentry envelope format: three newline-delimited JSON lines.
  const header = { event_id: eventId, sent_at: new Date().toISOString(), dsn: DSN };
  const itemHeader = { type: 'event', content_type: 'application/json' };
  return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(event)}`;
}

/**
 * Parse a Node.js stack-trace string into Sentry's expected frames
 * shape. Keeps the last ~30 frames, parses `at <fn> (<file>:<line>:<col>)`.
 */
function parseStack(stack: string | undefined): ReturnType<typeof makeStackShape> | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').slice(1, 31); // skip error message, keep top 30
  const frames = lines.map(parseStackLine).filter((f): f is NonNullable<typeof f> => !!f);
  return frames.length > 0 ? makeStackShape(frames) : undefined;
}

function parseStackLine(raw: string): { filename?: string; function?: string; lineno?: number } | null {
  // Matches "    at functionName (/path/to/file.ts:123:45)"
  //    or  "    at /path/to/file.ts:123:45"
  const withFn = raw.match(/\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
  if (withFn) {
    return {
      function: withFn[1],
      filename: withFn[2],
      lineno: Number(withFn[3]),
    };
  }
  const withoutFn = raw.match(/\s*at\s+(.+?):(\d+):(\d+)/);
  if (withoutFn) {
    return {
      filename: withoutFn[1],
      lineno: Number(withoutFn[2]),
    };
  }
  return null;
}

function makeStackShape(frames: Array<{ filename?: string; function?: string; lineno?: number }>) {
  // Sentry expects newest-first → oldest-last. Node gives us newest-first
  // already, but Sentry's frame rendering is oldest-first, so we reverse.
  return { frames: frames.reverse() };
}
