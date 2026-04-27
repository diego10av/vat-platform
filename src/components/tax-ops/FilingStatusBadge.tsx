'use client';

// Small status chip for tax filings. Colors chosen to be legible at a
// glance in grid rows — not decorative.
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

export function FilingStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'bg-surface-alt text-ink-muted', description: '' };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.tone}`}
      title={meta.description ? `${meta.label} — ${meta.description}` : meta.label}
    >
      {meta.label}
    </span>
  );
}

export function filingStatusLabel(status: string): string {
  return STATUS_META[status]?.label ?? status;
}

export function filingStatusDescription(status: string): string {
  return STATUS_META[status]?.description ?? '';
}
