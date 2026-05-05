'use client';

// ════════════════════════════════════════════════════════════════════════
// Sidebar collapsed state — persisted in localStorage, synchronised
// across tabs and across the two consumers (Sidebar + AppShellInner)
// via a custom event so they stay in lock-step without prop drilling
// or context.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';

const KEY = 'cifra-sidebar-collapsed';
const EVENT = 'cifra-sidebar-collapsed-change';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(false);

  // Hydrate from localStorage after mount (SSR-safe).
  useEffect(() => {
    setCollapsedState(readInitial());
  }, []);

  // Listen for changes from the other consumer or another tab.
  useEffect(() => {
    function onCustom(e: Event) {
      const detail = (e as CustomEvent<{ collapsed: boolean }>).detail;
      if (detail) setCollapsedState(detail.collapsed);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== KEY) return;
      setCollapsedState(e.newValue === '1');
    }
    window.addEventListener(EVENT, onCustom as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onCustom as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      window.localStorage.setItem(KEY, next ? '1' : '0');
      window.dispatchEvent(
        new CustomEvent(EVENT, { detail: { collapsed: next } }),
      );
    } catch {
      /* localStorage may be disabled in private mode — state still works in-memory */
    }
  }, []);

  return [collapsed, setCollapsed];
}
