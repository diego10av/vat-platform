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
}
interface Entity { id: string; name: string; }

type StatusFilter = 'all' | 'open' | 'archived';

export default function AEDLettersPage() {
  const [letters, setLetters] = useState<AEDComm[] | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const fileInput = useRef<HTMLInputElement>(null);

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
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.set('file', f);
      if (selectedEntity) form.set('entity_id', selectedEntity);
      await fetch('/api/aed/upload', { method: 'POST', body: form });
    }
    setUploading(false);
    load();
  }
  async function setStatus(id: string, status: string) {
    await fetch(`/api/aed/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
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
    if (statusFilter === 'open')     return l.status === 'received' || l.status === 'reviewed';
    if (statusFilter === 'archived') return l.status === 'archived';
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
            <label className="block text-[10.5px] uppercase tracking-[0.06em] font-semibold text-ink-muted mb-1.5">
              Assign to entity (optional)
            </label>
            <select
              value={selectedEntity}
              onChange={e => setSelectedEntity(e.target.value)}
              className="w-full h-9 border border-border rounded-md px-3 text-[13px] bg-surface focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20"
            >
              <option value="">— unassigned —</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <p className="text-[11px] text-ink-muted mt-1.5">
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

      {/* Filter chips */}
      <div className="flex items-center gap-1 mb-4">
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

      {/* Letters list */}
      {visible.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl shadow-xs">
          <EmptyState
            icon={<InboxIcon size={22} />}
            title={statusFilter === 'open' ? 'Inbox is clear' : 'No letters here'}
            description={
              statusFilter === 'open'
                ? 'No AED letters awaiting action right now. When a new letter is uploaded, Claude reads it and it lands here with a suggested next step.'
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
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LetterCard({
  letter, onOpen, onSetStatus,
}: {
  letter: AEDComm;
  onOpen: () => void;
  onSetStatus: (status: string) => void;
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
                  <span className="text-[11px] font-mono text-ink-muted bg-surface-alt px-1.5 py-0.5 rounded">
                    {letter.reference}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[13px] font-medium text-ink">
                {letter.entity_name ?? (
                  <span className="text-ink-muted italic">Unassigned</span>
                )}
              </div>
              {letter.summary ? (
                <p className="text-[12.5px] text-ink-soft mt-1.5 leading-relaxed line-clamp-2">
                  {letter.summary}
                </p>
              ) : (
                <p className="text-[12px] text-ink-muted mt-1.5 italic">
                  No summary yet — <button onClick={onOpen} className="text-brand-600 hover:underline">open to review</button>.
                </p>
              )}
            </div>

            {/* Right rail — amount + deadline */}
            <div className="shrink-0 text-right">
              {letter.amount != null && (
                <div className="text-[15px] font-bold text-ink tabular-nums tracking-tight">
                  €{Number(letter.amount).toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
              {letter.deadline_date && (
                <div className="text-[11px] text-ink-muted mt-1">
                  Deadline {formatDate(letter.deadline_date)}
                </div>
              )}
              <StatusPill status={letter.status} className="mt-1.5" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-divider flex-wrap">
            <button
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-600 hover:text-brand-700"
            >
              <ExternalLinkIcon size={12} /> Open PDF
            </button>
            {letter.entity_id && (
              <Link
                href={`/entities/${letter.entity_id}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted hover:text-ink"
              >
                <FileTextIcon size={12} /> View entity
              </Link>
            )}
            <div className="flex-1" />
            {letter.status === 'received' && (
              <button
                onClick={() => onSetStatus('reviewed')}
                className="h-7 px-2.5 rounded-md border border-border text-[11.5px] font-medium text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
              >
                <CheckCircle2Icon size={12} /> Mark reviewed
              </button>
            )}
            {letter.status === 'reviewed' && (
              <button
                onClick={() => onSetStatus('actioned')}
                className="h-7 px-2.5 rounded-md bg-success-500 text-white text-[11.5px] font-semibold hover:bg-success-700 inline-flex items-center gap-1.5"
              >
                <CheckCircle2Icon size={12} /> Mark actioned
              </button>
            )}
            {letter.status !== 'archived' && (
              <button
                onClick={() => onSetStatus('archived')}
                className="h-7 px-2.5 rounded-md text-[11.5px] font-medium text-ink-muted hover:text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
              >
                <ArchiveIcon size={12} /> Archive
              </button>
            )}
            {letter.status === 'archived' && (
              <button
                onClick={() => onSetStatus('received')}
                className="h-7 px-2.5 rounded-md text-[11.5px] font-medium text-ink-muted hover:text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
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

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium transition-all',
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
      'tabular-nums inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-semibold',
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
