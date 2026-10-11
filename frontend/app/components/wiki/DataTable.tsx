import type { ReactNode } from "react";

import { cx, wikiHairline, wikiRowDivider, wikiTableHead } from "./wikiStyles";

export type DataTableAlign = "left" | "center" | "right";

export interface DataTableColumn {
  /** Header text for this column. Rendered in a `<th scope="col">`. */
  header: ReactNode;
  /** Defaults to `"left"`. */
  align?: DataTableAlign;
  /** CSS width hint, e.g. `"12rem"` or `"25%"`. Advisory: the browser may ignore it. */
  width?: string;
  /** Stop this column's cells wrapping (short codes, numbers, durations). */
  nowrap?: boolean;
}

/** Anything React can render: a string, a number, a `<Link>`, an `<ItemChip>`, ... */
export type DataTableCell = ReactNode;

export interface DataTableProps {
  columns: DataTableColumn[];
  /** One array per row, in column order. Short rows render empty trailing cells. */
  rows: DataTableCell[][];
  /** Visible table caption. Also the table's accessible name. */
  caption?: ReactNode;
  /**
   * Width below which the table scrolls sideways instead of crushing its
   * columns. Defaults to `"32rem"`. Drop it for two-column tables of short values.
   */
  minWidth?: string;
  /** Key for each row; defaults to the row index. */
  rowKey?: (row: DataTableCell[], index: number) => string;
  /** Shown instead of the table body when `rows` is empty. */
  emptyMessage?: string;
  /** Use the declared column widths instead of sizing columns from their longest cell. */
  fixedLayout?: boolean;
  className?: string;
}

const ALIGN: Record<DataTableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * The wiki's generic table. Semantic `<table>` with `<th scope="col">` headers,
 * wrapped in a horizontally scrollable shell so it stays readable on a phone.
 *
 * The first column is rendered in cream (it is the row's subject); the rest in
 * mist. Pass a `<span className="text-[var(--tfmc-accent)]">` yourself if a cell
 * needs the accent colour.
 */
export default function DataTable({
  columns,
  rows,
  caption,
  minWidth = "32rem",
  rowKey,
  emptyMessage = "Nothing here yet.",
  fixedLayout = false,
  className,
}: DataTableProps) {
  if (rows.length === 0) {
    return (
      <div className={cx("mt-2 rounded-md p-3 text-sm text-[var(--tfmc-mist)]", wikiHairline, className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cx("mt-2 overflow-x-auto rounded-md", wikiHairline, className)}>
      <table className={cx("w-full text-left text-sm", fixedLayout && "table-fixed")} style={{ minWidth }}>
        {caption ? <caption className="px-3 pt-2 text-left text-xs text-[var(--tfmc-stone)]">{caption}</caption> : null}
        <thead className={wikiTableHead}>
          <tr>
            {columns.map((column, i) => (
              <th
                key={i}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cx("px-3 py-2 font-medium", ALIGN[column.align ?? "left"])}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowKey ? rowKey(row, rowIndex) : rowIndex} className={cx(wikiRowDivider, "align-top")}>
              {columns.map((column, colIndex) => (
                <td
                  key={colIndex}
                  className={cx(
                    "px-3 py-2",
                    ALIGN[column.align ?? "left"],
                    column.nowrap && "whitespace-nowrap",
                    colIndex === 0 ? "text-[var(--tfmc-cream)]" : "text-[var(--tfmc-mist)]",
                  )}
                >
                  {row[colIndex]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
