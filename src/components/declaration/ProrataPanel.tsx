'use client';

// ════════════════════════════════════════════════════════════════════════
// ProrataPanel — "clarísimo" view of input-VAT pro-rata for the current
// declaration (Diego, 2026-04-19).
//
// What it shows, in this order (PROTOCOLS §11 — actionable first):
//   1. Headline: "X% deductible · (1-X)% not deductible".
//   2. Three side-by-side cards: TOTAL input VAT · DEDUCTIBLE (green) ·
//      NON-DEDUCTIBLE (red-amber). The deductible one is highlighted.
//   3. Method + formula trail (numerator / denominator for general,
//      per-sector weight for sector, direct-attribution note otherwise).
//   4. Legal references (chips linking out to /legal-watch when we have
//      the source id).
//   5. "Missing config" red banner when no entity_prorata row overlaps
//      the declaration period — with a one-click path to set one up.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircleIcon, AlertCircleIcon, ScaleIcon, CalculatorIcon,
  ExternalLinkIcon, PencilIcon, XIcon, CheckIcon,
} from 'lucide-react';

type Method = 'general' | 'direct' | 'sector';

interface Breakdown {
  method: Method;
  ratio_pct: number;
  total_input_vat_eur: number;
  deductible_eur: number;
  non_deductible_eur: number;
  formula_text: string;
  legal_refs: string[];
}

interface Record {
  id: string;
  entity_id: string;
  period_start: string;
  period_end: string;
  method: Method;
  ratio_num: number | null;
  ratio_denom: number | null;
  ratio_pct: number | null;
  basis: string | null;
  notes: string | null;
}

interface ApiResponse {
  breakdown: Breakdown;
  record: Record | null;
  period: { start: string; end: string };
  total_input_vat_eur: number;
  schema_missing?: boolean;
}

export function ProrataPanel({
  declarationId,
  entityId,
}: {
  declarationId: string;
  entityId: string;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/declarations/${declarationId}/prorata`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? 'Failed to load pro-rata.');
        return;
      }
      setData(body as ApiResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }, [declarationId]);

  useEffect(() => { load(); }, [load]);

  if (!data && !error) {
    return (
      <div className="mt-6 p-4 bg-surface border border-border rounded-lg text-[12px] text-ink-muted">
        Loading pro-rata breakdown…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-6 p-4 bg-danger-50 border border-danger-200 rounded-lg text-[12px] text-danger-800">
        {error ?? 'Pro-rata unavailable.'}
      </div>
    );
  }

  const { breakdown, record, period, total_input_vat_eur, schema_missing } = data;
  const hasConfig = !!record;
  const noInputVat = total_input_vat_eur < 0.005;

  return (
    <section className="mt-6 bg-surface border border-border rounded-xl overflow-hidden">
      <header className="px-5 py-3.5 border-b border-divider flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScaleIcon size={14} className="text-brand-500" />
          <h3 className="text-[14px] font-semibold text-ink">
            Input-VAT pro-rata
          </h3>
          <span className="text-[11px] text-ink-muted">
            · {period.start} → {period.end}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasConfig && (
            <button
              onClick={() => setEditing(!editing)}
              className="h-7 px-2.5 rounded-md border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink inline-flex items-center gap-1"
            >
              <PencilIcon size={11} /> {editing ? 'Close' : 'Edit'}
            </button>
          )}
          {!hasConfig && !schema_missing && (
            <button
              onClick={() => setEditing(true)}
              className="h-7 px-3 rounded-md bg-brand-500 text-white text-[11.5px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1"
            >
              Set up pro-rata
            </button>
          )}
        </div>
      </header>

      {schema_missing && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-900">
          <strong>Schema missing:</strong> run migration 011 to enable pro-rata tracking.
        </div>
      )}

      {editing && !schema_missing && (
        <ProrataEditor
          entityId={entityId}
          existing={record}
          defaultPeriod={period}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}

      {!hasConfig && !schema_missing && !editing && !noInputVat && (
        <div className="px-5 py-4 bg-danger-50 border-b border-danger-200">
          <div className="flex items-start gap-2">
            <AlertCircleIcon size={14} className="text-danger-700 mt-0.5 shrink-0" />
            <div className="text-[12px] text-danger-800">
              <strong>No pro-rata configured for this period.</strong>
              {' '}
              Defaulting to 100% deductible. If the entity provides any
              exempt-without-deduction supplies (Art. 44§1 a/d), the
              deduction right must be apportioned (Art. 50 LTVA).
            </div>
          </div>
        </div>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-3 divide-x divide-divider">
        <MetricCell
          label="Total input VAT"
          value={fmtEur(breakdown.total_input_vat_eur)}
          tone="neutral"
        />
        <MetricCell
          label="Deductible"
          value={fmtEur(breakdown.deductible_eur)}
          sublabel={`${breakdown.ratio_pct}% of total`}
          tone="ok"
        />
        <MetricCell
          label="Not deductible"
          value={fmtEur(breakdown.non_deductible_eur)}
          sublabel={`${100 - breakdown.ratio_pct}% · box 087 (LUX_17_NONDED)`}
          tone={breakdown.non_deductible_eur > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Method + formula trail */}
      <div className="px-5 py-4 border-t border-divider bg-surface-alt/30">
        <div className="flex items-center gap-2 mb-2">
          <CalculatorIcon size={13} className="text-ink-muted" />
          <span className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-muted">
            Method · {labelForMethod(breakdown.method)}
          </span>
        </div>
        <pre className="text-[12px] leading-relaxed font-mono text-ink-soft whitespace-pre-wrap">
          {breakdown.formula_text}
        </pre>
        {record?.notes && (
          <div className="mt-3 text-[11.5px] text-ink-muted italic whitespace-pre-wrap border-l-2 border-brand-200 pl-2">
            Reviewer note: {record.notes}
          </div>
        )}
      </div>

      {/* Legal refs */}
      <div className="px-5 py-3 border-t border-divider flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
          Legal refs
        </span>
        {breakdown.legal_refs.map(ref => (
          <a
            key={ref}
            href={`/legal-watch?src=${encodeURIComponent(ref)}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded px-1.5 py-0.5 hover:bg-brand-100"
          >
            {ref}
            <ExternalLinkIcon size={9} />
          </a>
        ))}
        <span className="ml-auto text-[10.5px] text-ink-faint inline-flex items-center gap-1">
          {hasConfig ? <CheckCircleIcon size={10} className="text-emerald-600" /> : null}
          {hasConfig ? 'Configuration active' : 'No configuration · default 100%'}
        </span>
      </div>
    </section>
  );
}

function labelForMethod(m: Method): string {
  if (m === 'general') return 'General ratio (Art. 50§1 LTVA)';
  if (m === 'direct') return 'Direct attribution (Art. 50§2 LTVA)';
  return 'Sector ratios (Art. 50§3 LTVA · BLC Baumarkt)';
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('fr-LU', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function MetricCell({
  label, value, sublabel, tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone: 'neutral' | 'ok' | 'danger';
}) {
  const bg =
    tone === 'ok' ? 'bg-emerald-50/60' :
    tone === 'danger' ? 'bg-danger-50/60' :
    'bg-white';
  const labelColour =
    tone === 'ok' ? 'text-emerald-700' :
    tone === 'danger' ? 'text-danger-700' :
    'text-ink-muted';
  const valueColour =
    tone === 'ok' ? 'text-emerald-900' :
    tone === 'danger' ? 'text-danger-900' :
    'text-ink';
  return (
    <div className={`px-5 py-5 ${bg}`}>
      <div className={`text-[10.5px] uppercase tracking-wide font-semibold ${labelColour}`}>
        {label}
      </div>
      <div className={`mt-1 text-[22px] font-semibold tabular-nums tracking-tight ${valueColour}`}>
        {value}
      </div>
      {sublabel && (
        <div className={`text-[10.5px] mt-0.5 ${labelColour}`}>{sublabel}</div>
      )}
    </div>
  );
}

// ──────────────────── Editor (inline form) ────────────────────

function ProrataEditor({
  entityId, existing, defaultPeriod, onClose, onSaved,
}: {
  entityId: string;
  existing: Record | null;
  defaultPeriod: { start: string; end: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Partial<Record>>(
    existing ?? {
      period_start: defaultPeriod.start,
      period_end: defaultPeriod.end,
      method: 'general',
      ratio_num: null,
      ratio_denom: null,
      ratio_pct: null,
      basis: null,
      notes: null,
    },
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const url = existing
        ? `/api/entities/${entityId}/prorata/${existing.id}`
        : `/api/entities/${entityId}/prorata`;
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error?.message ?? 'Could not save.');
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  // Live preview of the rounded-up percentage when numerator/denominator are set.
  const previewPct = (() => {
    if (draft.method !== 'general') return null;
    const n = Number(draft.ratio_num);
    const d = Number(draft.ratio_denom);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
    return Math.max(0, Math.min(100, Math.ceil((n / d) * 100 - 0.005)));
  })();

  return (
    <div className="px-5 py-4 bg-amber-50/40 border-b border-amber-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-ink">
          {existing ? 'Edit pro-rata configuration' : 'Create pro-rata configuration'}
        </h4>
        <button
          onClick={onClose}
          className="p-1 text-ink-muted hover:text-ink"
          aria-label="Cancel"
        >
          <XIcon size={13} />
        </button>
      </div>

      {err && (
        <div className="mb-3 px-3 py-2 bg-danger-50 border border-danger-200 text-[11.5px] text-danger-800 rounded">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Period start (YYYY-MM-DD)">
          <input
            type="date"
            value={draft.period_start || ''}
            onChange={e => setDraft({ ...draft, period_start: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px]"
          />
        </Field>
        <Field label="Period end (YYYY-MM-DD)">
          <input
            type="date"
            value={draft.period_end || ''}
            onChange={e => setDraft({ ...draft, period_end: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px]"
          />
        </Field>
      </div>

      <div className="mb-3">
        <Field label="Method">
          <div className="flex gap-2">
            {(['general', 'direct', 'sector'] as const).map(m => (
              <button
                key={m}
                onClick={() => setDraft({ ...draft, method: m })}
                className={[
                  'flex-1 h-9 px-3 rounded border text-[12px] font-medium',
                  draft.method === m
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-surface text-ink-soft border-border-strong hover:text-ink',
                ].join(' ')}
              >
                {m === 'general' ? 'General ratio' : m === 'direct' ? 'Direct attribution' : 'Sector ratios'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {draft.method === 'general' ? (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Field label="Turnover WITH deduction (€)">
            <input
              type="number"
              step="0.01"
              value={draft.ratio_num ?? ''}
              onChange={e => setDraft({ ...draft, ratio_num: e.target.value ? Number(e.target.value) : null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] tabular-nums"
              placeholder="e.g. 820000"
            />
          </Field>
          <Field label="Total eligible turnover (€)">
            <input
              type="number"
              step="0.01"
              value={draft.ratio_denom ?? ''}
              onChange={e => setDraft({ ...draft, ratio_denom: e.target.value ? Number(e.target.value) : null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] tabular-nums"
              placeholder="e.g. 3920000"
            />
          </Field>
          <Field label="Resulting ratio (auto)">
            <div className="h-8 flex items-center px-2 text-[12.5px] font-mono bg-white border border-border-strong rounded">
              {previewPct != null ? `${previewPct}%` : '—'}
            </div>
          </Field>
        </div>
      ) : (
        <div className="mb-3">
          <Field label="Ratio (0..100%)">
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={draft.ratio_pct ?? ''}
              onChange={e => setDraft({ ...draft, ratio_pct: e.target.value ? Number(e.target.value) : null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] tabular-nums"
              placeholder="e.g. 75"
            />
          </Field>
        </div>
      )}

      <div className="mb-3">
        <Field label="Methodology justification (goes into the audit PDF)">
          <textarea
            rows={3}
            value={draft.basis ?? ''}
            onChange={e => setDraft({ ...draft, basis: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px]"
            placeholder="e.g. Loans to non-EU subsidiaries: $820k (Art. 49§2 — with deduction). Loans to LU and EU subsidiaries: $3.1m (without deduction). Ratio: 820/(820+3100) = 20.92% → 21% after round-up."
          />
        </Field>
      </div>

      <div className="mb-4">
        <Field label="Internal notes (not in the PDF)">
          <textarea
            rows={2}
            value={draft.notes ?? ''}
            onChange={e => setDraft({ ...draft, notes: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px]"
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="h-8 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="h-8 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <CheckIcon size={12} /> {saving ? 'Saving…' : existing ? 'Save changes' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-0.5">
        {label}
      </div>
      {children}
    </label>
  );
}
