'use client';

// Top bar sitting above the main content column. Holds global search,
// a notifications bell (placeholder for now), and responsive hamburger
// on mobile (sidebar is hidden below md). Height 56px.

import { useState } from 'react';
import { MenuIcon, BellIcon, XIcon, SparklesIcon } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import { Sidebar, type SidebarBadges } from './Sidebar';

interface TopBarProps {
  badges: SidebarBadges;
  onOpenChat?: () => void;
  chatOpen?: boolean;
}

export function TopBar({ badges, onOpenChat, chatOpen = false }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 h-14 bg-surface/85 backdrop-blur-xl border-b border-divider">
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

          <div className="flex items-center gap-1 shrink-0">
            <AskCifraButton onClick={onOpenChat} active={chatOpen} />
            <NotificationsButton />
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
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

function NotificationsButton() {
  // Placeholder — hooked up in Phase 3 once AED + validator inboxes are consolidated.
  return (
    <button
      className="relative w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
      aria-label="Notifications"
    >
      <BellIcon size={16} strokeWidth={1.8} />
    </button>
  );
}

// "Ask cifra" trigger — opens the right-side ChatDrawer. Uses the
// sparkles icon to mark AI + compact label to keep the topbar quiet.
function AskCifraButton({ onClick, active }: { onClick?: () => void; active: boolean }) {
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label="Open cifra assistant"
      title="Ask cifra (AI assistant)"
      className={[
        'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium',
        'transition-colors duration-150',
        active
          ? 'bg-brand-50 text-brand-700 border border-brand-100'
          : 'text-ink-soft hover:bg-surface-alt hover:text-ink border border-transparent',
      ].join(' ')}
    >
      <SparklesIcon size={13} strokeWidth={2} />
      <span className="hidden sm:inline">Ask cifra</span>
    </button>
  );
}
