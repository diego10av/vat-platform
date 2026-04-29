'use client';

// ════════════════════════════════════════════════════════════════════════
// PipelineKanban — Opportunities board grouped by stage with HTML5
// drag-and-drop. No external libs (no react-beautiful-dnd / dnd-kit)
// to keep the bundle lean. The 7 stages render as columns
// (Lead → Initial → Meeting → Proposal → Negotiation → Won/Lost).
//
// Drag semantics: picking up a card fires dragstart; dropping on a
// column fires drop → calls onStageChange(id, newStage). The parent
// page handles the PUT request + reload.
//
// Cards show: company, weighted €, probability, days-in-stage,
// next_action (truncated).
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import { type OpportunityStage, LABELS_STAGE, formatEur, formatDate } from '@/lib/crm-types';

interface OppCard {
  id: string;
  name: string;
  stage: string;
  stage_entered_at: string | null;
  estimated_value_eur: number | null;
  probability_pct: number | null;
  weighted_value_eur: number | null;
  estimated_close_date: string | null;
  next_action: string | null;
  next_action_due: string | null;
  company_name: string | null;
  company_id: string | null;
}

// Stint 64.Q.7 — pipeline merged. Order = real legal-services
// progression after Outreach was folded in: cold-identified → warm
// → first-touch → meeting → proposal → negotiation → won/lost.
const STAGE_ORDER: OpportunityStage[] = [
  'cold_identified', 'warm', 'first_touch', 'meeting_held',
  'proposal_sent', 'in_negotiation', 'won', 'lost',
];

const STAGE_TONE: Record<OpportunityStage, { header: string; border: string }> = {
  cold_identified: { header: 'bg-slate-100 text-slate-700',     border: 'border-slate-300' },
  warm:            { header: 'bg-blue-100 text-blue-800',       border: 'border-blue-300' },
  first_touch:     { header: 'bg-yellow-100 text-yellow-800',   border: 'border-yellow-300' },
  meeting_held:    { header: 'bg-orange-100 text-orange-800',   border: 'border-orange-300' },
  proposal_sent:   { header: 'bg-red-100 text-red-800',         border: 'border-red-300' },
  in_negotiation:  { header: 'bg-purple-100 text-purple-800',   border: 'border-purple-300' },
  won:             { header: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-300' },
  lost:            { header: 'bg-pink-100 text-pink-800',       border: 'border-pink-300' },
};

export function PipelineKanban({
  rows, onStageChange,
}: {
  rows: OppCard[];
  onStageChange: (id: string, newStage: string) => Promise<void> | void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Group rows by stage.
  const byStage: Record<string, OppCard[]> = {};
  for (const s of STAGE_ORDER) byStage[s] = [];
  for (const r of rows) {
    if (byStage[r.stage]) byStage[r.stage].push(r);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STAGE_ORDER.map(stage => {
        const items = byStage[stage] ?? [];
        const total = items.reduce((s, o) => s + Number(o.weighted_value_eur ?? 0), 0);
        const tone = STAGE_TONE[stage];
        const isDropTarget = dropTarget === stage;
        return (
          <div
            key={stage}
            onDragOver={e => {
              e.preventDefault();
              if (dragId) setDropTarget(stage);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={async e => {
              e.preventDefault();
              if (dragId) {
                const movingCard = rows.find(r => r.id === dragId);
                if (movingCard && movingCard.stage !== stage) {
                  await onStageChange(dragId, stage);
                }
              }
              setDragId(null);
              setDropTarget(null);
            }}
            className={`flex-1 min-w-[240px] max-w-[320px] flex flex-col border rounded-lg ${isDropTarget ? `${tone.border} ring-2 ring-offset-1 ring-brand-400` : tone.border}`}
          >
            <div className={`px-3 py-2 rounded-t-lg flex items-center justify-between ${tone.header}`}>
              <span className="text-xs font-semibold uppercase tracking-wide">
                {LABELS_STAGE[stage]}
              </span>
              <span className="text-2xs font-mono">{items.length}</span>
            </div>
            <div className="flex-1 p-2 flex flex-col gap-2 bg-surface-alt/30 min-h-[100px]">
              {items.map(opp => (
                <KanbanCard
                  key={opp.id}
                  opp={opp}
                  onDragStart={() => setDragId(opp.id)}
                  onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                  isDragging={dragId === opp.id}
                />
              ))}
              {items.length === 0 && (
                <div className="text-xs text-ink-faint italic text-center py-4">Drag cards here</div>
              )}
            </div>
            {total > 0 && (
              <div className="px-3 py-1.5 text-2xs text-ink-muted border-t border-border bg-white rounded-b-lg font-mono tabular-nums">
                Σ weighted {formatEur(total)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  opp, onDragStart, onDragEnd, isDragging,
}: {
  opp: OppCard;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const daysInStage = opp.stage_entered_at
    ? Math.floor((Date.now() - new Date(opp.stage_entered_at).getTime()) / 86400000)
    : null;
  const stale = daysInStage !== null && daysInStage > 14 && !['won', 'lost'].includes(opp.stage);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`bg-white border border-border rounded-md px-2.5 py-2 shadow-sm hover:shadow transition-shadow cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <Link
        href={`/crm/opportunities/${opp.id}`}
        className="block text-sm font-medium text-ink hover:underline truncate"
        onClick={e => { if (isDragging) e.preventDefault(); }}
      >
        {opp.name}
      </Link>
      {opp.company_name && (
        <div className="text-2xs text-ink-muted truncate mt-0.5">{opp.company_name}</div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-2xs">
        <span className="tabular-nums font-medium text-ink">{formatEur(opp.weighted_value_eur)}</span>
        {opp.probability_pct !== null && (
          <span className="text-ink-muted">{opp.probability_pct}%</span>
        )}
        {daysInStage !== null && (
          <span className={`ml-auto tabular-nums ${stale ? 'text-danger-700 font-medium' : 'text-ink-faint'}`}
            title={stale ? `Stale — ${daysInStage}d in this stage` : undefined}>
            {daysInStage}d
          </span>
        )}
      </div>
      {opp.next_action && (
        <div className="mt-1 text-2xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 truncate" title={opp.next_action}>
          → {opp.next_action}
          {opp.next_action_due && <span className="ml-1 text-amber-700 font-mono">{formatDate(opp.next_action_due)}</span>}
        </div>
      )}
    </div>
  );
}
