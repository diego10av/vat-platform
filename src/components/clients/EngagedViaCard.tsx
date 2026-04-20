'use client';

// ════════════════════════════════════════════════════════════════════════
// EngagedViaCard — shows / edits the intermediary (CSP) that engaged
// the firm for this end-client. Sits on /clients/[id] between the
// Profile and Contacts cards.
//
// Stint 14+: per Diego's 2026-04-20 screenshot review, the intermediary
// was being captured at creation but never surfaced afterwards. A
// dedicated editable card closes that loop.
//
// Business shape:
//   - Only relevant when client.kind = 'end_client'
//   - Four fields: company name, contact name, role, email
//   - "Empty state" renders as a slim "Add intermediary" affordance
//     so clients with no intermediary stay uncluttered
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { PencilIcon, CheckIcon, XIcon, Loader2Icon, PlusIcon, NetworkIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { describeApiError } from '@/lib/ui-errors';
import { useDraft } from '@/lib/use-draft';

export interface EngagedViaShape {
  engaged_via_name: string | null;
  engaged_via_contact_name: string | null;
  engaged_via_contact_email: string | null;
  engaged_via_contact_role: string | null;
  engaged_via_notes: string | null;
}

export function EngagedViaCard({
  clientId,
  clientKind,
  initial,
  onSaved,
}: {
  clientId: string;
  clientKind: 'end_client' | 'csp' | 'other';
  initial: EngagedViaShape;
  onSaved: (next: EngagedViaShape) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft, draftMeta] = useDraft<EngagedViaShape>(
    `engaged-via:${clientId}`,
    initial,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing && !draftMeta.hasDraft) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, editing, draftMeta.hasDraft]);

  // Only end-clients have intermediaries. A CSP record IS the
  // intermediary itself, so hiding this card prevents nonsense.
  if (clientKind !== 'end_client') return null;

  const hasData = !!initial.engaged_via_name;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engaged_via_name: draft.engaged_via_name?.trim() || null,
          engaged_via_contact_name: draft.engaged_via_contact_name?.trim() || null,
          engaged_via_contact_email: draft.engaged_via_contact_email?.trim() || null,
          engaged_via_contact_role: draft.engaged_via_contact_role?.trim() || null,
          engaged_via_notes: draft.engaged_via_notes?.trim() || null,
        }),
      });
      if (!res.ok) {
        const e = await describeApiError(res, 'Could not update the intermediary.');
        toast.error(e.message, e.hint);
        return;
      }
      toast.success('Intermediary updated.');
      onSaved(draft);
      setEditing(false);
      draftMeta.clear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  // Empty-state — minimal single-line affordance.
  if (!hasData && !editing) {
    return (
      <div id="engaged-via" className="bg-surface border border-dashed border-border rounded-lg px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-muted min-w-0">
          <NetworkIcon size={13} className="text-ink-faint shrink-0" />
          <span className="truncate">
            <strong className="text-ink-soft">No intermediary on record.</strong>{' '}
            Add one if you were engaged through a CSP / fiduciary rather than directly by the end-client.
          </span>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 h-7 px-2.5 rounded-md border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
        >
          <PlusIcon size={11} /> Add intermediary
        </button>
      </div>
    );
  }

  // Read-mode — populated.
  if (hasData && !editing) {
    return (
      <div id="engaged-via" className="bg-amber-50/30 border border-amber-200 rounded-lg px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wide font-semibold text-amber-800">
              <NetworkIcon size={11} /> Engaged via intermediary
            </div>
            <div className="mt-1.5 text-[14px] font-semibold text-ink">
              {initial.engaged_via_name}
            </div>
            {(initial.engaged_via_contact_name || initial.engaged_via_contact_role || initial.engaged_via_contact_email) && (
              <div className="mt-1 text-[12px] text-ink-soft">
                {initial.engaged_via_contact_name && <span className="font-medium">{initial.engaged_via_contact_name}</span>}
                {initial.engaged_via_contact_role && <span className="text-ink-muted"> · {initial.engaged_via_contact_role}</span>}
                {initial.engaged_via_contact_email && (
                  <>
                    {(initial.engaged_via_contact_name || initial.engaged_via_contact_role) && <span className="text-ink-faint"> · </span>}
                    <a href={`mailto:${initial.engaged_via_contact_email}`} className="text-brand-600 hover:underline">
                      {initial.engaged_via_contact_email}
                    </a>
                  </>
                )}
              </div>
            )}
            <div className="mt-1 text-[10.5px] text-ink-muted italic leading-relaxed">
              The end client ({initial.engaged_via_name ? 'above' : 'this one'}) is the legal record of truth;
              you talk to the intermediary in practice.
            </div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 h-7 px-2.5 rounded-md border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
          >
            <PencilIcon size={11} /> Edit
          </button>
        </div>
      </div>
    );
  }

  // Edit-mode.
  return (
    <div id="engaged-via" className="bg-amber-50/40 border border-amber-300 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[13px] font-semibold text-ink inline-flex items-center gap-2">
          <NetworkIcon size={14} className="text-amber-700" />
          {hasData ? 'Edit intermediary' : 'Add intermediary'}
        </h3>
        <button
          onClick={() => { setEditing(false); }}
          className="p-1 text-ink-muted hover:text-ink"
          aria-label="Cancel"
        >
          <XIcon size={13} />
        </button>
      </div>

      <div className="space-y-3">
        <Field label="Intermediary company" hint="The CSP / fiduciary that put you on the file">
          <input
            value={draft.engaged_via_name ?? ''}
            onChange={(e) => setDraft({ ...draft, engaged_via_name: e.target.value || null })}
            placeholder="Name of the intermediary company"
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your contact there" hint="person you actually email">
            <input
              value={draft.engaged_via_contact_name ?? ''}
              onChange={(e) => setDraft({ ...draft, engaged_via_contact_name: e.target.value || null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Role / title" hint="e.g. Accounting Manager">
            <input
              value={draft.engaged_via_contact_role ?? ''}
              onChange={(e) => setDraft({ ...draft, engaged_via_contact_role: e.target.value || null })}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
        </div>
        <Field label="Email">
          <input
            type="email"
            value={draft.engaged_via_contact_email ?? ''}
            onChange={(e) => setDraft({ ...draft, engaged_via_contact_email: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            value={draft.engaged_via_notes ?? ''}
            onChange={(e) => setDraft({ ...draft, engaged_via_notes: e.target.value || null })}
            rows={2}
            placeholder="e.g. Intermediary handles all VAT queries. For invoice issues, contact the end-client's HQ directly."
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[10.5px] text-ink-muted">
          {draftMeta.lastSavedAt && `Draft auto-saved ${relativeTime(draftMeta.lastSavedAt)}`}
        </div>
        <div className="flex gap-2">
          {draftMeta.hasDraft && (
            <button
              onClick={() => { draftMeta.clear(); setDraft(initial); }}
              className="h-8 px-3 rounded border border-border text-[12px] text-ink-muted hover:text-ink"
            >
              Discard draft
            </button>
          )}
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="h-8 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="h-8 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {saving ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
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

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
