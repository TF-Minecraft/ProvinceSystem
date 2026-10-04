/**
 * Generates `app/wiki/data/generated/stationRecipes.ts` from the live MMOItems
 * crafting-station YAML files.
 *
 * The source lives OUTSIDE this repository (it is the server's plugin config),
 * so this script is deliberately not part of `npm run build`. Run it by hand
 * whenever the server config changes:
 *
 *   node scripts/build-station-recipes.mjs [path/to/MMOItems/crafting-stations] [path/to/MMOItems/item]
 *
 * With no argument it falls back to DEFAULT_SOURCE_DIR below, and fails loudly
 * if that directory does not exist. The second argument (the MMOItems *item*
 * configs, default: the sibling `item/` directory) is optional and supplies the
 * real display names and base materials for MMOItems items. Without it, names
 * fall back to a title-cased item id, which is noticeably worse
 * (`ARCHAEO_TRACKER` -> "Archaeo Tracker" rather than "Field Compass"), and
 * custom items lose the vanilla sprite they are actually built on.
 *
 * Output is deterministic: files are read in sorted order, recipes are emitted
 * in YAML declaration order, and the texture index is built from sorted reads.
 * Re-running against an unchanged source and texture set produces a
 * byte-identical file.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_DIR = "C:/Users/MSI/Desktop/plugins/MMOItems/crafting-stations";
const OUTPUT_FILE = path.join(FRONTEND_ROOT, "app", "wiki", "data", "generated", "stationRecipes.ts");
const TEXTURE_ROOT = path.join(FRONTEND_ROOT, "public", "wiki", "textures");
const ITEMSADDER_MANIFEST = path.join(FRONTEND_ROOT, "app", "wiki", "data", "generated", "itemsadderItems.json");
const MMOITEMS_MANIFEST = path.join(FRONTEND_ROOT, "app", "wiki", "data", "generated", "mmoitemsItems.json");

/**
 * Texture directories that hold real item sprites. Everything else under
 * `public/wiki/textures` (block-model atlases, per-face block textures, vehicle
 * skins) renders as an unreadable blob at crafting-slot size, so it is
 * deliberately not searchable here.
 */
const ITEM_TEXTURE_DIRS = [
  "ammunition", "crops", "currency", "farming", "fishing-rods", "furniture",
  "gems", "goldsmith-tools", "gun-parts", "instruments", "jewellery",
  "magic_crafting", "materials", "pets", "skin-scrolls", "smithing-tools",
  "tools", "vanilla",
];

/**
 * Filename -> the `stations.ts` `name` this file's recipes belong to.
 *
 * This explicit table exists instead of trusting each YAML's own `name:`,
 * because `engineer-station.yml` declares 'Enginner Station' (a typo on the
 * server) and station matching in `catalog.ts#getRecipesForStation` is exact
 * string equality, so the typo would silently render zero recipes. Every file
 * is listed, so a new YAML file fails loudly rather than generating recipes
 * that nothing can display.
 */
const STATION_NAME_BY_FILE = {
  "alchemy-station.yml": "Alchemy Station",
  "animal-station.yml": "Animal Station",
  "archeology-station.yml": "Archeology Station",
  "block-station.yml": "Block Station",
  "copper-station.yml": "Copper Station",
  "engineer-station.yml": "Engineer Station", // YAML says 'Enginner Station' (server typo).
  "fishing-station.yml": "Fishing Station",
  "forester-station.yml": "Forester Station",
  "ingot-station.yml": "Ingot Station",
  "instrument-station.yml": "Instrument Station",
  "meal-prep-station.yml": "Meal Prep Station",
  "medicine-station.yml": "Medicine Station",
  "research-station.yml": "Research Station",
  "rune-station.yml": "Rune Station",
  "tool-station.yml": "Tool Station",
};

/** `class{list=Bard}` carries no `display`, so its player-facing label is written here. */
const CLASS_REQUIREMENT_LABELS = { Bard: "Bard class" };

/** Resolve item references from the server configuration to available pack assets. */
const ITEMSADDER_ID_ALIASES = {
  // Dev block-station.yml uses singular `marauder_goldbar`; the pack declares the plural id.
  marauder_goldbar: "marauder_goldbars",
};
// ---------------------------------------------------------------------------
// YAML subset parser
// ---------------------------------------------------------------------------

/**
 * Parses just the `recipes:` block of an MMOItems station config. This is not a
 * general YAML parser; it handles exactly the shape these 14 files use:
 *
 *   recipes:
 *       <recipe-key>:            # 4 spaces
 *           <field>: <scalar>    # 8 spaces
 *           <field>:             # 8 spaces, then either
 *           - <list item>        #   a list at the SAME indent, or
 *               <k>: <v>         #   a nested map at 12 spaces
 *
 * Any line inside `recipes:` matching none of those forms is returned in
 * `unparsed`, so a config change cannot be dropped silently.
 */
export function parseStationRecipes(text) {
  const recipes = [];
  const unparsed = [];
  let inRecipes = false;
  let recipe = null;
  let field = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^recipes:\s*$/.test(raw)) { inRecipes = true; continue; }
    if (!inRecipes) continue;
    if (/^\S/.test(raw)) { inRecipes = false; continue; }

    const indent = raw.length - raw.trimStart().length;
    const body = stripComment(raw.trim());

    if (indent === 4) {
      const m = body.match(/^([^:]+):\s*$/);
      if (!m) { unparsed.push({ line: i + 1, text: raw }); continue; }
      recipe = { key: m[1].trim(), fields: {} };
      field = null;
      recipes.push(recipe);
      continue;
    }
    if (!recipe) { unparsed.push({ line: i + 1, text: raw }); continue; }

    if (indent === 8 && body.startsWith("- ")) {
      if (!field) { unparsed.push({ line: i + 1, text: raw }); continue; }
      const item = unquote(body.slice(2).trim());
      const existing = recipe.fields[field];
      if (Array.isArray(existing)) existing.push(item);
      else recipe.fields[field] = [item];
      continue;
    }
    if (indent === 8) {
      const m = body.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!m) { unparsed.push({ line: i + 1, text: raw }); continue; }
      field = m[1];
      recipe.fields[field] = m[2] === "" ? {} : unquote(m[2]);
      continue;
    }
    if (indent === 12) {
      const m = body.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      const target = field ? recipe.fields[field] : undefined;
      if (m && target && typeof target === "object" && !Array.isArray(target)) target[m[1]] = unquote(m[2]);
      else unparsed.push({ line: i + 1, text: raw });
      continue;
    }
    unparsed.push({ line: i + 1, text: raw });
  }
  return { recipes, unparsed };
}

/** Drops a trailing ` # comment`, but only when the `#` sits outside quotes. */
function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "#" && i > 0 && /\s/.test(value[i - 1])) return value.slice(0, i).trimEnd();
  }
  return value;
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === "'" && v.at(-1) === "'") || (v[0] === '"' && v.at(-1) === '"'))) {
    // Inside a YAML single-quoted scalar, '' is an escaped apostrophe.
    return v[0] === "'" ? v.slice(1, -1).replaceAll("''", "'") : v.slice(1, -1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Item reference parsing
// ---------------------------------------------------------------------------

/**
 * Parses `prefix{k=v,k=v}` item and condition references.
 *
 * Attributes are separated by `,` OR `;` -- both spellings appear in these
 * files, and a comma-only split silently yields a bogus `type`. Splitting is
 * quote-aware so a `display="a, b"` cannot be torn in half.
 */
export function parseRef(value) {
  const m = value.match(/^([A-Za-z_]+)\{([\s\S]*)\}$/);
  if (!m) return null;
  const attrs = {};
  let key = "";
  let buffer = "";
  let quote = null;
  let seenEquals = false;
  const commit = () => {
    if (key || buffer) attrs[key.trim()] = unquote(buffer);
    key = ""; buffer = ""; seenEquals = false;
  };
  for (const ch of m[2]) {
    if (quote) { buffer += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { buffer += ch; quote = ch; continue; }
    if (ch === "=" && !seenEquals) { seenEquals = true; continue; }
    if (ch === "," || ch === ";") { commit(); continue; }
    if (seenEquals) buffer += ch;
    else key += ch;
  }
  commit();
  return { kind: m[1], attrs };
}

/** Strips Minecraft colour/format codes in both the `§x` and `&x` spellings. */
export function stripColours(value) {
  return value
    .replace(/<\/?[^<>]+>/g, "")
    .replace(/[\u00a7&][0-9a-fk-orA-FK-OR]/g, "")
    .trim();
}

/**
 * Display name and base vanilla material for every MMOItems item, keyed by id.
 *
 * Two things the crafting-station configs cannot tell us:
 *  - the item's real name (a station config names an item only when some recipe
 *    happens to use it as an ingredient with `display=`; map-form outputs carry
 *    no name at all);
 *  - the vanilla item it is built on, which is the sprite a player actually
 *    sees, and therefore the only honest texture for a custom item with no
 *    sprite of its own under `public/wiki/textures`.
 *
 * The shape is trivial: an id at column 0, `name:` and `material:` at indent 4
 * under `base:`. Ids are unique across these files (verified: 1232 ids, 0
 * conflicting names), so a flat index is safe.
 */
export function buildItemIndex(itemDir) {
  const byId = new Map();
  if (!itemDir || !existsSync(itemDir) || !statSync(itemDir).isDirectory()) return byId;
  for (const file of readdirSync(itemDir).filter((f) => f.endsWith(".yml")).sort()) {
    let id = null;
    for (const line of readFileSync(path.join(itemDir, file), "utf8").split(/\r?\n/)) {
      const head = line.match(/^([A-Z0-9_]+):(?:\s*#.*)?\s*$/);
      if (head) { id = head[1]; continue; }
      if (!id) continue;
      const name = line.match(/^ {4}name:\s*(.+)$/);
      if (name) {
        const value = stripColours(unquote(name[1]));
        const entry = byId.get(id) ?? {};
        if (value && entry.name === undefined) byId.set(id, { ...entry, name: value });
        continue;
      }
      const material = line.match(/^ {4}material:\s*([A-Za-z0-9_]+)\s*$/);
      if (material) {
        const entry = byId.get(id) ?? {};
        if (entry.material === undefined) byId.set(id, { ...entry, material: material[1] });
        continue;
      }
      // `model:` is the item_model component (`namespace:name`), which replaces CMD for newer items.
      const itemModel = line.match(/^ {4}model:\s*['"]?([a-z0-9_.-]+:[a-z0-9_./-]+)['"]?\s*$/);
      if (itemModel) {
        const entry = byId.get(id) ?? {};
        if (entry.itemModel === undefined) byId.set(id, { ...entry, itemModel: itemModel[1] });
        continue;
      }
      const customModelData = line.match(/^ {4}custom-model-data:\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
      if (customModelData) {
        const entry = byId.get(id) ?? {};
        if (entry.customModelData === undefined) {
          byId.set(id, { ...entry, customModelData: Number(customModelData[1]) });
        }
      }
    }
  }
  return byId;
}

/** `COPPER_BLOCK` / `copper-block` -> `Copper Block`. */
export function titleCase(id) {
  return id
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/**
 * Index of item-sprite basenames to their public URL. A basename present in
 * more than one searchable directory is recorded as ambiguous and never
 * resolved, so the generator cannot guess wrong between e.g.
 * `crops/apple.png` and `market-block/apple.png`.
 */
export function buildTextureIndex() {
  const byName = new Map();
  const ambiguous = new Set();
  for (const dir of [...ITEM_TEXTURE_DIRS].sort()) {
    const full = path.join(TEXTURE_ROOT, dir);
    if (!existsSync(full) || !statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full).sort()) {
      if (!file.endsWith(".png")) continue;
      const name = file.toLowerCase();
      const url = `/wiki/textures/${dir}/${file}`;
      if (byName.has(name) && byName.get(name) !== url) ambiguous.add(name);
      else byName.set(name, url);
    }
  }
  for (const name of ambiguous) byName.delete(name);
  return { byName, ambiguous };
}

/**
 * Display-name -> texture, read from `app/wiki/data/materials.ts`.
 *
 * MMOItems ids do not match texture filenames (an ingredient ref
 * `mmoitem{id=ABYSSALITE_FRAGMENT,...}` has no sprite named
 * `abyssalite_fragment.png`; the real file is `materials/abyssalite.png`), so
 * the id-based lookups above miss real textures. The hand-written wiki
 * catalogue in `materials.ts` (`serverCraftedMaterials`, `dropOnlyMaterials`,
 * and the `materialRecipes` outputs/ingredients) is the authority on
 * display-name -> texture for exactly this reason: a human already resolved
 * the mismatch once, per material, when writing that file. Re-deriving it
 * here instead of hand-copying it into this script keeps the two in sync
 * automatically as materials.ts changes.
 *
 * Parsed with a regex, not a TS compiler, because every entry in that file
 * has the trivial shape `name: "X", ... texture: T("path.png")` (verified:
 * the file has an equal count of `name:` and `texture: T(` occurrences, i.e.
 * every name is immediately followed by its own texture). A name seen with
 * two different textures is ambiguous and dropped rather than guessed.
 */
export function buildMaterialNameTextureIndex(materialsFile) {
  const byName = new Map();
  const ambiguous = new Set();
  if (!existsSync(materialsFile)) return { byName, ambiguous };
  const text = readFileSync(materialsFile, "utf8");
  const re = /name:\s*"([^"]+)"\s*,\s*(?:qty:\s*\d+\s*,\s*)?texture:\s*T\("([^"]+)"\)/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, texturePath] = m;
    const url = `/wiki/textures/${texturePath}`;
    if (byName.has(name) && byName.get(name) !== url) ambiguous.add(name);
    else byName.set(name, url);
  }
  for (const name of ambiguous) byName.delete(name);
  return { byName, ambiguous };
}

/**
 * Display name and sprite for every ItemsAdder id a station recipe references,
 * keyed by bare id, read from `itemsadderItems.json`.
 *
 * `itemsadder{id=...}` refs are the third form of item reference in these
 * configs and the only one with no sprite of its own here: the packs that
 * define them live with the server's ItemsAdder install, outside this
 * repository, and their ids match no filename under `public/wiki/textures`.
 * `scripts/extract-itemsadder-textures.mjs` copies the referenced sprites in
 * and writes that manifest; it is checked in so this generator stays runnable
 * without an ItemsAdder install present.
 *
 * The manifest deliberately also carries names for ids with no sprite: the
 * pack's own `display_name` is the authority (`mythril_block4` is "Oxidized
 * Mythril", which no amount of title-casing the id will produce).
 */
export function buildItemsAdderIndex(manifestFile) {
  const byId = new Map();
  if (!existsSync(manifestFile)) return byId;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return byId;
  }
  for (const [id, record] of Object.entries(parsed)) {
    if (!record || typeof record !== "object") continue;
    byId.set(id.toLowerCase(), {
      name: typeof record.name === "string" ? record.name : undefined,
      texture: typeof record.texture === "string" ? record.texture : undefined,
      material: typeof record.material === "string" ? record.material : undefined,
    });
  }
  return byId;
}

/** Exact custom-model sprites extracted from the server resource pack, by MMOItems id. */
export function buildMmoItemsTextureIndex(manifestFile) {
  const byId = new Map();
  if (!existsSync(manifestFile)) return byId;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return byId;
  }
  for (const [id, record] of Object.entries(parsed)) {
    if (!record || typeof record !== "object") continue;
    byId.set(id, {
      texture: typeof record.texture === "string" ? record.texture : undefined,
      sourceModel: typeof record.sourceModel === "string" ? record.sourceModel : undefined,
      sourceTexture: typeof record.sourceTexture === "string" ? record.sourceTexture : undefined,
    });
  }
  return byId;
}

/** `tfmc_blocks:mythril_block3` and `mythril_block3` are the same item. */
function bareItemsAdderId(ref) {
  const id = (ref.attrs.id ?? "").toLowerCase();
  const bare = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return ITEMSADDER_ID_ALIASES[bare] ?? bare;
}

// ---------------------------------------------------------------------------
// Output categories
// ---------------------------------------------------------------------------

/**
 * Ordered rules mapping an output item id to the section heading its recipe is
 * filed under on the station page. First match wins. This is purely
 * presentational: Block/Copper/Forester would otherwise render 129/118/117
 * undifferentiated cards in one list.
 */
const CATEGORY_RULES = [
  [/_horse_armor$|^saddle$|^lead$/, () => "Mount Gear"],
  [/_spawn_egg$/, () => "Spawn Eggs"],
  [/wool/, () => "Wool"],
  [/^marauder_/, () => "Currency"],
  [/^brush$/, () => "Tools"],
  [/^blindfold_helmet$/, () => "Armour"],
  [/^writable_book$/, () => "Books"],
  [
    /^(pedestal|artifact_display|lure|voting_booth|tool_shelf|frying_pan|saucepan|pot|cutting_board|butter_churn|butter_plate|plate|bowl|deck|archeology_cabinet)$/,
    () => "Furniture & Utensils",
  ],
  [
    /^(quartz|amethyst_shard|amethyst_cluster|heavy_core|glow_ink_sac|slime_ball|blaze_rod|glowstone_dust|flint|coal|bone|raw_gold|gunpowder|arrow|string)$/,
    () => "Materials",
  ],
  [/^mythril_block|^train_track$/, () => "Blocks & Building"],
  [/^waxed_(exposed|weathered|oxidized)_/, (m) => `Waxed ${titleCase(m[1])} Copper`],
  [/^waxed_/, () => "Waxed Copper"],
  [/^(exposed|weathered|oxidized)_/, (m) => `${titleCase(m[1])} Copper`],
  [/copper|^lightning_rod$/, () => "Copper"],
  [/_dye$/, () => "Dyes"],
  [/concrete/, () => "Concrete"],
  [/coral/, () => "Coral"],
  [/sculk/, () => "Sculk"],
  [/froglight|lantern|^redstone_lamp$|^sea_lantern$|^shroomlight$|^end_rod$/, () => "Light Sources"],
  [/_leaves$|^leaf_litter$/, () => "Leaves"],
  [/_log$|_stem$|_wood$|_planks?$|^bamboo_block$|^stripped_bamboo_block$|^bookshelf$/, () => "Logs & Planks"],
  [/mushroom|fungus|moss|nylium|mycelium|^resin_clump$|wart/, () => "Fungi, Moss & Nether Growth"],
  [
    /grass|fern|bush|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily|eyeblossom|rose|sunflower|lilac|peony|pitcher_plant|torchflower|cactus_flower|petals|wildflowers|blossom|dripleaf|vine|roots|seagrass|sea_pickle|sprouts|chorus_flower|glow_lichen|azalea/,
    () => "Plants & Flowers",
  ],
  [/^(dirt|podzol|mud|packed_mud|rooted_dirt|gravel|sand|red_sand|clay|terracotta|grass_block|soul_sand|soul_soil)$/, () => "Earth & Sediment"],
  [/ice$|^snow_block$/, () => "Ice & Snow"],
  [/nether|blackstone|basalt|^end_stone$|purpur|netherite/, () => "Nether & End"],
  [/^bee_nest$|^beehive$|^honey/, () => "Bees & Honey"],
  [
    /_block$|^bricks$|prismarine|^cobblestone$|^andesite$|^granite$|^diorite$|^calcite$|^tuff$|^quartz_block$|^reinforced_deepslate$|^crying_obsidian$|^lodestone$|^scaffolding$|dripstone|^bell$|^cobweb$|^sea_lantern$/,
    () => "Blocks & Building",
  ],
];

/** MMOItems `type` -> section heading, for the map-form outputs. */
const MMOITEM_TYPE_CATEGORIES = {
  ARMORS: "Armour",
  BOOKS: "Books",
  CONSUMABLES: "Consumables",
  CURRENCY: "Currency",
  FISHING_RODS: "Fishing Rods",
  INSTRUMENTS: "Instruments",
  KEYS: "Keys",
  LOCKPICKS: "Lockpicks",
  LOOT: "Loot",
  LUTES: "Instruments",
  MATERIALS: "Materials",
  MEDICINES: "Medicines",
  PETS: "Pet Supplies",
  RESEARCH: "Research",
  SURGERY: "Surgery",
  TOOLS: "Tools",
  UTILS: "Utilities",
};

function categoryFor(ref) {
  if (ref.kind === "mmoitem" && MMOITEM_TYPE_CATEGORIES[ref.attrs.type]) {
    return MMOITEM_TYPE_CATEGORIES[ref.attrs.type];
  }
  const id =
    ref.kind === "vanilla"
      ? (ref.attrs.type ?? "").toLowerCase()
      : ref.kind === "itemsadder"
        ? bareItemsAdderId(ref)
        : (ref.attrs.id ?? "").toLowerCase();
  for (const [pattern, label] of CATEGORY_RULES) {
    const m = id.match(pattern);
    if (m) return label(m);
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function refIdentity(ref) {
  if (ref.kind === "vanilla") return `vanilla:${(ref.attrs.type ?? "").toLowerCase()}`;
  if (ref.kind === "mmoitem") return `mmoitem:${ref.attrs.type}:${ref.attrs.id}`;
  // ItemsAdder ids may carry a pack namespace or not; both name the same item.
  if (ref.kind === "itemsadder") return `itemsadder:${bareItemsAdderId(ref)}`;
  return `${ref.kind}:${(ref.attrs.id ?? "").toLowerCase()}`;
}

/** Normalises `output:`, which is either a ref string or a `{type,id,amount}` map. */
function outputRef(value) {
  if (typeof value === "string") return parseRef(value);
  if (value && typeof value === "object") {
    return { kind: "mmoitem", attrs: { type: value.type, id: value.id, amount: value.amount } };
  }
  return null;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) return [value];
  return [];
}

/**
 * Turns `conditions` into the player-facing `requirement` string. Only
 * `permission{...}` (label taken from `display`) and `class{list=...}` appear
 * in these files; nothing else in `conditions` is rendered.
 */
function requirementFor(conditions) {
  const labels = [];
  for (const raw of conditions) {
    const ref = parseRef(raw);
    if (!ref) continue;
    if (ref.kind === "permission" && ref.attrs.display) {
      labels.push(stripColours(ref.attrs.display).replace(/^Requires\s+/i, ""));
    } else if (ref.kind === "class" && ref.attrs.list) {
      labels.push(CLASS_REQUIREMENT_LABELS[ref.attrs.list] ?? `${ref.attrs.list} class`);
    }
  }
  return labels.length ? [...new Set(labels)].join(" + ") : undefined;
}

export function build({
  sourceDir,
  textureIndex,
  items = new Map(),
  nameTextureIndex = new Map(),
  itemsAdder = new Map(),
  mmoItemsTextures = new Map(),
}) {
  const files = readdirSync(sourceDir).filter((f) => f.endsWith(".yml")).sort();
  const parsed = [];
  const unparsed = [];
  for (const file of files) {
    const result = parseStationRecipes(readFileSync(path.join(sourceDir, file), "utf8"));
    for (const u of result.unparsed) unparsed.push({ file, ...u });
    parsed.push({ file, recipes: result.recipes });
  }

  // Pass 1: collect every `display=` seen on an ingredient, keyed by item
  // identity. Map-form outputs carry no display name; this recovers the real
  // name for the ones that also appear as an ingredient somewhere.
  const displayByIdentity = new Map();
  for (const { recipes } of parsed) {
    for (const r of recipes) {
      for (const raw of asList(r.fields.ingredients)) {
        const ref = parseRef(raw);
        if (!ref?.attrs.display) continue;
        const id = refIdentity(ref);
        if (!displayByIdentity.has(id)) displayByIdentity.set(id, stripColours(ref.attrs.display));
      }
    }
  }

  // Name precedence: the `display=` written on this very reference, then the
  // item config's own name, then a `display=` the same item carries somewhere
  // else, then a title-cased id as a last resort.
  const nameFor = (ref) => {
    if (ref.attrs.display) return stripColours(ref.attrs.display);
    if (ref.kind === "mmoitem") {
      const configured = items.get(ref.attrs.id)?.name;
      if (configured) return configured;
    }
    if (ref.kind === "itemsadder") {
      const configured = itemsAdder.get(bareItemsAdderId(ref))?.name;
      if (configured) return configured;
    }
    const recovered = displayByIdentity.get(refIdentity(ref));
    if (recovered) return recovered;
    return titleCase(ref.kind === "vanilla" ? ref.attrs.type ?? "" : ref.attrs.id ?? "");
  };

  const vanillaTexture = (type) => {
    if (!type) return undefined;
    const lower = type.toLowerCase();
    const direct = `vanilla/${lower}.png`;
    if (existsSync(path.join(TEXTURE_ROOT, direct))) return `/wiki/textures/${direct}`;
    // Waxed-copper alias: Minecraft's own item models prove waxed copper is
    // pixel-identical to its unwaxed counterpart at the same oxidation stage
    // -- e.g. assets/minecraft/items/waxed_copper_bulb.json points its
    // "model" straight at "minecraft:block/copper_bulb", no separate waxed
    // sprite exists in the client at all. So when a `waxed_*` vanilla type
    // has no dedicated file (because none was ever extracted, and none ever
    // will be), fall back to the unwaxed sprite instead of leaving the slot
    // untextured. The direct lookup above still wins if a real `waxed_*.png`
    // is ever added, so this can never mask a genuine dedicated sprite.
    if (lower.startsWith("waxed_")) {
      const unwaxed = `vanilla/${lower.slice("waxed_".length)}.png`;
      if (existsSync(path.join(TEXTURE_ROOT, unwaxed))) return `/wiki/textures/${unwaxed}`;
    }
    return undefined;
  };

  // Texture precedence: a sprite named after the item id, then -- for MMOItems
  // items only -- the sprite of the vanilla item it is built on -- and
  // finally, the wiki's own display-name -> texture catalogue (see
  // `buildMaterialNameTextureIndex`), for the common case where a custom
  // item's id has no matching sprite filename but its display name is already
  // catalogued by hand. This last fallback never overrides a texture already
  // found above.
  const textureFor = (ref, name) => {
    if (ref.kind === "vanilla") return vanillaTexture(ref.attrs.type);
    // MMOItems custom-model-data is authoritative. The base material is only a
    // carrier for that model and must not masquerade as the item's real icon.
    if (ref.kind === "mmoitem") {
      const exact = mmoItemsTextures.get(ref.attrs.id)?.texture;
      if (exact && existsSync(path.join(TEXTURE_ROOT, exact))) return `/wiki/textures/${exact}`;
    }
    if (ref.kind === "itemsadder") {
      const item = itemsAdder.get(bareItemsAdderId(ref));
      const extracted = item?.texture;
      if (extracted && existsSync(path.join(TEXTURE_ROOT, extracted))) return `/wiki/textures/${extracted}`;
      // Blockbench furniture models expose UV atlases rather than inventory
      // sprites. In that case the configured carrier material is the truthful
      // lightweight fallback; presenting the atlas as an icon is misleading.
      const carrier = vanillaTexture(item?.material);
      if (carrier) return carrier;
    }
    const own = textureIndex.byName.get(`${(ref.attrs.id ?? "").toLowerCase()}.png`);
    if (own) return own;
    const byName = nameTextureIndex.get(name);
    if (byName) return byName;
    if (ref.kind === "mmoitem") {
      const material = vanillaTexture(items.get(ref.attrs.id)?.material);
      if (material) return material;
    }
    return undefined;
  };

  const slot = (ref) => {
    const name = nameFor(ref);
    const texture = textureFor(ref, name);
    const qty = Number(ref.attrs.amount ?? 1) || 1;
    return { name, qty, sourceId: refIdentity(ref), ...(texture ? { texture } : {}) };
  };

  const recipes = [];
  const stats = { slots: 0, textured: 0, badRefs: [] };
  for (const { file, recipes: fileRecipes } of parsed) {
    const station = STATION_NAME_BY_FILE[file];
    if (!station) throw new Error(`No station name mapped for ${file}. Add it to STATION_NAME_BY_FILE.`);
    const fileSlug = file.replace(/\.yml$/, "");
    for (const r of fileRecipes) {
      const output = outputRef(r.fields.output);
      if (!output) { stats.badRefs.push(`${file}:${r.key} output`); continue; }
      const ingredients = [];
      for (const raw of asList(r.fields.ingredients)) {
        const ref = parseRef(raw);
        if (!ref) { stats.badRefs.push(`${file}:${r.key} ingredient "${raw}"`); continue; }
        ingredients.push(slot(ref));
      }
      const outputSlot = slot(output);
      stats.slots += ingredients.length + 1;
      stats.textured += ingredients.filter((s) => s.texture).length + (outputSlot.texture ? 1 : 0);

      const requirement = requirementFor(asList(r.fields.conditions));
      const time = Number(r.fields["crafting-time"]);
      recipes.push({
        key: `gen-${fileSlug}-${r.key}`,
        title: outputSlot.name,
        station,
        ...(Number.isFinite(time) ? { time } : {}),
        ...(requirement ? { requirement } : {}),
        category: categoryFor(output),
        ingredients,
        output: outputSlot,
      });
    }
  }
  return { recipes, unparsed, stats };
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function serialiseSlot(s) {
  const parts = [`name: ${JSON.stringify(s.name)}`, `qty: ${s.qty}`];
  if (s.sourceId) parts.push(`sourceId: ${JSON.stringify(s.sourceId)}`);
  if (s.texture) parts.push(`texture: ${JSON.stringify(s.texture)}`);
  return `{ ${parts.join(", ")} }`;
}

export function serialise(recipes) {
  const body = recipes
    .map((r) => {
      const lines = [
        `    key: ${JSON.stringify(r.key)},`,
        `    title: ${JSON.stringify(r.title)},`,
        `    station: ${JSON.stringify(r.station)},`,
      ];
      if (r.time !== undefined) lines.push(`    time: ${r.time},`);
      if (r.requirement) lines.push(`    requirement: ${JSON.stringify(r.requirement)},`);
      lines.push(`    category: ${JSON.stringify(r.category)},`);
      lines.push(`    ingredients: [${r.ingredients.map(serialiseSlot).join(", ")}],`);
      lines.push(`    output: ${serialiseSlot(r.output)},`);
      return `  {\n${lines.join("\n")}\n  },`;
    })
    .join("\n");

  return [
    "/**",
    " * GENERATED FILE -- DO NOT EDIT BY HAND.",
    " *",
    " * Produced by `frontend/scripts/build-station-recipes.mjs` from the MMOItems",
    " * crafting-station YAML configs (`plugins/MMOItems/crafting-stations/*.yml`),",
    " * which live on the server, outside this repository.",
    " *",
    " * To change anything here, change the server config and re-run:",
    " *   node scripts/build-station-recipes.mjs <path-to-crafting-stations>",
    " *",
    " * A slot's `texture` is set only when that sprite actually exists under",
    " * `public/wiki/textures`; otherwise it is omitted and CraftingGrid falls back",
    " * to rendering the item name as text. No slot here carries a 3D `model`.",
    " */",
    "",
    'import type { Recipe } from "../types";',
    "",
    "export const generatedStationRecipes: Recipe[] = [",
    body,
    "];",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const sourceDir = process.argv[2] ?? DEFAULT_SOURCE_DIR;
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    console.error(
      `\nbuild-station-recipes: source directory not found:\n  ${sourceDir}\n\n` +
        "The MMOItems crafting-station YAML files live outside this repository.\n" +
        "Pass the directory explicitly:\n" +
        "  node scripts/build-station-recipes.mjs <path-to-MMOItems/crafting-stations>\n"
    );
    process.exit(1);
  }

  const itemDir = process.argv[3] ?? path.join(sourceDir, "..", "item");
  const items = buildItemIndex(itemDir);
  if (!items.size) {
    console.warn(
      `build-station-recipes: no MMOItems item configs at ${itemDir}; ` +
        "output names will fall back to title-cased item ids, and custom items " +
        "will lose the vanilla sprite they are built on."
    );
  }

  const textureIndex = buildTextureIndex();
  const nameTextureIndex = buildMaterialNameTextureIndex(
    path.join(FRONTEND_ROOT, "app", "wiki", "data", "materials.ts")
  );
  if (nameTextureIndex.ambiguous.size) {
    console.log(
      `Ambiguous display names skipped (materials.ts): ${[...nameTextureIndex.ambiguous].sort().join(", ")}`
    );
  }
  const itemsAdder = buildItemsAdderIndex(ITEMSADDER_MANIFEST);
  if (!itemsAdder.size) {
    console.warn(
      `build-station-recipes: no ItemsAdder manifest at ${ITEMSADDER_MANIFEST}; ` +
        "`itemsadder{...}` slots will lose their sprites and fall back to title-cased ids. " +
        "Re-create it with scripts/extract-itemsadder-textures.mjs."
    );
  }
  const mmoItemsTextures = buildMmoItemsTextureIndex(MMOITEMS_MANIFEST);
  if (!mmoItemsTextures.size) {
    console.warn(
      `build-station-recipes: no MMOItems texture manifest at ${MMOITEMS_MANIFEST}; ` +
        "custom-model-data items will fall back to their configured base material. " +
        "Re-create it with scripts/extract-itemsadder-textures.mjs."
    );
  }
  const { recipes, unparsed, stats } = build({
    sourceDir,
    textureIndex,
    items,
    nameTextureIndex: nameTextureIndex.byName,
    itemsAdder,
    mmoItemsTextures,
  });

  if (unparsed.length) {
    console.error(`Unparsed lines (${unparsed.length}):`);
    for (const u of unparsed.slice(0, 20)) console.error(`  ${u.file}:${u.line} ${u.text}`);
    process.exit(1);
  }
  if (stats.badRefs.length) {
    console.error(`Unparseable item refs (${stats.badRefs.length}): ${stats.badRefs.join(", ")}`);
    process.exit(1);
  }

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, serialise(recipes), "utf8");

  const perStation = new Map();
  for (const r of recipes) perStation.set(r.station, (perStation.get(r.station) ?? 0) + 1);
  console.log(`Generated ${recipes.length} recipes from ${sourceDir}`);
  for (const [station, count] of [...perStation].sort()) console.log(`  ${station}: ${count}`);
  console.log(
    `Texture coverage: ${stats.textured}/${stats.slots} slots ` +
      `(${((stats.textured / stats.slots) * 100).toFixed(1)}%)`
  );
  if (textureIndex.ambiguous.size) {
    console.log(`Ambiguous texture basenames skipped: ${[...textureIndex.ambiguous].sort().join(", ")}`);
  }
}
