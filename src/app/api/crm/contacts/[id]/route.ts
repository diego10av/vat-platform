import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

const UPDATABLE_FIELDS = [
  'full_name', 'email', 'phone', 'linkedin_url', 'job_title', 'country',
  'preferred_language', 'lifecycle_stage', 'role_tags', 'areas_of_interest',
  'engagement_override', 'source', 'consent_status', 'consent_date',
  'consent_source', 'referred_by_contact_id', 'next_follow_up', 'notes',
  'lead_counsel', 'tags', 'birthday', 'client_anniversary',
  'pinned_notes',  // stint 64.U.3 — sticky reminders on the detail page
] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const contact = await queryOne(
    `SELECT * FROM crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!contact) return apiError('not_found', 'Contact not found.', { status: 404 });

  // Stint 64.Q.5 — companies now carry employment dates. Both
  // current (ended_at IS NULL) and historical employments are
  // returned; the UI splits them into two sections.
  const companies = await query(
    `SELECT cc.id AS junction_id,
            c.id, c.company_name, c.classification,
            cc.role, cc.is_primary,
            cc.started_at::text AS started_at,
            cc.ended_at::text   AS ended_at,
            cc.notes            AS junction_notes
       FROM crm_contact_companies cc
       JOIN crm_companies c ON c.id = cc.company_id
      WHERE cc.contact_id = $1 AND c.deleted_at IS NULL
      ORDER BY
        CASE WHEN cc.ended_at IS NULL THEN 0 ELSE 1 END,
        cc.is_primary DESC,
        cc.started_at DESC,
        c.company_name ASC`,
    [id],
  );

  const activities = await query(
    `SELECT id, name, activity_type, activity_date, duration_hours, billable, outcome
       FROM crm_activities
      WHERE primary_contact_id = $1
         OR id IN (SELECT activity_id FROM crm_activity_contacts WHERE contact_id = $1)
      ORDER BY activity_date DESC
      LIMIT 100`,
    [id],
  );

  // Stint 64.U.3 — related deals + matters surfaced in the contact
  // detail sidebar. A contact can be linked directly via
  // primary_contact_id, OR via a company they belong to (current or
  // past). For the MVP we use only the direct link + the
  // company-of-record (current employer) — partner / decision-maker
  // attribution can be added later if Diego asks.
  const opportunities = await query(
    `SELECT DISTINCT ON (o.id) o.id, o.name, o.stage, o.estimated_value_eur,
            o.weighted_value_eur, o.estimated_close_date,
            c.company_name AS client_name
       FROM crm_opportunities o
       LEFT JOIN crm_companies c ON c.id = o.company_id
      WHERE o.deleted_at IS NULL
        AND (
          o.primary_contact_id = $1
          OR o.company_id IN (
            SELECT company_id FROM crm_contact_companies
             WHERE contact_id = $1 AND ended_at IS NULL
          )
        )
      ORDER BY o.id,
        CASE o.stage
          WHEN 'in_negotiation'  THEN 0
          WHEN 'proposal_sent'   THEN 1
          WHEN 'meeting_held'    THEN 2
          WHEN 'first_touch'     THEN 3
          WHEN 'warm'            THEN 4
          WHEN 'cold_identified' THEN 5
          WHEN 'won'             THEN 6
          WHEN 'lost'            THEN 7
          ELSE 8
        END`,
    [id],
  );

  const matters = await query(
    `SELECT DISTINCT ON (m.id) m.id, m.matter_reference, m.title, m.status,
            m.practice_areas, m.opening_date, m.closing_date,
            c.company_name AS client_name
       FROM crm_matters m
       LEFT JOIN crm_companies c ON c.id = m.client_company_id
      WHERE m.deleted_at IS NULL
        AND (
          m.primary_contact_id = $1
          OR m.client_company_id IN (
            SELECT company_id FROM crm_contact_companies
             WHERE contact_id = $1 AND ended_at IS NULL
          )
        )
      ORDER BY m.id,
        CASE m.status
          WHEN 'active'   THEN 0
          WHEN 'on_hold'  THEN 1
          WHEN 'closed'   THEN 2
          WHEN 'archived' THEN 3
          ELSE 4
        END`,
    [id],
  );

  return NextResponse.json({ contact, companies, activities, opportunities, matters });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Contact not found.', { status: 404 });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const changed: Array<{ field: UpdatableField; before: unknown; after: unknown }> = [];
  let idx = 1;

  for (const f of UPDATABLE_FIELDS) {
    if (!(f in body)) continue;
    let next = body[f];
    if (typeof next === 'string') next = next.trim() || null;
    if ((f === 'role_tags' || f === 'areas_of_interest' || f === 'tags') && !Array.isArray(next)) {
      next = [];
    }
    if (f === 'full_name' && !next) {
      return apiError('full_name_required', 'full_name cannot be empty.', { status: 400 });
    }
    const before = existing[f] ?? null;
    const beforeStr = Array.isArray(before) ? JSON.stringify(before) : String(before ?? '');
    const afterStr = Array.isArray(next) ? JSON.stringify(next) : String(next ?? '');
    if (beforeStr === afterStr) continue;
    setClauses.push(`${f} = $${idx}`);
    values.push(next);
    idx += 1;
    changed.push({ field: f, before, after: next });
  }

  if (changed.length === 0) return NextResponse.json({ id, changed: [] });

  setClauses.push(`updated_at = NOW()`);
  values.push(id);
  await execute(
    `UPDATE crm_contacts SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );

  for (const c of changed) {
    await logAudit({
      action: 'update',
      targetType: 'crm_contact',
      targetId: id,
      field: c.field,
      oldValue: Array.isArray(c.before) ? JSON.stringify(c.before) : String(c.before ?? ''),
      newValue: Array.isArray(c.after) ? JSON.stringify(c.after) : String(c.after ?? ''),
    });
  }

  return NextResponse.json({ id, changed: changed.map(c => c.field) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Contact not found or already deleted.', { status: 404 });

  await execute(
    `UPDATE crm_contacts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await logAudit({
    action: 'soft_delete',
    targetType: 'crm_contact',
    targetId: id,
    oldValue: existing.full_name,
    reason: 'Moved to trash',
  });
  return NextResponse.json({ id, soft_deleted: true });
}
