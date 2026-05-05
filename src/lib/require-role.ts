// Single-user session gate for API routes that need an authenticated
// caller (cascade delete, destructive admin actions). The middleware
// already enforces session on all non-public routes; this is a defensive
// double-check inside endpoints that perform destructive work.

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME } from './auth';

/**
 * Verify the session. Returns a 401 NextResponse on failure, or null
 * on success (caller proceeds).
 *
 * Usage:
 *   const fail = await requireSession(request);
 *   if (fail) return fail;
 */
export async function requireSession(request: NextRequest): Promise<NextResponse | null> {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (!session.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
