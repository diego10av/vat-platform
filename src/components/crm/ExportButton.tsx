'use client';

import { DownloadIcon } from 'lucide-react';

// ExportButton — downloads the list as an XLSX via /api/crm/export.
// Passes through optional extra query params (e.g. year filter for
// billing). The browser handles the file download natively through
// the Content-Disposition header from the API.

export function ExportButton({
  entity, extraParams, label,
}: {
  entity: 'companies' | 'contacts' | 'opportunities' | 'matters' | 'activities' | 'tasks' | 'billing';
  extraParams?: Record<string, string>;
  label?: string;
}) {
  const qs = new URLSearchParams({ entity, ...(extraParams ?? {}) }).toString();
  return (
    <a
      href={`/api/crm/export?${qs}`}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-[11.5px] text-ink-soft hover:bg-surface-alt hover:text-ink hover:border-border-strong transition-colors"
      title="Download as Excel (.xlsx)"
    >
      <DownloadIcon size={12} />
      {label ?? 'Export Excel'}
    </a>
  );
}
