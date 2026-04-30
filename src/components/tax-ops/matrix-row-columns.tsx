'use client';

// Shared column factories used by every tax-type category page so that
// prepared_with / comments / deadline get the same inline-edit behaviour
// everywhere. Keeps per-page code tight + avoids drift when we tweak
// UX later.

import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { MatrixColumn, MatrixEntity, MatrixCell } from './TaxTypeMatrix';
import { InlineTagsCell, InlineTextCell, InlineDateCell, InlinePriceCell } from './inline-editors';
import { DeadlineWithTolerance } from './DeadlineWithTolerance';
import { familyChipClasses } from './familyColors';
import { useFamilyChipClasses } from './FamilyColorContext';
import {
  CspContactsEditor, CONTACT_KIND_LABEL, CONTACT_KIND_TONE,
  type CspContact,
} from './CspContactsEditor';
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
          'inline-flex items-center px-1.5 py-0.5 rounded text-xs pointer-events-none',
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
        className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-surface-alt text-ink-soft pointer-events-none"
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
 * Stint 48.U3.A — refactored to write at the ENTITY level instead of
 * per-filing. Diego's report: contacts added in /vat/quarterly didn't
 * show up on /tax-ops/entities/[id] because the matrix was patching
 * `tax_filings.csp_contacts` while the entity page reads
 * `entities.csp_contacts`. Now both surfaces talk to the same field.
 *
 * Per-filing override is still supported (FilingEditDrawer still has
 * `csp_contacts` in its allowed-fields list), for the rare case where
 * Diego needs different contacts for one specific filing.
 */
export function contactsColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'csp_contacts',
    label: 'Contacts',
    widthClass: 'w-[220px]',
    render: (e) => {
      const value = e.csp_contacts ?? [];
      return (
        <ContactsInlineEditor
          value={value}
          // Entity-level edit always available (no filing required).
          // The legacy filing-level override is now reachable only via
          // the FilingEditDrawer pencil ✎ when Diego truly needs it.
          disabled={false}
          onSave={async (next) => {
            const res = await fetch(`/api/tax-ops/entities/${e.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ csp_contacts: next }),
            });
            if (!res.ok) throw new Error(`Save failed (${res.status})`);
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

  // Stint 54 — portal the popover to <body> with position: fixed so it
  // never gets clipped or visually trapped underneath the matrix's
  // sticky cells / sticky header / next row. Mirrors the pattern that
  // SearchableSelect uses since stint 49.B2. Solves the "transparenta
  // lo de add contact al scroll down" bug.
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const recompute = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, left: r.left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => recompute();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  // Click-outside dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      // Allow clicks inside the popover (which lives outside the
      // trigger via portal). Tag it via data-popover-id matching.
      const popover = document.querySelector('[data-contacts-popover="open"]');
      if (popover && popover.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

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

  return (
    <span ref={triggerRef} className="inline-block max-w-full">
      {value.length === 0 ? (
        <button
          type="button"
          onClick={() => { setDraft(value); setOpen(true); }}
          disabled={disabled}
          // Stint 64.X.8 — `whitespace-nowrap` so the placeholder doesn't
          // truncate as "+ Add conta" inside narrow Contacts columns.
          className="text-xs text-ink-muted hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed italic whitespace-nowrap"
          title={disabled ? 'Set a status first (creates the filing)' : 'Click to add contacts'}
        >
          + Add contact
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(value); setOpen(true); }}
          className="inline-flex items-center gap-1 flex-wrap max-w-full hover:bg-brand-50/50 rounded px-0.5"
          title={value.map(c => {
            const k = c.kind ?? 'csp';
            const label = CONTACT_KIND_LABEL[k] ?? k;
            return `${c.name} [${label}]${c.email ? ` (${c.email})` : ''}${c.role ? ` · ${c.role}` : ''}`;
          }).join('\n')}
        >
          {value.slice(0, 2).map((c, i) => {
            // Stint 64.X.6 — kind drives the chip tone so Diego can tell
            // at a glance whether a row is talking to a Client / CSP /
            // Peer without opening the popover.
            const kind = (c.kind ?? 'csp') as keyof typeof CONTACT_KIND_TONE;
            const tone = CONTACT_KIND_TONE[kind] ?? CONTACT_KIND_TONE.csp;
            return (
              <span
                key={i}
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs truncate max-w-[100px] ${tone}`}
              >
                {c.name || '—'}
              </span>
            );
          })}
          {value.length > 2 && (
            <span className="text-2xs text-ink-muted">+{value.length - 2}</span>
          )}
        </button>
      )}

      {mounted && open && pos && createPortal(
        <div
          data-contacts-popover="open"
          className="z-modal bg-surface border border-border rounded-md shadow-lg p-2 w-[320px]"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }}
        >
          <div className="text-xs text-ink-muted mb-1.5">Contacts for this row</div>
          <CspContactsEditor
            value={draft}
            onChange={setDraft}
            fallbackLabel="No contacts yet — add one"
          />
          <div className="flex justify-end gap-1 mt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>,
        document.body,
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
    // Stint 52 — was "Price". Renamed to "Price Per Return" so it can
    // sit next to the new issPriceColumn ("Price Per ISS") on VAT
    // matrices without ambiguity. The DB column + key stay the same.
    label: 'Price Per Return',
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

/**
 * Stint 52 — companion column to priceColumn, surfaced only on VAT
 * matrices. ISS = Intra-community Supply of Services (Liste
 * récapitulative / EC Sales List). cifra charges this as a separate
 * deliverable from the VAT return itself, so the prices are tracked
 * in parallel columns. Same per-filing storage + row-propagation
 * pattern as priceColumn — single edit syncs across Q1-Q4.
 */
export function issPriceColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'invoice_price_iss',
    label: 'Price Per ISS',
    widthClass: 'w-[140px]',
    alignRight: true,
    render: (e) => {
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      const first = periodLabels
        .map(l => e.cells[l])
        .find((c): c is MatrixCell => !!c) ?? null;
      return (
        <InlinePriceCell
          priceEur={first?.invoice_price_iss_eur ?? null}
          note={first?.invoice_price_iss_note ?? null}
          disabled={allFilingIds.length === 0}
          onSave={async ({ priceEur, note }) => {
            await patchAllFilings(allFilingIds, {
              invoice_price_iss_eur: priceEur,
              invoice_price_iss_note: note,
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
        if (!e.group_name) return <span className="text-ink-faint italic text-xs">—</span>;
        // Stint 51.C — use the render-context palette via hook so two
        // adjacent families never share a colour.
        return <FamilyChip name={e.group_name} />;
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

/** Chip rendered inside a TaxTypeMatrix — picks its colour from the
 *  per-render FamilyColorContext so adjacent families look distinct.
 *  Stint 51.C. */
function FamilyChip({ name }: { name: string }) {
  const cls = useFamilyChipClasses(name);
  return (
    <span
      className={[
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium truncate max-w-[150px]',
        cls,
      ].join(' ')}
      title={name}
    >
      {name}
    </span>
  );
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

  // Stint 48.B3 — `bare` mode on SearchableSelect drops its default
  // border/bg/min-width so the family chip's bg-{tone}-100 actually
  // renders. Without bare, the SearchableSelect's `bg-surface` was
  // winning over the chip color.
  // Stint 51.C — use the render-context palette so the trigger chip
  // matches the row chip when collision-rotation kicks in.
  const contextChip = useFamilyChipClasses(entity.group_name);
  const chip = entity.group_name ? contextChip : 'bg-surface-alt text-ink-muted';
  return (
    <SearchableSelect
      options={options}
      value={entity.group_id ?? ''}
      onChange={(v) => void handleChange(v)}
      ariaLabel="Change family"
      bare
      triggerClassName={[
        'text-xs font-medium px-1.5 py-0.5 max-w-[170px] truncate',
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

/**
 * Stint 53 — variant of deadlineColumn for matrices with multiple
 * periods per row (quarterly / monthly). Shows the deadline of the
 * NEXT pending cell — i.e. the earliest period whose status is not
 * yet 'filed' / 'paid' / 'waived'. If every cell is closed, falls
 * back to the last period's deadline (so the column never goes blank
 * for fully-closed entities). Headed "Next deadline" so Diego knows
 * it's a forward-looking view, not a fixed date.
 */
export function nextDeadlineColumn(periodLabels: string[], toleranceDays = 0): MatrixColumn {
  const CLOSED_STATUSES = new Set(['filed', 'paid', 'waived']);
  return {
    key: 'next_deadline',
    label: 'Next deadline',
    widthClass: 'w-[180px]',
    render: (e) => {
      const ordered = periodLabels
        .map(l => ({ label: l, cell: e.cells[l] ?? null }))
        .filter(x => x.cell?.deadline_date);
      const open = ordered.find(x => x.cell && !CLOSED_STATUSES.has(x.cell.status));
      const target = open ?? ordered[ordered.length - 1] ?? null;
      return (
        <DeadlineWithTolerance
          value={target?.cell?.deadline_date ?? null}
          toleranceDays={toleranceDays}
          label="Next deadline"
        />
      );
    },
  };
}

/**
 * Stint 59.A — display-only "Filed at" column. Walks periods newest →
 * oldest and surfaces the filed_at of the most recently-filed period.
 *
 * Big4 audit-trail practice: filed_at is the date the return was actually
 * deposited with AED, distinct from last_action_at (last touch in cifra).
 * The PATCH endpoint defaults filed_at to today when status flips to
 * 'filed' (idempotent), so this column mostly self-populates; Diego only
 * has to override from the FilingEditDrawer when the deposit day differs
 * from the day he updated cifra.
 *
 * Read-only on the matrix on purpose: with quarterly/monthly tax types
 * there are 3-12 cells per row, so an inline edit would have to choose
 * which cell to write — that's a footgun. Edits go through the per-cell
 * drawer (pencil ✎) which is unambiguous.
 */
export function lastFiledAtColumn(periodLabels: string[]): MatrixColumn {
  return {
    key: 'filed_at',
    label: 'Filed at',
    widthClass: 'w-[100px]',
    render: (e) => {
      // Walk newest → oldest; return first non-null filed_at.
      for (let i = periodLabels.length - 1; i >= 0; i--) {
        const cell = e.cells[periodLabels[i]];
        if (cell?.filed_at) {
          return (
            <span
              className="text-xs text-ink-soft tabular-nums whitespace-nowrap"
              title={`${periodLabels[i]} · filed ${cell.filed_at}`}
            >
              {cell.filed_at.slice(5)}
            </span>
          );
        }
      }
      return <span className="text-ink-faint italic text-xs">—</span>;
    },
  };
}
