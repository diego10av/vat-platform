import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// GET /api/crm/contacts — list with optional q / lifecycle / engagement filters.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const lifecycle = url.searchParams.get('lifecycle');
  const engagement = url.searchParams.get('engagement');
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));

  // Stint 64.P — column refs are prefixed with c. because the SELECT
  // joins crm_contacts with crm_contact_companies via a LATERAL.
  const conditions: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
  }
  if (lifecycle) {
    params.push(lifecycle);
    conditions.push(`c.lifecycle_stage = $${params.length}`);
  }
  if (engagement) {
    params.push(engagement);
    conditions.push(`COALESCE(c.engagement_override, c.engagement_level) = $${params.length}`);
  }
  params.push(limit);

  // Stint 64.P — denormalise the current primary company onto each
  // contact so the list view can show "Company / firm" inline.
  // The junction table doesn't track end-dates yet (planned in the
  // strategic audit follow-up), so for now we simply pick the
  // is_primary=true row, falling back to the most recently created
  // junction. When a contact changes firm today the previous junction
  // is overwritten — adding `ended_at` is part of the same audit.
  const rows = await query(
    `SELECT c.id, c.full_name, c.email, c.phone, c.linkedin_url, c.job_title,
            c.country, c.lifecycle_stage, c.role_tags, c.engagement_level,
            c.engagement_override, c.source, c.lead_score, c.next_follow_up,
            c.last_activity_at, c.created_at, c.updated_at,
            comp.id           AS primary_company_id,
            comp.company_name AS primary_company_name
       FROM crm_contacts c
       LEFT JOIN LATERAL (
         SELECT co.id, co.company_name
           FROM crm_contact_companies cc
           JOIN crm_companies co ON co.id = cc.company_id AND co.deleted_at IS NULL
          WHERE cc.contact_id = c.id
            AND cc.ended_at IS NULL                  -- stint 64.Q.5: current employer only
          ORDER BY cc.is_primary DESC, cc.started_at DESC
          LIMIT 1
       ) comp ON TRUE
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE COALESCE(c.engagement_override, c.engagement_level)
          WHEN 'active'  THEN 0
          WHEN 'dormant' THEN 1
          WHEN 'lapsed'  THEN 2
          ELSE 3
        END,
        c.full_name ASC
      LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json(rows);
}

// POST /api/crm/contacts — create contact. `full_name` required.
// Optional: company_id → auto-create a junction row (role='main_poc',
// is_primary=true) so the contact shows up under that company.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  if (!fullName) return apiError('full_name_required', 'full_name is required.', { status: 400 });

  const id = generateId();
  await execute(
    `INSERT INTO crm_contacts
       (id, full_name, email, phone, linkedin_url, job_title, country,
        preferred_language, lifecycle_stage, role_tags, areas_of_interest,
        source, consent_status, next_follow_up, notes, lead_counsel, tags,
        updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())`,
    [
      id, fullName,
      body.email ?? null,
      body.phone ?? null,
      body.linkedin_url ?? null,
      body.job_title ?? null,
      body.country ?? null,
      body.preferred_language ?? null,
      body.lifecycle_stage ?? null,
      Array.isArray(body.role_tags) ? body.role_tags : [],
      Array.isArray(body.areas_of_interest) ? body.areas_of_interest : [],
      body.source ?? null,
      body.consent_status ?? 'none',
      body.next_follow_up ?? null,
      body.notes ?? null,
      body.lead_counsel ?? null,
      Array.isArray(body.tags) ? body.tags : [],
    ],
  );

  // Optional company linkage on creation.
  if (typeof body.company_id === 'string' && body.company_id) {
    await execute(
      `INSERT INTO crm_contact_companies (id, contact_id, company_id, role, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (contact_id, company_id, role) DO NOTHING`,
      [generateId(), id, body.company_id, 'main_poc', true],
    );
  }

  await logAudit({
    action: 'create',
    targetType: 'crm_contact',
    targetId: id,
    newValue: fullName,
    reason: 'New CRM contact',
  });
  return NextResponse.json({ id, full_name: fullName }, { status: 201 });
}
