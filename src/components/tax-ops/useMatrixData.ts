'use client';

// Thin wrapper around the /api/tax-ops/matrix endpoint so category
// pages don't re-implement the same fetch shape. Returns loading / error
// states alongside the matrix response.

import { useEffect, useState, useCallback } from 'react';
import type { MatrixEntity, MatrixCell, MatrixColumn } from './TaxTypeMatrix';

export interface MatrixResponse {
  year: number;
  tax_type: string;
  period_pattern: string;
  service_kind: string;
  /** Administrative tolerance days past the statutory deadline before
   *  the filing is truly overdue. 0 when no tolerance. (Stint 37.C) */
  admin_tolerance_days: number;
  period_labels: string[];
  entities: MatrixEntity[];
}

export interface MatrixQuery {
  tax_type: string;
  year: number;
  period_pattern?: string;
  service_kind?: 'filing' | 'review';
  show_inactive?: boolean;
}

export function useMatrixData(q: MatrixQuery | null): {
  data: MatrixResponse | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const qs = new URLSearchParams();
    qs.set('tax_type', q.tax_type);
    qs.set('year', String(q.year));
    if (q.period_pattern) qs.set('period_pattern', q.period_pattern);
    if (q.service_kind) qs.set('service_kind', q.service_kind);
    if (q.show_inactive) qs.set('show_inactive', '1');

    setIsLoading(true);
    setError(null);
    fetch(`/api/tax-ops/matrix?${qs}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MatrixResponse>;
      })
      .then(body => {
        if (!cancelled) setData(body);
      })
      .catch(e => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [q?.tax_type, q?.year, q?.period_pattern, q?.service_kind, q?.show_inactive, tick]);

  return { data, error, isLoading, refetch };
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Humanize "2025-Q1" → "Q1", "2025-03" → "Mar", "2025" → "2025". */
export function shortPeriodLabel(label: string): string {
  const quarterMatch = label.match(/^\d{4}-(Q[1-4])$/);
  if (quarterMatch) return quarterMatch[1]!;
  const monthMatch = label.match(/^\d{4}-(\d{2})$/);
  if (monthMatch) {
    const mIdx = Number(monthMatch[1]) - 1;
    return MONTH_NAMES[mIdx] ?? monthMatch[1]!;
  }
  return label;
}

// ─── Inline-edit helpers (stint 36) ──────────────────────────────────
// (MatrixEntity / MatrixCell / MatrixColumn types imported at the top)

/**
 * Shared onStatusChange callback used by every tax-type category page.
 * When a cell has a filing: PATCH the status. When the cell is empty:
 * POST a new filing (obligation must already exist on the entity).
 *
 * The caller provides a `refetch()` so the matrix re-pulls the updated
 * data after save. We don't attempt optimistic mutation of the matrix
 * rows client-side — cheap to refetch, eliminates edge cases.
 */
export async function applyStatusChange({
  entity, column, cell, nextStatus, refetch,
}: {
  entity: MatrixEntity;
  column: MatrixColumn;
  cell: MatrixCell | null;
  nextStatus: string;
  refetch: () => void;
}): Promise<void> {
  if (cell?.filing_id) {
    // Existing filing — patch it.
    const res = await fetch(`/api/tax-ops/filings/${cell.filing_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
  } else {
    // Empty cell — create the filing. We assume the column.key IS the
    // period_label (annual / Q1 / Jan-Dec). onStatusChange is only wired
    // on period columns; custom-rendered columns bypass this codepath.
    if (!entity.obligation_id) {
      throw new Error('No obligation on this entity');
    }
    const res = await fetch('/api/tax-ops/filings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        obligation_id: entity.obligation_id,
        period_label: column.key,
        status: nextStatus,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `Create failed (${res.status})`);
    }
  }
  refetch();
}
