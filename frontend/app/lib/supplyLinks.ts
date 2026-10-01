import type { HubLink, InstallationMarker } from "../components/map/types";
import type { MapMarker } from "./mapMarkers";

export type SupplyLinkPath = {
  key: string;
  mode: HubLink["mode"];
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export function supplyLinkPaths(links: HubLink[]): SupplyLinkPath[] {
  return links.flatMap((link, index) => {
    const { from, to } = link;
    if (
      !Number.isFinite(from.map_x) ||
      !Number.isFinite(from.map_y) ||
      !Number.isFinite(to.map_x) ||
      !Number.isFinite(to.map_y)
    ) return [];
    return [{
      key: `${link.guild_id}:${from.installation_id}:${to.installation_id}:${index}`,
      mode: link.mode,
      fromX: from.map_x!,
      fromY: from.map_y!,
      toX: to.map_x!,
      toY: to.map_y!,
    }];
  });
}

const modeName: Record<HubLink["mode"], string> = {
  rail: "Rail",
  sea: "Sea",
  air: "Air",
};

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function installationLinkDetails(
  installation: InstallationMarker,
  links: HubLink[]
): string[] {
  return links.flatMap((link) => {
    // Installation ids are only unique within the faction that owns them.
    const isEnd = (end: HubLink["from"]) =>
      end.installation_id === installation.id &&
      (!end.faction_id ||
        !installation.faction_id ||
        end.faction_id === installation.faction_id);
    const peer = isEnd(link.from) ? link.to : isEnd(link.to) ? link.from : null;
    if (!peer) return [];
    return [
      `${link.guild_name} connects to ${peer.name} (${modeName[link.mode]}; trade ${percentage(link.trade_share)}, production ${percentage(link.production_share)})`,
    ];
  });
}

export function addInstallationLinkDetails(
  marker: MapMarker,
  installation: InstallationMarker,
  links: HubLink[]
): MapMarker {
  const details = installationLinkDetails(installation, links);
  if (!details.length) return marker;
  const lines = marker.hoverHint ? [marker.hoverHint, ...details] : details;
  return { ...marker, hoverText: marker.label, hoverHint: lines.join("\n") };
}
