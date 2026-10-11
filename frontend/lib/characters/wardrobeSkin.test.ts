import { afterEach, describe, expect, it, vi } from "vitest";

import * as sizes from "../skins/sizes";
import {
  assertWardrobeSkinPng,
  friendlyWardrobeUploadError,
  WARDROBE_INVALID_PNG_MESSAGE,
  WARDROBE_SIZE_MESSAGE,
} from "./wardrobeSkin";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertWardrobeSkinPng", () => {
  it("rejects non-PNG bytes with player-facing message", async () => {
    const file = new File(["not-a-png"], "skin.png", { type: "image/png" });
    await expect(assertWardrobeSkinPng(file)).rejects.toThrow(WARDROBE_INVALID_PNG_MESSAGE);
  });

  it("accepts PNG when IHDR is 64×64", async () => {
    vi.spyOn(sizes, "readPngSize").mockResolvedValue({ w: 64, h: 64 });
    const file = new File([new Uint8Array(100)], "skin.png", {
      type: "image/png",
    });
    await expect(assertWardrobeSkinPng(file)).resolves.toBeUndefined();
  });

  it("rejects wrong dimensions", async () => {
    vi.spyOn(sizes, "readPngSize").mockResolvedValue({ w: 32, h: 32 });
    const file = new File([new Uint8Array(100)], "skin.png", {
      type: "image/png",
    });
    await expect(assertWardrobeSkinPng(file)).rejects.toThrow(WARDROBE_SIZE_MESSAGE);
  });
});

describe("friendlyWardrobeUploadError", () => {
  it("maps server PNG validation errors", () => {
    expect(friendlyWardrobeUploadError("File is not a valid PNG")).toBe(WARDROBE_INVALID_PNG_MESSAGE);
    expect(friendlyWardrobeUploadError("skin.png: not a PNG")).toBe(WARDROBE_INVALID_PNG_MESSAGE);
  });

  it("passes through other messages", () => {
    expect(friendlyWardrobeUploadError("Slot locked for your rank")).toBe("Slot locked for your rank");
  });
});
