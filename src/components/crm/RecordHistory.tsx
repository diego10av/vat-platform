'use client';

// ════════════════════════════════════════════════════════════════════════
// RecordHistory — shows the audit_log timeline for a single CRM record.
//
// Dropped at the bottom of every detail page (company, contact,
// opportunity, matter, invoice). Collapsible — starts closed so the
// detail page header stays clean. When opened, shows the N most recent
// changes with before / after / timestamp / user.
//
// Sources: each write endpoint (POST/PUT/DELETE) in /api/crm/* emits
// one audit_log row per changed field. This component just queries
// /api/crm/audit?target_type=...&target_id=... and renders a timeline.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon } from 'lucide-react';

interface AuditEntry {
  id: string;
  user_id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  create:           'Created',
  update:           'Updated',
  // Pre-stint-96 audit rows may still carry soft_delete / restore /
  // permanent_delete actions; keep the labels so history reads cleanly.
  soft_delete:      'Deleted (legacy)',
  restore:          'Restored',
  permanent_delete: 'Permanently deleted',
  delete:           'Deleted',
  payment_recorded: 'Payment recorded',
  payment_deleted:  'Payment removed',
};

export function RecordHistory({
  targetType, targetId,
}: {
  targetType: string;
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (rows !== null) return;  // already loaded
    setLoading(true);
    try {
      const res = await fetch(
        `/api/crm/audit?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}&limit=100`,
        { cache: 'no-store' },
      );
      if (res.ok) setRows(await res.json());
      else setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && rows === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="mt-6 border border-border rounded-lg bg-white">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt/50"
      >
        {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
        <HistoryIcon size={13} className="text-ink-muted" />
        <span className="text-sm uppercase tracking-wide font-semibold text-ink-muted">
          History
        </span>
        {rows && rows.length > 0 && (
          <span className="text-2xs text-ink-muted font-normal">· {rows.length} change{rows.length === 1 ? '' : 's'}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border">
          {loading ? (
            <div className="px-3 py-4 text-sm text-ink-muted italic">Loading history…</div>
          ) : rows && rows.length > 0 ? (
            <ol className="divide-y divide-border">
              {rows.map(r => <AuditRow key={r.id} entry={r} />)}
            </ol>
          ) : (
            <div className="px-3 py-4 text-sm text-ink-muted italic">No history yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const actionLabel = ACTION_LABELS[entry.action] ?? entry.action;
  const when = new Date(entry.created_at);
  const whenStr = when.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const age = humanAge(when);

  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-ink">{entry.user_id}</span>
        <span className="text-ink-soft">{actionLabel.toLowerCase()}</span>
        {entry.field && (
          <code className="text-2xs bg-surface-alt px-1 py-0.5 rounded text-ink-soft">{entry.field}</code>
        )}
        <span className="text-ink-faint ml-auto" title={whenStr}>{age}</span>
      </div>
      {(entry.old_value || entry.new_value) && (
        <div className="mt-1 text-xs text-ink-muted">
          {entry.old_value && (
            <span className="line-through text-danger-600/80 mr-2 break-all">{truncate(entry.old_value, 100)}</span>
          )}
          {entry.new_value && (
            <span className="text-emerald-700 break-all">→ {truncate(entry.new_value, 100)}</span>
          )}
        </div>
      )}
      {entry.reason && (
        <div className="mt-0.5 text-2xs text-ink-faint italic">{entry.reason}</div>
      )}
    </li>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function humanAge(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
