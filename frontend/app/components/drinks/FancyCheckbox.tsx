"use client";

import { useState } from "react";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  /** Clickable but blocked (shake + red flash). */
  locked?: boolean;
  lockedDescription?: string;
};

export default function FancyCheckbox({
  checked,
  onChange,
  label,
  description,
  locked = false,
  lockedDescription,
}: Props) {
  const [shaking, setShaking] = useState(false);

  function onClick() {
    if (locked) {
      setShaking(true);
      window.setTimeout(() => setShaking(false), 360);
      return;
    }
    onChange(!checked);
  }

  const detail = locked ? lockedDescription || description : description;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={locked || undefined}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-sm border px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] ${
        shaking ? "animate-char-option-shake" : ""
      } ${
        shaking
          ? "border-[#c45c5c]/70 bg-[color-mix(in_srgb,#1a0c0c_55%,var(--tfmc-forest))]"
          : "border-[color-mix(in_srgb,var(--tfmc-cream)_16%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_40%,var(--tfmc-cream))]"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition ${
          checked && !locked
            ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)]"
            : "border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent"
        }`}
      >
        <svg
          viewBox="0 0 12 12"
          className={`h-3 w-3 text-[var(--tfmc-forest-deep)] transition-opacity ${
            checked && !locked ? "opacity-100" : "opacity-0"
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
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--tfmc-cream)]">{label}</span>
        {detail ? (
          <span className={`mt-0.5 block text-xs ${locked ? "text-[#e8a0a0]" : "text-[var(--tfmc-mist)]"}`}>
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
