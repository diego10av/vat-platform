import { NextRequest, NextResponse } from 'next/server';
import { execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// Map target types → table name. Keeps the handler generic without
// dynamic SQL magic. Supports soft-delete-enabled tables only.
const TABLES: Record<string, { table: string; audit: string }> = {
  crm_company:     { table: 'crm_companies',     audit: 'crm_company' },
  crm_contact:     { table: 'crm_contacts',      audit: 'crm_contact' },
  crm_opportunity: { table: 'crm_opportunities', audit: 'crm_opportunity' },
  crm_matter:      { table: 'crm_matters',       audit: 'crm_matter' },
};

// POST /api/crm/bulk — operate on multiple records at once.
// Body: {
//   target_type: 'crm_company' | ...,
//   ids: string[],
//   op: 'soft_delete' | 'add_tag' | 'remove_tag',
//   tag?: string   // required when op is add_tag / remove_tag
// }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const targetType = body.target_type;
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : [];
  const op = body.op;

  if (!targetType || !TABLES[targetType]) {
    return apiError('invalid_target_type',
      `target_type must be one of: ${Object.keys(TABLES).join(', ')}`,
      { status: 400 });
  }
  if (ids.length === 0) {
    return apiError('no_ids', 'ids must be a non-empty array.', { status: 400 });
  }
  if (ids.length > 500) {
    return apiError('too_many', 'max 500 ids per bulk operation.', { status: 400 });
  }

  const cfg = TABLES[targetType];

  if (op === 'soft_delete') {
    await execute(
      `UPDATE ${cfg.table}
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
      [ids],
    );
    for (const id of ids) {
      await logAudit({
        action: 'soft_delete',
        targetType: cfg.audit,
        targetId: id,
        reason: 'Bulk delete',
      });
    }
    return NextResponse.json({ op: 'soft_delete', affected: ids.length });
  }

  if (op === 'add_tag' || op === 'remove_tag') {
    const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
    if (!tag) return apiError('tag_required', 'tag is required for add_tag / remove_tag.', { status: 400 });

    if (op === 'add_tag') {
      await execute(
        `UPDATE ${cfg.table}
            SET tags = CASE
                         WHEN $1 = ANY(COALESCE(tags, '{}'::text[])) THEN tags
                         ELSE array_append(COALESCE(tags, '{}'::text[]), $1)
                       END,
                updated_at = NOW()
          WHERE id = ANY($2::text[]) AND deleted_at IS NULL`,
        [tag, ids],
      );
    } else {
      await execute(
        `UPDATE ${cfg.table}
            SET tags = array_remove(COALESCE(tags, '{}'::text[]), $1),
                updated_at = NOW()
          WHERE id = ANY($2::text[]) AND deleted_at IS NULL`,
        [tag, ids],
      );
    }

    for (const id of ids) {
      await logAudit({
        action: 'update',
        targetType: cfg.audit,
        targetId: id,
        field: 'tags',
        newValue: `${op === 'add_tag' ? '+' : '-'}${tag}`,
        reason: `Bulk ${op}`,
      });
    }
    return NextResponse.json({ op, affected: ids.length, tag });
  }

  return apiError('invalid_op', `op must be one of: soft_delete, add_tag, remove_tag`, { status: 400 });
}
