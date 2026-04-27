// Stint 56.D — bulk update tasks. Mirror of the entities/bulk-update
// pattern (stint 42). Single transaction, audit-log per row.
//
// Body shape:
//   { task_ids: string[], patch: { status?, priority?, assignee?, is_starred? } }
//
// ALLOWED_FIELDS whitelist enforced server-side. Only these four can be
// bulk-set today; full-fat editing still goes through PATCH /tasks/[id].

import { NextRequest, NextResponse } from 'next/server';
import { tx, execTx, logAuditTx } from '@/lib/db';

const ALLOWED = ['status', 'priority', 'assignee', 'is_starred'] as const;
type AllowedField = typeof ALLOWED[number];

const VALID_STATUSES = new Set([
  'queued', 'in_progress', 'waiting_on_external',
  'waiting_on_internal', 'done', 'cancelled',
]);
const VALID_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);

interface Body {
  task_ids?: string[];
  patch?: Partial<Record<AllowedField, unknown>>;
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const ids = Array.isArray(body.task_ids) ? body.task_ids : null;
  const patch = body.patch ?? {};
  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: 'task_ids_required' }, { status: 400 });
  }

  // Sanitise the patch — drop any field that isn't whitelisted, run
  // basic validation per allowed field.
  const set: Array<{ field: AllowedField; value: unknown }> = [];
  for (const f of ALLOWED) {
    if (!(f in patch)) continue;
    let v: unknown = patch[f];
    if (f === 'status') {
      if (typeof v !== 'string' || !VALID_STATUSES.has(v)) {
        return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
      }
    } else if (f === 'priority') {
      if (typeof v !== 'string' || !VALID_PRIORITIES.has(v)) {
        return NextResponse.json({ error: 'invalid_priority' }, { status: 400 });
      }
    } else if (f === 'is_starred') {
      v = !!v;
    } else if (f === 'assignee') {
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
      }
    }
    set.push({ field: f, value: v });
  }
  if (set.length === 0) {
    return NextResponse.json({ error: 'patch_empty' }, { status: 400 });
  }

  // Build SET clause for the UPDATE.
  const sql = `UPDATE tax_ops_tasks SET ${set.map((s, i) => `${s.field} = $${i + 1}`).join(', ')}, updated_at = NOW()
              WHERE id = ANY($${set.length + 1}::text[])`;
  const values = [...set.map(s => s.value), ids];

  await tx(async (client) => {
    await execTx(client, sql, values);
    for (const tid of ids) {
      await logAuditTx(client, {
        userId: 'founder',
        action: 'task_bulk_update',
        targetType: 'tax_ops_task',
        targetId: tid,
        newValue: JSON.stringify(Object.fromEntries(set.map(s => [s.field, s.value]))),
      });
    }
  });

  return NextResponse.json({ ok: true, updated: ids.length });
}
