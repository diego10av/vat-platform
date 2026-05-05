'use client';

// ════════════════════════════════════════════════════════════════════════
// EntityProrataCard — entity-level pro-rata configuration list + editor.
//
// Stint 67.E (Bug #10): pro-rata config used to be reachable only
// through a declaration's detail page (declaration → ProrataPanel →
// "Set up pro-rata" → POST /api/entities/[id]/prorata). That meant
// you couldn't pre-configure pro-rata on a brand-new entity before
// the first declaration was created — you had to create the
// declaration just to access the form. This card on /entities/[id]
// closes that gap.
//
// What it shows:
//   - The list of existing entity_prorata rows (ordered newest →
//     oldest by period_start).
//   - For each row: period range, method, ratio (% + numerator/
//     denominator for general), basis text, and "Edit" / "Delete".
//   - "Configure pro-rata" CTA when there is no row yet, or "+ Add
//     period" when there are rows but the user wants to add another
//     period.
//   - Inline form for create/edit using the existing per-method
//     fields (general: turnover-with-deduction / total-eligible;
//     direct: ratio_pct; sector: ratio_pct + per-sector breakdown
//     in `notes`).
//
// Talks to:
//   - GET    /api/entities/:id/prorata           — list
//   - POST   /api/entities/:id/prorata           — create
//   - PATCH  /api/entities/:id/prorata/:configId — update
//   - DELETE /api/entities/:id/prorata/:configId — soft-delete
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { ScaleIcon, PencilIcon, Trash2Icon, PlusIcon, XIcon } from 'lucide-react';

type Method = 'general' | 'direct' | 'sector';

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

interface ListResponse {
  prorata: Record[];
  schema_missing?: boolean;
}

export function EntityProrataCard({ entityId }: { entityId: string }) {
  const [rows, setRows] = useState<Record[] | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/entities/${entityId}/prorata`);
      const body = (await res.json()) as ListResponse;
      if (!res.ok) {
        setError('Could not load pro-rata configurations.');
        return;
      }
      if (body.schema_missing) {
        setSchemaMissing(true);
        setRows([]);
      } else {
        setRows(body.prorata || []);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }, [entityId]);

  useEffect(() => { load(); }, [load]);

  async function remove(configId: string) {
    if (!confirm('Delete this pro-rata configuration? Past declarations that referenced it will keep their snapshot, but new declarations falling in the same period will default to 100% deductible until you add another row.')) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/prorata/${configId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      load();
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (rows === null && !error) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4 mb-4 text-sm text-ink-muted">
        Loading pro-rata configurations…
      </div>
    );
  }

  if (schemaMissing) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <ScaleIcon size={14} className="text-brand-500" />
          <h3 className="text-sm font-semibold text-ink">Input-VAT pro-rata</h3>
        </div>
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
          Schema missing — apply migration 011 to enable pro-rata tracking.
        </p>
      </div>
    );
  }

  const list = rows ?? [];

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden mb-4">
      <header className="px-4 py-2.5 border-b border-border bg-surface-alt flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScaleIcon size={13} className="text-brand-500" />
          <h3 className="text-sm font-semibold text-ink">Input-VAT pro-rata</h3>
          <span className="text-xs text-ink-muted">
            {list.length === 0
              ? 'no configurations'
              : `${list.length} period${list.length === 1 ? '' : 's'} configured`}
          </span>
        </div>
        {editing == null && (
          <button
            onClick={() => setEditing({ id: null })}
            className="h-7 px-2.5 rounded-md bg-brand-500 text-white text-xs font-semibold hover:bg-brand-600 inline-flex items-center gap-1"
          >
            <PlusIcon size={11} /> {list.length === 0 ? 'Configure pro-rata' : 'Add period'}
          </button>
        )}
      </header>

      {error && (
        <div className="px-4 py-3 bg-danger-50 border-b border-danger-200 text-sm text-danger-800">
          {error}
        </div>
      )}

      {editing && (
        <Editor
          entityId={entityId}
          existing={editing.id ? list.find(r => r.id === editing.id) ?? null : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {list.length === 0 && !editing && (
        <div className="px-4 py-4 text-sm text-ink-muted">
          No pro-rata configurations yet. Pick this when:
          <ul className="list-disc list-inside mt-2 space-y-1 text-ink-soft">
            <li>The entity has any exempt-without-deduction supplies (Art. 44§1 a/d).</li>
            <li>Mixed taxable + exempt activity needs an apportionment ratio (Art. 50 LTVA).</li>
            <li>Otherwise the entity is treated as 100% deductible by default.</li>
          </ul>
        </div>
      )}

      {list.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-surface-alt/40 border-b border-divider text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-2xs uppercase tracking-[0.06em]">Period</th>
              <th className="px-3 py-2 text-left font-medium text-2xs uppercase tracking-[0.06em]">Method</th>
              <th className="px-3 py-2 text-right font-medium text-2xs uppercase tracking-[0.06em]">Ratio</th>
              <th className="px-3 py-2 text-left font-medium text-2xs uppercase tracking-[0.06em]">Basis</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/50 transition-colors duration-150 group">
                <td className="px-3 py-2 text-ink-soft whitespace-nowrap">
                  {r.period_start} → {r.period_end}
                </td>
                <td className="px-3 py-2 text-ink-soft">
                  {r.method === 'general' ? 'General ratio' : r.method === 'direct' ? 'Direct attribution' : 'Sector ratios'}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.ratio_pct != null ? `${r.ratio_pct}%` : '—'}
                  {r.method === 'general' && r.ratio_num != null && r.ratio_denom != null && (
                    <span className="block text-2xs text-ink-faint">
                      {Math.round(r.ratio_num).toLocaleString()} / {Math.round(r.ratio_denom).toLocaleString()}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-soft text-xs max-w-md truncate">
                  {r.basis ?? <span className="text-ink-faint italic">no basis recorded</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditing({ id: r.id })}
                      className="p-1.5 rounded hover:bg-surface-alt text-ink-soft hover:text-ink"
                      title="Edit"
                    >
                      <PencilIcon size={12} />
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="p-1.5 rounded hover:bg-danger-50 text-ink-soft hover:text-danger-700"
                      title="Delete"
                    >
                      <Trash2Icon size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ──────────────────── Editor (mirror of ProrataPanel's inline form) ────────────────────

function Editor({
  entityId, existing, onClose, onSaved,
}: {
  entityId: string;
  existing: Record | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Partial<Record>>(
    existing ?? {
      period_start: `${new Date().getFullYear()}-01-01`,
      period_end: `${new Date().getFullYear()}-12-31`,
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
    <div className="px-4 py-4 bg-amber-50/40 border-b border-amber-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-ink">
          {existing ? 'Edit pro-rata configuration' : 'New pro-rata configuration'}
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
        <div className="mb-3 px-3 py-2 bg-danger-50 border border-danger-200 text-xs text-danger-800 rounded">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Period start (YYYY-MM-DD)">
          <input type="date" max={`${new Date().getFullYear() + 1}-12-31`}
            value={draft.period_start || ''}
            onChange={e => setDraft({ ...draft, period_start: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Period end (YYYY-MM-DD)">
          <input type="date"
            value={draft.period_end || ''}
            onChange={e => setDraft({ ...draft, period_end: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
        </Field>
      </div>

      <div className="mb-3">
        <Field label="Method">
          <div className="flex gap-2">
            {(['general', 'direct', 'sector'] as const).map(m => (
              <button key={m}
                onClick={() => setDraft({ ...draft, method: m })}
                className={[
                  'flex-1 h-9 px-3 rounded border text-sm font-medium',
                  draft.method === m
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-surface text-ink-soft border-border-strong hover:text-ink',
                ].join(' ')}>
                {m === 'general' ? 'General ratio' : m === 'direct' ? 'Direct attribution' : 'Sector ratios'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {draft.method === 'general' ? (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Field label="Turnover WITH deduction (€)">
            <input type="number" step="0.01" value={draft.ratio_num ?? ''}
              onChange={e => setDraft({ ...draft, ratio_num: e.target.value ? Number(e.target.value) : null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Total eligible turnover (€)">
            <input type="number" step="0.01" value={draft.ratio_denom ?? ''}
              onChange={e => setDraft({ ...draft, ratio_denom: e.target.value ? Number(e.target.value) : null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Resulting % (rounded UP)">
            <div className="h-9 flex items-center justify-end pr-2 text-lg font-semibold text-brand-700">
              {previewPct == null ? '—' : `${previewPct}%`}
            </div>
          </Field>
        </div>
      ) : (
        <div className="mb-3">
          <Field label={draft.method === 'direct' ? 'Deductible % (direct attribution)' : 'Headline % (per-sector detail in notes below)'}>
            <input type="number" step="1" min="0" max="100" value={draft.ratio_pct ?? ''}
              onChange={e => setDraft({ ...draft, ratio_pct: e.target.value ? Number(e.target.value) : null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
          </Field>
        </div>
      )}

      <Field label="Basis (one line — what supports this ratio?)">
        <input type="text"
          placeholder="e.g. 2025 financial statements; turnover with deduction = €X, exempt = €Y"
          value={draft.basis ?? ''}
          onChange={e => setDraft({ ...draft, basis: e.target.value || null })}
          className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
      </Field>

      <div className="mt-3">
        <Field label="Notes (optional — sector breakdown, exclusions, etc.)">
          <textarea
            value={draft.notes ?? ''}
            onChange={e => setDraft({ ...draft, notes: e.target.value || null })}
            rows={2}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-sm" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="h-8 px-3 rounded border border-border-strong text-sm text-ink-soft hover:text-ink"
        >Cancel</button>
        <button
          onClick={save}
          disabled={saving}
          className="h-8 px-4 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 disabled:opacity-50"
        >{saving ? 'Saving…' : existing ? 'Save changes' : 'Create configuration'}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-[0.06em] font-medium text-ink-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
