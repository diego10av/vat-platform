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
import { PencilIcon, CheckIcon, XIcon, Loader2Icon, ClockIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { useDraft } from '@/lib/use-draft';

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
const FREQUENCIES = ['monthly', 'quarterly', 'annual'] as const;
// LU rule: the simplified regime can ONLY be filed annually. When the
// user picks "simplified" we lock the frequency dropdown to "annual";
// switching to "ordinary" unlocks it again. Diego confirmed this is
// non-negotiable — 2026-04-21.
function frequenciesAllowedFor(regime: string): readonly string[] {
  return regime === 'simplified' ? (['annual'] as const) : FREQUENCIES;
}
const LEGAL_FORMS = ['SARL', 'SA', 'SCS', 'SCSp', 'SCA', 'SICAV', 'SICAF', 'SIF', 'RAIF', 'SICAR', 'GmbH', 'Ltd', 'LP', 'LLC', 'Other'];
// SOPARFI nuance: "SOPARFI" is an income-tax regime label (Art. 166 LIR),
// not a VAT entity_type. A pure passive SOPARFI is NOT a VAT taxable
// person (Polysar C-60/90), has no registration, no matricule, no
// return to file — there is no valid reason to create such an entity
// in cifra. Removed from the dropdown 2026-04-21 per Diego's call.
// A SOPARFI with active management / financial / admin services to
// subsidiaries maps to `active_holding` (Cibo C-16/00, Marle C-320/17).
// See docs/classification-research.md §10.
const ENTITY_TYPES: Array<{ value: string; label: string }> = [
  { value: 'fund', label: 'Fund (UCITS / SIF / RAIF / SICAR / UCI Part II)' },
  { value: 'securitization_vehicle', label: 'Securitisation vehicle (Loi 2004/2022)' },
  { value: 'active_holding', label: 'Active holding — SOPARFI with services (Cibo / Marle)' },
  { value: 'gp', label: 'General partner' },
  { value: 'manco', label: 'Management company (AIFM / ManCo)' },
  { value: 'other', label: 'Other' },
];

// Per-type advisory notes shown inline when the user picks an entity type.
// Kept short + actionable — helps the reviewer pick the correct bucket
// without having to remember the full case-law reasoning each time.
const ENTITY_TYPE_NOTES: Record<string, string> = {
  active_holding:
    'Active / mixed holding — taxable for its management / admin / financial services to subsidiaries (Cibo C-16/00, Marle C-320/17). Input-VAT deduction on a pro-rata basis. A pure passive SOPARFI is NOT a valid entry in cifra — remove it and do not file.',
  securitization_vehicle:
    'Securitisation vehicle under Loi du 22 mars 2004 (modifiée 9 février 2022). An SV IS a taxable person for VAT; registration is typically required to handle reverse-charge on cross-border incoming services. Management services received are exempt under Art. 44§1 d LTVA via Fiscale Eenheid X C-595/13. Servicer agreements with debt-collection components may need to be split (Aspiro C-40/15).',
  fund:
    'Special investment fund (UCITS, UCI Part II, SIF, RAIF, SICAR, qualifying AIF). Management services received are exempt under Art. 44§1 d LTVA. BlackRock C-231/19: a single supply of management to a mixed SIF + non-SIF book is entirely taxable — no partial exemption.',
  manco:
    'AIFM / ManCo — provides management services (its outgoing is typically exempt Art. 44§1 d). INCOMING services are typically TAXABLE — the ManCo is NOT a qualifying fund itself.',
  gp:
    'General partner of an SCSp or similar. Charges the fund for its services (outgoing). Incoming services are typically taxable — the GP is NOT a qualifying fund.',
  other: 'Other entity — the classifier cannot apply entity-specific guards (no fund-management exemption, no IGP exclusion). Flag for reviewer discretion.',
};

export function EntityEditCard({
  entity, onSaved,
}: {
  entity: EntityEditable;
  onSaved: (next: EntityEditable) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Persist the in-progress draft to localStorage so a closed tab
  // doesn't lose the reviewer's changes. Cleared on a successful save
  // or explicit cancel + "discard draft".
  const [draft, setDraft, draftMeta] = useDraft<EntityEditable>(
    `entity-edit:${entity.id}`,
    entity,
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  // When the entity prop changes AND we're not editing, reset the draft
  // to the authoritative server value. If a draft exists, we leave it
  // so the reviewer can choose to resume.
  useEffect(() => {
    if (!editing && !draftMeta.hasDraft) setDraft(entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, editing, draftMeta.hasDraft]);

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
      draftMeta.clear();
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
            {draftMeta.hasDraft && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded px-1.5 py-0.5">
                <ClockIcon size={9} />
                Unsaved draft
              </span>
            )}
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
          {draft.entity_type && ENTITY_TYPE_NOTES[draft.entity_type] && (
            <p className="mt-1 text-[10.5px] text-ink-muted leading-snug">
              {ENTITY_TYPE_NOTES[draft.entity_type]}
            </p>
          )}
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
            onChange={e => {
              const nextRegime = e.target.value;
              // LU-law rule: simplified is only allowed annually. Snap
              // the frequency back to 'annual' when the user switches
              // into simplified, so we never persist an impossible
              // (simplified, monthly) or (simplified, quarterly) pair.
              const nextFreq = nextRegime === 'simplified' ? 'annual' : draft.frequency;
              setDraft({ ...draft, regime: nextRegime, frequency: nextFreq });
            }}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] bg-white"
          >
            {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field
          label="Frequency"
          hint={draft.regime === 'simplified' ? 'Simplified → annual only' : undefined}
        >
          <select
            value={draft.frequency}
            onChange={e => setDraft({ ...draft, frequency: e.target.value })}
            disabled={draft.regime === 'simplified'}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] bg-white disabled:bg-surface-alt disabled:cursor-not-allowed"
          >
            {frequenciesAllowedFor(draft.regime).map(f => <option key={f} value={f}>{f}</option>)}
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

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[10.5px] text-ink-muted inline-flex items-center gap-1.5">
          {draftMeta.lastSavedAt && (
            <>
              <ClockIcon size={10} />
              Draft auto-saved {formatRelativeTime(draftMeta.lastSavedAt)}
            </>
          )}
        </div>
        <div className="flex gap-2">
          {draftMeta.hasDraft && (
            <button
              onClick={() => { draftMeta.clear(); setDraft(entity); }}
              className="h-8 px-3 rounded border border-border text-[12px] text-ink-muted hover:text-ink"
              title="Discard the auto-saved draft and revert to the current saved values"
            >
              Discard draft
            </button>
          )}
          <button
            onClick={() => { setEditing(false); setErr(null); }}
            disabled={saving}
            className="h-8 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
            title="Close the editor — the draft stays in your browser and restores next time"
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
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
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
