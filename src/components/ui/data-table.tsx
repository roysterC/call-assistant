"use client";

/**
 * Every table in the CRM, one look: design C from the table designs (roomy
 * rows, a person's initials beside their name, quiet headers, the next thing
 * as a pill, "Show more" rather than pages).
 *
 * Built on TanStack Table for the behaviour — sorting, searching, showing
 * more — and leaves the look to the classes here, so a page only describes
 * its columns:
 *
 *   <DataTable columns={columns} data={rows} onRowClick={open} rowLabel={(r) => r.name} />
 *
 * Data can be all here (sort, search and "Show more" happen in the browser)
 * or a page at a time from the server (`total`, `onShowMore`, and
 * `manualSorting` with `sorting`/`onSortingChange` when the server sorts).
 */

import { useState } from "react";
import Image from "next/image";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Numbers and money read best right-aligned. */
    align?: "left" | "right";
    /** Extra classes on this column's cells. */
    className?: string;
    /** Extra classes on this column's header. */
    headerClassName?: string;
  }
}

export type { ColumnDef, SortingState } from "@tanstack/react-table";

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  data: T[];
  getRowId?: (row: T) => string;
  /** Rows open something: the whole row is the button, with a chevron at its end. */
  onRowClick?: (row: T) => void;
  /** What "Open …" says for a row, to a screen reader. */
  rowLabel?: (row: T) => string;
  /** Highlight a row (a selected or failed one), as extra classes. */
  rowClassName?: (row: T) => string | undefined;
  /** Search across the columns, in the browser. Leave out when the server searches. */
  search?: string;
  loading?: boolean;
  /** Shown in place of the rows when there are none. */
  empty?: React.ReactNode;
  /** Sorted to start with, e.g. [{ id: "date", desc: true }]. */
  initialSorting?: SortingState;
  /** The server sorts: the table only reports what was clicked. */
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Show this many, then "Show more" adds as many again. Leave out to show all. */
  pageSize?: number;
  /** A page at a time from the server: how many there are in all ... */
  total?: number;
  /** ... and how to fetch the next page. */
  onShowMore?: () => void;
  loadingMore?: boolean;
  /** What the rows are, for the footer: "Showing 7 of 214 clients". */
  noun?: string;
  /**
   * Scroll inside the table rather than the page, with the header kept in
   * view: a height class such as "max-h-[50vh]". For tables inside dialogs.
   */
  scrollClassName?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  onRowClick,
  rowLabel,
  rowClassName,
  search,
  loading = false,
  empty,
  initialSorting = [],
  manualSorting = false,
  sorting: controlledSorting,
  onSortingChange,
  pageSize,
  total,
  onShowMore,
  loadingMore = false,
  noun,
  scrollClassName,
  className,
}: DataTableProps<T>) {
  const [ownSorting, setOwnSorting] = useState<SortingState>(initialSorting);
  const [shown, setShown] = useState(pageSize ?? Infinity);
  const sorting = controlledSorting ?? ownSorting;

  // TanStack Table hands back fresh functions each render, so the React
  // Compiler leaves this component unmemoised; that is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, globalFilter: search ?? "" },
    onSortingChange: onSortingChange ?? setOwnSorting,
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: search === undefined ? undefined : getFilteredRowModel(),
    globalFilterFn: "includesString",
  });

  const rows = table.getRowModel().rows;
  const hasFooter = table.getAllLeafColumns().some((c) => c.columnDef.footer !== undefined);
  const visible = rows.slice(0, shown);
  const columnCount = table.getVisibleLeafColumns().length + (onRowClick ? 1 : 0);

  // The footer: everything is here (show more locally), or a page of it is.
  const server = total !== undefined;
  const all = server ? total : rows.length;
  const canShowMore = server ? Boolean(onShowMore) && data.length < total : visible.length < rows.length;
  const showFooter = (server || pageSize !== undefined) && all > 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[14px] bg-card text-card-foreground shadow-surface ring-1 ring-border",
        className
      )}
    >
      <div className={cn("w-full overflow-x-auto", scrollClassName && cn("overflow-y-auto", scrollClassName))}>
        <table className="w-full border-collapse text-sm">
          <thead className={cn(scrollClassName && "sticky top-0 z-10 bg-card")}>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-border/70">
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      className={cn(
                        "whitespace-nowrap px-5 pt-3.5 pb-2.5 text-xs font-medium text-muted-foreground",
                        meta?.align === "right" ? "text-right" : "text-left",
                        meta?.headerClassName
                      )}
                    >
                      {sortable && label ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                            dir && "text-foreground"
                          )}
                        >
                          {label}
                          {dir === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                          ) : dir === "desc" ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
                {onRowClick && (
                  <th scope="col" className="w-10">
                    <span className="sr-only">Open</span>
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && data.length === 0 ? (
              Array.from({ length: 3 }, (_, i) => (
                <tr key={`loading-${i}`} className="border-b border-border/40 last:border-0">
                  <td colSpan={columnCount} className="px-5 py-4">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  </td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-0">
                  {empty ?? <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing here yet.</p>}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const open = onRowClick ? () => onRowClick(row.original) : undefined;
                return (
                  <tr
                    key={row.id}
                    onClick={open}
                    onKeyDown={
                      open
                        ? (e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              open();
                            }
                          }
                        : undefined
                    }
                    tabIndex={open ? 0 : undefined}
                    aria-label={open && rowLabel ? `Open ${rowLabel(row.original)}` : undefined}
                    className={cn(
                      "border-b border-border/40 transition-colors last:border-0",
                      open
                        ? "cursor-pointer hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                        : "hover:bg-accent/25",
                      rowClassName?.(row.original)
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-5 py-3 align-middle",
                            meta?.align === "right" && "text-right tabular-nums",
                            meta?.className
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                    {open && (
                      <td className="w-10 pr-4 text-right align-middle text-muted-foreground/70">
                        <ChevronRight className="ml-auto h-4 w-4" aria-hidden />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          {/* A totals row, from the columns' `footer`s, when any column has one. */}
          {hasFooter && visible.length > 0 && (
            <tfoot>
              {table.getFooterGroups().slice(0, 1).map((group) => (
                <tr key={group.id} className="border-t border-border/70 bg-muted/40 font-medium">
                  {group.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    return (
                      <td
                        key={header.id}
                        className={cn(
                          "px-5 py-3 align-middle",
                          meta?.align === "right" && "text-right tabular-nums",
                          meta?.className
                        )}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.footer, header.getContext())}
                      </td>
                    );
                  })}
                  {onRowClick && <td />}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      {showFooter && (
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3 text-sm text-muted-foreground">
          <span>
            Showing {Math.min(server ? data.length : visible.length, all).toLocaleString()} of{" "}
            {all.toLocaleString()}
            {noun ? ` ${noun}` : ""}
          </span>
          {canShowMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => (server ? onShowMore?.() : setShown((n) => n + (pageSize ?? 0)))}
              className="h-8 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Cells and the bar above a table, so every page draws them the same way.
 * ------------------------------------------------------------------------- */

const TINTS = [
  "bg-indigo-50 text-indigo-800",
  "bg-emerald-50 text-emerald-800",
  "bg-orange-50 text-orange-800",
  "bg-violet-50 text-violet-800",
  "bg-sky-50 text-sky-800",
];

/** The same colour for the same name, wherever it appears. */
function tintFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

/**
 * A person (or a business): their photo or initials, name, and a line under
 * it. A missing name reads "Unknown", in italics.
 */
export function PersonCell({
  name,
  detail,
  photoUrl,
  badge,
}: {
  name: string | null | undefined;
  detail?: React.ReactNode;
  /** A profile picture, where the channel gives one (Instagram, Facebook). */
  photoUrl?: string | null;
  /** A small flag after the name ("Possible duplicate"). */
  badge?: React.ReactNode;
}) {
  const known = Boolean(name?.trim());
  const shown = name?.trim() || "Unknown";
  return (
    <div className="flex min-w-0 items-center gap-3">
      {photoUrl ? (
        <Image src={photoUrl} alt="" width={36} height={36} unoptimized className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold", tintFor(shown))}
        >
          {initials(shown)}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate font-semibold", !known && "font-normal italic text-muted-foreground")}>{shown}</span>
          {badge}
        </span>
        {detail && (
          <span
            title={typeof detail === "string" ? detail : undefined}
            className="max-w-64 truncate text-[13px] text-muted-foreground tabular-nums"
          >
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}

/** Something coming up, or a highlight: an indigo pill. */
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800",
        className
      )}
    >
      {children}
    </span>
  );
}

/** A second line under a cell's main value. */
export function SubText({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs text-muted-foreground/80">{children}</span>;
}

/** Quick filters above a table: All / Booked in / … */
export function TableTabs<V extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: V;
  onChange: (value: V) => void;
  items: Array<{ value: V; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-0.5 rounded-[9px] bg-muted p-[3px]">
      {items.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(item.value)}
            className={cn(
              "h-[30px] rounded-[7px] px-3 text-[13px] font-medium transition-colors",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="ml-1.5 text-muted-foreground">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The search box above a table. */
export function TableSearch({
  value,
  onChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block w-full sm:w-[300px]", className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      />
    </label>
  );
}

/** The bar above a table: tabs on the left, search and buttons on the right. */
export function TableToolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 [&>*:last-child]:ml-auto">{children}</div>;
}
