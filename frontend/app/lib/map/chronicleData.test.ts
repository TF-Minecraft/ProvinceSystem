import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapAccessError } from "@/lib/map/api";

import {
  CHRONICLE_FILE_NAMES,
  fetchChronicleDayFile,
  fetchChronicleIndex,
  fetchProvinceIdGridQ4,
  fingerprintBytes,
  CHRONICLE_DAY_FILE_BUDGET_BYTES,
  isChronicleDayFileMissing,
  type ChronicleIndex,
} from "./chronicleData";

function gzipResponse(body: Uint8Array | string): Response {
  const raw = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  const gz = gzipSync(raw);
  return new Response(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer, {
    status: 200,
    headers: { "Content-Type": "application/gzip" },
  });
}

/** Same layout as the backend's province id grid: int32 w, int32 h, uint16 body. */
function encodeGrid(width: number, height: number, ids: number[]): Uint8Array {
  const buffer = new ArrayBuffer(8 + ids.length * 2);
  const view = new DataView(buffer);
  view.setInt32(0, width, true);
  view.setInt32(4, height, true);
  ids.forEach((id, i) => view.setUint16(8 + i * 2, id, true));
  return new Uint8Array(buffer);
}

describe("chronicle data", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes exactly the backend chronicle file names", () => {
    expect(CHRONICLE_FILE_NAMES).toEqual([
      "nation",
      "province_data",
      "map_markers",
      "trade",
      "guilds",
      "zoc_overlays",
      "empire",
      "infestation_data",
      "county",
      "duchy",
      "kingdom",
    ]);
  });

  it("fetchChronicleIndex accepts the empty day-zero index", async () => {
    const empty: ChronicleIndex = {
      days: [],
      first: null,
      last: null,
      geometry_version: "abc",
      incomplete_days: [],
      incomplete_day_count: 0,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(empty), { status: 200 })));

    await expect(fetchChronicleIndex("dev", "tok")).resolves.toEqual(empty);
  });

  it("fetchChronicleDayFile gunzips, parses and fingerprints", async () => {
    const payload = JSON.stringify({ TEST: { rgb: "229,60,112", provinces: [1] } });
    const fetchMock = vi.fn().mockResolvedValue(gzipResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchChronicleDayFile("dev", "2026-08-31", "nation", "tok");

    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/dev/chronicle/2026-08-31/data/nation");
    expect(result.value).toEqual({ TEST: { rgb: "229,60,112", provinces: [1] } });
    expect(result.byteLength).toBe(Buffer.byteLength(payload, "utf-8"));
    expect(result.fingerprint).toBe(fingerprintBytes(new Uint8Array(Buffer.from(payload, "utf-8"))));
  });

  it("surfaces a missing day source distinctly from a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "not captured" }), { status: 404 })),
    );
    const missing = await fetchChronicleDayFile("dev", "2026-08-31", "trade", "tok").catch((err: unknown) => err);
    expect(isChronicleDayFileMissing(missing)).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const failed = await fetchChronicleDayFile("dev", "2026-08-31", "trade", "tok").catch((err: unknown) => err);
    expect(isChronicleDayFileMissing(failed)).toBe(false);
    expect((failed as MapAccessError).status).toBe(0);
  });

  it("refuses a day file that expands past the decompression budget", async () => {
    // 6 of these run concurrently during a build, and `decompressGzipBuffer`
    // buffers whatever the stream produces. A real day file is 4.6 KB; without
    // a cap one crafted response takes the tab down mid-build.
    const bomb = Buffer.alloc(CHRONICLE_DAY_FILE_BUDGET_BYTES + 1024, 0x20);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse(bomb)));

    const err = await fetchChronicleDayFile("dev", "2026-08-31", "nation", "tok").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MapAccessError);
    expect((err as Error).name).toBe("ChronicleDecompressionLimitError");
    // One day fails, not the studio: this is not a "day missing" skip either.
    expect(isChronicleDayFileMissing(err)).toBe(false);
  });

  it("still accepts a day file comfortably under the budget", async () => {
    const payload = JSON.stringify({ TEST: { rgb: "1,2,3", provinces: [1] } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse(payload)));

    const file = await fetchChronicleDayFile("dev", "2026-08-31", "nation", "tok");

    expect(file.byteLength).toBe(Buffer.byteLength(payload, "utf-8"));
  });

  it("fetchProvinceIdGridQ4 passes its abort signal down to the request", async () => {
    // Without this the studio's Cancel could not interrupt the grid fetch, and
    // a cancelled build stayed parked on it long enough for a second build to
    // start behind it.
    const fetchMock = vi.fn().mockResolvedValue(gzipResponse(encodeGrid(2, 2, [0, 1, 2, 0])));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchProvinceIdGridQ4("dev", "tok", controller.signal);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("fetchProvinceIdGridQ4 gunzips and deserializes the grid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gzipResponse(encodeGrid(2, 2, [0, 1, 2, 0]))));

    const grid = await fetchProvinceIdGridQ4("dev", "tok");

    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    expect(Array.from(grid.ids)).toEqual([0, 1, 2, 0]);
  });
});

describe("fingerprintBytes", () => {
  it("separates same-length payloads that differ only by a swap", () => {
    const a = new TextEncoder().encode('{"A":[1],"B":[2]}');
    const b = new TextEncoder().encode('{"A":[2],"B":[1]}');

    expect(fingerprintBytes(a)).not.toBe(fingerprintBytes(b));
    expect(fingerprintBytes(a)).toBe(fingerprintBytes(a.slice()));
  });
});
