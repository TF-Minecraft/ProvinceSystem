"use client";

import { useState } from "react";
import type { LoreRun } from "../../../lib/characters/lorePreview";
import type { WardrobeSlot } from "../../../lib/characters/api";
import { wardrobeSlotToArmModel } from "../../../lib/characters/wardrobeRanks";
import FormattedMcRuns from "../shared/FormattedMcRuns";
import SkinMannequinPreview from "./SkinMannequinPreview";

type Props = {
  slot: WardrobeSlot;
  label: string;
  active: boolean;
  textureSrc: string | null;
  lockRuns?: LoreRun[] | null;
  lockPlain?: string | null;
  onOpen: () => void;
  onEquip?: () => void;
  equipping?: boolean;
};

export default function WardrobeSlotFrame({
  slot,
  label,
  active,
  textureSrc,
  lockRuns,
  lockPlain,
  onOpen,
  onEquip,
  equipping,
}: Props) {
  const locked = !slot.unlocked;
  const pending = Boolean(slot.apply_pending) && slot.filled && !locked;
  const canOpen = slot.unlocked;
  const [buzz, setBuzz] = useState(false);
  const showEquip =
    Boolean(onEquip) &&
    slot.unlocked &&
    slot.filled &&
    slot.slot !== "masked" &&
    !active &&
    !pending;

  function onFrameClick() {
    if (locked) {
      setBuzz(true);
      window.setTimeout(() => setBuzz(false), 360);
      return;
    }
    if (canOpen) onOpen();
  }

  return (
    <div
      className={`flex w-[7.5rem] flex-col gap-2 sm:w-36 ${
        buzz ? "char-option-shake" : ""
      }`}
    >
      <button
        type="button"
        disabled={pending && !locked}
        onClick={onFrameClick}
        className={`relative aspect-[3/5] w-full overflow-hidden rounded-sm border transition-colors ${
          locked
            ? "cursor-pointer border-[#c45c5c]/70 bg-[color-mix(in_srgb,#1a0c0c_78%,transparent)] hover:bg-[color-mix(in_srgb,#1a0c0c_88%,transparent)]"
            : pending
              ? "cursor-wait border-[color-mix(in_srgb,var(--tfmc-cream)_28%,transparent)]"
              : active
                ? "border-[var(--tfmc-accent)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
                : "border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
        }`}
        aria-label={
          locked
            ? `${label} locked`
            : pending
              ? `${label} pending`
              : `${label}${slot.filled ? "" : " empty"} - edit`
        }
      >
        {locked ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2">
            <span className="inline-flex items-center rounded-sm border border-[#c45c5c]/70 bg-[color-mix(in_srgb,#1a0c0c_72%,transparent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#e8a0a0] pointer-events-none select-none">
              Locked
            </span>
            <p className="text-center text-[10px] leading-snug text-[#e8a0a0]">
              You need{" "}
              {lockRuns && lockRuns.length > 0 ? (
                <FormattedMcRuns runs={lockRuns} />
              ) : (
                lockPlain || "a higher rank"
              )}
            </p>
          </div>
        ) : (
          <>
            {slot.filled && textureSrc ? (
              <SkinMannequinPreview
                source={textureSrc}
                armModel={wardrobeSlotToArmModel(slot.model)}
                className="absolute inset-0 h-full w-full pointer-events-none"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,black)]">
                <span className="text-xs text-[var(--tfmc-mist)]">Empty</span>
              </div>
            )}

            {pending ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[color-mix(in_srgb,#0c1218_72%,transparent)] px-2">
                <span className="inline-flex items-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-[color-mix(in_srgb,#0c1218_80%,transparent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--tfmc-mist)] pointer-events-none select-none">
                  Pending
                </span>
              </div>
            ) : null}

            {active && !pending ? (
              <span className="absolute left-1 top-1 rounded-sm bg-[var(--tfmc-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--tfmc-ink)]">
                Active
              </span>
            ) : null}
          </>
        )}
      </button>

      <div className="flex flex-col gap-1">
        <p className="text-center text-xs text-[var(--tfmc-cream)]">{label}</p>
        {showEquip ? (
          <button
            type="button"
            disabled={equipping}
            onClick={onEquip}
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-2 py-1 text-[10px] text-[var(--tfmc-mist)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] disabled:opacity-50"
          >
            {equipping ? "…" : "Equip"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
