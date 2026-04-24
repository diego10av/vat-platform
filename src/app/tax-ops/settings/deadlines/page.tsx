'use client';

// /tax-ops/settings/deadlines — editable rules table.
//
// Each row shows: tax type · period pattern · statutory description ·
// tolerance · market note · open-filings count · Edit button.
// Clicking Edit opens DeadlineRuleEditor.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, Edit3Icon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { crmLoadShape } from '@/lib/useCrmFetch';
import { DeadlineRuleEditor, type DeadlineRule } from '@/components/tax-ops/DeadlineRuleEditor';

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function describeParams(kind: string, params: Record<string, unknown>): string {
  if (kind === 'days_after_period_end') return `${params.days_after} days after period end`;
  if (kind === 'fixed_md') return `${params.day}/${params.month} of N+1`;
  if (kind === 'fixed_md_with_extension') {
    return `${params.day}/${params.month} (ext. ${params.extension_day}/${params.extension_month})`;
  }
  return kind;
}

export default function TaxOpsDeadlinesPage() {
  const [rules, setRules] = useState<DeadlineRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<DeadlineRule | null>(null);

  const load = useCallback(() => {
    crmLoadShape<DeadlineRule[]>('/api/tax-ops/deadline-rules', b => (b as { rules: DeadlineRule[] }).rules)
      .then(rows => { setRules(rows); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRules([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (rules === null) return <PageSkeleton />;

  return (
    <div>
      <Link href="/tax-ops/settings" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink mb-2">
        <ArrowLeftIcon size={12} /> Back to settings
      </Link>
      <PageHeader
        title="Deadline rules"
        subtitle={`${rules.length} rules. Editing a rule (with propagation) re-dates every open filing of that tax type × period pattern.`}
      />

      {error && <CrmErrorBox message={error} onRetry={load} />}

      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-alt text-ink-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Tax type</th>
              <th className="px-3 py-2 font-medium">Period</th>
              <th className="px-3 py-2 font-medium">Rule</th>
              <th className="px-3 py-2 font-medium text-right">Tolerance</th>
              <th className="px-3 py-2 font-medium text-right">Open filings</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-surface-alt/40">
                <td className="px-3 py-2 font-medium">{humanTaxType(r.tax_type)}</td>
                <td className="px-3 py-2 capitalize text-ink-soft">{r.period_pattern}</td>
                <td className="px-3 py-2">
                  <div>{describeParams(r.rule_kind, r.rule_params)}</div>
                  {r.statutory_description && (
                    <div className="text-[11px] text-ink-muted mt-0.5 line-clamp-2">
                      {r.statutory_description}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.admin_tolerance_days > 0 ? `${r.admin_tolerance_days} d` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.open_filings_count > 0 ? (
                    <span className="text-ink">{r.open_filings_count}</span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditingRule(r)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] text-brand-700 hover:text-brand-800"
                  >
                    <Edit3Icon size={11} /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingRule && (
        <DeadlineRuleEditor
          rule={editingRule}
          open={true}
          onClose={() => setEditingRule(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
