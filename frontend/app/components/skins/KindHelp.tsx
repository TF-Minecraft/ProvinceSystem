"use client";

import { useId } from "react";
import type { SkinKind } from "../../../lib/skins/sizes";

type KindGuide = {
  title: string;
  summary: string;
  steps: string[];
  notes?: string[];
};

const GUIDES: Record<SkinKind, KindGuide> = {
  armor_set: {
    title: "Armour set",
    summary:
      "Submit one or more armour tiers. Each tier becomes its own shop listing under your name.",
    steps: [
      "Add at least one tier (Iron, Steel, Abyssalite, Mythril, Mage, or Infantry).",
      "Tier name is optional if you want a custom name instead of the default tier label.",
      "Per tier, upload helmet, chestplate, leggings, and boots icons (16×16 PNG).",
      "Upload Layer 1 and Layer 2 body textures (64×32 PNG) for that tier.",
      "Optional: tick 3D Helmet and upload a Java Block/Item JSON + PNG instead of the flat helmet icon (File → Export → Export Block/Item Model; one-axis 22.5°/45° rotations only).",
      "Set the item name and colours/styles if you want, then submit.",
    ],
    notes: [
      "In-game name looks like: Item name + tier label + piece (e.g. Norain Iron Chestplate).",
    ],
  },
  handheld: {
    title: "Handheld",
    summary: "One 16×16 texture.",
    steps: [
      "Choose the item type this skin applies to.",
      "Upload one 16×16 PNG as texture.",
      "Set the item name (and optional name colours/styles).",
    ],
  },
  large_handheld: {
    title: "Large handheld",
    summary: "A 32×32 handheld with a grip slider for how it sits in hand.",
    steps: [
      "Choose the item type.",
      "Adjust the grip height slider while checking the preview.",
      "Upload one 32×32 PNG as texture.",
      "Set the item name / colours, then submit.",
    ],
  },
  bow: {
    title: "Bow",
    summary: "Four 16×16 frames so the bow animates while drawing.",
    steps: [
      "Choose the item type.",
      "Upload Standby texture, then Pull 0, Pull 1 and Pull 2. All must be 16×16 PNG.",
      "Set the item name / colours, then submit.",
    ],
  },
  large_bow: {
    title: "Large bow",
    summary: "Same as bow, but every frame is 32×32.",
    steps: [
      "Choose the item type.",
      "Upload Standby texture, Pull 0, Pull 1 and Pull 2. All must be 32×32 PNG.",
      "Set the item name / colours, then submit.",
    ],
  },
  crossbow: {
    title: "Crossbow",
    summary: "Five 16×16 frames, including the charged look.",
    steps: [
      "Choose the item type.",
      "Upload Standby texture, Pull 0, Pull 1, Pull 2 and Charged. All must be 16×16 PNG.",
      "Set the item name / colours, then submit.",
    ],
  },
  item_3d: {
    title: "Item 3D",
    summary: "A custom Blockbench model used as a 3D item skin.",
    steps: [
      "Choose the item type.",
      "In Blockbench: File → Export → Export Block/Item Model as Java Block/Item (not Java Item, not a project file).",
      "Cubes may only rotate on one axis by 22.5° or 45°.",
      "Upload that model JSON and its texture PNG.",
      "Set the item name / colours, then submit.",
    ],
  },
  shield: {
    title: "Shield 3D",
    summary: "3D shield model plus texture.",
    steps: [
      "Choose the item type.",
      "Export as Java Block/Item JSON (File → Export → Export Block/Item Model; one-axis 22.5°/45° only).",
      "Upload that JSON + texture PNG.",
      "Preview Idle / Blocking on Right and Left hands.",
      "Set the item name / colours, then submit.",
    ],
  },
  mask: {
    title: "Mask",
    summary:
      "3D helmet model worn as an RP mask. Skin it onto a mask in the armour shop; wearing it hides your character name.",
    steps: [
      "Choose Masks as the item type.",
      "Export as Java Block/Item JSON (File → Export → Export Block/Item Model; one-axis 22.5°/45° only).",
      "Upload that JSON + texture PNG.",
      "Set the item name / colours, then submit.",
    ],
    notes: [
      "After approval, apply the skin to a mask item in the armour shop. Wearing that mask shows you as Masked in character chat.",
    ],
  },
  helmet_3d: {
    title: "Helmet 3D",
    summary: "Standalone 3D helmet (model + texture), not a full armour set.",
    steps: [
      "Choose the item type.",
      "Export as Java Block/Item JSON (File → Export → Export Block/Item Model; one-axis 22.5°/45° only).",
      "Upload that JSON + texture PNG.",
      "Set the item name / colours, then submit.",
    ],
  },
  gun: {
    title: "Gun",
    summary: "One texture and three Blockbench models: carry, reload, and aim.",
    steps: [
      "Choose the item type.",
      "Upload one texture PNG used by all poses.",
      "Export carry, reload, and aim as Java Block/Item JSON (not Java Item; one-axis 22.5°/45° only).",
      "Upload them as Carry model, Reload model and Aim model.",
      "Set the item name / colours, then submit.",
    ],
  },
  book: {
    title: "Book",
    summary:
      "Two 16×16 covers: unsigned for the writable book, signed after the player signs it.",
    steps: [
      "Choose Books as the item type.",
      "Upload unsigned (writable / closed look) as a 16×16 PNG.",
      "Upload signed (after the book is signed) as a 16×16 PNG.",
      "Set the item name / colours, then submit.",
    ],
    notes: [
      "Unsigned is what players see before signing; signed replaces it when they finish the book.",
    ],
  },
};

type ToggleProps = {
  open: boolean;
  onToggle: () => void;
  panelId: string;
};

export function KindHelpToggle({ open, onToggle, panelId }: ToggleProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border text-xs font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] ${
        open
          ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)]"
          : "border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] text-[var(--tfmc-stone)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_50%,var(--tfmc-cream))] hover:text-[var(--tfmc-cream)]"
      }`}
      title={open ? "Hide help" : "How this works"}
    >
      ?
    </button>
  );
}

type PanelProps = {
  kind: SkinKind;
  open: boolean;
  id: string;
};

export function KindHelpPanel({ kind, open, id }: PanelProps) {
  const guide = GUIDES[kind];

  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        open
          ? "grid-rows-[1fr] opacity-100"
          : "pointer-events-none grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="mt-1 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_75%,var(--tfmc-forest-deep))] px-3.5 py-3 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]">
          <p className="m-0 text-sm font-medium text-[var(--tfmc-cream)]">
            {guide.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--tfmc-mist)]">
            {guide.summary}
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-[var(--tfmc-cream)]">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {guide.notes?.length ? (
            <ul className="mt-3 space-y-1 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3 text-xs leading-relaxed text-[var(--tfmc-mist)]">
              {guide.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--tfmc-accent)]"
                  />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Stable id helper for pairing toggle + panel. */
export function useKindHelpId(): string {
  return useId();
}
