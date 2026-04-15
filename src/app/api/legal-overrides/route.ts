import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET /api/legal-overrides
// POST /api/legal-overrides

export async function GET() {
  const rows = await query(
    `SELECT * FROM legal_overrides ORDER BY effective_date DESC, created_at DESC`
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.rule_changed || !body.new_treatment || !body.legal_basis || !body.effective_date) {
    return NextResponse.json({
      error: 'rule_changed, new_treatment, legal_basis, effective_date are required',
    }, { status: 400 });
  }

  const id = generateId();
  await execute(
    `INSERT INTO legal_overrides (id, rule_changed, new_treatment, legal_basis,
       effective_date, provider_match, description_match, justification, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'founder')`,
    [
      id, body.rule_changed, body.new_treatment, body.legal_basis,
      body.effective_date, body.provider_match || null,
      body.description_match || null, body.justification || null,
    ]
  );
  await logAudit({
    action: 'create', targetType: 'legal_override', targetId: id,
    newValue: JSON.stringify({ rule: body.rule_changed, treatment: body.new_treatment }),
  });
  return NextResponse.json({ id, success: true }, { status: 201 });
}
