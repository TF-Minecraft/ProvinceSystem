# TFMCWeb

TFMCWeb powers **[tfminecraft.net](https://www.tfminecraft.net/)** - the TFMC web hub: interactive political maps, donator cosmetics (skins and drinks), character creation, and identity services.

**Stack:** FastAPI backend + Next.js frontend, deployed with Docker Compose.

## What the site is

| Route | Purpose |
|-------|---------|
| `/` | Hub landing and navigation |
| `/map/{mapId}` | Interactive political map (pan/zoom, labels, settlements, wars) |
| `/profile` | Characters, skin and drink wardrobes, custom items, linked accounts |
| `/profile?tab=skins&skin={new,id}` | Skin upload and review status, inside the Skins tab |
| `/profile?tab=drinks&drink={new,id}` | BreweryX drink builder and review status, inside the Drinks tab. `/drinks` redirects to the tab |
| `/profile?tab=characters&character={id}` | A character: the worn skin, identity, Wardrobe and Kits, attributes, profession EXP, traits, story and clues, inside the Characters tab |
| `/profile?tab=characters&character={id}&view=kits` | The character's kits and their items, with Customise for editable items while a kit is unclaimed |
| `/character/{id}/wardrobe` | A character's wardrobe; `/character/{id}/kits/{kit}/edit/{key}` edits a kit item and `/character/create` is the creator. `/character` redirects to Profile |
| `/map/editor` | Staff map title editor (county through empire); hidden unless `NEXT_PUBLIC_MAP_EDITOR_ENABLED=1` |

Players authenticate with in-game tokens from TFMCWeb - no website passwords.

## Documentation

- **Product and technical docs:** [docs/README.md](docs/README.md)
- **Local development:** [docs/ops/local-dev.md](docs/ops/local-dev.md)
- **Production deploy:** [UPDATE.md](UPDATE.md)
- **Staging stack:** [STAGING.md](STAGING.md)

## Architecture (brief)

```text
SimpleFactions (plugin)
        │  POST upload JSON, GET regenerate
        ▼
FastAPI ── mapgen/regiongen ──► backend/src/output/{map}/…
        │  skins / drinks / characters / identity APIs
        ▼
Next.js  ◄── hub, /map, /profile, /character
```

- Map generators write to `backend/src/output/`; the API serves assets via [`file_routes.py`](../backend/src/api/file_routes.py) (not into `frontend/public`).
- Site records in PostgreSQL; pending uploads on disk under `backend/src/data/`.
- Full detail: [docs/architecture.md](docs/architecture.md)

## Key features

- Multi-layer interactive map with parchment terrain, nation labels, settlements, installations, fort ZOC, and war overlays
- Skins pipeline: code → upload → Discord approve → ArmourShop pack apply
- Drinks pipeline: code → brew form → Discord approve → DrinkBuilder + BreweryX
- Web character creator with kits, lore customise, and MineSkin wardrobe
- Staff map title editor and auth hardening (Bearer sessions, production env guard)

## Integrations

| Component | Role | Docs |
|-----------|------|------|
| SimpleFactions | Map upload, regen, province lookup | [docs/integrations/simplefactions.md](docs/integrations/simplefactions.md) |
| TFMCWeb | Discord link, scoped tokens, Survival gate | [docs/identity/tfmcweb.md](docs/identity/tfmcweb.md) |
| ArmourShop | Skins pack writer + apply | [docs/integrations/armourshop.md](docs/integrations/armourshop.md) |
| tfmc_bot | Discord review, link, moderation | [docs/integrations/discord-bot.md](docs/integrations/discord-bot.md) |
| RPCharacters | Character data + kits | [docs/characters/creator.md](docs/characters/creator.md) |
| DrinkBuilder | BreweryX recipes + `tfmc_drinks` IA | [docs/cosmetics/drinks.md](docs/cosmetics/drinks.md) |

## Technical overview

- **Backend:** Python 3.x, FastAPI, Uvicorn, Pillow (mapgen), PostgreSQL 17
- **Frontend:** Next.js (App Router), React, Tailwind
- **Deploy:** `docker-compose.yml` - backend `:8000`, frontend `:3000`; nginx terminates TLS on the live host
- **Map code:** [loader](../backend/src/scripts/loader), [mapgen](../backend/src/scripts/mapgen), [MapViewer](../frontend/app/components/MapViewer.tsx)
