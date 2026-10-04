"use client";

import { useEffect, useRef } from "react";

import {
  paintChronicleFrameToImageData,
  type NationColorLut,
  type ProvinceIdGrid,
} from "@/app/lib/map/chroniclePaint";

/**
 * The chronicle's replacement for `/{map}/mapdata/{mode}` — the server-rendered
 * raster the live map shows for `prosperity` and `infestation`.
 *
 * Those PNGs are regenerated from *today's* data and have no per-day variant,
 * so a stored day paints its own from that day's captured file. Same quarter-
 * scale grid and same paint pass `ChronicleOwnershipLayer` uses, which is what
 * makes this layer line up with the day's borders and with the pick canvas.
 *
 * The canvas carries no opacity of its own: both LUT builders bake the alpha
 * into the packed colour (`CHRONICLE_PROSPERITY_ALPHA`, and the backend's own
 * per-severity alphas for infestation), so whatever sits beneath still shows
 * through by exactly the amount the ramp intends.
 */
export default function ChronicleProvincePaintLayer({
  grid,
  lut,
}: {
  /** Quarter-scale province id grid, or null while it is still loading. */
  grid: ProvinceIdGrid | null;
  /** Packed province colours for the day, or null when there is nothing yet. */
  lut: NationColorLut | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!grid || !lut || lut.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Resizing re-allocates the backing store; only touch it on a real change.
    if (canvas.width !== grid.width || canvas.height !== grid.height) {
      canvas.width = grid.width;
      canvas.height = grid.height;
    }

    // `paintChronicleFrameToImageData` writes every pixel, transparent ones
    // included, so a reused canvas needs no `clearRect` first.
    const imageData = ctx.createImageData(grid.width, grid.height);
    paintChronicleFrameToImageData(imageData, grid, lut);
    ctx.putImageData(imageData, 0, 0);
  }, [grid, lut]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
