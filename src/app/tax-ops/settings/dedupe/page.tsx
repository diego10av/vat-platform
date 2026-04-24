'use client';

// /tax-ops/settings/dedupe — Entity deduplication batch tool (stint 40.A).
//
// Diego's import from Excel left many entities with near-identical names
// that differ only in punctuation (e.g. "Avallon MBO Fund III SCA;" vs
// "Avallon MBO Fund III S.C.A."). This page surfaces clusters of
// suspected duplicates (using the Levenshtein-based similarityScore
// from src/lib/similarity.ts) and lets Diego merge each cluster with
// one click.
//
// UX:
//   - Threshold slider (0.70–1.00, default 0.85). Lower → more clusters.
//   - Each cluster = a card with N candidate rows. Radio button picks
//     the canonical entity; the others merge into it.
//   - "Merge group" → POST /api/tax-ops/entities/<canonical>/merge with
//     { source_entity_ids: [...] }.
//   - "Skip" → hides the cluster for this session (localStorage).
//
// The merge endpoint is atomic: all obligations are reassigned to the
// canonical entity; duplicate obligations on the canonical's key tuple
// are deactivated (kept for audit). Source entities are marked inactive
// with a note. An audit_log entry ties everything together.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, MergeIcon, XIcon, RefreshCwIcon, ZapIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/Toaster';

interface Member {
  id: string;
  legal_name: string;
  client_group_id: string | null;
  client_group_name: string | null;
  vat_number: string | null;
  matricule: string | null;
  obligations_count: number;
  filings_count: number;
  latest_filing_year: number | null;
}

interface Cluster {
  confidence: number;
  members: Member[];
}

interface Response {
  threshold: number;
  total_entities_scanned: number;
  clusters: Cluster[];
}

const IGNORE_KEY = 'cifra-tax-ops-dedupe-ignored';

function clusterKey(cluster: Cluster): string {
  return cluster.members.map(m => m.id).sort().join('|');
}

export default function DedupePage() {
  const [threshold, setThreshold] = useState(0.85);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canonicalByCluster, setCanonicalByCluster] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const toast = useToast();

  // Load ignored list from localStorage once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(IGNORE_KEY);
      if (raw) setIgnored(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  const persistIgnored = (next: Set<string>) => {
    setIgnored(next);
    try { localStorage.setItem(IGNORE_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tax-ops/entities/dedupe-candidates?threshold=${threshold}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as Response;
      setData(body);
      // Default canonical = highest (obligations_count * 100 + filings_count)
      // scored member — the one with the richest history wins.
      const next: Record<string, string> = {};
      for (const c of body.clusters) {
        const sorted = [...c.members].sort((a, b) =>
          (b.obligations_count * 100 + b.filings_count) -
          (a.obligations_count * 100 + a.filings_count),
        );
        next[clusterKey(c)] = sorted[0]!.id;
      }
      setCanonicalByCluster(next);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => { void load(); }, [load]);

  async function mergeCluster(cluster: Cluster) {
    const key = clusterKey(cluster);
    const canonicalId = canonicalByCluster[key];
    if (!canonicalId) {
      toast.error('Pick a canonical entity first.');
      return;
    }
    const sourceIds = cluster.members.map(m => m.id).filter(id => id !== canonicalId);
    const canonical = cluster.members.find(m => m.id === canonicalId);
    if (!canonical || sourceIds.length === 0) return;
    if (!confirm(
      `Merge ${sourceIds.length} entit${sourceIds.length === 1 ? 'y' : 'ies'} into ` +
      `"${canonical.legal_name}"?\n\n` +
      `All obligations and filings will move to the canonical. ` +
      `Source entities will be marked inactive. This is logged in the audit log.`,
    )) return;

    setMerging(key);
    try {
      const res = await fetch(`/api/tax-ops/entities/${canonicalId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_entity_ids: sourceIds }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { moved_obligations: number; deactivated_obligations: number };
      toast.success(
        `Merged ${sourceIds.length} entit${sourceIds.length === 1 ? 'y' : 'ies'} · ` +
        `${body.moved_obligations} obligation${body.moved_obligations === 1 ? '' : 's'} moved` +
        (body.deactivated_obligations > 0 ? `, ${body.deactivated_obligations} deactivated (duplicates)` : ''),
      );
      await load();
    } catch (e) {
      toast.error(`Merge failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setMerging(null);
    }
  }

  function skipCluster(cluster: Cluster) {
    const key = clusterKey(cluster);
    const next = new Set(ignored);
    next.add(key);
    persistIgnored(next);
  }

  function restoreIgnored() {
    persistIgnored(new Set());
  }

  const visibleClusters = (data?.clusters ?? []).filter(c => !ignored.has(clusterKey(c)));
  // Stint 42.E — clusters where every member normalises to the same
  // string are confidence 1.00 and safe to auto-merge. Pick canonical
  // via the richest-history default (same logic the page uses for
  // manual clicks) so the bulk action matches what Diego would do.
  const exactClusters = visibleClusters.filter(c => c.confidence >= 0.9999);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; failed: number } | null>(null);

  async function runBulkMerge() {
    if (exactClusters.length === 0) return;
    setBulkProgress({ done: 0, total: exactClusters.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const cluster of exactClusters) {
      const key = clusterKey(cluster);
      const canonicalId = canonicalByCluster[key];
      if (!canonicalId) { failed += 1; done += 1; setBulkProgress({ done, total: exactClusters.length, failed }); continue; }
      const sourceIds = cluster.members.map(m => m.id).filter(id => id !== canonicalId);
      try {
        const res = await fetch(`/api/tax-ops/entities/${canonicalId}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_entity_ids: sourceIds }),
        });
        if (!res.ok) failed += 1;
      } catch {
        failed += 1;
      }
      done += 1;
      setBulkProgress({ done, total: exactClusters.length, failed });
    }
    setBulkOpen(false);
    setBulkProgress(null);
    const succeeded = exactClusters.length - failed;
    if (succeeded > 0) {
      toast.success(`Auto-merged ${succeeded} cluster${succeeded === 1 ? '' : 's'}` + (failed > 0 ? ` · ${failed} failed` : ''));
    }
    if (failed > 0 && succeeded === 0) {
      toast.error(`Auto-merge failed on all ${failed} clusters`);
    }
    await load();
  }

  return (
    <div>
      <Link href="/tax-ops/settings" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink mb-2">
        <ArrowLeftIcon size={12} /> Back to settings
      </Link>

      <PageHeader
        title="Entity deduplication"
        subtitle="Find and merge entities whose names are near-duplicates (different punctuation, extra whitespace, variant spellings). Pick the canonical row — the others are merged into it."
      />

      <div className="rounded-md border border-border bg-surface px-4 py-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 text-[12.5px]">
            <span className="text-ink-muted">Similarity threshold:</span>
            <input
              type="range"
              min="0.7"
              max="1.0"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-48"
            />
            <span className="text-ink font-mono tabular-nums w-12">{threshold.toFixed(2)}</span>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border border-border hover:bg-surface-alt disabled:opacity-50"
          >
            <RefreshCwIcon size={12} /> Re-scan
          </button>
          {ignored.size > 0 && (
            <button
              type="button"
              onClick={restoreIgnored}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border border-border hover:bg-surface-alt"
            >
              Restore {ignored.size} skipped
            </button>
          )}
          {exactClusters.length > 0 && (
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md bg-brand-50 border border-brand-300 text-brand-700 hover:bg-brand-100"
              title="Merge all clusters whose members are identical after normalisation (confidence 100%)"
            >
              <ZapIcon size={12} /> Auto-merge exact matches ({exactClusters.length})
            </button>
          )}
          <div className="ml-auto text-[11.5px] text-ink-muted">
            {data && `${data.total_entities_scanned} entities scanned · ${visibleClusters.length} cluster${visibleClusters.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <p className="mt-2 text-[11.5px] text-ink-soft">
          Lower threshold → more clusters but more false positives. Default 0.85 catches
          punctuation + short legal-suffix variations (&quot;SCA;&quot; vs &quot;S.C.A.&quot;). Drop to 0.75
          to catch bigger spelling variations.
        </p>
      </div>

      {error && <CrmErrorBox message={error} onRetry={load} />}
      {loading && !data && <PageSkeleton />}

      {data && visibleClusters.length === 0 && (
        <EmptyState
          title="No duplicates detected"
          description={`At threshold ${threshold.toFixed(2)}, no clusters of near-duplicate entities were found. Lower the threshold or add more entities.`}
        />
      )}

      <div className="space-y-3">
        {visibleClusters.map(cluster => {
          const key = clusterKey(cluster);
          const canonicalId = canonicalByCluster[key];
          const isMerging = merging === key;
          return (
            <div key={key} className="rounded-md border border-border bg-surface">
              <div className="px-4 py-2 border-b border-border bg-surface-alt/50 flex items-center gap-2">
                <span className="text-[12px] text-ink font-medium">
                  {cluster.members.length} duplicates
                </span>
                <span className="text-[11px] text-ink-muted">
                  confidence <span className="tabular-nums">{(cluster.confidence * 100).toFixed(0)}%</span>
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => skipCluster(cluster)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] rounded border border-border text-ink-muted hover:text-ink hover:bg-surface-alt"
                    title="Hide this cluster — it will reappear if you clear 'skipped'."
                  >
                    <XIcon size={11} /> Skip
                  </button>
                  <button
                    type="button"
                    disabled={!canonicalId || isMerging}
                    onClick={() => void mergeCluster(cluster)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
                  >
                    <MergeIcon size={12} /> {isMerging ? 'Merging…' : 'Merge group'}
                  </button>
                </div>
              </div>
              <table className="w-full text-[12.5px]">
                <thead className="text-ink-muted bg-surface-alt/30">
                  <tr className="text-left">
                    <th className="px-3 py-1.5 font-medium w-8"></th>
                    <th className="px-3 py-1.5 font-medium">Entity</th>
                    <th className="px-3 py-1.5 font-medium">Family</th>
                    <th className="px-3 py-1.5 font-medium">VAT #</th>
                    <th className="px-3 py-1.5 font-medium text-right">Obligations</th>
                    <th className="px-3 py-1.5 font-medium text-right">Filings</th>
                    <th className="px-3 py-1.5 font-medium text-right">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {cluster.members.map(m => (
                    <tr key={m.id} className="border-t border-border/70">
                      <td className="px-3 py-1.5">
                        <input
                          type="radio"
                          name={`canonical-${key}`}
                          checked={canonicalId === m.id}
                          onChange={() => setCanonicalByCluster(prev => ({ ...prev, [key]: m.id }))}
                          aria-label={`Use ${m.legal_name} as canonical`}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/tax-ops/entities/${m.id}`}
                          target="_blank"
                          className="font-medium text-ink hover:text-brand-700"
                        >
                          {m.legal_name}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-ink-soft">{m.client_group_name ?? '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-ink-muted text-[11.5px]">{m.vat_number ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.obligations_count}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.filings_count}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{m.latest_filing_year ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setBulkOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-surface border border-border rounded-lg shadow-xl max-w-2xl w-full p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <ZapIcon size={14} className="text-brand-500" />
              <h2 className="text-[14px] font-semibold text-ink flex-1">Auto-merge exact matches</h2>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                aria-label="Close"
                className="text-ink-muted hover:text-ink p-1"
              >
                <XIcon size={14} />
              </button>
            </div>
            <p className="text-[12px] text-ink-muted">
              These {exactClusters.length} cluster{exactClusters.length === 1 ? '' : 's'} have members whose normalised names are
              identical — legal-suffix and punctuation variants of the same entity. The canonical
              pick defaults to the entity with the most filings history. You can review the list
              below; Apply merges everything at once.
            </p>
            <div className="max-h-[360px] overflow-auto border border-border rounded">
              <table className="w-full text-[11.5px]">
                <thead className="bg-surface-alt text-ink-muted sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">Canonical (kept)</th>
                    <th className="px-2 py-1 font-medium">Will be merged into it</th>
                  </tr>
                </thead>
                <tbody>
                  {exactClusters.map(c => {
                    const key = clusterKey(c);
                    const canonicalId = canonicalByCluster[key];
                    const canonical = c.members.find(m => m.id === canonicalId);
                    const sources = c.members.filter(m => m.id !== canonicalId);
                    return (
                      <tr key={key} className="border-t border-border/70">
                        <td className="px-2 py-1 font-medium text-ink">{canonical?.legal_name ?? '—'}</td>
                        <td className="px-2 py-1 text-ink-soft">
                          {sources.map(s => s.legal_name).join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {bulkProgress && (
              <div className="text-[11.5px] text-ink">
                Merging {bulkProgress.done} / {bulkProgress.total}{bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ''}…
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="px-3 py-1 text-[12px] rounded-md border border-border hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runBulkMerge()}
                disabled={!!bulkProgress}
                className="inline-flex items-center gap-1 px-3 py-1 text-[12px] rounded-md bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
              >
                <ZapIcon size={11} /> {bulkProgress ? 'Merging…' : `Apply ${exactClusters.length} merge${exactClusters.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
