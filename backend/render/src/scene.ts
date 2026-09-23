import * as THREE from "three";
import { applyDisplayToObject, resolveDisplayTab } from "./skins/displayTransform";
import { buildExtrudedItemGroup } from "./skins/extrudeItem";
import {
  buildJavaModelGroup,
  parseJavaModelJson,
  type JavaModelJson,
} from "./skins/javaModel";
import {
  applySteveArmPose,
  attachSteveArmorOverlay,
  createSteveMannequin,
  HEAD_SOCKET,
  setArmorHelmetVisible,
  type SteveArmPose,
} from "./skins/steveMannequin";

export type RenderJob = {
  kind: string;
  views: string[];
  width?: number;
  height?: number;
  assets: Record<string, string>;
};

const BG = 0x202024;
const TILE = 256;

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = dataUrl;
  });
}

function imageToTexture(image: HTMLImageElement): {
  texture: THREE.Texture;
  width: number;
  height: number;
} {
  const texture = new THREE.Texture(image);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return {
    texture,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function imageToImageData(image: HTMLImageElement): ImageData {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

function setDefaultOrbit(
  camera: THREE.PerspectiveCamera,
  focus: THREE.Vector3,
  frameSize: number
): void {
  camera.position.set(
    focus.x + frameSize * 1.4,
    focus.y + frameSize * 0.55,
    focus.z + frameSize * 1.6
  );
  camera.lookAt(focus);
}

/** Extra orbit distance so a tight head/hat box is not clipped. */
const FRAME_PAD = 1.35;

function frameObject(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const focus = box.getCenter(new THREE.Vector3());
  const frameSize = Math.max(size.x, size.y, size.z, 1) * FRAME_PAD;
  setDefaultOrbit(camera, focus, frameSize);
}

function isWornHeadKind(kind: string | undefined): boolean {
  return kind === "helmet_3d" || kind === "mask";
}

function wornHelmetGroup(
  root: THREE.Object3D,
  json: JavaModelJson | null
): THREE.Group {
  const socket = new THREE.Group();
  socket.name = "helmetSocket";
  socket.rotation.y = THREE.MathUtils.degToRad(HEAD_SOCKET.rotationY);
  socket.scale.setScalar(HEAD_SOCKET.scale);
  const held = new THREE.Group();
  const tab = resolveDisplayTab(json ?? { elements: [] }, "head", "helmet_3d");
  applyDisplayToObject(held, tab);
  held.add(root);
  socket.add(held);
  return socket;
}

function isFlatKind(kind: string): boolean {
  return (
    kind === "handheld" ||
    kind === "large_handheld" ||
    kind === "item" ||
    kind === "bow" ||
    kind === "large_bow" ||
    kind === "crossbow" ||
    kind === "book"
  );
}

async function buildItemRoot(
  kind: string,
  assets: Record<string, string>,
  opts: { center: boolean; textureKey?: string; modelKey?: string }
): Promise<{ root: THREE.Object3D; json: JavaModelJson | null }> {
  const textureKey = opts.textureKey ?? "texture";
  const texUrl = assets[textureKey];
  if (!texUrl) throw new Error(`Missing texture ${textureKey}`);
  const image = await dataUrlToImage(texUrl);

  if (isFlatKind(kind) || !assets[opts.modelKey ?? "model"]) {
    const loaded = imageToTexture(image);
    const root = buildExtrudedItemGroup(imageToImageData(image), loaded.texture, {
      center: opts.center,
    });
    return { root, json: null };
  }

  const modelText = assets[opts.modelKey ?? "model"];
  if (!modelText) throw new Error("Missing model JSON");
  const json = parseJavaModelJson(modelText);
  const loaded = imageToTexture(image);
  const root = buildJavaModelGroup(
    json,
    loaded.texture,
    loaded.width,
    loaded.height,
    { center: opts.center }
  );
  return { root, json };
}

function capture(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): string {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

function clearScene(scene: THREE.Scene): void {
  while (scene.children.length) {
    scene.remove(scene.children[0]!);
  }
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
}

export async function renderPreviewJob(
  job: RenderJob
): Promise<Record<string, string>> {
  const width = job.width ?? TILE;
  const height = job.height ?? TILE;
  const host = document.getElementById("host");
  if (!host) throw new Error("Missing #host");

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 500);
  const out: Record<string, string> = {};
  const kind = job.kind;
  const assets = job.assets || {};

  try {
    for (const view of job.views) {
      clearScene(scene);
      if (view === "model" && isWornHeadKind(kind)) {
        const { root, json } = await buildItemRoot(kind, assets, {
          center: false,
        });
        const worn = wornHelmetGroup(root, json);
        scene.add(worn);
        frameObject(camera, worn);
        out[view] = capture(renderer, scene, camera);
      } else if (view === "model") {
        const { root } = await buildItemRoot(kind, assets, {
          center: true,
          modelKey: kind === "gun" ? "carry" : "model",
        });
        scene.add(root);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const focus = box.getCenter(new THREE.Vector3());
        const frameSize = Math.max(size.x, size.y, size.z, 1);
        setDefaultOrbit(camera, focus, frameSize);
        out[view] = capture(renderer, scene, camera);
      } else if (view === "book_unsigned" || view === "book_signed") {
        const key = view === "book_signed" ? "signed" : "unsigned";
        const { root } = await buildItemRoot("book", assets, {
          center: true,
          textureKey: key,
        });
        scene.add(root);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const focus = box.getCenter(new THREE.Vector3());
        setDefaultOrbit(camera, focus, Math.max(size.x, size.y, size.z, 1));
        out[view] = capture(renderer, scene, camera);
      } else if (view === "hat") {
        const steve = createSteveMannequin(null, "default");
        applySteveArmPose(steve, "idle");
        const headKind = isWornHeadKind(kind) ? kind : "helmet_3d";
        const { root, json } = await buildItemRoot(headKind, assets, {
          center: false,
        });
        const held = new THREE.Group();
        const tab = resolveDisplayTab(json ?? { elements: [] }, "head", headKind);
        applyDisplayToObject(held, tab);
        held.add(root);
        steve.bones.itemSocketHead.add(held);
        scene.add(steve);
        frameObject(camera, steve.bones.head);
        out[view] = capture(renderer, scene, camera);
      } else if (view === "carry" || view === "aim" || view === "reload") {
        const steve = createSteveMannequin(null, "default");
        const pose: SteveArmPose =
          view === "aim" ? "crossbow_hold" : "hold_right";
        applySteveArmPose(steve, pose);
        const modelKey = view;
        const { root, json } = await buildItemRoot("gun", assets, {
          center: false,
          modelKey,
        });
        const held = new THREE.Group();
        const tab = resolveDisplayTab(
          json ?? { elements: [] },
          "thirdperson_righthand",
          "gun"
        );
        applyDisplayToObject(held, tab);
        held.add(root);
        steve.bones.itemSocketRight.add(held);
        scene.add(steve);
        setDefaultOrbit(camera, new THREE.Vector3(0, 14, 0), 32);
        out[view] = capture(renderer, scene, camera);
      } else if (view === "body") {
        const steve = createSteveMannequin(null, "default");
        applySteveArmPose(steve, "idle");
        let layer1: THREE.Texture | null = null;
        let layer2: THREE.Texture | null = null;
        if (assets.layer1) {
          layer1 = imageToTexture(await dataUrlToImage(assets.layer1)).texture;
        }
        if (assets.layer2) {
          layer2 = imageToTexture(await dataUrlToImage(assets.layer2)).texture;
        }
        attachSteveArmorOverlay(steve, layer1, layer2);
        const use3dHelm = Boolean(assets.helmet_model && assets.helmet_texture);
        setArmorHelmetVisible(steve, !use3dHelm);
        if (use3dHelm) {
          const { root, json } = await buildItemRoot("helmet_3d", assets, {
            center: false,
            textureKey: "helmet_texture",
            modelKey: "helmet_model",
          });
          const held = new THREE.Group();
          const tab = resolveDisplayTab(json ?? { elements: [] }, "head", "helmet_3d");
          applyDisplayToObject(held, tab);
          held.add(root);
          steve.bones.itemSocketHead.add(held);
        }
        scene.add(steve);
        setDefaultOrbit(camera, new THREE.Vector3(0, 14, 0), 32);
        out[view] = capture(renderer, scene, camera);
      }
    }
  } finally {
    renderer.dispose();
  }
  return out;
}
