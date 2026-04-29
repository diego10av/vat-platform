import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const stage = url.searchParams.get('stage');
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));

  const conditions: string[] = ['o.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`o.name ILIKE $${params.length}`);
  }
  if (stage) {
    params.push(stage);
    conditions.push(`o.stage = $${params.length}`);
  }
  params.push(limit);

  const rows = await query(
    `SELECT o.id, o.name, o.stage, o.stage_entered_at, o.practice_areas,
            o.estimated_value_eur, o.probability_pct, o.weighted_value_eur,
            o.first_contact_date, o.estimated_close_date, o.next_action, o.next_action_due,
            c.company_name AS company_name, c.id AS company_id,
            ct.full_name AS primary_contact_name, ct.id AS primary_contact_id
       FROM crm_opportunities o
       LEFT JOIN crm_companies c ON c.id = o.company_id
       LEFT JOIN crm_contacts ct ON ct.id = o.primary_contact_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY
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
        END,
        o.estimated_close_date ASC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json(rows);
}

// POST /api/crm/opportunities — create an opportunity. Requires `name` + `stage`.
// Default stage = 'cold_identified' (stint 64.Q.7 — Outreach merged in).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return apiError('name_required', 'name is required.', { status: 400 });

  const id = generateId();
  const stage = typeof body.stage === 'string' ? body.stage : 'cold_identified';
  await execute(
    `INSERT INTO crm_opportunities
       (id, name, company_id, primary_contact_id, stage, stage_entered_at,
        practice_areas, source, estimated_value_eur, probability_pct,
        first_contact_date, estimated_close_date, next_action, next_action_due,
        bd_lawyer, notes, tags, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
    [
      id, name,
      body.company_id ?? null,
      body.primary_contact_id ?? null,
      stage,
      Array.isArray(body.practice_areas) ? body.practice_areas : [],
      body.source ?? null,
      body.estimated_value_eur ?? null,
      body.probability_pct ?? null,
      body.first_contact_date ?? null,
      body.estimated_close_date ?? null,
      body.next_action ?? null,
      body.next_action_due ?? null,
      body.bd_lawyer ?? null,
      body.notes ?? null,
      Array.isArray(body.tags) ? body.tags : [],
    ],
  );
  await logAudit({
    action: 'create',
    targetType: 'crm_opportunity',
    targetId: id,
    newValue: name,
    reason: `New opportunity (stage=${stage})`,
  });
  return NextResponse.json({ id, name, stage }, { status: 201 });
}
