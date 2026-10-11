"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createStationTextureAnimation,
  createStationTextureAtlasFallback,
  type TextureAnimationMetadata,
} from "./stationTextureAnimation";
import { wikiBlockPreviewHeight } from "./wikiStyles";

type Face = {
  uv: [number, number, number, number];
  texture: string;
  rotation?: 0 | 90 | 180 | 270;
};

type Element = {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { angle: number; axis: "x" | "y" | "z"; origin: [number, number, number] };
  faces: Partial<Record<"north" | "south" | "east" | "west" | "up" | "down", Face>>;
};

type BlockModel = {
  texture_size: [number, number];
  elements: Element[];
};

const faceOrder: Array<keyof Element["faces"]> = ["east", "west", "up", "down", "south", "north"];

export function textureMaterialIndices(faces: Element["faces"], textureKeys: string[]): number[] {
  return faceOrder.map((dir) => {
    const key = faces[dir]?.texture.replace(/^#/, "");
    return key ? textureKeys.indexOf(key) : -1;
  });
}

export function visibleFaceMaterialGroups(
  faces: Element["faces"],
  textureKeys: string[],
): Array<{ faceIndex: number; materialIndex: number }> {
  return textureMaterialIndices(faces, textureKeys).flatMap((materialIndex, faceIndex) =>
    faces[faceOrder[faceIndex]] ? [{ faceIndex, materialIndex }] : [],
  );
}

export async function loadTextureBindings<T>(
  urls: string[],
  load: (url: string) => Promise<T>,
): Promise<Array<T | null>> {
  const results = await Promise.allSettled(urls.map((url) => load(url)));
  return results.map((result) => (result.status === "fulfilled" ? result.value : null));
}

/** UV samples for Three's per-face vertex order: top-left, top-right, bottom-left, bottom-right. */
export function faceUvCoordinates(face: Face): Array<[number, number]> {
  const [u1, v1, u2, v2] = face.uv;
  const a = u1 / 16;
  const b = 1 - v1 / 16;
  const c = u2 / 16;
  const d = 1 - v2 / 16;
  const corners: Array<[number, number]> = [
    [a, b],
    [c, b],
    [a, d],
    [c, d],
  ];

  // Minecraft/Blockbench face rotations are clockwise. Preserve the original
  // corner values so reversed UV rectangles continue to mirror correctly.
  switch (face.rotation ?? 0) {
    case 90:
      return [corners[2], corners[0], corners[3], corners[1]];
    case 180:
      return [corners[3], corners[2], corners[1], corners[0]];
    case 270:
      return [corners[1], corners[3], corners[0], corners[2]];
    default:
      return corners;
  }
}

export function buildGeometryForElement(el: Element, textureKeys: string[]) {
  const [x1, y1, z1] = el.from;
  const [x2, y2, z2] = el.to;
  const sizeX = (x2 - x1) / 16;
  const sizeY = (y2 - y1) / 16;
  const sizeZ = (z2 - z1) / 16;
  const geo = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);

  // BoxGeometry face groups order: px, nx, py, ny, pz, nz
  const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute;

  faceOrder.forEach((dir, faceIdx) => {
    const face = el.faces[dir];
    const vertOffset = faceIdx * 4;
    if (!face) {
      for (let i = 0; i < 4; i++) uvAttr.setXY(vertOffset + i, 0, 0);
      return;
    }
    // Blockbench stores UV in the classic 0-16 grid regardless of texture_size :
    // texture_size only affects pixel snapping in the editor, not the exported UV scale.
    faceUvCoordinates(face).forEach(([u, v], corner) => {
      uvAttr.setXY(vertOffset + corner, u, v);
    });
  });
  uvAttr.needsUpdate = true;

  geo.clearGroups();
  visibleFaceMaterialGroups(el.faces, textureKeys).forEach(({ materialIndex, faceIndex }) => {
    // A zero-thickness box has coincident opposing faces (fish fins, string).
    // Rendering both DoubleSide makes their different UVs fight for the same
    // depth. Use FrontSide for that pair; lone sheets remain DoubleSide.
    const axis = Math.floor(faceIndex / 2);
    const opposite = faceOrder[faceIndex ^ 1];
    const pairedPlane = el.from[axis] === el.to[axis] && !!el.faces[opposite];
    const slot = materialIndex >= 0 ? materialIndex : textureKeys.length;
    // BoxGeometry emits two triangles (six indices) for every visible face.
    geo.addGroup(faceIndex * 6, 6, slot + (pairedPlane ? textureKeys.length + 1 : 0));
  });

  const cx = (x1 + x2) / 2 / 16;
  const cy = (y1 + y2) / 2 / 16;
  const cz = (z1 + z2) / 2 / 16;

  return { geo, center: new THREE.Vector3(cx, cy, cz) };
}

export default function StationModelViewer({
  modelUrl,
  textureUrl,
  textureUrls,
  textureAnimationUrl,
  variant = "full",
}: {
  modelUrl: string;
  textureUrl?: string;
  /** Texture bindings keyed like the model's `textures` object (without the leading #). */
  textureUrls?: Record<string, string>;
  textureAnimationUrl?: string;
  /** "thumb" renders a small, non-interactive, borderless preview for use inside a crafting-grid slot. */
  variant?: "full" | "thumb";
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    });
    observer.observe(mount);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let cleanedUp = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let frameId: number | undefined;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const loadedTextures = new Set<THREE.Texture>();
    const materials = new Set<THREE.MeshLambertMaterial>();
    const geometries = new Set<THREE.BufferGeometry>();
    const abortController = new AbortController();
    let removeResizeListener: (() => void) | undefined;

    setError(null);

    async function init() {
      const mount = mountRef.current;
      if (!mount) return;
      const mounted = mount;

      let model: BlockModel;
      try {
        const res = await fetch(modelUrl, { signal: abortController.signal });
        if (!res.ok) throw new Error("Could not load model.");
        model = await res.json();
      } catch {
        if (!disposed && !abortController.signal.aborted) setError("Could not load model.");
        return;
      }
      if (disposed) return;

      const width = mount.clientWidth;
      const height = mount.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 100);
      camera.position.set(1.6, 1.4, 1.6);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      // Recipe previews can grow from 40px to 176px without remounting. Keep the
      // drawing buffer dense enough that the expanded geometry is not an upscaled
      // thumbnail, including on 1x desktop displays.
      renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, 2), 3));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      const texLoader = new THREE.TextureLoader();
      const loadTexture = (url: string) =>
        new Promise<THREE.Texture>((resolve, reject) => {
          texLoader.load(url, resolve, undefined, reject);
        });
      const textureKeys = Object.keys(textureUrls ?? {});
      const [texture] = textureUrl ? await loadTextureBindings([textureUrl], loadTexture) : [null];
      const keyedTextures = await loadTextureBindings(
        textureKeys.map((key) => textureUrls![key]),
        loadTexture,
      );
      if (texture) loadedTextures.add(texture);
      keyedTextures.forEach((value) => {
        if (value) loadedTextures.add(value);
      });
      if (disposed) {
        loadedTextures.forEach((value) => value.dispose());
        loadedTextures.clear();
        return;
      }

      let textureFrame: ReturnType<typeof createStationTextureAnimation> | undefined;
      if (texture && textureAnimationUrl) {
        try {
          const response = await fetch(textureAnimationUrl, { signal: abortController.signal });
          if (!response.ok) throw new Error("Could not load texture animation.");
          const metadata: TextureAnimationMetadata = await response.json();
          const sourceImage = texture.image as HTMLImageElement;
          textureFrame = createStationTextureAnimation(sourceImage.width, sourceImage.height, metadata);
        } catch {
          if (disposed || abortController.signal.aborted) {
            return;
          }
          const sourceImage = texture.image as HTMLImageElement;
          textureFrame = createStationTextureAtlasFallback(sourceImage.width, sourceImage.height, model.texture_size);
        }
      }
      if (disposed) return;

      loadedTextures.forEach((value) => {
        value.magFilter = THREE.NearestFilter;
        value.minFilter = THREE.NearestFilter;
        value.generateMipmaps = false;
        value.colorSpace = THREE.SRGBColorSpace;
      });

      const makeMaterial = (map: THREE.Texture | null) => {
        const value = new THREE.MeshLambertMaterial({
          map: map ?? undefined,
          color: map ? 0xffffff : 0x88a088,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.3,
        });
        materials.add(value);
        return value;
      };
      const fallbackMaterial = makeMaterial(texture);
      const keyedMaterials = keyedTextures.map((value) => (value ? makeMaterial(value) : fallbackMaterial));
      const doubleSidedMaterials = [...keyedMaterials, fallbackMaterial];
      const frontSidedMaterials = doubleSidedMaterials.map((source) => {
        const value = source.clone();
        value.side = THREE.FrontSide;
        materials.add(value);
        return value;
      });
      // Always use the groups, including for single-texture models: a scalar
      // material draws the entire box, including faces absent from the model.
      const meshMaterials = [...doubleSidedMaterials, ...frontSidedMaterials];

      const group = new THREE.Group();

      for (const el of model.elements) {
        const { geo, center } = buildGeometryForElement(el, textureKeys);
        geometries.add(geo);
        const mesh = new THREE.Mesh(geo, meshMaterials);
        // An inverted box (from > to) is the Blockbench trick for interior faces, e.g. the inside of
        // an open crate, and usually coincides exactly with its outer box. Pull it in a hair so the
        // outer faces win from outside and the two shells do not z-fight.
        if (el.from.some((value, axis) => value > el.to[axis])) mesh.scale.setScalar(0.995);

        if (el.rotation && el.rotation.angle) {
          const origin = new THREE.Vector3(...el.rotation.origin).multiplyScalar(1 / 16);
          const axis =
            el.rotation.axis === "x"
              ? new THREE.Vector3(1, 0, 0)
              : el.rotation.axis === "y"
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
          const rad = (el.rotation.angle * Math.PI) / 180;

          const pivot = new THREE.Object3D();
          pivot.position.copy(origin);
          pivot.rotateOnAxis(axis, rad);
          mesh.position.copy(center).sub(origin);
          pivot.add(mesh);
          group.add(pivot);
        } else {
          mesh.position.copy(center);
          group.add(mesh);
        }
      }

      // Center the group around its bounding box.
      const box = new THREE.Box3().setFromObject(group);
      const boxCenter = box.getCenter(new THREE.Vector3());
      group.position.sub(boxCenter);
      scene.add(group);

      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.5);
      camera.position.set(maxDim * 1.3, maxDim * 1.1, maxDim * 1.3);
      camera.lookAt(0, 0, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(3, 5, 2);
      scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
      dir2.position.set(-3, 2, -2);
      scene.add(dir2);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      controls.autoRotate = !reducedMotion;
      controls.autoRotateSpeed = variant === "thumb" ? 3 : 1.2;
      controls.minDistance = maxDim * 0.6;
      controls.maxDistance = maxDim * 4;
      if (variant === "thumb") {
        controls.enabled = false;
      }

      const animationStarted = performance.now();
      function animate() {
        frameId = requestAnimationFrame(animate);
        if (texture && textureFrame) {
          const frame = textureFrame(reducedMotion ? 0 : performance.now() - animationStarted);
          texture.repeat.set(frame.repeatX, frame.repeatY);
          texture.offset.set(frame.offsetX, frame.offsetY);
        }
        if (renderer && mounted.clientWidth > 0 && mounted.clientHeight > 0) {
          const currentSize = renderer.getSize(new THREE.Vector2());
          if (currentSize.x !== mounted.clientWidth || currentSize.y !== mounted.clientHeight) {
            camera.aspect = mounted.clientWidth / mounted.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mounted.clientWidth, mounted.clientHeight, false);
          }
        }
        controls?.update();
        if (renderer) renderer.render(scene, camera);
      }
      animate();

      function handleResize() {
        if (!mount || !renderer) return;
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      window.addEventListener("resize", handleResize);
      removeResizeListener = () => window.removeEventListener("resize", handleResize);
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(mount);
      }
    }

    void init().catch(() => {
      if (!disposed) setError("Could not display 3D preview.");
    });

    return () => {
      if (cleanedUp) return;
      cleanedUp = true;
      disposed = true;
      abortController.abort();
      removeResizeListener?.();
      resizeObserver?.disconnect();
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      controls?.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      geometries.clear();
      materials.forEach((value) => value.dispose());
      materials.clear();
      loadedTextures.forEach((value) => value.dispose());
      loadedTextures.clear();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        renderer = null;
      }
    };
  }, [modelUrl, textureUrl, textureUrls, textureAnimationUrl, variant, visible]);

  if (variant === "thumb") {
    return (
      <div
        ref={mountRef}
        className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[var(--tfmc-forest)] shadow-none transition-[width,height,background-color,box-shadow] duration-200 [&>canvas]:!h-full [&>canvas]:!w-full group-hover:h-44 group-hover:w-44 group-hover:rounded-md group-hover:border group-hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] group-hover:shadow-2xl group-focus:h-44 group-focus:w-44 group-focus:rounded-md group-focus:border group-focus:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] group-focus:shadow-2xl motion-reduce:transition-none sm:h-10 sm:w-10"
      >
        {error ? (
          <span className="absolute inset-0 flex items-center justify-center text-[8px] text-[var(--tfmc-mist)]">
            :
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className={`relative w-full overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)] ${wikiBlockPreviewHeight}`}
    >
      {error ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-[var(--tfmc-mist)]">{error}</p>
      ) : null}
    </div>
  );
}
