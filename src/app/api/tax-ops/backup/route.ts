import { NextRequest } from 'next/server';
import { query } from '@/lib/db';

// GET /api/tax-ops/backup?include_audit=1
//
// Stint 42 — point-in-time JSON snapshot of every Tax-Ops table.
// Diego clicks "Download now" in Settings; the browser receives a
// single JSON file with everything he needs to reconstruct the
// state of the world if something catastrophic happens (corrupt
// migration, accidental wipe, etc.).
//
// This is NOT a SQL dump — it's a developer-friendly JSON aimed at
// Diego eyeballing it / re-importing manually if needed. For a real
// SQL dump use Supabase's PITR / `pg_dump`.
//
// Tables included (always): tax_client_groups, tax_entities,
// tax_obligations, tax_filings, tax_ops_tasks, tax_deadline_rules,
// tax_team_members.
//
// Optional (?include_audit=1): every audit_log row whose target_type
// starts with 'tax_'. Big — probably MB-scale once we've been
// running a year — so opt-in only.

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const includeAudit = url.searchParams.get('include_audit') === '1';

  const [groups, entities, obligations, filings, tasks, rules, team] = await Promise.all([
    query(`SELECT * FROM tax_client_groups ORDER BY name`),
    query(`SELECT * FROM tax_entities ORDER BY legal_name`),
    query(`SELECT * FROM tax_obligations ORDER BY entity_id, tax_type, period_pattern`),
    query(`SELECT * FROM tax_filings ORDER BY obligation_id, period_year, period_label`),
    query(`SELECT * FROM tax_ops_tasks ORDER BY created_at DESC`),
    query(`SELECT * FROM tax_deadline_rules ORDER BY tax_type, period_pattern`),
    query(`SELECT * FROM tax_team_members ORDER BY short_name`),
  ]);

  let auditLog: unknown[] = [];
  if (includeAudit) {
    auditLog = await query(
      `SELECT * FROM audit_log
        WHERE target_type LIKE 'tax_%'
           OR action LIKE 'tax_%'
        ORDER BY created_at DESC`,
    );
  }

  const snapshot = {
    snapshot_at: new Date().toISOString(),
    cifra_version: 'tax-ops/v1',
    counts: {
      tax_client_groups: groups.length,
      tax_entities: entities.length,
      tax_obligations: obligations.length,
      tax_filings: filings.length,
      tax_ops_tasks: tasks.length,
      tax_deadline_rules: rules.length,
      tax_team_members: team.length,
      audit_log: includeAudit ? auditLog.length : 'omitted',
    },
    tables: {
      tax_client_groups: groups,
      tax_entities: entities,
      tax_obligations: obligations,
      tax_filings: filings,
      tax_ops_tasks: tasks,
      tax_deadline_rules: rules,
      tax_team_members: team,
      ...(includeAudit ? { audit_log: auditLog } : {}),
    },
  };

  const filename = `cifra-tax-ops-${new Date().toISOString().slice(0, 10)}${includeAudit ? '-with-audit' : ''}.json`;

  return new Response(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
