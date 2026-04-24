// Unit tests for src/lib/audit-humanize.ts (stint 42.A).

import { describe, it, expect } from 'vitest';
import { humanize, iconFor, groupByMonth, type AuditRow } from '@/lib/audit-humanize';

const baseRow = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a',
  action: 'update',
  target_type: 'tax_filing',
  target_id: 'f1',
  field: null,
  old_value: null,
  new_value: null,
  user_id: 'founder',
  created_at: '2026-04-24T10:00:00Z',
  ...over,
});

describe('iconFor', () => {
  it('maps key action patterns to an emoji, rest to dot', () => {
    expect(iconFor('tax_entity_merge')).toBe('🧩');
    expect(iconFor('tax_obligation_cadence_change')).toBe('🔁');
    expect(iconFor('tax_contact_bulk_rename')).toBe('👥');
    expect(iconFor('tax_entity_update')).toBe('📝');
    expect(iconFor('weird_unknown_action')).toBe('·');
  });
});

describe('humanize', () => {
  it('formats field + old → new for generic updates', () => {
    const r = baseRow({ action: 'update', field: 'status', old_value: 'working', new_value: 'filed' });
    expect(humanize(r)).toBe('Status: working → filed');
  });

  it('parses tax_entity_merge count', () => {
    const r = baseRow({
      action: 'tax_entity_merge',
      new_value: JSON.stringify({ source_entity_ids: ['a', 'b', 'c'], source_entity_names: ['A', 'B', 'C'] }),
    });
    expect(humanize(r)).toBe('Merged 3 duplicates into this entity');
  });

  it('formats cadence change with old and new pattern', () => {
    const r = baseRow({
      action: 'tax_obligation_cadence_change',
      new_value: JSON.stringify({ old_period_pattern: 'monthly', new_period_pattern: 'quarterly' }),
    });
    expect(humanize(r)).toBe('Cadence: monthly → quarterly');
  });

  it('formats bulk contact set with source hint', () => {
    const r = baseRow({
      action: 'tax_entity_contacts_bulk_set',
      new_value: JSON.stringify({ contact_set: [{ name: 'A' }, { name: 'B' }], source_entity_id: 'x' }),
    });
    expect(humanize(r)).toBe('Contacts replaced (2 from another entity)');
  });

  it('falls back to a prettified action when no structured context available', () => {
    const r = baseRow({ action: 'tax_client_group_update' });
    expect(humanize(r)).toContain('Tax Client Group Update');
  });

  it('truncates long values in field diffs', () => {
    const r = baseRow({
      action: 'update',
      field: 'comments',
      old_value: 'x'.repeat(100),
      new_value: 'y'.repeat(100),
    });
    const out = humanize(r);
    // Each side is capped at 60 chars; there are two sides, so output should stay bounded
    expect(out.length).toBeLessThan(160);
  });
});

describe('groupByMonth', () => {
  it('buckets rows by YYYY-MM, newest bucket first', () => {
    const rows: AuditRow[] = [
      baseRow({ id: '1', created_at: '2026-04-20T09:00:00Z' }),
      baseRow({ id: '2', created_at: '2026-04-15T09:00:00Z' }),
      baseRow({ id: '3', created_at: '2026-03-10T09:00:00Z' }),
      baseRow({ id: '4', created_at: '2026-05-01T09:00:00Z' }),
    ];
    const groups = groupByMonth(rows);
    expect(groups.map(g => g.key)).toEqual(['2026-05', '2026-04', '2026-03']);
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[1]!.items).toHaveLength(2);
    expect(groups[2]!.items).toHaveLength(1);
  });

  it('uses full English month names in labels', () => {
    const rows = [baseRow({ created_at: '2026-04-24T00:00:00Z' })];
    expect(groupByMonth(rows)[0]!.label).toBe('April 2026');
  });

  it('returns [] for empty input', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
