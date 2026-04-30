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
    description: 'Aún no hemos pedido la información al CSP / cliente. Próximo paso: mandarles email pidiendo lo que falta.',
  },
  info_requested: {
    label: 'Info requested',
    tone: 'bg-amber-50 text-amber-800',
    description: 'Ya hemos pedido la información al CSP / cliente y estamos esperando respuesta. La fecha en "Last action" indica cuándo se mandó la petición; si pasan días sin respuesta, mandar follow-up.',
  },
  working: {
    label: 'Working',
    tone: 'bg-amber-100 text-amber-800',
    description: 'Tenemos la información y estamos preparando la declaración (incluye recepción + trabajo activo).',
  },
  awaiting_client_clarification: {
    label: 'Awaiting clarification',
    tone: 'bg-amber-100 text-amber-900',
    description: 'Hemos pedido al cliente una aclaración por email y estamos esperando su respuesta.',
  },
  draft_sent: {
    label: 'Draft sent',
    tone: 'bg-brand-100 text-brand-800',
    description: 'Borrador enviado al cliente para aprobación.',
  },
  partially_approved: {
    label: 'Partially approved',
    tone: 'bg-blue-100 text-blue-800',
    description: 'Uno o más aprobadores ya firmaron, pero faltan otros (típicamente directores que firman conjuntos).',
  },
  client_approved: {
    label: 'Client approved',
    tone: 'bg-blue-200 text-blue-900',
    description: 'Todas las aprobaciones recibidas. Pendiente de depositar la declaración con la AED.',
  },
  filed: {
    label: 'Filed',
    tone: 'bg-green-100 text-green-800',
    description: 'Depositada con la AED + cliente notificado con justificante.',
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

const PROVISION_STATUS_META: Record<string, { label: string; tone: string; description: string }> = {
  awaiting_fs: {
    label: 'Awaiting FS',
    tone: 'bg-surface-alt text-ink-muted',
    description: 'Esperando que el cliente nos mande el borrador de los estados financieros para empezar a calcular la provision.',
  },
  fs_received: {
    label: 'FS received',
    tone: 'bg-amber-50 text-amber-800',
    description: 'Hemos recibido el borrador de los estados financieros. Próximo paso: empezar a calcular la provision.',
  },
  working: {
    label: 'Calculating',
    tone: 'bg-amber-100 text-amber-800',
    description: 'Trabajando en el cálculo de la tax provision a partir del borrador de FS.',
  },
  sent: {
    label: 'Sent — awaiting feedback',
    tone: 'bg-brand-100 text-brand-800',
    description: 'Provision enviada al cliente. Esperando confirmación o comentarios.',
  },
  comments_received: {
    label: 'Comments received',
    tone: 'bg-orange-100 text-orange-900',
    description: 'El cliente ha enviado comentarios sobre la provision — necesita revisión y re-envío.',
  },
  finalized: {
    label: 'Finalized',
    tone: 'bg-green-100 text-green-800',
    description: 'Provision aprobada por el cliente. El siguiente paso de este ciclo es la declaración CIT final cuando llegan los FS finales.',
  },
};

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
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.tone}`}
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
