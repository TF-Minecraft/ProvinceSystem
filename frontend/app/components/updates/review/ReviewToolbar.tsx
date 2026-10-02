"use client";

import { reviewButtonClass, reviewInputClass } from "./ReviewLine";

export type WeekAction = "sort" | "postpone" | "reset";
export type ToolbarPanel = WeekAction | "feedback" | null;

type ReviewToolbarProps = {
  filter: string;
  preview: boolean;
  feedback: string;
  confirm: ToolbarPanel;
  postponed: boolean;
  disabled: boolean;
  waitingCount: number;
  onFilterChange: (value: string) => void;
  onPreviewToggle: () => void;
  onApprove: () => void;
  onConfirmSelect: (action: ToolbarPanel) => void;
  onConfirm: () => void;
  onFeedbackChange: (value: string) => void;
  onFeedbackSend: () => void;
  onFeedbackCancel: () => void;
};

export default function ReviewToolbar({
  filter,
  preview,
  feedback,
  confirm,
  postponed,
  disabled,
  waitingCount,
  onFilterChange,
  onPreviewToggle,
  onApprove,
  onConfirmSelect,
  onConfirm,
  onFeedbackChange,
  onFeedbackSend,
  onFeedbackCancel,
}: ReviewToolbarProps) {
  return (
    <div
      className="sticky z-20 -mx-4 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]
        bg-[var(--tfmc-forest-deep)] px-4 py-2 sm:-mx-6 sm:px-6"
      style={{ top: "var(--tfmc-header-h)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-48 flex-1 items-center gap-2 text-xs text-[var(--tfmc-mist)]">
          Filter
          <input
            className={`${reviewInputClass} min-w-0 flex-1`}
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </label>
        <button className={reviewButtonClass} type="button" onClick={onPreviewToggle}>
          {preview ? "Edit review" : "Preview as players see it"}
        </button>
        <button
          className={reviewButtonClass}
          type="button"
          disabled={disabled || waitingCount === 0}
          onClick={onApprove}
        >
          Approve all waiting
        </button>
        <button
          className={reviewButtonClass}
          type="button"
          disabled={disabled}
          onClick={() => onConfirmSelect(confirm === "feedback" ? null : "feedback")}
          aria-expanded={confirm === "feedback"}
          aria-controls="review-feedback-panel"
        >
          Deny with feedback
        </button>
        <button
          className={reviewButtonClass}
          type="button"
          disabled={disabled}
          onClick={() => onConfirmSelect("sort")}
        >
          Sort with Sol
        </button>
        <button
          className={reviewButtonClass}
          type="button"
          disabled={disabled}
          onClick={() => onConfirmSelect("postpone")}
        >
          {postponed ? "Undo postpone" : "Postpone"}
        </button>
        <button
          className={reviewButtonClass}
          type="button"
          disabled={disabled}
          onClick={() => onConfirmSelect("reset")}
        >
          Reset week
        </button>
      </div>
      {confirm && confirm !== "feedback" && (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t
            border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-2"
        >
          <p className="text-xs text-[var(--tfmc-mist)]">
            {confirm === "sort"
              ? "Ask Sol to sort sections, topics and highlights?"
              : confirm === "postpone"
                ? postponed
                  ? "Undo postponing this week?"
                  : "Postpone this week’s review?"
                : "Reset this week’s review? This removes its review decisions."}
          </p>
          <div className="flex gap-2">
            <button className={reviewButtonClass} type="button" disabled={disabled} onClick={onConfirm}>
              Confirm
            </button>
            <button
              className={reviewButtonClass}
              type="button"
              disabled={disabled}
              onClick={() => onConfirmSelect(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirm === "feedback" && (
        <div
          id="review-feedback-panel"
          className="mt-2 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-2"
        >
          <div className="flex flex-wrap items-start gap-2">
            <label className="min-w-48 flex-1 text-xs text-[var(--tfmc-mist)]">
              Feedback instruction
              <textarea
                className={`${reviewInputClass} mt-1 block min-h-16 w-full`}
                minLength={1}
                maxLength={1000}
                value={feedback}
                disabled={disabled}
                onChange={(event) => onFeedbackChange(event.target.value)}
              />
            </label>
            <button
              className={reviewButtonClass}
              type="button"
              disabled={disabled || feedback.trim().length === 0 || feedback.length > 1000}
              onClick={onFeedbackSend}
            >
              Send
            </button>
            <button
              className={reviewButtonClass}
              type="button"
              disabled={disabled}
              onClick={onFeedbackCancel}
            >
              Cancel
            </button>
            <span className="pt-1 text-xs text-[var(--tfmc-stone)]">{feedback.length}/1000</span>
          </div>
          <p className="mt-1 text-xs text-[var(--tfmc-stone)]">
            This text is an instruction for the rewrite, not the new wording.
          </p>
        </div>
      )}
    </div>
  );
}
