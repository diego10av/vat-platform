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
import { ShieldAlertIcon, ShieldCheckIcon, RefreshCwIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

interface Hit {
  matter_id: string;
  matter_reference: string;
  status: string;
  field: 'client' | 'counterparty' | 'related';
  party: string;
  match_value: string;
  client_name: string | null;
}

interface ConflictResult {
  checked_at: string;
  hits: Hit[];
  false_positive_ids?: string[];  // list of composite "matter_id:field:party" keys
}

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
  const activeHits = (result?.hits ?? []).filter(h => !falsePositiveIds.has(`${h.matter_id}:${h.field}:${h.party}`));

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
              Found {activeHits.length} potential conflict{activeHits.length === 1 ? '' : 's'}. Review each — mark false positives to dismiss.
            </p>
            <ul className="space-y-1.5">
              {activeHits.map(h => {
                const key = `${h.matter_id}:${h.field}:${h.party}`;
                return (
                  <li key={key} className="border border-border rounded-md px-2.5 py-1.5 flex items-start gap-2">
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
            {result.false_positive_ids && result.false_positive_ids.length > 0 && (
              <p className="mt-2 text-[10.5px] text-ink-muted italic">
                {result.false_positive_ids.length} prior hit{result.false_positive_ids.length === 1 ? '' : 's'} marked as false positive (hidden).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
