"use client";

import { useEffect, useState } from "react";

import type { FitMode } from "../lib/mapViewportMath";

/**
 * Desktop opens on the whole world. A phone held upright would show that as a
 * small square with the screen empty below it, so there the map fills the
 * screen top to bottom instead and the sides are a drag away.
 */
export function useResponsiveFitMode(): FitMode {
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 47.99rem)");
    const apply = () => setFitMode(query.matches ? "cover" : "contain");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return fitMode;
}
