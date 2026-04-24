'use client';

// ════════════════════════════════════════════════════════════════════════
// TaxTypeMatrix — the Excel-style primitive that powers every tax-ops
// category page (CIT, NWT, VAT × 3, Subscription, WHT, BCL, Other).
//
// Layout rules (chosen to match Diego's Excel density):
//   - text-[12px] base, py-1.5 px-2 cells, border dividers
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
import { familyChipClasses } from './familyColors';

export interface MatrixCell {
  filing_id: string;
  status: string;
  deadline_date: string | null;
  assigned_to: string | null;
  comments: string | null;
  filed_at: string | null;
  draft_sent_at: string | null;
  tax_assessment_received_at: string | null;
  amount_due: string | null;
  amount_paid: string | null;
  prepared_with: string[];
  /** Stint 39.F — last chase date to client/CSP for this filing. */
  last_info_request_sent_at: string | null;
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
}: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!grouped) return [{ name: '', items: entities }];
    const m = new Map<string, MatrixEntity[]>();
    for (const e of entities) {
      const key = e.group_name ?? '(no group)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => ({ name, items }));
  }, [entities, grouped]);

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
        <div className="text-[12.5px] text-ink-muted italic">{emptyMessage}</div>
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

  return (
    <div className="rounded-md border border-border bg-surface overflow-auto relative">
      <table className="w-full text-[12px] border-collapse">
        <thead className="bg-surface-alt sticky top-0 z-10">
          <tr className="text-left text-ink-muted">
            {familyCol && (
              <th
                className="sticky left-0 z-20 bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium w-[170px]"
              >
                {familyCol.label}
              </th>
            )}
            <th
              className="sticky z-20 bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium min-w-[220px]"
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
                totalCols={(familyCol ? 1 : 0) + 1 + otherCols.length + (effectiveRowAction ? 1 : 0)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({
  group, grouped, isCollapsed, toggleGroup,
  columns, familyCol, entityStickyLeft,
  rowAction, handleCellClick, onStatusChange,
  groupFooter, totalCols,
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
            className="sticky left-0 bg-surface-alt/70 border-b border-border px-2.5 py-1 font-semibold text-[11.5px] text-ink"
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
}: {
  entity: MatrixEntity;
  columns: MatrixColumn[];
  familyCol: MatrixColumn | null;
  entityStickyLeft: number;
  rowAction?: (entity: MatrixEntity) => React.ReactNode;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
  onStatusChange?: Props['onStatusChange'];
}) {
  return (
    <tr className="border-b border-border/70 hover:bg-surface-alt/40">
      {familyCol && (
        <td className="sticky left-0 z-10 bg-surface hover:bg-surface-alt/40 border-r border-border px-2 py-1.5 w-[170px]">
          {familyCol.render
            ? familyCol.render(entity)
            : (entity.group_name
                ? <span className={[
                    'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium truncate max-w-[150px]',
                    familyChipClasses(entity.group_name),
                  ].join(' ')} title={entity.group_name}>
                    {entity.group_name}
                  </span>
                : <span className="text-ink-faint italic text-[11px]">—</span>)
          }
        </td>
      )}
      <td
        className="sticky z-10 bg-surface hover:bg-surface-alt/40 border-r border-border px-2.5 py-1.5 min-w-[220px] max-w-[320px]"
        style={{ left: `${entityStickyLeft}px` }}
      >
        <Link
          href={`/tax-ops/entities/${entity.id}`}
          className="text-ink hover:text-brand-700 font-medium block truncate"
          title={entity.legal_name}
        >
          {entity.legal_name}
        </Link>
      </td>
      {columns.map(col => (
        <CellRender
          key={col.key}
          entity={entity}
          column={col}
          handleCellClick={handleCellClick}
          onStatusChange={onStatusChange}
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
}: {
  entity: MatrixEntity;
  column: MatrixColumn;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
  onStatusChange?: Props['onStatusChange'];
}) {
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

  // Inline-edit enabled path (stint 36): render the status as an
  // InlineStatusCell with onSave wired to onStatusChange. Empty cells
  // still render the dropdown so the user can "set a status" → creates
  // the filing on save. Disabled when the entity lacks an obligation_id
  // (no way to place a filing without one).
  if (onStatusChange) {
    const disabled = !entity.obligation_id;
    return (
      <td
        className={['px-1.5 py-1 align-middle', column.widthClass ?? ''].join(' ')}
        title={cell ? buildTooltip(cell) : disabled ? 'No obligation — add one on the entity detail page' : 'Click to set a status (creates the filing)'}
      >
        <InlineStatusCell
          value={cell?.status ?? 'info_to_request'}
          disabled={disabled}
          onSave={(next) => onStatusChange({ entity, column, cell, nextStatus: next })}
        />
        {!cell && !disabled && (
          <span className="ml-0.5 text-[10px] text-ink-faint" aria-hidden>·new</span>
        )}
      </td>
    );
  }

  // Read-only click-through fallback (pre-stint-36 behaviour).
  if (!cell) {
    return (
      <td className={['px-2 py-1.5 align-middle text-ink-faint', column.widthClass ?? ''].join(' ')}>
        —
      </td>
    );
  }
  const tooltip = buildTooltip(cell);
  return (
    <td
      className={['px-2 py-1.5 align-middle cursor-pointer', column.widthClass ?? ''].join(' ')}
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
  if (cell.prepared_with?.length) parts.push(`Prepared with: ${cell.prepared_with.join(', ')}`);
  if (cell.comments) {
    const snippet = cell.comments.length > 120 ? cell.comments.slice(0, 120) + '…' : cell.comments;
    parts.push(`Comments: ${snippet}`);
  }
  return parts.join('\n');
}
