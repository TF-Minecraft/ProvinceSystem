"use client";

import { useEffect, useState } from "react";

import {
  isSectionName,
  SECTION_LABELS,
  SECTION_ORDER,
  TOPIC_LABELS,
  TOPIC_ORDER,
} from "@/lib/patchnotes/notes";
import {
  patchReviewBullet,
  type ReviewBullet,
} from "@/lib/patchnotes/review";

export const reviewButtonClass = [
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)]",
  "px-2 py-1 text-xs text-[var(--tfmc-cream)]",
  "hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

export const reviewInputClass = [
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)]",
  "bg-[var(--tfmc-forest-deep)] px-2 py-1.5 text-sm text-[var(--tfmc-cream)]",
].join(" ");

type ReviewLineProps = {
  bullet: ReviewBullet;
  disabled: boolean;
  error?: string;
  onPatch: (patch: Parameters<typeof patchReviewBullet>[2]) => void;
  onDrop: () => void;
  onError: (id: string, text: string) => void;
};

export default function ReviewLine({
  bullet,
  disabled,
  error,
  onPatch,
  onDrop,
  onError,
}: ReviewLineProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(bullet.body);

  useEffect(() => {
    setBody(bullet.body);
  }, [bullet.body]);

  return (
    <article className="border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-64">
          {editing ? (
            <textarea
              aria-label="Edit line text"
              className={`${reviewInputClass} min-h-16 w-full`}
              value={body}
              disabled={disabled}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || !body.trim()) return;
                event.preventDefault();
                onPatch({ body });
                setEditing(false);
              }}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-[var(--tfmc-stone)]">
              {bullet.body}
              {bullet.status === "approved" && (
                <span
                  className="ml-2 inline-block rounded
                    bg-[color-mix(in_srgb,var(--tfmc-accent)_25%,transparent)]
                    px-1.5 py-0.5 text-xs text-[var(--tfmc-cream)]"
                >
                  Approved
                </span>
              )}
              {bullet.warning && (
                <span className="ml-2 inline text-xs text-[var(--tfmc-accent)]">
                  ⚠ {bullet.warning}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Section"
            className={reviewInputClass}
            value={bullet.section}
            disabled={disabled || editing}
            onChange={(event) => {
              if (isSectionName(event.target.value)) onPatch({ section: event.target.value });
            }}
          >
            {SECTION_ORDER.map((section) => (
              <option key={section} value={section}>
                {SECTION_LABELS[section]}
              </option>
            ))}
          </select>
          <select
            aria-label="Topic"
            className={reviewInputClass}
            value={bullet.topic ?? ""}
            disabled={disabled || editing}
            onChange={(event) => {
              const topic = event.target.value;
              onPatch({
                topic: TOPIC_ORDER.includes(topic as (typeof TOPIC_ORDER)[number])
                  ? (topic as (typeof TOPIC_ORDER)[number])
                  : null,
              });
            }}
          >
            <option value="">None</option>
            {TOPIC_ORDER.map((topic) => (
              <option key={topic} value={topic}>
                {TOPIC_LABELS[topic]}
              </option>
            ))}
          </select>
          <button
            aria-label="Highlight"
            aria-pressed={bullet.highlight}
            className={`${reviewButtonClass} px-1.5 text-sm`}
            title="Highlight"
            type="button"
            disabled={disabled || editing}
            onClick={() => onPatch({ highlight: !bullet.highlight })}
          >
            {bullet.highlight ? "★" : "☆"}
          </button>
          {editing ? (
            <>
              <button
                className={reviewButtonClass}
                type="button"
                disabled={disabled || !body.trim()}
                onClick={() => {
                  onPatch({ body });
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button
                className={reviewButtonClass}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setBody(bullet.body);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className={reviewButtonClass}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onError(bullet.id, "");
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                className={reviewButtonClass}
                type="button"
                disabled={disabled}
                onClick={onDrop}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[var(--tfmc-accent)]">
          {error}
        </p>
      )}
    </article>
  );
}
