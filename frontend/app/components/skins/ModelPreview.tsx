"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  composeTintedPotionCanvas,
  loadDrinkAssetImages,
} from "../../../lib/drinks/potionTint";
import {
  applyDisplayToObject,
  resolveDisplayTab,
  type DisplayKind,
  type DisplayTabName,
} from "../../../lib/skins/displayTransform";
import {
  buildExtrudedItemGroup,
  loadImageDataFromFile,
} from "../../../lib/skins/extrudeItem";
import {
  resolveFlatDisplayTab,
  type FlatDisplayKind,
} from "../../../lib/skins/flatItemDisplay";
import { resolveShieldBlockingTab } from "../../../lib/skins/shieldBlockingDisplay";
import {
  buildJavaModelGroup,
  disposeObject3D,
  loadTextureFromFile,
  parseJavaModelJson,
  type JavaModelJson,
} from "../../../lib/skins/javaModel";
import {
  applySteveArmPose,
  createSteveMannequin,
  inferArmModelFromTexture,
  loadSteveTexture,
  setSteveOuterLayerVisible,
  type ArmModel,
  type SteveArmPose,
  type SteveMannequin,
} from "../../../lib/skins/steveMannequin";

export type GunModels = {
  carry: File | null;
  reload: File | null;
  aim: File | null;
};

export type FlatFrameId =
  | "texture"
  | "pull_0"
  | "pull_1"
  | "pull_2"
  | "charged";

export type FlatFrames = Partial<Record<FlatFrameId, File | null>>;

type ItemSlot =
  | "model"
  | "thirdperson_righthand"
  | "thirdperson_lefthand"
  | "head";

type GunSlot =
  | "model"
  | "carry_right"
  | "carry_left"
  | "reload_right"
  | "reload_left"
  | "aim_right"
  | "aim_left";

type PreviewSlot = ItemSlot | GunSlot;

type Props = {
  modelFile?: File | null;
  textureFile: File | null;
  gunModels?: GunModels;
  kind?: DisplayKind;
  /** Flat item display tab preset (e.g. generated for potions). Defaults to kind. */
  flatDisplayPreset?: FlatDisplayKind;
  /** Standby / single PNG for flat kinds (optional if flatFrames.texture set). */
  flatTextureFile?: File | null;
  flatFrames?: FlatFrames;
  /** Thirdperson grip Y for large_handheld (2.5–5.5). */
  gripY?: number | null;
  /** Tinted potion preview color (#RRGGBB); avoids rebuilding mesh on each change. */
  potionTintColor?: string | null;
  onPreviewError?: (message: string | null) => void;
  className?: string;
};

type Status = "idle" | "loading" | "ready" | "error";

type OrbitState = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

type ViewerRuntime = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  scene: THREE.Scene;
  raf: number;
  removeResize: () => void;
};

type ContentRefs = {
  itemRoot: THREE.Object3D | null;
  itemTexture: THREE.Texture | null;
  javaJson: JavaModelJson | null;
  steveRoot: SteveMannequin | null;
  steveTexture: THREE.Texture | null;
  potionCanvas: HTMLCanvasElement | null;
  floatingRoot: THREE.Group | null;
};

const FRAME_CHIPS: { id: FlatFrameId; label: string }[] = [
  { id: "texture", label: "Standby" },
  { id: "pull_0", label: "Pull 0" },
  { id: "pull_1", label: "Pull 1" },
  { id: "pull_2", label: "Pull 2" },
  { id: "charged", label: "Charged" },
];

function isGunKind(kind?: DisplayKind): boolean {
  return kind === "gun";
}

function isFlatKind(kind?: DisplayKind): boolean {
  return (
    kind === "handheld" ||
    kind === "generated" ||
    kind === "large_handheld" ||
    kind === "bow" ||
    kind === "large_bow" ||
    kind === "crossbow" ||
    kind === "book"
  );
}

function flatDisplayKind(
  kind?: DisplayKind,
  preset?: FlatDisplayKind
): FlatDisplayKind {
  return preset ?? kind ?? "handheld";
}

function isMultiFrameKind(kind?: DisplayKind): boolean {
  return kind === "bow" || kind === "large_bow" || kind === "crossbow";
}

function fileIdentity(file: File | null | undefined): string {
  if (!file) return "";
  return `${file.name}\0${file.size}\0${file.lastModified}`;
}

function saveOrbit(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls
): OrbitState {
  return {
    position: camera.position.clone(),
    target: controls.target.clone(),
  };
}

function restoreOrbit(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  state: OrbitState
): void {
  camera.position.copy(state.position);
  controls.target.copy(state.target);
  camera.lookAt(state.target);
  controls.update();
}

function setDefaultOrbit(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  focus: THREE.Vector3,
  frameSize: number
): void {
  camera.position.set(
    focus.x + frameSize * 1.4,
    focus.y + frameSize * 0.55,
    focus.z + frameSize * 1.6
  );
  camera.lookAt(focus);
  controls.target.copy(focus);
  controls.update();
}

function isPreviewSceneRoot(obj: THREE.Object3D): boolean {
  return obj.name === "floatingItem" || obj.name === "steveMannequin";
}

/** Drop mannequin / floating groups from the scene. Item mesh is unparented first so it can be reused. */
function stripPreviewFromScene(
  scene: THREE.Scene,
  content: ContentRefs
): void {
  content.itemRoot?.removeFromParent();

  const toDispose = new Set<THREE.Object3D>();
  if (content.floatingRoot) toDispose.add(content.floatingRoot);
  if (content.steveRoot) toDispose.add(content.steveRoot);
  for (const child of [...scene.children]) {
    if (isPreviewSceneRoot(child)) toDispose.add(child);
  }
  for (const obj of toDispose) {
    disposeObject3D(obj);
  }
  content.floatingRoot = null;
  content.steveRoot = null;
}

function disposeContent(content: ContentRefs, scene?: THREE.Scene): void {
  if (scene) {
    stripPreviewFromScene(scene, content);
  } else {
    content.itemRoot?.removeFromParent();
    if (content.steveRoot) disposeObject3D(content.steveRoot);
    if (content.floatingRoot) disposeObject3D(content.floatingRoot);
    content.steveRoot = null;
    content.floatingRoot = null;
  }
  content.steveTexture?.dispose();
  content.steveTexture = null;
  if (content.itemRoot) {
    disposeObject3D(content.itemRoot);
    content.itemRoot = null;
  }
  content.itemTexture?.dispose();
  content.itemTexture = null;
  content.javaJson = null;
  content.potionCanvas = null;
}

function itemSlotsForKind(
  kind?: DisplayKind
): { id: ItemSlot; label: string }[] {
  const base: { id: ItemSlot; label: string }[] = [
    { id: "model", label: "Model" },
    { id: "thirdperson_righthand", label: "Right" },
    { id: "thirdperson_lefthand", label: "Left" },
  ];
  if (kind === "helmet_3d" || kind === "mask") {
    return [...base, { id: "head", label: "Head" }];
  }
  return base;
}

const GUN_SLOTS: { id: GunSlot; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "carry_right", label: "Carry (Right)" },
  { id: "carry_left", label: "Carry (Left)" },
  { id: "reload_right", label: "Reload (Right)" },
  { id: "reload_left", label: "Reload (Left)" },
  { id: "aim_right", label: "Aim (Right)" },
  { id: "aim_left", label: "Aim (Left)" },
];

function isLeftHandSlot(slot: PreviewSlot): boolean {
  return (
    slot === "thirdperson_lefthand" ||
    slot === "carry_left" ||
    slot === "reload_left" ||
    slot === "aim_left"
  );
}

function isAimSlot(slot: PreviewSlot): boolean {
  return slot === "aim_right" || slot === "aim_left";
}

function gunVariantForSlot(
  slot: PreviewSlot
): "carry" | "reload" | "aim" | null {
  if (slot === "carry_right" || slot === "carry_left") return "carry";
  if (slot === "reload_right" || slot === "reload_left") return "reload";
  if (slot === "aim_right" || slot === "aim_left") return "aim";
  return null;
}

function isMannequinSlot(slot: PreviewSlot, gun: boolean): boolean {
  if (slot === "model") return false;
  if (gun) return gunVariantForSlot(slot) !== null;
  return true;
}

function slotStatusLabel(slot: PreviewSlot, gun: boolean): string {
  if (gun) {
    if (slot === "carry_right") return "carry (right hand)";
    if (slot === "carry_left") return "carry (left hand)";
    if (slot === "reload_right") return "reload (right hand)";
    if (slot === "reload_left") return "reload (left hand)";
    if (slot === "aim_right") return "aim (right, crossbow hold)";
    if (slot === "aim_left") return "aim (left, crossbow hold)";
    return "model";
  }
  if (slot === "thirdperson_lefthand") return "left hand";
  if (slot === "thirdperson_righthand") return "right hand";
  if (slot === "head") return "head";
  return "model";
}

function resolveActiveModelFile(
  gun: boolean,
  slot: PreviewSlot,
  modelFile: File | null | undefined,
  gunModels?: GunModels
): File | null {
  if (!gun) return modelFile ?? null;
  if (!gunModels) return null;
  const variant = gunVariantForSlot(slot);
  if (variant === "carry") return gunModels.carry;
  if (variant === "reload") return gunModels.reload;
  if (variant === "aim") return gunModels.aim;
  return gunModels.carry ?? gunModels.reload ?? gunModels.aim ?? null;
}

function gunSlotHasFile(id: GunSlot, gunModels?: GunModels): boolean {
  if (!gunModels) return false;
  if (id === "model") {
    return Boolean(gunModels.carry || gunModels.reload || gunModels.aim);
  }
  const variant = gunVariantForSlot(id);
  if (variant === "carry") return Boolean(gunModels.carry);
  if (variant === "reload") return Boolean(gunModels.reload);
  if (variant === "aim") return Boolean(gunModels.aim);
  return false;
}

function resolveFlatTextureFile(
  frame: FlatFrameId,
  flatFrames?: FlatFrames,
  flatTextureFile?: File | null,
  textureFile?: File | null
): File | null {
  const fromFrames = flatFrames?.[frame] ?? null;
  if (fromFrames) return fromFrames;
  if (frame === "texture") {
    return flatTextureFile ?? textureFile ?? null;
  }
  return null;
}

function availableFrames(
  kind: DisplayKind | undefined,
  flatFrames?: FlatFrames,
  flatTextureFile?: File | null,
  textureFile?: File | null
): FlatFrameId[] {
  if (!isMultiFrameKind(kind)) return ["texture"];
  const ids: FlatFrameId[] =
    kind === "crossbow"
      ? ["texture", "pull_0", "pull_1", "pull_2", "charged"]
      : ["texture", "pull_0", "pull_1", "pull_2"];
  return ids.filter((id) =>
    Boolean(resolveFlatTextureFile(id, flatFrames, flatTextureFile, textureFile))
  );
}

function resolveFlatArmPose(
  kind: DisplayKind | undefined,
  frame: FlatFrameId,
  leftHand: boolean
): { pose: SteveArmPose; chargeProgress?: number } {
  const pull =
    frame === "pull_0" || frame === "pull_1" || frame === "pull_2";
  if (kind === "bow" || kind === "large_bow") {
    if (pull) {
      return { pose: leftHand ? "bow_pull_left" : "bow_pull" };
    }
    return { pose: leftHand ? "hold_left" : "hold_right" };
  }
  if (kind === "crossbow") {
    if (pull) {
      const chargeProgress =
        frame === "pull_0" ? 0 : frame === "pull_1" ? 0.5 : 1;
      return {
        pose: leftHand ? "crossbow_charge_left" : "crossbow_charge",
        chargeProgress,
      };
    }
    if (frame === "charged") {
      return { pose: leftHand ? "crossbow_hold_left" : "crossbow_hold" };
    }
    return { pose: leftHand ? "hold_left" : "hold_right" };
  }
  return { pose: leftHand ? "hold_left" : "hold_right" };
}

function textureFromCanvas(canvas: HTMLCanvasElement): THREE.Texture {
  const texture = new THREE.Texture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function canvasImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not read potion canvas");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function updateMeshTexture(root: THREE.Object3D, texture: THREE.Texture): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
      obj.material.map = texture;
      obj.material.needsUpdate = true;
    }
  });
}

export default function ModelPreview({
  modelFile = null,
  textureFile,
  gunModels,
  kind,
  flatDisplayPreset,
  flatTextureFile = null,
  flatFrames,
  gripY = null,
  potionTintColor = null,
  onPreviewError,
  className = "",
}: Props) {
  const gun = isGunKind(kind);
  const flat = isFlatKind(kind);
  const displayKind = flatDisplayKind(kind, flatDisplayPreset);
  const potionTintMode =
    flat && flatDisplayPreset === "generated" && Boolean(potionTintColor);

  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const contentRef = useRef<ContentRefs>({
    itemRoot: null,
    itemTexture: null,
    javaJson: null,
    steveRoot: null,
    steveTexture: null,
    potionCanvas: null,
    floatingRoot: null,
  });
  const heldItemRef = useRef<THREE.Group | null>(null);
  const heldMirrorLeftRef = useRef(false);
  const steveLiveRef = useRef<SteveMannequin | null>(null);
  const orbitInitializedRef = useRef(false);
  const orbitStateRef = useRef<OrbitState | null>(null);
  const drinkAssetsRef = useRef<Awaited<
    ReturnType<typeof loadDrinkAssetImages>
  > | null>(null);
  const syncGenRef = useRef(0);
  const layoutGenRef = useRef(0);
  const gripYRef = useRef(gripY);
  gripYRef.current = gripY;
  const showOuterLayerRef = useRef(true);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<PreviewSlot>(
    gun ? "carry_right" : "thirdperson_righthand"
  );
  const [frame, setFrame] = useState<FlatFrameId>("texture");
  const [shieldMode, setShieldMode] = useState<"idle" | "blocking">("idle");
  const [playerSkinFile, setPlayerSkinFile] = useState<File | null>(null);
  const [armModel, setArmModel] = useState<ArmModel>("default");
  const [showOuterLayer, setShowOuterLayer] = useState(true);
  const [contentVersion, setContentVersion] = useState(0);
  showOuterLayerRef.current = showOuterLayer;

  const frameOptions = useMemo(
    () => availableFrames(kind, flatFrames, flatTextureFile, textureFile),
    [kind, flatFrames, flatTextureFile, textureFile]
  );

  const previewSlots = useMemo(() => {
    if (gun) return GUN_SLOTS.filter((opt) => gunSlotHasFile(opt.id, gunModels));
    return itemSlotsForKind(kind);
  }, [gun, gunModels, kind]);

  const pipelineKey = `${Number(gun)}-${Number(flat)}-${kind ?? ""}-${displayKind}`;

  const activeModelFile = resolveActiveModelFile(
    gun,
    slot,
    modelFile,
    gunModels
  );

  const activeFlatTexture = flat
    ? resolveFlatTextureFile(frame, flatFrames, flatTextureFile, textureFile)
    : null;

  const hasPreview = flat
    ? Boolean(activeFlatTexture) || potionTintMode
    : Boolean(activeModelFile && textureFile);

  const meshOnMannequin = isMannequinSlot(slot, gun);

  const contentSignature = useMemo(() => {
    const placement = meshOnMannequin ? "m" : "f";
    if (potionTintMode) return "potion:generated";
    if (flat) {
      return `flat:${fileIdentity(activeFlatTexture)}:${placement}`;
    }
    return `3d:${fileIdentity(activeModelFile)}:${fileIdentity(textureFile)}:${placement}`;
  }, [
    potionTintMode,
    flat,
    activeFlatTexture,
    activeModelFile,
    textureFile,
    meshOnMannequin,
  ]);

  const layoutSignature = `${slot}:${frame}:${shieldMode}:${fileIdentity(playerSkinFile)}`;

  useEffect(() => {
    if (previewSlots.some((s) => s.id === slot)) return;
    const preferred = gun
      ? previewSlots.find((s) => s.id === "carry_right")
      : previewSlots.find((s) => s.id === "thirdperson_righthand");
    setSlot(
      (preferred?.id as PreviewSlot | undefined) ??
        (previewSlots[0]?.id as PreviewSlot | undefined) ??
        (gun ? "carry_right" : "thirdperson_righthand")
    );
  }, [gun, previewSlots, slot]);

  useEffect(() => {
    if (frameOptions.includes(frame)) return;
    setFrame(frameOptions[0] ?? "texture");
  }, [frameOptions, frame]);

  useEffect(() => {
    if (kind !== "shield") setShieldMode("idle");
  }, [kind]);

  useEffect(() => {
    if (steveLiveRef.current) {
      setSteveOuterLayerVisible(steveLiveRef.current, showOuterLayer);
    }
  }, [showOuterLayer]);

  const reportError = useCallback(
    (message: string | null) => {
      setError(message);
      onPreviewError?.(message);
    },
    [onPreviewError]
  );

  const buildItemMesh = useCallback(
    async (
      onMannequin: boolean,
      tintColor: string | null
    ): Promise<{ root: THREE.Object3D; texture: THREE.Texture; javaJson: JavaModelJson | null; canvas: HTMLCanvasElement | null }> => {
      if (flat) {
        if (potionTintMode && tintColor) {
          const assets =
            drinkAssetsRef.current ?? (await loadDrinkAssetImages());
          drinkAssetsRef.current = assets;
          const canvas = composeTintedPotionCanvas(tintColor, assets);
          if (!canvas) throw new Error("Invalid potion color");
          const texture = textureFromCanvas(canvas);
          const imageData = canvasImageData(canvas);
          const root = buildExtrudedItemGroup(imageData, texture, {
            center: !onMannequin,
          });
          return { root, texture, javaJson: null, canvas };
        }
        if (!activeFlatTexture) {
          throw new Error("No texture for selected frame");
        }
        const loaded = await loadImageDataFromFile(activeFlatTexture);
        const root = buildExtrudedItemGroup(loaded.imageData, loaded.texture, {
          center: !onMannequin,
        });
        return {
          root,
          texture: loaded.texture,
          javaJson: null,
          canvas: null,
        };
      }
      if (!activeModelFile || !textureFile) {
        throw new Error("Missing model or texture");
      }
      const modelText = await activeModelFile.text();
      const javaJson = parseJavaModelJson(modelText);
      const loaded = await loadTextureFromFile(textureFile);
      const root = buildJavaModelGroup(
        javaJson,
        loaded.texture,
        loaded.width,
        loaded.height,
        { center: !onMannequin }
      );
      return { root, texture: loaded.texture, javaJson, canvas: null };
    },
    [
      flat,
      potionTintMode,
      activeFlatTexture,
      activeModelFile,
      textureFile,
    ]
  );

  const applyLayout = useCallback(
    async (
      runtime: ViewerRuntime,
      content: ContentRefs,
      resetOrbit: boolean,
      gen: number
    ): Promise<void> => {
      const { scene, camera, controls } = runtime;
      const onMannequin = isMannequinSlot(slot, gun);
      const leftHand = isLeftHandSlot(slot);
      const isStale = () => gen !== layoutGenRef.current;

      stripPreviewFromScene(scene, content);
      steveLiveRef.current = null;
      heldItemRef.current = null;

      if (!content.itemRoot) return;

      let focus = new THREE.Vector3(0, 0, 0);
      let frameSize = 16;

      if (onMannequin) {
        if (playerSkinFile) {
          const skin = await loadTextureFromFile(playerSkinFile);
          if (isStale() || !content.itemRoot) {
            skin.texture.dispose();
            return;
          }
          content.steveTexture?.dispose();
          content.steveTexture = skin.texture;
        } else {
          const steveTex = await loadSteveTexture();
          if (isStale() || !content.itemRoot) {
            steveTex?.dispose();
            return;
          }
          content.steveTexture?.dispose();
          content.steveTexture = steveTex;
        }
        const detected = inferArmModelFromTexture(content.steveTexture);
        setArmModel(detected);
        const steveRoot = createSteveMannequin(content.steveTexture, detected);
        if (isStale()) {
          disposeObject3D(steveRoot);
          return;
        }

        let pose: SteveArmPose;
        let chargeProgress: number | undefined;
        if (flat) {
          const resolved = resolveFlatArmPose(kind, frame, leftHand);
          pose = resolved.pose;
          chargeProgress = resolved.chargeProgress;
        } else if (kind === "shield" && slot !== "head") {
          pose =
            shieldMode === "blocking"
              ? leftHand
                ? "shield_block_left"
                : "shield_block"
              : leftHand
                ? "hold_left"
                : "hold_right";
        } else if (isAimSlot(slot)) {
          pose = leftHand ? "crossbow_hold_left" : "crossbow_hold";
        } else if (slot === "head") {
          pose = "idle";
        } else {
          pose = leftHand ? "hold_left" : "hold_right";
        }
        applySteveArmPose(steveRoot, pose, { chargeProgress });
        setSteveOuterLayerVisible(steveRoot, showOuterLayerRef.current);
        steveLiveRef.current = steveRoot;
        content.steveRoot = steveRoot;

        const displayTabName: DisplayTabName =
          slot === "head" ? "head" : "thirdperson_righthand";

        const held = new THREE.Group();
        held.name = "heldItem";

        if (flat) {
          const tab = resolveFlatDisplayTab(
            displayKind,
            "thirdperson_righthand",
            gripYRef.current
          );
          applyDisplayToObject(held, tab, { mirrorLeft: leftHand });
          heldItemRef.current = held;
          heldMirrorLeftRef.current = leftHand;
        } else if (
          kind === "shield" &&
          shieldMode === "blocking" &&
          slot !== "head"
        ) {
          const tab = resolveShieldBlockingTab(
            content.javaJson ?? { elements: [] },
            "thirdperson_righthand"
          );
          applyDisplayToObject(held, tab, { mirrorLeft: leftHand });
        } else {
          const tab = resolveDisplayTab(
            content.javaJson ?? { elements: [] },
            displayTabName,
            kind
          );
          applyDisplayToObject(held, tab, { mirrorLeft: leftHand });
        }

        held.add(content.itemRoot);
        const socket =
          slot === "head"
            ? steveRoot.bones.itemSocketHead
            : leftHand
              ? steveRoot.bones.itemSocketLeft
              : steveRoot.bones.itemSocketRight;
        socket.add(held);
        scene.add(steveRoot);
        if (isStale()) {
          stripPreviewFromScene(scene, content);
          steveLiveRef.current = null;
          heldItemRef.current = null;
          return;
        }

        focus.set(0, 14, 0);
        frameSize = 32;
      } else {
        const floating = new THREE.Group();
        floating.name = "floatingItem";
        floating.add(content.itemRoot);
        content.floatingRoot = floating;
        scene.add(floating);
        if (isStale()) {
          stripPreviewFromScene(scene, content);
          return;
        }

        const box = new THREE.Box3().setFromObject(content.itemRoot);
        const size = box.getSize(new THREE.Vector3());
        focus = box.getCenter(new THREE.Vector3());
        frameSize = Math.max(size.x, size.y, size.z, 1);
      }

      if (isStale()) return;

      if (resetOrbit || !orbitInitializedRef.current) {
        setDefaultOrbit(camera, controls, focus, frameSize);
        orbitInitializedRef.current = true;
      } else if (orbitStateRef.current) {
        restoreOrbit(camera, controls, orbitStateRef.current);
      }
    },
    [slot, gun, flat, kind, frame, shieldMode, displayKind, playerSkinFile]
  );

  // Viewer lifecycle: renderer + camera + controls persist until pipeline changes.
  useEffect(() => {
    if (!hasPreview) {
      setStatus("idle");
      reportError(null);
      orbitInitializedRef.current = false;
      orbitStateRef.current = null;
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    setStatus("loading");
    reportError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1c16);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));

    const widthPx = host.clientWidth || 320;
    const heightPx = 240;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(widthPx, heightPx, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(renderer.domElement);
    renderer.domElement.className = "h-full w-full touch-none";
    renderer.domElement.style.display = "block";

    const camera = new THREE.PerspectiveCamera(35, widthPx / heightPx, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const onResize = () => {
      if (!host) return;
      const w = host.clientWidth || 320;
      const h = 240;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    window.addEventListener("resize", onResize);

    const runtime: ViewerRuntime = {
      renderer,
      camera,
      controls,
      scene,
      raf: 0,
      removeResize: () => window.removeEventListener("resize", onResize),
    };
    runtimeRef.current = runtime;

    const tick = () => {
      if (cancelled) return;
      runtime.raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(runtime.raf);
      runtime.removeResize();
      runtime.controls.dispose();
      runtime.renderer.dispose();
      runtimeRef.current = null;
      disposeContent(contentRef.current, runtime.scene);
      contentRef.current = {
        itemRoot: null,
        itemTexture: null,
        javaJson: null,
        steveRoot: null,
        steveTexture: null,
        potionCanvas: null,
        floatingRoot: null,
      };
      heldItemRef.current = null;
      steveLiveRef.current = null;
      orbitInitializedRef.current = false;
      orbitStateRef.current = null;
      drinkAssetsRef.current = null;
      host.replaceChildren();
    };
  }, [hasPreview, pipelineKey, reportError]);

  // Content rebuild: new files / frame / initial potion mesh (not color-only).
  useEffect(() => {
    if (!hasPreview) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const gen = ++syncGenRef.current;
    layoutGenRef.current += 1;

    setStatus("loading");
    reportError(null);

    void (async () => {
      try {
        const built = await buildItemMesh(
          meshOnMannequin,
          potionTintColor ?? null
        );
        if (gen !== syncGenRef.current) {
          disposeObject3D(built.root);
          built.texture.dispose();
          return;
        }

        layoutGenRef.current += 1;
        disposeContent(contentRef.current, runtime.scene);
        contentRef.current = {
          itemRoot: built.root,
          itemTexture: built.texture,
          javaJson: built.javaJson,
          steveRoot: null,
          steveTexture: null,
          potionCanvas: built.canvas,
          floatingRoot: null,
        };
        setContentVersion((v) => v + 1);
        reportError(null);
      } catch (err) {
        if (gen !== syncGenRef.current) return;
        const message =
          err instanceof Error ? err.message : "Could not build preview";
        reportError(message);
        setStatus("error");
      }
    })();
  }, [hasPreview, contentSignature, buildItemMesh, reportError, potionTintColor, meshOnMannequin]);

  // Layout updates: slot / frame pose / shield / skin - preserve orbit.
  useEffect(() => {
    if (!hasPreview) return;
    const runtime = runtimeRef.current;
    const content = contentRef.current;
    if (!runtime || !content.itemRoot) return;

    if (orbitInitializedRef.current) {
      orbitStateRef.current = saveOrbit(runtime.camera, runtime.controls);
    }

    const gen = ++layoutGenRef.current;

    void (async () => {
      try {
        const resetOrbit = !orbitInitializedRef.current;
        await applyLayout(runtime, content, resetOrbit, gen);
        if (gen !== layoutGenRef.current) return;
        setStatus("ready");
        reportError(null);
      } catch (err) {
        if (gen !== layoutGenRef.current) return;
        const message =
          err instanceof Error ? err.message : "Could not update preview";
        reportError(message);
        setStatus("error");
      }
    })();

    return () => {
      layoutGenRef.current += 1;
    };
  }, [hasPreview, layoutSignature, contentVersion, applyLayout, reportError]);

  // Potion tint: update texture in place without rebuilding geometry.
  useEffect(() => {
    if (!potionTintMode || !potionTintColor) return;
    const content = contentRef.current;
    if (!content.itemRoot || !content.itemTexture) return;

    void (async () => {
      try {
        const assets =
          drinkAssetsRef.current ?? (await loadDrinkAssetImages());
        drinkAssetsRef.current = assets;
        const canvas = composeTintedPotionCanvas(potionTintColor, assets);
        if (!canvas || !content.itemTexture || !content.itemRoot) return;
        content.potionCanvas = canvas;
        content.itemTexture.image = canvas;
        content.itemTexture.needsUpdate = true;
        updateMeshTexture(content.itemRoot, content.itemTexture);
      } catch {
        reportError("Could not update potion color");
      }
    })();
  }, [potionTintColor, potionTintMode, contentVersion, reportError]);

  // Grip Y for large_handheld: transform only, no orbit reset.
  useEffect(() => {
    const held = heldItemRef.current;
    if (!held || !flat || kind !== "large_handheld") return;
    const leftHand = heldMirrorLeftRef.current;
    const tab = resolveFlatDisplayTab(
      displayKind,
      "thirdperson_righthand",
      gripY
    );
    applyDisplayToObject(held, tab, { mirrorLeft: leftHand });
  }, [gripY, flat, kind, displayKind, slot]);

  if (!hasPreview) {
    return (
      <div
        className={`rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[var(--tfmc-forest-deep)] px-4 py-8 text-center text-sm text-[var(--tfmc-mist)] ${className}`}
      >
        No preview texture loaded.
      </div>
    );
  }

  const mannequinPreview = isMannequinSlot(slot, gun);
  const showFrameChips = flat && isMultiFrameKind(kind) && frameOptions.length > 1;
  const showShieldMode = kind === "shield" && mannequinPreview;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">
          Model preview
        </span>
        <div
          role="radiogroup"
          aria-label="Display preview"
          className="inline-flex max-w-full flex-wrap rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] p-0.5"
        >
          {previewSlots.map((opt) => {
            const selected = slot === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSlot(opt.id)}
                className={`rounded-sm px-2.5 py-1 text-xs transition ${
                  selected
                    ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_22%,var(--tfmc-forest))] text-[var(--tfmc-cream)]"
                    : "text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {showShieldMode ? (
        <div
          role="radiogroup"
          aria-label="Shield stance"
          className="inline-flex max-w-full flex-wrap self-start rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] p-0.5"
        >
          {(
            [
              { id: "idle" as const, label: "Idle" },
              { id: "blocking" as const, label: "Blocking" },
            ] as const
          ).map((opt) => {
            const selected = shieldMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setShieldMode(opt.id)}
                className={`rounded-sm px-2.5 py-1 text-xs transition ${
                  selected
                    ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_22%,var(--tfmc-forest))] text-[var(--tfmc-cream)]"
                    : "text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {showFrameChips ? (
        <div
          role="radiogroup"
          aria-label="Animation frame"
          className="inline-flex max-w-full flex-wrap self-start rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] p-0.5"
        >
          {FRAME_CHIPS.filter((chip) => frameOptions.includes(chip.id)).map(
            (chip) => {
              const selected = frame === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setFrame(chip.id)}
                  className={`rounded-sm px-2.5 py-1 text-xs transition ${
                    selected
                      ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_22%,var(--tfmc-forest))] text-[var(--tfmc-cream)]"
                      : "text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
                  }`}
                >
                  {chip.label}
                </button>
              );
            }
          )}
        </div>
      ) : null}

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
      {mannequinPreview ? (
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
      ) : null}
      {status === "ready" ? (
        <p className="text-xs text-[var(--tfmc-mist)]">
          {mannequinPreview
            ? playerSkinFile
              ? `Previewing on ${playerSkinFile.name}. Drag to orbit, scroll to zoom.`
              : `Display: ${slotStatusLabel(slot, gun)}${
                  showShieldMode ? ` · ${shieldMode}` : ""
                }${
                  showFrameChips ? ` · ${frame}` : ""
                }. Optional: upload your skin PNG. Drag to orbit, scroll to zoom.`
            : "Drag to orbit, scroll to zoom."}
        </p>
      ) : null}
    </div>
  );
}
