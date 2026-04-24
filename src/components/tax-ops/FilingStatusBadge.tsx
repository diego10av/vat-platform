'use client';

// Small status chip for filings. Colors chosen to be legible at a glance
// in grid rows — not decorative.

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending_info:            { label: 'Pending info',         tone: 'bg-surface-alt text-ink-muted' },
  info_received:           { label: 'Info received',        tone: 'bg-blue-100 text-blue-800' },
  working:                 { label: 'Working',              tone: 'bg-amber-100 text-amber-800' },
  draft_sent:              { label: 'Draft sent',           tone: 'bg-brand-100 text-brand-800' },
  pending_client_approval: { label: 'Pending approval',     tone: 'bg-amber-100 text-amber-800' },
  filed:                   { label: 'Filed',                tone: 'bg-green-100 text-green-800' },
  assessment_received:     { label: 'Assessment received',  tone: 'bg-green-200 text-green-900' },
  paid:                    { label: 'Paid',                 tone: 'bg-green-100 text-green-800' },
  waived:                  { label: 'Waived',               tone: 'bg-surface-alt text-ink-muted' },
  blocked:                 { label: 'Blocked',              tone: 'bg-danger-100 text-danger-800' },
};

export const FILING_STATUSES = Object.keys(STATUS_META);

export function FilingStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'bg-surface-alt text-ink-muted' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.tone}`}>
      {meta.label}
    </span>
  );
}

export function filingStatusLabel(status: string): string {
  return STATUS_META[status]?.label ?? status;
}
