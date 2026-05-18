import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

const UPDATABLE_FIELDS = [
  'name', 'company_id', 'primary_contact_id', 'stage', 'practice_areas',
  'source', 'estimated_value_eur', 'probability_pct',
  'first_contact_date', 'estimated_close_date', 'actual_close_date',
  'next_action', 'next_action_due', 'loss_reason', 'won_reason',
  'bd_lawyer', 'notes', 'tags',
] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const opp = await queryOne(
    `SELECT o.*, c.company_name AS company_name, ct.full_name AS primary_contact_name
       FROM crm_opportunities o
       LEFT JOIN crm_companies c ON c.id = o.company_id
       LEFT JOIN crm_contacts ct ON ct.id = o.primary_contact_id
      WHERE o.id = $1`,
    [id],
  );
  if (!opp) return apiError('not_found', 'Opportunity not found.', { status: 404 });

  const activities = await query(
    `SELECT id, name, activity_type, activity_date, duration_hours, billable, outcome, notes
       FROM crm_activities
      WHERE opportunity_id = $1
      ORDER BY activity_date DESC`,
    [id],
  );

  return NextResponse.json({ opportunity: opp, activities });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_opportunities WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Opportunity not found.', { status: 404 });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const changed: Array<{ field: UpdatableField; before: unknown; after: unknown }> = [];
  let idx = 1;
  let stageChanged = false;

  for (const f of UPDATABLE_FIELDS) {
    if (!(f in body)) continue;
    let next = body[f];
    if (typeof next === 'string') next = next.trim() || null;
    if ((f === 'practice_areas' || f === 'tags') && !Array.isArray(next)) next = [];
    if (f === 'name' && !next) {
      return apiError('name_required', 'name cannot be empty.', { status: 400 });
    }
    // Coerce numerics.
    if ((f === 'estimated_value_eur' || f === 'probability_pct') && next !== null && next !== undefined) {
      const n = Number(next);
      if (!Number.isFinite(n)) next = null; else next = n;
    }
    const before = existing[f] ?? null;
    const beforeStr = Array.isArray(before) ? JSON.stringify(before) : String(before ?? '');
    const afterStr = Array.isArray(next) ? JSON.stringify(next) : String(next ?? '');
    if (beforeStr === afterStr) continue;
    setClauses.push(`${f} = $${idx}`);
    values.push(next);
    idx += 1;
    changed.push({ field: f, before, after: next });
    if (f === 'stage') stageChanged = true;
  }

  // Stage change → update stage_entered_at to NOW for velocity metrics.
  if (stageChanged) {
    setClauses.push(`stage_entered_at = NOW()`);
  }

  // Stint 105 — closing a deal auto-clears next_action + next_action_due.
  // Diego: "cuando una oportunidad se pierde o si ya no hay mas next
  // action deberia poder eliminar la fecha y que no me saltaran luego
  // alertas que no vienen a cuento". Without this, a deal marked
  // won/lost keeps its dangling follow-up date in the row (visually
  // confusing, even though the alert SQL already filters closed
  // stages). HubSpot/Pipedrive/Salesforce all cancel pending follow-
  // ups on close — same pattern. Body-supplied next_action / due
  // values win (Diego can explicitly set a post-close action in the
  // same PATCH if he wants).
  if (stageChanged) {
    const newStage = changed.find(c => c.field === 'stage')?.after;
    const closing = newStage === 'won' || newStage === 'lost';
    if (closing) {
      if (!('next_action' in body) && existing.next_action) {
        setClauses.push(`next_action = NULL`);
        changed.push({ field: 'next_action', before: existing.next_action, after: null });
      }
      if (!('next_action_due' in body) && existing.next_action_due) {
        setClauses.push(`next_action_due = NULL`);
        changed.push({ field: 'next_action_due', before: existing.next_action_due, after: null });
      }
    }
  }

  if (changed.length === 0) return NextResponse.json({ id, changed: [] });

  setClauses.push(`updated_at = NOW()`);
  values.push(id);
  await execute(
    `UPDATE crm_opportunities SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );

  for (const c of changed) {
    await logAudit({
      action: 'update',
      targetType: 'crm_opportunity',
      targetId: id,
      field: c.field,
      oldValue: Array.isArray(c.before) ? JSON.stringify(c.before) : String(c.before ?? ''),
      newValue: Array.isArray(c.after) ? JSON.stringify(c.after) : String(c.after ?? ''),
    });
  }

  // Stint 96 — runAutomations() removed. Stage transitions used to
  // fire 3 hard-coded rules (proposal_sent → follow-up task, won →
  // open matter task, etc). For dogfood single-user this surfaced
  // tasks Diego didn't want; the simpler signal is the stage chip
  // on /crm/opportunities itself.
  return NextResponse.json({ id, changed: changed.map(c => c.field) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM crm_opportunities WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Opportunity not found.', { status: 404 });

  // Stint 96 — hard delete. Single-user dogfood + UI confirmation
  // modal makes the soft-delete + trash bin ceremony unnecessary.
  // The audit log row remains as the historical record.
  await execute(`DELETE FROM crm_opportunities WHERE id = $1`, [id]);
  await logAudit({
    action: 'delete',
    targetType: 'crm_opportunity',
    targetId: id,
    oldValue: existing.name,
    reason: 'Deleted',
  });
  return NextResponse.json({ id, deleted: true });
}
