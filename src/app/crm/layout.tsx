'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm — layout shared by all sub-routes of the CRM module.
//
// Renders a top tab nav with the 7 entity types. Each tab is a link to
// the corresponding sub-route. Active tab is highlighted based on
// pathname. Kept simple for stint 25.B scaffold — polish (kanban,
// dashboards, Excel export button) comes in phase 2.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BuildingIcon, UsersIcon, TargetIcon, BriefcaseIcon,
  CalendarIcon, CalendarDaysIcon, CheckSquareIcon, EuroIcon, Trash2Icon,
  SearchIcon, SettingsIcon,
} from 'lucide-react';
import { GlobalSearch } from '@/components/crm/GlobalSearch';

const TABS = [
  { href: '/crm/companies',     label: 'Companies',     icon: BuildingIcon },
  { href: '/crm/contacts',      label: 'Contacts',      icon: UsersIcon },
  { href: '/crm/opportunities', label: 'Opportunities', icon: TargetIcon },
  { href: '/crm/matters',       label: 'Matters',       icon: BriefcaseIcon },
  { href: '/crm/activities',    label: 'Activities',    icon: CalendarIcon },
  { href: '/crm/tasks',         label: 'Tasks',         icon: CheckSquareIcon },
  { href: '/crm/billing',       label: 'Billing',       icon: EuroIcon },
  { href: '/crm/calendar',      label: 'Calendar',      icon: CalendarDaysIcon },
  { href: '/crm/trash',         label: 'Trash',         icon: Trash2Icon },
  { href: '/crm/settings',      label: 'Settings',      icon: SettingsIcon },
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="max-w-[1400px] mx-auto px-4 pt-4">
      <GlobalSearch />
      <nav className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto">
        {TABS.map(tab => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors whitespace-nowrap ${
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
        <button
          onClick={() => {
            // Simulate ⌘K — dispatch a synthetic event.
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
          }}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] text-ink-muted hover:text-ink border border-border rounded-md hover:bg-surface-alt whitespace-nowrap"
          title="Search across all CRM entities (⌘K)"
        >
          <SearchIcon size={12} />
          Search
          <kbd className="text-[9.5px] px-1 py-0.5 rounded bg-surface-alt border border-border text-ink-faint">⌘K</kbd>
        </button>
      </nav>
      <div>{children}</div>
    </div>
  );
}
