import { materialCatalog } from "./catalog";
import { slugify } from "./helpers";
import { customItemIdentity } from "./item-identity";
import { allRecipes } from "./registry";
import { stations } from "./stations";
import { vehicles } from "./vehicles";
import type { Recipe, Slot } from "./types";
import descriptions from "./generated/itemDescriptions.json";

export type ItemDetail = {
  identity: string;
  name: string;
  slug: string;
  href: string;
  texture?: string;
  model?: Slot["model"];
  recipes: Recipe[];
  usedIn: Recipe[];
  description?: string;
};

export const itemRecipes = [...new Map(allRecipes.map(recipe => [recipe.key, recipe])).values()];
const byIdentity = new Map<string, ItemDetail>();
const materialByIdentity = new Map([...materialCatalog.values()].map(material => [customItemIdentity(material), material]));
/** A station's own item has no item page: its station page already holds the recipe and model. */
const stationHrefByIdentity = new Map(stations.flatMap(station => {
  const output = (station.craftRecipe ?? station.vanillaBlock?.recipe)?.output;
  const identity = output ? customItemIdentity(output) : undefined;
  return identity ? [[identity, `/wiki/stations/${station.slug}`] as const] : [];
}));

for (const recipe of itemRecipes) {
  for (const slot of [recipe.output, ...recipe.ingredients]) {
    const identity = customItemIdentity(slot);
    if (!identity || byIdentity.has(identity)) continue;
    const material = materialByIdentity.get(identity);
    byIdentity.set(identity, {
      identity, name: material?.name ?? slot.name, slug: slugify(material?.name ?? slot.name),
      href: material ? `/wiki/materials/${material.slug}` : stationHrefByIdentity.get(identity) ?? "",
      texture: material?.texture ?? slot.texture, model: slot.model, recipes: [], usedIn: [],
      description: (descriptions as Record<string, string[]>)[identity]?.join(" "),
    });
  }
}

// Every collision gets a reversible identity suffix, independent of traversal order.
const slugCounts = new Map<string, number>();
for (const item of byIdentity.values()) slugCounts.set(item.slug, (slugCounts.get(item.slug) ?? 0) + 1);
for (const item of byIdentity.values()) {
  if ((slugCounts.get(item.slug) ?? 0) > 1) item.slug += `--${Array.from(item.identity).map(char => char.codePointAt(0)!.toString(16)).join("-")}`;
  if (!item.href) item.href = `/wiki/items/${item.slug}`;
  item.recipes = itemRecipes.filter(recipe => customItemIdentity(recipe.output) === item.identity);
  item.usedIn = itemRecipes.filter(recipe => recipe.ingredients.some(slot => customItemIdentity(slot) === item.identity));
}

/** Only items occurring in the site's recipe data create detail routes. */
export const itemDetails = [...byIdentity.values()].filter(item => item.href.startsWith("/wiki/items/"));
export function getItemBySlug(slug: string): ItemDetail | undefined {
  return itemDetails.find(item => item.slug === slug);
}
export function getRecipeItemHref(slot: Slot): string | undefined {
  const vehicle = slot.model && vehicles.find(candidate => candidate.skins.some(skin => skin.modelUrl === slot.model?.url));
  if (vehicle) return `/wiki/vehicles?vehicle=${vehicle.slug}#catalogue`;
  const identity = customItemIdentity(slot);
  return identity ? byIdentity.get(identity)?.href : undefined;
}

/** Resolve prose mentions only when they identify one canonical wiki destination. */
export function resolveWikiItemHref(
  name: string,
  sourceId?: string,
): string | undefined {
  if (sourceId) {
    const identity = customItemIdentity({ name, sourceId });
    if (!identity) return undefined;
    const material = materialByIdentity.get(identity);
    return material ? `/wiki/materials/${material.slug}` : byIdentity.get(identity)?.href;
  }

  const hrefs = new Set<string>();
  const material = materialCatalog.get(name);
  if (material) hrefs.add(`/wiki/materials/${material.slug}`);
  for (const item of byIdentity.values()) {
    if (item.name === name) hrefs.add(item.href);
  }
  return hrefs.size === 1 ? [...hrefs][0] : undefined;
}

/** Exact, unambiguous names available to plain-text prose renderers. */
export function getWikiItemLinkTargets(): ReadonlyArray<{ name: string; href: string }> {
  const names = new Set<string>([
    ...materialCatalog.keys(),
    ...[...byIdentity.values()].map(item => item.name),
  ]);
  return [...names]
    .map(name => ({ name, href: resolveWikiItemHref(name) }))
    .filter((target): target is { name: string; href: string } => Boolean(target.href))
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}
