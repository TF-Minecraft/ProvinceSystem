# Dossier D — Identity & Social Systems

**Purpose:** Factual research dossier for a player-facing gameplay wiki. This is *not* guide prose — it is verified facts with file citations, for a writer to turn into player-facing pages.

**Plugins covered:** RPCharacters, SimpleFactions, TFMCCore, TFMCWeb, BirdMessenger, HelpCommand, AACommandsFiller, GSit, EssentialsX (+ EssentialsXChat)

**Snapshot date:** 2026-09-11
**Sources:** live plugin data folders under `C:\Users\MSI\Desktop\plugins\` (read-only), plugin jars' `plugin.yml`, upstream source cloned read-only to `C:\Users\MSI\Desktop\plugin-src\`, and the ItemsAdder `tfmc_pack` contents.

---

## READ THIS FIRST — three server-wide caveats

These affect how much of this dossier you can publish as fact.

### 1. LuckPerms permission data is UNREACHABLE

`C:\Users\MSI\Desktop\plugins\LuckPerms\config.yml` line 3 sets `storage-method: MariaDB`, pointing at `localhost:3306`, database `luckperms`. **Port 3306 refuses connections on this machine and no mysql/mariadb client is installed.** There are no `yaml-storage/` or `json-storage/` folders.

The file `luckperms-h2-v2.mv.db` is a **leftover from a previous storage method and is NOT authoritative**. Proof that it is stale: it contains a block of `towny.*` nodes granted to the `default` group, but **Towny is not installed** — this server's territory plugin is SimpleFactions. It also references `orpchat.*`, `openrp.*`, `speechbubbles.use` and `denizen.clickable`, none of which correspond to installed jars.

**Consequence:** wherever a plugin declares a permission with `default: true`, we can state player access as fact. Wherever a node is `default: false` or undeclared (Bukkit falls back to op-only), we **cannot** confirm whether the default group has been granted it. This is flagged per-plugin below. It bites hardest on EssentialsX and on RPCharacters' chat/roll/persona commands.

### 2. This looks like a DEV/STAGING snapshot, not production

- `RPCharacters/config.yml` has `dev-characters: true` — in-game creates are tagged dev and website character pulls are disabled.
- `SimpleFactions/Data/` contains only four test factions (`Slumholt`, `testistan`, `test_fran`, `What`), and `Cache/logins.json` is dominated by `dummy*` accounts.
- `Essentials/warps/` contains only `dref_test`, `faction_test`, `pvp_test`, `vehicle_test`.
- `Essentials/kits.yml` and `worth.yml` are the **stock unmodified EssentialsX example files**.

Numbers and mechanics are still trustworthy; *world state* (warps, factions, kits) is not.

### 3. HelpCommand's jar is missing

Every `.jar` in the plugins folder was enumerated and its `plugin.yml` `name:` field read. **None is HelpCommand.** The `HelpCommand/` folder contains exactly one file, `config.yml`. The config is fully authored for this server and is an excellent record of *intended* player commands, but we cannot confirm `/help` is live in-game.

---

## RPCharacters

`rpcharacters-1.1.6.jar` · author Drefvelin · `main: net.tfminecraft.rpcharacters.RPCharacters`

### What it is

RPCharacters is the roleplay-character backbone of the server: it makes each player create and play as one or more named characters (race, traits, attributes, appearance, description), routes all chat through in-character channels, and handles death, injury, permadeath, graves, clues and professions for those characters.

### How a player actually uses it

1. **You are forced into character creation.** With `require-character: true` (`C:\Users\MSI\Desktop\plugins\RPCharacters\config.yml`) a Survival player with no active character has every command cancelled except `/rpcharacter ...`, `/roll` and the registered chat-channel commands (`CommandManager.java:706-736`). `no-character-freeze: true` also applies.
2. **`/rpcharacter create`** — checks for a free character slot, then starts the staged creator.
3. **Stage flow** (`stages.yml`, in file order): welcome → age gate (OOC 18+) → info → name (typed in chat) → class info → class selection → race selection → character age → trait GUIs (homeland, cataclysm, reclamation, motivation, gift, virtue, combat, physical, celestial) → attributes → personality → evil archetype → permanent injury → prosthetic → description (typed in chat) → clue entry (typed) → wardrobe → summary.
   Navigation: `/rpcharacter next`, `back`, `help`, `cancel`.
4. **After creation**, `/rpcharacter menu` returns you to the character selection room, where you switch characters or end one. Switching characters is on a per-rank cooldown.
5. **Starter kit:** `/rpcharacter kit starter`.
6. **Talking:** plain typing goes to your default channel (`chat.yml` `default: rp`). Explicit commands `/rp`, `/shout`, `/yell` (`/y`), `/whisper` (`/wh`), `/looc`, `/ooc`, `/me`, `/scene` are registered at runtime from `chat.yml` `channels.*.commands` via reflection into the Bukkit CommandMap (`chat\ChatCommandRegistry.java:26-50`). `/channel <id>` changes the default; `/channeltoggle <id>` hides/shows a channel.
7. **Rolling:** `/roll`, `/roll <max> [+/-mod]`, or `/roll <attribute>` (d20 + that attribute's modifier). **Survival gamemode only** (`roll\RollManager.java:24-26`).
8. **Persona editing:** `/rpcharacter alias|namecolour|gender|description|birthday|profile`.
9. **Looking at someone:** sneak + empty hand + right-click a player prints their character card (`profile-view.yml`: `require-sneak: true`, `require-empty-hand: true`).
10. **Skins:** `/rpcharacter wardrobe` opens the GUI; `/rpcharacter wardrobe <base|extra_1|extra_2|name>` equips directly.
11. **Professions:** `/profession` opens the menu GUI; `/profession top <profession>` shows a leaderboard.
12. **PvP etiquette:** `/pvp start` broadcasts a countdown to nearby players; `/pvp lethal` / `/pvp nonlethal` sets the active character's PvP mode.
13. **Consensual RP injury:** `/rpcharacter injure <player>` opens an injury-picker GUI for the initiator, then the target confirms (`injuries\RpInjureService.java:37-67`).
14. **Investigating clues:** hold a magnifying glass and right-click to actively search; passive discovery also fires on a timer. `/rpcharacter clues` opens your clue list.
15. **Dying:** a grave chest is placed with a hologram; right-click it to recover (or rob). Right-clicking a `grave_insurance` item anywhere recovers your newest grave.
16. **Injury recovery:** drink a remedy potion to cure a healing injury; right-click a blaze rod to install a prosthetic over a permanent injury (`prosthetics.yml` `install-item: v.blaze_rod`); right-click arcane fuel to refuel an arcane prosthetic.

### Content it adds

- **Character creation** — 30+ configured stages (`stages.yml`).
- **Races** — human, elf, orc and more, each with `age-max` and attribute modifiers (`races.yml`).
- **Traits** — 16 files under `C:\Users\MSI\Desktop\plugins\RPCharacters\traits\`: ambition, attributes, cataclysm, celestial, combat, evil, expedition, gift, homeland, injury, motivation, personality, physical, prosthetic, reclamation, virtue.
- **Chat channels** — rp, shout, yell, whisper, looc, ooc, action (`/me`), scene, plus staff dm/admin/helper. Formats e.g. RP `&f{display}&e: &f"&e{message}&f"`; OOC `&f[&9OOC&f] &f{player}: &7{message}`; action `&e* &f{display} &d{message}`.
- **Speech bubbles** — floating text displays above heads (`speechbubbles.yml`).
- **Smart messages / sound occlusion** — walls muffle speech, letters get garbled per `muffle-rules`, and heavily muffled speakers show as `???` (`smart-messages.yml`).
- **Masks** — wearing `m.masks.ghost_mask` replaces your chat/display name with "Masked" (`masks.yml`).
- **Dice** — d100 default, d200 with `rpchar.roll.alt`, d20 for attribute rolls (`rolls.yml`).
- **Clue system** — characters author 2–10 personal clues left at scenes, plus an automatic race clue (`"This seems to be the mark of {a/an} {race}"`). Clues spawn as fading text displays with particles, decay in potency, and are found via passive perception or magnifying glasses.
- **Magnifying glasses** — 4 tiers (iron, steel, abyssalite, mythril) with discovery bonuses and attribute requirements (`items.yml`).
- **Skill/attribute tomes** — minor (1 pt) and major (5 pt).
- **Injuries** — broken_arm, broken_leg, half_blind (healing, 72 h) escalating to one_handed, one_legged, blind (permanent).
- **Prosthetics** — wooden claw arm, basic/arcane prosthetic arm, pegleg, basic/arcane prosthetic leg; arcane ones have a fuel meter and a depowered penalty state.
- **Permadeath zones** — e.g. "Mount Vard" (`mini_vard`) in `zones.yml`.
- **Graves** — CHEST-material grave with a hologram showing the killer, lock/protect state, robbery hint, and a `grave_insurance` consumable.
- **Professions** — crafter, forager, herborist, plus a breeding-XP table and animal breeding locks.
- **Fantasy calendar** — years offset by 1647, era suffix `AE`, minimum character age 18 (`calendar.yml`).
- **Rank groups** — noble, gilded, ascended, legacy: more alive characters, shorter switch cooldowns, more name-colour gradient stops, more wardrobe slots (`permission-groups.yml`).
- **Web character creator** — characters can be created on the website and ingested.

**Per-character data stored** (`data\characterdata\<playerUUID>\<characterUUID>.json`): `active`, `birthday`, `class`, `clues[]`, `conversations`, `created-at`, `description`, `extra-attribute-allocation`, `id`, `kit-status`, `last-location`, `name`, `name-colour.colours[]`, `race`, `slug`, `status`, `traits[]`.

### Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/rpcharacter create` | — | Starts character creation | Requires a free character slot |
| `/rpcharacter next` / `back` / `help` / `cancel` | — | Creation-stage navigation | Only while a creator is active |
| `/rpcharacter edit [entry]` | — | Re-opens the creation editor / a specific entry | |
| `/rpcharacter menu` | — | Returns you to character selection | With a player arg, staff get that player's chest GUI (`rpcharacters.admin`) |
| `/rpcharacter kit <id>` | — | Claims a kit (e.g. `starter`) | |
| `/rpcharacter clues` | — | Opens your character's clue GUI | With a player arg it needs `rpcharacters.admin` |
| `/rpcharacter wardrobe [slot]` | — | Wardrobe GUI, or equips `base`/`extra_1`/`extra_2`/name | |
| `/rpcharacter injure <player>` | — | Consensual RP-injury flow with another player | `rpchar.injure`, **`default: true`** in plugin.yml |
| `/rpcharacter alias <name>` / `clear` | — | Sets your character's alias | Needs `rpchar.persona.set` (see caveat below) |
| `/rpcharacter namecolour <#hex...>` / `clear` | — | Sets name colour / gradient | Stops allowed by rank group |
| `/rpcharacter gender <Male/Female/Other>` | — | Sets character gender | |
| `/rpcharacter description <text>` / `clear` | — | Sets character description | Colour codes stripped without `rpchar.persona.colors` |
| `/rpcharacter birthday <DD.MM.YYYY>` / `clear` | — | Sets fantasy-calendar birthday | Validated against race `age-max` and `calendar.yml` minimum |
| `/rpcharacter profile [player]` | — | Shows a character profile card | Needs `rpchar.profile` |
| `/rpcharacter dismisspdwarning` | — | Permanently hides the permadeath tutorial | **No permission check** |
| `/rpcharacter tempalias <name>` / `clear` | — | Session-only alias | Needs `rpchar.tempalias` |
| `/rpcharacter sethidden <slug> [clear]` | — | Hides a character from TAB/list | Needs `rpchar.character.hidden` |
| `/roll [max or attribute] [+/-mod]` | — | Dice roll broadcast to nearby players | Code checks `rpchar.roll`. **Survival gamemode only** |
| `/profession` | — | Opens the profession menu GUI | `rpchar.profession.use`, **`default: true`** |
| `/profession top <profession>` | — | Profession leaderboard | No admin check on this branch |
| `/pvp start` | — | 10 s countdown warning to players within 16 blocks | `rpchar.pvp`, **`default: true`** |
| `/pvp lethal` / `/pvp nonlethal` | — | Sets this character's PvP lethality | `rpchar.pvp`, **`default: true`** |
| `/channel [id]` | — | Sets default chat channel, or shows current | Allowed: rp, ooc, looc, whisper, shout, yell, action |
| `/channeltoggle <id>` | — | Toggles a channel's visibility | Allowed: looc, ooc, helper, admin |
| `/rp <msg>` | — | In-character speech, 15-block range | |
| `/shout <msg>` | — | 24-block range | |
| `/yell <msg>` | `/y` | 48-block range, bold red | |
| `/whisper <msg>` | `/wh` | 2-block range, italic | |
| `/looc <msg>` | — | Local OOC, 20-block range | |
| `/ooc <msg>` | — | Global OOC | Works with **no character** (`require-character: false`) |
| `/me <msg>` | — | Emote/action, 20-block range | |
| `/scene <msg>` | — | Scene narration, 20-block range, no speech bubble | |

**Admin/staff commands excluded:**

- `/rpcharacter admin injure|permakill`, `permakill`, `reload`, `catalog sync`, `pending sync`, `wipe`, `reclaimkit`, `resetkit`, `stage preview`, `setclass`, `seteighteen`, `skipcooldown`, `addtrait`, `removetrait`, `placeclue`, `clearclues`, `adminmode`, `discordgate`, `setworldspawn` — all gated by `rpcharacters.admin` (`default: false`).
- `/rpcharacter override <player> <field> <value>` — `rpchar.persona.override`.
- `/rpcharacter menu <player>` and `/rpcharacter clues <player>` — the player-arg forms need `rpcharacters.admin`.
- `/profession reload|givepoints|removeupgrade|reset` — `professions.admin` (`default: op`).
- `/admin` (`/a`), `/helper` (`/h`), `/dm` (`/narrate`) chat channels — `rpchar.chat.admin` / `rpchar.chat.helper`. Note `/dm` output is *readable* by anyone with `rpchar.chat.use`.
- `rpchar.grave.admin` — `default: op`, grave bypass, no command attached.

> **Permission caveat for this table.** `plugin.yml` declares only six nodes: `rpchar.profession.use`, `rpchar.pvp`, `rpchar.injure`, `rpchar.grave.protect` (all `default: true`), `rpchar.grave.admin` and `professions.admin` (`default: op`). Nodes like `rpchar.chat.use`, `rpchar.roll`, `rpchar.persona.set`, `rpchar.profile`, `rpchar.tempalias`, `rpchar.character.hidden` appear **only in YAML configs** and are never registered at runtime (`grep addPermission` returns nothing). Under Bukkit an undeclared node is op-only, so these are almost certainly granted to the default group via LuckPerms — **which we could not verify** (see caveat 1). The chat/roll/persona rows are listed on that assumption.

### Numbers that matter to players

**`config.yml`** — `default-clues-required: 2`; `evil-clues-required: 4`; `max-clues: 10`; `evil-min-account-age-hours: 24`; `clue-min-length: 12`; `clue-max-length: 48`; description length 32–256; `spawned-clue-timer: 48` (unit inferred as hours); `clue-spawn-radius: 3`; conversation reply timeout 30 s, pair cooldown 2 h; `rp-injure.range: 10`, `rp-injure.timeout-seconds: 30`; `base-profession-factor: -10`.

**`chat.yml` — ranges in blocks:** whisper 2 · rp 15 · looc 20 · action (`/me`) 20 · scene 20 · shout 24 · yell 48 · dm 64 · ooc unlimited. **All channels have `cooldown: 0`.**

> Conflict: `HelpCommand/config.yml` page 1 advertises `/shout` as **25** blocks; `chat.yml` says **24**. The live plugin config wins. See "Conflicts and contradictions" at the end.

**`rolls.yml`** — default 1–100; `alternative` (`rpchar.roll.alt`) 1–200; attribute rolls d20; broadcast range 20. Attribute modifier table (identical for all six attributes): 0–1 → −5, 2–3 → −4, 4–5 → −3, 6–7 → −2, 8–9 → −1, 10–11 → 0, 12–13 → +1, 14–15 → +2, 16–17 → +3, 18–19 → +4, 20 → +5.

**`pvp.yml`** — `start-radius: 16`; `start-warn-seconds: 10`; `start-countdown-from: 5`; `knockout-seconds: 30`; `blindness-amplifier: 4`.

**`permission-groups.yml`** — defaults: switch cooldown **4 days**, **3** alive characters, **0** name-colour stops, **1** wardrobe slot. Noble: 3 d / 3 / 1 / 1. Gilded: 2 d / 4 / 2 / 2. Ascended: 1 d / 5 / 20 / 3. Legacy: 1 d / 5 / 20 / 3.

**`profile.yml`** — `max-character-slots: 10` (hard cap regardless of rank).

**`persona.yml`** — display name 3–24 chars; alias, gender and description cooldowns 10 s each; default description `"A{n} {race} in {continent}."`; no-character fallback name `Unknown`.

**`calendar.yml`** — `year-offset: 1647`; `era-suffix: AE`; `age.minimum: 18`.

**`clue-discovery.yml`** — investigation points max **20**, regen cycle 30 s. Passive: every 15 s, radius 4.0, base chance **0.08**, min potency 0.1. Active: 3 s cooldown, costs **1** investigation point, radius 3.0, base chance **0.35**. Attribute weights: wisdom 0.02, intelligence 0.015 per point. Potency starts 1.0, decays **0.02/hour**, min 0.1 to discover, 0.15 to read. Readability: full clarity at 0.85, min audible 0.12.

**`items.yml` — magnifying glasses:** iron (+0.0, radius 3.0) · steel (+0.1, radius 3.75, needs wisdom 6 / int 4) · abyssalite (+0.2, radius 4.5, wisdom 10 / int 8) · mythril (+0.35, radius 6.0, wisdom 14 / int 12).

**`injuries.yml`** — healing tick every 1 min; roll weights broken_arm 40, broken_leg 35, half_blind 25.

**`traits\injury-traits.yml`** — healing injuries last **72 h**. broken_arm: strength −4, constitution −2, Weakness I, offhand blocked. broken_leg: dexterity −4, Slowness I. half_blind: dexterity −1. Permanent — one_handed: str −3, con −1, Weakness I, offhand blocked. one_legged: dex −3, Slowness I. blind: dex −4, wisdom −2, **Blindness V**.

**`traits\prosthetic-traits.yml` / `fuel-templates.yml`** — all prosthetics cost 1. Arcane arm/leg: `fuel-capacity: 50`; `arcane_fuel` gives 50 units, burning **1 per hour**, so a full prosthetic runs ~50 hours. Depowered penalties are roughly double the powered ones.

**`zones.yml`** — `permadeath-chance-per-injury: 10` (read as +10% per injury from the tutorial text).

**`graves.yml`** — `hologram-radius: 32`; `expire-seconds: 0` (**graves never expire**); material CHEST; `m.miscellanea.grave_insurance` never enters a grave and is consumed on use.

**`kits.yml`** — `starter`: `cooldown-hours: 48`, `once-per-character: true`. Contents: 1× iron hunting knife (customisable skin), 32× gold coin, 256× bread, 1× writable book (customisable), 1× bundle, 1× brown bed.

**`professions.yml`** — `max_spending_points: 40`. Breeding XP: generic 10; goat/frog/wolf/cat/parrot/panda/bee/fox/turtle/axolotl 12; horse/donkey/camel/llama 16; rabbit/pig/sheep/cow/chicken 20. All non-generic species are in `lock_breeding`.

**`smart-messages.yml`** — fade starts at 60% of range; min audible 0.05; full clarity 0.85; muffle rules replace `th`→`th...` (70% chance below 0.7 intelligibility), `sh`→`sh...` (60% below 0.6), word-end→`...` (40% below 0.5); charisma hearing boost up to +0.20; **anonymous `???` voice below 0.65 intelligibility**.

**`speechbubbles.yml`** — scale 0.8; 32 chars per line; 2.0 blocks above head; max 5 stacked utterances; 5 s timeout.

**`races.yml`** — `age-max`: human 110, elf 210, orc 90 (file not exhaustively enumerated).

### Cross-links

- **TLibs** (hard depend) — all item references use TLibs paths (`m.tools.*`, `m.currency.*`, `v.*`); `PvpCommand` imports `net.tfminecraft.tlibs.armour.ArmorEquipEvent`.
- **MMOCore** (hard depend) — character classes are MMOCore `PlayerClass` objects; RPCharacters hooks `/mmocore admin skill-points` and `attribute-points`.
- **MMOItems** (hard depend) — `professions.yml` `types.*.mmoitem_types` lists MMOItems types (sword, spear, musket, shield...).
- **MythicLib** (hard depend) — attribute/stat layer under MMOCore.
- **TFMCWeb** (hard depend) — API gateway for website sync (`api\GatewayClient.java:145` "TFMCWeb gateway unavailable").
- **TFMCWeb** — `api\ProvinceSystemClient.java` (`GET /characters/plugin/pending`); `/rpcharacter resetkit` triggers a TFMCWeb customise wipe.
- **ItemsAdder** — kit skin customisation via `CustomStack` with namespaces `tfmc_submissions` / `tfmc_armorshop`.
- **LuckPerms** (softdepend) — `ProfessionCommandHandler` writes LuckPerms `PermissionNode`s with `perm_context: main`; rank groups `rpchar.group.*` come from LuckPerms.
- **ProtocolLib** (softdepend) — fake-entity speech bubbles.
- **PlaceholderAPI** (softdepend) — character placeholders.
- **WorldGuard** (softdepend) — permadeath/PvP zone checks.
- **TFMCCore** — consumes RPCharacters events (`CharacterCreatedEvent`, `CharacterChatEvent`, `CharacterPermakillEvent`, ...) for its stats DB, and keys its Focus pool to `RPCharacter.getId()`.
- **BirdMessenger** — reads the character list, skull textures and per-character last-known location.
- **SimpleFactions** — RPCharacters playtime feeds SimpleFactions' per-member prestige term.
- **Discord gate** — a gate freezes Survival players until Discord-verified; applied by **TFMCWeb** calling `RPCharacters.setDiscordGate(...)`.

### Uncertain / unverified

- **The permission caveat above is the biggest gap** — chat, roll and persona commands are assumed player-accessible but unverified.
- `spawned-clue-timer: 48` has no unit in config; hours is the plausible reading, not confirmed in code.
- `permadeath-chance-per-injury: 10` — percent vs weight not stated in `zones.yml`.
- **No ItemsAdder items were found for RPCharacters' own items.** Grepping `ItemsAdder\contents\` for `magnifying_glass`, `grave_insurance`, `skill_tome`, `ghost_mask` returned only unrelated `vehicleframework` hits for `arcane_fuel`. RPCharacters resolves items via TLibs paths; where those ultimately point is unverified.
- `races.yml`, `stages.yml` and the 16 trait files were sampled, not exhaustively enumerated.
- `dev-characters: true` — this folder is in dev mode (see caveat 2).
- `magic\elements.yml` contains a single element (`cerrith` → skill `woodland_anvil`); no command or GUI reading it was found.
- `expedition-traits.yml` and `ambition-traits.yml` are not referenced in `config.yml`'s trait-type lists; how they are granted is unverified.
- Grave robbery conditions are documented in `docs\graves-system\05-thievery-hook.md`, which was not read.

---
## SimpleFactions

`simplefactions-2.8.7.jar` · `net.tfminecraft:simplefactions:3.0.0` · author Drefvelin

> **Source.** [TF-Minecraft/SimpleFactions](https://github.com/TF-Minecraft/SimpleFactions). Everything below was read from the deployed 2.8.7 jar's bytecode and the live configs, not the repo. Consequences are listed under "Uncertain".

### What it is

SimpleFactions is a nation-building plugin that turns a fixed, pre-drawn map of 806 numbered provinces into a grand-strategy layer — you found a faction, claim provinces, run a government with laws and taxes, build guilds and companies that generate trade income, and fight scheduled wars and battles over land, all mirrored onto a live web map.

### How a player actually uses it

1. **Found a faction.** `/faction create <name>`. You are told `Use /faction setcapital <name> to claim your first province and found your capital.` Until the capital exists, `/faction claim` is refused.
2. **Found the capital.** Stand in a province and run `/faction setcapital <CityName>`. The province is resolved from the province-ID grid (`Input/province_id_grid.bin.gz`); off-grid gives `This location has no province!`. This writes a `faction_capital` settlement marker to `MapAPI/map_markers.json`.
3. **Claim land.** Stand in an adjacent province and `/faction claim` (leader only). Failure messages include `Your faction already owns this province!`, `Cannot claim land during a civil war.`, and `You have too many untitled provinces, form a county first!`. `/faction unclaim` reverses it; `Cannot unclaim the capital!`.
4. **Titles / tiers.** Untitled provinces are capped at 5, so you open the tier/title GUI and form a County, then Duchy, Kingdom, Empire. Title shapes are pre-baked in `Input/county.json`, `duchy.json`, `kingdom.json`, `empire.json`.
5. **Recruit.** `/faction invite <player>`, they run `/faction join <name>`. `/faction leave` is blocked if you are in a sub-guild (`You are in a guild, use /guild leave instead`); the leader uses `/faction kick <player>`.
6. **Money.** The leader places a bank block with `/faction setbank` (`bank-block: iaf(tfmc:bank)`, an ItemsAdder furniture id), then anyone stands in the bank chunk and runs `/faction deposit <amount>`; only the leader can `/faction withdraw <amount>`.
7. **Guilds.** Inside a faction, `/guild create <name>` makes a sub-guild — you cannot if you are the faction leader, because that faction owns the "base guild" / Realm automatically. Guild leaders get their own `setbank`, `deposit`, `withdraw`, `setcapital`, `setbanner`, `invite`, `setleader`, `rename`. Guild economy (branches, upgrades, loans, dividends) runs through GUIs.
8. **Government.** `/faction menu` opens the hub; from there: government, laws, taxes, council, elections, proposals. Under a democracy you cannot `/faction setleader` (`Cannot set leader in a democracy!`); instead elections run and players vote at voting booths (`voting-block: v(chiseled_bookshelf)`). Dissenters organise through movements, causes and the coup system.
9. **Diplomacy.** GUI-only for normal players. The `/faction setrelation` / `settreaty` / `setstance` commands are **admin overrides**, not the player path.
10. **War.** Declared from the war-declare GUI chain. In production the attacking leader must first type a staff-minted Discord code (`war.require_declare_code: true`) which pins the war goal; `simplefactions.admin` bypasses it. Players then check `/war list`.
11. **Battles.** Battles are **scheduled, not spontaneous**. Form a warband (`/warband create <name>`, `invite`, `toggleopen`, `list`), sign up, then `/battle join <battleId>` when the window opens. Mid-battle, `/warband retreat`. Campaign raids use `/raid join` with a 60-second muster.
12. **Installations and vehicles.** A faction leader runs `/faction construct fort|port|airport <name>` in an owned, non-water province; after the build timer the installation exists and has vehicle slots. A player-owned VehicleFramework vehicle is berthed with `/faction vehicle transfer <installation id>` (the owner must be online and confirm), located with `/faction findvehicles <installation id>`, and kept alive with `/faction vehicle maintenance pay` → `Right-click the vehicle to pay one day of maintenance from your pouch.` **An unpaid vehicle cannot be repaired.**
13. **Mercenaries.** A guild member runs `/company found <name>` to buy a charter, `/company invite <player>` to offer a slot, recruits run `/company accept` / `decline`. The leader uses `/company expand` for another slot, `/company draft` to write a contract book, `/company offer <faction>` to send it, `/company contracts` for the ledger. Buyers browse with `/mercenaries`, `/mercenaries list`, `/mercenaries hire <company>`.
14. **Income.** `/ledger` opens your personal daily cashflow — wages, dividends, taxes.
15. **Farming.** Crop growth is province-gated: each crop has a fertility requirement, and growth rolls fail in provinces whose fertility is too low.

### Content it adds

- **Province map, not chunk claims.** 806 fixed provinces, each with an id, RGB colour, terrain type and a third numeric field (`Input/provinces.txt`, e.g. `1 = 58,132,60;plains;78`), a packed lookup grid (`Input/province_id_grid.bin.gz`) and an adjacency graph (`Input/province_neighbors.json`). Claiming is **per-province**.
- **Titles and tiers.** Landless → Province → County → Duchy → Kingdom → Empire, each with per-culture aliases (Barony, Tribe, Town, Republic, Chiefdom, Petty Kingdom, Grand Republic...) — `tiers.yml`.
- **Prestige ranks.** Five, from Obscure Faction to Legendary Faction — `ranks.yml`.
- **Diplomacy.** Relation types `subject`, `integrated_subject`, `march`, `mercantile`, `palatinate`, `ally`, `rival`, `tributary`/`suzerain`, `war`, plus trade overlays `trade_agreement`, `unequal_treaty_leader/subject`, `embargo`, `nap` — each with a diplomatic-capacity cost (`diplomacy.yml`). Separate attitude axis: friendly / neutral / unfriendly / hostile.
- **Laws and government.** 14 law groups in `laws.yml`: `citizen_tax`, `vassal_tax`, `guild_tax`, `leadership`, `government`, `council`, `military`, `vassalage`, `economy`, `borders`, `repression`, `favouring`, `assembly`. Government forms: community, autocracy, oligarchy, plutocracy, democracy. Plus councils, proposals, elections, voting booths, stability modifiers, political movements, causes, crackdowns and coups.
- **Political actions.** `change_leader`, `nationhood`, `independence`, `snap_elections`, `dissolve`, `white_peace`, `surrender` — `political-actions.yml`.
- **War and battles.** Campaign wars with goals (`DE_JURE_ANNEX`, `SUBJUGATE`, `TRANSFER_SUBJECT`, `TRIBUTARY`, `USURP`, `OPEN_MARKET`, `CHANGE_GOVERNMENT`, `PILLAGE`, `OVERTHROW`, `CHANGE_LAW`, `CHANGE_TAX`, `FORCE_PEACE`, `WAR`), a path/zone-of-control pathfinder, occupation maps, reparations, civil wars, and three live battle types: **field** (capture points, collective lives), **siege** (timed contest), **raid** (`battle-templates.yml`). Warbands are the squad unit.
- **Military.** Regiment types Professional Army, Militia, Levies, plus a Mercenary Company prototype — `regiments.yml`.
- **Guilds and companies.** Guild types Guild / Realm; branches Bureaucracy, Guild Halls, Workshops, Storehouses; realm/guild upgrades; mercenary company upgrades Hardened Bodies / Warding Sigils / Steady Focus (`Guilds/*.yml`). Plus loans, trade-power/production nodes, dividends and a per-player ledger.
- **Vehicles.** Five categories with per-vehicle upkeep and slot size: land vehicles, trains, ships, static emplacements, aircraft — `vehicles.yml`. Berthing, transfer consent, maintenance decay, repair locks, wartime embargoes.
- **Installations.** Forts, ports and airports with radii, daily upkeep, construction times and per-category vehicle slots — `installations.yml`.
- **Fertility farming.** Vanilla and CustomCrops crops each need a province fertility level — `fertility-crops.yml`.
- **77 distinct GUI screens** enumerated in `enums/SFGUI`.
- **Map export.** JSON snapshots written to `MapAPI/`: `nation.json`, `guilds.json`, `province_data.json`, `map_markers.json`, `chronicle.json`, plus a dirty-flag `queue.json`.

### Player command table

Normal players (no `simplefactions.admin`). "Notes" gives the in-faction rank requirement enforced by the code.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/faction` | — | Opens the faction hub GUI | Any player |
| `/faction menu` | — | Opens the faction view | Any player |
| `/faction list` | — | Lists all factions | Any player |
| `/faction create <name>` | — | Founds a faction; you become leader | Must not already be in a faction |
| `/faction delete` | — | Disbands your faction | **Faction leader.** Blocked if bankrupt, has active loans, or balance > 0 |
| `/faction invite <player>` | — | Invites a player | **Faction leader.** Blocked at `max-members` |
| `/faction join <name>` | — | Joins a faction you were invited to | Must be invited and factionless |
| `/faction leave` | — | Leaves your faction | Leader must `delete` instead; guild members use `/guild leave` |
| `/faction kick <player>` | — | Removes a member | **Faction leader.** Cannot kick the leader or a guild member |
| `/faction accept` | — | Accepts a pending request (diplomacy/transfer) | **Faction leader** |
| `/faction setleader <player>` | — | Hands leadership to a member | **Faction leader.** Blocked under democracy; target must not be a guild leader |
| `/faction rename <name>` | — | Renames the faction | **Faction leader** |
| `/faction setcapital <name>` | — | Founds/moves the capital city in the current province | **Faction leader.** Name required |
| `/faction claim` | — | Claims the province you stand in | **Faction leader.** Needs a capital; blocked in civil war; blocked past the untitled cap |
| `/faction unclaim` | — | Releases the province you stand in | **Faction leader.** Cannot unclaim the capital |
| `/faction construct <fort/port/airport> <name>` | — | Starts building an installation here | **Faction leader.** Owned, non-water province; one build at a time |
| `/faction deconstruct <id>` | — | Demolishes an installation | **Faction leader** |
| `/faction installation` | — | Opens the installations view | Any faction member |
| `/faction vehicle transfer <installation id>` | `/faction transfervehicle <id>` | Berths a vehicle (owner must be online and consent) | **Faction leader.** Blocked during battle/raid embargo |
| `/faction vehicle maintenance pay` | `/faction maintenance` | Arms a right-click to pay one day of vehicle maintenance from your pouch | **Faction leader** |
| `/faction findvehicles <installation id>` | — | Lists berthed vehicles with coordinates | Any faction member |
| `/faction setbanner` | — | Sets the faction banner from your held banner | **Faction leader** |
| `/faction setcolour <R,G,B>` | — | Sets the map colour; re-queues the map | **Faction leader.** 0–255 each |
| `/faction setrulertitle <title>` | — | Sets the ruler's title ("Leader", "King"...) | **Faction leader** |
| `/faction setrulingsystem <system>` | — | Sets the ruling-system label | **Faction leader** |
| `/faction setculture <culture>` | — | Sets the culture label | **Faction leader** |
| `/faction setreligion <religion>` | — | Sets the religion label | **Faction leader** |
| `/faction setbank` | — | Sets/moves the faction bank chunk | **Faction leader** |
| `/faction deposit <amount>` | — | Deposits denars into the faction bank | Any member, in the bank chunk |
| `/faction withdraw <amount>` | — | Withdraws from the faction bank | **Faction leader**, in the bank chunk |
| `/guild` / `/guild menu` | — | Opens the guild hub GUI | Any player |
| `/guild list` | — | Lists guilds | Any player |
| `/guild create <name>` | — | Creates a sub-guild inside your faction | In a faction, not already in a guild, **not** the faction leader |
| `/guild delete` | — | Disbands your guild | **Guild leader.** Not the base guild; blocked if bankrupt / balance > 0 / active loans |
| `/guild invite <player>` | — | Invites a player | **Guild leader.** Base guild uses `/faction invite`; outsiders blocked under Closed Borders |
| `/guild join <name>` | — | Joins a guild you were invited to | Cannot already be a guild leader |
| `/guild leave` | — | Leaves your guild | Leader must `delete` instead |
| `/guild setleader <player>` | — | Hands the guild to another member | **Guild leader** |
| `/guild rename <name>` | — | Renames the guild | **Guild leader** |
| `/guild setcapital` | — | Sets the guild trade capital to the current province | **Guild leader** |
| `/guild setbanner` | — | Sets the guild banner from your held banner | **Guild leader.** Not the base guild |
| `/guild setbank` | — | Sets/moves the guild bank chunk | **Guild or faction leader** |
| `/guild deposit <amount>` | — | Deposits into the guild bank | Any guild member, in the guild bank chunk |
| `/guild withdraw <amount>` | — | Withdraws from the guild bank | **Guild leader**, in the guild bank chunk |
| `/ledger` | — | Opens your daily cashflow ledger | Players only |
| `/war list` | — | Lists active wars | Any player — the **only** non-admin `/war` branch |
| `/battle list` | — | Lists battles | Any player |
| `/battle join <battleId>` | — | Joins a battle you are eligible for | Any player |
| `/raid join` | — | Joins a campaign raid during its 60 s muster | Any player |
| `/warband create <name>` | — | Creates a warband | Any player |
| `/warband delete` | — | Disbands your warband | **Warband leader** |
| `/warband invite <player>` | — | Invites to the warband | **Warband leader** |
| `/warband kick <player>` | — | Removes a member | **Warband leader** |
| `/warband setleader <player>` | — | Transfers warband leadership | **Warband leader** |
| `/warband toggleopen` | — | Toggles open / invite-only joining | **Warband leader** |
| `/warband list` | — | Lists warbands | Any player |
| `/warband leave` | — | Leaves your warband | Any member |
| `/warband retreat` | — | Retreats the warband from a live battle | **Warband leader.** Only after 1200 s elapsed |
| `/company found <name>` | — | Buys a mercenary company charter | Must be in a guild |
| `/company invite <player>` | — | Offers a company slot | **Company leader** |
| `/company accept` / `/company decline` | — | Signs on to / turns down a company | Must have an offer |
| `/company kick <player>` | — | Dismisses a mercenary | **Company leader** |
| `/company expand` | — | Queues another company slot | **Company leader.** Not while an unfilled slot exists |
| `/company draft` | — | Writes a contract book you fill in and sign | **Company leader** |
| `/company offer <faction>` | — | Sends the reviewed contract book to a faction | **Company leader.** Must hold the reviewed book |
| `/company contracts` | — | Opens the contract ledger | Any company member |
| `/mercenaries` | — | Opens the mercenary market GUI | Any player |
| `/mercenaries list` | — | Same list in chat, best reputation first | Any player |
| `/mercenaries hire <company>` | — | Checks whether you may sign a company here | Faction leader in practice |

**Admin/staff commands excluded** — all gated by `simplefactions.admin` (`default: false`):

`/faction dummify`, `dummyLeader`, `forcedelete`, `forcejoin`, `forceleader`, `forcewithdraw`, `forceconstruct`, `forceregiment`, `addprestigemodifier`, `addwealthmodifier`, `refresh`, `delbank`, `startelection`, `endelection`, `getglobalwealth`, `queueallnations`, `fullregen` (requires the literal passcode `i_love_tfmc`), `reloadtitles`, `reloadconfigs`, `destroytitle`, `granttitle`, `usurp`, `transfersubject`, `setrelation`, `settreaty`, `setpower`, `setlaw`, `setstance`, `provincecap`; the `/battle create|edit|delete|addside|addpoint|setlives|setspawn|setjail|...` tree; the entire `/war admin` tree; the entire `/movement admin` tree; `/company admin give|take`.

> **Note:** SimpleFactions' `plugin.yml` declares **no permissions at all** and no `permission:` key on any of its ten commands. Every command is therefore reachable by any player at the Bukkit level; gating is entirely **in-code**, by faction/guild/warband rank and by `Permissions.isAdmin`.

### Numbers that matter to players

All paths under `C:\Users\MSI\Desktop\plugins\SimpleFactions\`.

**Factions and land — `config.yml`**
`max-members: 64` · `max-untitled-provinces: 5` (a 6th forces you to form a county) · `max-free-titles: 3` · **`province-cost: 50` denars** · `de-jure-requirement: 75.0%` · `max-prestige-from-wealth: 800` · `max-prestige-playtime-exponent: 5` (a member is worth at most 32 prestige, reached at ~500 h online; needs RPCharacters) · `settlement-large-population-threshold: 8` · `port-sea-proximity-blocks: 20` · `starting-year: "372 AE"`.
Terrain trade-carry modifiers: FARMLAND 0.95 · PLAINS 0.85 · WATER 0.75 · FOREST 0.6 · SEA 0.6 · DRYLANDS 0.6 · HIGHLANDS 0.55 · HILLS 0.5 · JUNGLE 0.45 · BOG 0.4 · MOUNTAIN 0.3.

**Tier thresholds — `tiers.yml`**
Province 10 prestige · County 100 prestige, form-cost 5 · Duchy 400, cost 4 · Kingdom 1000, cost 4 · Empire 2500, cost 3.

**Faction ranks — `ranks.yml`**
Obscure 0 prestige / 0% of highest · Influential 200 / 40% · Powerful 500 / 55% · Glorious 600 / 75% · Legendary 3000 / 85%. De-jure requirement falls 90% → 60% as you climb; Legendary adds +5 node speed and +10% diplomatic capacity.

**Diplomatic capacity cost per relation — `diplomacy.yml`**
integrated_subject 0.5 · tributary 0.3 · subject 1 · unequal_treaty_leader 1 · nap 1 · trade_agreement 1.5 · mercantile 1.5 · embargo 2 · march 2 · palatinate 2 · ally 3.5 · friendly attitude 0.25. Opinion thresholds: **war at −50, ally at +50**.

**Guild and branch upgrades**
`branch-upgrade-cost: 100.0`, `branch-upgrade-exponent: 1.07` (each level costs 7% more). Realm/guild upgrades: `expansion-time: 21600` s = **6 h** each. Mercenary company upgrades: upkeep 10/day per level, **24 h** each, max level 10, +0.5 health / +1 max mana / +0.1 mana regen per level.

**Mercenaries — `config.yml`**
Charter 100.0 one-off · founding time **86400 s (24 real hours)**, arrives with 1 slot · slot upkeep **8.0 denars/slot/day whether filled or not** · contract floors min 50.0 per battle and min 10.0 per day (a battle day costs both) · **max contract length 14 days** · default breach refund 500.0.

**Regiments — `regiments.yml`**
Professional Army: upkeep 6.0/day, expansion 12 h · Militia: 6 default slots, upkeep 2.0/day, expansion 6 h · Levies: upkeep 0, supplied by vassals.

**Installations — `installations.yml`**
Fort: radius 80, 50 upkeep/day, **5-day build**, 8 static-emplacement + 2 land-vehicle slots.
Port: radius 80, 20/day, **3-day build**, 8 ship slots.
Airport: radius 80, 35/day, **3-day build**, 10 aircraft slots.
`consent-proximity-blocks: 20` · `transfer-request-timeout-seconds: 60`.

**Vehicles — `vehicles.yml`**
`personal-slot-limit: 3` · defaults: upkeep 4/day, 1 person.
Ships: gunboat 3 · sloop 8 · torpedoboat 14 · ironclad 20 · cruiser 40 (size 2).
Aircraft: monoplane 8 · biplane 12 · bomber 20 (size 2) · cloudskimmer 20 · gyrobomber 32 (size 2) · behemoth 50 (size 4).
Land: wooden_cart 1 · horse_cart 5 · small_car 8. Emplacements: aa_turret 3 · field_artillery 4 · fixed_artillery 12 · anti_air 12.
Trains ignore the installation slot limit.

**Battles — `config.yml`**
Province leave countdown 10 s · capture needs at least 1 player · item durability loss ×0.2 · **retreat locked for the first 1200 s (20 min)** · signup reminders at 1800/600/300/60 s before · siege contest 180 s.

**War timing — `war.yml`** (hours are Europe/Paris)
Battle vote closes **16:00** · raid window **19:00–20:00** · main battle window **21:00–24:00** · defender must choose by **12:00** · **one battle per day**, first battle the day after declaring.
Voting: min 4 players, smallest side must be full; passes if either condition holds.
**4 battles max per campaign leg** for every goal except PILLAGE (1).
PILLAGE: range 3 provinces, 10 loot days, −100% trade for 10 days.
Reparations: **25% of income for 10 days** · declined-ally stability penalty −30.
`declare_opinion_threshold: -50` · `initiative_factor: 1.5` · 3 provinces between battles, first battle at the border.
Lives: 5 per regiment, minimum 1 per side; field template default **25 collective lives**.
Campaign raid: 60 s muster (reminders at 45/30/15/10 s), 600 s duration, **48 h repair lock**, intruder damage 4 every 10 ticks.
The declare-code check times out after 10 s and **fails closed**.

**Taxes and laws — `laws.yml`**
Citizen tax brackets: none 0 · low 5–10% · medium 10–25% · high 25–60%. Law adoption costs 10/15/20/30 admin power with upkeep 0/2/4/6. Same pattern for `vassal_tax` and `guild_tax`. Closed Borders cost 15 (+5% admin power multiplier); Open Borders cost 20, upkeep 4, +2.5% production for domestic guilds.

**Fertility — `fertility-crops.yml`**
Highest vanilla requirement WHEAT **0.90**; TORCHFLOWER / BEETROOTS 0.80; lowest NETHER_WART 0.15, SWEET_BERRY_BUSH 0.25. CustomCrops: rice 0.85 · corn 0.80 · vanilla/tomato 0.75 · down to cactusfruit 0.12.

**Dividends — `config.yml`**
`dividend-require-previous-tick-membership: true` — you only get a share if you were in the guild at the previous daily tick. The percentage is set per-guild by its leader and **starts at 0%**.

### Cross-links

- **DenarEconomy** (hard depend) — all banks, upkeep, loans, dividends and mercenary wages are denars. Vehicle maintenance is charged to the player **pouch**, not the bank.
- **TLibs** (hard depend) — hex formatting and the item-reference syntax used throughout configs (`v.diamond`, `ia.namespace:id`, `m.type.id`, `iaf(...)`).
- **TFMCWeb / TFMCWeb web map** (softdepend) — `api.GatewayClient` reflectively calls `net.tfminecraft.tfmcweb.api.ProvinceSystemGateway`. Startup warns: *"enable-map is true but TFMCWeb is not loaded. Map upload, province lookup, and regen require TFMCWeb + api.base-url / api.plugin-key."* Backend at `http://127.0.0.1:8000`, realm `main`, matching `map-reference: main`. Exports land in `MapAPI/`. The war-declare code gate also calls TFMCWeb.
- **VehicleFramework + VFBuilders** (softdepends) — startup logs *"VehicleFramework vehicle integration enabled"* and *"VFBuilders vehicle integration enabled"*. The whole `vehicles/` package wraps VF vehicles.
- **MMOCore / MythicLib / MMOItems** (softdepends) — `GuildModifier` exposes `MAX_HEALTH`, `MAX_MANA`, `MANA_REGEN`, which mercenary company upgrades apply; mana is an MMOCore stat.
- **RPCharacters** (softdepend) — the per-member playtime prestige term "Needs RPCharacters; without it the term is 0." Also a mercenary-eligibility trait probe.
- **CustomCrops** (softdepend) — `CustomCropsFertilityBridge` gates CustomCrops growth on province fertility.
- **ItemsAdder** — the faction bank block is `iaf(tfmc:bank)`.
- **ExcellentCrates** — `war.yml` battle loot dispatches `crates key give %player% battle_key 1`.
- **ConditionalEvents** (softdepend).
- **TFMCCore** — reads SimpleFactions outcomes for the stats DB (`factionsstats.yml` defines `battles_joined`; `vehiclestats.yml` maps VF vehicle types to `ships_sunk` / `planes_crashed`).
- **LuckPerms** — grants `simplefactions.admin`.
- **DecentHolograms** — parliament-session holograms.
- **dynmap / BlueMap / squaremap — NOT installed.** No such jars or folders exist. Map rendering is entirely the custom TFMCWeb/TFMCWeb pipeline.

### Uncertain / unverified

- **The GitHub repo does not match the deployed build** (see source warning). Reading was limited to bytecode string constants and method signatures; exact control flow, message wording for un-dumped classes, and the precise semantics of some checks are inferred.
- **Rank requirements beyond "leader" are not fully verified.** The code consistently checks leader equality. Councils, elected officials and delegated permissions plainly exist, but whether a councillor can run any leader-gated command was not confirmed.
- `/faction installation` appears in tab completion and dispatch but its exact argument form was not recovered.
- Two `isAdmin` checks between `forcewithdraw` and `startelection` could not be attributed to a string constant; most likely `refresh` and `delbank`, unconfirmed.
- `trade-agreements.yml` exists inside the jar but is **0 bytes** and absent from the live config folder. Trade-agreement definitions actually live in `diplomacy.yml`.
- `docs/mercenaries.md` is referenced by `config.yml` and `regiments.yml` comments but is not shipped, so the "full reference" for mercenary rules could not be read.
- Bare `/faction` vs `/faction menu` — could not confirm whether bare `/faction` opens the GUI or prints usage. The usage error is `Error with command format, use the gameplay guide for a list of commands`, implying an external gameplay guide we did not have.
- The third numeric field in `Input/provinces.txt` (e.g. `78`) is almost certainly province fertility given the 0–1 thresholds in `fertility-crops.yml`, but the parser's interpretation was not confirmed.
- **Goal enum mismatch.** `enums/Goal` in the jar lists `ANNEX, SUBJUGATE, REVOLT, TRIBUTARY, INDEPENDENCE, WAR_REPARATIONS, TRANSFER_SUBJECT, USURP`, which does **not** match the goal keys in `war.yml`. There is likely a second, newer goal enum under `War/` that was not located. **Treat `war.yml` as authoritative for what players can pick.**
- `battle.province_block_protection_enabled: false` and `war.devmode.phantom_count: 10` suggest features disabled or in testing; their player-visible effect is unverified.
- Live `Data/` holds only four test factions and `Cache/logins.json` is dominated by `dummy*` accounts — staging state (see caveat 2).

---
## TFMCCore

`TFMCCore.jar` · author Drefvelin · `depend: [TLibs]` · `softdepend: [VehicleFramework, RPCharacters, AdvancedCrafting, MythicLib, MMOCore, SimpleFactions]`

### What it is

TFMCCore is the server's in-house "glue" plugin: it disables a long list of vanilla Minecraft behaviours (brewing, enchanting, most vanilla crafting), adds custom block-break drops, opens custom crafting-station GUIs from ordinary blocks, and bundles several small RP features — sealed letters, lore/name stones, an animal whistle, a per-character "Focus" pool, and a stats database.

> **Are Letters / lorestones / whistle / focus / stations / stats separate plugins? No.** All six are packages inside the single TFMCCore jar (`net.tfminecraft.tfmccore.letters`, `.stones`, `.whistle`, `.focus`, `.manager.StationManager`, `.stats`), registered by `TFMCCore.java`, each with its own config file in the TFMCCore folder. There is no `Letters.jar` or `lorestones.jar` in the plugins directory.

### How a player actually uses it

- **Custom drops.** Hold the right custom tool (e.g. `m.tools.iron_alchemy_collector`) and break a matching block; vanilla drops are suppressed and the configured custom item rolls instead (`manager\DropManager.java`, table in `TFMCCore\drops.yml`). The drop is granted **5 ticks** after the break, and only if the block actually changed.
- **Crafting stations.** Walk up to a configured block and right-click (or shift-right-click, per block) — e.g. shift-right-click a crafting table for `tool-station`, right-click a brewing stand for `alchemy-station`. TFMCCore then runs `mi stations open <station> <player>` from console, so the player sees an MMOItems station GUI (`manager\StationManager.java`, `TFMCCore\stations.yml`).
- **Letters.** Hold the custom writable-book item (`m.books.letter`), write, and click "Sign". The vanilla written book is cancelled and replaced by a **sealed letter** (`m.books.written_letter`) with "You have successfully signed your letter!". Anyone right-clicking that sealed letter reads it and it becomes `m.books.written_letter_open` ("The seal breaks as you open the letter..."). **Right-clicking while targeting a lectern or chiselled bookshelf does not break the seal** (`letters\LetterListener.java`).
- **Lore / name stones.** Pick up a `lorestone` or `namestone` on the cursor in your own inventory and click it onto a single (unstacked) item. A chat prompt appears; type the text within **60 seconds**, or type `cancel`. The line is added to lore (namestone renames instead) and the stone is consumed; **every failure path refunds the stone** (`stones\StoneListener.java`).
- **Animal whistle.** Right-click while holding `m.pets.animal_whistle`. A goat-horn sound plays and every horse/donkey/mule/llama/trader llama within **64 blocks glows for 5 seconds**; you get "Highlighted X animals nearby."
- **Focus.** Invisible to commands for normal players — it attaches to your active RPCharacters character on character activation and regenerates over time; it is spent by the Research and Magic plugins.
- **Stats.** Type `/core stats <category>` (aliases `/tfmc stats ...`) to see your own totals for `rpcharacters`, `advancedcrafting`, `skills`, `vehicles` or `factions`.

### Content it adds

- **Rule enforcement:** no bone meal on crops, no brewing stands, enchanting tables blocked, blocking with a shield does not reduce damage (damage is re-applied), no shooting bows while mounted, **~90 vanilla recipes blocked**, 4 consumables blocked (milk bucket, both golden apples, suspicious stew), copper golem statue scraping prevented, and a Weakness effect applied on every armour equip.
- **67 custom block-drop rules** producing herbs, gemstones, ingredients, materials and research items (`drops.yml`).
- **15 crafting stations:** tool, ingot, forester, alchemy, block, instrument, research, copper, medicine, engineer, meal-prep, fishing, animal, archeology (`stations.yml`).
- **Letters/mail items** (writable letter → sealed letter → opened letter), with the author line hidden and the book title used as the item name.
- **Lorestone / namestone** consumables with a chat-prompt flow (no GUI).
- **Animal whistle** pet-finder item.
- **Focus:** a per-character mental-point pool stored as JSON per character id (`data\focus\<characterId>.json`, fields `characterId, ownerUuid, points, lastRegenMs`).
- **Stats:** a SQLite table `stat_totals(player_uuid, category, stat_key, value)` in `TFMCCore\stats.db`, fed by events from other plugins. Live data includes `rpcharacters/messages_rp`, `messages_ooc`, `characters_created`, `class_*`, `race_*`; `advancedcrafting/hits_hit`, `hits_etch`, `items_crafted*`; `skills/skill_*`; `factions/battles_joined`. Output is a **chat list, not a ranked leaderboard**.

### Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/core stats <category>` | `/tfmc stats <category>` | Prints your own totals for that stat category in chat | Categories: `rpcharacters`, `advancedcrafting`, `skills`, `vehicles`, `factions` (only those whose source plugin is loaded). **No permission check for self-lookup.** Server totals are appended only with `tfmccore.admin` |
| `/core` (no args) | `/tfmc` | Shows usage; a normal player only sees the `stats` line | |
| *(no command)* Lorestone / namestone use | — | Applying stones is gated by `tfmccore.stones.use`, **`default: true`**, so every player has it | Declared in `plugin.yml` |

Everything else in TFMCCore — letters, whistle, stations, drops, focus regen — is item/block interaction with **no permission node at all**, available to all players.

**Admin/staff commands excluded:**
- `/core stats <category> <player>` — `tfmccore.admin` (`default: op`)
- `/core reload [all|config|drops|stations|stats|focus|whistle|letters|lorestones]` — `tfmccore.reload` or `tfmccore.admin` (both `default: op`)
- `/core focus restore <player>` — `tfmccore.admin`
- `/core stones give <lorestone|namestone> [player] [amount]` — `tfmccore.admin`
- Server-wide stat totals display — `tfmccore.admin`

### Numbers that matter to players

- **Armour-equip Weakness: 7 seconds, amplifier 2 (Weakness III)** — `armour-time: 7` in `TFMCCore\config.yml`, applied as `armourTime*20` ticks in `manager\CoreManager.java`.
- **Focus:** cap **150**, base regen **10 per hour**, regen tick every 72000 ticks (**1 real hour**), offline regen **on** — `TFMCCore\focus.yml`. MMOCore bonuses: **+0.5/hr per wisdom, +0.25/hr per intelligence**.
- **Whistle:** detection radius **64 blocks**, glow **5 seconds**, cooldown **3 seconds** per player — `TFMCCore\animal-whistle-config.yml`.
- **Lorestones:** chat prompt timeout **60 s**, max **100 raw characters** per line (colour codes count), max **10 lore lines** per item, stacked items rejected, `v.bedrock` blacklisted — `TFMCCore\lorestones-config.yml`.
- **Drop chances:** per-entry decimals, mostly **0.12 (12%)** for the herb collectors — `TFMCCore\drops.yml`.
- **Drop resolution delay:** 5 ticks after break.
- **No leaderboard size** — `/core stats` prints all keys in a category sorted alphabetically by label, with no top-N cut.
- `/core stones give` amount is clamped to 1–64 (admin only).

### Cross-links

- **TLibs** (hard depend) — every item/block path check (`TLibs.getItemAPI()...checkItemWithPath`, `TLibs.getBlockAPI()`), the `ArmorEquipEvent`, and tab-completion helpers.
- **MMOItems** — stations are opened by dispatching `mi stations open <id> <player>`; all `m.*` item paths (`m.books.letter`, `m.consumable.lorestone`, `m.pets.animal_whistle`, `m.tools.*_alchemy_collector`) are MMOItems types resolved via TLibs.
- **ItemsAdder** — six stations bind to ItemsAdder blocks `iaf(tfmc:medicine_station)`, `tfmc:ammunition_station`, `meal_prep_station`, `fishing_station`, `animal_station`, `archeology_station` (`stations.yml`).
- **RPCharacters** (softdepend) — Focus is keyed to `RPCharacter.getId()` and driven by `CharacterActivatedEvent`; the `rpcharacters` stat category listens to `CharacterCreatedEvent`, `CharacterClassChangeEvent`, `CharacterRaceChangeEvent`, `CharacterPermakillEvent`, `CharacterChatEvent`.
- **MMOCore / MythicLib** (softdepend) — Focus regen bonuses read MMOCore attributes `wisdom` and `intelligence`.
- **AdvancedCrafting** (softdepend) — stat category listens to `AlloyDiscoveredEvent`, `AlloyCraftedEvent`, `ItemCraftedEvent`, `SmithingHitEvent`.
- **SimpleFactions** (softdepend) — `factions/battles_joined` comes from `BattleEndedEvent`.
- **VehicleFramework** (softdepend) — `vehicles` stats come from `VehicleRemoveEvent`, mapped through `vehiclestats.yml` groups (`plane`, `ship`) to `planes_crashed` / `ships_crashed` / `ships_sunk`.
- **Magic / Research plugins** — `focus.yml` header states Focus is "Consumed by Research experiments and Magic meditation"; both `research-1.0.0.jar` and `magic-0.1.0.jar` are installed. `FocusStore.tryMigrateFromResearch` migrates old Research-owned focus data.
- **Skills** — the `skills` category listens to `SkillCastEvent`; live DB rows show MythicMobs/MMOCore-style skill ids.
- **No LuckPerms, BirdMessenger, or web-map integration was found in TFMCCore.**

### Uncertain / unverified

- Which plugin owns the `mi` command was inferred (MMOItems); not verified by reading the MMOItems jar.
- The `skills` stat source plugin is inferred from the event name `SkillCastEvent`; the owning plugin was not identified.
- `vehiclestats.yml` still contains the shipped example values (`example_plane`, `ironclad`), so vehicle stats may be **effectively inert** on this box.
- `advancedcraftingstats.yml`, `rpcharactersstats.yml`, `skillsstats.yml` are the default shipped label files (e.g. only `warrior`/`human` labelled), while the DB already holds `class_mage`, `race_elf`, etc.; those unlabelled keys fall back to auto-formatted names.
- Focus point **spending**, the Research/Magic call sites, and the `ItemScanHandler` consumers are outside TFMCCore's source and were not verified.
- Whether standalone `Letters` / `lorestones` repos still exist elsewhere under the JustinasLa account was not checked; on this server they exist only as TFMCCore packages.

---

## TFMCWeb

`tfmcweb-1.0-SNAPSHOT.jar` · author TFMC · `depend: [TLibs]` · `softdepend: [RPCharacters, Essentials]`

### What it is

TFMCWeb is the bridge between the Minecraft server and the TFMCWeb website / Discord bot: it lets players link their Discord account, mint one-time codes they redeem on the website (skins, drinks, profile), and pushes each player's rank entitlements to the site on join.

### How a player actually uses it

1. Type `/linkdiscord` in game. The plugin asks the website API for a code and prints a **click-to-copy** code in chat, plus "In Discord, run `/linkdiscord <code>` with that code" and a relative expiry line.
2. Run `/linkdiscord <code>` in the Discord server. Within **~1 second** the in-game plugin picks up the `link_success` notice and chats "Discord linked successfully with `<discord name>`", and the Survival Discord gate is lifted through RPCharacters.
3. Type `/token create profile` to get a profile code; redeem it on the website `/profile` page. The session lasts **8 hours**.
4. Type `/token create skin` or `/token create drink` to get a cosmetic upload code; redeem on the skins website or the website `/drinks` page. **Both draw from one shared mint cooldown**, so using one blocks the other. The plugin replies "Token cooldown: try again in 3d 4h" if you are still waiting.
5. `/unlinkdiscord` removes the link and **re-applies the Survival gate**.
6. On every join the plugin silently pushes your rank tier, name-colour stops, max alive characters, wardrobe skin slots, allowed skin kinds and drink permissions to the website, so what you can do on the site matches your in-game rank.
7. **What shows up on the website:** your profile, your uploaded skins and custom drinks, your linked Discord identity, and staff-issued warnings. Warnings issued in game with `/warning` appear in chat, are stored on the site, and are DM'd to you on Discord if you are linked. Bird-mail arrival notices from BirdMessenger are forwarded to your Discord DMs.

### Content it adds

- **No items, no blocks, no GUIs.** Content is chat output: clickable copyable codes, relative-expiry lines, and a `[Warning] <reason>` chat line.
- Discord account link/unlink, with a grace window when you leave the Discord guild.
- A Survival **"Discord gate"** enforced through RPCharacters — a non-linked Survival player is gated (the gate behaviour itself lives in RPCharacters).
- Scoped one-time website codes: `skin`, `drink`, `profile`, `skin staff`.
- Rank entitlement push (`rpc_player_meta`) covering RPCharacters, ArmourShop/skins and DrinkBuilder tiers, plus boolean permission snapshots.
- Ban mirroring via an EssentialsX listener.
- Bird-mail → Discord DM forwarding.
- **No stats, no leaderboards, no letters, no lorestones, no crafting stations** — those are all TFMCCore.

### Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/linkdiscord` | none | Requests a Discord link code and prints it click-to-copy; if already linked, reports the linked Discord username | `tfmcweb.linkdiscord`, **`default: true`**. Players only |
| `/unlinkdiscord` | none | Removes the Discord link and re-applies the Survival gate | Same permission, **`default: true`**. Players only |
| `/token` (no args) | none | Prints usage for whichever token actions you have | The `token` command has **no `permission:` entry in plugin.yml**, so any player can run it; subcommands are individually gated |
| `/token create <skin\|drink\|profile>` | none | Mints a one-time website code for that scope | Requires `tfmcweb.token.create`, **`default: false`** — a **rank perk, not a base-player command**. Only scopes in `tokens.enabled-scopes` are offered |

**Admin/staff and rank-gated commands excluded:**
- `/token create skin staff` — `tfmcweb.token.create.staff` (`default: false`)
- `/token resetcooldowns <player>` — `tfmcweb.token.resetcooldowns` (`default: op`)
- `/warning <player> <reason>` — `tfmcweb.warning` (`default: false`)
- `/web status|reload|lookup|unlink|reconcile|syncmeta` — `tfmcweb.admin` (`default: op`). Note `syncmeta` is implemented but absent from the plugin.yml usage string.

### Numbers that matter to players

- **Notice poll interval: 1 second** — this is how fast a Discord link appears in game (`managers\PluginNoticePoller.java`).
- **Shared skin+drink mint cooldown by rank** (`TFMCWeb\config.yml`, `token-cooldowns`): default **−1 = cannot mint**; `rpchar.group.noble` **28 days**, `gilded` **21 days**, `ascended` **14 days**, `legacy` **7 days**. Highest matching permission wins. Remaining time is displayed rounded to `Xd Yh`, minimum "1h".
- **Website code session: 8 hours.**
- **RPCharacters entitlements** (`player-meta.rpc`): max alive characters **3** default → noble 3, gilded **4**, ascended/legacy **5**; wardrobe skin slots **1** default → gilded 2, ascended/legacy 3; name-colour stops **0** default → noble 1, gilded 2, ascended/legacy **20**.
- **Skin entitlements** (`player-meta.skins`): max 3D pair size **30720 bytes (30 KB)**; skin kinds unlocked by tier — noble: handheld / large_handheld / bow / large_bow / crossbow / book; gilded: armor_set; ascended: item_3d / shield / helmet_3d / gun. `allow-armor-3d-helmet` from ascended up.
- **Drink entitlements** (`player-meta.drinks`): drink textures from gilded up; custom drink messages from ascended up; name-colour stops 0/1/2/8/8 by tier.
- **Enabled token scopes on this box:** `skin, drink, profile, skin_staff`; realm id `main`. Config comments note lobby is `[profile]` only and tutorial is `[]`.

### Cross-links

- **RPCharacters** (softdepend) — the Discord gate is applied by reflecting `RPCharacters.setDiscordGate(UUID|Player, boolean)`; `player-meta.rpc` pushes character limits and colour stops. Config comments state other plugins soft-depend TFMCWeb and call `TFMCWeb.getRealmId()` rather than duplicating `realm.id`.
- **EssentialsX** (softdepend) — `listeners\EssentialsBanListener.java` mirrors bans to the website.
- **BirdMessenger** — `mail\BirdMailGateway.java` is the documented "Entry point for BirdMessenger (reflective)" and posts `bird_mail` arrivals to the site/Discord.
- **LuckPerms** — used implicitly: all entitlement tiers and cooldowns resolve from LP nodes `rpchar.group.noble|gilded|ascended|legacy`, and `player-meta.sync-permissions` snapshots the boolean nodes `rulequiz.completed` and `tfmc.map.staff` to the website.
- **Web map** — the `tfmc.map.staff` permission is pushed as a boolean flag, implying a staff layer on the web map; no map plugin is called directly.
- **SimpleFactions** — calls TFMCWeb's `ProvinceSystemGateway` for map upload, province lookup and the war-declare code gate.
- **ArmourShop / DrinkBuilder** — config comments point at their `permission-groups.yml` files as the in-game owners of the same ladders; both jars are installed. TFMCWeb only posts values.
- **TLibs** (hard depend).
- **TFMCWeb website API** — `http://127.0.0.1:8000` with a plugin key (`TFMCWeb\config.yml`).
- **No link to TFMCCore's stats, focus, letters or stations was found in either codebase.**

### Uncertain / unverified

- What the Survival "Discord gate" actually blocks is implemented in RPCharacters and was not read.
- The grace-period length after leaving the Discord guild is set server-side by TFMCWeb (`graceUntil` arrives in the notice payload) — not configurable in `config.yml`.
- Code/token expiry times are server-side; the plugin only formats whatever `expiresAt` the API returns.
- The live `TFMCWeb\config.yml` contains a real-looking `plugin-key`; whether it is production was not determined (the file's own comment says not to commit real secrets).
- `/web syncmeta` exists in code but not in plugin.yml usage; whether it is intended to be public is undetermined.
- Website page layout (what a player literally sees) is inferred only from chat strings referencing `/profile`, `/drinks` and "the skins website"; the TFMCWeb frontend was not inspected.

---
## BirdMessenger

`birdmessenger-1.0-SNAPSHOT.jar` · author MrEnzo99 · `depend: [TLibs]` · `loadbefore: [ItemsAdder]` · `softdepend: [RPCharacters, TFMCWeb, ItemsAdder]`

### What it is

A player-to-player letter mail system: you write a Letter book, hand it to a bird coop, pick which roleplay character to send it to, and a bird physically "flies" it there over real time.

### How a player actually uses it

1. Obtain and write an ItemsAdder Letter (`iasurvival:letter`, a `WRITABLE_BOOK`; display name "Letter", written state "Sealed Letter", read state "Opened Letter" — `ItemsAdder\contents\iasurvival\configs\various\items\books.yml` lines 4-22, names at `..\_dictionaries\en.yml` lines 205-207).
2. **Right-click a bird-coop block** — configured as `coop: v(lodestone)`, a vanilla lodestone (`BirdMessenger\config.yml`). Non-sneaking, main-hand right-click only; sneak-right-click is ignored. The block's normal interaction is cancelled.
3. A **9-slot "Bird Messenger" GUI** opens with one open slot (slot 4) surrounded by gray panes. Place or shift-click a Letter into it; anything else is rejected with "Only letters can be sent by bird." Shift-clicking plays a parrot-fly sound and auto-closes the GUI.
4. On close with a valid letter, a **54-slot "Send letter" character picker** opens: up to **45 player-head icons per page** (heads pulled from RPCharacters), Previous (slot 45), Cancel (49), Confirm (50), Next (53). **Your own characters are filtered out.**
5. Click a head (it gains a "Selected" lore line and a hidden enchant glint), then Confirm. Without a selection you get "Select a character first."
6. On confirm the letter leaves your inventory, you hear a parrot ambient sound and get "The bird has left with your letter." **Closing the picker without confirming returns the letter.**
7. When the flight timer expires: if the recipient is online **and currently playing that exact character**, they receive the letter item and "A bird lands at your feet with a letter for {character}."; the sender gets "Your letter was delivered!" Otherwise the letter moves to a pending queue keyed by character ID, and the sender is told "Your letter is waiting until they play that character." or "...until they log in." A Discord DM is queued via TFMCWeb.
8. Pending letters are handed over **the moment that character is activated, or on login**.

### Content it adds

- Two GUIs: "Bird Messenger" (letter drop box) and "Send letter" (paged character picker, 45/page).
- A coop interaction on lodestone blocks.
- Chat feedback lines only — no chat channel. All templates in `BirdMessenger\config.yml` under `messages:`.
- Mail mechanics: an in-flight queue (`in_flight_mail.yml`, **empty at snapshot** — nothing in the air) and a per-character pending queue (`pending_mail.yml`, currently holding **1** undelivered written book titled "test" by author `drefvelin`, addressed to a character displayed as the gradient name "Avalon Falstad"). **In-flight letters are rescheduled on server restart.**
- Sounds: `ENTITY_PARROT_FLY` on pickup/delivery, `ENTITY_PARROT_AMBIENT` on send, `UI_BUTTON_CLICK` on picker selection.
- Optional Discord DM notification through TFMCWeb.

### Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | **BirdMessenger exposes no player command.** The entire flow is block-interaction + GUI driven | `plugin.yml` declares exactly one command, and it is op-gated |

**Admin/staff commands excluded:**
- `/birdmessenger reload` — `birdmessenger.reload`, `default: op`.

### Numbers that matter to players

All from `C:\Users\MSI\Desktop\plugins\BirdMessenger\config.yml`:

- **Bird speed:** `seconds-per-block: 0.25` → **4 blocks per second** of flight.
- **Minimum flight: `min-seconds: 30`** — applies even at 0 distance (e.g. recipient has no stored last location).
- **Maximum flight: `max-seconds: 600` (10 minutes).**
- **Formula:** `round(distance × 0.25)` clamped to `[30, 600]` seconds, distance measured from the sender's current location to the recipient character's **stored last location**.
- **Practical cap:** any distance ≥ **2400 blocks** takes the same 10 minutes; ≤ **120 blocks** takes the 30-second floor.
- **Cross-world delivery is impossible** — different worlds return null and the letter bounces with "The bird cannot reach them from here."
- **Cost: none.** No economy hook exists in the source.
- **Mail expiry: none.** Pending letters are stored indefinitely until the target character is played.
- `delivery-delay-ticks: 22000` is explicitly marked **legacy** in the config and is **not** used for timing.

### Cross-links

- **TLibs** (hard depend) — provides the block checker (`v(lodestone)`) and item checker (`ia.iasurvival:letter`) path syntax.
- **ItemsAdder** (`loadbefore` + softdepend) — supplies the Letter item and its written/open model states.
- **RPCharacters** (softdepend) — supplies the character list, character skull textures, per-character last-known location (**which sets flight time**), and the "active character" check that gates delivery. Without it: "Character mail is unavailable right now."
- **TFMCWeb** (softdepend) — Discord DM bridge for arrival notifications. `discord.enabled: true`, with `include-sender: false` and `include-contents: false`, so **the DM reveals neither sender nor letter text**.
- **TFMCCore** — a *separate* letters system (sealed `m.books.letter` → `written_letter`). BirdMessenger uses the ItemsAdder `iasurvival:letter` instead. These are two different letter items; see "Conflicts" below.

### Uncertain / unverified

- The `v(...)` and `ia....` path prefixes are TLibs syntax; the call sites were read but not TLibs itself, so "lodestone = the coop block" is inferred from the prefix convention plus the `iaf(tfmc:bird_coop)` code default.
- `in_flight_mail.yml` is zero bytes, so **real observed delivery durations cannot be sampled** — the numbers above are computed from config.
- Whether a Letter must be *written* (sealed) before sending is **not enforced in code**; the checker accepts any item matching the ItemsAdder letter path.

---

## HelpCommand

Third-party plugin by Spigot author **VoidemLIVE**, config version **2.9.2**, repo `https://github.com/VoidemLIVE/Help-Command-Plugin`, docs `https://hcdocs.voidem.com/`.

> **The jar is missing from this server** (see caveat 3). The config is fully authored for TFMC, but we cannot confirm `/help` is live in-game.

### What it is

A plugin that prints a 9-page, server-authored text menu of TFMC's roleplay commands when a player types `/help`.

### How a player actually uses it

1. Type `/help` → page 1 (Chat) prints.
2. Type `/help <n>` for any page 1–9; an out-of-range or non-numeric argument prints "This page does not exist!".
3. Each page ends with a **clickable page prompt**: `[<< 4]  Page 5  [6 >>]` — clicking runs `/help 4` or `/help 6`.
4. **Named shortcuts** also work, handled by a chat-preprocess listener rather than real command registration: `/help chat`, `professions`, `factions`, `denar`, `commands`, `lockpicking`, `voting`, `movement`, `pets`. These print the page body **without** the page prompt.
5. Console cannot use it ("Only players can use this command").

### Content it adds

Purely chat output. Nine pages, all enabled (`pagesEnabled: [1..9]`), defined in `C:\Users\MSI\Desktop\plugins\HelpCommand\config.yml`:

1. **Chat** — the RP chat channel list plus a `/warp Chat` tutorial pointer and a video link (`https://tinyurl.com/4y67e3ts`).
2. **Professions** — `/profession`, `/profession reset`, `/profession top <profession>`; leveling sources for Alchemist, Smith, Forester, Miner, Agriculturist, Engineer, Fisher; `/warp Professions`.
3. **Factions** — 16 `/faction ...` subcommands (list, create, delete, invite, join, kick, rename, claim, setbank, withdraw, setbanner, setculture, setleader, setreligion, setrulertitle, setrulingsystem).
4. **Denar Commands** — `/deco bal|pay|deposit|withdraw|toitem`.
5. **General Commands** — `/rules`, `/class`, `/armourshop`, `/codex`, `/cb enable|disable`, `/pvp start|nonlethal|lethal`, `/tfmc tips enable|disable`, `/tfmc pack auto|manual`, `/tfmc masks`.
6. **Lockpicking** — lock tiers, left-click procedure, failure/breakage; `/warp Lockpicking`.
7. **Voting** — `/vote`, `/crates open`.
8. **Movement** — `/sit`, `/crawl`, `/lay`, `/bellyflop`, `/spin`.
9. **Pets** — usage rules (allowed while roaming; **banned in dungeons, mob-fight content, plugin wars, exploration maps and quests**); `/warp Pets`.

### Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/help` | — | Prints page 1 of the TFMC help menu | **No `permission:` key in plugin.yml at all** → available to everyone. Gated only by `helpcmd: true` in config |
| `/help <1-9>` | — | Prints that page, with clickable prev/next prompt | Same — no permission node |
| `/help chat` / `professions` / `factions` / `denar` / `commands` / `lockpicking` / `voting` / `movement` / `pets` | these *are* the aliases | Prints pages 1–9 respectively | Implemented via `PlayerCommandPreprocessEvent`, **no permission check whatsoever** |

**Admin/staff commands excluded:**
- `/hc` — `hc.admin` (no `default:` declared, so Bukkit's `op` fallback applies). `/hc reload` reloads the config.

### Numbers that matter to players

Verbatim from page 1 of the config:
- `/whisper` — **2 blocks** · `/rp` — **15** · `/looc` — **20** · `/shout` — **25** · `/yell` — **48**
- `/ooc`, `/trade`, `/helpop` — global (no range stated)

Page 5: `/pvp start` starts a **10 second** pvp countdown.
Pages: **9** total, all enabled.

> **`/shout` is listed as 25 here but 24 in RPCharacters' `chat.yml`.** See "Conflicts".

### Cross-links

Each page references another system:
- Page 1 → **RPCharacters** chat channels and `/warp` (**EssentialsX**).
- Page 2 → **MMOCore / RPCharacters** professions.
- Page 3 → **SimpleFactions**, including province claiming — ties to the TFMCWeb map.
- Page 4 → **DenarEconomy** / EconomyBridge (`/deco`).
- Page 5 → **Codex**, **ArmourShop**, **MMOCore** classes, and the **ConditionalEvents**-backed `/tfmc ...` and `/cb` / `/pvp` toggles — exactly the tree **AACommandsFiller** tab-completes.
- Page 6 → the lockpicking system (**thievery** / **InteractibleFurniture** locks).
- Page 7 → **VotingPlugin** + **ExcellentCrates**.
- Page 8 → **GSit** — the only page whose commands are fully covered by another section in this dossier.
- Page 9 → **MCPets**.
- `softdepend: PlaceholderAPI` — page text is run through PAPI before sending, so placeholders would resolve per-player (none currently used).

### Uncertain / unverified

- **No HelpCommand jar exists on this server** (caveat 3). We cannot confirm `/help` is live.
- The cloned upstream repo is version `2.9.3`; the on-disk config declares `2.9.2`. Command/permission shape is identical between the two `plugin.yml` copies, but minor behavioural drift is possible.
- **Pages 2, 3, 4 and 6 are server-authored text, not verified against the owning plugins' actual command sets** — they could be stale. Page 1's `/shout` range already demonstrably is.
- The alias handler computes the alias→page index from the raw message before the loop, so alias matching is effectively case-sensitive; `/HELP CHAT` may resolve to the wrong page. Not tested live.

---

## AACommandsFiller

`AACommandsFiller-2.0.jar` · author Justin · `main: net.tfminecraft.aacommandsfiller.AACommandsFiller`

### What it is

An invisible helper that registers `/tfmc` on the server and supplies its tab-completion tree, so the `/tfmc ...` commands — which are actually **executed by ConditionalEvents, not by any real command** — show up when players press Tab.

### How a player actually uses it

Players never invoke it directly and there is no in-game evidence it exists. The observable behaviour:

1. Type `/tfmc ` and press Tab → a list appears (`roll`, `tips`, `chatbubbles`, `pvp`, `pack`, `donatorname`, `booster`, `date`, `drinks`, `patreon`, `statues`, `help`, `patterns`, `masks`, `claim`, `starter`, `map`, `worldboss`, `class`, plus staff branches only if permitted).
2. Keep tabbing to walk the tree: `/tfmc roll ` → `strength`, `charisma`, `dexterity`, `constitution`, `wisdom`, `intelligence`, `<number>`; then `/tfmc roll 20 ` → `<+/-><modifier>`.
3. Typed literals are mapped back onto placeholders — typing `20` where `<number>` is defined lets completion continue to the next level.
4. Press Enter. **AACommandsFiller itself does nothing** — its command handler validates the path and permission then returns with no output. The real effect comes from ConditionalEvents `player_command` events matching `%command% equals /tfmc ...`.
5. **Commands the player lacks permission for never appear in Tab at all.**

### Content it adds

- One dynamically registered root command, `/tfmc` (`base-command: tfmc`), registered via reflection into the server `CommandMap` at startup — it is **not** in `plugin.yml`, which declares **no commands and no permissions at all**.
- No items, no GUIs, no chat formats, no listeners, no scheduled tasks.
- Placeholder tokens understood: `<number>`, `<amount>` (integers), `<+/-><modifier>` (signed integers), `<playername>`/`<player>`/`<name>`, `<reason>`/`<message>`/`<text>` (any non-empty string).
- On enable/reload/disable it calls `player.updateCommands()` for every online player so the tree refreshes live.

### Player command table

Every entry below is a tab-completion path with **no permission entry in the config's `permissions:` block**, which the plugin treats as public.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/tfmc roll <stat>` | none | Completes `strength`, `charisma`, `dexterity`, `constitution`, `wisdom`, `intelligence` | Execution handled elsewhere |
| `/tfmc roll <number> <+/-><modifier>` | none | Free-number dice roll with signed modifier | Placeholders always shown |
| `/tfmc tips enable\|disable` | none | Toggles chat tips | Public |
| `/tfmc chatbubbles enable\|disable` | none | Toggles chat bubbles (also `/cb enable\|disable`) | Public |
| `/tfmc pvp start\|nonlethal\|lethal` | none | PvP countdown / lethality toggles | Public |
| `/tfmc pack auto\|manual` | none | Resource-pack auto-apply toggle; grants/removes `tfmcresourcepack.enable` via LuckPerms | Public |
| `/tfmc donatorname`, `donatordoublename`, `donatortriplename` | none | Donator name features | **No permission in AACF config — visible to all in Tab even if the backing event gates them** |
| `/tfmc booster` | none | Booster feature | Public |
| `/tfmc date` | none | Server calendar date | Public |
| `/tfmc drinks` | none | Drinks menu | Public |
| `/tfmc patreon` | none | Patreon info | Public |
| `/tfmc statues` | none | Statues feature | Public |
| `/tfmc help` | none | Prints the `/help <topic>` argument list | Public |
| `/tfmc patterns` | none | Patterns feature | Public |
| `/tfmc masks` | none | Gives a random mask | Public |
| `/tfmc claim` | none | Daily reward claim | Public, **24 h cooldown** |
| `/tfmc starter` | none | Starter kit/info | Public |
| `/tfmc map` | none | Map feature | Public |
| `/tfmc worldboss info` | none | World boss info | Public |
| `/tfmc class reset` | none | Resets your class | Public |

**Admin/staff paths excluded** (from the `permissions:` block of `AACommandsFiller\config.yml`):
- `/tfmc ban <playername> <reason>` — `tfmc.staff`
- `/tfmc helper ...` — `tfmc.helper` OR `tfmc.admin`
- `/tfmc helper demote <playername>` — `tfmc.helper.demote`
- `/tfmc helper promote <playername>` — `tfmc.helper.promote`
- `/aacommandsfiller reload` — plugin-internal; **not declared in plugin.yml**, so whether it is reachable in-game is unverified.

### Numbers that matter to players

AACommandsFiller has **no gameplay numbers of its own** — no distances, costs, cooldowns or limits. Numbers surfaced by the commands it completes live in ConditionalEvents, e.g. `/tfmc claim` `cooldown: 86400` seconds / **24 h** (`ConditionalEvents\events\a_commands.yml`). Config tree size: **20 public top-level branches + 2 staff branches**.

### Cross-links

- **ConditionalEvents** — the actual executor. Confirmed by the plugin's own disable log line: *"AACommandsFiller is disabled! (makes conditional event commands visible in chat)"*. Matching `player_command` events live in `ConditionalEvents\events\` (`a_commands.yml`, `a_boosters.yml`, `a_helper.yml`, `a_masks.yml`, `calendar.yml`, `drinkbuilder.yml`, `map.yml`, `x_world_bosses.yml`, `y_helper.yml`). **Without AACommandsFiller these commands still work but are invisible to Tab and show as unknown commands.**
- **LuckPerms** — permission checks for filtering (`tfmc.staff`, `tfmc.helper*`), and `/tfmc pack auto` writes `tfmcresourcepack.enable` via `lp user %player% permission set`.
- **HelpCommand** — page 5 documents `/tfmc tips`, `/tfmc pack`, `/tfmc masks`, and `/tfmc help` forwards players back to `/help <topic>`.
- **PlugManX** — explicitly handled: `onDisable` unregisters the command and strips `knownCommands` so a live unload leaves no stale `/tfmc`.

### Uncertain / unverified

- The on-disk jar is `AACommandsFiller-2.0.jar` but the cloned repo README badges version 2.1 and the repo `plugin.yml` says `version: 1.0`; the running jar may differ from the source read.
- `/aacommandsfiller reload` has no `plugin.yml` entry, so it is likely unreachable in-game despite the code path existing.
- **Whether every listed `/tfmc` leaf actually has a backing ConditionalEvents handler was spot-checked, not exhaustively verified.** `starter`, `patterns`, `donatorname`/`donatordoublename`/`donatortriplename`, `roll`, `class reset` and `pvp` did **not** surface in greps of the ConditionalEvents folder, so those may be handled by another plugin (TFMCCore / RPCharacters) or may be **dead entries**.

---

## GSit

`GSit-3.2.0.jar` · third-party. Described **only** from this server's `config.yml` and the shipped jar's `plugin.yml`; upstream features not represented in this config are deliberately not described.

### What it is

A sitting-and-posing plugin that lets players sit on stairs, slabs and carpets, or drop into lying, crawling, bellyflop and spin poses for roleplay.

### How a player actually uses it

- **Sit by clicking:** right-click a stair, slab, carpet, moss carpet or snow block **with an empty main hand**. `empty-hand-only: true` and `bottom-part-only: true` mean **full/top stairs and top slabs will not work**. Distance is unlimited (`max-distance: 0.0`). You are snapped to the block centre. Click-to-sit is **on by default for everyone**.
- **Sit by command:** `/sit` (or `/gsit`).
- **Get up:** press **Sneak/Shift**. The message shows "&6<lang:key.sneak>&a to get up". **Taking damage does NOT force you up** (`get-up-damage: false`). Breaking the block you sit on does. You stand where you are, not where you started.
- **Poses:** `/lay` (on your back facing up), `/layback`, `/bellyflop`, `/spin`. **While posing you cannot interact** with blocks, items or players (`Pose.interact: false`).
- **Crawl:** `/crawl` to go prone; sneak to stand. **Double-sneak-to-crawl is disabled on this server**, so the command is the only entry point.
- **Sitting on other players is disabled on this server** (`PlayerSit.allow-sit: false`) — `/gsit playertoggle` exists but there is nothing to sit on. Sitting on NPCs remains allowed.
- **Toggles:** `/gsit toggle` turns your click-to-sit on/off; `/gsit playertoggle` and `/gcrawl toggle` are the equivalents for player-sitting and crawl double-sneak.
- **Blocked while posed:** `/skin` and `/nick` cannot be run, producing "You are not allowed to run this command right now!".

### Content it adds

- Sitting on 6 material groups; lay / lay-back / bellyflop / spin poses; crawling.
- Per-player persistent toggles stored in SQLite (`GSit\data\data.yml` → `type: "sqlite"`, backing file `data.db`).
- **Chat messages only — no items, no GUIs.** Prefix `&7[&6GSit&7]`. A custom message is shown when a player begins sitting or posing, and messages are sent in each client's own language where available (`client-lang: true`, **18 language files** present).
- **Sleep interaction:** lying down **resets the phantom timer** and **counts toward skipping the night** as long as at least one player is in a real bed. Snoring sounds are off.

### Player command table

All permissions below are declared **`default: true`** in the jar's `plugin.yml`.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/gsit` | `/sit` | Sit down where you stand | Command declares **no** `permission:` key; the action checks `GSit.Sit` (`default: true`). Click-to-sit uses `GSit.SitClick` (`default: true`) |
| `/gsit toggle` | `/sit toggle` | Enables/disables your click-to-sit | `GSit.SitToggle`. Server default is **ON** |
| `/gsit playertoggle` | `/sit playertoggle` | Enables/disables sitting on other players | `GSit.PlayerSitToggle`. **Effectively inert here** — `PlayerSit.allow-sit: false` |
| `/glay` | `/lay` | Lie on your back | `GSit.Lay` |
| `/glayback` | `/layback` | Lie back pose | `GSit.LayBack`. **Not listed on `/help 8`** |
| `/gbellyflop` | `/bellyflop` | Bellyflop pose | `GSit.Bellyflop` (permission block spells it `GSit.BellyFlop`) |
| `/gspin` | `/spin` | Spin pose | `GSit.Spin` |
| `/gcrawl` | `/crawl` | Go prone | `GSit.Crawl` |
| `/gcrawl toggle` | `/crawl toggle` | Enables/disables crawl double-sneak | `GSit.CrawlToggle`. Double-sneak is disabled server-wide anyway |

**Admin/staff commands and permissions excluded:**
- `/gsitreload` (alias `/gsitrl`) — `GSit.Reload`, `default: op`.
- `GSit.Kick.Sit`, `GSit.Kick.Pose` — `default: op` (eject others from seats/poses).
- `GSit.ByPass.Command`, `GSit.ByPass.World`, `GSit.ByPass.Region` — `default: op`.
- `GSit.Update` — `default: op`.
- Wildcard parents `GSit.*`, `GSit.Sit.*`, `GSit.PlayerSit.*`, `GSit.Pose.*`, `GSit.Crawl.*`, `GSit.Kick.*`, `GSit.ByPass.*` — all `default: op`.

### Numbers that matter to players

All from `C:\Users\MSI\Desktop\plugins\GSit\config.yml`:

- `Sit.max-distance: 0.0` — **unlimited click-to-sit reach.**
- `PlayerSit.max-distance: 0.0` and `max-stack: 0` — unlimited (moot; player-sitting off).
- `Sit.SitMaterials` — 6 entries: `#stairs`, `#slabs`, `#carpets`, `#wool_carpets`, `moss_carpet`, `snow`.
- `MaterialBlacklist` — 1 entry: `lava`.
- `CommandBlacklist` — 2 entries: `skin`, `nick`.
- `WorldBlacklist` — 1 entry: `blocked_world`; `WorldWhitelist: []` (empty, so all other worlds allow GSit).
- `FeatureFlags: []` — no experimental features active.

**Enabled on this server:** `get-up-sneak` (sit), `get-up-break`, `center-block`, `custom-message`, `client-lang`, `bottom-part-only`, `empty-hand-only` (both sit and player-sit), `Sit.default-sit-mode`, `PlayerSit.default-sit-mode`, `PlayerSit.allow-sit-npc`, `PlayerSit.sneak-ejects`, `Pose.lay-rest`, `Pose.lay-night-skip`, `Pose.lay-snoring-night-only`, `Crawl.get-up-sneak`, `Crawl.default-crawl-mode`, `check-for-update`.

**Disabled on this server:** `get-up-damage`, `get-up-return`, `allow-unsafe`, `same-block-rest`, `PlayerSit.allow-sit`, `PlayerSit.bottom-return`, `Pose.interact`, `Pose.lay-snoring-sounds`, `Crawl.double-sneak`, `trusted-region-only`, `enhanced-compatibility`.

### Cross-links

- **HelpCommand page 8 ("Movement")** lists `/sit`, `/crawl`, `/lay`, `/bellyflop`, `/spin` — GSit is the only plugin that page documents. Note it **omits `/layback`**.
- **EssentialsX** — `/skin` and `/nick` are the two commands GSit blocks while you are seated/posed.
- **NPCs** — `allow-sit-npc: true` means NPC entities can be sat on.
- **LuckPerms** — all `GSit.*` nodes are resolvable there; the `default: true` nodes need no grant, so **GSit is the one plugin in this dossier whose player commands we can state with full confidence** despite caveat 1.
- `softdepend: [GriefPrevention, PlaceholderAPI, PlotSquared, WorldGuard]`. Only **WorldGuard** and **PlaceholderAPI** are installed; `trusted-region-only` is `false`, so region-trust gating is not in use.
- **Vanilla sleep/phantom system** — lying down counts as rest and toward night-skip.

### Uncertain / unverified

- `/gsit` and `/gcrawl` carry no `permission:` key at the command level, so they appear for every player in Tab; whether the *action* succeeds is governed by `GSit.Sit` / `GSit.Crawl` (`default: true`). Inferred from the permission tree, not from Java source (no source was cloned for GSit).
- `data.db` (28 KB) was not opened — the number of players with non-default toggles is unknown.
- The `GSit.Bellyflop` vs `GSit.BellyFlop` capitalization difference appears in the shipped `plugin.yml`; Bukkit permission lookups are case-insensitive so it should be harmless, but this is unverified.

---

---

## EssentialsX

`EssentialsX-2.22.0-dev+60-787f539.jar` (`name: Essentials`) + `EssentialsXChat-2.22.0-dev+60-787f539.jar` (`name: EssentialsChat`) · upstream EssentialsX team · data folder `C:\Users\MSI\Desktop\plugins\Essentials\`

> ### ⚠ READ BEFORE PUBLISHING ANY COMMAND FROM THIS SECTION
>
> **Not one EssentialsX command permission has `default: true`.** The jar's `plugin.yml` declares 433 permission nodes; parsing every `default:` key gives **3 `true`** (`essentials.back.onteleport`, `essentials.teleport.cooldown.bypass.tpa`, `essentials.teleport.cooldown.bypass.back` — all passive behaviour flags, none a command), **22 `false`**, **2 `op`** (`essentials.*`, `essentials.gamemode.*`) and **406 with no `default:` key at all**, which under Bukkit means **op-only**.
>
> **Therefore: by the jar alone, a normal player can run ZERO EssentialsX commands.** Everything in this section's command table depends entirely on LuckPerms grants, and **the live LuckPerms data is unreachable** (caveat 1 at the top of this dossier — `storage-method: MariaDB` at `localhost:3306`, connection re-tested for this section and **actively refused**; `C:\Users\MSI\Desktop\plugins\LuckPerms\config.yml` lines 86, 98, 102).
>
> This section therefore reports a **best-evidence reconstruction**, clearly labelled, plus the exact question to put to the server owner. See "Uncertain / unverified".
>
> The only nodes we can state as hard fact are EssentialsX**Chat**'s four: `essentials.chat.local`, `essentials.chat.receive.local`, `essentials.chat.receive.shout`, `essentials.chat.receive.question` — all `default: true`. None of them is a command and all four are inert here (chat radius is 0).

### What it is

EssentialsX is the long-standing general-purpose "server basics" plugin — the one that normally supplies `/home`, `/tpa`, `/spawn`, `/msg`, `/kit`, `/warp` and about 130 other utility commands. On this server it has been **cut down to a small support role**: most of its player-facing systems are switched off, replaced by TFMC's own plugins, or simply never granted to players.

### What it actually provides on this server

Working through `C:\Users\MSI\Desktop\plugins\Essentials\config.yml` (diffed line-by-line against the jar's bundled `config.yml`; the live file is a **2.21.0-dev config running under a 2.22.0-dev jar** and is stock apart from the authored changes listed below):

| Feature | State here | Evidence |
|---|---|---|
| **Warps** | **On, and in real use.** `per-warp-permission: false`, so one node (`essentials.warp`) covers every warp. | `config.yml` `per-warp-permission: false`; `Essentials\warps\` |
| **Homes** | Config allows them (`sethome-multiple.default: 3`) but **no player on this server has ever set one** — 0 of 21 `userdata/*.yml` files contain a `homes:` key. | `grep -l 'homes:' Essentials/userdata/*.yml` returns 0 files |
| **Teleport requests** | Config allows them, but the last known LuckPerms snapshot **explicitly denies** `essentials.tpa` and `essentials.teleport` to the default group. | see "LuckPerms evidence" below |
| **Kits** | `kits.yml` is the **stock unmodified EssentialsX sample** (`tools`, `dtools`, `notch`, `color`, `firework` — Notch heads and a "Gigadrill" diamond pick). Not TFMC content. The snapshot **explicitly denies** `essentials.kits` to default. Player kits are RPCharacters' `/rpcharacter kit starter` instead. | `Essentials\kits.yml`; RPCharacters section |
| **Economy** | **Technically on, practically dead.** `starting-balance: 0`, `currency-symbol: '$'`, and **all 21 userdata files read `money: '0'`**. The real currency is **DenarEconomy** (`/deco`), a separate plugin with physical coin items that does **not** depend on Vault. `worth.yml` is the stock sample. | `Essentials\userdata\*.yml`; `denareconomy-0.1.8.jar` `plugin.yml` (`depend: [MMOItems, MythicLib, TLibs]`, no Vault) |
| **AFK** | **On.** Auto-AFK after 300 s; **auto-kick disabled**. | `auto-afk: 300`, `auto-afk-kick: -1` |
| **Mail** | Config on, but `notify-no-new-mail: false` (authored). Player-to-player letters on this server are TFMCCore's sealed-letter items, and long-distance delivery is **BirdMessenger**. | `config.yml`; TFMCCore / BirdMessenger sections |
| **Chat formatting** | **Effectively dead — see "Chat" below.** | RPCharacters `chat\ChatManager.java:48` |
| **Nicknames** | **Display-name changes are switched OFF** (`change-displayname: false`, authored — stock is `true`) and `change-tab-complete-name: false`. `/nick` would still store a nickname but it would not appear anywhere. No userdata file has a `nickname` key. | `config.yml`; `Essentials\userdata\*.yml` |
| **MOTD** | `motd.txt` is the **stock EssentialsX sample** ("Welcome, {PLAYER}! Type /help…") and `delay-motd: -1` (authored, stock is `0`). | `Essentials\motd.txt`, `config.yml` |
| **Join/quit messages** | `hide-join-quit-messages-above: 0` (authored, stock is `-1`) — join/quit messages suppressed. | `config.yml` |
| **Random teleport (`/tpr`)** | Configured (`tpr.yml`, all ocean/river biomes excluded) but never granted. | `Essentials\tpr.yml` |
| **Social spy** | On, with a 21-command watch list. Staff-facing. | `config.yml` `socialspy-*` |
| **Block/entity protection** | On, and **authored**: creeper explosions blocked, zombie door-breaking blocked, villager transformation blocked, phantom spawning blocked. Passive — no command. | `config.yml` `protect:` (4 authored changes vs stock) |
| **Signs** | **Off.** `enabledSigns:` is empty. | `config.yml` |
| **Newbie starter kit** | **Off.** `newbies.kit: ''` (authored; stock is `tools`). | `config.yml` |
| **Spawn on join** | **Off.** `spawn-on-join: false`. Respawn goes to bed (`respawn-at-home-bed: true`), not to a home (`respawn-at-home: false`) and not to an anchor. | `config.yml` |

### LuckPerms evidence — what the DEFAULT group actually grants

**The authoritative store (MariaDB) could not be read.** What follows comes from `C:\Users\MSI\Desktop\plugins\LuckPerms\luckperms-h2-v2.mv.db`, the leftover H2 file. This dossier's caveat 1 correctly flags that file as **stale** — and it is: it grants `towny.*` nodes although Towny is not installed, plus `orpchat.*`, `openrp.*`, `speechbubbles.use` and `denizen.clickable`, none of which match an installed jar.

**However**, the file's H2 row format is parseable, and its `essentials.*` rows are unambiguous. Extracted verbatim (holder → node → value):

```
group default   essentials.help      = true
group default   essentials.helpop    = true
group default   essentials.msg       = true
group default   essentials.kits      = FALSE   (explicit deny)
group default   essentials.teleport  = FALSE   (explicit deny)
group default   essentials.tpa       = FALSE   (explicit deny)
```

Cross-checked against the plugin's own plaintext action log embedded in the same file, which records e.g. `webeditor add essentials.kits false` and `webeditor add essentials.help true` against `default`.

The default group's **entire** node list in that snapshot is only 20 nodes:
`angelchest.use`, `denizen.clickable`, `essentials.help`, `essentials.helpop`, `essentials.msg`, `essentials.kits(false)`, `essentials.teleport(false)`, `essentials.tpa(false)`, `gsit.crawl`, `gsit.sit`, `gsit.sitclick`, `mmocore.class-select`, `orpchat.default`, `orpdesc.set`, `speechbubbles.use`, `towny.claimed.alltown.switch.*`, `towny.command.plot.perm.remove(false)`, `towny.command.resident.set.perm(false)`, `towny.wild.item_use.*`, `towny.wild.switch.*`, `weight.1`.

**There is no `essentials.*` wildcard on the default group.** The wildcard sits on `staff`, `moderator` and `builder` only.

Other groups in the same snapshot, for context: `builder` = `essentials.*` **minus** `ban`/`banip`/`kick`/`kickall`; `moderator` = `essentials.*`; `staff` = `*` **and** `essentials.*`; `donator` = no essentials nodes; `qa` = no essentials nodes (they were added then removed per the action log).

**Corroboration from a live, non-stale source:** `C:\Users\MSI\Desktop\plugins\HelpCommand\config.yml` — the server owner's own authored 9-page help menu — advertises exactly **three** EssentialsX commands to players: **`/warp`**, **`/helpop`** and **`/rules`**. It advertises **no** `/home`, `/sethome`, `/tpa`, `/spawn`, `/kit`, `/pay`, `/balance` or `/msg`. That independently matches the H2 picture: **this server does not give players homes, teleport requests or Essentials kits.**

### Player command table

Every row is **evidence-graded**, not asserted. **No row is confirmed against the live permission store.**

| Command | Aliases | What it does | Evidence a player can run it | Notes |
|---|---|---|---|---|
| `/warp <name>` | `/ewarp`, `/warps`, `/ewarps` | Teleports you to a named server warp; bare `/warp` lists them | **Inferred — strong.** Advertised on 4 of the 9 `HelpCommand` pages (`/warp Chat`, `/warp Professions`, `/warp Lockpicking`, `/warp Pets`). `essentials.warp` is **not** in the stale default-group list — but the H2 file is known-stale and the help menu is live-authored. | `per-warp-permission: false`, so one node covers all warps. Live warps are only the four staging warps `dref_test`, `faction_test`, `pvp_test`, `vehicle_test` (caveat 2) |
| `/helpop <message>` | `/ac`, `/amsg`, `/eamsg`, `/ehelpop` | Messages online staff | **Two sources.** `essentials.helpop = true` on the default group in the H2 snapshot, **and** `/helpop` is listed as a global channel on `HelpCommand` page 1. | The alias `eac` is in `disabled-commands`; `/ac` itself is not |
| `/msg <player> <msg>` | `/w`, `/m`, `/t`, `/pm`, `/tell`, `/whisper`, `/emsg`, `/epm`, `/etell`, `/ewhisper` | Private message | **One source.** `essentials.msg = true` on the default group in the H2 snapshot. **Not** advertised in the help menu. | **Alias collision:** `/whisper` is also an RPCharacters chat channel (2-block in-character whisper, alias `/wh`). RPCharacters registers its channels into the CommandMap at runtime — which wins is **unverified**. `minecraft:msg` is in `disabled-commands` |
| `/r <msg>` | `/er`, `/reply`, `/ereply` | Replies to the last person who messaged you | **Weak inference.** Follows from `/msg` being granted; the exact node `/r` checks was **not** confirmed from the jar. | Reply target: `last-message-reply-recipient: true`, timeout **180 s** |
| `/help [search] [page]` | `/ehelp` | Lists commands you have permission for | **One source.** `essentials.help = true` on the default group in the H2 snapshot. | **Contested command.** `HelpCommand` intends to own `/help` but **its jar is missing** (caveat 3), so `/help` most likely falls through to EssentialsX. `hide-permissionless-help: true` means the output shows only what you can actually run; `non-ess-in-help: true` includes other plugins' commands. **This makes in-game `/help` the single best way to settle this whole section.** |
| `/rules [chapter] [page]` | `/erules` | Prints the server rules text | **Inferred — weak.** Advertised on `HelpCommand` page 5. No matching node in the snapshot. | **`rules.txt` does not exist in `Essentials\`.** The jar ships a 53-byte default that Essentials writes out on first use, so `/rules` would print the **stock upstream placeholder**, not TFMC rules. Same for `/info` (`info.txt` also absent) |

**Everything else — `/home`, `/sethome`, `/delhome`, `/spawn`, `/tpa`, `/tpaccept`, `/tpahere`, `/tpdeny`, `/back`, `/kit`, `/pay`, `/balance`, `/baltop`, `/sell`, `/worth`, `/nick`, `/afk`, `/mail`, `/me`, `/list`, `/seen`, `/ping`, `/near`, `/suicide`, `/ignore`, `/tpr`, `/workbench`, `/repair` — is NOT evidenced as player-available on this server.** Several are actively contradicted:

- `/tpa`, `/tpaccept`, `/tpahere`, `/tpdeny`, `/tpr` — `essentials.tpa` and `essentials.teleport` are **explicitly denied** to the default group.
- `/kit`, `/kits` — `essentials.kits` **explicitly denied**. Kits are RPCharacters'.
- `/me` — the Essentials aliases `action`, `eaction`, `edescribe`, `eme`, `minecraft:me` are in **`disabled-commands`**, and `/me` is an RPCharacters chat channel.
- `/nick` — pointless: `change-displayname: false`. Also, **GSit blocks `/nick` while you are seated or posed** (see GSit section).
- `/balance`, `/pay`, `/baltop`, `/sell`, `/worth` — would operate on a parallel `$` ledger that is zero for every player. The real economy is `/deco` (DenarEconomy).

### Numbers that matter to players

All from `C:\Users\MSI\Desktop\plugins\Essentials\config.yml` unless noted.

- **Home limit:** `sethome-multiple.default: 3`, `vip: 5`, `staff: 10` (nodes `essentials.sethome.multiple.vip` / `.staff`). `spawn-if-no-home: true`; `confirm-home-overwrite: false`; `compass-towards-home-perm: false`; `world-home-permissions: false`. **No player has any home set.**
- **Teleport warmup:** `teleport-delay: 0` — **no warmup, teleports are instant**.
- **Teleport cooldown:** `teleport-cooldown: 0` — **no cooldown**.
- **Teleport invulnerability:** **4 seconds** after arriving.
- **TPA request timeout:** `tpa-accept-cancellation: 120` — **120 seconds**. `tpa-max-requests: 5` queued requests.
- **Teleport safety:** `teleport-safety: true`, `teleport-to-center: true`, `is-water-safe: false` (authored — you will not be dropped into water), `teleport-passenger-dismount: true`.
- **AFK:** auto-AFK after **300 seconds (5 minutes)** of inactivity. **`auto-afk-kick: -1` — no auto-kick, ever.** `broadcast-afk-message: true`; `cancel-afk-on-interact` / `-on-move` / `-on-chat` all `true`; `freeze-afk-players: false`; `disable-item-pickup-while-afk: false`; `sleep-ignores-afk-players: true`. (The jar accepts both `auto-afk-kick` and the newer `auto-afk-timeout` key — both strings are present in `Settings.class` — so the 2.21-era key in the live file is still honoured.)
- **Spawn on join:** **`spawn-on-join: false`.** `respawn-at-home: false`; `respawn-at-home-bed: true`; `respawn-at-anchor: false`; `random-spawn-location: "none"`; `random-respawn-location: "none"`.
- **Economy:** `starting-balance: 0`; currency symbol **`$`**, prefixed (`currency-symbol-suffix: false`); `max-money: 10000000000000`; `min-money: -10000`; `minimum-pay-amount: 0.001`; `command-costs:` empty (no command costs anything); `sell-multipliers: default 1.0 / double 2.0 / triple 3.0`.
- **Nicknames:** `max-nick-length: 15`; `nickname-prefix: '~'`; `nick-blacklist:` empty; `ops-name-color: '4'`. **Moot while `change-displayname: false`.**
- **Other:** `/heal` cooldown **60 s**; `/near` radius **200**; `mails-per-minute: 1000`; `max-itemlore-lines: 10`; `max-fly-speed: 0.8`, `max-walk-speed: 0.8`; `/tree` range limit 300; `login-attack-delay: 5 s`; `spawnmob-limit: 10`; `max-mute-time: -1`, `max-tempban-time: -1` (unlimited).

### Commands EXCLUDED as staff-only

So nothing looks accidentally missing. All are op-default in `plugin.yml`, and where the H2 snapshot speaks they sit on `staff` / `moderator` / `builder`, not `default`:

**Moderation:** `/ban`, `/banip`, `/tempban`, `/tempbanip`, `/unban`, `/unbanip`, `/kick`, `/kickall`, `/mute`, `/togglejail` (`/jail`), `/setjail`, `/deljail`, `/jails`, `/sudo`, `/vanish` (`/v`), `/socialspy`, `/invsee`, `/enderchest` (`/ec`), `/seen`, `/whois`, `/realname`, `/tpoffline`.
**Creative / build:** `/gamemode` (`/gm`, `/gmc`, `/gms`, `/gma`, `/gmsp`, `/creative`, `/survival`…), `/give`, `/item` (`/i`), `/more`, `/unlimited`, `/enchant`, `/repair`, `/hat`, `/skull`, `/itemname`, `/itemlore`, `/potion`, `/firework`, `/spawner`, `/spawnmob`, `/editsign`, `/tree`, `/bigtree`, `/break`, `/remove` (`/butcher`, `/killall`), `/powertool` + `/powertoollist` + `/powertooltoggle`.
**Admin teleport:** `/tp`, `/tphere`, `/tpo`, `/tpohere`, `/tpall`, `/tpaall`, `/tppos`, `/top`, `/bottom`, `/jump`.
**Server / world:** `/essentials` (`/ess`), `/backup`, `/gc` (`/tps`, `/lag`, `/mem`), `/time` (`/day`, `/night`), `/weather` (`/sun`, `/storm`, `/rain`), `/thunder`, `/ptime`, `/pweather`, `/world`, `/broadcast` (`/bc`), `/broadcastworld`, `/settpr`, `/setwarp`, `/delwarp`, `/setworth`, `/createkit`, `/delkit`, `/kitreset`.
**Player-state:** `/heal`, `/feed`, `/rest`, `/god`, `/fly`, `/speed`, `/ext`, `/ice`, `/burn`, `/lightning`, `/kill`, `/exp`, `/clearinventory` (`/ci`), `/eco`.
**Joke commands:** `/antioch` (`/tnt`, `/grenade`), `/nuke`, `/kittycannon`, `/beezooka`, `/fireball`.
**Portable GUIs:** `/workbench` (`/craft`, `/wb`), `/anvil`, `/grindstone`, `/loom`, `/smithingtable`, `/stonecutter`, `/cartographytable`, `/disposal` (`/trash`), `/book`.
**EssentialsXChat:** `/toggleshout` (`/etoggleshout`) — `essentials.toggleshout`, op-default, and inert anyway (chat radius 0).

### Features disabled on this server — do not advertise these

1. **All sign types.** `enabledSigns:` is empty — no `[Buy]`, `[Sell]`, `[Warp]`, `[Kit]`, `[Heal]`, `[Free]`, `[Trade]`, `[Protection]`, `[Disposal]`, `[Enchant]`, `[Balance]`, `[Time]`, `[Weather]`, `[Gamemode]`, `[Mail]`, `[Info]` or `[Repair]` signs exist here.
2. **Local / radius chat.** `chat.radius: 0` — EssentialsXChat's local-chat, shout (`!`) and question (`?`) prefixes are all inert. `shout-default: false`, `persist-shout: false`. `question-enabled: true` is set but only takes effect when radius > 0.
3. **Nickname display.** `change-displayname: false` + `change-tab-complete-name: false`.
4. **Join/quit broadcasts.** `hide-join-quit-messages-above: 0`.
5. **MOTD on join.** `delay-motd: -1`.
6. **New-player starter kit.** `newbies.kit: ''`.
7. **Spawn on join.** `spawn-on-join: false`.
8. **Six commands hard-disabled** via `disabled-commands:` — `eaction`, `minecraft:msg`, `minecraft:me`, `eac`, `action`, `demand`. This is authored (stock is empty), and the pattern — killing `/me`, `/action` and the vanilla `/msg` — is a deliberate clearing of the field for RPCharacters' chat channels.
9. **Group / world chat formats.** `chat.group-formats:` empty, `chat.world-aliases:` empty.
10. **Command costs and cooldowns.** `command-costs:` empty; `command-cooldowns:` empty.
11. **Economy logging.** `economy-log-enabled: false`, `economy-log-update-enabled: false`.
12. **Unsafe enchantments.** `unsafe-enchantments: false`.
13. **Per-player locale.** `per-player-locale: false`.
14. **Permission-based item spawn.** `permission-based-item-spawn: false`.
15. **The `player-commands:` list is IGNORED — do not use it.** The live config carries a `player-commands:` block of ~80 entries (afk, back, home, sethome, tpa, kit, spawn, warp, pay, sell…). **This is Essentials' internal fallback permission list, used only when `use-bukkit-permissions: false`.** The live setting is **`use-bukkit-permissions: true`**, so LuckPerms is authoritative and the list does nothing. It is also **identical to the stock EssentialsX default** (diffed against the jar's `config.yml`; only line ordering differs). **It is not a record of what players get here.**

### Chat

**EssentialsXChat is installed but its chat format never reaches players.**

- Its configured format is the stock `chat.format: '<{DISPLAYNAME}> {MESSAGE}'` with no group formats and no world aliases.
- **RPCharacters cancels every plain chat message.** `plugin-src\rpcharacters\...\RPCharacters\chat\ChatManager.java:33-48` registers `onPlainChat(AsyncPlayerChatEvent)` at **`EventPriority.MONITOR`** and calls `event.setCancelled(true)` unconditionally (unless `shouldSkipIngest`, or the message is blank or begins with `/`), then re-routes the text into the player's active RP channel. EssentialsXChat formats at a lower priority and is then overridden. Net effect: **the `<Name> message` format is dead; what players see is RPCharacters' channel formats** (`&f{display}&e: &f"&e{message}&f"` for RP, etc. — see the RPCharacters section).
- **There is no local/global chat toggle from EssentialsX here.** Local vs global is entirely RPCharacters' `/channel`, `/rp`, `/looc`, `/ooc`, `/shout`, `/yell`, `/whisper`.
- The four `default: true` nodes EssentialsXChat grants everyone (`essentials.chat.local`, `essentials.chat.receive.local`, `essentials.chat.receive.shout`, `essentials.chat.receive.question`) are consequently **inert**.
- **Colour codes in chat** are gated by `essentials.chat.color` / `.format` / `.magic` / `.rgb` / `.url`, none of which has a `default:` and none of which appears in the default group's snapshot — and RPCharacters does its own colour stripping regardless. Do not document Essentials chat colours as a player feature.
- **Social spy** watches 21 message aliases (`msg`, `w`, `r`, `mail`, `m`, `t`, `whisper`, `tell`, `reply`, `pm`, `email`, `action`, `describe`, …) with `socialspy-listen-muted-players: true` and `socialspy-uses-displaynames: true`. Staff-facing; worth one line in a player wiki's "staff can see your DMs" note.

### Cross-links

- **DenarEconomy** (`denareconomy-0.1.8.jar`, `/deco`, `/pouch`) — **the real economy.** It does **not** depend on or register with Vault, so Essentials' `$` ledger is a completely separate, all-zero currency. Never present `/balance` or `/pay` as the server's money commands.
- **EconomyBridge** (`economy-bridge-1.2.0.jar`) — the actual currency bridge layer.
- **RPCharacters** — owns chat (cancels `AsyncPlayerChatEvent`), owns kits (`/rpcharacter kit starter`), owns display names and personas (`/rpcharacter alias`, `namecolour`). Essentials' `/nick` and `/me` are stood down for it.
- **TFMCCore** — sealed letters replace `/mail` as the in-fiction message item.
- **BirdMessenger** — long-distance letter delivery; the in-fiction replacement for Essentials mail.
- **HelpCommand** — intends to own `/help`; its jar is missing, so Essentials' `/help` is what players most likely hit. Its config is the best live record of intended player commands, and lists only `/warp`, `/helpop` and `/rules` from Essentials.
- **GSit** — blocks `/nick` (and `/skin`) while a player is seated or posed.
- **TFMCWeb** — `listeners\EssentialsBanListener.java` mirrors Essentials bans to the website (`softdepend: Essentials`).
- **SimpleFactions** — entirely independent teleport / claim / bank systems; no Essentials interaction.
- **LuckPerms** — the sole gate on every command above.
- **Vault** — installed (`vault.admin` on `staff`); Essentials registers its economy into it, which is why Essentials' `$` can surface in other plugins' placeholders despite being unused.

### Uncertain / unverified

1. **THE BIG ONE — the live player command set is NOT confirmed.** The authoritative LuckPerms store is MariaDB on `localhost:3306`, which actively refuses connections, and no MySQL/MariaDB client is installed. The table above is reconstructed from a **stale** H2 file plus a **live but second-hand** help-menu config. **Ask the server owner to run, in-game as a normal-rank player: `/lp group default permission info` and `/help`.** With `hide-permissionless-help: true` set, the `/help` output alone would settle this section in one screenshot.
2. **Is the H2 file's Essentials data stale in the same way as its Towny data?** Unknown. The Towny nodes prove the file predates the current plugin set. But the Essentials denials (`kits`, `tpa`, `teleport` all explicitly `false`) match the live help menu's silence on those commands, so they are probably still the server's intent. Treat as strong circumstantial evidence, **not fact**.
3. **`/warp` has no supporting permission row at all**, in any source, yet the live help menu tells players to use it four times. Either `essentials.warp` was granted after the H2 snapshot, or the help menu is stale. **Unresolved.**
4. **`/r` (reply) node not verified.** We did not confirm from the jar whether `/r` checks `essentials.msg` or a separate node.
5. **`/whisper` and `/me` alias collisions with RPCharacters are unresolved.** RPCharacters registers its channel commands into the Bukkit CommandMap via reflection at runtime (`chat\ChatCommandRegistry.java:26-50`); EssentialsX registers `/whisper` as an alias of `/msg` at load. Which wins depends on registration order and was not tested live. `/me`'s Essentials aliases are partly in `disabled-commands` but bare `/me` is not.
6. **Config/jar version skew.** The live `config.yml` header says it was generated for `2.21.0-dev+164-1a4d75c`; the jar is `2.22.0-dev+60-787f539`. Keys added in 2.22 (`allowed-nicks-regex`, `gamemode-change-preserve-flying`, `use-custom-whitelist-message`, `log-console-commands`, `economy-log-uuids`, `baltop-entry-limit`, `paper-chat-events`, `windcharge-explosion`, `auto-afk-timeout`) are **absent from the live file and will silently use the jar's internal defaults**. Harmless, but any "this is off" claim about those specific keys would be wrong.
7. **`rules.txt` and `info.txt` do not exist** in `Essentials\`. Both ship inside the jar and are written out on first use, so `/rules` and `/info` would print **upstream placeholder text**, not TFMC content — yet `/rules` is advertised on `HelpCommand` page 5. Another plugin may be supplying `/rules`; not established.
8. **Staging snapshot.** Only four warps exist and all are named `*_test`; `kits.yml`, `worth.yml`, `motd.txt`, `items.json` and `custom_items.yml` are the **stock unmodified EssentialsX samples**. Warp names, kit contents and item worths from this folder must **not** be published as server content (caveat 2).
9. **21 userdata files, all with `money: '0'`, no homes and no nicknames.** Consistent with a staging server, but it also means there is zero behavioural evidence of any player ever having used an Essentials feature beyond logging in.
10. The H2 row parse was done by hand-decoding H2's MVStore string/boolean tags (string tag byte = 68 + length; `0x41` = true, `0x40` = false), cross-validated against the plugin's own plaintext action log in the same file. The six `essentials.*` default-group rows decoded consistently under both methods, but this is a **reverse-engineered read of a binary format, not a database query.** The file was opened read-only and never modified.
