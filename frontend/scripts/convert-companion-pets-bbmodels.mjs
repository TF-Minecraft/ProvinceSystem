/**
 * Export static wiki previews from the pet .bbmodel sources, without changing them.
 * Run from frontend/: node scripts/convert-companion-pets-bbmodels.mjs <source-directory>
 * Reuses the vehicle converter's texture, UV and bone hierarchy handling.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "./convert-vehicle-bbmodels.mjs";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new Error("Pass the directory containing the pet .bbmodel files.");

const modelsDir = join(frontend, "public/wiki/models/companion-pets");
const texturesDir = join(frontend, "public/wiki/textures/companion-pets");
const catalogue = {};
const files = readdirSync(sourceDirectory).filter((file) => file.endsWith(".bbmodel")).sort();
if (!files.length) throw new Error("No pet .bbmodel files found.");

for (const file of files) {
  const id = file.slice(0, -".bbmodel".length);
  const source = JSON.parse(readFileSync(join(sourceDirectory, file), "utf8"));
  for (const element of source.elements) {
    for (const face of Object.values(element.faces ?? {})) {
      // Untextured hitboxes and helper cubes are deliberately invisible.
      if (face.texture != null && !source.textures[face.texture]?.source?.startsWith("data:image/png;base64,")) {
        throw new Error(`${id}: a face references a missing embedded texture.`);
      }
    }
  }
  const result = convert(id, id, undefined, {
    blueprintsDir: sourceDirectory,
    modelsDir,
    texturesDir,
    texturePrefix: "companion-pets",
  });
  if (result.missing || !result.elements) {
    throw new Error(`${id}: missing model geometry or textures.`);
  }
  catalogue[id] = {
    modelUrl: `/wiki/models/companion-pets/${id}.json`,
    textures: Object.fromEntries(Object.entries(result.textures)
      .map(([key, path]) => [key, `/wiki/textures/${path}`])),
  };
  console.log(`${id}: ${result.elements} cubes, ${result.pngs} textures`);
}
writeFileSync(join(modelsDir, "catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
