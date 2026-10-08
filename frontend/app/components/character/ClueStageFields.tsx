"use client";

import { useEffect, useId, useRef, useState } from "react";
import { proseError } from "../../../lib/textValidation";

type Props = {
  clues: string[];
  required: number;
  minLen: number;
  maxLen: number;
  maxClues: number;
  onChange: (clues: string[]) => void;
};

export default function ClueStageFields({
  clues,
  required,
  minLen,
  maxLen,
  maxClues,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const trimmed = draft.trim();
  const n = trimmed.length;
  const charsetErr =
    n > 0
      ? proseError(trimmed, { minLen, maxLen, field: "clue" })
      : null;
  const lengthOk = n >= minLen && n <= maxLen;
  const canAdd =
    lengthOk && charsetErr === null && clues.length < maxClues;
  const atMax = clues.length >= maxClues;

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopup();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openPopup() {
    if (atMax) return;
    setDraft("");
    setOpen(true);
  }

  function closePopup() {
    setOpen(false);
    setDraft("");
  }

  function submitClue() {
    if (!canAdd) return;
    onChange([...clues, trimmed]);
    closePopup();
  }

  function removeClue(i: number) {
    onChange(clues.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--tfmc-stone)]">
        {clues.length}/{required} required
        {maxClues > required ? ` (max ${maxClues})` : null}
        {" · "}
        {minLen}–{maxLen} characters each
      </p>

      {clues.length === 0 ? (
        <p className="text-sm text-[var(--tfmc-mist)]">No clues added yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clues.map((clue, i) => (
            <li
              key={`${i}-${clue.slice(0, 12)}`}
              className="flex items-start justify-between gap-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-3 py-2.5"
            >
              <p className="text-sm leading-relaxed text-[var(--tfmc-cream)]">
                {clue}
              </p>
              <button
                type="button"
                onClick={() => removeClue(i)}
                className="shrink-0 text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!atMax ? (
        <button
          type="button"
          onClick={openPopup}
          className="self-start text-sm text-[var(--tfmc-accent)] hover:underline"
        >
          Add clue
        </button>
      ) : (
        <p className="text-xs text-[var(--tfmc-stone)]">Clue limit reached.</p>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_72%,transparent)] p-4 backdrop-blur-[2px]"
          onClick={closePopup}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[var(--tfmc-forest)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id={titleId}
              className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]"
            >
              New clue
            </h3>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitClue();
                }
              }}
              placeholder="Write the clue…"
              className="mt-3 w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_50%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)]"
            />
            <p
              className={`mt-1.5 text-xs tabular-nums ${
                n > 0 && (n < minLen || n > maxLen || charsetErr)
                  ? "text-[#e8a0a0]"
                  : "text-[var(--tfmc-stone)]"
              }`}
            >
              {n}/{maxLen}
              {n > 0 && n < minLen
                ? ` · need ${minLen - n} more`
                : n > maxLen
                  ? ` · ${n - maxLen} over max`
                  : charsetErr
                    ? ` · ${charsetErr}`
                    : null}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={closePopup}
                className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canAdd}
                onClick={submitClue}
                className="flex-1 rounded-sm bg-[var(--tfmc-accent)] px-3 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
