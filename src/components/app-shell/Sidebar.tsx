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
  LandmarkIcon, SearchCheckIcon, ReceiptIcon,
  WalletIcon, CoinsIcon, LibraryBigIcon, FolderIcon, CheckSquareIcon,
  BarChart3Icon, ShieldCheckIcon, SettingsIcon, ChevronRightIcon,
  TargetIcon, CircleIcon, PercentIcon, CalculatorIcon, ScrollTextIcon,
  type LucideIcon,
} from 'lucide-react';

// Icon name → component (stint 38.A). Sidebar_icon column stores the
// lucide icon name; this map decodes. Anything not here falls back
// to CircleIcon. Stint 52-followup — EuroIcon dropped (Diego: "queda
// cutrísimo"); replaced everywhere VAT renders by CalculatorIcon.
// Old `sidebar_icon = 'EuroIcon'` rows in tax_deadline_rules now fall
// back to CircleIcon, but the seed migration 067 already swapped them.
const ICON_MAP: Record<string, LucideIcon> = {
  LandmarkIcon, SearchCheckIcon, ReceiptIcon, WalletIcon,
  CoinsIcon, LibraryBigIcon, FolderIcon, FileStackIcon,
  FileTextIcon, Building2Icon, CalendarIcon, BriefcaseIcon,
  TargetIcon, CircleIcon, PercentIcon,
  CalculatorIcon, ScrollTextIcon,
};
function iconFor(name: string | null | undefined): LucideIcon {
  return (name && ICON_MAP[name]) || CircleIcon;
}

// Map known tax_type → canonical URL. Unknown tax_types fall back to
// /tax-ops/category/<tax_type> which uses a generic matrix page.
const TAX_TYPE_TO_URL: Record<string, string> = {
  cit_annual:                 '/tax-ops/cit',
  // Stint 42 cleanup: NWT lives as a column inside the CIT matrix
  // (37.D rework). The standalone /tax-ops/nwt page was deleted.
  nwt_annual:                 '/tax-ops/cit',
  vat_annual:                 '/tax-ops/vat/annual',
  vat_simplified_annual:      '/tax-ops/vat/annual',
  vat_quarterly:              '/tax-ops/vat/quarterly',
  vat_monthly:                '/tax-ops/vat/monthly',
  subscription_tax_quarterly: '/tax-ops/subscription-tax',
  wht_director_monthly:       '/tax-ops/wht/monthly',
  wht_director_semester:      '/tax-ops/wht/semester',
  wht_director_annual:        '/tax-ops/wht/annual',
  fatca_crs_annual:           '/tax-ops/fatca-crs',
  // Stint 40.D — BCL merged into a single sidebar item; both sub-pages
  // still exist but are reached via /tax-ops/bcl tabs.
  bcl_sbs_quarterly:          '/tax-ops/bcl',
  bcl_216_monthly:            '/tax-ops/bcl',
};
function urlForTaxType(taxType: string): string {
  return TAX_TYPE_TO_URL[taxType] ?? `/tax-ops/category/${taxType}`;
}
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

interface TaxCategory {
  tax_type: string;
  period_pattern: string;
  sidebar_label: string;
  sidebar_icon: string | null;
  sidebar_group: string | null;
  sidebar_order: number;
}

/** Build the dynamic chunk of Tax-Ops children from the categories API.
 *  Rules without a sidebar_group sit at the top level of Tax-Ops.
 *  Rules with sidebar_group nest under a parent with that group name
 *  (VAT filings → Annual / Quarterly / Monthly). Stint 38.A. */
function buildTaxCategoryNavItems(categories: TaxCategory[]): NavItem[] {
  if (categories.length === 0) {
    // Fallback: the hardcoded list from stint 37.B. Used when /api/tax-ops/
    // categories is unreachable or hasn't run migration 050 yet.
    return [
      // Stint 51.F — Diego: VAT filings goes ABOVE Corporate tax returns.
      // Stint 52-followup — children share the same CalculatorIcon as the
      // parent (was ReceiptIcon, which still rendered as a € glyph).
      {
        href: '/tax-ops/vat',
        label: 'VAT filings',
        icon: CalculatorIcon,
        children: [
          { href: '/tax-ops/vat/annual',    label: 'Annual',    icon: CalculatorIcon },
          { href: '/tax-ops/vat/quarterly', label: 'Quarterly', icon: CalculatorIcon },
          { href: '/tax-ops/vat/monthly',   label: 'Monthly',   icon: CalculatorIcon },
        ],
      },
      { href: '/tax-ops/cit',              label: 'Corporate tax returns', icon: LandmarkIcon },
      { href: '/tax-ops/subscription-tax', label: 'Subscription tax',     icon: PercentIcon },
      { href: '/tax-ops/wht',              label: 'Withholding tax',      icon: WalletIcon },
      { href: '/tax-ops/bcl',              label: 'BCL reporting',        icon: LibraryBigIcon },
    ];
  }

  // Group by sidebar_group. null group → top-level.
  // Stint 51.F — track a sidebar_order alongside each item so we can sort
  // the final top-level list by it (otherwise grouped parents always
  // append to the end, which is why VAT filings used to sit at the bottom
  // even though Diego wanted it on top).
  type ItemWithOrder = { item: NavItem; order: number };
  const topLevel: ItemWithOrder[] = [];
  const byGroup = new Map<string, ItemWithOrder[]>();
  for (const c of categories) {
    const url = urlForTaxType(c.tax_type);
    const item: NavItem = {
      href: url,
      label: c.sidebar_label,
      icon: iconFor(c.sidebar_icon),
    };
    const entry = { item, order: c.sidebar_order ?? 100 };
    if (c.sidebar_group) {
      if (!byGroup.has(c.sidebar_group)) byGroup.set(c.sidebar_group, []);
      byGroup.get(c.sidebar_group)!.push(entry);
    } else {
      topLevel.push(entry);
    }
  }

  // For each group, create a parent item that takes the smallest order of
  // its children — so the parent slots into the top level at the same
  // position as its first child. Group 'vat' → VAT filings.
  for (const [groupName, children] of byGroup) {
    const parentLabel = groupName === 'vat' ? 'VAT filings'
                      : groupName.charAt(0).toUpperCase() + groupName.slice(1);
    const parentHref = groupName === 'vat' ? '/tax-ops/vat'
                     : `/tax-ops/group/${groupName}`;
    // Stint 51.F — VAT parent gets CalculatorIcon explicitly (Diego asked
    // for something less "cutre" than EuroIcon).
    const parentIcon = groupName === 'vat'
      ? CalculatorIcon
      : (children[0]?.item.icon ?? FolderIcon);
    const parentOrder = Math.min(...children.map(c => c.order));
    topLevel.push({
      item: {
        href: parentHref,
        label: parentLabel,
        icon: parentIcon,
        children: children.map(c => c.item),
      },
      order: parentOrder,
    });
  }
  topLevel.sort((a, b) => a.order - b.order);
  return topLevel.map(x => x.item);
}

function buildGroups(badges: SidebarBadges, taxCategories: TaxCategory[]): NavGroup[] {
  // 2026-04-24 stint 37.B: sidebar reorg based on Diego's Veeva/Factorial
  // mental model — top-level items are the MODULES (VAT, CRM, Tax-Ops),
  // everything else nests inside. Home stays alone at the top; Operations
  // anchors the admin nav at the bottom.
  //
  // Tax-Ops is now fully collapsible (click chevron to hide all 9
  // sub-items) so the sidebar doesn't saturate the viewport.
  return [
    // Home alone at top (stint 39.A: order was Home/VAT/CRM/Tax-Ops;
    // Diego: "Tax Ops lo pondría debajo de Home. Luego iría VAT.
    // Luego iría CRM." Applied.)
    {
      items: [
        { href: '/', label: 'Home', icon: HomeIcon },
      ],
    },
    // Tax-Ops — promoted above VAT (stint 39.A).
    {
      roles: ['admin', 'reviewer'],
      items: [
        {
          href: '/tax-ops',
          label: 'Tax-Ops',
          icon: FileStackIcon,
          children: [
            { href: '/tax-ops',                  label: 'Overview',              icon: FileStackIcon },
            { href: '/tax-ops/tasks',            label: 'Tasks',                 icon: CheckSquareIcon },
            // Tax-type children are data-driven from /api/tax-ops/categories.
            ...buildTaxCategoryNavItems(taxCategories),
            { href: '/tax-ops/other',            label: 'Other (ad-hoc)',       icon: FolderIcon },
            { href: '/tax-ops/entities',         label: 'Entities',             icon: Building2Icon },
            { href: '/tax-ops/families',         label: 'Families',             icon: Building2Icon },
            { href: '/tax-ops/settings',         label: 'Settings',             icon: SettingsIcon },
          ],
        },
      ],
    },
    // VAT — Diego's original module, now second.
    {
      roles: ['admin', 'reviewer'],
      items: [
        {
          href: '/declarations',
          label: 'VAT',
          // Stint 52-followup — was EuroIcon, matched to CalculatorIcon
          // for parity with the Tax-Ops "VAT filings" parent.
          icon: CalculatorIcon,
          children: [
            { href: '/clients',      label: 'Clients',      icon: Building2Icon },
            { href: '/declarations', label: 'Declarations', icon: FileTextIcon,
              badge: badges.declarationsInReview },
            { href: '/deadlines',    label: 'Deadlines',    icon: CalendarIcon,
              badge: badges.deadlinesUrgent },
            { href: '/legal-watch',  label: 'Legal watch',  icon: BookOpenIcon },
          ],
        },
      ],
    },
    {
      roles: ['admin', 'reviewer'],
      items: [
        {
          href: '/crm',
          label: 'CRM',
          icon: BriefcaseIcon,
          children: [
            { href: '/crm',          label: 'Overview', icon: BriefcaseIcon },
            { href: '/crm/outreach', label: 'Outreach', icon: TargetIcon },
          ],
        },
      ],
    },
    {
      label: 'Operations',
      roles: ['admin', 'reviewer'],
      items: [
        { href: '/metrics',  label: 'Metrics',  icon: BarChart3Icon },
        { href: '/audit',    label: 'Audit',    icon: ShieldCheckIcon },
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
  const [taxCategories, setTaxCategories] = useState<TaxCategory[]>([]);

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

  // Stint 38.A — fetch tax-type sidebar categories. Silent fail → uses
  // hardcoded fallback from buildTaxCategoryNavItems.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tax-ops/categories')
      .then(r => r.ok ? r.json() : { categories: [] })
      .then((body: { categories: TaxCategory[] }) => {
        if (!cancelled) setTaxCategories(body.categories ?? []);
      })
      .catch(() => { /* sidebar still renders via fallback */ });
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

  const groups = filterForRole(buildGroups(badges, taxCategories), role);

  // Stint 48.B1 — match rule has to know whether the item has children.
  // For Home (`/`): only match exact. For LEAF items: match the route or
  // any sub-route (so /declarations/xyz keeps lighting up Declarations).
  // For PARENT items (those with children, e.g. Overview = /tax-ops):
  // match exact only. Otherwise the parent's `startsWith(href + '/')`
  // would also fire on /tax-ops/vat/quarterly, lighting up BOTH Overview
  // and the actual leaf — Diego's bug report from 2026-04-27.
  const isActive = (href: string, isLeaf: boolean): boolean => {
    if (href === '/') return pathname === '/';
    if (!isLeaf) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  // Auto-expand a parent when its own route or one of its children is active,
  // so a deep-link to /tax-ops/vat/quarterly shows the tree opened.
  const isParentAutoExpanded = (item: NavItem): boolean => {
    if (!item.children) return false;
    if (pathname === item.href) return true;
    return item.children.some(c => isActive(c.href, !c.children));
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

  // Indent scale per nesting depth (stint 37.B: supports grandchildren
  // for VAT filings → Annual/Quarterly/Monthly inside Tax-Ops).
  const indentClass = (depth: number): string => {
    if (depth === 0) return 'pl-3';
    if (depth === 1) return 'pl-8';
    return 'pl-12';  // depth >= 2
  };

  const renderItem = (item: NavItem, depth = 0): React.ReactNode => {
    const hasChildren = !!(item.children && item.children.length > 0);
    const active = isActive(item.href, !hasChildren);
    const Icon = item.icon;
    const open = isExpanded(item);
    const iconSize = depth === 0 ? 16 : 13;
    return (
      <li key={item.href} className="relative">
        {/* Stint 48.U1 — back to brand-pink rail. Diego: "tendría más
            sentido el color de cifra (rojo) que el gris". Reverts the
            stint 40.K change. The rail is still 2px (not 3px) so it's
            clearly the active marker without overwhelming. */}
        {active && (
          <span
            className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-brand-500"
            aria-hidden="true"
          />
        )}
        <div className="flex items-center">
          <Link
            href={item.href}
            className={[
              'flex items-center gap-2.5 pr-1 h-8 rounded-md text-sm',
              'transition-colors duration-150 flex-1 min-w-0',
              indentClass(depth),
              active
                ? 'bg-surface-alt text-ink font-medium'
                : 'text-ink-soft hover:bg-surface-alt hover:text-ink',
            ].join(' ')}
          >
            <Icon
              size={iconSize}
              strokeWidth={active ? 2.2 : 1.8}
              className={active ? 'text-ink' : 'text-ink-muted'}
            />
            <span className="flex-1 truncate">{item.label}</span>
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span
                className={[
                  'tabular-nums inline-flex items-center justify-center',
                  'min-w-[18px] h-[18px] px-1 rounded-full text-2xs font-semibold',
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
            {item.children!.map(child => renderItem(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      className="hidden md:flex flex-col fixed top-0 left-0 bottom-0 w-[232px] bg-surface border-r border-divider z-drawer"
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
              <div className="px-3 mb-1.5 text-2xs uppercase tracking-[0.08em] font-semibold text-ink-faint">
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
      <div className="text-sm font-medium text-ink truncate leading-tight">
        {label}
      </div>
      <div className="text-2xs text-ink-muted truncate leading-tight mt-0.5">
        {tagline}
      </div>
    </div>
  );
}
