'use client';

// ════════════════════════════════════════════════════════════════════════
// InlineCompanyCell — stint 64.T
//
// Inline cell editor for the "Company / firm" column on the contacts
// list. Diego: "no se puede editar la compañía de firma para la que
// trabaja esa persona... Fernando me sale una raya y no lo puedo
// editar." Right call — every other cell in that table is inline-
// editable except this one.
//
// Display:
//   - With current firm    → link to /crm/companies/{id} + small ✎ on hover
//   - Without current firm → muted "+ Set firm" affordance
//
// Edit:
//   - Searchable dropdown of all companies (loaded on demand)
//   - "+ Create new company" inline (same UX as the contact-create form)
//   - Save → POST /api/crm/contacts/{contactId}/companies with the
//     selected company_id. The endpoint preserves employment history:
//     it closes the current junction (ended_at = today-1d) and opens a
//     new one, so switching firms keeps the timeline.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { SearchableSelect, type SearchableOption } from '@/components/ui/SearchableSelect';
import { useToast } from '@/components/Toaster';

interface Props {
  contactId: string;
  /** Current primary company id (null = no current firm). */
  currentCompanyId: string | null;
  currentCompanyName: string | null;
  /** Called after a successful save so the parent can refetch the list. */
  onChanged: () => void;
}

export function InlineCompanyCell({
  contactId, currentCompanyId, currentCompanyName, onChanged,
}: Props) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    // Stint 64.U.1 — Diego: "cuando clico la empresa, no me lleva a
    // la página de la empresa". Right call. Inverted the UX so click
    // on the name navigates (Link), and a small ✎ icon next to it
    // opens the editor. Matches HubSpot / Linear / Salesforce.
    if (currentCompanyId && currentCompanyName) {
      return (
        <span className="inline-flex items-center gap-1 max-w-full group">
          <Link
            href={`/crm/companies/${currentCompanyId}`}
            className="text-ink truncate hover:text-brand-700 hover:underline"
            title={`Open ${currentCompanyName}`}
          >
            {currentCompanyName}
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-ink-muted hover:text-brand-700 transition-opacity"
            title="Switch firm (history preserved)"
            aria-label="Switch firm"
          >
            <PencilIcon size={11} />
          </button>
        </span>
      );
    }
    // No current firm — clicking the placeholder enters edit mode
    // directly (there's nothing to navigate to).
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-ink-faint italic hover:text-ink-muted hover:not-italic"
        title="Set the contact's firm"
      >
        + Set firm
      </button>
    );
  }

  return (
    <CompanyEditor
      contactId={contactId}
      currentCompanyId={currentCompanyId}
      onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); onChanged(); }}
    />
  );
}

// Helper — shown next to the inline cell so Diego can jump straight
// to the company detail without entering edit mode by mistake. Used
// by the contacts list page.
export function CompanyLink({
  companyId, companyName,
}: { companyId: string | null; companyName: string | null }) {
  if (!companyId || !companyName) return null;
  return (
    <Link
      href={`/crm/companies/${companyId}`}
      className="text-2xs text-ink-muted hover:text-brand-700 hover:underline shrink-0"
      title={`Open ${companyName} detail`}
      onClick={(e) => e.stopPropagation()}
    >
      ↗
    </Link>
  );
}

// ─────────────────────────── Edit popover ─────────────────────────────

function CompanyEditor({
  contactId, currentCompanyId, onClose, onSaved,
}: {
  contactId: string;
  currentCompanyId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<SearchableOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(currentCompanyId);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function loadCompanies() {
    setLoading(true);
    try {
      const res = await fetch('/api/crm/companies?limit=500', { cache: 'no-store' });
      const rows: Array<{ id: string; company_name: string }> = res.ok ? await res.json() : [];
      setOptions(rows.map(r => ({ value: r.id, label: r.company_name ?? r.id })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadCompanies(); }, []);

  async function save() {
    if (!picked || picked === currentCompanyId) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: picked,
          role: 'main_poc',
          is_primary: true,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(currentCompanyId ? 'Firm switched' : 'Firm set');
      onSaved();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const trimmed = newName.trim();
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
      const body = await res.json() as { id: string; company_name: string };
      // Append to options + select. Avoid full refetch (saves a roundtrip).
      setOptions(prev => [...prev, { value: body.id, label: body.company_name }]);
      setPicked(body.id);
      setCreateOpen(false);
      setNewName('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1 min-w-[220px]">
      <div className="flex items-center gap-1">
        <div className="flex-1 [&>div]:block [&>div]:w-full">
          <SearchableSelect
            bare
            options={options}
            value={picked}
            onChange={setPicked}
            placeholder={loading ? 'Loading…' : 'Search firms…'}
            ariaLabel="Pick firm"
            disabled={loading || busy}
            triggerClassName="w-full h-7 px-2 text-xs bg-white border border-border rounded-md hover:bg-surface-alt/50"
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || loading || !picked}
          className="h-7 px-2 text-2xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          title="Save"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-7 px-1 text-2xs text-ink-muted hover:text-ink"
          title="Cancel"
        >
          ✕
        </button>
      </div>
      {!createOpen ? (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={busy}
          className="text-2xs text-brand-700 hover:underline self-start"
        >
          + Create new firm
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void createNew(); }
              else if (e.key === 'Escape') { setCreateOpen(false); setNewName(''); }
            }}
            disabled={busy}
            placeholder="New firm name"
            className="flex-1 h-6 px-1.5 text-2xs border border-border rounded bg-white"
          />
          <button
            type="button"
            onClick={createNew}
            disabled={busy || !newName.trim()}
            className="h-6 px-1.5 text-2xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? '…' : 'Add'}
          </button>
        </div>
      )}
      {error && <p className="text-2xs text-danger-700">{error}</p>}
      {currentCompanyId && (
        <p className="text-2xs text-ink-faint">
          Switching firm closes current employment + opens a new one. History preserved.
        </p>
      )}
    </div>
  );
}
