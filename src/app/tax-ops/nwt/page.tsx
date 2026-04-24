'use client';

// /tax-ops/nwt — Net wealth tax year-end ADVISORY REVIEWS.
//
// Not a filing. For opted-in clients only. Workflow: request interim
// financials ~Nov/Dec → check for tax leakage → propose restructuring.
// Output = a recommendation memo, not an AED submission.
//
// Columns specific to the review workflow: Active? (obligation toggle),
// Status, Prepared with, Interim financials received, Recommendation
// sent, Comments.
//
// "Show all entities" toggle lets Diego opt a new client in on the fly.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import { useMatrixData } from '@/components/tax-ops/useMatrixData';
import { FilingStatusBadge } from '@/components/tax-ops/FilingStatusBadge';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export default function NwtReviewsPage() {
  const [year, setYear] = useState(2025);
  const [showInactive, setShowInactive] = useState(false);

  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'nwt_annual',
    year,
    period_pattern: 'annual',
    service_kind: 'review',
    show_inactive: showInactive,
  });

  const columns: MatrixColumn[] = [
    {
      key: 'active',
      label: 'Opted-in',
      widthClass: 'w-[80px]',
      render: (e) => {
        if (e.obligation_id) {
          return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">
              Yes
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-surface-alt text-ink-muted">
            No
          </span>
        );
      },
    },
    {
      key: String(year),
      label: `Status ${year}`,
      widthClass: 'w-[140px]',
      render: (e) => {
        const cell = e.cells[String(year)];
        if (!cell) return <span className="text-ink-faint">—</span>;
        return <FilingStatusBadge status={cell.status} />;
      },
    },
    {
      key: 'deadline',
      label: 'Target date',
      widthClass: 'w-[130px]',
      render: (e) => {
        const cell = e.cells[String(year)];
        return <DateBadge value={cell?.deadline_date ?? null} mode="urgency" label="Target trigger date" />;
      },
    },
    {
      key: 'prepared_with',
      label: 'Prepared with',
      widthClass: 'w-[140px]',
      render: (e) => {
        const cell = e.cells[String(year)];
        if (!cell?.prepared_with?.length) return <span className="text-ink-faint">—</span>;
        return <span className="text-ink-soft">{cell.prepared_with.join(', ')}</span>;
      },
    },
    {
      key: 'interim_received',
      label: 'Interim financials',
      widthClass: 'w-[150px]',
      render: (e) => {
        // Re-uses draft_sent_at as "interim received" date — Diego can
        // repurpose in UI without a schema change. If needed later we add
        // a dedicated column (nwt_interim_received_at).
        const cell = e.cells[String(year)];
        if (!cell?.draft_sent_at) {
          return <span className="text-ink-faint">—</span>;
        }
        return (
          <span className="text-ink-soft text-[11.5px]">
            Received {cell.draft_sent_at}
          </span>
        );
      },
    },
    {
      key: 'recommendation',
      label: 'Recommendation sent',
      widthClass: 'w-[160px]',
      render: (e) => {
        // Re-uses filed_at as "recommendation sent" date on a review row.
        const cell = e.cells[String(year)];
        if (!cell?.filed_at) {
          return <span className="text-ink-faint">—</span>;
        }
        return (
          <span className="text-ink-soft text-[11.5px]">
            Sent {cell.filed_at}
          </span>
        );
      },
    },
    {
      key: 'comments',
      label: 'Comments',
      render: (e) => {
        const cell = e.cells[String(year)];
        const text = cell?.comments ?? '';
        if (!text) return <span className="text-ink-faint">—</span>;
        return (
          <span className="text-ink-soft line-clamp-2 text-[11.5px]" title={text}>
            {text}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="NWT reviews"
        subtitle="Year-end net wealth tax advisory review — interim financials (~Nov/Dec) to check for tax leakage and propose restructuring. Opted-in clients only. Not filed with AED."
      />

      <div className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-[12.5px]">
          <span className="text-ink-muted">Period year:</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-2 py-1 text-[12.5px] border border-border rounded-md bg-surface"
          >
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span className="text-ink-muted">Show all entities (to opt a new client in)</span>
        </label>
        {data && (
          <div className="ml-auto text-[11.5px] text-ink-muted">
            {data.entities.filter(e => e.obligation_id).length} opted-in
            {showInactive && ` · ${data.entities.length - data.entities.filter(e => e.obligation_id).length} available`}
          </div>
        )}
      </div>

      {error && <CrmErrorBox message={error} onRetry={refetch} />}

      {isLoading && !data && <PageSkeleton />}

      {data && (
        <TaxTypeMatrix
          entities={data.entities}
          columns={columns}
          firstColLabel="Entity"
          emptyMessage={
            showInactive
              ? 'No entities in the system. Add one via /tax-ops/entities.'
              : 'No entities are opted into NWT reviews. Toggle "Show all entities" to add one.'
          }
        />
      )}
    </div>
  );
}
