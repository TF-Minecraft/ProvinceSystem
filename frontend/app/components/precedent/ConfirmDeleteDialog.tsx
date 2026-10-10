"use client";

import { useId } from "react";

import { errorClass, headingClass, mutedClass, quietButtonClass } from "@/app/components/admin/ui";

type Props = {
  open: boolean;
  summary: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Deletion is permanent and has no undo, so it gets the same two-step
 *  confirmation the Discord /case-delete command requires. */
export default function ConfirmDeleteDialog({
  open,
  summary,
  deleting,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,var(--tfmc-forest)_72%,black)]/80 p-4 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[var(--tfmc-forest-deep)] p-5 shadow-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className={headingClass}
        >
          Delete this case?
        </h2>
        <p className={`mt-2 ${mutedClass}`}>
          This is permanent. It will no longer inform precedent searches.
        </p>
        <p className="mt-3 border-l-2 border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] pl-3 text-sm text-[var(--tfmc-cream)]">
          {summary}
        </p>

        {error ? <p className={`mt-3 ${errorClass}`} role="alert">{error}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className={quietButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="rounded-sm bg-[#e8a0a0] px-3 py-1.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
