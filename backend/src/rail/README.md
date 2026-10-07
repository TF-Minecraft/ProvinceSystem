# Rail network

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
