'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm — layout shared by all sub-routes of the CRM module.
//
// Nav split (stint 33.B):
//   - Primary tabs (always visible): 8 high-frequency destinations.
//   - Overflow menu (3-dot button): Trash, Settings, Help — low-
//     frequency items that used to bloat the primary bar.
// This eliminates horizontal scroll on typical viewports and keeps
// the daily-use tabs unobstructed.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BuildingIcon, UsersIcon, TargetIcon, BriefcaseIcon,
  CalendarIcon, CalendarDaysIcon, CheckSquareIcon, EuroIcon, Trash2Icon,
  SearchIcon, SettingsIcon, HelpCircleIcon,
} from 'lucide-react';
import { GlobalSearch } from '@/components/crm/GlobalSearch';
import { CrmQuickCreateModal } from '@/components/crm/CrmQuickCreateModal';
import { OverflowMenu } from '@/components/ui/OverflowMenu';

// Stint 64.S — order aligned with the left sidebar (stint 64.R)
// AND the legal-CRM canon (Clio Grow / Lexicata / InterAction /
// HubSpot / Salesforce all start with Contacts or Accounts).
//
// Diego: "todavía contacts y companies están en orden invertido"
// — referring to THIS top-tab nav, not the side nav (which was
// already correct since 64.R). Two navs in the same module must
// agree, otherwise the user has to context-switch between mental
// models every time they cross from sidebar to top-tab.
//
// Order grouped same as the sidebar:
//   Foundation: Contacts → Companies (people first)
//   Sales/work: Opportunities → Matters → Activities
//   Daily ops:  Tasks → Calendar
//   Output:     Billing
const PRIMARY_TABS = [
  { href: '/crm/contacts',      label: 'Contacts',      icon: UsersIcon },
  { href: '/crm/companies',     label: 'Companies',     icon: BuildingIcon },
  { href: '/crm/opportunities', label: 'Opportunities', icon: TargetIcon },
  { href: '/crm/matters',       label: 'Matters',       icon: BriefcaseIcon },
  { href: '/crm/activities',    label: 'Activities',    icon: CalendarIcon },
  { href: '/crm/tasks',         label: 'Tasks',         icon: CheckSquareIcon },
  { href: '/crm/calendar',      label: 'Calendar',      icon: CalendarDaysIcon },
  { href: '/crm/billing',       label: 'Billing',       icon: EuroIcon },
];

const OVERFLOW_ITEMS = [
  { href: '/crm/trash',    label: 'Trash',    icon: Trash2Icon },
  { href: '/crm/settings', label: 'Settings', icon: SettingsIcon },
  { href: '/crm/help',     label: 'Help',     icon: HelpCircleIcon },
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="max-w-[1400px] mx-auto px-4 pt-4">
      <GlobalSearch />
      <nav className="flex items-center gap-1 border-b border-border mb-4">
        {PRIMARY_TABS.map(tab => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-border-strong'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-1 pb-1.5">
          <button
            onClick={() => {
              // Simulate ⌘K — dispatch a synthetic event.
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink border border-border rounded-md hover:bg-surface-alt whitespace-nowrap"
            title="Search across all CRM entities (⌘K)"
          >
            <SearchIcon size={12} />
            Search
            <kbd className="text-2xs px-1 py-0.5 rounded bg-surface-alt border border-border text-ink-faint">⌘K</kbd>
          </button>
          <OverflowMenu items={OVERFLOW_ITEMS} ariaLabel="More CRM sections" />
        </div>
      </nav>
      <div>{children}</div>
      {/* Stint 63.B — global quick-create modal. Press N from any
          /crm/* page to create a Company / Contact / Opportunity / Task
          without navigating to its tab first. */}
      <CrmQuickCreateModal />
    </div>
  );
}
