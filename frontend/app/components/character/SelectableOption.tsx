"use client";

import { useEffect, useState } from "react";
import type { ModifierPreviewLine } from "../../../lib/characters/wizardState";

type Props = {
  title: string;
  selected: boolean;
  onSelect: () => void;
  descriptionLines?: string[];
  attributeDescriptionLines?: string[];
  dependency?: { mode: string; names: string[] } | null;
  mutuallyExclusive?: string[];
  modifierLines?: ModifierPreviewLine[];
  /** Trait point cost (may be negative to refund points). */
  cost?: number | null;
  /** Expand-body cost line (MC lore parity); header badge still uses cost. */
  showCostInBody?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  /** Incompatible with a current selection; click rejects with shake. */
  exclusiveConflict?: boolean;
};

function dependencyHeading(mode: string): string {
  const m = mode.trim().toLowerCase();
  if (m === "all") return "Requires all of these:";
  if (m === "one-or-more" || m === "one_or_more") {
    return "Requires at least one of these:";
  }
  return "Requires:";
}

function formatDelta(delta: number, kind: "attribute" | "experience"): string {
  if (delta === 0) return "";
  const sign = delta > 0 ? "+" : "";
  if (kind === "experience") return `(${sign}${delta}%)`;
  return `(${sign}${delta})`;
}

function ModifierRow({ line }: { line: ModifierPreviewLine }) {
  const muted = line.delta === 0;
  const deltaClass =
    line.delta > 0
      ? "text-[var(--tfmc-accent)]"
      : line.delta < 0
        ? "text-[#e8a0a0]"
        : "";
  const current =
    line.kind === "experience" ? `${line.current}%` : String(line.current);
  const deltaText = formatDelta(line.delta, line.kind);

  return (
    <p
      className={`flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums ${
        muted ? "text-[var(--tfmc-stone)]" : "text-[var(--tfmc-mist)]"
      }`}
    >
      <span className="min-w-[6.5rem]">{line.label}</span>
      <span>{current}</span>
      {deltaText ? <span className={deltaClass}>{deltaText}</span> : null}
    </p>
  );
}

export default function SelectableOption({
  title,
  selected,
  onSelect,
  descriptionLines = [],
  attributeDescriptionLines = [],
  dependency = null,
  mutuallyExclusive = [],
  modifierLines = [],
  cost = null,
  showCostInBody = false,
  disabled = false,
  disabledReason = null,
  exclusiveConflict = false,
}: Props) {
  const [shaking, setShaking] = useState(false);
  const showCost = cost != null && Number(cost) !== 0;
  const lines = descriptionLines.filter((l) => String(l || "").trim());
  const attrDesc = attributeDescriptionLines.filter((l) =>
    String(l || "").trim()
  );
  const exclusive = mutuallyExclusive.filter((l) => String(l || "").trim());
  const attrs = modifierLines.filter((l) => l.kind === "attribute");
  const xp = modifierLines.filter((l) => l.kind === "experience");
  const showConflict = exclusiveConflict && !selected;

  const hasExpand =
    lines.length > 0 ||
    attrDesc.length > 0 ||
    Boolean(dependency?.names?.length) ||
    exclusive.length > 0 ||
    attrs.length > 0 ||
    xp.length > 0 ||
    (showCostInBody && showCost);

  useEffect(() => {
    if (!shaking) return;
    const t = window.setTimeout(() => setShaking(false), 380);
    return () => window.clearTimeout(t);
  }, [shaking]);

  function handleClick() {
    if (disabled && !selected) return;
    if (showConflict) {
      setShaking(true);
      return;
    }
    onSelect();
  }

  const borderClass = selected
    ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_15%,transparent)]"
    : showConflict || shaking
      ? "border-[#e8a0a0] bg-[color-mix(in_srgb,#e8a0a0_10%,transparent)]"
      : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)]";

  return (
    <button
      type="button"
      disabled={disabled && !selected}
      onClick={handleClick}
      aria-pressed={selected}
      aria-disabled={showConflict || (disabled && !selected)}
      className={`w-full rounded-sm border px-3 py-3 text-left transition-[border-color,background-color,opacity] duration-200 ${borderClass} ${
        disabled && !selected && !showConflict ? "opacity-40" : ""
      } ${shaking ? "char-option-shake" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-[var(--tfmc-cream)]">{title}</span>
        {showCost ? (
          <span
            className={`shrink-0 text-xs ${
              Number(cost) < 0
                ? "text-[var(--tfmc-accent)]"
                : "text-[var(--tfmc-stone)]"
            }`}
          >
            {Number(cost) > 0 ? "+" : ""}
            {Number(cost)} pt{Math.abs(Number(cost)) === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>
      {disabledReason && !selected ? (
        <p className="mt-1 text-xs text-[#e8a0a0]">{disabledReason}</p>
      ) : null}
      {showConflict && !disabledReason ? (
        <p className="mt-1 text-xs text-[#e8a0a0]">Conflicts with a chosen trait</p>
      ) : null}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          selected && hasExpand
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {hasExpand ? (
            <div className="mt-2 flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-2">
              {lines.map((line, i) => (
                <p
                  key={`${title}-desc-${i}`}
                  className="text-sm leading-relaxed text-[var(--tfmc-mist)]"
                >
                  {line}
                </p>
              ))}

              {dependency?.names?.length ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-[var(--tfmc-stone)]">
                    {dependencyHeading(dependency.mode)}
                  </p>
                  {dependency.names.map((name) => (
                    <p
                      key={`${title}-dep-${name}`}
                      className="text-sm text-[var(--tfmc-mist)]"
                    >
                      {name}
                    </p>
                  ))}
                </div>
              ) : null}

              {exclusive.length ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-[var(--tfmc-stone)]">
                    Can&apos;t combine with:
                  </p>
                  {exclusive.map((name) => (
                    <p
                      key={`${title}-ex-${name}`}
                      className="text-sm text-[var(--tfmc-mist)]"
                    >
                      {name}
                    </p>
                  ))}
                </div>
              ) : null}

              {attrs.length || xp.length ? (
                <div className="flex flex-col gap-1">
                  {attrs.map((line) => (
                    <ModifierRow
                      key={`${title}-attr-${line.label}`}
                      line={line}
                    />
                  ))}
                  {attrs.length && xp.length ? (
                    <div
                      className="my-1 h-px bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]"
                      aria-hidden
                    />
                  ) : null}
                  {xp.map((line) => (
                    <ModifierRow key={`${title}-xp-${line.label}`} line={line} />
                  ))}
                </div>
              ) : null}

              {attrDesc.map((line, i) => (
                <p
                  key={`${title}-attrdesc-${i}`}
                  className="text-sm leading-relaxed text-[var(--tfmc-mist)]"
                >
                  {line}
                </p>
              ))}

              {showCostInBody && showCost ? (
                <p className="text-sm text-[var(--tfmc-stone)]">
                  Cost:{" "}
                  <span className="text-[var(--tfmc-mist)]">{Number(cost)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}
