"use client";

import type { AttributePointBuy } from "../../../lib/characters/api";
import {
  canDecrement,
  canIncrement,
  costOfNextRank,
  displayAttrName,
  remainingPoints,
} from "../../../lib/characters/pointBuy";

type Props = {
  ranks: Record<string, number>;
  apb: AttributePointBuy;
  onChange: (ranks: Record<string, number>) => void;
};

export default function AttributeSheet({ ranks, apb, onChange }: Props) {
  const remaining = remainingPoints(ranks, apb);

  function bump(attr: string, delta: 1 | -1) {
    const current = Number(ranks[attr] ?? 0) || 0;
    if (delta > 0 && !canIncrement(ranks, attr, apb)) return;
    if (delta < 0 && !canDecrement(ranks, attr)) return;
    onChange({ ...ranks, [attr]: current + delta });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--tfmc-stone)]">
        Spend exactly <span className="text-[var(--tfmc-cream)]">{apb.pool}</span> points. Remaining:{" "}
        <span className={remaining === 0 ? "text-[var(--tfmc-accent)]" : "text-[var(--tfmc-cream)]"}>{remaining}</span>
      </p>
      <ul className="flex flex-col gap-3">
        {apb.attributes.map((attr) => {
          const rank = Number(ranks[attr] ?? 0) || 0;
          const nextCost = costOfNextRank(rank, apb.cost_for_rank);
          return (
            <li
              key={attr}
              className="flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pb-3"
            >
              <div>
                <p className="font-medium text-[var(--tfmc-cream)]">{displayAttrName(attr)}</p>
                <p className="text-xs text-[var(--tfmc-mist)]">
                  Rank +{rank}
                  {nextCost != null && rank < apb.max_rank ? ` · next costs ${nextCost}` : " · max"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Decrease ${attr}`}
                  disabled={!canDecrement(ranks, attr)}
                  onClick={() => bump(attr, -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] text-lg text-[var(--tfmc-cream)] disabled:opacity-30"
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label={`Increase ${attr}`}
                  disabled={!canIncrement(ranks, attr, apb)}
                  onClick={() => bump(attr, 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] text-lg text-[var(--tfmc-cream)] disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
