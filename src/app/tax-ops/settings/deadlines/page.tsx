'use client';

// /tax-ops/settings/deadlines — editable rules table.
//
// Each row shows: tax type · period pattern · statutory description ·
// tolerance · market note · open-filings count · Edit button.
// Clicking Edit opens DeadlineRuleEditor.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, Edit3Icon, PlusIcon, Trash2Icon, ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { Modal } from '@/components/ui/Modal';
import { crmLoadShape } from '@/lib/useCrmFetch';
import { useToast } from '@/components/Toaster';
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
  if (kind === 'adhoc_no_deadline') return 'Ad-hoc — no fixed deadline';
  return kind;
}

export default function TaxOpsDeadlinesPage() {
  const [rules, setRules] = useState<DeadlineRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<DeadlineRule | null>(null);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    crmLoadShape<DeadlineRule[]>('/api/tax-ops/deadline-rules', b => (b as { rules: DeadlineRule[] }).rules)
      .then(rows => { setRules(rows); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRules([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteRule(r: DeadlineRule) {
    if (!confirm(`Delete rule for ${r.tax_type} · ${r.period_pattern}? Blocked if active obligations reference it — archive those first.`)) return;
    const res = await fetch(`/api/tax-ops/deadline-rules/${r.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(`Delete failed: ${b?.error === 'active_obligations_exist' ? `${b.count} obligations still active` : (b?.error ?? res.status)}`);
      return;
    }
    toast.success('Rule deleted');
    load();
  }

  if (rules === null) return <PageSkeleton />;

  return (
    <div>
      <Link href="/tax-ops/settings" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink mb-2">
        <ArrowLeftIcon size={12} /> Back to settings
      </Link>
      <PageHeader
        title="Deadline rules"
        subtitle={`${rules.length} rules. Edit to rewrite params (with propagation), or archive / delete. Create new rules for tax types not yet in the system.`}
        actions={
          <button
            onClick={() => setNewRuleOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-md bg-brand-500 hover:bg-brand-600 text-white"
          >
            <PlusIcon size={12} /> New rule
          </button>
        }
      />

      <NewRuleModal
        open={newRuleOpen}
        onClose={() => setNewRuleOpen(false)}
        onCreated={load}
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
                  <button
                    onClick={() => deleteRule(r)}
                    aria-label="Delete rule"
                    disabled={r.open_filings_count > 0}
                    title={r.open_filings_count > 0 ? `${r.open_filings_count} open filings — archive first` : 'Delete rule'}
                    className="inline-flex items-center p-1 ml-1 text-ink-muted hover:text-danger-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2Icon size={11} />
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

// ─── NewRuleModal (stint 37.H) ────────────────────────────────────────

function NewRuleModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [taxType, setTaxType] = useState('');
  const [periodPattern, setPeriodPattern] = useState<string>('annual');
  const [ruleKind, setRuleKind] = useState<string>('fixed_md');
  const [params, setParams] = useState<Record<string, number>>({ month: 3, day: 31 });
  const [tolerance, setTolerance] = useState(0);
  const [statutory, setStatutory] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) {
      setTaxType(''); setPeriodPattern('annual'); setRuleKind('fixed_md');
      setParams({ month: 3, day: 31 }); setTolerance(0);
      setStatutory(''); setNote(''); setError(null);
    }
  }, [open]);

  function switchKind(next: string) {
    setRuleKind(next);
    if (next === 'days_after_period_end') setParams({ days_after: 15 });
    else if (next === 'fixed_md') setParams({ month: 3, day: 31 });
    else if (next === 'fixed_md_with_extension') setParams({ month: 3, day: 31, extension_month: 12, extension_day: 31 });
    else setParams({});
  }

  async function submit() {
    if (!taxType.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/tax-ops/deadline-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tax_type: taxType.trim().toLowerCase().replace(/\s+/g, '_'),
          period_pattern: periodPattern,
          rule_kind: ruleKind,
          rule_params: params,
          admin_tolerance_days: tolerance,
          statutory_description: statutory.trim() || null,
          market_practice_note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Rule created');
      onCreated();
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New deadline rule" size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-1.5 text-[12.5px] rounded-md border border-border hover:bg-surface-alt">Cancel</button>
          <button onClick={submit} disabled={busy || !taxType.trim()} className="px-3 py-1.5 text-[12.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create rule'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[12.5px]">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-ink-muted">Tax type (internal id)</span>
            <input
              value={taxType}
              onChange={e => setTaxType(e.target.value)}
              placeholder="e.g. dac6_annual"
              className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface font-mono"
            />
            <span className="text-[10.5px] text-ink-muted block mt-1">Snake_case. Lowercased on save.</span>
          </label>
          <label>
            <span className="text-ink-muted">Period pattern</span>
            <select value={periodPattern} onChange={e => setPeriodPattern(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface">
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
              <option value="semester">Semester</option>
              <option value="adhoc">Ad-hoc</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-ink-muted">Rule kind</span>
          <select value={ruleKind} onChange={e => switchKind(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface">
            <option value="days_after_period_end">Days after period end</option>
            <option value="fixed_md">Fixed date (month/day, year N+1)</option>
            <option value="fixed_md_with_extension">Fixed date + extension</option>
            <option value="adhoc_no_deadline">Ad-hoc (no fixed deadline)</option>
          </select>
        </label>
        {ruleKind === 'days_after_period_end' && (
          <label>
            <span className="text-ink-muted">Days after period end</span>
            <input type="number" min={0} max={365} value={params.days_after ?? 15}
              onChange={e => setParams({ ...params, days_after: Number(e.target.value) })}
              className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" />
          </label>
        )}
        {ruleKind === 'fixed_md' && (
          <div className="grid grid-cols-2 gap-3">
            <label><span className="text-ink-muted">Month</span><input type="number" min={1} max={12} value={params.month ?? 3} onChange={e => setParams({ ...params, month: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" /></label>
            <label><span className="text-ink-muted">Day</span><input type="number" min={1} max={31} value={params.day ?? 31} onChange={e => setParams({ ...params, day: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" /></label>
          </div>
        )}
        {ruleKind === 'fixed_md_with_extension' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="text-ink-muted">Statutory month</span><input type="number" min={1} max={12} value={params.month ?? 3} onChange={e => setParams({ ...params, month: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" /></label>
              <label><span className="text-ink-muted">Statutory day</span><input type="number" min={1} max={31} value={params.day ?? 31} onChange={e => setParams({ ...params, day: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="text-ink-muted">Extension month</span><input type="number" min={1} max={12} value={params.extension_month ?? 12} onChange={e => setParams({ ...params, extension_month: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" /></label>
              <label><span className="text-ink-muted">Extension day</span><input type="number" min={1} max={31} value={params.extension_day ?? 31} onChange={e => setParams({ ...params, extension_day: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" /></label>
            </div>
          </>
        )}
        <label>
          <span className="text-ink-muted">Admin tolerance days</span>
          <input type="number" min={0} max={365} value={tolerance} onChange={e => setTolerance(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums" />
        </label>
        <label className="block">
          <span className="text-ink-muted">Statutory description</span>
          <input value={statutory} onChange={e => setStatutory(e.target.value)} placeholder="e.g. Form XYZ — statutory 30 June N+1" className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface" />
        </label>
        <label className="block">
          <span className="text-ink-muted">Market practice note</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface" />
        </label>
        {error && <div className="rounded-md border border-danger-400 bg-danger-50/50 p-2 text-[12px] text-danger-800">{error}</div>}
      </div>
    </Modal>
  );
}
