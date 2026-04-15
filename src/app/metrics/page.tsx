'use client';

import { useEffect, useState } from 'react';

interface MetricsData {
  extraction: { total_invoices: number; corrected: number; accuracy_pct: number | null; target_pct: number };
  classification: {
    total_lines: number; changed_by_user: number; accuracy_pct: number | null; target_pct: number;
    by_source: { rule: number; precedent: number; inference: number; manual: number };
    by_rule: { classification_rule: string; n: number }[];
  };
  declarations_by_status: { status: string; n: number }[];
  activity_last_30d: { d: string; n: number }[];
  cost_estimate: { anthropic_api_calls: number; anthropic_eur: number; note: string };
}

export default function MetricsPage() {
  const [data, setData] = useState<MetricsData | null>(null);

  useEffect(() => {
    fetch('/api/metrics').then(r => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  const exAcc = data.extraction.accuracy_pct;
  const clAcc = data.classification.accuracy_pct;
  const totalSource = Object.values(data.classification.by_source).reduce((s, n) => s + n, 0);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-semibold tracking-tight">Quality metrics</h1>
        <p className="text-[12px] text-gray-500 mt-1">
          Accuracy of the AI agents and the rules engine, derived from the audit log. Per PRD §17.4.
        </p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <BigKPI
          label="Extraction accuracy"
          value={exAcc != null ? `${exAcc.toFixed(1)}%` : '—'}
          target={`Target ${data.extraction.target_pct}%`}
          good={exAcc != null && exAcc >= data.extraction.target_pct}
          subtitle={`${data.extraction.total_invoices} invoices · ${data.extraction.corrected} corrected`}
        />
        <BigKPI
          label="Classification accuracy"
          value={clAcc != null ? `${clAcc.toFixed(1)}%` : '—'}
          target={`Target ${data.classification.target_pct}%`}
          good={clAcc != null && clAcc >= data.classification.target_pct}
          subtitle={`${data.classification.total_lines} lines · ${data.classification.changed_by_user} changed`}
        />
        <BigKPI
          label="Anthropic API calls"
          value={data.cost_estimate.anthropic_api_calls.toLocaleString()}
          subtitle={`Est. €${data.cost_estimate.anthropic_eur.toFixed(2)} total`}
        />
        <BigKPI
          label="Active declarations"
          value={data.declarations_by_status.filter(d => !['paid'].includes(d.status)).reduce((s, d) => s + d.n, 0)}
          subtitle={`${data.declarations_by_status.find(d => d.status === 'paid')?.n || 0} paid (closed)`}
        />
      </div>

      {/* Two-column row */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* Classification source split */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Classification source</h3>
          {totalSource === 0 ? (
            <div className="text-[12px] text-gray-400">No classified lines yet.</div>
          ) : (
            <div className="space-y-2">
              <SourceBar label="Rule" n={data.classification.by_source.rule} total={totalSource} color="bg-sky-400" />
              <SourceBar label="Precedent" n={data.classification.by_source.precedent} total={totalSource} color="bg-blue-400" />
              <SourceBar label="Inference" n={data.classification.by_source.inference} total={totalSource} color="bg-amber-400" />
              <SourceBar label="Manual" n={data.classification.by_source.manual} total={totalSource} color="bg-emerald-400" />
            </div>
          )}
        </div>

        {/* Declarations by status */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Declarations by status</h3>
          <div className="space-y-2">
            {data.declarations_by_status.map(s => (
              <div key={s.status} className="flex items-center justify-between text-[12px]">
                <span className="text-gray-700 capitalize">{s.status}</span>
                <span className="font-semibold tabular-nums">{s.n}</span>
              </div>
            ))}
            {data.declarations_by_status.length === 0 && (
              <div className="text-[12px] text-gray-400">No declarations yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Per-rule frequency */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Rules engine — usage</h3>
        {data.classification.by_rule.length === 0 ? (
          <div className="text-[12px] text-gray-400">No rule applications yet.</div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {data.classification.by_rule.map(r => (
              <div key={r.classification_rule} className="flex items-center justify-between text-[12px] border-b border-gray-100 pb-1">
                <span className="text-gray-700 font-mono">{r.classification_rule}</span>
                <span className="font-semibold tabular-nums">{r.n}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity sparkline */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Activity, last 30 days</h3>
        {data.activity_last_30d.length === 0 ? (
          <div className="text-[12px] text-gray-400">No activity in the last 30 days.</div>
        ) : (
          <ActivitySparkline data={data.activity_last_30d} />
        )}
      </div>

      <div className="text-[11px] text-gray-400">{data.cost_estimate.note}</div>
    </div>
  );
}

function BigKPI({ label, value, subtitle, target, good }: {
  label: string; value: string | number; subtitle?: string; target?: string; good?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`text-3xl font-bold mt-1 tabular-nums ${good === true ? 'text-emerald-600' : good === false ? 'text-amber-600' : 'text-gray-900'}`}>
        {value}
      </div>
      {target && <div className="text-[10px] text-gray-400 mt-0.5">{target}</div>}
      {subtitle && <div className="text-[11px] text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

function SourceBar({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total > 0 ? (n / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ActivitySparkline({ data }: { data: { d: string; n: number }[] }) {
  const max = Math.max(...data.map(d => d.n), 1);
  return (
    <div className="flex items-end gap-0.5 h-20">
      {data.map(d => (
        <div key={d.d} className="flex-1 flex flex-col items-center group" title={`${d.d}: ${d.n} events`}>
          <div className="w-full bg-[#1a1a2e] rounded-sm transition-all duration-150 group-hover:bg-blue-600"
            style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
