'use client';

// ════════════════════════════════════════════════════════════════════════
// useTaxonomy — module-scope cache for crm_taxonomies dropdown values.
// First component to request a given kind triggers the fetch; every
// subsequent call reuses the cached array. Refresh flipping a value
// in /crm/settings/taxonomies doesn't auto-propagate — users need to
// reload the form page once. Acceptable tradeoff for the read-heavy
// shape (dropdowns render constantly, taxonomies change rarely).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';

export type TaxonomyKind =
  | 'country' | 'industry' | 'practice_area' | 'fee_type'
  | 'role_tag' | 'source' | 'loss_reason';

interface TaxonomyOption { value: string; label: string; }

const cache = new Map<TaxonomyKind, TaxonomyOption[]>();
const inflight = new Map<TaxonomyKind, Promise<TaxonomyOption[]>>();
const subscribers = new Map<TaxonomyKind, Set<(opts: TaxonomyOption[]) => void>>();

async function fetchTaxonomy(kind: TaxonomyKind): Promise<TaxonomyOption[]> {
  const cached = cache.get(kind);
  if (cached) return cached;

  const existing = inflight.get(kind);
  if (existing) return existing;

  const p = (async () => {
    const res = await fetch(`/api/crm/taxonomies?kind=${kind}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Taxonomy fetch failed: ${res.status}`);
    const body = await res.json() as Array<{ value: string; label: string; archived: boolean }>;
    const opts = body.filter(r => !r.archived).map(r => ({ value: r.value, label: r.label }));
    cache.set(kind, opts);
    inflight.delete(kind);
    (subscribers.get(kind) ?? []).forEach(fn => fn(opts));
    return opts;
  })().catch(e => {
    inflight.delete(kind);
    throw e;
  });
  inflight.set(kind, p);
  return p;
}

/**
 * Returns `options` for a given taxonomy kind. Starts with the
 * provided `fallback` (the hardcoded array from schemas.ts) and
 * upgrades once the fetch resolves. Consumer components don't need
 * to handle loading — the fallback is always usable.
 */
export function useTaxonomy(
  kind: TaxonomyKind | undefined,
  fallback: TaxonomyOption[] = [],
): TaxonomyOption[] {
  const [opts, setOpts] = useState<TaxonomyOption[]>(() => {
    if (!kind) return fallback;
    const c = cache.get(kind);
    return c ?? fallback;
  });

  useEffect(() => {
    if (!kind) { setOpts(fallback); return; }
    const c = cache.get(kind);
    if (c) { setOpts(c); return; }

    // Subscribe in case another component triggers the fetch.
    const sub = (latest: TaxonomyOption[]) => setOpts(latest);
    if (!subscribers.has(kind)) subscribers.set(kind, new Set());
    subscribers.get(kind)!.add(sub);

    fetchTaxonomy(kind).then(setOpts).catch(() => { /* keep fallback */ });

    return () => { subscribers.get(kind)?.delete(sub); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return opts;
}

/** Invalidate the cache for a kind so the next consumer re-fetches.
 *  Called by the taxonomy settings page when the user changes a value. */
export function invalidateTaxonomy(kind: TaxonomyKind) {
  cache.delete(kind);
}
