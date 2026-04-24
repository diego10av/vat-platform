#!/usr/bin/env tsx
// ════════════════════════════════════════════════════════════════════════
// scripts/tax-ops-family-cleanup.ts  (stint 40.B)
//
// One-shot cleanup of families that aren't really families — they were
// tax-type abbreviations that got mistakenly promoted to groups during
// the stint-34 Excel import.
//
// Today's targets: CTR (Corporate Tax Return, 81 entities) and FCR
// (3 entities). The entities underneath are duplicates of entities that
// already exist in real client families (MILL REEF, AVALLON, BLUE SEA,
// BLACKPEAK, etc.); the dedup tool in stint 40.A surfaces those pairs
// for merging. This script just removes the fake group labels so the
// family UI stops showing bogus groupings.
//
// NOTE: This cleanup was already run via Supabase MCP execute_sql on
// 2026-04-24, with an audit_log entry. This script is kept in the repo
// for posterity + so future abbreviation-family mistakes can reuse it.
//
// Usage:
//   tsx scripts/tax-ops-family-cleanup.ts --dry-run
//   tsx scripts/tax-ops-family-cleanup.ts --commit
// ════════════════════════════════════════════════════════════════════════

import { tx, query, qTx, execTx, generateId, logAuditTx } from '../src/lib/db';

const FAKE_FAMILY_NAMES = new Set(['CTR', 'CSR', 'FCR', 'VAT', 'WHT', 'NWT', 'BCL', 'NWTR']);

interface GroupRow {
  id: string;
  name: string;
  entity_count: string;  // Postgres COUNT comes back as string
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const commit = args.includes('--commit');

  if (!dryRun && !commit) {
    console.error('Pass --dry-run or --commit.');
    process.exit(1);
  }

  const rows = await query<GroupRow>(
    `SELECT g.id, g.name,
            (SELECT COUNT(*)::text FROM tax_entities e WHERE e.client_group_id = g.id) AS entity_count
       FROM tax_client_groups g
      WHERE g.name = ANY($1::text[])`,
    [Array.from(FAKE_FAMILY_NAMES)],
  );

  if (rows.length === 0) {
    console.log('No fake-family groups found. Nothing to do.');
    return;
  }

  console.log(`Found ${rows.length} fake-family group(s):`);
  for (const g of rows) console.log(`  · ${g.name}  — ${g.entity_count} entities`);

  if (dryRun) {
    console.log('\nDry-run only. Pass --commit to execute.');
    return;
  }

  await tx(async (client) => {
    for (const g of rows) {
      // Unassign entities first
      await execTx(client,
        `UPDATE tax_entities SET client_group_id = NULL, updated_at = NOW()
          WHERE client_group_id = $1`,
        [g.id],
      );
      // Delete the group
      await execTx(client, `DELETE FROM tax_client_groups WHERE id = $1`, [g.id]);
      console.log(`  ✓ ${g.name}: unassigned ${g.entity_count} entities and deleted group.`);
    }
    await logAuditTx(client, {
      userId: 'script',
      action: 'tax_client_group_bulk_delete',
      targetType: 'tax_client_group',
      targetId: rows.map(r => r.name).join('+'),
      newValue: JSON.stringify({
        script: 'tax-ops-family-cleanup',
        stint: '40.B',
        groups_deleted: rows.map(r => r.name),
        entities_unassigned_total: rows.reduce((s, r) => s + Number(r.entity_count), 0),
      }),
    });
  });

  console.log('\nDone.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
