// ════════════════════════════════════════════════════════════════════════
// scripts/backfill-entity-families — stint 51.B
//
// Diego: "en Corporate Tax Returns hay un montón de entidades sin
// familia. Y creo que sí que conoces tú la familia. No sé si podrías
// hacerme una primera tentativa e incluirme la familia de todas estas
// empresas, porque hay un montón sin familia y creo que tú sí que lo
// sabes."
//
// Heuristic matcher: for each active entity with client_group_id IS NULL,
// match the legal_name prefix against a curated list of known group
// patterns. Print a dry-run plan; apply with --apply.
//
//   npm run backfill-families            # dry-run
//   npm run backfill-families -- --apply # execute in single transaction
//
// Entities that don't match any pattern stay in UNGROUPED so Diego sees
// them clearly and can re-assign manually if needed.
// ════════════════════════════════════════════════════════════════════════

import { query, tx, execTx, logAuditTx } from '../src/lib/db';

const APPLY = process.argv.includes('--apply');

interface EntityRow {
  id: string;
  legal_name: string;
}

interface GroupRow {
  id: string;
  name: string;
}

// ─── Pattern table ──────────────────────────────────────────────────────
//
// Each entry: { regex (case-insensitive on legal_name), target group name }.
// Order matters — first match wins. Specific patterns (e.g. "MRC") come
// before generic prefix patterns ("Mill" → MILL REEF).
const PATTERNS: Array<{ match: RegExp; group: string; reason: string }> = [
  { match: /^Ilanga\b/i,                     group: 'C-INVESTMENTS', reason: 'Ilanga branch lives in C-INVESTMENTS' },
  { match: /^Mill Reef\b/i,                  group: 'MILL REEF',     reason: 'Mill Reef prefix' },
  { match: /^Mill Capital Magnolia\b/i,      group: 'MILL REEF',     reason: 'Mill Capital Magnolia → Mill Reef family (likely typo)' },
  { match: /^MRC\b/i,                        group: 'MILL REEF',     reason: 'MRC = Mill Reef Capital sub-vehicle' },
  { match: /^Portobello\b/i,                 group: 'PORTOBELLO',    reason: 'Portobello prefix' },
  { match: /^TTGV\b/i,                       group: 'TTGV',          reason: 'TTGV prefix' },
  { match: /^MBO Partners\b/i,               group: 'AVALLON',       reason: 'MBO Partners = Avallon vehicle naming' },
  { match: /^Nice Bay\b/i,                   group: 'UNGROUPED',     reason: 'Nice Bay vehicles live in UNGROUPED (per existing)' },
];

function pickGroup(name: string): { group: string; reason: string } {
  for (const p of PATTERNS) {
    if (p.match.test(name)) return { group: p.group, reason: p.reason };
  }
  return { group: 'UNGROUPED', reason: 'no prefix match — standalone compliance entity' };
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  console.log('Building family backfill plan…\n');

  const entities = await query<EntityRow>(
    `SELECT id, legal_name FROM tax_entities
      WHERE is_active = TRUE AND client_group_id IS NULL
      ORDER BY legal_name`,
  );

  if (entities.length === 0) {
    console.log('No entities without family. Nothing to do.');
    return;
  }

  const groups = await query<GroupRow>(
    `SELECT id, name FROM tax_client_groups WHERE is_active = TRUE`,
  );
  const groupByName = new Map(groups.map(g => [g.name.toUpperCase(), g] as const));

  // Plan: for each entity, propose a group. Bucket into matched vs ungrouped
  // for clearer dry-run output.
  interface PlanRow {
    entity: EntityRow;
    target_group_name: string;
    target_group_id: string;
    reason: string;
    is_ungrouped: boolean;
  }
  const plan: PlanRow[] = [];
  for (const e of entities) {
    const { group, reason } = pickGroup(e.legal_name);
    const target = groupByName.get(group.toUpperCase());
    if (!target) {
      console.log(`⚠ Could not find group "${group}" for entity "${e.legal_name}" — skipping`);
      continue;
    }
    plan.push({
      entity: e,
      target_group_name: target.name,
      target_group_id: target.id,
      reason,
      is_ungrouped: target.name.toUpperCase() === 'UNGROUPED',
    });
  }

  // Print
  console.log(`═══ Family Backfill · ${APPLY ? 'APPLY' : 'Dry Run'} ════════════════════════════════════`);
  console.log(`${plan.length} entities to assign\n`);

  const matched = plan.filter(p => !p.is_ungrouped);
  const unmatched = plan.filter(p => p.is_ungrouped);

  if (matched.length > 0) {
    console.log(`──── Matched to a named family (${matched.length}) ────`);
    for (const p of matched) {
      console.log(`   ${p.entity.id.slice(0, 8)}…  "${p.entity.legal_name}"`);
      console.log(`      → ${p.target_group_name}  (${p.reason})`);
    }
    console.log('');
  }

  if (unmatched.length > 0) {
    console.log(`──── No clear family match → UNGROUPED (${unmatched.length}) ────`);
    for (const p of unmatched) {
      console.log(`   ${p.entity.id.slice(0, 8)}…  "${p.entity.legal_name}"`);
    }
    console.log('');
  }

  console.log('═══ Summary ═══');
  console.log(`   ${matched.length} → named families · ${unmatched.length} → UNGROUPED`);

  if (!APPLY) {
    console.log('\nRun with --apply to execute.');
    console.log('═══════════════════════════════════════════════════════════════════════\n');
    return;
  }

  // APPLY — single transaction, audit-log per entity touched.
  console.log('\n═══ Applying ═══');
  await tx(async (client) => {
    for (const p of plan) {
      await execTx(
        client,
        `UPDATE tax_entities SET client_group_id = $1, updated_at = NOW() WHERE id = $2`,
        [p.target_group_id, p.entity.id],
      );
      await logAuditTx(client, {
        userId: 'founder',
        action: 'tax_entity_update',
        targetType: 'tax_entity',
        targetId: p.entity.id,
        newValue: JSON.stringify({
          client_group_id: p.target_group_id,
          backfill: true,
          reason: p.reason,
          stint: '51.B',
        }),
      });
      console.log(`   ✓ "${p.entity.legal_name}" → ${p.target_group_name}`);
    }
  });
  console.log(`\n═══ Apply complete · ${plan.length} entities updated ═══\n`);
}

main().catch(e => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
