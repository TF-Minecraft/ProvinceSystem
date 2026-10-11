"use client";

import { mutedClass, pagerClass, quietButtonClass, rowClass } from "@/app/components/admin/ui";
import type { PrecedentCase } from "@/lib/precedent/api";
import { formatCreatedAt } from "@/lib/precedent/filter";
import CaseTags from "./CaseTags";
import { dateClass, idClass, loggedByClass } from "./caseFieldStyles";

type Props = {
  /** One page of cases. */
  cases: PrecedentCase[];
  /** Cases matching the search across every page. */
  total: number;
  searching: boolean;
  loading: boolean;
  page: number;
  pages: number;
  onPage: (page: number) => void;
  onEdit: (row: PrecedentCase) => void;
  onDelete: (row: PrecedentCase) => void;
};

function matchLine(total: number): string {
  return total === 1 ? "1 case matches" : `${total.toLocaleString()} cases match`;
}

export default function PrecedentTable({
  cases,
  total,
  searching,
  loading,
  page,
  pages,
  onPage,
  onEdit,
  onDelete,
}: Props) {
  // Only the first load blanks the list; later pages and searches keep the old rows until theirs arrive.
  if (loading && cases.length === 0) {
    return <p className={`mt-3 ${mutedClass}`}>Loading cases…</p>;
  }

  if (cases.length === 0) {
    return <p className={`mt-3 ${mutedClass}`}>{searching ? "No cases match that search." : "No cases logged yet."}</p>;
  }

  return (
    <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : undefined}>
      {searching ? <p className="mt-3 text-xs text-[var(--tfmc-stone)]">{matchLine(total)}</p> : null}
      <ul className={`mt-2 ${rowClass}`}>
        {cases.map((row) => (
          <li key={row.id} className="py-3">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-semibold text-[var(--tfmc-cream)]">{row.summary}</p>
              <div className="flex shrink-0 gap-3">
                <button type="button" className={quietButtonClass} onClick={() => onEdit(row)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="text-sm text-[#e8a0a0] underline-offset-2 hover:underline"
                  onClick={() => onDelete(row)}
                >
                  Delete
                </button>
              </div>
            </div>
            <CaseTags row={row} />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
              <span className={loggedByClass}>{row.logged_by}</span>
              <span className={dateClass}>{formatCreatedAt(row.created_at)}</span>
              <span className={idClass}>{row.id}</span>
            </p>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <div className="mt-4 flex items-center gap-3 text-sm text-[var(--tfmc-stone)]">
          <button type="button" className={pagerClass} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className={pagerClass} disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
