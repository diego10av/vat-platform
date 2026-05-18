'use client';

// Top bar sitting above the main content column. Holds global search +
// mobile hamburger. Height 56px.

import { useState } from 'react';
import { MenuIcon, XIcon } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import { Sidebar, type SidebarBadges } from './Sidebar';

interface TopBarProps {
  badges: SidebarBadges;
}

export function TopBar({ badges }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Stint 104 — z-sticky (was z-popover). Stint 101 bumped
          --z-index-popover from 30 → 55 so SearchableSelect dropdowns
          inside modals render above the backdrop. Collateral: this
          header was also z-popover (now 55), which made the global
          search bar float ABOVE any open modal. z-sticky:10 lets the
          modal backdrop (z-modal:50) cleanly cover the header when
          one is open, and still keeps the header above page content
          (z-auto = 0) when scrolling. */}
      <header className="sticky top-0 z-sticky h-14 bg-surface/85 backdrop-blur-xl border-b border-divider">
        <div className="h-full px-4 md:px-6 flex items-center gap-3 md:gap-4">
          <button
            className="md:hidden w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon size={18} />
          </button>

          <div className="flex-1 min-w-0">
            <SearchBar />
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-modal flex">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-[232px] h-full animate-slideInRight">
            <Sidebar badges={badges} />
            <button
              className="absolute top-3 right-3 w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <XIcon size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
