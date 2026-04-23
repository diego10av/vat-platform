import { NextRequest, NextResponse } from 'next/server';
import { query, logAudit } from '@/lib/db';

// POST /api/crm/scheduled/trash-purge
//
// Weekly cron (Sunday 03:00 CET). Hard-deletes rows that have been
// in the trash for more than 30 days. The 30-day window gives Diego
// a generous safety net to restore anything deleted by mistake;
// beyond that, we reclaim the storage + keep row counts honest.
//
// Scope: only the 4 CRM tables that carry a `deleted_at` column.
// Activities, tasks, invoices, time entries + disbursements use
// hard-delete (no trash), so they're out of scope here.
//
// Idempotent + safe: each DELETE targets only rows already 30+ days
// past their tombstone. The audit_log retains the full history of
// what was purged (one row per table per run with the count).
const TABLES: Array<{ table: string; audit: string; label_sql: string }> = [
  { table: 'crm_companies',     audit: 'crm_company',     label_sql: 'company_name' },
  { table: 'crm_contacts',      audit: 'crm_contact',     label_sql: 'full_name' },
  { table: 'crm_opportunities', audit: 'crm_opportunity', label_sql: 'name' },
  { table: 'crm_matters',       audit: 'crm_matter',      label_sql: `matter_reference || ' — ' || title` },
];

const RETENTION_DAYS = 30;

export async function POST(_request: NextRequest) {
  const now = new Date();
  const purgedByTable: Record<string, number> = {};
  let total = 0;

  for (const t of TABLES) {
    // DELETE … RETURNING so we can log per-row audit entries if we
    // later want to. For now we just count — 1 audit row per table
    // keeps audit_log lean when a backlog of hundreds finally expires.
    const rows = await query<{ id: string; label: string }>(
      `DELETE FROM ${t.table}
        WHERE deleted_at IS NOT NULL
          AND deleted_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
        RETURNING id, ${t.label_sql} AS label`,
    );
    purgedByTable[t.table] = rows.length;
    total += rows.length;

    if (rows.length > 0) {
      await logAudit({
        action: 'trash_purged',
        targetType: t.audit,
        targetId: 'batch',
        field: 'permanent_delete',
        newValue: String(rows.length),
        reason: `Purged ${rows.length} ${t.table} rows older than ${RETENTION_DAYS} days`,
      });
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    retention_days: RETENTION_DAYS,
    purged_by_table: purgedByTable,
    total,
  });
}

// Allow GET for manual sanity runs.
export const GET = POST;
