// Horizontal declaration lifecycle stepper.
//
// The engine (src/lib/lifecycle.ts) tracks 8 DB states:
//   created → uploading → extracting → classifying → review → approved → filed → paid
//
// The reviewer does not need to see `extracting` and `classifying` as
// two separate user-facing steps — architecturally they are (Extract is
// the Haiku OCR+parse call, Classify is the deterministic rules engine)
// but for the VAT practitioner they feel like one phase ("the system
// is processing the uploads"). This stepper collapses them to a single
// visible "Processing" step while the underlying status field keeps
// its 8-value granularity for audit / telemetry / retry logic.
//
// Diego's call 2026-04-21: "No entiendo por qué hay fase de upload y
// luego extract y luego classify. ¿Cuál es la finalidad de extract?"
// → correct. Implementation leaked into the UI. Fixed below.

import { CheckIcon } from 'lucide-react';

interface VisibleStep {
  id: string;
  label: string;
  short: string;
  /** DB statuses that count as "on this visible step". First entry is
   *  the canonical status when we render the step as current. */
  dbStatuses: string[];
}

const BASE_STEPS: VisibleStep[] = [
  { id: 'created',    label: 'Created',    short: 'Created',    dbStatuses: ['created'] },
  { id: 'upload',     label: 'Upload',     short: 'Upload',     dbStatuses: ['uploading'] },
  // `processing` folds extracting + classifying: the Haiku extractor
  // run followed by the deterministic rules pass. The reviewer sees
  // them as one phase.
  { id: 'processing', label: 'Processing', short: 'Processing', dbStatuses: ['extracting', 'classifying'] },
  { id: 'review',     label: 'Review',     short: 'Review',     dbStatuses: ['review'] },
  { id: 'approved',   label: 'Approved',   short: 'Approved',   dbStatuses: ['approved'] },
  { id: 'filed',      label: 'Filed',      short: 'Filed',      dbStatuses: ['filed'] },
  { id: 'paid',       label: 'Paid',       short: 'Paid',       dbStatuses: ['paid'] },
];

const PARTNER_REVIEW_STEP: VisibleStep = {
  id: 'pending_review', label: 'Partner review', short: 'Partner', dbStatuses: ['pending_review'],
};

function buildVisibleSteps(requiresPartnerReview: boolean): VisibleStep[] {
  if (!requiresPartnerReview) return BASE_STEPS;
  // Insert partner-review between Review and Approved.
  const out: VisibleStep[] = [];
  for (const step of BASE_STEPS) {
    out.push(step);
    if (step.id === 'review') out.push(PARTNER_REVIEW_STEP);
  }
  return out;
}

function findStepIndex(status: string, steps: VisibleStep[]): number {
  const idx = steps.findIndex(s => s.dbStatuses.includes(status));
  return idx === -1 ? 0 : idx;
}

export function LifecycleStepper({
  status,
  requiresPartnerReview,
}: {
  status: string;
  /** When the entity opts into two-step approval (migration 023), the
   *  stepper shows an extra "Partner review" node between Review and
   *  Approved. Defaults to the base 7-step bar. */
  requiresPartnerReview?: boolean;
}) {
  const steps = buildVisibleSteps(!!requiresPartnerReview);
  const activeIdx = findStepIndex(status, steps);
  const currentLabel = steps[activeIdx]?.label ?? 'Unknown';
  const progressPct = (activeIdx / Math.max(1, steps.length - 1)) * 100;

  return (
    <div className="w-full">
      {/* Mobile compact: just step N of total + progress bar */}
      <div className="md:hidden">
        <div className="flex items-center justify-between text-[11.5px] mb-2">
          <span className="text-ink-muted">Step {activeIdx + 1} of {steps.length}</span>
          <span className="font-semibold text-brand-600">{currentLabel}</span>
        </div>
        <div className="h-1.5 w-full bg-surface-alt rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Desktop: full horizontal stepper */}
      <ol className="hidden md:flex items-center gap-0 w-full">
        {steps.map((step, i) => {
          const isDone = i < activeIdx;
          const isCurrent = i === activeIdx;

          const circleClasses = isCurrent
            ? 'bg-brand-500 text-white ring-4 ring-brand-100'
            : isDone
              ? 'bg-success-500 text-white'
              : 'bg-surface-alt text-ink-faint border border-border';

          const labelClasses = isCurrent
            ? 'text-brand-700 font-semibold'
            : isDone
              ? 'text-ink-soft'
              : 'text-ink-faint';

          const connectorClasses = i > 0
            ? (isDone || isCurrent ? 'bg-success-500' : 'bg-border')
            : '';

          return (
            <li
              key={step.id}
              className="relative flex-1 flex flex-col items-center"
              aria-current={isCurrent ? 'step' : undefined}
              title={
                step.id === 'processing'
                  ? 'Processing combines two internal steps: extraction (AI reads the invoices and pulls the fields) and classification (deterministic rules assign a treatment code to every line).'
                  : undefined
              }
            >
              {/* Connector line to previous step */}
              {i > 0 && (
                <span
                  className={`absolute top-3 right-[50%] w-full h-0.5 ${connectorClasses}`}
                  aria-hidden="true"
                />
              )}

              {/* Step circle */}
              <div
                className={`relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums z-10 transition-all duration-200 ${circleClasses}`}
              >
                {isDone ? <CheckIcon size={11} strokeWidth={3} /> : i + 1}
              </div>

              {/* Step label */}
              <span className={`mt-1.5 text-[10.5px] tracking-tight text-center ${labelClasses}`}>
                {step.short}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
