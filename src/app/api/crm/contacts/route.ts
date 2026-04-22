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

  const conditions: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (lifecycle) {
    params.push(lifecycle);
    conditions.push(`lifecycle_stage = $${params.length}`);
  }
  if (engagement) {
    params.push(engagement);
    conditions.push(`COALESCE(engagement_override, engagement_level) = $${params.length}`);
  }
  params.push(limit);

  const rows = await query(
    `SELECT id, full_name, email, phone, linkedin_url, job_title, country,
            lifecycle_stage, role_tags, engagement_level, engagement_override,
            source, lead_score, next_follow_up, last_activity_at,
            created_at, updated_at
       FROM crm_contacts
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE COALESCE(engagement_override, engagement_level)
          WHEN 'active'  THEN 0
          WHEN 'dormant' THEN 1
          WHEN 'lapsed'  THEN 2
          ELSE 3
        END,
        full_name ASC
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
