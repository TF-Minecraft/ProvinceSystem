# Dev config (TFMCWeb)

Dev-only shortcuts, bypasses, and fixture data for TFMCWeb. **Unset all dev flags on production** - see [identity/auth-security.md](../identity/auth-security.md) and [STAGING.md](../../STAGING.md).

## Backend

| Item | Location | Dev behavior | Production action |
|------|----------|--------------|-------------------|
| `SKINS_DEV` | backend env | Relaxed skins dev helpers | **Unset** when `PS_PRODUCTION=1` |
| `CHARACTER_UI_DEV` | backend env | `ui-dev-session` Bearer bypass for staff map/editor | **Unset** when `PS_PRODUCTION=1` |
| `PS_PRODUCTION` | backend env | Unset on staging/dev | Set `PS_PRODUCTION=1` on prod; requires `PLUGIN_KEY` + `STAFF_KEY` |
| Committed map input | `backend/src/input/main/guilds.json`, `province_data.json` | Seed data for local regen | SF uploads replace them every 300 s on live |
| Spoof generator | `scripts/tools/generate_spoof_province_data.py` | Regenerates fake data | Keep tool; stop using output on prod map |
| Skin test code seeder | `skins/seed_dev_code.py` | Seeds `TEST-CODE-1` | Local/staging only |
| CORS origins | `backend/server.py` | `localhost:3000`, etc. | Restrict to prod domains on deploy |
| Regen hash in SF plugin | via `RestServer.REGEN_HASH` | Shared secret in Java source | Config/env (checklist open item) |
| Internal queue/regen | loopback only | `http://127.0.0.1:18001` on staging | Same: never public hostname |

## Frontend

| Item | Env / path | Dev behavior | Production action |
|------|------------|--------------|-------------------|
| Character UI dev | `NEXT_PUBLIC_CHARACTER_UI_DEV=1` | Fake session, no redeem | **Unset** on prod build |
| UI dev modules | `lib/characters/uiDev.ts`, `sheetDev.ts`, `loreItemsDev.ts`, `kitsDev.ts`; `lib/skins/entitlementsDev.ts` | Fixtures when flag set | Harmless if flag off; verify CI/prod env |
| Creation catalog fixture | `fixtures/creationCatalog.dev.json` | Used by UI-dev lore editor | Local only |
| Dev map route | `/map/r3b1rth` → `mapId=dev` | URL-only test map | Not in nav; optional on prod |
| Map title editor | `/map/editor?map=main\|dev`; entry via **Edit titles** on map viewer; hidden unless `NEXT_PUBLIC_MAP_EDITOR_ENABLED=1` | `NEXT_PUBLIC_CHARACTER_UI_DEV=1` + backend `CHARACTER_UI_DEV=1` uses `ui-dev-session` | Staff-only; unset both on prod |
| Editor regen (no SF hash) | `POST /{map}/editor/regen/fullregen:{tier}` | Bearer staff session token | Not plugin regen URL |
| Province id grid (editor) | `defines/{map}/province_id_grid.bin.gz` | Rebuilt by every regen when `provinces.png` / `provinces.txt` change - no manual step needed. Fallback when editing `provinces.png` without a regen: `python -m scripts.tools.build_province_id_grid --map main` from `TFMCWeb/backend/src` | Editor requires grid file |
| Province geometry (labels) | `defines/{map}/province_neighbors.json`, `province_label_neighbors.json`, `province_centroids.json`, `province_label_grid.bin.gz` \| `.json` | Same gate as the id grid; ~68 s on `main`, so it runs only when the province sources actually change. Manual fallback: `python -m scripts.map_tools.build_province_geometry main` from `TFMCWeb/backend/src`. Set `REGEN_SKIP_PROVINCE_GEOMETRY=1` to force regen to leave it alone | Keep gate on; stale geometry breaks label placement |
| Derived-source stamp | `defines/{map}/derived_sources.json` | sha256 of the sources behind the id grid, geometry and map preview from their last successful build. Delete it to force a rebuild on the next regen | Generated; safe to delete |
| Base map placeholder | `output/{map}/maps/map_preview.webp` | 800x800 WebP (~78 KB on `main`) written by regen when `map.png` changes; frontend shows it while the full base map downloads | Needs a route to be served (see `map_routes.py`) |
| Title coverage check | `python -m src.scripts.util.validate_title_coverage main` | From `TFMCWeb/backend` | After county rebuild on `main` |
| Drinks dev preview | `/profile/drinks/dev-preview` | Local iteration page | Do not link publicly on prod |
| Site dev gate | `NEXT_PUBLIC_SITE_DEV_GATE=1` | Entire UI replaced by dev landing until staff redeem | Unset on public launch |
| Prod build guard | `PS_PRODUCTION=1` at frontend build | `prebuild` fails if `NEXT_PUBLIC_CHARACTER_UI_DEV=1` | Pass `PS_PRODUCTION` build arg in prod Dockerfile |

## Fixture / map data tweaks

| Item | Notes |
|------|-------|
| `input/dev/` | Secondary test map; not in public nav |
| `defines/main/` title JSON | May be edited via map title editor; operator merges ZIP on host |

Sibling repo dev shortcuts: `tfmc_bot/docs/local-dev.md`. SimpleFactions, ArmourShop and TFMCWeb: see those repos.
