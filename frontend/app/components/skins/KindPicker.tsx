"use client";

import { useState } from "react";
import type { SkinKind } from "../../../lib/skins/sizes";
import {
  KindHelpPanel,
  KindHelpToggle,
  useKindHelpId,
} from "./KindHelp";

const OPTIONS: {
  value: SkinKind;
  label: string;
  detail: string;
}[] = [
  { value: "armor_set", label: "Armor set", detail: "Full set by tier" },
  { value: "handheld", label: "Handheld", detail: "16×16 texture" },
  {
    value: "large_handheld",
    label: "Large handheld",
    detail: "32×32 + grip slider",
  },
  { value: "bow", label: "Bow", detail: "16×16 · 4 frames" },
  { value: "large_bow", label: "Large bow", detail: "32×32 · 4 frames" },
  { value: "crossbow", label: "Crossbow", detail: "16×16 · 5 frames" },
  { value: "item_3d", label: "Item 3D", detail: "Model + texture" },
  { value: "shield", label: "Shield 3D", detail: "Model + texture" },
  { value: "helmet_3d", label: "Helmet 3D", detail: "Model + texture" },
  { value: "mask", label: "Mask", detail: "3D helmet · hides identity" },
  { value: "gun", label: "Gun", detail: "Carry · reload · aim" },
  {
    value: "book",
    label: "Book",
    detail: "Unsigned + signed · 16×16",
  },
];

type Props = {
  value: SkinKind;
  onChange: (kind: SkinKind) => void;
  disabled?: boolean;
  /** When set, only these kinds are shown. Empty = none. Omit/undefined = all. */
  allowedKinds?: string[] | null;
};

export default function KindPicker({
  value,
  onChange,
  disabled,
  allowedKinds,
}: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useKindHelpId();
  const options =
    allowedKinds == null
      ? OPTIONS
      : OPTIONS.filter((opt) =>
          allowedKinds.map((k) => k.toLowerCase()).includes(opt.value)
        );

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <div className="flex items-center gap-2">
        <legend className="float-none w-auto px-0 text-sm font-medium text-[var(--tfmc-stone)]">
          Kind
        </legend>
        <KindHelpToggle
          open={helpOpen}
          panelId={helpId}
          onToggle={() => setHelpOpen((v) => !v)}
        />
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-[var(--tfmc-mist)]">
          No upload kinds available for your rank.
        </p>
      ) : (
      <div
        role="radiogroup"
        aria-label="Skin kind"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={`group relative overflow-hidden rounded-sm border px-3.5 py-3 text-left transition duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "kind-tile-selected border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_18%,var(--tfmc-forest))] shadow-[inset_3px_0_0_0_var(--tfmc-accent)]"
                  : "border-[color-mix(in_srgb,var(--tfmc-cream)_16%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--tfmc-accent)_45%,var(--tfmc-cream))] hover:bg-[color-mix(in_srgb,var(--tfmc-moss)_55%,var(--tfmc-forest))] hover:shadow-[0_6px_16px_color-mix(in_srgb,black_28%,transparent)] active:translate-y-0 active:scale-[0.99]"
              } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)]`}
            >
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] to-transparent opacity-0 transition duration-200 ${
                  selected ? "opacity-70" : "group-hover:opacity-50"
                }`}
              />
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--tfmc-cream)]">
                    {opt.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-xs transition-colors ${
                      selected
                        ? "text-[color-mix(in_srgb,var(--tfmc-cream)_75%,var(--tfmc-mist))]"
                        : "text-[var(--tfmc-mist)]"
                    }`}
                  >
                    {opt.detail}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition duration-200 ${
                    selected
                      ? "scale-100 border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)]"
                      : "scale-90 border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] bg-transparent group-hover:scale-100 group-hover:border-[color-mix(in_srgb,var(--tfmc-accent)_60%,var(--tfmc-cream))]"
                  }`}
                >
                  <svg
                    viewBox="0 0 12 12"
                    className={`h-2.5 w-2.5 text-[var(--tfmc-forest-deep)] transition-opacity duration-150 ${
                      selected ? "opacity-100" : "opacity-0"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.2 4.8 8.5 9.5 3.5" />
                  </svg>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      )}

      <KindHelpPanel kind={value} open={helpOpen} id={helpId} />
    </fieldset>
  );
}
