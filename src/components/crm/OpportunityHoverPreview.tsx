'use client';

// OpportunityHoverPreview — popover that opens after 400ms of hovering
// on an opportunity name in any list. Shows the headline numbers
// (stage / value / weighted / probability / days in stage) plus the
// linked company name + a count of activities logged so far.
//
// Stint 63.L — same UX as CompanyHoverPreview, fetches from
// /api/crm/opportunities/[id] which returns `{ opportunity, activities }`.

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { LABELS_STAGE, formatEur, type OpportunityStage } from '@/lib/crm-types';

const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

interface PreviewPayload {
  stage: string;
  value_eur: number | null;
  weighted_eur: number | null;
  probability_pct: number | null;
  days_in_stage: number | null;
  company_name: string | null;
  next_action: string | null;
  activity_count: number;
}

const cache = new Map<string, PreviewPayload>();

interface OpportunityDetailResponse {
  opportunity: {
    stage: string;
    estimated_value_eur: number | string | null;
    weighted_value_eur: number | string | null;
    probability_pct: number | null;
    stage_entered_at: string | null;
    company_name: string | null;
    next_action: string | null;
  };
  activities: unknown[];
}

async function fetchPreview(opportunityId: string): Promise<PreviewPayload | null> {
  if (cache.has(opportunityId)) return cache.get(opportunityId)!;
  try {
    const res = await fetch(`/api/crm/opportunities/${opportunityId}`);
    if (!res.ok) return null;
    const detail = await res.json() as OpportunityDetailResponse;
    const stageEntered = detail.opportunity.stage_entered_at
      ? new Date(detail.opportunity.stage_entered_at)
      : null;
    const days_in_stage = stageEntered
      ? Math.floor((Date.now() - stageEntered.getTime()) / 86400000)
      : null;
    const payload: PreviewPayload = {
      stage: detail.opportunity.stage,
      value_eur: detail.opportunity.estimated_value_eur !== null
        ? Number(detail.opportunity.estimated_value_eur) : null,
      weighted_eur: detail.opportunity.weighted_value_eur !== null
        ? Number(detail.opportunity.weighted_value_eur) : null,
      probability_pct: detail.opportunity.probability_pct,
      days_in_stage,
      company_name: detail.opportunity.company_name,
      next_action: detail.opportunity.next_action,
      activity_count: detail.activities?.length ?? 0,
    };
    cache.set(opportunityId, payload);
    return payload;
  } catch {
    return null;
  }
}

interface Props {
  opportunityId: string;
  children: React.ReactNode;
}

export function OpportunityHoverPreview({ opportunityId, children }: Props) {
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
      const p = await fetchPreview(opportunityId);
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
          className="z-popover w-[320px] bg-surface border border-border rounded-md shadow-lg p-3 text-sm"
        >
          {/* Stage + days in stage */}
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-semibold bg-brand-50 text-brand-700">
              {LABELS_STAGE[data.stage as OpportunityStage] ?? data.stage}
            </span>
            {data.days_in_stage !== null && (
              <span className="text-2xs text-ink-muted">
                {data.days_in_stage}d in stage
              </span>
            )}
          </div>

          {/* Money grid 2×2 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Stat label="value" value={data.value_eur !== null ? formatEur(data.value_eur) : '—'} />
            <Stat label="weighted" value={data.weighted_eur !== null ? formatEur(data.weighted_eur) : '—'} />
            <Stat label="probability" value={data.probability_pct !== null ? `${data.probability_pct}%` : '—'} />
            <Stat label="activities" value={String(data.activity_count)} />
          </div>

          {/* Linked company */}
          {data.company_name && (
            <div className="text-2xs text-ink-muted mb-1.5">
              <span className="text-ink-faint">Company:</span> {data.company_name}
            </div>
          )}

          {/* Next action */}
          {data.next_action && (
            <div className="text-2xs text-ink-soft pt-1.5 border-t border-border line-clamp-2">
              <span className="font-semibold text-ink">Next:</span> {data.next_action}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-ink leading-none tabular-nums">{value}</div>
      <div className="text-2xs text-ink-muted leading-tight mt-0.5">{label}</div>
    </div>
  );
}
