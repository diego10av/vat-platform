'use client';

// MatterHoverPreview — popover that opens after 400ms of hovering on a
// matter reference in any list. Surfaces status / fee type / client +
// counts of activities and invoices (open + closed).
//
// Stint 63.L — same UX as CompanyHoverPreview, fetches from
// /api/crm/matters/[id] which returns `{ matter, activities, invoices }`.

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { LABELS_MATTER_STATUS, type MatterStatus } from '@/lib/crm-types';

const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

interface PreviewPayload {
  status: string;
  client_name: string | null;
  fee_type: string | null;
  estimated_budget_eur: number | null;
  hourly_rate_eur: number | null;
  conflict_check_done: boolean;
  practice_areas: string[];
  activity_count: number;
  invoice_count_open: number;
  invoice_count_total: number;
}

const cache = new Map<string, PreviewPayload>();

interface MatterDetailResponse {
  matter: {
    status: string;
    client_name: string | null;
    fee_type: string | null;
    estimated_budget_eur: number | string | null;
    hourly_rate_eur: number | string | null;
    conflict_check_done: boolean | null;
    practice_areas: string[] | null;
  };
  activities: unknown[];
  invoices: Array<{ status: string; outstanding: number | string }>;
}

async function fetchPreview(matterId: string): Promise<PreviewPayload | null> {
  if (cache.has(matterId)) return cache.get(matterId)!;
  try {
    const res = await fetch(`/api/crm/matters/${matterId}`);
    if (!res.ok) return null;
    const detail = await res.json() as MatterDetailResponse;
    const invoices = detail.invoices ?? [];
    const payload: PreviewPayload = {
      status: detail.matter.status,
      client_name: detail.matter.client_name,
      fee_type: detail.matter.fee_type,
      estimated_budget_eur: detail.matter.estimated_budget_eur !== null
        ? Number(detail.matter.estimated_budget_eur) : null,
      hourly_rate_eur: detail.matter.hourly_rate_eur !== null
        ? Number(detail.matter.hourly_rate_eur) : null,
      conflict_check_done: !!detail.matter.conflict_check_done,
      practice_areas: detail.matter.practice_areas ?? [],
      activity_count: detail.activities?.length ?? 0,
      invoice_count_open: invoices.filter(i => Number(i.outstanding) > 0).length,
      invoice_count_total: invoices.length,
    };
    cache.set(matterId, payload);
    return payload;
  } catch {
    return null;
  }
}

interface Props {
  matterId: string;
  children: React.ReactNode;
}

export function MatterHoverPreview({ matterId, children }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function recompute() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - 320);
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }

  useLayoutEffect(() => { if (open) recompute(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => recompute();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  function scheduleOpen() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openTimer.current) return;
    openTimer.current = window.setTimeout(async () => {
      openTimer.current = null;
      const p = await fetchPreview(matterId);
      if (p) {
        setData(p);
        setOpen(true);
      }
    }, HOVER_OPEN_MS);
  }

  function scheduleClose() {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, HOVER_CLOSE_MS);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        className="contents"
      >
        {children}
      </span>
      {mounted && open && pos && data && createPortal(
        <div
          onMouseEnter={() => {
            if (closeTimer.current) {
              window.clearTimeout(closeTimer.current);
              closeTimer.current = null;
            }
          }}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-popover w-[300px] bg-surface border border-border rounded-md shadow-lg p-3 text-sm"
        >
          {/* Status + client */}
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-semibold bg-brand-50 text-brand-700">
              {LABELS_MATTER_STATUS[data.status as MatterStatus] ?? data.status}
            </span>
            {!data.conflict_check_done && (
              <span className="text-2xs text-amber-700">⚠ conflict check pending</span>
            )}
          </div>

          {/* Client name */}
          {data.client_name && (
            <div className="text-2xs text-ink-muted mb-2">
              <span className="text-ink-faint">Client:</span> {data.client_name}
            </div>
          )}

          {/* Stats grid 2×2 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Stat label="activities" value={String(data.activity_count)} />
            <Stat label="open invoices" value={String(data.invoice_count_open)} />
            <Stat label="fee type" value={data.fee_type ?? '—'} small />
            <Stat label="hourly rate" value={data.hourly_rate_eur !== null ? `€${data.hourly_rate_eur}` : '—'} small />
          </div>

          {/* Practice areas */}
          {data.practice_areas.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border">
              {data.practice_areas.slice(0, 4).map((t, i) => (
                <span key={i} className="text-2xs px-1 py-0 rounded bg-surface-alt text-ink-muted">
                  {t}
                </span>
              ))}
              {data.practice_areas.length > 4 && (
                <span className="text-2xs text-ink-faint">+{data.practice_areas.length - 4}</span>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div className={`${small ? 'text-sm' : 'text-base'} font-semibold text-ink leading-none tabular-nums`}>
        {value}
      </div>
      <div className="text-2xs text-ink-muted leading-tight mt-0.5">{label}</div>
    </div>
  );
}
