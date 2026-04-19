// ════════════════════════════════════════════════════════════════════════
// GET  /api/entities/[id]/prorata — list pro-rata configurations for this entity
// POST /api/entities/[id]/prorata — create a new pro-rata row for a period
//
// One pro-rata row = (entity × period × methodology). A declaration
// picks the row whose period overlaps its reporting period. See
// docs/classification-research.md §2 for the legal scaffolding
// (Art. 50 LTVA + Art. 49§2 non-EU exception).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, queryOne, execute, generateId, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const VALID_METHODS = ['general', 'direct', 'sector'] as const;

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?entity_prorata["']? does not exist/i.test(msg);
}

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await query(
      `SELECT id, entity_id,
              period_start::text AS period_start,
              period_end::text AS period_end,
              method, ratio_num::float8 AS ratio_num,
              ratio_denom::float8 AS ratio_denom,
              ratio_pct::float8 AS ratio_pct,
              basis, notes,
              created_at::text AS created_at,
              updated_at::text AS updated_at
         FROM entity_prorata
        WHERE entity_id = $1
        ORDER BY period_start DESC`,
      [id],
    );
    return apiOk({ prorata: rows });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiOk({ prorata: [], schema_missing: true });
    }
    return apiFail(err, 'prorata/list');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: entityId } = await params;
    const entity = await queryOne<{ id: string }>('SELECT id FROM entities WHERE id = $1', [entityId]);
    if (!entity) return apiError('not_found', 'Entity not found.', { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (!isIsoDate(body.period_start)) return apiError('bad_period_start', 'period_start must be YYYY-MM-DD.', { status: 400 });
    if (!isIsoDate(body.period_end)) return apiError('bad_period_end', 'period_end must be YYYY-MM-DD.', { status: 400 });
    if (body.period_end < body.period_start) return apiError('bad_period', 'period_end must be on or after period_start.', { status: 400 });

    const method = typeof body.method === 'string' && (VALID_METHODS as readonly string[]).includes(body.method)
      ? (body.method as typeof VALID_METHODS[number])
      : null;
    if (!method) return apiError('bad_method', `method must be one of: ${VALID_METHODS.join(', ')}`, { status: 400 });

    // For general: ratio_num + ratio_denom expected (number or null).
    // For direct/sector: ratio_pct expected.
    let ratioNum: number | null = null;
    let ratioDenom: number | null = null;
    let ratioPct: number | null = null;

    if (method === 'general') {
      if (body.ratio_num !== undefined && body.ratio_num !== null) {
        ratioNum = Number(body.ratio_num);
        if (!Number.isFinite(ratioNum) || ratioNum < 0) return apiError('bad_ratio_num', 'ratio_num must be a non-negative number.', { status: 400 });
      }
      if (body.ratio_denom !== undefined && body.ratio_denom !== null) {
        ratioDenom = Number(body.ratio_denom);
        if (!Number.isFinite(ratioDenom) || ratioDenom < 0) return apiError('bad_ratio_denom', 'ratio_denom must be a non-negative number.', { status: 400 });
      }
      if (ratioNum != null && ratioDenom != null && ratioDenom > 0) {
        // Derive ratio_pct rounded-up whole percentage.
        ratioPct = Math.max(0, Math.min(100, Math.ceil((ratioNum / ratioDenom) * 100 - 0.005)));
      }
    }

    if (body.ratio_pct !== undefined && body.ratio_pct !== null) {
      const p = Number(body.ratio_pct);
      if (!Number.isFinite(p) || p < 0 || p > 100) return apiError('bad_ratio_pct', 'ratio_pct must be 0..100.', { status: 400 });
      ratioPct = p;
    }

    const basis = typeof body.basis === 'string' ? body.basis.trim() || null : null;
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

    const id = `ep-${generateId().slice(0, 10)}`;
    await execute(
      `INSERT INTO entity_prorata
         (id, entity_id, period_start, period_end, method,
          ratio_num, ratio_denom, ratio_pct, basis, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, entityId, body.period_start, body.period_end, method,
       ratioNum, ratioDenom, ratioPct, basis, notes],
    );

    await logAudit({
      entityId,
      action: 'create',
      targetType: 'entity_prorata',
      targetId: id,
      newValue: JSON.stringify({
        period_start: body.period_start, period_end: body.period_end,
        method, ratio_pct: ratioPct,
      }),
    });

    return apiOk({ id, ratio_pct: ratioPct });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Apply migration 011 first.', { status: 501 });
    }
    return apiFail(err, 'prorata/create');
  }
}
