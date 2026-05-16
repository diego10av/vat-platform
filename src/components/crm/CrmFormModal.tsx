'use client';

// ════════════════════════════════════════════════════════════════════════
// CrmFormModal — generic modal form for creating or editing any CRM
// record. Driven by a `fields` schema that describes columns, labels,
// types, and options. Same component handles Company, Contact,
// Opportunity, Matter, Activity, Task, Invoice — we just pass a different
// schema.
//
// Keeps create and edit flows visually + semantically identical for the
// user (Salesforce/Veeva pattern: "the object form is the same view in
// both modes"). Validation is client-side + server-side (the API always
// re-validates).
// ════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';
import { useTaxonomy } from '@/lib/useTaxonomy';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';

export type FieldType =
  | 'text' | 'textarea' | 'email' | 'tel' | 'url'
  | 'select' | 'multiselect'
  | 'date' | 'number' | 'checkbox'
  | 'tags'
  // Stint 64.G — async-loaded combobox for picking another CRM
  // entity (a company, a matter…). Renders <SearchableSelect> under
  // the hood; options hydrate once per modal-open from the existing
  // GET endpoints. Required for the new-invoice form (Diego: "no
  // quiero emitir facturas, sólo trackearlas con su cliente").
  | 'entity-select';

export interface FieldSchema {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** When set, options hydrate from GET /api/crm/taxonomies?kind=<value>.
   *  The static `options` array becomes the SSR-friendly fallback used
   *  until the fetch resolves. */
  taxonomyKind?: 'country' | 'industry' | 'practice_area' | 'fee_type'
              | 'role_tag' | 'source' | 'loss_reason' | 'won_reason';
  /** For 'entity-select' — which collection to async-load. Each source
   *  maps a known API endpoint + label format (see useEntityOptions).
   *  Stint 91 — added 'contact' for the Opportunity primary contact
   *  picker; previously only company + matter were supported. */
  entitySource?: 'company' | 'matter' | 'contact';
  placeholder?: string;
  help?: string;
  /** For number: number format hint. For text: maxLength. */
  maxLength?: number;
  /** Show this field only when another field has a specific value. */
  visibleWhen?: { field: string; equals: string | boolean | null };
}

export interface CrmFormModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  title: string;
  subtitle?: string;
  fields: FieldSchema[];
  /** Initial values keyed by field name. Used in edit mode. */
  initial?: Record<string, unknown>;
  /** Called with the form values on Save. Should POST / PUT. Returns
   *  the record id on success, throws on validation / network error. */
  onSave: (values: Record<string, unknown>) => Promise<{ id: string } | void>;
  /** Label for the primary button. Default: Create / Save. */
  saveLabel?: string;
}

export function CrmFormModal({
  open, onClose, mode, title, subtitle, fields, initial, onSave, saveLabel,
}: CrmFormModalProps) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset state when re-opened with different initial values.
  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setErrors({});
    }
  }, [open, initial]);

  const setField = (name: string, v: unknown) => {
    setValues(prev => ({ ...prev, [name]: v }));
    if (errors[name]) setErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  function validate(): boolean {
    const next: Record<string, string> = {};
    for (const f of fields) {
      if (f.visibleWhen && values[f.visibleWhen.field] !== f.visibleWhen.equals) continue;
      if (f.required) {
        const v = values[f.name];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          next[f.name] = `${f.label} is required`;
        }
      }
      if (f.type === 'email' && typeof values[f.name] === 'string' && values[f.name]) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[f.name] as string)) {
          next[f.name] = 'Invalid email';
        }
      }
      if (f.type === 'url' && typeof values[f.name] === 'string' && values[f.name]) {
        try { new URL(values[f.name] as string); } catch { next[f.name] = 'Invalid URL'; }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) {
      toast.error('Fix validation errors above');
      return;
    }
    setSaving(true);
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      dismissable={!saving}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-8 px-3 rounded-md border border-border text-sm text-ink-soft hover:bg-surface-alt disabled:opacity-40"
          >
            Cancel
          </button>
          <Button onClick={handleSave} loading={saving} variant="primary" size="sm">
            {saveLabel ?? (mode === 'create' ? 'Create' : 'Save changes')}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(field => {
          if (field.visibleWhen && values[field.visibleWhen.field] !== field.visibleWhen.equals) return null;
          return (
            <FieldRenderer
              key={field.name}
              field={field}
              value={values[field.name]}
              error={errors[field.name]}
              onChange={v => setField(field.name, v)}
            />
          );
        })}
      </div>
    </Modal>
  );
}

// ─────────────────────────── Entity options hook ─────────────────────
//
// Stint 64.G — async-loads the option list for `type: 'entity-select'`
// fields. We deliberately fetch all rows up to the API's hard cap (500)
// once per source per modal-open, then let <SearchableSelect> filter
// client-side. At today's scale (<100 companies, <100 matters) this is
// instant; revisit a server-side typeahead when row counts approach
// the cap.
//
// Endpoints reused (no schema changes needed):
//   companies → GET /api/crm/companies?limit=500 → { id, company_name, ... }[]
//   matters   → GET /api/crm/matters?limit=500   → { id, matter_reference, title, ... }[]

interface CompanyRow { id: string; company_name: string }
interface MatterRow  { id: string; matter_reference: string | null; title: string | null }
// Stint 91 — contact picker source. Reuses GET /api/crm/contacts
// which already returns full_name + company_name on each row.
interface ContactRow { id: string; full_name: string | null; company_name: string | null }

function useEntityOptions(source: FieldSchema['entitySource'] | undefined): {
  options: SearchableOption[];
  loading: boolean;
  refetch: () => void;
} {
  const [options, setOptions] = useState<SearchableOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!source) { setOptions([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const url =
      source === 'company' ? '/api/crm/companies?limit=500' :
      source === 'matter'  ? '/api/crm/matters?limit=500' :
      /* contact */          '/api/crm/contacts?limit=500';
    fetch(url, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: unknown) => {
        if (!alive) return;
        if (!Array.isArray(rows)) { setOptions([]); return; }
        let opts: SearchableOption[];
        if (source === 'company') {
          opts = (rows as CompanyRow[]).map(r => ({
            value: r.id,
            label: r.company_name ?? r.id,
          }));
        } else if (source === 'matter') {
          opts = (rows as MatterRow[]).map(r => ({
            value: r.id,
            label: [r.matter_reference, r.title].filter(Boolean).join(' · ') || r.id,
          }));
        } else {
          opts = (rows as ContactRow[]).map(r => ({
            value: r.id,
            // "Maria González · Allen Overy" so two Marias at different
            // firms stay disambiguated in the dropdown.
            label: [r.full_name, r.company_name].filter(Boolean).join(' · ') || r.id,
          }));
        }
        setOptions(opts);
      })
      .catch(() => { if (alive) setOptions([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, tick]);

  return { options, loading, refetch };
}

// Stint 64.Q.4 — inline "Create new company" affordance attached to
// the entity-select picker when entitySource='company'. Diego: "haz
// eso también" → an inline create flow so adding a new contact whose
// firm doesn't exist yet doesn't force a context switch to
// /crm/companies. Single field (company_name); on success calls
// onCreated(newId) so the parent can refetch options + auto-select
// the new entry.
function InlineCreateCompany({
  onCreated,
}: {
  onCreated: (newId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: trimmed }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { id: string };
      onCreated(body.id);
      setOpen(false);
      setName('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-2xs text-brand-700 hover:underline mt-1"
      >
        + Create new company
      </button>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          else if (e.key === 'Escape') { setOpen(false); setName(''); setError(null); }
        }}
        disabled={busy}
        placeholder="New company name"
        className="flex-1 h-7 px-2 text-xs border border-border rounded bg-white"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !name.trim()}
        className="h-7 px-2 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? '…' : 'Create'}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(''); setError(null); }}
        disabled={busy}
        className="h-7 px-1 text-xs text-ink-muted hover:text-ink"
      >
        ✕
      </button>
      {error && <span className="text-2xs text-danger-700" title={error}>⚠</span>}
    </div>
  );
}

// ─────────────────────────── Field renderer ──────────────────────────

function FieldRenderer({
  field, value, error, onChange,
}: {
  field: FieldSchema;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  // Hydrate options from crm_taxonomies when the field declares a kind.
  // Fallback is the static `options` array defined in schemas.ts, so
  // the dropdown renders correctly on first paint before the fetch.
  const taxonomyOpts = useTaxonomy(field.taxonomyKind, field.options ?? []);
  const effectiveOptions = field.taxonomyKind ? taxonomyOpts : (field.options ?? []);
  // Stint 64.G — async load entity options when this is an entity-select.
  // No-op for every other field type (the hook is cheap when source is
  // undefined; it just bails out in the effect).
  const entityState = useEntityOptions(field.type === 'entity-select' ? field.entitySource : undefined);
  const full = field.type === 'textarea' || field.type === 'tags' || field.type === 'multiselect' || field.type === 'entity-select';
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <label className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {field.label}
        {field.required && <span className="text-danger-600 ml-0.5">*</span>}
      </label>
      {field.type === 'text' || field.type === 'email' || field.type === 'tel' || field.type === 'url' ? (
        <input
          type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : field.type === 'url' ? 'url' : 'text'}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          className={`w-full h-9 px-2.5 text-sm border rounded-md ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border'
          }`}
        />
      ) : field.type === 'textarea' ? (
        <textarea
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={`w-full px-2.5 py-2 text-sm border rounded-md resize-y ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border'
          }`}
        />
      ) : field.type === 'number' ? (
        <input
          type="number"
          // step="any" — accept arbitrary decimals (cents on amounts,
          // fractional VAT rates). Without it, browsers default to
          // step=1 and the spinner only increments by whole units;
          // typed decimals still work but the UI suggests integers
          // only. Stint 64.G follow-up after Diego asked about the
          // missing decimals on billing.
          step="any"
          value={(value as number | string) ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder={field.placeholder}
          className={`w-full h-9 px-2.5 text-sm border rounded-md tabular-nums ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border'
          }`}
        />
      ) : field.type === 'date' ? (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className={`w-full h-9 px-2.5 text-sm border rounded-md ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border'
          }`}
        />
      ) : field.type === 'checkbox' ? (
        <label className="inline-flex items-center gap-2 h-9 text-sm">
          <input
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            className="h-4 w-4 accent-brand-500"
          />
          <span className="text-ink-soft">{field.placeholder ?? ''}</span>
        </label>
      ) : field.type === 'select' ? (
        <select
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className={`w-full h-9 px-2.5 text-sm border rounded-md bg-white ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border'
          }`}
        >
          <option value="">—</option>
          {effectiveOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.type === 'multiselect' ? (
        <MultiSelectField
          options={effectiveOptions}
          value={Array.isArray(value) ? value as string[] : []}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      ) : field.type === 'tags' ? (
        <TagsField
          value={Array.isArray(value) ? value as string[] : []}
          onChange={onChange}
          placeholder={field.placeholder ?? 'Type + Enter to add'}
        />
      ) : field.type === 'entity-select' ? (
        // SearchableSelect's wrapper is inline-block by default and its
        // trigger is inline-flex — fine for tax-ops chips, but in a
        // form grid we need full-width input chrome. The arbitrary
        // variant `[&>div]:block [&>div]:w-full` flips the wrapper to
        // block / 100% width without touching the primitive. `bare`
        // strips the default chrome so triggerClassName fully owns the
        // look (matches the other inputs at h-9).
        <div>
          <div className="[&>div]:block [&>div]:w-full">
            <SearchableSelect
              bare
              options={entityState.options}
              value={(value as string) ?? null}
              onChange={(next) => onChange(next || null)}
              placeholder={
                entityState.loading
                  ? 'Loading…'
                  : (field.placeholder ?? 'Search and select…')
              }
              ariaLabel={field.label}
              disabled={entityState.loading}
              triggerClassName={`w-full h-9 px-2.5 bg-white text-ink hover:bg-surface-alt/50 border ${
                error ? 'border-danger-400' : 'border-border'
              }`}
            />
          </div>
          {/* Stint 64.Q.4 — inline create flow for the company picker.
              Adding a contact whose firm doesn't exist in the DB yet
              shouldn't force a context switch to /crm/companies. After
              creation, refetch options and auto-select the new entry. */}
          {field.entitySource === 'company' && (
            <InlineCreateCompany
              onCreated={(newId) => {
                entityState.refetch();
                onChange(newId);
              }}
            />
          )}
        </div>
      ) : null}
      {field.help && !error && (
        <p className="mt-1 text-2xs text-ink-muted">{field.help}</p>
      )}
      {error && <p className="mt-1 text-2xs text-danger-700">{error}</p>}
    </div>
  );
}

function MultiSelectField({
  options, value, onChange, placeholder,
}: {
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };
  return (
    <div>
      {placeholder && <p className="text-2xs text-ink-muted mb-1">{placeholder}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = value.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              onClick={() => toggle(o.value)}
              className={`h-7 px-2.5 rounded-md text-xs border transition-colors ${
                on
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-ink-soft border-border hover:border-brand-400'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagsField({
  value, onChange, placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    setDraft('');
  };
  const remove = (t: string) => onChange(value.filter(x => x !== t));
  return (
    <div className="w-full px-2 py-1.5 border border-border rounded-md flex flex-wrap gap-1.5 items-center min-h-9">
      {value.map(t => (
        <span key={t} className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 border border-brand-200 rounded px-1.5 py-0.5">
          {t}
          <button type="button" onClick={() => remove(t)} className="hover:text-brand-900">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(draft);
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => { if (draft.trim()) addTag(draft); }}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] text-sm"
      />
    </div>
  );
}
