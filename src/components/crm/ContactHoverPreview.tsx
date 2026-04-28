'use client';

// ContactHoverPreview — popover that opens after 400ms of hovering on a
// contact name in any list. Surfaces lifecycle / engagement / role +
// linked companies and recent activity counts.
//
// Stint 63.L — same UX as CompanyHoverPreview, fetches from
// /api/crm/contacts/[id] which returns `{ contact, companies, activities }`.

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { LABELS_LIFECYCLE, type ContactLifecycle } from '@/lib/crm-types';

const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

interface PreviewPayload {
  lifecycle_stage: string | null;
  engagement_score: number | null;
  job_title: string | null;
  email: string | null;
  country: string | null;
  primary_company_name: string | null;
  company_count: number;
  activity_count: number;
  last_activity_date: string | null;
  tags: string[];
}

const cache = new Map<string, PreviewPayload>();

interface ContactDetailResponse {
  contact: {
    lifecycle_stage: string | null;
    engagement_score: number | null;
    job_title: string | null;
    email: string | null;
    country: string | null;
    tags: string[] | null;
  };
  companies: Array<{ company_name: string; is_primary: boolean }>;
  activities: Array<{ activity_date: string }>;
}

async function fetchPreview(contactId: string): Promise<PreviewPayload | null> {
  if (cache.has(contactId)) return cache.get(contactId)!;
  try {
    const res = await fetch(`/api/crm/contacts/${contactId}`);
    if (!res.ok) return null;
    const detail = await res.json() as ContactDetailResponse;
    const companies = detail.companies ?? [];
    const activities = detail.activities ?? [];
    const primary = companies.find(c => c.is_primary) ?? companies[0];
    const payload: PreviewPayload = {
      lifecycle_stage: detail.contact.lifecycle_stage,
      engagement_score: detail.contact.engagement_score,
      job_title: detail.contact.job_title,
      email: detail.contact.email,
      country: detail.contact.country,
      primary_company_name: primary?.company_name ?? null,
      company_count: companies.length,
      activity_count: activities.length,
      last_activity_date: activities[0]?.activity_date ?? null,
      tags: detail.contact.tags ?? [],
    };
    cache.set(contactId, payload);
    return payload;
  } catch {
    return null;
  }
}

interface Props {
  contactId: string;
  children: React.ReactNode;
}

export function ContactHoverPreview({ contactId, children }: Props) {
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
      const p = await fetchPreview(contactId);
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
          {/* Lifecycle + engagement */}
          <div className="flex items-center justify-between mb-2">
            {data.lifecycle_stage ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-semibold bg-brand-50 text-brand-700">
                {LABELS_LIFECYCLE[data.lifecycle_stage as ContactLifecycle] ?? data.lifecycle_stage}
              </span>
            ) : <span />}
            {data.engagement_score !== null && (
              <span className="text-2xs text-ink-muted">
                Engagement: <span className="font-semibold text-ink">{data.engagement_score}</span>
              </span>
            )}
          </div>

          {/* Identity */}
          {(data.job_title || data.email) && (
            <div className="text-2xs text-ink-muted mb-2 leading-snug">
              {data.job_title && <div className="text-ink">{data.job_title}</div>}
              {data.email && <div className="truncate">{data.email}</div>}
            </div>
          )}

          {/* Stats grid 2×2 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Stat label="companies" value={String(data.company_count)} />
            <Stat label="activities" value={String(data.activity_count)} />
            <Stat label="primary" value={data.primary_company_name ?? '—'} small />
            <Stat label="last activity" value={data.last_activity_date ? formatRelative(data.last_activity_date) : '—'} small />
          </div>

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

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`${small ? 'text-xs' : 'text-base'} font-semibold text-ink leading-none truncate`}>
        {value}
      </div>
      <div className="text-2xs text-ink-muted leading-tight mt-0.5">{label}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
