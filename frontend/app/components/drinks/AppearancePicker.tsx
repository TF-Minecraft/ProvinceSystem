"use client";

import { useState } from "react";

export type AppearanceMode = "color" | "upload" | "reuse";

type Option = {
  value: AppearanceMode;
  label: string;
  detail: string;
  /** Clickable but blocked (shake + red flash). */
  locked?: boolean;
};

type Props = {
  value: AppearanceMode;
  onChange: (mode: AppearanceMode) => void;
  allowTexture: boolean;
  reuseDisabled?: boolean;
};

export default function AppearancePicker({
  value,
  onChange,
  allowTexture,
  reuseDisabled,
}: Props) {
  const [buzzKey, setBuzzKey] = useState<AppearanceMode | null>(null);

  const options: Option[] = [
    {
      value: "color",
      label: "Potion colour",
      detail: "Tint the default bottle",
    },
    ...(allowTexture
      ? [
          {
            value: "upload" as const,
            label: "Upload PNG",
            detail: "Custom 16×16 potion icon",
          },
          {
            value: "reuse" as const,
            label: "Reuse texture",
            detail: reuseDisabled ? "None yet" : "Use one you've made before",
            locked: Boolean(reuseDisabled),
          },
        ]
      : []),
  ];

  function onPick(opt: Option) {
    if (opt.locked) {
      setBuzzKey(opt.value);
      window.setTimeout(() => setBuzzKey(null), 360);
      return;
    }
    onChange(opt.value);
  }

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="float-none w-auto px-0 text-sm font-medium text-[var(--tfmc-stone)]">
        Appearance
      </legend>
      {!allowTexture ? (
        <p className="text-xs text-[var(--tfmc-mist)]">
          Your rank is colour-only (no custom texture).
        </p>
      ) : null}
      <div
        role="radiogroup"
        aria-label="Drink appearance"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {options.map((opt) => {
          const selected = value === opt.value;
          const buzzing = buzzKey === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={opt.locked || undefined}
              onClick={() => onPick(opt)}
              className={`group relative overflow-hidden rounded-sm border px-3.5 py-3 text-left transition duration-200 ease-out cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] ${
                buzzing ? "char-option-shake" : ""
              } ${
                buzzing
                  ? "border-[#c45c5c]/70 bg-[color-mix(in_srgb,#1a0c0c_55%,var(--tfmc-forest))]"
                  : selected
                    ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_18%,var(--tfmc-forest))] shadow-[inset_3px_0_0_0_var(--tfmc-accent)]"
                    : "border-[color-mix(in_srgb,var(--tfmc-cream)_16%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--tfmc-accent)_45%,var(--tfmc-cream))]"
              }`}
            >
              <span className="block text-sm font-medium text-[var(--tfmc-cream)]">
                {opt.label}
              </span>
              <span
                className={`mt-0.5 block text-xs ${
                  opt.locked ? "text-[#e8a0a0]" : "text-[var(--tfmc-mist)]"
                }`}
              >
                {opt.detail}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
