'use client';

// /tax-ops/nwt — NWT year-end advisory REVIEWS (not filings).

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, applyStatusChange, useClientGroups, filterEntitiesByStatus,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import {
  preparedWithColumn, lastChasedColumn, commentsColumn, deadlineColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { InlineDateCell } from '@/components/tax-ops/inline-editors';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';

// Tolerance usage below reads data.admin_tolerance_days.

const YEAR_OPTIONS = yearOptions();

export default function NwtReviewsPage() {
  const [year, setYear] = useState(2025);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();

  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'nwt_annual',
    year,
    period_pattern: 'annual',
    service_kind: 'review',
    show_inactive: showInactive,
  });

  const periodLabel = String(year);
  const filtered = filterEntitiesByStatus(
    data?.entities ?? [], statusFilter, [periodLabel],
  );
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    {
      key: 'active',
      label: 'Opted-in',
      widthClass: 'w-[80px]',
      render: (e) => (
        <span className={[
          'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px]',
          e.obligation_id ? 'bg-green-100 text-green-800' : 'bg-surface-alt text-ink-muted',
        ].join(' ')}>
          {e.obligation_id ? 'Yes' : 'No'}
        </span>
      ),
    },
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    deadlineColumn(periodLabel, data?.admin_tolerance_days ?? 0),
    preparedWithColumn([periodLabel], refetch),
    lastChasedColumn([periodLabel], refetch),
    {
      key: 'interim_received',
      label: 'Interim financials',
      widthClass: 'w-[160px]',
      render: (e) => {
        const cell = e.cells[periodLabel];
        return (
          <InlineDateCell
            value={cell?.draft_sent_at ?? null}
            disabled={!cell?.filing_id}
            mode="neutral"
            onSave={async (next) => {
              if (!cell?.filing_id) return;
              const res = await fetch(`/api/tax-ops/filings/${cell.filing_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ draft_sent_at: next }),
              });
              if (!res.ok) throw new Error(`Save failed (${res.status})`);
              refetch();
            }}
          />
        );
      },
    },
    {
      key: 'recommendation',
      label: 'Recommendation sent',
      widthClass: 'w-[180px]',
      render: (e) => {
        const cell = e.cells[periodLabel];
        return (
          <InlineDateCell
            value={cell?.filed_at ?? null}
            disabled={!cell?.filing_id}
            mode="neutral"
            onSave={async (next) => {
              if (!cell?.filing_id) return;
              const res = await fetch(`/api/tax-ops/filings/${cell.filing_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filed_at: next }),
              });
              if (!res.ok) throw new Error(`Save failed (${res.status})`);
              refetch();
            }}
          />
        );
      },
    },
    commentsColumn([periodLabel], refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="NWT reviews"
        subtitle="Year-end net wealth tax advisory review — interim financials (~Nov/Dec) to check for tax leakage and propose restructuring. Opted-in clients only. Not filed with AED."
      />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.filter(e => e.obligation_id).length}
        countLabel="opted-in"
        exportTaxType="nwt_annual"
        exportPeriodPattern="annual"
        exportServiceKind="review"
        exportShowInactive={showInactive}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        extraChildren={
          <label className="inline-flex items-center gap-1.5 text-[12.5px] cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span className="text-ink-muted">Show all entities (to opt a new client in)</span>
          </label>
        }
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}

      {isLoading && !data && <PageSkeleton />}

      {data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
          firstColLabel="Entity"
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({ entity, column, cell, nextStatus, refetch, toast })
          }
          rowAction={(entity) => (
            <RemoveRowButton
              obligationId={entity.obligation_id}
              entityName={entity.legal_name}
              onRemoved={refetch}
            />
          )}
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
