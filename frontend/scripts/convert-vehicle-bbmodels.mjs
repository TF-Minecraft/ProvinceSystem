/**
 * One-off asset converter: ModelEngine `.bbmodel` -> wiki block-model JSON + PNGs.
 *
 * Vehicles on this server are ModelEngine rigs. The `.bbmodel` project file is the
 * only usable source: ModelEngine's own generated resource pack emits one JSON per
 * *bone*, each in its own local space with no bone offset baked in, so loading them
 * produces disconnected fragments.
 *
 * What this does, per vehicle:
 *   1. Base64-decodes every embedded `textures[].source` to a PNG under
 *      public/wiki/textures/vehicles/<id>/. Identical PNGs inside one model are
 *      de-duplicated by content hash (several texture slots share one image).
 *   2. Preserves the complete static outliner hierarchy, including Blockbench 5's
 *      separate groups table. Pivots are absolute model coordinates; rotations
 *      compose from the cube through its ancestors using Blockbench's ZYX order.
 *      Animation keyframes are not the rest pose and are never applied.
 *   3. Rescales each face from its texture slot's declared `uv_width` / `uv_height`
 *      to the viewer's 0-16 grid. Slots in one project can use different UV grids.
 *   4. Resolves the integer `faces[].texture` index into a `#<id>` variable keyed by
 *      the texture's own `id`, so a model that keys its texture "1" instead of "0"
 *      round-trips correctly. Faces with no texture assigned are dropped.
 *   5. Converts the bbmodel `[rx, ry, rz]` Euler + `origin` into
 *      `rotation: { origin, euler }`. Multi-axis rotation is preserved (the vanilla
 *      single-axis `{ angle, axis, origin }` form is still what the four station
 *      models use, and the viewer reads both).
 *   6. Drops animations, the outliner, and non-exported / invisible elements
 *      (ModelEngine uses those for hitboxes and mount points).
 *
 * Read-only against C:\Users\MSI\Desktop\plugins. Run from `frontend/`:
 *   node scripts/convert-vehicle-bbmodels.mjs
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const BLUEPRINTS = "C:/Users/MSI/Desktop/plugins/ModelEngine/blueprints";
const OUT_MODELS = join(FRONTEND, "public", "wiki", "models", "vehicles");
const OUT_TEXTURES = join(FRONTEND, "public", "wiki", "textures", "vehicles");

/** vehicle id -> path under plugins\ModelEngine\blueprints, without the extension. */
export const VEHICLES = {
  aa_turret: "aa_turret",
  anti_air: "anti_air",
  behemoth: "vehicles/airships/behemoth",
  biplane: "biplane",
  bomber: "bomber",
  cloudskimmer: "cloudskimmer",
  coal_car: "vehicles/trains/coal_car",
  cruiser: "cruiser",
  field_artillery: "field_artillery",
  fixed_artillery: "fixed_artillery",
  gunboat: "gunboat",
  gyrobomber: "gyrobomber",
  horse_cart: "vehicles/land/horse_cart",
  ironclad: "ironclad",
  monoplane: "monoplane",
  passenger_car: "vehicles/trains/passenger_car",
  simple_locomotive: "simple_locomotive",
  sloop: "sloop",
  small_car: "vehicles/land/small_car",
  torpedoboat: "torpedoboat",
  wooden_cart: "vehicles/land/wooden_cart",
};

const FACE_DIRS = ["north", "south", "east", "west", "up", "down"];

// These configured plane skins have blueprint assets. The other eleven
// configured variants are intentionally represented as unavailable in the wiki.
export const SKINS = {};
for (const plane of ["biplane", "monoplane"]) {
  for (const suffix of ["black", "chinese", "purple", "revenor", "domenia", "sabarissa", "sabarissa_brown", "pirate"]) {
    SKINS[`${plane}_${suffix}`] = plane;
  }
}

function round(n) {
  // 4dp keeps the files small without moving a vertex by anything visible.
  return Math.round(n * 10000) / 10000;
}

export function convert(id, relPath, baseId, paths = {}) {
  const blueprints = paths.blueprintsDir ?? BLUEPRINTS;
  const outModels = paths.modelsDir ?? OUT_MODELS;
  const outTextures = paths.texturesDir ?? OUT_TEXTURES;
  const texturePrefix = paths.texturePrefix ?? "vehicles";
  const src = join(blueprints, `${relPath}.bbmodel`);
  if (!existsSync(src)) return { id, missing: true };

  const bb = JSON.parse(readFileSync(src, "utf8"));
  const base = baseId ? JSON.parse(readFileSync(join(blueprints, `${VEHICLES[baseId]}.bbmodel`), "utf8")) : bb;
  const resW = bb.resolution?.width || 16;
  const resH = bb.resolution?.height || 16;

  const parentRotations = new Map();
  const excluded = new Set();
  const groups = new Map((bb.groups || []).map((group) => [group.uuid, group]));
  function indexOutliner(nodes, ancestors = [], hidden = false) {
    for (const node of nodes || []) {
      if (typeof node === "string") {
        parentRotations.set(node, [...ancestors].reverse());
        if (hidden) excluded.add(node);
        continue;
      }
      const group = { ...groups.get(node.uuid), ...node };
      const rotation = Array.isArray(group.rotation) && group.rotation.some((angle) => angle)
        ? { origin: (group.origin || [0, 0, 0]).map(round), euler: group.rotation.map(round), order: "ZYX" }
        : null;
      indexOutliner(node.children, rotation ? [...ancestors, rotation] : ancestors,
        hidden || group.export === false || group.visibility === false);
    }
  }
  indexOutliner(bb.outliner);

  // ---- textures ----
  mkdirSync(join(outTextures, id), { recursive: true });
  const byHash = new Map();
  /** array index -> { key, file } */
  const slots = [];
  const textures = {};

  bb.textures.forEach((tex, index) => {
    const key = String(tex.id ?? index);
    const base64 = String(tex.source || "").split(",")[1];
    if (!base64) {
      slots[index] = null;
      return;
    }
    const buf = Buffer.from(base64, "base64");
    const hash = createHash("sha1").update(buf).digest("hex");
    const baseTexture = baseId ? base.textures.find((item) => String(item.id) === key) : null;
    if (baseTexture && (baseTexture.uv_width !== tex.uv_width || baseTexture.uv_height !== tex.uv_height)) {
      throw new Error(`${id}: texture #${key} has an incompatible UV grid`);
    }
    let file = byHash.get(hash);
    if (!file) {
      file = `${key}.png`;
      writeFileSync(join(outTextures, id, file), buf);
      byHash.set(hash, file);
    }
    slots[index] = {
      key,
      file,
      uvWidth: tex.uv_width || resW,
      uvHeight: tex.uv_height || resH,
    };
    textures[key] = baseTexture?.source === tex.source
      ? `${texturePrefix}/${baseId}/${key}.png`
      : `${texturePrefix}/${id}/${file}`;
  });

  // `particle` is metadata only -- it may point at a different PNG than any visible
  // face. Record it so the data layer can supply it, but never let a face fall back
  // to it silently.
  const particleIndex = bb.textures.findIndex((t) => t.particle);
  if (particleIndex >= 0 && slots[particleIndex]) {
    textures.particle = `${texturePrefix}/${id}/${slots[particleIndex].file}`;
  }

  // ---- elements ----
  const elements = [];
  let skipped = 0;
  let multiAxis = 0;
  let facesDropped = 0;

  for (const el of bb.elements) {
    // Locators are attachment points, without visible geometry.
    if (el.type === "locator") {
      skipped++;
      continue;
    }
    if ((el.type || "cube") !== "cube") {
      throw new Error(`${id}: unsupported element type ${el.type}; refusing to publish an incomplete model`);
    }
    // ModelEngine hides hitbox / mount-point cubes; they are not part of the shape.
    if (el.export === false || el.visibility === false || excluded.has(el.uuid)) {
      skipped++;
      continue;
    }
    const from = el.from.map(round);
    const to = el.to.map(round);
    if (from.every((v, i) => v === to[i])) {
      skipped++;
      continue;
    }

    const faces = {};
    for (const dir of FACE_DIRS) {
      const face = el.faces?.[dir];
      if (!face || !Array.isArray(face.uv)) continue;
      const slot = typeof face.texture === "number" ? slots[face.texture] : null;
      if (!slot) {
        facesDropped++;
        continue;
      }
      const [u1, v1, u2, v2] = face.uv;
      const out = {
        uv: [
          round((u1 * 16) / slot.uvWidth),
          round((v1 * 16) / slot.uvHeight),
          round((u2 * 16) / slot.uvWidth),
          round((v2 * 16) / slot.uvHeight),
        ],
        texture: `#${slot.key}`,
      };
      if (face.rotation) out.rotation = face.rotation;
      faces[dir] = out;
    }
    if (!Object.keys(faces).length) {
      skipped++;
      continue;
    }

    const out = { sourceUuid: el.uuid, from, to, faces };
    const rot = el.rotation;
    if (Array.isArray(rot) && rot.some((a) => a)) {
      if (rot.filter((a) => a).length > 1) multiAxis++;
      out.rotation = {
        origin: (el.origin || [0, 0, 0]).map(round),
        euler: rot.map(round),
        order: "ZYX",
      };
    }
    const inherited = parentRotations.get(el.uuid);
    if (inherited?.length) out.parentRotations = inherited;
    elements.push(out);
  }

  mkdirSync(outModels, { recursive: true });
  if (baseId) {
    // A skin may change UV placement, but never supplies vertices or bones.
    // UUID matching keeps texture overrides tied to the canonical base cubes.
    const canonical = JSON.parse(readFileSync(join(outModels, `${baseId}.json`), "utf8"));
    const byUuid = new Map(elements.map((element) => [element.sourceUuid, element]));
    const faces = {};
    for (const element of canonical.elements) {
      const variant = byUuid.get(element.sourceUuid);
      if (!variant || JSON.stringify(variant.from) !== JSON.stringify(element.from) || JSON.stringify(variant.to) !== JSON.stringify(element.to)) {
        throw new Error(`${id}: skin cannot be mapped to base cube ${element.sourceUuid}`);
      }
      if (JSON.stringify(variant.faces) !== JSON.stringify(element.faces)) faces[element.sourceUuid] = variant.faces;
    }
    writeFileSync(join(outModels, `${id}.json`), JSON.stringify({ baseModel: baseId, faces }));
  } else {
    const json = { texture_size: [resW, resH], textures, elements };
    writeFileSync(join(outModels, `${id}.json`), JSON.stringify(json));
  }

  return {
    id,
    elements: elements.length,
    skipped,
    multiAxis,
    facesDropped,
    textures,
    pngs: byHash.size,
    baseId: baseId || id,
  };
}

export function main() {
const requested = new Set(process.argv.slice(2));
for (const id of requested) {
  if (!(id in VEHICLES) && !(id in SKINS)) throw new Error(`Unknown vehicle or skin: ${id}`);
}
const report = [];
for (const [id, relPath] of Object.entries(VEHICLES)) {
  if (requested.size && !requested.has(id)) continue;
  report.push(convert(id, relPath));
}
for (const [id, baseId] of Object.entries(SKINS)) {
  if (requested.size && !requested.has(id)) continue;
  report.push(convert(id, id, baseId));
}

for (const r of report) {
  if (r.missing) {
    console.log(`${r.id.padEnd(20)} MISSING .bbmodel`);
    continue;
  }
  console.log(
    `${r.id.padEnd(20)} elements=${String(r.elements).padStart(3)} skipped=${String(
      r.skipped,
    ).padStart(3)} multiAxisRot=${r.multiAxis} facesWithoutTexture=${r.facesDropped} pngs=${r.pngs} keys=${Object.keys(r.textures).join(",")}`,
  );
}

// Emit the `textures` literal for each vehicle so app/wiki/data/vehicles.ts never has
// to guess a key or a filename.
console.log("\n--- paste-ready texture maps (values go through T()) ---");
for (const r of report) {
  if (r.missing) continue;
  const entries = Object.entries(r.textures)
    .map(([k, v]) => `${JSON.stringify(k)}: T(${JSON.stringify(v)})`)
    .join(", ");
  console.log(`${r.id}: { ${entries} },`);
}
const cataloguePath = join(OUT_MODELS, "catalogue.json");
const previous = requested.size && existsSync(cataloguePath) ? JSON.parse(readFileSync(cataloguePath, "utf8")) : {};
for (const result of report) delete previous[result.id];
writeFileSync(cataloguePath, JSON.stringify({ ...previous, ...Object.fromEntries(report.filter((r) => !r.missing).map((r) => [r.id, {
  modelUrl: `/wiki/models/vehicles/${r.baseId}.json`,
  ...(r.id !== r.baseId ? { skinUvUrl: `/wiki/models/vehicles/${r.id}.json` } : {}),
  textures: Object.fromEntries(Object.entries(r.textures).map(([key, path]) => [key, `/wiki/textures/${path}`])),
}])) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
