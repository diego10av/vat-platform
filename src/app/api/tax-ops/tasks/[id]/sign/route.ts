import { NextRequest, NextResponse } from 'next/server';
import { execute, query, logAudit } from '@/lib/db';

// POST /api/tax-ops/tasks/[id]/sign
//   Body: { role: 'preparer'|'reviewer'|'partner', signer: string }
//
// Stint 56.A — cascading sign-off. Stamps `<role>` + `<role>_at` on
// the task. Enforces the cascade:
//
//   reviewer  requires preparer signed
//   partner   requires reviewer signed
//
// Re-signing the same role with a different signer overwrites both
// name and timestamp. Re-signing with `signer === ''` (or omitted)
// CLEARS the role — useful for an "unsign" toggle from the UI. When
// you unsign a role that has a downstream signer, downstream is also
// cleared (you can't keep partner sign-off if reviewer is gone).

const ROLE_TO_FIELDS: Record<string, { name: string; at: string; requires?: string }> = {
  preparer: { name: 'preparer',         at: 'preparer_at' },
  reviewer: { name: 'reviewer',         at: 'reviewer_at',         requires: 'preparer' },
  partner:  { name: 'partner_sign_off', at: 'partner_sign_off_at', requires: 'reviewer' },
};

const DOWNSTREAM: Record<string, string[]> = {
  preparer: ['reviewer', 'partner'],
  reviewer: ['partner'],
  partner:  [],
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as { role?: string; signer?: string };
  const role = body.role;
  const signer = (body.signer ?? '').trim();

  if (!role || !ROLE_TO_FIELDS[role]) {
    return NextResponse.json({ error: 'invalid_role' }, { status: 400 });
  }
  const cfg = ROLE_TO_FIELDS[role];

  // Fetch current state to enforce the cascade.
  const rows = await query<Record<string, string | null>>(
    `SELECT preparer, reviewer, partner_sign_off FROM tax_ops_tasks WHERE id = $1`,
    [id],
  );
  const current = rows[0];
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isUnsign = signer === '';

  if (!isUnsign && cfg.requires) {
    // Map the upstream role name → field name. preparer is its own
    // field; reviewer maps to "reviewer"; partner_sign_off field for partner.
    const upstreamField = ROLE_TO_FIELDS[cfg.requires]!.name;
    if (!current[upstreamField]) {
      return NextResponse.json(
        { error: `cascade_violation`, hint: `${role} requires ${cfg.requires} signed first` },
        { status: 409 },
      );
    }
  }

  // Build the SET clause: this role + downstream cleared on unsign.
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (isUnsign) {
    sets.push(`${cfg.name} = NULL`, `${cfg.at} = NULL`);
    for (const down of DOWNSTREAM[role]!) {
      const dCfg = ROLE_TO_FIELDS[down]!;
      sets.push(`${dCfg.name} = NULL`, `${dCfg.at} = NULL`);
    }
  } else {
    sets.push(`${cfg.name} = $${i}`); values.push(signer); i += 1;
    sets.push(`${cfg.at} = NOW()`);
  }
  sets.push(`updated_at = NOW()`);
  values.push(id);

  await execute(
    `UPDATE tax_ops_tasks SET ${sets.join(', ')} WHERE id = $${i}`,
    values,
  );

  await logAudit({
    userId: 'founder',
    action: isUnsign ? `task_unsigned_${role}` : `task_signed_${role}`,
    targetType: 'tax_ops_task',
    targetId: id,
    newValue: JSON.stringify({ role, signer: isUnsign ? null : signer }),
  });

  return NextResponse.json({ ok: true });
}
