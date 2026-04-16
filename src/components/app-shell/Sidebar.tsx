'use client';

// Left-hand sidebar, permanent on desktop. Groups navigation by workflow
// intent (daily work / setup / operations) rather than by "every page we
// built has a link". An item can carry a small count badge (number of
// declarations in review, AED letters urgent, etc.) so Diego sees at a
// glance what's waiting. Active state is a 3px pink rail + pink-50 bg.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HomeIcon, Building2Icon, FileTextIcon, InboxIcon, CalendarIcon,
  ScaleIcon, BookOpenIcon,
  BarChart3Icon, ShieldCheckIcon, SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';

export interface SidebarBadges {
  /** Declarations currently in `review` status. */
  declarationsInReview?: number;
  /** AED letters with urgency = high and unresolved. */
  aedUrgent?: number;
  /** Deadlines overdue + urgent (<= 7 days). */
  deadlinesUrgent?: number;
}

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number | undefined;
};
type NavGroup = { label?: string; items: NavItem[] };

function buildGroups(badges: SidebarBadges): NavGroup[] {
  return [
    {
      items: [
        { href: '/',             label: 'Home',         icon: HomeIcon },
        { href: '/entities',     label: 'Clients',      icon: Building2Icon },
        { href: '/declarations', label: 'Declarations', icon: FileTextIcon,
          badge: badges.declarationsInReview },
        { href: '/aed-letters',  label: 'AED inbox',    icon: InboxIcon,
          badge: badges.aedUrgent },
        { href: '/deadlines',    label: 'Deadlines',    icon: CalendarIcon,
          badge: badges.deadlinesUrgent },
      ],
    },
    {
      label: 'Library',
      items: [
        // Registrations is no longer a top-level nav item — it's now a
        // lifecycle state of the Client entity (vat_status =
        // 'pending_registration'). The full /registrations list is
        // still reachable from within the Client detail page, and
        // pending-registration Clients show a badge on the Clients
        // list. The old global registrations route stays alive for
        // back-compat but is no longer surfaced in nav.
        { href: '/legal-overrides',  label: 'Legal overrides', icon: ScaleIcon },
        { href: '/legal-watch',      label: 'Legal watch',     icon: BookOpenIcon },
      ],
    },
    {
      label: 'Operations',
      items: [
        { href: '/metrics',  label: 'Metrics', icon: BarChart3Icon },
        { href: '/audit',    label: 'Audit',   icon: ShieldCheckIcon },
        { href: '/settings', label: 'Settings', icon: SettingsIcon },
      ],
    },
  ];
}

export function Sidebar({ badges = {} }: { badges?: SidebarBadges }) {
  const pathname = usePathname() || '/';
  const groups = buildGroups(badges);

  // Match rule: exact "/" for Home; otherwise startsWith for nested routes
  // (so /declarations/xyz still lights up the Declarations item).
  const isActive = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <aside
      className="hidden md:flex flex-col fixed top-0 left-0 bottom-0 w-[232px] bg-surface border-r border-divider z-40"
      aria-label="Primary"
    >
      {/* Logo area */}
      <div className="h-14 px-4 flex items-center border-b border-divider shrink-0">
        <Link href="/" className="inline-flex" aria-label="cifra — home">
          <Logo />
        </Link>
      </div>

      {/* Nav body */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        {groups.map((group, i) => (
          <div key={i} className={i > 0 ? 'mt-5' : ''}>
            {group.label && (
              <div className="px-3 mb-1.5 text-[10.5px] uppercase tracking-[0.08em] font-semibold text-ink-faint">
                {group.label}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href} className="relative">
                    {/* Active indicator rail */}
                    {active && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-brand-500"
                        aria-hidden="true"
                      />
                    )}
                    <Link
                      href={item.href}
                      className={[
                        'flex items-center gap-2.5 pl-3 pr-2 h-8 rounded-md text-[13px]',
                        'transition-colors duration-150',
                        active
                          ? 'bg-brand-50 text-brand-700 font-medium'
                          : 'text-ink-soft hover:bg-surface-alt hover:text-ink',
                      ].join(' ')}
                    >
                      <Icon
                        size={16}
                        strokeWidth={active ? 2.2 : 1.8}
                        className={active ? 'text-brand-500' : 'text-ink-muted'}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {typeof item.badge === 'number' && item.badge > 0 && (
                        <span
                          className={[
                            'tabular-nums inline-flex items-center justify-center',
                            'min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-semibold',
                            active
                              ? 'bg-brand-500 text-white'
                              : 'bg-brand-50 text-brand-700 border border-brand-100',
                          ].join(' ')}
                          aria-label={`${item.badge} items`}
                        >
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer — user + logout */}
      <div className="px-3 pb-3 pt-2 border-t border-divider shrink-0">
        <UserMenu />
      </div>
    </aside>
  );
}

function UserMenu() {
  // Minimalist text-only user chip (à la Linear). No avatar circle —
  // the previous "D" circle competed visually with the "c" logomark
  // at the top of the sidebar. Typography carries identification; a
  // profile photo can replace this cleanly later without re-doing
  // the layout.
  return (
    <div className="flex flex-col px-3 py-1.5 rounded-md hover:bg-surface-alt transition-colors cursor-pointer">
      <div className="text-[12.5px] font-medium text-ink truncate leading-tight">
        Diego
      </div>
      <div className="text-[10.5px] text-ink-muted truncate leading-tight mt-0.5">
        cifra · founder
      </div>
    </div>
  );
}
