'use client';

// ════════════════════════════════════════════════════════════════════════
// EntityEditCard — inline edit form for the entity profile.
//
// Sits on /entities/[id] under the page header. Renders as a compact
// summary row by default; "Edit" opens an inline form with validated
// inputs. Wires the PUT /api/entities/[id] endpoint that already
// existed (the gap was purely UI, not API).
//
// Gassner audit item #1 (docs/gassner-audit-2026-04-19.md): "Entity
// edit form missing — every typo at creation is a permanent scar".
// Fixed in stint 12 (2026-04-19).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { PencilIcon, CheckIcon, XIcon, Loader2Icon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

export interface EntityEditable {
  id: string;
  name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  legal_form: string | null;
  entity_type: string | null;
  regime: string;
  frequency: string;
  address: string | null;
  has_fx: boolean;
  has_outgoing: boolean;
  has_recharges: boolean;
}

const REGIMES = ['simplified', 'ordinary'] as const;
const FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;
const LEGAL_FORMS = ['SARL', 'SA', 'SCS', 'SCSp', 'SCA', 'SICAV', 'SICAF', 'SIF', 'RAIF', 'SICAR', 'GmbH', 'Ltd', 'LP', 'LLC', 'Other'];
const ENTITY_TYPES: Array<{ value: string; label: string }> = [
  { value: 'fund', label: 'Fund (UCITS / SIF / RAIF / SICAR / UCI Part II)' },
  { value: 'active_holding', label: 'Active holding (Cibo / Marle)' },
  { value: 'passive_holding', label: 'Passive holding (Polysar)' },
  { value: 'gp', label: 'General partner' },
  { value: 'manco', label: 'Management company (AIFM / ManCo)' },
  { value: 'other', label: 'Other' },
];

export function EntityEditCard({
  entity, onSaved,
}: {
  entity: EntityEditable;
  onSaved: (next: EntityEditable) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EntityEditable>(entity);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { if (!editing) setDraft(entity); }, [entity, editing]);

  async function save() {
    if (!draft.name || draft.name.trim().length === 0) {
      setErr('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          vat_number: draft.vat_number?.trim() || null,
          matricule: draft.matricule?.trim() || null,
          rcs_number: draft.rcs_number?.trim() || null,
          legal_form: draft.legal_form || null,
          entity_type: draft.entity_type || null,
          regime: draft.regime,
          frequency: draft.frequency,
          address: draft.address?.trim() || null,
          has_fx: draft.has_fx,
          has_outgoing: draft.has_outgoing,
          has_recharges: draft.has_recharges,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error?.message || body?.error || body?.message || 'Could not save.');
        return;
      }
      toast.success('Entity updated.');
      onSaved(draft);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="bg-surface border border-border rounded-lg mb-4 px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
            <span className="uppercase tracking-wide font-semibold text-ink-muted text-[10px]">
              Entity profile
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-2 text-[11.5px]">
            <MetaField label="Legal form" value={entity.legal_form} />
            <MetaField label="Entity type" value={formatEntityType(entity.entity_type)} />
            <MetaField label="VAT number" value={entity.vat_number} mono />
            <MetaField label="Matricule" value={entity.matricule} mono />
            <MetaField label="RCS" value={entity.rcs_number} mono />
            <MetaField label="Regime" value={`${entity.regime} · ${entity.frequency}`} />
          </dl>
          {entity.address && (
            <div className="mt-2 text-[11px] text-ink-muted truncate">
              {entity.address}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            {entity.has_fx && <FeatureChip label="FX" />}
            {entity.has_outgoing && <FeatureChip label="Outgoing" />}
            {entity.has_recharges && <FeatureChip label="Recharges" />}
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 h-8 px-3 rounded-md border border-border-strong text-[12px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1.5"
        >
          <PencilIcon size={12} />
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="bg-amber-50/40 border border-amber-300 rounded-lg mb-4 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink">Edit entity profile</h3>
        <button
          onClick={() => { setEditing(false); setErr(null); }}
          className="p-1 text-ink-muted hover:text-ink"
          aria-label="Cancel"
        >
          <XIcon size={14} />
        </button>
      </div>

      {err && (
        <div className="mb-3 px-3 py-2 bg-danger-50 border border-danger-200 text-[11.5px] text-danger-800 rounded">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Name *">
          <input
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
          />
        </Field>
        <Field label="Legal form">
          <select
            value={draft.legal_form ?? ''}
            onChange={e => setDraft({ ...draft, legal_form: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] bg-white"
          >
            <option value="">—</option>
            {LEGAL_FORMS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Entity type" hint="Drives classification rules">
          <select
            value={draft.entity_type ?? ''}
            onChange={e => setDraft({ ...draft, entity_type: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] bg-white"
          >
            <option value="">—</option>
            {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="VAT number">
          <input
            value={draft.vat_number ?? ''}
            onChange={e => setDraft({ ...draft, vat_number: e.target.value.toUpperCase() || null })}
            placeholder="LU12345678"
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </Field>
        <Field label="Matricule">
          <input
            value={draft.matricule ?? ''}
            onChange={e => setDraft({ ...draft, matricule: e.target.value || null })}
            placeholder="1999220..."
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </Field>
        <Field label="RCS number">
          <input
            value={draft.rcs_number ?? ''}
            onChange={e => setDraft({ ...draft, rcs_number: e.target.value || null })}
            placeholder="B123456"
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </Field>

        <Field label="Regime">
          <select
            value={draft.regime}
            onChange={e => setDraft({ ...draft, regime: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] bg-white"
          >
            {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Frequency">
          <select
            value={draft.frequency}
            onChange={e => setDraft({ ...draft, frequency: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] bg-white"
          >
            {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <div />

        <div className="md:col-span-3">
          <Field label="Address">
            <input
              value={draft.address ?? ''}
              onChange={e => setDraft({ ...draft, address: e.target.value || null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px]"
            />
          </Field>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={draft.has_fx}
            onChange={e => setDraft({ ...draft, has_fx: e.target.checked })}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          Non-EUR invoices (FX)
        </label>
        <label className="inline-flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={draft.has_outgoing}
            onChange={e => setDraft({ ...draft, has_outgoing: e.target.checked })}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          Issues outgoing invoices
        </label>
        <label className="inline-flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={draft.has_recharges}
            onChange={e => setDraft({ ...draft, has_recharges: e.target.checked })}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          Internal recharges
        </label>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => { setEditing(false); setErr(null); setDraft(entity); }}
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
          {saving ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function formatEntityType(v: string | null): string | null {
  if (!v) return null;
  const found = ENTITY_TYPES.find(t => t.value === v);
  return found?.label ?? v;
}

function MetaField({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[9.5px] uppercase tracking-wide font-semibold text-ink-faint">
        {label}
      </dt>
      <dd className={`mt-0.5 ${mono ? 'font-mono' : ''} ${value ? 'text-ink' : 'text-ink-faint italic'}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

function FeatureChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-[18px] px-1.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100 text-[10px] font-semibold tracking-wide uppercase">
      {label}
    </span>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-0.5 flex items-baseline gap-2">
        <span>{label}</span>
        {hint && <span className="text-[9.5px] text-ink-faint normal-case tracking-normal font-normal">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
