'use client';

// Small status chip for tax filings. Colors chosen to be legible at a
// glance in grid rows — not decorative.
//
// Stint 64.X.2 — provision filings have a DIFFERENT status enum
// (awaiting_fs / fs_received / working / sent / comments_received /
// finalized) with different semantics from filings (info_to_request /
// info_requested / working / draft_sent / client_approved / filed).
// Most call sites know which kind they're dealing with — the matrix
// Status column is filing-only, the TaxProvisionInlineCell renders
// provisions internally. But the cross-cutting Filings list at
// `/tax-ops/filings` and the entity detail's filings matrix mix both
// kinds; for those, callers pass `serviceKind` and the badge routes
// the label/tone accordingly. Default behaviour (no serviceKind) is
// the historical filing labels so existing call sites don't change.
//
// Status enum v4 (stint 49):
//   - new info_requested between info_to_request and working
//     (Diego: "puedo tener que pedir la información, pero si la he
//     pedido, necesito saber que hay un estatus que es que la he
//     pedido y que estoy esperando").
//
// Status enum v3 (stint 43):
//   - info_received fused into working (Diego: si tengo info, ya estoy trabajando)
//   - new partially_approved (some approvers signed off, others pending)
//   - new client_approved (all approvals received, pending to file)
//   - assessment_received removed (Diego doesn't track assessment as a status;
//       the date lives on tax_assessment_received_at + the CIT Assessment chip)
//   - blocked + waived removed (Diego: irrelevant in his workflow)
//
// Final order = workflow progression. The first option is the default for
// brand-new filings (still need to ask the client/CSP for info).

const STATUS_META: Record<string, { label: string; tone: string; description: string }> = {
  info_to_request: {
    label: 'Info to request',
    tone: 'bg-surface-alt text-ink-muted',
    description: 'Information not yet requested from the CSP / client. Next step: send them an email asking for what is missing.',
  },
  info_requested: {
    label: 'Info requested',
    tone: 'bg-amber-50 text-amber-800',
    description: 'Information requested from the CSP / client; awaiting reply. The "Last action" date shows when the request was sent; follow up if days pass with no answer.',
  },
  working: {
    label: 'Working',
    tone: 'bg-amber-100 text-amber-800',
    description: 'Information received; preparing the filing (covers receipt + active work).',
  },
  awaiting_client_clarification: {
    label: 'Awaiting clarification',
    tone: 'bg-amber-100 text-amber-900',
    description: 'A clarification email was sent to the client; awaiting their reply.',
  },
  draft_sent: {
    label: 'Draft sent',
    tone: 'bg-brand-100 text-brand-800',
    description: 'Draft sent to the client for approval.',
  },
  partially_approved: {
    label: 'Partially approved',
    tone: 'bg-blue-100 text-blue-800',
    description: 'One or more approvers have signed, but others are still pending (typically directors who sign jointly).',
  },
  client_approved: {
    label: 'Client approved',
    tone: 'bg-blue-200 text-blue-900',
    description: 'All approvals received. Pending submission to the AED.',
  },
  filed: {
    label: 'Filed',
    tone: 'bg-green-100 text-green-800',
    description: 'Filed with the AED; client notified with the receipt.',
  },
};

/** Order reflects the real workflow progression. The status filter
 *  dropdown + edit selects render in this order. */
export const FILING_STATUSES = [
  'info_to_request',
  'info_requested',
  'working',
  'awaiting_client_clarification',
  'draft_sent',
  'partially_approved',
  'client_approved',
  'filed',
];

// ─────────────────── Provision status enum (stint 64.X.2) ───────────────────
// Kept side-by-side with the filing meta so cross-cutting screens (the
// /tax-ops/filings list, /tax-ops/filings/[id] detail, EntityFilingsMatrix)
// can render the correct labels for provision rows. The provision UX
// authority lives in TaxProvisionInlineCell — those labels here are
// kept identical to that component so a status looks the same wherever
// it's surfaced.

// Stint 64.X.2.b — exported so TaxProvisionInlineCell shares the same
// source of truth (no more duplicated meta drifting out of sync).
export const PROVISION_STATUS_META: Record<string, { label: string; tone: string; description: string }> = {
  awaiting_fs: {
    label: 'Awaiting FS',
    tone: 'bg-surface-alt text-ink-muted',
    description: 'Waiting for the client to send the draft financial statements before we can start calculating the provision.',
  },
  fs_received: {
    label: 'FS received',
    tone: 'bg-amber-50 text-amber-800',
    description: 'Draft financial statements received. Next step: start calculating the provision.',
  },
  working: {
    label: 'Calculating',
    tone: 'bg-amber-100 text-amber-800',
    description: 'Working on the tax provision calculation from the draft FS.',
  },
  sent: {
    label: 'Sent — awaiting feedback',
    tone: 'bg-brand-100 text-brand-800',
    description: 'Provision sent to the client. Awaiting confirmation or comments. If a week passes with no reply, assume finalized (status edited manually).',
  },
  comments_received: {
    label: 'Comments received',
    tone: 'bg-orange-100 text-orange-900',
    description: 'Client returned comments on the provision — needs review and re-send. Move back to "Calculating" once the review starts.',
  },
  finalized: {
    label: 'Finalized',
    tone: 'bg-green-100 text-green-800',
    description: 'Provision approved by the client. Next step in this cycle is the final CIT return once the final FS arrive.',
  },
};

/** Stint 64.X.2.b — convenience label helper for callers that don't
 *  need the full badge component. */
export function provisionStatusLabel(s: string): string {
  return PROVISION_STATUS_META[s]?.label ?? s.replace(/_/g, ' ');
}

export const PROVISION_STATUSES = [
  'awaiting_fs',
  'fs_received',
  'working',
  'sent',
  'comments_received',
  'finalized',
];

export type ServiceKind = 'filing' | 'provision' | 'review';

function pickMeta(status: string, serviceKind: ServiceKind | undefined) {
  if (serviceKind === 'provision') {
    return PROVISION_STATUS_META[status]
      ?? { label: status, tone: 'bg-surface-alt text-ink-muted', description: '' };
  }
  // Default + 'filing' + 'review' use the filing meta. Reviews historically
  // share the filing enum (Diego: review = lighter filing, no separate
  // status semantics needed today).
  return STATUS_META[status]
    ?? { label: status, tone: 'bg-surface-alt text-ink-muted', description: '' };
}

export function FilingStatusBadge({
  status, serviceKind,
}: { status: string; serviceKind?: ServiceKind }) {
  const meta = pickMeta(status, serviceKind);
  return (
    <span
      // Stint 64.X.8 — `whitespace-nowrap` so a 14-char status like
      // "Info to request" doesn't wrap to 2 lines inside narrow matrix
      // columns (Diego: tablas chirrían — referencia Linear / HubSpot
      // tightness). The cell can scroll horizontally if needed; we
      // never want a status to look like 2-row text.
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${meta.tone}`}
      title={meta.description ? `${meta.label} — ${meta.description}` : meta.label}
    >
      {meta.label}
    </span>
  );
}

export function filingStatusLabel(status: string, serviceKind?: ServiceKind): string {
  return pickMeta(status, serviceKind).label;
}

export function filingStatusDescription(status: string, serviceKind?: ServiceKind): string {
  return pickMeta(status, serviceKind).description;
}

/** Stint 64.X.2 — explicit provision-only badge for callers that
 *  always render provisions (e.g. TaxProvisionInlineCell). Convenience
 *  wrapper around the same routing logic. */
export function ProvisionStatusBadge({ status }: { status: string }) {
  return <FilingStatusBadge status={status} serviceKind="provision" />;
}
