# Wars on the web map

Website-side war visualization only. War **gameplay**, FSM, and export live in SimpleFactions: [`war/`](https://github.com/TF-Minecraft/SimpleFactions/tree/main/src/main/java/net/tfminecraft/simplefactions/war), [`WarMapExporter.java`](https://github.com/TF-Minecraft/SimpleFactions/blob/main/src/main/java/net/tfminecraft/simplefactions/map/export/WarMapExporter.java).

## Shipped (website)

| Layer | Description |
|-------|-------------|
| **Campaign route line** | Axis/path between campaign waypoints from SF `wars` export |
| **Battle pins** | Scheduled battle locations on the map with tooltip metadata |
| **Occupier nation fill** | Political overlay remaps `province_data[].occupied_by` tiles to the occupier colour (slightly greyer). Labels use `occupied_held`. |
| **Campaign-line front** | `occupied_by_attacker[]` on `wars[]` advances the dotted front along the axis |

Data arrives via SimpleFactions nation/war upload. The website **does not infer** frontlines from territory diffs alone.

## Chronicle

Daily map snapshots and economy ledger ship ([ledger.md](ledger.md)). SF does not emit war events (`war_declared`, battle, occupy, end) yet, so the `chronicle` upload's `events[]` is always empty.

## Data contract (summary)

From SF war export (see [`WarMapExporter.java`](https://github.com/TF-Minecraft/SimpleFactions/blob/main/src/main/java/net/tfminecraft/simplefactions/map/export/WarMapExporter.java)):

- Belligerent nation ids
- Campaign route polyline or waypoint list for the route line layer
- Battle schedule entries with map coordinates for pins
- Occupation: `occupied_by_attacker[]` / `occupied_by_defender[]` on `wars[]`; `occupied_by` on `province_data` for occupier fill

TFMCWeb reads war JSON from the same upload/regen path as other map markers. Pipeline detail: [generation.md](generation.md).

## Rendering rules

- War overlays compose **above** political fills but respect pick-layer separation (hover still uses pick canvas).
- Multiple concurrent wars may each get a `war_{id}` layer key.
- Pins and route lines use muted cartography colours consistent with [overview.md](overview.md) ink style.

## Staff / public access

War layers follow the same map access rules as the parent `mapId`. Staff-only maps hide war data from players without `tfmc.map.staff`. See [identity/auth-security.md](../identity/auth-security.md).

## See also

- [map/overview.md](overview.md) - full layer model
- [integrations/simplefactions.md](../integrations/simplefactions.md) - upload and regen contract
