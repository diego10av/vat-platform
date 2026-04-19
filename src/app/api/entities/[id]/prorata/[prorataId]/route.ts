// ════════════════════════════════════════════════════════════════════════
// PATCH  /api/entities/[id]/prorata/[prorataId] — update a pro-rata row
// DELETE /api/entities/[id]/prorata/[prorataId] — remove one
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const VALID_METHODS = ['general', 'direct', 'sector'] as const;

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; prorataId: string }> },
) {
  try {
    const { id: entityId, prorataId } = await params;
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM entity_prorata WHERE id = $1 AND entity_id = $2`,
      [prorataId, entityId],
    );
    if (!existing) return apiError('not_found', 'Pro-rata row not found.', { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (body.period_start !== undefined) {
      if (!isIsoDate(body.period_start)) return apiError('bad_period_start', 'YYYY-MM-DD required.', { status: 400 });
      sets.push(`period_start = $${i++}`); vals.push(body.period_start);
    }
    if (body.period_end !== undefined) {
      if (!isIsoDate(body.period_end)) return apiError('bad_period_end', 'YYYY-MM-DD required.', { status: 400 });
      sets.push(`period_end = $${i++}`); vals.push(body.period_end);
    }
    if (body.method !== undefined) {
      if (!(VALID_METHODS as readonly string[]).includes(body.method as string)) {
        return apiError('bad_method', `one of ${VALID_METHODS.join(', ')}`, { status: 400 });
      }
      sets.push(`method = $${i++}`); vals.push(body.method);
    }
    for (const f of ['ratio_num', 'ratio_denom', 'ratio_pct'] as const) {
      if (body[f] === undefined) continue;
      if (body[f] === null) {
        sets.push(`${f} = NULL`);
      } else {
        const n = Number(body[f]);
        if (!Number.isFinite(n) || n < 0) return apiError(`bad_${f}`, `${f} must be a non-negative number.`, { status: 400 });
        if (f === 'ratio_pct' && n > 100) return apiError('bad_ratio_pct', 'ratio_pct must be 0..100.', { status: 400 });
        sets.push(`${f} = $${i++}`); vals.push(n);
      }
    }
    if (body.basis !== undefined) {
      sets.push(`basis = $${i++}`);
      vals.push(typeof body.basis === 'string' ? body.basis.trim() || null : null);
    }
    if (body.notes !== undefined) {
      sets.push(`notes = $${i++}`);
      vals.push(typeof body.notes === 'string' ? body.notes.trim() || null : null);
    }

    // If num/denom are being set and ratio_pct wasn't explicitly given,
    // re-derive the rounded-up percentage.
    if ((body.ratio_num !== undefined || body.ratio_denom !== undefined) && body.ratio_pct === undefined) {
      const row = await queryOne<{ ratio_num: string | null; ratio_denom: string | null }>(
        `SELECT ratio_num::text AS ratio_num, ratio_denom::text AS ratio_denom FROM entity_prorata WHERE id = $1`,
        [prorataId],
      );
      const num = body.ratio_num !== undefined ? Number(body.ratio_num) : Number(row?.ratio_num);
      const denom = body.ratio_denom !== undefined ? Number(body.ratio_denom) : Number(row?.ratio_denom);
      if (Number.isFinite(num) && Number.isFinite(denom) && denom > 0) {
        const pct = Math.max(0, Math.min(100, Math.ceil((num / denom) * 100 - 0.005)));
        sets.push(`ratio_pct = $${i++}`); vals.push(pct);
      }
    }

    if (sets.length === 0) return apiError('no_changes', 'Nothing to update.', { status: 400 });

    vals.push(prorataId);
    await execute(`UPDATE entity_prorata SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    await logAudit({
      entityId,
      action: 'update',
      targetType: 'entity_prorata',
      targetId: prorataId,
      newValue: JSON.stringify(body),
    });

    return apiOk({ ok: true });
  } catch (err) {
    return apiFail(err, 'prorata/patch');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; prorataId: string }> },
) {
  try {
    const { id: entityId, prorataId } = await params;
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM entity_prorata WHERE id = $1 AND entity_id = $2`,
      [prorataId, entityId],
    );
    if (!existing) return apiError('not_found', 'Pro-rata row not found.', { status: 404 });

    await execute(`DELETE FROM entity_prorata WHERE id = $1`, [prorataId]);
    await logAudit({
      entityId,
      action: 'delete',
      targetType: 'entity_prorata',
      targetId: prorataId,
    });
    return apiOk({ ok: true });
  } catch (err) {
    return apiFail(err, 'prorata/delete');
  }
}
