import * as THREE from "three";
import { MODEL_WORKSPACE_ORIGIN } from "./javaModel";

const ALPHA_CUTOFF = 16; // ~ItemModelGenerator threshold (out of 255)
const DEPTH = 1; // model units (1/16 block)

type Quad = {
  positions: number[];
  uvs: number[];
  indices: number[];
};

function pushQuad(out: Quad, corners: [number, number, number][], uvCorners: [number, number][], flip = false): void {
  const base = out.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    out.positions.push(...corners[i]!);
    out.uvs.push(...uvCorners[i]!);
  }
  if (flip) {
    out.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  } else {
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/**
 * Extrude an item PNG into a thin Minecraft-style generated item mesh.
 * Geometry always spans the 16×16 model face (32×32 = finer pixels, same size).
 */
export function buildExtrudedItemGroup(
  imageData: ImageData,
  texture: THREE.Texture,
  options?: { center?: boolean },
): THREE.Group {
  const center = options?.center !== false;
  const tw = imageData.width;
  const th = imageData.height;
  if (tw < 1 || th < 1) {
    throw new Error("Texture has no pixels");
  }

  const data = imageData.data;
  const opaque = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= tw || y >= th) return false;
    return data[(y * tw + x) * 4 + 3]! > ALPHA_CUTOFF;
  };

  const scaleX = 16 / tw;
  const scaleY = 16 / th;
  const z0 = 7.5; // centered in 16-deep cube like generated items
  const z1 = z0 + DEPTH;

  const quads: Quad = { positions: [], uvs: [], indices: [] };

  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      if (!opaque(px, py)) continue;

      // Model space: +Y up, texture row 0 at top → high Y
      const x0 = px * scaleX;
      const x1 = (px + 1) * scaleX;
      const y1 = 16 - py * scaleY;
      const y0 = 16 - (py + 1) * scaleY;
      const u0 = px / tw;
      const u1 = (px + 1) / tw;
      // flipY=false: image row 0 (top) is at V=0 — do not invert V.
      const vTop = py / th;
      const vBot = (py + 1) / th;
      // Edge faces: pin all corners to texel center so NearestFilter
      // never samples a neighbor (boundary UVs look fuzzy / half-transparent).
      const uC = (px + 0.5) / tw;
      const vC = (py + 0.5) / th;
      const edgeUv: [number, number][] = [
        [uC, vC],
        [uC, vC],
        [uC, vC],
        [uC, vC],
      ];

      // Front (+Z)
      pushQuad(
        quads,
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [
          [u0, vBot],
          [u1, vBot],
          [u1, vTop],
          [u0, vTop],
        ],
      );
      // Back (−Z)
      pushQuad(
        quads,
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
        [
          [u1, vBot],
          [u0, vBot],
          [u0, vTop],
          [u1, vTop],
        ],
      );

      // Edges where neighbor is transparent
      if (!opaque(px - 1, py)) {
        pushQuad(
          quads,
          [
            [x0, y0, z0],
            [x0, y0, z1],
            [x0, y1, z1],
            [x0, y1, z0],
          ],
          edgeUv,
        );
      }
      if (!opaque(px + 1, py)) {
        pushQuad(
          quads,
          [
            [x1, y0, z1],
            [x1, y0, z0],
            [x1, y1, z0],
            [x1, y1, z1],
          ],
          edgeUv,
        );
      }
      if (!opaque(px, py + 1)) {
        // below in texture = lower Y
        pushQuad(
          quads,
          [
            [x0, y0, z1],
            [x1, y0, z1],
            [x1, y0, z0],
            [x0, y0, z0],
          ],
          edgeUv,
        );
      }
      if (!opaque(px, py - 1)) {
        pushQuad(
          quads,
          [
            [x0, y1, z0],
            [x1, y1, z0],
            [x1, y1, z1],
            [x0, y1, z1],
          ],
          edgeUv,
        );
      }
    }
  }

  if (quads.positions.length === 0) {
    throw new Error("Texture has no opaque pixels");
  }

  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // UVs: image row 0 (top) → V=0
  texture.needsUpdate = true;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(quads.positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(quads.uvs, 2));
  geo.setIndex(quads.indices);
  geo.computeVertexNormals();

  // Cutout (not blended transparency) — blended alpha makes thin sides look fuzzy.
  // DoubleSide: edge winding varies by silhouette; FrontSide culls some faces by angle.
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: false,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "extrudedItemMesh";

  const content = new THREE.Group();
  content.name = "extrudedItemContent";
  content.add(mesh);

  const root = new THREE.Group();
  root.name = "extrudedItem";
  root.add(content);

  if (center) {
    const box = new THREE.Box3().setFromObject(content);
    const mid = box.getCenter(new THREE.Vector3());
    content.position.sub(mid);
  } else {
    content.position.set(...MODEL_WORKSPACE_ORIGIN);
  }

  return root;
}

/** Load PNG File → ImageData + THREE.Texture for extrusion. */
export async function loadImageDataFromFile(file: File): Promise<{ imageData: ImageData; texture: THREE.Texture }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load item PNG"));
      img.src = url;
    });
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not read item PNG");
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    return { imageData, texture };
  } finally {
    URL.revokeObjectURL(url);
  }
}
