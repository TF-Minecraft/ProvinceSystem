// lib/map/chronicleDayContext.tsx
"use client";

import React, { createContext, useContext, useMemo } from "react";

type ChronicleDayContextValue = { day: string } | null;

/**
 * Which stored day the tree beneath is reading, or `null` for the live map.
 *
 * The default is `null` rather than `undefined`, which is the deliberate
 * difference from `MapEngineContext`: `useMapEngine` throws outside its
 * provider because a map with no engine is a bug, whereas a component outside
 * this provider is simply the live map, which is the overwhelming majority of
 * the app. Making "no provider" mean "live" is what lets Phase 3 land without
 * wrapping a single existing route.
 */
const ChronicleDayContext = createContext<ChronicleDayContextValue>(null);

export const ChronicleDayProvider: React.FC<{
  day: string | null;
  children: React.ReactNode;
}> = ({ day, children }) => {
  // Memoised on the day string alone so a re-render of the page around the
  // provider does not hand every consumer a new object and re-run the data
  // effects that take `day` in their deps.
  const value = useMemo<ChronicleDayContextValue>(() => (day === null ? null : { day }), [day]);

  return <ChronicleDayContext.Provider value={value}>{children}</ChronicleDayContext.Provider>;
};

/**
 * Returns the active day, or `null` when there is none — including when there
 * is no provider at all. Read this at the page/component level and pass the
 * result into the hooks as a parameter; the hooks deliberately do not read the
 * context themselves, so the data flow stays visible at the call site and the
 * hooks stay testable in the `node` test environment.
 */
export function useChronicleDay(): string | null {
  return useContext(ChronicleDayContext)?.day ?? null;
}
