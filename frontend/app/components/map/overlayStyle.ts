import type { CSSProperties } from "react";
import type { OverlayBBox } from "./types";

/** Keep region overlays and labels fixed; highlight with colour and a rim only. */
export const HOVER_OVERLAY_EXPAND = 0;

type OverlayStyleOptions = {
  /** Fractional grow (e.g. 0.05 = 5% larger), centered on the bbox. */
  expand?: number;
};

export function overlayPathFromHoverUrl(url: string): string | null {
  const slash = url.lastIndexOf("/");
  if (slash === -1) return null;
  const filename = url.slice(slash + 1);
  if (!filename.endsWith("_hover")) return null;
  return filename.slice(0, -"_hover".length);
}

export function overlayStyle(
  bbox: OverlayBBox | undefined,
  mapW: number,
  mapH: number,
  options?: OverlayStyleOptions,
): CSSProperties {
  if (!bbox?.w || !bbox?.h || !mapW || !mapH) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      visibility: "hidden",
    };
  }

  const expand = options?.expand ?? 0;
  const padX = (bbox.w * expand) / 2;
  const padY = (bbox.h * expand) / 2;
  const x = bbox.x - padX;
  const y = bbox.y - padY;
  const w = bbox.w * (1 + expand);
  const h = bbox.h * (1 + expand);

  return {
    left: `${(x / mapW) * 100}%`,
    top: `${(y / mapH) * 100}%`,
    width: `${(w / mapW) * 100}%`,
    height: `${(h / mapH) * 100}%`,
  };
}
