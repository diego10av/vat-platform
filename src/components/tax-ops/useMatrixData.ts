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

// ─── Client groups (families) — used by familyColumn ────────────────

export interface ClientGroup {
  id: string;
  name: string;
  is_active: boolean;
  entity_count: number;
}

/** Stint 37.E — list of client groups (families) for the family column
 *  dropdown. Cached in module memory once loaded; callers can trigger
 *  refetch when a new family is created. */
export function useClientGroups(): {
  groups: ClientGroup[];
  isLoading: boolean;
  refetch: () => void;
} {
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch('/api/tax-ops/client-groups')
      .then(r => r.ok ? r.json() : { groups: [] })
      .then(body => {
        if (!cancelled) setGroups(
          (body.groups ?? []).filter((g: ClientGroup) => g.is_active),
        );
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  return { groups, isLoading, refetch };
}

/**
 * Stint 39.D — filter entities by status for the follow-up workflow.
 *
 * Returns entities whose period cells include at least one filing with the
 * requested status. Special values:
 *   - 'all' or empty → passthrough (no filter)
 *   - '__empty' → rows where NO period cell has a filing (all cells null)
 *
 * Only period cells are considered (the keys in period_labels) — prepared_with
 * and comments don't participate. This matches Diego's mental model: "show me
 * the entities where I still need to request info" filters on the status chips
 * he sees in the matrix body.
 */
export function filterEntitiesByStatus(
  entities: MatrixEntity[],
  status: string | undefined,
  periodLabels: string[],
): MatrixEntity[] {
  if (!status || status === 'all') return entities;
  if (status === '__empty') {
    return entities.filter(e => periodLabels.every(l => !e.cells[l]));
  }
  return entities.filter(e => periodLabels.some(l => e.cells[l]?.status === status));
}

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
 *
 * Stint 39.E — when a `toast` is supplied, a success-toast with an
 * "Undo" action is shown. Undo reverses the mutation:
 *   - PATCH case → patches back to the previous status
 *   - POST case (new filing) → DELETEs the freshly-created filing
 * Without a toast the function still works (legacy call sites don't get
 * undo, but nothing breaks).
 */
interface ToastLikeForUndo {
  withAction: (
    kind: 'success' | 'error' | 'info',
    message: string,
    hint: string | undefined,
    action: { label: string; onClick: () => void | Promise<void> },
  ) => void;
  error: (message: string) => void;
}

export async function applyStatusChange({
  entity, column, cell, nextStatus, refetch, toast,
}: {
  entity: MatrixEntity;
  column: MatrixColumn;
  cell: MatrixCell | null;
  nextStatus: string;
  refetch: () => void;
  toast?: ToastLikeForUndo;
}): Promise<void> {
  const entityLabel = entity.legal_name;
  const colLabel = column.label;

  if (cell?.filing_id) {
    // Existing filing — patch it, capture previous status for undo.
    const priorStatus = cell.status;
    const filingId = cell.filing_id;
    const res = await fetch(`/api/tax-ops/filings/${filingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    refetch();

    if (toast) {
      toast.withAction(
        'success',
        `${entityLabel} · ${colLabel}`,
        `${priorStatus} → ${nextStatus}`,
        {
          label: 'Undo',
          onClick: async () => {
            const r = await fetch(`/api/tax-ops/filings/${filingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: priorStatus }),
            });
            if (!r.ok) toast.error('Undo failed');
            refetch();
          },
        },
      );
    }
    return;
  }

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
  const created = await res.json().catch(() => ({})) as { id?: string };
  refetch();

  if (toast && created?.id) {
    const newFilingId = created.id;
    toast.withAction(
      'success',
      `${entityLabel} · ${colLabel}`,
      `filing created · ${nextStatus}`,
      {
        label: 'Undo',
        onClick: async () => {
          const r = await fetch(`/api/tax-ops/filings/${newFilingId}`, {
            method: 'DELETE',
          });
          if (!r.ok) toast.error('Undo failed');
          refetch();
        },
      },
    );
  }
}
