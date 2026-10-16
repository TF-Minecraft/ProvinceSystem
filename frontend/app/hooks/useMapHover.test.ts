/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapHover } from "./useMapHover";
import { buildProvinceRegionIndex } from "./regionPick";
import { buildProvinceRunIndex, type ProvinceRunIndex } from "../lib/map/editor/buildProvinceIndex";
import { pickSurfaceFromImageData } from "../lib/map/pickSurface";
import type { RegionRecord } from "../components/map/types";

/** One row: province 7 (black realm) at x 0-1, unheld at x 2, province 8 at x 3. */
function mockRunIndex(): ProvinceRunIndex {
  return buildProvinceRunIndex(4, 1, Uint32Array.from([2, 1, 1]), Uint16Array.from([7, 0, 8]));
}

const regionData: RegionRecord = {
  BlackRealm: { rgb: "0,0,0", name: "BlackRealm", provinces: [7] },
  Other: { rgb: "9,9,9", name: "Other", provinces: [8] },
};

/** A colour surface that disagrees with geometry everywhere: all Other. */
function colourSurface() {
  const data = new Uint8ClampedArray(4 * 1 * 4);
  for (let x = 0; x < 4; x++) data.set([9, 9, 9, 255], x * 4);
  return pickSurfaceFromImageData({ data, width: 4, height: 1 });
}

function setup(runsReady: boolean) {
  const setCursorTooltip = vi.fn();
  const viewportElement = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 4, height: 1 }),
  } as unknown as HTMLDivElement;
  const props = {
    mapId: "main",
    mapType: "nation" as const,
    loading: false,
    regionData,
    pickSurfaceRef: { current: colourSurface() },
    provinceRunIndexRef: { current: runsReady ? mockRunIndex() : null },
    provinceRegionIndex: buildProvinceRegionIndex(regionData),
    provincePickReady: runsReady,
    viewportCoordsRef: {
      current: { displayScale: 1, translateX: 0, translateY: 0, viewportElement, mapSize: { w: 4, h: 1 } },
    },
    guildNameCacheRef: { current: {} },
    setCursorTooltip,
    setHoveredOverlay: vi.fn(),
    setSelectedRegionId: vi.fn(),
    getHoverRegion: (_mapType: string, _mapId: string, pickId: string) => ({
      regionId: pickId,
      imagePath: null,
      region: { name: pickId },
    }),
    mapObjects: [],
    markers: [],
    labels: [],
  };
  const hook = renderHook(() => useMapHover(props as never));
  return { hook, setCursorTooltip };
}

function moveTo(hook: ReturnType<typeof setup>["hook"], x: number) {
  act(() => {
    hook.result.current.onMouseMove({ clientX: x, clientY: 0 } as never);
  });
}

describe("useMapHover province-ID picking", () => {
  it("hovers and clicks a black realm by province, never by its colour", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const { hook, setCursorTooltip } = setup(true);

    moveTo(hook, 0);
    expect(setCursorTooltip).toHaveBeenLastCalledWith(expect.objectContaining({ text: "BlackRealm" }));
    expect(hook.result.current.isHoveringClickable).toBe(true);
    expect(hook.result.current.pickRegionAtEvent({ clientX: 0, clientY: 0 } as never)).toBe("BlackRealm");
    expect(hook.result.current.pickRegionAtEvent({ clientX: 3, clientY: 0 } as never)).toBe("Other");
  });

  it("resolves to a miss while geometry is not loaded, with no colour fallback", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const { hook, setCursorTooltip } = setup(false);

    moveTo(hook, 0);
    expect(setCursorTooltip).toHaveBeenLastCalledWith(null);
    expect(hook.result.current.isHoveringClickable).toBe(false);
    expect(hook.result.current.pickRegionAtEvent({ clientX: 0, clientY: 0 } as never)).toBeNull();
  });
});
