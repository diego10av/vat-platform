'use client';

// ════════════════════════════════════════════════════════════════════════
// InlineEntitySelect — click-to-edit cell for picking another CRM entity
// (company / contact / matter) directly from a list row.
//
// Why this exists: the +Edit modal already lets the user pick via
// CrmFormModal's `entity-select` type, but on a list table that's
// 2 clicks (open modal → save) when you just want to reassign one row.
// Diego (stint 91): the Opportunities Company column was a read-only
// link with a comment "not editable inline — heavy action"; he wants
// to change a deal's company / primary contact without opening the
// detail page.
//
// Rhythm:
//   - At rest: show the entity name as a button-styled chip.
//   - Click: load options async (one-shot, cached for the editor's
//     lifetime), open SearchableSelect.
//   - Pick: setValue → setTimeout(commit, 0) so React's async batching
//     doesn't lose the new id.
//   - ESC / click-outside: cancel (no-save).
//
// This file lives under crm/ because it hard-codes the CRM API
// endpoints. Reusable inline patterns for tax-ops stay in
// tax-ops/inline-editors.tsx.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { InlineCellEditor } from '@/components/tax-ops/InlineCellEditor';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';

type EntitySource = 'company' | 'contact' | 'matter';

interface CompanyRow { id: string; company_name: string }
interface ContactRow { id: string; full_name: string | null; company_name: string | null }
interface MatterRow  { id: string; matter_reference: string | null; title: string | null }

// Hook is duplicated (intentionally) from CrmFormModal.tsx — the modal
// hook hydrates once per modal open, this one hydrates once per cell
// edit. Keep the two in sync if endpoints change.
function useCrmEntityOptions(source: EntitySource, enabled: boolean): {
  options: SearchableOption[];
  loading: boolean;
} {
  const [options, setOptions] = useState<SearchableOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
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
            label: [r.full_name, r.company_name].filter(Boolean).join(' · ') || r.id,
          }));
        }
        setOptions(opts);
      })
      .catch(() => { if (alive) setOptions([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, enabled]);

  return { options, loading };
}

interface Props {
  /** Current entity id (null when unset). */
  value: string | null;
  /** Current entity display label (e.g. company_name). Rendered at rest. */
  displayLabel: string | null;
  /** Which collection to async-load when the cell enters edit mode. */
  source: EntitySource;
  /** Persist the new id (or null to clear). Throw on failure. */
  onSave: (next: string | null) => Promise<void>;
  /** Optional href: when present, the read-state renders the label as a
   *  link to the detail page (e.g. `/crm/companies/{id}`). Click bubbles
   *  to navigate; the small "edit" affordance opens the inline editor. */
  href?: string | null;
  /** Placeholder when value is null. Default "—". */
  placeholder?: string;
  /** Disable editing (e.g. row is closed). */
  disabled?: boolean;
}

export function InlineEntitySelect({
  value, displayLabel, source, onSave, href, placeholder = '—', disabled,
}: Props) {
  return (
    <InlineCellEditor<string | null>
      value={value}
      onSave={async next => { await onSave(next); }}
      disabled={disabled}
      inline
      ariaLabel={`Edit ${source}`}
      renderDisplay={(v) => {
        if (!v || !displayLabel) {
          return <span className="text-ink-faint italic">{placeholder}</span>;
        }
        if (href) {
          // Display as link so cmd-click / middle-click still navigates,
          // matching the previous read-only experience. Inline editor
          // wraps the whole node in a click target; we stop propagation
          // on the link so plain clicks navigate instead of entering edit
          // mode. To edit, click anywhere outside the link text (the
          // wrapping cell remains clickable around the link).
          return (
            <Link
              href={href}
              className="text-brand-700 hover:underline"
              onClick={(e) => { e.stopPropagation(); }}
            >
              {displayLabel}
            </Link>
          );
        }
        return <span className="text-ink">{displayLabel}</span>;
      }}
      renderEditor={({ value: editorValue, setValue, commit }) => (
        <InlineEditorPicker
          source={source}
          value={editorValue}
          onPick={(next) => {
            setValue(next);
            // Defer commit until after setValue settles, mirroring the
            // pattern used by InlineStatusCell — avoids React batching
            // committing a stale value.
            setTimeout(() => commit(next), 0);
          }}
        />
      )}
    />
  );
}

// Separate component so useCrmEntityOptions only fires while the picker
// is mounted (= while the cell is in edit mode).
function InlineEditorPicker({
  source, value, onPick,
}: {
  source: EntitySource;
  value: string | null;
  onPick: (next: string | null) => void;
}) {
  const { options, loading } = useCrmEntityOptions(source, true);
  // Add an explicit "— unset —" sentinel so the user can clear the link.
  const optionsWithUnset: SearchableOption[] = [
    { value: '__unset__', label: '— unset —' },
    ...options,
  ];
  return (
    <SearchableSelect
      options={optionsWithUnset}
      value={value}
      onChange={(next) => onPick(next === '__unset__' ? null : next)}
      ariaLabel={`Pick ${source}`}
      placeholder={loading ? 'Loading…' : `Pick a ${source}`}
      triggerClassName="min-w-[200px]"
    />
  );
}
