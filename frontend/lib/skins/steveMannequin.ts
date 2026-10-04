import * as THREE from "three";

export type ArmModel = "default" | "slim";

/**
 * Hand slot frame — where the entity holds the item (arm-local tip + Rx(-90)/Rz(180)
 * + local). Independent of MODEL_WORKSPACE_ORIGIN on the Java mesh. Tune tip/local
 * vs Blockbench with identity display.
 */
export const HAND_SOCKET = {
  /** Arm-local: -Y toward fingers (out), +Z up before hand Rx/Rz. */
  tip: [0, -6, 2] as [number, number, number],
  local: [0, 0, 0] as [number, number, number],
};

/**
 * Head slot frame — tip on the head bone + local + Ry. Independent of model
 * workspace origin on the Java mesh.
 *
 * `scale` matches Blockbench/vanilla head-item frame (0.625). JSON display.head
 * scale stacks on top (e.g. 1.4 → effective 0.875).
 */
export const HEAD_SOCKET = {
  tip: [0, 4.5, 0] as [number, number, number],
  /** Further down from tip (head-local Y). */
  local: [0, 0, 0] as [number, number, number],
  scale: 0.625,
  /** Degrees about vertical (Y). */
  rotationY: 180,
};

export type SteveMannequin = THREE.Group & {
  armModel: ArmModel;
  bones: {
    head: THREE.Group;
    body: THREE.Group;
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Group;
    rightLeg: THREE.Group;
    itemSocketRight: THREE.Group;
    itemSocketLeft: THREE.Group;
    itemSocketHead: THREE.Group;
  };
};

/**
 * UV layout matching skinview3d / Minecraft classic skins.
 * BoxGeometry face order: +X -X +Y -Y +Z -Z.
 */
function setSkinUVs(
  box: THREE.BoxGeometry,
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  textureWidth = 64,
  textureHeight = 64
): void {
  const toFaceVertices = (x1: number, y1: number, x2: number, y2: number) => [
    new THREE.Vector2(x1 / textureWidth, 1.0 - y2 / textureHeight),
    new THREE.Vector2(x2 / textureWidth, 1.0 - y2 / textureHeight),
    new THREE.Vector2(x2 / textureWidth, 1.0 - y1 / textureHeight),
    new THREE.Vector2(x1 / textureWidth, 1.0 - y1 / textureHeight),
  ];

  const top = toFaceVertices(u + depth, v, u + width + depth, v + depth);
  const bottom = toFaceVertices(
    u + width + depth,
    v,
    u + width * 2 + depth,
    v + depth
  );
  const left = toFaceVertices(u, v + depth, u + depth, v + depth + height);
  const front = toFaceVertices(
    u + depth,
    v + depth,
    u + width + depth,
    v + depth + height
  );
  const right = toFaceVertices(
    u + width + depth,
    v + depth,
    u + width + depth * 2,
    v + height + depth
  );
  const back = toFaceVertices(
    u + width + depth * 2,
    v + depth,
    u + width * 2 + depth * 2,
    v + height + depth
  );

  const uvRight = [right[3], right[2], right[0], right[1]];
  const uvLeft = [left[3], left[2], left[0], left[1]];
  const uvTop = [top[3], top[2], top[0], top[1]];
  const uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]];
  const uvFront = [front[3], front[2], front[0], front[1]];
  const uvBack = [back[3], back[2], back[0], back[1]];

  const uvAttr = box.getAttribute("uv") as THREE.BufferAttribute;
  const data: number[] = [];
  for (const face of [uvRight, uvLeft, uvTop, uvBottom, uvFront, uvBack]) {
    for (const uv of face) {
      data.push(uv.x, uv.y);
    }
  }
  uvAttr.set(new Float32Array(data));
  uvAttr.needsUpdate = true;
}

function makeBox(
  size: [number, number, number],
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  skinLayer: 1 | 2 = 1
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  setSkinUVs(geo, u, v, width, height, depth);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.skinLayer = skinLayer;
  return mesh;
}

/** Show/hide Minecraft skin outer layer (hat, jacket, sleeves, pants). */
export function setSteveOuterLayerVisible(
  root: THREE.Object3D,
  visible: boolean
): void {
  root.traverse((obj) => {
    if (obj.userData.skinLayer === 2) {
      obj.visible = visible;
    }
  });
}

export type ArmorPiece = "helmet" | "chest" | "arm" | "boot" | "legging";

/** Show/hide flat armor helmet meshes (hide when a 3D helmet is attached). */
export function setArmorHelmetVisible(
  root: THREE.Object3D,
  visible: boolean
): void {
  root.traverse((obj) => {
    if (obj.userData.armorPiece === "helmet") {
      obj.visible = visible;
    }
  });
}

/** Remove armour overlay meshes from the mannequin. */
export function clearSteveArmorOverlay(root: THREE.Object3D): void {
  const toRemove: THREE.Object3D[] = [];
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (!obj.userData.armorPiece) return;
    toRemove.push(obj);
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
      else materials.add(mat);
    }
  });
  for (const obj of toRemove) {
    obj.parent?.remove(obj);
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  }
  for (const mat of materials) mat.dispose();
}

function makeArmorBox(
  size: [number, number, number],
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  piece: ArmorPiece,
  armorLayer: 1 | 2
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  setSkinUVs(geo, u, v, width, height, depth, 64, 32);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.armorPiece = piece;
  mesh.userData.armorLayer = armorLayer;
  mesh.name = `armor_${piece}_l${armorLayer}`;
  return mesh;
}

function armorMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  });
}

function limbPivot(bone: THREE.Group): THREE.Object3D {
  const pivot = bone.children.find(
    (c) =>
      c instanceof THREE.Group &&
      typeof c.name === "string" &&
      !c.name.startsWith("itemSocket")
  );
  return pivot ?? bone;
}

/**
 * Attach vanilla 64×32 armor overlays.
 * layer_1 → outer armor model (CubeDeformation 1.0): helm, chest, arms, boots.
 * layer_2 → inner armor model (CubeDeformation 0.5): leggings (+ waist).
 * Outside the player skin outer layer (≈0.25–0.5 dilation).
 */
export function attachSteveArmorOverlay(
  root: SteveMannequin,
  layer1: THREE.Texture | null,
  layer2: THREE.Texture | null
): void {
  clearSteveArmorOverlay(root);
  const { head, body, leftArm, rightArm, leftLeg, rightLeg } = root.bones;
  const slim = root.armModel === "slim";
  // Outer armor: base size + 2×1.0 dilation
  const armBase = slim ? 3 : 4;
  const outerArm: [number, number, number] = [armBase + 2, 14, 6];
  const outerLeg: [number, number, number] = [6, 14, 6];
  const outerBody: [number, number, number] = [10, 14, 6];
  // Inner armor: base + 2×0.5
  const innerLeg: [number, number, number] = [5, 13, 5];
  const innerBody: [number, number, number] = [9, 13, 5];

  if (layer2) {
    // Inner first (leggings sit under boots on the legs).
    const mat = armorMaterial(layer2);
    const matBias = mat.clone();
    matBias.polygonOffset = true;
    matBias.polygonOffsetFactor = 1;
    matBias.polygonOffsetUnits = 1;

    body.add(
      makeArmorBox(innerBody, 16, 16, 8, 12, 4, mat, "legging", 2)
    );
    limbPivot(rightLeg).add(
      makeArmorBox(innerLeg, 0, 16, 4, 12, 4, matBias, "legging", 2)
    );
    limbPivot(leftLeg).add(
      makeArmorBox(innerLeg, 0, 16, 4, 12, 4, matBias, "legging", 2)
    );
  }

  if (layer1) {
    const mat = armorMaterial(layer1);
    const matBias = mat.clone();
    matBias.polygonOffset = true;
    matBias.polygonOffsetFactor = -1;
    matBias.polygonOffsetUnits = -1;

    const helm = makeArmorBox([10, 10, 10], 0, 0, 8, 8, 8, mat, "helmet", 1);
    helm.position.y = 4;
    head.add(helm);

    body.add(makeArmorBox(outerBody, 16, 16, 8, 12, 4, mat, "chest", 1));

    limbPivot(rightArm).add(
      makeArmorBox(outerArm, 40, 16, armBase, 12, 4, matBias, "arm", 1)
    );
    limbPivot(leftArm).add(
      makeArmorBox(outerArm, 40, 16, armBase, 12, 4, matBias, "arm", 1)
    );

    limbPivot(rightLeg).add(
      makeArmorBox(outerLeg, 0, 16, 4, 12, 4, matBias, "boot", 1)
    );
    limbPivot(leftLeg).add(
      makeArmorBox(outerLeg, 0, 16, 4, 12, 4, matBias, "boot", 1)
    );
  }
}


function fallbackMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xc68660,
    transparent: false,
  });
}

function computeSkinScale(width: number): number {
  return width / 64;
}

function hasTransparency(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number
): boolean {
  const imgData = ctx.getImageData(x0, y0, w, h);
  for (let i = 3; i < imgData.data.length; i += 4) {
    if (imgData.data[i] !== 0xff) return true;
  }
  return false;
}

function isAreaBlack(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number
): boolean {
  const imgData = ctx.getImageData(x0, y0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    if (
      imgData.data[i] !== 0 ||
      imgData.data[i + 1] !== 0 ||
      imgData.data[i + 2] !== 0 ||
      imgData.data[i + 3] !== 0xff
    ) {
      return false;
    }
  }
  return true;
}

function isAreaWhite(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number
): boolean {
  const imgData = ctx.getImageData(x0, y0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    if (
      imgData.data[i] !== 0xff ||
      imgData.data[i + 1] !== 0xff ||
      imgData.data[i + 2] !== 0xff ||
      imgData.data[i + 3] !== 0xff
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Auto-detect slim vs classic arms (same rules as skinview-utils inferModelType).
 * Checks the 2px strips that classic arms use but slim leaves unused.
 */
export function inferArmModel(
  source: CanvasImageSource & { width: number; height: number }
): ArmModel {
  const width = source.width;
  const height = source.height;
  if (!width || !height || width < 64 || height < 32) return "default";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "default";
  ctx.drawImage(source, 0, 0);

  const scale = computeSkinScale(width);
  const checkTransparency = (x: number, y: number, w: number, h: number) =>
    hasTransparency(ctx, x * scale, y * scale, w * scale, h * scale);
  const checkBlack = (x: number, y: number, w: number, h: number) =>
    isAreaBlack(ctx, x * scale, y * scale, w * scale, h * scale);
  const checkWhite = (x: number, y: number, w: number, h: number) =>
    isAreaWhite(ctx, x * scale, y * scale, w * scale, h * scale);

  const isSlim =
    checkTransparency(50, 16, 2, 4) ||
    checkTransparency(54, 20, 2, 12) ||
    checkTransparency(42, 48, 2, 4) ||
    checkTransparency(46, 52, 2, 12) ||
    (checkBlack(50, 16, 2, 4) &&
      checkBlack(54, 20, 2, 12) &&
      checkBlack(42, 48, 2, 4) &&
      checkBlack(46, 52, 2, 12)) ||
    (checkWhite(50, 16, 2, 4) &&
      checkWhite(54, 20, 2, 12) &&
      checkWhite(42, 48, 2, 4) &&
      checkWhite(46, 52, 2, 12));

  return isSlim ? "slim" : "default";
}

export function inferArmModelFromTexture(texture: THREE.Texture | null): ArmModel {
  if (!texture?.image) return "default";
  const img = texture.image as { width?: number; height?: number };
  if (
    typeof img.width === "number" &&
    typeof img.height === "number" &&
    (img instanceof HTMLImageElement ||
      img instanceof HTMLCanvasElement ||
      (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap))
  ) {
    return inferArmModel(
      img as CanvasImageSource & { width: number; height: number }
    );
  }
  return "default";
}

/**
 * Classic / slim Steve + outer layer (skinview3d / Minecraft layout).
 * Units: 1 = 1 pixel = 1/16 block. Feet at y=0.
 * Pass armModel explicitly, or omit to auto-detect from the texture.
 */
export function createSteveMannequin(
  texture: THREE.Texture | null,
  armModel?: ArmModel
): SteveMannequin {
  const model = armModel ?? inferArmModelFromTexture(texture);
  const slim = model === "slim";
  const armW = slim ? 3 : 4;
  const armOuter = slim ? 3.5 : 4.5;
  const armPivotX = slim ? 0.5 : 1;
  const armPivotY = slim ? -4.5 : -4;

  const root = new THREE.Group() as SteveMannequin;
  root.name = "steveMannequin";
  root.armModel = model;

  // skinview3d SkinObject is centered with feet at -16; shift so feet sit on y=0.
  const skin = new THREE.Group();
  skin.name = "skin";
  skin.position.y = 16;
  root.add(skin);

  let layer1: THREE.MeshBasicMaterial;
  let layer1Biased: THREE.MeshBasicMaterial;
  let layer2: THREE.MeshBasicMaterial;
  let layer2Biased: THREE.MeshBasicMaterial;

  if (texture) {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.needsUpdate = true;

    layer1 = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.FrontSide,
    });
    layer1Biased = layer1.clone();
    layer1Biased.polygonOffset = true;
    layer1Biased.polygonOffsetFactor = 1;
    layer1Biased.polygonOffsetUnits = 1;

    layer2 = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 1e-5,
      side: THREE.DoubleSide,
    });
    layer2Biased = layer2.clone();
    layer2Biased.polygonOffset = true;
    layer2Biased.polygonOffsetFactor = 1;
    layer2Biased.polygonOffsetUnits = 1;
  } else {
    layer1 = fallbackMaterial();
    layer1Biased = layer1;
    layer2 = fallbackMaterial();
    layer2Biased = layer2;
  }

  const head = new THREE.Group();
  head.name = "head";
  const headInner = makeBox([8, 8, 8], 0, 0, 8, 8, 8, layer1);
  const headOuter = makeBox([9, 9, 9], 32, 0, 8, 8, 8, layer2, 2);
  headInner.position.y = 4;
  headOuter.position.y = 4;
  head.add(headInner, headOuter);
  // Head slot frame: tip + local + Ry + 0.625 frame scale. JSON display on held child.
  const itemSocketHead = new THREE.Group();
  itemSocketHead.name = "itemSocketHead";
  itemSocketHead.position.set(...HEAD_SOCKET.tip);
  itemSocketHead.translateX(HEAD_SOCKET.local[0]);
  itemSocketHead.translateY(HEAD_SOCKET.local[1]);
  itemSocketHead.translateZ(HEAD_SOCKET.local[2]);
  itemSocketHead.rotation.y = THREE.MathUtils.degToRad(HEAD_SOCKET.rotationY);
  itemSocketHead.scale.setScalar(HEAD_SOCKET.scale);
  head.add(itemSocketHead);
  skin.add(head);

  const body = new THREE.Group();
  body.name = "body";
  body.position.y = -6;
  body.add(
    makeBox([8, 12, 4], 16, 16, 8, 12, 4, layer1),
    makeBox([8.5, 12.5, 4.5], 16, 32, 8, 12, 4, layer2, 2)
  );
  skin.add(body);

  const rightArm = new THREE.Group();
  rightArm.name = "rightArm";
  rightArm.position.set(-5, -2, 0);
  // Default idle (arms down); applySteveArmPose raises the holding arm when needed.
  rightArm.rotation.x = 0;
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(-armPivotX, armPivotY, 0);
  rightArmPivot.add(
    makeBox([armW, 12, 4], 40, 16, armW, 12, 4, layer1Biased),
    makeBox([armOuter, 12.5, 4.5], 40, 32, armW, 12, 4, layer2Biased, 2)
  );
  rightArm.add(rightArmPivot);

  // Slot frame (right arm): tip + Rx(-90)/Rz(180) + local. JSON display on held child.
  const handSocketRot = new THREE.Euler(
    THREE.MathUtils.degToRad(-90),
    0,
    THREE.MathUtils.degToRad(180),
    "XYZ"
  );
  const itemSocketRight = new THREE.Group();
  itemSocketRight.name = "itemSocketRight";
  itemSocketRight.position.set(...HAND_SOCKET.tip);
  itemSocketRight.rotation.copy(handSocketRot);
  itemSocketRight.translateX(HAND_SOCKET.local[0]);
  itemSocketRight.translateY(HAND_SOCKET.local[1]);
  itemSocketRight.translateZ(HAND_SOCKET.local[2]);
  rightArmPivot.add(itemSocketRight);
  skin.add(rightArm);

  const leftArm = new THREE.Group();
  leftArm.name = "leftArm";
  leftArm.position.set(5, -2, 0);
  leftArm.rotation.x = 0;
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(armPivotX, armPivotY, 0);
  leftArmPivot.add(
    makeBox([armW, 12, 4], 32, 48, armW, 12, 4, layer1Biased),
    makeBox([armOuter, 12.5, 4.5], 48, 48, armW, 12, 4, layer2Biased, 2)
  );
  leftArm.add(leftArmPivot);

  // Left slot frame: same HAND_SOCKET, parented to the left arm.
  const itemSocketLeft = new THREE.Group();
  itemSocketLeft.name = "itemSocketLeft";
  itemSocketLeft.position.set(...HAND_SOCKET.tip);
  itemSocketLeft.rotation.copy(handSocketRot);
  itemSocketLeft.translateX(HAND_SOCKET.local[0]);
  itemSocketLeft.translateY(HAND_SOCKET.local[1]);
  itemSocketLeft.translateZ(HAND_SOCKET.local[2]);
  leftArmPivot.add(itemSocketLeft);
  skin.add(leftArm);

  const rightLeg = new THREE.Group();
  rightLeg.name = "rightLeg";
  rightLeg.position.set(-1.9, -12, -0.1);
  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.y = -6;
  rightLegPivot.add(
    makeBox([4, 12, 4], 0, 16, 4, 12, 4, layer1Biased),
    makeBox([4.5, 12.5, 4.5], 0, 32, 4, 12, 4, layer2Biased, 2)
  );
  rightLeg.add(rightLegPivot);
  skin.add(rightLeg);

  const leftLeg = new THREE.Group();
  leftLeg.name = "leftLeg";
  leftLeg.position.set(1.9, -12, -0.1);
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.y = -6;
  leftLegPivot.add(
    makeBox([4, 12, 4], 16, 48, 4, 12, 4, layer1Biased),
    makeBox([4.5, 12.5, 4.5], 0, 48, 4, 12, 4, layer2Biased, 2)
  );
  leftLeg.add(leftLegPivot);
  skin.add(leftLeg);

  root.bones = {
    head,
    body,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    itemSocketRight,
    itemSocketLeft,
    itemSocketHead,
  };

  return root;
}

export type SteveArmPose =
  | "idle"
  | "hold_right"
  | "hold_left"
  | "bow_pull"
  | "bow_pull_left"
  | "crossbow_hold"
  | "crossbow_hold_left"
  | "crossbow_charge"
  | "crossbow_charge_left"
  | "shield_block"
  | "shield_block_left";

/**
 * Third-person arm poses for the mannequin.
 * Lateral fold uses roll (Z), not yaw — our arm frame twists on Y.
 *
 * @param chargeProgress 0–1 for crossbow_charge* (pull_0→pull_2); ignored otherwise.
 */
export function applySteveArmPose(
  root: SteveMannequin,
  pose: SteveArmPose,
  options?: { chargeProgress?: number }
): void {
  const { leftArm, rightArm } = root.bones;
  const holdX = THREE.MathUtils.degToRad(-22.5);
  const g = Math.min(1, Math.max(0, options?.chargeProgress ?? 1));

  if (pose === "shield_block") {
    // Holding arm raised across the body; other arm down (not crossbow aim).
    rightArm.rotation.set(-1.1, 0, 0.55);
    leftArm.rotation.set(0, 0, 0);
    return;
  }
  if (pose === "shield_block_left") {
    leftArm.rotation.set(-1.1, 0, -0.55);
    rightArm.rotation.set(0, 0, 0);
    return;
  }
  if (pose === "crossbow_hold") {
    // CrossbowPosing.hold — aimed / charged.
    rightArm.rotation.set(-Math.PI / 2 + 0.1, 0, 0.3);
    leftArm.rotation.set(-1.5, 0, -0.6);
    return;
  }
  if (pose === "crossbow_hold_left") {
    leftArm.rotation.set(-Math.PI / 2 + 0.1, 0, -0.3);
    rightArm.rotation.set(-1.5, 0, 0.6);
    return;
  }
  if (pose === "crossbow_charge") {
    // Reload: arms angled down. Left (pull) arm: out → mid → stronger in.
    const holdPitch = -0.7;
    const holdZ = 0.35;
    // Keyframes: pull_0 / pull_1 / pull_2 (g = 0 / 0.5 / 1)
    const pullPitch =
      g <= 0.5
        ? THREE.MathUtils.lerp(-0.55, -0.9, g * 2)
        : THREE.MathUtils.lerp(-0.9, -0.95, (g - 0.5) * 2);
    const pullZ =
      g <= 0.5
        ? THREE.MathUtils.lerp(-0.4, -0.65, g * 2) // pull_1 = former pull_2
        : THREE.MathUtils.lerp(-0.65, -1.05, (g - 0.5) * 2);
    rightArm.rotation.set(holdPitch, 0, holdZ);
    leftArm.rotation.set(pullPitch, 0, pullZ);
    return;
  }
  if (pose === "crossbow_charge_left") {
    const holdPitch = -0.7;
    const holdZ = -0.35;
    const pullPitch =
      g <= 0.5
        ? THREE.MathUtils.lerp(-0.55, -0.9, g * 2)
        : THREE.MathUtils.lerp(-0.9, -0.95, (g - 0.5) * 2);
    const pullZ =
      g <= 0.5
        ? THREE.MathUtils.lerp(0.4, 0.65, g * 2)
        : THREE.MathUtils.lerp(0.65, 1.05, (g - 0.5) * 2);
    leftArm.rotation.set(holdPitch, 0, holdZ);
    rightArm.rotation.set(pullPitch, 0, pullZ);
    return;
  }
  if (pose === "bow_pull") {
    // BOW_AND_ARROW-style: both arms forward, fold toward center on Z.
    rightArm.rotation.set(-Math.PI / 2 + 0.2, 0, 0.25);
    leftArm.rotation.set(-Math.PI / 2 + 0.35, 0, -0.55);
    return;
  }
  if (pose === "bow_pull_left") {
    leftArm.rotation.set(-Math.PI / 2 + 0.2, 0, -0.25);
    rightArm.rotation.set(-Math.PI / 2 + 0.35, 0, 0.55);
    return;
  }
  if (pose === "hold_right") {
    rightArm.rotation.set(holdX, 0, 0);
    leftArm.rotation.set(0, 0, 0);
    return;
  }
  if (pose === "hold_left") {
    leftArm.rotation.set(holdX, 0, 0);
    rightArm.rotation.set(0, 0, 0);
    return;
  }
  rightArm.rotation.set(0, 0, 0);
  leftArm.rotation.set(0, 0, 0);
}

export function loadSteveTexture(
  url = "/skins/skin.png"
): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => resolve(tex),
      undefined,
      () => resolve(null)
    );
  });
}
