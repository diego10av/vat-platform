'use client';

// ════════════════════════════════════════════════════════════════════════
// EntityFilingsMatrix — compact multi-year tax_type × period matrix
// shown on the entity detail page. Replaces the previous stack of
// per-year sub-tables.
//
// Rows: one per tax_type the entity has filings for.
// Columns: up to 4 recent years. Each year column expands into the
//          right number of sub-columns based on period_pattern:
//            annual    → 1 sub-col (the year itself)
//            quarterly → 4 sub-cols (Q1-Q4)
//            monthly   → 12 sub-cols (Jan-Dec)
//            semester  → 2 sub-cols (S1-S2)
//
// Cells: FilingStatusBadge for the matching filing, '—' otherwise.
//        Click → /tax-ops/filings/[id].
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useMemo } from 'react';
import { FilingStatusBadge, filingStatusLabel } from './FilingStatusBadge';
import { shortPeriodLabel } from './useMatrixData';

export interface EntityFiling {
  id: string;
  tax_type: string;
  /** Stint 64.X.2 — service_kind threads through to FilingStatusBadge
   *  so provision filings render with the provision label set
   *  (Awaiting FS, Calculating, Sent — awaiting feedback, Finalized)
   *  instead of the filing one. Optional for backward compat with
   *  callers that haven't been updated yet. */
  service_kind?: 'filing' | 'provision' | 'review';
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  filed_at: string | null;
  tax_assessment_received_at: string | null;
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function patternOf(taxType: string, sampleLabels: string[]): 'annual' | 'quarterly' | 'monthly' | 'semester' | 'adhoc' {
  // Inspect the actual labels we have for this tax_type — the period_pattern
  // can vary per obligation, but for display we pick the finest-grained
  // one we see (monthly > quarterly > semester > annual).
  const hasMonthly = sampleLabels.some(l => /^\d{4}-\d{2}$/.test(l));
  if (hasMonthly) return 'monthly';
  const hasQuarterly = sampleLabels.some(l => /^\d{4}-Q[1-4]$/.test(l));
  if (hasQuarterly) return 'quarterly';
  const hasSemester = sampleLabels.some(l => /^\d{4}-S[12]$/.test(l));
  if (hasSemester) return 'semester';
  const hasAnnual = sampleLabels.some(l => /^\d{4}$/.test(l));
  if (hasAnnual) return 'annual';
  return 'adhoc';
}

function periodLabelsForPattern(pattern: string, year: number): string[] {
  if (pattern === 'annual') return [String(year)];
  if (pattern === 'quarterly') return [`${year}-Q1`, `${year}-Q2`, `${year}-Q3`, `${year}-Q4`];
  if (pattern === 'monthly') {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  if (pattern === 'semester') return [`${year}-S1`, `${year}-S2`];
  return [];
}

export function EntityFilingsMatrix({
  filings, years,
}: {
  filings: EntityFiling[];
  /** Ordered list of years to render as columns (e.g. [2023, 2024, 2025, 2026]). */
  years: number[];
}) {
  // Pivot by (tax_type → year → period_label → filing)
  const byTypeYear = useMemo(() => {
    const m = new Map<string, Map<number, Map<string, EntityFiling>>>();
    for (const f of filings) {
      if (!m.has(f.tax_type)) m.set(f.tax_type, new Map());
      const byYear = m.get(f.tax_type)!;
      if (!byYear.has(f.period_year)) byYear.set(f.period_year, new Map());
      byYear.get(f.period_year)!.set(f.period_label, f);
    }
    return m;
  }, [filings]);

  // Compute per-tax-type pattern by peeking at its labels across all years
  const patternByType = useMemo(() => {
    const m = new Map<string, string>();
    for (const [type, byYear] of byTypeYear.entries()) {
      const allLabels: string[] = [];
      for (const byPeriod of byYear.values()) {
        for (const label of byPeriod.keys()) allLabels.push(label);
      }
      m.set(type, patternOf(type, allLabels));
    }
    return m;
  }, [byTypeYear]);

  const taxTypes = Array.from(byTypeYear.keys()).sort();

  if (taxTypes.length === 0) {
    return (
      <div className="text-sm text-ink-muted italic">
        No filings for this entity yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-auto">
      <table className="text-xs border-collapse">
        <thead className="bg-surface-alt sticky top-0 z-sticky">
          <tr>
            <th
              className="sticky left-0 z-sticky bg-surface-alt border-b border-r border-border px-2.5 py-1.5 font-medium text-left min-w-[180px]"
              rowSpan={2}
            >
              Tax type
            </th>
            {years.map(y => (
              <th
                key={y}
                className="border-b border-border px-2 py-1.5 font-semibold text-center border-l border-border"
                colSpan={maxSubColsForYear(patternByType, y)}
              >
                {y}
              </th>
            ))}
          </tr>
          <tr>
            {/* No second-row cells needed because sub-cols are variable per tax_type —
                we render sub-headers inline per row below. Keep this empty row for
                thead structural symmetry. */}
            {years.map(y => (
              <th
                key={`${y}-spacer`}
                className="border-b border-border px-0 py-0"
                colSpan={maxSubColsForYear(patternByType, y)}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {taxTypes.map(type => (
            <TypeRow
              key={type}
              taxType={type}
              pattern={patternByType.get(type)!}
              years={years}
              byYear={byTypeYear.get(type)!}
              allPatterns={patternByType}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function maxSubColsForYear(patternByType: Map<string, string>, _year: number): number {
  // The year column is as wide as the widest pattern across tax_types.
  // monthly=12, quarterly=4, semester=2, annual=1.
  let max = 1;
  for (const p of patternByType.values()) {
    if (p === 'monthly') max = Math.max(max, 12);
    else if (p === 'quarterly') max = Math.max(max, 4);
    else if (p === 'semester') max = Math.max(max, 2);
  }
  return max;
}

function TypeRow({
  taxType, pattern, years, byYear, allPatterns,
}: {
  taxType: string;
  pattern: string;
  years: number[];
  byYear: Map<number, Map<string, EntityFiling>>;
  allPatterns: Map<string, string>;
}) {
  const widestSubCols = maxSubColsForYear(allPatterns, 0);

  return (
    <tr className="border-b border-border/70 hover:bg-surface-alt/50">
      <td className="sticky left-0 bg-surface hover:bg-surface-alt/50 border-r border-border px-2.5 py-1.5 min-w-[180px] font-medium">
        {humanTaxType(taxType)}
      </td>
      {years.map(year => {
        const labels = periodLabelsForPattern(pattern, year);
        const byPeriod = byYear.get(year) ?? new Map();
        const thisPatternCols = labels.length || 1;
        const filler = widestSubCols - thisPatternCols;

        return (
          <YearCells
            key={year}
            year={year}
            labels={labels}
            byPeriod={byPeriod}
            fillerCols={filler}
          />
        );
      })}
    </tr>
  );
}

function YearCells({
  year, labels, byPeriod, fillerCols,
}: {
  year: number;
  labels: string[];
  byPeriod: Map<string, EntityFiling>;
  fillerCols: number;
}) {
  if (labels.length === 0) {
    return <td className="text-ink-faint text-center" colSpan={Math.max(fillerCols, 1)}>—</td>;
  }
  const cells: React.ReactNode[] = [];
  for (const label of labels) {
    const filing = byPeriod.get(label) ?? null;
    cells.push(
      <PeriodCell key={label} label={label} filing={filing} />,
    );
  }
  // Right-pad with empty spacer cells if this tax_type has fewer sub-cols
  // than the year column allocates (e.g. annual row inside a monthly column).
  for (let i = 0; i < fillerCols; i += 1) {
    cells.push(<td key={`filler-${i}`} className="bg-surface-alt/20" />);
  }
  return <>{cells}</>;
}

function PeriodCell({ label, filing }: { label: string; filing: EntityFiling | null }) {
  if (!filing) {
    return (
      <td
        className="px-1 py-1 align-middle text-center text-ink-faint border-l border-border/30"
        title={label}
      >
        <span className="text-2xs">{shortPeriodLabel(label)}</span>
      </td>
    );
  }
  const tooltipParts = [
    filingStatusLabel(filing.status, filing.service_kind),
    filing.deadline_date ? `Deadline: ${filing.deadline_date}` : null,
    filing.filed_at ? `Filed: ${filing.filed_at}` : null,
    filing.tax_assessment_received_at ? `Assessment: ${filing.tax_assessment_received_at}` : null,
    filing.assigned_to ? `Assignee: ${filing.assigned_to}` : null,
  ].filter(Boolean);
  return (
    <td
      className="px-1 py-1 align-middle text-center border-l border-border/30"
      title={tooltipParts.join('\n')}
    >
      <Link href={`/tax-ops/filings/${filing.id}`} className="inline-block">
        <FilingStatusBadge status={filing.status} serviceKind={filing.service_kind} />
      </Link>
    </td>
  );
}
