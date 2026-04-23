'use client';

// ════════════════════════════════════════════════════════════════════════
// CrmErrorBox — drop-in error state for any CRM surface that was
// previously hiding failures behind a permanent "Loading…" skeleton
// or an empty list. Pairs with useCrmFetch — when the hook returns
// an `error` string, render this.
// ════════════════════════════════════════════════════════════════════════

import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react';

export function CrmErrorBox({
  message, onRetry, compact = false,
}: {
  message: string;
  onRetry?: () => void | Promise<void>;
  compact?: boolean;
}) {
  return (
    <div
      className={`border border-danger-300 bg-danger-50 rounded-md flex items-start gap-3 ${
        compact ? 'p-2.5 text-[11.5px]' : 'p-3 text-[12.5px]'
      }`}
      role="alert"
    >
      <AlertTriangleIcon size={compact ? 14 : 16} className="shrink-0 mt-0.5 text-danger-700" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-danger-800">Couldn&apos;t load this section</div>
        <div className="text-danger-700 mt-0.5 break-words">{message}</div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-danger-400 text-[11.5px] font-semibold text-danger-800 hover:bg-danger-100"
        >
          <RefreshCwIcon size={11} />
          Retry
        </button>
      )}
    </div>
  );
}
