'use client';

// NewEntityModal — stint 51.G.
//
// Diego: "si tengo un cliente que me contrata para hacer las
// declaraciones de IVA y tengo que añadir este nuevo cliente y no
// pertenece a ninguna familia ni la entidad ha sido creada, que pueda
// crear la entidad y pueda decir: vale, está sujeta anual, quarterly o
// monthly… que tenga la posibilidad de crear una nueva entidad."
//
// One-shot creation of a fresh entity + every relevant tax obligation,
// without forcing a hop to the entity detail page after creation. The
// AddEntityRow per-family flow stays — this is the global path for
// new clients who don't belong to any existing family yet.
//
// Surfaces:
//   - /tax-ops/entities page header (CTA)
//   - Every matrix toolbar (CTA)

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/Toaster';

interface FamilyOption { id: string; name: string }

interface ObligationCheck {
  key: string;
  tax_type: string;
  period_pattern: string;
  service_kind?: 'filing' | 'review';
  label: string;
}

// ─── Catalogue of obligations the modal can create ──────────────────
//
// Grouped so checkboxes render in clusters Diego understands. Mirrors
// the tax_deadline_rules seeded in mig 045/050 — adding a new tax_type
// in the DB requires a one-line addition here too.

const VAT_OBLIGATIONS: ObligationCheck[] = [
  { key: 'vat_annual',            tax_type: 'vat_annual',            period_pattern: 'annual',    label: 'Annual' },
  { key: 'vat_simplified_annual', tax_type: 'vat_simplified_annual', period_pattern: 'annual',    label: 'Annual simplified' },
  { key: 'vat_quarterly',         tax_type: 'vat_quarterly',         period_pattern: 'quarterly', label: 'Quarterly' },
  { key: 'vat_monthly',           tax_type: 'vat_monthly',           period_pattern: 'monthly',   label: 'Monthly' },
];

const DIRECT_TAX_OBLIGATIONS: ObligationCheck[] = [
  { key: 'cit_annual', tax_type: 'cit_annual', period_pattern: 'annual', label: 'Corporate tax (CIT)' },
  // NWT review is the "do you want me to review the NWT computation?"
  // opt-in. service_kind=review distinguishes it from a full filing.
  { key: 'nwt_review', tax_type: 'nwt_annual', period_pattern: 'annual', service_kind: 'review', label: 'NWT review' },
];

const OTHER_OBLIGATIONS: ObligationCheck[] = [
  { key: 'subscription_tax_quarterly', tax_type: 'subscription_tax_quarterly', period_pattern: 'quarterly', label: 'Subscription tax' },
  { key: 'bcl_sbs_quarterly',          tax_type: 'bcl_sbs_quarterly',          period_pattern: 'quarterly', label: 'BCL SBS (quarterly)' },
  { key: 'bcl_216_monthly',            tax_type: 'bcl_216_monthly',            period_pattern: 'monthly',   label: 'BCL 2.16 (monthly)' },
  { key: 'fatca_crs_annual',           tax_type: 'fatca_crs_annual',           period_pattern: 'annual',    label: 'FATCA / CRS' },
];

// WHT is a single concept (director's withholding tax) with four cadences;
// the user picks one, not a checkbox per cadence.
const WHT_CADENCES: Array<{ value: string; label: string; period_pattern: string; tax_type: string }> = [
  { value: 'wht_director_monthly',   label: 'Monthly',   period_pattern: 'monthly',   tax_type: 'wht_director_monthly' },
  { value: 'wht_director_quarterly', label: 'Quarterly', period_pattern: 'quarterly', tax_type: 'wht_director_quarterly' },
  { value: 'wht_director_semester',  label: 'Semester',  period_pattern: 'semester',  tax_type: 'wht_director_semester' },
  { value: 'wht_director_annual',    label: 'Annual',    period_pattern: 'annual',    tax_type: 'wht_director_annual' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the family selector when the modal is opened from a
   *  context that already knows the family (e.g. opened from inside
   *  an Avallon matrix). */
  presetFamilyId?: string | null;
  /** Called after a successful create with the new entity id. The
   *  caller decides whether to navigate, refetch a list, etc. */
  onCreated: (entityId: string) => void;
}

export function NewEntityModal({ open, onClose, presetFamilyId, onCreated }: Props) {
  const router = useRouter();
  const toast = useToast();

  const [legalName, setLegalName] = useState('');
  const [familyId, setFamilyId] = useState<string>('');     // '' | id | '__create__'
  const [newFamilyName, setNewFamilyName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [matricule, setMatricule] = useState('');
  const [rcsNumber, setRcsNumber] = useState('');

  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [whtEnabled, setWhtEnabled] = useState(false);
  const [whtCadence, setWhtCadence] = useState<string>('wht_director_monthly');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  // Reset state every time the modal closes.
  useEffect(() => {
    if (open) {
      setLegalName(''); setNewFamilyName(''); setVatNumber('');
      setMatricule(''); setRcsNumber('');
      setFamilyId(presetFamilyId ?? '');
      setSelected(new Set()); setWhtEnabled(false);
      setWhtCadence('wht_director_monthly');
      setBusy(false); setError(null); setConflictId(null);
      // Lazy-load the list of families on open.
      fetch('/api/tax-ops/entities')
        .then(r => r.ok ? r.json() : { groups: [] })
        .then((body: { groups: FamilyOption[] }) => setFamilies(body.groups ?? []))
        .catch(() => setFamilies([]));
    }
  }, [open, presetFamilyId]);

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function submit() {
    const name = legalName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    setConflictId(null);
    try {
      // 1. Resolve family → id. May create a new one on the fly.
      let resolvedFamilyId: string | null = null;
      if (familyId === '__create__') {
        const fname = newFamilyName.trim();
        if (!fname) throw new Error('Family name required');
        const fres = await fetch('/api/tax-ops/client-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fname }),
        });
        if (!fres.ok) {
          const b = await fres.json().catch(() => ({}));
          throw new Error(b?.error ?? `Family create failed (${fres.status})`);
        }
        const { id: newId } = await fres.json() as { id: string };
        resolvedFamilyId = newId;
      } else if (familyId) {
        resolvedFamilyId = familyId;
      }

      // 2. Create the entity. /api/tax-ops/entities POST already does
      //    the dup pre-check (mig 065 + stint 50.C/D), so a 409 here
      //    means a real duplicate.
      const eres = await fetch('/api/tax-ops/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_name: name,
          client_group_id: resolvedFamilyId,
          vat_number: vatNumber.trim() || null,
          matricule: matricule.trim() || null,
          rcs_number: rcsNumber.trim() || null,
        }),
      });
      if (eres.status === 409) {
        const b = await eres.json().catch(() => ({}));
        setConflictId(b?.existing_entity_id ?? null);
        throw new Error(
          `An entity with this legal name already exists in this family${
            b?.existing_legal_name ? ` (${b.existing_legal_name})` : ''
          }.`,
        );
      }
      if (!eres.ok) {
        const b = await eres.json().catch(() => ({}));
        throw new Error(b?.error ?? `Entity create failed (${eres.status})`);
      }
      const { id: entityId } = await eres.json() as { id: string };

      // 3. Build the obligation list and POST each in turn.
      const oblsToCreate: Array<{ tax_type: string; period_pattern: string; service_kind?: 'filing' | 'review' }> = [];
      for (const o of [...VAT_OBLIGATIONS, ...DIRECT_TAX_OBLIGATIONS, ...OTHER_OBLIGATIONS]) {
        if (selected.has(o.key)) {
          oblsToCreate.push({
            tax_type: o.tax_type,
            period_pattern: o.period_pattern,
            service_kind: o.service_kind ?? 'filing',
          });
        }
      }
      if (whtEnabled) {
        const cad = WHT_CADENCES.find(c => c.value === whtCadence);
        if (cad) oblsToCreate.push({
          tax_type: cad.tax_type,
          period_pattern: cad.period_pattern,
          service_kind: 'filing',
        });
      }

      const obligationErrors: string[] = [];
      for (const o of oblsToCreate) {
        const r = await fetch('/api/tax-ops/obligations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: entityId, ...o }),
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          obligationErrors.push(`${o.tax_type}: ${b?.error ?? r.status}`);
        }
      }

      if (obligationErrors.length) {
        toast.error(
          `Entity created but ${obligationErrors.length} obligation${obligationErrors.length > 1 ? 's' : ''} failed`,
          obligationErrors.join('; '),
        );
      } else {
        toast.success(
          oblsToCreate.length === 0
            ? `${name} created`
            : `${name} created with ${oblsToCreate.length} obligation${oblsToCreate.length > 1 ? 's' : ''}`,
        );
      }
      onCreated(entityId);
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const totalSelected = selected.size + (whtEnabled ? 1 : 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New entity"
      subtitle="Create a fresh entity and tick every tax obligation it's subject to. All in one step — no need to come back later to add each filing."
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !legalName.trim() || (familyId === '__create__' && !newFamilyName.trim())}
            className="px-3 py-1.5 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Creating…'
              : totalSelected === 0
                ? 'Create entity'
                : `Create entity + ${totalSelected} obligation${totalSelected > 1 ? 's' : ''}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {/* ─── Identity ─────────────────────────────── */}
        <div className="space-y-2">
          <label className="block">
            <span className="text-ink-muted text-xs">Legal name *</span>
            <input
              autoFocus
              value={legalName}
              onChange={e => setLegalName(e.target.value)}
              placeholder="e.g. Acme Holdings S.à r.l."
              className="mt-1 w-full px-2.5 py-1.5 border border-border rounded-md bg-surface"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-ink-muted text-xs">Family</span>
              <select
                value={familyId}
                onChange={e => setFamilyId(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
              >
                <option value="">— No family (standalone) —</option>
                {families.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
                <option value="__create__">+ Create new family…</option>
              </select>
            </label>
            {familyId === '__create__' && (
              <label>
                <span className="text-ink-muted text-xs">New family name *</span>
                <input
                  value={newFamilyName}
                  onChange={e => setNewFamilyName(e.target.value)}
                  placeholder="e.g. NEW CLIENT GROUP"
                  className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
                />
              </label>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label>
              <span className="text-ink-muted text-xs">VAT number</span>
              <input
                value={vatNumber}
                onChange={e => setVatNumber(e.target.value)}
                placeholder="LU…"
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
              />
            </label>
            <label>
              <span className="text-ink-muted text-xs">Matricule</span>
              <input
                value={matricule}
                onChange={e => setMatricule(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
              />
            </label>
            <label>
              <span className="text-ink-muted text-xs">RCS number</span>
              <input
                value={rcsNumber}
                onChange={e => setRcsNumber(e.target.value)}
                placeholder="B…"
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
              />
            </label>
          </div>
        </div>

        {/* ─── Obligation checklist ─────────────────── */}
        <div className="space-y-3 pt-2 border-t border-border">
          <div>
            <h4 className="text-xs font-semibold text-ink mb-1">VAT</h4>
            <p className="text-2xs text-ink-muted mb-1.5">
              Tick every cadence the entity is subject to — multiple are allowed (régimen ordinario LU).
            </p>
            <div className="grid grid-cols-2 gap-1">
              {VAT_OBLIGATIONS.map(o => (
                <Check key={o.key} ob={o} checked={selected.has(o.key)} onToggle={toggle} />
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-ink mb-1">Direct tax</h4>
            <div className="grid grid-cols-2 gap-1">
              {DIRECT_TAX_OBLIGATIONS.map(o => (
                <Check key={o.key} ob={o} checked={selected.has(o.key)} onToggle={toggle} />
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-ink mb-1">Other</h4>
            <div className="grid grid-cols-2 gap-1">
              {OTHER_OBLIGATIONS.map(o => (
                <Check key={o.key} ob={o} checked={selected.has(o.key)} onToggle={toggle} />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 px-1 py-1">
              <input
                type="checkbox"
                id="wht-enabled"
                checked={whtEnabled}
                onChange={e => setWhtEnabled(e.target.checked)}
              />
              <label htmlFor="wht-enabled" className="text-sm cursor-pointer">
                Withholding tax (director)
              </label>
              {whtEnabled && (
                <select
                  value={whtCadence}
                  onChange={e => setWhtCadence(e.target.value)}
                  className="ml-2 px-2 py-0.5 text-xs border border-border rounded-md bg-surface"
                >
                  {WHT_CADENCES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-danger-300 bg-danger-50/50 px-3 py-2 text-sm text-danger-800">
            {error}
            {conflictId && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => router.push(`/tax-ops/entities/${conflictId}`)}
                  className="underline hover:text-danger-900"
                >
                  Open the existing entity
                </button>
                .
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Check({
  ob, checked, onToggle,
}: { ob: ObligationCheck; checked: boolean; onToggle: (key: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-alt/50 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(ob.key)}
      />
      <span className="text-sm text-ink">{ob.label}</span>
    </label>
  );
}
