'use client';

// ════════════════════════════════════════════════════════════════════════
// InboxButton — replaces the placeholder bell in the topbar with a
// genuinely actionable "your queue" dropdown.
//
// Design per Diego (2026-04-18) + PROTOCOLS §11:
//
// - Every item represents a NEXT ACTION the reviewer can execute now.
//   Never "waiting on client", never vanity counters.
// - Badge shows the count of *critical* + *warning* items. Info-level
//   items (admin nudges) don't pump the number. If you're a reviewer
//   and the Inbox is "clear" visually, nothing you can act on is
//   waiting. That's the whole point.
// - When there's no action pending, the button shows the inbox icon
//   without a badge, and clicking opens a positive "Inbox clear"
//   message. No ghost dot.
//
// Data from /api/inbox (60s cache server-side).
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  InboxIcon, AlertTriangleIcon, ClockIcon, CheckCircle2Icon,
  FileTextIcon, MailIcon, ShieldAlertIcon, XCircleIcon, InfoIcon,
  WalletIcon, MessageCircleIcon, DatabaseIcon,
} from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info';

type InboxKind =
  | 'client_approved'
  | 'filing_overdue' | 'filing_soon'
  | 'payment_overdue' | 'payment_soon'
  | 'aed_urgent'
  | 'extraction_errors'
  | 'validator_findings'
  | 'budget_warn'
  | 'feedback_new'
  | 'schema_missing';

interface InboxItem {
  id: string;
  kind: InboxKind;
  severity: Severity;
  title: string;
  description: string;
  href: string;
}

interface Counts {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

export function InboxButton() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox');
      const data = await res.json();
      if (!res.ok) {
        // Silent failure — show empty inbox, don't block the topbar.
        setItems([]);
        setCounts({ critical: 0, warning: 0, info: 0, total: 0 });
        return;
      }
      setItems(data.items as InboxItem[]);
      setCounts(data.counts as Counts);
      setLastFetched(Date.now());
    } catch {
      setItems([]);
      setCounts({ critical: 0, warning: 0, info: 0, total: 0 });
    }
  }, []);

  // Eager load on mount so the badge count is correct before the user
  // hovers. Re-poll every 90s. Foreground tab only — we throttle when
  // the tab is hidden by keying off document.visibilityState.
  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load();
      }
    }, 90_000);
    return () => clearInterval(interval);
  }, [load]);

  // Also refresh on dropdown open, but only if the cached data is
  // older than 15s (gives the user a "it's current" feel without
  // spamming).
  useEffect(() => {
    if (!open) return;
    if (Date.now() - lastFetched > 15_000) void load();
  }, [open, lastFetched, load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Badge count excludes info-level (admin nudges like "apply migration"
  // don't interrupt a reviewer's workflow).
  const badge = counts ? counts.critical + counts.warning : 0;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={badge > 0 ? `Inbox: ${badge} items awaiting action` : 'Inbox'}
        aria-expanded={open}
        aria-haspopup="menu"
        title={badge > 0 ? `${badge} items awaiting action` : 'Inbox'}
        className={[
          'relative w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors',
          open
            ? 'bg-brand-50 text-brand-700'
            : 'text-ink-soft hover:bg-surface-alt hover:text-ink',
        ].join(' ')}
      >
        <InboxIcon size={16} strokeWidth={1.8} />
        {badge > 0 && (
          <span
            className={[
              'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9.5px] font-bold',
              'inline-flex items-center justify-center tabular-nums',
              counts && counts.critical > 0
                ? 'bg-danger-500 text-white'
                : 'bg-warning-500 text-white',
            ].join(' ')}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <InboxDropdown
          items={items}
          counts={counts}
          onDismiss={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function InboxDropdown({
  items, counts, onDismiss,
}: {
  items: InboxItem[] | null;
  counts: Counts | null;
  onDismiss: () => void;
}) {
  const isLoading = items === null;
  const actionItems = items?.filter(i => i.severity !== 'info') ?? [];
  const infoItems = items?.filter(i => i.severity === 'info') ?? [];
  const hasActions = actionItems.length > 0;

  return (
    <div
      role="menu"
      aria-label="Inbox"
      className="absolute right-0 top-full mt-2 w-[440px] bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-fadeInScale"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between bg-surface-alt/40">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Inbox</h3>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {counts && counts.total > 0
              ? `${actionItems.length} to action${infoItems.length > 0 ? ` · ${infoItems.length} info` : ''}`
              : 'Items that need your attention'}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[520px] overflow-y-auto">
        {isLoading ? (
          <div className="p-6 text-center text-[12px] text-ink-muted">Loading…</div>
        ) : !hasActions && infoItems.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {actionItems.length > 0 && (
              <ul className="divide-y divide-divider">
                {actionItems.map((item) => (
                  <li key={item.id}>
                    <InboxRow item={item} onClick={onDismiss} />
                  </li>
                ))}
              </ul>
            )}

            {infoItems.length > 0 && (
              <>
                {hasActions && (
                  <div className="px-4 py-2 bg-surface-alt/60 text-[10px] uppercase tracking-wide font-semibold text-ink-muted border-t border-b border-divider">
                    Admin / setup
                  </div>
                )}
                <ul className="divide-y divide-divider">
                  {infoItems.map((item) => (
                    <li key={item.id}>
                      <InboxRow item={item} onClick={onDismiss} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InboxRow({ item, onClick }: { item: InboxItem; onClick: () => void }) {
  const { Icon, tint } = kindVisual(item.kind, item.severity);
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="block px-4 py-3 hover:bg-surface-alt/40 transition-colors group"
    >
      <div className="flex items-start gap-3">
        <div className={`w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0 ${tint}`}>
          <Icon size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-ink leading-snug">
            {item.title}
          </div>
          <div className="text-[11.5px] text-ink-muted mt-0.5 leading-snug">
            {item.description}
          </div>
        </div>
        <SeverityChip severity={item.severity} />
      </div>
    </Link>
  );
}

function SeverityChip({ severity }: { severity: Severity }) {
  const config = {
    critical: { label: 'Urgent',  cls: 'bg-danger-50 text-danger-700 border-danger-200' },
    warning:  { label: 'Soon',    cls: 'bg-warning-50 text-warning-700 border-warning-200' },
    info:     { label: 'Info',    cls: 'bg-surface-alt text-ink-soft border-border' },
  }[severity];
  return (
    <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${config.cls}`}>
      {config.label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center justify-center mb-3">
        <CheckCircle2Icon size={20} />
      </div>
      <div className="text-[13px] font-medium text-ink">Inbox is clear</div>
      <div className="text-[11.5px] text-ink-muted mt-1.5 max-w-[300px] mx-auto leading-relaxed">
        Nothing needs your attention right now. New urgent items show up
        here automatically — feel free to get on with the day.
      </div>
    </div>
  );
}

function kindVisual(kind: InboxKind, severity: Severity): {
  Icon: React.ComponentType<{ size?: number }>;
  tint: string;
} {
  // Tint depends on severity so the icon carries that signal too.
  const tint =
    severity === 'critical' ? 'bg-danger-50 text-danger-700' :
    severity === 'warning'  ? 'bg-warning-50 text-warning-700' :
                              'bg-surface-alt text-ink-soft';
  const Icon: Record<InboxKind, React.ComponentType<{ size?: number }>> = {
    client_approved:    CheckCircle2Icon,
    filing_overdue:     AlertTriangleIcon,
    filing_soon:        ClockIcon,
    payment_overdue:    AlertTriangleIcon,
    payment_soon:       ClockIcon,
    aed_urgent:         MailIcon,
    extraction_errors:  XCircleIcon,
    validator_findings: ShieldAlertIcon,
    budget_warn:        WalletIcon,
    feedback_new:       MessageCircleIcon,
    schema_missing:     DatabaseIcon,
  };
  return { Icon: Icon[kind] ?? InfoIcon, tint };
}

// Keep so Tailwind doesn't tree-shake the FileTextIcon import if we
// later add a case that uses it.
export const _SILENT = FileTextIcon;
