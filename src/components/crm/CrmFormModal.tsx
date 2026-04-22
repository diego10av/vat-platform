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

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';

export type FieldType =
  | 'text' | 'textarea' | 'email' | 'tel' | 'url'
  | 'select' | 'multiselect'
  | 'date' | 'number' | 'checkbox'
  | 'tags';

export interface FieldSchema {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
  /** For number: number format hint. For text: maxLength. */
  maxLength?: number;
  /** Show this field only when another field has a specific value. */
  visibleWhen?: { field: string; equals: string | null };
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
            className="h-8 px-3 rounded-md border border-border text-[12.5px] text-ink-soft hover:bg-surface-alt disabled:opacity-40"
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

// ─────────────────────────── Field renderer ──────────────────────────

function FieldRenderer({
  field, value, error, onChange,
}: {
  field: FieldSchema;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const full = field.type === 'textarea' || field.type === 'tags' || field.type === 'multiselect';
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
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
          className={`w-full h-9 px-2.5 text-[13px] border rounded-md focus:outline-none focus:ring-1 ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border focus:border-brand-500 focus:ring-brand-500'
          }`}
        />
      ) : field.type === 'textarea' ? (
        <textarea
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={`w-full px-2.5 py-2 text-[13px] border rounded-md focus:outline-none focus:ring-1 resize-y ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border focus:border-brand-500 focus:ring-brand-500'
          }`}
        />
      ) : field.type === 'number' ? (
        <input
          type="number"
          value={(value as number | string) ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder={field.placeholder}
          className={`w-full h-9 px-2.5 text-[13px] border rounded-md focus:outline-none focus:ring-1 tabular-nums ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border focus:border-brand-500 focus:ring-brand-500'
          }`}
        />
      ) : field.type === 'date' ? (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className={`w-full h-9 px-2.5 text-[13px] border rounded-md focus:outline-none focus:ring-1 ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border focus:border-brand-500 focus:ring-brand-500'
          }`}
        />
      ) : field.type === 'checkbox' ? (
        <label className="inline-flex items-center gap-2 h-9 text-[13px]">
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
          className={`w-full h-9 px-2.5 text-[13px] border rounded-md focus:outline-none focus:ring-1 bg-white ${
            error ? 'border-danger-400 focus:ring-danger-400' : 'border-border focus:border-brand-500 focus:ring-brand-500'
          }`}
        >
          <option value="">—</option>
          {field.options?.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.type === 'multiselect' ? (
        <MultiSelectField
          options={field.options ?? []}
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
      ) : null}
      {field.help && !error && (
        <p className="mt-1 text-[10.5px] text-ink-muted">{field.help}</p>
      )}
      {error && <p className="mt-1 text-[10.5px] text-danger-700">{error}</p>}
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
      {placeholder && <p className="text-[10.5px] text-ink-muted mb-1">{placeholder}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = value.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              onClick={() => toggle(o.value)}
              className={`h-7 px-2.5 rounded-md text-[11.5px] border transition-colors ${
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
        <span key={t} className="inline-flex items-center gap-1 text-[11px] bg-brand-50 text-brand-700 border border-brand-200 rounded px-1.5 py-0.5">
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
        className="flex-1 min-w-[120px] text-[13px] focus:outline-none"
      />
    </div>
  );
}
