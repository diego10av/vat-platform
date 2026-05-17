'use client';

// AED inbox — letters received from the Luxembourg tax authority.
// Each letter is auto-read by Claude on upload, producing type + urgency
// + deadline_date + summary + suggested next_action. The reviewer's job
// here is: scan the queue, open the PDF to verify, and resolve
// (mark reviewed / actioned / archived). Design goal: the urgent items
// jump at you, the archived ones disappear.

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  InboxIcon, UploadCloudIcon, ExternalLinkIcon,
  FileTextIcon, CheckCircle2Icon, ArchiveIcon,
  AlertOctagonIcon, MailIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Stat } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/Toaster';

interface AEDComm {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  filename: string;
  file_size: number;
  type: string | null;
  amount: number | null;
  reference: string | null;
  deadline_date: string | null;
  urgency: string | null;
  summary: string | null;
  status: string;
  uploaded_at: string;
  // Stint 94 — Haiku extracts a suggested next_action at upload time;
  // pre-94 it was stored but invisible to the UI. Now displayed read-
  // only on the card so Diego sees the suggestion at a glance.
  next_action: string | null;
  // Stint 94 — free-text notes (mig 092). Inline-editable below the
  // summary, owned by Diego (chase history, response drafts, etc.).
  notes: string | null;
}
interface Entity { id: string; name: string; }

type StatusFilter = 'all' | 'open' | 'archived';
type UrgencyFilter = 'all' | 'high' | 'medium' | 'low';

export default function AEDLettersPage() {
  const [letters, setLetters] = useState<AEDComm[] | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  // Read initial urgency filter from URL — the home dashboard's
  // "AED letters urgent" card link drops users here with ?urgency=high.
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    const u = new URLSearchParams(window.location.search).get('urgency') ?? '';
    return u === 'high' || u === 'medium' || u === 'low' ? u : 'all';
  });
  const [entityFilter, setEntityFilter] = useState<string>('');
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  function load() {
    fetch('/api/aed').then(r => r.json()).then(setLetters);
  }
  useEffect(() => {
    load();
    fetch('/api/entities').then(r => r.json()).then(setEntities);
  }, []);

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    let okCount = 0;
    let failCount = 0;
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.set('file', f);
      if (selectedEntity) form.set('entity_id', selectedEntity);
      const res = await fetch('/api/aed/upload', { method: 'POST', body: form });
      if (res.ok) okCount++; else failCount++;
    }
    setUploading(false);
    if (okCount > 0) {
      toast.success(`${okCount} letter${okCount === 1 ? '' : 's'} uploaded — Claude is reading${failCount > 0 ? ` · ${failCount} failed` : ''}`);
    } else if (failCount > 0) {
      toast.error(`Upload failed (${failCount} letter${failCount === 1 ? '' : 's'})`);
    }
    load();
  }
  async function setStatus(id: string, status: string) {
    const res = await fetch(`/api/aed/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error('Could not update letter status');
      return;
    }
    toast.success(`Letter marked ${status}`);
    load();
  }

  // Stint 94 — inline-save helper for free-text fields on a letter.
  async function patchField(id: string, field: 'notes' | 'next_action', value: string | null) {
    const res = await fetch(`/api/aed/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      toast.error(`Could not save ${field.replace('_', ' ')}`);
      return;
    }
    // Optimistic local update — no full reload needed, fields are
    // free text and have no JOIN-derived siblings.
    setLetters(prev => prev?.map(l =>
      l.id === id ? { ...l, [field]: value } : l,
    ) ?? null);
  }
  async function openLetter(id: string) {
    const res = await fetch(`/api/aed/${id}?action=url`);
    const d = await res.json();
    if (d.url) window.open(d.url, '_blank', 'noopener');
  }

  if (letters === null) return <PageSkeleton />;

  const counts = {
    total: letters.length,
    urgent: letters.filter(l => l.urgency === 'high' && l.status !== 'archived' && l.status !== 'actioned').length,
    open: letters.filter(l => l.status === 'received' || l.status === 'reviewed').length,
    actioned: letters.filter(l => l.status === 'actioned').length,
  };

  const visible = letters.filter(l => {
    if (statusFilter === 'open' && !(l.status === 'received' || l.status === 'reviewed')) return false;
    if (statusFilter === 'archived' && l.status !== 'archived') return false;
    if (urgencyFilter !== 'all' && l.urgency !== urgencyFilter) return false;
    if (entityFilter && l.entity_id !== entityFilter) return false;
    return true;
  }).sort((a, b) => {
    // Urgent first, then by deadline, then by recency
    const urgRank = (u: string | null) => u === 'high' ? 0 : u === 'medium' ? 1 : 2;
    const ua = urgRank(a.urgency), ub = urgRank(b.urgency);
    if (ua !== ub) return ua - ub;
    if (a.deadline_date && b.deadline_date) return a.deadline_date.localeCompare(b.deadline_date);
    if (a.deadline_date) return -1;
    if (b.deadline_date) return 1;
    return b.uploaded_at.localeCompare(a.uploaded_at);
  });

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title="AED inbox"
        subtitle="Letters received from the Luxembourg tax authority. Claude auto-reads each one on upload and extracts type, deadline, amount and suggested next action."
        actions={
          <Button
            variant="primary"
            icon={<UploadCloudIcon size={14} />}
            onClick={() => fileInput.current?.click()}
            loading={uploading}
          >
            Upload AED letter
          </Button>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        multiple
        className="hidden"
        onChange={e => handleUpload(e.target.files)}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Total letters" value={counts.total} />
        <Stat label="Urgent open" value={counts.urgent} tone={counts.urgent > 0 ? 'danger' : 'muted'} />
        <Stat label="Open" value={counts.open} tone={counts.open > 0 ? 'warning' : 'muted'} />
        <Stat label="Actioned" value={counts.actioned} tone="success" />
      </div>

      {/* Upload drop-zone + entity selector */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="block text-2xs uppercase tracking-[0.06em] font-semibold text-ink-muted mb-1.5">
              Assign to entity (optional)
            </label>
            <select
              value={selectedEntity}
              onChange={e => setSelectedEntity(e.target.value)}
              className="w-full h-9 border border-border rounded-md px-3 text-sm bg-surface focus-visible:ring-2 focus-visible:ring-brand-500/20"
            >
              <option value="">— unassigned —</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <p className="text-xs text-ink-muted mt-1.5">
              If you assign an entity, the letter will appear on that entity&rsquo;s page. You can also leave it unassigned and link it later.
            </p>
          </div>
          <Button
            variant="secondary"
            size="lg"
            icon={<UploadCloudIcon size={15} />}
            onClick={() => fileInput.current?.click()}
            loading={uploading}
          >
            {uploading ? 'Uploading & classifying…' : 'Upload'}
          </Button>
        </div>
      </div>

      {/* Filter chips: status (left group) + urgency + entity (right) */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-1">
          <FilterChip active={statusFilter === 'open'}     onClick={() => setStatusFilter('open')}>
            Open <Count active={statusFilter === 'open'} value={counts.open} />
          </FilterChip>
          <FilterChip active={statusFilter === 'all'}      onClick={() => setStatusFilter('all')}>
            All <Count active={statusFilter === 'all'} value={counts.total} />
          </FilterChip>
          <FilterChip active={statusFilter === 'archived'} onClick={() => setStatusFilter('archived')}>
            Archived <Count active={statusFilter === 'archived'} value={counts.total - counts.open - counts.actioned} />
          </FilterChip>
        </div>
        <div className="h-5 w-px bg-divider" aria-hidden />
        <div className="flex items-center gap-1">
          <span className="text-2xs uppercase tracking-wider text-ink-faint font-semibold mr-1">Urgency</span>
          {(['all', 'high', 'medium', 'low'] as const).map(u => (
            <FilterChip key={u} active={urgencyFilter === u} onClick={() => setUrgencyFilter(u)}>
              {u === 'all' ? 'All' : u.charAt(0).toUpperCase() + u.slice(1)}
            </FilterChip>
          ))}
        </div>
        <div className="h-5 w-px bg-divider" aria-hidden />
        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
          className="h-7 text-xs px-2 rounded-md border border-border bg-surface text-ink-soft hover:border-border-strong"
          aria-label="Filter by entity"
        >
          <option value="">All entities</option>
          {entities.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {(urgencyFilter !== 'all' || entityFilter) && (
          <button
            type="button"
            onClick={() => { setUrgencyFilter('all'); setEntityFilter(''); }}
            className="text-2xs text-ink-muted hover:text-ink underline ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Letters list */}
      {visible.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl shadow-xs">
          <EmptyState
            illustration={statusFilter === 'open' ? 'empty_approved' : 'empty_inbox'}
            title={statusFilter === 'open' ? 'Inbox is clear' : 'No letters here'}
            description={
              statusFilter === 'open'
                ? 'No AED letters awaiting action right now. When you upload a letter, Claude reads it and it lands here with a suggested next step + per-category appeal deadline.'
                : 'Try switching the filter, or upload an AED letter to see it classified automatically.'
            }
            action={
              <Button
                variant="primary"
                icon={<UploadCloudIcon size={14} />}
                onClick={() => fileInput.current?.click()}
              >
                Upload AED letter
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map(l => (
            <LetterCard
              key={l.id}
              letter={l}
              onOpen={() => openLetter(l.id)}
              onSetStatus={(s) => setStatus(l.id, s)}
              onSaveNotes={(v) => patchField(l.id, 'notes', v)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LetterCard({
  letter, onOpen, onSetStatus, onSaveNotes,
}: {
  letter: AEDComm;
  onOpen: () => void;
  onSetStatus: (status: string) => void;
  onSaveNotes: (next: string | null) => Promise<void>;
}) {
  const isUrgent = letter.urgency === 'high' && letter.status !== 'archived' && letter.status !== 'actioned';
  const isArchived = letter.status === 'archived';

  return (
    <li
      className={[
        'bg-surface border rounded-xl shadow-xs transition-all duration-150',
        'hover:shadow-md',
        isUrgent
          ? 'border-l-[3px] border-l-danger-500 border-t-border border-r-border border-b-border'
          : isArchived
            ? 'border-border opacity-70'
            : 'border-border',
      ].join(' ')}
    >
      <div className="p-4 flex items-start gap-4">
        {/* Icon */}
        <div className={[
          'w-9 h-9 rounded-lg inline-flex items-center justify-center shrink-0',
          isUrgent ? 'bg-danger-50 text-danger-700' :
          letter.urgency === 'medium' ? 'bg-warning-50 text-warning-700' :
          'bg-surface-alt text-ink-muted',
        ].join(' ')}>
          {isUrgent ? <AlertOctagonIcon size={16} /> : <MailIcon size={16} />}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <TypePill type={letter.type} />
                <UrgencyPill urgency={letter.urgency} />
                {letter.reference && (
                  <span className="text-xs font-mono text-ink-muted bg-surface-alt px-1.5 py-0.5 rounded">
                    {letter.reference}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-sm font-medium text-ink">
                {letter.entity_name ?? (
                  <span className="text-ink-muted italic">Unassigned</span>
                )}
              </div>
              {letter.summary ? (
                <p className="text-sm text-ink-soft mt-1.5 leading-relaxed line-clamp-2">
                  {letter.summary}
                </p>
              ) : (
                <p className="text-sm text-ink-muted mt-1.5 italic">
                  No summary yet — <button onClick={onOpen} className="text-brand-600 hover:underline">open to review</button>.
                </p>
              )}
              {/* Stint 94 — Haiku's extracted next-action suggestion. Read-
                  only by design (it's an AI proposal, kept stable as evidence).
                  Diego's own running thoughts live in the Notes field below. */}
              {letter.next_action && (
                <p className="text-xs text-ink-muted mt-1.5 inline-flex items-center gap-1.5">
                  <span className="text-2xs uppercase tracking-wide font-semibold text-ink-faint">Suggested</span>
                  <span className="text-ink-soft">{letter.next_action}</span>
                </p>
              )}
            </div>

            {/* Right rail — amount + deadline */}
            <div className="shrink-0 text-right">
              {letter.amount != null && (
                <div className="text-base font-bold text-ink tabular-nums tracking-tight">
                  €{Number(letter.amount).toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
              {letter.deadline_date && (
                <div className="text-xs text-ink-muted mt-1">
                  Deadline {formatDate(letter.deadline_date)}
                </div>
              )}
              <StatusPill status={letter.status} className="mt-1.5" />
            </div>
          </div>

          {/* Actions */}
          {/* Stint 94 — inline-editable Notes field. The big real-world
              gap: when Diego chased the client / drafted a response /
              waited for AED, he had nowhere to capture it inside cifra.
              Now it lives on the card itself. Click → textarea →
              click-outside or blur to save. */}
          <NotesField
            value={letter.notes}
            onSave={onSaveNotes}
          />

          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-divider flex-wrap">
            <button
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              <ExternalLinkIcon size={12} /> Open PDF
            </button>
            {letter.entity_id && (
              <Link
                href={`/entities/${letter.entity_id}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
              >
                <FileTextIcon size={12} /> View entity
              </Link>
            )}
            <div className="flex-1" />
            {letter.status === 'received' && (
              <button
                onClick={() => onSetStatus('reviewed')}
                className="h-7 px-2.5 rounded-md border border-border text-xs font-medium text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
              >
                <CheckCircle2Icon size={12} /> Mark reviewed
              </button>
            )}
            {letter.status === 'reviewed' && (
              <button
                onClick={() => onSetStatus('actioned')}
                className="h-7 px-2.5 rounded-md bg-success-500 text-white text-xs font-semibold hover:bg-success-700 inline-flex items-center gap-1.5"
              >
                <CheckCircle2Icon size={12} /> Mark actioned
              </button>
            )}
            {letter.status !== 'archived' && (
              <button
                onClick={() => onSetStatus('archived')}
                className="h-7 px-2.5 rounded-md text-xs font-medium text-ink-muted hover:text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
              >
                <ArchiveIcon size={12} /> Archive
              </button>
            )}
            {letter.status === 'archived' && (
              <button
                onClick={() => onSetStatus('received')}
                className="h-7 px-2.5 rounded-md text-xs font-medium text-ink-muted hover:text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
              >
                Restore
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ═════════════════ Small presentational components ═════════════════

function TypePill({ type }: { type: string | null }) {
  if (!type) return <Badge tone="neutral">Unclassified</Badge>;
  const map: Record<string, { tone: 'danger' | 'warning' | 'amber' | 'neutral' | 'info' | 'violet'; label: string }> = {
    extrait_de_compte:           { tone: 'neutral', label: 'Account statement' },
    fixation_d_acompte:          { tone: 'danger',  label: 'Provisional assessment' },
    taxation_d_office:           { tone: 'danger',  label: "Taxation d'office" },
    bulletin_d_information:      { tone: 'warning', label: 'Tax assessment' },
    demande_de_renseignements:   { tone: 'amber',   label: 'Info request' },
    mise_en_demeure:             { tone: 'danger',  label: 'Formal demand' },
    decision_de_redressement:    { tone: 'danger',  label: 'Reassessment' },
    rappel:                      { tone: 'warning', label: 'Reminder' },
    attestation:                 { tone: 'info',    label: 'Attestation' },
    decision_remboursement:      { tone: 'info',    label: 'Refund decision' },
    relance_simple:              { tone: 'amber',   label: 'Friendly reminder' },
    courrier_amiable:            { tone: 'warning', label: 'Settlement offer' },
    sursis_de_paiement:          { tone: 'info',    label: 'Payment deferral' },
    remise_gracieuse:            { tone: 'violet',  label: 'Discretionary waiver' },
    demande_caution:             { tone: 'warning', label: 'Security request' },
    notification_controle:       { tone: 'danger',  label: 'Audit opening' },
    pv_de_controle:              { tone: 'danger',  label: 'Audit closing PV' },
    other:                       { tone: 'neutral', label: 'Other' },
  };
  const entry = map[type] ?? { tone: 'neutral' as const, label: type.replace(/_/g, ' ') };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

function UrgencyPill({ urgency }: { urgency: string | null }) {
  if (!urgency) return null;
  const map: Record<string, { tone: 'danger' | 'warning' | 'neutral'; label: string }> = {
    high:   { tone: 'danger',  label: 'Urgent' },
    medium: { tone: 'warning', label: 'Medium' },
    low:    { tone: 'neutral', label: 'Low' },
  };
  const entry = map[urgency] ?? { tone: 'neutral' as const, label: urgency };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

function StatusPill({ status, className = '' }: { status: string; className?: string }) {
  const map: Record<string, { tone: 'info' | 'violet' | 'success' | 'neutral'; label: string }> = {
    received: { tone: 'info',    label: 'Received' },
    reviewed: { tone: 'violet',  label: 'Reviewed' },
    actioned: { tone: 'success', label: 'Actioned' },
    archived: { tone: 'neutral', label: 'Archived' },
  };
  const entry = map[status] ?? { tone: 'neutral' as const, label: status };
  return (
    <span className={className}>
      <Badge tone={entry.tone}>{entry.label}</Badge>
    </span>
  );
}

// Stint 94 — inline-editable notes. Diego owns this field (Haiku
// never touches notes; only Diego writes). Click-outside / blur saves;
// ESC reverts. Empty value is allowed (saved as null).
function NotesField({
  value, onSave,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  async function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === value) return;
    setBusy(true);
    try { await onSave(next); } finally { setBusy(false); }
  }

  function cancel() {
    setDraft(value ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mt-3 px-3 py-2 rounded-md border border-brand-200 bg-brand-50/30">
        <div className="text-2xs uppercase tracking-wide font-semibold text-brand-700 mb-1">
          Notes
        </div>
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          onBlur={() => void commit()}
          rows={3}
          placeholder="Chase the client / draft reply / status of the response…"
          className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface resize-y"
          disabled={busy}
        />
        <div className="text-2xs text-ink-faint mt-1">
          Click away or press ESC to {busy ? 'save…' : 'finish'}.
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-3 w-full text-left px-3 py-2 rounded-md border border-dashed border-border bg-surface-alt/30 hover:bg-surface-alt/50 transition-colors"
    >
      <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">
        Notes
      </div>
      {value ? (
        <p className="text-sm text-ink-soft whitespace-pre-wrap leading-relaxed">{value}</p>
      ) : (
        <p className="text-sm text-ink-faint italic">+ Add notes (chase, response draft, status…)</p>
      )}
    </button>
  );
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-all',
        active
          ? 'bg-brand-500 text-white shadow-xs'
          : 'bg-surface border border-border text-ink-soft hover:bg-surface-alt',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Count({ active, value }: { active: boolean; value: number }) {
  return (
    <span className={[
      'tabular-nums inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-2xs font-semibold',
      active ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700',
    ].join(' ')}>
      {value}
    </span>
  );
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}
