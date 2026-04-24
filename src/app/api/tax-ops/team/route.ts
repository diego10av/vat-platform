import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET  /api/tax-ops/team           — list all team members
// POST /api/tax-ops/team           — create { short_name, full_name?, email? }

interface TeamMember {
  id: string;
  short_name: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const rows = await query<TeamMember>(
    `SELECT id, short_name, full_name, email, is_active,
            created_at::text, updated_at::text
       FROM tax_team_members
      ORDER BY is_active DESC, short_name ASC`,
  );
  return NextResponse.json({ members: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    short_name?: string; full_name?: string; email?: string;
  };
  const short_name = body.short_name?.trim();
  if (!short_name) {
    return NextResponse.json({ error: 'short_name_required' }, { status: 400 });
  }
  const id = generateId();
  try {
    await execute(
      `INSERT INTO tax_team_members (id, short_name, full_name, email)
       VALUES ($1, $2, $3, $4)`,
      [id, short_name, body.full_name?.trim() || null, body.email?.trim() || null],
    );
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    // UNIQUE constraint on short_name — surface it cleanly
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: 'short_name_exists' }, { status: 409 });
    }
    throw e;
  }
  await logAudit({
    userId: 'founder',
    action: 'tax_team_create',
    targetType: 'tax_team_member',
    targetId: id,
    newValue: JSON.stringify({ short_name }),
  });
  return NextResponse.json({ id });
}
