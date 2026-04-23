'use client';

// ════════════════════════════════════════════════════════════════════════
// ConflictCheckPanel — runs a cross-matter conflict scan for the
// current matter's client + counterparty + related parties. Shows
// findings as a list with "False positive" dismissal per hit. Persists
// the result (hits + false_positive_ids) to the matter's
// conflict_check_result JSONB via PUT.
//
// Legal-industry best practice: every new matter runs a conflict scan
// before it opens; every party change re-runs. Auditable via the
// RecordHistory timeline (changes to conflict_check_result appear as
// a normal audit row).
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlertIcon, ShieldCheckIcon, RefreshCwIcon, SparklesIcon, ChevronDownIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

// Extended from the base ILIKE hit: each hit may carry an AI verdict
// from the Opus review pass (stint 33.D). See src/lib/conflict-ai-review.ts.
interface Hit {
  matter_id: string;
  matter_reference: string;
  status: string;
  field: 'client' | 'counterparty' | 'related';
  party: string;
  match_value: string;
  client_name: string | null;
  verdict?: 'true_conflict' | 'false_positive' | 'uncertain';
  confidence?: number;
  reasoning?: string;
}

interface ConflictResult {
  checked_at: string;
  hits: Hit[];
  false_positive_ids?: string[];  // list of composite "matter_id:field:party" keys
  ai_review_ran?: boolean;
}

// AI auto-dismisses false positives with confidence ≥ this threshold.
// Below threshold they surface as normal hits (user decides).
const AI_AUTO_DISMISS_MIN_CONFIDENCE = 0.8;

const FIELD_LABELS = { client: 'Client', counterparty: 'Counterparty', related: 'Related party' };

export function ConflictCheckPanel({
  matterId, clientCompanyId, clientName, counterpartyName, relatedParties, initialResult,
}: {
  matterId: string;
  clientCompanyId: string | null;
  clientName: string | null;
  counterpartyName: string | null;
  relatedParties: string[];
  initialResult: ConflictResult | null;
}) {
  const toast = useToast();
  const [result, setResult] = useState<ConflictResult | null>(initialResult);
  const [running, setRunning] = useState(false);
  const [showAiDismissed, setShowAiDismissed] = useState(false);

  async function runCheck() {
    setRunning(true);
    try {
      const res = await fetch('/api/crm/matters/conflict-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_company_id: clientCompanyId,
          client_name: clientName,
          counterparty_name: counterpartyName,
          related_parties: relatedParties,
          exclude_matter_id: matterId,
        }),
      });
      if (!res.ok) {
        toast.error('Conflict check failed');
        return;
      }
      const body = await res.json();
      const newResult: ConflictResult = {
        checked_at: body.checked_at,
        hits: body.hits ?? [],
        false_positive_ids: result?.false_positive_ids ?? [],
        ai_review_ran: !!body.ai_review_ran,
      };
      setResult(newResult);

      // Persist on the matter.
      await fetch(`/api/crm/matters/${matterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conflict_check_result: newResult }),
      });

      if (body.hits.length === 0) {
        toast.success('Conflict check clean — no matches found');
      } else {
        toast.info(`${body.hits.length} potential conflict${body.hits.length === 1 ? '' : 's'} found · review below`);
      }
    } finally {
      setRunning(false);
    }
  }

  async function dismissHit(key: string) {
    if (!result) return;
    const updated: ConflictResult = {
      ...result,
      false_positive_ids: [...(result.false_positive_ids ?? []), key],
    };
    setResult(updated);
    await fetch(`/api/crm/matters/${matterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conflict_check_result: updated }),
    });
    toast.success('Marked as false positive');
  }

  const falsePositiveIds = new Set(result?.false_positive_ids ?? []);
  // Partition hits by (a) user dismissed, (b) AI auto-dismissed with
  // high confidence, (c) still requires review.
  const notUserDismissed = (result?.hits ?? []).filter(
    h => !falsePositiveIds.has(`${h.matter_id}:${h.field}:${h.party}`),
  );
  const aiAutoDismissed = notUserDismissed.filter(
    h => h.verdict === 'false_positive' && (h.confidence ?? 0) >= AI_AUTO_DISMISS_MIN_CONFIDENCE,
  );
  const activeHits = notUserDismissed.filter(h => !aiAutoDismissed.includes(h));

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden mb-4">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border">
        {activeHits.length > 0 ? (
          <ShieldAlertIcon size={14} className="text-danger-600" />
        ) : result ? (
          <ShieldCheckIcon size={14} className="text-emerald-600" />
        ) : (
          <ShieldCheckIcon size={14} className="text-ink-muted" />
        )}
        <span className="text-[12px] uppercase tracking-wide font-semibold text-ink-muted flex-1">
          Conflict check
        </span>
        {result && (
          <span className="text-[10.5px] text-ink-muted">
            Last checked {new Date(result.checked_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button
          onClick={runCheck}
          disabled={running}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-[11.5px] text-ink-soft hover:bg-surface-alt disabled:opacity-40"
        >
          <RefreshCwIcon size={12} className={running ? 'animate-spin' : ''} />
          {running ? 'Scanning…' : result ? 'Re-run' : 'Run check'}
        </button>
      </div>

      <div className="p-3 text-[12px]">
        {!result && (
          <p className="text-ink-muted italic">
            Scan open / on-hold matters for party-name overlaps with this matter&apos;s
            client ({clientName ?? 'n/a'}), counterparty ({counterpartyName ?? 'n/a'}), and {relatedParties.length} related part{relatedParties.length === 1 ? 'y' : 'ies'}.
          </p>
        )}
        {result && activeHits.length === 0 && (
          <p className="text-emerald-700 font-medium">
            ✓ Clean — no potential conflicts with existing open/on-hold matters.
          </p>
        )}
        {result && activeHits.length > 0 && (
          <div>
            <p className="mb-2 text-danger-700">
              {activeHits.length} potential conflict{activeHits.length === 1 ? '' : 's'} need review.
              {aiAutoDismissed.length > 0 && (
                <span className="text-ink-muted font-normal"> AI dismissed {aiAutoDismissed.length} obvious false positive{aiAutoDismissed.length === 1 ? '' : 's'} below.</span>
              )}
            </p>
            <ul className="space-y-1.5">
              {activeHits.map(h => {
                const key = `${h.matter_id}:${h.field}:${h.party}`;
                const isTrueConflict = h.verdict === 'true_conflict';
                const isUncertain = h.verdict === 'uncertain';
                const borderTone = isTrueConflict
                  ? 'border-danger-400 bg-danger-50/30'
                  : isUncertain
                    ? 'border-amber-300 bg-amber-50/30'
                    : 'border-border';
                return (
                  <li key={key} className={`border rounded-md px-2.5 py-1.5 flex items-start gap-2 ${borderTone}`}>
                    <div className="flex-1 min-w-0">
                      <Link href={`/crm/matters/${h.matter_id}`} className="font-mono text-[11.5px] font-medium text-brand-700 hover:underline">
                        {h.matter_reference}
                      </Link>
                      {h.client_name && (
                        <span className="ml-2 text-[11px] text-ink-muted">· {h.client_name}</span>
                      )}
                      <div className="text-[11px] text-ink-muted">
                        <strong>{FIELD_LABELS[h.field]}</strong> of matter matched party <em>&ldquo;{h.party}&rdquo;</em> via <em>&ldquo;{h.match_value}&rdquo;</em>
                      </div>
                      {h.verdict && h.reasoning && (
                        <div className={`mt-1 text-[11px] flex items-start gap-1.5 ${isTrueConflict ? 'text-danger-700' : 'text-ink-soft'}`}>
                          <SparklesIcon size={11} className="shrink-0 mt-0.5" />
                          <span>
                            <strong className="font-semibold">AI verdict: {h.verdict === 'true_conflict' ? 'real conflict' : 'uncertain'}</strong>
                            {typeof h.confidence === 'number' && <span className="text-ink-muted"> ({Math.round(h.confidence * 100)}%)</span>}
                            {' — '}{h.reasoning}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => dismissHit(key)}
                      className="h-6 px-2 rounded text-[10.5px] text-ink-muted hover:text-ink border border-border hover:bg-surface-alt"
                      title="Mark as false positive — will stay dismissed across future scans"
                    >
                      False positive
                    </button>
                  </li>
                );
              })}
            </ul>

            {aiAutoDismissed.length > 0 && (
              <div className="mt-2 border border-border rounded-md bg-surface-alt/40">
                <button
                  onClick={() => setShowAiDismissed(s => !s)}
                  className="w-full px-2.5 py-1.5 text-left text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1.5"
                >
                  <SparklesIcon size={11} />
                  {aiAutoDismissed.length} false positive{aiAutoDismissed.length === 1 ? '' : 's'} dismissed by AI (click to review)
                  <ChevronDownIcon size={11} className={`ml-auto transition-transform ${showAiDismissed ? 'rotate-180' : ''}`} />
                </button>
                {showAiDismissed && (
                  <ul className="px-2.5 pb-2 space-y-1">
                    {aiAutoDismissed.map(h => {
                      const key = `${h.matter_id}:${h.field}:${h.party}`;
                      return (
                        <li key={key} className="border border-border rounded-md px-2 py-1.5 bg-white">
                          <Link href={`/crm/matters/${h.matter_id}`} className="font-mono text-[11px] font-medium text-brand-700 hover:underline">
                            {h.matter_reference}
                          </Link>
                          {h.client_name && <span className="ml-2 text-[11px] text-ink-muted">· {h.client_name}</span>}
                          <div className="text-[10.5px] text-ink-muted">
                            <strong>{FIELD_LABELS[h.field]}</strong> matched <em>&ldquo;{h.party}&rdquo;</em> via <em>&ldquo;{h.match_value}&rdquo;</em>
                          </div>
                          {h.reasoning && (
                            <div className="text-[10.5px] text-ink-soft mt-0.5 italic">
                              AI ({typeof h.confidence === 'number' ? `${Math.round(h.confidence * 100)}%` : '—'}): {h.reasoning}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {result.false_positive_ids && result.false_positive_ids.length > 0 && (
              <p className="mt-2 text-[10.5px] text-ink-muted italic">
                {result.false_positive_ids.length} prior hit{result.false_positive_ids.length === 1 ? '' : 's'} manually marked as false positive (hidden).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
