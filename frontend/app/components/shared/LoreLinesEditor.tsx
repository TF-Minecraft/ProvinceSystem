"use client";

import { useState } from "react";
import { parseLoreRuns } from "../../../lib/characters/lorePreview";
import { proseError } from "../../../lib/textValidation";
import FormattedMcRuns from "./FormattedMcRuns";

/** Match kit lore / backend lore_items limits. */
export const LORE_MAX_LINES = 6;
export const LORE_LINE_MAX = 48;

const inputClass =
  "w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)] focus:border-[var(--tfmc-accent)] focus:outline-none";

type Props = {
  lines: string[];
  onChange: (lines: string[]) => void;
  /** Fraunces section title (kits) vs compact mist label (drinks). */
  heading?: "section" | "compact";
  showPreview?: boolean;
  emptyMessage?: string;
  className?: string;
};

/**
 * Shared Minecraft-format lore line editor (kit item customise + drink brew).
 * Lines use § / & / #RRGGBB mid-line codes — not NameColourPicker stops.
 */
export default function LoreLinesEditor({
  lines,
  onChange,
  heading = "section",
  showPreview = true,
  emptyMessage = "No custom lore yet.",
  className = "",
}: Props) {
  const [draft, setDraft] = useState("");
  const draftTrimmed = draft.trim();
  const draftErr =
    draftTrimmed.length > 0
      ? proseError(draftTrimmed, {
          minLen: 1,
          maxLen: LORE_LINE_MAX,
          field: "lore line",
          allowColourCodes: true,
        })
      : null;
  const canAdd =
    lines.length < LORE_MAX_LINES &&
    draftTrimmed.length > 0 &&
    draftErr === null;

  function addLine() {
    if (!canAdd) return;
    onChange([...lines, draftTrimmed]);
    setDraft("");
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className={className}>
      {heading === "section" ? (
        <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
          Lore
        </h2>
      ) : (
        <h2 className="text-sm font-medium text-[var(--tfmc-stone)]">Lore</h2>
      )}
      <p
        className={`text-sm text-[var(--tfmc-mist)] ${
          heading === "section" ? "mt-2" : "mt-1"
        }`}
      >
        Up to {LORE_MAX_LINES} lines, {LORE_LINE_MAX} characters each. Colour
        codes like &amp;c work.
      </p>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--tfmc-mist)]">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {lines.map((line, i) => (
            <li
              key={`${i}-${line.slice(0, 12)}`}
              className="flex items-start justify-between gap-3 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] py-2"
            >
              <p className="font-mono text-sm text-[var(--tfmc-cream)]">
                {line}
              </p>
              <button
                type="button"
                onClick={() => removeLine(i)}
                className="shrink-0 text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {lines.length < LORE_MAX_LINES ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={LORE_LINE_MAX}
            className={`${inputClass} sm:flex-1`}
            placeholder="Add a line"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={addLine}
            disabled={!canAdd}
            className="rounded-sm bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)] disabled:opacity-50"
          >
            Add line
          </button>
        </div>
      ) : null}
      {draftErr ? (
        <p className="mt-2 text-xs text-[#e8a0a0]">{draftErr}</p>
      ) : null}
      {showPreview && lines.some((l) => l.trim()) ? (
        <div className="mt-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[#1a1a1a] px-4 py-3 font-mono text-sm">
          <ul className="space-y-1">
            {lines
              .map((l) => l.trim())
              .filter(Boolean)
              .map((line, li) => (
                <li key={`${li}-${line.slice(0, 16)}`}>
                  <FormattedMcRuns runs={parseLoreRuns(line)} />
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
