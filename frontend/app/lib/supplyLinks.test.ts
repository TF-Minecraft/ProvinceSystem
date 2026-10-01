import { describe, expect, it } from "vitest";

import type { HubLink, InstallationMarker } from "../components/map/types";
import { installationToMapMarker } from "./installationMarkers";
import {
  addInstallationLinkDetails,
  installationLinkDetails,
  supplyLinkPaths,
} from "./supplyLinks";

const link: HubLink = {
  guild_id: "guild",
  guild_name: "The Guild",
  faction_id: "realm",
  mode: "rail",
  distance: 12,
  trade_share: 0.63,
  production_share: 0.22,
  from: { installation_id: "a", name: "A Station", map_x: 10, map_y: 20 },
  to: { installation_id: "b", name: "B Station", map_x: 30, map_y: 40 },
};

describe("supplyLinks", () => {
  it("builds map-space paths and skips links without placed ends", () => {
    expect(supplyLinkPaths([link])).toEqual([{
      key: "guild:a:b:0",
      mode: "rail",
      fromX: 10,
      fromY: 20,
      toX: 30,
      toY: 40,
    }]);
    expect(supplyLinkPaths([{ ...link, to: { ...link.to, map_x: undefined } }])).toEqual([]);
  });

  it("formats the connected guild, destination, mode, and percentage shares", () => {
    const installation: InstallationMarker = {
      id: "a", name: "A Station", kind: "train_station", hub_slots: 1,
      hubs: 1, map_x: 10, map_y: 20,
    };
    expect(installationLinkDetails(installation, [link])).toEqual([
      "The Guild connects to B Station (Rail; trade 63%, production 22%)",
    ]);
    expect(addInstallationLinkDetails(installationToMapMarker(installation), installation, [link]).hoverHint)
      .toBe("Hubs: 1/1\nThe Guild connects to B Station (Rail; trade 63%, production 22%)");
    expect(installationToMapMarker(installation).hoverHint).toBe("Hubs: 1/1");
    expect(installationToMapMarker({ ...installation, hub_slots: 0 }).hoverHint).toBeUndefined();
    expect(installationToMapMarker(installation).title).toContain("Hubs: 1/1");
  });
});
