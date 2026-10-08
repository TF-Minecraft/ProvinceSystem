"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applyDisplayToObject, resolveDisplayTab } from "../../../lib/skins/displayTransform";
import {
  buildJavaModelGroup,
  disposeObject3D,
  loadTextureFromFile,
  parseJavaModelJson,
} from "../../../lib/skins/javaModel";
import {
  applySteveArmPose,
  attachSteveArmorOverlay,
  createSteveMannequin,
  inferArmModelFromTexture,
  loadSteveTexture,
  setArmorHelmetVisible,
  setSteveOuterLayerVisible,
  type SteveMannequin,
} from "../../../lib/skins/steveMannequin";

type Props = {
  layer1File: File | null;
  layer2File: File | null;
  helmet3d?: boolean;
  helmetModelFile?: File | null;
  helmetTextureFile?: File | null;
  className?: string;
};

type Status = "idle" | "loading" | "ready" | "error";

export default function ArmorPreview({
  layer1File,
  layer2File,
  helmet3d = false,
  helmetModelFile = null,
  helmetTextureFile = null,
  className = "",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const steveLiveRef = useRef<SteveMannequin | null>(null);
  const showOuterLayerRef = useRef(true);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [playerSkinFile, setPlayerSkinFile] = useState<File | null>(null);
  const [showOuterLayer, setShowOuterLayer] = useState(true);
  showOuterLayerRef.current = showOuterLayer;

  const hasLayers = Boolean(layer1File || layer2File);
  const use3dHelm =
    helmet3d && Boolean(helmetModelFile) && Boolean(helmetTextureFile);

  useEffect(() => {
    if (steveLiveRef.current) {
      setSteveOuterLayerVisible(steveLiveRef.current, showOuterLayer);
    }
  }, [showOuterLayer]);

  useEffect(() => {
    if (!hasLayers) {
      setStatus("idle");
      setError(null);
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let raf = 0;
    let steveRoot: SteveMannequin | null = null;
    let layer1Tex: THREE.Texture | null = null;
    let layer2Tex: THREE.Texture | null = null;
    let steveTexture: THREE.Texture | null = null;
    let helmetItemTex: THREE.Texture | null = null;
    let removeResize: (() => void) | null = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1c16);

    setStatus("loading");
    setError(null);
    host.replaceChildren();

    (async () => {
      try {
        if (layer1File) {
          layer1Tex = (await loadTextureFromFile(layer1File)).texture;
        }
        if (layer2File) {
          layer2Tex = (await loadTextureFromFile(layer2File)).texture;
        }
        if (cancelled) {
          layer1Tex?.dispose();
          layer2Tex?.dispose();
          return;
        }

        if (playerSkinFile) {
          steveTexture = (await loadTextureFromFile(playerSkinFile)).texture;
        } else {
          steveTexture = await loadSteveTexture();
        }
        if (cancelled) {
          steveTexture?.dispose();
          layer1Tex?.dispose();
          layer2Tex?.dispose();
          return;
        }

        const detected = inferArmModelFromTexture(steveTexture);
        steveRoot = createSteveMannequin(steveTexture, detected);
        applySteveArmPose(steveRoot, "idle");
        setSteveOuterLayerVisible(steveRoot, showOuterLayerRef.current);
        attachSteveArmorOverlay(steveRoot, layer1Tex, layer2Tex);
        setArmorHelmetVisible(steveRoot, !use3dHelm);
        steveLiveRef.current = steveRoot;

        if (use3dHelm && helmetModelFile && helmetTextureFile) {
          const modelText = await helmetModelFile.text();
          if (cancelled) return;
          const json = parseJavaModelJson(modelText);
          const loaded = await loadTextureFromFile(helmetTextureFile);
          helmetItemTex = loaded.texture;
          if (cancelled) {
            helmetItemTex.dispose();
            return;
          }
          const group = buildJavaModelGroup(
            json,
            helmetItemTex,
            loaded.width,
            loaded.height,
            { center: false }
          );
          const held = new THREE.Group();
          held.name = "heldHelmet3d";
          const tab = resolveDisplayTab(json, "head", "helmet_3d");
          applyDisplayToObject(held, tab);
          held.add(group);
          steveRoot.bones.itemSocketHead.add(held);
        }

        if (cancelled) {
          disposeObject3D(steveRoot);
          return;
        }

        const widthPx = host.clientWidth || 320;
        const heightPx = 240;

        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(widthPx, heightPx, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        host.replaceChildren(renderer.domElement);
        renderer.domElement.className = "h-full w-full touch-none";
        renderer.domElement.style.display = "block";

        const camera = new THREE.PerspectiveCamera(
          35,
          widthPx / heightPx,
          0.1,
          500
        );
        const focus = new THREE.Vector3(0, 14, 0);
        const frameSize = 32;
        camera.position.set(
          focus.x + frameSize * 1.4,
          focus.y + frameSize * 0.55,
          focus.z + frameSize * 1.6
        );
        camera.lookAt(focus);

        scene.add(steveRoot);
        scene.add(new THREE.AmbientLight(0xffffff, 1.1));

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.target.copy(focus);
        controls.update();

        const onResize = () => {
          if (!renderer || !host) return;
          const w = host.clientWidth || 320;
          const h = 240;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        };
        window.addEventListener("resize", onResize);
        removeResize = () => window.removeEventListener("resize", onResize);

        const tick = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(tick);
          controls?.update();
          renderer?.render(scene, camera);
        };
        tick();
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Preview failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      removeResize?.();
      controls?.dispose();
      steveLiveRef.current = null;
      if (steveRoot) {
        disposeObject3D(steveRoot);
      } else {
        layer1Tex?.dispose();
        layer2Tex?.dispose();
        steveTexture?.dispose();
        helmetItemTex?.dispose();
      }
      renderer?.dispose();
      host.replaceChildren();
    };
  }, [
    layer1File,
    layer2File,
    helmet3d,
    helmetModelFile,
    helmetTextureFile,
    playerSkinFile,
    use3dHelm,
    hasLayers,
  ]);

  if (!hasLayers) {
    return (
      <p className={`text-xs text-[var(--tfmc-mist)] ${className}`}>
        Upload a layer to preview.
      </p>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span className="text-sm font-medium text-[var(--tfmc-stone)]">
        Armor preview
      </span>
      <div
        className="relative overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[var(--tfmc-forest-deep)]"
        style={{ height: 240 }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        {status === "loading" ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_88%,transparent)]"
            role="status"
            aria-live="polite"
          >
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] border-t-[var(--tfmc-accent)]"
              aria-hidden
            />
            <p className="text-sm text-[var(--tfmc-mist)]">Loading preview…</p>
          </div>
        ) : null}
        {status === "error" && error ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_92%,transparent)] px-4">
            <p className="text-center text-sm text-[#e8a0a0]" role="alert">
              {error}
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-left sm:flex-initial">
          <span className="text-xs font-medium text-[var(--tfmc-stone)]">
            Preview skin
          </span>
          <input
            type="file"
            accept="image/png,.png"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setPlayerSkinFile(file);
              e.target.value = "";
            }}
            className="max-w-full text-xs text-[var(--tfmc-mist)] file:mr-2 file:rounded-sm file:border-0 file:bg-[var(--tfmc-moss)] file:px-2.5 file:py-1 file:text-xs file:text-[var(--tfmc-cream)]"
          />
        </label>
        <button
          type="button"
          aria-pressed={showOuterLayer}
          onClick={() => setShowOuterLayer((v) => !v)}
          className={`self-end rounded-sm border px-2.5 py-1 text-xs transition ${
            showOuterLayer
              ? "border-[color-mix(in_srgb,var(--tfmc-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_18%,transparent)] text-[var(--tfmc-cream)]"
              : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-mist)] hover:border-[var(--tfmc-accent)] hover:text-[var(--tfmc-cream)]"
          }`}
        >
          Outer layer
        </button>
        {playerSkinFile ? (
          <button
            type="button"
            onClick={() => setPlayerSkinFile(null)}
            className="self-end rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] px-2.5 py-1 text-xs text-[var(--tfmc-mist)] transition hover:border-[var(--tfmc-accent)] hover:text-[var(--tfmc-cream)]"
          >
            Use default
          </button>
        ) : null}
      </div>
      {status === "ready" ? (
        <p className="text-xs text-[var(--tfmc-mist)]">
          Drag to rotate, scroll to zoom.
        </p>
      ) : null}
    </div>
  );
}
