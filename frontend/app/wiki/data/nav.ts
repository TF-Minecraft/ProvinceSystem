import { wikiSections } from "./registry";
import type { WikiCategory, WikiCategoryKey, WikiNavItem } from "./types";

/** The overview page. Not a registered section. It is the index of all of them. */
export const overviewNavItem: WikiNavItem = {
  href: "/wiki",
  label: "Overview",
  category: "getting-started",
  blurb: "Every section of the guide, grouped by topic.",
};

/**
 * Category definitions, keyed by `WikiCategoryKey`. Typed as a full `Record`, so
 * adding a key to `WikiCategoryKey` without defining it here is a compile error.
 */
const CATEGORY_DEFS: Record<WikiCategoryKey, Omit<WikiCategory, "key">> = {
  "getting-started": {
    label: "Getting Started",
    blurb: "First steps on the server: what to read before anything else.",
    order: 1,
  },
  character: {
    label: "Character & Identity",
    blurb: "Who you are: classes, appearance, and the choices that stick with you.",
    order: 2,
  },
  professions: {
    label: "Professions & Crafting",
    blurb: "Trades, skill trees, and the systems that turn raw goods into gear.",
    order: 3,
  },
  gathering: {
    label: "Gathering & Farming",
    blurb: "Where raw materials come from: mining, harvesting, and husbandry.",
    order: 4,
  },
  food: {
    label: "Food & Drink",
    blurb: "Cooking, brewing, and what the results actually do for you.",
    order: 5,
  },
  magic: {
    label: "Magic & Knowledge",
    blurb: "Arcane systems, research, and the strange things buried in the world.",
    order: 6,
  },
  combat: {
    label: "Combat & Danger",
    blurb: "Fighting, dying, and everything on the server that wants you dead.",
    order: 7,
  },
  vehicles: {
    label: "Vehicles & Machines",
    blurb: "Mounts, transport, and the machinery that moves you and your cargo.",
    order: 8,
  },
  social: {
    label: "Society & Economy",
    blurb: "Playing with other people: trade, performance, and community systems.",
    order: 9,
  },
  reference: {
    label: "Reference",
    blurb: "Lookup tables: every material, every station, every number.",
    order: 10,
  },
};

/** All categories, in display order. */
export const wikiCategories: readonly WikiCategory[] = (
  Object.entries(CATEGORY_DEFS) as Array<[WikiCategoryKey, Omit<WikiCategory, "key">]>
)
  .map(([key, def]) => ({ key, ...def }))
  .sort((a, b) => a.order - b.order);

/**
 * Every content page's nav entry, derived from the section registry. There is no
 * hand-maintained copy of this list and no separate blurb map: a page appears
 * here (and therefore in the sidebar and on the overview) purely by being
 * registered in `registry.ts`.
 */
export const navItems: readonly WikiNavItem[] = wikiSections.map((s) => s.nav);

/** Nav items for one category, in registration order. */
export function navItemsForCategory(key: WikiCategoryKey): WikiNavItem[] {
  return navItems.filter((item) => item.category === key);
}

/** Categories that actually have at least one page, in display order. */
export function populatedCategories(): WikiCategory[] {
  return wikiCategories.filter((c) => navItems.some((item) => item.category === c.key));
}

export function getNavItemByHref(href: string): WikiNavItem | undefined {
  if (href === overviewNavItem.href) return overviewNavItem;
  return navItems.find((item) => item.href === href);
}
