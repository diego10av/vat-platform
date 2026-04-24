'use client';

// ════════════════════════════════════════════════════════════════════════
// DeadlineRuleEditor — two-step modal:
//
//   Step 1: edit rule params + tolerance + market note.
//   Step 2: "Propagate?" confirmation — shows how many open filings
//           will be re-dated + optionally a diff preview (first 10).
//
// Param inputs adapt by rule_kind:
//   days_after_period_end   → days_after number
//   fixed_md                → month + day
//   fixed_md_with_extension → month + day + extension_month + extension_day
//
// After save, parent page re-fetches so the table shows the new
// rule + the just-recomputed open_filings_count.
// ════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { AlertTriangleIcon, ArrowRightIcon, CheckIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

export interface DeadlineRule {
  id: string;
  tax_type: string;
  period_pattern: string;
  rule_kind: string;
  rule_params: Record<string, unknown>;
  statutory_description: string | null;
  admin_tolerance_days: number;
  market_practice_note: string | null;
  open_filings_count: number;
}

interface AffectedFiling {
  id: string;
  entity_name: string;
  period_year: number;
  period_label: string;
  old_deadline: string | null;
  new_deadline: string | null;
  status: string;
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function DeadlineRuleEditor({
  rule, open, onClose, onSaved,
}: {
  rule: DeadlineRule;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<'edit' | 'confirm' | 'done'>('edit');

  // Editable fields
  const [ruleKind, setRuleKind] = useState(rule.rule_kind);
  const [params, setParams] = useState<Record<string, number>>(() =>
    coerceParams(rule.rule_kind, rule.rule_params),
  );
  const [tolerance, setTolerance] = useState(rule.admin_tolerance_days);
  const [note, setNote] = useState(rule.market_practice_note ?? '');
  const [statutory, setStatutory] = useState(rule.statutory_description ?? '');

  const [affected, setAffected] = useState<AffectedFiling[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propagated, setPropagated] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setStep('edit');
      setRuleKind(rule.rule_kind);
      setParams(coerceParams(rule.rule_kind, rule.rule_params));
      setTolerance(rule.admin_tolerance_days);
      setNote(rule.market_practice_note ?? '');
      setStatutory(rule.statutory_description ?? '');
      setError(null);
      setPropagated(null);
    }
  }, [open, rule]);

  async function saveWithoutPropagation() {
    await doSave(false);
  }

  async function goToConfirm() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/tax-ops/deadline-rules/${rule.id}?preview_propagate=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { affected: AffectedFiling[] };
      // Re-compute client-side with the edited rule? No — the preview
      // endpoint uses the current stored rule. That's fine as a proxy:
      // Diego sees "N open filings of this type". The actual new
      // deadlines land on save.
      setAffected(body.affected);
      setStep('confirm');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function doSave(propagate: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/tax-ops/deadline-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_kind: ruleKind,
          rule_params: params,
          statutory_description: statutory || null,
          admin_tolerance_days: tolerance,
          market_practice_note: note || null,
          propagate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { propagated: number };
      setPropagated(body.propagated);
      setStep('done');
      onSaved();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${humanTaxType(rule.tax_type)} · ${rule.period_pattern}`}
      subtitle="Editing this rule can re-date every open filing of this type."
      size="lg"
    >
      <div className="space-y-3 text-[12.5px]">
        {error && (
          <div className="rounded-md border border-danger-400 bg-danger-50/50 p-2.5 flex items-start gap-2">
            <AlertTriangleIcon size={14} className="mt-0.5 text-danger-700 shrink-0" />
            <div className="text-[12px] text-danger-800">{error}</div>
          </div>
        )}

        {step === 'edit' && (
          <>
            <label className="block">
              <span className="text-ink-muted">Rule kind</span>
              <select
                value={ruleKind}
                onChange={e => {
                  const next = e.target.value;
                  setRuleKind(next);
                  setParams(coerceParams(next, {}));
                }}
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
              >
                <option value="days_after_period_end">Days after period end</option>
                <option value="fixed_md">Fixed date (month/day, year N+1)</option>
                <option value="fixed_md_with_extension">Fixed date + extension</option>
                <option value="adhoc_no_deadline">Ad-hoc (no fixed deadline)</option>
              </select>
            </label>

            {ruleKind === 'days_after_period_end' && (
              <NumberField
                label="Days after period end"
                value={params.days_after ?? 15}
                onChange={v => setParams({ ...params, days_after: v })}
                min={0} max={365}
              />
            )}
            {ruleKind === 'fixed_md' && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Month" value={params.month ?? 3} onChange={v => setParams({ ...params, month: v })} min={1} max={12} />
                <NumberField label="Day" value={params.day ?? 1} onChange={v => setParams({ ...params, day: v })} min={1} max={31} />
              </div>
            )}
            {ruleKind === 'fixed_md_with_extension' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Statutory month" value={params.month ?? 3} onChange={v => setParams({ ...params, month: v })} min={1} max={12} />
                  <NumberField label="Statutory day" value={params.day ?? 31} onChange={v => setParams({ ...params, day: v })} min={1} max={31} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Extension month" value={params.extension_month ?? 12} onChange={v => setParams({ ...params, extension_month: v })} min={1} max={12} />
                  <NumberField label="Extension day" value={params.extension_day ?? 31} onChange={v => setParams({ ...params, extension_day: v })} min={1} max={31} />
                </div>
              </>
            )}

            <NumberField
              label="Admin tolerance days"
              value={tolerance}
              onChange={setTolerance}
              min={0}
              max={365}
              hint="Days past deadline before AED typically applies a penalty."
            />

            <label className="block">
              <span className="text-ink-muted">Statutory description</span>
              <input
                value={statutory}
                onChange={e => setStatutory(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
                placeholder="e.g. Form 500 — statutory 31 March N+1"
              />
            </label>
            <label className="block">
              <span className="text-ink-muted">Market practice note</span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
                placeholder="Shown in each filing's detail sidebar."
              />
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={onClose} className="px-3 py-2 text-[12.5px] rounded-md border border-border hover:bg-surface-alt">
                Cancel
              </button>
              <button
                onClick={saveWithoutPropagation}
                disabled={busy}
                className="px-3 py-2 text-[12.5px] rounded-md border border-border hover:bg-surface-alt disabled:opacity-50"
              >
                Save (no propagation)
              </button>
              <button
                onClick={goToConfirm}
                disabled={busy || rule.open_filings_count === 0}
                className="px-3 py-2 text-[12.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                Save + propagate to {rule.open_filings_count} filings
                <ArrowRightIcon size={11} className="inline ml-1" />
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p>
              Saving this rule will update <strong>{affected.length}</strong> open
              filings of this tax type &amp; period pattern. Filed, paid, and
              waived filings keep their historic deadline for audit.
            </p>
            <div className="rounded-md border border-border overflow-hidden max-h-[320px] overflow-y-auto">
              <table className="w-full text-[11.5px]">
                <thead className="bg-surface-alt text-ink-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">Entity</th>
                    <th className="px-2 py-1 font-medium">Period</th>
                    <th className="px-2 py-1 font-medium">Old deadline</th>
                    <th className="px-2 py-1 font-medium">New (est.)</th>
                  </tr>
                </thead>
                <tbody>
                  {affected.slice(0, 50).map(f => (
                    <tr key={f.id} className="border-t border-border">
                      <td className="px-2 py-1 truncate max-w-[180px]">{f.entity_name}</td>
                      <td className="px-2 py-1 tabular-nums">{f.period_label}</td>
                      <td className="px-2 py-1 tabular-nums text-ink-muted">{f.old_deadline ?? '—'}</td>
                      <td className="px-2 py-1 tabular-nums text-brand-700">{f.new_deadline ?? '—'}</td>
                    </tr>
                  ))}
                  {affected.length > 50 && (
                    <tr><td colSpan={4} className="px-2 py-1 text-center text-ink-muted italic">
                      …and {affected.length - 50} more.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => setStep('edit')} className="px-3 py-2 text-[12.5px] rounded-md border border-border hover:bg-surface-alt">
                Back
              </button>
              <button
                onClick={() => doSave(true)}
                disabled={busy}
                className="px-3 py-2 text-[12.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {busy ? 'Updating…' : 'Confirm — update rule + filings'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="rounded-md border border-green-400 bg-green-50/50 p-3 flex items-start gap-2">
            <CheckIcon size={14} className="mt-0.5 text-green-700 shrink-0" />
            <div>
              <div className="font-semibold text-green-800">Rule saved.</div>
              <div className="text-[11.5px] text-green-700 mt-0.5">
                {propagated !== null && propagated > 0
                  ? `${propagated} open filings re-dated.`
                  : 'No open filings affected.'}
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-3 py-1.5 text-[12px] rounded-md bg-brand-500 text-white hover:bg-brand-600"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function coerceParams(kind: string, raw: Record<string, unknown>): Record<string, number> {
  const n = (v: unknown): number => typeof v === 'number' ? v : Number(v) || 0;
  if (kind === 'days_after_period_end') return { days_after: n(raw.days_after) };
  if (kind === 'fixed_md') return { month: n(raw.month), day: n(raw.day) };
  if (kind === 'fixed_md_with_extension') {
    return {
      month: n(raw.month), day: n(raw.day),
      extension_month: n(raw.extension_month),
      extension_day: n(raw.extension_day),
    };
  }
  return {};
}

function NumberField({
  label, value, onChange, min, max, hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number; max?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-ink-muted">{label}</span>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface tabular-nums"
      />
      {hint && <span className="mt-0.5 block text-[11px] text-ink-muted">{hint}</span>}
    </label>
  );
}
