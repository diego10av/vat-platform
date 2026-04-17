// ════════════════════════════════════════════════════════════════════════
// api-client — client-side fetch with retry + error envelope + timeouts.
//
// Use this helper in React components instead of raw fetch() for any
// internal API call. You get:
//
//   - AbortController timeout (default 30s; 120s for long-running
//     endpoints like /api/agents/extract).
//   - Exponential backoff retry on transient failures (network error,
//     5xx, 429 with Retry-After, 503). NOT on 4xx that represents
//     user error (400 bad input, 401 auth, 403 forbidden, 404 not
//     found, 409 conflict) — those won't get better by retrying.
//   - Structured error parsing into the { code, message, hint }
//     envelope already used everywhere in the backend.
//   - Offline awareness: if navigator.onLine is false, returns a
//     synthesised offline error immediately without hitting the network.
//
// Use `useApiCall` hook to auto-toast errors and manage loading state.
//
// Not a replacement for every existing fetch — the component-level
// retries on the chat / feedback / share-link modals are already
// good enough. This is for new code and future rewrites where we
// want consistent behaviour.
// ════════════════════════════════════════════════════════════════════════

import type { UiError } from '@/lib/ui-errors';

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'signal'> {
  /** JSON body — will be stringified + Content-Type set. */
  body?: unknown;
  /** Timeout in ms. Default 30 000. */
  timeoutMs?: number;
  /** Max retry attempts on transient errors. Default 2 (so 3 tries total). */
  maxRetries?: number;
  /** Initial backoff in ms; doubles each retry. Default 500. */
  backoffMs?: number;
  /**
   * Caller can pass an AbortSignal to cancel from outside. The helper's
   * own timeout signal is merged with this one.
   */
  signal?: AbortSignal;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface ApiFailure {
  ok: false;
  status: number;       // 0 when the request never reached a server
  error: UiError;
  /** True when the failure is likely transient (retryable). */
  transient: boolean;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

/** Codes we consider retryable — the request is likely to succeed if we try again. */
function isTransientStatus(status: number): boolean {
  if (status === 408) return true; // Request Timeout
  if (status === 429) return true; // Too Many Requests (respect Retry-After)
  if (status === 502) return true; // Bad Gateway
  if (status === 503) return true; // Service Unavailable
  if (status === 504) return true; // Gateway Timeout
  // Generic 5xx: retryable except 501 (schema_missing — won't self-heal)
  if (status >= 500 && status !== 501) return true;
  return false;
}

function mergeSignals(external: AbortSignal | undefined, internal: AbortSignal): AbortSignal {
  if (!external) return internal;
  // If either aborts, abort combined.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (external.aborted || internal.aborted) controller.abort();
  external.addEventListener('abort', abort);
  internal.addEventListener('abort', abort);
  return controller.signal;
}

async function parseError(res: Response): Promise<UiError> {
  let code = `http_${res.status}`;
  let message = `Request failed (${res.status}).`;
  let hint: string | undefined;
  try {
    const body = await res.clone().json() as { error?: { code?: string; message?: string; hint?: string } | string };
    if (typeof body.error === 'object' && body.error !== null) {
      if (typeof body.error.code === 'string') code = body.error.code;
      if (typeof body.error.message === 'string') message = body.error.message;
      if (typeof body.error.hint === 'string') hint = body.error.hint;
    } else if (typeof body.error === 'string') {
      message = body.error;
    }
  } catch {
    // Non-JSON body — keep defaults. Try to include text if small.
    try {
      const text = await res.clone().text();
      if (text && text.length < 300) message = text;
    } catch { /* noop */ }
  }
  return hint !== undefined ? { code, message, hint } : { code, message };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Make a typed API call. Handles JSON serialisation, retries, timeouts,
 * offline detection, and error-envelope parsing.
 */
export async function apiRequest<T = unknown>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const {
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    signal: externalSignal,
    headers,
    ...rest
  } = options;

  // Offline check — return immediately without hitting the network.
  // `typeof navigator` guard is for SSR safety; this helper is client-side
  // but the check is cheap.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      status: 0,
      transient: true,
      error: {
        code: 'offline',
        message: "You're offline.",
        hint: 'Reconnect and try again.',
      },
    };
  }

  const finalHeaders: Record<string, string> = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...((headers as Record<string, string> | undefined) || {}),
  };

  let lastError: ApiFailure | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = mergeSignals(externalSignal, controller.signal);

    try {
      const res = await fetch(url, {
        ...rest,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        // Try to parse JSON, fallback to raw text.
        let data: T;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await res.json() as T;
        } else {
          data = (await res.text()) as unknown as T;
        }
        return { ok: true, status: res.status, data };
      }

      const error = await parseError(res);
      const transient = isTransientStatus(res.status);

      lastError = {
        ok: false,
        status: res.status,
        error,
        transient,
      };

      if (!transient || attempt === maxRetries) return lastError;

      // Respect Retry-After on 429, otherwise exponential backoff.
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 10_000)
        : backoffMs * Math.pow(2, attempt);
      await sleep(wait);
      attempt += 1;
    } catch (err) {
      clearTimeout(timeoutId);

      // Aborted by our timeout or by the caller?
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const aborted = isAbort && !externalSignal?.aborted; // our timeout
      const externallyAborted = isAbort && externalSignal?.aborted === true;

      if (externallyAborted) {
        return {
          ok: false,
          status: 0,
          transient: false,
          error: { code: 'cancelled', message: 'Request cancelled.' },
        };
      }

      lastError = {
        ok: false,
        status: 0,
        transient: true,
        error: aborted
          ? {
              code: 'timeout',
              message: `Request timed out after ${Math.round(timeoutMs / 1000)}s.`,
              hint: 'The server may be slow; retrying.',
            }
          : {
              code: 'network_error',
              message: err instanceof Error ? err.message : 'Network error.',
              hint: 'Check your internet connection.',
            },
      };

      if (attempt === maxRetries) return lastError;
      await sleep(backoffMs * Math.pow(2, attempt));
      attempt += 1;
    }
  }

  // Unreachable in practice, but TypeScript needs it.
  return lastError || {
    ok: false,
    status: 0,
    transient: false,
    error: { code: 'unknown', message: 'Unknown error.' },
  };
}

/**
 * Convenience: GET JSON.
 */
export function apiGet<T = unknown>(url: string, opts?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<ApiResult<T>> {
  return apiRequest<T>(url, { ...opts, method: 'GET' });
}

/**
 * Convenience: POST JSON.
 */
export function apiPost<T = unknown>(url: string, body: unknown, opts?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<ApiResult<T>> {
  return apiRequest<T>(url, { ...opts, method: 'POST', body });
}

/**
 * Convenience: PATCH JSON.
 */
export function apiPatch<T = unknown>(url: string, body: unknown, opts?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<ApiResult<T>> {
  return apiRequest<T>(url, { ...opts, method: 'PATCH', body });
}

/**
 * Convenience: DELETE.
 */
export function apiDelete<T = unknown>(url: string, opts?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<ApiResult<T>> {
  return apiRequest<T>(url, { ...opts, method: 'DELETE' });
}
