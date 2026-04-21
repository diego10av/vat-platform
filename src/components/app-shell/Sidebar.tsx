'use client';

// Left-hand sidebar, permanent on desktop. Groups navigation by workflow
// intent (daily work / setup / operations) rather than by "every page we
// built has a link". An item can carry a small count badge (number of
// declarations in review, AED letters urgent, etc.) so Diego sees at a
// glance what's waiting. Active state is a 3px pink rail + pink-50 bg.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  HomeIcon, Building2Icon, FileTextIcon, CalendarIcon,
  BookOpenIcon,
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

type Role = 'admin' | 'reviewer' | 'junior' | 'client';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number | undefined;
  /** Roles that can see this item. Defaults to all roles. */
  roles?: readonly Role[];
};
type NavGroup = { label?: string; items: NavItem[]; roles?: readonly Role[] };

function buildGroups(badges: SidebarBadges): NavGroup[] {
  return [
    {
      items: [
        { href: '/',             label: 'Home',         icon: HomeIcon },
        // 2026-04-18 restructure: Clients is now a top-level concept
        // with entities hanging off it. Previously "Clients" in the
        // sidebar pointed at /entities (a flat list, no hierarchy),
        // which confused Diego. Clients absorbs Entities per his
        // decision — entities are reachable by drilling into a client.
        { href: '/clients',      label: 'Clients',      icon: Building2Icon },
        { href: '/declarations', label: 'Declarations', icon: FileTextIcon,
          badge: badges.declarationsInReview },
        // 2026-04-21 (Diego first-use review): Closing dashboard removed
        // from top-level nav. It's a multi-entity quarter-at-a-glance
        // view that only earns its place when there are 10+ entities
        // under management. For 1-5 entities it's pure noise. Route
        // `/closing` stays live and reachable via ⌘K ("closing") for
        // the day the book grows.
        // 2026-04-18: AED removed from top-level. It lives inside each
        // entity now (/entities/[id] → AED tab) because a flat "AED
        // inbox across all entities" view was a dashboard-only concept
        // that doesn't match how VAT reviewers work (per-entity). The
        // urgent AEDs still surface globally in the Inbox button
        // (top-right of the topbar) — that's the actionable view.
        // Route /aed-letters stays alive for back-compat deep-links.
        { href: '/deadlines',    label: 'Deadlines',    icon: CalendarIcon,
          badge: badges.deadlinesUrgent },
      ],
    },
    {
      label: 'Library',
      roles: ['admin', 'reviewer'],
      items: [
        // Two items previously lived here that no longer do:
        //   · Registrations  →  folded into Client lifecycle (vat_status =
        //     'pending_registration'). Route kept for back-compat.
        //   · Legal overrides →  folded into the Legal watch page as a
        //     top section. Route kept for back-compat + deep-links from
        //     agent explanations.
        { href: '/legal-watch',      label: 'Legal watch',     icon: BookOpenIcon },
      ],
    },
    {
      label: 'Operations',
      roles: ['admin', 'reviewer'],
      items: [
        { href: '/metrics',  label: 'Metrics', icon: BarChart3Icon },
        { href: '/audit',    label: 'Audit',   icon: ShieldCheckIcon },
        { href: '/settings', label: 'Settings', icon: SettingsIcon },
      ],
    },
  ];
}

function filterForRole(groups: NavGroup[], role: Role): NavGroup[] {
  return groups
    .filter(g => !g.roles || g.roles.includes(role))
    .map(g => ({
      ...g,
      items: g.items.filter(item => !item.roles || item.roles.includes(role)),
    }))
    .filter(g => g.items.length > 0);
}

export function Sidebar({ badges = {} }: { badges?: SidebarBadges }) {
  const pathname = usePathname() || '/';
  const [role, setRole] = useState<Role>('admin');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.role) setRole(data.role);
      })
      .catch(() => { /* swallow — defaults to admin */ });
    return () => { cancelled = true; };
  }, []);
  const groups = filterForRole(buildGroups(badges), role);

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
        <UserMenu role={role} />
      </div>
    </aside>
  );
}

function UserMenu({ role }: { role: Role }) {
  // Minimalist text-only user chip (à la Linear). The internal role
  // value ('junior') never surfaces in the UI per Diego 2026-04-19 —
  // the restricted-view user simply reads as "Associate". Same pattern
  // as "founder" for admin.
  const label = role === 'junior' ? 'Associate' : role === 'reviewer' ? 'Reviewer' : 'Diego';
  const tagline =
    role === 'junior' ? 'cifra · associate' :
    role === 'reviewer' ? 'cifra · reviewer' :
    'cifra · founder';
  return (
    <div className="flex flex-col px-3 py-1.5 rounded-md hover:bg-surface-alt transition-colors cursor-pointer">
      <div className="text-[12.5px] font-medium text-ink truncate leading-tight">
        {label}
      </div>
      <div className="text-[10.5px] text-ink-muted truncate leading-tight mt-0.5">
        {tagline}
      </div>
    </div>
  );
}
