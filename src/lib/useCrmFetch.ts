'use client';

// ════════════════════════════════════════════════════════════════════════
// useCrmFetch — small hook that replaces the `.catch(() => setX(null))`
// anti-pattern with a visible error state.
//
// Before:
//   useEffect(() => {
//     fetch(url).then(r => r.json()).then(setData).catch(() => setData(null));
//   }, [url]);
//   if (!data) return 'Loading…';
//
// After:
//   const { data, error, isLoading, refetch } = useCrmFetch<T>(url);
//   if (isLoading) return <Skeleton />;
//   if (error) return <ErrorBox message={error} onRetry={refetch} />;
//   // data is T
//
// The `error` state surfaces silent 500s (the bug that hid the billing
// dashboard SQL failure for weeks). The `refetch` callback lets
// components offer a "Retry" button rather than forcing a hard refresh.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';

/**
 * Imperative list-fetch helper. Used by list pages that manage their
 * own `load` callback + filter/search state — the hook shape doesn't
 * quite fit. Throws on non-2xx so callers can catch and surface the
 * message via <CrmErrorBox />.
 */
export async function crmLoadList<T>(url: string): Promise<T[]> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `${r.status} ${r.statusText}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * Variant for endpoints that wrap the array (e.g. billing returns
 * { invoices, summary }). Caller passes a picker.
 */
export async function crmLoadShape<T>(url: string, pick: (body: unknown) => T): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `${r.status} ${r.statusText}`);
  }
  return pick(await r.json());
}

export interface CrmFetchState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useCrmFetch<T>(url: string | null): CrmFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!url) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        // Try to parse structured API error shape; fall back to status text.
        let msg = `${res.status} ${res.statusText}`;
        try {
          const body = await res.json();
          const m = body?.error?.message ?? body?.message;
          if (typeof m === 'string' && m) msg = m;
        } catch { /* ignore */ }
        setError(msg);
        setData(null);
        return;
      }
      const body = await res.json();
      setData(body as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // Reset when URL changes; refetch handles the rest.
    if (!url) { setData(null); setError(null); setIsLoading(false); return; }
    void refetch();
  }, [url, refetch]);

  return { data, error, isLoading, refetch };
}
