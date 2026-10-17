# Research dossier A2 — GemInfusion, Dowsing, Archaeo

Factual dossier for the gameplay wiki. Structured facts only, no guide prose.
Every non-obvious claim cites a file path. Guesses are marked **GUESS**.

Item-reference convention (TLibs): `v.<MATERIAL>` = vanilla, `m.<type>.<id>` = MMOItems,
`ia.<namespace>:<id>` = ItemsAdder. Archaeo's own `config.yml` uses a different
syntax: `STONE_HOE` / `mmoitems:TYPE:ID` / `itemsadder:namespace:id`.

Sources read:
- `C:\Users\MSI\Desktop\plugins\GemInfusion\` (config.yml, goldsmithing.yml, goldsmithing/*.yml)
- `C:\Users\MSI\Desktop\plugin-src\geminfusion\` (full source, `src/main/java/net/tfminecraft/geminfusion/`)
- `C:\Users\MSI\Desktop\plugins\Dowsing\` (config.yml, blocks.yml, types.yml, slots.yml, production_methods.yml, guild_capacity.json)
- `C:\Users\MSI\Desktop\plugins\Archaeo\` (all 7 yml)
- `C:\Users\MSI\Desktop\plugin-src\archeology-plugin\` (docs/gameplay.md, docs/concepto.md, src/, pack/)

---

# 1. GemInfusion

Jar: `C:\Users\MSI\Desktop\plugins\geminfusion-2.2.jar`
Source: `C:\Users\MSI\Desktop\plugin-src\geminfusion` (HEAD `b5a5d76 merged goldsmithing`)
Main class `net.tfminecraft.geminfusion.InfusionMain`, author Drefvelin.
Hard depends on TLibs, MMOItems, MythicLib; soft-depends MMOCore.
(`plugin-src/geminfusion/src/main/resources/plugin.yml`)

## What it is

Two linked crafting minigames: you **infuse** blank gemstones at an enchanting table to turn
them into stat-bearing Infused Gemstones, then you **goldsmith** an infused gem into a piece
of jewellery at a smithing table by depositing gold and hammering it.

## How a player actually uses it

### A. Infusion (enchanting table)

1. Stand at an **enchanting table** (`infusion_blocks: [enchanting_table]`,
   `plugins/GemInfusion/config.yml`). `location_specific: false` on this server, so **any**
   enchanting table works — the single coordinate listed under `locations`
   (`-2590,134,-5321`) is **inert** while that flag is false
   (`InfusionEvents.addGemEvent`, checks `ConfigLoader.useLocations`).
2. Hold a **blank gemstone**. The plugin only accepts an MMOItems stack whose
   `MMOITEMS_DISPLAYED_TYPE` is exactly `Blank Gemstone` **and** whose TYPE.ID matches one of
   the 40 gems in `config.yml` (`InfusionEvents.addGemEvent`).
3. **Right-click** the table. One gem is consumed from the hand and added to the table's
   batch. A title shows `Added <Gem>` and `Current Gem Amount: n/10`. Enchantment-table
   particles + sound.
4. Repeat up to **10 gems per batch**. Adding an 11th is refused: "You can only infuse 10
   gems at a time!"
5. Hold the **infusion token** (`infusion_item: loot.infusion_token` → MMOItems
   `LOOT:INFUSION_TOKEN`) and **left-click** the table. Each left-click is one infusion hit;
   title shows `Infusing... Progress: n/5`.
6. On the **5th hit** the token is consumed (one token per completed batch, not per gem),
   lightning strikes the table, and the infused gems drop one at a time (30-tick delay, then
   one every 2 ticks) with a small random pop velocity.
7. A **Legendary** result broadcasts to the whole server:
   `<player> just infused a <Rarity> <Gem> Gemstone` (`announce: true` on legendary only).

Once the first hit has landed, **no more gems can be added** ("Infusion has already
started"). Batches live in memory on `InfusionEvents.currentStations` — see *Inert /
caveats*.

### B. Goldsmithing (smithing table)

Station: vanilla **smithing table** (`station: v(smithing_table)`,
`plugins/GemInfusion/goldsmithing.yml`), resolved through the TLibs block checker.

1. **Right-click** an empty smithing table → the **project menu GUI** opens
   (`GoldsmithInventoryManager`). Click a project icon to lock that project onto the bench.
2. **Right-click** the bench with each **gold material** in hand — one item per click,
   consumed. Title shows `Added <Material>` and the type progress `n/m`.
3. **Right-click** with an **Infused Gemstone** (any of the 40; must carry
   `MMOITEMS_DISPLAYED_TYPE = Infused Gemstone`) → gem slot `1/1`. Every project on this
   server requires exactly **one** gem (`gem: 1` on all 14 projects).
4. **Left-click** the bench with a goldsmithing hammer/tinker tool → one hit registered;
   title shows `+1 <Hit name>` and the hit-type progress. Hits required scale with the
   materials actually deposited (`GoldsmithStation.recomputeRequiredHits`, noted in
   `goldsmithing/materials.yml`).
5. **Right-click** with the **branding tool** (`m.tools.goldsmith_branding_tool`) → chat
   status readout: project name, each material type `n/m`, `gem: n/1`, each hit type `n/m`.
6. **Left-click** with the branding tool → finish. The finished MMOItems jewellery drops on
   top of the bench, `ENTITY_PLAYER_LEVELUP` + `BLOCK_ANVIL_PLACE` play, and the bench is
   cleared.
7. **Shift + left-click** with the branding tool → cancel, refunding every deposited material
   and the gem to inventory (overflow drops at your feet).

Finishing requires **all three** of: every material bucket full, the gem placed, **every hit
exactly complete**, and the deposited materials **exactly matching** the recipe — no more, no
less (`GoldsmithStation.canFinish` → `checkItems` + `checkExactHits` + `checkExactRecipe`).

Breaking a goldsmithing table with a project on it refunds the deposits to the breaker
(`GoldsmithStationManager.onBreak`). Benches with live projects persist to disk
(`GoldsmithStationStore`).

Permission gate: `professions.goldsmith` (`goldsmithing.yml: permission:`). Default **false**
in `plugin.yml`, so it is **not** available to everyone — it is a profession node granted
elsewhere (LuckPerms / the professions system). `geminfusion.admin` bypasses.
**Infusion itself has no permission gate.**

## Content it adds on this server

### Infusion rarities (`plugins/GemInfusion/config.yml`)

| Rarity | Display | Weight | Broadcast |
|---|---|---|---|
| common | `§aCommon` | 65 | no |
| rare | `§9Rare` | 25 | no |
| epic | `§5Epic` | 7 | no |
| legendary | `§6Legendary` | 3 | **yes, server-wide** |

Weights are summed and normalised (`InfusionEvents.getRarity`), so on this server they are
literal percentages: 65 / 25 / 7 / 3 = 100.

### The 40 gemstones

Socket tiers (the "Gemstone Type" lore line and the MMOItems `GEM_COLOR`): **Basic
Gemstone**, **Polished Gemstone**, **Radiant Gemstone**, **Mythical Gemstone** — 10 gems
each, one per stat. All 40 use MMOItems type `GEMSTONES`, id = the config key.

Ranges below are `min`–`max` per rarity.

**Basic Gemstone**

| Gem | MMOItems id | Stat | common | rare | epic | legendary |
|---|---|---|---|---|---|---|
| Agate | `gemstones.agate` | max_health | 0.20–0.30 | 0.30–0.40 | 0.40–0.50 | 0.50–0.60 |
| Jasper | `gemstones.jasper` | armor | 0.05–0.10 | 0.10–0.15 | 0.15–0.20 | 0.20–0.25 |
| Onyx | `gemstones.onyx` | physical_damage_reduction | 1.00–1.20 | 1.30–1.50 | 1.60–1.80 | 1.90–2.00 |
| Tourmaline | `gemstones.tourmaline` | projectile_damage_reduction | 1.00–1.20 | 1.30–1.50 | 1.60–1.80 | 1.90–2.00 |
| Pearl | `gemstones.pearl` | magic_damage_reduction | 1.00–1.20 | 1.30–1.50 | 1.60–1.80 | 1.90–2.00 |
| Coral | `gemstones.coral` | physical_damage | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Chrysoprase | `gemstones.chrysoprase` | projectile_damage | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Larimar | `gemstones.larimar` | magic_damage | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Rhodonite | `gemstones.rhodonite` | spell_vampirism | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Vesuvianite | `gemstones.vesuvianite` | lifesteal | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |

**Polished Gemstone**

| Gem | MMOItems id | Stat | common | rare | epic | legendary |
|---|---|---|---|---|---|---|
| Turquoise | `gemstones.turquoise` | max_health | 0.60–0.70 | 0.70–0.80 | 0.80–0.90 | 0.90–1.00 |
| Peridot | `gemstones.peridot` | armor | 0.25–0.30 | 0.30–0.35 | 0.35–0.40 | 0.40–0.45 |
| Malachite | `gemstones.malachite` | physical_damage_reduction | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Zircon | `gemstones.zircon` | projectile_damage_reduction | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Apatite | `gemstones.apatite` | magic_damage_reduction | 2.00–2.20 | 2.30–2.50 | 2.60–2.80 | 2.90–3.00 |
| Carnelian | `gemstones.carnelian` | physical_damage | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Labradorite | `gemstones.labradorite` | projectile_damage | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Sardonyx | `gemstones.sardonyx` | magic_damage | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Variscite | `gemstones.variscite` | spell_vampirism | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Wulfenite | `gemstones.wulfenite` | lifesteal | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |

**Radiant Gemstone**

| Gem | MMOItems id | Stat | common | rare | epic | legendary |
|---|---|---|---|---|---|---|
| Aquamarine | `gemstones.aquamarine` | max_health | 1.00–1.10 | 1.10–1.20 | 1.20–1.30 | 1.40–1.50 |
| Garnet | `gemstones.garnet` | armor | 0.45–0.50 | 0.50–0.55 | 0.55–0.60 | 0.60–0.65 |
| Opal | `gemstones.opal` | physical_damage_reduction | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Tanzanite | `gemstones.tanzanite` | projectile_damage_reduction | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Moonstone | `gemstones.moonstone` | magic_damage_reduction | 3.00–3.20 | 3.30–3.50 | 3.60–3.80 | 3.90–4.00 |
| Sunstone | `gemstones.sunstone` | physical_damage | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| Spinel | `gemstones.spinel` | projectile_damage | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| Alexandrite | `gemstones.alexandrite` | magic_damage | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| **Direstone** (key `firestone`) | `gemstones.firestone` | spell_vampirism | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| Cloudstone | `gemstones.cloudstone` | lifesteal | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |

> Mismatch worth flagging: the config key is `firestone`, but the **display name is
> "Direstone"**. The wiki should use **Direstone**.

**Mythical Gemstone**

| Gem | MMOItems id | Stat | common | rare | epic | legendary |
|---|---|---|---|---|---|---|
| Ruby | `gemstones.ruby` | max_health | 1.50–1.60 | 1.60–1.70 | 1.70–1.80 | 1.80–2.00 |
| Sapphire | `gemstones.sapphire` | armor | 0.65–0.70 | 0.70–0.75 | 0.75–0.80 | 0.80–1.00 |
| Topaz | `gemstones.topaz` | physical_damage_reduction | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| Citrine | `gemstones.citrine` | projectile_damage_reduction | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| Morganite | `gemstones.morganite` | magic_damage_reduction | 4.00–4.20 | 4.30–4.50 | 4.60–4.80 | 4.90–5.00 |
| Crystallite | `gemstones.crystallite` | physical_damage | 5.00–5.20 | 5.30–5.50 | 5.60–5.80 | 5.90–6.00 |
| Tiger's Eye | `gemstones.tigers_eye` | projectile_damage | 5.00–5.20 | 5.30–5.50 | 5.60–5.80 | 5.90–6.00 |
| Serpent's Eye | `gemstones.serpents_eye` | magic_damage | 5.00–5.20 | 5.30–5.50 | 5.60–5.80 | 5.90–6.00 |
| Musgravite | `gemstones.musgravite` | spell_vampirism | 5.00–5.20 | 5.30–5.50 | 5.60–5.80 | 5.90–6.00 |
| Taaffeite | `gemstones.taaffeite` | lifesteal | 5.00–5.20 | 5.30–5.50 | 5.60–5.80 | 5.90–6.00 |

Ten stats total: `max_health`, `armor`, `physical_damage_reduction`,
`projectile_damage_reduction`, `magic_damage_reduction`, `physical_damage`,
`projectile_damage`, `magic_damage`, `spell_vampirism`, `lifesteal`. Every socket tier
covers all ten, so the tier is purely a power step.

### What an infused gem looks like

`InfusedGemBuilder` rewrites the blank gem into:
- name `<Rarity> Infused <Gem name>` in the rarity colour (e.g. `§6Legendary Infused Ruby`)
- `MMOITEMS_DISPLAYED_TYPE` → `Infused Gemstone`
- `GEM_COLOR` → the socket tier string (`Basic` / `Polished` / `Radiant` / `Mythical Gemstone`)
- lore lines: `Gemstone Type: <socket tier>`, `Rarity: <rarity>`
- the rolled stat, as MMOItems DoubleData
- an MMOItems `SUCCESS_RATE` (the socketing success chance)
- a hidden Unbreaking 1 glint (`Enchantment.DURABILITY` + `HIDE_ENCHANTS`)
- a PDC tag recording the rarity id (`GemRarityPdc`), used to restore the gem on unsocket

### Goldsmithing materials (`goldsmithing/materials.yml`)

| Material | Display | Item path | Hits it adds per unit |
|---|---|---|---|
| rough_gold | Rough Gold | `m.materials.rough_gold` | Hit ×2, Small Hit ×1 |
| moldable_gold | Moldable Gold | `m.materials.moldable_gold` | Hit ×3, Small Hit ×2, Tinker ×1 |
| shiny_gold | Shiny Gold | `m.materials.shiny_gold` | Hit ×1, Small Hit ×3, Tinker ×2 |

All three sit in the one material bucket `gold` → `§6Gold Materials`
(`goldsmithing/material-types.yml`).

### Goldsmithing tools (`goldsmithing/hits.yml`, `goldsmithing.yml`)

| Tool | MMOItems path | Produces |
|---|---|---|
| Goldsmith Hammer | `tools.goldsmith_hammer` | `§7Hit` |
| Small Goldsmith Hammer | `tools.small_goldsmith_hammer` | `§7Small Hit` |
| Goldsmith Tinker Tool | `tools.goldsmith_tinker_tool` | `§7Tinker` |
| Goldsmith Branding Tool | `m.tools.goldsmith_branding_tool` | status / finish / cancel |

Single hit type: `gold` → `§6Goldsmithing` (`goldsmithing/hit-types.yml`).

### Jewellery projects (`goldsmithing/projects.yml`) — all 14

| Project id | Display | Output item | Tier field | Gem | Recipe |
|---|---|---|---|---|---|
| gold_ring | §fGolden Ring | `m.ring.fine_ring` | minor | 1 | Rough ×4 |
| jeweled_gold_ring | §fJeweled Ring | `m.ring.fine_jeweled_ring` | lesser | 1 | Rough ×3, Moldable ×3 |
| purple_ring | §fPurple Ring | `m.ring.fine_purple_ring` | major | 1 | Rough ×2, Moldable ×4, Shiny ×2 |
| red_ring | §fRed Ring | `m.ring.fine_red_ring` | greater | 1 | Moldable ×4, Shiny ×6 |
| green_ring | §fGreen Ring | `m.ring.fine_green_ring` | greater | 1 | Moldable ×4, Shiny ×6 |
| red_necklace | §fRed Necklace | `m.amulet.fine_red_amulet` | minor | 1 | Rough ×4 |
| purple_necklace | §fPurple Necklace | `m.amulet.fine_purple_amulet` | lesser | 1 | Rough ×3, Moldable ×3 |
| dark_necklace | §fGreen Necklace | `m.amulet.fine_dark_amulet` | major | 1 | Rough ×2, Moldable ×4, Shiny ×2 |
| pendant | §fPendant | `m.amulet.fine_pendant_amulet` | greater | 1 | Moldable ×4, Shiny ×6 |
| green_medal | §fGreen Medal | `m.artifact.good_green_medal` | minor | 1 | Rough ×4 |
| blue_medal | §fBlue Medal | `m.artifact.good_medal` | minor | 1 | Rough ×4 |
| mirror | §fMirror | `m.artifact.good_mirror` | lesser | 1 | Rough ×3, Moldable ×3 |
| chalice | §fChalice | `m.artifact.good_chalice` | major | 1 | Rough ×2, Moldable ×4, Shiny ×2 |
| bracelet | §fGold Bracelet | `m.artifact.good_bracelet` | greater | 1 | Moldable ×4, Shiny ×6 |

`dark_necklace` has id "dark" but displays as **"Green Necklace"** — another key/display
mismatch. The `tier:` field is recorded but **does nothing** (see Inert, below).

Derived hit totals per project (materials × per-unit hits):

| Project | Hits | Small Hits | Tinkers |
|---|---|---|---|
| Rough ×4 (gold_ring, red_necklace, green_medal, blue_medal) | 8 | 4 | 0 |
| Rough ×3 + Moldable ×3 (jeweled_gold_ring, purple_necklace, mirror) | 15 | 9 | 3 |
| Rough ×2 + Moldable ×4 + Shiny ×2 (purple_ring, dark_necklace, chalice) | 18 | 16 | 8 |
| Moldable ×4 + Shiny ×6 (red_ring, green_ring, pendant, bracelet) | 18 | 26 | 16 |

**GUESS** on the arithmetic: this assumes `recomputeRequiredHits` is a plain
per-deposited-unit sum, which is what `materials.yml` documents. I did not read that method.

## Player command table

**There are no player commands.** The only registered command is `/geminfusion`
(`plugin-src/geminfusion/src/main/resources/plugin.yml`), and both subcommands are behind
`geminfusion.admin` (default `op`).

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/geminfusion` (no args) | none | Prints two usage lines | No permission check on the bare form (`CommandManager.onCommand`). Reachable by anyone, but does nothing |

Both infusion and goldsmithing are entirely click-driven.

### Admin/staff commands (excluded from the player table)

| Command | Permission | What it does |
|---|---|---|
| `/geminfusion reload` | `geminfusion.admin` (default op) | Reloads all configs |
| `/geminfusion select <projectId>` | `geminfusion.admin` **and** `professions.goldsmith` | Forces a project onto the smithing table you are looking at (≤6 blocks) |

## Numbers that matter to players

| Thing | Value | Source |
|---|---|---|
| Gems per infusion batch | max **10** | `InfusionEvents.addGemEvent` |
| Infusion hits to finish | **5** left-clicks | `InfusionEvents.infuseHitEvent` |
| Infusion tokens spent | **1 per batch** (consumed on the 5th hit) | same |
| Rarity odds | 65 / 25 / 7 / 3 (common / rare / epic / legendary) | `config.yml` |
| Socket **Success Rate** on an infused gem | `floor(random × (60 − batchSize)) + 40` % | `InfusedGemBuilder.rollStats` |
| → 1 gem in the batch | **40–98 %** | derived |
| → 10 gems in the batch | **40–89 %** | derived |
| Intelligence influence on infusion stat roll | ±20 % max | `config.yml attribute-influence` |
| → floor / neutral / full Intelligence | 0 / 10 / 20 | same |
| Dexterity influence on jewellery stat | ±20 % max | `config.yml jewelry-attribute-influence` |
| → floor / neutral / full Dexterity | 0 / 10 / 20 | same |
| Goldsmith bench click cooldown | 200 ms | `GoldsmithStationManager.CLICK_COOLDOWN_MS` |
| Infusion gem drop cadence | 30-tick delay, then 1 gem per 2 ticks | `InfusionEvents.infuseHitEvent` |

**Key player-facing consequence:** infusing **fewer gems at once yields a higher socket
Success Rate** (`maxChance = 60 − infusionAmount`). Batching 10 costs one token instead of
ten, but caps Success Rate at 89 % instead of 98 %. There is **no failure chance on infusion
itself** — every gem in the batch always produces an infused gem. The "success rate" is
MMOItems' socketing roll, applied later when the gem is put into gear.

**Attribute maths** (`AttributeInfluence.delta`): the MMOCore attribute is read; at or below
`floor` (0) the delta is `−20 %`; it lerps to 0 at `neutral` (10); it lerps to `+20 %` at
`full` (20) and is capped there. The delta multiplies the rolled value
(`statAmount × (1 + delta)`). If MMOCore is absent the attribute reads 0, i.e. the **full
−20 % penalty** (`AttributeInfluence.readAttribute`).

## Features configured but INERT

1. **`goldsmithing/qualities.yml` and `goldsmithing/tiers.yml` are never read.** Grepping the
   whole source tree for `qualities`, `tiers`, `getTier`, `Quality` returns **zero** hits, and
   neither file exists in `plugin-src/geminfusion/drop-in/goldsmithing/` (the shipped
   defaults). So the craft-quality ladder (`§fRusted` / `§aTempered` / `§9Polished` /
   `§5Gleaming` / `§6Masterwork`, with `stat-min`/`stat-max` bands) and the tier multipliers
   (minor 0.5, lesser 0.65, major 0.80, greater 1.0) **affect nothing**. `JewelryOutput.build`
   copies the gem's rolled stat straight across and applies only the Dexterity delta.
   **Do not document tiers or qualities as live mechanics.**
2. **`min-hit-percent: 0.40`** in `goldsmithing.yml` is **inert**. `GoldsmithStation.canFinish`
   calls `checkExactHits()`, which requires every hit counter to be exactly equal to its
   needed value. A 40 % partial finish is impossible.
3. **`location_specific: false` + the `locations:` list** — `-2590,134,-5321` is dead config;
   any enchanting table works.
4. **Per-gem `location_specific` / `location`** — supported by the code
   (`InfusionEvents.addGemEvent` checks `gem.isLocationSpecific()`), but commented out on
   every gem in this server's config. No gem is location-locked.
5. **Legacy particle enums** `Particle.ENCHANTMENT_TABLE` and `Particle.BLOCK_DUST` are used.
   On modern Paper these were renamed. **GUESS** that they still resolve; not verified against
   the running server.

## Cross-links

- **MMOItems** — every gem, tool, material and jewellery output is an MMOItems item; stats are
  written as MMOItems `ItemStat` DoubleData; socketing uses MMOItems `SUCCESS_RATE` and
  `GEM_COLOR` (so the four socket tiers are MMOItems gem colours, i.e. which sockets a gem
  fits). Affected MMOItems stats: the ten listed above.
- **MythicLib** — NBT reading (`io.lumine.mythic.lib.api.item.NBTItem`).
- **MMOCore** — `intelligence` and `dexterity` attributes directly change roll quality. This is
  the plugin's only stat-progression hook.
- **TLibs** — block checker (smithing table), item checker (tools/materials), `IntCounter`
  progress counters, item creator for jewellery output.
- **Professions system** — `professions.goldsmith` permission node. The plugin explicitly
  states it *does not grant* the node (`goldsmithing.yml` comment); something else does.
- **Socket persistence** — `SocketRarityStore`, `GemSocketRebuildListener`,
  `UnsocketedGemRestorer`, `GemUnsocketSnapshotListener`: the plugin re-applies the infused
  name/lore/rarity when a gem is unsocketed from gear, so gems survive the socket/unsocket
  round trip.

## Uncertain / unverified

- Display names and models of the **blank** gemstones live in MMOItems configs (type
  `GEMSTONES`) — **not read**. The names in this dossier are GemInfusion's own `name:` fields,
  which are what the infused item is renamed to.
- Where infusion tokens (`loot.infusion_token`) and the three gold materials come from (drops,
  shops, professions?) is **not determined** here.
- `InfusionEvents.currentStations` is an in-memory list with **no persistence** — gems added to
  an enchanting table and not finished before a restart are **GUESS: lost**. Goldsmithing
  benches, by contrast, do persist (`GoldsmithStationStore`).
- Per-project hit totals in the table above are derived arithmetic, not read from
  `recomputeRequiredHits`.

---

# 2. Dowsing

Jar: `C:\Users\MSI\Desktop\plugins\dowsing-3.1.2.jar` (its plugin.yml reports `version: 3.0.3`).
Author Drefvelin.
`depend: [TLibs, SimpleFactions, MMOItems, MythicLib, ItemsAdder]`, `softdepend: [Magic]`.

Source: [TF-Minecraft/Dowsing](https://github.com/TF-Minecraft/Dowsing) (main class `net.tfminecraft.dowsing.DowsingMain`).
Everything below the config files is read from the jar's bytecode with `javap -p -c`
(JDK 24 read the classes fine; no class-version patching was needed).

## Is Dowsing the Arcane Trace Detector or the Mount Whistle? — NO. It is neither.

**Explicitly: Dowsing is an unrelated system. Do not merge these pages, and do not describe
the dowsing stick as a proximity detector.**

| Wiki page | Actual plugin | Evidence |
|---|---|---|
| **Arcane Trace Detector** (`GEIGER_COUNTER`) | `geiger_counter-1.1.2.jar` | Its `plugin.yml` declares `name: geiger_counter`, `main: net.tfminecraft.geigercounters.geiger_counter`, author Justin, command `/geiger <locate\|move\|limits\|resetlimits\|droplist\|reload>` under `geiger.admin`, plus a `geiger.limit.bypass` per-player drop limit — exactly the single-hidden-source loot race the existing page describes. |
| **Mount Whistle** (`ANIMAL_WHISTLE`) | TFMCCore | [`WhistleListener`](https://github.com/TF-Minecraft/TFMCCore/blob/main/src/main/java/net/tfminecraft/tfmccore/whistle/WhistleListener.java) highlights configured animals on right-click; [`WhistleConfig`](https://github.com/TF-Minecraft/TFMCCore/blob/main/src/main/java/net/tfminecraft/tfmccore/whistle/WhistleConfig.java) defaults to a 64-block detection radius. |
| **Dowsing** | `dowsing-3.1.2.jar` | Guild-owned **resource-node industry**: place a node block in a chunk, pick a node type, slot production methods, run timed production cycles that consume inputs and drop outputs. It hard-depends on **SimpleFactions**, which neither of the other two does. |

The only superficial overlap is the **dowsing stick**, a survey item — and on this server it is
**switched off** (see Inert). Even when enabled it only reports the resource in the chunk you
are standing in, with no directional or proximity signal at all.

## What it is

A guild-level industry system: your guild plants a **resource node** in a chunk, chooses what
kind of operation it is (mine, farm, forestry, quarry...), fits it with tools, refineries,
irrigation and so on, feeds it materials from a barrel underneath, and it produces resource
drops on a repeating timer.

## How a player actually uses it

1. **Be in a guild.** Placing a node without one is refused with
   "You need to have a guild to use nodes!" (`NodeManager.tryCreateNode`).
   `min-members-for-node: 1` (`plugins/Dowsing/config.yml`), so a one-person guild qualifies.
2. **Place a node block** in a chunk (`NodeManager.placeVanillaNode` / `placeFurnitureNode`).
   Two node blocks exist on this server (`plugins/Dowsing/blocks.yml`):

   | Node block | Resource label | Block | Node types it can run |
   |---|---|---|---|
   | `master_node` | Master | `v.end_portal_frame` | ore_mine, magic_mine, farm, plantation, forestry, quarry |
   | `general_node` | General | `ia.tfmc:general_node` (ItemsAdder furniture) | ore_mine, magic_mine, farm, plantation, forestry, quarry |

   Both allow all six types, so the distinction is **not** in what they can run.
   **GUESS:** the difference is which chunks each may be placed in (the Resources database
   keys a chunk to a resource string, and `blocks.yml` gives each block a `resource:` label).
   Unverified. One node per chunk: "Chunk already has a node!"
3. **Right-click the node** to open its GUI (`NodeManager.openNode`). It shows the node level,
   the slot row, ACTIVE/INACTIVE state, an efficiency percentage, and
   "Last Cycle Result: Extracted:" (or "Nothing").
4. **Pick a node type** for the node — one of the six in `types.yml`.
5. **Fill the slots.** Each type exposes a fixed set of slots; each slot offers a list of
   production methods. Clicking a slot selects the method.
6. **Put a BARREL directly under the node block.** `NodeEngine.hasBarrel` checks
   node location + (0, -1, 0) for `Material.BARREL`. Every production method with a `cost:`
   draws its inputs from that barrel each cycle (`NodeEngine.takeInputs`).
7. **Activate the node.** Each cycle it consumes the inputs and drops its output items into
   the world at the node location + 1 block up (`ItemDropper.dropItem` calls
   `World.dropItem`). A **HOPPER one block above the node** (`NodeEngine.hasHopper` checks
   + (0, +1, 0) for `Material.HOPPER`) is how you catch them automatically.
8. **Upgrade** the node with guild-bank money (levels 1 to 10), buy extra node capacity, hand
   the node to another guild ("Transfer Node" marks it claimable; any guild leader who
   interacts then claims it), or delete it.

### Node GUI buttons (strings read from `InventoryManager`)

| Button | Text | Notes |
|---|---|---|
| Activate / deactivate | INACTIVE / ACTIVE, "Click to Deactivate" | "WARNING! Deactivating resets the current cycle! The cost of the current cycle will be refunded." |
| Upgrade | "Click to Upgrade!" ("Max level" at 10) | Costs guild-bank money |
| Downgrade | "Click to Downgrade!" ("Lowest level" at 1) | Cannot go below level 1 |
| Transfer Node | "Click to mark the node as Claimable" / "Any guild leader that interacts with this node will claim it." | icon `mcicons:icon_web` |
| Purchase Extra Capacity | "Purchase Extra Capacity" / "+1 Node Capacity" | **inert on this server, see below** |
| Delete Node | "Delete Node" / "Cannot be undone" / "Only the node block is refunded" / "All other items/upgrades are lost!" | icon `mcicons:icon_cancel` |
| Last cycle | "Last Cycle Result:" / "Extracted:" / "Nothing" | |
| Efficiency | `Efficiency: %s%.2f%%` | colour-graded |
| Confirmation | "Confirm Action" / "Confirm" / "Cancel" | shown on destructive actions |
| Natural yield banner | "Natural Yield Detected!" | only reachable if natural yields are enabled |
| Biome restriction | "Only useable in:" | no node type is biome-restricted on this server |

### Error and gate messages (from `NodeManager`)

"Chunk already has a node!" - "You need to have a guild to use nodes!" -
"You are already filled your node capacity!" - "Must be a guild leader to claim an unclaimed
node!" - "Claimed Node" - "Node had no guild and so it broke" - "Cannot change another
guild's node" - "Cannot upgrade while node is active" - "Cannot change type while node is
active" - "Cannot downgrade while node is active" - "Cannot delete node while active" -
"Cannot change production methods while node is active" - "Node set as claimable" -
"No bank" - "Not enough funds" - "Guild bank does not have enough funds" - "Node is already
at max level" - "Node cannot go below level 1" - "Already purchased the maximum extra
capacity" - "Purchased +1 Capacity" - "This node type can only be used in these biomes:"

**Every state-changing action is blocked while the node is active.** Deactivate first.

### The dowsing stick (`ResourceManager.dowsingEvent`)

1. Hold `tools.dowsing_stick` (MMOItems `TOOLS:DOWSING_STICK`, `config.yml: dowsing_item`).
2. **Right-click air or a block.** 100 ms per-player cooldown.
3. If `enable-natural-yields` is false, chat says "Natural yields are disabled" and it
   **stops**. It is `false` on this server, so this is the only outcome a player can get.
4. Otherwise it looks up your **current chunk** in the Resources database and prints the
   resource name and its natural-yield amount, colour-graded, or "Nothing found here".

| Natural yield in the chunk | Colour |
|---|---|
| 1 or less | DARK_RED |
| 2-3 | RED |
| 4-5 | YELLOW |
| 6-7 | GREEN |
| 8 or more | DARK_GREEN |

(Thresholds read from the `if_icmple` chain at offsets 264-315 of `ResourceManager.class`.)

There is **no beeping, no proximity, no direction** — it reads the chunk you stand in, full stop.

## Content it adds on this server

### The six node types (`plugins/Dowsing/types.yml`)

| Type | Display | Base timer | Resource | Icon item | Slots | natural-yield-per-yield |
|---|---|---|---|---|---|---|
| ore_mine | Ore Mine | 240 | mineral | `v.raw_iron` | tool, ore focus, refinery, light, explosives | 2 |
| magic_mine | Magical Mine (light purple) | 240 | magic | `m.currency.enchanted_dust` | tool, magic focus, refinery, light, explosives | 2 |
| farm | Farm | 120 | farm | `m.foods.lettuce` | farming tool, vegetable focus, fertilizer, farm irrigation | 1 |
| plantation | Plantation | 120 | plantation | `v.sugar_cane` | farming tool, plantation focus, fertilizer, farm irrigation | 1 |
| forestry | Forestry | 60 | wood | `v.oak_sapling` | forestry tool, wood focus, refinery, forestry irrigation | 1 |
| quarry | Quarry | 60 | quarry | `v.granite` | shovel tool, quarry focus, refinery, light, explosives | 1 |

All six share `time-reduction-per-natural-yield: -2.0`.

### Node level ladder — identical for all six types

Verified byte-identical: the md5 of each type's `levels:` block is the same
(`8e89dc67df01d66d1b3710d4c819e0bc`).

| Level | Cost | Yield | time_modifier | Prestige | Upkeep |
|---|---|---|---|---|---|
| 1 | 0 | +1 | +45 | - | 4 |
| 2 | 40 | +1 | +40 | 1 | 8 |
| 3 | 80 | +2 | +35 | 2 | 12 |
| 4 | 160 | +2 | +30 | 4 | 16 |
| 5 | 320 | +3 | +25 | 8 | 20 |
| 6 | 640 | +3 | +20 | 16 | 24 |
| 7 | 1280 | +4 | +15 | 32 | 28 |
| 8 | 2560 | +4 | +10 | 64 | 32 |
| 9 | 5120 | +5 | +5 | 128 | 36 |
| 10 | 10060 | +6 | 0 | 256 | 40 |

Level 10 costs **10060**, not 10240 — that is literally what the file says. Total 1 to 10:
**20,260**.

### Slots (`plugins/Dowsing/slots.yml`)

| Slot id | GUI slot | Methods offered |
|---|---|---|
| tool_slot | 10 | stone / iron / steel / diamond / abyssalite / mythril tools |
| tool_slot_farming | 10 | stone / iron / steel / diamond / abyssalite / mythril hoes |
| tool_slot_forestry | 10 | stone / iron / steel / diamond / abyssalite / mythril axes |
| tool_slot_shovel | 10 | stone / iron / steel / diamond / abyssalite / mythril shovels |
| ore_mine_focus_slot | 11 | iron_ore_focus, copper_ore_focus, rare_ore_focus, gemstone_focus |
| magic_mine_focus_slot | 11 | dust_focus, artifact_focus |
| vegetable_focus_slot | 11 | vegetable_farm, onion_farm, exotic_farm, yeast_production, fruit_orchard, exotic_fruit_orchard |
| plantation_focus_slot | 11 | material_plantation, spice_plantation, sweet_spice_plantation |
| wood_focus_slot | 11 | wood_focus, bark_focus, rare_wood_focus |
| quarry_focus_slot | 11 | stone_focus, salt_focus, gold_focus |
| refinery_slot | 12 | no / basic / advanced / industrial / arcane refinery |
| fertilizer_slot | 12 | no / basic / advanced fertilizer |
| light_slot | 13 | no_light, torches, lanterns |
| irrigation_slot_forestry | 13 | no / basic / steam powered / arcane forestry irrigation |
| irrigation_slot_farm | 13 | no / basic / steam powered / arcane farm irrigation |
| explosives_slot | 14 | no_explosives, basic_explosives, dynamite, arcane_mining |

### Focus production methods — what each node actually produces

Drop numbers are relative weights inside that method's drop table.

**Ore Mine focuses**

| Focus | Display | Prereq | Effects | Drops (weight) |
|---|---|---|---|---|
| iron_ore_focus | Iron Ore Mine | - | yield +20, time -100, upkeep 5 | raw_iron 80, raw_gold 10, diamond 10 |
| copper_ore_focus | Copper Ore Mine | - | yield +80, time -100, upkeep 10 | raw_copper 100 |
| rare_ore_focus | Rare Ore Mine | - | prestige 4, upkeep 20 | `m.materials.niter` 50, `m.materials.arcane_crystal` 50 |
| gemstone_focus | Gemstone Mine | **diamond_tools** | prestige 8, time +100, upkeep 20 | `m.loot.basic_gemstone_pouch` 65, `polished_gemstone_pouch` 25, `radiant_gemstone_pouch` 7, `mythical_gemstone_pouch` 3 |

**Magical Mine focuses**

| Focus | Display | Prereq | Effects | Drops | Input cost |
|---|---|---|---|---|---|
| dust_focus | Dust Mine | - | yield +4, upkeep 10 | `m.currency.enchanted_dust` 100 | - |
| artifact_focus | Artifact Mine | **diamond_tools** | prestige 8, time +200, upkeep 20 | `magic.(rarity=common)` 65, uncommon 25, rare 7, legendary 3 | `m.currency.enchanted_dust` x4 |

**Farm focuses** (all drop ItemsAdder `playbox_custom_crops` seeds, weight 10 each)

| Focus | Display | Prereq | Effects | Seeds dropped |
|---|---|---|---|---|
| vegetable_farm | Vegetable Farm | - | yield +6, prestige 2, upkeep 5 | cucumber, lettuce, rhubarb, corn |
| onion_farm | Onion Farm | - | yield +6, prestige 2, upkeep 5 | onion, garlic |
| exotic_farm | Exotic Farm | - | yield +6, prestige 2, upkeep 5 | rice, mustard, olive |
| yeast_production | Yeast Production | - | yield +6, prestige 2, upkeep 5 | yeast |
| fruit_orchard | Fruit Orchard | **basic_farm_irrigation** | yield +6, prestige 2, upkeep 5 | apple, plum, grape, strawberry, peach, pistachio, tomato |
| exotic_fruit_orchard | Exotic Fruit Orchard | **basic_farm_irrigation** | yield +6, prestige 2, upkeep 5 | orange, lemon, lime, cherry, pineapple, banana, cactusfruit |

**Plantation focuses**

| Focus | Display | Prereq | Effects | Drops |
|---|---|---|---|---|
| material_plantation | Material Plantation | - | yield +20, prestige 8, time -50, upkeep 5 | `ia.iasurvival:tobacco` 50, `v.sugar` 50 |
| spice_plantation | Spice Plantation | basic_farm_irrigation | yield +4, prestige 4, upkeep 10 | sugar 40, spiceleaf / basil / blackpepper seeds 20 each |
| sweet_spice_plantation | Sweet Spice Plantation | basic_farm_irrigation | yield +4, prestige 4, upkeep 10 | sugar 40, vanilla / cinnamon / nut seeds 20 each |

**Forestry focuses**

| Focus | Display | Prereq | Effects | Drops |
|---|---|---|---|---|
| wood_focus | Log Forestry | - | yield +10, upkeep 5 | `m.materials.wood_core` 100 |
| bark_focus | Bark Forestry | - | yield +10, upkeep 10 | `m.materials.bark` 100 |
| rare_wood_focus | Rare Wood Forestry | **diamond_axes** | yield +4, prestige 16, upkeep 10 | valewood / runebark / amberpine / goldmaple / silk, 20 each |

**Quarry focuses**

| Focus | Display | Prereq | Effects | Drops |
|---|---|---|---|---|
| stone_focus | Stone Quarry | - | yield +10, upkeep 5 | `m.materials.stone_core` 100 |
| salt_focus | Salt Quarry | - | yield +10, upkeep 10 | `m.ingredients.salt` 100 |
| gold_focus | Gold Quarry | - | prestige 16, upkeep 10 | `m.materials.rough_gold` 50, `moldable_gold` 30, `shiny_gold` 20 |

> **Cross-link worth calling out in the wiki:** the Gold Quarry is the only Dowsing method
> that produces Rough / Moldable / Shiny Gold — the three GemInfusion goldsmithing materials.
> And the Gemstone Mine drops four gemstone pouches that map one-to-one onto GemInfusion's
> four socket tiers, **at the identical 65 / 25 / 7 / 3 weights as GemInfusion's rarity table**.

### Tool tiers

The pickaxe row is shown; the shovel, axe and hoe rows carry the same numbers with the
matching tool item. Costs are per cycle, taken from the barrel.

| Tool | Display | Effects | Cost |
|---|---|---|---|
| stone_tools | Stone Tools | time +150, `add_drop(nothing,50)` | cobblestone x2, stick x2 |
| iron_tools | Iron Tools | time +50, `add_drop(nothing,25)` | iron_ingot x2, stick x2 |
| diamond_tools | Diamond Tools | time +10 | diamond x2, stick x2 |
| steel_tools | Steel Tools | prestige 20, yield +1, time -10 | `m.materials.steel_ingot` x2, stick x2 |
| abyssalite_tools | Abyssalite Tools | prestige 40, yield +2, time -30, upkeep 2 | `m.materials.abyssalite_ingot` x1, `refined_maplewood` x1 |
| mythril_tools | Mythril Tools | prestige 80, yield +3, time -50, upkeep 4 | `m.materials.mythril_ingot` x1, `refined_elderwood` x1 |

`add_drop(nothing,50)` on stone tools means **half of a stone-tool node's drop table is
literally nothing** (`ItemDropper` special-cases the string `nothing`). Iron tools: 25.
Diamond and above have no `nothing` entry at all. **This is the single biggest early upgrade.**

### Support modules

| Slot | Method | Display | Prereq | Effects | Cost |
|---|---|---|---|---|---|
| Explosives | no_explosives | No Explosives | - | time +20 | - |
| | basic_explosives | Basic Explosives | - | prestige 4, upkeep 1 | gunpowder x1 |
| | dynamite | Dynamite | - | prestige 8, time -10, upkeep 2 | `m.materials.dynamite` x1 |
| | arcane_mining | Arcane Mining | - | prestige 16, time -20, upkeep 4 | dynamite x1, arcane_crystal x2 |
| Refinery | no_refinery | No Refinery | - | time +80 | - |
| | basic_refinery | Basic Refinery | - | prestige 2, time +40 | coal x2 |
| | advanced_refinery | Advanced Refinery | - | prestige 4, time +20, upkeep 1 | coal x4 |
| | industrial_refinery | Industrial Refinery | - | prestige 8, upkeep 2 | coal x8 |
| | arcane_refinery | Arcane Refinery | - | prestige 16, time -10, upkeep 4 | coal x8, arcane_crystal x2 |
| Light | no_light | No Lights | - | time +20 | - |
| | torches | Torches | - | prestige 2, time +10, upkeep 2 | coal x2 |
| | lanterns | Lanterns | - | prestige 4, upkeep 4 | coal x4, iron_ingot x2 |
| Fertilizer | no_fertilizer | No Fertilizer | - | time +20 | - |
| | basic_fertilizer | Basic Fertilizer | - | prestige 2, time +10, upkeep 2 | bone_meal x4 |
| | advanced_fertilizer | Advanced Fertilizer | **basic_farm_irrigation** | prestige 4, upkeep 4 | `m.materials.fertilizer` x2 |
| Forestry irrigation | no_forestry_irrigation | No Forestry Irrigation | - | time +80 | - |
| | basic_forestry_irrigation | Basic Forestry Irrigation | - | prestige 2, time +40 | cup_of_water x4 |
| | steam_powered_forestry_irrigation | Steam Powered Forestry Irrigation | **iron_axes** | prestige 8, upkeep 2 | cup_of_water x4, coal x8 |
| | arcane_forestry_irrigation | Arcane Forestry Irrigation | **diamond_axes** | prestige 16, time -10, upkeep 4 | cup_of_water x4, arcane_crystal x2, coal x8 |
| Farm irrigation | no_farm_irrigation | No Farm Irrigation | - | time +80 | - |
| | basic_farm_irrigation | Basic Farm Irrigation | - | prestige 2, time +40 | cup_of_water x4 |
| | steam_powered_farm_irrigation | Steam Powered Farm Irrigation | **iron_hoes** | prestige 8, upkeep 2 | cup_of_water x4, coal x8 |
| | arcane_farm_irrigation | Arcane Farm Irrigation | **diamond_hoes** | prestige 16, time -10, upkeep 4 | cup_of_water x4, arcane_crystal x2, coal x8 |

**Reading the numbers:** every "none" module carries a *positive* `time_modifier`, i.e. a
penalty. Fitting basic gear removes the penalty; the arcane tier goes negative (a real speed
bonus). Higher tiers universally trade **upkeep** for **speed and prestige**.

### Prerequisite chains a player has to plan around

- `gemstone_focus` and `artifact_focus` need **diamond_tools** in the tool slot.
- `rare_wood_focus` and `arcane_forestry_irrigation` need **diamond_axes**.
- `arcane_farm_irrigation` needs **diamond_hoes**; `steam_powered_farm_irrigation` needs
  **iron_hoes**; `steam_powered_forestry_irrigation` needs **iron_axes**.
- `fruit_orchard`, `exotic_fruit_orchard`, `spice_plantation`, `sweet_spice_plantation` and
  `advanced_fertilizer` all need **basic_farm_irrigation** fitted first.

## Player command table

**There are no player commands.** `/dowsing` is the only registered command, and
`CommandManager.onCommand` calls `Permissions.isAdmin(sender)` **before any subcommand
dispatch**; failing it prints "You do not have access to this command!" and returns false.
`Permissions.Permission_Admin = "dowsing.admin"`, `default: false`
(`dowsing-3.1.2.jar!/permissions.yml`).

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | - | - | Everything is done by placing / right-clicking the node block, and by right-clicking with the dowsing stick |

### Admin/staff commands (excluded from the player table)

| Command | Permission | What it does |
|---|---|---|
| `/dowsing reload` | `dowsing.admin` (default false) | Reload configs |
| `/dowsing createresource <resource> <a> <b>` | `dowsing.admin` | Writes a resource entry for the chunk you are standing in; replies "Resource saved" |
| `/dowsing deleteresource` | `dowsing.admin` | Removes the chunk's resource entry; replies "Resource deleted" |

`createresource` reads `args[1]` as the resource name and concatenates `args[2]` and
`args[3]`; the exact meaning of the last two arguments is **unverified** (the disassembly
shows a `makeConcatWithConstants` of args 2 and 3, keyed on
`player.getLocation().getChunk().toString()`).

## Numbers that matter to players

| Thing | Value | Source |
|---|---|---|
| Node capacity per guild | **1** base | `config.yml` comment on `members_per_node_capacity` |
| Extra capacity from members | **disabled** (`members_per_node_capacity: -1`) | `config.yml` |
| Max extra capacity purchasable | **0** | `config.yml max-extra-capacity-from-members` |
| Cost per +1 capacity | 1250 | `config.yml extra-capacity-cost` |
| Min guild members to own a node | 1 | `config.yml min-members-for-node` |
| Input cycle length | 720 | `config.yml input_cycle_length` (unit unstated) |
| Efficiency growth per member | +0.1 | `config.yml efficiency-growth-per-member` |
| Max efficiency per member | 25.0 | `config.yml max-efficiency-per-member` |
| Efficiency lost on changing node type | **40.0** | `config.yml efficiency-loss-type` |
| Efficiency lost on changing a production method | **0.0** (free) | `config.yml efficiency-loss-pm` |
| Node base timers | ore/magic 240, farm/plantation 120, forestry/quarry 60 | `types.yml` |
| Level 10 upgrade cost | 10060 | `types.yml` |
| Total cost levels 1 to 10 | 20,260 | derived sum |
| Dowsing stick cooldown | 100 ms | `ResourceManager.dowsingEvent` |
| Barrel (inputs) | exactly 1 block **below** the node | `NodeEngine.hasBarrel` |
| Hopper (output catch) | exactly 1 block **above** the node | `NodeEngine.hasHopper` |

**Practical consequence of this config:** with `members_per_node_capacity: -1` and
`max-extra-capacity-from-members: 0`, **every guild on this server has exactly one node
slot**, no matter how many members it has or how much money it holds.

Changing your node's **type** costs 40 efficiency; changing a **production method** costs
nothing. Experimenting with focuses, tools and modules is free; turning a Farm into a Quarry
is not.

## Features configured but INERT

1. **The dowsing stick is dead.** `enable-natural-yields: false` (`config.yml`). Right-clicking
   with `tools.dowsing_stick` can only ever produce "Natural yields are disabled"
   (`ResourceManager.dowsingEvent`, the `Cache.naturalYieldEnabled` branch at bytecode offset
   164). Everything downstream — chunk resource lookup, the colour grades, "Nothing found
   here" — is unreachable. **The plugin is named after a mechanic that is currently switched off.**
2. **Natural-yield node bonuses are therefore probably dead too.** Every node type's
   `natural-yield-per-yield` and `time-reduction-per-natural-yield: -2.0` depend on a chunk
   having a stored natural yield, and `InventoryManager` has a "Natural Yield Detected!" banner
   that would never fire. **GUESS:** `Node.getNaturalYieldFromChunk` still reads the database
   independently of the flag, so nodes in staff-registered resource chunks may still get the
   bonus even though players cannot survey for them. Not verified.
3. **Extra node capacity is unbuyable.** `max-extra-capacity-from-members: 0` means the GUI's
   "Purchase Extra Capacity / +1 Node Capacity" button always answers "Already purchased the
   maximum extra capacity". The `extra-capacity-cost: 1250` price is never charged.
4. **Member-scaled capacity is off** (`members_per_node_capacity: -1`).
5. **Biome restrictions are unused.** The bytecode contains "This node type can only be used in
   these biomes:" and the GUI has an "Only useable in:" lore line, but **no `biome` key appears
   anywhere** in `types.yml`, `production_methods.yml` or `blocks.yml`. No node type is
   biome-locked.
6. **`guild_capacity.json` is 0 bytes** — no guild has ever bought extra capacity, consistent
   with (3).
7. **`efficiency-loss-pm: 0.0`** — the production-method change penalty exists in code but is
   configured to zero.
8. **`softdepend: [Magic]`** — the Artifact Mine's `add_drop(magic.(rarity=...))` entries are
   the only references to it. **GUESS** that these resolve through the installed
   `magic-0.1.0.jar`; not verified.

## Cross-links

- **SimpleFactions** (`net.tfminecraft.simplefactions.guild.Guild`) — **hard dependency**. Node
  ownership, the guild bank (upgrade costs, capacity purchases), guild-leader-only claiming,
  member-count-driven efficiency and the node capacity limit all live there. Dowsing is a
  guild feature, not a solo one.
- **The guild economy** — upgrades, capacity and per-cycle upkeep are charged to the **guild
  bank** ("No bank", "Guild bank does not have enough funds").
- **Guild prestige** — almost every production method grants `prestige(n)`. Prestige is a
  SimpleFactions stat, not an MMOCore one.
- **GemInfusion** — Gold Quarry is the source of Rough / Moldable / Shiny Gold; Gemstone Mine
  drops the four gemstone pouches matching GemInfusion's four socket tiers at identical
  65/25/7/3 weights.
- **ItemsAdder** — `general_node` is furniture (`ia.tfmc:general_node`); all farm and
  plantation seed drops are `ia.playbox_custom_crops:*`; the GUI uses `mcicons:*` icons;
  tobacco is `ia.iasurvival:tobacco`.
- **CustomCrops** (`CustomCrops-3.6.49.jar` is installed) — the `playbox_custom_crops` seeds
  are that plugin's crops, so farming nodes feed the farming system rather than producing
  finished goods.
- **MMOItems** — the dowsing stick, all tool tiers, materials, foods, ingredients, currency
  (`m.currency.enchanted_dust`) and the gemstone pouches.
- **MythicLib** — NBT reading for the dowsing stick.
- **Magic plugin** (soft dependency) — the Artifact Mine's rarity-keyed drops.
- **Cooking / BreweryX / DrinkBuilder** — **GUESS**, not verified: salt, spices, yeast and
  cups of water are cooking and brewing inputs, so plantation and farm nodes likely feed
  those systems.

## Uncertain / unverified

- **What distinguishes `master_node` from `general_node`** — both list all six types; the
  `resource:` label (Master vs General) is the only difference in `blocks.yml`. **GUESS:** a
  `master_node` chunk can host any resource while a `general_node` matches only its chunk's
  stored resource. Not verified.
- **How the cycle timer is actually computed** from `timer`, level `time_modifier`, module
  `time_modifier`s and efficiency. The effect names are clear; the formula lives inside
  `Node.tick` / `Node.tickCycle` and was not disassembled in full.
- **`input_cycle_length: 720`** — the unit (ticks? seconds? cycles?) is not stated anywhere in
  the config or comments.
- **Where the dowsing stick, the node blocks, and the steel / abyssalite / mythril tools come
  from** (crafting? shops? professions?) — not determined.
- **What "efficiency" multiplies** — yield, speed, or both — not determined.
- **The Mount Whistle's actual plugin** — confirmed *not* Dowsing, but not positively
  identified.
- No decompiler was used, only `javap`. Control flow was read from bytecode, so any claim
  above that is not a literal string constant or a config value should be treated as a careful
  reading rather than a source quote.

---

# 3. Archaeo (archeology-plugin)

Jar: `C:\Users\MSI\Desktop\plugins\archeology-plugin-1.0.jar`
Source: [TF-Minecraft/Archaeo](https://github.com/TF-Minecraft/Archaeo) (package `net.tfminecraft.archaeo`, author **nowko**); read from a local clone at `C:\Users\MSI\Desktop\plugin-src\archeology-plugin`
Data folder: `C:\Users\MSI\Desktop\plugins\Archaeo\`
`softdepend: [ItemsAdder, MMOItems]` — **both optional**. The jar runs on pure vanilla items.

The plugin guides now live in the central Docs repository. Historical source
paths quoted below refer to these relocated pages:
- [Gameplay guide](https://github.com/TF-Minecraft/Docs/blob/main/projects/Archaeo/docs/gameplay.md) (formerly `docs/gameplay.md`) — the player loop
- [Original design reference](https://github.com/TF-Minecraft/Docs/blob/main/projects/Archaeo/docs/concepto.md) (formerly `docs/concepto.md`, Spanish); sections are marked
  *borrador* (draft) / *propuesta* (proposed) / *acordado* (agreed). **Treat anything marked
  borrador or propuesta as not-shipped design talk, not as wiki material.**
- [Pack installation](https://github.com/TF-Minecraft/Docs/blob/main/projects/Archaeo/docs/pack-installation.md) (formerly `pack/README.md`)
  and [custom-pack player guide](https://github.com/TF-Minecraft/Docs/blob/main/projects/Archaeo/docs/pack-gameplay.md) (formerly `pack/GAMEPLAY.md`)
- `AGENTS.md` — repo conventions only, no gameplay content

## Which pack is authoritative?

**The deployed server files are authoritative; `pack/` is a reference drop-in that has
already been applied — but applied imperfectly.**

The plugin's own `pack/` folder is a *source* copy of what to install. It was clearly used:
- `C:\Users\MSI\Desktop\plugins\MMOItems\item\tools.yml` lines 786-912 contain all ten
  Archaeo TOOLS templates.
- `C:\Users\MSI\Desktop\plugins\MMOItems\crafting-stations\archeology-station.yml` exists
  with the full recipe list.
- `C:\Users\MSI\Desktop\plugins\ItemsAdder\contents\ia_tfmc\contents\base.yml` defines both
  furniture pieces.

But the pack was installed under the server's **own** ItemsAdder namespace `tfmc` (folder
`contents/ia_tfmc/`, `info.namespace: tfmc`), **not** the pack's `archeo` namespace. There is
no `archeo` and no `furniture` ItemsAdder namespace on this server. The archaeology models
live at `contents/ia_tfmc/resourcepack/assets/tfmc/models/furniture/archeology_cabinet.json`
and `archeology_station.json`.

`tfmc_pack` (the main ItemsAdder pack) does **not** contain the archaeology content; `ia_tfmc`
does.

### Two suspected live misconfigurations — flag these before writing any wiki page

**(1) MMOItems type is `TOOL` in the deployed config but `TOOLS` everywhere else.**

| File | Line |
|---|---|
| `plugins/Archaeo/config.yml` (LIVE) | `item: mmoitems:TOOL:ARCHAEO_TRACKER` and `mmoitems:TOOL:HAND_PICK`, `...:MATTOCK`, `...:BREAKER_PICK`, `...:ARCHAEO_PENCIL` etc. |
| `plugin-src/archeology-plugin/pack/plugins/Archaeo/config.yml` (reference) | `item: "mmoitems:TOOLS:ARCHAEO_TRACKER"` — with `# item: "mmoitems:TOOL:ARCHAEO_TRACKER"` commented out as the alternative |
| `plugins/MMOItems/item/tools.yml` | all ten Archaeo templates live here, i.e. MMOItems type **TOOLS** |
| `plugins/MMOItems/crafting-stations/archeology-station.yml` | every recipe outputs `type: TOOLS` |
| `plugins/MMOItems/item-types.yml` | line 434 `TOOLS:` (with `parent: 'TOOL'`), line 1425 `TOOL:` — both types exist; `plugins/MMOItems/item/tool.yml` is **empty (1 line)** |
| `pack/README.md` | "MMOItems type **TOOLS**, not `TOOL`" — stated explicitly |

`ItemMatcher.matchesMmoItems` (line 276) does
`type.equalsIgnoreCase(ref.primary()) && id.equalsIgnoreCase(ref.secondary())`, where `type`
comes from MMOItems `getTypeName(stack)`. A stack built from `tools.yml` reports `TOOLS`; the
live config asks for `TOOL`. **These do not match.** If `getTypeName` really returns the
literal template type (not the parent), then **every Archaeo MMOItems tool on this server is
currently unrecognised** and the whole loop falls back to vanilla items only (recovery
compass, stone hoe, stick, vanilla pickaxes/shovels, brush, paper, feather).

Confidence: high on the mismatch, **not verified in-game**. MMOItems `getTypeName` semantics
with a `parent:` type were not tested. **Do not write "hold the Field Compass" in the wiki
until someone confirms this in-game.**

**(2) Cabinet namespace.**

| File | Value |
|---|---|
| `plugins/Archaeo/config.yml` (LIVE) | `cabinet: itemsadder:furniture:archeology_cabinet` |
| `pack/plugins/Archaeo/config.yml` | `cabinet: "itemsadder:tfmc:archeology_cabinet"` |
| `pack/README.md` furniture id | `itemsadder:archeo:archeology_cabinet` |
| Actually installed | namespace `tfmc`, id `archeology_cabinet` → **`tfmc:archeology_cabinet`** |

`ItemRef.parse` turns `itemsadder:furniture:archeology_cabinet` into an ITEMSADDER ref with
primary `furniture:archeology_cabinet`; `ItemMatcher.matchesItemsAdder` compares that against
the furniture's real namespaced id `tfmc:archeology_cabinet`. **No match.** The lab, cleaning,
registration and reading steps would be unreachable.
`pack/README.md` already warns about exactly this ("Align that line with the namespace you
actually load"). Also **not verified in-game**.

## What it is

A long-form archaeology profession: hidden ruins are placed on the map by staff, you find one
by ear with a tracker, confirm it with soil samples, plant a camp beside it, then dig the
ground cube by cube over many in-game days, brush out the buried objects, clean and study them
at a cabinet, and display them in a museum.

## How a player actually uses it

> `docs/gameplay.md`: *"Players do not use commands. Staff place hidden ruins on the map; you
> find them by walking, then you plant a camp and dig the ground itself."*

Full loop:
`Tracker → prospect samples → establishment kit → camp board → Hand Pick in the prism →
brush exposed finds → clean and register at the cabinet → plaque on a museum support`

### 1. Find a dig site

- Hold the **tracker**: `mmoitems:TOOL:ARCHAEO_TRACKER` as configured, `TOOLS:ARCHAEO_TRACKER`
  as built — a **Recovery Compass** named **Field Compass** (`<#5b8a9a>`). Any Recovery Compass
  works if the MMOItems match fails.
- Pulses get **faster the closer you are**, and stop entirely for ruins that are already
  established or exhausted. There is **no ruin list and no compass needle**. If the beeps
  fade, you walked the wrong way.
- Ring sizes step up in three bands (`config.yml tracker.wave-radii: [1.2, 2.4, 3.6]`,
  `wave-particle: ENCHANTED_HIT`).
- Standing on the ruin chunk is always the strongest pulse.
- When you are close and facing it, chat tells you to prospect the ground.

| Setting | Value |
|---|---|
| Hard max range | 256 blocks (`tracker.max-range`) — each ruin also has a `detection-radius`; **the smaller wins** |
| Medium band | 64 blocks |
| Close band | 32 blocks |
| Pulse interval far | 70 ticks (3.5 s) |
| Pulse interval close | 5 ticks (0.25 s) |

### 2. Confirm it (prospecting)

- Hold the **prospecting kit**: `ARCHAEO_PROSPECT`, a **Stone Hoe** named **Soil Probe**.
- **Right-click shovel-dug ground**: dirt, grass, sand, gravel, clay, mud. Stone, wool and
  furniture do not count.
- Each sample takes **40 ticks (2 s)**; **moving more than 2 blocks cancels it**.
- Samples must be **at least 3 blocks apart** (`prospect.min-sample-distance: 3`) and each
  cell counts once ("You already sampled this spot. Try another point.").
- **4 distinct samples** confirm the site (`prospect.points-required: 4`).

Staged chat feedback (`ProspectService.resultFor` / `sendResult`):

| Samples (of 4) | Result | Message |
|---|---|---|
| 0-1 | INSUFFICIENT | "Soil sample analysed. Not enough traces yet. (n/4)" |
| 2 | WEAK | "Weak traces of human activity. Keep sampling other points. (n/4)" |
| 3 | POSSIBLE | "Possible archaeological site. One more distinct point should confirm it. (3/4)" |
| 4 | CONFIRMED | confirmation message + `ENTITY_EXPERIENCE_ORB_PICKUP` |

Confirmation is **per player** and still does **not** claim the site.

### 3. Plant the camp

- Hold the **establishment kit**: `ARCHAEO_ESTABLISH`, a **Campfire** named **Camp Kit**.
  (Note: `docs/gameplay.md` says "stick" — that is the jar's vanilla default; the installed
  MMOItems template uses `CAMPFIRE`.)
- Aim at a **neighbour chunk**, not the ruin chunk. A ghost preview follows your look; rotate
  until it sits on valid ground, then confirm.
  Invalid ground shows as `RED_STAINED_GLASS`; the ruin outline shows as
  `LIGHT_BLUE_STAINED_GLASS` (`establish.invalid-block` / `ruin-outline-block`).
- You become **director**. The tracker ignores this ruin from now on.
- The camp chunk is locked while the dig is active. The **prism** (the actual dig volume) is
  the ruin chunk and its depth bands, not the tents.
- Planting the camp **does not spend a work day**.
- **This is not a land claim.** Only people on the roster may dig.

### 4. The camp board

Right-click the board at camp for:
- the **dossier** (interest level, hints)
- the **roster** (18 slots = the first two chest rows; there is no page 2)
- the **finds list**
- **Show limits** — glowing display bars outlining the prism, visible **to you only**, drawn
  *through terrain*, for **12 seconds**, bar thickness **0.08 blocks**, rendered up to
  **96 blocks** away (`excavation.limits`).

The director adds workers by name. `establish.max-staff: 18` (values above 18 are ignored).

### 5. Dig — hear, then release

Inside the prism, **hold left-click** with a listed excavation tool. Vanilla block cracking is
frozen; the plugin decides when a cube leaves. Listen:

| Cue | Meaning |
|---|---|
| Soft clings, then a louder ready chime | Empty fill. **Release on the ready chime** to lift cubes |
| Release too soon | Nothing leaves. The next hold starts clean |
| Release too late | **More** cubes leave — worse control |
| Find cling (different timbre), often with *Stop* | That cube is **not** dirt. Do not treat it as fill; the piece stays in the ground |

HUD shows the **stratum** you are in and **Hand Pick actions left today**.

Tool profiles (`config.yml excavation.tools`, names from `plugins/MMOItems/item/tools.yml`):

| Profile | Items (MMOItems id → vanilla base → display name) | Ready lift | Late lift | Shape | Workday cost |
|---|---|---|---|---|---|
| hand | `AIR` (empty hand) | 1 | 1 | down | 1 |
| light | `HAND_PICK` → Wooden Pickaxe → **Hand Pick** (`<#c2b280>`); `POINTING_TROWEL` → Wooden Shovel → **Pointing Trowel** | 1 | 2 | down | 1 |
| heavy | `MATTOCK` → Stone Pickaxe → **Mattock** (`<#8b6914>`); `GRAFTING_SPADE` → Stone Shovel → **Grafting Spade** | 2 | 4 | around (3x3x2, face-connected) | 1 |
| super-heavy | `BREAKER_PICK` → Iron Pickaxe → **Breaker Pick** (`<#7f7d80>`); `SPOIL_SHOVEL` → Iron Shovel → **Spoil Shovel** | 4 | 8 | random (same 3x3x2, extras picked at random among faces) | 1 |

Break shapes (`config.yml` comment block):
- `down` — straight down (Y-1, Y-2, ...)
- `around` — 3x3x2 grown face-to-face: cardinals, then diagonals, then the layer below
- `random` — same volume; each extra cube is a random face-neighbour of the lift so far

The aimed cube is always first. Extras always share a face with the aim or with a cube already
chosen this lift — **no diagonal hops, no floating cubes**.
Only the `hand` profile has an explicit `release-window-ticks: 20` (1 second after the ready
chime still counts as timely); the other three inherit it.

**Faster vanilla mining (a better tool against that block) only changes *when* the cues fire,
not how many cubes leave.**

After an empty cube comes out, chat and the HUD show **neighbour traces**: how many find cubes
of each material touch the hole, grouped by material — a minesweeper hint
(`excavation.neighbor-traces: true`). **Faces only; diagonals do not count.**

If you ignore a find cling and punch the piece out, **conservation drops**. A destroyed cell
is **gone for good**.

### 6. Brush the find out

Finds are **shapes of connected cubes**, not loot blocks.

- When every remaining cube of a shape has air on a face, the cubes **drip**.
- **Hold right-click** with the **brush** (`BRUSH`, vanilla; the station can craft one) on a
  dripping cube. **40 ticks / 2 seconds** per cube (`brush.hold-ticks: 40`), with a progress
  bar. **Looking away pauses that cube's bar; looking back resumes it.**
- You must clean `min(shape size, 6)` distinct cubes (`brush.max-cells-to-clean: 6`,
  `RecoverService` line 322). Small shapes therefore need the whole shape.
- Then **one item drops**, carrying conservation and provenance.
- **The pick never drops the piece.** Brushing does **not** spend the work day.
  **Conservation 0 means nothing is recovered.**

### 7. Clean, sketch, register (the cabinet)

Take the recovered piece to the **Archeology Cabinet** (ItemsAdder furniture
`tfmc:archeology_cabinet`, display name "Archeology Cabinet"). Right-click **with the piece in
hand** (sneak-click for the vanilla behaviour of the block). Empty-handed clicks do nothing.

| State of the piece | What opens |
|---|---|
| dirty | **lab wipe** window: match each stain to its tool |
| cleaned, no drawing | **Register** (furnace layout: top = drawing, fuel = the piece, result = Register) |
| already filed | a **reading** |

**Lab wipe** (`sketch.lab`): **6 dirty panes** (`dirty-count: 6`). Pick a tool from the rack
and click each pane.

| Tool | Item | Display | Description | Sound |
|---|---|---|---|---|
| water | `WATER_BUCKET` | Water | "Washes mineral crust from ceramic and stone. Do not soak metal." | `ITEM_BUCKET_EMPTY` |
| brush | `BRUSH` | Brush | "Dry-cleans rust and soil. Safe on metal and bone." | `ITEM_BRUSH_BRUSHING_GENERIC` |
| air | `FEATHER` | Air | "Dries mud on organic finds. Do not wet these pieces." | `ITEM_BRUSH_BRUSHING_SAND` |

| Stain | Display | Pane | Correct tool |
|---|---|---|---|
| limescale | Limescale | `ORANGE_STAINED_GLASS_PANE` | water |
| soil | Soil | `BROWN_STAINED_GLASS_PANE` | brush |
| rust | Rust | `RED_STAINED_GLASS_PANE` | brush |
| mud | Mud | `BROWN_STAINED_GLASS_PANE` | air |

> Note for the wiki: **Soil and Mud are the same colour pane** (`BROWN_STAINED_GLASS_PANE`)
> but take **different tools** (brush vs air). The pane colour alone is not enough — the stain
> name matters. Which stains a piece can roll comes from its material (see materials table).

**Field sketch** (`sketch`): hold a **field sheet** (`PAPER`) and use the **pencil**
(`ARCHAEO_PENCIL`, a **Feather** named **Field Pencil**, `<#6e6a66>`) in the other hand — or
click the sheet onto the pencil in the inventory. Sign the map, then register at the cabinet
with the find in hand. **The sheet is consumed; the pencil wears** (`pencil-uses: 64`; 0 would
mean never wears).

**Reading / classification** (`interpretations.yml`): the station asks a short series of
questions about the piece and offers three phrases per question. See the interpretations
tables below.

### 8. Museum

Build any display you like. **Shift + right-click** a recovered Archaeo find onto a listed
support to open its **plaque** — the same reading you get from the camp board. Click without
shift is ordinary Minecraft (hang, rotate, take). Empty slots and ordinary items do nothing.

The deployed `config.yml` has **no `museum:` section**, so `MuseumSettings.defaults()` applies:

| Allowed support |
|---|
| `ITEM_FRAME` |
| `GLOW_ITEM_FRAME` |
| `ARMOR_STAND` |
| `LECTERN` |
| `SHELF` (any `*_SHELF` block) |

`ITEM_DISPLAY` and ItemsAdder display-case furniture are commented out in the shipped default
and absent from the live file — **not available on this server**.

### 9. Exhausted sites

When every find is recovered or destroyed, the excavation **exhausts**: picks and brushes
stop working, but the camp and board remain as the site's memory. Closing the camp (director,
from the board) **frees your excavation slot**. You receive a **field book**
(`CampArchiveBook`); right-click it later to re-read the dossier and finds even after the
tents are gone.

## Content it adds on this server

### Interest levels — how rich a ruin is (`plugins/Archaeo/interest.yml`)

Staff choose the level when registering a ruin chunk.

| Level | Base wealth | Variation | Detection radius | Finds | Relics | Hints | Stratum IV chance | Disturbed chance |
|---|---|---|---|---|---|---|---|---|
| low | 1 | 0 | 64 | 3-5 | 0 | 2 | 0 % | 15 % |
| medium | 3 | 1 | 128 | 5-8 | 0 | 3 | 25 % | 20 % |
| high | 6 | 1 | 256 | 8-12 | 0 | 3 | 60 % | 25 % |
| exceptional | 10 | 2 | 512 | 12-18 | 0 | 4 | 100 % | 30 % |

Generation: `max-shape-attempts: 24`, `use-world-seed: true`, `find-min-cover: 2` (a find must
have at least 2 fill blocks straight above every one of its cells, measured from the chunk's
**median** ground level, so pieces never generate in plain sight on a slope or shore).

Note the **detection radius is the ruin's own cap** and the tracker's `max-range: 256` is the
hard cap — so an *exceptional* ruin's 512 is clipped to 256, and a *low* ruin is only audible
within 64 blocks.

**Relic quotas are 0 at every level** — see Inert.

### Strata — the depth bands (`plugins/Archaeo/strata.yml`)

Depths are measured **below the chunk's median ground Y** (the datum), not absolute Y.

| Id | Order | Display name | Antiquity (config only) | Depth below datum | Always present |
|---|---|---|---|---|---|
| I | 1 | Recent layer | recent | 0-4 | yes |
| II | 2 | Layer II | 300-500 years | 5-9 | yes |
| III | 3 | Layer III | 700-900 years | 10-14 | yes |
| IV | 4 | Deep layer | 1000-1300 years | 15-19 | **no** (see stratum-iv-chance) |

The file states plainly: *"antiquity is leftover config; the HUD and boards do not show it.
Epoch is a station reading."* — so **the "300-500 years" strings never reach the player**. Do
not put them in the wiki as in-game text.

### Find materials (`plugins/Archaeo/materials.yml`)

`survival` scales the buried-conservation roll. It **never depends on how well you dig**.

| Material | Display | Survival | Clean pane | Possible stains | Lab chain (later) |
|---|---|---|---|---|---|
| ceramic | Ceramic | 0.95 | `WHITE_STAINED_GLASS_PANE` | limescale, soil | clean, wash, dry, photograph, interpret |
| metal | Metal | 0.85 | `GRAY_STAINED_GLASS_PANE` | rust | clean, stabilize, photograph, interpret |
| bone | Bone | 0.80 | `WHITE_STAINED_GLASS_PANE` | soil | clean, dry, photograph, interpret |
| organic | Organic | 0.70 | `LIME_STAINED_GLASS_PANE` | mud | dry, conserve, photograph, interpret |
| stone | Stone | **1.00** | `LIGHT_GRAY_STAINED_GLASS_PANE` | limescale | clean, wash, dry, photograph, interpret |

**Stone never rots; Organic loses 30 % before you even arrive.** The `steps:` lists beyond the
first wipe are **not implemented** (the file says "Later chain steps are listed for later").

### Artifacts — everything that can be buried (`plugins/Archaeo/artifacts.yml`)

All nine entries. `weight` is the relative roll chance; total weight = **114**.

| Id | Display | Size (cells) | Material | Rarity | Weight | % of rolls | Strata | Tags | Drops as | Profile |
|---|---|---|---|---|---|---|---|---|---|---|
| `pottery_sherd` | Pottery sherd | 1 | ceramic | common | 24 | 21.1 % | I, II, III, IV | ceramic, settlement | `BRICK` | object |
| `coin` | Coin | 1 | metal | common | 22 | 19.3 % | I, II, III | trade, metal | `GOLD_NUGGET` | object |
| `charcoal` | Fire remains | 1-2 | organic | common | 16 | 14.0 % | I, II, III | fire, domestic | `CHARCOAL` | object |
| `tool` | Tool | 2-3 | metal | uncommon | 14 | 12.3 % | II, III | settlement, metal | `IRON_HOE` | object |
| `vessel` | Vessel | 3-6 | ceramic | uncommon | 10 | 8.8 % | I, II, III | ceramic, ceremonial, deposit | `DECORATED_POT` | object |
| `faunal_dump` | Animal remains | 3-8 | bone | uncommon | 10 | 8.8 % | I, II, III | bone, food, animal | `BONE` | **animal** |
| `ornament` | Ornament | 1-2 | metal | uncommon | 8 | 7.0 % | II, III | ceremonial, trade, ornament | `GOLD_INGOT` | object |
| `sword` | Ancient sword | 3-5 | metal | rare | 6 | 5.3 % | II, III, IV | conflict, metal, blade | `IRON_SWORD` | object |
| `burial` | Burial | **8-15** | bone | rare | 4 | 3.5 % | III, IV | burial, bone | `BONE` | **individual** |

Percentages are mine (weight / 114) and assume a flat weighted roll with no per-stratum
filtering. **In practice the strata filter applies first**, so the real odds in any one band
differ — e.g. only `pottery_sherd` and `sword` can appear in Stratum IV, and only `burial`
and `sword` and `pottery_sherd` reach it at all. Treat the percentage column as indicative.

**Things to tell a player:**
- Only **three** artifacts reach the Deep layer (IV): pottery_sherd, sword and burial — and
  Stratum IV only exists at all on medium-or-better interest ruins.
- **Burial is the biggest shape in the game (8-15 cells)** and the rarest tie (weight 4). It
  is also bone (survival 0.80) and sits in the deepest bands (highest depth penalty), so
  burials are the hardest thing to recover intact.
- `study-notes` are revealed **at camp after the piece is studied**, not on lift:

| Artifact | Study note |
|---|---|
| Coin | "A small struck disc. The face is worn; a mint or a portrait may still be read." |
| Pottery sherd | "A body sherd. The fabric and any surviving slip say more than the shape." |
| Tool | "A working edge, not an ornament. Wear on the bit points to repeated use." |
| Ancient sword | "A blade with little domestic assemblage around it. The fuller and tang still read as a weapon." |
| Vessel | "A closed form. Surviving rim and decoration suggest it was set down, not discarded in pieces." |
| Burial | "Articulated bone, not kitchen scatter. The layout still argues for a grave." |
| Animal remains | "Disarticulated bone with kitchen scatter. This looks like refuse, not a grave." |
| Fire remains | "Charred wood and ash. Repeated burning at this depth looks domestic, not a single pyre." |
| Ornament | "A small decorative piece. The metal does not match the cheapest local work." |

### Hints — the clues on a site's dossier (`plugins/Archaeo/hints.yml`)

A ruin gets `hint-count` of these (2 to 4 depending on interest level), filtered by what was
actually generated. Total weight = **98**.

| Id | Text shown to the player | Weight | Requires |
|---|---|---|---|
| `empty_iv` | "The deepest level is not preserved." | 12 | Stratum IV missing |
| `fire_multi` | "Traces of fire or charcoal at more than one depth." | 10 | a `fire` tag; at least 2 strata |
| `pots_metal` | "Vessel fragments found together with metal." | 10 | **both** `ceramic` and `metal` tags |
| `clustered` | "The remains appear clustered, not scattered." | 8 | wealth 3 or more |
| `scattered` | "The remains are widely scattered across the layer." | 8 | wealth 3 or less |
| `bone` | "There is more bone than tool." | 8 | a `bone` or `burial` tag |
| `blade` | "A blade or weapon, little domestic assemblage." | 8 | a `blade` or `conflict` tag |
| `ornament` | "Small ornamental pieces." | 7 | an `ornament` or `ceremonial` tag |
| `mixed_layer` | "One depth is mixed compared with the others." | 6 | a disturbed band |
| `recent_interrupt` | "The upper layer cuts into those below." | 6 | strata I **and** III both present |
| `trade` | "Materials that do not quite fit this setting." | 6 | a `trade` tag |
| `seed_grain` | "Seeds or grain in the soil." | 5 | a `food` tag |
| `unknown` | "The assemblage does not suggest a clear use." | 4 | wealth 3 or less |

**How to read a hint as a player** (this is the actual value of the table):

| Hint | What it tells you |
|---|---|
| "The deepest level is not preserved." | No Stratum IV — do not dig past ~14 blocks below datum |
| "A blade or weapon..." | There is a `sword` (3-5 cells, can reach IV) |
| "There is more bone than tool." | There is a `burial` (8-15 cells) or `faunal_dump` |
| "Small ornamental pieces." | `ornament` or `vessel` — small, easy to punch through |
| "Materials that do not quite fit this setting." | `coin` or `ornament` |
| "Seeds or grain in the soil." | `faunal_dump` (the only `food`-tagged artifact) |
| "One depth is mixed compared with the others." | A disturbed band: **-10 conservation** on anything in it |
| "The remains appear clustered / scattered" | wealth above / below 3, i.e. roughly interest level |

### Conservation — how well a piece survives

Rolled **once per find when the site is generated**. Digging can only **subtract** from it.
*"a flawless dig does not make a flawless piece."*

Formula (`SiteGenerator` lines 399-407, `config.yml excavation.conservation.buried`):

```
value  = 40 + centredRoll * (100 - 40)         # buried.min 40, buried.max 100, bias 1.0
value -= (stratumOrder - 1) * 4                # depth-penalty
value -= 10  if the band is disturbed          # disturbed-penalty
value *= materials.yml survival (0.70 - 1.00)
result = clamp(1, 100, round(value))
```

The roll is **centred**: a middling piece is common, a pristine one is rare (`bias: 1.0`;
raising bias leans it toward min).

| Stratum | Depth penalty |
|---|---|
| I (Recent layer) | 0 |
| II | -4 |
| III | -8 |
| IV (Deep layer) | -12 |

Worked worst case: an organic find in a disturbed Stratum IV band rolling the minimum:
`(40 - 12 - 10) * 0.70 = 12.6` → **Crumbling**. Worked best case: a stone find in Stratum I
rolling 100: `100 * 1.00 = 100` → **Intact**.

### Conservation grades (`config.yml excavation.conservation.grades`)

Highest match wins; below the last band, or at 0 %, **nothing is recovered**.

| Grade id | Label | Minimum % |
|---|---|---|
| intact | Intact | 92 |
| sound | Sound | 72 |
| worn | Worn | 48 |
| fragmentary | Fragmentary | 24 |
| crumbling | Crumbling | 1 |

### Interpretations — the classification station (`plugins/Archaeo/interpretations.yml`)

Each **type** is one question about the find (not about the site). The station offers **three
phrases** per question. `suggested-by` tags raise a phrase's chance; `suggested-for` artifact
ids guarantee at least one matching phrase among the three offers. **Neither hides the rest** —
you can always choose wrongly.

**Question order by find profile**

| Profile | Question order |
|---|---|
| `object` (7 of 9 artifacts) | Function → Formation → Epoch |
| `individual` (`burial`) | Species → Deposit → Epoch |
| `animal` (`faunal_dump`) | Species → Deposit → Epoch |

Epoch is declared once and shared by all three paths. *"Strata are depth only; they do not
state a date."*

**Function — "What was it for?"**

| Option | Phrase shown | Suggested by tags | Guaranteed for |
|---|---|---|---|
| combat_edge | "combat edge" | blade, conflict | sword |
| working_tool | "working tool" | settlement, domestic | tool |
| vessel | "vessel or container" | ceramic, deposit | vessel, pottery_sherd |
| ornament | "ornament" | ceremonial, ornament, trade | ornament, coin |
| grave_good | "object made to accompany a body" | burial, bone | ornament, vessel |
| unknown_function | "function unknown" | unknown | charcoal |

**Formation — "How did it reach this layer?"**

| Option | Phrase shown | Suggested by tags | Guaranteed for |
|---|---|---|---|
| discarded | "thrown away" | abandonment, scattered, domestic | pottery_sherd, tool, charcoal |
| cached | "hidden or cached" | deposit, clustered | coin, ornament, vessel, sword |
| with_a_body | "laid with a body" | burial, bone | ornament |
| trade_in | "brought in by trade" | trade | coin |
| washed_in | "washed or slumped in" | unknown | pottery_sherd, charcoal |
| unknown_path | "how it arrived is unknown" | unknown | — |

**Epoch — "Which time does it belong to?"** (offered on every path)

| Option | Phrase shown | Suggested by tags | Guaranteed for |
|---|---|---|---|
| recent_occupation | "recent occupation" | — | — |
| era_of_ash | "Era of Ash" | — | — |
| third_exodus | "Third Exodus" | — | — |
| older_heirloom | "older than this burial; left later" | burial, deposit | burial |
| deep_time | "a much older time" | — | — |
| unknown_epoch | "epoch unknown" | unknown | — |

> **Lore hook for the wiki:** "Era of Ash" and "Third Exodus" are the only named in-world
> epochs anywhere in Archaeo's data. No other file references them, so their meaning is
> defined elsewhere in the server's lore (or nowhere yet).

**Species — "What species is it?"** (individual / animal paths only)

| Option | Phrase | Profile | Suggested by | Guaranteed for |
|---|---|---|---|---|
| homo_sapiens | "Homo sapiens" | individual | burial, bone | burial |
| neanderthal | "Neanderthal" | individual | burial, bone | — |
| denisovan | "Denisovan" | individual | burial | — |
| archaic_human | "archaic human" | individual | burial, bone | — |
| unidentified_individual | "unidentified individual" | individual | unknown, bone | — |
| dog | "dog" | animal | animal, bone | — |
| cattle | "cattle" | animal | food, animal | faunal_dump |
| sheep_or_goat | "sheep or goat" | animal | food, animal | — |
| deer | "deer" | animal | food, bone | — |
| horse | "horse" | animal | animal | — |
| pig | "pig" | animal | food, animal | — |
| unknown_species | "species unknown" | both | unknown | — |

**Deposit — "How was it left here?"** (individual / animal paths only)

| Option | Phrase | Profile | Suggested by | Guaranteed for |
|---|---|---|---|---|
| formal_inhumation | "formal inhumation" | individual | burial, clustered, ceremonial | burial |
| cremation | "cremation" | individual | burial, fire | — |
| secondary_deposit | "secondary deposit" | individual | burial, bone | — |
| body_dump | "body dump" | individual | burial, scattered | — |
| hasty_burial | "hasty burial" | individual | burial | — |
| foundation_deposit | "foundation deposit" | individual | deposit, ceremonial | — |
| food_refuse | "food refuse" | animal | food, domestic | faunal_dump |
| with_an_individual | "laid with an individual" | animal | burial, ceremonial | — |
| ritual_sacrifice | "ritual deposit or sacrifice" | animal | ceremonial | — |
| companion_burial | "companion burial" | animal | burial, animal | — |
| kill_site | "kill-site discard" | animal | scattered, bone | — |
| natural_death | "natural death in place" | animal | unknown | — |
| unknown_deposit | "how it was left is unknown" | both | unknown | — |

### The tools and where they come from

Crafted at the **Archeology Table** (ItemsAdder furniture `tfmc:archeology_station`, display
"Archeology Table"), which opens the MMOItems crafting station `archeology-station`.
The table itself is craftable at a vanilla crafting table: **8 Oak Planks around 1 Bone**
(`ItemsAdder/contents/ia_tfmc/contents/base.yml` recipe `archeology_station`).

> **Important binding caveat** (`pack/README.md`): MMOItems does not bind a block in the
> station YAML. The workshop is opened with `/mi stations open archeology-station <player>`,
> normally wired through ItemsAdder `events.placed_furniture.interact.execute_commands` on the
> station furniture. **Whether that binding exists on this server was not verified** — if it
> is missing, the table is decorative and the recipes are unreachable.

All station recipes (`plugins/MMOItems/crafting-stations/archeology-station.yml`, 12 recipes,
`max-queue-size: 64`):

| Recipe | Output | Crafting time | Ingredients |
|---|---|---|---|
| archaeo-tracker | `TOOLS:ARCHAEO_TRACKER` (Field Compass) | 5 | Redstone Torch x1 |
| archaeo-prospect | `TOOLS:ARCHAEO_PROSPECT` (Soil Probe) | 5 | Cobblestone x2, Stick x2 |
| archaeo-establish | `TOOLS:ARCHAEO_ESTABLISH` (Camp Kit) | 5 | Leather x2, Stick x4, White Wool x2 |
| archaeo-pencil | `TOOLS:ARCHAEO_PENCIL` (Field Pencil) | 5 | Feather x1, Coal x1 |
| field-brush | vanilla `BRUSH` x1 | 5 | Feather x1, Copper Ingot x1, Stick x1 |
| hand-pick | `TOOLS:HAND_PICK` | 5 | Stick x4 |
| pointing-trowel | `TOOLS:POINTING_TROWEL` | 5 | Stick x4 |
| mattock | `TOOLS:MATTOCK` | 5 | Cobblestone x3, Stick x2 |
| grafting-spade | `TOOLS:GRAFTING_SPADE` | 5 | Cobblestone x2, Stick x2 |
| breaker-pick | `TOOLS:BREAKER_PICK` | 5 | Iron Ingot x3, Stick x2 |
| spoil-shovel | `TOOLS:SPOIL_SHOVEL` | 5 | Iron Ingot x2, Stick x2 |
| archeology-cabinet | ItemsAdder `archeology_cabinet` | 2 | Iron Ingot x1 |

All ten MMOItems tool templates carry `displayed-type: Archeology` and
`disable-repairing / -enchanting / -smithing / -smelting / -crafting: true`, i.e. **they
cannot be repaired, enchanted, or used in any vanilla crafting recipe.**
All `custom-model-data` lines (10.0 through 19.0) are **commented out** — there is no custom
model, so they look like a plain recovery compass, stone hoe, campfire, feather, wooden/stone/
iron pickaxe and shovel. `pack/README.md` confirms: *"There is no custom MMOItems resource
pack yet; looks stay compass / hoe / stick / pickaxe until that is added."*

Tool lore, verbatim (this is the in-game tooltip and is good wiki copy):

| Item | Lore |
|---|---|
| Field Compass | "Hold to listen for a hidden ruin." / "Pulses grow stronger as you close in. Face it when close, then prospect." |
| Soil Probe | "Right Click soil in a suspected chunk to sample." / "Several distinct points confirm the site. Then a camp can be planted." |
| Camp Kit | "Hold next to a confirmed ruin to preview the camp." / "Right Click to plant it on a neighbour chunk." |
| Hand Pick / Pointing Trowel | "Hold Left Click on fill to cut." / "The most delicate cut. A late release still stays tight." |
| Mattock / Grafting Spade | "Hold Left Click on fill to cut." / "A working cut. Late, it opens a wider face." |
| Breaker Pick / Spoil Shovel | "Hold Left Click on fill to cut." / "The most powerful cut. Late, it strips a lot of fill." |
| Field Pencil | "Click a field sheet onto this, or hold the sheet and Right Click with this." / "Sign the drawing, then register it at the cabinet with the piece in hand." |

### Furniture (`plugins/ItemsAdder/contents/ia_tfmc/contents/base.yml`)

| Id | Display name | Model | Entity | Hitbox | Opens |
|---|---|---|---|---|---|
| `tfmc:archeology_station` | Archeology Table | `furniture/archeology_station` | item_frame, rotatable, solid | 1x1x1 | MMOItems station `archeology-station` |
| `tfmc:archeology_cabinet` | Archeology Cabinet | `furniture/archeology_cabinet` | item_frame, rotatable, solid | 1x1x1 | Archaeo lab / register / reading |

`pack/README.md` is emphatic: **do not** put the `/mi stations open` command on the cabinet,
"or both GUIs fight."

## Player command table

**There are no player commands.** `docs/gameplay.md`: *"Players do not use commands."*
`ArchaeoCommand.onCommand` line 135 checks `sender.hasPermission(catalogs.staffPermission())`
**before any subcommand dispatch**, and tab-complete (line 750) checks the same node.
The node is `permissions.staff: archaeo.admin` (`plugins/Archaeo/config.yml`), `default: op`
(`plugin.yml`).

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | The entire loop is item- and click-driven: tracker, prospect kit, camp kit, camp board, excavation tools, brush, pencil, cabinet, museum supports |

### Admin/staff commands (excluded from the player table)

All require `archaeo.admin` (default op). Usage line:
`/archaeo <give|ruin|workday|find|sketch|reload> ...`

| Command | What it does |
|---|---|
| `/archaeo give tracker\|prospect\|establish\|brush\|paper\|pencil [player]` | Hands out a role item. Only `paper` and `pencil` given this way get Archaeo how-to lore written onto them |
| `/archaeo ruin ...` | Register a ruin chunk at an interest level, inspect the dossier, resolve a site by `#id` |
| `/archaeo workday ...` | Work-day controls |
| `/archaeo find ...` | Test / inspect generated finds |
| `/archaeo sketch ...` | Sketch tooling |
| `/archaeo reload` | Reload the catalogs |

Also relevant to staff, from `pack/README.md`:
`/mi stations open archeology-station <player>` (MMOItems, not Archaeo).

## Numbers that matter to players

| Thing | Value | Source |
|---|---|---|
| **Work-day cap** | **8 successful cuts per Minecraft day** | `excavation.workday-actions: 8` (0 = uncapped) |
| Brushing cost | **does not spend the work day** | `docs/gameplay.md` |
| Planting the camp | **does not spend the work day** | `docs/gameplay.md` |
| Open excavations you may direct | **1** | `establish.max-excavations: 1` (0 = no cap) |
| Camp roster size | **18** including the director | `establish.max-staff: 18` |
| Prospect samples to confirm | **4** | `prospect.points-required: 4` |
| Time per sample | **2 s (40 ticks)** | `prospect.use-ticks: 40` |
| Movement that cancels a sample | **more than 2 blocks** | `config.yml` comment |
| Minimum distance between samples | **3 blocks** | `prospect.min-sample-distance: 3` |
| Tracker max range | **256 blocks** (or the ruin's own radius, whichever is smaller) | `tracker.max-range` |
| Tracker pulse rate | 70 ticks far → 5 ticks close | `tracker.beep-max-ticks` / `beep-min-ticks` |
| Brush hold per cube | **2 s (40 ticks)** | `brush.hold-ticks: 40` |
| Cubes to brush per find | **min(shape size, 6)** distinct cubes | `brush.max-cells-to-clean: 6` + `RecoverService:322` |
| Pick durability cost | **1 per cube removed** | `tool-wear.pick: 1` — so a late 3x3x2 lift costs 6 points |
| Brush durability cost | **1 per cube cleared** | `tool-wear.brush: 1` |
| Unbreaking | **works normally** | `tool-wear.unbreaking: true` |
| Pencil uses | **64 sketches** | `sketch.pencil-uses: 64` |
| Field sheet | **consumed per sketch** | `sketch` section |
| Lab stains per piece | **6** | `sketch.lab.dirty-count: 6` |
| Show-limits duration | **12 s**, thickness 0.08, visible to 96 blocks | `excavation.limits` |
| Find burial depth | at least **2 fill blocks** of cover | `interest.yml generation.find-min-cover: 2` |
| Buried conservation range | **40-100** before penalties | `conservation.buried.min/max` |
| Depth penalty | **-4 per stratum below the top** | `conservation.buried.depth-penalty: 4` |
| Disturbed penalty | **-10** | `conservation.buried.disturbed-penalty: 10` |
| Material survival multiplier | 0.70 (organic) to 1.00 (stone) | `materials.yml` |
| Neighbour-trace particle interval | 6 ticks | `excavation.find-particles-interval-ticks: 6` |

**The two numbers that shape play the most:**
1. **8 cuts per Minecraft day.** A single super-heavy late release takes 8 cubes out of the
   ground but still costs only **1** of those 8 actions (`workday-cost: 1` on every profile) —
   so the work-day budget rewards heavy tools, while precision rewards light ones. Brushing is
   free, so the day cap only limits *digging*, not *recovering*.
2. **1 excavation at a time.** You cannot hoard sites. Closing a camp is the only way to claim
   another ruin.

## Features configured but INERT

1. **Relics do not exist.** Every interest level has `min-relics: 0, max-relics: 0`, and every
   artifact has `relic: false`. `interest.yml` says so outright: *"Relic quotas stay at 0 until
   a later pack marks templates as relic (architecture, etc.)"*, and `artifacts.yml` adds
   *"unused in the default pack: every find is a liftable object."* **Do not mention relics.**
2. **Stratum `antiquity` strings are never shown.** `strata.yml`: *"antiquity is leftover
   config; the HUD and boards do not show it."* The "300-500 years" / "700-900 years" /
   "1000-1300 years" labels are dead text. Dating is a **station reading** (the Epoch question),
   not a depth readout.
3. **Lab chain steps beyond the first wipe are not implemented.** `materials.yml` lists
   `steps: [clean, wash, dry, photograph, interpret]` etc. and says *"Later chain steps are
   listed for later."* `config.yml` calls the wipe *"First lab step"*. Only the wipe exists.
4. **`config.yml` line 8 claims `interpretations.yml` is "player readings (not used in-game
   yet)" — this comment is STALE.** The source wires interpretations into
   `CampIdentifyBoard`, which is opened from `CampListener` (lines 574-670) and from
   `SketchService:563` (after registering at the cabinet). The interpretations system **is**
   implemented in the version of the source I read. **GUESS:** the deployed `config.yml`
   predates that work, or the comment was simply not updated. **Verify in-game before writing
   the classification page as live.**
5. **No `museum:` section in the deployed config** — defaults apply (ITEM_FRAME,
   GLOW_ITEM_FRAME, ARMOR_STAND, LECTERN, SHELF). `ITEM_DISPLAY` and ItemsAdder display cases
   are **not** enabled.
6. **All Archaeo MMOItems `custom-model-data` lines are commented out** (10.0-19.0). There is
   no custom model or texture for any Archaeo tool.
7. **Commented-out ItemsAdder alternatives in config**: `itemsadder:archeo:field_brush` and
   `itemsadder:archeo:field_sheet` are offered but not used; the brush is vanilla `BRUSH` and
   the sheet is vanilla `PAPER`. Consequence: **any** brush and **any** paper works, and
   Archaeo deliberately does **not** rewrite lore on unmarked vanilla stacks — so an ordinary
   feather and an ordinary sheet of paper look completely normal.
8. **`mining-speed` / `mining-speed-multiplier` overrides** are commented out on every tool
   profile — the cue clock uses the held item as-is.
9. **Biome / world restrictions**: none exist in Archaeo at all.
10. **The two suspected misconfigurations in §"Which pack is authoritative"** (MMOItems
    `TOOL` vs `TOOLS`, and the cabinet namespace) would make large parts of the system inert
    in practice. Both are high-confidence config mismatches but **neither is verified in-game**.

### 11. NO RUINS HAVE EVER BEEN REGISTERED ON THIS SERVER — read this first

`SiteRepository` (lines 64-65, 372) stores every staff-registered ruin as
`plugins/Archaeo/sites/<uuid>.yml`, with a counter in `plugins/Archaeo/sites-index.yml`.

A full recursive listing of the live `plugins\Archaeo\` folder returns exactly seven files —
`artifacts.yml`, `config.yml`, `hints.yml`, `interest.yml`, `interpretations.yml`,
`materials.yml`, `strata.yml`. **There is no `sites/` folder and no `sites-index.yml`.**
All seven are dated the same minute (Sep 11 01:46), i.e. freshly generated first-run defaults.

**Conclusion: zero ruins exist. Archaeo has no playable content on this server right now.**
Nothing in the loop — tracker, prospect, camp, dig, brush, cabinet, museum — is reachable by a
player until staff run `/archaeo ruin` on some chunks. This is not a guess; it is the absence
of the files the plugin writes when a ruin is created.

The wiki page should either be held back, or clearly marked as documenting a system that is
installed but not yet seeded.

## Cross-links

- **ItemsAdder** (soft) — the Archeology Table and Archeology Cabinet furniture, in the
  server's `tfmc` namespace (`contents/ia_tfmc/`). Archaeo binds
  `dev.lone.itemsadder.api.Events.FurnitureInteractEvent` by **reflection**
  (`PackPluginHook`), so it degrades gracefully if ItemsAdder is absent.
- **MMOItems** (soft) — all ten Archaeo tools (type `TOOLS`), and the `archeology-station`
  crafting station. Matched by reflection via `getTypeName` / `getID`.
- **Nothing else.** A full grep of the 107 source files for `mmocore`, `profession`, `codex`,
  `vault`, `economy`, `research` returns **zero hits**. Archaeo:
  - grants **no** MMOCore profession or class XP
  - awards **no** money
  - is **not** wired into Codex achievements
  - is **not** wired into the Research / advancedresearch system
  - has **no** stats on its tools (the MMOItems templates are `base:` only — material, name,
    lore, and the disable flags; no MMOItems stat lines at all)

  So archaeology is currently a **self-contained loop**: the reward is the object, the grade,
  the reading and the museum display, not XP or currency. If the wiki implies otherwise it
  will be wrong. Worth raising with the server owner as a design gap.
- **Vanilla archaeology** is *not* used: `docs/concepto.md` explains the plugin deliberately
  replaces suspicious sand/gravel loot tables with its own cube-shape system, because vanilla
  finds are destroyed if the block is broken, falls, or is pushed by a piston.
- **World protection** — `establish.protect-dig-site: true` locks every present stratum band of
  an established prism, so only the Archaeo excavation tools can work the fill. With it off (or
  in an **unestablished** prism), **an ordinary pickaxe destroys a buried find permanently** —
  worth a warning box in the wiki.

## Uncertain / unverified

- **The two config mismatches above (MMOItems `TOOL` vs `TOOLS`, cabinet namespace).** Highest
  priority to verify in-game. Everything in the "how a player uses it" section depends on them.
- **Whether the Archeology Table furniture is actually bound** to
  `/mi stations open archeology-station`. `pack/README.md` says the plugin does not do this;
  a server-side ItemsAdder `execute_commands` event or an NPC must. **Not found** in the files
  I read. If it is missing, none of the tools are craftable by players.
- **Whether `interpretations.yml` is live on the deployed jar version.** The source implements
  it; the deployed `config.yml` comment says it is not used yet. The jar is `archeology-plugin-1.0.jar`
  and I did not check whether it was built from the source checkout I read.

- Exact **sound cue names** for the ready chime, the find cling and the *Stop* prompt — the
  cue plan lives in `HoldCuePlan` / `FindBreakCue`, which I did not read line by line.
- Exact **camp board layout** (which slot is which button) — `CampBoard` / `CampGui` /
  `CampStaffBoard` / `CampWorkerBoard` / `CampFindsBoard` not read in detail.
- The **camp wool-role system** (`CampWools`, `CampWoolRole`, `CampWoolPicker`) — clearly a
  colour-coded role assignment on the roster, but not investigated.
- The **field report / archive book** contents (`FindReportBook`, `CampArchiveBook`) — not read.
- `docs/concepto.md` is 1619 lines of Spanish design notes with explicit draft/proposed/agreed
  markers. I read the intent and vanilla-comparison sections only. **Anything that appears
  there but not in `docs/gameplay.md`, `config.yml` or the catalogs should be assumed
  unimplemented.**
