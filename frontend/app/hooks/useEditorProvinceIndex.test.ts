import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/map/api", () => ({
  fetchMapApi: vi.fn(),
  fetchEditorProvinces: vi.fn(),
  fetchEditorProvinceIndex: vi.fn(),
  MapAccessError: class MapAccessError extends Error {},
}));

import { fetchMapApi } from "@/lib/map/api";
import type { EditorProvinceRow } from "@/lib/map/api";

import {
  editorProvinceRunsPath,
  isEditorProvinceRunsEnabled,
  loadProvinceIndexFromRuns,
} from "./useEditorProvinceIndex";

const CATALOG: EditorProvinceRow[] = [
  { id: 1, rgb: "10,20,30" },
  { id: 2, rgb: "40,50,60" },
];

/** Minimal valid province_id_runs payload for a 4x2 grid. */
function validRunsPayload(): Buffer {
  const width = 4;
  const height = 2;
  const lengths = [2, 2, 4];
  const ids = [1, 2, 1];
  const boxes = [
    [1, 0, 0, 3, 1],
    [2, 2, 0, 3, 0],
  ];

  const buffer = new ArrayBuffer(32 + lengths.length * 6 + boxes.length * 20);
  const view = new DataView(buffer);
  view.setUint8(0, 0x50);
  view.setUint8(1, 0x52);
  view.setUint8(2, 0x55);
  view.setUint8(3, 0x56);
  view.setUint32(4, 1, true);
  view.setInt32(8, width, true);
  view.setInt32(12, height, true);
  view.setUint32(16, lengths.length, true);
  view.setUint32(20, boxes.length, true);

  lengths.forEach((v, i) => view.setUint32(32 + i * 4, v, true));
  const idsStart = 32 + lengths.length * 4;
  ids.forEach((v, i) => view.setUint16(idsStart + i * 2, v, true));

  let offset = idsStart + ids.length * 2;
  for (const box of boxes) {
    box.forEach((v, i) => view.setUint32(offset + i * 4, v, true));
    offset += 20;
  }

  return Buffer.from(buffer);
}

function respondWith(body: Buffer, ok = true): void {
  vi.mocked(fetchMapApi).mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response);
}

describe("editor province runs feature flag", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to OFF when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_EDITOR_PROVINCE_RUNS", "");
    expect(isEditorProvinceRunsEnabled()).toBe(false);
  });

  it("stays OFF for anything other than exactly \"1\"", () => {
    for (const value of ["0", "true", "yes", "on", " 1", "1 "]) {
      vi.stubEnv("NEXT_PUBLIC_EDITOR_PROVINCE_RUNS", value);
      expect(isEditorProvinceRunsEnabled()).toBe(false);
    }
  });

  it("turns ON only for \"1\"", () => {
    vi.stubEnv("NEXT_PUBLIC_EDITOR_PROVINCE_RUNS", "1");
    expect(isEditorProvinceRunsEnabled()).toBe(true);
  });

  it("builds the runs route path", () => {
    expect(editorProvinceRunsPath("main")).toBe("/main/editor/province-runs");
  });
});

describe("loadProvinceIndexFromRuns", () => {
  beforeEach(() => {
    vi.mocked(fetchMapApi).mockReset();
  });

  it("builds a run-backed province index from a good artifact", async () => {
    respondWith(gzipSync(validRunsPayload()));

    const index = await loadProvinceIndexFromRuns("main", "token", CATALOG);

    expect(index).not.toBeNull();
    expect(index!.width).toBe(4);
    expect(index!.height).toBe(2);
    expect(index!.runs).toBeDefined();
    expect(Array.from(index!.provinceMap)).toEqual([1, 1, 2, 2, 1, 1, 1, 1]);
    expect(index!.provinceToRgb).toEqual({ 1: "10,20,30", 2: "40,50,60" });
  });

  it("returns null when the route is missing (artifact absent)", async () => {
    respondWith(Buffer.alloc(0), false);
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("returns null when the fetch itself rejects", async () => {
    vi.mocked(fetchMapApi).mockRejectedValue(new Error("network down"));
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("returns null when the body is not gzip", async () => {
    respondWith(Buffer.from("not gzip at all"));
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("returns null when the magic is wrong", async () => {
    const payload = validRunsPayload();
    payload.writeUInt8(0x58, 0);
    respondWith(gzipSync(payload));
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("returns null when the version is unsupported", async () => {
    const payload = validRunsPayload();
    payload.writeUInt32LE(2, 4);
    respondWith(gzipSync(payload));
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("returns null for a stale artifact whose runs no longer cover the grid", async () => {
    const payload = validRunsPayload();
    payload.writeInt32LE(8, 8); // width 4 -> 8, runs no longer cover w*h
    respondWith(gzipSync(payload));
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("returns null for a truncated artifact", async () => {
    const payload = validRunsPayload();
    respondWith(gzipSync(payload.subarray(0, payload.length - 8)));
    await expect(
      loadProvinceIndexFromRuns("main", "token", CATALOG)
    ).resolves.toBeNull();
  });

  it("never throws for any corruption of the payload", async () => {
    const base = validRunsPayload();
    for (let byte = 0; byte < base.length; byte++) {
      const corrupted = Buffer.from(base);
      corrupted[byte] = (corrupted[byte]! + 137) & 0xff;
      respondWith(gzipSync(corrupted));
      // Must resolve to either a usable index or null - never reject.
      await expect(
        loadProvinceIndexFromRuns("main", "token", CATALOG)
      ).resolves.not.toThrow();
    }
  });
});
