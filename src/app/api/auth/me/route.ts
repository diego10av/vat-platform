import { NextRequest, NextResponse } from 'next/server';
import { verifySession, AUTH_COOKIE_NAME } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (!session.valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ authenticated: true });
}
