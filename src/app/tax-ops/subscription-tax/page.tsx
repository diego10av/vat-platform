'use client';

// /tax-ops/subscription-tax — Subscription tax (quarterly, UCI/AIF).

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { TaxTypeMatrix, type MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';
import {
  useMatrixData, shortPeriodLabel, applyStatusChange, useClientGroups,
  filterEntities, makeReorderHandler,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions } from '@/components/tax-ops/yearOptions';
import {
  partnerInChargeColumn, associatesWorkingColumn, lastActionColumn, contactsColumn, commentsColumn, priceColumn, familyColumn, nextDeadlineColumn, lastFiledAtColumn,
} from '@/components/tax-ops/matrix-row-columns';
import { MatrixToolbar } from '@/components/tax-ops/MatrixToolbar';
import { AddEntityRow } from '@/components/tax-ops/AddEntityRow';
import { RemoveRowButton } from '@/components/tax-ops/RemoveRowButton';
import { FilingEditDrawer } from '@/components/tax-ops/FilingEditDrawer';

const YEAR_OPTIONS = yearOptions();

export default function SubscriptionTaxPage() {
  const [year, setYear] = useState(2026);
  const [statusFilter, setStatusFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [associateFilter, setAssociateFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(''); // Stint 64
  const [periodFilter, setPeriodFilter] = useState('all');
  const [editingFilingId, setEditingFilingId] = useState<string | null>(null);
  const toast = useToast();
  const { groups, refetch: refetchGroups } = useClientGroups();
  const { data, error, isLoading, refetch } = useMatrixData({
    tax_type: 'subscription_tax_quarterly',
    year,
    period_pattern: 'quarterly',
  });
  const visiblePeriodLabels = (data?.period_labels ?? []).filter(
    l => periodFilter === 'all' || l === periodFilter,
  );
  const filtered = filterEntities({
    entities: data?.entities ?? [],
    status: statusFilter,
    partner: partnerFilter,
    associate: associateFilter,
    periodLabels: visiblePeriodLabels,
    query: searchQuery,
  });

  const columns: MatrixColumn[] = [
    familyColumn({ groups, refetch, onGroupsChanged: refetchGroups }),
  ];
  if (data) {
    for (const label of visiblePeriodLabels) {
      columns.push({ key: label, label: shortPeriodLabel(label), widthClass: 'w-[80px]' });
    }
    // Stint 53 — Diego asked for a deadline column on the subscription-tax
    // matrix. Shows the next pending deadline per row (Loi 17 déc 2010
    // Art. 175 §3 — 20 days after quarter-end, strict).
    columns.push(nextDeadlineColumn(visiblePeriodLabels));
    // Stint 59.A — display-only "Filed at" column. Self-populates via the
    // PATCH endpoint default when status flips to filed; Diego edits via
    // the FilingEditDrawer (pencil ✎) when the AED deposit day differs.
    columns.push(lastFiledAtColumn(visiblePeriodLabels));
    columns.push(lastActionColumn(visiblePeriodLabels, refetch));
    columns.push(partnerInChargeColumn(visiblePeriodLabels, refetch));
    columns.push(associatesWorkingColumn(visiblePeriodLabels, refetch));
    columns.push(contactsColumn(visiblePeriodLabels, refetch));
    columns.push(commentsColumn(visiblePeriodLabels, refetch));
    columns.push(priceColumn(visiblePeriodLabels, refetch));
  }
  const periodOptions = (data?.period_labels ?? []).map(l => ({
    value: l,
    label: shortPeriodLabel(l),
  }));

  return (
    <div className="space-y-3">
      <PageHeader
        title="Subscription tax"
        subtitle="UCI / AIF / RAIF quarterly subscription tax — filing AND payment within 20 days of each quarter-end (Loi 17 déc. 2010 Art. 175 §3 / Loi 13 fév. 2007 Art. 68 §2 / Loi RAIF 2016 Art. 46). Strict deadline, identical for all vehicles."
      />

      <MatrixToolbar
        year={year}
        years={YEAR_OPTIONS}
        onYearChange={setYear}
        count={filtered.length}
        countLabel="entities"
        exportTaxType="subscription_tax_quarterly"
        exportPeriodPattern="quarterly"
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        partnerFilter={partnerFilter}
        onPartnerFilterChange={setPartnerFilter}
        associateFilter={associateFilter}
        onAssociateFilterChange={setAssociateFilter}
        entitiesForFilters={data?.entities ?? []}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        periodOptions={periodOptions}
        periodFilter={periodFilter}
        onPeriodFilterChange={setPeriodFilter}
        periodLabel="Quarter"
      />

      {error && <CrmErrorBox message={error} onRetry={refetch} />}
      {isLoading && !data && <PageSkeleton />}
      {data && (
        <TaxTypeMatrix
          entities={filtered}
          columns={columns}
          onReorderWithinFamily={makeReorderHandler(refetch)}
          onStatusChange={({ entity, column, cell, nextStatus }) =>
            applyStatusChange({
              entity, column, cell, nextStatus, refetch, toast,
              taxType: 'subscription_tax_quarterly', periodPattern: 'quarterly',
            })
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
              taxType="subscription_tax_quarterly"
              periodPattern="quarterly"
              onCreated={refetch}
            />
          )}
          emptyMessage="No entities have an active subscription tax obligation for this year."
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
