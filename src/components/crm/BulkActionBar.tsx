'use client';

// ════════════════════════════════════════════════════════════════════════
// BulkActionBar — floating bar shown when N>0 rows are selected in a
// CRM list view. Offers bulk delete (soft) and bulk tag add/remove.
//
// The hosting list page is responsible for:
//  - Rendering checkboxes in each row and tracking a `selected` Set
//  - Passing `targetType`, `selectedIds`, and `onDone` (to clear the
//    selection + reload after action)
//
// The bar itself handles the API calls + confirmation modals.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Trash2Icon, TagIcon, XIcon, PencilIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

export function BulkActionBar({
  targetType, selectedIds, onDone, onClear, onEditFields,
}: {
  targetType: 'crm_company' | 'crm_contact' | 'crm_opportunity' | 'crm_matter';
  selectedIds: string[];
  onDone: () => void;
  onClear: () => void;
  /** Optional — when provided, renders an "Edit fields" button that
   *  invokes the host page's BulkEditDrawer (each list configures its
   *  own fields whitelist). Stint 63.E. */
  onEditFields?: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tagPromptOpen, setTagPromptOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOp, setTagOp] = useState<'add_tag' | 'remove_tag'>('add_tag');

  if (selectedIds.length === 0) return null;

  async function run(op: 'soft_delete' | 'add_tag' | 'remove_tag', extra?: { tag?: string }) {
    setBusy(true);
    try {
      const res = await fetch('/api/crm/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType, ids: selectedIds, op, ...extra }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Bulk ${op} failed`);
        return;
      }
      const body = await res.json();
      toast.success(`${body.op} applied to ${body.affected} record${body.affected === 1 ? '' : 's'}`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(
      `Move ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'} to trash?\n\n` +
      `You can restore from /crm/trash within 30 days.`,
    )) return;
    await run('soft_delete');
  }

  async function handleTagSubmit() {
    const tag = tagDraft.trim();
    if (!tag) { toast.error('Tag cannot be empty'); return; }
    await run(tagOp, { tag });
    setTagPromptOpen(false);
    setTagDraft('');
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-drawer bg-ink text-white rounded-lg shadow-xl px-3 py-2 flex items-center gap-2 text-sm">
        <span className="font-semibold">
          {selectedIds.length} selected
        </span>
        <span className="h-4 w-px bg-white/30" />
        {onEditFields && (
          <button
            onClick={onEditFields}
            disabled={busy}
            className="h-7 px-2.5 rounded-md bg-brand-500/90 hover:bg-brand-600 disabled:opacity-40 inline-flex items-center gap-1.5 text-xs font-medium"
          >
            <PencilIcon size={12} /> Edit fields
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={busy}
          className="h-7 px-2.5 rounded-md bg-danger-500/90 hover:bg-danger-600 disabled:opacity-40 inline-flex items-center gap-1.5 text-xs font-medium"
        >
          <Trash2Icon size={12} /> Delete
        </button>
        <button
          onClick={() => { setTagOp('add_tag'); setTagPromptOpen(true); }}
          disabled={busy}
          className="h-7 px-2.5 rounded-md bg-white/15 hover:bg-white/25 disabled:opacity-40 inline-flex items-center gap-1.5 text-xs font-medium"
        >
          <TagIcon size={12} /> Add tag
        </button>
        <button
          onClick={() => { setTagOp('remove_tag'); setTagPromptOpen(true); }}
          disabled={busy}
          className="h-7 px-2.5 rounded-md bg-white/15 hover:bg-white/25 disabled:opacity-40 text-xs font-medium"
        >
          Remove tag
        </button>
        <span className="h-4 w-px bg-white/30" />
        <button
          onClick={onClear}
          className="h-7 w-7 rounded-md hover:bg-white/15 inline-flex items-center justify-center"
          title="Clear selection"
        >
          <XIcon size={13} />
        </button>
      </div>

      {tagPromptOpen && (
        <div className="fixed inset-0 bg-black/40 z-modal flex items-center justify-center p-4" onClick={() => setTagPromptOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-2">
              {tagOp === 'add_tag' ? 'Add tag' : 'Remove tag'} — {selectedIds.length} record{selectedIds.length === 1 ? '' : 's'}
            </h3>
            <input
              autoFocus
              value={tagDraft}
              onChange={e => setTagDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleTagSubmit(); }}
              placeholder="Tag name"
              className="w-full h-9 px-2.5 text-sm border border-border rounded-md"
            />
            <div className="mt-3 flex items-center gap-2 justify-end">
              <button onClick={() => setTagPromptOpen(false)} className="h-8 px-3 rounded-md border border-border text-sm text-ink-soft hover:bg-surface-alt">Cancel</button>
              <button onClick={handleTagSubmit} disabled={busy || !tagDraft.trim()} className="h-8 px-3 rounded-md bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40">
                {busy ? 'Applying…' : tagOp === 'add_tag' ? 'Add' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
