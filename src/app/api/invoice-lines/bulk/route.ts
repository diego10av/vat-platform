import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { TREATMENT_CODES } from '@/config/treatment-codes';

// POST /api/invoice-lines/bulk
// Body: { ids: string[], action: 'set_treatment' | 'acknowledge_flag' | 'mark_reviewed' | 'move_to_excluded', value?: string }
//
// Guards: only operates on active lines that are not locked (declaration not approved+).

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids = (body.ids as string[]) || [];
    const action = body.action as string;
    const value = body.value as string | undefined;

    if (!Array.isArray(ids) || ids.length === 0) {
      return apiError('no_ids', 'At least one line id is required.', { status: 400 });
    }
    if (ids.length > 500) {
      return apiError('too_many', 'Bulk operations are capped at 500 lines per request.', { status: 400 });
    }

    // Fetch lines + parent declaration status for lock check + entity for audit
    const rows = await query<{
      id: string; declaration_id: string; entity_id: string; decl_status: string;
    }>(
      `SELECT il.id, il.declaration_id, d2.entity_id, d2.status AS decl_status
         FROM invoice_lines il
         JOIN invoices i ON il.invoice_id = i.id
         JOIN declarations d2 ON il.declaration_id = d2.id
        WHERE il.id = ANY($1::text[])`,
      [ids]
    );
    if (rows.length === 0) return apiError('no_lines', 'No matching lines found.', { status: 404 });

    const locked = rows.filter(r => ['approved', 'filed', 'paid'].includes(r.decl_status));
    if (locked.length > 0) {
      return apiError('declaration_locked', `${locked.length} line(s) belong to approved/filed/paid declarations and can't be modified.`,
        { hint: 'Reopen the declaration first.', status: 409 });
    }

    const declId = rows[0].declaration_id;
    const entityId = rows[0].entity_id;
    let changed = 0;

    switch (action) {
      case 'set_treatment': {
        if (!value) return apiError('value_required', 'value (treatment code) is required.', { status: 400 });
        // Validate the treatment against the canonical config. The previous
        // version passed whatever string the client sent straight into SQL,
        // so a typo like "LUX_17%" would be persisted and then silently
        // excluded from every eCDF box filter.
        if (!(value in TREATMENT_CODES)) {
          return apiError('treatment_unknown',
            `Unknown treatment code "${value}".`,
            { hint: 'Pick a code from the treatment list.', status: 400 });
        }
        await execute(
          `UPDATE invoice_lines
              SET treatment = $1, treatment_source = 'manual', updated_at = NOW()
            WHERE id = ANY($2::text[])`,
          [value, ids]
        );
        changed = ids.length;
        break;
      }
      case 'acknowledge_flag': {
        await execute(
          `UPDATE invoice_lines
              SET flag_acknowledged = TRUE, updated_at = NOW()
            WHERE id = ANY($1::text[]) AND flag = TRUE`,
          [ids]
        );
        changed = ids.length;
        break;
      }
      case 'mark_reviewed': {
        await execute(
          `UPDATE invoice_lines
              SET reviewed = TRUE, state = CASE WHEN state = 'classified' THEN 'reviewed' ELSE state END,
                  updated_at = NOW()
            WHERE id = ANY($1::text[])`,
          [ids]
        );
        changed = ids.length;
        break;
      }
      case 'move_to_excluded': {
        await execute(
          `UPDATE invoice_lines
              SET state = 'deleted', deleted_at = NOW(),
                  deleted_reason = 'Moved to excluded by user (bulk)',
                  updated_at = NOW()
            WHERE id = ANY($1::text[])`,
          [ids]
        );
        changed = ids.length;
        break;
      }
      default:
        return apiError('unknown_action', `Unknown bulk action "${action}".`, { status: 400 });
    }

    await logAudit({
      entityId, declarationId: declId,
      action: 'update', targetType: 'invoice_line_bulk', targetId: `bulk-${Date.now()}`,
      field: 'bulk_action', oldValue: '',
      newValue: `${action} on ${ids.length} line(s) · value=${value ?? ''}`,
    });

    return NextResponse.json({ success: true, action, changed });
  } catch (e) { return apiFail(e, 'invoice-lines/bulk'); }
}
