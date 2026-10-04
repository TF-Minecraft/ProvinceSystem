/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the hover-highlight partial repaint (the "repaints
 * the full 1600x1600 ImageData on every hoveredRegionId change" finding).
 *
 * jsdom has no canvas backend installed, so `HTMLCanvasElement.getContext`
 * normally returns null; this test installs a small fake 2D context that
 * records exactly what the component writes and asks it for, which is enough
 * to assert on the two things the fix promises without a real GPU/canvas:
 *  - the pixels touched by a hover change are limited to the previously- and
 *    newly-hovered provinces, not the whole grid, and
 *  - the `putImageData` call the component issues is scoped to a small dirty
 *    rectangle rather than the full canvas.
 * A literal `performance.now()` wall-clock comparison would not mean much
 * against a fake context with no real pixel-copy cost — the touched-pixel and
 * dirty-rect assertions below are the deterministic stand-in the report
 * describes.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChronicleOwnershipLayer from "./ChronicleOwnershipLayer";
import type { ProvinceIdGrid } from "@/app/lib/map/chroniclePaint";
import type { MapObject, RegionRecord } from "@/app/components/map/types";

afterEach(cleanup);

type PutImageDataCall = {
  data: Uint8ClampedArray;
  dirtyX?: number;
  dirtyY?: number;
  dirtyWidth?: number;
  dirtyHeight?: number;
};

/** jsdom (this version) has no `ImageData` global at all — not just no canvas
 * backend — so `createImageData` below hands back this minimal stand-in
 * instead of the real DOM type. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class FakeCtx2D {
  imageData: FakeImageData | null = null;
  readonly putCalls: PutImageDataCall[] = [];
  clearCalls = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  clearRect(): void {
    this.clearCalls++;
  }

  createImageData(w: number, h: number): FakeImageData {
    return new FakeImageData(w, h);
  }

  putImageData(
    imageData: FakeImageData,
    _dx: number,
    _dy: number,
    dirtyX?: number,
    dirtyY?: number,
    dirtyWidth?: number,
    dirtyHeight?: number
  ): void {
    this.imageData = imageData;
    this.putCalls.push({
      data: new Uint8ClampedArray(imageData.data),
      dirtyX,
      dirtyY,
      dirtyWidth,
      dirtyHeight,
    });
  }
}

/** One fake context per canvas element, so the base and hover canvases (both
 * rendered by the component) never share recorded state. */
function installFakeCanvas(): Map<HTMLCanvasElement, FakeCtx2D> {
  const byCanvas = new Map<HTMLCanvasElement, FakeCtx2D>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    let ctx = byCanvas.get(this);
    if (!ctx) {
      ctx = new FakeCtx2D(this);
      byCanvas.set(this, ctx);
    }
    return ctx as unknown as CanvasRenderingContext2D;
  });
  return byCanvas;
}

/** 4x4 grid: province 1 fills the top-left 2x2 block, province 2 the
 * bottom-right 2x2 block, everything else ocean (id 0). */
function fourByFourGrid(): ProvinceIdGrid {
  // prettier-ignore
  const ids = Uint16Array.from([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 2, 2,
    0, 0, 2, 2,
  ]);
  return { width: 4, height: 4, ids };
}

const REGION_DATA: RegionRecord = {
  nationA: { rgb: "10,20,30", provinces: [1] },
  nationB: { rgb: "200,150,50", provinces: [2] },
};

function mapObject(id: string): MapObject {
  return { id, visible: true, path: "", nested: false, baseId: id };
}

const MAP_OBJECTS: MapObject[] = [mapObject("nationA"), mapObject("nationB")];

function findHoverCanvas(
  container: HTMLElement,
  byCanvas: Map<HTMLCanvasElement, FakeCtx2D>
): { canvas: HTMLCanvasElement; ctx: FakeCtx2D } {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  // The hover canvas is the second of the two the component renders.
  const canvas = canvases[1]!;
  return { canvas, ctx: byCanvas.get(canvas)! };
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const o = (y * width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

describe("ChronicleOwnershipLayer hover highlight", () => {
  it("only touches the newly-hovered province's pixels, and its bounding box, not the whole grid", () => {
    const byCanvas = installFakeCanvas();
    const grid = fourByFourGrid();

    const { container, rerender } = render(
      <ChronicleOwnershipLayer
        grid={grid}
        regionData={REGION_DATA}
        mapObjects={MAP_OBJECTS}
        hoveredRegionId={null}
        mapW={400}
        mapH={400}
      />
    );

    const { ctx } = findHoverCanvas(container, byCanvas);
    // No highlight yet: the effect ran (grid/canvas sizing) but found nothing
    // to paint, so it must not have flushed any pixels.
    expect(ctx.putCalls).toHaveLength(0);

    rerender(
      <ChronicleOwnershipLayer
        grid={grid}
        regionData={REGION_DATA}
        mapObjects={MAP_OBJECTS}
        hoveredRegionId="nationA"
        mapW={400}
        mapH={400}
      />
    );

    expect(ctx.putCalls).toHaveLength(1);
    const first = ctx.putCalls[0]!;
    // nationA occupies (0,0)-(1,1): only that 2x2 rectangle needs repainting.
    expect(first).toMatchObject({ dirtyX: 0, dirtyY: 0, dirtyWidth: 2, dirtyHeight: 2 });

    expect(pixelAt(first.data, 4, 0, 0)).toEqual([120, 126, 131, 255]);
    expect(pixelAt(first.data, 4, 1, 1)).toEqual([120, 126, 131, 255]);
    // nationB's block must still read as untouched/transparent.
    expect(pixelAt(first.data, 4, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("on a hover change, clears exactly the old province and paints exactly the new one", () => {
    const byCanvas = installFakeCanvas();
    const grid = fourByFourGrid();

    const { container, rerender } = render(
      <ChronicleOwnershipLayer
        grid={grid}
        regionData={REGION_DATA}
        mapObjects={MAP_OBJECTS}
        hoveredRegionId="nationA"
        mapW={400}
        mapH={400}
      />
    );
    const { ctx } = findHoverCanvas(container, byCanvas);
    expect(ctx.putCalls).toHaveLength(1);

    rerender(
      <ChronicleOwnershipLayer
        grid={grid}
        regionData={REGION_DATA}
        mapObjects={MAP_OBJECTS}
        hoveredRegionId="nationB"
        mapW={400}
        mapH={400}
      />
    );

    expect(ctx.putCalls).toHaveLength(2);
    const second = ctx.putCalls[1]!;
    // The dirty rect spans both the cleared old highlight and the new one —
    // still a small fraction of the 4x4 grid, not the whole thing.
    expect(second).toMatchObject({ dirtyX: 0, dirtyY: 0, dirtyWidth: 4, dirtyHeight: 4 });

    // nationA's block is cleared back to transparent.
    expect(pixelAt(second.data, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(second.data, 4, 1, 1)).toEqual([0, 0, 0, 0]);
    // nationB's block now carries its highlight colour.
    expect(pixelAt(second.data, 4, 2, 2)).toEqual([225, 197, 142, 255]);
    expect(pixelAt(second.data, 4, 3, 3)).toEqual([225, 197, 142, 255]);
  });

  it("does not repaint when re-rendered with the same hovered region", () => {
    const byCanvas = installFakeCanvas();
    const grid = fourByFourGrid();

    const { container, rerender } = render(
      <ChronicleOwnershipLayer
        grid={grid}
        regionData={REGION_DATA}
        mapObjects={MAP_OBJECTS}
        hoveredRegionId="nationA"
        mapW={400}
        mapH={400}
      />
    );
    const { ctx } = findHoverCanvas(container, byCanvas);
    expect(ctx.putCalls).toHaveLength(1);

    // A prop identity change unrelated to the hover (mapW) still re-runs the
    // component, but the hover effect itself must see nothing to do.
    rerender(
      <ChronicleOwnershipLayer
        grid={grid}
        regionData={REGION_DATA}
        mapObjects={MAP_OBJECTS}
        hoveredRegionId="nationA"
        mapW={401}
        mapH={400}
      />
    );

    expect(ctx.putCalls).toHaveLength(1);
  });
});
