'use client';

// ════════════════════════════════════════════════════════════════════════
// /closing — period-closing dashboard (stint 12 extra #10).
//
// End-of-quarter ritual: "which entities still need their Q1 return
// prepared?". Today a reviewer scans /declarations filtered by period
// + cross-references every entity's frequency. This page collapses
// that into one grid — one row per entity, coloured by status.
//
// Periods are picked via a compact segmented control at the top.
// Default: current calendar quarter.
// Stint 67.B.b: per-page force-dynamic — see /clients/page.tsx.
// ════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarIcon, FileTextIcon, CircleIcon,
  LoaderIcon, ClipboardCheckIcon,
  CheckCircle2Icon, SendIcon, Euro as EuroIcon,
  ArrowRightIcon, PlusIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

interface EntityStatus {
  entity_id: string;
  entity_name: string;
  client_id: string | null;
  client_name: string | null;
  regime: string;
  frequency: string;
  expected: boolean;
  declaration_id: string | null;
  declaration_status: string | null;
  line_count: number;
  vat_payable: number | null;
  filed_at: string | null;
}

interface ClosingResponse {
  period: string;
  year: number;
  kind: 'month' | 'quarter' | 'semester' | 'annual';
  code: string;
  rows: EntityStatus[];
  summary: {
    expected: number;
    not_started: number;
    in_progress: number;
    in_review: number;
    approved: number;
    filed: number;
    paid: number;
  };
}

export default function ClosingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClosingContent />
    </Suspense>
  );
}

function ClosingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  const period = searchParams.get('period') || defaultPeriod;

  const [data, setData] = useState<ClosingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/closing?period=${encodeURIComponent(period)}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? 'Could not load the closing dashboard.');
        return;
      }
      setData(body as ClosingResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const periodOptions = useMemo(() => buildPeriodOptions(now), [now]);

  function setPeriod(p: string) {
    const qs = new URLSearchParams(searchParams);
    qs.set('period', p);
    router.replace(`/closing?${qs.toString()}`, { scroll: false });
  }

  if (!data && !error) return <PageSkeleton />;

  return (
    <div className="max-w-[1400px]">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Closing dashboard</h1>
          <p className="text-sm text-ink-muted mt-1 max-w-xl">
            One row per entity for the chosen period. Fastest way to see "which
            returns still need work" at the end of a quarter.
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {periodOptions.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={[
                'h-8 px-3 rounded-md text-sm font-medium transition-colors',
                period === p.value
                  ? 'bg-brand-500 text-white shadow-xs'
                  : 'bg-surface border border-border text-ink-soft hover:bg-surface-alt',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-5">
            <Metric
              tone="neutral"
              icon={<CircleIcon size={12} />}
              label="Expected"
              value={data.summary.expected}
              caption={`entities on ${frequencyLabel(data.kind)} freq`}
            />
            <Metric
              tone={data.summary.not_started > 0 ? 'danger' : 'neutral'}
              icon={<CircleIcon size={12} />}
              label="Not started"
              value={data.summary.not_started}
            />
            <Metric
              tone="warning"
              icon={<LoaderIcon size={12} />}
              label="In progress"
              value={data.summary.in_progress}
            />
            <Metric
              tone="warning"
              icon={<ClipboardCheckIcon size={12} />}
              label="In review"
              value={data.summary.in_review}
            />
            <Metric
              tone="info"
              icon={<SendIcon size={12} />}
              label="Approved + filed"
              value={data.summary.approved + data.summary.filed}
            />
            <Metric
              tone="success"
              icon={<CheckCircle2Icon size={12} />}
              label="Paid"
              value={data.summary.paid}
            />
          </div>

          {data.rows.length === 0 ? (
            <div className="bg-surface border border-border rounded-lg">
              <EmptyState
                illustration="empty_clients"
                title="No entities yet"
                description="Create a client + entity first, then the closing dashboard lights up."
                action={
                  <Link href="/clients/new" className="h-9 px-4 rounded-md bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600">
                    Create first client
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-alt border-b border-divider text-ink-muted">
                  <tr>
                    <Th>Entity</Th>
                    <Th>Client</Th>
                    <Th>Frequency</Th>
                    <Th>Status</Th>
                    <Th>Lines</Th>
                    <Th>VAT payable</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr
                      key={r.entity_id}
                      className={[
                        'border-b border-divider last:border-0',
                        r.expected && !r.declaration_id ? 'bg-danger-50/30' : '',
                        r.expected && r.declaration_status === 'review' ? 'bg-amber-50/30' : '',
                        !r.expected ? 'opacity-60' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/entities/${r.entity_id}`} className="font-medium text-ink hover:text-brand-600 transition-colors">
                          {r.entity_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {r.client_id
                          ? <Link href={`/clients/${r.client_id}`} className="hover:text-brand-600 hover:underline">{r.client_name ?? 'no name'}</Link>
                          : <span className="text-ink-faint italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-ink-soft capitalize">{r.frequency}</td>
                      <td className="px-4 py-3">
                        <StatusCell row={r} expectedFrequency={frequencyLabel(data.kind)} />
                      </td>
                      <td className="px-4 py-3 text-ink-soft tabular-nums">{r.line_count || '—'}</td>
                      <td className="px-4 py-3 text-ink-soft tabular-nums">
                        {r.vat_payable != null ? formatEur(r.vat_payable) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.declaration_id ? (
                          <Link
                            href={`/declarations/${r.declaration_id}`}
                            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                          >
                            Open <ArrowRightIcon size={11} />
                          </Link>
                        ) : r.expected ? (
                          <Link
                            href={`/declarations?entity_id=${r.entity_id}`}
                            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                          >
                            <PlusIcon size={11} /> Start
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-faint italic">Not expected this period</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium text-2xs uppercase tracking-[0.06em]">{children}</th>;
}

function StatusCell({ row, expectedFrequency }: { row: EntityStatus; expectedFrequency: string }) {
  if (!row.expected) {
    return <span className="text-xs text-ink-faint italic">{row.frequency} freq · not this period</span>;
  }
  if (!row.declaration_id) {
    return <span className="inline-flex items-center gap-1.5 text-danger-700 text-xs font-semibold">
      <CircleIcon size={10} className="fill-danger-500 stroke-danger-500" />
      Not started
    </span>;
  }
  const status = row.declaration_status ?? 'created';
  const map: Record<string, { label: string; tone: 'info' | 'warning' | 'success' | 'ok' | 'neutral' }> = {
    created:     { label: 'Created',       tone: 'neutral' },
    uploading:   { label: 'Uploading docs', tone: 'info' },
    extracting:  { label: 'Extracting',    tone: 'info' },
    classifying: { label: 'Classifying',   tone: 'info' },
    review:      { label: 'In review',     tone: 'warning' },
    approved:    { label: 'Approved',      tone: 'ok' },
    filed:       { label: 'Filed',         tone: 'success' },
    paid:        { label: 'Paid',          tone: 'success' },
  };
  const { label, tone } = map[status] ?? { label: status, tone: 'neutral' };
  const cls = tone === 'success' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : tone === 'ok' ? 'bg-blue-50 text-blue-800 border-blue-200'
    : tone === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : tone === 'info' ? 'bg-brand-50 text-brand-700 border-brand-100'
    : 'bg-surface-alt text-ink-muted border-border';
  return (
    <span className={`inline-flex items-center h-5 px-1.5 rounded border text-2xs font-semibold tracking-wide ${cls}`}>
      {label}
    </span>
  );
  void expectedFrequency; // linting false-positive; kept for API symmetry
}

function Metric({
  tone, icon, label, value, caption,
}: {
  tone: 'neutral' | 'danger' | 'warning' | 'info' | 'success';
  icon: React.ReactNode;
  label: string;
  value: number;
  caption?: string;
}) {
  const palette = tone === 'danger' ? 'bg-danger-50 border-danger-200 text-danger-700'
    : tone === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
    : tone === 'info' ? 'bg-brand-50 border-brand-100 text-brand-700'
    : tone === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : 'bg-surface border-border text-ink-muted';
  return (
    <div className={`border rounded-lg px-3 py-2.5 ${palette}`}>
      <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wide font-semibold">
        {icon}{label}
      </div>
      <div className="text-xl font-semibold tabular-nums text-ink mt-0.5">{value}</div>
      {caption && <div className="text-2xs text-ink-muted mt-0.5">{caption}</div>}
    </div>
  );
}

function formatEur(n: number): string {
  return new Intl.NumberFormat('fr-LU', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function frequencyLabel(kind: ClosingResponse['kind']): string {
  return kind === 'quarter' ? 'quarterly'
    : kind === 'month' ? 'monthly'
    : kind === 'semester' ? 'semestrial'
    : 'yearly';
}

function buildPeriodOptions(now: Date): Array<{ value: string; label: string }> {
  // Current + previous 4 quarters + current year.
  const out: Array<{ value: string; label: string }> = [];
  const y = now.getFullYear();
  const currentQ = Math.floor(now.getMonth() / 3) + 1;
  // Walk backwards from current quarter, generating 5 quarters.
  for (let offset = 0; offset < 5; offset++) {
    let q = currentQ - offset;
    let year = y;
    while (q <= 0) { q += 4; year -= 1; }
    const value = `${year}-Q${q}`;
    const label = offset === 0 ? `Q${q} ${year} (now)` : `Q${q} ${year}`;
    out.push({ value, label });
  }
  out.push({ value: `${y}-Y`, label: `Year ${y}` });
  return out;
}
