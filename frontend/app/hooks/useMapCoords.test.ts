import { describe, expect, it } from "vitest";

import {
  getMapCoords,
  mapPixelToPickCanvas,
  type MapPickViewport,
} from "./useMapCoords";

function mockMouseEvent(clientX: number, clientY: number): React.MouseEvent {
  return { clientX, clientY } as React.MouseEvent;
}

function mockCanvas(
  rect: { left: number; top: number; width: number; height: number },
  size = { width: 2000, height: 2000 }
): HTMLCanvasElement {
  return {
    width: size.width,
    height: size.height,
    getBoundingClientRect: () => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  } as HTMLCanvasElement;
}

function mockViewportElement(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): HTMLDivElement {
  return {
    getBoundingClientRect: () => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  } as HTMLDivElement;
}

describe("getMapCoords canvas path", () => {
  it("maps cursor position with uniform rect scaling", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 1000, height: 1000 });

    const coords = getMapCoords(mockMouseEvent(600, 550), canvas, "main");

    expect(coords).toEqual({
      x: 1000,
      y: 1000,
      screenX: 600,
      screenY: 550,
    });
  });

  it("returns null when cursor is outside the canvas rect", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 1000, height: 1000 });

    expect(getMapCoords(mockMouseEvent(50, 550), canvas, "main")).toBeNull();
  });

  it("uses the 6400 fallback for an unknown map when the canvas has no bitmap", () => {
    const canvas = mockCanvas(
      { left: 0, top: 0, width: 1000, height: 1000 },
      { width: 0, height: 0 }
    );

    const coords = getMapCoords(mockMouseEvent(500, 500), canvas, "calavorn");

    expect(coords).toEqual({
      x: 3200,
      y: 3200,
      screenX: 500,
      screenY: 500,
    });
  });
});

describe("getMapCoords viewport path", () => {
  const mapSize = { w: 2000, h: 2000 };
  const viewportRect = { left: 100, top: 50, width: 1000, height: 1000 };

  function viewport(overrides: Partial<MapPickViewport> = {}): MapPickViewport {
    return {
      displayScale: 1,
      translateX: 0,
      translateY: 0,
      viewportElement: mockViewportElement(viewportRect),
      mapSize,
      ...overrides,
    };
  }

  it("matches canvas mapping at fit-to-width scale", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 1000, height: 1000 });

    const canvasCoords = getMapCoords(mockMouseEvent(600, 550), canvas, "main");
    const transformed = getMapCoords(
      mockMouseEvent(600, 550),
      canvas,
      "main",
      viewport({ displayScale: 0.5 })
    );

    expect(transformed).toEqual(canvasCoords);
  });

  it("maps zoomed viewport coordinates via screenToMap", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 2000, height: 2000 });

    const coords = getMapCoords(
      mockMouseEvent(700, 650),
      canvas,
      "main",
      viewport({ displayScale: 2 })
    );

    expect(coords).toEqual({
      x: 300,
      y: 300,
      screenX: 700,
      screenY: 650,
    });
  });

  it("accounts for pan translate", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 1000, height: 1000 });

    const coords = getMapCoords(
      mockMouseEvent(450, 450),
      canvas,
      "main",
      viewport({ displayScale: 0.5, translateX: -100, translateY: -50 })
    );

    expect(coords).toEqual({
      x: 900,
      y: 900,
      screenX: 450,
      screenY: 450,
    });
  });

  it("returns null when map point is outside map bounds", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 1000, height: 1000 });

    expect(
      getMapCoords(
        mockMouseEvent(50, 550),
        canvas,
        "main",
        viewport()
      )
    ).toBeNull();
  });

  it("falls back to canvas mapping when viewport element is missing", () => {
    const canvas = mockCanvas({ left: 100, top: 50, width: 1000, height: 1000 });

    const canvasCoords = getMapCoords(mockMouseEvent(600, 550), canvas, "main");
    const coords = getMapCoords(
      mockMouseEvent(600, 550),
      canvas,
      "main",
      viewport({ viewportElement: null })
    );

    expect(coords).toEqual(canvasCoords);
  });
});

describe("mapPixelToPickCanvas", () => {
  it("keeps map pixels when canvas matches map size", () => {
    expect(
      mapPixelToPickCanvas(100, 200, { w: 6400, h: 6400 }, { width: 6400, height: 6400 })
    ).toEqual({ x: 100, y: 200 });
  });

  it("scales map pixels onto a smaller pick bitmap", () => {
    expect(
      mapPixelToPickCanvas(3200, 1600, { w: 6400, h: 6400 }, { width: 4096, height: 4096 })
    ).toEqual({ x: 2048, y: 1024 });
  });

  it("returns null when the scaled pixel is outside the bitmap", () => {
    expect(
      mapPixelToPickCanvas(6399, 0, { w: 6400, h: 6400 }, { width: 0, height: 4096 })
    ).toBeNull();
  });
});
