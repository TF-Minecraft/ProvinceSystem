/**
 * Pure geometry maths for `WikiModelViewer`, kept out of the component so it can be
 * unit-tested without a WebGL context.
 *
 * Everything here works on the vanilla-Minecraft block-model shape: `elements[]` with
 * `from`/`to` in 0-16 pixel space and per-face `uv` on the 0-16 grid.
 */

/** The six cube faces, in vanilla block-model naming. */
export const FACE_DIRS = ["east", "west", "up", "down", "south", "north"] as const;

export type FaceDir = (typeof FACE_DIRS)[number];

export type ModelFace = {
  uv: [number, number, number, number];
  /** `"#0"`, `"#1"`, ...: a key into the model's `textures` map. */
  texture?: string;
  /** Clockwise texture rotation in degrees: 0 | 90 | 180 | 270. */
  rotation?: number;
};

export type ModelElementRotation = {
  origin: [number, number, number];
  /** Vanilla single-axis form. */
  angle?: number;
  axis?: "x" | "y" | "z";
  /**
   * Extended multi-axis form, in degrees. Emitted by
   * `scripts/convert-vehicle-bbmodels.mjs` because six vehicle models rotate
   * elements on two axes at once and the vanilla form cannot express that.
   */
  euler?: [number, number, number];
  /** Blockbench free models use ZYX; other models default to XYZ. */
  order?: "XYZ" | "ZYX";
};

export type ModelElement = {
  sourceUuid?: string;
  from: [number, number, number];
  to: [number, number, number];
  rotation?: ModelElementRotation;
  /** Parent-bone rotations, ordered from the nearest parent outwards. */
  parentRotations?: ModelElementRotation[];
  faces: Partial<Record<FaceDir, ModelFace>>;
};

export type WikiBlockModel = {
  texture_size?: [number, number];
  /** Texture key -> an opaque identifier. Only the *keys* matter to the viewer. */
  textures?: Record<string, string>;
  elements: ModelElement[];
};

/** Only texture coordinates/material slots can vary; geometry stays canonical. */
export type ModelSkinUvs = { faces: Record<string, ModelElement["faces"]> };
export function applySkinUvs(model: WikiBlockModel, skin: ModelSkinUvs): WikiBlockModel {
  return { ...model, elements: model.elements.map((element) => ({
    ...element,
    faces: (element.sourceUuid && skin.faces[element.sourceUuid]) || element.faces,
  })) };
}

/**
 * Corner positions and normal for each face, in the exact vertex order
 * `THREE.BoxGeometry` uses, so UVs written for that layout keep working.
 *
 * Each corner is a sign triple `[sx, sy, sz]` selecting the min (-1) or max (+1)
 * bound on that axis. Vertex order is (uv 0,1), (1,1), (0,0), (1,0).
 */
const FACE_CORNERS: Record<FaceDir, { normal: [number, number, number]; corners: [number, number, number][] }> = {
  east: {
    normal: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, -1],
    ],
  },
  west: {
    normal: [-1, 0, 0],
    corners: [
      [-1, 1, -1],
      [-1, 1, 1],
      [-1, -1, -1],
      [-1, -1, 1],
    ],
  },
  up: {
    normal: [0, 1, 0],
    corners: [
      [-1, 1, -1],
      [1, 1, -1],
      [-1, 1, 1],
      [1, 1, 1],
    ],
  },
  down: {
    normal: [0, -1, 0],
    corners: [
      [-1, -1, 1],
      [1, -1, 1],
      [-1, -1, -1],
      [1, -1, -1],
    ],
  },
  south: {
    normal: [0, 0, 1],
    corners: [
      [-1, 1, 1],
      [1, 1, 1],
      [-1, -1, 1],
      [1, -1, 1],
    ],
  },
  north: {
    normal: [0, 0, -1],
    corners: [
      [1, 1, -1],
      [-1, 1, -1],
      [1, -1, -1],
      [-1, -1, -1],
    ],
  },
};

/** Triangle winding within one face, matching `THREE.BoxGeometry`. */
const FACE_INDICES = [0, 2, 1, 2, 3, 1] as const;

/**
 * Vertex slots in clockwise order around the quad: top-left, top-right,
 * bottom-right, bottom-left.
 */
const CLOCKWISE = [0, 1, 3, 2] as const;

/**
 * The four UV pairs for one face, in vertex order, with `face.rotation` applied.
 *
 * A vanilla `rotation` turns the *texture* clockwise, which means the UV each vertex
 * samples moves counter-clockwise by the same amount.
 */
export function faceUvs(face: ModelFace): [number, number][] {
  const [u1, v1, u2, v2] = face.uv;
  const a = u1 / 16;
  const b = 1 - v1 / 16;
  const c = u2 / 16;
  const d = 1 - v2 / 16;
  const base: [number, number][] = [
    [a, b],
    [c, b],
    [a, d],
    [c, d],
  ];

  const steps = (((Math.round((face.rotation ?? 0) / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  if (steps === 0) return base;

  const out: [number, number][] = [base[0], base[1], base[2], base[3]];
  for (let i = 0; i < 4; i++) {
    out[CLOCKWISE[i]] = base[CLOCKWISE[(i - steps + 4) % 4]];
  }
  return out;
}

/** Degrees to radians. */
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Row-major-free 3x3 rotation applied to a vector, built from an element's
 * `rotation`. Returns the identity when there is no rotation.
 */
function rotationMatrix(rotation: ModelElementRotation | undefined): number[] | null {
  if (!rotation) return null;

  if (rotation.euler) {
    const [rx, ry, rz] = rotation.euler.map(rad);
    if (!rx && !ry && !rz) return null;
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    if (rotation.order === "ZYX") {
      return [
        cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz,
        cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz,
        -sy, sx * cy, cx * cy,
      ];
    }
    // THREE.Euler default order "XYZ": R = Rx * Ry * Rz applied as m = Rx·Ry·Rz.
    return [
      cy * cz,
      -cy * sz,
      sy,
      cx * sz + sx * sy * cz,
      cx * cz - sx * sy * sz,
      -sx * cy,
      sx * sz - cx * sy * cz,
      sx * cz + cx * sy * sz,
      cx * cy,
    ];
  }

  if (!rotation.angle || !rotation.axis) return null;
  const t = rad(rotation.angle);
  const c = Math.cos(t);
  const s = Math.sin(t);
  if (rotation.axis === "x") return [1, 0, 0, 0, c, -s, 0, s, c];
  if (rotation.axis === "y") return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function applyMatrix(m: number[] | null, x: number, y: number, z: number): [number, number, number] {
  if (!m) return [x, y, z];
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/** Flat vertex buffers for one material, ready to hand to a `BufferGeometry`. */
export type MaterialBuffers = {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
};

/**
 * Flatten a whole model into one buffer set **per material**, so a 499-element
 * airship becomes at most a handful of draw calls instead of 499 meshes.
 *
 * `materialIndexFor` maps a face's `texture` key (`"#0"` -> `"0"`) to a slot in the
 * caller's material array; returning `-1` drops the face.
 *
 * Positions come out in block units (the 0-16 pixel space divided by 16).
 */
export function buildModelBuffers(
  model: WikiBlockModel,
  materialCount: number,
  materialIndexFor: (textureKey: string | undefined) => number,
): MaterialBuffers[] {
  const out: MaterialBuffers[] = [];
  for (let i = 0; i < materialCount; i++) {
    out.push({ position: [], normal: [], uv: [], index: [] });
  }

  for (const el of model.elements ?? []) {
    const [x1, y1, z1] = el.from;
    const [x2, y2, z2] = el.to;
    const half: [number, number, number] = [(x2 - x1) / 32, (y2 - y1) / 32, (z2 - z1) / 32];
    const center: [number, number, number] = [(x1 + x2) / 32, (y1 + y2) / 32, (z1 + z2) / 32];

    const rotations = [el.rotation, ...(el.parentRotations ?? [])].filter(
      (rotation): rotation is ModelElementRotation => Boolean(rotation),
    );

    for (const dir of FACE_DIRS) {
      const face = el.faces?.[dir];
      if (!face) continue;
      const slot = materialIndexFor(face.texture);
      if (slot < 0 || slot >= materialCount) continue;

      const buf = out[slot];
      const base = buf.position.length / 3;
      const { normal, corners } = FACE_CORNERS[dir];
      const uvs = faceUvs(face);

      let [nx, ny, nz] = normal;
      for (const rotation of rotations) {
        [nx, ny, nz] = applyMatrix(rotationMatrix(rotation), nx, ny, nz);
      }

      for (let i = 0; i < 4; i++) {
        const [sx, sy, sz] = corners[i];
        let px = center[0] + sx * half[0];
        let py = center[1] + sy * half[1];
        let pz = center[2] + sz * half[2];
        for (const rotation of rotations) {
          const origin = rotation.origin.map((coordinate) => coordinate / 16) as [number, number, number];
          const rotated = applyMatrix(rotationMatrix(rotation), px - origin[0], py - origin[1], pz - origin[2]);
          [px, py, pz] = [rotated[0] + origin[0], rotated[1] + origin[1], rotated[2] + origin[2]];
        }
        buf.position.push(px, py, pz);
        buf.normal.push(nx, ny, nz);
        buf.uv.push(uvs[i][0], uvs[i][1]);
      }
      for (const i of FACE_INDICES) buf.index.push(base + i);
    }
  }

  return out;
}

/**
 * Every distinct texture key referenced by a model's faces, in first-seen order.
 * Keys are returned without the leading `#`.
 */
export function referencedTextureKeys(model: WikiBlockModel): string[] {
  const seen: string[] = [];
  for (const el of model.elements ?? []) {
    for (const dir of FACE_DIRS) {
      const key = el.faces?.[dir]?.texture;
      if (!key) continue;
      const bare = key.startsWith("#") ? key.slice(1): key;
      if (!seen.includes(bare)) seen.push(bare);
    }
  }
  return seen;
}

/**
 * Resolve each referenced texture key to a URL.
 *
 * The quirks this exists to absorb, all seen in real assets on this server:
 * - a model may key its only texture `"1"` (or `"1".."5"`) rather than `"0"`;
 * - `particle` often points at a *different* PNG than any visible face, so it is
 *   only ever a last-resort fallback;
 * - several keys can share one PNG, which is fine. They collapse to one material.
 *
 * Returns `null` for a key with no usable URL; the caller drops those faces.
 */
export function resolveTextureUrls(
  keys: string[],
  textures: Record<string, string> | undefined,
  fallbackUrl?: string,
): (string | null)[] {
  const map = textures ?? {};
  const firstVisible = Object.entries(map).find(([k, v]) => k !== "particle" && !!v)?.[1];
  return keys.map((key) => map[key] ?? fallbackUrl ?? firstVisible ?? map.particle ?? null);
}
