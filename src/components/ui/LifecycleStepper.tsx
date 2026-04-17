// Horizontal declaration lifecycle stepper. Renders the 8 states from
// src/lib/lifecycle.ts in order, highlighting the current one in brand
// pink and collapsing completed ones to a check-mark. On narrow screens
// it compresses to "step N of 8 — <current label>" + a thin progress bar.

import { CheckIcon } from 'lucide-react';

const STEPS: Array<{ id: string; label: string; short: string }> = [
  { id: 'created',     label: 'Created',     short: 'Created' },
  { id: 'uploading',   label: 'Uploading',   short: 'Upload' },
  { id: 'extracting',  label: 'Extracting',  short: 'Extract' },
  { id: 'classifying', label: 'Classifying', short: 'Classify' },
  { id: 'review',      label: 'Review',      short: 'Review' },
  { id: 'approved',    label: 'Approved',    short: 'Approved' },
  { id: 'filed',       label: 'Filed',       short: 'Filed' },
  { id: 'paid',        label: 'Paid',        short: 'Paid' },
];

export function LifecycleStepper({ status }: { status: string }) {
  const activeIdx = Math.max(0, STEPS.findIndex(s => s.id === status));
  const currentLabel = STEPS[activeIdx]?.label ?? 'Unknown';
  const progressPct = ((activeIdx) / (STEPS.length - 1)) * 100;

  return (
    <div className="w-full">
      {/* Mobile compact: just step N of 8 + progress bar */}
      <div className="md:hidden">
        <div className="flex items-center justify-between text-[11.5px] mb-2">
          <span className="text-ink-muted">Step {activeIdx + 1} of {STEPS.length}</span>
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
        {STEPS.map((step, i) => {
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
