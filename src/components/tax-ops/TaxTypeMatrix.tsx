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
import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from 'lucide-react';
import { FilingStatusBadge, filingStatusLabel } from './FilingStatusBadge';
import { InlineStatusCell } from './inline-editors';
import { familyChipClasses, buildFamilyColorMap } from './familyColors';
import { FamilyColorProvider } from './FamilyColorContext';
import { LiquidationChip, isFinalReturnPeriod } from './LiquidationChip';
import { EntityActionsMenu } from './EntityActionsMenu';

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
}: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
      className="rounded-md border border-border bg-surface overflow-auto relative"
      style={{ maxHeight: 'calc(100vh - 220px)' }}
    >
      <table className="min-w-full text-sm border-separate border-spacing-0">
        <thead className="bg-surface-alt sticky top-0 z-sticky">
          <tr className="text-left text-ink-muted">
            {familyCol && (
              <th
                className="sticky left-0 z-sticky bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium min-w-[170px] max-w-[170px]"
              >
                {familyCol.label}
              </th>
            )}
            <th
              className="sticky z-sticky bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium min-w-[220px]"
              style={{ left: `${entityStickyLeft}px` }}
            >
              {firstColLabel}
            </th>
            {otherCols.map(col => (
              <th
                key={col.key}
                className={[
                  'border-b border-border px-2 py-2 font-medium whitespace-nowrap',
                  col.alignRight ? 'text-right' : 'text-left',
                  col.widthClass ?? '',
                ].join(' ')}
              >
                {col.label}
              </th>
            ))}
            {effectiveRowAction && (
              <th className="border-b border-border px-2 py-2 font-medium w-[60px]"></th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => {
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
}) {
  // First entity's group_id is the canonical id for this group — use it
  // when calling groupFooter so "+Add" knows where to attach new entities.
  const groupId = group.items[0]?.group_id ?? null;

  return (
    <>
      {grouped && group.name && (
        <tr>
          <td
            colSpan={totalCols}
            className="sticky left-0 bg-surface-alt/70 border-b border-border px-2.5 py-1 font-semibold text-xs text-ink"
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
        />
      ))}
      {!isCollapsed && groupFooter && (
        <tr className="border-b border-border/70 bg-surface-alt/20">
          <td
            colSpan={totalCols}
            className="sticky left-0 bg-surface-alt/20 border-r border-border"
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
}) {
  // Stint 43.D15 — row tinting + sticky-cell tinting must match. The
  // sticky cells (family + entity) live on `bg-surface` to override the
  // tr's bg, so when we tint the row we have to tint those cells too,
  // otherwise they paint a clean white strip on top of the amber row.
  const tinted = liquidationVisuals && !!entity.liquidation_date;
  const trClass = [
    tinted
      ? 'border-b border-border/70 bg-amber-50/40 hover:bg-amber-50/70'
      : 'border-b border-border/70 hover:bg-surface-alt/50',
    isDragging ? 'opacity-40' : '',
  ].join(' ');
  const stickyBgClass = tinted
    ? 'bg-amber-50/60 hover:bg-amber-50/80'
    : 'bg-surface hover:bg-surface-alt/50';

  return (
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
          'sticky left-0 z-sticky border-r border-border px-2 py-1.5 min-w-[170px] max-w-[170px]',
          stickyBgClass,
          draggable ? 'cursor-grab active:cursor-grabbing' : '',
        ].join(' ')}
        title={draggable ? 'Drag to reorder within this family' : undefined}
        >
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
        </td>
      )}
      <td
        className={[
          'sticky z-sticky border-r border-border px-2.5 py-1.5 min-w-[220px] max-w-[320px]',
          stickyBgClass,
        ].join(' ')}
        style={{ left: `${entityStickyLeft}px` }}
      >
        <div className="flex items-center min-w-0">
          <Link
            href={`/tax-ops/entities/${entity.id}`}
            className="text-ink hover:text-brand-700 font-medium truncate"
            title={entity.legal_name}
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
