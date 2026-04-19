import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME } from '@/lib/auth';

/**
 * Returns the current user's role so client components can render
 * role-aware affordances (hide admin sidebar items for junior, etc.).
 * The middleware has already verified the session; this endpoint just
 * echoes the decoded role.
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (!session.valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ role: session.role });
}
