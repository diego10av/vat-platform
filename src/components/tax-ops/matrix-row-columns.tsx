'use client';

// Shared column factories used by every tax-type category page so that
// prepared_with / comments / deadline get the same inline-edit behaviour
// everywhere. Keeps per-page code tight + avoids drift when we tweak
// UX later.

import { useState, useMemo } from 'react';
import type { MatrixColumn, MatrixEntity, MatrixCell } from './TaxTypeMatrix';
import { InlineTagsCell, InlineTextCell, InlineDateCell, InlinePriceCell } from './inline-editors';
import { DeadlineWithTolerance } from './DeadlineWithTolerance';
import { familyChipClasses } from './familyColors';
import { CspContactsEditor, type CspContact } from './CspContactsEditor';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';

// Patch helper — works off the cell's filing_id. When the cell is empty,
// the edit is blocked (we don't create an empty filing just to attach a
// comment; user sets a status first via the period cell).
async function patchFiling(filingId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/tax-ops/filings/${filingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}

/**
 * Returns the most "representative" filing cell for an entity: the
 * first non-empty cell across all its period columns. Used by common
 * columns (prepared_with, comments) which logically apply per-period
 * but Diego edits in one place per row.
 *
 * For annual tax types, there's only ever one period so this resolves
 * trivially. For quarterly/monthly, edits pick the first filled cell
 * (usually the most recent filed one); in practice Diego almost always
 * has the same prepared_with across Q1..Q4 for a given entity-year.
 */
function firstFiledCell(entity: MatrixEntity, periodLabels: string[]): MatrixCell | null {
  for (const label of periodLabels) {
    const cell = entity.cells[label];
    if (cell?.filing_id) return cell;
  }
  return null;
}

/**
 * When the common column edits a value that semantically belongs on
 * EVERY filing of the row (like prepared_with across all 4 quarters
 * of a VAT return), we propagate the patch to each filing in parallel.
 */
async function patchAllFilings(filingIds: string[], patch: Record<string, unknown>): Promise<void> {
  const results = await Promise.allSettled(
    filingIds.map(id => patchFiling(id, patch)),
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) throw new Error(`${failed} of ${filingIds.length} saves failed`);
}

/**
 * Stint 43.D11 — "Partner in charge" column (renamed from "Prepared with").
 *
 * Diego: "el 'prepared with' diría partner in charge". Big4-style ownership:
 * the partner who owns the engagement. Backed by `tax_filings.partner_in_charge`
 * (TEXT[]) — backfilled from `prepared_with` on migration 060.
 *
 * Edits propagate across every filing in the row (so VAT Q1..Q4 stay in
 * sync — Diego almost always has the same partner across all quarters).
 */
export function partnerInChargeColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'partner_in_charge',
    label: 'Partner in charge',
    widthClass: 'w-[160px]',
    render: (e) => {
      const anyCell = firstFiledCell(e, periodLabels);
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      // Read from the new field; fall back to `prepared_with` for cells
      // not yet touched after migration 060 (defensive — the migration
      // backfilled all 200 rows but a stale fetch could still arrive).
      const value = anyCell?.partner_in_charge?.length
        ? anyCell.partner_in_charge
        : (anyCell?.prepared_with ?? []);
      return (
        <InlineTagsCell
          value={value}
          disabled={allFilingIds.length === 0}
          placeholder="+ partner"
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { partner_in_charge: next });
            refetch();
          }}
        />
      );
    },
  };
}

/**
 * Stint 43.D11 — "Associates working" column. Mirror of partnerInChargeColumn
 * but for the associate(s) doing the prep work. New field, starts empty
 * for all rows; Diego fills as engagements progress.
 *
 * Stint 44.F1 — was rendering a blank cell when no associates were assigned
 * (placeholder=""), so Diego had no clue where to click. Visible "+ associate"
 * placeholder makes the affordance obvious.
 */
export function associatesWorkingColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'associates_working',
    label: 'Associates working',
    widthClass: 'w-[160px]',
    render: (e) => {
      const anyCell = firstFiledCell(e, periodLabels);
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      const value = anyCell?.associates_working ?? [];
      return (
        <InlineTagsCell
          value={value}
          disabled={allFilingIds.length === 0}
          placeholder="+ associate"
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { associates_working: next });
            refetch();
          }}
        />
      );
    },
  };
}

/**
 * @deprecated Stint 43.D11 — superseded by `partnerInChargeColumn`.
 * Kept temporarily so any external code referencing the old name keeps
 * compiling. Internal call sites all migrated; safe to remove next stint.
 */
export const preparedWithColumn = partnerInChargeColumn;

/**
 * Stint 43.D6 — "Last action" date column (renamed from "Last chased").
 *
 * Diego: "Last Chase no me pega como nombre, porque tiene que ser en
 * plan de cuándo ha sido la última vez que se ha tomado una acción.
 * Si es cuándo le pedí información, cuando le pedí información. Si es
 * file, pues que cuando la he depositado."
 *
 * Backed by `tax_filings.last_action_at`. Auto-stamped server-side
 * on every PATCH that touches a meaningful field (status, comments,
 * contacts, prepared_with, dates…). Diego can override manually
 * via the inline date editor.
 *
 * Display: most recent date across the row's filings — "what's the
 * most recent thing that happened to this entity-year".
 */
export function lastActionColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'last_action',
    label: 'Last action',
    widthClass: 'w-[130px]',
    render: (e) => {
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      const dates = periodLabels
        .map(l => e.cells[l]?.last_action_at)
        .filter((x): x is string => !!x);
      const latest = dates.length === 0 ? null : dates.sort().slice(-1)[0]!;
      return (
        <InlineDateCell
          value={latest}
          disabled={allFilingIds.length === 0}
          mode="neutral"
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { last_action_at: next });
            refetch();
          }}
        />
      );
    },
  };
}

/**
 * Stint 43.D4 — Form column for CIT (and other tax types where it
 * makes sense). Per-obligation field: per-entity stable, only
 * changes when the entity goes through a société conversion.
 *
 * Diego's spec: "para algunas declaraciones hago el formulario 500,
 * para otras el 205 y muy a veces el 200." Three valid codes; null
 * = unset.
 *
 * Click the chip → small dropdown overlays with the 3 options.
 * Save patches the obligation in place (not the filing).
 */
export const CIT_FORM_OPTIONS = [
  { code: '500', label: '500', description: 'Standard CIT return (default for most companies)' },
  { code: '205', label: '205', description: 'Abbreviated return for small entities' },
  { code: '200', label: '200', description: 'Special-case form (rare)' },
];

export function formColumn({ refetch, toast }: {
  refetch: () => void;
  toast?: { success: (m: string) => void; error: (m: string) => void };
}): MatrixColumn {
  return {
    key: 'form',
    label: 'Form',
    widthClass: 'w-[80px]',
    render: (e) => (
      <FormInlineCell
        obligationId={e.obligation_id}
        currentForm={e.form_code ?? null}
        disabled={!e.obligation_id}
        onChange={async (next) => {
          if (!e.obligation_id) return;
          const res = await fetch(`/api/tax-ops/obligations/${e.obligation_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ form_code: next }),
          });
          if (!res.ok) {
            const b = await res.json().catch(() => ({}));
            toast?.error(`Form update failed: ${b?.error ?? res.status}`);
            return;
          }
          toast?.success(`${e.legal_name} → Form ${next ?? '(none)'}`);
          refetch();
        }}
      />
    ),
  };
}

function FormInlineCell({
  obligationId, currentForm, onChange, disabled,
}: {
  obligationId: string | null;
  currentForm: string | null;
  onChange: (next: string | null) => Promise<void>;
  disabled?: boolean;
}) {
  const label = currentForm ?? '—';
  const tone = currentForm
    ? 'bg-surface-alt text-ink font-mono'
    : 'text-ink-muted italic';

  function handleChange(raw: string) {
    const next = raw === '__none__' ? null : raw;
    if (next === currentForm) return;
    void onChange(next);
  }

  return (
    <span className="relative inline-block">
      <span
        className={[
          'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] pointer-events-none',
          tone,
        ].join(' ')}
        title={
          disabled
            ? 'No obligation on this entity'
            : currentForm
              ? `Form ${currentForm} — click to change`
              : 'Click to set the CIT form (500 / 205 / 200)'
        }
      >
        {label}
      </span>
      {!disabled && (
        <select
          value={currentForm ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Change tax form"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          <option value="__none__">— (clear)</option>
          {CIT_FORM_OPTIONS.map(o => (
            <option key={o.code} value={o.code}>{o.label}</option>
          ))}
        </select>
      )}
      <span aria-hidden className="hidden" data-obligation-id={obligationId ?? ''} />
    </span>
  );
}

/**
 * Stint 41 — Cadence switcher column (WHT-family only).
 *
 * Diego's feedback: "algunas empresas lo hacen quarterly, otras
 * mensualmente, otras semestralmente, otras cada dos meses, cada
 * tres, según le dé a la gana". Shows each entity's current WHT
 * cadence as a chip; click opens a dropdown with the 5 supported
 * cadences (Monthly / Quarterly / Semester / Annual / Ad-hoc);
 * changing dispatches a confirm + POST to the change-cadence
 * endpoint + refetch.
 *
 * Declared at the Family family: obligations only move within
 * wht_director_*. The endpoint refuses cross-family moves.
 */
export const WHT_CADENCE_OPTIONS: Array<{
  tax_type: string; period_pattern: string; label: string;
}> = [
  { tax_type: 'wht_director_monthly',   period_pattern: 'monthly',   label: 'Monthly' },
  { tax_type: 'wht_director_quarterly', period_pattern: 'quarterly', label: 'Quarterly' },
  { tax_type: 'wht_director_semester',  period_pattern: 'semester',  label: 'Semester' },
  { tax_type: 'wht_director_annual',    period_pattern: 'annual',    label: 'Annual' },
  { tax_type: 'wht_director_adhoc',     period_pattern: 'adhoc',     label: 'Ad-hoc' },
];

export function cadenceColumn({
  currentTaxType,
  refetch,
  toast,
}: {
  currentTaxType: string;
  refetch: () => void;
  toast?: {
    success: (m: string) => void;
    error: (m: string) => void;
  };
}): MatrixColumn {
  return {
    key: 'cadence',
    label: 'Cadence',
    widthClass: 'w-[110px]',
    render: (e) => (
      <CadenceInlineCell
        obligationId={e.obligation_id}
        currentTaxType={currentTaxType}
        disabled={!e.obligation_id}
        onChange={async (next) => {
          if (!e.obligation_id) return;
          const res = await fetch(
            `/api/tax-ops/obligations/${e.obligation_id}/change-cadence`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                new_tax_type: next.tax_type,
                new_period_pattern: next.period_pattern,
              }),
            },
          );
          if (!res.ok) {
            const b = await res.json().catch(() => ({}));
            toast?.error(`Cadence change failed: ${b?.error ?? res.status}`);
            return;
          }
          toast?.success(`${e.legal_name} → ${next.label}`);
          refetch();
        }}
      />
    ),
  };
}

function CadenceInlineCell({
  obligationId, currentTaxType, onChange, disabled,
}: {
  obligationId: string | null;
  currentTaxType: string;
  onChange: (next: typeof WHT_CADENCE_OPTIONS[number]) => Promise<void>;
  disabled?: boolean;
}) {
  const current = WHT_CADENCE_OPTIONS.find(o => o.tax_type === currentTaxType);
  const label = current?.label ?? currentTaxType;

  function handleChange(taxType: string) {
    const next = WHT_CADENCE_OPTIONS.find(o => o.tax_type === taxType);
    if (!next || !current) return;
    if (next.tax_type === current.tax_type) return;
    const ok = window.confirm(
      `Change cadence from ${current.label} to ${next.label}?\n\n` +
      'Existing filings remain in the audit log but will no longer ' +
      'appear in matrices (their old period labels won\'t match the ' +
      'new cadence). Future filings will use the new cadence.',
    );
    if (!ok) return;
    void onChange(next);
  }

  // Compact chip + hidden native select overlay for 1-click editing.
  return (
    <span className="relative inline-block">
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-surface-alt text-ink-soft pointer-events-none"
        title={disabled ? 'No obligation on this entity' : 'Click to change cadence'}
      >
        {label}
      </span>
      {!disabled && (
        <select
          value={currentTaxType}
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Change cadence"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {WHT_CADENCE_OPTIONS.map(o => (
            <option key={o.tax_type} value={o.tax_type}>{o.label}</option>
          ))}
        </select>
      )}
      {/* keep obligationId referenced for linters */}
      <span aria-hidden className="hidden" data-obligation-id={obligationId ?? ''} />
    </span>
  );
}

/**
 * Stint 40.G — Contacts row-level column.
 *
 * Diego's feedback: "estaría bien añadir en corporate tax return y
 * también en el apartado de IVA poder añadir uno o varios contactos
 * porque normalmente hay que pedir la declaración a una determinada
 * persona de un proveedor de servicios o al cliente. Entonces estaría
 * bien poder tener a mano los contactos."
 *
 * Stored per-filing in `tax_filings.csp_contacts` (JSONB). Same
 * row-level pattern: display shows chip(s) from the first filed
 * cell; save propagates to every filing in the row via patchAllFilings.
 */
export function contactsColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'csp_contacts',
    label: 'Contacts',
    widthClass: 'w-[220px]',
    render: (e) => {
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      const first = periodLabels
        .map(l => e.cells[l])
        .find((c): c is MatrixCell => !!c) ?? null;
      return (
        <ContactsInlineEditor
          value={first?.csp_contacts ?? []}
          disabled={allFilingIds.length === 0}
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { csp_contacts: next });
            refetch();
          }}
        />
      );
    },
  };
}

function ContactsInlineEditor({
  value, onSave, disabled,
}: {
  value: CspContact[];
  onSave: (next: CspContact[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CspContact[]>(value);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(draft);
      setOpen(false);
    } catch {
      /* error surfaces via the underlying PATCH's failure toast */
    } finally {
      setBusy(false);
    }
  }

  // Everything lives inside a relative wrapper so the absolute
  // popover anchors to this cell (and doesn't leak to the viewport).
  return (
    <span className="relative inline-block max-w-full">
      {value.length === 0 ? (
        <button
          type="button"
          onClick={() => { setDraft(value); setOpen(true); }}
          disabled={disabled}
          className="text-[11px] text-ink-muted hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed italic"
          title={disabled ? 'Set a status first (creates the filing)' : 'Click to add contacts'}
        >
          + Add contact
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(value); setOpen(true); }}
          className="inline-flex items-center gap-1 flex-wrap max-w-full hover:bg-brand-50/50 rounded px-0.5"
          title={value.map(c => `${c.name}${c.email ? ` (${c.email})` : ''}${c.role ? ` · ${c.role}` : ''}`).join('\n')}
        >
          {value.slice(0, 2).map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-brand-50 text-brand-700 truncate max-w-[100px]"
            >
              {c.name || '—'}
            </span>
          ))}
          {value.length > 2 && (
            <span className="text-[10.5px] text-ink-muted">+{value.length - 2}</span>
          )}
        </button>
      )}

      {open && (
        <div
          className="absolute top-full left-0 z-50 bg-surface border border-border rounded-md shadow-lg p-2 w-[320px] mt-1"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }}
        >
          <div className="text-[11px] text-ink-muted mb-1.5">Contacts for this row</div>
          <CspContactsEditor
            value={draft}
            onChange={setDraft}
            fallbackLabel="No contacts yet — add one"
          />
          <div className="flex justify-end gap-1 mt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 py-0.5 text-[11px] rounded border border-border hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="px-2 py-0.5 text-[11px] rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Stint 40.O — Invoice price row-level column.
 *
 * Diego's workflow: when he hands an entity's work to the office CFO
 * for billing, he quotes a fixed fee (often €3,000) plus a small
 * note (+5% office expenses +VAT if applicable). Keeping that price
 * inline on the matrix saves a context switch. Stored per-filing so
 * the same obligation can price Q1 ≠ Q2 if needed; save propagates
 * across all row filings by default (same pattern as preparedWith).
 */
export function priceColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'invoice_price',
    label: 'Price',
    widthClass: 'w-[140px]',
    alignRight: true,
    render: (e) => {
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      // Display picks the first filed cell's values (or null when none).
      const first = periodLabels
        .map(l => e.cells[l])
        .find((c): c is MatrixCell => !!c) ?? null;
      return (
        <InlinePriceCell
          priceEur={first?.invoice_price_eur ?? null}
          note={first?.invoice_price_note ?? null}
          disabled={allFilingIds.length === 0}
          onSave={async ({ priceEur, note }) => {
            await patchAllFilings(allFilingIds, {
              invoice_price_eur: priceEur,
              invoice_price_note: note,
            });
            refetch();
          }}
        />
      );
    },
  };
}

export function commentsColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'comments',
    label: 'Comments',
    render: (e) => {
      const cell = firstFiledCell(e, periodLabels);
      return (
        <InlineTextCell
          value={cell?.comments ?? null}
          disabled={!cell}
          placeholder="Add note…"
          multiline
          onSave={async (next) => {
            if (!cell?.filing_id) return;
            await patchFiling(cell.filing_id, { comments: next });
            refetch();
          }}
        />
      );
    },
  };
}

/**
 * Family column — first position, always visible. When `groups` + `refetch`
 * provided, click-to-edit dropdown lets Diego reassign the entity to a
 * different family or create a new one inline. When omitted, pure display.
 */
export function familyColumn(
  options?: {
    groups: Array<{ id: string; name: string }>;
    refetch: () => void;
    onGroupsChanged: () => void;
  },
): MatrixColumn {
  const editable = !!options;
  return {
    key: 'family',
    label: 'Family',
    widthClass: 'w-[170px]',
    render: (e) => {
      // Display mode: colored chip — Diego wants visual differentiation
      // between families at a glance. Click-to-edit when options passed.
      if (!editable) {
        if (!e.group_name) return <span className="text-ink-faint italic text-[11px]">—</span>;
        return (
          <span
            className={[
              'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium truncate max-w-[150px]',
              familyChipClasses(e.group_name),
            ].join(' ')}
            title={e.group_name}
          >
            {e.group_name}
          </span>
        );
      }
      return (
        <FamilyInlineSelect
          entity={e}
          groups={options.groups}
          onChangedFamily={options.refetch}
          onGroupsChanged={options.onGroupsChanged}
        />
      );
    },
  };
}

function FamilyInlineSelect({
  entity, groups, onChangedFamily, onGroupsChanged,
}: {
  entity: MatrixEntity;
  groups: Array<{ id: string; name: string }>;
  onChangedFamily: () => void;
  onGroupsChanged: () => void;
}) {
  // Stint 43.D8 — replaced native <select>+chip overlay with SearchableSelect.
  // The chip styling moves onto the SearchableSelect trigger so families stay
  // colour-coded; the popup gets a search input for free.
  const options = useMemo<SearchableOption[]>(() => [
    { value: '', label: '— (no family)' },
    ...groups.map(g => ({
      value: g.id,
      label: g.name,
      className: familyChipClasses(g.name),
    })),
    { value: '__create__', label: '+ Create new family…' },
  ], [groups]);

  async function handleChange(raw: string): Promise<void> {
    if (raw === '__create__') {
      const name = window.prompt('New family name:');
      if (!name?.trim()) return;
      const created = await fetch('/api/tax-ops/client-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!created.ok) {
        const b = await created.json().catch(() => ({}));
        alert(`Create failed: ${b?.error ?? created.status}`);
        return;
      }
      const { id: newGroupId } = await created.json() as { id: string };
      const patched = await fetch(`/api/tax-ops/entities/${entity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_group_id: newGroupId }),
      });
      if (!patched.ok) {
        alert(`Assign failed: HTTP ${patched.status}`);
        return;
      }
      onGroupsChanged();
      onChangedFamily();
      return;
    }
    const nextGroupId = raw === '' ? null : raw;
    const res = await fetch(`/api/tax-ops/entities/${entity.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_group_id: nextGroupId }),
    });
    if (!res.ok) {
      alert(`Save failed: HTTP ${res.status}`);
      return;
    }
    onChangedFamily();
  }

  // Trigger button styled as the family chip — keeps Diego's at-a-glance
  // colour differentiation while gaining a searchable popup on click.
  const chip = entity.group_name
    ? familyChipClasses(entity.group_name)
    : 'bg-surface-alt text-ink-muted';
  return (
    <SearchableSelect
      options={options}
      value={entity.group_id ?? ''}
      onChange={(v) => void handleChange(v)}
      ariaLabel="Change family"
      triggerClassName={[
        'border-transparent text-[11px] font-medium px-1.5 py-0.5 min-w-[120px] max-w-[170px]',
        chip,
      ].join(' ')}
    />
  );
}

export function deadlineColumn(periodLabel: string, toleranceDays = 0): MatrixColumn {
  // Pure display — deadline is auto-computed from the rule; editing
  // happens in the filing detail page. Admin tolerance (stint 37.C) makes
  // deadlines past statutory but within tolerance amber instead of red.
  return {
    key: 'deadline',
    label: 'Deadline',
    widthClass: 'w-[180px]',
    render: (e) => {
      const cell = e.cells[periodLabel];
      return (
        <DeadlineWithTolerance
          value={cell?.deadline_date ?? null}
          toleranceDays={toleranceDays}
          label="Deadline"
        />
      );
    },
  };
}
