'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/client/use-media-query';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from './dropdown-menu';
import { EmptyState } from './empty-state';
import { IconButton } from './icon-button';
import { Select } from './select';
import { Skeleton } from './skeleton';
import { Table, TBody, TD, TH, THead, TR } from './table';

export type SortState = { id: string; dir: 'asc' | 'desc' } | null;

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  /** plain-text name for the column menu (defaults to `header` when it is a string) */
  label?: string;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** value used when sorting client-side (the current page) */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** can be hidden from the column menu (default true) */
  hideable?: boolean;
  defaultHidden?: boolean;
  /** how the column appears in the stacked card on phones */
  mobile?: 'title' | 'sub' | 'status' | 'value' | 'detail' | 'hide';
}

export interface DataTableProps<T> {
  /** persistence key for column visibility */
  id: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** shown when there are no rows (use <EmptyState/>; for "no results" include the filters + Clear action) */
  empty?: React.ReactNode;
  caption?: string;
  /** controlled sorting (server-side) — omit for client-side sorting of the current page */
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  /** server-side pagination */
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (s: Set<string>) => void;
  bulkActions?: (rows: T[], clear: () => void) => React.ReactNode;
  onRowClick?: (row: T) => void;
  activeRowKey?: string | null;
  compact?: boolean;
  /**
   * Skip re-rendering a row (and phone card) unless its data object, selection or active state changed, so ticking a checkbox or opening a
   * drawer on a 100-row page redraws one row, not all of them. Only enable when every `cell` is a pure function of its row (no other state).
   */
  memoRows?: boolean;
  /** extra toolbar controls placed next to the column menu */
  toolbar?: React.ReactNode;
  /** saved filter chips row, above the table */
  filters?: React.ReactNode;
  className?: string;
}

const colKey = (id: string) => `ss:cols:${id}`;

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

interface RowProps<T> {
  row: T;
  rowId: string;
  cols: Column<T>[];
  /** ids of the visible columns: part of the memo check, the `cols` array itself is rebuilt on every parent render */
  colsKey: string;
  compact?: boolean;
  selectable?: boolean;
  isSel: boolean;
  active: boolean;
  clickable: boolean;
  onRowClick: (row: T) => void;
  onToggle: (k: string) => void;
}

function DataRowImpl<T>({ row, rowId: k, cols, compact, selectable, isSel, active, clickable, onRowClick, onToggle }: RowProps<T>) {
  return (
    <TR
      data-row-key={k}
      interactive={clickable}
      selected={isSel || active}
      onClick={clickable ? () => onRowClick(row) : undefined}
      onKeyDown={clickable ? (e) => (e.key === 'Enter' && e.target === e.currentTarget ? onRowClick(row) : undefined) : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-selected={isSel || undefined}
    >
      {selectable && (
        <TD compact={compact} className="w-11 pr-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={isSel} onCheckedChange={() => onToggle(k)} aria-label="Select row" />
        </TD>
      )}
      {cols.map((c) => (
        <TD key={c.id} align={c.align} compact={compact} className={c.className}>
          {c.cell(row)}
        </TD>
      ))}
    </TR>
  );
}

function DataCardImpl<T>({ row, rowId: k, cols, selectable, isSel, clickable, onRowClick, onToggle }: RowProps<T>) {
  const titleCol = cols.find((c) => c.mobile === 'title') ?? cols[0]!;
  const mob = (m: Column<T>['mobile']) => cols.filter((c) => c.mobile === m);
  return (
    <li className={cn('flex gap-3 p-4', isSel && 'bg-brand-soft')}>
      {selectable && <Checkbox className="mt-0.5" checked={isSel} onCheckedChange={() => onToggle(k)} aria-label="Select row" />}
      <div
        className={cn('min-w-0 flex-1 space-y-1.5', clickable && 'cursor-pointer')}
        onClick={clickable ? () => onRowClick(row) : undefined}
        onKeyDown={clickable ? (e) => (e.key === 'Enter' ? onRowClick(row) : undefined) : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm font-medium">{titleCol.cell(row)}</div>
          <div className="shrink-0">{mob('status').map((c) => <React.Fragment key={c.id}>{c.cell(row)}</React.Fragment>)}</div>
        </div>
        {mob('sub').map((c) => (
          <div key={c.id} className="t-caption text-ink-2">{c.cell(row)}</div>
        ))}
        {mob('value').length > 0 && <div className="flex items-baseline justify-between gap-3">{mob('value').map((c) => <span key={c.id} className="text-sm font-medium tabular-nums">{c.cell(row)}</span>)}</div>}
        {mob('detail').map((c) => (
          <div key={c.id} className="t-caption flex justify-between gap-3 text-ink-2">
            <span>{c.label ?? (typeof c.header === 'string' ? c.header : c.id)}</span>
            <span className="text-ink">{c.cell(row)}</span>
          </div>
        ))}
      </div>
    </li>
  );
}

const sameRow = <T,>(a: RowProps<T>, b: RowProps<T>) => a.row === b.row && a.colsKey === b.colsKey && a.isSel === b.isSel && a.active === b.active && a.compact === b.compact && a.selectable === b.selectable && a.clickable === b.clickable;
const MemoDataRow = React.memo(DataRowImpl, sameRow) as typeof DataRowImpl;
const MemoDataCard = React.memo(DataCardImpl, sameRow) as typeof DataCardImpl;

/**
 * The data table (design.md §8): 44 px rows, hairlines, sticky subtle header, sortable columns (aria-sort), selection with a
 * sticky bulk-action bar, column menu, server pagination with page size, skeleton / empty / error states, and stacked cards on phones.
 */
export function DataTable<T>({
  id,
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  caption,
  sort: sortProp,
  onSortChange,
  page = 1,
  pageSize = 25,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  selectable,
  selected,
  onSelectedChange,
  bulkActions,
  onRowClick,
  activeRowKey,
  compact,
  memoRows,
  toolbar,
  filters,
  className,
}: DataTableProps<T>) {
  // The table and the phone card list used to both render every row (CSS hid one): twice the work for large pages. Render only the visible one.
  const wide = useMediaQuery('(min-width: 768px)', true);
  const [innerSort, setInnerSort] = React.useState<SortState>(null);
  const [hidden, setHidden] = React.useState<Record<string, boolean>>(() => Object.fromEntries(columns.filter((c) => c.defaultHidden).map((c) => [c.id, true])));
  const controlledSort = onSortChange !== undefined;
  const sort = controlledSort ? (sortProp ?? null) : innerSort;

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(colKey(id));
      if (saved) setHidden(JSON.parse(saved) as Record<string, boolean>);
    } catch {}
  }, [id]);
  const toggleCol = (cid: string, show: boolean) =>
    setHidden((h) => {
      const next = { ...h, [cid]: !show };
      try {
        localStorage.setItem(colKey(id), JSON.stringify(next));
      } catch {}
      return next;
    });

  const visibleCols = columns.filter((c) => !hidden[c.id]);
  const sorted = React.useMemo(() => {
    if (!rows || controlledSort || !sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((x, y) => dir * compare(col.sortValue!(x), col.sortValue!(y)));
  }, [rows, columns, sort, controlledSort]);

  const setSort = (cid: string) => {
    const next: SortState = !sort || sort.id !== cid ? { id: cid, dir: 'asc' } : sort.dir === 'asc' ? { id: cid, dir: 'desc' } : null;
    if (controlledSort) onSortChange!(next);
    else setInnerSort(next);
  };

  const count = total ?? sorted?.length ?? 0;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const showFooter = !loading && !error && count > 0 && onPageChange !== undefined;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);

  const pageKeys = (sorted ?? []).map(rowKey);
  const selCount = selected?.size ?? 0;
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selected?.has(k));
  const someOnPage = pageKeys.some((k) => selected?.has(k));
  const setSel = (next: Set<string>) => onSelectedChange?.(next);
  // stable callbacks for the memoized rows: they read the latest props at click time instead of closing over this render's
  const latest = React.useRef({ onRowClick, selected, onSelectedChange });
  React.useLayoutEffect(() => {
    latest.current = { onRowClick, selected, onSelectedChange };
  });
  const rowClick = React.useCallback((row: T) => latest.current.onRowClick?.(row), []);
  const toggleRow = React.useCallback((k: string) => {
    const n = new Set(latest.current.selected);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    latest.current.onSelectedChange?.(n);
  }, []);
  const colsKey = visibleCols.map((c) => c.id).join('|');
  const allColsKey = columns.map((c) => c.id).join('|'); // phone cards ignore the column menu, as before
  const Row = memoRows ? MemoDataRow : DataRowImpl;
  const Card = memoRows ? MemoDataCard : DataCardImpl;
  const togglePage = () => {
    const n = new Set(selected);
    if (allOnPage) pageKeys.forEach((k) => n.delete(k));
    else pageKeys.forEach((k) => n.add(k));
    setSel(n);
  };
  const selectedRows = (sorted ?? []).filter((r) => selected?.has(rowKey(r)));

  const skeletonRows = Math.min(pageSize, 10);
  const stateBody = !loading && error ? (
    <EmptyState illustration="error-offline" title="We couldn’t load this list" description={error instanceof Error ? error.message : 'Something went wrong while loading.'} action={onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>} compact />
  ) : !loading && sorted && sorted.length === 0 ? (
    (empty ?? <EmptyState illustration="empty-generic" title="Nothing here yet" description="When records are added they will show up in this list." compact />)
  ) : null;

  return (
    <div className={cn('space-y-3', className)}>
      {(filters || toolbar || columns.some((c) => c.hideable !== false)) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{filters}</div>
          <div className="flex items-center gap-1">
            {toolbar}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <span className="hidden md:inline-flex">
                  <IconButton label="Columns" variant="secondary" size="icon" type="button">
                    <Columns3 />
                  </IconButton>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {columns
                  .filter((c) => c.hideable !== false)
                  .map((c) => (
                    <DropdownMenuCheckboxItem key={c.id} checked={!hidden[c.id]} onCheckedChange={(v) => toggleCol(c.id, !!v)} onSelect={(e) => e.preventDefault()}>
                      {c.label ?? (typeof c.header === 'string' ? c.header : c.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {/* tablet / desktop: table */}
        <div className="hidden overflow-x-auto md:block">
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <THead>
              <tr>
                {selectable && (
                  <TH className="w-11 pr-0">
                    <Checkbox checked={allOnPage ? true : someOnPage ? 'indeterminate' : false} onCheckedChange={togglePage} aria-label="Select all rows on this page" disabled={loading || pageKeys.length === 0} />
                  </TH>
                )}
                {visibleCols.map((c) => {
                  const active = sort?.id === c.id;
                  return (
                    <TH key={c.id} align={c.align} className={c.className} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}>
                      {c.sortable ? (
                        <button type="button" onClick={() => setSort(c.id)} className={cn('tr-colors -mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-ink', active && 'text-ink', c.align === 'right' && 'flex-row-reverse')}>
                          {c.header}
                          {active ? sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </TH>
                  );
                })}
              </tr>
            </THead>
            {wide && !loading && !error && sorted && sorted.length > 0 && (
              <TBody>
                {sorted.map((row) => {
                  const k = rowKey(row);
                  return <Row key={k} row={row} rowId={k} cols={visibleCols} colsKey={colsKey} compact={compact} selectable={selectable} isSel={!!selected?.has(k)} active={activeRowKey === k} clickable={!!onRowClick} onRowClick={rowClick} onToggle={toggleRow} />;
                })}
              </TBody>
            )}
            {loading && (
              <TBody aria-busy>
                {Array.from({ length: skeletonRows }, (_, i) => (
                  <TR key={i}>
                    {selectable && <TD compact={compact} className="w-11 pr-0"><Skeleton className="size-[18px]" /></TD>}
                    {visibleCols.map((c, j) => (
                      <TD key={c.id} compact={compact} align={c.align}>
                        <Skeleton className={cn('h-4', c.align === 'right' && 'ml-auto', j === 0 ? 'w-40' : 'w-20')} />
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            )}
          </Table>
        </div>

        {/* phone: stacked cards — two key fields and a status chip */}
        <ul className="divide-y divide-border md:hidden" aria-busy={loading || undefined}>
          {loading &&
            Array.from({ length: Math.min(skeletonRows, 6) }, (_, i) => (
              <li key={i} className="space-y-2 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </li>
            ))}
          {!wide &&
            !loading &&
            !error &&
            sorted?.map((row) => {
              const k = rowKey(row);
              return <Card key={k} row={row} rowId={k} cols={columns} colsKey={allColsKey} selectable={selectable} isSel={!!selected?.has(k)} active={activeRowKey === k} clickable={!!onRowClick} onRowClick={rowClick} onToggle={toggleRow} />;
            })}
        </ul>

        {stateBody}

        {showFooter && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <span className="t-caption tnum text-ink-2">
              {from.toLocaleString()}–{to.toLocaleString()} of {count.toLocaleString()}
            </span>
            <div className="flex items-center gap-3">
              {onPageSizeChange && (
                <label className="t-caption hidden items-center gap-2 text-ink-2 sm:flex">
                  Rows
                  <Select className="!h-8 w-[76px]" aria-label="Rows per page" value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))} options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))} />
                </label>
              )}
              <div className="flex items-center gap-1">
                <IconButton label="Previous page" variant="ghost" size="icon-sm" onClick={() => onPageChange!(Math.max(1, page - 1))} disabled={page <= 1}>
                  <ChevronLeft />
                </IconButton>
                <span className="t-caption tnum min-w-16 text-center text-ink-2">
                  Page {page} of {pages}
                </span>
                <IconButton label="Next page" variant="ghost" size="icon-sm" onClick={() => onPageChange!(Math.min(pages, page + 1))} disabled={page >= pages}>
                  <ChevronRight />
                </IconButton>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectable && selCount > 0 && (
        <div className="sticky bottom-4 z-20 flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2.5 shadow-pop" role="region" aria-label="Bulk actions">
          <span className="text-sm font-medium">{selCount.toLocaleString()} selected</span>
          <div className="flex flex-1 flex-wrap items-center gap-2">{bulkActions?.(selectedRows, () => setSel(new Set()))}</div>
          <IconButton label="Clear selection" variant="ghost" size="icon-sm" onClick={() => setSel(new Set())}>
            <X />
          </IconButton>
        </div>
      )}
    </div>
  );
}
