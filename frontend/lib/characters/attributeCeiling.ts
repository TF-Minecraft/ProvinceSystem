import type { AttributeModifierDto, CatalogStage, CatalogTrait, CreationCatalog } from "./api";

type Option = { ids: string[]; excludes: string[]; mods: Map<string, number> };

/** Above this many picks per stage the search gives up rather than stall the page. */
const MAX_STAGE_OPTIONS = 20_000;

function lower(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function modMap(...lists: (AttributeModifierDto[] | undefined)[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of lists) {
    for (const m of list ?? []) {
      const key = lower(m?.type);
      const amount = Number(m?.amount);
      if (key && Number.isFinite(amount)) out.set(key, (out.get(key) ?? 0) + amount);
    }
  }
  return out;
}

/** Every legal pick in one trait stage: size, point budget and the stage's own exclusions. */
function traitStageOptions(stage: CatalogStage, traits: CatalogTrait[]): Option[] | null {
  const key = lower(stage.key);
  const items = traits.filter(
    (t) => lower(t.key) === key && !(lower(stage.filter) === "permanent-only" && t.has_duration),
  );
  // Stages that change no attribute add nothing, so their picks need not be listed.
  if (!items.some((t) => t.attribute_modifiers?.length)) return [];
  const lo = Math.max(0, Number(stage.min_select ?? 0) || 0);
  const hi = Math.min(items.length, Number(stage.max_select ?? items.length) || 0);
  const budget = stage.points == null ? Infinity : Number(stage.points);
  const out: Option[] = [];
  const pick: CatalogTrait[] = [];
  let overflow = false;
  const walk = (start: number, cost: number) => {
    if (overflow) return;
    if (pick.length >= lo && cost <= budget) {
      if (out.length >= MAX_STAGE_OPTIONS) {
        overflow = true;
        return;
      }
      out.push({
        ids: pick.map((t) => lower(t.id)),
        excludes: pick.flatMap((t) => (t.mutually_exclusive ?? []).map(lower)),
        mods: modMap(...pick.map((t) => t.attribute_modifiers)),
      });
    }
    if (pick.length === hi) return;
    for (let i = start; i < items.length; i++) {
      const t = items[i];
      const id = lower(t.id);
      const clash = pick.some(
        (p) => (p.mutually_exclusive ?? []).some((x) => lower(x) === id) ||
          (t.mutually_exclusive ?? []).some((x) => lower(x) === lower(p.id)),
      );
      if (clash) continue;
      pick.push(t);
      walk(i + 1, cost + (Number(t.cost) || 0));
      pick.pop();
    }
  };
  walk(0, 0);
  return overflow ? null : out;
}

/** One option per affordable point-buy rank; each attribute's ranks are bought independently. */
function pointBuyOptions(catalog: CreationCatalog, traits: Map<string, CatalogTrait>): Option[] {
  const apb = catalog.attribute_point_buy;
  if (!apb) return [];
  const pattern = apb.trait_id_pattern || "{abbr}{rank}";
  const out: Option[] = [];
  for (const raw of apb.attributes ?? []) {
    const attr = lower(raw);
    const abbr = lower(apb.abbreviations?.[raw] ?? apb.abbreviations?.[attr] ?? attr.slice(0, 3));
    let spent = 0;
    const lists: AttributeModifierDto[][] = [];
    for (let rank = 1; rank <= apb.max_rank; rank++) {
      spent += Number(apb.cost_for_rank?.[rank - 1]) || 0;
      if (spent > apb.pool) break;
      const id = pattern.replace("{abbr}", abbr).replace("{rank}", String(rank));
      lists.push(traits.get(lower(id))?.attribute_modifiers ?? [{ type: attr, amount: 1 }]);
      out.push({ ids: [], excludes: [], mods: modMap(...lists) });
    }
  }
  return out;
}

/**
 * The highest total each attribute can reach through character creation:
 * the best race, affordable point-buy rank and trait picks, honouring
 * mutual exclusions across stages. Null when the catalogue is missing or too large to search.
 */
export function attributeCeilings(catalog: CreationCatalog | null | undefined): Record<string, number> | null {
  if (!catalog?.stages?.length) return null;
  const traits = new Map((catalog.traits ?? []).map((t) => [lower(t.id), t]));
  const stages: Option[][] = [];
  for (const stage of catalog.stages) {
    let options: Option[] | null = [];
    if (stage.type === "attributes") {
      options = pointBuyOptions(catalog, traits);
    } else if (stage.type === "selection" && lower(stage.target) === "race") {
      options = (catalog.races ?? []).map((r) => ({ ids: [], excludes: [], mods: modMap(r.attribute_modifiers) }));
    } else if (stage.type === "selection" && lower(stage.target) === "trait") {
      options = traitStageOptions(stage, catalog.traits ?? []);
    }
    if (options == null) return null;
    if (options.some((o) => o.mods.size)) stages.push(options);
  }

  const attrs = new Set((catalog.attribute_point_buy?.attributes ?? []).map(lower));
  for (const options of stages) for (const o of options) for (const k of o.mods.keys()) attrs.add(k);

  const out: Record<string, number> = {};
  for (const attr of attrs) {
    const value = (o: Option) => o.mods.get(attr) ?? 0;
    const sorted = stages.map((s) => [...s].sort((a, b) => value(b) - value(a)));
    const suffix = new Array<number>(sorted.length + 1).fill(0);
    for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + (sorted[i].length ? value(sorted[i][0]) : 0);
    let best = -Infinity;
    const chosen: string[] = [];
    const blocked: string[] = [];
    const search = (i: number, total: number) => {
      if (total + suffix[i] <= best) return;
      if (i === sorted.length) {
        best = total;
        return;
      }
      if (!sorted[i].length) return search(i + 1, total);
      for (const o of sorted[i]) {
        if (o.ids.some((id) => blocked.includes(id)) || o.excludes.some((x) => chosen.includes(x))) continue;
        chosen.push(...o.ids);
        blocked.push(...o.excludes);
        search(i + 1, total + value(o));
        chosen.length -= o.ids.length;
        blocked.length -= o.excludes.length;
      }
    };
    search(0, 0);
    if (Number.isFinite(best)) out[attr] = best;
  }
  return out;
}
