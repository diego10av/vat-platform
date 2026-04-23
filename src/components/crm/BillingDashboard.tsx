'use client';

// ════════════════════════════════════════════════════════════════════════
// BillingDashboard — annual revenue + outstanding + aging + splits.
// Pure SVG charts, no external deps (recharts/chart.js would add
// ~150kb for minor polish). Chart sizes adapt via viewBox; mobile/
// tablet shrinks naturally.
// ════════════════════════════════════════════════════════════════════════

import { useCrmFetch } from '@/lib/useCrmFetch';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { formatEur } from '@/lib/crm-types';

interface DashboardData {
  year: number;
  prev_year: number;
  kpis: { total_incl_vat: string; total_paid: string; total_outstanding: string; invoice_count: string } | null;
  prev_kpis: { total_incl_vat: string } | null;
  top_clients: Array<{ company_name: string; total: string; invoice_count: string }>;
  monthly: Array<{ month: number; total: string }>;
  practice_split: Array<{ practice: string; total: string }>;
  aging: Array<{ bucket: string; total: string; count: string }>;
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const AGING_ORDER = ['not_yet_due', '0_30', '31_60', '61_90', 'over_90', 'no_due'];
const AGING_LABELS: Record<string, string> = {
  not_yet_due: 'Not yet due',
  '0_30': '0–30 days overdue',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: '>90 days',
  no_due: 'No due date',
};
const AGING_TONES: Record<string, string> = {
  not_yet_due: '#94a3b8',  // slate
  '0_30': '#facc15',        // yellow
  '31_60': '#fb923c',       // orange
  '61_90': '#ef4444',       // red
  over_90: '#7f1d1d',       // dark red
  no_due: '#d1d5db',        // grey
};

export function BillingDashboard({ year }: { year: number }) {
  const { data, error, isLoading, refetch } = useCrmFetch<DashboardData>(`/api/crm/billing/dashboard?year=${year}`);

  if (isLoading && !data) return <div className="text-[12px] text-ink-muted italic px-3 py-4">Loading dashboard…</div>;
  if (error) return <CrmErrorBox message={error} onRetry={refetch} />;
  if (!data) return <div className="text-[12px] text-ink-muted italic px-3 py-4">No data for {year}.</div>;

  const current = Number(data.kpis?.total_incl_vat ?? 0);
  const prev = Number(data.prev_kpis?.total_incl_vat ?? 0);
  const yoyPct = prev > 0 ? ((current - prev) / prev) * 100 : null;

  return (
    <div className="space-y-5">
      {/* YoY banner */}
      {prev > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-md px-3 py-2 flex items-center gap-4 text-[12.5px]">
          <span><strong>{data.year}:</strong> {formatEur(current)}</span>
          <span className="text-ink-muted">vs {data.prev_year}: {formatEur(prev)}</span>
          {yoyPct !== null && (
            <span className={`font-semibold ${yoyPct >= 0 ? 'text-emerald-700' : 'text-danger-700'}`}>
              {yoyPct >= 0 ? '▲' : '▼'} {Math.abs(yoyPct).toFixed(1)}% YoY
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top 10 clients */}
        <ChartCard title={`Top 10 clients — ${data.year}`}>
          {data.top_clients.length === 0 ? (
            <Empty />
          ) : (
            <BarsHorizontal
              items={data.top_clients.map(c => ({
                label: c.company_name,
                value: Number(c.total),
                meta: `${c.invoice_count} invoice${c.invoice_count === '1' ? '' : 's'}`,
              }))}
            />
          )}
        </ChartCard>

        {/* Practice split */}
        <ChartCard title={`Revenue by practice area`}>
          {data.practice_split.length === 0 ? (
            <Empty />
          ) : (
            <PracticePie items={data.practice_split.map(p => ({
              label: p.practice.replace(/_/g, ' '),
              value: Number(p.total),
            }))} />
          )}
        </ChartCard>

        {/* Monthly trend */}
        <ChartCard title={`Monthly invoicing — ${data.year}`}>
          <MonthlyLine
            months={data.monthly.map(m => ({ month: m.month, total: Number(m.total) }))}
          />
        </ChartCard>

        {/* Aging */}
        <ChartCard title="Aging — outstanding by bucket (all years)">
          {data.aging.length === 0 ? (
            <Empty />
          ) : (
            <AgingBars
              items={AGING_ORDER
                .map(bucket => {
                  const row = data.aging.find(a => a.bucket === bucket);
                  return {
                    bucket,
                    label: AGING_LABELS[bucket],
                    value: Number(row?.total ?? 0),
                    count: Number(row?.count ?? 0),
                    color: AGING_TONES[bucket],
                  };
                })
                .filter(x => x.value > 0)}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg bg-white">
      <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Empty() {
  return <div className="text-[12px] text-ink-muted italic px-3 py-6 text-center">No data for this period.</div>;
}

// ── Horizontal bars for top clients ────────────────────────────────────
function BarsHorizontal({ items }: { items: Array<{ label: string; value: number; meta?: string }> }) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-[11.5px]">
          <div className="w-[38%] truncate text-ink-soft font-medium" title={item.label}>{item.label}</div>
          <div className="flex-1 relative h-5 bg-surface-alt rounded">
            <div
              className="h-full bg-brand-500 rounded"
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
            />
          </div>
          <div className="w-[22%] text-right tabular-nums font-medium">{formatEur(item.value)}</div>
          {item.meta && <div className="w-[18%] text-right text-[10.5px] text-ink-muted">{item.meta}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Pie / donut for practice split ─────────────────────────────────────
function PracticePie({ items }: { items: Array<{ label: string; value: number }> }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const r = 60, cx = 70, cy = 70;
  let cumulative = 0;
  const slices = items.map((item, i) => {
    const start = cumulative / total;
    cumulative += item.value;
    const end = cumulative / total;
    const largeArc = end - start > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(2 * Math.PI * start - Math.PI / 2);
    const y1 = cy + r * Math.sin(2 * Math.PI * start - Math.PI / 2);
    const x2 = cx + r * Math.cos(2 * Math.PI * end - Math.PI / 2);
    const y2 = cy + r * Math.sin(2 * Math.PI * end - Math.PI / 2);
    return {
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      color: palette[i % palette.length],
      label: item.label,
      value: item.value,
      pct: total > 0 ? (item.value / total) * 100 : 0,
    };
  });

  return (
    <div className="flex items-start gap-4">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
      </svg>
      <ul className="flex-1 space-y-1 text-[11.5px]">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 text-ink-soft capitalize truncate">{s.label}</span>
            <span className="tabular-nums font-medium">{formatEur(s.value)}</span>
            <span className="text-ink-muted tabular-nums w-10 text-right">{s.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Monthly line trend ────────────────────────────────────────────────
function MonthlyLine({ months }: { months: Array<{ month: number; total: number }> }) {
  // Fill sparse months.
  const full = Array.from({ length: 12 }, (_, i) => {
    const m = months.find(x => x.month === i + 1);
    return { month: i + 1, total: m ? m.total : 0 };
  });
  const max = Math.max(...full.map(f => f.total), 1);
  const w = 400, h = 140, padL = 30, padB = 22, padT = 10;
  const innerW = w - padL - 8;
  const innerH = h - padB - padT;
  const points = full.map((f, i) => ({
    x: padL + (i / 11) * innerW,
    y: padT + innerH - (f.total / max) * innerH,
    total: f.total,
    month: f.month,
  }));
  const path = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const area = `${path} L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {/* y-axis grid */}
      {[0, 0.5, 1].map(f => {
        const y = padT + innerH - f * innerH;
        return <line key={f} x1={padL} x2={w - 8} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="0.5" />;
      })}
      <path d={area} fill="#c7d2fe" opacity="0.4" />
      <path d={path} stroke="#6366f1" strokeWidth="1.5" fill="none" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="2.5" fill="#6366f1" />
          <text x={p.x} y={h - 6} textAnchor="middle" fontSize="9" fill="#6b7280">
            {MONTH_LABELS[i]}
          </text>
        </g>
      ))}
      <text x="4" y={padT + 4} fontSize="9" fill="#6b7280">
        {formatEur(max)}
      </text>
    </svg>
  );
}

// ── Aging bars with color-coded tones ─────────────────────────────────
function AgingBars({ items }: { items: Array<{ label: string; value: number; count: number; color: string }> }) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-[11.5px]">
          <div className="w-[30%] truncate text-ink-soft font-medium">{item.label}</div>
          <div className="flex-1 relative h-5 bg-surface-alt rounded">
            <div
              className="h-full rounded"
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%`, background: item.color }}
            />
          </div>
          <div className="w-[22%] text-right tabular-nums font-medium">{formatEur(item.value)}</div>
          <div className="w-[14%] text-right text-[10.5px] text-ink-muted tabular-nums">
            {item.count} inv
          </div>
        </div>
      ))}
    </div>
  );
}
