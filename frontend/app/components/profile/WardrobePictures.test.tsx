/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSkinThumbnail } from "../../../lib/skins/api";
import { getDrinkTexture } from "../../../lib/drinks/api";
import { composeTintedPotionCanvas, loadDrinkAssetImages, type DrinkAssetImages } from "../../../lib/drinks/potionTint";
import { DrinkPicture, SkinPicture } from "./WardrobePictures";

vi.mock("../../../lib/skins/api", () => ({ getSkinThumbnail: vi.fn() }));
vi.mock("../../../lib/drinks/api", () => ({ getDrinkTexture: vi.fn() }));
vi.mock("../../../lib/drinks/potionTint", () => ({
  composeTintedPotionCanvas: vi.fn(),
  loadDrinkAssetImages: vi.fn(),
}));

const probes: HTMLImageElement[] = [];
const revoke = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function placeholder(container: HTMLElement) {
  return container.querySelector("span[aria-hidden='true']");
}

beforeEach(() => {
  probes.length = 0;
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    Object.defineProperty(image, "naturalWidth", { value: 32 });
    probes.push(image);
    return image;
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = revoke;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a decorative skin placeholder until the thumbnail decodes", async () => {
  const pending = deferred<string | null>();
  vi.mocked(getSkinThumbnail).mockReturnValueOnce(pending.promise);
  const { container, unmount } = render(<SkinPicture id="skin" sessionToken="owner" />);
  expect(placeholder(container)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();

  await act(async () => pending.resolve("blob:skin"));
  expect(placeholder(container)).toBeTruthy();
  fireEvent.load(probes[0]);
  expect(placeholder(container)).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:skin");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:skin");
});

it.each(["missing", "request failure", "decode failure"])(
  "replaces the skin placeholder with a hanger on %s",
  async (failure) => {
    const pending = deferred<string | null>();
    vi.mocked(getSkinThumbnail).mockReturnValueOnce(pending.promise);
    const { container } = render(<SkinPicture id="skin" sessionToken="owner" />);
    await act(async () => {
      if (failure === "request failure") pending.reject(new Error("unavailable"));
      else pending.resolve(failure === "missing" ? null : "blob:skin");
    });
    if (failure === "decode failure") fireEvent.error(probes[0]);
    expect(placeholder(container)).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  },
);

it("fills the drink frame until its texture arrives", async () => {
  const pending = deferred<string | null>();
  vi.mocked(getDrinkTexture).mockReturnValueOnce(pending.promise);
  const { container } = render(<DrinkPicture id="drink" color={null} sessionToken="owner" />);
  expect(placeholder(container)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => pending.resolve("blob:drink"));
  expect(placeholder(container)).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:drink");
});

it.each(["missing", "request failure"])("replaces the drink placeholder with a hanger on %s", async (failure) => {
  const pending = deferred<string | null>();
  vi.mocked(getDrinkTexture).mockReturnValueOnce(pending.promise);
  const { container } = render(<DrinkPicture id="drink" color={null} sessionToken="owner" />);
  await act(async () => {
    if (failure === "request failure") pending.reject(new Error("unavailable"));
    else pending.resolve(null);
  });
  expect(placeholder(container)).toBeNull();
  expect(container.querySelector("svg")).toBeTruthy();
});

it("keeps the tinted potion placeholder until asset composition finishes", async () => {
  const pending = deferred<DrinkAssetImages>();
  vi.mocked(loadDrinkAssetImages).mockReturnValueOnce(pending.promise);
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/png;base64,potion");
  vi.mocked(composeTintedPotionCanvas).mockReturnValueOnce(canvas);
  const { container } = render(<DrinkPicture id="drink" color="#aabbcc" sessionToken="owner" />);
  expect(placeholder(container)).toBeTruthy();
  await act(async () => pending.resolve({ overlay: new Image(), bottle: new Image(), width: 16, height: 16 }));
  expect(placeholder(container)).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,potion");
});

it.each(["skin", "drink"])("revokes a late %s texture after unmount without rendering it", async (kind) => {
  const pending = deferred<string | null>();
  vi.mocked(kind === "skin" ? getSkinThumbnail : getDrinkTexture).mockReturnValueOnce(pending.promise);
  const { container, unmount } = render(
    kind === "skin" ? (
      <SkinPicture id="skin" sessionToken="owner" />
    ) : (
      <DrinkPicture id="drink" color={null} sessionToken="owner" />
    ),
  );
  unmount();
  await act(async () => pending.resolve(`blob:${kind}`));
  expect(container.children).toHaveLength(0);
  expect(revoke).toHaveBeenCalledWith(`blob:${kind}`);
});
