"use client";

import { useEffect, useState } from "react";

import { hexToRgbString, rgbStringToHex, tweakRgbNear } from "../../../lib/map/titleRgb";

const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60";

const DEFAULT_HEX = "#808080";

export type TitleRgbPickerProps = {
  rgb: string;
  onChange: (rgb: string) => void;
  usedRgbs?: string[];
  suggestFromRgb?: string;
  disabled?: boolean;
  onError?: (message: string | null) => void;
  className?: string;
};

export default function TitleRgbPicker({
  rgb,
  onChange,
  usedRgbs = [],
  suggestFromRgb,
  disabled = false,
  onError,
  className = "",
}: TitleRgbPickerProps) {
  const [hexDraft, setHexDraft] = useState(DEFAULT_HEX);

  useEffect(() => {
    const hex = rgbStringToHex(rgb);
    if (hex) setHexDraft(hex);
  }, [rgb]);

  const displayHex = rgbStringToHex(rgb) || hexDraft || DEFAULT_HEX;
  const hasCollision = usedRgbs.some((used) => used.trim() === rgb.trim());
  const showSuggest = Boolean(suggestFromRgb?.trim());

  function commitHex(rawHex: string) {
    const nextRgb = hexToRgbString(rawHex);
    if (!nextRgb) {
      onError?.("Invalid colour (use #RRGGBB)");
      return;
    }
    onError?.(null);
    onChange(nextRgb);
    const normalizedHex = rgbStringToHex(nextRgb);
    if (normalizedHex) setHexDraft(normalizedHex);
  }

  function handleSuggest() {
    if (!suggestFromRgb?.trim()) return;
    const next = tweakRgbNear(suggestFromRgb, usedRgbs);
    onError?.(null);
    onChange(next);
    const hex = rgbStringToHex(next);
    if (hex) setHexDraft(hex);
  }

  return (
    <fieldset className={`flex flex-col gap-3 border-0 p-0 ${className}`} disabled={disabled} aria-disabled={disabled}>
      <legend className="sr-only">Title colour</legend>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">Title colour</span>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-block h-10 w-10 shrink-0 rounded-sm border border-black/40"
            style={{ backgroundColor: displayHex }}
            aria-hidden
          />
          <input
            type="color"
            value={hexDraft}
            disabled={disabled}
            onChange={(e) => {
              const value = e.target.value;
              setHexDraft(value);
              commitHex(value);
            }}
            className="h-9 w-12 cursor-pointer bg-transparent disabled:cursor-not-allowed"
            aria-label="Pick title colour"
          />
          <input
            type="text"
            value={hexDraft}
            disabled={disabled}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={() => commitHex(hexDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitHex(hexDraft);
              }
            }}
            className={`${inputClass} max-w-[8rem]`}
            placeholder="#RRGGBB"
            maxLength={7}
            aria-label="Title colour hex"
          />
        </div>
        <p className="text-xs text-[var(--tfmc-mist)]">
          Map RGB: <span className="text-[var(--tfmc-stone)]">{rgb}</span>
        </p>
      </div>

      {hasCollision ? (
        <p className="text-sm font-medium text-[#e8a0a0]" role="status">
          Another title at this tier already uses this colour.
        </p>
      ) : null}

      {showSuggest ? (
        <button
          type="button"
          disabled={disabled}
          onClick={handleSuggest}
          className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)] transition hover:brightness-110 hover:border-[var(--tfmc-accent)] active:scale-[0.98] disabled:opacity-60"
        >
          Suggest colour
        </button>
      ) : null}
    </fieldset>
  );
}
