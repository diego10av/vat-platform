'use client';

// ════════════════════════════════════════════════════════════════════════
// WipWidget — "Unbilled work" on the CRM home. Reuses the existing
// /api/crm/wip endpoint (lifetime unbilled per matter, sorted by
// value desc). Shows the summary total + top 5 matters. Clicking a
// row navigates to the matter detail (where the user can generate
// an invoice).
//
// Actionable-first: the whole point is "what do I need to bill this
// week" — every row has a direct drill-through.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EuroIcon, ChevronRightIcon } from 'lucide-react';
import { formatEur } from '@/lib/crm-types';

interface WipMatter {
  matter_id: string;
  matter_reference: string;
  title: string;
  client_name: string | null;
  unbilled_hours: string | number;
  unbilled_amount: string | number;
}

interface WipData {
  matters: WipMatter[];
  total_wip_amount: number;
  total_wip_hours: number;
}

export function WipWidget() {
  const [data, setData] = useState<WipData | null>(null);

  useEffect(() => {
    fetch('/api/crm/wip', { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="border border-border rounded-lg bg-white p-4 min-h-[110px] text-[12px] text-ink-muted italic flex items-center justify-center">
        Computing WIP…
      </div>
    );
  }

  const topMatters = data.matters.filter(m => Number(m.unbilled_amount) > 0).slice(0, 5);
  const hasWip = topMatters.length > 0;
  const totalAmount = Number(data.total_wip_amount ?? 0);

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <EuroIcon size={13} className="text-amber-600" />
          <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
            Unbilled work
          </span>
        </div>
        <span className={`text-[16px] font-semibold tabular-nums ${totalAmount > 0 ? 'text-amber-700' : 'text-ink-muted'}`}>
          {formatEur(totalAmount)}
        </span>
      </div>
      {!hasWip ? (
        <div className="p-4 text-[13px] text-emerald-700 font-medium">
          ✓ Everything billable is on an invoice.
          <div className="text-[11.5px] text-ink-muted mt-0.5 italic font-normal">
            No unbilled time or disbursements across open matters.
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {topMatters.map(m => (
            <li key={m.matter_id}>
              <Link
                href={`/crm/matters/${m.matter_id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-surface-alt/60 text-[12.5px]"
              >
                <span className="shrink-0 font-mono text-[11px] text-brand-700 w-[100px] truncate">
                  {m.matter_reference}
                </span>
                <span className="flex-1 min-w-0 truncate text-ink">
                  {m.title}
                  {m.client_name && <span className="text-ink-muted text-[11px]"> · {m.client_name}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-ink-muted">
                  {Number(m.unbilled_hours).toFixed(1)}h
                </span>
                <span className="shrink-0 tabular-nums font-medium text-amber-700 w-[80px] text-right">
                  {formatEur(m.unbilled_amount)}
                </span>
                <ChevronRightIcon size={12} className="text-ink-muted" />
              </Link>
            </li>
          ))}
          {data.matters.length > 5 && (
            <li className="px-4 py-1.5 text-center text-[11px] text-ink-muted italic border-t border-border">
              + {data.matters.length - 5} more matter{data.matters.length - 5 === 1 ? '' : 's'} with unbilled work
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
