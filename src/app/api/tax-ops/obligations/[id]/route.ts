import { NextRequest, NextResponse } from 'next/server';
import { execute, logAudit, buildUpdate } from '@/lib/db';

// PATCH  /api/tax-ops/obligations/[id] — partial update (active flag, notes, assignee)
// DELETE /api/tax-ops/obligations/[id] — soft-delete: sets is_active=false so the
//                                        obligation stops appearing in matrices but
//                                        historical filings are preserved. Reversible
//                                        via PATCH is_active=true.

// Stint 43.D4 — form_code added (CIT forms 500 / 205 / 200).
const ALLOWED = ['is_active', 'default_assignee', 'notes', 'form_code'] as const;
const VALID_FORM_CODES = ['500', '205', '200'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  // form_code is whitelisted but only the 3 CIT codes are valid.
  if (body.form_code !== undefined && body.form_code !== null) {
    if (typeof body.form_code !== 'string' || !VALID_FORM_CODES.includes(body.form_code as typeof VALID_FORM_CODES[number])) {
      return NextResponse.json(
        { error: `form_code must be one of ${VALID_FORM_CODES.join(' / ')} or null` },
        { status: 400 },
      );
    }
  }
  const { sql, values, changes } = buildUpdate(
    'tax_obligations', ALLOWED, body, 'id', id, ['updated_at = NOW()'],
  );
  if (!sql) return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  await execute(sql, values);
  await logAudit({
    userId: 'founder',
    action: 'tax_obligation_update',
    targetType: 'tax_obligation',
    targetId: id,
    newValue: JSON.stringify(changes),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  await execute(
    `UPDATE tax_obligations SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await logAudit({
    userId: 'founder',
    action: 'tax_obligation_archive',
    targetType: 'tax_obligation',
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}
