/**
 * Shared types for the wiki data layer.
 *
 * Everything here is re-exported from `@/app/wiki/data`. Import from there, not
 * from this file directly.
 */

import type { ReactNode } from "react";

// ---------- Recipes ----------

export type Slot = {
  /** Stable server reference, including explicit vanilla references. */
  sourceId?: string;
  name: string;
  qty: number;
  texture?: string;
  /** Render a small live 3D preview instead of a flat texture (used for station outputs). */
  model?: {
    url: string;
    texture?: string;
    /** Model texture key to public texture URL, for Blockbench models that use several images. */
    textures?: Record<string, string>;
    textureAnimationUrl?: string;
  };
};

export type Recipe = {
  key: string;
  title: string;
  station: string;
  time?: number;
  requirement?: string;
  /**
   * Optional grouping label for station pages, e.g. "Leaves" or "Waxed Copper".
   * Set by the generated server data so that a station with 129 recipes renders
   * as headed sections instead of one undifferentiated list.
   */
  category?: string;
  ingredients: Slot[];
  output: Slot;
  note?: string;
};

// ---------- Navigation ----------

/**
 * The fixed set of sidebar categories. Adding a page means picking one of these
 * keys: a typo is a compile error, not a page that quietly disappears from the
 * sidebar. Add a new key here and to `CATEGORY_DEFS` in `nav.ts` together.
 */
export type WikiCategoryKey =
  | "getting-started"
  | "character"
  | "professions"
  | "gathering"
  | "food"
  | "magic"
  | "combat"
  | "vehicles"
  | "social"
  | "reference";

export type WikiCategory = {
  key: WikiCategoryKey;
  label: string;
  blurb: string;
  order: number;
};

export type WikiNavItem = {
  /** Absolute route, e.g. "/wiki/mount-whistle". */
  href: string;
  label: string;
  category: WikiCategoryKey;
  /** One-sentence summary. Used by the sidebar tooltip and the overview cards. */
  blurb: string;
};

/**
 * One registered wiki section: its nav entry plus any game data the rest of the
 * wiki has to be able to see globally.
 *
 * `recipes` is the important part: every recipe listed here is automatically
 * picked up by `getRecipesForStation()` and by the material "used in" reverse
 * index. There is no second list to remember to append to.
 */
export type WikiSection = {
  nav: WikiNavItem;
  /** Recipes this section owns, folded into the global recipe index. */
  recipes?: Recipe[];
  /**
   * Commands this section documents, folded into the global command index at
   * `/wiki/commands`. Same principle as `recipes`: one registration act, so a
   * page cannot be silently missing from the index.
   */
  commands?: WikiCommandSet;
};

// ---------- Commands ----------

/**
 * `"player"`: anyone can run it. `"permission"`. It needs a permission node,
 * so most players will just see "Unknown command".
 */
export type CommandAccess = "player" | "permission";

/**
 * One row of a command table. This is the shape `CommandTable` renders, and it
 * lives here rather than in the component so that the data layer never has to
 * import from `app/components/`.
 */
export type CommandRow = {
  /** The command as typed, e.g. `"/instruments keybinds"`. */
  command: string;
  /** Alternate spellings, e.g. `["/inst", "/i"]`. */
  aliases?: string[];
  /** What the command does, in one or two sentences. */
  description: ReactNode;
  /** Caveats: cooldowns, required held item, argument details. */
  notes?: ReactNode;
  /** Defaults to `"player"`. */
  access?: CommandAccess;
  /** The permission node, shown under the command when `access` is `"permission"`. */
  permission?: string;
};

/**
 * Every command one plugin/system exposes to players, registered on the section
 * that documents them. Registering here: rather than hand-writing the rows
 * inline in the page: is what lets `/wiki/commands` list every command on the
 * server and flag two plugins that claim the same one.
 */
export type WikiCommandSet = {
  /** The plugin or system these belong to, e.g. `"Musical Instruments"`. */
  system: string;
  /** The page that documents them. Must match the section's `nav.href`. */
  href: string;
  /** The player-facing rows. May be empty: "this system has no commands" is a fact worth stating. */
  commands: CommandRow[];
  /**
   * Commands deliberately left out because only staff can run them. Recorded so
   * the research behind the page is not lost, and rendered as a trailing note.
   */
  excludedStaffCommands?: string[];
};

/** One command row plus the system and page it was registered by. */
export type RegisteredCommand = {
  row: CommandRow;
  system: string;
  href: string;
};

/** A command string registered by more than one section. */
export type DuplicateCommand = {
  /** The command as typed, lower-cased. */
  command: string;
  /** Every registration of it, in registry order. */
  registrations: RegisteredCommand[];
};

// ---------- Instruments ----------

export type InstrumentKey = { num: number; note: string; sound: string };

export type InstrumentInfo = {
  slug: string;
  name: string;
  icon: string;
  mode: "chord" | "octave";
  row1: InstrumentKey[];
  row2: InstrumentKey[];
};

// ---------- Materials ----------

/**
 * A material the catalogue knows by name, texture and lore alone. Its recipe,
 * if it has one, is resolved from the global recipe index rather than being
 * attached here.
 */
export type CatalogMaterial = {
  name: string;
  texture?: string;
  lore?: string;
  acquisition?: MaterialAcquisition[];
  /** Existing-stock conversions, not a source of new material. */
  unpackingRecipeKeys?: string[];
};

export type MaterialAcquisition = {
  method: string;
  detail: string;
};

/** A gathered material may also have a block-unpacking recipe. */
export type DropOnlyMaterial = CatalogMaterial;

export type MaterialCatalogEntry = {
  slug: string;
  name: string;
  texture?: string;
  lore?: string;
  recipe?: Recipe;
  recipes: Recipe[];
  acquisition?: MaterialAcquisition[];
  unpackingRecipes: Recipe[];
  usedIn: Recipe[];
};

// ---------- Stations ----------

export type StationInfo = {
  slug: string;
  name: string;
  blurb: string;
  icon: string;
  /** The verified input that opens or operates this station. */
  interaction: "Right click" | "Shift + Right click";
  /** A registered guide that explains non-grid recipes or the station's wider workflow. */
  guide?: { href: string; label: string };
  model?: { url: string; texture?: string; textures?: Record<string, string>; textureAnimationUrl?: string };
  fallbackTexture?: string;
  /** How to craft the physical station block/furniture itself, if it has one. */
  craftRecipe?: Recipe;
  /** Set when this station uses an ordinary vanilla block. */
  vanillaBlock?: { name: string; recipe: Recipe };
  /** Per-face textures for a plain vanilla cube block, rendered with SimpleCubeViewer. */
  cubeFaces?: { up: string; down: string; north: string; south: string; east: string; west: string };
};
