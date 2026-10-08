"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildModelBuffers,
  applySkinUvs,
  referencedTextureKeys,
  resolveTextureUrls,
  type WikiBlockModel,
} from "./modelGeometry";

export interface WikiModelViewerProps {
  /** `M("vehicles/small_car.json")`: a vanilla-style block model. */
  modelUrl: string;
  /** Texture-only face mappings applied to the canonical model. */
  skinUvUrl?: string;
  /**
   * Texture key -> URL, e.g. `{ "0": T("vehicles/small_car/0.png") }`. Keys match the
   * `#0` / `#1` variables the model's faces reference. Required for any model with
   * more than one texture.
   */
  textures?: Record<string, string>;
  /** Single-texture shorthand, used when every face samples the same PNG. */
  textureUrl?: string;
  /** Accessible name for the canvas. */
  label: string;
  /** Height of the frame. */
  height?: "sm" | "md" | "lg";
  className?: string;
}

const HEIGHTS = {
  sm: "h-48 sm:h-56",
  md: "h-64 sm:h-80",
  lg: "h-80 sm:h-[26rem]",
} as const;

/**
 * A three.js preview of a vanilla-style block model, with two capabilities
 * `StationModelViewer` does not have and vehicle models require:
 *
 * 1. **Multiple textures.** The model's `textures` map is resolved into a material
 *    array, so each face samples the PNG its `#key` names.
 * 2. **Merged geometry.** Faces are flattened into one `BufferGeometry` per material
 *    rather than one `Mesh` per element. The Behemoth is 498 elements; without this
 *    it would be 498 draw calls.
 *
 * It builds a renderer near the viewport and pauses rendering off-screen.
 * Each mounted viewer still holds a context: galleries should mount only the
 * selected model, as the vehicle detail page does.
 *
 * `StationModelViewer` is deliberately left alone; the four station models keep
 * rendering through the code they already render through.
 */
export default function WikiModelViewer({
  modelUrl,
  skinUvUrl,
  textures,
  textureUrl,
  label,
  height = "md",
  className,
}: WikiModelViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  // Only start loading once the frame is near the viewport.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    observer.observe(mount);
    return () => observer.disconnect();
  }, []);

  // `visible` drives the render loop without re-running the expensive init effect.
  const visibleRef = useRef(false);
  visibleRef.current = visible;

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (visible) setStarted(true);
  }, [visible]);

  useEffect(() => {
    if (!started) return;
    setReady(false);
    setError(null);

    let disposed = false;
    let frameId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let cleanupResize: (() => void) | undefined;
    const disposables: Array<{ dispose: () => void }> = [];

    async function init() {
      const mount = mountRef.current;
      if (!mount) return;

      let model: WikiBlockModel;
      try {
        const res = await fetch(modelUrl);
        if (!res.ok) throw new Error(String(res.status));
        model = await res.json();
        if (skinUvUrl) {
          const skinResponse = await fetch(skinUvUrl);
          if (!skinResponse.ok) throw new Error(String(skinResponse.status));
          model = applySkinUvs(model, await skinResponse.json());
        }
      } catch {
        if (!disposed) setError("Could not load this model.");
        return;
      }
      if (disposed || !Array.isArray(model.elements) || !model.elements.length) {
        if (!disposed) setError("Preview unavailable.");
        return;
      }

      // ---- materials, one per referenced texture key ----
      const keys = referencedTextureKeys(model);
      const urls = resolveTextureUrls(keys, textures, textureUrl);

      const loader = new THREE.TextureLoader();
      const byUrl = new Map<string, Promise<THREE.Texture | null>>();
      const loaded = await Promise.all(
        urls.map(async (url) => {
          if (!url) return null;
          const cached = byUrl.get(url);
          if (cached !== undefined) return cached;
          const pending = new Promise<THREE.Texture | null>((resolve) => {
            loader.load(
              url,
              (t) => resolve(t),
              undefined,
              () => resolve(null),
            );
          }).then((tex) => {
            if (tex) {
              tex.magFilter = THREE.NearestFilter;
              tex.minFilter = THREE.NearestFilter;
              tex.colorSpace = THREE.SRGBColorSpace;
              disposables.push(tex);
            }
            return tex;
          });
          byUrl.set(url, pending);
          return pending;
        }),
      );
      if (disposed) {
        for (const d of disposables) d.dispose();
        return;
      }

      const materials = loaded.map(
        (tex) =>
          new THREE.MeshLambertMaterial({
            map: tex ?? undefined,
            color: tex ? 0xffffff: 0x8ea58e,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.3,
          }),
      );
      for (const m of materials) disposables.push(m);

      const slotOf = new Map(keys.map((k, i) => [k, i] as const));
      const buffers = buildModelBuffers(model, materials.length, (textureKey) => {
        if (!textureKey) return -1;
        const bare = textureKey.startsWith("#") ? textureKey.slice(1): textureKey;
        return slotOf.get(bare) ?? -1;
      });

      const group = new THREE.Group();
      buffers.forEach((buf, i) => {
        if (!buf.index.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(buf.position, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(buf.normal, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uv, 2));
        geo.setIndex(buf.index);
        disposables.push(geo);
        group.add(new THREE.Mesh(geo, materials[i]));
      });

      if (!group.children.length) {
        for (const d of disposables) d.dispose();
        if (!disposed) setError("Preview unavailable.");
        return;
      }

      const box = new THREE.Box3().setFromObject(group);
      group.position.sub(box.getCenter(new THREE.Vector3()));

      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.5);

      const width = mount.clientWidth || 1;
      const heightPx = mount.clientHeight || 1;

      const scene = new THREE.Scene();
      scene.add(group);
      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(3, 5, 2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.6);
      fill.position.set(-3, 2, -2);
      scene.add(fill);

      const camera = new THREE.PerspectiveCamera(45, width / heightPx, 0.05, maxDim * 20);
      // Fit the bounding sphere in the narrower field of view, including phones.
      const halfFov = Math.atan(Math.tan(Math.PI / 8) * Math.min(1, width / heightPx));
      const distance = size.length() / 2 / Math.sin(halfFov) * 1.1;
      camera.position.copy(new THREE.Vector3(1.1, 0.8, 1.1).normalize().multiplyScalar(distance));
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, heightPx);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("aria-label", `3D preview of ${label}`);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.2;
      controls.minDistance = maxDim * 0.4;
      controls.maxDistance = maxDim * 5;

      if (!disposed) setReady(true);

      const localRenderer = renderer;
      const localControls = controls;
      function animate() {
        frameId = requestAnimationFrame(animate);
        // Off-screen frames cost nothing: the context stays alive, the loop idles.
        if (!visibleRef.current) return;
        localControls.update();
        localRenderer.render(scene, camera);
      }
      animate();

      function handleResize() {
        const el = mountRef.current;
        if (!el) return;
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        localRenderer.setSize(w, h);
      }
      window.addEventListener("resize", handleResize);
      cleanupResize = () => window.removeEventListener("resize", handleResize);
    }

    void init().catch(() => {
      if (!disposed) {
        setReady(false);
        setError("3D preview is unavailable on this device.");
      }
    });

    return () => {
      disposed = true;
      cleanupResize?.();
      if (frameId) cancelAnimationFrame(frameId);
      controls?.dispose();
      // The existing station viewer leaks geometries, materials and textures on
      // unmount; this one does not.
      for (const d of disposables) d.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };
  }, [started, modelUrl, skinUvUrl, textures, textureUrl, label]);

  return (
    <div
      ref={mountRef}
      className={[
        "relative w-full overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)]",
        HEIGHTS[height],
        className ?? "",
      ].join(" ")}
    >
      {error ? (
        <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-[var(--tfmc-mist)]">
          {error}
        </p>
      ): !ready ? (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-[var(--tfmc-mist)]">
          Loading {label}&hellip;
        </p>
      ): null}
    </div>
  );
}
