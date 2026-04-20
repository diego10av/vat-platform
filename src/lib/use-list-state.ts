'use client';

// ════════════════════════════════════════════════════════════════════════
// useListState — shared hook for URL-synced filters + sort + pagination.
//
// Factored out of the declarations page refactor so clients + entities
// can use the same primitive with one-liner wire-up. Scope:
//
//   - free-text search (q)
//   - single-value filter string (e.g. status, vat_filter)
//   - sort key + direction
//   - page + page size (with fixed options)
//   - URL round-trip via router.replace (no scroll)
//
// The hook is agnostic about what you're sorting — pass a compare
// function to `applySort` on the consuming side.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export type SortDir = 'asc' | 'desc';

export interface ListStateOptions<SK extends string, F extends string> {
  /** Base path for URL sync, e.g. '/entities'. */
  basePath: string;
  /** Allowed sort keys + the default. */
  sortKeys: readonly SK[];
  defaultSort: SK;
  defaultDir?: SortDir;
  /** Allowed filter values + the default. */
  filterValues: readonly F[];
  defaultFilter: F;
  /** Permitted page sizes. The hook clamps `size` to one of these. */
  pageSizes: readonly number[];
  defaultPageSize: number;
  /** Additional non-interactive query params to preserve in the URL
   *  (e.g. entity_id on /declarations). */
  passthroughParams?: readonly string[];
}

export interface ListState<SK extends string, F extends string> {
  q: string;
  setQ: (v: string) => void;
  filter: F;
  setFilter: (v: F) => void;
  sort: SK;
  dir: SortDir;
  toggleSort: (key: SK) => void;
  page: number;
  setPage: (v: number | ((prev: number) => number)) => void;
  pageSize: number;
  setPageSize: (v: number) => void;
}

export function useListState<SK extends string, F extends string>(
  opts: ListStateOptions<SK, F>,
): ListState<SK, F> {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQ = searchParams.get('q') ?? '';
  const initialFilter = readEnum<F>(searchParams.get('filter'), opts.filterValues, opts.defaultFilter);
  const initialSort = readEnum<SK>(searchParams.get('sort'), opts.sortKeys, opts.defaultSort);
  const initialDir: SortDir = (searchParams.get('dir') === 'asc' ? 'asc' : searchParams.get('dir') === 'desc' ? 'desc' : (opts.defaultDir ?? 'desc'));
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const initialPageSize = opts.pageSizes.includes(Number(searchParams.get('size')))
    ? Number(searchParams.get('size'))
    : opts.defaultPageSize;

  const [q, setQ] = useState(initialQ);
  const [filter, setFilter] = useState<F>(initialFilter);
  const [sort, setSort] = useState<SK>(initialSort);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const [page, setPageRaw] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);

  const setPage = useCallback((v: number | ((p: number) => number)) => {
    setPageRaw(prev => typeof v === 'function' ? (v as (p: number) => number)(prev) : v);
  }, []);

  const toggleSort = useCallback((key: SK) => {
    if (sort === key) {
      setDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key);
      setDir('asc');
    }
  }, [sort]);

  // Reset page 1 when any dimension except page itself changes.
  useEffect(() => { setPageRaw(1); }, [q, filter, sort, dir, pageSize]);

  // URL sync.
  useEffect(() => {
    const qs = new URLSearchParams();
    for (const key of opts.passthroughParams ?? []) {
      const v = searchParams.get(key);
      if (v != null) qs.set(key, v);
    }
    if (q.trim()) qs.set('q', q.trim());
    if (filter !== opts.defaultFilter) qs.set('filter', filter);
    if (sort !== opts.defaultSort) qs.set('sort', sort);
    if (dir !== (opts.defaultDir ?? 'desc')) qs.set('dir', dir);
    if (page > 1) qs.set('page', String(page));
    if (pageSize !== opts.defaultPageSize) qs.set('size', String(pageSize));
    const str = qs.toString();
    router.replace(str ? `${opts.basePath}?${str}` : opts.basePath, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, sort, dir, page, pageSize]);

  return { q, setQ, filter, setFilter, sort, dir, toggleSort, page, setPage, pageSize, setPageSize };
}

function readEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

// ─────────────────── Paginator UI ───────────────────

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  const start = (effectivePage - 1) * pageSize;
  return {
    total,
    totalPages,
    page: effectivePage,
    start,
    end: Math.min(start + pageSize, total),
    visible: rows.slice(start, start + pageSize),
  };
}
