"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import * as THREE from "three";
import { disposeObject3D, loadTextureFromFile } from "../../../lib/skins/javaModel";
import {
  applySteveArmPose,
  createSteveMannequin,
  inferArmModelFromTexture,
  setSteveOuterLayerVisible,
  type ArmModel,
  type SteveMannequin,
} from "../../../lib/skins/steveMannequin";

type Props = {
  /** Local File or remote blob/object URL for a 64×64 skin PNG. */
  source: File | string | null;
  className?: string;
  /** When set, use this arm model instead of inferring from the texture. */
  armModel?: ArmModel | null;
  /**
   * When set and a source is available, show a bottom-right download control
   * that saves the current skin PNG (e.g. auto-masked preview for editing).
   */
  downloadFilename?: string | null;
};

async function downloadSkinSource(
  source: File | string,
  filename: string
): Promise<void> {
  let blob: Blob;
  if (source instanceof File) {
    blob = source;
  } else {
    const res = await fetch(source);
    if (!res.ok) throw new Error("Could not download skin");
    blob = await res.blob();
  }
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Standing Steve mannequin textured with a player skin (wardrobe / creation).
 */
export default function SkinMannequinPreview({
  source,
  className = "",
  armModel = null,
  downloadFilename = null,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const hostEl = hostRef.current;
    const skinSource = source;
    if (!hostEl || !skinSource) {
      setError(null);
      if (hostEl) hostEl.replaceChildren();
      return;
    }
    const mount: HTMLDivElement = hostEl;

    let cancelled = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let steveRoot: SteveMannequin | null = null;
    let steveTexture: THREE.Texture | null = null;
    let raf = 0;

    async function run() {
      setError(null);
      try {
        let file: File;
        if (typeof skinSource === "string") {
          const res = await fetch(skinSource);
          if (!res.ok) throw new Error("Could not load skin texture");
          const blob = await res.blob();
          file = new File([blob], "skin.png", { type: "image/png" });
        } else if (skinSource instanceof File) {
          file = skinSource;
        } else {
          return;
        }
        if (cancelled) return;

        const loaded = await loadTextureFromFile(file);
        steveTexture = loaded.texture;
        if (cancelled) {
          steveTexture.dispose();
          return;
        }

        const previewModel = armModel ?? inferArmModelFromTexture(steveTexture);
        steveRoot = createSteveMannequin(steveTexture, previewModel);
        applySteveArmPose(steveRoot, "idle");
        setSteveOuterLayerVisible(steveRoot, true);

        if (cancelled) {
          disposeObject3D(steveRoot);
          return;
        }

        const widthPx = mount.clientWidth || 160;
        const heightPx = mount.clientHeight || 240;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(widthPx, heightPx, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x000000, 0);
        mount.replaceChildren(renderer.domElement);
        renderer.domElement.className = "h-full w-full touch-none";
        renderer.domElement.style.display = "block";

        const camera = new THREE.PerspectiveCamera(
          34,
          widthPx / Math.max(heightPx, 1),
          0.1,
          500
        );
        const focus = new THREE.Vector3(0, 12, 0);
        camera.position.set(focus.x + 6, focus.y + 4, focus.z + 54);
        camera.lookAt(focus);

        const scene = new THREE.Scene();
        const amb = new THREE.AmbientLight(0xffffff, 0.85);
        const dir = new THREE.DirectionalLight(0xffffff, 0.55);
        dir.position.set(20, 40, 30);
        scene.add(amb, dir, steveRoot);

        const tick = () => {
          if (cancelled || !renderer || !steveRoot) return;
          steveRoot.rotation.y += 0.008;
          renderer.render(scene, camera);
          raf = window.requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Preview failed");
          mount.replaceChildren();
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      if (renderer) {
        renderer.dispose();
        renderer = null;
      }
      if (steveRoot) {
        disposeObject3D(steveRoot);
        steveRoot = null;
      }
      steveTexture?.dispose();
      mount.replaceChildren();
    };
  }, [source, armModel]);

  const canDownload = Boolean(source && downloadFilename);

  async function onDownload(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!source || !downloadFilename || downloading) return;
    setDownloading(true);
    try {
      await downloadSkinSource(source, downloadFilename);
    } catch {
      setError("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className={`relative overflow-hidden bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,black)] ${className}`}
    >
      <div ref={hostRef} className="h-full w-full" />
      {!source ? (
        <p className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-[var(--tfmc-mist)]">
          No skin
        </p>
      ) : null}
      {error ? (
        <p className="absolute inset-x-0 bottom-1 px-2 text-center text-[10px] text-red-300">
          {error}
        </p>
      ) : null}
      {canDownload ? (
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          title="Download skin PNG"
          aria-label="Download skin PNG"
          className="absolute bottom-1.5 right-1.5 z-10 inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_28%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_88%,black)] text-[var(--tfmc-cream)] shadow-sm transition hover:border-[var(--tfmc-accent)] hover:bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,black)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] disabled:opacity-50 pointer-events-auto"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3v12" />
            <path d="m7 11 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
