import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/map/api", () => ({
  fetchMapApi: vi.fn(),
  MapAccessError: class MapAccessError extends Error {
    status: number;
    detail: string;
    constructor(message: string, status: number, detail: string) {
      super(message);
      this.name = "MapAccessError";
      this.status = status;
      this.detail = detail;
    }
  },
}));

import { MapAccessError, fetchMapApi } from "@/lib/map/api";

import { provinceAt } from "./editor/buildProvinceIndex";
import { fetchProvinceRunIndex, provinceIdRunsPath } from "./provinceRuns";

/** Minimal valid province_id_runs payload for a 4x2 grid (as the editor test builds). */
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

function respondWith(body: Buffer, ok = true, status = ok ? 200 : 404): void {
  vi.mocked(fetchMapApi).mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    json: async () => ({ detail: "artifact missing" }),
  } as unknown as Response);
}

describe("fetchProvinceRunIndex", () => {
  beforeEach(() => {
    vi.mocked(fetchMapApi).mockReset();
  });

  it("builds the public runs route path", () => {
    expect(provinceIdRunsPath("main")).toBe("/main/data/province_id_runs");
  });

  it("fetches, gunzips and decodes the public artifact", async () => {
    respondWith(gzipSync(validRunsPayload()));
    const index = await fetchProvinceRunIndex("runs-ok");
    expect(vi.mocked(fetchMapApi)).toHaveBeenCalledWith(
      "/runs-ok/data/province_id_runs",
      expect.objectContaining({ sessionToken: undefined }),
    );
    expect(provinceAt(index, 0, 0)).toBe(1);
    expect(provinceAt(index, 3, 0)).toBe(2);
    expect(provinceAt(index, 3, 1)).toBe(1);
  });

  it("serves repeat loads for the same map and access from cache", async () => {
    respondWith(gzipSync(validRunsPayload()));
    const first = await fetchProvinceRunIndex("runs-cached", "token");
    const second = await fetchProvinceRunIndex("runs-cached", "token");
    expect(second).toBe(first);
    expect(vi.mocked(fetchMapApi)).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing artifact as a MapAccessError and lets a retry succeed", async () => {
    respondWith(Buffer.from("nope"), false, 404);
    const missing = await fetchProvinceRunIndex("runs-missing").catch((err: unknown) => err);
    expect(missing).toBeInstanceOf(MapAccessError);
    expect((missing as MapAccessError).status).toBe(404);

    respondWith(gzipSync(validRunsPayload()));
    const index = await fetchProvinceRunIndex("runs-missing");
    expect(provinceAt(index, 0, 0)).toBe(1);
    expect(vi.mocked(fetchMapApi)).toHaveBeenCalledTimes(2);
  });

  it("rejects a body that is not a valid runs payload", async () => {
    respondWith(gzipSync(Buffer.from("not runs at all")));
    await expect(fetchProvinceRunIndex("runs-corrupt")).rejects.toThrow();
  });
});
