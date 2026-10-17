# SimpleFactions integration

Map bridge between SimpleFactions on Paper and TFMCWeb. SimpleFactions owns nations/provinces in-game; TFMCWeb owns mapgen, PNG layers, and the web viewer.

War gameplay source: [`war/`](https://github.com/TF-Minecraft/SimpleFactions/tree/main/src/main/java/net/tfminecraft/simplefactions/war).

**See also:** [map/generation.md](../map/generation.md) · [map/overview.md](../map/overview.md) · [flows/journeys.md](../flows/journeys.md)

## Role split

| Actor | Responsibility |
|-------|----------------|
| SimpleFactions | Nation/province state; enqueue regen; HTTP upload |
| TFMCWeb | `ProvinceSystemGateway` - base URL, plugin key, async HTTP |
| TFMCWeb | Compile defines, mapgen, regiongen, serve assets |
| Website | MapViewer, modes, markers, war overlays |

SimpleFactions is **not** involved in skins, drinks, or characters.

## Province fertility

SimpleFactions reads per-province fertility from loaded `provinces.txt` (field 3: `id = R,G,B;terrain;fertility`) for in-game crop growth. The web map viewer fertility mode uses the same mapgen source. Source: [`FertilityProvinceResolver.java`](https://github.com/TF-Minecraft/SimpleFactions/blob/main/src/main/java/net/tfminecraft/simplefactions/map/fertility/FertilityProvinceResolver.java).

## HTTP contract

Primary client: `simplefactions/src/main/java/net/tfminecraft/simplefactions/rest/RestServer.java` - delegates to TFMCWeb `ProvinceSystemGateway` via `api/GatewayClient.java`.

| Call | Purpose |
|------|---------|
| `POST {api}/{mapRef}/data/upload/{mode}` | Push nation / provinces / guilds / queue / `map_markers` / title-tier JSON (internal IP; no staff token) |
| `GET {api}/{mapRef}/{hashedKey}/api/regenerate/{type}` | `textonly`, queued, or `fullregen` |
| `GET {api}/generator/banner` | Random banner patterns |

### Config knobs

| Where | Key | Purpose |
|-------|-----|---------|
| **TFMCWeb** `config.yml` | `api.base-url`, `api.plugin-key` | TFMCWeb HTTP (all SF map calls) |
| **SimpleFactions** `config.yml` | `map-reference` | Which map folder (`main`, `dev`, …) - must match website `mapId` |
| **SimpleFactions** `config.yml` | `enable-map` | Kill switch |

SimpleFactions **soft-depends** on TFMCWeb. With `enable-map: true` and TFMCWeb missing, SF logs a severe startup warning and map HTTP fails at runtime.

### Loopback URL rule

On the game host, `api.base-url` must point at **loopback** (e.g. `http://127.0.0.1:8000`), not the public website hostname. Uploads and regen inherit this URL. Docker NAT then shows a private peer (often `172.18.0.1`), which the API treats as internal. Calling the public `/api/` host adds `X-Forwarded-For` and is rejected. See [identity/auth-security.md](../identity/auth-security.md).

## Queue upload and regen flow

Typical claim change sequence:

1. Gameplay changes nation borders.
2. SimpleFactions enqueues affected region RGB values.
3. `POST /{map}/data/upload/…` pushes nation JSON, queue, markers, war export, etc.
4. `GET /{map}/{hashedKey}/api/regenerate/{type}` runs mapgen on TFMCWeb.
5. Website loads updated `output/{map}/` assets.

Regen types include `textonly`, queued partial regen, and `fullregen`. Title-tier regen (`fullregen:county`, etc.) is used after staff title editor saves.

## Upload modes

Common `mode` values on `POST /{map}/data/upload/{mode}`:

- `nation` - political nation JSON
- `province_data` - province metadata
- `guilds` - guild layer data
- `queue` - pending region RGB jobs
- `map_markers` - settlements, capitals, forts
- `infestation_data` - province infestation overlay (Infestations plugin)
- `county` / `duchy` / `kingdom` / `empire` - de jure title JSON (same IP gate; validated payload)
- `chronicle` - economy snapshot (faction wealth/prestige, guilds), posted every 300s; does **not** overwrite a single file like the modes above - partitioned and indexed as the **ledger**, see [map/ledger.md](../map/ledger.md)

War and chronicle extensions follow the export schema in [`docs/assets/map-export-schema.json`](../assets/map-export-schema.json). SF-side export source: [`map/export/`](https://github.com/TF-Minecraft/SimpleFactions/tree/main/src/main/java/net/tfminecraft/simplefactions/map/export).

## Upload cadence

SF splits its payloads by cost. Every 300 s it ships the **live** set (`province_data`, `guilds`, `chronicle`) unconditionally, and adds the **map** set (`queue`, `nation`, `map_markers`, title JSON) only when the map queue has work. A full nation cycle runs hourly regardless.

The live-only path finishes with `GET /{map}/{hashedKey}/api/regenerate/trade`, which redraws the trade and prosperity overlays only; nation and title-tier layers are left alone.

## Chronicle ingest

Partitioning, faction identity, deletion and charting rules: [map/ledger.md](../map/ledger.md).

## Multi-map

Each logical world has its own `input/{map}`, `defines/{map}`, `output/{map}` on TFMCWeb. SF `map-reference` must match the website `mapId` for that season/world.

## Local vs live

| Mode | Map data |
|------|----------|
| Website only | Sample `input`/`defines` + manual fullregen ([ops/local-dev.md](../ops/local-dev.md)) |
| Integration | TFMCWeb `api.base-url` → local/staging API; SF `map-reference` = test mapRef |
| Production | SF on Paper → live API; players browse tfminecraft.net |

## Security note

Map regen uses a hashed key in the URL path today (MD5 segment in regenerate URL). Prefer moving the secret to config/env. Public map **read** endpoints remain low sensitivity; write/upload paths should stay on loopback or authenticated plugin routes where applicable.

## See also

- [map/wars-on-map.md](../map/wars-on-map.md) - website war layers
- [map/title-editor.md](../map/title-editor.md) - staff title JSON (not SF-uploaded)
