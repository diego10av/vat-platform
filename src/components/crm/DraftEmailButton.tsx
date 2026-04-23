'use client';

// ════════════════════════════════════════════════════════════════════════
// DraftEmailButton — "Draft email" CTA that invokes the AI endpoint,
// shows a preview modal with editable subject + body, and lets the
// user open it in their mail client (mailto:) or copy-to-clipboard.
//
// Surfaces:
//   - ActionsDueWidget rows that have a relationship target
//   - DealsAtRiskWidget rows (when implemented)
//   - Invoice detail page (overdue chase)
//   - Contact detail page (dormant check-in)
//
// Rate-limited at the endpoint level (Opus 4.7, ~€0.01/call). Compact
// mode for inline use inside table-like widgets; full mode for page
// detail headers.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { SparklesIcon, CopyIcon, MailIcon, XIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';

export type DraftTargetType = 'crm_contact' | 'crm_invoice' | 'crm_opportunity' | 'crm_matter';
export type DraftIntent = 'follow_up' | 'overdue_chase' | 'check_in' | 'next_step';

interface DraftResponse {
  subject: string;
  body_markdown: string;
  body_plain_text: string;
  mailto_url: string;
  recipient_email: string | null;
  recipient_name: string | null;
}

const INTENT_LABEL: Record<DraftIntent, string> = {
  follow_up:     'follow-up',
  overdue_chase: 'overdue chase',
  check_in:      'check-in',
  next_step:     'next step',
};

export function DraftEmailButton({
  targetType, targetId, intent, compact = false, label,
}: {
  targetType: DraftTargetType;
  targetId: string;
  intent: DraftIntent;
  compact?: boolean;
  label?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [editedSubject, setEditedSubject] = useState('');
  const [editedBody, setEditedBody] = useState('');

  async function generate() {
    setLoading(true);
    setDraft(null);
    try {
      const res = await fetch('/api/crm/ai/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, intent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? 'Draft failed');
        setOpen(false);
        return;
      }
      const body = await res.json() as DraftResponse;
      setDraft(body);
      setEditedSubject(body.subject);
      setEditedBody(body.body_plain_text);
    } finally { setLoading(false); }
  }

  function openAndGenerate() {
    setOpen(true);
    generate();
  }

  function mailtoUrl(): string {
    if (!draft) return '#';
    const to = draft.recipient_email ?? '';
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(editedSubject)}&body=${encodeURIComponent(editedBody)}`;
  }

  function copyToClipboard() {
    const text = `Subject: ${editedSubject}\n\n${editedBody}`;
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Copy failed'),
    );
  }

  const btnLabel = label ?? 'Draft email';

  return (
    <>
      {compact ? (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAndGenerate(); }}
          title={`Draft ${INTENT_LABEL[intent]} email`}
          className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50/50 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
        >
          <SparklesIcon size={11} />
          <span className="hidden md:inline">Draft</span>
        </button>
      ) : (
        <button
          onClick={(e) => { e.preventDefault(); openAndGenerate(); }}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-brand-300 bg-brand-50 text-[12.5px] font-medium text-brand-700 hover:bg-brand-100"
        >
          <SparklesIcon size={13} />
          {btnLabel}
        </button>
      )}
      {open && (
        <Modal
          open={true}
          onClose={() => !loading && setOpen(false)}
          title={`Draft ${INTENT_LABEL[intent]} email${draft?.recipient_name ? ` — ${draft.recipient_name}` : ''}`}
          size="lg"
          footer={
            draft ? (
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={copyToClipboard}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-white text-[12.5px] text-ink-soft hover:bg-surface-alt"
                >
                  <CopyIcon size={12} /> Copy
                </button>
                <button
                  onClick={generate}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-white text-[12.5px] text-ink-soft hover:bg-surface-alt disabled:opacity-40"
                >
                  <SparklesIcon size={12} /> Regenerate
                </button>
                <a
                  href={mailtoUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-brand-600 text-white text-[12.5px] font-semibold hover:bg-brand-700"
                >
                  <MailIcon size={12} /> Open in mail client
                </a>
              </div>
            ) : null
          }
        >
          {loading && !draft && (
            <div className="text-[12px] text-ink-muted italic py-8 text-center">
              Opus 4.7 is drafting. Typically 8-15 seconds…
            </div>
          )}
          {draft && (
            <div className="space-y-3">
              {draft.recipient_email ? (
                <div className="text-[11.5px] text-ink-muted">
                  To: <span className="font-mono text-ink-soft">{draft.recipient_email}</span>
                  {draft.recipient_name && <span className="ml-1">({draft.recipient_name})</span>}
                </div>
              ) : (
                <div className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center gap-1.5">
                  <XIcon size={11} />
                  No email address on record — you&apos;ll need to paste the recipient manually.
                </div>
              )}
              <div>
                <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Subject</label>
                <input
                  value={editedSubject}
                  onChange={e => setEditedSubject(e.target.value)}
                  className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md"
                />
              </div>
              <div>
                <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Body</label>
                <textarea
                  value={editedBody}
                  onChange={e => setEditedBody(e.target.value)}
                  rows={12}
                  className="w-full px-2.5 py-2 text-[13px] font-[ui-sans-serif] border border-border rounded-md resize-y leading-relaxed"
                />
                <p className="mt-1 text-[10.5px] text-ink-muted italic">
                  Edit as needed — this is AI-generated, not auto-sent. Always read before sending.
                </p>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
