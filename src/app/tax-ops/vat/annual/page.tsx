'use client';

// /tax-ops/vat/annual — VAT annual returns (standard or simplified).
// Two matrices unified into one table with a Subtype column; each row
// carries subtype metadata so inline edits hit the right filing.

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn, type MatrixEntity } from '@/components/tax-ops/TaxTypeMatrix';
import { VatSubtypeInlineCell } from '@/components/tax-ops/VatSubtypeInlineCell';
import {
  useMatrixData, applyStatusChange, useClientGroups, filterEntities, makeReorderHandler,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import { VatTabs } from '@/components/tax-ops/VatTabs';
import {
  partnerInChargeColumn, associatesWorkingColumn, lastActionColumn, contactsColumn, commentsColumn, priceColumn, deadlineColumn, familyColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';
import { FilingEditDrawer } from '@/components/tax-ops/FilingEditDrawer';

const YEAR_OPTIONS = yearOptions();

type CombinedEntity = MatrixEntity & { subtype: 'standard' | 'simplified' };

export default function VatAnnualPage() {
  const [year, setYear] = useState(2025);
  const [statusFilter, setStatusFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [associateFilter, setAssociateFilter] = useState('all');
  // Stint 48.F1.A — Standard/Simplified subtype filter. 'all' shows both;
  // 'standard' / 'simplified' narrows the combined list.
  const [subtypeFilter, setSubtypeFilter] = useState<'all' | 'standard' | 'simplified'>('all');
  const [editingFilingId, setEditingFilingId] = useState<string | null>(null);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const standard = useMatrixData({ tax_type: 'vat_annual', year, period_pattern: 'annual' });
  const simplified = useMatrixData({ tax_type: 'vat_simplified_annual', year, period_pattern: 'annual' });

  const refetch = () => { standard.refetch(); simplified.refetch(); };

  const combined: CombinedEntity[] = [];
  if (standard.data) {
    for (const e of standard.data.entities) combined.push({ ...e, subtype: 'standard' });
  }
  if (simplified.data) {
    for (const e of simplified.data.entities) combined.push({ ...e, subtype: 'simplified' });
  }

  const periodLabel = String(year);
  const tolerance = standard.data?.admin_tolerance_days ?? simplified.data?.admin_tolerance_days ?? 0;
  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
    {
      key: 'subtype',
      label: 'Subtype',
      widthClass: 'w-[120px]',
      render: (e) => {
        const subtype = (e as CombinedEntity).subtype;
        return (
          <VatSubtypeInlineCell
            entityName={e.legal_name}
            obligationId={e.obligation_id}
            current={subtype}
            onChanged={refetch}
          />
        );
      },
    },
    { key: periodLabel, label: `Status ${year}`, widthClass: 'w-[140px]' },
    lastActionColumn([periodLabel], refetch),
    deadlineColumn(periodLabel, tolerance),
    partnerInChargeColumn([periodLabel], refetch),
    associatesWorkingColumn([periodLabel], refetch),
    contactsColumn([periodLabel], refetch),
    commentsColumn([periodLabel], refetch),
    priceColumn([periodLabel], refetch),
  ];

  const hasError = standard.error || simplified.error;
  const isLoading = (standard.isLoading || simplified.isLoading) && !standard.data && !simplified.data;
  const filteredCombined = filterEntities({
    entities: combined,
    status: statusFilter,
    partner: partnerFilter,
    associate: associateFilter,
    periodLabels: [periodLabel],
  }).filter(e => {
    if (subtypeFilter === 'all') return true;
    return (e as CombinedEntity).subtype === subtypeFilter;
  });

  return (
    <div className="space-y-3">
      <PageHeader
        title="VAT"
        subtitle="Luxembourg VAT — annual return (standard + simplified variants), plus quarterly and monthly returns. Click a status cell to update inline."
      />
      <VatTabs />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filteredCombined.length}
        countLabel={`filings (${standard.data?.entities.length ?? 0} standard · ${simplified.data?.entities.length ?? 0} simplified)`}
        exportTaxType="vat_annual"
        exportPeriodPattern="annual"
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        partnerFilter={partnerFilter}
        onPartnerFilterChange={setPartnerFilter}
        associateFilter={associateFilter}
        onAssociateFilterChange={setAssociateFilter}
        entitiesForFilters={combined}
        extraChildren={
          <label className="inline-flex items-center gap-1.5 text-sm">
            <span className="text-ink-muted">Subtype:</span>
            <select
              value={subtypeFilter}
              onChange={(e) => setSubtypeFilter(e.target.value as typeof subtypeFilter)}
              className="px-2 py-1 text-sm border border-border rounded-md bg-surface"
            >
              <option value="all">All</option>
              <option value="standard">Standard</option>
              <option value="simplified">Simplified</option>
            </select>
          </label>
        }
      />

      {hasError && <CrmErrorBox message={String(hasError)} onRetry={refetch} />}

      {isLoading && <PageSkeleton />}

      {(standard.data || simplified.data) && (
        <TaxTypeMatrix
          entities={filteredCombined}
          columns={columns}
          firstColLabel="Entity"
          onEditFiling={setEditingFilingId}
          periodLabelsForEdit={[periodLabel]}
          liquidationVisuals
          onLiquidationChanged={refetch}
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
              taxType="vat_annual"
              periodPattern="annual"
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active VAT annual obligation for this year."
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
