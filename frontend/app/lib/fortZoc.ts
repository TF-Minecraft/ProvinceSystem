import type { FortMarker, HoverOverlay } from "../components/map/types";
import type { MapMarker } from "./mapMarkers";

const INSTALLATION_MARKER_PREFIX = "installation:";

export function installationIdFromMarkerId(markerId: string): string | null {
  if (!markerId.startsWith(INSTALLATION_MARKER_PREFIX)) {
    return null;
  }
  const installationId = markerId.slice(INSTALLATION_MARKER_PREFIX.length);
  return installationId || null;
}

export function lookupFortZocOverlay(marker: MapMarker, forts: FortMarker[]): HoverOverlay | null {
  if (marker.kind !== "fort") {
    return null;
  }

  const installationId = installationIdFromMarkerId(marker.id);
  if (!installationId) {
    return null;
  }

  const fort = forts.find((entry) => entry.id === installationId);
  if (!fort?.zoc_url || !fort.overlay?.w || !fort.overlay?.h) {
    return null;
  }

  return {
    url: fort.zoc_url,
    overlay: fort.overlay,
  };
}
