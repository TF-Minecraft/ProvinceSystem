// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as potion from "../../../lib/drinks/potionTint";
import * as display from "../../../lib/skins/displayTransform";
import * as extrude from "../../../lib/skins/extrudeItem";
import * as flatDisplay from "../../../lib/skins/flatItemDisplay";
import * as java from "../../../lib/skins/javaModel";
import * as shield from "../../../lib/skins/shieldBlockingDisplay";
import * as steve from "../../../lib/skins/steveMannequin";
import ModelPreview, { type FlatFrames, type GunModels } from "./ModelPreview";

const h = vi.hoisted(() => ({ renderers: [] as unknown[], controls: [] as unknown[] }));
vi.mock("three", async (original) => {
  const real = await original<typeof import("three")>();
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    outputColorSpace = "";
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    constructor() { h.renderers.push(this); }
  }
  return { ...real, WebGLRenderer };
});
vi.mock("three/examples/jsm/controls/OrbitControls.js", async () => {
  const { Vector3 } = await vi.importActual<typeof import("three")>("three");
  class OrbitControls {
    target = new Vector3();
    update = vi.fn();
    dispose = vi.fn();
    constructor(public camera: unknown) { h.controls.push(this); }
  }
  return { OrbitControls };
});
vi.mock("../../../lib/skins/javaModel", () => ({
  buildJavaModelGroup: vi.fn(), loadTextureFromFile: vi.fn(),
  parseJavaModelJson: vi.fn((text: string) => JSON.parse(text)),
  disposeObject3D: vi.fn((obj: THREE.Object3D) => obj.removeFromParent()),
}));
vi.mock("../../../lib/skins/extrudeItem", () => ({
  buildExtrudedItemGroup: vi.fn(), loadImageDataFromFile: vi.fn(),
}));
vi.mock("../../../lib/skins/displayTransform", () => ({
  applyDisplayToObject: vi.fn(), resolveDisplayTab: vi.fn(() => ({ rotation: [1, 2, 3] })),
}));
vi.mock("../../../lib/skins/flatItemDisplay", () => ({
  resolveFlatDisplayTab: vi.fn(() => ({ translation: [1, 2, 3] })),
}));
vi.mock("../../../lib/skins/shieldBlockingDisplay", () => ({
  resolveShieldBlockingTab: vi.fn(() => ({ scale: [2, 2, 2] })),
}));
vi.mock("../../../lib/skins/steveMannequin", () => ({
  createSteveMannequin: vi.fn(), applySteveArmPose: vi.fn(),
  setSteveOuterLayerVisible: vi.fn(), inferArmModelFromTexture: vi.fn(),
  loadSteveTexture: vi.fn(),
}));
vi.mock("../../../lib/drinks/potionTint", () => ({
  composeTintedPotionCanvas: vi.fn(), loadDrinkAssetImages: vi.fn(),
}));

type Renderer = {
  domElement: HTMLCanvasElement; setSize: ReturnType<typeof vi.fn>;
  setPixelRatio: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
};
type Controls = { camera: THREE.PerspectiveCamera; target: THREE.Vector3; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
const renderer = () => h.renderers.at(-1) as Renderer;
const controls = () => h.controls.at(-1) as Controls;
const lastSteve = () => vi.mocked(steve.createSteveMannequin).mock.results.at(-1)!.value as steve.SteveMannequin;
const file = (name: string, body = "{}") => {
  const value = new File([body], name, { lastModified: 123 });
  Object.defineProperty(value, "text", { value: vi.fn(async () => body) });
  return value;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const imageData = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) } as ImageData;
const javaTab = { rotation: [1, 2, 3], translation: [0, 0, 0], scale: [1, 1, 1] } satisfies Required<display.DisplayTab>;
const flatTab = { rotation: [0, 0, 0], translation: [1, 2, 3], scale: [1, 1, 1] } satisfies Required<display.DisplayTab>;
const shieldTab = { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [2, 2, 2] } satisfies Required<display.DisplayTab>;
let frames: FrameRequestCallback[];
let textures: Map<File, THREE.Texture>;
let defaultSkin: THREE.Texture;
let model: File;
let texture: File;
let canvas: HTMLCanvasElement;
function mesh(tex: THREE.Texture) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshBasicMaterial({ map: tex })));
  // A non-textured decoration must not receive the potion's material map.
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial()));
  return group;
}
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function ready() {
  await flush();
  await waitFor(() => { expect(screen.queryByRole("status")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull(); });
  expect(screen.getByText(/Drag to orbit, scroll to zoom\./)).toBeTruthy();
}
async function choose(label: string) { fireEvent.click(screen.getByRole("radio", { name: label })); await ready(); }

beforeEach(() => {
  vi.resetAllMocks();
  h.renderers.length = 0; h.controls.length = 0; frames = []; textures = new Map();
  model = file("model.json", '{"elements":[]}'); texture = file("texture.png");
  defaultSkin = new THREE.Texture(); vi.spyOn(defaultSkin, "dispose");
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => frames.push(cb)));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(java.parseJavaModelJson).mockImplementation((text) => JSON.parse(text));
  vi.mocked(java.disposeObject3D).mockImplementation((obj) => obj.removeFromParent());
  vi.mocked(java.loadTextureFromFile).mockImplementation(async (f) => {
    let tex = textures.get(f);
    if (!tex) { tex = new THREE.Texture(); vi.spyOn(tex, "dispose"); textures.set(f, tex); }
    return { texture: tex, width: 16, height: 16 };
  });
  vi.mocked(java.buildJavaModelGroup).mockImplementation((_json, tex) => mesh(tex));
  vi.mocked(extrude.loadImageDataFromFile).mockImplementation(async (f) => ({ ...await java.loadTextureFromFile(f), imageData }));
  vi.mocked(extrude.buildExtrudedItemGroup).mockImplementation((_image, tex) => mesh(tex));
  vi.mocked(steve.loadSteveTexture).mockResolvedValue(defaultSkin);
  vi.mocked(steve.createSteveMannequin).mockImplementation(() => {
    const group = new THREE.Group() as steve.SteveMannequin;
    group.name = "steveMannequin";
    const bones = {
      itemSocketHead: new THREE.Group(), itemSocketLeft: new THREE.Group(), itemSocketRight: new THREE.Group(),
    } as steve.SteveMannequin["bones"];
    group.bones = bones;
    group.add(bones.itemSocketHead, bones.itemSocketLeft, bones.itemSocketRight);
    return group;
  });
  vi.mocked(steve.inferArmModelFromTexture).mockReturnValue("default");
  vi.mocked(steve.applySteveArmPose).mockImplementation(() => {});
  vi.mocked(steve.setSteveOuterLayerVisible).mockImplementation(() => {});
  vi.mocked(display.resolveDisplayTab).mockReturnValue(javaTab);
  vi.mocked(flatDisplay.resolveFlatDisplayTab).mockReturnValue(flatTab);
  vi.mocked(shield.resolveShieldBlockingTab).mockReturnValue(shieldTab);
  canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
  vi.spyOn(canvas, "getContext").mockReturnValue({ getImageData: () => imageData } as unknown as CanvasRenderingContext2D);
  vi.mocked(potion.composeTintedPotionCanvas).mockReturnValue(canvas);
  vi.mocked(potion.loadDrinkAssetImages).mockResolvedValue({ width: 1, height: 1, overlay: new Image(), bottle: new Image() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { textureFile: null }, { textureFile: file("t.png") },
  { kind: "gun", textureFile: file("t.png") },
  { kind: "gun", textureFile: file("t.png"), gunModels: { carry: null, reload: null, aim: null } },
  { kind: "bow", textureFile: null },
])("shows a useful empty preview for incomplete inputs %#", (props) => {
  render(<ModelPreview {...props} className="test-preview" />);
  expect(screen.getByText("No preview texture loaded.").className).toContain("test-preview");
  expect(h.renderers).toHaveLength(0);
});

it("renders a Java item, attaches both hands, preserves the orbit, resizes and disposes resources", async () => {
  const onError = vi.fn();
  const view = render(<ModelPreview modelFile={model} textureFile={texture} onPreviewError={onError} />);
  expect(screen.getByRole("status")).toBeTruthy(); await ready();
  expect(java.buildJavaModelGroup).toHaveBeenCalledWith({ elements: [] }, textures.get(texture), 16, 16, { center: false });
  expect(lastSteve().bones.itemSocketRight.children[0].name).toBe("heldItem");
  expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), "hold_right", { chargeProgress: undefined });
  controls().camera.position.set(9, 8, 7); controls().target.set(6, 5, 4);
  await choose("Left");
  expect(lastSteve().bones.itemSocketLeft.children[0].name).toBe("heldItem");
  expect(display.applyDisplayToObject).toHaveBeenLastCalledWith(expect.any(THREE.Group), javaTab, { mirrorLeft: true });
  expect(controls().camera.position.toArray()).toEqual([9, 8, 7]);
  expect(controls().target.toArray()).toEqual([6, 5, 4]);
  const host = renderer().domElement.parentElement!;
  Object.defineProperty(host, "clientWidth", { value: 640, configurable: true });
  fireEvent(window, new Event("resize"));
  expect(renderer().setSize).toHaveBeenLastCalledWith(640, 240, false);
  expect(controls().camera.aspect).toBe(640 / 240);
  const tick = frames.at(-1)!; act(() => tick(10));
  expect(renderer().render).toHaveBeenCalledTimes(2);
  await choose("Model");
  expect(java.buildJavaModelGroup).toHaveBeenLastCalledWith({ elements: [] }, textures.get(texture), 16, 16, { center: true });
  expect(screen.queryByLabelText("Preview skin")).toBeNull();
  const r = renderer(); const c = controls();
  view.unmount(); tick(20);
  expect(r.dispose).toHaveBeenCalledOnce(); expect(c.dispose).toHaveBeenCalledOnce();
  expect(r.render).toHaveBeenCalledTimes(2); expect(host.children).toHaveLength(0);
  expect(textures.get(texture)!.dispose).toHaveBeenCalled(); expect(defaultSkin.dispose).toHaveBeenCalled();
  expect(onError).toHaveBeenLastCalledWith(null);
});

it.each(["helmet_3d", "mask"])("supports the head socket for %s", async (kind) => {
  render(<ModelPreview kind={kind} modelFile={model} textureFile={texture} />); await ready();
  await choose("Head");
  expect(lastSteve().bones.itemSocketHead.children[0].name).toBe("heldItem");
  expect(display.resolveDisplayTab).toHaveBeenLastCalledWith({ elements: [] }, "head", kind);
  expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), "idle", { chargeProgress: undefined });
  expect(screen.getByText(/Display: head\./)).toBeTruthy();
});

it("loads an optional player skin, toggles its outer layer and returns to the default skin", async () => {
  render(<ModelPreview kind="item_3d" modelFile={model} textureFile={texture} />); await ready();
  const player = file("my-skin.png");
  fireEvent.change(screen.getByLabelText("Preview skin"), { target: { files: [player] } }); await ready();
  expect(screen.getByText(/Previewing on my-skin.png/)).toBeTruthy();
  expect(steve.createSteveMannequin).toHaveBeenLastCalledWith(textures.get(player), "default");
  fireEvent.click(screen.getByRole("button", { name: "Outer layer" }));
  expect(screen.getByRole("button", { name: "Outer layer" }).getAttribute("aria-pressed")).toBe("false");
  expect(steve.setSteveOuterLayerVisible).toHaveBeenLastCalledWith(lastSteve(), false);
  fireEvent.click(screen.getByRole("button", { name: "Use default" })); await ready();
  expect(textures.get(player)!.dispose).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Preview skin"), { target: { files: [] } }); await ready();
  expect(screen.queryByRole("button", { name: "Use default" })).toBeNull();
});

it("supports both shield stances and resets blocking when switching item kind", async () => {
  const view = render(<ModelPreview kind="shield" modelFile={model} textureFile={texture} />); await ready();
  await choose("Blocking");
  expect(shield.resolveShieldBlockingTab).toHaveBeenLastCalledWith({ elements: [] }, "thirdperson_righthand");
  expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), "shield_block", { chargeProgress: undefined });
  await choose("Left");
  expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), "shield_block_left", { chargeProgress: undefined });
  await choose("Idle");
  expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), "hold_left", { chargeProgress: undefined });
  await choose("Model"); expect(screen.queryByRole("radiogroup", { name: "Shield stance" })).toBeNull();
  view.rerender(<ModelPreview kind="mask" modelFile={model} textureFile={texture} />); await ready();
  await choose("Right"); view.rerender(<ModelPreview kind="shield" modelFile={model} textureFile={texture} />); await ready();
  expect(screen.getByRole("radio", { name: "Idle" }).getAttribute("aria-checked")).toBe("true");
});

it.each(["handheld", "generated", "large_handheld", "book"])("previews a flat %s from its PNG", async (kind) => {
  const view = render(<ModelPreview kind={kind} textureFile={texture} gripY={3} />); await ready();
  expect(extrude.loadImageDataFromFile).toHaveBeenCalledWith(texture);
  expect(extrude.buildExtrudedItemGroup).toHaveBeenCalledWith(imageData, textures.get(texture), { center: false });
  await choose("Left");
  expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), "hold_left", { chargeProgress: undefined });
  const count = vi.mocked(extrude.buildExtrudedItemGroup).mock.calls.length;
  view.rerender(<ModelPreview kind={kind} textureFile={texture} gripY={5.5} />); await ready();
  expect(extrude.buildExtrudedItemGroup).toHaveBeenCalledTimes(count);
  if (kind === "large_handheld") {
    expect(flatDisplay.resolveFlatDisplayTab).toHaveBeenLastCalledWith(kind, "thirdperson_righthand", 5.5);
    expect(display.applyDisplayToObject).toHaveBeenLastCalledWith(expect.any(THREE.Group), flatTab, { mirrorLeft: true });
  }
  await choose("Model");
  expect(extrude.buildExtrudedItemGroup).toHaveBeenLastCalledWith(imageData, textures.get(texture), { center: true });
});

it.each(["bow", "large_bow", "crossbow"])("uses all %s animation frames and mirrored arm poses", async (kind) => {
  const flatFrames: FlatFrames = { texture, pull_0: file("0.png"), pull_1: file("1.png"), pull_2: file("2.png"), charged: file("charged.png") };
  render(<ModelPreview kind={kind} textureFile={null} flatFrames={flatFrames} />); await ready();
  const chips = within(screen.getByRole("radiogroup", { name: "Animation frame" }));
  expect(chips.getAllByRole("radio")).toHaveLength(kind === "crossbow" ? 5 : 4);
  for (const hand of ["Right", "Left"]) {
    await choose(hand);
    for (const [idx, label] of ["Pull 0", "Pull 1", "Pull 2"].entries()) {
      await choose(label);
      expect(extrude.loadImageDataFromFile).toHaveBeenLastCalledWith(flatFrames[`pull_${idx}` as keyof FlatFrames]);
      const left = hand === "Left";
      expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(),
        kind === "crossbow" ? (left ? "crossbow_charge_left" : "crossbow_charge") : (left ? "bow_pull_left" : "bow_pull"),
        { chargeProgress: kind === "crossbow" ? idx / 2 : undefined });
    }
    if (kind === "crossbow") {
      await choose("Charged");
      expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), hand === "Left" ? "crossbow_hold_left" : "crossbow_hold", { chargeProgress: undefined });
    }
    await choose("Standby");
    expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), hand === "Left" ? "hold_left" : "hold_right", { chargeProgress: undefined });
  }
});

it("selects the remaining frame when the current frame disappears", async () => {
  const pull = file("pull.png");
  const view = render(<ModelPreview kind="bow" textureFile={texture} flatFrames={{ texture, pull_0: pull }} />); await ready();
  await choose("Pull 0");
  view.rerender(<ModelPreview kind="bow" textureFile={null} flatTextureFile={texture} />); await ready();
  expect(extrude.loadImageDataFromFile).toHaveBeenLastCalledWith(texture);
  expect(screen.queryByRole("radiogroup", { name: "Animation frame" })).toBeNull();
  view.rerender(<ModelPreview kind="bow" textureFile={null} flatFrames={{ pull_1: pull }} />); await ready();
  expect(extrude.loadImageDataFromFile).toHaveBeenLastCalledWith(pull);
});

it("previews all gun variants with the corresponding model and arm poses", async () => {
  const gunModels: GunModels = { carry: model, reload: file("reload.json"), aim: file("aim.json") };
  render(<ModelPreview kind="gun" textureFile={texture} gunModels={gunModels} />); await ready();
  expect(screen.getAllByRole("radio")).toHaveLength(7);
  for (const [variant, label] of [["carry", "Carry"], ["reload", "Reload"], ["aim", "Aim"]] as const) {
    for (const hand of ["Right", "Left"]) {
      await choose(`${label} (${hand})`);
      expect(gunModels[variant]!.text).toHaveBeenCalled();
      expect(steve.applySteveArmPose).toHaveBeenLastCalledWith(lastSteve(), variant === "aim"
        ? (hand === "Left" ? "crossbow_hold_left" : "crossbow_hold")
        : (hand === "Left" ? "hold_left" : "hold_right"), { chargeProgress: undefined });
    }
  }
  await choose("Model"); expect(java.buildJavaModelGroup).toHaveBeenLastCalledWith({ elements: [] }, textures.get(texture), 16, 16, { center: true });
});

it.each(["carry", "reload", "aim"] as const)("only offers available gun slots and falls back to %s", async (variant) => {
  const gunModels: GunModels = { carry: null, reload: null, aim: null, [variant]: model };
  render(<ModelPreview kind="gun" textureFile={texture} gunModels={gunModels} />); await ready();
  expect(screen.getAllByRole("radio").map((el) => el.textContent)).toEqual(["Model", `${variant[0].toUpperCase()}${variant.slice(1)} (Right)`, `${variant[0].toUpperCase()}${variant.slice(1)} (Left)`]);
  await choose("Model"); expect(model.text).toHaveBeenCalled();
});

it("resets a removed gun variant to carry and resets a removed head slot to the right hand", async () => {
  const view = render(<ModelPreview kind="mask" textureFile={texture} modelFile={model} />); await ready(); await choose("Head");
  view.rerender(<ModelPreview kind="item_3d" textureFile={texture} modelFile={model} />); await ready();
  expect(screen.getByRole("radio", { name: "Right" }).getAttribute("aria-checked")).toBe("true");
  view.rerender(<ModelPreview kind="gun" textureFile={texture} gunModels={{ carry: model, reload: model, aim: null }} />); await ready();
  await choose("Reload (Left)");
  view.rerender(<ModelPreview kind="gun" textureFile={texture} gunModels={{ carry: model, reload: null, aim: null }} />); await ready();
  expect(screen.getByRole("radio", { name: "Carry (Right)" }).getAttribute("aria-checked")).toBe("true");
});

it.each([new Error("Bad Java model"), null])("reports mesh build failures %#", async (error) => {
  vi.mocked(java.loadTextureFromFile).mockRejectedValue(error);
  const onError = vi.fn();
  render(<ModelPreview modelFile={model} textureFile={texture} onPreviewError={onError} />); await flush();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", error instanceof Error ? error.message : "Could not build preview");
  expect(onError).toHaveBeenLastCalledWith(error instanceof Error ? error.message : "Could not build preview");
});

it.each([new Error("Bad player skin"), null])("reports mannequin layout failures %#", async (error) => {
  vi.mocked(steve.loadSteveTexture).mockRejectedValue(error);
  render(<ModelPreview modelFile={model} textureFile={texture} />); await flush();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", error instanceof Error ? error.message : "Could not update preview");
});

it.each(["java", "flat", "potion"])("releases loaded textures if %s geometry cannot be built", async (kind) => {
  const disposed = vi.fn();
  const fail = (_data: unknown, tex: THREE.Texture): never => {
    tex.addEventListener("dispose", disposed);
    throw new Error("Invalid geometry");
  };
  vi.mocked(java.buildJavaModelGroup).mockImplementation(fail);
  vi.mocked(extrude.buildExtrudedItemGroup).mockImplementation(fail);
  render(kind === "java" ? <ModelPreview modelFile={model} textureFile={texture} />
    : <ModelPreview kind="generated" textureFile={texture}
      flatDisplayPreset={kind === "potion" ? "generated" : undefined}
      potionTintColor={kind === "potion" ? "#abcdef" : undefined} />);
  await flush();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid geometry");
  expect(disposed).toHaveBeenCalledOnce();
});

it.each([false, true])("ignores superseded model loading and disposes late meshes (error=%s)", async (fails) => {
  const old = deferred<Awaited<ReturnType<typeof java.loadTextureFromFile>>>();
  vi.mocked(java.loadTextureFromFile).mockReturnValueOnce(old.promise);
  const view = render(<ModelPreview modelFile={model} textureFile={texture} />); await flush();
  const next = file("next.png");
  view.rerender(<ModelPreview modelFile={model} textureFile={next} />); await ready();
  const lateTexture = new THREE.Texture(); vi.spyOn(lateTexture, "dispose");
  await act(async () => { if (fails) old.reject(new Error("outdated")); else old.resolve({ texture: lateTexture, width: 16, height: 16 }); });
  await ready();
  if (!fails) expect(lateTexture.dispose).toHaveBeenCalledOnce();
});

it.each([false, true])("ignores superseded default-skin loading (error=%s)", async (fails) => {
  const old = deferred<THREE.Texture | null>(); vi.mocked(steve.loadSteveTexture).mockReturnValueOnce(old.promise);
  render(<ModelPreview kind="item_3d" modelFile={model} textureFile={texture} />); await flush();
  const player = file("player.png"); fireEvent.change(screen.getByLabelText("Preview skin"), { target: { files: [player] } }); await ready();
  await act(async () => { if (fails) old.reject(new Error("outdated")); else old.resolve(defaultSkin); });
  await ready(); if (!fails) expect(defaultSkin.dispose).toHaveBeenCalled();
});

it("disposes an obsolete custom skin and accepts a missing default texture", async () => {
  render(<ModelPreview modelFile={model} textureFile={texture} />); await ready();
  const old = deferred<Awaited<ReturnType<typeof java.loadTextureFromFile>>>();
  vi.mocked(java.loadTextureFromFile).mockReturnValueOnce(old.promise);
  fireEvent.change(screen.getByLabelText("Preview skin"), { target: { files: [file("slow.png")] } }); await flush();
  vi.mocked(steve.loadSteveTexture).mockResolvedValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Use default" })); await ready();
  expect(steve.createSteveMannequin).toHaveBeenLastCalledWith(null, "default");
  const tex = new THREE.Texture(); vi.spyOn(tex, "dispose");
  await act(async () => old.resolve({ texture: tex, width: 64, height: 64 })); await ready();
  expect(tex.dispose).toHaveBeenCalledOnce();
});

it("renders tinted potions with pixel filtering and updates every textured mesh", async () => {
  render(<ModelPreview kind="generated" flatDisplayPreset="generated" textureFile={null} potionTintColor="#abcdef" />); await ready();
  expect(potion.loadDrinkAssetImages).toHaveBeenCalledOnce();
  const tex = vi.mocked(extrude.buildExtrudedItemGroup).mock.calls[0][1];
  expect(tex).toMatchObject({ magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, flipY: false, generateMipmaps: false });
  const root = vi.mocked(extrude.buildExtrudedItemGroup).mock.results[0].value;
  expect((root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.map).toBe(tex);
});

it.each(["invalid", "context", "load"])("reports invalid potion assets: %s", async (mode) => {
  if (mode === "invalid") vi.mocked(potion.composeTintedPotionCanvas).mockReturnValue(null);
  if (mode === "context") vi.mocked(canvas.getContext).mockReturnValue(null);
  if (mode === "load") vi.mocked(potion.loadDrinkAssetImages).mockRejectedValue(new Error("Assets unavailable"));
  render(<ModelPreview kind="generated" flatDisplayPreset="generated" textureFile={null} potionTintColor="#abcdef" />); await flush();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", mode === "invalid" ? "Invalid potion color" : mode === "context" ? "Could not read potion canvas" : "Assets unavailable");
});

it("reports a potion tint update error without crashing the viewer", async () => {
  vi.mocked(potion.composeTintedPotionCanvas).mockImplementationOnce(() => canvas).mockImplementation(() => { throw new Error("Tint failure"); });
  const onError = vi.fn();
  render(<ModelPreview kind="generated" flatDisplayPreset="generated" textureFile={null} potionTintColor="#abcdef" onPreviewError={onError} />); await flush();
  expect(onError).toHaveBeenCalledWith("Could not update potion color");
});

it("ignores a null canvas during a potion texture update", async () => {
  vi.mocked(potion.composeTintedPotionCanvas).mockReturnValueOnce(canvas).mockReturnValue(null);
  render(<ModelPreview kind="generated" flatDisplayPreset="generated" textureFile={null} potionTintColor="#abcdef" />); await ready();
});

it("disposes a mesh that finishes loading after the preview unmounts", async () => {
  const pending = deferred<Awaited<ReturnType<typeof java.loadTextureFromFile>>>();
  vi.mocked(java.loadTextureFromFile).mockReturnValueOnce(pending.promise);
  const view = render(<ModelPreview modelFile={model} textureFile={texture} />); await flush(); view.unmount();
  const tex = new THREE.Texture(); vi.spyOn(tex, "dispose");
  await act(async () => pending.resolve({ texture: tex, width: 16, height: 16 })); await flush();
  expect(tex.dispose).toHaveBeenCalledOnce();
  expect(java.disposeObject3D).toHaveBeenCalledWith(vi.mocked(java.buildJavaModelGroup).mock.results.at(-1)!.value);
});

it("changes a potion's tint without rebuilding its geometry or resetting the orbit", async () => {
  const view = render(<ModelPreview kind="generated" flatDisplayPreset="generated" textureFile={null} potionTintColor="#abcdef" />); await ready();
  const builds = vi.mocked(extrude.buildExtrudedItemGroup).mock.calls.length;
  controls().camera.position.set(9, 8, 7);
  view.rerender(<ModelPreview kind="generated" flatDisplayPreset="generated" textureFile={null} potionTintColor="#123456" />); await ready();
  expect(extrude.buildExtrudedItemGroup).toHaveBeenCalledTimes(builds);
  expect(controls().camera.position.toArray()).toEqual([9, 8, 7]);
  expect(potion.composeTintedPotionCanvas).toHaveBeenLastCalledWith("#123456", expect.any(Object));
});
