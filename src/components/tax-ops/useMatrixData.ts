'use client';

// Thin wrapper around the /api/tax-ops/matrix endpoint so category
// pages don't re-implement the same fetch shape. Returns loading / error
// states alongside the matrix response.

import { useEffect, useState, useCallback } from 'react';
import type { MatrixEntity } from './TaxTypeMatrix';

export interface MatrixResponse {
  year: number;
  tax_type: string;
  period_pattern: string;
  service_kind: string;
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
