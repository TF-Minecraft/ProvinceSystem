# Rail network

[Project index](../../README.md) · [Source module](../../../backend/src/rail)

Bare filenames below refer to `backend/src/rail/` in the TFMCWeb checkout; paths beginning with `src/` are relative to `backend/`.

The staff panel's Rail tab draws the Minecraft server's rail network on the
live map: every VehicleFramework track, its junctions and ends, broken or
damaged stretches, and the stops along it. `GET /admin/rail?map=<id>` serves
it to admins and the owner (`view_rail`). Track positions are not personal
data, so views are not audited.

VehicleFramework saves one JSON file per track in
`plugins/VehicleFramework/data/tracks/<world>/`, with switches in
`junctions/` beside them. A track holds a sample about every block and one
segment per pair of samples; a segment can be broken or damaged. The backend
reads the files on request and keeps the result until any file, the map's
`map_markers.json` or its `province_id_runs.bin.gz` changes. A file caught
mid-save is skipped and counted, so the page can say so.

- **Stops** are the settlements whose provinces a track crosses. Each sits
  where the track comes closest to the settlement inside its provinces.
- **Lines** are tracks joined by junctions. A line is named after its first and
  last stop along its longest track; one with no stops is an "Unnamed line".
- Tracks are simplified (Douglas-Peucker, 0.35 blocks) before they are sent.

## Tube map

The tab's **Map** and **Tube map** buttons switch between the live map and an
Underground-style diagram (`/admin/rail?view=tube`), drawn in the browser by
`frontend/lib/admin/railSchematic.ts`:

- Stops, junctions and track ends are the diagram's nodes. Each axis is
  stretched separately, halfway between real distance and the nodes' order, so
  crowded stops get room and every stop keeps its compass order.
- Nodes snap to a 25-unit grid. Each piece of track between nodes becomes one
  or two runs at 0, 45 or 90 degrees, bending on the side nearer the real
  track. Bends larger than 4% of the network's size are kept as extra points.
- A stop within 120 blocks of a track end is drawn at the end.
- Stops are ticks, faction capitals are white rings, and line colours follow
  the Underground's (red, green, light blue, and so on). Broken track is black
  dashes; damaged track has a white centre line. Picking a stop, line or break
  in the lists frames it on the diagram too.

## Settings

| Variable | Meaning |
| --- | --- |
| `RAIL_TRACKS_DIR` | VehicleFramework's `data/tracks` folder inside the backend container. Unset: the tab says the site is not set up to read the network. |
| `RAIL_WORLD` | The world folder to read: the server's `level-name`. Defaults to `COREPROTECT_MAP_WORLD`, then `TFMC_Map`. |

Mount the folder read-only in the host's `docker-compose.override.yml`, like
CoreProtect's:

```yaml
services:
  backend:
    volumes:
      - /home/amp/.ampdata/instances/TFMCMain01/Minecraft/plugins/VehicleFramework/data/tracks:/vehicleframework-tracks:ro
    environment:
      - RAIL_TRACKS_DIR=/vehicleframework-tracks
```
