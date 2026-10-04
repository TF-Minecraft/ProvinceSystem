import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripColours } from "./build-station-recipes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Archaeology descriptions come from the gameplay guide, not item tooltips.
const supersededLore = new Set(["HAND_PICK", "POINTING_TROWEL", "MATTOCK", "GRAFTING_SPADE", "BREAKER_PICK", "SPOIL_SHOVEL", "ARCHAEO_TRACKER", "ARCHAEO_PROSPECT", "ARCHAEO_ESTABLISH", "ARCHAEO_PENCIL"]);
export function parseItemDescriptions(text, type, used) {
  const descriptions = {};
  let identity;
  let inLore = false;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^([A-Z0-9_]+):(?:\s*#.*)?\s*$/);
    if (head) { identity = `mmoitem:${type.toUpperCase()}:${head[1]}`; inLore = false; }
    else if (/^\S/.test(line) && !line.startsWith("#")) { identity = undefined; inLore = false; }
    if (/^ {4}lore:\s*$/.test(line)) { inLore = true; continue; }
    if (!inLore) continue;
    const entry = line.match(/^ {4}-\s*(.*)$/);
    if (!entry) { if (line.trim()) inLore = false; continue; }
    if (!used.has(identity) || supersededLore.has(identity.split(":").at(-1))) continue;
    // Multiline YAML scalars are omitted rather than publishing a truncated tooltip.
    if (/^['"]/.test(entry[1]) && !entry[1].endsWith(entry[1][0])) continue;
    const raw = entry[1].replace(/^(['"])(.*)\1$/, "$2");
    const text = stripColours(raw).replace(/&x/gi, "").replace(/<[^>]+>/g, "").replaceAll("''", "'").replaceAll("—", ",").trim();
    if (text) (descriptions[identity] ??= []).push(text);
  }
  return descriptions;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2] ?? "C:/Users/MSI/Desktop/plugins/MMOItems/item";
  const recipes = await readFile(path.join(root, "app/wiki/data/generated/stationRecipes.ts"), "utf8");
  const used = new Set([...recipes.matchAll(/sourceId: "(mmoitem:[^"]+)"/g)].map(match => match[1]));
  const descriptions = {};
  for (const file of (await readdir(source)).filter(file => file.endsWith(".yml")).sort()) {
    Object.assign(descriptions, parseItemDescriptions(await readFile(path.join(source, file), "utf8"), file.slice(0, -4), used));
  }
  await writeFile(path.join(root, "app/wiki/data/generated/itemDescriptions.json"), JSON.stringify(descriptions, null, 2) + "\n");
  console.log(`Wrote source lore for ${Object.keys(descriptions).length} recipe items.`);
}
