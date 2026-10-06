"use client";

import { memo, useEffect, useRef } from "react";

import {
  CHRONICLE_BORDER_INK_RGBA,
  expandChronicleBorderMask,
  type ChronicleBorderMask,
} from "../../lib/map/chronicleBorderMask";

/**
 * Nation borders for one stored day, drawn as pixels at the grid's own
 * resolution.
 *
 * This canvas deliberately does *not* go through the fill frame's
 * `renderSize` downscale: the fill is painted at 1600, shrunk to 600-1200 and
 * then magnified by the viewport, which is a second resample. Borders keep
 * their 1600x1600 backing store and the viewport stretches that once, with
 * the browser's normal smoothing. The live overlays are full-resolution PNGs
 * scaled the same way; nearest-neighbour on this coarser grid is what made
 * the chronicle seam look pixelated beside them.
 *
 * Sits below the label layer (z-15) and above the fill canvas (z-12) so a
 * border is never painted over by the territory it encloses, and never covers
 * a realm name.
 *
 * `ink` makes this the canvas for every packed single-ink overlay, not just
 * borders: the occupation seam and the fort-ZoC hatch want exactly the same
 * no-double-resample treatment, and a copy of this component per colour would
 * be three places for that reasoning to rot. It defaults to the border stroke,
 * so that call site and that look are untouched. All three share z-13 and are
 * stacked by document order instead — hatch under the borders it underlies,
 * seam over them — which leaves every *other* layer's z alone.
 */
function ChronicleBorderCanvas({
  mask,
  ink = CHRONICLE_BORDER_INK_RGBA,
}: {
  mask: ChronicleBorderMask | null;
  ink?: readonly [number, number, number, number];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // One RGBA scratch for whichever day is on screen — the masks themselves
  // stay packed at 1 bit per pixel; only the displayed day is ever expanded.
  const imageDataRef = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mask) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== mask.width || canvas.height !== mask.height) {
      canvas.width = mask.width;
      canvas.height = mask.height;
      imageDataRef.current = null;
    }
    let imageData = imageDataRef.current;
    if (!imageData) {
      imageData = ctx.createImageData(mask.width, mask.height);
      imageDataRef.current = imageData;
    }
    // Scrubbing between days that share a fingerprint shares the mask object,
    // so this effect (keyed on `mask`) never re-expands an unchanged day.
    expandChronicleBorderMask(mask, imageData.data, { ink });
    ctx.putImageData(imageData, 0, 0);
  }, [mask, ink]);

  if (!mask) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[13] h-full w-full"
      aria-hidden
    />
  );
}

export default memo(ChronicleBorderCanvas);
