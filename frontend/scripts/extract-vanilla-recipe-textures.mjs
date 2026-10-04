/**
 * Copies missing vanilla recipe icons from an official Minecraft client jar.
 * Item models are followed to their real item/block texture, so block outputs
 * use a source selected by Minecraft's model rather than a filename guess.
 *
 *   node scripts/extract-vanilla-recipe-textures.mjs [client.jar] [crafting-stations]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { buildItemIndex, parseRef, parseStationRecipes } from "./build-station-recipes.mjs";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_JAR = "C:/Users/MSI/AppData/Roaming/.minecraft/versions/1.21.10/1.21.10.jar";
const DEFAULT_STATIONS = "C:/Users/MSI/Desktop/plugins/MMOItems/crafting-stations";
const OUTPUT_DIR = path.join(FRONTEND_ROOT, "public", "wiki", "textures", "vanilla");
const MANIFEST = path.join(FRONTEND_ROOT, "app", "wiki", "data", "generated", "vanillaRecipeTextures.json");
const ITEMSADDER_MANIFEST = path.join(FRONTEND_ROOT, "app", "wiki", "data", "generated", "itemsadderItems.json");
const decoder = new TextDecoder();

function collectVanillaTypes(stationsDir, itemDir) {
  const counts = new Map();
  const items = buildItemIndex(itemDir);
  const addType = (type) => {
    if (!type) return;
    const key = type.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const add = (ref) => {
    if (ref?.kind === "vanilla") addType(ref.attrs.type);
    else if (ref?.kind === "mmoitem") addType(items.get(ref.attrs.id)?.material);
  };
  for (const file of readdirSync(stationsDir).filter((name) => name.endsWith(".yml")).sort()) {
    const { recipes } = parseStationRecipes(readFileSync(path.join(stationsDir, file), "utf8"));
    for (const recipe of recipes) {
      const ingredients = Array.isArray(recipe.fields.ingredients)
        ? recipe.fields.ingredients
        : typeof recipe.fields.ingredients === "string" ? [recipe.fields.ingredients] : [];
      for (const raw of ingredients) add(parseRef(raw));
      if (typeof recipe.fields.output === "string") add(parseRef(recipe.fields.output));
      else if (recipe.fields.output && typeof recipe.fields.output === "object") {
        addType(items.get(recipe.fields.output.id)?.material);
      }
    }
  }
  if (existsSync(ITEMSADDER_MANIFEST)) {
    const manifest = JSON.parse(readFileSync(ITEMSADDER_MANIFEST, "utf8"));
    for (const item of Object.values(manifest)) addType(item?.material);
  }
  return counts;
}

function splitRef(ref, fallbackNamespace = "minecraft") {
  const colon = ref.indexOf(":");
  return colon === -1
    ? { namespace: fallbackNamespace, relative: ref }
    : { namespace: ref.slice(0, colon), relative: ref.slice(colon + 1) };
}

function readModel(files, ref, seen = new Set()) {
  const { namespace, relative } = splitRef(ref);
  const key = `assets/${namespace}/models/${relative}.json`;
  if (seen.has(key) || !files[key]) return { textures: {} };
  seen.add(key);
  let model;
  try { model = JSON.parse(decoder.decode(files[key])); }
  catch { return { textures: {} }; }
  const parent = typeof model.parent === "string" ? readModel(files, model.parent, seen) : { textures: {} };
  return {
    modelEntry: key,
    textures: {
      ...parent.textures,
      ...(model.textures && typeof model.textures === "object" ? model.textures : {}),
    },
  };
}

function resolveVariable(textures, key) {
  let value = textures[key];
  const seen = new Set();
  while (typeof value === "string" && value.startsWith("#")) {
    const next = value.slice(1);
    if (seen.has(next)) return null;
    seen.add(next);
    value = textures[next];
  }
  return typeof value === "string" ? value : null;
}

function resolveVanillaTexture(files, type) {
  let model = readModel(files, `minecraft:item/${type}`);
  if (!model.modelEntry) {
    const itemEntry = `assets/minecraft/items/${type}.json`;
    if (files[itemEntry]) {
      let definition;
      try { definition = JSON.parse(decoder.decode(files[itemEntry])); }
      catch { definition = null; }
      const findModel = (node) => {
        if (!node || typeof node !== "object") return null;
        if (node.type === "minecraft:model" && typeof node.model === "string") return node.model;
        if (node.type === "minecraft:special" && typeof node.base === "string") return node.base;
        if (node.fallback) {
          const fallback = findModel(node.fallback);
          if (fallback) return fallback;
        }
        for (const value of Object.values(node)) {
          const nested = findModel(value);
          if (nested) return nested;
        }
        return null;
      };
      const modelRef = findModel(definition?.model);
      if (modelRef) model = readModel(files, modelRef);
    }
  }
  const keys = ["layer0", "all", "side", "top", "front", "particle", ...Object.keys(model.textures).sort()]
    .filter((key, index, all) => all.indexOf(key) === index);
  for (const key of keys) {
    const textureRef = resolveVariable(model.textures, key);
    if (!textureRef) continue;
    const { namespace, relative } = splitRef(textureRef);
    const entry = `assets/${namespace}/textures/${relative}.png`;
    if (files[entry]) return { bytes: files[entry], modelEntry: model.modelEntry, textureEntry: entry };
  }
  return null;
}

const jar = process.argv[2] ?? DEFAULT_JAR;
const stationsDir = process.argv[3] ?? DEFAULT_STATIONS;
const itemDir = process.argv[4] ?? path.join(stationsDir, "..", "item");
for (const [label, source] of [["client jar", jar], ["crafting stations", stationsDir]]) {
  if (!existsSync(source) || (label === "crafting stations" && !statSync(source).isDirectory())) {
    console.error(`extract-vanilla-recipe-textures: ${label} not found: ${source}`);
    process.exit(1);
  }
}

const files = unzipSync(new Uint8Array(readFileSync(jar)));
const referenced = collectVanillaTypes(stationsDir, itemDir);
const manifest = {};
const unresolved = [];
let copied = 0;
let existing = 0;
await mkdir(OUTPUT_DIR, { recursive: true });
for (const [type, count] of [...referenced].sort(([a], [b]) => a.localeCompare(b))) {
  const dest = path.join(OUTPUT_DIR, `${type}.png`);
  if (existsSync(dest)) {
    existing += 1;
    const resolved = resolveVanillaTexture(files, type);
    const exactJarBytes = resolved && Buffer.compare(readFileSync(dest), Buffer.from(resolved.bytes)) === 0;
    manifest[type] = exactJarBytes
      ? {
          texture: `vanilla/${type}.png`,
          sourceJar: path.basename(jar),
          sourceModel: resolved.modelEntry,
          sourceTexture: resolved.textureEntry,
        }
      : { texture: `vanilla/${type}.png`, source: "existing checked-in asset" };
    continue;
  }
  const resolved = resolveVanillaTexture(files, type);
  if (!resolved) {
    unresolved.push({ type, references: count, reason: "item model has no resolvable texture" });
    continue;
  }
  await writeFile(dest, resolved.bytes);
  copied += 1;
  manifest[type] = {
    texture: `vanilla/${type}.png`,
    sourceJar: path.basename(jar),
    sourceModel: resolved.modelEntry,
    sourceTexture: resolved.textureEntry,
  };
}
await writeFile(MANIFEST, `${JSON.stringify({ copied, existing, unresolved, items: manifest }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ referenced: referenced.size, copied, existing, unresolved }, null, 2));
