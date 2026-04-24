'use client';

// Shared column factories used by every tax-type category page so that
// prepared_with / comments / deadline get the same inline-edit behaviour
// everywhere. Keeps per-page code tight + avoids drift when we tweak
// UX later.

import { useState } from 'react';
import type { MatrixColumn, MatrixEntity, MatrixCell } from './TaxTypeMatrix';
import { InlineTagsCell, InlineTextCell, InlineDateCell, InlinePriceCell } from './inline-editors';
import { DeadlineWithTolerance } from './DeadlineWithTolerance';
import { familyChipClasses } from './familyColors';
import { CspContactsEditor, type CspContact } from './CspContactsEditor';

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

export function preparedWithColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'prepared_with',
    label: 'Prepared with',
    widthClass: 'w-[160px]',
    render: (e) => {
      const anyCell = firstFiledCell(e, periodLabels);
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      const value = anyCell?.prepared_with ?? [];
      return (
        <InlineTagsCell
          value={value}
          disabled={allFilingIds.length === 0}
          placeholder=""
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { prepared_with: next });
            refetch();
          }}
        />
      );
    },
  };
}

/**
 * Stint 39.F — "Last chased" date column.
 *
 * Diego's workflow: when an entity is in info_to_request or
 * awaiting_client_clarification state, he chases the client or the CSP
 * by email and needs to know at a glance when he last did so (so he
 * doesn't double-chase on day 1 or forget for 3 weeks).
 *
 * Stored per-filing; the row-level column writes the same date to every
 * filing in the row (mirroring preparedWithColumn's pattern) since
 * chasing usually covers "anything pending for this entity-year", not
 * a specific period. Display shows the most-recent date across the row.
 */
export function lastChasedColumn(periodLabels: string[], refetch: () => void): MatrixColumn {
  return {
    key: 'last_chased',
    label: 'Last chased',
    widthClass: 'w-[130px]',
    render: (e) => {
      const allFilingIds = periodLabels
        .map(l => e.cells[l]?.filing_id)
        .filter((x): x is string => !!x);
      // Show the max date across all filings in the row — "most recently
      // chased" is more informative than "chase date of Q1 specifically".
      const dates = periodLabels
        .map(l => e.cells[l]?.last_info_request_sent_at)
        .filter((x): x is string => !!x);
      const latest = dates.length === 0 ? null : dates.sort().slice(-1)[0]!;
      return (
        <InlineDateCell
          value={latest}
          disabled={allFilingIds.length === 0}
          mode="neutral"
          onSave={async (next) => {
            await patchAllFilings(allFilingIds, { last_info_request_sent_at: next });
            refetch();
          }}
        />
      );
    },
  };
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
      // Assign the entity to the new family
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
    // Existing group id (or empty → unassign)
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

  // Color-coded display + native select stacked transparent above it.
  // Diego wants the color differentiation; native <select> keeps the
  // inline-editability without a custom dropdown library.
  const chip = familyChipClasses(entity.group_name);
  const label = entity.group_name ?? '— (no family)';
  return (
    <div className="relative inline-block w-full">
      <span
        className={[
          'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium truncate max-w-[150px] pointer-events-none',
          entity.group_name ? chip : 'bg-surface-alt text-ink-muted',
        ].join(' ')}
        title={label}
      >
        {label}
      </span>
      <select
        value={entity.group_id ?? ''}
        onChange={(e) => void handleChange(e.target.value)}
        aria-label="Change family"
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
      >
        <option value="">— (no family)</option>
        {groups.map(g => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
        <option value="__create__">+ Create new family…</option>
      </select>
    </div>
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
