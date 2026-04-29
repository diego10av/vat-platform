import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// ════════════════════════════════════════════════════════════════════════
// /api/crm/contacts/[id]/companies — stint 64.Q.5
//
// Manages a contact's employment history.
//
// POST  → switch firms: close the current employment (ended_at = today)
//         and open a new junction row to the supplied company_id.
//         Body: { company_id, role?, is_primary?, started_at?, notes? }
// PATCH → edit a junction row in place (e.g. correct a wrong start
//         date, mark a past employment ended, fix the role).
//         Body: { junction_id, started_at?, ended_at?, role?, is_primary? }
//
// Why a separate endpoint: the contact PUT only updates fields on
// crm_contacts; firm changes have to fan out to a different table
// AND need history-preserving semantics (don't overwrite). Keeping
// them here makes the audit log entries clean ("contact_company_
// switch" vs "contact_update").
// ════════════════════════════════════════════════════════════════════════

interface SwitchBody {
  company_id?: string;
  role?: string;
  is_primary?: boolean;
  started_at?: string;
  notes?: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params;
  const body = await request.json().catch(() => ({})) as SwitchBody;
  const companyId = typeof body.company_id === 'string' ? body.company_id : '';
  if (!companyId) return apiError('company_id_required', 'company_id is required.', { status: 400 });

  const role = typeof body.role === 'string' && body.role ? body.role : 'main_poc';
  const isPrimary = body.is_primary === false ? false : true;
  const startedAt = typeof body.started_at === 'string' && body.started_at
    ? body.started_at
    : new Date().toISOString().slice(0, 10);

  // Close every current employment for this contact: set ended_at =
  // (newStartedAt - 1 day) so the timeline reads cleanly without
  // overlapping windows. We don't lose data — the row stays, just
  // gets a closing date.
  await execute(
    `UPDATE crm_contact_companies
        SET ended_at = ($2::date - INTERVAL '1 day')::date
      WHERE contact_id = $1 AND ended_at IS NULL`,
    [contactId, startedAt],
  );

  // Open the new employment.
  const newJunctionId = generateId();
  await execute(
    `INSERT INTO crm_contact_companies
       (id, contact_id, company_id, role, is_primary, started_at, ended_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
     ON CONFLICT (contact_id, company_id, role) DO UPDATE
       SET started_at = EXCLUDED.started_at,
           ended_at   = NULL,
           is_primary = EXCLUDED.is_primary,
           notes      = EXCLUDED.notes`,
    [newJunctionId, contactId, companyId, role, isPrimary, startedAt, body.notes ?? null],
  );

  await logAudit({
    userId: 'founder',
    action: 'contact_company_switch',
    targetType: 'crm_contact',
    targetId: contactId,
    newValue: JSON.stringify({ company_id: companyId, role, started_at: startedAt }),
  });

  return NextResponse.json({ ok: true, junction_id: newJunctionId });
}

interface PatchBody {
  junction_id?: string;
  started_at?: string | null;
  ended_at?: string | null;
  role?: string;
  is_primary?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params;
  const body = await request.json().catch(() => ({})) as PatchBody;
  const junctionId = typeof body.junction_id === 'string' ? body.junction_id : '';
  if (!junctionId) return apiError('junction_id_required', 'junction_id is required.', { status: 400 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (body.started_at !== undefined) { sets.push(`started_at = $${i++}`); vals.push(body.started_at); }
  if (body.ended_at !== undefined)   { sets.push(`ended_at   = $${i++}`); vals.push(body.ended_at); }
  if (body.role !== undefined)       { sets.push(`role       = $${i++}`); vals.push(body.role); }
  if (body.is_primary !== undefined) { sets.push(`is_primary = $${i++}`); vals.push(body.is_primary); }
  if (sets.length === 0) return apiError('empty_patch', 'No fields to update.', { status: 400 });

  vals.push(junctionId, contactId);
  await execute(
    `UPDATE crm_contact_companies
        SET ${sets.join(', ')}
      WHERE id = $${i++} AND contact_id = $${i++}`,
    vals,
  );

  await logAudit({
    userId: 'founder',
    action: 'contact_company_edit',
    targetType: 'crm_contact',
    targetId: contactId,
    newValue: JSON.stringify({ junction_id: junctionId, ...body }),
  });

  return NextResponse.json({ ok: true });
}
