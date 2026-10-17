## MythicMobs

### What it is
MythicMobs is the engine behind every custom monster, boss and magical effect on the server — the named enemies you fight, their attack patterns, their loot, and most of the visual/audio spectacle attached to them.

### How a player actually uses it
There is no MythicMobs command or GUI for players. You interact with it purely by walking into its content:

1. **World bosses** — right-click a **Withered Remains Ticket** or **Ice General Ticket** (from voting crates). You get a chain of warning messages; right-click the ticket a *second time within 20 seconds* to confirm. The ticket is consumed and you are teleported alone to the boss lobby. Every party member needs their own ticket. In the lobby, right-click the **soul lantern** to start; everyone within 20 blocks is pulled into the arena, and after ~10 s the boss spawns with a title card and boss bar. On victory you are teleported out, given items, and a second soul lantern lets you claim the Codex achievement. Source: `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\x_world_bosses.yml`.
2. **Ambient wildlife** — sharks, orcas, jellyfish etc. spawn on their own in the ocean of `TFMC_Map`; you kill or fish them for materials (`C:\Users\MSI\Desktop\plugins\MythicMobs\randomspawns\OceanAnimals.yml`).
3. **Infestations** — swamp infestation events pull their monster roster from MythicMobs (`C:\Users\MSI\Desktop\plugins\Infestations\groups.yml`).
4. **Your own class abilities** — many MMOCore class skills are literally MythicMobs skills under the hood (see Cross-links).

### Content it adds ON THIS SERVER

#### World bosses (the only bespoke MythicMobs combat content reachable in the open world)
Defined in `C:\Users\MSI\Desktop\plugins\MythicMobs\mobs\TFMC\Exploration\tfmc_world_bosses_mobs.yml`.

| Internal ID | Display name (colour) | HP | Base dmg | Where / trigger |
|---|---|---|---|---|
| `withered_remains` | Withered Remains (MiniMessage `<gradient:#141214:#3e2d3b:#141214>`) | 1000 | 0 (all damage via skills) | `TFMC_Map` −907.5, 141, 1762.5. Started by soul lantern at −859, 124, 1851 |
| `withered_remains_terror` | Withered Remains — phase 2 (same gradient) | 500 | 0 | Spawns from phase 1; this is the form that pays rewards |
| `withered_remains_skull_2ndphase` | *(no display name — FX armour stand)* | 1000 | – | Phase-2 prop |
| `Ice_General` | Ice General (`<gradient:#36D2FA:#65CCFD:#89E2FF>`), subtitle "Vaaramereios" | 1500 | 5 | `TFMC_Map` −1400.5, 148, 1751.5. Started by soul lantern at −1355, 127, 1857 |
| `Ice_General_2ND` | Ice General — phase 2 | 1000 | 5 | Summoned on phase-1 death; pays rewards |

Both bosses use a red `SEGMENTED_20` boss bar with `CreateFog` and `DarkenSky`, range 50, and force-load their chunk. Both stun themselves *and* all players within 200 blocks for the intro (80 ticks for Withered Remains, 120 for Ice General).

#### Ocean wildlife — `TFMC_Map` only
Defined in `C:\Users\MSI\Desktop\plugins\MythicMobs\mobs\TFMC\Mobs\tfmc_water_animals.yml`, spawned by `C:\Users\MSI\Desktop\plugins\MythicMobs\randomspawns\OceanAnimals.yml`. None have display names (nameplates hidden).

| ID | HP | Biomes | Notes |
|---|---|---|---|
| `Oarfish` | 80 | DEEP_OCEAN | Flees players |
| `Jellyfish` | 80 | OCEAN, DEEP/LUKEWARM/WARM_OCEAN | Passive, drifts |
| `Piranha` | 80 | RIVER, BEACH | Attacks players on sight |
| `Manta` | 250 | OCEAN, DEEP/LUKEWARM/WARM_OCEAN | Retaliates only |
| `Shark` | 500 | OCEAN, DEEP/LUKEWARM/WARM_OCEAN | Retaliates only |
| `Orca` | 1000 | DEEP_OCEAN, COLD/DEEP_COLD_OCEAN | Retaliates only |

Vanilla COD, SALMON, TROPICAL_FISH, PUFFERFISH and SQUID are also re-spawned through the same system in `TFMC_Map`.

`Deer` (`tfmc_land_animals.yml`, HP 40, SHEEP-based, flees within 30 blocks, drops leather + raw beef) **has no random-spawn or spawner entry anywhere in the config tree** — see Inert.

#### Swamp infestation roster
`C:\Users\MSI\Desktop\plugins\Infestations\groups.yml` groups `swamp_mobs` and `swamp_mobs_hill`, both **night-only**, both displayed to players as **"Bog Monsters"**.

| ID | Display name | HP | Weight in group | Defined in |
|---|---|---|---|---|
| `SwampGhoul` | Cursed Ghoul (`§3`) | 80 (dmg 10) | 0.5 | `mobs\TFMC\Exploration\AAmobs.yml` |
| `parasitic_worm` | *(none)* | 10 | 1 | `mobs\3rd Party\Others\Mobs\ParasiticWorms.yml` |
| `frog_zombie` / `mantis_zombie` / `snail_zombie` | *(none)* | 20 each | 1 each | same |
| `dragonfly_zombie` / `butterfly_zombie` | *(none)* | 20 each | 1 each | same (BEE-based, fly) |
| `rpg_rat` | rpg_rat | 20 | 1 | `mobs\3rd Party\Others\Mobs\rpg_pack_vol1.yml` |
| `rpg_rat_undead` | rpg_rat_undead | 200 | 1 | same |
| `rpg_slime_cube` | rpg_slime_cube | 100 | 1 | same |
| `rpg_poison_slime_cube` | rpg_poison_slime_cube | 200 | 1 | same |
| `rpg_skeleton` / `rpg_skeleton_crossbow` | same as ID | 200 each | 1 each | same |
| `greentroll` | – | – | 0.05 (`swamp_mobs`) / 1.0 (`swamp_mobs_hill`) | Only `GreenTroll` (capitalised) exists, in `trolls.yml` — MythicMobs lookups are case-insensitive so this should resolve; flagged below as unverified |

Note the 3rd-party pack mobs above ship with their internal ID as their display name (`'rpg_skeleton'` etc.), so players see raw IDs as nameplates unless nameplates are hidden.

#### Codex / exploration set pieces
`C:\Users\MSI\Desktop\plugins\MythicMobs\mobs\TFMC\Exploration\tfmc_codex_mobs.yml`, all ALLAY, HP 999, damage 0, driven by `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\codex.yml`:

| ID | Display (colour `&3`) | Role |
|---|---|---|
| `OceanSpirit` | `...` | 16 of them spawn around `TFMC_Map` ~795, 136, 1771 during the "siren song" sequence |
| `True_OceanSpirit` | `♫` | The real one at 795.2, 136.9, 1771.8 |
| `OceanSpirit_Teleporter` | `Return...` | Spawned at −773.3, 182, 2282.3 / −783.0, 141.5, 2459.8 when you submerge with Water Breathing near 799, 132, 1770 |
| `OceanSpirit_Inverter` | `Flip...` | Puzzle step near 854.5, 162.5, 787.5 |

#### Swamp ambience props (`mobs\TFMC\Exploration\AAmobs.yml`)
`CrowCircle` ("Crows"), `SwampBanner` ("Swamp Banner"), `SwampJumpscare` ("Swamp Ghoul"), `ChainedGhoul` ("Hanging Ghoul"), `PikeGhoul` ("Pike Ghoul") — all `§a` green, HP 150, damage 0, `NoAI`, `Invincible`, `NoGravity`, ModelEngine models plus custom `aa.*` sounds. No spawn rule exists for any of them; they must be placed by staff with `/mm m spawn`.

#### Dungeon mob sets (defined but see Inert)
- `mobs\TFMC\Dungeons\caverns_of_the_dammed_mobs.yml` — "Caverns of the Damned": Swamp Skeleton, Swamp Skeleton Crossbow, Swamp Troll (`§a`), **Blood Mage** (`&5`, HP 1000), **Swamp Abomination** (`&5`) in Clean/Exposed/Weathered/Oxidized tiers at HP 200/300/400/500, and **Swamp Abomination True Form** (`&6`, HP 2000).
- `mobs\TFMC\Dungeons\seithr_fortress_mobs.yml` — "Seithr Fortress": Seithr Soldier (200 HP, 19 dmg), Seithr Archer (140 HP, 22 dmg), Elite variants, Frost Spider (60), Seithr Miner (40), Ice Golem (400) / Elite Ice Golem (800), Seithr Captain (400), Frost Druid (400), Frost Mage (600), Seithr Executioner (800), Prisoners (3 HP), and **General Vaaramereios** (`&6`, `Seithr_Commander`, HP 1500 / `Seithr_Commander_2ND` 1000). The Ice General world boss reuses this boss's ModelEngine model (`mid=seithr_commander`) and name.

#### 3rd-party purchased packs
`C:\Users\MSI\Desktop\plugins\MythicMobs\mobs\3rd Party\` holds two subtrees (SamusDev class/mob packs, and "Others"). Of 552 total mob IDs across `mobs/`, **82 have no reference anywhere else in the plugins tree.** The genuinely *used* 3rd-party content is narrow:
- **MCPets companions** (`C:\Users\MSI\Desktop\plugins\MCPets\Pets\`, 19 pets) use: `Pet_Warrior`, `Pet_Dark_Knight`, `Pet_Paladin`, `Pet_Dragon_Warrior`, `Pet_Assassin`, `Pet_Martial_Artist`, `Pet_Ninja_Samurai`, `Pet_Reaper`, `NocsyOtter`, `Fox_fox`, `Frog_frog`, `Catblack`, `Catfunny`, `Catorange`, `Beagle`, `Chihuahua`, `Corgi`, `Golden`, `PickaxeGoblin`.
- **Infestations** uses the ParasiticWorms + rpg_pack_vol1 mobs listed above.
- **`toro_wither`** is the base model/skill set the Withered Remains world boss is built from.
- Everything else in the SamusDev trees (icebound, dark forest, howling nether, awakened archer/mage, all the class VFX mobs) is unreferenced decoration.

### Player command table
**MythicMobs registers no commands a normal player can use.** Every command it registers is gated on a `mythicmobs.command.*` permission, and none of those are declared in `plugin.yml`, so Bukkit treats them as op-only by default.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | – | – | MythicMobs is entirely passive from the player's side on this server |

Player-facing command that *talks about* this content but belongs to another plugin:

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/tfmc worldboss info` | – | Prints the world-boss explainer (tickets, lobby, lantern, one group at a time, insurance tickets) | No permission node listed in `C:\Users\MSI\Desktop\plugins\AACommandsFiller\config.yml`, so open to everyone. Handled by `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\x_world_bosses.yml` |

**Admin/staff commands excluded** (all default `op`): `/mythicmobs` (`/mm`) with subcommands `mobs` (spawn, kill, killall, list, listactive, info, browse, clean, stats), `items` (get, give, list, browse, edit, info, import, export, enchant), `skills info`, `spawners` (create, remove, set, move, copy, cut, paste, undo, find, info, browse, activate, resettimers, addcondition, removecondition), `eggs` (get, give), `dialogs` (list, show), `test` (cast, mechanic, spawncheck, taunt, addthreat, reducethreat), `utilities` (~16 subcommands incl. `plugindump`, `getiteminfo`, `getentitynbt`), `debug`, `reload`, `save`, `signal`, `camera`, `info`, `version`, `menu`; plus `/spawnmob` (`/spawnmythicmob`, `/mspawn`, `/msummon`), `/mythicmobsmenu` (`/mmmenu`, `/mmm`), `/pins` (`/pin`), `/addpin`. Declared permissions: `mythicmobs.admin`, `mythicmobs.reload`, `mythicmobs.signal` (all `default: op`).

### Numbers that matter to players

**World bosses**
- Withered Remains: 1000 HP phase 1 → 500 HP phase 2. Difficulty label on the ticket: **Easy**.
- Ice General: 1500 HP phase 1 → 1000 HP phase 2. Difficulty label: **Very Hard**.
- **Ticket confirm window: 20 seconds** (a temporary LuckPerms node `boss1.accept`/`boss2.accept` is granted for 20 s).
- Ticket right-click cooldown: 12 (ConditionalEvents `cooldown: 12`).
- **Despawn / wipe check every 12000 ticks (10 minutes)**: if zero players are within 200 blocks, the boss deletes itself and the entry lantern is restored (`Boss1_WIPE` / `Boss2_WIPE`, `C:\Users\MSI\Desktop\plugins\MythicMobs\skills\TFMC\Exploration\tfmc_world_bosses_skills.yml`).
- **Arena lock: 71800 ticks ≈ 59 minutes 50 s** before the entry lantern is force-restored if nothing else restores it. While the lantern is missing, other players are told "There is an ongoing boss fight, please wait until its finished".
- **Ice General enrage**: if only 1 player is within 80 blocks, he gains Strength I + Resistance I for 3600 ticks (3 min) with a broadcast; cooldown 3600.
- **You cannot enter with PvP non-lethal mode on** (`pvp.non_lethal` permission blocks the ticket).

**World boss rewards** (given by command to every player within 60 blocks on the phase-2 kill)

| Boss | MMOCore main EXP | Items |
|---|---|---|
| Withered Remains | 250 | 5× Ignitium, 5× Raw Tin, 5× Abyssalite Fragment |
| Ice General | 1000 | 16× Raw Tin, 16× Abyssalite Fragment, 2× Mythril Fragment, 1× Mythrilite |

Plus Codex achievements on leaving the arena: `world_boss_1` "Demon Slayer" (**+1650 player EXP**) and `world_boss_2` "No Maidens?" (**+1650 player EXP**) — `C:\Users\MSI\Desktop\plugins\Codex\categories\achievements.yml`.

**Boss ticket acquisition** — voting crates 1/2/3 (`C:\Users\MSI\Desktop\plugins\ExcellentCrates\crates\voting_crate_1.yml` and siblings): each ticket has weight 15 of 285 total = **5.26 % per roll**, no per-player limit or cooldown.

**Ocean wildlife drop rates** (`C:\Users\MSI\Desktop\plugins\MythicMobs\droptables\WaterAnimalsDropTables.yml` and the mob files)
- Every ocean mob: **5 % chance** for its MMOItems raw-meat ingredient (`RAW_OARFISH`, `RAW_JELLYFISH`, `RAW_PIRANHA`, `RAW_SHARK`, `RAW_ORCA`) and 5 % for its sting material.
- Material tables (`FishMats`, `PiranhaMats`, `SharkMats`, `OrcaMats`): rolled at 5 %, then **1 item at 10 % each** from scale/fin/sting/tooth — **and each table is gated behind fisher profession permissions** (`professions.fisher_weapon_1`+`professions.fisher_armor_1` through `_4`). Without the matching profession gear tier you get nothing from these tables.
- Random-spawn parameters: chance 0.05 per attempt, cooldown 30, spawn ring 12–64 blocks from a player, y 50–64, and a density cap (e.g. no second Shark/Manta/Orca within 128 blocks, no second Oarfish/Jellyfish/Pufferfish within 64).

**Generic mob drop tables** (`C:\Users\MSI\Desktop\plugins\MythicMobs\droptables\MobDropTables.yml`) — exactly **1 item per kill**:

| Table | Drops |
|---|---|
| `EasyMob` | Iron Ingot ×1 (40 %), Coal ×2 (20 %), Common Item Skin Scroll (30 %), Gold Coin ×1 (10 %) |
| `MediumMob` | Iron Ingot ×2 (40 %), Coal ×4 (20 %), Rare Item Skin Scroll (30 %), Gold Coin ×2 (10 %) |
| `HardMob` | Iron Ingot ×4 (40 %), Epic Item Skin Scroll (30 %), Ignitium ×1 (20 %), Gold Coin ×4 (10 %) |

**Infestation severity tiers** (per group, `Infestations\groups.yml`) — identical for both swamp groups:

| Severity | Ambient cap | Spawn interval | Spawn ring | Lure count | Lure duration |
|---|---|---|---|---|---|
| mild | 8 | 40 t (2 s) | 10–22 | 20 | 120 s |
| worrying | 16 | 40 t | 10–20 | 40 | 120 s |
| severe | 28 | 30 t (1.5 s) | 9–19 | 60 | 120 s |
| extreme | 40 | 20 t (1 s) | 8–18 | 80 | 120 s |

Global infestation settings (`Infestations\config.yml`): lure item `ia.tfmc:lure` (an ItemsAdder item in namespace `tfmc`), lure spawn radius 48, join window 20 s, logout grace 300 s, deserter damage 2, hologram view range 96, water/sea terrain skipped, spread disabled.

**Mob levelling** (`C:\Users\MSI\Desktop\plugins\MythicMobs\config\config-mobs.yml`): world scaling is **on** for the default world and also scales vanilla mobs — **one level per 250 blocks from spawn**. Each level multiplies health and damage by 1.05 (`V * (1.05)^(L-1)`), with a default +0.1 health level modifier. You must deal **at least 1 % of a mob's health** to be eligible for drops.

### Features configured but INERT
- **Caverns of the Damned mob set** (11 named mobs incl. Blood Mage and Swamp Abomination True Form) — the only references outside its own files are **commented-out** quest lines in `C:\Users\MSI\Desktop\plugins\MMOCore\classes\test.yml` (lines 303–312). Nothing spawns them.
- **Seithr Fortress mob set** (22 named mobs) — no spawner, no random spawn, no dungeon, no ConditionalEvent. Only the boss's model and name survive, recycled into the Ice General world boss.
- **`Shadow_Fragment`** ("Shadow Fragment", `&8`, HP 300) in `mobs\TFMC\Exploration\tfmc_magic_ritual_mobs.yml` — referenced only by its own skills. No trigger exists.
- **Ritual portal FX mobs** `BLOODMAGIC_RUNE_PORTAL`, `NECROMANCY_RUNE_PORTAL`, `ILLUSION_PORTAL_MAZE`, `ILLUSION_PORTAL_TOWER` (`tfmc_ritual_FX_mobs.yml`) — zero references anywhere.
- **`JAKE_ILLUSION_PORTAL_1` / `_2`** (`mobs\TFMC\FX\tfmc_FX_mobs.yml`) — zero references.
- **Rothil/Zerratoris NPC set** — all 13 mobs in `mobs\TFMC\Exploration\tfmc_rothil_zerratoris_mobs.yml` (`Zerratoris_Sentry_*`, `Zerratoris_Spectator_*`, `Chains_of_Void`, `Chains_of_Void_DamageChain`, `Warp_Vacuum_Blackhole`) have **zero references**. Note these are *different* mobs from the `Zerratoris_Patrol_*` set used in the Operation Magpie dungeon.
- **Swamp ambience props** `CrowCircle`, `SwampBanner`, `SwampJumpscare`, `ChainedGhoul`, `PikeGhoul` — no automatic spawn; staff-placed only.
- **`Deer`** — fully defined with a ModelEngine model and drops, but it appears in no randomspawn file and no spawner. The only hit anywhere is an unrelated word match in `ArmourShop\Categories\i_shields.yml`.
- **`white_cloud2` … `white_cloud6`** (hydromancy FX) — zero references.
- **Most of the "3rd Party" tree** — 82 mob IDs unreferenced, concentrated in `RPG_Class_Awakened_Archer_Mobs.yml` (6), `icebound_mobs.yml` (3), `mage_mobs.yml` (4), `CaveGoblins.yml` (3 of 4 — only `PickaxeGoblin` is used, as an MCPets pet), `toro_knight.yml` (2), and the various `*_mobs.yml` VFX files. These are inert decoration.
- **`ExampleMobs.yml`, `ExampleSkills.yml`, `ExampleDropTables.yml`, `ExampleRandomSpawns.yml`, `ExampleDialogs.yml`** — fully commented out / empty, no active definitions.
- **`placeholders.yml` is empty** — no custom MythicMobs placeholders are defined.
- **`stats.yml`: 1 of ~30 stats is enabled** (`LIFESTEAL_POWER`). `ATTACK_DAMAGE`, `CRITICAL_STRIKE_CHANCE`, `DAMAGE_REDUCTION` and the rest are all `Enabled: false` — the server uses MMOItems/MythicLib stats instead.
- **No MythicMobs spawners exist.** `C:\Users\MSI\Desktop\plugins\MythicMobs\data\` contains only an empty `global-data.json` (`{"entries": {}}`) and 21 near-empty player files. The `Spawners: true` feature flag is on but nothing is placed.
- **`config-items.yml` `Equippables.Enabled: false`** and `ItemUpdating.Enabled: false` — the MythicMobs custom-slot equipment system (NECKLACE, RING_1, RING_2) is configured but switched off; MMOInventory handles that instead.
- **Likely-broken: the world-boss tickets.** `x_world_bosses.yml` requires `%item% == GOLD_NUGGET` and `%item_custom_model_data% == 73`, but `C:\Users\MSI\Desktop\plugins\MMOItems\item\loot.yml` defines `BOSS_TICKET_1`/`BOSS_TICKET_2` as `material: PAPER` with `custom-model-data: 9.0` (revision-id 2). Unless something re-stamps the item at runtime, the right-click event cannot match and **the tickets do nothing**. This is a config mismatch, stated as an observation — see Uncertain.

### Cross-links
- **ConditionalEvents** — sole driver of the world-boss flow (`x_world_bosses.yml`) and the Ocean Spirit codex puzzle (`codex.yml`). `x_dungeons.yml` is 100 % commented out.
- **MMOItems** — boss tickets (`LOOT:BOSS_TICKET_1/2`), all ocean-mob drops (`MATERIALS:*_SCALE/_FIN/_STING/_TOOTH`, `INGREDIENTS:RAW_*`), boss reward materials (`IGNITIUM`, `RAW_TIN`, `ABYSSALITE_FRAGMENT`, `MYTHRIL_FRAGMENT`, `MYTHRILITE`), and item-skin scrolls in the mob drop tables.
- **MMOCore** — boss and achievement rewards are `mmocore admin exp give … main`; MMOCore classes reference MythicMobs kill objectives (currently commented out).
- **MythicLib** — the bridge that turns MythicMobs skills into player class abilities. `C:\Users\MSI\Desktop\plugins\MythicLib\skill\tfmc.yml` (33 handlers), `tfmc_cerrith.yml` (9), `tfmc_seithr.yml` (8), `tfmc_illusion.yml` (5), `tfmc_oseni.yml` (4), `hydromancy.yml` (9) all map to skills in `MythicMobs\skills\TFMC\Classes\`. Verified example: MythicLib `MENDING` → MythicMobs `Mending` at `tfmc_class_skills.yml:3`; `TREMORS` → line 21; also `STAND_TOGETHER`, `GUARDIAN_ANGEL`, `GROUND_SMASH`, `GROUP_UP`, `SUBSTITUTE`. The `guardian` MMOCore class uses these.
- **ModelEngine** — 632 blueprints in `C:\Users\MSI\Desktop\plugins\ModelEngine\blueprints\`. TFMC mobs reference 52 distinct model IDs, including `toro_wither`, `toro_wither_terror`, `seithr_commander`, `seithr_golem`, `swamp_ghoul_*`, `crows_circling`, `deer`, `shark`, `orca`, `manta`, `whirlpool`.
- **ItemsAdder** (pack `tfmc_pack`) — supplies the custom sound events these mobs play: `aa.crow_1/2`, `aa.ghoul_grunt_1/2/3`, `aa.swamp_jumpscare`, `aa.swamp_water_attack`, `lore.siren_song`, plus the `music.lore.*` boss/lore tracks (`ItemsAdder\contents\tfmc_pack\resourcepack\assets\minecraft\sounds.json`, 220 entries). Also `ia.tfmc:lure`, the Infestations lure item.
- **Infestations** — consumes the swamp mob roster.
- **ExcellentCrates** — voting crates 1/2/3 are the ticket source.
- **Codex** — achievements `world_boss_1`, `world_boss_2` unlocked on leaving the arenas.
- **MCPets** — 19 pets are MythicMobs mobs from the purchased pet packs.
- **CustomFishing** — ocean mob names appear in rod/bait definitions (`CustomFishing\contents\item\tfmc_water_*rod.yml`), tying fishing tiers to shark/orca/manta content.
- **LuckPerms** — used transactionally by the ticket flow (`lp user … permission settemp boss1.accept true 20s`) and as the gate for fisher-profession drop tables.
- **TrialRooms** — does *not* use MythicMobs mob IDs. It converts vanilla spawners and has its own loot tables; it is a sibling system, not a MythicMobs consumer.

### Uncertain / unverified
- **The boss-ticket material/model-data mismatch is a config-level observation, not a tested failure.** I could not run the server. It is possible MMOItems' item-updating or some runtime layer restores the old GOLD_NUGGET/CMD-73 form, but MMOItems' own `ItemUpdating` is disabled in MythicMobs' config (different plugin) and I found no other config writing CMD 73 onto these items. Treat as "probably broken, needs an in-game test".
- `greentroll` (lowercase, in `Infestations\groups.yml`) vs `GreenTroll` (the actual definition in `trolls.yml`). MythicMobs mob lookups are case-insensitive in my understanding of the plugin, so this almost certainly resolves — but I did not verify it against the jar's lookup code.
- The `AAmobs`/`AAskills` prefix presumably stands for the "Archaeo"/atmosphere pack, but nothing in `C:\Users\MSI\Desktop\plugins\Archaeo\` references them. This is a guess at naming only.
- I could not read LuckPerms group grants — `C:\Users\MSI\Desktop\plugins\LuckPerms\` stores data in an H2 database (`luckperms-h2-v2.mv.db`). **Any statement about a permission's effective default assumes no LuckPerms override.**

---

## MythicDungeons

### What it is
MythicDungeons runs private, instanced dungeon worlds: you and your party get your own copy of a hand-built map with scripted mobs, puzzles, checkpoints and a loot chest at the end.

### How a player actually uses it
1. **Form a party.** The server routes MythicDungeons parties through MMOCore (`party-plugin: mythicdungeons_inject` in `C:\Users\MSI\Desktop\plugins\MMOCore\config.yml`, paired with `PartyPlugin: MMOCore` in `C:\Users\MSI\Desktop\plugins\MythicDungeons\config.yml`), so `/party` and `/dparty` both reach the same system. `/recruit` opens a chat-driven wizard (label ≤ 3 words, description, player count 2–12, optional password) and your listing is broadcast every 5 minutes.
2. **Queue.** `LeaderOnlyQueue: true` — **only the party leader can start a dungeon**. Members then get a ready check.
3. **Ready up.** `/ready` to confirm, `/notready` to cancel the whole queue. You have **45 seconds**; `StartWithoutUnreadyPlayers: false` means one silent member blocks the run, and the leader's ready is required.
4. **Inside.** You keep your inventory and XP on entry but lose your health, hunger and potion effects (they reset). Blocks cannot be broken or placed, PvP is off, ender pearls, chorus fruit and buckets are disabled, and **almost all commands are blocked** — only a small whitelist (party/chat/roleplay commands) works.
5. **If you get stuck**, `/stuck` returns you to your last checkpoint. **If you die past your life limit**, you are put into spectator or ejected depending on the dungeon.
6. **Finishing** is usually an interaction with a scripted object; loot comes from chest functions that roll the `s4starterdungeon` loot table, and Codex achievements fire for every party member.
7. **Leaving**: `/leave` or `/md leave`.

**Important caveat on step 2:** I could not find any active in-world entry point. The only configured `md play` trigger, in `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\x_dungeons.yml`, is **entirely commented out** — see Inert.

### Content it adds ON THIS SERVER

Seven dungeon folders exist in `C:\Users\MSI\Desktop\plugins\MythicDungeons\maps\`. Only five have content.

| Folder (internal ID) | `DisplayName` in config (colour) | Public name (from Codex) | Scripted content | Status |
|---|---|---|---|---|
| `startdungeon` | Tamarith (`&b`) | "Complete the Tamarith starter dungeon" — achievement **Wise Mystical Tree** | 663 mob spawns, 505 block edits, 5 loot chests, 7 checkpoints, 3 in-dungeon keys | Built, complete |
| `Minidungeon_1` | Chrononomiconical Chaos (`&b`) | achievement **That's Not What Happened... Is It?** | 439 mob spawns, 568 block edits, 10 loot chests, 8 checkpoints, 4 moving clusters | Built, complete |
| `minidungeon2` | Operation Magpie (`&b`) | achievement **An Act's Conclusion** | 131 mob spawns, 166 block edits, 34 chunk-loads, 7 hologram/signal functions, 6 holograms, 0 loot chests | Built; stealth-style, no loot chests |
| `dungeon1` | A Dungeon (`&b`, plugin default) | "Shattered Stronghold of Aldroth" — achievement **Part 8 at 10m 7s** | 151 mob spawns, 70 redstone functions, 12 moving clusters, 5 checkpoints, 0 loot chests | Built; display name never customised |
| `trialdungeon` | A Dungeon (`&b`, plugin default) | most likely "Tomb of Domenius" — achievement **Heavy Is The Crown** (inference, see Uncertain) | 267 mob spawns, 663 block edits, 6 loot chests, 7 checkpoints, 7 in-dungeon keys | Built; display name never customised |
| `magicmaze` | A Dungeon (`&b`) | – | `functions.yml` is **25 bytes** — completely empty | Empty shell |
| `cautiontesting` | A Dungeon (`&b`) | – | 7 block edits, 1 trigger, no mobs | Dev scratch map |

#### Mob rosters per dungeon
These are the mobs each dungeon actually spawns (from `functions.yml`). **None of these mob IDs are defined anywhere in the MythicMobs config in this snapshot** — see Inert/Uncertain.

**Tamarith (`startdungeon`)** — forest/ent theme: `Ent_Warrior` (139 spawn points), `Ent_Sorcerer` (54), `Vine_Guardian` (38), `Awakened_Shrub` (29), `bl_poison_spider` (25), `starterdungeon_mushroom` (20) and `_red`, `Thorn_Spitter` (14), `Useful_Frog` (13), `SILVERFISH` (33), `cleanserfrog`, plus traps `firetrap`/`firetrap2`/`firetrap3`, `tornadoshooter`, `ftaoe`. Bosses: **`Ent_Guardian`**, **`Ent_King`** (with `Ent_King_Phase_2_Engraged1`), **`Mutant_Flower`**, **`sdbosswitch`** (a witch who teleports you, via skill `sdwitchbosstp`), and ghosts `ent_spectre`/`ent_spectre2`/`ent_spectre_fake`. Decorative `particlebirb{white,pink,green,blue,gold,dold}` account for 204 of the spawn points. Scripted music: `starterdungeonmusicstart/end`, `lobbymusicstart/end`, `entguardianmusicstart/end`, `entkingmusicstart`, `mutantplantmusicend`.

**Chrononomiconical Chaos (`Minidungeon_1`)** — time/goblin/frog theme: `Goblin_Assassin` (69), `FrogPatroller` (68), `Oseni_Kobold_Archer` (46), `FrogSoldier2` (45), `Oseni_Kobold_Warrior` (40), `Goblin_Warrior` (37), `Goblin_Archer` (14) and `Goblin_Archer_Sniper` (10), `Sniper_Harp` (14), `Lava_Fall` (14), `shadowbolttrap` (10), `Deadly_Harp`/`_2`/`_3` and giant Red/Green/Blue variants, `OseniRog`, `Oseni_Barrage_Archer1`, `magical_bomb`, `osenimeteor`/`osenimeteorcreator`, `timebarragemob`, `toro_knight_thunder`, `Direfang`, `Goblin_Shaman`. Named NPCs: **`Conductor_Jeremiah`**, **`Gullible_Greg`**, and boss **`evilevie`** (`evilevie2`, `evilevie3`, `evieparticlegen`). Four music phases (`minidungeon1part1..4musicstart/end`), plus `brokenclocksound`, `Froghorn`/`Froghorn2`, `minidungeon1slowfall`, arena teleports.

**Operation Magpie (`minidungeon2`)** — stealth/patrol theme, all `Zerratoris_*`: three patrol routes (`Zerratoris_Patrol_1/2/3_P1…P17`, plus `_Turbo`, `_Inner`, `_Alerted`, `_Noteguard`, `_Chaser`), stationary guards (`Zerratoris_Stationary_1/2/3_Range4/5`, `_Aura` variants, `_Archer`, `_Archer_2/3`, `_Mage`), hazards `Zerratoris_Fireman`, `Zerratoris_Explodeman` (+ `_Placeholder` versions), `alarmsignaler`, `Zerratoris_Alerter`, `zerrameteorcaller`, `zerraghostchatter`, `spotlightmob1` (9 spotlights). Leaders: **`Zerratoris_Leader_1`** and **`Zerratoris_Leader_2`**. The dungeon forces `time set night` and `weather storm`, and plays `Zerratoris_Camp_Bells`. Seven `MythicSignal` functions and 6 holograms drive the alarm state; 7 `GiveItem` functions hand out quest props (a blue carpet and a writable book among them).

**Shattered Stronghold of Aldroth (`dungeon1`)** — golem/runestone theme: `bl_strangler_spider` (32), `Pillarbound_Golem` (26), `Cobble_Golem` (24), `Stacker_Golem` (16), `corruptshielder` (15), `cerrithshielder` (15), `runeballshooter`, `runeringspawner`, `pohaku` + `pohaku_ballista`, `gm_sentinell_sword_statue`, `abyssal_knight`. Bosses: **`Runestone_Titan_Cerrith`** and **`Runestone_Titan_Corrupted`**. Five portals (`Dungeon1Portal1…5`) and a slime-based puzzle (`s4d1puzzlemobmain`, `s4d1puzzlemobtutorial`, `s4d1puzzlemobsignaler`, `s4d1puzzlemobtutorialsignaler`, skill `s4d1puzzletutorialslimespawns`). Three separate boss music tracks plus a general track (`Season4Dungeon1Music`, `…Boss1Music`, `…Boss2Music`, `…FinalBossMusic`, each with a Stop variant).

**`trialdungeon`** — crypt theme: `crypt_skeleton_warrior` (76), `unkillablepufferfish` (66), `shelf_gun` (25), `crypt_skeleton_marksman` (24), `crypt_skeleton_warrior_weak` (20), vanilla `PUFFERFISH` (16), `crypt_skeleton_archer` (10), `crypt_skeleton_warrior_strong` (9), `crypt_candle_holder` (6), `crypt_statue_eye_holder`, `crypt_statue_holder`, `crypt_statue_fireball`, `crypt_warrior_elite`. Bosses: **`crypt_skeleton_boss`**, **`crypt_warden_1`**, **`crypt_warden_2`**; the boss is gated behind `crypt_boss_key_summoner` / `crypt_boss_key_drop` / `crypt_boss_encounter_start`. This is the only dungeon with **7 `GiveKey` functions** and no `MythicSkill` functions at all.

#### Historical evidence
`C:\Users\MSI\Desktop\plugins\MythicDungeons\backups\` shows each dungeon's last archive, which dates the build order:

| Backup | Date |
|---|---|
| `startdungeon` | 2025-08-26 |
| `magicmaze` | 2025-08-27 |
| `minidungeon2` | 2025-09-04 |
| `Minidungeon_1` | 2025-09-15 |
| `dungeon1` | 2025-10-26 |
| `trialdungeon` | 2025-12-31 |
| `cautiontesting` | 2026-08-31 |

Two loose zips also sit in `maps\`: `minidungeon2.zip` and `trialdungeon.zip`.

### Player command table
Every command below is declared in the jar's `plugin.yml` with a permission that **defaults to `true`** — i.e. available to all players with no grant needed.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/md` | `/dungeon`, `/mythicdungeons` | Base command. The *subcommands* have their own permissions — only the ones below are open to everyone | Permission `mythicdungeons.core`, **default `true`** |
| `/md leave` | via `/dungeon leave` | Leave the dungeon, or cancel your place in the queue | Covered by `mythicdungeons.core` |
| `/md lives` | – | Tells you how many lives you have left ("You have 2 lives left" / "infinite lives") | Covered by `mythicdungeons.core` |
| `/leave` | – | Shorthand for `/md leave` | `mythicdungeons.quickleave`, **default `true`** |
| `/ready` | – | Confirm you're ready during a dungeon ready check. Broadcasts "X is ready to enter the dungeon! (n/total)" | `mythicdungeons.ready`, **default `true`** |
| `/notready` | – | Cancel the queue for the whole party | `mythicdungeons.notready`, **default `true`** |
| `/recruit` | – | Create or join a party listing (chat wizard: label, description, size, optional password). Also `/recruit <player>` to join theirs, and a cancel path | `mythicdungeons.recruit`, **default `true`**. Note: `dungeons.party.recruit` is `op` — see Uncertain |
| `/stuck` | – | Teleport to your last checkpoint ("Oh no! Sending you to your last checkpoint.") | `mythicdungeons.quickstuck`, **default `true`**. Note: `dungeons.stuck` is `op` — see Uncertain |
| `/rewards` | `/drewards` | Open the rewards inventory to claim dungeon loot | `mythicdungeons.rewards`, **default `true`** |
| `/party` | `/dparty` | Party management: invite, join, kick, leave, disband, givelead, list | `mythicdungeons.party`, **default `true`**. Routed through MMOCore |
| `/p <message>` | – | Party chat | `mythicdungeons.party.chat`, **default `true`**. `PartyChat: true` globally |

**Whitelisted inside dungeons** (`AllowCommands: false` + `AllowedCommands` per map): `party`, `dparty`, `p`, `leave`, `md leave`, `dungeon leave`, `rp`, `ooc`, `looc`, `yell`, `shout`, `me`, `ac`, `whisper`, `help`, `helpop`, `sit`, `crawl`. The exact set differs per dungeon — notably `dungeon1`, `magicmaze` and `trialdungeon` explicitly whitelist the leave commands while `startdungeon`, `minidungeon2` and `Minidungeon_1` **do not list any leave command**, only chat/roleplay ones.

**Admin/staff commands excluded** (all `default: op`): `/md play <dungeon> [player]` (`dungeons.play`, plus `.send` and `.force` and `.difficulty`), `/md create`, `/md delete`, `/md import`, `/md reload`, `/md join <player>`, `/md kick <player>`, `/md status`, `/md givekey`, `/md loot` (create/remove/edit — `dungeons.loottables`), `/md edit` (`dungeons.edit`, suffixable per dungeon), `dungeons.functioneditor`, `dungeons.roomeditor`, `dungeons.cleansigns`, `dungeons.setcooldown`, `dungeons.resetcooldown`, `dungeons.vanish`, `dungeons.bypassjoin`, `dungeons.bypasscooldown`, `dungeons.bypasscost`, `dungeons.bypasskeys`, `dungeons.admin`, and the umbrella nodes `mythicdungeons.*` and `dungeons.*`. The in-editor function-builder tool is a **FEATHER** (`FunctionBuilderItem: FEATHER`).

### Numbers that matter to players

**Global** (`C:\Users\MSI\Desktop\plugins\MythicDungeons\config.yml`)
- **Ready check: 45 seconds**, required from the leader, and the run will not start without every member ready.
- Only the **party leader** can queue.
- Party recruitment listings re-broadcast **every 5 minutes**.
- Party size limits for `/recruit`: **minimum 2, maximum 12**.
- Autosave every **300 seconds**; generator timeout 5 s.
- Global `MaxInstances: 1`.
- "Stuck" does not kill you (`StuckKillsPlayer: false`).

**Per dungeon**

| Dungeon | Party min–max | `MaxPlayers` | Lives | On death | Instances | Time limit | Cleanup delay | Entry cost | Key required | Permission required |
|---|---|---|---|---|---|---|---|---|---|---|
| `startdungeon` (Tamarith) | 1–8 | 8 | **2** | kicked from dungeon | 1 | **60** | 20 | 0 | none | none |
| `Minidungeon_1` (Chrononomiconical Chaos) | 1–8 | 8 | **2** | kicked from dungeon | 1 | 0 (none) | 0 | 0 | none | none |
| `minidungeon2` (Operation Magpie) | 1–8 | 8 | **infinite** | – | 1 | **60** | 20 | 0 | none | none |
| `dungeon1` (Shattered Stronghold of Aldroth) | 1–4 | unlimited | **infinite** | – | 5 | 0 | 0 | 0 | none | none |
| `trialdungeon` | 1–4 | unlimited | **infinite** | – | 5 | 0 | 0 | 0 | none | none |
| `magicmaze` | 1–4 | unlimited | infinite | – | 5 | 0 | 0 | 0 | none | none |
| `cautiontesting` | 1–8 | 8 | 2 | kicked | 1 | 60 | 20 | 0 | none | none |

(`TimeLimit` units are almost certainly minutes — see Uncertain. `MaxPlayers: 0` means no cap.)

**Cooldowns**

| Dungeon | Access cooldown | Applied when | Loot cooldown |
|---|---|---|---|
| `startdungeon` | **DAILY** | on start **and** on finish | **WEEKLY, per reward** |
| `Minidungeon_1` | **DAILY** | on start **and** on finish | **WEEKLY, per reward** |
| `minidungeon2` | **DAILY** | on start **and** on finish | disabled |
| `cautiontesting` | DAILY | on start and finish | WEEKLY, per reward |
| `dungeon1`, `trialdungeon`, `magicmaze` | **disabled** | – | disabled |

`CooldownTime: 0` with `CooldownType: DAILY`/`WEEKLY` and `ResetDay: 1` means the cooldown clears on the calendar boundary rather than after a fixed duration. **Leaving early or losing all your lives does not put the dungeon on cooldown** (`CooldownOnLeave: false`, `CooldownOnLoseLives: false`) — but *starting* does, so an aborted run still burns your daily attempt on the three dungeons above.

**Rules that apply in every dungeon**: survival gamemode; inventory and XP kept on entry; health, hunger and potion effects **not** kept; no block breaking or placing; no ender pearls, chorus fruit or buckets; PvP off; random tick and plant growth disabled; offline players kicked after **300 seconds**; `MaxBackups: 1`. Death messages are hidden in `startdungeon`, `Minidungeon_1`, `minidungeon2` and `cautiontesting`, but shown in `dungeon1`, `magicmaze` and `trialdungeon`. Durability loss protection is **off** everywhere — your gear takes damage normally. No dungeon bans any items.

**Difficulty levels**: every dungeon has `EnableDifficultyLevels: false` and `EnableDifficultyMenu: false`, with only the plugin's stock `HARD` example (×1.5 mob health, ×1.5 mob count, ×1.25 mob damage, +1 mythic level, 1–3 bonus loot) left unedited. There is no difficulty choice in practice.

**Loot** — one table exists, `s4starterdungeon` (`C:\Users\MSI\Desktop\plugins\MythicDungeons\loottables.yml`). Used by 10 chests in Minidungeon_1, 6 in trialdungeon, 5 in startdungeon. Each chest rolls **2–4 items**:

| Item | Stack | Weight | Chance per pick |
|---|---|---|---|
| Raw Iron | ×64 | 24 | **24.0 %** |
| Abyssalite Fragment (AMETHYST_SHARD ×2) | 1–4 picks | 12 | **12.0 %** |
| Tin (RAW_GOLD ×2) | 1–4 picks | 12 | **12.0 %** |
| Fruit Salad (TROPICAL_FISH ×64) | ×1 | 12 | **12.0 %** |
| Weak Repair Kit (200 durability, weapons & armour) | ×1 | 8 | **8.0 %** |
| Tool Repair Kit (600 durability, tools) | ×1 | 8 | **8.0 %** |
| Key Lime Pie (TROPICAL_FISH ×32) | ×1 | 8 | **8.0 %** |
| Weak Repair Kit | 1–2 picks | 6 | **6.0 %** |
| Lost Knowledge Fragment (research; hint: "Check the Cartography Table") | ×1 | 4 | **4.0 %** |
| Medium Repair Kit | ×1 | 4 | **4.0 %** |
| Rare Research Paper | ×1 | 1 | **1.0 %** |
| Rare Research Paper (second entry) | ×1 | 1 | **1.0 %** |

Total weight 100, so the weights above read directly as percentages per item picked. With the WEEKLY per-reward loot cooldown on Tamarith and Chrononomiconical Chaos, you can only bank each chest's reward once a week.

**Completion rewards (Codex, via MMOCore player EXP)** — `C:\Users\MSI\Desktop\plugins\Codex\categories\achievements.yml`:

| Dungeon | Achievement | Player EXP |
|---|---|---|
| Tamarith | Wise Mystical Tree | **2750** |
| Shattered Stronghold of Aldroth | Part 8 at 10m 7s | **2750** |
| Tomb of Domenius | Heavy Is The Crown | **2750** |
| Chrononomiconical Chaos | That's Not What Happened... Is It? | **1650** |
| Operation Magpie | An Act's Conclusion | **1650** |

Only two dungeons actually fire their unlock from inside the map: `startdungeon` and `Minidungeon_1`, each with 8 `FunctionCommand` entries (`codex unlock %md_party_member_1..8% achievements …`) so the whole party is credited.

**Checkpoints** (used by `/stuck`): Tamarith 7, Chrononomiconical Chaos 8, trialdungeon 7, Shattered Stronghold 5, Operation Magpie **0**.

**Spectator mode** uses a 3-item hotbar: COMPASS "Teleport to Player" (slot 0), COMPARATOR "Options" (slot 4), RED_BED "Leave Dungeon" (slot 8). Options include a night-vision toggle and a fly-speed cycle (right-click to increase, left-click to reset). Only `dungeon1`, `magicmaze` and `trialdungeon` have `DeadPlayersSpectate: true`, so this is the only place you'll see it — and those three have infinite lives, so in practice it almost never triggers.

### Features configured but INERT
- **There is no configured way for a player to start a dungeon.** `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\x_dungeons.yml` contains exactly two events and **both are commented out in their entirety**: the `minidungeon1` entry (right-click a SEA_LANTERN at `TFMC_Map` 2462, −1, 1222 holding a "Temporal Crystal Key", CMD 59, which would run `md play Minidungeon_1` and consume `academy:CRYSTAL_DUNGEON_KEY`) and the `md2_codex` completion hook. `/md play` itself is `dungeons.play`, **default `op`**. Nothing else in the plugins tree calls `md play`.
- **`magicmaze`** — a fully configured dungeon world with a 25-byte `functions.yml`. Nothing happens in it. No mobs, no triggers, no exit.
- **`cautiontesting`** — a developer scratch map: 7 block edits, one remote trigger, no mobs, generic "A Dungeon" name, no lobby location set.
- **`dungeon1` and `trialdungeon` never had their display names set** — both still read `&bA Dungeon`, the plugin default. Their real names only exist in Codex achievement text.
- **`AccessKeys.KeyItems: []` on every dungeon** and `Requirements.Cost: 0`, `Requirements.Permissions: []`, `Requirements.DungeonsComplete: []`. The entire gating system — keys, costs, prerequisite dungeons, permission locks — is configured and **completely empty**. There is no progression chain.
- **Difficulty system entirely off** on all seven dungeons, with only the unmodified `HARD` example left in place.
- **458 of 460 player data files in `globalplayerdata\` are 0 bytes.** The only two non-empty files contain `StoredExitLocation` (one player's logout point in `TFMC_Map`) and an empty `DungeonSavePoint: {}`. **No player has a single recorded dungeon completion, access cooldown or loot cooldown.** That is strong evidence that no dungeon has been completed since this data was last reset.
- **`Experimental.OneWorldDungeons: false`** and `MovingBlocksMoveEntities: false` — both experimental features off.
- **Generator/procedural dungeons unused** — `maps\default-generator.yml` exists but every dungeon is `DungeonType: classic`; no room editor content.
- **Probably-broken Codex hook**: `minidungeon1complete` in `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\codex.yml` (line ~202) requires `%block_world% == TFMC_Map` *and* `%md_dungeon_name% == dungeon1` simultaneously. A player inside the `dungeon1` instance is not in `TFMC_Map`, so these conditions look mutually exclusive and the event likely never fires. It is also mis-wired in name: the event is called `minidungeon1complete`, checks `dungeon1`, and unlocks `minidungeon_2`.
- **`GiveLootAfterCompletion: false`** on every dungeon — loot must be picked up from chests during the run, not handed out at the end.
- **The plugin's own `/party` (`/dparty`)** is functionally shadowed: `PartyPlugin: MMOCore` + MMOCore's `mythicdungeons_inject` means the two systems are cross-wired into one. Players will normally type `/party`.
- **Most critically: none of the ~150 distinct mob IDs these dungeons spawn are defined in the MythicMobs config in this snapshot.** I searched the whole `plugins` tree for `Ent_King`, `Goblin_Assassin`, `crypt_skeleton_boss`, `Zerratoris_Patrol_1_P1`, `Runestone_Titan_Cerrith`, `Pillarbound_Golem`, `bl_poison_spider`, `abyssal_knight` and the named boss music skills (`Season4Dungeon1Music`, `entkingmusicstart`, `sdwitchbosstp`, `Froghorn`, `Zerratoris_Camp_Bells`) — **every one appears only inside the dungeon's own `functions.yml`**. `MythicMobs\mobs\` contains 51 files and no pack/extra directory. As configured, these dungeons would spawn nothing. See Uncertain.

### Cross-links
- **MMOCore** — the party system (`party-plugin: mythicdungeons_inject`), and all completion EXP (`mmocore admin exp give … main`).
- **MythicMobs** — every dungeon mob, every scripted music cue, every teleport and puzzle effect is a `FunctionSpawnMythicMob` / `FunctionMythicSkill` / `FunctionMythicSignal` call into MythicMobs.
- **Codex** — five dungeon achievements (`starter_dungeon`, `dungeon_1`, `minidungeon_1`, `minidungeon_2`, `minidungeon_3`), unlocked by in-dungeon `FunctionCommand`s.
- **MMOItems** — the `s4starterdungeon` loot table's items carry `mmoitems:decoy` attribute modifiers and MMOItems custom model data (Repair Kits, Lost Knowledge Fragment, Rare Research Paper, Abyssalite Fragment, Tin).
- **ConditionalEvents** — `x_dungeons.yml` (dead) and `codex.yml` (dungeon completion hook, apparently mis-wired).
- **Research** — "Lost Knowledge Fragment" and "Rare Research Paper" from dungeon chests feed the `Research` plugin's cartography-table system.
- **ModelEngine** — blueprints for the dungeon bosses are all present and accounted for (`ent_king.bbmodel`, `ent_guardian.bbmodel`, `ent_warrior.bbmodel`, `ent_sorcerer.bbmodel`, `ent_spectre.bbmodel`, `mutant_flower.bbmodel`, `vine_guardian.bbmodel`, `awakened_shrub.bbmodel`, `thorn_spitter.bbmodel`, `crypt_boss_skeleton.bbmodel`, `boss_runestone_titan_cerrith.bbmodel`, `boss_runestone_titan_corrupted.bbmodel`, `mob_goblin_{archer,assassin,shaman,warrior}.bbmodel`, `mob_{cobble,pillarbound,stacker}_golem.bbmodel`, `frogsoldier.bbmodel`, `harpmodel.bbmodel`, `bl_poison_spider.bbmodel`, `abyssal_knight.bbmodel` …). The art exists even though the mob YAML does not.
- **ItemsAdder** — dungeon music tracks live in `tfmc_pack`'s `sounds.json` (`music.lore.zerratoris`, `music.lore.zerratoris_battle`, `music.lore.zerratoris_battle_squire`, `music.lore.zerratoris_battle_knight`, `music.lore.battle_cervalic_order`, `music.lore.act_intro`, `music.lore.postbattle`, `music.lore.zenyra`, `music.lore.vardera`, `music.lore.zerratoris_dark`).
- **EssentialsX** — at least one player's userdata (`Essentials\userdata\1e431793-3f27-4eb7-8e69-012f6a67bbfb.yml`) records `world-name: trialdungeon_0`, confirming that dungeon instance worlds have been live at some point.
- **Multiverse** — `MultiverseGroup: default` for instance inventory handling.
- **LuckPerms** — `dungeons.*` permission tree.

### Uncertain / unverified
- **The missing dungeon mob definitions are the single biggest open question.** Two readings fit the evidence equally: (a) this `plugins\` snapshot is incomplete and the live server has additional MythicMobs files not captured here, or (b) the mob configs were genuinely deleted and these five dungeons are currently non-functional. The 460 empty `globalplayerdata` files and the fully commented-out `x_dungeons.yml` lean toward (b) — the dungeon system looks mothballed — but **I cannot confirm either without server access.** Do not write player-facing guide copy for these dungeons until someone checks in-game.
- **`trialdungeon` = "Tomb of Domenius" is an inference**, not a verified fact. The reasoning: five Codex dungeon achievements exist, four map cleanly to named maps, `minidungeon_3` "Heavy Is The Crown" / "Complete the Tomb of Domenius dungeon" is the leftover, and `trialdungeon` is the leftover map with a crypt/skeleton/warden roster. The config itself says only `&bA Dungeon`.
- **`TimeLimit: 60` units.** MythicDungeons documents this as minutes; I read it from config only and did not confirm against the jar.
- **`/recruit` and `/stuck` have contradictory permission declarations in the same `plugin.yml`**: `mythicdungeons.recruit` and `mythicdungeons.quickstuck` are `default: true`, while `dungeons.party.recruit` and `dungeons.stuck` are `default: op`. Which one the command actually checks at runtime is not determinable from `plugin.yml` alone. I have listed them as player commands based on the command-block permission, but **this needs an in-game test with a non-op account.**
- **All permission statements assume no LuckPerms overrides.** LuckPerms data is in an H2 database (`C:\Users\MSI\Desktop\plugins\LuckPerms\luckperms-h2-v2.mv.db`) which I could not read.
- **How players were *meant* to enter dungeons.** MythicDungeons also supports in-world `[Dungeon]` signs, which are stored in world data rather than the plugins folder. The lobby coordinates configured for `startdungeon` (−734.5, 108, 875.5) and `Minidungeon_1` (−215.5, −26, 90.6) imply a physical entrance existed. I could not check world files, so I cannot rule out a sign-based entry point.
- **All files in `globalplayerdata\` share an identical mtime** (the snapshot copy date), so I could not date the last dungeon activity from the filesystem.

---

## Addendum — second research pass (MythicMobs & MythicDungeons)

*Written by a second agent working the same two plugins. Everything below is additive: where it overlaps the sections above, the figures agree. Where it corrects something, that is stated explicitly.*

### 1. MISSING FROM THE MYTHICMOBS SECTION: vanilla mobs are rewritten server-wide

This is the highest-traffic thing MythicMobs does on this server and is not covered above. `MythicMobs\mobs\VanillaMobs.yml`, `VanillaLandAnimals.yml` and `VanillaWaterAnimals.yml` re-define the **vanilla mob types themselves**, so every naturally-spawning zombie, skeleton, cow or cod *is* a Mythic mob. All of them set `PreventOtherDrops: true` — the **vanilla drop table is replaced, not added to**.

| Mob | Faction | Drops (amount @ chance) |
|---|---|---|
| Zombie / Husk / Drowned | Monsters | `v.rotten_flesh` 1–2 @ 100% |
| Witch | Monsters | `v.glowstone_dust` 1–2 @ 50%; `v.redstone` 1–2 @ 70% |
| Skeleton / Stray | Monsters | `m.masks.SKELETON_MASK` @ **1%**; `m.masks.SKELETON_MASK2` @ **1%**; `v.arrow` 1–2 @ 60%; `v.bone` 1–2 @ 100%. Both carry a `v.bow` with `model=16`. |
| Creeper | Monsters | `m.materials.SULFUR` 1–2 @ 80%. `ExplosionRadius: 2`, explosion re-cast as `explosion{yield=4;bd=false}` — **creepers do no block damage on this server**. |
| Slime | Monsters | `v.slime_ball` 1–2 @ 100% |
| Enderman | Monsters | **nothing at all** |
| Wither Skeleton | — | not re-typed; only `Health: 50` / `Damage: 10` overridden |
| Rabbit / Pig / Sheep | Farm | `v.rabbit` / `v.porkchop` / `v.mutton` 1–2 @ **20%** |
| Cow | Farm | `v.beef` 1–2 @ **20%**; `v.leather` 1–2 @ **20%** |
| Chicken | Farm | `v.chicken` 1–2 @ **20%**; `v.feather` 1–2 @ **20%** |

All five farm animals are `Despawn: PERSISTENT`, leashable, renameable, and carry `NoDamageTicks: 20` — **you can only land one hit per second on a farm animal.** Salmon, Cod, Tropical Fish, Pufferfish and Squid set `PreventOtherDrops: true` and route loot through death skills (`salmon_drops`, `cod_drops`, `tropical_fish_drops`, `pufferfish_drops`, `squid_drops`) in `MythicMobs\skills\TFMC\Mobs\tfmc_water_animals_skills.yml`; turtles and axolotls are made `PERSISTENT` and drop nothing.

**Player takeaway for the wiki:** vanilla mob loot on this server is *not* vanilla. Farm animals drop meat only 20% of the time, endermen drop nothing, and creepers cannot grief terrain.

### 2. Partial answer to the repeated "I could not read LuckPerms" caveat

The H2 database cannot be *queried* without an H2 client, but it can be **string-scanned**. Extracting printable strings from `C:\Users\MSI\Desktop\plugins\LuckPerms\luckperms-h2-v2.mv.db` and grepping for `mythicmobs.`, `mythicdungeons.` and `dungeons.` returns exactly one node family: **4 occurrences of `mythicmobs.admin`, and nothing else.**

Consequences:

- **No `mythicmobs.command.*` node has been granted to anybody.** The "MythicMobs registers no commands a normal player can use" conclusion holds under LuckPerms, not merely under Bukkit defaults.
- **No `dungeons.*` node appears at all — including `dungeons.play`.** So the "no configured way for a player to start a dungeon" finding is reinforced: not only is there no in-world trigger, nobody holds the permission either.
- It also means the open question about `/recruit` and `/stuck` resolves *against* players: `dungeons.party.recruit` and `dungeons.stuck` are `default: op` and are granted to nobody, so if the runtime does check them, those two commands fail for everyone non-op.

**Caveat:** this is a raw string scan of a binary file, not a parsed query. It proves the strings are absent from the database file; it does not formally prove no grant exists (e.g. via a wildcard node stored in another form).

### 3. Two more references that point at nothing (add to the Inert lists)

- **`Ascendant_Reverie_Orb`** — `ConditionalEvents\events\r_lore.yml` lines 56–59 run `mm m spawn Ascendant_Reverie_Orb` at four points around `6837 53 2034` in `TFMC_Map`. **No mob file anywhere defines that ID.** All four spawns fail silently.
- **`MythicMobs:SkeletalKnight`** — referenced by `CustomFishing\contents\entity\default.yml` line 41. **Not defined anywhere in `MythicMobs\mobs\`.**

### 4. Correction: the MMOCore class kill-quests are NOT commented out

The MythicMobs Cross-links section above states that MMOCore's MythicMobs kill objectives are "currently commented out". That is true of `MMOCore\classes\test.yml`, but **not** of the live class files. `MMOCore\classes\archer.yml` lines 184–200 are active (the commented lines immediately above them, `#- 'killmob{type=SKELETON…}'`, are the *vanilla* versions that were replaced). The same live `killmythicmob` blocks appear in `bard.yml`, `guardian.yml`, `mage.yml` and `musketeer.yml`.

This matters because **most of the targeted mobs have no spawn path**. Every ID below is defined (in the 3rd-party packs) but appears in **no** random-spawn file, **no** Infestations group and **no** console spawn command:

| Tier in `archer.yml` | Mob IDs | Reachable? |
|---|---|---|
| EasyMobs | `Aurorafowl`, `Wraith`, `Kobold_Warrior`, `Kobold_Archer` | **No — unspawnable** |
| EasyMobs | `rpg_mushroom`, `rpg_mushroom_red` | **No — unspawnable** |
| EasyMobs | `rpg_slime_cube` | Yes — Infestations swamp groups |
| MediumMobs | `Cryonic_Crab`, `Salamander` | **No — unspawnable** |
| MediumMobs | `rpg_poison_slime_cube`, `rpg_skeleton`, `rpg_skeleton_crossbow`, `rpg_rat_undead` | Yes — Infestations swamp groups |
| HardMobs | `Permafrost_Sentinel`, `Mimic` | **No — unspawnable** |

So a player rolling a class quest objective has roughly a coin-flip chance of drawing an **uncompletable** one. Flagged for the RPG-stack dossier owner — this is a cross-plugin gap, not a MythicMobs bug.

### 5. Composed drop rates, stated end-to-end

Both stages are easy to miss when reading the tables above separately:

| Outcome | Maths | Effective |
|---|---|---|
| Rare Item Skin Scroll from an `rpg_skeleton` | 20% (mob rolls its table) × 30% (item within `MediumMob`) | **6%** |
| Epic Item Skin Scroll from a `GreenTroll` | 20% × 30% (`HardMob`) | **6%** |
| A named fisher-profession material off a Shark | 5% (mob rolls `SharkMats`) × 10% (item within table) | **0.5%**, and only while holding **both** `professions.fisher_weapon_3` and `professions.fisher_armor_3` |
| Either Skeleton Mask off a skeleton | flat | **1%** each, **2%** for one-or-the-other |
| At least one Rare Research Paper from one dungeon loot chest | 1% + 1% per pick, 2–4 picks, duplicates allowed | **≈ 4–8%** |

### 6. Corroboration of the boss-ticket mismatch

Independently confirmed. `MMOItems\item\loot.yml` lines 257–288 define both tickets as:

```
BOSS_TICKET_1:  material: PAPER   custom-model-data: 9.0   revision-id: 2
BOSS_TICKET_2:  material: PAPER   custom-model-data: 9.0   revision-id: 2
```

while `ConditionalEvents\events\x_world_bosses.yml` gates the right-click on `%item% == GOLD_NUGGET` **and** `%item_custom_model_data% == 73`. The two cannot both be true. The `revision-id: 2` is the tell — the item was redesigned from a gold nugget to paper and the ConditionalEvents trigger was never updated. **Both world bosses are therefore very likely unreachable by players**, which makes the world-boss content inert in practice despite being fully built. This needs one in-game test with a freshly-drawn ticket to confirm.

### 7. Two smaller notes

- **`Deer` display name.** `mobs\TFMC\Mobs\tfmc_land_animals.yml` gives `Deer` no `Display:` at all (and a blank `Faction:`), so even if it were spawned it would show no nameplate. Drops: `v.leather` 1–2 @ **80%**, `v.raw_beef` 1–2 @ **90%**.
- **Seithr Fortress mobs would drop nothing even if spawned.** All 22 combat mobs in `mobs\TFMC\Dungeons\seithr_fortress_mobs.yml` declare a `Drops:` key with **no entries beneath it**. The same is true of `Shadow_Fragment`. So the "inert" verdict on those sets is doubly true: nothing spawns them, and they carry no loot.
