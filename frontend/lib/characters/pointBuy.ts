import type { AttributePointBuy } from "./api";

/** Cost to buy the n-th rank (1-based) = cost_for_rank[n-1]. */
export function costOfNextRank(currentRank: number, costForRank: number[]): number | null {
  if (currentRank < 0 || currentRank >= costForRank.length) {
    return null;
  }
  return Number(costForRank[currentRank]) || 0;
}

export function spentPoints(ranks: Record<string, number>, costForRank: number[]): number {
  let total = 0;
  for (const rank of Object.values(ranks)) {
    const r = Math.max(0, Number(rank) || 0);
    for (let i = 0; i < r; i++) {
      if (i >= costForRank.length) break;
      total += Number(costForRank[i]) || 0;
    }
  }
  return total;
}

export function remainingPoints(ranks: Record<string, number>, apb: AttributePointBuy): number {
  return apb.pool - spentPoints(ranks, apb.cost_for_rank);
}

export function canIncrement(ranks: Record<string, number>, attr: string, apb: AttributePointBuy): boolean {
  const current = Number(ranks[attr] ?? 0) || 0;
  if (current >= apb.max_rank) return false;
  const cost = costOfNextRank(current, apb.cost_for_rank);
  if (cost == null) return false;
  return remainingPoints(ranks, apb) >= cost;
}

export function canDecrement(ranks: Record<string, number>, attr: string): boolean {
  return (Number(ranks[attr] ?? 0) || 0) > 0;
}

export function emptyRanks(attributes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of attributes) {
    out[a] = 0;
  }
  return out;
}

export function isExactSpend(ranks: Record<string, number>, apb: AttributePointBuy): boolean {
  return spentPoints(ranks, apb.cost_for_rank) === apb.pool;
}

export function displayAttrName(attr: string): string {
  if (!attr) return "";
  return attr.charAt(0).toUpperCase() + attr.slice(1);
}
