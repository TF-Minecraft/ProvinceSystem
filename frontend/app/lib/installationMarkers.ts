import type { InstallationMarker } from "../components/map/types";
import { cleanRegionName } from "./mapLabels";
import type { MapMarker } from "./mapMarkers";

export function filterPlacedInstallations(
  installations: InstallationMarker[]
): InstallationMarker[] {
  return installations.filter(
    (installation) =>
      typeof installation.map_x === "number" &&
      Number.isFinite(installation.map_x) &&
      typeof installation.map_y === "number" &&
      Number.isFinite(installation.map_y)
  );
}

export function installationToMapMarker(
  installation: InstallationMarker
): MapMarker {
  const displayName = cleanRegionName(installation.name);
  const kindLabel =
    installation.kind.charAt(0).toUpperCase() + installation.kind.slice(1);

  return {
    id: `installation:${installation.id}`,
    kind: installation.kind,
    markerSize: "small",
    mapX: installation.map_x!,
    mapY: installation.map_y!,
    label: displayName,
    title: `${displayName} (${kindLabel})`,
    showLabelOnlyOnHover: true,
  };
}
