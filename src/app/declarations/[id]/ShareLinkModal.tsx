'use client';

// ════════════════════════════════════════════════════════════════════════
// ShareLinkModal — issues a client approval portal link.
//
// Used from the declaration page's top action bar when the declaration
// is in 'review' state. The reviewer clicks "Share for client approval",
// picks an expiry (default 7 days, up to 30), and gets a signed URL to
// paste into an email / Slack / Whatsapp.
//
// The link is issued by POST /api/declarations/[id]/share-link.
// Opening it lands on /portal/[token] — no login required for the
// client on the receiving end.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { XIcon, CopyIcon, CheckIcon, ShareIcon, Loader2Icon, AlertCircleIcon } from 'lucide-react';

interface ApproverSlim {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  organization: string | null;
  country: string | null;
  approver_type: 'client' | 'csp' | 'other';
  is_primary: boolean;
}

interface ShareLinkResult {
  url: string;
  expires_at: string;
  expires_at_unix: number;
  nonce: string;
  expiry_days: number;
  approvers: ApproverSlim[];
  primary_email: string | null;
  cc_emails: string[];
}

export function ShareLinkModal({
  declarationId, onClose,
}: { declarationId: string; onClose: () => void }) {
  const [expiryDays, setExpiryDays] = useState(7);
  const [result, setResult] = useState<ShareLinkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/declarations/${declarationId}/share-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiry_days: expiryDays }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? `Failed to generate link (${res.status}).`);
        return;
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy — select the URL manually.');
    }
  }

  function openInMail() {
    if (!result) return;
    const subject = 'VAT declaration ready for your approval';
    const body = [
      'Hi,',
      '',
      'Please review and approve the attached VAT declaration using the secure link below.',
      '',
      result.url,
      '',
      `Link expires on ${new Date(result.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}.`,
      '',
      'Thanks.',
    ].join('\n');

    // Pre-fill the To / Cc fields from the entity's approvers. Primary
    // gets "To:", the rest are "Cc:". If no approvers are configured,
    // user fills it manually (old behaviour).
    const to = result.primary_email ? encodeURIComponent(result.primary_email) : '';
    const cc = result.cc_emails.length > 0
      ? `&cc=${encodeURIComponent(result.cc_emails.join(','))}`
      : '';
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}${cc}&body=${encodeURIComponent(body)}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-surface rounded-lg w-full max-w-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-link-title"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0">
              <ShareIcon size={13} />
            </div>
            <div>
              <h3 id="share-link-title" className="text-[14px] font-semibold text-ink leading-tight">Share for client approval</h3>
              <div className="text-[11px] text-ink-muted leading-tight mt-0.5">
                One-time link, no login required on the client side
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {!result ? (
            <>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                  Link expires after
                </span>
                <select
                  value={expiryDays}
                  onChange={e => setExpiryDays(Number(e.target.value))}
                  disabled={loading}
                  className="mt-1.5 w-full border border-border-strong rounded px-3 py-2 text-[13px] bg-surface focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days (recommended)</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days (max)</option>
                </select>
              </label>

              <div className="mt-3 text-[11.5px] text-ink-muted leading-relaxed">
                The client can approve with one click. We record their IP +
                timestamp + a cryptographic nonce in the audit trail.
              </div>

              {error && (
                <div className="mt-3 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
                  <AlertCircleIcon size={13} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}

              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={onClose}
                  className="h-9 px-4 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  onClick={generate}
                  disabled={loading}
                  className="h-9 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <Loader2Icon size={13} className="animate-spin" /> Generating…
                    </>
                  ) : (
                    'Generate link'
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                Shareable link
              </div>
              <div className="mt-1.5 bg-surface-alt border border-border rounded p-2 font-mono text-[11.5px] text-ink break-all select-all">
                {result.url}
              </div>
              <div className="text-[11px] text-ink-muted mt-2">
                Expires{' '}
                <span className="font-medium text-ink-soft">
                  {new Date(result.expires_at).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>

              {/* Approvers preview — tells the user exactly who will
                  receive the email when they click "Draft email". */}
              {result.approvers.length > 0 ? (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-2">
                    Will send to
                  </div>
                  <div className="space-y-1.5">
                    {result.approvers.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-[12px]">
                        <span className={[
                          'text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                          a.is_primary
                            ? 'bg-brand-500 text-white'
                            : 'bg-surface-alt text-ink-soft border border-border',
                        ].join(' ')}>
                          {a.is_primary ? 'To' : 'Cc'}
                        </span>
                        <span className="text-ink font-medium">{a.name}</span>
                        {a.role && <span className="text-ink-muted">· {a.role}</span>}
                        {a.email ? (
                          <span className="text-ink-muted font-mono text-[11px]">{a.email}</span>
                        ) : (
                          <span className="text-warning-700 text-[11px]">(no email)</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-[11.5px] text-warning-800 bg-warning-50 border border-warning-200 rounded px-3 py-2">
                  No approvers configured for this entity.
                  Add them on the entity page so "Draft email" can
                  pre-fill To / Cc automatically.
                </div>
              )}

              <div className="mt-5 flex gap-2 justify-end">
                <button
                  onClick={openInMail}
                  className="h-9 px-4 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt"
                >
                  Draft email
                </button>
                <button
                  onClick={copy}
                  className="h-9 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5"
                >
                  {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
