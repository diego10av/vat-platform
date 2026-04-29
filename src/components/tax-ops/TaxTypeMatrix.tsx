'use client';

// ════════════════════════════════════════════════════════════════════════
// TaxTypeMatrix — the Excel-style primitive that powers every tax-ops
// category page (CIT, NWT, VAT × 3, Subscription, WHT, BCL, Other).
//
// Layout rules (chosen to match Diego's Excel density):
//   - text-sm base, py-1.5 px-2 cells, border dividers
//   - Sticky header row + sticky first column
//   - Rows grouped by client_group_name, collapsible per-group
//   - Cell renderers pluggable via `renderCell` prop
//   - Click row → entity detail; click cell with filing → filing detail
//
// Not a generic data-grid — intentionally narrow. Cross-rendering into
// something like TanStack Table would erase the tight pixel economy.
// ════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, GripVerticalIcon } from 'lucide-react';
import { FilingStatusBadge, filingStatusLabel } from './FilingStatusBadge';
import { InlineStatusCell } from './inline-editors';
import { familyChipClasses, buildFamilyColorMap } from './familyColors';
import { FamilyColorProvider } from './FamilyColorContext';
import { LiquidationChip, isFinalReturnPeriod } from './LiquidationChip';
import { EntityActionsMenu } from './EntityActionsMenu';
import { useDensity } from './use-density';
import { useContextMenu, type ContextMenuItem } from './ContextMenu';
import {
  ExternalLinkIcon, CopyIcon, FolderIcon, ListIcon,
} from 'lucide-react';
import { useToast } from '@/components/Toaster';

export interface MatrixCell {
  filing_id: string;
  status: string;
  deadline_date: string | null;
  assigned_to: string | null;
  comments: string | null;
  filed_at: string | null;
  draft_sent_at: string | null;
  tax_assessment_received_at: string | null;
  /** Stint 44.F3 — outcome category for the assessment.
   *  'aligned' / 'under_audit' / null. Independent of the date field. */
  tax_assessment_outcome?: string | null;
  amount_due: string | null;
  amount_paid: string | null;
  prepared_with: string[];
  /** Stint 43.D11 — partner(s) who own the engagement. Renamed semantic
   *  of prepared_with; backfilled on migration 060. */
  partner_in_charge: string[];
  /** Stint 43.D11 — associate(s) doing the prep work. */
  associates_working: string[];
  /** Stint 39.F — last chase date to client/CSP (legacy field; kept
   *  for backwards compatibility, superseded by last_action_at). */
  last_info_request_sent_at: string | null;
  /** Stint 43.D6 — date of the most recent action on the filing.
   *  Auto-stamped server-side; Diego can override manually. */
  last_action_at: string | null;
  /** Stint 40.O — invoice price + free-text note. */
  invoice_price_eur: string | null;
  invoice_price_note: string | null;
  /** Stint 52 — separate ISS (Liste récapitulative / EC Sales List)
   *  invoice price. Lives in parallel with invoice_price_eur because
   *  cifra charges these as two distinct deliverables. NULL when no
   *  ISS is prepared for the filing. Surfaced only on VAT matrices. */
  invoice_price_iss_eur: string | null;
  invoice_price_iss_note: string | null;
  /** Stint 40.G — CSP / client contacts for this filing. */
  csp_contacts: Array<{ name: string; email?: string; role?: string }>;
}

export interface MatrixEntity {
  id: string;
  legal_name: string;
  group_id: string | null;
  group_name: string | null;
  obligation_id: string | null;
  /** Stint 43.D4 — per-obligation tax form id (CIT: 500/205/200). */
  form_code?: string | null;
  /** Stint 43.D15 — date the entity was/will be liquidated.
   *  When set + matrix opted into liquidationVisuals, drives the
   *  liquidation chip + row tinting + final-return border. */
  liquidation_date?: string | null;
  /** Stint 48.U3.A — entity-level CSP contacts (the canonical default).
   *  Matrix's contactsColumn now reads + writes here directly. Filing
   *  level overrides (in `cell.csp_contacts`) still exist for edge cases
   *  but are accessed via the FilingEditDrawer. */
  csp_contacts?: Array<{ name: string; email?: string; role?: string }>;
  cells: Record<string, MatrixCell | null>;
}

/** A column definition for the matrix. `key` is either a period_label
 *  (e.g. "2025-Q1") — in which case the default renderer shows a status
 *  badge for that period's filing — or a synthetic key like "prepared_with"
 *  or "comments" that produces a computed value across the row. */
export interface MatrixColumn {
  key: string;
  label: string;
  /** Tailwind width class; defaults to `w-auto`. Use for compact monthly
   *  cells (w-[44px]) vs wide text columns. */
  widthClass?: string;
  /** Optional custom cell renderer. If omitted, the matrix looks up
   *  cells[key] and renders a status badge. */
  render?: (entity: MatrixEntity) => React.ReactNode;
  /** Optional right-align (for numbers). */
  alignRight?: boolean;
}

interface Props {
  entities: MatrixEntity[];
  columns: MatrixColumn[];
  /** Title over the first sticky column (default "Entity"). */
  firstColLabel?: string;
  /** When true, group rows by client_group_name with collapsible headers.
   *  Defaults to true. */
  grouped?: boolean;
  /** Optional additional row action (icon button at row end). */
  rowAction?: (entity: MatrixEntity) => React.ReactNode;
  /**
   * Stint 40.G.2 — when provided, a pencil ✎ icon appears in each row
   * and invokes this callback with the filing_id of the first filed
   * cell in the row. The caller mounts <FilingEditDrawer /> to render
   * the full edit surface. Disabled if the row has no filings yet.
   */
  onEditFiling?: (filingId: string) => void;
  /** Period labels used to pick the "first filed cell" for the edit
   *  pencil. When onEditFiling is set, this must be populated so we
   *  know which cells are period cells. */
  periodLabelsForEdit?: string[];
  /** Called when a cell is clicked and that cell has a filing. Default:
   *  navigates to /tax-ops/filings/[id]. */
  onCellClick?: (entity: MatrixEntity, column: MatrixColumn, cell: MatrixCell) => void;
  /** Empty-state copy. */
  emptyMessage?: string;
  /** Optional content rendered under each group (row-level). Used by
   *  37.F to show "+ Add entity to this family" at the end of each
   *  group section. Receives the first entity in the group (or null
   *  if we need a "no-family" injection point). */
  groupFooter?: (group: { name: string; groupId: string | null }) => React.ReactNode;
  /**
   * When set, enables inline status editing on period columns. Called
   * with the updated status for an existing filing (filing_id present)
   * or for an empty cell where a filing must be created first
   * (filing_id=null).
   *
   * The hook should: PATCH the filing if filing_id, else POST a new
   * filing for (entity.obligation_id, column.key). Reject the Promise
   * on error — the InlineCellEditor shows the error + reverts optimistic
   * UI.
   *
   * If omitted, period cells remain click-to-navigate only.
   */
  onStatusChange?: (args: {
    entity: MatrixEntity;
    column: MatrixColumn;
    cell: MatrixCell | null;
    nextStatus: string;
  }) => Promise<void>;
  /**
   * Stint 43.D15 — when true, surfaces liquidation status visually:
   *   • LiquidationChip rendered next to the entity name (amber when
   *     in-progress, gray-faint when past).
   *   • Subtle amber row tinting on entities with liquidation_date set.
   *   • Amber border ring on the status chip whose period contains
   *     the liquidation date — marks the "final return".
   *   • "+ liquidate" ghost button rendered for entities without a
   *     date set, so Diego can mark one without leaving the matrix.
   *
   * Opted in on /tax-ops/cit and /tax-ops/vat/{annual,quarterly,monthly}
   * — the tax types where a liquidation cycle has fiscal weight.
   * Other matrices ignore the flag.
   */
  liquidationVisuals?: boolean;
  /** Required when `liquidationVisuals` is true: called after the
   *  liquidation date is changed via the chip popover so the matrix
   *  refetches. Reuses the same callback shape as the other inline
   *  edits. */
  onLiquidationChanged?: () => void;
  /**
   * Stint 51.D — when set, every entity row gets a drag handle and can
   * be reordered within its family by drag-and-drop. The callback
   * receives the new sequential ordered list of entity ids for the
   * affected family; the page is responsible for POSTing them to
   * /api/tax-ops/entities/reorder and refetching.
   *
   * Drops across family boundaries are rejected client-side.
   */
  onReorderWithinFamily?: (args: { groupName: string; orderedIds: string[] }) => void;
  /**
   * Stint 64.O F1 — bulk operations MVP. When set, every row gets a
   * checkbox and a floating action bar appears at the bottom of the
   * matrix once 1+ rows are selected. The page implements the actual
   * mutation by passing `onBulkReassignPartner` (and possibly more
   * actions later); the matrix only owns selection UI + the action
   * bar. `bulkPartnerOptions` populates the SearchableSelect inside
   * the partner-reassign popover; pages typically pass the same list
   * they already build for the toolbar's partner filter.
   */
  enableBulkSelection?: boolean;
  bulkPartnerOptions?: Array<{ value: string; label: string }>;
  onBulkReassignPartner?: (args: { entityIds: string[]; partnerName: string }) => Promise<void>;
}

export function TaxTypeMatrix({
  entities, columns,
  firstColLabel = 'Entity',
  grouped = true,
  rowAction,
  onCellClick,
  onStatusChange,
  emptyMessage = 'No entities with this obligation. Toggle "Show all entities" to activate one.',
  groupFooter,
  onEditFiling,
  periodLabelsForEdit,
  liquidationVisuals,
  onLiquidationChanged,
  onReorderWithinFamily,
  enableBulkSelection,
  bulkPartnerOptions,
  onBulkReassignPartner,
}: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Stint 64.O F1 — bulk-selection state. Empty Set when nothing
  // selected; entries are entity ids. The action bar at the bottom
  // is rendered conditionally on size > 0.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((entityId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Stint 64.O F7 — read the user's density preference. Applied as a
  // data-attribute on the wrapper; the descendant arbitrary-variant
  // selector below collapses body cells to ~half the vertical padding
  // when 'compact'. Header padding stays comfortable for legibility.
  const { density } = useDensity();

  // Stint 51.D — optimistic local override for drag-and-drop reorder.
  // When the user drops a row, we re-order the local copy immediately so
  // the matrix doesn't flicker while waiting for the server PATCH +
  // refetch round-trip. Cleared whenever the parent passes a fresh
  // `entities` prop (fresh data from the refetch).
  const [optimistic, setOptimistic] = useState<MatrixEntity[] | null>(null);
  // Track the entity currently being dragged + its source group so we
  // can block cross-family drops.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  // Reset optimistic state when fresh data arrives.
  useMemo(() => { setOptimistic(null); }, [entities]);
  const effective = optimistic ?? entities;

  const groups = useMemo(() => {
    if (!grouped) return [{ name: '', items: effective }];
    const m = new Map<string, MatrixEntity[]>();
    for (const e of effective) {
      const key = e.group_name ?? '(no group)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => ({ name, items }));
  }, [effective, grouped]);

  // Drag-drop helpers — only active when onReorderWithinFamily is set.
  const handleDragStart = useCallback((entity: MatrixEntity) => {
    setDragId(entity.id);
    setDragGroup(entity.group_name ?? '(no group)');
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, entity: MatrixEntity) => {
    if (!dragId || !onReorderWithinFamily) return;
    const targetGroup = entity.group_name ?? '(no group)';
    if (targetGroup !== dragGroup) return;  // block cross-family drops
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, [dragId, dragGroup, onReorderWithinFamily]);
  const handleDrop = useCallback((e: React.DragEvent, target: MatrixEntity) => {
    if (!dragId || !onReorderWithinFamily) return;
    const targetGroup = target.group_name ?? '(no group)';
    if (targetGroup !== dragGroup) return;
    if (target.id === dragId) return;
    e.preventDefault();
    // Compute new order: take effective[], remove the source, insert
    // it before the target (drop ABOVE target).
    const next = [...effective];
    const sourceIdx = next.findIndex(e2 => e2.id === dragId);
    if (sourceIdx === -1) return;
    const [moved] = next.splice(sourceIdx, 1);
    const targetIdx = next.findIndex(e2 => e2.id === target.id);
    if (targetIdx === -1) return;
    next.splice(targetIdx, 0, moved!);
    setOptimistic(next);
    setDragId(null);
    setDragGroup(null);
    // Compute the new ordered ids for the affected family + dispatch.
    const familyIds = next
      .filter(e2 => (e2.group_name ?? '(no group)') === targetGroup)
      .map(e2 => e2.id);
    onReorderWithinFamily({ groupName: targetGroup, orderedIds: familyIds });
  }, [dragId, dragGroup, effective, onReorderWithinFamily]);
  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragGroup(null);
  }, []);

  const toggleGroup = useCallback((name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const handleCellClick = useCallback((e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => {
    if (onCellClick) {
      onCellClick(e, col, cell);
    } else {
      router.push(`/tax-ops/filings/${cell.filing_id}`);
    }
  }, [onCellClick, router]);

  if (entities.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-8 text-center">
        <div className="text-sm text-ink-muted italic">{emptyMessage}</div>
      </div>
    );
  }

  // Stint 39.B — Family column is sticky + comes BEFORE the Entity
  // sticky column when present. We detect it by key='family' and pull
  // it out of the normal columns[] for special rendering. The visual
  // order becomes: [Family sticky left:0] [Entity sticky left:170] [rest…].
  const familyCol = columns.find(c => c.key === 'family') ?? null;
  const otherCols = columns.filter(c => c.key !== 'family');
  const familyColWidth = 170;   // px — matches w-[170px]
  const entityStickyLeft = familyCol ? familyColWidth : 0;

  // Stint 51.C — render-context palette assignment. Walk the entities in
  // their visual order and produce a Map<family-name, palette-index> that
  // never lets two adjacent rows share a colour. Memoized on the entity
  // list so the assignment is stable across re-renders that don't change
  // the order.
  const familyColorMap = useMemo(
    () => buildFamilyColorMap(entities.map(e => e.group_name)),
    [entities],
  );

  // Stint 40.G.2 — compose a row action that prepends a pencil ✎
  // when onEditFiling is set. Pencil is disabled (but visible) when
  // the row has no filed cells yet.
  const labelsForEdit = periodLabelsForEdit ?? [];
  const effectiveRowAction = onEditFiling
    ? (entity: MatrixEntity) => {
        const firstFiling = labelsForEdit
          .map(l => entity.cells[l])
          .find((c): c is MatrixCell => !!c) ?? null;
        return (
          <span className="inline-flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (firstFiling) onEditFiling(firstFiling.filing_id);
              }}
              disabled={!firstFiling}
              aria-label="Edit all fields"
              title={firstFiling ? 'Edit all fields of this row\'s filing' : 'No filing yet — set a status first'}
              className="p-1 text-ink-muted hover:text-brand-700 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <PencilIcon size={12} />
            </button>
            {rowAction?.(entity)}
          </span>
        );
      }
    : rowAction;

  // Stint 43.D12 — viewport-cap so the horizontal scrollbar lives inside
  // the visible window instead of at the bottom of the (potentially very
  // long) page. Diego: "no veo bien la barra horizontal porque me obliga
  // a hacer scroll al fondo de la página". The 220px subtract leaves room
  // for the page header + toolbar + a small breathing strip; tweakable.
  // Stint 48.B2 — table uses border-separate + spacing-0 instead of
  // border-collapse so position: sticky on <th>/<td> renders cleanly
  // (border-collapse breaks the rendering of borders on sticky cells in
  // every Chromium release we've tested). w-full → min-w-max so columns
  // expand the table when they exceed the wrapper width, giving the
  // sticky cells a horizontal scroll context to anchor against.
  return (
   <FamilyColorProvider value={familyColorMap}>
    <div
      data-density={density}
      className="rounded-md border border-border bg-surface overflow-auto relative data-[density=compact]:[&_tbody_td]:!py-0.5"
      style={{ maxHeight: 'calc(100vh - 220px)' }}
    >
      {/* Stint 64.O F1 — floating action bar appears at the
          bottom-right of the matrix wrapper when 1+ rows are
          selected. Self-contained: pages just opt in via
          `enableBulkSelection` + supply the action callback. */}
      {enableBulkSelection && selected.size > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          selectedIds={Array.from(selected)}
          onClear={clearSelection}
          partnerOptions={bulkPartnerOptions ?? []}
          onReassignPartner={onBulkReassignPartner}
        />
      )}
      <table className="min-w-full text-sm border-separate border-spacing-0">
        {/* Stint 64.N — sticky lives on every <th> individually rather
            than on <thead>. Browsers (especially Safari) don't honour
            sticky on <thead>; cell-level sticky is the reliable pattern
            and matches what Linear/Notion/Veeva ship. Each th carries
            an explicit opaque bg-surface-alt so rows scrolling
            underneath don't bleed through. */}
        <thead>
          <tr className="text-left text-ink-muted">
            {familyCol && (
              <th
                // Family header: stuck top + left, highest z so it
                // wins the top-left corner against both body sticky
                // cells and other header cells.
                className="sticky top-0 left-0 z-[25] bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium min-w-[170px] max-w-[170px]"
              >
                {familyCol.label}
              </th>
            )}
            <th
              className="sticky top-0 z-[25] bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium min-w-[220px]"
              style={{ left: `${entityStickyLeft}px` }}
            >
              {firstColLabel}
            </th>
            {otherCols.map(col => (
              <th
                key={col.key}
                className={[
                  // Stint 64.N — every header cell is now sticky-top
                  // with an opaque bg so vertical scroll doesn't
                  // bleed through. z-[20] is below Family/Entity
                  // (z-[25]) but above body sticky cells (z-[15]).
                  'sticky top-0 z-[20] bg-surface-alt border-b border-border px-2 py-2 font-medium whitespace-nowrap',
                  col.alignRight ? 'text-right' : 'text-left',
                  col.widthClass ?? '',
                ].join(' ')}
              >
                {col.label}
              </th>
            ))}
            {effectiveRowAction && (
              <th className="sticky top-0 z-[20] bg-surface-alt border-b border-border px-2 py-2 font-medium w-[60px]"></th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((group, idx) => {
            const isCollapsed = collapsed.has(group.name);
            return (
              <GroupBlock
                key={group.name || 'all'}
                group={group}
                grouped={grouped}
                isCollapsed={isCollapsed}
                toggleGroup={toggleGroup}
                columns={otherCols}
                familyCol={familyCol}
                entityStickyLeft={entityStickyLeft}
                rowAction={effectiveRowAction}
                handleCellClick={handleCellClick}
                onStatusChange={onStatusChange}
                groupFooter={groupFooter}
                liquidationVisuals={liquidationVisuals}
                onLiquidationChanged={onLiquidationChanged}
                totalCols={(familyCol ? 1 : 0) + 1 + otherCols.length + (effectiveRowAction ? 1 : 0)}
                draggable={!!onReorderWithinFamily}
                dragId={dragId}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                /* Stint 64.N — first group has no leading spacer; every
                   subsequent group gets a 12px breathing space so the
                   eye sees "this is a new family" without needing extra
                   borders. Diego: "como estas dos cosas salen como del
                   mismo color, a veces no es lo más mejor". */
                showLeadingSpacer={idx > 0}
                /* Stint 64.O F1 — bulk selection plumbing. */
                enableBulkSelection={enableBulkSelection}
                selectedIds={selected}
                onToggleSelect={toggleSelect}
              />
            );
          })}
        </tbody>
      </table>
    </div>
   </FamilyColorProvider>
  );
}

function GroupBlock({
  group, grouped, isCollapsed, toggleGroup,
  columns, familyCol, entityStickyLeft,
  rowAction, handleCellClick, onStatusChange,
  groupFooter, totalCols,
  liquidationVisuals, onLiquidationChanged,
  draggable, dragId, onDragStart, onDragOver, onDrop, onDragEnd,
  showLeadingSpacer,
  enableBulkSelection, selectedIds, onToggleSelect,
}: {
  group: { name: string; items: MatrixEntity[] };
  grouped: boolean;
  isCollapsed: boolean;
  toggleGroup: (name: string) => void;
  columns: MatrixColumn[];
  familyCol: MatrixColumn | null;
  entityStickyLeft: number;
  rowAction?: (entity: MatrixEntity) => React.ReactNode;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
  onStatusChange?: Props['onStatusChange'];
  groupFooter?: Props['groupFooter'];
  totalCols: number;
  liquidationVisuals?: boolean;
  onLiquidationChanged?: () => void;
  // Stint 51.D — drag-drop reorder hooks
  draggable?: boolean;
  dragId?: string | null;
  onDragStart?: (entity: MatrixEntity) => void;
  onDragOver?: (e: React.DragEvent, entity: MatrixEntity) => void;
  onDrop?: (e: React.DragEvent, entity: MatrixEntity) => void;
  onDragEnd?: () => void;
  /** Stint 64.N — render a thin spacer row above the group header so
   *  the eye sees a clean break between families. Set true for every
   *  group except the first. */
  showLeadingSpacer?: boolean;
  /** Stint 64.O F1 — bulk selection threading. */
  enableBulkSelection?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (entityId: string) => void;
}) {
  // First entity's group_id is the canonical id for this group — use it
  // when calling groupFooter so "+Add" knows where to attach new entities.
  const groupId = group.items[0]?.group_id ?? null;

  return (
    <>
      {/* Stint 64.N — 12px breathing space before every group except
          the first one. Diego's matrix used to render footer →
          immediate next family header with both on the same colour
          band; this spacer + tonal contrast on the header makes the
          break read at a glance. */}
      {showLeadingSpacer && (
        <tr aria-hidden="true">
          <td colSpan={totalCols} className="h-3 bg-surface" />
        </tr>
      )}
      {grouped && group.name && (
        <tr>
          <td
            colSpan={totalCols}
            // Stint 54 — was bg-surface-alt/70 (translucent). When the
            // user scrolls, the rows underneath show through and the
            // group header looks "transparent". Switched to fully
            // opaque bg-surface-alt + z-[15] so it stays solid against
            // both vertical and horizontal scroll.
            className="sticky left-0 z-[15] bg-surface-alt border-b border-border px-2.5 py-1 font-semibold text-xs text-ink"
          >
            {/* Stint 40.P — group header has two affordances: chevron
                toggles collapse, name links to family overview. */}
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                onClick={() => toggleGroup(group.name)}
                className="inline-flex items-center cursor-pointer hover:text-brand-700"
              >
                {isCollapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
              </button>
              {groupId ? (
                <Link
                  href={`/tax-ops/families/${groupId}`}
                  className="hover:text-brand-700 hover:underline cursor-pointer"
                  title={`Open ${group.name} family overview`}
                >
                  {group.name}
                </Link>
              ) : (
                <span>{group.name}</span>
              )}
              <span className="ml-1 text-ink-muted font-normal">({group.items.length})</span>
            </span>
          </td>
        </tr>
      )}
      {!isCollapsed && group.items.map(e => (
        <RowRender
          key={e.id}
          entity={e}
          columns={columns}
          familyCol={familyCol}
          entityStickyLeft={entityStickyLeft}
          rowAction={rowAction}
          handleCellClick={handleCellClick}
          onStatusChange={onStatusChange}
          liquidationVisuals={liquidationVisuals}
          onLiquidationChanged={onLiquidationChanged}
          draggable={draggable}
          isDragging={dragId === e.id}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          enableBulkSelection={enableBulkSelection}
          isSelected={selectedIds?.has(e.id) ?? false}
          onToggleSelect={onToggleSelect}
        />
      ))}
      {!isCollapsed && groupFooter && (
        <tr className="border-b border-border/70 bg-surface-alt">
          <td
            colSpan={totalCols}
            // Stint 54 — was bg-surface-alt/20 (mostly transparent),
            // which made the "+ New entity" / "Add existing" row
            // look ghosted while scrolling. Solid bg + z-[15] now
            // matches the group header above.
            className="sticky left-0 z-[15] bg-surface-alt border-r border-border"
          >
            {groupFooter({ name: group.name, groupId })}
          </td>
        </tr>
      )}
    </>
  );
}

function RowRender({
  entity, columns, familyCol, entityStickyLeft,
  rowAction, handleCellClick, onStatusChange,
  liquidationVisuals, onLiquidationChanged,
  draggable, isDragging, onDragStart, onDragOver, onDrop, onDragEnd,
  enableBulkSelection, isSelected, onToggleSelect,
}: {
  entity: MatrixEntity;
  columns: MatrixColumn[];
  familyCol: MatrixColumn | null;
  entityStickyLeft: number;
  rowAction?: (entity: MatrixEntity) => React.ReactNode;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
  onStatusChange?: Props['onStatusChange'];
  liquidationVisuals?: boolean;
  onLiquidationChanged?: () => void;
  // Stint 51.D — drag-drop reorder
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (entity: MatrixEntity) => void;
  onDragOver?: (e: React.DragEvent, entity: MatrixEntity) => void;
  onDrop?: (e: React.DragEvent, entity: MatrixEntity) => void;
  onDragEnd?: () => void;
  enableBulkSelection?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (entityId: string) => void;
}) {
  // Stint 43.D15 — row tinting + sticky-cell tinting must match. The
  // sticky cells (family + entity) live on `bg-surface` to override the
  // tr's bg, so when we tint the row we have to tint those cells too,
  // otherwise they paint a clean white strip on top of the amber row.
  //
  // Stint 64 — fix transparent-on-hover bug. Sticky cells used to use
  // `hover:bg-surface-alt/50` which is 50% transparent, so when Diego
  // hovered a row the body cells passing beneath the sticky column
  // (e.g. "+ Add contact" in the Contacts column) bled through visually.
  // Now sticky cells get an OPAQUE hover bg; the tr keeps its lighter
  // /50 hover for the non-sticky cells (so the visual highlight stays).
  const tinted = liquidationVisuals && !!entity.liquidation_date;
  const trClass = [
    tinted
      ? 'border-b border-border/70 bg-amber-50/40 hover:bg-amber-50/70'
      : 'border-b border-border/70 hover:bg-surface-alt/50',
    isDragging ? 'opacity-40' : '',
  ].join(' ');
  const stickyBgClass = tinted
    ? 'bg-amber-50 hover:bg-amber-100'
    : 'bg-surface hover:bg-surface-alt';

  // Stint 64.O F4 — per-row right-click context menu.
  const contextMenu = useContextMenu();
  const rowToast = useToast();
  const router2 = useRouter();
  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Open entity',
      icon: <ExternalLinkIcon size={13} />,
      onClick: () => router2.push(`/tax-ops/entities/${entity.id}`),
    },
    {
      label: 'Open family',
      icon: <FolderIcon size={13} />,
      disabled: !entity.group_id,
      onClick: () => {
        if (entity.group_id) router2.push(`/tax-ops/families/${entity.group_id}`);
      },
    },
    {
      label: 'View activity timeline',
      icon: <ListIcon size={13} />,
      onClick: () => router2.push(`/tax-ops/entities/${entity.id}#activity`),
    },
    {
      label: 'Copy entity name',
      icon: <CopyIcon size={13} />,
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(entity.legal_name);
          rowToast.success('Entity name copied');
        } catch {
          rowToast.error('Could not copy — clipboard unavailable');
        }
      },
    },
  ];

  return (
    <>
    <tr
      className={trClass}
      draggable={draggable}
      onDragStart={draggable ? () => onDragStart?.(entity) : undefined}
      onDragOver={draggable ? (e) => onDragOver?.(e, entity) : undefined}
      onDrop={draggable ? (e) => onDrop?.(e, entity) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      {familyCol && (
        <td className={[
          // Stint 54 — bumped to z-[15] (above the z-sticky:10 header)
          // so when the user scrolls horizontally the Family column
          // never gets visually overlapped by the period cells passing
          // beneath. The bg class below keeps it opaque.
          'sticky left-0 z-[15] border-r border-border px-2 py-1.5 min-w-[170px] max-w-[170px]',
          stickyBgClass,
          draggable ? 'cursor-grab active:cursor-grabbing' : '',
        ].join(' ')}
        title={draggable ? 'Drag the ≡ handle to reorder within this family' : undefined}
        >
          <div className="flex items-center gap-1 min-w-0">
            {/* Stint 54 — visible drag handle so Diego knows the row
                can be reordered (was hidden behind a cursor change
                only). Only rendered when reorder is enabled. */}
            {draggable && (
              <GripVerticalIcon
                size={11}
                className="shrink-0 text-ink-faint group-hover:text-ink-muted"
                aria-hidden="true"
              />
            )}
            <div className="flex-1 min-w-0">
              {familyCol.render
                ? familyCol.render(entity)
                : (entity.group_name
                    ? <span className={[
                        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium truncate max-w-[150px]',
                        familyChipClasses(entity.group_name),
                      ].join(' ')} title={entity.group_name}>
                        {entity.group_name}
                      </span>
                    : <span className="text-ink-faint italic text-xs">—</span>)
              }
            </div>
          </div>
        </td>
      )}
      <td
        className={[
          // Stint 54 — same z-[15] as Family so both stay above the
          // body cells during horizontal scroll.
          'sticky z-[15] border-r border-border px-2.5 py-1.5 min-w-[220px] max-w-[320px]',
          stickyBgClass,
        ].join(' ')}
        style={{ left: `${entityStickyLeft}px` }}
        // Stint 64.O F4 — right-click on the entity-name cell opens a
        // small context menu with the most common per-row actions.
        // Excel/Notion pattern; Big4 partners use it dozens of times
        // a day once they discover it.
        onContextMenu={contextMenu.openAt}
      >
        <div className="flex items-center min-w-0 gap-1.5">
          {/* Stint 64.O F1 — bulk-selection checkbox; only rendered
              when the page opted in to bulk operations. Stop click
              propagation so toggling the box doesn't navigate to
              the entity detail. */}
          {enableBulkSelection && onToggleSelect && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={() => onToggleSelect(entity.id)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 h-3.5 w-3.5 accent-brand-500 cursor-pointer"
              aria-label={`Select ${entity.legal_name}`}
            />
          )}
          <Link
            href={`/tax-ops/entities/${entity.id}`}
            className="text-ink hover:text-brand-700 font-medium truncate"
            title={entity.legal_name + '  ·  Right-click for actions'}
          >
            {entity.legal_name}
          </Link>
          {/* Stint 44.F4 — kebab `⋯` is the SETTING surface (low-frequency
              actions like "mark liquidating"); LiquidationChip is the
              SIGNAL chip (only visible when an entity actually has a
              liquidation_date set). Both share the same opt-in flag. */}
          {liquidationVisuals && (
            <>
              <EntityActionsMenu
                entityId={entity.id}
                entityName={entity.legal_name}
                liquidationDate={entity.liquidation_date ?? null}
                onChanged={onLiquidationChanged ?? (() => {})}
              />
              <LiquidationChip
                entityId={entity.id}
                entityName={entity.legal_name}
                liquidationDate={entity.liquidation_date ?? null}
                onChanged={onLiquidationChanged ?? (() => {})}
              />
            </>
          )}
        </div>
      </td>
      {columns.map(col => (
        <CellRender
          key={col.key}
          entity={entity}
          column={col}
          handleCellClick={handleCellClick}
          onStatusChange={onStatusChange}
          liquidationVisuals={liquidationVisuals}
        />
      ))}
      {rowAction && (
        <td className="px-2 py-1.5 text-right">{rowAction(entity)}</td>
      )}
    </tr>
    {contextMenu.render({ items: contextMenuItems })}
    </>
  );
}

function CellRender({
  entity, column, handleCellClick, onStatusChange,
  liquidationVisuals,
}: {
  entity: MatrixEntity;
  column: MatrixColumn;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
  onStatusChange?: Props['onStatusChange'];
  liquidationVisuals?: boolean;
}) {
  // Stint 43.D15 — flag the status chip whose period contains the
  // liquidation date as the "final return". Wraps the cell in an
  // amber ring + tooltip suffix so Diego sees at a glance which
  // filing closes out this entity. Cheap; no impact on cells whose
  // column.key isn't a parseable period_label.
  const isFinalReturn =
    !!liquidationVisuals
    && !!entity.liquidation_date
    && isFinalReturnPeriod(entity.liquidation_date, column.key);
  // Custom renderers win.
  if (column.render) {
    return (
      <td
        className={[
          'px-2 py-1.5 align-middle',
          column.alignRight ? 'text-right tabular-nums' : '',
          column.widthClass ?? '',
        ].join(' ')}
      >
        {column.render(entity)}
      </td>
    );
  }

  // Default: key is a period_label; look up the cell.
  const cell = entity.cells[column.key] ?? null;

  // Stint 43.D15 — when this period contains the liquidation date,
  // surround the cell with an amber inset ring so it pops as the
  // "final return". Tooltip gains a clarifying suffix.
  const finalReturnRing = isFinalReturn
    ? 'shadow-[inset_0_0_0_2px_theme(colors.amber.400)]'
    : '';
  const finalReturnTooltipSuffix = isFinalReturn
    ? `\n⚑ Final return (liquidation date ${entity.liquidation_date})`
    : '';

  // Inline-edit enabled path (stint 36): render the status as an
  // InlineStatusCell with onSave wired to onStatusChange. Empty cells
  // still render the dropdown so the user can "set a status" → creates
  // the filing on save. Disabled when the entity lacks an obligation_id
  // (no way to place a filing without one).
  if (onStatusChange) {
    const disabled = !entity.obligation_id;
    return (
      <td
        className={['px-1.5 py-1 align-middle', column.widthClass ?? '', finalReturnRing].join(' ')}
        title={(cell ? buildTooltip(cell) : disabled ? 'No obligation — add one on the entity detail page' : 'Click to set a status (creates the filing)') + finalReturnTooltipSuffix}
      >
        <InlineStatusCell
          value={cell?.status ?? 'info_to_request'}
          disabled={disabled}
          onSave={(next) => onStatusChange({ entity, column, cell, nextStatus: next })}
        />
      </td>
    );
  }

  // Read-only click-through fallback (pre-stint-36 behaviour).
  if (!cell) {
    return (
      <td
        className={['px-2 py-1.5 align-middle text-ink-faint', column.widthClass ?? '', finalReturnRing].join(' ')}
        title={finalReturnTooltipSuffix.trim() || undefined}
      >
        —
      </td>
    );
  }
  const tooltip = buildTooltip(cell) + finalReturnTooltipSuffix;
  return (
    <td
      className={['px-2 py-1.5 align-middle cursor-pointer', column.widthClass ?? '', finalReturnRing].join(' ')}
      onClick={() => handleCellClick(entity, column, cell)}
      title={tooltip}
    >
      <FilingStatusBadge status={cell.status} />
    </td>
  );
}

function buildTooltip(cell: MatrixCell): string {
  const parts: string[] = [filingStatusLabel(cell.status)];
  if (cell.deadline_date) parts.push(`Deadline: ${cell.deadline_date}`);
  if (cell.filed_at) parts.push(`Filed: ${cell.filed_at}`);
  if (cell.draft_sent_at) parts.push(`Draft sent: ${cell.draft_sent_at}`);
  if (cell.assigned_to) parts.push(`Assignee: ${cell.assigned_to}`);
  if (cell.partner_in_charge?.length) parts.push(`Partner in charge: ${cell.partner_in_charge.join(', ')}`);
  else if (cell.prepared_with?.length) parts.push(`Prepared with: ${cell.prepared_with.join(', ')}`);
  if (cell.associates_working?.length) parts.push(`Associates: ${cell.associates_working.join(', ')}`);
  if (cell.comments) {
    const snippet = cell.comments.length > 120 ? cell.comments.slice(0, 120) + '…' : cell.comments;
    parts.push(`Comments: ${snippet}`);
  }
  return parts.join('\n');
}

// ════════════════════════════════════════════════════════════════════════
// BulkActionBar — stint 64.O F1
//
// Floating bar that surfaces at the bottom-right of the matrix wrapper
// when the user has selected 1+ rows. Mirrors the Linear / Notion /
// Gmail pattern: action targets are visible at the moment of choice.
//
// MVP ships ONE bulk action — "Reassign partner in charge" — because
// it's the highest-value Big4 use case Diego's likely to hit (a
// partner leaves the firm, all their entities re-assign in one click).
// Adding more actions is a matter of dropping more buttons here +
// callbacks; the selection plumbing is already in place.
// ════════════════════════════════════════════════════════════════════════

function BulkActionBar({
  selectedCount, selectedIds, onClear,
  partnerOptions, onReassignPartner,
}: {
  selectedCount: number;
  selectedIds: string[];
  onClear: () => void;
  partnerOptions: Array<{ value: string; label: string }>;
  onReassignPartner?: (args: { entityIds: string[]; partnerName: string }) => Promise<void>;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pickedPartner, setPickedPartner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function handleApply() {
    if (!pickedPartner || !onReassignPartner) return;
    setBusy(true);
    try {
      await onReassignPartner({ entityIds: selectedIds, partnerName: pickedPartner });
      toast.success(`Partner reassigned on ${selectedIds.length} ${selectedIds.length === 1 ? 'entity' : 'entities'}`);
      setPopoverOpen(false);
      setPickedPartner(null);
      onClear();
    } catch (e) {
      toast.error(`Failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="sticky bottom-2 z-[30] flex justify-end pointer-events-none"
      // The wrapper is sticky inside the overflow:auto matrix container,
      // so the bar stays visible while the user scrolls the table.
    >
      <div className="pointer-events-auto inline-flex items-center gap-2 px-3 py-2 mr-2 mb-2 rounded-lg bg-ink shadow-lg text-white text-sm">
        <span className="font-medium tabular-nums">{selectedCount} selected</span>
        <span className="opacity-30">·</span>
        {onReassignPartner && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPopoverOpen(o => !o)}
              disabled={busy}
              className="px-2 py-0.5 rounded text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50"
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
            >
              Reassign partner ▾
            </button>
            {popoverOpen && (
              <div
                role="dialog"
                aria-label="Reassign partner"
                className="absolute bottom-full right-0 mb-1 w-64 bg-surface text-ink border border-border rounded-md shadow-lg p-2"
              >
                <label className="block text-xs text-ink-muted mb-1">Pick partner</label>
                <select
                  value={pickedPartner ?? ''}
                  onChange={(e) => setPickedPartner(e.target.value || null)}
                  disabled={busy}
                  className="w-full h-8 px-2 text-sm border border-border rounded-md bg-surface mb-2"
                >
                  <option value="">— Select —</option>
                  {partnerOptions
                    .filter(o => o.value && o.value !== 'all' && o.value !== '__unassigned')
                    .map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => { setPopoverOpen(false); setPickedPartner(null); }}
                    disabled={busy}
                    className="px-2 py-1 rounded text-xs text-ink-soft hover:bg-surface-alt"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={busy || !pickedPartner}
                    className="px-2 py-1 rounded text-xs bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {busy ? 'Applying…' : 'Apply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="px-2 py-0.5 rounded text-xs hover:bg-white/20 disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
