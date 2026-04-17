// ════════════════════════════════════════════════════════════════════════
// In-memory token-bucket rate limiter.
//
// Purpose: prevent burst abuse on expensive endpoints (primarily
// /api/agents/* which hits Anthropic). Complements — does NOT replace —
// the monthly budget guard (`budget-guard.ts`), which is the real
// cost enforcement.
//
// Design: token bucket per-key with lazy refill. Keys are typically
// `${ip}:${path}` so each caller has an independent bucket per endpoint.
// Buckets live in a module-scoped Map, evicted on idle.
//
// Trade-offs (honest):
// - NOT durable. Serverless cold starts reset the Map; a multi-region
//   deployment has one Map per instance. This is fine as a hedge, not
//   a precision tool. For true distributed rate-limiting we'd ship
//   Upstash Redis or similar — deferred pending Diego's permission +
//   cost decision.
// - No hard ceiling per-process memory. The cleanup sweep keeps it
//   bounded in practice; for a public API at scale we'd add an LRU.
// - Clock drift: uses Date.now() — fine on a single process.
//
// Default limits (tunable per-call):
// - 20 requests per 60 seconds per (ip, path) key.
// - Agent routes override with tighter numbers per-endpoint.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';

interface Bucket {
  tokens: number;
  lastRefill: number; // epoch ms
  max: number;
  windowMs: number;
}

/** Module-scoped store. Lives as long as the Node process / serverless warm container. */
const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max tokens (= max requests per window). Default 20. */
  max?: number;
  /** Window length in ms. Default 60 000. */
  windowMs?: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Remaining tokens in the bucket after this call (0 when denied). */
  remaining: number;
  /** Full bucket capacity (max tokens). */
  limit: number;
  /** Seconds until the next token is available. 0 when ok. */
  retryAfterSeconds: number;
  /** Unix ms when the bucket will be fully refilled. */
  resetAtMs: number;
}

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_MS = 60_000;

// Cleanup frequency: on roughly 1-in-100 hits we sweep old buckets.
// Cheap amortised cost; prevents unbounded growth if many unique IPs
// hit the service.
const CLEANUP_PROBABILITY = 0.01;
const CLEANUP_IDLE_MULTIPLIER = 5; // purge after 5× windowMs idle

/**
 * Consume one token for `key`. Returns `{ ok: false, retryAfterSeconds }`
 * when the bucket is empty.
 *
 * Not async — all logic is local. Safe to call on every request.
 */
export function rateLimit(key: string, opts: RateLimitOptions = {}): RateLimitResult {
  const max = opts.max ?? DEFAULT_MAX;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();

  let bucket = buckets.get(key);

  if (!bucket) {
    // First hit — bucket starts full, we take one token.
    bucket = { tokens: max - 1, lastRefill: now, max, windowMs };
    buckets.set(key, bucket);
    maybeCleanup(now);
    return {
      ok: true,
      remaining: bucket.tokens,
      limit: max,
      retryAfterSeconds: 0,
      resetAtMs: now + windowMs,
    };
  }

  // Handle dynamic limit changes on the same key (e.g. different route
  // using the same IP). Easier: just accept the current `max`/`windowMs`
  // and reconcile. Refill is proportional to elapsed time.
  bucket.max = max;
  bucket.windowMs = windowMs;

  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refill = (elapsed / windowMs) * max;
    if (refill >= 1) {
      bucket.tokens = Math.min(max, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
  }

  if (bucket.tokens < 1) {
    // Empty — compute when the next token will be available.
    const msPerToken = windowMs / max;
    const msUntilNext = Math.ceil(msPerToken - (now - bucket.lastRefill));
    const retryAfterSeconds = Math.max(1, Math.ceil(msUntilNext / 1000));
    return {
      ok: false,
      remaining: 0,
      limit: max,
      retryAfterSeconds,
      resetAtMs: bucket.lastRefill + windowMs,
    };
  }

  bucket.tokens -= 1;
  maybeCleanup(now);

  return {
    ok: true,
    remaining: Math.floor(bucket.tokens),
    limit: max,
    retryAfterSeconds: 0,
    resetAtMs: bucket.lastRefill + windowMs,
  };
}

/** Probabilistic cleanup to bound memory. Safe to call on every hit. */
function maybeCleanup(now: number): void {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  for (const [key, bucket] of buckets) {
    const idle = now - bucket.lastRefill;
    if (idle > bucket.windowMs * CLEANUP_IDLE_MULTIPLIER && bucket.tokens >= bucket.max) {
      buckets.delete(key);
    }
  }
}

/**
 * Derive a rate-limit key from an incoming request. Uses `x-forwarded-for`
 * (Vercel/Cloudflare/most proxies) with fallbacks. Path is included so
 * each endpoint has its own bucket per caller.
 */
export function keyFromRequest(request: NextRequest, scope?: string): string {
  const xff = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = (xff?.split(',')[0]?.trim()) || realIp || 'unknown';
  const path = scope ?? request.nextUrl.pathname;
  return `${ip}:${path}`;
}

/**
 * Convenience wrapper for use at the top of an API route:
 *
 *     const limited = await checkRateLimit(request, { max: 10, windowMs: 60_000 });
 *     if (!limited.ok) return limited.response;
 *
 * On success, `response` is null and the caller continues. On denial,
 * `response` is a 429 `NextResponse` ready to return.
 */
export function checkRateLimit(
  request: NextRequest,
  opts: RateLimitOptions & { scope?: string } = {}
): { ok: true; result: RateLimitResult } | { ok: false; response: Response; result: RateLimitResult } {
  const key = keyFromRequest(request, opts.scope);
  const result = rateLimit(key, opts);

  if (result.ok) return { ok: true, result };

  // 429 Too Many Requests with standard headers.
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Retry-After': String(result.retryAfterSeconds),
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': String(Math.ceil(result.resetAtMs / 1000)),
  });
  const response = new Response(
    JSON.stringify({
      error: {
        code: 'rate_limited',
        message: `Too many requests. Try again in ${result.retryAfterSeconds}s.`,
        hint: 'This endpoint hits Anthropic and is rate-limited to prevent cost spikes. Wait and retry.',
      },
    }),
    { status: 429, headers },
  );
  return { ok: false, response, result };
}

// Testing hook — lets tests reset the state deterministically.
// Not exported for production callers.
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
