"use client";

import { type ColumnDef, type RowData, tableFeatures, useTable } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./primitives";

export const coreFeatures = tableFeatures({});
export type CoreFeatures = typeof coreFeatures;

/**
 * High-density data table. Data is paged and filtered by the server, so the table only
 * renders what it is given. Rows are keyboard-activatable when `onRowClick` is set.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  loading,
  empty,
  onRowClick,
  rowLabel,
  getRowId,
}: {
  // Columns hold different value types; `any` is TanStack's documented pattern for mixed arrays.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<CoreFeatures, T, any>[];
  data: T[];
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  getRowId: (row: T) => string;
}) {
  const table = useTable({ features: coreFeatures, columns, data, getRowId: (r) => getRowId(r) });

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface/95 px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle backdrop-blur first:pl-5 last:pr-5"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j} className="border-b border-border px-4 py-3.5 first:pl-5 last:pr-5">
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            : table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick && rowLabel ? rowLabel(row.original) : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row.original);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "group transition-colors",
                    onRowClick &&
                      "cursor-pointer hover:bg-surface-sunken/70 focus-visible:bg-surface-sunken focus-visible:outline-none",
                  )}
                >
                  {row.getAllCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="border-b border-border px-4 py-3 align-middle first:pl-5 last:pr-5"
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && data.length === 0 && empty}
    </div>
  );
}
