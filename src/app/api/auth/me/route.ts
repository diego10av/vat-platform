import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME } from '@/lib/auth';

/**
 * Returns the current user's username + role so client components can
 * render user-aware affordances (sidebar UserMenu, hide admin items
 * for junior, etc.). The middleware has already verified the session;
 * this endpoint just echoes the decoded payload.
 *
 * Stint 61 added `username` to the response (was role-only since
 * stint 11).
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (!session.valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ username: session.username, role: session.role });
}
