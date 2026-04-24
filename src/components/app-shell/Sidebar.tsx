'use client';

// Left-hand sidebar, permanent on desktop. Groups navigation by workflow
// intent (daily work / setup / operations) rather than by "every page we
// built has a link". An item can carry a small count badge (number of
// declarations in review, AED letters urgent, etc.) so Diego sees at a
// glance what's waiting. Active state is a 3px pink rail + pink-50 bg.
//
// Stint 35 (2026-04-24): items can carry `children?: NavItem[]` — used
// by Tax-Ops to expose tax-type sub-categories (VAT → Annual / Quarterly
// / Monthly). Click on the parent navigates to its href; click on the
// chevron toggles children visibility. State persisted in localStorage.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  HomeIcon, Building2Icon, FileTextIcon, CalendarIcon,
  BookOpenIcon, BriefcaseIcon, FileStackIcon,
  LandmarkIcon, SearchCheckIcon, ReceiptIcon, WalletIcon,
  CoinsIcon, LibraryBigIcon, FolderIcon, CheckSquareIcon,
  BarChart3Icon, ShieldCheckIcon, SettingsIcon, ChevronRightIcon,
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
  /** Nested sub-items, rendered indented under the parent. When present,
   *  a chevron button appears next to the label to toggle visibility. */
  children?: NavItem[];
};
type NavGroup = { label?: string; items: NavItem[]; roles?: readonly Role[] };

function buildGroups(badges: SidebarBadges): NavGroup[] {
  return [
    {
      items: [
        { href: '/',             label: 'Home',         icon: HomeIcon },
        { href: '/clients',      label: 'Clients',      icon: Building2Icon },
        { href: '/declarations', label: 'Declarations', icon: FileTextIcon,
          badge: badges.declarationsInReview },
        { href: '/deadlines',    label: 'Deadlines',    icon: CalendarIcon,
          badge: badges.deadlinesUrgent },
      ],
    },
    {
      label: 'CRM',
      roles: ['admin', 'reviewer'],
      items: [
        { href: '/crm',          label: 'CRM',           icon: BriefcaseIcon },
      ],
    },
    {
      // 2026-04-24 stint 35: Tax-Ops restructured from a single item into
      // a tax-type-category tree. Matches Diego's Excel mental model
      // (4 CIT sheets + 7 VAT sheets). NWT split into its own item
      // because it's a year-end advisory review, not a filing.
      label: 'Tax-Ops',
      roles: ['admin', 'reviewer'],
      items: [
        { href: '/tax-ops',                  label: 'Overview',             icon: FileStackIcon },
        { href: '/tax-ops/cit',              label: 'Corporate tax returns', icon: LandmarkIcon },
        { href: '/tax-ops/nwt',              label: 'NWT reviews',          icon: SearchCheckIcon },
        {
          href: '/tax-ops/vat',
          label: 'VAT',
          icon: ReceiptIcon,
          children: [
            { href: '/tax-ops/vat/annual',    label: 'Annual',    icon: ReceiptIcon },
            { href: '/tax-ops/vat/quarterly', label: 'Quarterly', icon: ReceiptIcon },
            { href: '/tax-ops/vat/monthly',   label: 'Monthly',   icon: ReceiptIcon },
          ],
        },
        { href: '/tax-ops/subscription-tax', label: 'Subscription tax',     icon: CoinsIcon },
        { href: '/tax-ops/wht',              label: 'Withholding tax',      icon: WalletIcon },
        { href: '/tax-ops/bcl',              label: 'BCL reporting',        icon: LibraryBigIcon },
        { href: '/tax-ops/other',            label: 'Other (ad-hoc)',       icon: FolderIcon },
        { href: '/tax-ops/entities',         label: 'Entities',             icon: Building2Icon },
        { href: '/tax-ops/tasks',            label: 'Tasks',                icon: CheckSquareIcon },
        { href: '/tax-ops/settings',         label: 'Settings',             icon: SettingsIcon },
      ],
    },
    {
      label: 'Library',
      roles: ['admin', 'reviewer'],
      items: [
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

// localStorage key for the expanded state of a given parent href
const EXPANDED_KEY_PREFIX = 'cifra-sidebar-expanded-';

export function Sidebar({ badges = {} }: { badges?: SidebarBadges }) {
  const pathname = usePathname() || '/';
  const [role, setRole] = useState<Role>('admin');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  // Load persisted expand state per-parent from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next: Record<string, boolean> = {};
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith(EXPANDED_KEY_PREFIX)) continue;
      const href = key.slice(EXPANDED_KEY_PREFIX.length);
      next[href] = window.localStorage.getItem(key) === '1';
    }
    setExpanded(next);
  }, []);

  const groups = filterForRole(buildGroups(badges), role);

  // Match rule: exact "/" for Home; otherwise startsWith for nested routes
  // (so /declarations/xyz still lights up the Declarations item).
  const isActive = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  // Auto-expand a parent when its own route or one of its children is active,
  // so a deep-link to /tax-ops/vat/quarterly shows the tree opened.
  const isParentAutoExpanded = (item: NavItem): boolean => {
    if (!item.children) return false;
    if (isActive(item.href)) return true;
    return item.children.some(c => isActive(c.href));
  };

  const isExpanded = (item: NavItem): boolean => {
    if (!item.children) return false;
    return expanded[item.href] ?? isParentAutoExpanded(item);
  };

  const toggleExpand = (href: string) => {
    setExpanded(prev => {
      const nextVal = !(prev[href] ?? false);
      const next = { ...prev, [href]: nextVal };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`${EXPANDED_KEY_PREFIX}${href}`, nextVal ? '1' : '0');
      }
      return next;
    });
  };

  const renderItem = (item: NavItem, isChild = false): React.ReactNode => {
    const active = isActive(item.href);
    const Icon = item.icon;
    const hasChildren = !!(item.children && item.children.length > 0);
    const open = isExpanded(item);
    return (
      <li key={item.href} className="relative">
        {active && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-brand-500"
            aria-hidden="true"
          />
        )}
        <div className="flex items-center">
          <Link
            href={item.href}
            className={[
              'flex items-center gap-2.5 pr-1 h-8 rounded-md text-[13px]',
              'transition-colors duration-150 flex-1 min-w-0',
              isChild ? 'pl-8' : 'pl-3',
              active
                ? 'bg-brand-50 text-brand-700 font-medium'
                : 'text-ink-soft hover:bg-surface-alt hover:text-ink',
            ].join(' ')}
          >
            <Icon
              size={isChild ? 13 : 16}
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
          {hasChildren && (
            <button
              type="button"
              onClick={() => toggleExpand(item.href)}
              aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
              aria-expanded={open}
              className="shrink-0 p-1 mr-1 rounded text-ink-muted hover:text-ink hover:bg-surface-alt"
            >
              <ChevronRightIcon
                size={12}
                className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
              />
            </button>
          )}
        </div>
        {hasChildren && open && (
          <ul className="space-y-0.5 mt-0.5">
            {item.children!.map(child => renderItem(child, true))}
          </ul>
        )}
      </li>
    );
  };

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
              {group.items.map(item => renderItem(item))}
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
