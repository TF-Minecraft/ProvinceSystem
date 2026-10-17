# TFMCWeb documentation

**tfminecraft.net** is the TFMC web hub: interactive political maps, donator cosmetics (skins and drinks), character creation, Discord accounts, and staff tools backed by a FastAPI backend and Next.js frontend.

The game integration target is Minecraft **1.21.10**; see the [shared platform baseline](https://github.com/TF-Minecraft/Docs/blob/main/PLATFORM.md). TFMCWeb itself uses the web runtimes described in [architecture.md](architecture.md).

This section is the product and technical reference for **TFMCWeb**. Technical documentation for the site lives in this repository’s `docs/` folder; shared platform and other project guides remain in [TF-Minecraft/Docs](https://github.com/TF-Minecraft/Docs/blob/main/README.md).

## Reading order

1. [architecture.md](architecture.md) - stack, routes, data layout
2. Product areas (pick what you need):
   - [map/overview.md](map/overview.md) - map platform goals and layers
   - [cosmetics/skins.md](cosmetics/skins.md) - skins upload and review
   - [cosmetics/drinks.md](cosmetics/drinks.md) - BreweryX drink builder
   - [characters/creator.md](characters/creator.md) - web character creator
   - [characters/wills-estates.md](characters/wills-estates.md) - wills on Profile, memorials and estates
   - [identity/tfmcweb.md](identity/tfmcweb.md) - Discord link, tokens, gate
   - [integrations/patreon.md](integrations/patreon.md) - Patreon supporter linking, entitlement and operations
   - [identity/auth-security.md](identity/auth-security.md) - Discord sign-in, feature codes and staff access
   - [integrations/coreprotect.md](integrations/coreprotect.md) - staff player activity and movement
   - [integrations/rail.md](integrations/rail.md) - staff rail network
   - [integrations/servers.md](integrations/servers.md) - staff plugin versions on Main and Dev
   - [integrations/luckperms.md](integrations/luckperms.md) - staff permission policy and plugin protocol
3. [flows/journeys.md](flows/journeys.md) - end-to-end player and staff journeys
4. [ops/local-dev.md](ops/local-dev.md) - run the site locally
5. [ops/sheet-render.md](ops/sheet-render.md) - 3D review-sheet renderer (prod deploy + smoke)
6. [ops/dev-config.md](ops/dev-config.md) - dev-only flags and shortcuts
7. [ops/diagnostic.md](ops/diagnostic.md) - player diagnostic page and staff reports
8. [ops/patch-notes-jobs.md](ops/patch-notes-jobs.md) - patch note jobs on the TF server

Schema assets: [assets/map-export-schema.json](assets/map-export-schema.json) (SF map export contract).

## Components

| Component | Path | Role | Docs |
|-----------|------|------|------|
| **TFMCWeb** | `TFMCWeb/` | Website + FastAPI: maps, skins, drinks, characters, identity | This folder |
| **TFMCWebBridge** | `tfmcweb/` | The `TFMCWeb` plugin: Discord link, scoped tokens, Survival Discord freeze, warn/ban mirror, Patreon ranks, staff LuckPerms bridge | [identity/tfmcweb.md](identity/tfmcweb.md), [integrations/patreon.md](integrations/patreon.md) |
| **SimpleFactions** | `simplefactions/` | Map bridge: nation JSON upload, queue, regen, province lookup | [integrations/simplefactions.md](integrations/simplefactions.md) |
| **ArmourShop** | `armourshop/` | Skins pack writer + apply | [integrations/armourshop.md](integrations/armourshop.md) |
| **DrinkBuilder** | `drinkbuilder/` | Donator BreweryX drinks + `tfmc_drinks` IA | [cosmetics/drinks.md](cosmetics/drinks.md) |
| **RPCharacters** | `rpcharacters/` | Characters + freeze loop; Discord gate via freeze reason | [characters/creator.md](characters/creator.md) |
| **ItemsAdder** | Server `plugins/ItemsAdder/` | Resource packs: `tfmc_submissions`, `tfmc_armorshop`, `tfmc_drinks` | [integrations/armourshop.md](integrations/armourshop.md) |
| **tfmc_bot** | `tfmc_bot/` | Red-DiscordBot: skins/drinks review, link, ban/warn DMs, Patreon supporter roles | [integrations/discord-bot.md](integrations/discord-bot.md), [integrations/patreon.md](integrations/patreon.md) |

## Shared platform behavior

- **Name:** TFMC = TF Minecraft. "TF" has no expansion.
- **Website sign-in** - Discord OAuth powers account and staff pages. Skins, drinks, and characters also use TFMCWeb-issued UUID-bound codes; redeem → feature API session (8h).
- **Shared cosmetic mint cooldown** - skin + drink share one clock in the **TFMCWeb plugin**, owned by TFMCWebBridge.
- **Discord link** - in-game `/linkdiscord` + Discord `/linkdiscord <code>`; required before upload.
- **PostgreSQL + disk** for site records and pending asset files on the API.
- **SimpleFactions = map only**; **ArmourShop = skins pack writer**; **TFMCWeb = identity + web transport**.

## Ops references

- Deployment and QA checklists: [STAGING.md](../STAGING.md)
- Preview and deployment workflow: [DEPLOY.md](../DEPLOY.md)
- Database configuration, migrations, backups and restores: [PostgreSQL](ops/postgresql.md)
- Update reference: [UPDATE.md](../UPDATE.md)
