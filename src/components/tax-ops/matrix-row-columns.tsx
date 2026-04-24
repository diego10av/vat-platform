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
