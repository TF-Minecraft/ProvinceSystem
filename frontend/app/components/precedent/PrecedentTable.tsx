"use client";

import { mutedClass, quietButtonClass, rowClass } from "@/app/components/admin/ui";
import type { PrecedentCase } from "@/lib/precedent/api";
import { formatCreatedAt } from "@/lib/precedent/filter";
import CaseTags from "./CaseTags";
import { dateClass, idClass, loggedByClass } from "./caseFieldStyles";

type Props = {
  cases: PrecedentCase[];
  /** Total in the DB, for the "showing N of M" line. */
  total: number;
  loading: boolean;
  onEdit: (row: PrecedentCase) => void;
  onDelete: (row: PrecedentCase) => void;
};

export default function PrecedentTable({
  cases,
  total,
  loading,
  onEdit,
  onDelete,
}: Props) {
  if (loading) {
    return <p className={`mt-3 ${mutedClass}`}>Loading cases…</p>;
  }

  if (cases.length === 0) {
    return (
      <p className={`mt-3 ${mutedClass}`}>
        {total === 0 ? "No cases logged yet." : "No cases match that filter."}
      </p>
    );
  }

  return (
    <>
      {cases.length < total ? (
        <p className="mt-3 text-xs text-[var(--tfmc-stone)]">
          Showing {cases.length.toLocaleString()} of {total.toLocaleString()}
        </p>
      ) : null}
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
    </>
  );
}
