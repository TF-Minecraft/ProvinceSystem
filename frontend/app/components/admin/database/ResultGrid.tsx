"use client";

import { useMemo, useState } from "react";

import { cellText, formatBytes, isBlob, toCsv, type Cell, type QueryResult } from "@/lib/admin/database";
import { CloseIcon, SortMark } from "./icons";
import { hairline, sunken, toolButton } from "./studioStyles";

/** Sorting done by the server (a table browse) rather than on the rows in hand. */
export type ServerSort = { order: string | null; descending: boolean; onSort: (column: string) => void };

type Props = {
  result: QueryResult;
  /** Column types from the schema, shown under each name when known. */
  types?: Record<string, string>;
  serverSort?: ServerSort;
  /** Number of the first row, for a browse page that starts further in. */
  firstRow?: number;
  fileName?: string;
};

function compare(a: Cell, b: Cell): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true });
}

function CellView({ cell }: { cell: Cell }) {
  if (cell === null)
    return <span className="italic text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)]">NULL</span>;
  if (isBlob(cell))
    return (
      <span className="rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] px-1 text-[10px] uppercase tracking-wider text-[var(--tfmc-mist)]">
        blob {formatBytes(cell.blob)}
      </span>
    );
  if (typeof cell === "boolean") return <span className="text-[#c8b6f0]">{String(cell)}</span>;
  return <>{String(cell)}</>;
}

/** Long text as written, JSON laid out. */
function inspected(cell: Cell): string {
  const text = cellText(cell);
  if (typeof cell === "string" && /^\s*[[{]/.test(cell)) {
    try {
      return JSON.stringify(JSON.parse(cell), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

export default function ResultGrid({ result, types, serverSort, firstRow = 1, fileName = "query" }: Props) {
  const [localSort, setLocalSort] = useState<{ index: number; descending: boolean } | null>(null);
  const [picked, setPicked] = useState<{ row: number; column: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => {
    const indexed = result.rows.map((row, i) => ({ row, i }));
    if (!serverSort && localSort) {
      indexed.sort((a, b) => {
        const order = compare(a.row[localSort.index], b.row[localSort.index]);
        return localSort.descending ? -order : order;
      });
    }
    return indexed;
  }, [result, localSort, serverSort]);

  const numeric = useMemo(
    () =>
      result.columns.map(
        (_, c) =>
          result.rows.some((r) => typeof r[c] === "number") &&
          result.rows.every((r) => r[c] === null || typeof r[c] === "number"),
      ),
    [result],
  );

  function sortBy(index: number) {
    if (serverSort) return serverSort.onSort(result.columns[index]);
    setLocalSort((s) =>
      s?.index === index ? (s.descending ? null : { index, descending: true }) : { index, descending: false },
    );
  }

  function direction(index: number): "asc" | "desc" | null {
    if (serverSort) return serverSort.order === result.columns[index] ? (serverSort.descending ? "desc" : "asc") : null;
    return localSort?.index === index ? (localSort.descending ? "desc" : "asc") : null;
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  function download() {
    const blob = new Blob([toCsv(result.columns, result.rows)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const pickedCell = picked ? result.rows[picked.row]?.[picked.column] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs text-[var(--tfmc-mist)]">
        <span role="status" className="text-[var(--tfmc-stone)]">
          {result.changes !== null ? (
            <>
              <strong className="mr-0.5 text-[var(--tfmc-cream)]">{result.changes.toLocaleString()}</strong>{" "}
              {result.changes === 1 ? "row changed" : "rows changed"}
              {result.columns.length ? ` · ${result.rows.length.toLocaleString()} returned` : ""}
            </>
          ) : (
            <>
              <strong className="mr-0.5 text-[var(--tfmc-cream)]">{result.rows.length.toLocaleString()}</strong>{" "}
              {result.rows.length === 1 ? "row" : "rows"}
            </>
          )}{" "}
          · {result.elapsed_ms.toLocaleString()} ms
        </span>
        {result.truncated ? (
          <span className="text-[#f0d090]">Only the first {result.limit.toLocaleString()} rows are shown.</span>
        ) : null}
        {result.columns.length ? (
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              className={toolButton}
              onClick={() => void copy(toCsv(result.columns, result.rows), "csv")}
            >
              {copied === "csv" ? "Copied" : "Copy CSV"}
            </button>
            <button type="button" className={toolButton} onClick={download}>
              Download CSV
            </button>
          </span>
        ) : null}
      </div>

      {result.columns.length ? (
        <div className={`min-h-0 flex-1 overflow-auto border-t ${hairline} ${sunken}`}>
          <table className="min-w-full border-separate border-spacing-0 font-mono text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th
                  scope="col"
                  className={`sticky left-0 z-20 w-12 border-b border-r ${hairline} bg-[var(--tfmc-forest-deep)] px-2 py-1.5 text-right font-normal text-[var(--tfmc-mist)]`}
                >
                  #
                </th>
                {result.columns.map((column, c) => (
                  <th
                    key={`${column}-${c}`}
                    scope="col"
                    aria-sort={
                      direction(c) === "asc" ? "ascending" : direction(c) === "desc" ? "descending" : undefined
                    }
                    className={`border-b border-r ${hairline} bg-[var(--tfmc-forest-deep)] p-0 text-left font-semibold`}
                  >
                    <button
                      type="button"
                      onClick={() => sortBy(c)}
                      className="flex w-full min-w-[6rem] flex-col items-start px-2.5 py-1.5 text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
                    >
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        {column}
                        <SortMark direction={direction(c)} />
                      </span>
                      {types?.[column] ? (
                        <span className="text-[10px] font-normal uppercase tracking-wide text-[var(--tfmc-mist)]">
                          {types[column]}
                        </span>
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, i }, shown) => (
                <tr key={i} className="group">
                  <td
                    className={`sticky left-0 border-b border-r ${hairline} bg-[var(--tfmc-forest-deep)] px-2 py-1 text-right text-[var(--tfmc-mist)] group-hover:text-[var(--tfmc-cream)]`}
                  >
                    {firstRow + shown}
                  </td>
                  {row.map((cell, c) => {
                    const active = picked?.row === i && picked.column === c;
                    return (
                      <td
                        key={c}
                        onClick={() => setPicked(active ? null : { row: i, column: c })}
                        title={cell === null || isBlob(cell) ? undefined : cellText(cell).slice(0, 500)}
                        className={`max-w-[24rem] cursor-default truncate border-b border-r ${hairline} px-2.5 py-1 ${
                          numeric[c] ? "text-right tabular-nums" : ""
                        } ${
                          active
                            ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_22%,transparent)] text-[var(--tfmc-cream)] outline outline-1 -outline-offset-1 outline-[var(--tfmc-accent)]"
                            : "text-[var(--tfmc-cream)] group-hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_4%,transparent)]"
                        }`}
                      >
                        <CellView cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 ? (
            <p className="px-3 py-4 font-sans text-sm text-[var(--tfmc-mist)]">No rows.</p>
          ) : null}
        </div>
      ) : null}

      {picked && pickedCell !== undefined ? (
        <div className={`border-t ${hairline} bg-[var(--tfmc-forest-deep)] px-3 py-2`}>
          <div className="flex items-center gap-2 text-xs text-[var(--tfmc-mist)]">
            <span className="font-mono text-[var(--tfmc-cream)]">{result.columns[picked.column]}</span>
            <span>row {firstRow + rows.findIndex((r) => r.i === picked.row)}</span>
            <span className="ml-auto flex gap-1.5">
              <button type="button" className={toolButton} onClick={() => void copy(cellText(pickedCell), "cell")}>
                {copied === "cell" ? "Copied" : "Copy value"}
              </button>
              <button type="button" className={toolButton} onClick={() => setPicked(null)} aria-label="Close value">
                <CloseIcon />
              </button>
            </span>
          </div>
          <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-[var(--tfmc-cream)]">
            {pickedCell === null ? "NULL" : inspected(pickedCell)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
