'use client';

// Shared column factories used by every tax-type category page so that
// prepared_with / comments / deadline get the same inline-edit behaviour
// everywhere. Keeps per-page code tight + avoids drift when we tweak
// UX later.

import type { MatrixColumn, MatrixEntity, MatrixCell } from './TaxTypeMatrix';
import { InlineTagsCell, InlineTextCell } from './inline-editors';
import { DeadlineWithTolerance } from './DeadlineWithTolerance';

// Patch helper — works off the cell's filing_id. When the cell is empty,
// the edit is blocked (we don't create an empty filing just to attach a
// comment; user sets a status first via the period cell).
async function patchFiling(filingId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/tax-ops/filings/${filingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}

/**
 * Returns the most "representative" filing cell for an entity: the
 * first non-empty cell across all its period columns. Used by common
 * columns (prepared_with, comments) which logically apply per-period
 * but Diego edits in one place per row.
 *
 * For annual tax types, there's only ever one period so this resolves
 * trivially. For quarterly/monthly, edits pick the first filled cell
 * (usually the most recent filed one); in practice Diego almost always
 * has the same prepared_with across Q1..Q4 for a given entity-year.
 */
function firstFiledCell(entity: MatrixEntity, periodLabels: string[]): MatrixCell | null {
  for (const label of periodLabels) {
    const cell = entity.cells[label];
    if (cell?.filing_id) return cell;
  }
  return null;
}

/**
 * When the common column edits a value that semantically belongs on
 * EVERY filing of the row (like prepared_with across all 4 quarters
 * of a VAT return), we propagate the patch to each filing in parallel.
 */
async function patchAllFilings(filingIds: string[], patch: Record<string, unknown>): Promise<void> {
  const results = await Promise.allSettled(
    filingIds.map(id => patchFiling(id, patch)),
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) throw new Error(`${failed} of ${filingIds.length} saves failed`);
}

export function preparedWithColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'prepared_with',
    label: 'Prepared with',
    widthClass: 'w-[160px]',
    render: (e) => {
      const anyCell = firstFiledCell(e, periodLabels);
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      const value = anyCell?.prepared_with ?? [];
      return (
        <InlineTagsCell
          value={value}
          disabled={allFilingIds.length === 0}
          placeholder="Gab, Andrew"
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { prepared_with: next });
            refetch();
          }}
        />
      );
    },
  };
}

export function commentsColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'comments',
    label: 'Comments',
    render: (e) => {
      const cell = firstFiledCell(e, periodLabels);
      return (
        <InlineTextCell
          value={cell?.comments ?? null}
          disabled={!cell}
          placeholder="Add note…"
          multiline
          onSave={async (next) => {
            if (!cell?.filing_id) return;
            await patchFiling(cell.filing_id, { comments: next });
            refetch();
          }}
        />
      );
    },
  };
}

/**
 * Family column — first position, always visible. When `groups` + `refetch`
 * provided, click-to-edit dropdown lets Diego reassign the entity to a
 * different family or create a new one inline. When omitted, pure display.
 */
export function familyColumn(
  options?: {
    groups: Array<{ id: string; name: string }>;
    refetch: () => void;
    onGroupsChanged: () => void;
  },
): MatrixColumn {
  const editable = !!options;
  return {
    key: 'family',
    label: 'Family',
    widthClass: 'w-[150px]',
    render: (e) => {
      if (!editable) {
        if (!e.group_name) return <span className="text-ink-faint italic text-[11px]">—</span>;
        return (
          <span className="text-ink-soft text-[11.5px] truncate block" title={e.group_name}>
            {e.group_name}
          </span>
        );
      }
      return (
        <FamilyInlineSelect
          entity={e}
          groups={options.groups}
          onChangedFamily={options.refetch}
          onGroupsChanged={options.onGroupsChanged}
        />
      );
    },
  };
}

function FamilyInlineSelect({
  entity, groups, onChangedFamily, onGroupsChanged,
}: {
  entity: MatrixEntity;
  groups: Array<{ id: string; name: string }>;
  onChangedFamily: () => void;
  onGroupsChanged: () => void;
}) {
  async function handleChange(raw: string): Promise<void> {
    if (raw === '__create__') {
      const name = window.prompt('New family name:');
      if (!name?.trim()) return;
      const created = await fetch('/api/tax-ops/client-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!created.ok) {
        const b = await created.json().catch(() => ({}));
        alert(`Create failed: ${b?.error ?? created.status}`);
        return;
      }
      const { id: newGroupId } = await created.json() as { id: string };
      // Assign the entity to the new family
      const patched = await fetch(`/api/tax-ops/entities/${entity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_group_id: newGroupId }),
      });
      if (!patched.ok) {
        alert(`Assign failed: HTTP ${patched.status}`);
        return;
      }
      onGroupsChanged();
      onChangedFamily();
      return;
    }
    // Existing group id (or empty → unassign)
    const nextGroupId = raw === '' ? null : raw;
    const res = await fetch(`/api/tax-ops/entities/${entity.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_group_id: nextGroupId }),
    });
    if (!res.ok) {
      alert(`Save failed: HTTP ${res.status}`);
      return;
    }
    onChangedFamily();
  }

  return (
    <select
      value={entity.group_id ?? ''}
      onChange={(e) => void handleChange(e.target.value)}
      className="w-full px-1.5 py-0.5 text-[11.5px] border border-border rounded bg-surface hover:bg-surface-alt"
    >
      <option value="">— (no family)</option>
      {groups.map(g => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
      <option value="__create__">+ Create new family…</option>
    </select>
  );
}

export function deadlineColumn(periodLabel: string, toleranceDays = 0): MatrixColumn {
  // Pure display — deadline is auto-computed from the rule; editing
  // happens in the filing detail page. Admin tolerance (stint 37.C) makes
  // deadlines past statutory but within tolerance amber instead of red.
  return {
    key: 'deadline',
    label: 'Deadline',
    widthClass: 'w-[180px]',
    render: (e) => {
      const cell = e.cells[periodLabel];
      return (
        <DeadlineWithTolerance
          value={cell?.deadline_date ?? null}
          toleranceDays={toleranceDays}
          label="Deadline"
        />
      );
    },
  };
}
