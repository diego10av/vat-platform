// Standard error envelope for every API route.
//
// Shape: { error: { code, message, hint?, details? } }
//   - code: machine-readable snake_case identifier (for telemetry + tests)
//   - message: user-facing English sentence
//   - hint: optional "what to do about it"
//   - details: optional debug payload (logged, not shown to the user)
//
// Usage in a route:
//   import { apiError, apiOk } from '@/lib/api-errors';
//   if (!ok) return apiError('entity_not_found', 'Entity does not exist.', { hint: '…' }, 404);
//
// On the client, call `describeApiError(res)` (see ui-errors.ts) to get a
// human sentence to display.

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

const log = logger.bind('api-errors');

export type ApiErrorShape = {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
};

export function apiError(
  code: string,
  message: string,
  opts?: { hint?: string; details?: unknown; status?: number }
) {
  return NextResponse.json(
    { error: { code, message, hint: opts?.hint, details: opts?.details } as ApiErrorShape },
    { status: opts?.status ?? 400 }
  );
}

export function apiOk<T extends Record<string, unknown>>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

// Convert any thrown error into the envelope. Never leak stack traces or
// database errors verbatim — those go to the structured logger, which
// forwards to stderr for Vercel's log drawer.
export function apiFail(error: unknown, where: string, status = 500) {
  const err = error as { code?: string; message?: string; stack?: string; status?: number };
  log.error('api route failed', error, {
    where,
    err_code: err.code,
  });
  return NextResponse.json(
    {
      error: {
        code: err.code || 'internal_error',
        message: err.message || 'An unexpected error occurred.',
        hint: 'Please retry. If the problem persists, contact support with the time of the error.',
      } as ApiErrorShape,
    },
    { status: err.status || status }
  );
}
