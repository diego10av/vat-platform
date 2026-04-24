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
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { FilingStatusBadge, filingStatusLabel } from './FilingStatusBadge';

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
  /** Called when a cell is clicked and that cell has a filing. Default:
   *  navigates to /tax-ops/filings/[id]. */
  onCellClick?: (entity: MatrixEntity, column: MatrixColumn, cell: MatrixCell) => void;
  /** Empty-state copy. */
  emptyMessage?: string;
}

export function TaxTypeMatrix({
  entities, columns,
  firstColLabel = 'Entity',
  grouped = true,
  rowAction,
  onCellClick,
  emptyMessage = 'No entities with this obligation. Toggle "Show all entities" to activate one.',
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

  return (
    <div className="rounded-md border border-border bg-surface overflow-auto relative">
      <table className="w-full text-[12px] border-collapse">
        <thead className="bg-surface-alt sticky top-0 z-10">
          <tr className="text-left text-ink-muted">
            <th className="sticky left-0 z-20 bg-surface-alt border-b border-r border-border px-2.5 py-2 font-medium min-w-[220px]">
              {firstColLabel}
            </th>
            {columns.map(col => (
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
            {rowAction && (
              <th className="border-b border-border px-2 py-2 font-medium w-[40px]"></th>
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
                columns={columns}
                rowAction={rowAction}
                handleCellClick={handleCellClick}
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
  columns, rowAction, handleCellClick,
}: {
  group: { name: string; items: MatrixEntity[] };
  grouped: boolean;
  isCollapsed: boolean;
  toggleGroup: (name: string) => void;
  columns: MatrixColumn[];
  rowAction?: (entity: MatrixEntity) => React.ReactNode;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
}) {
  const totalCols = 1 + columns.length + (rowAction ? 1 : 0);

  return (
    <>
      {grouped && group.name && (
        <tr>
          <td
            colSpan={totalCols}
            className="sticky left-0 bg-surface-alt/70 border-b border-border px-2.5 py-1 font-semibold text-[11.5px] text-ink cursor-pointer hover:bg-surface-alt"
            onClick={() => toggleGroup(group.name)}
          >
            <span className="inline-flex items-center gap-1">
              {isCollapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
              {group.name}
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
          rowAction={rowAction}
          handleCellClick={handleCellClick}
        />
      ))}
    </>
  );
}

function RowRender({
  entity, columns, rowAction, handleCellClick,
}: {
  entity: MatrixEntity;
  columns: MatrixColumn[];
  rowAction?: (entity: MatrixEntity) => React.ReactNode;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
}) {
  return (
    <tr className="border-b border-border/70 hover:bg-surface-alt/40">
      <td className="sticky left-0 bg-surface hover:bg-surface-alt/40 border-r border-border px-2.5 py-1.5 min-w-[220px] max-w-[320px]">
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
        />
      ))}
      {rowAction && (
        <td className="px-2 py-1.5 text-right">{rowAction(entity)}</td>
      )}
    </tr>
  );
}

function CellRender({
  entity, column, handleCellClick,
}: {
  entity: MatrixEntity;
  column: MatrixColumn;
  handleCellClick: (e: MatrixEntity, col: MatrixColumn, cell: MatrixCell) => void;
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
