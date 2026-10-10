"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import {
  StartRefusedError,
  timeUntil,
  type StartAllowance,
  type StartRefusal,
} from "../../../lib/profile/start";

export type WardrobeItem = {
  id: string;
  href: string;
  name: string;
  /** What it is: "Sword", "Armour set", "Drink". */
  detail: string;
  status: string;
  denyReason?: string | null;
  picture: ReactNode;
};

type Noun = "skin" | "drink";

type Props = {
  noun: Noun;
  items: WardrobeItem[];
  /** Undefined when the API can't start one from Profile; codes still work. */
  allowance?: StartAllowance;
  onStart: () => Promise<void>;
  /** The compact form for a /token create code. */
  codeForm: ReactNode;
};

const quietButtonClass =
  "text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";
const tileClass =
  "flex h-full min-h-44 w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] px-3 text-center text-sm";

const CHIPS: Record<string, { label: string; className: string }> = {
  pending: { label: "In review", className: "bg-[color-mix(in_srgb,var(--tfmc-cream)_16%,transparent)] text-[var(--tfmc-cream)]" },
  pending_pack: { label: "Live soon", className: "bg-[#c8b27a] text-[var(--tfmc-forest-deep)]" },
  approved: { label: "Live soon", className: "bg-[#c8b27a] text-[var(--tfmc-forest-deep)]" },
  applied: { label: "Live", className: "bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)]" },
  denied: { label: "Denied", className: "bg-[color-mix(in_srgb,#e8a0a0_22%,transparent)] text-[#f0b8b8]" },
  rejected: { label: "Denied", className: "bg-[color-mix(in_srgb,#e8a0a0_22%,transparent)] text-[#f0b8b8]" },
  revoked: { label: "Removed", className: "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] text-[var(--tfmc-stone)]" },
};

function Chip({ status }: { status: string }) {
  const chip = CHIPS[status.toLowerCase()];
  if (!chip) return null;
  return (
    <span
      className={`absolute left-2 top-2 rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${chip.className}`}
    >
      {chip.label}
    </span>
  );
}

function refusalText(noun: Noun, reason: StartRefusal, nextAt: string | null): string {
  switch (reason) {
    case "cooldown":
      return nextAt ? `Next ${noun} in ${timeUntil(nextAt)}` : `Your next ${noun} isn’t ready yet`;
    case "rank":
      return `Your rank can’t make ${noun}s`;
    case "join_server":
      return "Join the server once first";
    case "discord":
      return "Link Discord in game first";
  }
}

/** A hanger, for things with no picture yet. */
export function HangerGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-10 w-10 text-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)]">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7.5a2 2 0 1 1 2-2M12 7.5v1.5L3 15.5a1 1 0 0 0 .6 1.8h16.8a1 1 0 0 0 .6-1.8L12 9"
      />
    </svg>
  );
}

function Card({ item }: { item: WardrobeItem }) {
  const denied = ["denied", "rejected", "revoked"].includes(item.status.toLowerCase());
  return (
    <li>
      <Link
        href={item.href}
        className="block overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_50%,transparent)] transition-colors hover:border-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)]"
      >
        <div
          className="relative grid aspect-square place-items-center bg-[radial-gradient(circle_at_50%_45%,var(--tfmc-moss),color-mix(in_srgb,var(--tfmc-forest-deep)_90%,var(--tfmc-forest))_70%)]"
        >
          <div className={`grid h-full w-full place-items-center ${denied ? "opacity-50 grayscale" : ""}`}>
            {item.picture}
          </div>
          <Chip status={item.status} />
        </div>
        <div className="px-2.5 pb-3 pt-2">
          <p className="truncate font-semibold text-[var(--tfmc-cream)]">{item.name}</p>
          <p className="text-xs text-[var(--tfmc-mist)]">{item.detail}</p>
          {item.denyReason ? (
            <p className="mt-1 text-xs text-[#e8a0a0]">{item.denyReason}</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export default function Wardrobe({ noun, items, allowance, onStart, codeForm }: Props) {
  const codeId = useId();
  const [showCode, setShowCode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refused = allowance && !allowance.can_start && allowance.reason ? allowance : null;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await onStart();
    } catch (err) {
      setError(
        err instanceof StartRefusedError
          ? refusalText(noun, err.reason, err.nextAt)
          : err instanceof Error
            ? err.message
            : `Couldn’t start a ${noun}. Please try again.`
      );
      setStarting(false);
    }
  }

  let newTile: ReactNode;
  if (!allowance) {
    // Without the start route, the tile opens the code form instead.
    newTile = (
      <button
        type="button"
        onClick={() => setShowCode(true)}
        className={`${tileClass} text-[var(--tfmc-stone)] transition-colors hover:border-[color-mix(in_srgb,var(--tfmc-cream)_45%,transparent)] hover:text-[var(--tfmc-cream)]`}
      >
        <PlusMark />
        New {noun}
      </button>
    );
  } else if (refused) {
    newTile = (
      <div className={`${tileClass} text-[var(--tfmc-stone)] opacity-70`} aria-disabled>
        <PlusMark />
        New {noun}
        <span className="text-xs text-[var(--tfmc-mist)]">
          {refused.reason === "cooldown" && refused.next_at
            ? `In ${timeUntil(refused.next_at)}`
            : refusalText(noun, refused.reason!, refused.next_at)}
        </span>
      </div>
    );
  } else {
    newTile = (
      <button
        type="button"
        onClick={() => void start()}
        disabled={starting}
        className={`${tileClass} text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-accent)] disabled:opacity-60`}
      >
        <PlusMark />
        {starting ? "Opening…" : `New ${noun}`}
      </button>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4 text-sm text-[var(--tfmc-mist)]">
        <span>
          {items.length === 1 ? `1 ${noun}` : `${items.length} ${noun}s`}
        </span>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          aria-expanded={showCode}
          aria-controls={codeId}
          className={quietButtonClass}
        >
          Use a code
        </button>
      </div>
      <div id={codeId} hidden={!showCode} className="mb-4">
        <p className="mb-2 text-sm text-[var(--tfmc-mist)]">
          Run <code className="text-[var(--tfmc-accent)]">/token create {noun}</code> in game, then
          enter the code.
        </p>
        {codeForm}
      </div>
      {error ? (
        <p className="mb-3 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <li>{newTile}</li>
        {items.map((item) => (
          <Card key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function PlusMark() {
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 place-items-center rounded-full border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] text-xl leading-none"
    >
      +
    </span>
  );
}
