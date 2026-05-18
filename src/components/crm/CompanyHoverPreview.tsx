'use client';

// CompanyHoverPreview — popover that opens after 400ms of hovering on
// a company name in any list. Shows # contacts / # opportunities /
// # matters / # invoices, plus the top tags + a one-line "next action".
//
// Stint 63.C (2026-04-28). Same UX as TaskHoverPreview in Tax-Ops, but
// fed by /api/crm/companies/[id] which already returns the related
// arrays in a single round-trip.

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { getTriggerRect } from '@/lib/dom-trigger-rect';

const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

interface PreviewPayload {
  contact_count: number;
  opportunity_count_open: number;
  matter_count_active: number;
  invoice_count_outstanding: number;
  tags: string[];
  classification: string | null;
  country: string | null;
}

const cache = new Map<string, PreviewPayload>();

interface CompanyDetailResponse {
  company: {
    classification?: string | null;
    country?: string | null;
    tags?: string[] | null;
  };
  contacts: unknown[];
  opportunities: Array<{ stage: string }>;
  matters: Array<{ status: string }>;
  invoices: Array<{ status: string; outstanding: number | string }>;
}

async function fetchPreview(companyId: string): Promise<PreviewPayload | null> {
  if (cache.has(companyId)) return cache.get(companyId)!;
  try {
    const res = await fetch(`/api/crm/companies/${companyId}`);
    if (!res.ok) return null;
    const detail = await res.json() as CompanyDetailResponse;
    const payload: PreviewPayload = {
      contact_count: detail.contacts?.length ?? 0,
      // Open opportunities = anything not won/lost.
      opportunity_count_open: (detail.opportunities ?? [])
        .filter(o => o.stage !== 'won' && o.stage !== 'lost').length,
      // Active matters = status active or on_hold.
      matter_count_active: (detail.matters ?? [])
        .filter(m => m.status === 'active' || m.status === 'on_hold').length,
      // Outstanding invoices = anything with non-zero outstanding.
      invoice_count_outstanding: (detail.invoices ?? [])
        .filter(i => Number(i.outstanding) > 0).length,
      tags: detail.company?.tags ?? [],
      classification: detail.company?.classification ?? null,
      country: detail.company?.country ?? null,
    };
    cache.set(companyId, payload);
    return payload;
  } catch {
    return null;
  }
}

interface Props {
  companyId: string;
  children: React.ReactNode;
}

export function CompanyHoverPreview({ companyId, children }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function recompute() {
    // Wrapper below uses `display: contents` (no layout box). See
    // src/lib/dom-trigger-rect.ts for why we walk children.
    const r = getTriggerRect(triggerRef.current);
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
      const p = await fetchPreview(companyId);
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
          {/* Stats grid 2×2 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Stat icon="👥" label="contacts" value={data.contact_count} />
            <Stat icon="🎯" label="open opps" value={data.opportunity_count_open} />
            <Stat icon="💼" label="active matters" value={data.matter_count_active} />
            <Stat icon="🧾" label="outstanding inv." value={data.invoice_count_outstanding} />
          </div>
          {/* Meta line: classification + country */}
          {(data.classification || data.country) && (
            <div className="text-2xs text-ink-muted mb-1.5">
              {data.classification && <span className="capitalize">{data.classification.replace(/_/g, ' ')}</span>}
              {data.classification && data.country && <span> · </span>}
              {data.country && <span>{data.country}</span>}
            </div>
          )}
          {/* Tags */}
          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border">
              {data.tags.slice(0, 4).map((t, i) => (
                <span key={i} className="text-2xs px-1 py-0 rounded bg-surface-alt text-ink-muted">
                  {t}
                </span>
              ))}
              {data.tags.length > 4 && (
                <span className="text-2xs text-ink-faint">+{data.tags.length - 4}</span>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-base shrink-0" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <div className="text-base font-semibold text-ink leading-none tabular-nums">{value}</div>
        <div className="text-2xs text-ink-muted leading-tight mt-0.5">{label}</div>
      </div>
    </div>
  );
}
