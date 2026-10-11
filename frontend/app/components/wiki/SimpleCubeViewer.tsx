"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { wikiBlockPreviewHeight } from "./wikiStyles";

export type CubeFaces = {
  up: string;
  down: string;
  north: string;
  south: string;
  east: string;
  west: string;
};

export default function SimpleCubeViewer({
  faces,
  variant = "full",
}: {
  faces: CubeFaces;
  /** "thumb" renders a small, non-interactive, borderless preview for use inside a crafting-grid slot. */
  variant?: "full" | "thumb";
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let frameId: number;
    let controls: OrbitControls | null = null;

    async function init() {
      const mount = mountRef.current;
      if (!mount) return;

      const width = mount.clientWidth;
      const height = mount.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 100);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      const texLoader = new THREE.TextureLoader();
      const loadTex = (url: string) =>
        new Promise<THREE.Texture | null>((resolve) => {
          texLoader.load(
            url,
            (tex) => {
              tex.magFilter = THREE.NearestFilter;
              tex.minFilter = THREE.NearestFilter;
              tex.colorSpace = THREE.SRGBColorSpace;
              resolve(tex);
            },
            undefined,
            () => resolve(null),
          );
        });

      // BoxGeometry material group order: px, nx, py, ny, pz, nz
      // Minecraft axes: +x=east, -x=west, +y=up, -y=down, +z=south, -z=north
      const [east, west, up, down, south, north] = await Promise.all([
        loadTex(faces.east),
        loadTex(faces.west),
        loadTex(faces.up),
        loadTex(faces.down),
        loadTex(faces.south),
        loadTex(faces.north),
      ]);
      if (disposed) return;

      const mkMat = (tex: THREE.Texture | null) =>
        new THREE.MeshLambertMaterial({ map: tex ?? undefined, color: tex ? 0xffffff : 0x88a088 });

      const materials = [east, west, up, down, south, north].map(mkMat);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, materials);
      scene.add(mesh);

      camera.position.set(1.3, 1.1, 1.3);
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
      controls.autoRotate = true;
      controls.autoRotateSpeed = variant === "thumb" ? 3 : 1.2;
      controls.minDistance = 0.8;
      controls.maxDistance = 4;
      if (variant === "thumb") {
        controls.enabled = false;
      }

      function animate() {
        frameId = requestAnimationFrame(animate);
        if (renderer && mount && mount.clientWidth > 0 && mount.clientHeight > 0) {
          const size = renderer.getSize(new THREE.Vector2());
          if (size.x !== mount.clientWidth || size.y !== mount.clientHeight) {
            camera.aspect = mount.clientWidth / mount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mount.clientWidth, mount.clientHeight, false);
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

      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }

    let cleanupResize: (() => void) | undefined;
    init()
      .then((cleanup) => {
        cleanupResize = cleanup;
      })
      .catch(() => {
        if (!disposed) setError("Could not load model.");
      });

    return () => {
      disposed = true;
      cleanupResize?.();
      if (frameId) cancelAnimationFrame(frameId);
      controls?.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [faces, variant]);

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
