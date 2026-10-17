# Adventure & Encounter Systems — Factual Research Dossier

Scope: Thievery, Infestations, TrialRooms, Games, MythicMobs, MythicDungeons, MCPets, LibsDisguises, ConditionalEvents.

Source of truth: the live server plugin data folders at `C:\Users\MSI\Desktop\plugins\` (read-only), plugin `.jar` `plugin.yml` manifests, the ItemsAdder pack at `C:\Users\MSI\Desktop\plugins\ItemsAdder\`, and (for in-house plugins) source at `C:\Users\MSI\Desktop\plugin-src\`.

Conventions used throughout this dossier for item references, confirmed from TLibs
([`ItemChecker.java`](https://github.com/TF-Minecraft/TLibs/blob/main/src/main/java/net/tfminecraft/tlibs/objects/api/subapi/ItemChecker.java)):

| Prefix | Means | Example |
|---|---|---|
| `v.<MATERIAL>` | Vanilla Minecraft item | `v.iron_ingot` |
| `m.<type>.<id>` | MMOItems item, `<type>` = MMOItems item type | `m.loot.infusion_token` |
| `ia.<namespace>:<id>` | ItemsAdder item | `ia.tfmc:lure` |

---

## Thievery

**What it is** — An in-house crime system: you can lock your own doors and chests with keys, and you can break into other people's doors, chests, display furniture and graves with lockpicks, pickpocket players, or hold a player up in a consensual timed robbery — all of which can leave *clues* pointing at your character.

Jar: `thievery-1.0.0.jar`. Data: `C:\Users\MSI\Desktop\plugins\Thievery\`. Source: `C:\Users\MSI\Desktop\plugin-src\thievery\`.
Hard dependencies (`plugin.yml`): MMOCore, TLibs, RPCharacters. Soft: OpenRP, AdvancedCrafting, InteractibleFurniture, DenarEconomy.

### How a player actually uses it

**Locking your own door**
1. Hold a key (`m.keys.iron_key` or `m.keys.gold_key`).
2. **Sneak + right-click** the door. Title: `Door locked.` A lock sound plays.
3. Sneak + right-click again with the *same* key to unlock (title `Door unlocked.`). A wrong key gives `This key does not fit this lock.`
4. While locked, right-clicking the door without a matching key shows the title `This door is locked.` and the door will not open. Breaking the door (or the block under it) is also blocked unless you hold the matching key.
   (`C:\Users\MSI\Desktop\plugin-src\thievery\src\main\java\net\tfminecraft\thievery\door\DoorManager.java`, `onPlayerInteract` and `onBlockBreak`.)

**Locking your own container**
1. *You automatically own any container you place.* On placement you get the title `Lock State` / `Private`.
2. **Sneak + LEFT-click** a container you own to cycle its lock state: `Private` → `Guild` → `Public` → back to `Private`. An iron-trapdoor sound plays each time.
3. Non-owners who right-click a container they cannot access get `You do not have access to this container.` Trying to cycle a container you do not own gives `You can only change the lock state on containers you own.`
   (`door/ContainerManager.java` `onShiftLeftClickContainer`; `door/LockState.java`.)
   Ender chests are excluded from the whole system (`Thievery/config.yml` → `lockpicking.excluded-containers`).

**Copying a key** — done by dragging one item onto another *in your own inventory* (no crafting bench), per `key/KeyCopyListener.java`:

| Pick up (cursor) | Click onto | Result | Message |
|---|---|---|---|
| `v.clay_ball` | a master key | `m.utils.key_mold` | `Key mold created.` |
| `v.copper_ingot` | a key mold | `m.keys.copper_key` (permanent copy); mold and ingot consumed | `Key copy created.` |
| `v.paper` | a master key or a copper copy | `m.keys.paper_key` (single-use) | `Paper key created.` |

Paper keys **only open doors** — sneak-using one on a door says `Paper keys can only open doors.` — and are consumed on use. Copying a given key to paper is on a **240-minute (4 hour) per-player, per-key cooldown**; otherwise `You cannot copy that key to paper for another <n> minute(s).` (`config.yml` → `key-copy.paper-cooldown-minutes`.)

**Keychain** — `m.keys.key_chain` holds up to **5 keys**; its model changes with how many keys are inside (custom models 68–73 for 0–5 keys). A full keychain says `This keychain is full.` Keys on the chain work for opening doors. *(The only in-plugin way to get one is the admin command `/thievery keychain` — see Inert.)*

**Lockpicking a door**
1. Hold a lockpick (`m.lockpicks.basic_lockpick_set`, strength 0.35, 30 uses) and right-click a **closed, locked** door within 3 blocks.
2. Without the required character trait: `You lack the needed character trait(s) to lockpick!`
3. A minigame starts: a 20-slot bar scrolls in the title/subtitle alongside your current **risk**. Right-click the door again to strike — land on a success slot (up to 3 wide) and avoid the break slots.
4. Outcomes: title `Picked!`, `Failed!` or `Lockpick broke!`. Walking away cancels it: `Lockpicking cancelled - you moved too far from the door.`
5. On success the door enters a **60-minute unlock window** during which it opens for anyone.
6. If your pick is much weaker than the lock: `Your lockpick is too weak for this lock.` A partial mismatch instead gives `Lockpicking with <n>% penalty (<n>s)`.

**Lockpicking a container / display furniture**
Same tool and bar minigame, but on success you do **not** receive the chest contents — you get a **Steal GUI**. You click slots to *probe* them (`Click a slot to probe the container.`); each probe risks breaking your lockpick (`Your lockpick broke!`) and each item you take costs **budget points** from your loadout. Lockable furniture: `artifact_display`, `pedestal`. Lockable entities: `ARMOR_STAND`, `ITEM_FRAME`, `GLOW_ITEM_FRAME` (`config.yml` → `lockpicking.lockable-furniture` / `lockable-entities`).

**Graves** — right-clicking another player's grave opens the same steal interface with a budget of 10. `You took <items>` on success, `There is nothing you can steal here.` otherwise (`steal/GraveStealListener.java`).

**Pickpocketing**
1. `/pickpocket start` → `Right-click a player within 4 blocks to pickpocket them.`
2. Right-click the target. A Steal GUI of their inventory opens with a **10-point budget**.
3. The victim gets a red subtitle: `Someone is pickpocketing you!` — or, if you trigger a *critical*, `<Your Character Name> is pickpocketing you!`
4. Moving away ends it: `Your target moved too far away.`

**Robbery** (opt-in — the victim must consent)
1. `/robbery start` → `Right-click a player within 4 blocks…`
2. Right-click the target; they must run `/robbery accept` within **30 seconds** or you get `Your robbery request timed out.`
3. On accept: robber sees `Robbery started! Take what you can before time runs out.`; victim sees `You accepted the robbery and cannot move until it ends.` — **the victim is frozen**.
4. You get **120 seconds** and a **30-point budget**. Clicking their coin pouch takes 10 denar per click, shift-click 100.
5. `The robbery has ended.`

**Loadout** — `/thievery loadout` opens a 54-slot paged GUI titled `Loadout (<bank> bank · <spent>/30)`. Each category costs points; you may hold **30 points** of categories at once, and points return to a bank over time. Only categories in your active loadout can be stolen; coins specifically require the `Money` category. Buttons: red dye `Cancel`, lime dye `Confirm`, arrows for pages. Errors: `You cannot allocate more than 30 points.`, `You do not have enough bank points for that category.` (`player/InventoryManager.java`.)

**Clearing clues** — `/thievery clearclues` → `Right-click a door or container to clear linked clues.` → `Removed <n> clue(s)`. This has **no permission check in the code** (`command/CommandManager.java`).

### Content it adds ON THIS SERVER

**Keys and tools** (all MMOItems):

| Path | Role | Strength / capacity |
|---|---|---|
| `m.keys.iron_key` | Lockable key | 0.2 |
| `m.keys.gold_key` | Lockable key | 0.5 |
| `m.keys.copper_key` | Permanent copy (made from a mold) | inherits source |
| `m.keys.paper_key` | Single-use, doors only | inherits source |
| `m.keys.key_chain` | Holds 5 keys | — |
| `m.utils.key_mold` | Intermediate for copying | — |
| `m.lockpicks.basic_lockpick_set` | The only configured lockpick | strength 0.35, 30 uses |
| `m.misc.door_locks_debug_tool` | Staff debug tool | — |

**Steal categories** (`Thievery/categories.yml`) — 30 categories, each with a display name and point cost:
- `Money` (cost 1) — required to take physical coins and robbery-pouch money; 0.1 budget per denar.
- Crafting material tiers I–IV for **Metal, Wood, Crystal, Leather, Feather, Wool** — cost 1/2/3/4 per tier.
- `Tier I–IV Armor` (cost 2/3/4/5), `Tier I–IV Weapons` (2/3/4/5), `Tier I–IV Bows` (2/3/4/5).
- Gemstones: `Basic Gemstones` (cost 1, value 1.0), `Polished Gemstones` (2, value 2.0), `Radiant Gemstones` (3, value 4.0), `Mythical Gemstones` (4, value 8.0 — ruby, sapphire, musgravite and taaffeite are 10.0 each).

Name colour codes: `#e8e0d4` Tier I, `#9a9a9a` Tier II, `#7b68a6` Tier III, `#c9a227` Tier IV and Money.

Tier value multipliers used when pricing a theft: tier 1 = 1.0, tier 2 = 2.0, tier 3 = 4.0, tier 4 = 8.0; anything uncategorised is worth `default_item_value: 0.1` (`config.yml`).

**Live data on this server**: 74 locked-container records and 5 locked-door records exist (`Thievery/data/`, `Thievery/door-data/`). Container records store `owner`, `lockState` (`PRIVATE`/`GUILD`/`PUBLIC`) and an access map; door records store the key UUID, the key's strength, the owner, and an `unlockExpiryMs` timestamp.

### Player command table

Thievery's `plugin.yml` declares **no `permissions:` block at all**, so nothing is permission-gated except where the code explicitly checks `thievery.admin`. Everything below is open to a normal player.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/thievery` | — | Lists the player subcommands (`loadout`, `clearclues`) | Admins additionally see the staff list |
| `/thievery loadout` | — | Opens the 30-point steal-category loadout GUI | Requires the `thief` character trait, else `You lack the needed character trait(s) for thievery!` |
| `/thievery clearclues` | — | Arms a right-click to wipe clues from one door or container | No permission check in code |
| `/pickpocket` | — | Shows pickpocket usage | |
| `/pickpocket start` | — | Arms a right-click to pickpocket a player within 4 blocks | Requires the `thief` trait |
| `/robbery` | — | Shows robbery usage | |
| `/robbery start` | — | Arms a right-click to demand a robbery | Requires the `bandit` trait |
| `/robbery accept` | — | Accepts a robbery demand aimed at you | **No trait or permission needed** — any player can accept |

**Admin/staff commands excluded** (all gated on `thievery.admin`): `/thievery reload`, `/thievery resetcooldowns <player|all>`, `/thievery setrisk <player|all> <0.0-1.0>`, `/thievery itemvalue`, `/thievery keychain`, `/thievery feedback`.

### Numbers that matter to players

| Thing | Value | Source key |
|---|---|---|
| Interact cooldown | 3 | `cooldown` |
| Lockpick range | `-1` (unlimited) | `lockpick-range` |
| Door lockpick max distance | 3 blocks | `lockpicking.door-max-distance` |
| Max success chance (any pick) | 95% | `lockpicking.max-success-chance` |
| Failed-pick cooldown | 60 seconds | `lockpicking.fail-cooldown-ms: 60000` |
| Door unlock window after a successful pick | 60 minutes | `lockpicking.door-unlock-window-minutes` |
| Minimum lockpick-to-lock strength ratio | 0.5 — a lock more than twice your pick's strength is impossible | `lockpicking.min-lock-strength-ratio` |
| Lockpick penalty cap | up to 50% reduction | `lockpicking.lockpick-max-reduction` |
| Bar length / success slots / break slots | 20 / up to 3 / slots 3–19 | `lockpicking.bar` |
| Bar speed | base 2.5, −0.02 per Dexterity, floor 0.4, ±30% jitter | `lockpicking.bar` |
| Bar randomly reverses direction | 3% | `bar.random-flip-chance` |
| Governing stat | **Dexterity** (MMOCore): 0 dex = ×1.0, 40 dex = ×4.0 | `lockpicking.attribute`, `dex-map` |
| Chest probing | 100% base success, +10% break chance per slot probed | `lockpicking.chest` |
| Display furniture lock strength | fixed 0.5 | `lockpicking.display-lock-strength` |
| Loadout points | 30 held, +24 per gain interval | `category_points`, `point_gain_interval` |
| Pickpocket budget / cooldown / range | 10 points / 1 hour / 4 blocks | `pickpocket` |
| Robbery budget / cooldown / duration / range | 30 points / 3 days / 120 s / 4 blocks | `robbery` |
| Robbery accept timeout | 30 seconds | `robbery.accept-timeout-seconds` |
| Robbery pouch click / shift-click | 10 / 100 denar | `robbery.pouch-*-amount` |
| Grave steal budget | 10 points | `graves.budget` |
| Key-to-paper copy cooldown | 240 minutes | `key-copy.paper-cooldown-minutes` |
| Keychain capacity | 5 keys | `keychain.max-keys` |
| Risk gained per crime | door 0.05–0.15, chest 0.025–0.075, pickpocket 0.04–0.12 | `clues.risk-gain-*` |
| Risk decay | −0.08 per hour (Dexterity accelerates it) | `clues.risk-decay-per-hour` |
| Successful pick halves risk gain | ×0.5 | `clues.risk-pick-reduction` |
| Critical clue chance (names your character) | base 0%, +0.5 × risk; Dexterity −0.15, lockpick strength −0.2 | `clues.critical-*` |
| Critical clue cooldown per target | 24 hours | `clues.critical-cooldown-hours` |
| Recent-clue memory | last 6, 1-hour cooldown before a clue can repeat | `clues.recent-max`, `recent-cooldown-hours` |
| Guaranteed clues | 0 on doors, **1 on containers** — your first container theft always drops a clue | `clues.min-clues-door` / `min-clues-container` |

The critical clue text is literally: `This seems to be the work of <Character Name>` (`config.yml` → `clues.critical-clue`).

### Features configured but INERT

- **`lockpicking.debug-allow-own-chest: true`** and **`lockpicking.debug-clue-preview: true`** are debug flags left **on**. As configured, players can lockpick their own chests and clue previews are shown. Likely test settings rather than intended mechanics — *the "test setting" reading is a guess; the config values themselves are verified.*
- **Only one lockpick exists.** `config.yml` defines a single `iron_lockpick` entry pointing at `m.lockpicks.basic_lockpick_set`. There is no tiered lockpick progression despite keys having tiers.
- **Keychains have no in-game source.** `/thievery keychain` is `thievery.admin`-only, and nothing in this plugin grants `m.keys.key_chain` by any other route. Unless another plugin distributes it (none found in this folder), players cannot obtain one.
- **All `ac_*` material/armour/weapon/bow categories have `value: 0.0`.** Only the gemstone and money categories carry steal value. Stealing tiered gear costs loadout points but contributes nothing to the value-scaled clue risk (`clues.take-value-scale: 12.0` multiplies a value of zero). Verified in `categories.yml`; the gameplay consequence is an inference.
- **`lockpicking.require-owner-online: false`** — owners need not be online. Not a restriction players hit; listed so nobody documents one.
- **`robbery.ignore.name-contains: [Slot]`** and the same for pickpocket — GUI placeholder items named "Slot" are skipped. Invisible to players.

### Cross-links

- **RPCharacters** — clues attach to your *active character*; with no character you get `You do not have an active character!` and clue drops are skipped. Clue text comes from RPCharacters' `ClueGiver`, and clues spawn as holograms at the crime scene.
- **MMOCore** — Dexterity drives lockpick speed, success and critical-clue reduction. Character **traits** (`thief`, `bandit`) gate the commands.
- **MMOItems** — every key, lockpick, mold and category icon.
- **DenarEconomy** — coin and pouch values inside the steal budget.
- **SimpleFactions** — the `GUILD` lock state, and a per-guild pickpocket/robbery cooldown (`Your guild must wait …`).
- **InteractibleFurniture** — `artifact_display` and `pedestal` are lockable and stealable.
- **AdvancedCrafting** — the `ac_*` category IDs are AdvancedCrafting item tiers.
- **DecentHolograms** — clue holograms (via RPCharacters).

### Uncertain / unverified

- `traits: [thief]` at the top of `config.yml` governs lockpicking and the loadout; `robbery.traits: [bandit]` and `pickpocket.traits: [thief]` govern those. *How a player earns a trait* lives in RPCharacters and was not researched.
- `lockpick-range: -1` is read as "unlimited"; the code path was not traced.
- Whether a non-owner can break or pick up a locked container has guild-access branches that were not fully traced.
- The exact formula converting risk into a clue-drop chance was read at a high level only.

---

## Infestations

**What it is** — Whole map provinces get overrun by monsters; you can see which ones on the map, you fight ambient spawns while you are there, and you can place a Lure to trigger a wave fight that, if you win, clears the province.

Jar: `infestations-0.1.0.jar`. Data: `C:\Users\MSI\Desktop\plugins\Infestations\`. Source: [TF-Minecraft/Infestations](https://github.com/TF-Minecraft/Infestations). Hard dependencies: TLibs, SimpleFactions, MythicMobs, ItemsAdder, InteractibleFurniture.

### How a player actually uses it

1. **Find an infested province.** Infested provinces are published to the server map (`Infestations\MapAPI\infestation_data.json`) with a hover label — currently every one reads **"Bog Monsters"** — plus a severity.
2. **Walk in.** Infested provinces continuously spawn ambient monsters in a ring around you, up to a cap. For both configured groups this is **night-only**: no ambient or lure spawns unless world time is between 13000 and 23000 (`Infestations\groups.yml`).
3. **Place a Lure** — the ItemsAdder furniture item `ia.tfmc:lure`, display name **"Lure"** (`ItemsAdder\contents\ia_tfmc\contents\base.yml`, around line 697). Placing it in an infested province starts a **20-second join window**:
   - Chat: `A lure is activating. Leave the province or right-click the lure to join.`
   - A hologram counts down `Lure - join <n>s`, visible up to 96 blocks.
   - Action bar: `Lure activating: {seconds}s - leave or right-click to join`.
4. **Right-click the lure to commit** → `You joined the lure. Leave the province and the lure fails.`
   If you neither join nor leave: `Leave this province. The lure has started without you.` and **you take deserter damage of 2 per check** (`config.yml` → `deserter-damage: 2`).
5. **Fight the wave.** A hologram shows `Remaining: <n>`. Clear them all → `The infestation is cleared.` Fail, die out or leave → `The lure failed. The infestation remains.`
6. Placing a lure in a clean province: `There is no infestation here. The lure does nothing.` Only one at a time: `A lure is already placed in this province.`
7. **Logging out mid-lure does not save you.** There is a 300-second logout grace, after which the data file records you in `deathOnLogin` — you die when you next log in (`config.yml` → `logout-grace-seconds: 300`; `Data\infestations.json` field `deathOnLogin`).

### Content it adds ON THIS SERVER

Two groups, both shown to players as **"Bog Monsters"**, both night-only (`Infestations\groups.yml`):

| Group ID | Display | Mob roster (MythicMobs IDs, spawn weight) |
|---|---|---|
| `swamp_mobs` | Bog Monsters | `SwampGhoul` (0.5), `parasitic_worm`, `butterfly_zombie`, `dragonfly_zombie`, `frog_zombie`, `mantis_zombie`, `rpg_rat`, `rpg_rat_undead`, `rpg_poison_slime_cube`, `rpg_slime_cube`, `rpg_skeleton`, `rpg_skeleton_crossbow` (all 1.0), `greentroll` (**0.05** — rare) |
| `swamp_mobs_hill` | Bog Monsters | identical roster, except `greentroll` weight is **1.0** (common) |

Current live infestations: **88 provinces** (`MapAPI\infestation_data.json`):

| Group | Severity | Province count |
|---|---|---|
| `swamp_mobs` | mild | 3 |
| `swamp_mobs` | worrying | 24 |
| `swamp_mobs` | severe | 36 |
| `swamp_mobs` | extreme | 22 |
| `swamp_mobs_hill` | extreme | 3 |

Province IDs run in an almost unbroken block from **427 to 514** (443 is not infested), plus the outlier **744**.

### Player command table

**There are no player commands.** `infestations-0.1.0.jar`'s `plugin.yml` declares exactly one command, `/infestation` (alias `/infestations`), with `permission: infestations.admin`, `default: op`. Everything a player does is done with the Lure item and by walking into a province.

**Admin/staff commands excluded**: `/infestation reload | set | clear | list` (alias `/infestations`), all requiring `infestations.admin` (default op).

### Numbers that matter to players

| Thing | Value | Source |
|---|---|---|
| Join window after a lure is placed | 20 seconds | `join-seconds` |
| Deserter damage for staying without joining | 2 per check | `deserter-damage` |
| Logout grace before a death is queued | 300 seconds | `logout-grace-seconds` |
| Lure spawn radius | 48 blocks | `lure-spawn-radius` |
| Hologram view range | 96 blocks | `hologram-view-range` |
| Night-only window | world time 13000–23000 | `groups.yml` comment |

Per-severity numbers (identical for both groups):

| Severity | Ambient cap | Ambient interval | Ambient ring | **Lure wave size** | Lure duration |
|---|---|---|---|---|---|
| mild | 8 | 40 ticks (2 s) | 10–22 blocks | **20 mobs** | 120 s |
| worrying | 16 | 40 ticks (2 s) | 10–20 blocks | **40 mobs** | 120 s |
| severe | 28 | 30 ticks (1.5 s) | 9–19 blocks | **60 mobs** | 120 s |
| extreme | 40 | 20 ticks (1 s) | 8–18 blocks | **80 mobs** | 120 s |

### Features configured but INERT

- **Spread is OFF.** `config.yml` → `spread: false`, with the comment *"Keep false on the test server so set infestations stay put."* Infestations do **not** creep into neighbouring provinces, and `spread-interval-seconds: 600` never fires. Do not tell players infestations grow on their own.
- **Only swamp content exists.** Both configured groups are swamp/bog. There are no forest, desert, nether or other infestation types. `swamp_mobs_hill` differs from `swamp_mobs` only in troll frequency, and since both display as "Bog Monsters" players cannot distinguish them from the map.
- **`skip-terrains: [water, sea]`** — ocean provinces can never be infested. Staff-side, invisible to players.
- **Severity "mild" is nearly unused** — 3 of 88 provinces. The infested band is overwhelmingly severe/extreme.

### Cross-links

- **MythicMobs** — every spawned monster is a MythicMobs mob. `parasitic_worm` is defined in `MythicMobs\mobs\3rd Party\Others\Mobs\ParasiticWorms.yml`; the `rpg_*` mobs come from the purchased RPG packs; `greentroll` from `trolls.yml`. See the MythicMobs section for their stats and drops.
- **SimpleFactions** — provinces are SimpleFactions land provinces (`Not a valid land province.`).
- **ItemsAdder** — the Lure item `ia.tfmc:lure`.
- **InteractibleFurniture** — the Lure is placed furniture, not a normal block.
- **The server web map / MapAPI** — `Infestations\MapAPI\infestation_data.json` is written for the map; that is where players see infestations at a glance.
- **TLibs** — item path resolution.

### Uncertain / unverified

- **No reward for clearing an infestation is configured in this plugin.** `lure-victory` only says `The infestation is cleared.` Any loot comes from the mobs themselves or from a ConditionalEvents rule — see the ConditionalEvents section.
- **How a player obtains a Lure is not determinable from this folder.** No recipe, crate or shop entry for `ia.tfmc:lure` was found here. Whether the Lure is consumed on use is likewise unconfirmed.
- Whether infestations ever respawn or decay is unknown; only manual `set`/`clear` exist.
- Ambient spawn behaviour was read from config keys only (the jar was not decompiled), so the meaning of `ambient-ring-min/max` — distance from the player versus from the province centre — is a **guess**; read here as distance from the player.

---

## TrialRooms

**What it is** — A configured-but-not-installed dungeon-room loot system: key-locked spawner rooms that scale with level, drop rarity-weighted loot, and occasionally yield a "mob key".

### STATUS: NOT INSTALLED — ENTIRELY INERT

`C:\Users\MSI\Desktop\plugins\TrialRooms\` contains only three config files (`config.yml`, `loot-tables.yml`, `spawners.yml`). **There is no TrialRooms jar in `C:\Users\MSI\Desktop\plugins\`.** Every `.jar` in that directory was scanned: none contains a class or resource matching `trialroom`, and no jar's `plugin.yml` declares a plugin named TrialRooms. No repository exists under `drefvelin` or `JustinasLa` for `trialrooms`, `TrialRooms`, or `trial-rooms` (probed with `git ls-remote`).

Corroborating evidence:
- `spawners.yml` is a 29-byte stub: `spawner: { block: v(spawner) }` — no actual placed spawners.
- Nothing anywhere else in the plugins tree references `SPAWNER_KEY` or `MOB_KEY` except `TrialRooms\config.yml` itself.
- The MMOItems entries `SPAWNER_KEY` and `MOB_KEY` (`MMOItems\item\loot.yml`, lines 289 and 298) are bare: `GOLD_NUGGET`, custom-model-data 72.0 and 71.0, **no display name, no lore**. By contrast the neighbouring `TRIAL_KEY` (model 69.0) is a finished item named `Unknown Key` with lore `Used to enter a Dungeon Crawl.` — but `TRIAL_KEY` is **not** the key TrialRooms is configured to consume.

**The wiki must not document TrialRooms as playable content.** The rest of this section exists only so the design intent is not lost.

### What it would add if enabled

- **Keys**: `m.loot.spawner_key` (opens a room's spawner) and `m.loot.mob_key`.
- **Staff edit tool**: `v.blaze_rod`.
- **Scaling**: +0.6 damage and +15.0 health per level.
- **Mob key drop chance**: 2% base, +0.15% per level, capped at **25%**.
- **Rarity weights**: common 60, uncommon 25, rare 10, epic 4, legendary 0.6; exponential model, +6% growth per level; jitter ±1.5%.
- **Two loot tables** (`loot-tables.yml`):
  - `table1` (room/chest loot) — 2–3 rolls at common rising to 5–9 at legendary. Notables: `m.loot.infusion_token` (rare, 0.08), and at legendary weight 0.005 each: `m.loot.mythical_gemstone_pouch`, `m.loot.sword_runestone`, `m.loot.wand_runestone`, `m.loot.staff_runestone`, `m.loot.armor_runestone`, `m.consumables.shadow_potion`.
  - `mob_table` (mob drops) — junk (`v.rotten_flesh`, `v.bone`, `v.wheat`, `m.foods.onion`) up to `m.materials.abyssalite_fragment` (0.005) and `m.materials.mythril_fragment` (0.002) at legendary.
- **Potion value conversions**: `trial_minor_mana_potion` 1.5, `trial_minor_health_potion` 1.5, `trial_minor_resistance_potion` 3.0, `trial_major_mana_potion` 3.0, `trial_major_health_potion` 3.0, `trial_massive_health_potion` 6.0.

Note the `m.consumables.trial_*` potions **do** exist in MMOItems, so those items may be obtainable through other systems even though TrialRooms is not running.

### Player command table

None — the plugin is not installed and registers no commands. (Nothing was excluded; there is nothing there.)

### Cross-links (intended)

MMOItems (keys, potions, gemstone pouches, runestones, skin scrolls) — the same loot vocabulary used by ExcellentCrates and the MythicMobs droptables.

### Uncertain / unverified

- Whether TrialRooms was ever live on this server, or whether the jar is merely absent from this snapshot. **This is the single most important thing to confirm before the wiki mentions it at all.**
- `spawners.yml`'s `v(spawner)` syntax does not match the documented TLibs `v.<MATERIAL>` form; it may use a different parser or simply be a broken stub. Unresolved.

---

## Games

**What it is** — Physical card tables you place in the world: a deck sits on a block, cards float in your hand as 3-D displays, and you bet real denars at Blackjack, Hold'em, Five-Draw, or a no-rules Free Play table.

Jar: `games-0.1.0.jar`. Data: `C:\Users\MSI\Desktop\plugins\Games\`. Source: `C:\Users\MSI\Desktop\plugin-src\games\`.
Depends on TLibs, ItemsAdder, ProtocolLib. Soft-depends on DenarEconomy, RPCharacters, SimpleFactions.

### How a player actually uses it

**Placing a table** — any player can do this; it is *not* admin-only (`table\TableManager.java`, the deck-item branch of the interact handler):
1. Hold a **Deck of Cards** (`ia.tfmc_games:deck`).
2. Right-click a block. A **game-select GUI** opens with four icons.
3. Pick a game. Blackjack then opens a **table-options GUI** (min bet, max bet, house settings); Poker / Draw / Free Play arm placement immediately.
4. Click the spot to place. **Sneaking cancels** an armed placement.
5. Picking the table back up **drops the Deck of Cards item again** at the table's origin.

**Playing, in general**
- Cards render as floating ItemDisplays **fanned in front of you**, visible only within 48 blocks.
- **Left-click a card in your fan** to inspect it (it pushes forward). **Press your swap-hands key (F)** to flip your whole hand face-up for the table.
- **Right-click the shoe** (the deck on the table) to draw, deal or act.
- **Right-click the felt while holding coins** to bet.
- **Walk more than 6 blocks from the table** and your cards return and this round's stake comes back.
- Only **whole denars** go on a table — silver bits are refused (`wager.integer-denars: true`; the help book: *"Only whole coins go on a table. Silver bits are no good."*).
- Winnings are subject to **citizen tax** via DenarEconomy; you get the usual `(<n> in tax)` line (`wager\CitizenTax.java`).

**Blackjack**
1. While betting is open, right-click **your own box** on the felt holding coins. Click again to add more.
2. When your name comes up, right-click the shoe for a card, **or type in chat**: `hit`, `stand`, `double`, `split`. Those words only register when it is actually your turn. `/games bet hit` does the same thing.
3. The dealer reveals and draws to **17** — this house does **not** hit soft 17.
4. Payouts: a win returns **double** your bet; a natural 21 on the first two cards pays **3:2**; a push returns your bet.
5. **No insurance and no surrender** are offered (stated outright in `Games\help.yml`).
6. To deal by hand, stand at the dealer's spot and right-click the shoe; right-click again to hand it over. A dealer runs `/games bet min <n>`, `/games bet max <n>`, `/games bet open`, `/games bet close`, then right-clicks the shoe.
7. Some tables deal themselves — betting opens automatically and a clock starts once the first real bet lands.

**Tenceur Hold'em / Five-Draw**
- Right-click the felt with coins to sit down. Once **two** players are seated, **anyone at the table** can right-click the shoe to deal.
- Bet by pushing coins onto the felt **first**, then saying the word in chat: `check`, `call`, `raise`, `fold`. The table reads how many coins you actually put out, so saying "raise" with nothing on the felt does nothing.
- **Blinds are advisory only.** The help book says so in red: *"The blinds written above the table are a guide. Nothing is taken from you automatically."* Whoever owes a blind puts the coins out themselves.
- The dealer button is shown above the table and moves one seat after every hand; it sets who acts first, for both betting and drawing.
- Five-Draw: on your draw turn, click the cards you want to discard (they lift so you can see your picks), then right-click the shoe for that many replacements. To stand pat, type `draw` in chat — **chat only; there is no `/games bet draw`**.
- Calling with less than you need puts you in for what you could manage; side pots are created and you can only win what you matched.
- Walking off forfeits: this round's stake returns, earlier rounds' does not.

**Free play**
- No rules, no turns, no dealer. Right-click the shoe empty-handed for a card. Click cards then right-click the shoe to discard them. No limit on how many you hold.
- Right-click the felt with coins to add to the middle.
- **Sneak + right-click the shoe and the entire pot comes to you.** Nothing prevents this — the help book warns: *"Nothing stops you doing that, so only play here with people you trust."*

**Wagering non-coin items** — hold the item, type `/wager <amount>`, and the table **votes** on whether it counts (30-second window). If accepted you have 10 seconds to click the felt with that same item. With `min-players: 1`, a wager auto-accepts if nobody else has bought in.

**Help books** — `/games help` opens an in-game written book titled **"Table games"**, author "The house". `/games help blackjack|poker|draw|freeplay` opens the per-game rule books (6–15 hand-written pages each, `Games\help.yml`). These are the best in-game rules reference and are worth mirroring into the wiki.

### Content it adds ON THIS SERVER

**Four games** (`Games\games.yml`):

| Game ID | Label shown to players | Select-GUI icon | Card set | Notable rules |
|---|---|---|---|---|
| `blackjack` | **Blackjack** | `ia.tfmc_games:mitlan_7` | french_52 | min 10 / max 1000, 6 boxes, auto-dealer on, stands on soft 17 |
| `poker` | **Tenceur Hold'em** | `ia.tfmc_games:oseni_1` | french_52 | small blind 5 / big blind 10 (advisory only), Ace plays as 14 |
| `draw` | **Five-Draw** | `ia.tfmc_games:seithr_5` | french_52 | no blinds, no ante, Ace plays as 14 |
| `freeplay` | **Free play** | `ia.tfmc_games:cerrith_10` | french_52 | no rules; anyone can sneak-take the pot |

**The deck is themed to TFMC lore.** The four suits are **cerrith, mitlan, oseni, seithr** — the server's elements — not hearts/clubs/diamonds/spades (`Games\cards.yml`). Cards are ItemsAdder items `ia.tfmc_games:<suit>_<1..13>`. Ace is catalogue rank **1** but plays as **14** in all three ranked games. Two sets are defined: `french_52` (all 52) and `french_54`.

**Items**: `ia.tfmc_games:deck` = **"Deck of Cards"**, `ia.tfmc_games:card_back` = **"Card Back"** (`ItemsAdder\contents\tfmc_games\contents\items.yml`).

**Chips and pot items** (`Games\config.yml` → `wager`):
- Gold chips render as `ia.tfmc:gold_coin` (**"Gold Coin"**), stacked 6 high, drawn in 3-D with random yaw.
- Silver chips use `m.currency.silver_coin`.
- A `v.gold_ingot` is accepted as a pot item worth **1**.

**Live tables on this server**: exactly **one** — a Blackjack table in world `TFMC_Map` at **x 7368.5, y 186.0, z 4039.5**, owned by player UUID `39b4b314-95f9-488a-9fa1-8afef0bb4907`, auto-dealer on, staff-minted house, min bet 10, max bet 1000, 6 boxes, `SHOE` shuffle policy (`Games\Data\tables\8855d9e7-a107-4cb6-bdc4-3c7c7ac0598c.json`).

### Player command table

All three permissions below are declared **`default: true`** in `games-0.1.0.jar`'s `plugin.yml` — i.e. granted to everyone.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/games` | — | Prints the usage line appropriate to your permissions | |
| `/games help` | — | Opens the "Table games" index book | `games.help`, default **true** |
| `/games help <blackjack\|poker\|draw\|freeplay>` | — | Opens that game's rule book | `games.help`, default **true** |
| `/games bet min <n>` | — | Sets the table minimum (as the dealer at the shoe) | `games.bet`, default **true** |
| `/games bet max <n>` | — | Sets the table maximum | `games.bet`, default **true** |
| `/games bet open` | — | Opens betting for a round | `games.bet`, default **true** |
| `/games bet close` | — | Closes betting | `games.bet`, default **true** |
| `/games bet hit \| stand \| double \| split` | — | Blackjack action on your turn | `games.bet`, default **true**. Identical to typing the word in chat |
| `/games bet check \| call \| fold \| raise` | — | Hold'em / Five-Draw action on your turn | `games.bet`, default **true**. Put coins on the felt **before** `raise` |
| `/wager <amount>` | — | Proposes the item you are holding as a stake; the table votes | `games.wager`, default **true** |
| `/wager accept` | — | Votes yes on a proposed wager | `games.wager`, default **true** |
| `/wager decline` | — | Votes no | `games.wager`, default **true** |

Everything else — placing a table, dealing, betting coins, drawing, discarding, revealing, taking the free-play pot — is **clicks and chat words, not commands**.

Chat words recognised at a table (no prefix, only on your turn): `hit`, `stand`, `double`, `split`, `check`, `call`, `raise`, `fold`, and `draw` (Five-Draw stand-pat only).

**Admin/staff commands excluded** (`games.admin`, default op): `/games reload` (child `games.admin.reload`), `/games deck`, `/games deck test`, `/games display`, `/games place [poker|draw|blackjack|freeplay]`, `/games payout [player]`, `/games session start|stop`, `/games deal`, `/games deal table`. Also the permission `games.autodealer.staff` (default op) — staff-mint auto-dealer and the table-options mint toggle.

### Numbers that matter to players

| Thing | Value |
|---|---|
| Leave distance (all four games) | 6 blocks |
| Display render range | 48 blocks |
| Blackjack min / max bet (the one live table) | 10 / 1000 denar |
| Blackjack boxes per table | 6 |
| Hands per box after splits | 4 (three resplits) |
| Resplitting aces | **not allowed** |
| Dealer hits soft 17 | **no** |
| Blackjack betting window | 10 seconds |
| Round-end window | 10 seconds |
| Hold'em blinds (advisory) | small 5 / big 10 |
| Wager vote window | 30 seconds |
| Seconds to place an accepted loot wager | 10 |
| Buy-ins needed for a wager to auto-accept | 1 |
| Chip stack height | 6 per pile |
| Card set size | 52 |
| Blackjack payouts | win returns double your stake; natural 21 pays 3:2; push returns your stake |

Guild-owned tables have an **auto-dealer table cap** driven by the SimpleFactions guild modifier `AUTO_DEALER_TABLES` (`guild\GuildTables.java`). A guild table's float and its winnings belong to the **guild bank**, not to whoever is dealing; a table with no guild behind it is stocked out of the dealer's own pocket — the help book puts it as *"The money is the guild's either way, so keep your own coins in your pocket."*

### Features configured but INERT

- **`french_54` is a duplicate of `french_52`.** Jokers do not exist. The config says so: *"french_54 matches french_52 until joker textures exist."* No game references `french_54` anyway.
- **Poker and Five-Draw blinds are decorative.** `blinds: {small: 5, big: 10}` is displayed above the table but nothing is ever posted automatically. Do not tell players blinds are taken for them.
- **Only one table exists on the live server** — a single Blackjack table. Tenceur Hold'em, Five-Draw and Free Play are fully implemented but currently have **no placed table anywhere**; players must place their own with a Deck of Cards.
- **`wager.items` defines exactly one non-coin stake**: `gold` = `v.gold_ingot`, worth 1. Anything else must go through the `/wager` vote.
- **`wager.audit-log: false`** — denar movements are not logged to console. Staff-side only.
- **`voice.channel: rp`** — Blackjack actions are echoed as RP speech ("Hit.", "Stand.", "Double.", "Split.") into an `rp` chat channel. This only does anything if such a channel exists.
- **Pouch cash-out is not this plugin.** The config notes: *"Pouch cash-out is /deco toitem, not this plugin."*
- `debug: false`; `card-sound` and `chip-sound` are both enabled (`ITEM_BOOK_PAGE_TURN`, `ENTITY_EXPERIENCE_ORB_PICKUP`).

### Cross-links

- **DenarEconomy** — all money, and **citizen tax on net profit** from a table round (`wager\CitizenTax.java` calls `doTaxes`, so SimpleFactions records the levy like any other earned income).
- **SimpleFactions** — guild-owned tables, the guild bank as house float, and the `AUTO_DEALER_TABLES` guild modifier capping auto-dealing tables per guild.
- **RPCharacters** — names at the table and in showdown messages are **character names**, not account names (`voice\RpNames.java`).
- **ItemsAdder** (`tfmc_games` namespace) — the deck, card back, all 52 card faces; plus `ia.tfmc:gold_coin` for chips.
- **ProtocolLib** — cards are packet-level fake ItemDisplays, so only nearby players see them.
- **MMOItems** — `m.currency.silver_coin` for silver chips.
- **TLibs** — item path resolution for every `ia.` / `m.` / `v.` reference.

### Uncertain / unverified

- Whether any player can pick up **someone else's** table, or only the owner/guild — the `pickup` path was read but its permission guard was not traced.
- **How a player obtains a Deck of Cards** (`ia.tfmc_games:deck`) — no recipe, crate or shop entry was found in the Games folder. It presumably comes from a shop or crate configured elsewhere. *Unconfirmed.*
- The chat-channel plugin backing `voice.channel: rp`.
- The sitting/`GSit` connection is inferred from the `hand.sit-*` config keys and the fact that GSit is installed; it is **not** confirmed in code.
- `Games\messages.yml` (12 KB) was not read line-by-line, so some system-message wording above is paraphrased from message keys. The help-book text quoted is **verbatim**.

---

## ConditionalEvents

### What it is

A rules engine that sits silently behind the whole server: it watches what you do — commands you type, items you right-click, blocks you touch, where you stand, what you say in chat — and fires off scripted reactions (messages, sounds, teleports, items, rank perks, boss spawns) without you ever opening a menu for it.

Source of record: `C:\Users\MSI\Desktop\plugins\ConditionalEvents\config.yml` and the 19 files in `C:\Users\MSI\Desktop\plugins\ConditionalEvents\events\`.

### How a player actually uses it

You never "open" ConditionalEvents. It has no player-facing GUI and its only real command (`/ce`) is admin-only. Instead it manifests three ways:

1. **It is the engine behind most `/tfmc ...` commands.** `/tfmc` itself is registered by a separate plugin (`C:\Users\MSI\Desktop\plugins\AACommandsFiller\config.yml`, `base-command: tfmc`) purely so the command exists and tab-completes; ConditionalEvents supplies every subcommand's actual behaviour. So `/tfmc claim`, `/tfmc masks`, `/tfmc date`, `/tfmc parrot` etc. are ConditionalEvents events.
2. **It makes special items "do things" when right-clicked.** Right-clicking a Skill Training Manual, a gemstone pouch, a Completed Thesis, a boss ticket, a rank-redemption dye, or the Deep Sea Conch runs a ConditionalEvents script that consumes the item and gives you the payoff.
3. **It reacts to where you are and what you say.** Standing within a few blocks of a cave mural quietly grants you a hidden progress flag. Saying a specific phrase near a certain altar unlocks a passage. Swimming into a particular deep-sea area without Water Breathing inflicts Wither. None of this is announced.

Concrete examples a player would recognise:
- You log in and immediately see "Welcome, <name>, to TFMC Roleplay!" plus four setup tips — that is a `player_join` event.
- Every 30 minutes a yellow tip appears in chat. That is the `repetitive_tips` event, and `/tfmc tips disable` turns it off by granting yourself a permission node.
- You type `/ooc gg` and nothing visible happens, but a Codex achievement silently unlocks.
- You type `/me waves` and get "Nice try, buster." — the command was cancelled.

### Content it adds ON THIS SERVER

#### Boosters — `events\a_boosters.yml`

| Trigger | Conditions | What you see/get |
|---|---|---|
| `/tfmc booster` | Requires rank prefix `prefix.40.&6Ascended` or `prefix.50.&6Legacy`. 3-day (259,200 s) cooldown. | Six MMOCore profession boosters at 1x for 3,600 s each: agriculturist, alchemist, engineer, forester, miner, smith. **Server-wide announcement** to all players: "Thank you, {player}, for supporting TFMC!" in a purple (Ascended) or green (Legacy) gradient, followed by "You can support us on patreon.com/c/TFMCRP". |
| Same, no qualifying rank | — | "This command only works for Ascended Donators: https://www.patreon.com/c/TFMCRP" |
| Same, on cooldown | — | "You need to wait <time> before boosting again." |

Hidden rules: **Gilded and Noble donors are NOT eligible** for `/tfmc booster` — only Ascended and Legacy. The booster is a *global* announcement, so using it publicly outs you as a donor.

#### Masks & banner patterns — `events\a_masks.yml`

| Trigger | Conditions | Outcome |
|---|---|---|
| `/tfmc masks` | 10 s cooldown, no permission gate found | One **random** MMOItems mask (1-in-10 each): `MASKS:GHOST_MASK` "Ghost Mask", `MONSTER_MASK` "Monster Mask", `ONI_MASK` "Oni Mask", `URUKHAI_MASK` "Uruk-hai Mask", `SAMURAI_MASK` "Samurai Mask", `STEAMPUNK_MASK` "Steampunk Mask", `STEAMPUNK_ROBOT_MASK` "Steampunk Robot Mask", `SKELETON_MASK` "Skeleton Mask", `SKELETON_MASK2` "Wither Skeleton Mask", `ZERRATORIS_MASK` "Original Zerratoris Mask". Names verified in `C:\Users\MSI\Desktop\plugins\MMOItems\item\masks.yml`. |
| `/tfmc patterns` | 10 s cooldown | Ten vanilla banner patterns in one go: flower, guster, field_masoned, skull, mojang, globe, piglin, flow, creeper, bordure_indented. |
| Either on cooldown | — | "This command has a 10 second cooldown." |

#### Tips & chat toggles — `events\a_tips.yml`, `events\a_commands.yml`

- Every **30 minutes** (`repetitive_time: 36000` ticks) one random tip from the pool is shown, only if you do **not** have `tips.off`. Each tip is followed by "Disable tips at any time by using /tfmc tips disable."
- `/tfmc tips disable` → sets `tips.off` → "Disabled Chat Tips!"; `/tfmc tips enable` → unsets it → "Enabled Chat Tips!"
- `/tfmc chatbubbles enable` / `disable` → sets/unsets the `chatbubble.see` permission → "Enabled Chat Bubbles!" / "Disabled Chat Bubbles!"
- Tip content includes the server's current act: **"The server is currently on the Prologue, with Iron as the standard material."** The Act I (Steel), Act II (Abyssalite) and Act III (Mythril) lines are commented out — the server is canonically in the Prologue.
- Other tips point at `/helpop`, `/vote`, `/tfmc help`, `/tfmc pvp nonlethal`, `/tfmc chatbubbles`, bundles, `/class` and `/profile`, `/faction create`, `/codex`, `/channeltoggle`, and the Discord.

#### Join sequence — `events\a_commands.yml`

On every join: "Welcome, %player%, to TFMC Roleplay!" / "To apply the Resource Pack use the command /tfmc pack." / "To see the different help options use the command /tfmc help." / "To claim your daily rewards do /tfmc claim."
If you have `tfmcresourcepack.enable`, after a 2-second delay it runs `iatexture` for you and says "Applied Resource Pack!" plus "If you still cannot see the textures, consult the Discord FAQ or open a Ticket."

#### Daily rewards — `events\a_commands.yml`

| Rank | Cooldown | Reward |
|---|---|---|
| Everyone | 24 h (86,400 s) | 2x `vote_3` crate keys. "You have claimed your rewards!" |
| Noble (`noble`) | 24 h | 2x `vote_3` keys **+** 1 Item Skin Scroll: 50% Common, 30% Rare, 10% Epic, 10% Legendary |
| Gilded (`gilded`) | 24 h | 2x `vote_3` keys **+** 1 Item Skin Scroll: 25% / 25% / 25% / 25% |
| Ascended (`ascended`) | 24 h | 2x `vote_3` keys **+ 2x** of one Item Skin Scroll tier: 10% Common, 10% Rare, 30% Epic, 50% Legendary |
| Legacy (`legacy`) | 24 h | 2x `vote_3` keys **+ 2x of every tier** (2 Common, 2 Rare, 2 Epic, 2 Legendary — 8 scrolls, guaranteed) |

Item ids: `LOOT:COMMON_ITEM_SKIN_SCROLL` "Common Item Skin Scroll", `RARE_ITEM_SKIN_SCROLL` "Rare Item Skin Scroll", `EPIC_ITEM_SKIN_SCROLL` "Epic Item Skin Scroll", `LEGENDARY_ITEM_SKIN_SCROLL` "Legendary Item Skin Scroll". On cooldown: "You need to wait <time> before claiming your daily reward again."

#### Calendar / in-world date — `events\calendar.yml`

`/tfmc date` prints two lines derived from the **real-world local server date**:
- Weekday → "The stars reveal this day as ..." — Monday **Morindas**, Tuesday **Erindas**, Wednesday **Varindas**, Thursday **Othrindas**, Friday **Fierindas**, Saturday **Saerindas**, Sunday **Suparindas**.
- Month → "The turning of the seasons brings the month of ..." — Jan **Seith Jar**, Feb **Seith Fer**, Mar **Cerr Mar**, Apr **Cerr Ael**, May **Cerr Mes**, Jun **Oss Jer**, Jul **Oss Jul**, Aug **Oss Aer**, Sep **Mit Set**, Oct **Mit Ocs**, Nov **Mit Nor**, Dec **Seith Des**.

#### Codex — `events\codex.yml`

**Joke/hidden achievements.** These fire on the *arguments of any command you type* (so chat channel commands count) and are one-time:

| Say / do | Codex achievement |
|---|---|
| "tf" / "TF" | `tf` |
| "gg" | `gg` |
| "skill issue" | `no_u` |
| "find out ic" | `find_out_ic` |
| "erp" | `erp` |
| "if i speak" | `if_i_speak` |
| "hoi4" / "hoi 4" / "HoI IV" | `hoi4` |
| `/afk` | `afk` |
| "one sex" | `one_sex` |
| "tommykay" / "tommy kay" | `tommykay` |
| "aneesh" / "Olyn" / "0lyn" / "_sly" / "apostasy" / "fa1c" | `aneesh` |
| Die once | `die` |

**Hidden restriction — metagaming block.** Typing `/describe`, `/minecraft:me`, `/minecraft:msg`, `/minecraft:eme`, `/eme`, `/minecraft:tell` or `/minecraft:w ` is **cancelled outright** with "Nice try, buster." and unlocks the `metagaming` achievement. This is the most player-relevant silent rule in the file: the vanilla-namespaced chat commands are deliberately unusable.

**Codex completion rewards** (checked every 5 s, one-time):

| Condition | Reward |
|---|---|
| All 9 Three Kingdoms discoveries (justinia, doulons, arves, baldria, ivrium, valoris, histom, faunon, nerresia) | Research Paper `RESEARCH:R_THE_THREE_KINGDOMS`, message "You have toured the Three Kingdoms of Calavorn, and feel confident enough to conduct a proper study... You have received the Research Paper for The Three Kingdoms!" |
| >=36 Calavorn discoveries | Research Paper `RESEARCH:R_CALAVORN` — "You have explored all of Calavorn in its natural beauty..." / "You have received the Research Paper for Calavorn!" |
| >=37 Calavorn discoveries | Achievement `calavorn_100` |
| >=12 Three Kingdoms discoveries | Achievement `threekingdoms_100` |
| >=5 / >=10 / >=25 / >=49 Research discoveries | Achievements `5_research`, `10_research`, `25_research`, `all_research` |

**The Mural chain (secret).** Stand within 4 blocks of four cave murals in TFMC_Map — `390,110,2655`; `291,110,2710`; `2246,121,2954`; `888,102,2213`. Each grants a hidden permission (`mural.beast`, `mural.sun`, `mural.spell`, `mural.summon`). From the second one onward you get: "You have seen a mural like this one before... What could they possibly mean...?" With all four: "You have discovered several murals across Calavorn, and feel confident enough to conduct some research... You have received the Research Paper for The Calavorian Murals!" plus `RESEARCH:R_THE_CALAVORIAN_MURALS`.

Then a 5-stage treasure hunt with the "Book of Mural Research" (MAGMA_CREAM, CustomModelData 108) and the "Enchanted Parchment" (PAPER, CMD 21). Holding and right-clicking it anywhere within 128 blocks of the target spawns happy-villager particles at the exact spot, and within 1 block it upgrades the paper. Out of range: "Your notes can only help if you know where to look..." Locations in order:
1. `1147, 232, 2624` → MURAL_PAPER_1
2. `882, 91, 3580` → MURAL_PAPER_2
3. `3681, 64, 3126` → MURAL_PAPER_3
4. `2391, 127, 1218` → MURAL_PAPER_4
5. `69, 203, 2087` → MURAL_PAPER_5 **and** you are added to the WorldGuard region `decarith_mural` and given group `group.decarith_mural`

Finally, the Decarith candle puzzle near `1306,169,960`: light three candles at `1302,171,958`, `1309,170,956`, `1308,171,964` with **Flint and Steel** (holding anything else: "You lack the tool to light these candles..."). Each lighting forcibly turns your camera to face `1311, 170.5, 960`, gives Slowness, and the candle **burns out after 2,400 ticks (120 s)** — so all three must be lit inside two minutes. Completing it consumes MURAL_PAPER_5 and unlocks Codex special `cavepaintings`.

**The Umbrythikon (secret).** Carry the book `LORE:UMBRYTHIKON` (BOOK, CMD 51, lore "An ancient magical tome, that seems as...") and, at most once per 10 minutes, it whispers to you — but only while you have **not** yet unlocked Codex special `the_umbrythikon`. Lines include: "You suddenly start trembling and feel an insatiable sensation of thirst...", "You feel shivers along your body as if something is trying to speak with you...", "Seek the eye that glimpses the viridian barrier...", "Beyond the far Reach... Beyond the earthen spires... Gaze into the beyond...", "Above the united grass and remorseless cold, your altar beckons...", "Follow the dusk until you can follow no more...", "Let us be one... Let us be whole...". Right-clicking `76, 251, 3436` while holding the book teleports you into the lair at `77, 246.5, 3433.5` with a blindness/slowness transition; the block at `77, 247, 3434` takes you back out. Touching `74, 235, 3415` starts a forced ~35-second cutscene (Slowness X for 660 ticks, Darkness) with distorted screams and the lines "We are many... We are everywhere...", "Those who know us... will know all that we know...", "...and all will know the true extent of our influence, one way or another..." and unlocks Codex special `the_umbrythikon`.

**The Deep Sea / Planewalker chain (the longest secret).**
- Right-click the amethyst block at `3644, -22, 2521` → "You attempt to pull the black shell from the altar..." → receive the Deep Sea Conch (`LORE:DEEP_SEA_CONCH`, AMETHYST_SHARD, CMD 23) and permission `deepsea.conch`.
- Right-clicking the Conch anywhere (30-minute cooldown) plays `lore.ocean_song` and blinds/slows you for ~16 s: "You hold your ear up to the conch, and listen..." → "You decide to lower the conch." On cooldown: "The ocean's song is too faint... You can listen again in <time>."
- Right-clicking it within 3 blocks of `799, 132, 1770` is different: **by day** (world time <=12786 or >=22331) you get the hint "Maybe you should come back here at night..."; **at night** it spawns `True_OceanSpirit` and 16 `OceanSpirit` mobs around you and says "Wait... that sound's not coming from the conch!"
- Clicking the Allay named "♫" (needs `deepsea.conch`) gives **Water Breathing for 1,200 ticks (60 s)**.
- Then, submerged in water near `799,132,1770` with Water Breathing active, you are teleported to the underwater ruin at `-772.5, 179, 2281.5`.
- **Hidden danger:** within 56 blocks of `-735, 155, 2244`, in Survival, **without** Water Breathing you get "The abyssal depths become suffocating..." and **Wither III for 2,400 ticks (120 s)**, re-applied every 120 s.
- The block at `-772, 155, 2285` takes you to the Planewalker's Workshop (`-783, 140, 2461`), which also cures the Wither. The workshop has 12 individually inspectable props, each with its own flavour text (crown replica, brewing potions, unrecognisable globe, over-engineered Delorian compass stuck on high arcane radiation, fresh fruit, amphibian fossil, Arcane Extractor with a Delorian star, everlasting fireplace, blueprint book, sample vials with "enchanted dust and elderwood sap... flaky scales and human blood", saltwater cauldron).
- The grand book at `-746, 135, 2489` grants `deepsea.smudge` and a clickable message linking to an image of a "smudged line of ink".
- Then, standing within 3 blocks of `854, 160, 787`, **typing the phrase "The Cerrith Core's Altar" in chat** produces "Offer to nature, and nature will reward in turn..." Right-clicking `854, 159, 787` while holding the Conch consumes it, grants `deepsea.offering`, and inverts you into a mirrored dive (Nausea + Slowness X + Water Breathing 6,000 ticks, teleport to `839.5, 145, 787.5`). Afterwards the same block is a reusable dive portal on a **1-hour cooldown** ("You need <time> to recover from your last dive.").
- Post-braille: with `deepsea.offering` **and** `deepsea.braille`, right-clicking empty air at `1582, 70, 1847` with an empty hand grants `deepsea.purge` and drags you underwater to `1579.5, 43, 1843.5`. Escape at `1571, 46, 1890` → "As you slip past the rubble, and into the light, a familiar heartbeat rings through your body..." then "You are nearing the end now."
- The heart at `3643, -14, 2521` speaks a cipher: "Pw rcl ybvqzlhrrr, fae, pvrx wl ua ps jxofp bh tzkvl?" Speaking any of **Hwbr, Jfmr, Dmtdvv, Fvedwd, Gvwsrh, Iehssp, Zmvffqofog** in chat within 10 blocks opens a water passage at `3644,-19,2513` for 600 ticks (30 s).
- Entering `3644, -19, 2512` starts the one-time Planewalker conversation: ~2 minutes of dialogue from "?????" ("This path I have walked... The burden I have carried...", "...the war... only changed its course. The agents of the Void remain at large...", "May we have something for which to fight, not to salvage...", "We will meet again in time. Till then... grow strong, and stand with your brethren as united people."), awards `LORE:MITLAN_RUNESTONE`, and returns you to `3673.5, 62.5, 2498.5`.
- Separately, right-clicking any MAGMA_CREAM item whose lore line 6 or 7 reads "Type: Mitlan" opens Codex page `planewalker_puzzle_page1` and adds you to WorldGuard region `ocean_song_ruin`.

#### Research — `events\codex_research.yml`

Two item shapes, both PAPER:
- **"Completed Thesis Bundle"** (CMD 25) → right-click → consumed, gives **3 copies** of the matching Completed Thesis. Three exist: Revenor ("You have obtained three copies of your studies on Revenor!"), Domenia, Sabarissa.
- **"Completed Thesis"** (CMD 23 for material studies, CMD 25 for lore studies) → right-click → consumed, unlocks the matching Codex entry. One-time per player. If you already have it: "You have already unlocked this Research." / "Perhaps somebody else may be willing to purchase it...?" — i.e. **duplicate theses are meant to be traded or sold to other players**, and the item is *not* consumed in that case.

49 studies are wired up. Material/`research` category (CMD 23): Ignitium, Bronze, Abyssalite, Mythril, Elderwood, Demonwood, Enchanted Dust, Arcane Crystals, Gunpowder, Imperial Denar, Orca Scales, Slightly Magic Shards, Runestones, Gemstone Infusion. Lore category (CMD 25): Syrindell, Adavaar, Arboreans, The Imperial Arcane Academy, The Decarian Cataclysm, Vampirism, The Petty Mage Guild, Legends of the Calavorian Sea, The Cervalic Order, The Crown of Servitude, Vestanger, The Decarian Wasteland, The Reclamation, Arcanum Fever, The Solmyrith Empire, Archnecromancer Erandor, Seithr Essence, Arcane Instability, Mitlan the Water Plane, The Oseni Loyalists, Malice Crawlers, The Rothil Zerratoris, Tamarith the Great Elderwood, The Ancient Cerrith, The Ancients, The Cerrithian Schism, The Calavorian Murals, The Arcanum, Arcanum Souls, Ancientorim the Priestess, Limvidar the Widow, Cerrith Cores, Tyvanis, Ramon Zentharon, The Heroes of Bastion, The Delorians. Plus Three Kingdoms (Revenor, Domenia, Sabarissa) and Calavorn.

Three studies are secretly the entry point to the Planewalker chain — **Orca Scales**, **Legends of the Calavorian Sea**, and **Mitlan, the Water Plane** additionally open Codex `planewalker_puzzle_page1` and add you to WorldGuard region `ocean_song_ruin`. **The Calavorian Murals** is unique: it does not unlock a Codex entry at all, it gives you the Book of Mural Research instead, with "You have gained greater insight on the murals of Calavorn... but there is still much to be discovered..." and, if repeated, "You ought to return this to its rightful owner...".

#### Drink building — `events\drinkbuilder.yml`

`/tfmc drinks` opens the DrinkBuilder interface, but **only** for Legacy (`prefix.50`), Ascended (`prefix.40`) or Gilded (`prefix.30`). Everyone else gets "This command only works for Ascended Donators: https://www.patreon.com/c/TFMCRP". No cooldown.

#### Loot rules — `events\loot.yml`

Gemstone pouches (all GOLD_NUGGET, right-click, consumed, XP-orb sound). Each pouch is a **flat 10% for each of 10 gemstones**:

| Pouch (MMOItems id) | Possible gemstones |
|---|---|
| Pouch of Basic Gemstones (`LOOT:BASIC_GEMSTONE_POUCH`) | Agate, Jasper, Onyx, Tourmaline, Pearl, Coral, Chrysoprase, Larimar, Rhodonite, Vesuvianite |
| Pouch of Polished Gemstones (`POLISHED_GEMSTONE_POUCH`) | Turquoise, Peridot, Malachite, Zircon, Apatite, Carnelian, Labradorite, Sardonyx, Variscite, Wulfenite |
| Pouch of Radiant Gemstones (`RADIANT_GEMSTONE_POUCH`) | Aquamarine, Garnet, Opal, Tanzanite, Moonstone, Sunstone, Spinel, Alexandrite, Firestone, Cloudstone |
| Pouch of Mythical Gemstones (`MYTHICAL_GEMSTONE_POUCH`) | Ruby, Sapphire, Topaz, Citrine, Morganite, Crystallite, Tiger's Eye, Serpent's Eye, Musgravite, Taaffeite |

**Pouch of Rare Materials** (`LOOT:RARE_MATERIAL_POUCH`) is explicitly commented "Prologue Rewards" and currently only ever gives **Ignitium** (`MATERIALS:IGNITIUM`): 40% → 3, 30% → 6, 20% → 9, 10% → 12. Expected value 5.4 Ignitium.

**Rank redemption items.** Right-clicking these consumes them and grants a **30-day** temporary LuckPerms rank, with a toast sound and coloured dust particles:
- Blue Dye "Noble Rank" (`LOOT:NOBLE_RANK`), lore line 3 "Right Click to redeem 1 month of [Noble]." → "You have redeemed 1 month of Noble Rank!"
- Orange Dye "Gilded Rank" (`LOOT:GILDED_RANK`) → "You have redeemed 1 month of Gilded Rank!"
- Purple Dye "Ascended Rank" (`LOOT:ASCENDED_RANK`) → "You have redeemed 1 month of Ascended Rank!"

#### Mage staffs — `events\mage_staffs.yml`

Right-clicking a **Major Mana Potion** (SLIME_BALL) restores mana equal to **20% of your Max Mana minus 10**, and **only works if your Max Mana is above 50**. 20-second cooldown. Below 50 max mana the potion silently does nothing. Note the item is *not* consumed by this event.

#### Map — `events\map.yml`

`/tfmc map` → "View the global nations map on: https://www.tfminecraft.net/". 10 s cooldown.

#### Parrot — `events\parrot.yml`

`/tfmc parrot` (5-minute cooldown, no permission gate): you are disguised as a **gray parrot** via LibsDisguises for 20 seconds, given flight at speed 0.1, and told "You are now a Parrot". After 20 seconds flight is revoked. On cooldown: "You need to wait <time> before turning into a Parrot again."

#### Skills — `events\p_skills.yml`

| Item (MMOItems) | Right-click result |
|---|---|
| BOOK "Skill Training Manual" (`BOOKS:SKILL_POINT_BOOK`) | +1 MMOCore skill point, book consumed. "You have gained a Skill Point! Type /skills to use it!" |
| BOOK "Skill Retraining Manual" (`BOOKS:SKILL_REALLOCATION_BOOK`) | +1 skill reallocation point. "You have gained a Skill Reallocation Point! Type /skills to use it!" |
| BOOK "Attribute Tome" (`BOOKS:ATTRIBUTE_POINT_BOOK`) | +1 attribute point. "You have gained an Attribute Point! Type /attributes to use it!" |

#### Lore / staff-run bossfights — `events\r_lore.yml`

Mostly staff tooling, but three parts touch players:
- **`/tfmc poster Zerratoris1`** through **`Zerratoris8`** — each places a Zerratoris propaganda poster image (via the Images plugin) at scale 42.75. These are not in the `/tfmc` tab-completion tree, so they are effectively undocumented.
- **Thalorim bossfight** — a staff-held BOSSFIGHT ITEM triggers a 160-block-radius title card ("Thalorim, the Squire" / "4th Chief Wayfarer of the Rothil Zerratoris") with the `music.lore.zerratoris_battle_squire_finale` track, and a boss bar. A second staff item ("SQUIRE DAGGER - ASCENDANT REVERIE") broadcasts "Thalorim, the Squire is preparing to cast Ascendant Reverie! Take out the Meditation Orbs around the arena to prevent him from recovering health!" and spawns four `Ascendant_Reverie_Orb` MythicMobs at the arena corners around `6837, 53, 2034`.
- **Thalorim Kidnapper Dagger** — a staff PvP item: hitting a player blinds them (Blindness + Darkness, 300 ticks) and **teleports them to `1839, 200, -591`**.

#### Dungeons — `events\x_dungeons.yml`

**Everything in this file is commented out.** No dungeon entry or Codex unlock in this file is live. The commented content shows the intent: a Temporal Crystal Key (GOLD_NUGGET, CMD 59) used on a sea lantern at `2462, -1, 1222` to launch `Minidungeon_1`, and a lantern in `minidungeon2` at `118, 63, 390` to unlock a Codex achievement. Only `minidungeon1complete` in `codex.yml` is live — right-clicking the sea lantern at `1340, 216, 2641` in TFMC_Map while inside MythicDungeons dungeon `dungeon1` holding an item with CMD 60 unlocks the `minidungeon_2` achievement.

#### World bosses — `events\x_world_bosses.yml`

`/tfmc worldboss info` prints the official explainer, verbatim:

> TFMC Roleplay World Boss Info
> There are several world bosses in TFMC. These are hard fights that can grant powerful loot. To start a boss fight you will need the corresponding boss ticket. Each person that wants to take part in the fight will need to use one.
> You can get the tickets in the Voting Crates. To use a ticket you will need to right click 2 times (2nd time to confirm). Once you are in the lobby before the fight, wait for everyone before pressing the soul lantern to start the fight.
> Each boss can only be fought by one group at the same time, so if there is no lantern you will need to wait for the current group to finish. There is no cooldown for fighting the different bosses, but you can always run into the danger of dying. (You can always use an Insurance Ticket if you die).

Two bosses are implemented:

| Boss | Ticket | Lobby lantern (occupancy flag) | Lobby TP | Boss spawn | Exit lantern |
|---|---|---|---|---|---|
| **Withered Remains** / "The Lost Malice Crawler" (MythicMob `withered_remains`) | `LOOT:BOSS_TICKET_1` "Withered Remains Ticket" (GOLD_NUGGET, CMD 73) | `-859, 124, 1851` | `-859, 123, 1861` | `-907.5, 141, 1762.5` | `-940, 181, 1698` → Codex `world_boss_1` |
| **Ice General** / "Vaaramereios" (MythicMob `Ice_General`) | `LOOT:BOSS_TICKET_2` "Ice General Ticket" (GOLD_NUGGET, CMD 73) | `-1355, 127, 1857` | `-1355, 126, 1867` | `-1400.5, 148, 1751.5` | `-1467, 162, 1724` → Codex `world_boss_2` |

First right-click of a ticket gives a staged warning over 12 seconds and grants a temporary 20-second `bossN.accept` permission:
- "Using this ticket again will teleport you to the boss arena lobby."
- "This ticket will only teleport yourself, so if you are in a group you will need several tickets."
- "You will be able to start the fight from the lobby at any time by clicking the soul lantern."
- "Once you use this ticket you won't be able to go back without fighting. For more info check out /tfmc worldboss info."
- "You have 20 seconds to click the ticket again if you want to continue with the fight."

Second click inside 20 s consumes the ticket and teleports you to the lobby. Hidden rules:
- **Non-lethal PvP blocks entry.** If you have `pvp.non_lethal`: "You can't have non lethal active during a boss fight!"
- **Occupancy lock.** If the lobby soul lantern is missing (another group is inside): "There is an ongoing boss fight, please wait until its finished."
- The lantern is removed when a fight starts and restored either when someone clicks the exit lantern, or automatically after **71,800 ticks ~ 59 minutes 50 seconds** — so a stuck arena self-releases after roughly an hour.
- Everyone within **20 blocks** of the entry lantern is pulled into the arena; everyone within **50 blocks** of the exit lantern gets the Codex unlock and the teleport to spawn (`1690, 81, 1939`). Item cooldown on the ticket itself is 12 s.

#### Helper / staff tooling — `events\a_helper.yml`, `events\y_helper.yml`

`/tfmc helper promote|demote` (LuckPerms promote/demote on the `helper` and `helper+` tracks), `/tfmc ban <player> <reason>` (issues an 8-hour tempban and logs it), and a passive logger on `/tempban` for anyone with `tfmc.staff`. Also one player-specific joke: ShayminPlays, WrenPlays and Iphis get `/thievery feedback` run for them 30 seconds after joining, with "Enable them again with /thievery feedback".

### Player command table

`/tfmc` subcommands are registered by AACommandsFiller but implemented here. None of the events below declare a permission of their own, so the "permission" column reflects the permission that actually gates the *outcome*. Where none is listed, any player can run it.

| Command | Aliases | What it does | Notes (permission / default) |
|---|---|---|---|
| `/tfmc claim` | — | Daily rewards: 2 vote_3 keys for everyone, plus Item Skin Scrolls scaled by donor rank | 24 h cooldown. Rank tiers keyed on `legacy`, `ascended`, `gilded`, `noble`; defaults false (purchased ranks). Base reward is ungated. |
| `/tfmc pack` | — | Applies the ItemsAdder resource pack now | Ungated |
| `/tfmc pack auto` | — | Sets `tfmcresourcepack.enable` so the pack applies on every login | Sets the node on yourself; default false |
| `/tfmc pack manual` | — | Unsets `tfmcresourcepack.enable` | — |
| `/tfmc help` | — | Lists the `/help <topic>` topics: chat, professions, factions, commands, lockpicking, voting, movement, pets | Ungated |
| `/tfmc tips disable` | — | Sets `tips.off`, silencing the 30-minute tip rotation | Self-granted; default false |
| `/tfmc tips enable` | — | Unsets `tips.off` | — |
| `/tfmc chatbubbles enable` | — | Sets `chatbubble.see` | Self-granted; default false |
| `/tfmc chatbubbles disable` | — | Unsets `chatbubble.see` | — |
| `/tfmc masks` | — | One random MMOItems mask out of ten | 10 s cooldown. Ungated. |
| `/tfmc patterns` | — | Gives all 10 special banner patterns | 10 s cooldown. Ungated. |
| `/tfmc statues` | — | Gives the Armor Statues datapack book | Ungated |
| `/tfmc date` | — | In-world weekday and month name | Ungated |
| `/tfmc map` | — | Links the nations map at tfminecraft.net | 10 s cooldown. Ungated. |
| `/tfmc patreon` | — | Prints the Patreon link | Ungated |
| `/tfmc parrot` | — | 20 s gray-parrot disguise with flight | 300 s (5 min) cooldown. Ungated — **not** donor-only. |
| `/tfmc booster` | — | 1-hour 1x boosters on all six MMOCore professions + global thank-you broadcast | Requires `prefix.50.&6Legacy` or `prefix.40.&6Ascended`; default false. 3-day cooldown. |
| `/tfmc drinks` | — | Opens DrinkBuilder | Requires `prefix.50`, `prefix.40` or `prefix.30` (Legacy/Ascended/Gilded); default false |
| `/tfmc worldboss info` | — | Prints the world boss explainer | Ungated |
| `/tfmc poster Zerratoris1`…`Zerratoris8` | — | Places one of 8 Zerratoris posters as an image | Ungated, but **absent from the `/tfmc` tab-completion tree** — undocumented in-game |
| `/anvil` | — | Grants then immediately removes 1 MMOCore main EXP (a refresh hack so the anvil GUI updates) | Ungated; runs invisibly alongside the real `/anvil` |
| `/afk` | — | Normal Essentials AFK, **plus** silently unlocks Codex achievement `afk` | Ungated, one-time |
| `/hello` | — | Registered as a command by `config.yml` (`register_commands`) but **no event handles it** | Does nothing |
| `/describe`, `/minecraft:me`, `/minecraft:msg`, `/minecraft:eme`, `/eme`, `/minecraft:tell`, `/minecraft:w` | — | **Blocked.** "Nice try, buster." + Codex `metagaming` | Hard block for all players |

**Admin/staff commands excluded from the table above:**

| Command | Gate |
|---|---|
| `/ce` (alias `/conditionalevents`) with `reload`, `reset`, `enable`, `disable`, `debug`, `call`, `item`, `interrupt`, `help` | `conditionalevents.admin`. The jar's `plugin.yml` declares no `permissions` block, so the node has no declared default and is op-only in practice |
| `/tfmc helper promote` / `/tfmc helper demote` | `helper.promote` / `helper.demote` (and `helper+.*`), surfaced only to `tfmc.helper` or `tfmc.admin` |
| `/tfmc ban <player> <reason>` | `tfmc.helper` — issues a fixed 8-hour tempban plus a log entry |
| `/tempban` (passive logging hook) | `tfmc.staff` |

### Numbers that matter to players

**Cooldowns**
- `/tfmc claim` — 86,400 s (24 h)
- `/tfmc booster` — 259,200 s (3 days)
- `/tfmc parrot` — 300 s (5 min); the parrot disguise and flight last 20 s
- `/tfmc masks`, `/tfmc patterns`, `/tfmc map` — 10 s
- Deep Sea Conch listening — 1,800 s (30 min); near the Mitlan site post-smudge, 120 s
- Inversion dive portal at `854,159,787` — 3,600 s (1 h)
- Umbrythikon whispers — 600 s (10 min) between lines
- Major Mana Potion — 20 s
- Boss tickets — 12 s; the accept window is 20 s
- Chat tips — one every 36,000 ticks (30 min)
- Mural research book / parchment pinging — 10 s

**Chances**
- Every gemstone pouch: exactly 10% per gemstone, 10 gemstones each
- Pouch of Rare Materials: 40% / 30% / 20% / 10% for 3 / 6 / 9 / 12 Ignitium
- `/tfmc masks`: 10% per mask
- Daily claim scroll tiers: Noble 50/30/10/10, Gilded 25/25/25/25, Ascended 10/10/30/50 (x2 copies), Legacy guaranteed 2 of each tier
- `/tfmc booster` gives a flat 1x multiplier, not a random one

**Durations & limits**
- Booster duration: 3,600 s (1 h) per profession, six professions
- Rank redemption dyes: 30 days of Noble / Gilded / Ascended
- World boss arena auto-unlock: 71,800 ticks ~ 59 min 50 s
- World boss entry pull radius: 20 blocks; exit reward radius: 50 blocks; boss title card radius: 80 blocks
- Decarith candles stay lit for 2,400 ticks (120 s) — the three-candle puzzle has a two-minute window
- Ocean Spirit Allay grants Water Breathing for 1,200 ticks (60 s); dive portals grant 6,000 ticks (5 min)
- Abyssal suffocation: Wither III, 2,400 ticks (120 s), reapplied every 120 s
- Umbrythikon lair cutscene: Slowness X for 660 ticks + Darkness for 550 ticks, roughly 35 s of forced immobility
- Helper tempban: fixed 8 hours

**Codex thresholds**
- Calavorn: 36 discoveries → Research Paper; 37 → `calavorn_100`
- Three Kingdoms: all 9 named discoveries → Research Paper; 12 → `threekingdoms_100`
- Research: 5 / 10 / 25 / 49 discoveries → four achievements

**Date/time windows**
- `/tfmc date` reads the **real-world server date**, not in-game time.
- The Deep Sea Conch at `799,132,1770` behaves differently by **in-game world time**: the spirit event only triggers between world time 12786 and 22331 (night). Outside that you are told to come back at night.

### Features configured but INERT

These must **not** be presented to players as things to chase.

1. **`event_booster`** (`events\a_boosters.yml`, line 39) — `enabled: false`. A server-start event that would give the whole server 24-hour boosters on main + all six professions. Dead.
2. **`thalorim_bossbar`** (`events\r_lore.yml`, line 10) — `enabled: false`.
3. **All of `events\x_dungeons.yml`** — every event in the file is commented out. There is no working Temporal Crystal Key dungeon entry and no `minidungeon2` lantern Codex unlock.
4. **All of `events\z_inactive_events.yml`** — the only content is a commented-out `/redeem TFMC` / `/code TFMC` redeem-code template. **There is no working redeem code command.**
5. **`/tfmc unparrot`** (`events\parrot.yml`) — the `parrot_undisguise` block is indented *inside* the `parrot` event instead of at the `Events:` level, so it is not a registered event at all. Its command is also misspelled (`undisguiseplaye`, missing the final `r`). The command does nothing; the disguise expires on its own after 20 s regardless.
6. **Chat tips 17 and 18** — `repetitive_tips` rolls `%random_1_16%` but `random_tips` defines branches for values 1–18. The "Server Lore channel" and "/channeltoggle" tips can never be selected.
7. **Umbrythikon whisper lines 8 and 9** — the two rarest lines ("Do not deny me... Do not deny them..." and "You are powerful... Valuable... Worthy of my blessing...") are gated on `%umbrythikon%` rather than `%umbrythikon_hints%`, a variable that is never set. These lines almost certainly never fire.
8. **`deepsea.braille` is never granted.** The post-braille chapter at `1582,70,1847` requires both `deepsea.offering` and `deepsea.braille`, but **nothing anywhere in the ConditionalEvents config grants `deepsea.braille`** (verified by a full-directory grep; it appears exactly once, in `codex.yml:1443`). Unless another plugin or a staff member grants it manually, the entire final Planewalker chapter — the underwater ruin, the cipher, the Planewalker conversation and the Mitlan Runestone — is unreachable through ConditionalEvents alone.
9. **Duplicate helper events** — `helper_promote` and `helper_demote` are defined identically in both `events\a_helper.yml` and `events\y_helper.yml`. Only one set can be active.
10. **Commented-out Act I/II/III tips** — the server-act tip is hard-locked to "Prologue / Iron".
11. **`config.yml` leftovers** — `register_commands: ["hello"]` registers a `/hello` command with no handler, and `to_condition_groups.group1` references `conditionalevents.somepermission`, which no event uses. Both are unmodified plugin-template defaults.
12. **`saved_items.yml` is empty** (0 bytes) — no saved item references are in use.

### Cross-links

ConditionalEvents is the glue layer and touches nearly everything:

- **AACommandsFiller** (`C:\Users\MSI\Desktop\plugins\AACommandsFiller\config.yml`) — registers `/tfmc` and its subcommand tree; CE supplies the behaviour. Any `/tfmc` wiki page is really a joint page for these two.
- **MMOItems** — `mi give` / `mi take` for every mask, pouch, gemstone, research paper, book, boss ticket, rank dye and lore relic. Item types used: `MASKS`, `LOOT`, `GEMSTONES`, `MATERIALS`, `BOOKS`, `RESEARCH`, `LORE`.
- **MMOCore** — profession boosters, skill points, skill reallocation points, attribute points, main EXP, and mana.
- **MythicLib** — `%mythiclib_stat_max_mana%` gates the Major Mana Potion.
- **Codex** — `codex unlock` / `codex open` for every achievement, discovery and puzzle page; the `%codex_*%` placeholders drive the completion rewards.
- **Research plugin** — the thesis/study economy that produces the Completed Thesis items CE consumes.
- **MythicMobs** — world bosses (`withered_remains`, `Ice_General`), Ocean Spirits (`OceanSpirit`, `True_OceanSpirit`, `OceanSpirit_Teleporter`, `OceanSpirit_Inverter`) and Thalorim's `Ascendant_Reverie_Orb`.
- **MythicDungeons** — `%md_dungeon_name%` gates the `minidungeon1complete` Codex unlock; the rest of the dungeon integration is commented out.
- **LuckPerms** — CE grants, revokes and temp-grants permissions constantly: `tips.off`, `chatbubble.see`, `tfmcresourcepack.enable`, `mural.*`, `deepsea.*`, `group.decarith_mural`, `boss1.accept`/`boss2.accept` (20 s temp), and the 30-day `noble`/`gilded`/`ascended` rank grants.
- **WorldGuard** — `rg addmember -w TFMC_Map` adds players to the `decarith_mural` and `ocean_song_ruin` regions as secret-chain progress markers.
- **ExcellentCrates** — `crates key give ... vote_3` for daily rewards; the boss tickets come from Voting Crates.
- **VotingPlugin / VotifierPlus** — the vote crate keys and the `/vote` tip.
- **LibsDisguises** — the `/tfmc parrot` disguise.
- **DrinkBuilder** — `/tfmc drinks`.
- **ItemsAdder** — `iatexture` for the resource pack; also the source of the custom sounds (`custom.slash2`, `aa.distorted_scream`, `lore.ocean_song`, `lore.siren_song`, `music.lore.zerratoris_battle_squire_finale`).
- **Images** — `/tfmc poster Zerratoris1-8`.
- **Essentials** — `tempban`, `fly`, `flyspeed`, `sudo`, `/afk`, `/anvil`.
- **Thievery** — the per-player `thievery feedback` join hook.
- **PlaceholderAPI** — heavily used, including the `CheckItem` expansion and `localtime` for the calendar.
- **SimpleFactions**, **TAB**, **GSit** — referenced incidentally.
- **Not touched by ConditionalEvents:** no DenarEconomy transactions, no MCPets calls, no BreweryX calls (drinks go through DrinkBuilder), and no ItemsAdder `ia.namespace:id` item references appear anywhere in the config.

### Uncertain / unverified

- **Condition-ladder semantics — INFERRED, NOT VERIFIED.** Many events use a ladder such as `<= 10 execute default`, `<= 20 execute default1`, `<= 50 execute default2`. These are read as **first matching bracket wins** (1–10 → default, 11–20 → default1, etc.). This is the only reading under which the daily-claim tables, the pouch tables and the boss-ticket safety checks make sense. It could not be confirmed from the jar (`javap` unavailable; `VerifyManager.class` not decompiled). If the plugin instead applies last-match-wins, every pouch would always give its 10th gemstone and every daily claim would always give Legendary scrolls — clearly not the design, but the percentages above rest on this reading.
- **Missing MMOItems definitions.** A full grep of `C:\Users\MSI\Desktop\plugins\` found **no definition** for these ids that CE tries to give: `LORE:MURAL_BOOK`, `LORE:MURAL_PAPER_1`…`_5`, `LORE:DEEP_SEA_CONCH`, `LORE:MITLAN_RUNESTONE`, `RESEARCH:R_THE_THREE_KINGDOMS`, `RESEARCH:R_CALAVORN`, `RESEARCH:R_THE_CALAVORIAN_MURALS`, `RESEARCH:CR_THE_CALAVORIAN_MURALS`, `RESEARCH:C_REVENOR` / `C_DOMENIA` / `C_SABARISSA` / `C_CALAVORN` and the `*_BUNDLE` ids, and most of the lore-study `C_*` ids. `MMOItems\item\lore.yml` contains only `UMBRYTHIKON`, `UMBRYTHIKON_PAPER_1-6`, `ILLUSION_*`, `CERRITH_CORE`, `DELORUS_STONE`. Either this plugins directory is a partial snapshot, or these `mi give` calls fail silently in-game. **Undetermined — do not assert these items are obtainable until confirmed in-game.** Note `research.yml` contains bare template entries named `R_`, `C_`, `CR_`, `RR_`, `RH_`, `CH_`, suggesting some research items may be generated rather than statically defined.
- **`hoflog` / `hoflogh`** (used by the helper ban events) — the providing plugin could not be identified; TFMCCore or TFMCWeb is a **guess**.
- **`/tfmc statues`** calls `loot give %player% loot armor_statues:book`. There is no "Loot" plugin in the directory, so this is read as the **vanilla `/loot` command** pulling from an Armor Statues datapack loot table. Consistent but unverified; the world's datapacks folder was not checked.
- **Whether the tip rotation is per-player or global.** Per-player cooldown timestamps in `players\*.yml` suggest per-player, but this is not conclusive.
- **Stale player data.** `ConditionalEvents\players\` (20 files) persists per-player `one_time` flags and cooldown timestamps, including flags for **11 events that no longer exist in the config**: `bloodmagic_dagger_rules`, `bloomagic_complete`, `necromancy_complete`, `necromancy_dagger_rules`, `codex_calavorn_exp_act3`, `codex_research_exp_act3`, `codex_special_exp_act3`, `codex_threekingdoms_exp_act3`, `startdungeon_key_particles`, `tfmc_starter`, `umbrythikon_temple_death`. These are fossils of removed content (blood magic, necromancy dagger rules, an Act III Codex EXP payout, a starter kit, a dungeon key, an Umbrythikon temple death handler). **None of it is live; the wiki must not mention them.** Persisted per-player state is only: event name → `one_time` boolean and `cooldown` (epoch millis). All real progress flags live in LuckPerms permissions and in Codex.
- **`/tfmc starter`, `/tfmc roll`, `/tfmc pvp`, `/tfmc donatorname`, `/tfmc class reset`** appear in the AACommandsFiller tree but have **no ConditionalEvents implementation** — another plugin (likely TFMCCore) handles them. Out of scope here, but flagged so the wiki writer does not assume CE owns every `/tfmc` subcommand.

---

## MCPets

### What it is

MCPets gives you a personal, custom-modelled companion creature — a kitten, dog, fox, otter, frog, or an armed brawler — that follows you around, fights alongside you, levels up, and can be summoned or dismissed from a menu.

### How a player actually uses it

**Obtaining a pet.** A pet is "owned" when you hold its `Permission:` node. Three grant paths exist in config:

1. **Free-for-everyone pets.** Five pets use `Permission: group.default`, which LuckPerms grants to every player in the default group. These are the pets a brand-new player actually has.
2. **Profession perk.** The RPCharacters *Forager* profession sells a perk called **Pet Master** for **4 points**, lore `Unlocks the different Farm pets!` / `Summon with /mcpets and read /help pets`. It grants `mcpet.pet_master_1` (`C:\Users\MSI\Desktop\plugins\RPCharacters\professions\forager.yml`, lines 165–176). **Caveat: no pet file requires `mcpet.pet_master_1`** — see Inert.
3. **Unlock gems (pet foods of `Type: UNLOCK`).** Right-clicking one consumes it and MCPets writes the target pet's permission node straight into LuckPerms (`fr/nocsy/mcpets/utils/PermsUtils.class` → `givePermission`). Defined in `C:\Users\MSI\Desktop\plugins\MCPets\petfoods.yml`.

**Summoning.** Type `/mcpets` (alias `/pets`). A GUI titled `☀ Pets ☀` opens listing every pet you own. Click a pet icon → it spawns next to you: `A pet has been summoned !` Summoning a second pet auto-dismisses the first. `SpawnPetOnReconnect: true`, so your pet comes back automatically when you log in.

**Dismissing.** In the pet's sub-menu (`☀ Pet ☀`) click the nickname item — lore reads `Click here to revoke your pet`. Message: `Your pet was revoked.` The pet also despawns if you go too far and it cannot path back.

**Riding.** Not available. `Mountable: false` in `config.yml` **and** in all 19 pet files. A saddle icon (`Mount` / `Click to mount your pet`) is still built in `menuIcons.yml`, but clicking it produces `This pet has no mounting point.`

**Renaming.** In the pet sub-menu click the name tag (`Rename` / `Click to rename your pet`). Chat prompt: `Write down in the chat the name of your pet.` Type the new name, or `None` to clear it. Max **16 characters** (`MaxNameLenght: 16`). Default name if unnamed is `Pet of <yourname>`, and `OverrideDefaultName: true` forces it over the MythicMob display name. `blacklist.yml` is **empty (0 bytes)**, so no words are filtered.

**Feeding.** Hold a pet food item and right-click your summoned pet. Foods on this server (`MCPets\petfoods.yml`):

| Food | Item key | Type | Effect |
|---|---|---|---|
| Green Concoction | `green_concoction` | EXP | +10 pet XP |
| Red Concoction | `red_concoction` | EXP | +25 pet XP |
| Fish Treat | `fish_treat` | HEALTH | +10 HP |
| Meat Treat | `meat_treat` | HEALTH | +20 HP |
| Pink Donut ("Testing_Food") | `testing_food` | EXP | +2000 pet XP |
| Chips | `chips` | UNLOCK | Unlocks pet `Otter` |
| Assassin's Gem | `assassin_unlock` | UNLOCK | Unlocks `DE_Pet_Assassin` |
| Dark Knight's Gem | `dark_knight_unlock` | UNLOCK | Unlocks `DB_Pet_Dark_Knight` |
| Dragon Warrior's Gem | `dragon_warrior_unlock` | UNLOCK | Unlocks `DD_Pet_Dragon_Warrior` |
| Martial Artist's Gem | `martial_artist_unlock` | UNLOCK | Unlocks `DF_Pet_Martial_Artist` |
| Ninja Samurai's Gem | `ninja_samurai_unlock` | UNLOCK | Unlocks `DG_Pet_Ninja_Samurai` |
| Paladin's Gem | `paladin_unlock` | UNLOCK | Unlocks `DC_Pet_Paladin` |
| Reaper's Gem | `reaper_unlock` | UNLOCK | Unlocks `DH_Pet_Reaper` |
| Warrior's Gem | `warrior_unlock` | UNLOCK | Unlocks `DE_Pet_Warrior` |

The four consumable foods are craftable at the **Animal Station** (`C:\Users\MSI\Desktop\plugins\MMOItems\crafting-stations\animal-station.yml`, lines ~295–355), all gated on `mcpet.pet_master_1`, displayed as `Requires Pet Master I`, 5 s craft time each:
- Green Concoction ← 2× Salmon
- Red Concoction ← 2× Beef
- Fish Treat ← 4× Salmon
- Meat Treat ← 4× Beef

**Pet skills / signals.**
- **No signals are configured.** Zero of the 19 pet files contain a `Signals:` section, so a signal stick has nothing to cast.
- Skills fire **automatically** from MythicMobs, not from player input. Every brawler pet runs `skill{s=Pet_<Name>_Skill} ~onTimer:40` (every 2 s) and `skill{s=EXP_Gain} ~onTimer:100` (`MythicMobs\mobs\3rd Party\Others\Mobs\Pets\rpg_pet_2_mobs.yml`). `EXP_Gain` is `petExperience{exp=1}` and only fires while `incombat true` — **1 XP per 5 seconds in combat**.
- **Right-clicking an animal pet toggles "pacifist" mode** (`Dog_Interact` / `Dog_Mode_Check`, `MythicMobs\skills\3rd Party\Others\Mobs\animal_pet_skills.yml`, line 592+). While tagged `pacifist` the pet stops attacking. 5 s interact cooldown.
- Right-clicking a brawler pet plays a flavour animation only (3 s cooldown, requires out-of-combat).
- Pets only attack via `AITargetSelectors: ownertarget, ownerattacker, monsters` — they never pick fights with players independently.

**Server rules on where pets work** (`C:\Users\MSI\Desktop\plugins\HelpCommand\config.yml`, page 9, `/help pets`): pets may be used while roaming and in normal gameplay; **not** in dungeons, mob-fighting content, plugin wars, exploration maps, or quests. In-game tutorial at `/warp Pets`.

### Content it adds ON THIS SERVER

19 pets. Display names have colour codes stripped. "Model" = ModelEngine `mid`.

| Internal Id | Display name | MythicMob | ModelEngine model | Icon (material / CMD) | Permission | How unlocked |
|---|---|---|---|---|---|---|
| `Catblack` | Black Kitten | `Catblack` | `catblack` | BRICK / 3550 | `group.default` | Everyone |
| `Corgi` | Corgi | `Corgi` | `corgi` | BRICK / 3564 | `group.default` | Everyone |
| `Fox` | Fox | `Fox_fox` | `fox` | BRICK / 3548 | `group.default` | Everyone |
| `Frog` | Frog | `Frog_frog` | `frog` | BRICK / 3549 | `group.default` | Everyone |
| `Otter` | Otter | `NocsyOtter` | `nocsy_otter` | BRICK / 3552 | `group.default` | Everyone; also the target of the `chips` UNLOCK food |
| `Beagle` | Beagle | `Beagle` | `beagle` | BRICK / 3562 | `noble` | See warning below |
| `Catfunny` | Funny Kitten | `Catfunny` | `catfunny` | BRICK / 3551 | `noble` | See warning below |
| `Chihuahua` | Chihuahua | `Chihuahua` | `chihuahua` | BRICK / 3563 | `gilded` | See warning below |
| `Catorange` | Orange Kitten | `Catorange` | `catorange` | BRICK / 3553 | `ascended` | See warning below |
| `Golden` | Golden | `Golden` | `golden` | BRICK / 3565 | `ascended` | See warning below |
| `PickaxeGoblin` | Pickaxe Goblin | `PickaxeGoblin` | `pickaxe_goblin` | IRON_PICKAXE | `mcpet.jake3971` | **Nothing grants it** |
| `DB_Pet_Dark_Knight` | Dark Knight | `Pet_Dark_Knight` | `pet_dark_knight` | BRICK / 3532 | `mcpet.darkknight` | Dark Knight's Gem only |
| `DE_Pet_Assassin` | Assassin | `Pet_Assassin` | `pet_assassin` | BRICK / 3531 | `mcpet.pet_master_2` | Any of the 7 shared gems |
| `DC_Pet_Paladin` | Paladin | `Pet_Paladin` | `pet_paladin` | BRICK / 3541 | `mcpet.pet_master_2` | Any of the 7 shared gems |
| `DD_Pet_Dragon_Warrior` | Dragon Warrior | `Pet_Dragon_Warrior` | `pet_dragon_warrior` | BRICK / 3533 | `mcpet.pet_master_2` | Any of the 7 shared gems |
| `DE_Pet_Warrior` | Warrior | `Pet_Warrior` | `pet_warrior` | BRICK / 3547 | `mcpet.pet_master_2` | Any of the 7 shared gems |
| `DF_Pet_Martial_Artist` | Martial Artist | `Pet_Martial_Artist` | `pet_martial_artist` | BRICK / 3538 | `mcpet.pet_master_2` | Any of the 7 shared gems |
| `DG_Pet_Ninja_Samurai` | Ninja Samurai | `Pet_Ninja_Samurai` | `pet_ninja_samurai` | BRICK / 3540 | `mcpet.pet_master_2` | Any of the 7 shared gems |
| `DH_Pet_Reaper` | Reaper | `Pet_Reaper` | `pet_reaper` | BRICK / 3543 | `mcpet.pet_master_2` | Any of the 7 shared gems |

**Important consequence:** seven of the eight brawler pets share the single node `mcpet.pet_master_2`. Because the UNLOCK food writes that exact node to LuckPerms, **consuming any one of those seven gems unlocks all seven pets at once.** Only the Dark Knight has a private node.

**Advertised pet abilities** (from each pet's icon lore):

| Pet | Skill name(s) | Icon description |
|---|---|---|
| Assassin | Assassination | Teleports to the enemy and slashes them 3 times |
| Dark Knight | Shadow Slash | Slashes the enemy with its sword, knocking them back |
| Dragon Warrior | Dragon Strike / Dragon Soul | Spear strike; every 5th strike summons a dragon soul that breathes fire |
| Martial Artist | Combo Strike | Punches several times with an uppercut at the end |
| Ninja Samurai | Spinning Blade | Slashes through 4 targets while spinning its blade |
| Paladin | Heavenly Smash | Hammer smash that also heals **your** health |
| Reaper | Soul Collector | Absorbs enemy souls and sends them to you — Blue Soul = Speed, Red Soul = Heal |
| Warrior | Axe Smash | Smashes the enemy with its axes |
| All animal pets | `Cat_Skill` / `Dog_Skill` / `Otter_Skill` / `Frog_Skill` | Lore only says "A cutie that will follow you everywhere !" |

**Player data format** (`MCPets\PlayerData\<uuid>.yml`): three keys — `Names: []`, `Inventories: []`, and `PetStats:`, a list of base64-encoded JSON blobs, one per pet, e.g.
`{"petId":"DC_Pet_Paladin","petOwner":"<uuid>","currentHealth":125.0,"experience":0.0,"levelId":"Lvl_Common"}`.
A `PetStats` entry records stats; it is **not** proof of ownership — ownership is the permission node.

### Player command table

MCPets registers exactly **one** command (`plugin.yml` inside `MCPets 4.1.6 (1.21.+).jar`).

| Command | Aliases | What it does | Notes (permission + default) |
|---|---|---|---|
| `/mcpets` | `/pets` | Opens the pet menu listing every pet you own; click to summon | `mcpets.use`, **default: true** — every player has it |
| `/mcpets category <id>` | `/pets category <id>` | Opens a specific pet category menu | `mcpets.use` (default true). **No categories are configured on this server**, so this always returns `This category does not exist.` |
| `/mcpets mount` | `/pets mount` | Attempts to mount your active pet | `ArgumentMount.class` contains **no permission check at all**. Always fails here: every pet has `Mountable: false` → `This pet has no mounting point.` |
| `/mcpets name <name>` | `/pets name <name>` | Renames your active pet from the command line | `ArgumentName.class` contains **no permission check at all**. `Nameable: true` globally, 16-char cap |

**Admin/staff commands excluded** (all verified to test `mcpets.admin`, **default: op**, by decompiling `fr/nocsy/mcpets/commands/mcpets/Argument*.class`): `/mcpets spawn`, `revoke`, `open`, `inventory`, `item list|add|remove|give`, `petFood`, `signalStick`, `clearStats`, `debug`, `editor`, `reload`. Also excluded: `mcpets.color` (default op) for colour codes in pet names.

### Numbers that matter to players

**Global** (`MCPets\config.yml`):
- Right-click pet to open its menu: **on**. Left-click: **off**.
- `DistanceTeleport: 5000` — the pet teleports to you if it falls more than 5000 blocks behind.
- `PercentHealthOnRespawn: 0.2` — a pet respawns at **20% health**.
- `AutoRespawn: false` — you must re-summon a dead pet yourself.
- `MaxNameLenght: 16`; `InventorySize: -1` (pet inventories disabled).
- `AutoSaveDelay: 3600` s (1 h). `BlackListedWorlds: []` — pets work in every world as far as MCPets is concerned.

**Per pet, identical across all 19 files:** `Distance: 6` (follow distance), `SpawnRange: 3`, `ComingBackRange: 3`.

**Cooldowns:** `Respawn: 60` s at every level on every pet. `Revoke: 0` s on all pets **except the Assassin**, which is `Revoke: 1` s.

**Level thresholds (identical on all 19 pets):** Common 0 XP → Rare 500 XP → Epic 5,000 XP → Legendary 30,000 XP. XP accrues at 1 per 100 ticks **while in combat only** — roughly 1 XP / 5 s, so Legendary is about 150,000 s (~41.7 hours) of continuous combat at base rate, ignoring food.

**Regeneration:** 0.1 / 0.12 / 0.15 / 0.2 HP per second at Common / Rare / Epic / Legendary on all pets.
**Resistance modifier:** 1 / 1.2 / 1.5 / 2 on all pets.
**Power:** 1 / 1.05 / 1.3 / 2 on the Assassin; 1 / 1.3 / 1.6 / 2 on every other pet.
**InventoryExtension:** 0 at every level on every pet.

**Health and damage by pet** (Common / Rare / Epic / Legendary):

| Pet | Max health | Damage modifier |
|---|---|---|
| Paladin | 125 / 150 / 200 / 250 | 1.7 / 1.9 / 2.2 / 2.6 |
| Warrior | 125 / 150 / 200 / 250 | 1.9 / 2.1 / 2.4 / 2.8 |
| Ninja Samurai | 100 / 130 / 160 / 200 | 1.8 / 2.0 / 2.2 / 2.5 |
| Reaper | 100 / 125 / 150 / 200 | 2.0 / 2.2 / 2.5 / 3.0 |
| Dragon Warrior | 100 / 125 / 150 / 200 | 1.8 / 2.0 / 2.3 / 2.6 |
| Dark Knight | 100 / 125 / 150 / 200 | 1.4 / 1.6 / 2.0 / 2.4 |
| Fox, Otter | 100 / 125 / 150 / 200 | 1.4 / 1.6 / 2.0 / 2.4 |
| Assassin | 90 / 110 / 130 / 150 | 0.75 / 1.05 / 1.25 / 1.6 |
| Martial Artist | 90 / 110 / 130 / 150 | 0.2 / 0.4 / 0.8 / 1.2 |
| Beagle, Catblack, Catfunny, Catorange, Chihuahua, Corgi, Frog, Golden, Pickaxe Goblin | 100 / 125 / 150 / 200 | 0.7 / 0.8 / 1.0 / 1.2 |

**Underlying MythicMob stats** (identical for all pet mobs): `Damage: 2`, `MovementSpeed: 0.3`, `FollowRange: 15`, `KnockbackResistance: 1`, fall-damage immune, `Silent: true`, `PreventSunburn: true`, `Persistent: false`.

**Mount speed:** n/a — no pet is mountable.

### Features configured but INERT

- **Mounting/riding is entirely dead.** `Mountable: false` globally and on all 19 pets. The saddle icon still exists in `menuIcons.yml`, `/mcpets mount` is permission-free, and `MountType: walking` is set on the Assassin — all of it hits `This pet has no mounting point.`
- **Signal sticks are dead.** No pet defines `Signals:`. The signal-stick config keys, admin command and language strings all exist, but there is nothing to signal.
- **Pet inventories are disabled.** `InventorySize: -1`, `InventoryExtension: 0` at every level. The `Inventory` and `Equipment` icons in `menuIcons.yml` are unreachable in practice.
- **Skins menu is unreachable.** A `Skins` icon exists in `menuIcons.yml` and `pet_skins_title` / `skin_applied` exist in `language.yml`, but no pet file defines a `Skins:` section.
- **`mcpet.pet_master_1` unlocks no pet.** The Forager perk sold for 4 points advertises "Unlocks the different Farm pets!" but **no pet file requires that node**. It only gates the four Animal Station food recipes. The five "farm pets" (Catblack, Corgi, Fox, Frog, Otter) are on `group.default` and are already free to everyone. **This perk currently buys food-crafting access, not pets** — a wiki must not repeat the perk's own lore text.
- **All eight brawler pets are unobtainable through any file-based route.** `mcpet.pet_master_2` and `mcpet.darkknight` are not granted by any profession, crate, shop, vote reward, or event anywhere in `C:\Users\MSI\Desktop\plugins\`. The unlock gems exist as MMOItems (`MMOItems\item\pets.yml`, type `PETS`) but **nothing gives them out**: no ExcellentCrates crate (`festive_crate`, `voting_crate`, `voting_crate_1/2/3`, `war_crate`), no VotingPlugin reward, no MarketBlock/BarterShops/ArmourShop entry, and no ConditionalEvents event references them. Staff-give-only as configured.
- **Pickaxe Goblin is unobtainable.** `Permission: mcpet.jake3971` — a leftover from the model author. Granted nowhere.
- **Five pets have no ModelEngine model.** `beagle`, `chihuahua`, `corgi`, `golden` and `pickaxe_goblin` are referenced by `model{mid=...}` in MythicMobs, but there is **no matching `.bbmodel` in `C:\Users\MSI\Desktop\plugins\ModelEngine\blueprints\` and no entry in ModelEngine's resource pack**. (Present and verified: `pet_warrior`, `pet_dark_knight`, `pet_paladin`, `pet_dragon_warrior`, `pet_assassin`, `pet_martial_artist`, `pet_ninja_samurai`, `pet_reaper`, `nocsy_otter`, `fox`, `frog`, `catblack`, `catfunny`, `catorange`.) These five would spawn as a bare wolf. Their 2-D menu icons (CMD 3562–3565) *do* exist, so they look fine in the GUI and wrong in the world.
- **The five donor pets are probably ungrantable as written.** `Beagle`, `Funny Kitten`, `Chihuahua`, `Orange Kitten` and `Golden` use the bare strings `noble`, `gilded`, `ascended` as their `Permission:`. LuckPerms group membership grants `group.noble` / `group.gilded` / `group.ascended`, not the bare node, and the rank-redeem events do `lp user %player% parent addtemp noble 30d` (`ConditionalEvents\events\loot.yml`, lines 292–332) — which adds the parent, not a bare permission. Compare `catblack.yml`, which correctly uses `group.default`. **See Uncertain — this is an inference.**
- **Pet categories are unconfigured**, so `/mcpets category` can never succeed.
- **MySQL is configured but off in practice.** `DisableMySQL: false` with placeholder credentials (`user`/`password`@`localhost:2560`); the populated flat-file `PlayerData\` is clearly what is in use.
- **`blacklist.yml` is empty (0 bytes)** — no banned words in pet names.
- **Taming is unused.** The `Taming:` block and its messages exist; no pet defines a taming requirement.
- **"Pink Donut" (`testing_food`, +2000 XP)** is a developer test item with no source.
- **`Suspicious Slime` / `Suspicious Carrot`** exist in `MMOItems\item\pets.yml` but are not registered as MCPets pet foods.

### Cross-links

- **MythicMobs** — every pet's entity, AI and combat skills (`mobs\3rd Party\Others\Mobs\Pets\rpg_pet_2_mobs.yml`, `CaveGoblins.yml`, `skills\3rd Party\Others\Mobs\rpg_pet_2_skills.yml`, `animal_pet_skills.yml`). Hard dependency.
- **ModelEngine** — the 3-D pet models. Hard dependency.
- **LuckPerms** — soft dependency; MCPets writes permission nodes directly through the LuckPerms API when an UNLOCK food is eaten.
- **RPCharacters** — the Forager profession sells the `Pet Master` perk granting `mcpet.pet_master_1`.
- **MMOItems** — all pet foods and unlock gems (`item\pets.yml`, type `PETS`) and the Animal Station recipes.
- **ItemsAdder** — the `rpg_pet_pack_vol6_brawlers` content pack supplies the BRICK CustomModelData 3531–3565 menu icons.
- **HelpCommand** — `/help pets` (page 9) documents where pets may be used.
- **MythicDungeons / plugin wars / exploration content** — named in `/help pets` as places pets are *not* allowed.
- **WorldGuard** — soft dependency; `language.yml` has `cant_follow_here` and `not_mountable_here`, implying region flags may restrict pets.
- **EssentialsX** — `/warp Pets` tutorial area.

### Uncertain / unverified

- **The `noble` / `gilded` / `ascended` permission question is an inference, not a verified fact.** LuckPerms stores its data in `C:\Users\MSI\Desktop\plugins\LuckPerms\luckperms-h2-v2.mv.db`, a compressed H2 database; a binary grep for `noble`, `gilded`, `ascended`, `group.noble` and `mcpet.*` returned **zero** matches, so the actual group definitions could not be read. If a staff member has explicitly added a bare `noble`/`gilded`/`ascended` node to those groups, the five donor pets work normally. Settle it in game with `/lp group noble permission info`.
- Whether `mcpet.pet_master_2` or `mcpet.darkknight` is granted directly to a group in LuckPerms — same limitation. The "unobtainable" claim covers every *file-based* grant path in the plugins tree only.
- Whether WorldGuard regions actually carry MCPets flags — region data lives in the world folders, outside the researched directory.
- The `/help pets` restrictions (no pets in dungeons/wars/quests) are **server policy text**; no config mechanically enforcing them was found. It may be enforced by MythicDungeons/region logic, or by staff moderation.
- `DisableMySQL: false` alongside populated flat files is contradictory. Most likely the MySQL connection fails and the plugin silently falls back to YAML; no log was available to confirm.
- The Animal Station food recipes use `command{format="mcpets item give <key>",sender=OP}`. `ArgumentItem` requires a Player sender, and `sender=OP` in MythicLib means the player executes with temporary OP, so this should work — not tested live.

---

## LibsDisguises

### What it is

LibsDisguises is a staff/developer tool that makes an entity look like something else — on this server it is used almost entirely behind the scenes to give roleplay NPCs human skins, not as a player toy.

### How a player actually uses it

**A normal player can do essentially nothing with it.**

Every player-facing command is registered with a `libsdisguises.seecmd.*` permission. Those `seecmd` nodes default to **true** — but they only control whether the command **appears in tab-completion**. The actual disguise permissions (`libsdisguises.disguise.<type>`, `libsdisguises.undisguise`, etc.) are **not declared with any default in the plugin's `plugin.yml`**, are not granted by any config in this tree, and nothing in `C:\Users\MSI\Desktop\plugins\` grants them. `ExplicitDisguises: false` in `commands.yml` does not change this — it governs *option* inheritance once you already hold a disguise permission.

So the realistic player experience is: you see `/disguise` in tab-complete, you type it, and you are refused.

Two things *do* work for a player whom staff has disguised:
1. `/disguiseviewself` (`/dvs`, `/selfd`, …) toggles seeing your own disguise. Backed by `libsdisguises.selfdisguises`, **default: true**. `ViewSelfDisguises: true` and `ViewSelfDisguisesDefault: true` in `self_disguise.yml`, so self-view is on by default.
2. `/disguiseviewbar` (`/dvb`, `/notifybar`, …) toggles the disguise notification bar. `NotifyBar: 'ACTION_BAR'` in `displays.yml` — a disguised player sees a persistent action-bar reminder.

Both preferences persist across restarts (`SaveUserPreferences: true`, stored in `LibsDisguises\internal\preferences.json`).

**What the "masks" actually are — an important correction for the wiki.** `ConditionalEvents\events\a_masks.yml` implements `/tfmc masks`, which is a **cosmetic MMOItems system, not LibsDisguises**. It runs `mi give MASKS <ID> %player% 1 0 100 1 s` and hands out one random mask from ten. It has no connection to LibsDisguises. The `wmask_*` SavedSkins are unrelated despite the naming overlap — see below.

### Content it adds ON THIS SERVER

**Custom saved disguises** (`LibsDisguises\configs\disguises.yml`, `Disguises:` block) — exactly **two**, one of which is the plugin's stock example:

| Name | Definition | Status |
|---|---|---|
| `libraryaddict` | `player libraryaddict setArmor GOLDEN_* setItemInMainHand WRITTEN_BOOK setGlowing setSkin {…}` | Shipped example, left enabled |
| `Jeremiah` | `player <inherit> setSkin {"uuid":"8f940ab8-20e3-4447-8c21-4a217af3d92f","name":"Jeremiah",…} setDynamicName` | Server-made, for the dungeon NPC "Conductor Jeremiah" |

**SavedSkins** (`LibsDisguises\SavedSkins\`) — 12 cached skin profiles:

| Saved skin | Profile sourced from | Purpose |
|---|---|---|
| `wmask_male_human_3` | `41414141h` | NPC skin — `Zerratoris_Sentry_Male_1`, `Zerratoris_Spectator_Male_1` |
| `wmask_female_human_3` | `Ikhwan0510` | NPC skin — `Zerratoris_Sentry_Female_1`, `Zerratoris_Spectator_Female_1` |
| `wmask_nb_human` | `SoyKosa` | NPC skin — `Zerratoris_Sentry_NB`, `Zerratoris_Spectator_NB` |
| `jeremiah` | Jeremiah | Backs the `Jeremiah` custom disguise |
| `evilevie` | `MxsticDave` | Matches MythicDungeons `Minidungeon_1` mobs `evilevie`, `evilevie2`, `evilevie3` |
| `error` | Error | Player-name skin cache |
| `justintheone` | JustinTheOne | Player-name skin cache |
| `nowko` | Nowko | Player-name skin cache (also an RPCharacters character slug) |
| `rysioszarlotka` | RysioSzarlotka | Player-name skin cache |
| `shayminplays` | ShayminPlays | Player-name skin cache |
| `xxfran10xx` | XxFran10xX | Player-name skin cache |
| `skin1` | `StormStormy` | Generic saved skin, referenced nowhere |

**The `wmask_*` prefix does NOT mean "player mask".** These are the skins for the Rothil/Zerratoris exploration NPCs (`MythicMobs\mobs\TFMC\Exploration\tfmc_rothil_zerratoris_mobs.yml`), which use MythicMobs' `Disguise:` field, e.g. `Disguise: player wmask_male_human_3 setCustomName "&f"`. Ten mobs are configured this way: `Zerratoris_Sentry_Male_1/_2`, `Zerratoris_Sentry_Female_1/_2`, `Zerratoris_Sentry_NB`, and the matching `Zerratoris_Spectator_*` set.

**Raw skin PNGs** (`LibsDisguises\Skins\`): `evilevie.png`, `jeremiah.png`, `wMASK_Female_Human_3.png`, `wMASK_Male_Human_3.png`, `wMASK_NB_Human.png`, plus `README`.

**Vanilla disguise types** — the full LibsDisguises entity catalogue is loaded, but four types are OP-only by config (`dangerous.yml`): `TEXT_DISPLAY`, `ITEM_DISPLAY`, `BLOCK_DISPLAY`, `INTERACTION`; four methods are OP-only: `setYModifier`, `setNameYModifier`, `setInvisible`, `setUnsafeSize`. None of this matters for normal players, who cannot disguise at all.

### Player command table

| Command | Aliases | What it does | Notes (permission + default) |
|---|---|---|---|
| `/disguiseviewself` | `dviewself`, `dvs`, `disguisevs`, `disvs`, `vsd`, `viewselfdisguise`, `viewselfd`, `selfdisguise`, `selfdisg`, `selfd`, `toggleselfdisguise`, `seeselfdisguise` | Toggles whether you can see your own disguise | Command perm `libsdisguises.seecmd.viewself`; functional gate is `libsdisguises.selfdisguises`, **declared `default: true`**. Only useful if staff has disguised you |
| `/disguiseviewbar` | `dviewbar`, `dvb`, `disguisevb`, `disvb`, `viewdisguisebar`, `viewbardisguise`, `bardisguise`, `bardisg`, `bard`, `notifybar`, `viewnotifybar`, `disguisenotifybar`, `disgnotifybar`, `dnotifybar` | Toggles the disguise notification bar | Shares `libsdisguises.seecmd.viewself`. `NotifyBar: 'ACTION_BAR'` |
| `/libsdisguises` | `libsdisg`, `ld` | Plugin info command | Registered in `plugin.yml` with **no `permission:` line at all** — anyone can run the base command. Its useful subcommands (`reload`, `update`, `count`, `config`, `debug`, `permtest`, `metainfo`, `json`, `scoreboardtest`, `mods`) each have their own op-only permissions |

Also visible-but-unusable by everyone: every `libsdisguises.seecmd.*` node is a child of `libsdisguises.seecmd`, **default: true**, plus `SeeCommands: true` in `commands.yml`. This makes `/disguise`, `/undisguise`, `/dhelp` etc. appear in tab-completion for ordinary players even though running them is refused. **Worth calling out in the wiki so players do not think the commands are broken.**

Permissions that default to **false**, so off for everyone: `libsdisguises.seethrough`, `libsdisguises.hidename`, `libsdisguises.pve`, `libsdisguises.pvp`, `libsdisguises.noactionbar`.

**Admin/staff commands excluded** (no declared default → op-only, or explicitly `default: op`): `/disguise` (`d`, `dis`, `disg`), `/undisguise`, `/disguiseentity`, `/undisguiseentity`, `/disguiseplayer`, `/undisguiseplayer`, `/disguiseradius`, `/undisguiseradius`, `/disguiseclone`, `/disguisemodify`, `/disguisemodifyplayer`, `/disguisemodifyradius`, `/disguisemodifyentity`, `/copydisguise`, `/grabskin` (aliases include the very generic **`/skin`**), `/grabhead`, `/savedisguise`, `/disguisehelp`, and the four animation commands `/disguiseanimation`, `/disguiseplayeranimation`, `/disguiseradiusanimation`, `/disguiseentityanimation` (all explicitly `default: op`).

### Numbers that matter to players

- **Disguise duration:** unlimited by default. `DynamicExpiry: false`, so a timed disguise expires on real elapsed time regardless of whether you were online.
- **Disguise persistence:** `SaveDisguises.Players: false`, `SaveDisguises.Entities: false`, `KeepDisguises.PlayerDeath: false` — a disguise is lost on server restart and on death (`premium.yml`).
- **Radius command caps:** `DisguiseRadiusMax: 50`, `UndisguiseRadiusMax: 50` blocks.
- **Clone limits:** `DisguiseCloneSize: 3` stored disguises, `DisguiseCloneExpire: 10` s, `DisguiseEntityExpire: 10` s to right-click a target.
- **Scale limits:** `MinScale: 0`, `MaxScale: 50`. Self-disguise scaling is **off**.
- **Rate limit:** 500 ms between disguise commands, bypassable only with `libsdisguises.ratelimitbypass`.
- **Name length cap:** `PlayerNames: 'ARMORSTANDS'` → up to 256 characters above a disguise.
- **PvP:** unrestricted while disguised — `DisablePvP: false`, `DisablePvE: false`, `BlowDisguisesWhenAttacking: false`, `BlowDisguisesWhenAttacked: false`, `MonstersIgnoreDisguises: false`. Disguises survive block placing/breaking and world changes.
- **Costs:** none. LibsDisguises is not wired to any economy on this server.
- **Shulker disguises cannot move** (`StopShulkerDisguisesFromMoving: true`).

### Features configured but INERT

- **The entire player-facing disguise feature set.** No file in `C:\Users\MSI\Desktop\plugins\` grants `libsdisguises.disguise.*` to anyone; a tree-wide grep for `libsdisguises.` found matches only inside `LibsDisguises\` itself. From the file evidence, disguising is a staff capability only.
- **The `libraryaddict` stock example disguise** is still enabled — server-irrelevant.
- **Two NPC skins are referenced but missing.** `wmask_male_human_5` and `wmask_female_human_4` are used by `Zerratoris_Sentry_Male_2`, `Zerratoris_Spectator_Male_2`, `Zerratoris_Sentry_Female_2` and `Zerratoris_Spectator_Female_2`, but there is **no corresponding file in `SavedSkins\` or `Skins\`**. Those four NPCs will fall back to a Mojang lookup for a literal player of that name, which will fail — likely rendering as Steve/Alex.
- **`skin1` is orphaned** — cached from `StormStormy`, referenced nowhere.
- **Premium features are all off:** disguise saving, keep-on-death, and translations (`Translations: false`).
- **`MineSkinAPIKey: 'N/A'`** — no MineSkin account, so skin uploads take the slow path.
- **`AutoUpdate: true`** with `UpdatesBranch: 'SAME_BUILDS'` — the plugin will silently self-update. Not player-facing, but staff should know.
- **Custom entity registration is unused.** The commented `Librarian` block in `disguises.yml` demonstrates it; **no custom entity-type disguises are defined on this server** — only the two saved player-skin disguises above.
- **Dyeable/saddleable flags all disabled** (`protocol.yml`): `DyeableSheep`, `DyeableWolf`, `DyeableCat`, `CarpetableLlama`, `SaddleableHorse` are all `false`, so disguised animals cannot be interacted with that way.
- **`ShowNamesAboveDisguises: false`** — disguises do not display the real player's name, which is what makes the NPC illusion work.
- **VoiceChat compatibility shim is enabled** (`Compatibility.VoiceChat: true`) although no voice-chat plugin is present.

### Cross-links

- **MythicMobs** — the real consumer. `tfmc_rothil_zerratoris_mobs.yml` uses `Disguise: player wmask_*` on 10 exploration NPCs; MythicMobs' `Disguise:` field is provided by LibsDisguises.
- **MythicDungeons** — `Minidungeon_1` mobs `evilevie`, `evilevie2`, `evilevie3` and `Conductor_Jeremiah` (`MythicDungeons\maps\Minidungeon_1\functions.yml`) match the `evilevie` and `jeremiah` saved skins and the `Jeremiah` custom disguise.
- **ConditionalEvents** — `/tfmc parrot` uses LibsDisguises to turn a player into a gray parrot for 20 seconds. **This is the only LibsDisguises feature a normal player can trigger**, and it is triggered indirectly. See the ConditionalEvents section.
- **ProtocolLib / packetevents** — packet backend.
- **PlaceholderAPI** — soft dependency; `NameAboveDisguise: '%complex%'` can resolve PAPI placeholders.
- **TAB** — potential interaction: `HideDisguisedPlayersFromTab: false`, `ShowPlayerDisguisesInTab: false`, and `Scoreboard.CopyPlayerTeamInfo: true` / `WarnConflict: true` all touch scoreboard teams TAB also manages.
- **ConditionalEvents + MMOItems** — `/tfmc masks` and its ten `MASKS` items. Named here **only to rule it out**: it is not a LibsDisguises feature despite the `wmask_*` naming overlap.

### Uncertain / unverified

- **LuckPerms group permissions could not be verified.** The database at `LuckPerms\luckperms-h2-v2.mv.db` is a compressed H2 file and a binary grep for `libsdisguises` returned nothing. The claim that no normal player can disguise rests on there being **no file-based grant anywhere in the plugins tree** — it does not rule out a node added in-game via `/lp`. Confirm with `/lp group default permission info` and `/lp search libsdisguises.*`.
- Whether the four NPCs using `wmask_male_human_5` / `wmask_female_human_4` actually render broken is an **inference** from the missing skin files; no server log confirmed it. Those skins might resolve from `LibsDisguises\internal\mappings_cache`, which was not decoded.
- The ten `MASKS` MMOItems were read from the `mi give` lines in `a_masks.yml` only; the MMOItems `MASKS` type file was not opened to confirm exact display names. (The ConditionalEvents section above reports them as verified against `MMOItems\item\masks.yml` — treat that section as the stronger source.)
- `LibsDisguises\configs\sounds.yml` and the `Translations\` folder were not read; neither appeared likely to hold player-facing content, but the gap is flagged rather than glossed.
