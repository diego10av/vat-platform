'use client';

// ════════════════════════════════════════════════════════════════════════
// AddEntityRow — stint 37.F · extended in 49.B2 with "add existing"
//
// At the end of each client-group section in a matrix page, two paths:
//
//   1. "+ Add entity to GROUP"  → expands an inline input. Type the
//      legal name, Enter → creates entity (with client_group_id) +
//      obligation for the current matrix tax_type. (Original flow.)
//
//   2. "↳ Add existing"  → opens a searchable dropdown of entities
//      that DON'T have an active obligation for this matrix's
//      (tax_type, period_pattern, service_kind) yet. Pick one → POSTs
//      a new obligation against the picked entity (keeping its
//      existing family). Solves Diego's "Green Arrow Fund is in
//      subscription tax but I want it in VAT too" problem without
//      forcing him to create a duplicate entity.
// ════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from 'react';
import { PlusIcon } from 'lucide-react';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';
import { useToast } from '@/components/Toaster';

interface Props {
  groupId: string | null;
  groupName: string;
  taxType: string;
  periodPattern: string;
  serviceKind?: 'filing' | 'review';
  /**
   * Stint 40.D — optional extra obligations to create in parallel with
   * the main one. Used on BCL pages so "+ Add entity" under SBS also
   * sets up the BCL 2.16 monthly obligation (every BCL-subject entity
   * does both reports; forcing Diego to add them twice was friction).
   */
  additionalObligations?: Array<{
    tax_type: string;
    period_pattern: string;
    service_kind?: 'filing' | 'review';
  }>;
  onCreated: () => void;
}

interface EntityOption {
  id: string;
  legal_name: string;
  group_name: string | null;
  obligations: Array<{ tax_type: string; period_pattern: string; service_kind: string; is_active: boolean }>;
}

export function AddEntityRow({
  groupId, groupName, taxType, periodPattern, serviceKind = 'filing',
  additionalObligations, onCreated,
}: Props) {
  const [mode, setMode] = useState<'button' | 'input' | 'pick'>('button');
  const [legalName, setLegalName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Stint 49.B2 — entities eligible for the "add existing" mode. Lazy-
  // loaded only when Diego clicks "↳ Add existing" so we don't pay the
  // fetch cost on every matrix render.
  const [allEntities, setAllEntities] = useState<EntityOption[] | null>(null);
  const [pickedEntityId, setPickedEntityId] = useState<string>('');

  useEffect(() => {
    if (mode === 'input') inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'pick' || allEntities) return;
    fetch('/api/tax-ops/entities?with_obligations=1')
      .then(r => r.ok ? r.json() : { entities: [] })
      .then(body => setAllEntities(body.entities ?? []))
      .catch(() => setAllEntities([]));
  }, [mode, allEntities]);

  // Filter to entities WITHOUT an active obligation matching (tax_type,
  // period_pattern, service_kind). Sorted by family name then legal name.
  const eligibleOptions = useMemo<SearchableOption[]>(() => {
    if (!allEntities) return [];
    const eligible = allEntities.filter(e =>
      !e.obligations.some(o =>
        o.is_active
          && o.tax_type === taxType
          && o.period_pattern === periodPattern
          && o.service_kind === serviceKind,
      ),
    );
    eligible.sort((a, b) => {
      const fa = a.group_name ?? 'zzz';
      const fb = b.group_name ?? 'zzz';
      if (fa !== fb) return fa.localeCompare(fb);
      return a.legal_name.localeCompare(b.legal_name);
    });
    return eligible.map(e => ({
      value: e.id,
      label: e.group_name ? `${e.legal_name} · ${e.group_name}` : `${e.legal_name} · (no family)`,
    }));
  }, [allEntities, taxType, periodPattern, serviceKind]);

  async function create() {
    const name = legalName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Create entity
      const entRes = await fetch('/api/tax-ops/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_name: name,
          client_group_id: groupId,
        }),
      });
      if (!entRes.ok) {
        const b = await entRes.json().catch(() => ({}));
        throw new Error(b?.error ?? `Entity create failed (${entRes.status})`);
      }
      const { id: entityId } = await entRes.json() as { id: string };

      // 2. Create obligation for the current matrix scope
      await createObligationFor(entityId);

      setLegalName('');
      setMode('button');
      onCreated();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function addExisting() {
    if (!pickedEntityId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createObligationFor(pickedEntityId);
      const picked = allEntities?.find(e => e.id === pickedEntityId);
      toast.success(
        `${picked?.legal_name ?? 'Entity'} added to this ${humanTaxType(taxType)} matrix`,
      );
      setPickedEntityId('');
      setMode('button');
      onCreated();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function createObligationFor(entityId: string) {
    const oblRes = await fetch('/api/tax-ops/obligations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_id: entityId,
        tax_type: taxType,
        period_pattern: periodPattern,
        service_kind: serviceKind,
      }),
    });
    if (!oblRes.ok) {
      const b = await oblRes.json().catch(() => ({}));
      throw new Error(b?.error ?? `Obligation create failed (${oblRes.status})`);
    }
    if (additionalObligations?.length) {
      const extraErrors: string[] = [];
      for (const extra of additionalObligations) {
        const r = await fetch('/api/tax-ops/obligations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity_id: entityId,
            tax_type: extra.tax_type,
            period_pattern: extra.period_pattern,
            service_kind: extra.service_kind ?? 'filing',
          }),
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          extraErrors.push(`${extra.tax_type}: ${b?.error ?? r.status}`);
        }
      }
      if (extraErrors.length) {
        setError(`Partial: ${extraErrors.join('; ')}`);
      }
    }
  }

  if (mode === 'button') {
    // Stint 51.F — Diego: "no entiendo por qué ahora no puedo añadir
    // una nueva entidad". The action existed but the label "Add entity
    // to AVALLON" read as "associate" rather than "create". Rephrased
    // to explicit "+ New entity" so creating is unmistakable; "Add
    // existing" stays as the second option for when the entity already
    // lives in another family.
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setMode('input')}
          className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-700"
          title="Create a brand-new entity in this family"
        >
          <PlusIcon size={11} /> New entity in {groupName || '(no family)'}
        </button>
        <span className="text-2xs text-ink-faint">·</span>
        <button
          type="button"
          onClick={() => setMode('pick')}
          className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-700"
          title="Add an entity that already exists (any family) to this tax type"
        >
          ↳ Add existing entity
        </button>
      </div>
    );
  }

  if (mode === 'pick') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="text-xs text-ink-muted">Add existing →</span>
        <SearchableSelect
          options={eligibleOptions}
          value={pickedEntityId}
          onChange={setPickedEntityId}
          placeholder={
            allEntities === null
              ? 'Loading…'
              : eligibleOptions.length === 0
                ? 'All entities already have this'
                : 'Pick an entity…'
          }
          ariaLabel="Pick existing entity"
          triggerClassName="min-w-[280px]"
        />
        <button
          type="button"
          onClick={() => void addExisting()}
          disabled={busy || !pickedEntityId}
          className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => { setPickedEntityId(''); setMode('button'); }}
          className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
        >
          Cancel
        </button>
        {error && <span className="text-2xs text-danger-700" title={error}>⚠</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <PlusIcon size={11} className="text-ink-muted" />
      <input
        ref={inputRef}
        value={legalName}
        onChange={(e) => setLegalName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void create(); }
          else if (e.key === 'Escape') {
            e.preventDefault();
            setLegalName('');
            setMode('button');
          }
        }}
        placeholder={`Legal name (adding to ${groupName || '(no family)'})`}
        disabled={busy}
        className="flex-1 min-w-[220px] max-w-[360px] px-2 py-0.5 text-sm border border-border rounded bg-surface"
      />
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !legalName.trim()}
        className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => { setLegalName(''); setMode('button'); }}
        className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
      >
        Cancel
      </button>
      {error && <span className="text-2xs text-danger-700" title={error}>⚠</span>}
    </div>
  );
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
