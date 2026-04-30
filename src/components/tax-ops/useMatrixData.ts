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
  // Stint 64.J adds 'provision' for the new CIT tax-provision column.
  service_kind?: 'filing' | 'review' | 'provision';
  show_inactive?: boolean;
  /**
   * Stint 64.X.1 — additional service_kinds whose obligation existence
   * also includes the entity in the result set, even without a primary
   * `service_kind` obligation. Used by /tax-ops/cit so entities with
   * only provision (or only review) still appear as rows. The Status
   * cell stays empty when no primary obligation exists.
   */
  or_kinds?: Array<'filing' | 'review' | 'provision'>;
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
    if (q.or_kinds && q.or_kinds.length > 0) qs.set('or_kinds', q.or_kinds.join(','));

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
  }, [q?.tax_type, q?.year, q?.period_pattern, q?.service_kind, q?.show_inactive, q?.or_kinds?.join(','), tick]);

  return { data, error, isLoading, refetch };
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── Stint 51.D — drag-drop reorder helper ──────────────────────────
//
// Returns a callback ready to plug into TaxTypeMatrix's
// `onReorderWithinFamily` prop. POSTs the new sequential display_order
// for every entity in the affected family + triggers a refetch.

export function makeReorderHandler(refetch: () => void) {
  return async ({ orderedIds }: { groupName: string; orderedIds: string[] }) => {
    const updates = orderedIds.map((id, idx) => ({ id, display_order: idx }));
    try {
      const res = await fetch('/api/tax-ops/entities/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Reorder failed:', e);
      // Refetch anyway so the local optimistic state is reset.
      refetch();
    }
  };
}

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

/**
 * Stint 43.D7 — combined filter: status + partner in charge + associate.
 *
 * AND across the three filters. Each filter accepts:
 *   - undefined / 'all' → passthrough
 *   - '__empty' / '__unassigned' → rows with no filing (status) / no
 *     ownership tag (partner / associate) on any period cell
 *   - any other string → match the value on at least one period cell
 *
 * The three filters compose: a row passes only if it matches ALL three.
 * Diego's mental model: "show me the entities I'm partner on AND that
 * Vale is working on AND that are still in info_to_request".
 */
export function filterEntities(args: {
  entities: MatrixEntity[];
  status?: string;
  partner?: string;
  associate?: string;
  periodLabels: string[];
  /** Stint 64 — free-text search by entity legal_name (case-insensitive
   *  substring). Empty string is treated as no filter. Composes AND
   *  with status / partner / associate. */
  query?: string;
}): MatrixEntity[] {
  const { entities, status, partner, associate, periodLabels, query } = args;
  let out = filterEntitiesByStatus(entities, status, periodLabels);
  if (partner && partner !== 'all') {
    out = out.filter(e => matchesOwnership(e, periodLabels, 'partner_in_charge', partner));
  }
  if (associate && associate !== 'all') {
    out = out.filter(e => matchesOwnership(e, periodLabels, 'associates_working', associate));
  }
  const q = (query ?? '').trim().toLowerCase();
  if (q) {
    out = out.filter(e =>
      e.legal_name.toLowerCase().includes(q)
      // Also match against family/group name so "ilanga" finds rows
      // grouped under the C-INVESTMENTS family if they share the name.
      || (e.group_name?.toLowerCase().includes(q) ?? false),
    );
  }
  return out;
}

function matchesOwnership(
  entity: MatrixEntity,
  periodLabels: string[],
  field: 'partner_in_charge' | 'associates_working',
  value: string,
): boolean {
  if (value === '__unassigned') {
    // Row has at least one filing AND none of its filings have any
    // ownership tag on this field.
    const cells = periodLabels.map(l => entity.cells[l]).filter(Boolean);
    if (cells.length === 0) return false;
    return cells.every(c => !(c![field]?.length));
  }
  return periodLabels.some(l => {
    const cell = entity.cells[l];
    return cell?.[field]?.includes(value) ?? false;
  });
}

/**
 * Stint 44.F2 — collect the unique short_names that actually appear in the
 * matrix's cells for the given ownership field. Diego adds names directly
 * via the inline tags cell (free text), bypassing the team endpoint, so
 * the filter dropdown has to read what's in the data — not just from
 * tax_team_members. Returns sorted ASCII names with no duplicates.
 */
export function ownershipNamesInCells(
  entities: MatrixEntity[],
  field: 'partner_in_charge' | 'associates_working',
): string[] {
  const set = new Set<string>();
  for (const e of entities) {
    for (const cell of Object.values(e.cells)) {
      if (!cell) continue;
      const list = cell[field];
      if (!list) continue;
      for (const name of list) {
        const t = name.trim();
        if (t) set.add(t);
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ─── Tax team members (stint 43.D7) ──────────────────────────────────

export interface TaxTeamMember {
  id: string;
  short_name: string;
  full_name: string | null;
  is_active: boolean;
}

/** Stint 43.D7 — list of team members for the partner/associate filter
 *  dropdowns. Only active members; sorted by short_name. */
export function useTaxTeamMembers(): {
  members: TaxTeamMember[];
  isLoading: boolean;
  refetch: () => void;
} {
  const [members, setMembers] = useState<TaxTeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch('/api/tax-ops/team')
      .then(r => r.ok ? r.json() : { members: [] })
      .then(body => {
        if (!cancelled) {
          setMembers((body.members ?? []).filter((m: TaxTeamMember) => m.is_active));
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  return { members, isLoading, refetch };
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
