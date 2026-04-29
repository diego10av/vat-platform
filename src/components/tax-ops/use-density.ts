'use client';

// ════════════════════════════════════════════════════════════════════════
// useDensity — stint 64.O F7
//
// Persistent matrix density preference. Read by TaxTypeMatrix to swap
// padding utilities and by MatrixToolbar to render the toggle. Stored
// in localStorage so it survives reloads and applies to every tax-ops
// matrix the moment the page mounts (no prop drilling).
//
// 'comfortable' (default) — current padding (px-2/px-2.5 py-1.5).
// 'compact'                — half the vertical padding, smaller text
//                            so partners scanning 50+ entities can
//                            see twice as many rows on screen.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';

export type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'cifra.tax-ops.density.v1';

export function useDensity(): {
  density: Density;
  setDensity: (next: Density) => void;
  toggle: () => void;
} {
  // SSR-safe: start at the default to avoid hydration mismatch, sync
  // from localStorage on mount.
  const [density, setDensityState] = useState<Density>('comfortable');

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === 'compact' || v === 'comfortable') setDensityState(v);
    } catch {
      // localStorage unavailable (private mode etc.) — silently keep default.
    }
  }, []);

  const setDensity = (next: Density) => {
    setDensityState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  };

  const toggle = () => setDensity(density === 'comfortable' ? 'compact' : 'comfortable');

  return { density, setDensity, toggle };
}
