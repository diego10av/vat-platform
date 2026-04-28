'use client';

// /tax-ops/wht/annual — WHT director annual summary.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, applyStatusChange, useClientGroups, filterEntities, makeReorderHandler,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import { WhtTabs } from '@/components/tax-ops/WhtTabs';
import {
  partnerInChargeColumn, associatesWorkingColumn, lastActionColumn, contactsColumn, commentsColumn,
  priceColumn, deadlineColumn, familyColumn, cadenceColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';
import { FilingEditDrawer } from '@/components/tax-ops/FilingEditDrawer';

const YEAR_OPTIONS = yearOptions();

export default function WhtAnnualPage() {
  const [year, setYear] = useState(2025);
  const [statusFilter, setStatusFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [associateFilter, setAssociateFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(''); // Stint 64
  const [editingFilingId, setEditingFilingId] = useState<string | null>(null);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'wht_director_annual',
    year,
    period_pattern: 'annual',
  });

  const periodLabel = String(year);
  const filtered = filterEntities({
    entities: data?.entities ?? [],
    status: statusFilter,
    partner: partnerFilter,
    associate: associateFilter,
    periodLabels: [periodLabel],
    query: searchQuery,
  });
  const tolerance = data?.admin_tolerance_days ?? 0;
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    cadenceColumn({ currentTaxType: 'wht_director_annual', refetch, toast }),
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    lastActionColumn([periodLabel], refetch),
    deadlineColumn(periodLabel, tolerance),
    partnerInChargeColumn([periodLabel], refetch),
    associatesWorkingColumn([periodLabel], refetch),
    contactsColumn([periodLabel], refetch),
    commentsColumn([periodLabel], refetch),
    priceColumn([periodLabel], refetch),
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Withholding tax"
        subtitle="WHT director annual summary — 1 March N+1."
      />
      <WhtTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.length}
        countLabel="entities"
        exportTaxType="wht_director_annual"
        exportPeriodPattern="annual"
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        partnerFilter={partnerFilter}
        onPartnerFilterChange={setPartnerFilter}
        associateFilter={associateFilter}
        onAssociateFilterChange={setAssociateFilter}
        entitiesForFilters={data?.entities ?? []}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
          onReorderWithinFamily={makeReorderHandler(refetch)}
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
          groupFooter={(group) => (
            <AddEntityRow
              groupId={group.groupId}
              groupName={group.name}
              taxType="wht_director_annual"
              periodPattern="annual"
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active WHT director annual obligation for this year."
        />
      )}
      <FilingEditDrawer
        filingId={editingFilingId}
        onClose={() => setEditingFilingId(null)}
        onSaved={refetch}
      />
    </div>
  );
}
