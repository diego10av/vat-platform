import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';
import { nextMatterReference } from '@/lib/crm-matter-number';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));

  const conditions: string[] = ['m.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(m.matter_reference ILIKE $${params.length} OR m.title ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`m.status = $${params.length}`);
  }
  params.push(limit);

  const rows = await query(
    `SELECT m.id, m.matter_reference, m.title, m.status, m.practice_areas,
            m.fee_type, m.hourly_rate_eur, m.opening_date, m.closing_date,
            m.conflict_check_done,
            c.company_name AS client_name, c.id AS client_id,
            (SELECT COALESCE(SUM(amount_incl_vat), 0) FROM crm_billing_invoices WHERE matter_id = m.id) AS total_billed,
            (SELECT COALESCE(SUM(duration_hours), 0) FROM crm_activities WHERE matter_id = m.id) AS total_hours
       FROM crm_matters m
       LEFT JOIN crm_companies c ON c.id = m.client_company_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE m.status
          WHEN 'active'   THEN 0
          WHEN 'on_hold'  THEN 1
          WHEN 'closed'   THEN 2
          WHEN 'archived' THEN 3
          ELSE 4
        END,
        m.opening_date DESC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json(rows);
}

// POST /api/crm/matters — create a matter.
// - `title` required.
// - `matter_reference` auto-generated (MP-YYYY-NNNN) unless explicitly
//   provided (useful when importing historic matters with established refs).
// - `status` defaults to 'active'.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return apiError('title_required', 'title is required.', { status: 400 });

  const matterRef = typeof body.matter_reference === 'string' && body.matter_reference.trim()
    ? body.matter_reference.trim()
    : await nextMatterReference();

  const id = generateId();
  await execute(
    `INSERT INTO crm_matters
       (id, matter_reference, title, client_company_id, primary_contact_id,
        source_opportunity_id, status, practice_areas, fee_type, hourly_rate_eur,
        opening_date, closing_date, conflict_check_done, conflict_check_date,
        lead_counsel, team_members, documents_link, notes, tags,
        estimated_budget_eur, cap_eur, counterparty_name, related_parties,
        conflict_check_result, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,NOW())`,
    [
      id, matterRef, title,
      body.client_company_id ?? null,
      body.primary_contact_id ?? null,
      body.source_opportunity_id ?? null,
      body.status ?? 'active',
      Array.isArray(body.practice_areas) ? body.practice_areas : [],
      body.fee_type ?? null,
      body.hourly_rate_eur ?? null,
      body.opening_date ?? null,
      body.closing_date ?? null,
      body.conflict_check_done ?? false,
      body.conflict_check_date ?? null,
      body.lead_counsel ?? null,
      Array.isArray(body.team_members) ? body.team_members : [],
      body.documents_link ?? null,
      body.notes ?? null,
      Array.isArray(body.tags) ? body.tags : [],
      body.estimated_budget_eur ?? null,
      body.cap_eur ?? null,
      body.counterparty_name ?? null,
      Array.isArray(body.related_parties) ? body.related_parties : [],
      body.conflict_check_result ? JSON.stringify(body.conflict_check_result) : null,
    ],
  );
  await logAudit({
    action: 'create',
    targetType: 'crm_matter',
    targetId: id,
    newValue: matterRef,
    reason: `New matter: ${title}`,
  });
  return NextResponse.json({ id, matter_reference: matterRef, title }, { status: 201 });
}
