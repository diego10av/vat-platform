import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// GET /api/crm/companies — list, most-recent first. Query params:
//   ?q=text          search in company_name (case-insensitive)
//   ?classification=key_account|standard|...  (optional filter)
//   ?country=LU       (optional filter)
//   ?limit=200        (default 200, max 500)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const classification = url.searchParams.get('classification');
  const country = url.searchParams.get('country');
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));

  const conditions: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`company_name ILIKE $${params.length}`);
  }
  if (classification) {
    params.push(classification);
    conditions.push(`classification = $${params.length}`);
  }
  if (country) {
    params.push(country);
    conditions.push(`country = $${params.length}`);
  }
  params.push(limit);

  const rows = await query(
    `SELECT id, company_name, country, industry, size, classification,
            website, linkedin_url, tags, entity_id, notes,
            created_at, updated_at
       FROM crm_companies
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE classification
          WHEN 'key_account'    THEN 0
          WHEN 'standard'       THEN 1
          WHEN 'occasional'     THEN 2
          WHEN 'not_yet_client' THEN 3
          ELSE 4
        END,
        company_name ASC
      LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json(rows);
}

// POST /api/crm/companies — create a new company row.
//
// Body: { company_name, country?, industry?, size?, classification?,
//         website?, linkedin_url?, tags?[], notes?, lead_counsel?, entity_id? }
// Returns: { id, ... }
//
// Required: company_name (min 1 char after trim).
// Emits audit_log 'create' with targetType='crm_company' + reason=company_name.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.company_name === 'string' ? body.company_name.trim() : '';
  if (!name) return apiError('company_name_required', 'company_name is required.', { status: 400 });

  const id = generateId();
  await execute(
    `INSERT INTO crm_companies
       (id, company_name, country, industry, size, classification,
        website, linkedin_url, tags, notes, lead_counsel, entity_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
    [
      id, name,
      body.country ?? null,
      body.industry ?? null,
      body.size ?? null,
      body.classification ?? null,
      body.website ?? null,
      body.linkedin_url ?? null,
      Array.isArray(body.tags) ? body.tags : [],
      body.notes ?? null,
      body.lead_counsel ?? null,
      body.entity_id ?? null,
    ],
  );
  await logAudit({
    action: 'create',
    targetType: 'crm_company',
    targetId: id,
    newValue: name,
    reason: 'New CRM company',
  });
  return NextResponse.json({ id, company_name: name }, { status: 201 });
}
