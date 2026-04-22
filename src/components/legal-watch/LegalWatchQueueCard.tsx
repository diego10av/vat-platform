'use client';

// LegalWatchQueueCard — the "live classifier" inbox.
//
// 2026-04-23 redesign driven by Diego's feedback: "no entiendo qué
// quiere decir escalate / flag / dismiss, los tres desaparecen igual".
// The fix is to make each button's effect *visible* on the same page:
//
//   • Recordar (flag)         → item stays visible in "Recordatorios"
//                                section with a yellow chip. Come back
//                                to it whenever you want.
//   • Actualizar reglas (esc.) → item moves to "Pendiente actualizar
//                                reglas" section with a green chip.
//                                You commit to doing something about
//                                the item (or Claude drafts the patch
//                                when migration 024 lands).
//   • Descartar (dismiss)      → item goes to "Descartados" (hidden by
//                                default). Toggle "Mostrar descartados"
//                                to inspect / recover.
//
// The mutation no longer optimistically removes the item from local
// state — we refresh from the server so the item re-appears in its
// new section.

import { useCallback, useEffect, useState } from 'react';
import {
  SparklesIcon, RadioIcon, XIcon, CheckCheckIcon, BookmarkIcon,
  ExternalLinkIcon, Loader2Icon, EyeIcon, EyeOffIcon,
  ChevronDownIcon, ChevronRightIcon,
} from 'lucide-react';

type TriageSeverity = 'critical' | 'high' | 'medium' | 'low';
type TriageStatus = 'new' | 'flagged' | 'dismissed' | 'escalated';

interface QueueItem {
  id: string;
  source: string;
  external_id: string | null;
  title: string;
  url: string | null;
  summary: string | null;
  published_at: string | null;
  matched_keywords: string[];
  status: TriageStatus;
  created_at: string;
  triaged_by: string | null;
  ai_triage_severity: TriageSeverity | null;
  ai_triage_affected_rules: string[] | null;
  ai_triage_summary: string | null;
  ai_triage_proposed_action: string | null;
  ai_triage_confidence: number | null;
  ai_triage_model: string | null;
  ai_triage_at: string | null;
}

interface ScanReport {
  source: string;
  fetched: number;
  filtered: number;
  inserted: number;
  skipped_duplicate: number;
  errors: string[];
}

type Tone = 'idle' | 'scanning' | 'success' | 'error';

export function LegalWatchQueueCard() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanState, setScanState] = useState<Tone>('idle');
  const [scanBanner, setScanBanner] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [escalatedOpen, setEscalatedOpen] = useState(true);
  const [flaggedOpen, setFlaggedOpen] = useState(true);
  const [dismissedOpen, setDismissedOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Always request all reviewer-relevant statuses. The server filter
      // returns new + flagged + escalated by default; include dismissed
      // when the toggle is on.
      const qs = includeDismissed ? 'limit=60&include_dismissed=true' : 'limit=40';
      const res = await fetch(`/api/legal-watch/queue?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as QueueItem[];
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [includeDismissed]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async (source: 'vatupdate' | 'sample') => {
    setScanState('scanning');
    setScanBanner(null);
    try {
      const res = await fetch(
        `/api/legal-watch/scan?source=${source}&fallback=true`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.error?.message || `scan failed (${res.status})`;
        setScanState('error');
        setScanBanner(msg);
        return;
      }
      const reports: ScanReport[] = body.reports ?? [];
      const totalInserted = reports.reduce((a, r) => a + r.inserted, 0);
      const totalFetched = reports.reduce((a, r) => a + r.fetched, 0);
      setScanState('success');
      setScanBanner(
        totalInserted === 0
          ? `Fetched ${totalFetched} items · no new hits (everything already in queue)`
          : `Fetched ${totalFetched} items · ${totalInserted} new hit${totalInserted === 1 ? '' : 's'} added`,
      );
      await load();
    } catch (err) {
      setScanState('error');
      setScanBanner(err instanceof Error ? err.message : 'scan failed');
    }
  };

  const triage = async (id: string, status: 'flagged' | 'dismissed' | 'escalated') => {
    setMutatingId(id);
    try {
      const res = await fetch(`/api/legal-watch/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      // Refresh from server — the item moves to its new section rather
      // than disappearing entirely.
      await load();
    } finally {
      setMutatingId(null);
    }
  };

  // Split items into the four reviewer sections.
  const newItems       = items.filter(i => i.status === 'new');
  const flaggedItems   = items.filter(i => i.status === 'flagged');
  const escalatedItems = items.filter(i => i.status === 'escalated');
  const dismissedItems = items.filter(i => i.status === 'dismissed');

  const severityPill = (sev: TriageSeverity): string => {
    switch (sev) {
      case 'critical': return 'bg-red-50 text-red-800 border-red-300';
      case 'high':     return 'bg-orange-50 text-orange-800 border-orange-300';
      case 'medium':   return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'low':      return 'bg-surface-alt text-ink-muted border-border';
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
      <header className="px-5 py-4 flex items-start gap-4 border-b border-divider">
        <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-700 inline-flex items-center justify-center shrink-0">
          <RadioIcon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[14px] font-semibold text-ink tracking-tight">
              Live feed — candidate jurisprudence & notices
            </h2>
            <span className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold tracking-wide border ${newItems.length > 0 ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-surface-alt text-ink-muted border-border'}`}>
              {loading ? '…' : `${newItems.length} new`}
            </span>
            {escalatedItems.length > 0 && (
              <span className="inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold tracking-wide border bg-emerald-50 text-emerald-800 border-emerald-200">
                {escalatedItems.length} pending rule update
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-ink-soft mt-1 leading-relaxed">
            Auto-fetched from public feeds (VATupdate, curia.europa.eu via sample seed),
            filtered by the cifra watchlist, pre-triaged by Opus 4.7.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={() => runScan('sample')}
            disabled={scanState === 'scanning'}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border-strong bg-surface text-[12px] font-medium text-ink-soft hover:border-brand-300 hover:text-brand-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            title="Insert the three flagship sample cases (Versãofast, Finanzamt T II, C-288/22 TP) so you can see the triage flow even without network"
          >
            <BookmarkIcon size={12} />
            Seed samples
          </button>
          <button
            onClick={() => runScan('vatupdate')}
            disabled={scanState === 'scanning'}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-violet-600 text-white text-[12px] font-medium hover:bg-violet-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {scanState === 'scanning' ? <Loader2Icon size={12} className="animate-spin" /> : <SparklesIcon size={12} />}
            Scan now
          </button>
        </div>
      </header>

      {scanBanner && (
        <div className={`px-5 py-2 text-[12px] border-b border-divider ${scanState === 'error' ? 'bg-danger-50 text-danger-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {scanBanner}
        </div>
      )}

      {loading ? (
        <div className="px-5 py-8 text-center text-[12px] text-ink-muted">Loading queue…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-ink-muted">
          Queue is empty — no candidate items currently awaiting triage.
          <div className="mt-2 text-[11.5px] text-ink-faint">
            Click <strong className="font-semibold">Scan now</strong> to pull the VATupdate feed,
            or <strong className="font-semibold">Seed samples</strong> to drop in the three flagship cases for demo.
          </div>
        </div>
      ) : (
        <>
          {/* ── New items — main queue ── */}
          {newItems.length > 0 && (
            <ItemList
              items={newItems}
              mutatingId={mutatingId}
              onTriage={triage}
              severityPill={severityPill}
            />
          )}

          {/* ── Escalated: pending rule update ── */}
          {escalatedItems.length > 0 && (
            <SectionToggle
              open={escalatedOpen}
              onToggle={() => setEscalatedOpen(v => !v)}
              title="Pending rule update"
              subtitle={`${escalatedItems.length} item${escalatedItems.length === 1 ? '' : 's'} you marked for code change`}
              accent="emerald"
            >
              <ItemList
                items={escalatedItems}
                mutatingId={mutatingId}
                onTriage={triage}
                severityPill={severityPill}
                sectionTone="escalated"
              />
            </SectionToggle>
          )}

          {/* ── Flagged: reminders ── */}
          {flaggedItems.length > 0 && (
            <SectionToggle
              open={flaggedOpen}
              onToggle={() => setFlaggedOpen(v => !v)}
              title="Reminders"
              subtitle={`${flaggedItems.length} item${flaggedItems.length === 1 ? '' : 's'} to revisit`}
              accent="amber"
            >
              <ItemList
                items={flaggedItems}
                mutatingId={mutatingId}
                onTriage={triage}
                severityPill={severityPill}
                sectionTone="flagged"
              />
            </SectionToggle>
          )}

          {/* ── Dismissed — hidden by default ── */}
          <div className="px-5 py-3 border-t border-divider bg-surface-alt/30">
            <button
              onClick={() => {
                if (!includeDismissed) setIncludeDismissed(true);
                setDismissedOpen(v => !v);
              }}
              className="inline-flex items-center gap-2 text-[11.5px] text-ink-soft hover:text-ink transition-colors"
              title="Show items you've dismissed — they stay in the database for audit"
            >
              {includeDismissed && dismissedOpen ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
              {includeDismissed && dismissedOpen ? 'Hide dismissed items' : 'Show dismissed items'}
              {includeDismissed && dismissedItems.length > 0 && (
                <span className="ml-1 text-[10.5px] text-ink-muted">({dismissedItems.length})</span>
              )}
            </button>
            {includeDismissed && dismissedOpen && (
              <div className="mt-3">
                {dismissedItems.length === 0 ? (
                  <div className="text-[11.5px] text-ink-muted italic">No dismissed items.</div>
                ) : (
                  <ItemList
                    items={dismissedItems}
                    mutatingId={mutatingId}
                    onTriage={triage}
                    severityPill={severityPill}
                    sectionTone="dismissed"
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SectionToggle({
  open, onToggle, title, subtitle, accent, children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  accent: 'emerald' | 'amber';
  children: React.ReactNode;
}) {
  const accentClasses = accent === 'emerald'
    ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
    : 'bg-amber-50 text-amber-800 border-amber-100';
  return (
    <div className="border-t border-divider">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-5 py-2.5 text-left hover:brightness-95 transition-all ${accentClasses}`}
      >
        {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        <span className="text-[12.5px] font-semibold">{title}</span>
        <span className="text-[11px] opacity-80">{subtitle}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function ItemList({
  items, mutatingId, onTriage, severityPill, sectionTone,
}: {
  items: QueueItem[];
  mutatingId: string | null;
  onTriage: (id: string, status: 'flagged' | 'dismissed' | 'escalated') => void;
  severityPill: (sev: TriageSeverity) => string;
  sectionTone?: 'flagged' | 'escalated' | 'dismissed';
}) {
  const rowOpacity = sectionTone === 'flagged' || sectionTone === 'escalated' ? 'opacity-90'
    : sectionTone === 'dismissed' ? 'opacity-60'
    : '';
  const statusPill = (s: TriageStatus): string => {
    if (s === 'new')       return 'bg-brand-50 text-brand-700 border-brand-200';
    if (s === 'flagged')   return 'bg-amber-50 text-amber-800 border-amber-200';
    if (s === 'escalated') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    return 'bg-surface-alt text-ink-muted border-border';
  };
  return (
    <ul className="divide-y divide-divider">
      {items.map(item => (
        <li key={item.id} className={`px-5 py-4 hover:bg-surface-alt/40 transition-colors ${rowOpacity}`}>
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {item.ai_triage_severity && (
                  <span className={`inline-flex items-center h-[17px] px-1.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${severityPill(item.ai_triage_severity)}`}
                    title={item.ai_triage_summary ?? undefined}
                  >
                    {item.ai_triage_severity}
                  </span>
                )}
                <span className={`inline-flex items-center h-[17px] px-1.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${statusPill(item.status)}`}>
                  {item.status === 'escalated' ? 'to update' : item.status === 'flagged' ? 'reminder' : item.status}
                </span>
                <span className="text-[11px] font-mono text-ink-muted">{item.source}</span>
                {item.external_id && (
                  <span className="text-[11px] font-mono text-ink-faint">· {item.external_id}</span>
                )}
                {item.published_at && (
                  <span className="text-[11px] text-ink-muted tabular-nums">
                    · {new Date(item.published_at).toISOString().slice(0, 10)}
                  </span>
                )}
                {item.triaged_by === 'ai_auto' && (
                  <span className="text-[10px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                    AI auto-dismiss
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[13px] font-medium text-ink leading-snug">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener" className="hover:underline inline-flex items-start gap-1">
                    {item.title}
                    <ExternalLinkIcon size={10} className="mt-[3px] shrink-0 text-ink-muted" />
                  </a>
                ) : (
                  item.title
                )}
              </div>

              {/* AI triage block */}
              {item.ai_triage_summary && (
                <div className="mt-2 rounded border border-violet-200 bg-violet-50/60 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-violet-800 uppercase tracking-wide">
                    <SparklesIcon size={10} />
                    AI triage
                    {item.ai_triage_confidence != null && (
                      <span className="font-normal text-violet-600">
                        · confidence {Math.round(item.ai_triage_confidence * 100)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-ink leading-relaxed">{item.ai_triage_summary}</p>
                  {item.ai_triage_proposed_action && (
                    <p className="mt-1 text-[11.5px] text-ink-soft leading-relaxed">
                      <strong className="font-semibold">Proposed action:</strong> {item.ai_triage_proposed_action}
                    </p>
                  )}
                  {item.ai_triage_affected_rules && item.ai_triage_affected_rules.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.ai_triage_affected_rules.map(r => (
                        <span
                          key={r}
                          className="inline-flex items-center h-[17px] px-1.5 rounded bg-white text-violet-800 border border-violet-200 text-[10px] font-semibold"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {item.summary && (
                <p className="mt-2 text-[11.5px] text-ink-muted leading-relaxed line-clamp-2">
                  <span className="uppercase text-[9.5px] tracking-wider font-semibold text-ink-faint mr-1">source</span>
                  {item.summary}
                </p>
              )}
              {item.matched_keywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.matched_keywords.slice(0, 6).map(kw => (
                    <span
                      key={kw}
                      className="inline-flex items-center h-[18px] px-1.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100 text-[10px] font-medium"
                    >
                      {kw}
                    </span>
                  ))}
                  {item.matched_keywords.length > 6 && (
                    <span className="inline-flex items-center h-[18px] px-1.5 text-[10px] text-ink-muted">
                      +{item.matched_keywords.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-1 flex-col">
              {/* Only new + flagged can be re-triaged with all 3 buttons.
                  Escalated items get "Unescalate → back to new" + "Dismiss".
                  Dismissed items get "Restore → new" only. */}
              {item.status === 'new' && (
                <>
                  <TriageButton
                    onClick={() => onTriage(item.id, 'flagged')}
                    disabled={mutatingId === item.id}
                    label="Recordar"
                    title="Keep it visible in the Reminders section. Click this when you want to come back to it later but don't yet have an opinion."
                    tone="amber"
                    icon={<BookmarkIcon size={11} />}
                  />
                  <TriageButton
                    onClick={() => onTriage(item.id, 'escalated')}
                    disabled={mutatingId === item.id}
                    label="Actualizar reglas"
                    title="Move to 'Pending rule update'. Signals you commit to updating cifra's classifier rules or legal-sources.ts because of this item. (Migration 024 enables Opus 4.7 to auto-draft the code change.)"
                    tone="emerald"
                    icon={<CheckCheckIcon size={11} />}
                  />
                  <TriageButton
                    onClick={() => onTriage(item.id, 'dismissed')}
                    disabled={mutatingId === item.id}
                    label="Descartar"
                    title="Not relevant. Item hides into the Dismissed section (kept for audit). Toggle 'Show dismissed' to recover."
                    tone="muted"
                    icon={<XIcon size={11} />}
                  />
                </>
              )}
              {item.status === 'flagged' && (
                <>
                  <TriageButton
                    onClick={() => onTriage(item.id, 'escalated')}
                    disabled={mutatingId === item.id}
                    label="Actualizar reglas"
                    title="Promote this reminder to a committed rule update."
                    tone="emerald"
                    icon={<CheckCheckIcon size={11} />}
                  />
                  <TriageButton
                    onClick={() => onTriage(item.id, 'dismissed')}
                    disabled={mutatingId === item.id}
                    label="Descartar"
                    title="Decided it's not relevant after all."
                    tone="muted"
                    icon={<XIcon size={11} />}
                  />
                </>
              )}
              {item.status === 'escalated' && (
                <>
                  <TriageButton
                    onClick={() => onTriage(item.id, 'flagged')}
                    disabled={mutatingId === item.id}
                    label="Revertir a recordatorio"
                    title="Send back to Reminders — changed your mind about updating the rules."
                    tone="amber"
                    icon={<BookmarkIcon size={11} />}
                  />
                  <TriageButton
                    onClick={() => onTriage(item.id, 'dismissed')}
                    disabled={mutatingId === item.id}
                    label="Descartar"
                    title="Not worth a rule update after all."
                    tone="muted"
                    icon={<XIcon size={11} />}
                  />
                </>
              )}
              {item.status === 'dismissed' && (
                <TriageButton
                  onClick={() => onTriage(item.id, 'flagged')}
                  disabled={mutatingId === item.id}
                  label="Recuperar"
                  title="Send back to Reminders — you want to revisit this."
                  tone="amber"
                  icon={<BookmarkIcon size={11} />}
                />
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TriageButton({
  onClick, disabled, label, title, tone, icon,
}: {
  onClick: () => void; disabled: boolean; label: string; title: string;
  tone: 'amber' | 'emerald' | 'muted';
  icon: React.ReactNode;
}) {
  const tones = {
    amber: 'hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200',
    emerald: 'hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-200',
    muted: 'hover:bg-surface-alt hover:text-ink hover:border-border-strong',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border text-[11px] text-ink-soft transition-colors whitespace-nowrap ${tones[tone]} disabled:opacity-40 disabled:cursor-wait`}
    >
      {icon}
      {label}
    </button>
  );
}
