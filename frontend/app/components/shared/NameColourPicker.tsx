"use client";

import { useState } from "react";
import {
  LEGACY_PALETTE,
  normalizePreviewHex,
  previewColourStopRuns,
} from "../../../lib/skins/namePreview";
import FormattedMcRuns from "./FormattedMcRuns";

const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60";

export type NameColourPickerProps = {
  colours: string[];
  onChange: (colours: string[]) => void;
  previewText: string;
  /** Max colour stops (clamped externally to ≤8). 0 or disabled → locked. */
  maxStops: number;
  disabled?: boolean;
  /** Shown in red when locked (maxStops ≤ 0 or disabled with message). */
  lockedMessage?: string;
  /** Extra CSS for preview (e.g. skins name styles). */
  previewStyles?: string[];
  onError?: (message: string | null) => void;
  className?: string;
};

export default function NameColourPicker({
  colours,
  onChange,
  previewText,
  maxStops,
  disabled = false,
  lockedMessage = "Only for donators",
  previewStyles = [],
  onError,
  className = "",
}: NameColourPickerProps) {
  const [hexDraft, setHexDraft] = useState("#55ff55");
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const lockedForRank = maxStops <= 0;
  const interactiveLocked = disabled || lockedForRank;
  const cap = Math.max(0, Math.min(8, maxStops));
  const previewRuns = previewColourStopRuns(
    previewText.trim() || "Preview",
    colours,
    previewStyles
  );

  function addColour(token: string) {
    if (interactiveLocked) return;
    const hex = normalizePreviewHex(token);
    if (!hex) {
      onError?.("Invalid colour (use #RRGGBB)");
      return;
    }
    if (colours.length >= cap) {
      onError?.(
        cap <= 0
          ? lockedMessage
          : `At most ${cap} colour${cap === 1 ? "" : "s"} with your rank`
      );
      return;
    }
    onError?.(null);
    onChange([...colours, hex]);
  }

  function removeColour(index: number) {
    if (interactiveLocked) return;
    onChange(colours.filter((_, i) => i !== index));
  }

  function reorderColour(from: number, to: number) {
    if (interactiveLocked || from === to || from < 0 || to < 0) return;
    if (from >= colours.length || to >= colours.length) return;
    const next = [...colours];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  return (
    <fieldset
      className={`flex flex-col gap-4 border-0 p-0 ${
        lockedForRank ? "opacity-50" : ""
      } ${className}`}
      disabled={interactiveLocked}
      aria-disabled={interactiveLocked}
    >
      <legend className="sr-only">Name colours</legend>

      {lockedForRank && lockedMessage ? (
        <p className="text-sm font-medium text-[#e8a0a0]" role="status">
          {lockedMessage}
        </p>
      ) : null}

      <div
        className={`flex flex-col gap-2 ${
          lockedForRank ? "pointer-events-none select-none" : ""
        }`}
      >
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">
          Colours
          {!lockedForRank && cap > 0 ? (
            <span className="ml-2 font-normal text-[var(--tfmc-mist)]">
              ({colours.length}/{cap})
            </span>
          ) : null}
        </span>
        <span className="text-xs text-[var(--tfmc-mist)]">
          One colour = solid; two or more = gradient. Drag to reorder.
        </span>
        <div className="flex flex-wrap gap-2">
          {colours.map((c, i) => (
            <div
              key={`${c}-${i}`}
              draggable={!interactiveLocked}
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) {
                  reorderColour(dragFrom, i);
                }
                setDragFrom(null);
              }}
              onDragEnd={() => setDragFrom(null)}
              className={`inline-flex cursor-grab items-center gap-2 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_30%,transparent)] px-2 py-1 text-xs text-[var(--tfmc-cream)] active:cursor-grabbing ${
                dragFrom === i
                  ? "opacity-60 ring-1 ring-[var(--tfmc-accent)]"
                  : ""
              }`}
              title="Drag to reorder"
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border border-black/40"
                style={{ backgroundColor: normalizePreviewHex(c) || c }}
              />
              {c}
              <button
                type="button"
                disabled={interactiveLocked}
                onClick={() => removeColour(i)}
                title="Remove colour"
                className="rounded-sm px-1 text-[var(--tfmc-mist)] transition hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] hover:text-[var(--tfmc-cream)]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            value={normalizePreviewHex(hexDraft) || "#55ff55"}
            disabled={interactiveLocked}
            onChange={(e) => setHexDraft(e.target.value)}
            className="h-9 w-12 cursor-pointer bg-transparent disabled:cursor-not-allowed"
          />
          <input
            type="text"
            value={hexDraft}
            disabled={interactiveLocked}
            onChange={(e) => setHexDraft(e.target.value)}
            className={`${inputClass} max-w-[8rem]`}
            placeholder="#55ff55"
            maxLength={7}
          />
          <button
            type="button"
            disabled={interactiveLocked || colours.length >= cap}
            onClick={() => addColour(hexDraft)}
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)] transition hover:brightness-110 hover:border-[var(--tfmc-accent)] active:scale-[0.98] disabled:opacity-60"
          >
            Add colour
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LEGACY_PALETTE.map((p) => (
            <button
              key={p.code}
              type="button"
              disabled={interactiveLocked || colours.length >= cap}
              title={`${p.label} (§${p.code})`}
              onClick={() => addColour(p.hex)}
              className="h-5 w-5 rounded-sm border border-black/50 transition hover:scale-125 hover:ring-2 hover:ring-[var(--tfmc-accent)] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] active:scale-110 disabled:hover:scale-100 disabled:hover:ring-0"
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">
          Preview
        </span>
        <div
          className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[#1a1a1a] px-4 py-3"
          aria-live="polite"
        >
          <p
            className="m-0 text-xl tracking-wide"
            style={{
              fontFamily:
                'ui-monospace, "Cascadia Mono", "Segoe UI Mono", monospace',
            }}
          >
            <FormattedMcRuns runs={previewRuns} />
          </p>
        </div>
      </div>
    </fieldset>
  );
}
