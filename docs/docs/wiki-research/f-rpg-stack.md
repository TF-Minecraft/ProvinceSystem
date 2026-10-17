# Wiki Research Dossier — F: RPG Stack

**Plugins covered:** MMOCore, MMOItems, MMOInventory, ItemsAdder
**Source of truth:** the live server's on-disk plugin data folders at `C:\Users\MSI\Desktop\plugins\` (read-only inspection) and the plugin `.jar` `plugin.yml` files.
**Research date:** 2026-09-11
**Rule applied:** only features actually present in this server's config are described. Upstream/default-but-unused features are flagged as such.

**Versions in use (from each jar's `plugin.yml`):**

| Plugin | Jar | Version |
|---|---|---|
| MMOCore | `MMOCore-1.13.1-20260531.191529-59.jar` | 1.13.1-SNAPSHOT |
| MMOItems | `MMOItems-6.10.1-20260531.191614-59.jar` | 6.10.1-SNAPSHOT |
| MMOInventory | `MMOInventory-2.0-20260330.113858-32.jar` | 2.0-SNAPSHOT |
| ItemsAdder | `ItemsAdder_4.0.17.jar` | 4.0.17 |
| MythicLib (shared dependency) | `MythicLib-dist-1.7.1-20260819.194904-107.jar` | 1.7.1-SNAPSHOT |

All three MMO plugins depend on **MythicLib**, the shared stat/damage/skill engine. MMOCore `loadbefore: [MMOItems, MythicDungeons]`; MMOItems `loadbefore: [MMOInventory, Oraxen]`.

---

## 1. MMOCore

### What it is
MMOCore is the RPG character layer: it gives every player a class, a level, attributes you spend points into, skills you bind to a hotbar, gathering professions, parties, guilds and friends.

### How a player actually uses it

1. **You must pick a class before you can play.** `force-class-selection: true` (`plugins/MMOCore/config.yml`) means a player is forced into class selection and cannot use the default class.
2. `/class` (alias `/c`) opens the **Class Selection** GUI — a 27-slot menu (`plugins/MMOCore/gui/class-select.yml`) listing seven classes. Clicking one opens a **confirmation** screen titled `Confirmation: {class}` (`gui/class-confirm/class-confirm-default.yml`).
3. `/player` (aliases `/p`, `/profile`) opens **"Your Character"**, a 54-slot page showing level, the three professions, attribute summary, EXP boosters and party morale (`gui/player-stats.yml`).
4. `/attributes` (aliases `/att`, `/stats`) opens **"Character Attributes"**, a 27-slot page where you spend attribute points into the 7 attributes and can reallocate them (`gui/attribute-view.yml`).
5. `/skills` (alias `/s`) opens **"Selected Skill: {skill}"** (54 slots, `gui/skill-list.yml`). Left-click a skill slot to bind the selected skill, right-click to unbind, shift-left-click to select. Upgrading a skill costs **1 skill point**; reallocating all spent skill points costs **1 skill reallocation point**.
6. **Casting skills in the world:** casting mode is `SKILL_BAR` and the key to enter casting mode is `SWAP_HANDS` — i.e. press **F**, then press the number keybind shown on the action bar (`config.yml` → `skill-casting`; confirmed by the GUI lore "Cast this spell by pressing [F] followed by the keybind displayed on the action bar" in `gui/skill-list.yml`). Sneaking does not cancel casting (`disable-sneak: false`). Creative-mode players cannot enter casting mode (`can-creative-cast: false`).
7. `/skilltrees` (aliases `/st`, `/trees`, `/tree`) opens the global skill-tree menu; `/skilltrees <id>` opens one specific tree read-only. Both GUIs are enabled (`enable-global-skill-tree-gui: true`, `enable-specific-skill-tree-gui: true`).
8. `/party`, `/friends` (`/f`), `/quests` (`/q`, `/journal`), `/waypoints` (`/wp`) each open their own GUI (see command table).
9. **Action bar:** every player permanently sees `❤ {health}/{max_health} | {mana_icon} {mana}/{max_mana} | ⛨ {armor}` (`config.yml` → `action-bar.format`), refreshed every 5 ticks.
10. **Level-up feedback:** a sound plus the message "Congratulations, you reached level {level}! Use /p to see your new statistics!" (`messages.yml`). MMOCore **overrides the vanilla XP bar** to show class level progress (`override-vanilla-exp: true`).

### Content it adds ON THIS SERVER

#### Classes (7 selectable + 1 hidden default + 1 unused test file)
All selectable classes live in `plugins/MMOCore/classes/` and all seven appear in `gui/class-select.yml`.

| Class | Display name | Max level | EXP table | Unique equipment (from its own `attribute-lore`) |
|---|---|---|---|---|
| `archer` | Archer (green) | 6 | `archer_exp_table` | Shortbows, Longbows, Crossbows, Light Armor |
| `bard` | Bard (light blue) | 6 | `bard_exp_table` | Lutes, Light Armor |
| `guardian` | Guardian (grey) | 6 | `guardian_exp_table` | One-Handed Weapons, Shields, Battle Standards, Heavy Armor |
| `mage` | Mage (magenta) | 6 | `mage_exp_table` | Mage Staffs, Mage Wands, Mage Blades, Mage Armor. Lore warns "Mages are expensive to gear!" |
| `musketeer` | Musketeer (orange) | 6 | `musketeer_exp_table` | Pistols, Rifles, Shotguns, Rocket Launchers, Infantry Armor. Lore explicitly states **"No Skills"** |
| `paladin` | Paladin (pale yellow) | 6 | `paladin_exp_table` | One-Handed Weapons, Two-Handed Weapons, Shortswords, Shields, Medium Armor |
| `warrior` | Warrior (red) | 6 | `warrior_exp_table` | One-Handed Weapons, Two-Handed Weapons, Shortswords, Battle Standards, Medium Armor |
| `default` | Default | 2 | `default` | Fallback class; `display: false`, so it is not shown in the selection GUI |

`classes/test.yml` exists (316 lines) but is **not** listed in `gui/class-select.yml`, so players cannot select it.

**Every selectable class has max-level 6** and four skill slots ("Skill Slot I–IV"), of which only **Slot I is unlocked by default**.

Class descriptions as written in-game (`classes/*.yml` → `display.lore`):
- **Archer** — "deadly marksmen, wielding bows with precision. They deal sustained damage from a distance, and are excellent at maintaining a favourable position, making them ever-reliable."
- **Bard** — "charismatic minstrels, wielding Mana through music. They can provide magical blessings and hamper enemy mobility."
- **Guardian** — "unyielding defenders, controlling the battlefield by drawing attention, absorbing damage, and manipulating enemies."
- **Mage** — "command the forces of magic, casting spells via runes. With many runes available, Mages are the most diverse class."
- **Musketeer** — "excel at the usage of advanced guns and gadgets. Though lacking skills, they manufacture custom firearms… many of which deal armor-piercing damage."
- **Paladin** — "resolute soldiers who excel in traditional combat, empowering themselves and protecting others."
- **Warrior** — "mobile masters of combat, weaving attacks with an array of flexible skills to inflict great damage."

#### Class base attributes (`base` / `per-level`)

| Class | Max Health | Health/level | Max Mana | Mana/level | Mana regen | Move speed | Attack speed | Physical dmg | Projectile dmg |
|---|---|---|---|---|---|---|---|---|---|
| Archer | 20 | +0.25 | 10 | +0.5 | 0.1 | 0.1 | 4 | 0 | **25** |
| Bard | 20 | +0.3 | 10 | +0.6 | 0.1 | 0.1 | 4 | 0 | 0 |
| Guardian | 20 | +0.3 | 10 | +0.5 | 0.1 | 0.1 | 4 | **−10** | 0 |
| Mage | 20 | +0.3 | 10 | +0.6 | 0.1 | 0.1 | 4 | 10 | 5 |
| Musketeer | 20 | +0.3 | 10 | +0.5 | 0.1 | 0.1 | 4 | 0 | 5 |
| Paladin | 20 | +0.3 | 10 | +0.5 | 0.1 | 0.1 | 4 | **15** | 0 |
| Warrior | 20 | +0.25 | 10 | +0.6 | 0.15 | 0.1 | 4 | **15** | 0 |
| Default | 20 | +0 | 0 | +0 | 0 | 0.1 | 4 | 1 | 0 |

Every class also declares `cooldown_reduction`, `recoil_reduction` and `reload_reduction` at base 0, and `off-combat-health-regen: true`.

#### Class skills
Skills are defined per class in the class file. **Every configured skill unlocks at class level 2 and has max-level 4.** Mage and Musketeer have **no** class skills configured at all — Mage power comes from MMOItems runes, Musketeer from MMOItems guns.

**Archer** (`classes/archer.yml`)

| Skill ID | Cooldown (base → per level) | Mana (base → per level) | Other |
|---|---|---|---|
| `ARCHER_STEP` | 20.0 s, −1.66/lvl | 10, −1.66/lvl | — |
| `DECOY` | 15.0 s, −1.66/lvl | 5, −0.833/lvl | duration 10.0 s |
| `ARROW_VOLLEY` | 20.0 s, −4.0/lvl | 5, −0.833/lvl | — |
| `POISON_ARROW` | 20.0 s | 5, −0.833/lvl | duration 2.0 s +1/lvl; damage 8.0 +2.33/lvl |
| `TOTEM_MINE` | 20.0 s | 5, −0.833/lvl | duration 5.0 s +1.66/lvl; damage 10.0 +1.66/lvl |
| `HAWK_EYE` | 10.0 s | 5, −0.833/lvl | duration 5.0 s +1.66/lvl |
| `FREEZING_SHOT` | 40.0 s | 10, −1.66/lvl | duration 4.0 s +2.0/lvl |
| `ARCHER_CLOAK` | 30.0 s | 10, −1.66/lvl | duration 2.0 s +1/lvl |

**Bard** (`classes/bard.yml`)

| Skill ID | Cooldown | Mana | Other |
|---|---|---|---|
| `SOUND_WAVE` | 20.0 s | 5, −0.833/lvl | duration 2.0 s +0.66/lvl; damage 8.0 +2.33/lvl |
| `MEMENTO_MORI` | 15.0 s | 5, −0.833/lvl | duration 2.0 s +1/lvl |
| `VIBRATIVE_STRIKE` | 40.0 s, −1.66/lvl | 10, −1.66/lvl | duration 3.0 s +0.66/lvl |
| `SHIELD_OF_HARMONY` | 20.0 s | 5, −0.833/lvl | duration 5.0 s +1.66/lvl |
| `ANGELIC_SERENADE` | 25.0 s | 5, −1.66/lvl | duration 5.0 s +1.66/lvl; heal 2.0 +2.0/lvl |
| `RHAPSODY` | 20.0 s | 5, −0.833/lvl | duration 7.0 s +1.66/lvl |
| `SYMPHONY_OF_DESTRUCTION` | 30.0 s | 10, −1.66/lvl | duration 2.0 s +1/lvl; damage 12.0 +2.0/lvl |
| `TELEPORT` | 20.0 s | 10, −1.66/lvl | — |

**Guardian** (`classes/guardian.yml`)

| Skill ID | Cooldown | Mana | Other |
|---|---|---|---|
| `MENDING` | 30.0 s | 10.0, −1.66/lvl | duration 3.0 s +1.0/lvl; heal 4.0 +0.66/lvl |
| `TREMORS` | 25.0 s | 5.0, −0.833/lvl | duration 5.0 s +1.0/lvl; damage 2 +1.33/lvl |
| `GUARDIAN_ANGEL` | 40.0 s | 10, −1.66/lvl | duration 8 s +2.33/lvl; percentage 8 +8/lvl |
| `GROUND_SMASH` | 30.0 s | 5.0, −0.833/lvl | duration 2.0 s +0.66/lvl |
| `GROUP_UP` | 30.0 s | 5, −0.833/lvl | duration 10 s +2/lvl; power 4 +4/lvl |
| `SUBSTITUTE` | 25.0 s, −1.66/lvl | 5, −1.0/lvl | — |
| `SHIELD_WALL` | 40.0 s | 5, −0.833/lvl | duration 2.0 s +1.66/lvl |
| `TANK_PULL` | 20.0 s | 10, −1.66/lvl | duration 3 s +1.66/lvl |

**Paladin** (`classes/paladin.yml`)

| Skill ID | Cooldown | Mana | Other |
|---|---|---|---|
| `SHIELD_UP` | 20.0 s | 5.0, −0.833/lvl | duration 3.0 s +1.33/lvl |
| `HEALING_STRIKE` | 20.0 s | 5.0, −0.833/lvl | damage 7 +1.33/lvl |
| `BULK_UP` | 30.0 s | 5.0, −0.833/lvl | duration 4.0 s +1.0/lvl |
| `HEAL_AURA` | 60.0 s | 10.0, −1.66/lvl | duration 3.0 s +1/lvl; heal 2.0 +1.0/lvl |
| `WAR_CRY` | 30.0 s | 5, −0.833/lvl | duration 3 s +1/lvl |
| `PALADIN_SMITE` | 30.0 s | 10.0, −1.66/lvl | damage 10 +1.66/lvl |
| `BLESS` | 20.0 s | 5, −0.833/lvl | duration 10 s +1.66/lvl |
| `CHALLENGE` | 40.0 s, −2.33/lvl | 10.0, −1.66/lvl | — |

**Warrior** (`classes/warrior.yml`)

| Skill ID | Cooldown | Mana | Other |
|---|---|---|---|
| `WARRIOR_DASH` | 20.0 s | 5.0, −0.833/lvl | damage 8.0 +1.33/lvl |
| `WARRIOR_STRIKE` | 20.0 s | 5, −0.833/lvl | damage 8.0 +2.33/lvl |
| `WARRIOR_HOOK` | 20.0 s, −1.66/lvl | 5, −0.833/lvl | — |
| `WARRIOR_SWEEP` | 20.0 s, −1.66/lvl | 5, −0.833/lvl | damage 5.0 +1.66/lvl |
| `WARRIOR_LUNGE` | 30.0 s | 10, −1.66/lvl | damage 10.0 +2.0/lvl |
| `WARRIOR_HEAL` | 20.0 s | 5, −0.833/lvl | heal 6.0 +2.0/lvl |
| `WARRIOR_SHIELD` | 30.0 s, −1.66/lvl | 10, −1.66/lvl | duration 20 s +0.833/lvl |
| `WARRIOR_BEAM` | 40.0 s | 10, −1.66/lvl | damage 8.0 +2.33/lvl |

On top of per-skill cooldowns there is a **global skill cooldown of 10 ticks (0.5 s)** applying to every active skill (`config.yml` → `global-skill-cooldown: 10`).

#### Attributes (`plugins/MMOCore/attributes/attributes.yml`)
Seven attributes, each capped at **20 points**:

| Attribute | Per point |
|---|---|
| Strength | +1.0 Physical Damage |
| Dexterity | +1.0 Projectile Damage |
| Constitution | +0.3 Max Health |
| Intelligence | +1.0 Max Mana, +0.01 Mana Regeneration |
| Wisdom | +1.0 Cooldown Reduction |
| Charisma | +1.0 Recoil Reduction, +1.0 Reload Reduction, +1.0 Magic Damage, +0.25 Critical Strike Chance |
| Nutrition | +0.5 Physical/Projectile/Magic Damage, +0.2 Max Health, +0.5 Max Mana, +0.01 Mana Regen, +0.5 Cooldown Reduction, +0.125 Crit Chance |

All seven appear in both `gui/attribute-view.yml` and `gui/player-stats.yml`.

#### Professions (`plugins/MMOCore/professions/`)
Three professions, all sharing the `profession` EXP curve.

| File | Display name | Main-class EXP per profession level | How it levels |
|---|---|---|---|
| `crafter.yml` | **Crafter** | 20 base, +3/level | Smelting (stone/deepslate/terracotta/quartz/glass/bricks etc. 5–10 xp; copper ingot 2–4; iron ingot 4–8; gold ingot 8–12) **and** mining ores (coal/iron/copper/redstone + deepslate variants 4–8; gold/lapis/diamond/emerald + deepslate variants 8–12; plain stone/andesite/granite/diorite/deepslate 0.02). Also has a `repair-exp` table for repairing tools (per 100 durability: DIAMOND_SWORD 1.923, GOLDEN_SWORD 62.5, IRON_SWORD 8, STONE_SWORD 7.634, WOODEN_SWORD 13.56, and the same values for the matching pickaxes). |
| `forager.yml` | **Agriculturist** (the file is named `forager`, the display name inside is `Agriculturist`) | 10 base, +2/level | Killing farm animals (cow/chicken/pig/sheep/rabbit 5–10) and harvesting crops (wheat, beetroot, carrot, potato, cocoa, cactus 1.0–1.8, player-planted only, no silk touch; melon, pumpkin 1.0–1.8 non-player-placed; sugar cane; red/brown mushroom) |
| `herborist.yml` | **Herborist** | 20 base, +3/level | Nether wart / crimson & warped fungus (5–10) and chopping **all** log/wood/stripped variants incl. cherry, mangrove and pale oak (1–2 each); mangrove roots (1) |

The alchemy-experience block in `herborist.yml` is fully commented out — **brewing gives no Herborist EXP on this server**.

`gui/player-stats.yml` shows the professions as `profession_herborist` (labelled "Herborsit" — typo in config), `profession_crafter` ("Crafter") and `profession_forager` ("Forager" — inconsistent with the `Agriculturist` display name in the profession file itself). Flagged under Uncertain.

#### EXP curves (`plugins/MMOCore/exp-curves/`)

- `class.txt` — used by all seven playable classes. Contents repeat the pattern **100, 200, 300, 400, 500** (20 lines total). Since max level is 6, the levels that matter are: **L1→2 = 100, L2→3 = 200, L3→4 = 300, L4→5 = 400, L5→6 = 500. Total to max = 1500 class EXP.**
- `default-class.txt` — a single value `1` (used by the Default class, max level 2).
- `profession.txt` — 79 values, starting 50, 85, 125, 175, 235, 305, 385, 475, 575, 690, 810, 950, 1100, 1270, 1450, 1650, 1850, 2075, 2300, 2550 … ending 206600, 213500, 220500.
- `levels.txt` — 100…1000 in steps of 100 (not referenced by any class file on this server).
- `skill-tree-node.txt` — 1, 2, 3 … 25.

#### EXP tables — what leveling actually hands you (`plugins/MMOCore/exp-tables/exp-tables.yml`)

Every playable class shares the same skill-slot unlock schedule:

| Class level | Reward |
|---|---|
| 7 | Unlock **Skill Slot II** + 2 skill points (Mage: slot only, no points) |
| 12 | Unlock **Skill Slot III** + 2 skill points (Mage: slot only) |
| 17 | Unlock **Skill Slot IV** + 2 skill points (Mage: slot only) |

Mage additionally receives, **at class level 2 only**: `4× minor_runestone` and `4× minor_armor_runestone` (MMOItems `LOOT` type, delivered by `mi give loot …`).

The `default` exp table gives an attribute point trigger at level 22 with amount `0` (i.e. a no-op).

> **Important consistency note:** every playable class has `max-level: 6`, but the skill-slot unlocks fire at levels **7, 12 and 17**. As configured, **Skill Slots II–IV are unreachable through normal leveling.** Flagged under Uncertain rather than presented as intended design.

#### Skill trees (`plugins/MMOCore/skill-trees/`)
Six tree files exist. **No class file on this server contains a `skill-trees:` key**, so which trees a player can actually access is unverified (see Uncertain).

| File | ID | Display name | Type | Max points spendable | Nodes |
|---|---|---|---|---|---|
| `combat.yml` | `combat` | `&4Combat` — "used for combat abilities" | PROXIMITY | 20 | 27 nodes: Cooldown Reduction I–III, Crit Chance I–III, Life Steal I–III, Resistance I–III, Health Regen I–III, Mana Regen I–III, Magic Damage I–III, Max Health I–III, Weapon Damage I–III |
| `general.yml` | `general` | `&4General` | CUSTOM | 11 | 21 nodes: Mana Regen I–III, Health Regen I–III, Cooldown Reduction I–III, Crit Chance I–III, Damage Reduction I–III, Force I–III, Life Steal, Max Health, Magic Damage |
| `mage-arcane-mage.yml` | `mage-arcane-mage` | `&4Mage` — "Available to Mages only" | CUSTOM | 21 | 21 nodes: Mana Regen I–III, Offense I–III, Spell Vamp I–III, Additional Exp I–III, Magic Resistance I–III, Skill Crit Chance I–III, Skills IV–VI |
| `rogue-marksman.yml` | `rogue-marksman` | `&4Rogue & Marksman` | CUSTOM | 21 | 21 nodes: Additional Exp I–III, Shooting Force I–III, Sustain I–III, Knockback Resistance I–III, Crit Chance I–III, Agility I–III, Projectile Damage I–III |
| `warrior-paladin.yml` | `warrior-paladin` | `&4Warrior & Paladin` | custom | 21 | 21 nodes: Attack Speed I–III, Health Regen I–III, Resistance I–III, Parrying I–III, Toughness I–III, Dodging I–III, Weapon Damage I–III |
| `loop.yml` | `example_loop` | `&4Loop Skill Tree` | CUSTOM | 20 | Demo file — nodes named "Loop I…" with placeholder lore "Lorem ipsum dolor sit amet" and **no stat triggers**. Stock MMOCore example content, not real gameplay. |

Sample node values (FLAT unless noted): Cooldown Reduction I/II/III = +5 / +10 / +15 %; Crit Chance I = +1; Mana Regen I/II/III = +1 / +2 / +2 pts/sec; Health Regen I = +1 pt/sec; Attack Speed I/II/III = +5 / +10 / +15 % (RELATIVE); Additional Exp I/II/III = +2 / +3 / +5 %; Shooting Force I = +10 % arrow velocity (RELATIVE); Offense I = +5 Skill Damage.

Skill-tree nodes have parents of type `strong` (must be fully unlocked first) and `soft`. Tree navigation in the GUI uses Up/Down/Left/Right buttons with a scroll step of 1 in both axes (`config.yml`).

Note the tree names reference classes that **do not exist on this server** — "Rogue" and "Marksman" are not in `classes/`. Flagged under Uncertain.

#### Party system (`config.yml` → `party`)
- Party plugin is set to `mythicdungeons_inject` — parties are **provided by MythicDungeons**, not MMOCore's own system. The MMOCore party GUI files still exist ("Party Creation", 27 slots; "Party ({players}/{max})", 54 slots, with Leave and Invite buttons).
- Party chat prefix: **`@`** at the start of a chat message. Format: `&5[Party] {player}: {message}`.
- Max players per party: **16**. Max level difference to join: **21**.
- Class EXP is **split** among party members (`main-exp-split: true`); profession EXP is **not** (`profession-exp-split: false`).
- EXP is not split beyond **48 blocks** apart.
- Party buffs are set to **0** for both health regeneration and additional experience — i.e. **no stat bonus for partying on this server**.

#### Guild system (`plugins/MMOCore/guilds.yml`)
- Guild plugin = `mmocore` (built-in), but the `/guild` command is **commented out** in `plugins/MMOCore/commands.yml`, so there is no guild command registered. Flagged under Uncertain.
- Guild chat prefix: **`*`**. Format: `&a[{tag}] {player}: {message}`.
- Tags are auto-uppercased, must match `[a-zA-Z-_!?]+`, length **3–4**.
- Names must match `[a-zA-Z -_!?]+`, length **3–14**.
- Max members: **40**.
- GUIs: "Guild Creation" (27 slots) and the guild roster (54 slots, title `[{tag}] {name} - ({page}/{maxpages})`) with Leave / Disband / Invite buttons.

#### Friends
`gui/friend-list.yml` — a 54-slot list showing `&a[Online] {name}` / `&c[Offline] {name}`, plus a "New Friend Request" button. Removing a friend opens a 27-slot confirm ("Remove {name}" / "Keep {name}", `gui/friend-removal.yml`).

#### Waypoints
`plugins/MMOCore/waypoints/default_waypoints.yml` is **entirely commented out — there are zero waypoints configured on this server.** The `/waypoints` GUI (45 slots, paginated, `gui/waypoints.yml`) and the config options exist but have nothing to show: default warp time 100 ticks = 5 s; automatic shortest-path calculation enabled; `link_reciprocity: false`. Waypoint travel costs **Stellium**.

#### Quests
Three quest files exist in `plugins/MMOCore/quests/`, but all three are stock MMOCore example content (they reference Citizens `npc=0`/`npc=1`, coordinates in a world literally named `world`, and a MythicMob `SkeletalKnight` that appears in no class EXP source list):

| File | Name | Notes |
|---|---|---|
| `tutorial.yml` | *A Whole New World* | Requires main level 10 **and** mining level 5 — but there is **no `mining` profession** on this server (only crafter/forager/herborist), so this requirement cannot be met. 12-hour cooldown. Rewards wooden tools + `mmoitem{type=SWORD;id=CUTLASS}` + 100 EXP. |
| `adv-begins.yml` | *The Beginning of an Adventure* | Parent quest `tutorial`. Rewards stone tools + 30 EXP. |
| `fetch-mango.yml` | *The Exotic Fruit* | 0-hour cooldown (instantly redoable). Rewards 10 gold coins + 30 EXP. |

Quest boss bars are enabled globally (`mmocore-quests.disable-boss-bar: false`). The `/quests` GUI is a 45-slot paginated list (`gui/quest-list.yml`).

**Treat MMOCore quests as almost certainly non-functional/unused on this live server.**

#### Loot chests, drop tables, conditions, restrictions, exp-sources
All of these are stock examples or empty:
- `loot-chests/default_loot_chests.yml` — **empty** (comments only). Loot chest expiry 600 s and per-player cooldown 600 s are configured but nothing spawns.
- `drop-tables/example_drop_tables.yml` — two demo tables (`diamond-drop-table`, `other-drop-table`).
- `conditions.yml` — two demo conditions referencing a `MINING` profession that does not exist here.
- `restrictions.yml` — entirely commented out; **no tool restrictions active**.
- `exp-sources.yml` — two demo sources (`test-exp-source`, `test2`).
- Custom mining is **disabled** (`custom-mining.enable: false`).
- MMOCore's `chance-stat-weight` for loot chests, fishing drops and drop items are all **1** (unmodified).

#### Currency items (`plugins/MMOCore/items.yml`)
`GOLD_COIN` (Gold Nugget, "Worth: 1g"), `NOTE` (Paper, "Worth: {worth}g"), `DEPOSIT_ITEM`, `GOLD_POUCH` / `MOB_GOLD_POUCH` (Leather, "Right-Click to open"), `SKILL_POINT_BOOK` ("Click to redeem one skill point"), `SKILL_BOOK: {skill}`, `WAYPOINT_BOOK: {waypoint}`. These back `/withdraw` and `/deposit`.

#### Where a new player starts (`config.yml` → `default-playerdata`)
level 1, **1 class point**, 0 skill points, 0 skill realloc points, 0 attribute points, 0 attribute realloc points, 20 health, 0 mana, 0 stellium, 0 stamina.

### Player command table — MMOCore

Commands and aliases from `plugins/MMOCore/commands.yml`; permission defaults from the jar's `plugin.yml`.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/player` | `/p`, `/profile` | Opens "Your Character" — level, professions, attribute summary, EXP boosters, party morale | `mmocore.profile` default **true** (everyone) |
| `/attributes` | `/att`, `/stats` | Opens "Character Attributes" — spend and reallocate attribute points | `mmocore.attributes` default **true** |
| `/skills` | `/s` | Opens the skill list — upgrade skills, bind/unbind them to slots | `mmocore.skills` default **true** |
| `/skilltrees` | `/st`, `/trees`, `/tree` | Opens the skill tree menu. `/skilltrees <id>` opens one tree read-only | `mmocore.skilltrees` default **true** |
| `/quests` | `/q`, `/journal` | Opens the quest journal | `mmocore.quests` default **true**. Quest content is stock examples — see above |
| `/friends` | `/f` | Online/offline friend list, send & accept requests | `mmocore.friends` default **true** |
| `/party` | *(none)* | Party menu: create, invite, leave, kick | `mmocore.party` default **true**. Party backend is MythicDungeons |
| `/guild` | *(none)* | Guild roster/creation | `mmocore.guild` permission defaults **true**, **but the command is commented out in `commands.yml`**, so it is probably not registered. Unverified |

**Registered in `commands.yml` but gated behind an op-default permission** (a normal player can only use these if LuckPerms grants the node):

| Command | Aliases | Permission | Default |
|---|---|---|---|
| `/class` | `/c` | `mmocore.class-select` | op |
| `/waypoints` | `/wp` | `mmocore.waypoints` | op |
| `/withdraw` | `/w` | `mmocore.currency` | op |
| `/deposit` | `/d` | `mmocore.currency` | op |
| `/pvpmode` | `/pvp` | `mmocore.pvpmode` | op |
| `/cast` | — | `mmocore.cast` | op |

Because `force-class-selection: true`, **`/class` must in practice be reachable by normal players**, so LuckPerms almost certainly grants `mmocore.class-select` to the default group. This could not be confirmed — LuckPerms stores permissions in an H2 database (`plugins/LuckPerms/luckperms-h2-v2.mv.db`) which is not readable as text. **Flagged under Uncertain.** The same caveat applies to `mmocore.waypoints`, `mmocore.currency` and `mmocore.pvpmode`.

**Admin/staff commands excluded from the player table:**
- `/mmocore` (alias `/rpg`) — the entire admin tree (`mmocore.admin`, default op). Sub-commands confirmed in use by this server's own config: `mmocore admin attribute-points give`, `mmocore admin skill-points give`, `mmocore admin slot unlock`, `mmocore coins`. Command verbosity is on for attribute, skill, class, experience, level, nocd, skill-tree-points, points, reset, resource and waypoint.
- `mmocore.bypass-waypoint-wait` (default `false`) — bypasses waypoint warm-up.

### Numbers that matter to players — MMOCore

- **Class EXP to max (level 6): 1500** total (100/200/300/400/500 per level).
- **Attribute cap: 20 points per attribute**, 7 attributes.
- **Global skill cooldown: 0.5 s (10 ticks)** on every active skill.
- **Skill upgrade cost: 1 skill point per level**; **skill reallocation: 1 skill reallocation point**.
- **PvP mode is disabled** (`pvp_mode.enabled: false`). The configured-but-inactive values, for reference: min level 0, max level difference 10, combat timeout 30 s, invulnerability 60 s on region change / 30 s on command, /pvpmode cooldowns 20 s region enter, 20 s region leave, 45 s after combat, 5 s toggle-on, 3 s toggle-off.
- **Death EXP loss is disabled** (`death-exp-loss.enabled: false`; the 30 % value is configured but inactive).
- **Combat log timer: 10 seconds** after taking damage from any of: CRAMMING, DRAGON_BREATH, ENTITY_ATTACK, ENTITY_EXPLOSION, ENTITY_SWEEP_ATTACK, MAGIC, POISON, PROJECTILE, SONIC_BOOM, THORNS, WITHER.
- **Mobs from spawners give no MMO XP** (`prevent-spawner-xp: true`).
- **Cobblestone generators give no EXP** (`should-cobblestone-generators-give-exp: false`).
- **Vanilla-XP redirection is off** but the **vanilla XP bar is overridden** to show class level.
- **Main-class EXP holograms are off** (`display-main-class-exp-holograms: false`); EXP progress is shown on the action bar as `{profession} {progress} {ratio}%` instead.
- **Passive skills must be bound to take effect** (`passive-skill-need-bound: true`).
- **Auto-save every 1800 s (30 min)**.
- **Class EXP sources are identical for all seven classes** and come exclusively from MythicMobs kills (all vanilla-mob sources are commented out):
  - *Easy, 3–6 EXP:* Aurorafowl, Wraith, Kobold_Warrior, Kobold_Archer, rpg_slime_cube, rpg_mushroom, rpg_mushroom_red
  - *Medium, 6–12 EXP:* Cryonic_Crab, Salamander, rpg_poison_slime_cube, rpg_skeleton, rpg_skeleton_crossbow, rpg_rat_undead
  - *Hard, 9–18 EXP:* Permafrost_Sentinel, Mimic, GreenTroll
  - (The `default` class instead earns 4–8 from vanilla DROWNED.)
- **Base stats every player starts from** (`plugins/MMOCore/stats.yml`, `default` section): Max Health 20, Attack Damage 1, Attack Speed 4, Movement Speed 0.1, Health Regen 0.1/s, Max Mana 20, Max Stamina 20, Max Stellium 20, Mana Regen 0.166/s (+0.03 per level), Stamina Regen 0.166/s (+0.03 per level), Stellium Regen 0.01/s, Jump Strength 0.42, Block Interaction Range 4.5, Entity Interaction Range 3.0, Safe Fall Distance 3.0, Submerged Mining Speed 0.2, Sneaking Speed 0.3, Step Height 0.6, Fall Damage Multiplier 1.0, Gravity 0.08.
- **Fishing stats** scale with level: Fishing Strength +0.3/level (cap 40), Critical Fishing Chance 5 % flat (cap 70), Critical Fishing Failure Chance 3 % −0.01/level (floor 1, cap 100).
- **Resource bar colours:** stamina whole GREEN, half DARK_GREEN, empty WHITE.

### Cross-links — MMOCore
- **MythicLib** — provides the stat engine, the `%mythiclib_stat_*%` placeholders and the `mmocore_level_up_effect` script (`MythicLib/scripts/mmocore_scripts.yml`) fired on level-up.
- **MythicMobs** — the *only* source of class EXP on this server (19 named mob types).
- **MythicDungeons** — owns the party system (`party-plugin: mythicdungeons_inject`).
- **MMOItems** — Mage's level-2 reward runestones are delivered with `mi give loot …`; the tutorial quest reward is `mmoitem{type=SWORD;id=CUTLASS}`; class names are used as MMOItems `required-class` restrictions.
- **MMOInventory** — its Information button reads `%mmocore_level%` and `%mmocore_class%`.
- **PlaceholderAPI / PAPIProxyBridge** — `%rpcharacters_display_tab%` appears in `gui/player-stats.yml` (an RPCharacters/profile plugin placeholder).
- **Vault / DenarEconomy** — `/withdraw` and `/deposit` convert money into Gold Coin / Note items.
- **WorldGuard** — required for PvP mode (currently disabled).
- **Citizens** — referenced by the (stock) quest NPC objectives.
- Soft-depends declared in `plugin.yml` but not confirmed in use here: MMOProfiles, Residence, ProtocolLib, OBTeam, FactionsBridge, Multiverse-Core.

### Uncertain / unverified — MMOCore
1. **Which LuckPerms permissions the default group has.** LuckPerms uses an H2 database (`plugins/LuckPerms/luckperms-h2-v2.mv.db`); it cannot be read as text, and no YAML group files exist. Every "default: op" permission above (`mmocore.class-select`, `mmocore.waypoints`, `mmocore.currency`, `mmocore.pvpmode`, `mmocore.cast`) may or may not be granted to players.
2. **Skill Slots II–IV appear unreachable.** Unlocks fire at class levels 7/12/17 but every class caps at level 6.
3. **Which skill trees each class can open.** No class file declares `skill-trees:`. The tree names reference "Rogue" and "Marksman", classes that do not exist here.
4. **`/guild` is commented out** of `commands.yml` while `guild-plugin: mmocore` is still active. Whether players can access guilds at all is unknown.
5. **Profession display-name inconsistency:** `professions/forager.yml` sets `name: Agriculturist`, while `gui/player-stats.yml` labels the same profession "Forager". Which one a player sees where is not verified. `gui/player-stats.yml` also contains the typo "Herborsit".
6. **Quests, waypoints, loot chests, drop tables and exp-sources are stock/empty**, so they are presumed inactive, but that has not been confirmed against live server behaviour.
7. `classes/test.yml` (316 lines) was not read in full; it is not selectable from the class GUI.
8. The MMOCore skill IDs above are config keys; the **in-game display name and description of each skill** live in MythicLib/MMOCore skill definitions that were not opened in this pass.

---

## 2. MMOItems

### What it is
MMOItems is the custom-gear engine: it defines every custom weapon, armour piece, rune, gemstone, herb, tool and consumable on the server, gives them rarities and class restrictions, and provides the crafting stations players use to make them.

### How a player actually uses it

1. **Getting gear:** you craft it at a **crafting station**, or you get it as a drop/reward. MMOItems' own commands are admin-only; players never type an MMOItems command to obtain an item.
2. **Opening a crafting station:** stations are bound to **world blocks**, configured in `plugins/TFMCCore/stations.yml` (a separate server plugin). You walk up to the block and click:

| Station | Block you click | Click type |
|---|---|---|
| Tool Station | vanilla Crafting Table | shift-right-click |
| Ingot Station | vanilla Blast Furnace | shift-right-click |
| Forester Station | vanilla Fletching Table | right-click |
| Alchemy Station | vanilla Brewing Stand | right-click |
| Block Station | vanilla Stonecutter | shift-right-click |
| Instrument Station | vanilla Jukebox | shift-right-click |
| Research Station | vanilla Cartography Table | shift-right-click |
| Copper Station | vanilla Grindstone | shift-right-click |
| Medicine Station | ItemsAdder furniture `tfmc:medicine_station` | right-click |
| Engineer Station | ItemsAdder furniture `tfmc:ammunition_station` | right-click |
| Meal Prep Station | ItemsAdder furniture `tfmc:meal_prep_station` | right-click |
| Fishing Station | ItemsAdder furniture `tfmc:fishing_station` | right-click |
| Animal Station | ItemsAdder furniture `tfmc:animal_station` | right-click |
| Archeology Station | ItemsAdder furniture `tfmc:archeology_station` | right-click |

   (Vanilla-use blocks use shift-right-click so a plain right-click still opens the vanilla UI — stated in the header comment of `plugins/TFMCCore/stations.yml`.)
   No station defines its own `command:` block, so there is **no `/alchemystation`-style command**.
3. **Inside a station GUI:** a 54-slot paginated menu titled e.g. `Tool Station (1/4)`. Right-clicking a recipe **previews** it in a 45-slot "Preview" window (`enable_right_click_preview: true`). Ingredients and conditions are shown with green ✔ / red ✖ (`plugins/MMOItems/language/crafting-stations.yml`). Crafting is **queued** — up to **64 items at a time** (`max-queue-size: 64` on every station) — and each recipe has a **crafting-time in seconds** you wait through.
4. **Socketing runes/gems:** you apply a rune or gemstone to an item that has a matching empty **gem socket**. The socket name must match the rune's `gem-color` exactly (e.g. a "Rare Staff Support Rune" socket only accepts a rune with `gem-color: Rare Staff Support Rune`). Messages: "You successfully applied {gem} onto your {item}." / "Your gem stone {gem} broke while trying to apply it…" (`plugins/MMOItems/language/messages.yml`). Removing a gem can fail: "The gems have bonded strongly with your item. Cannot remove."
5. **Upgrading:** apply an upgrade consumable to an item. Upgraded items show ` (+N)` appended to the name (`config.yml` → `item-upgrading.name-suffix: ' &8(&e+#lvl#&8)'`). Stat changes themselves are **hidden** (`display-stat-changes: false`). Upgrades check that you'd still meet the item's requirements afterwards (`item-upgrade-requirements-check: true`); a failed upgrade consumes the consumable or the station materials.
6. **Repairing:** most gear sets `disable-repairing: true` for vanilla repair and instead uses a `repair-type` tag — `general`, `mage`, `tool`, or `fisher` — meaning you need the matching repair consumable.
7. **Restrictions you will hit** (`language/messages.yml`): "You don't have the right class!", "You don't have enough levels to use this item!", "You can't use an unidentified item!", "This item is broken, you first need to repair it.", "This item is linked to another player, you can't use it!" (soulbound), "You don't have enough mana/stamina!", "You don't have enough {attribute}!", "You don't have enough levels in {profession}!", plus a two-handed restriction (`two-handed-item-restriction: true`).

### Content it adds ON THIS SERVER

#### Scale
**1,395 item definitions across 116 files** in `plugins/MMOItems/item/`.
*(Method: `grep -hcE "^[A-Za-z0-9_]+:" *.yml` summed across all files — MMOItems stores one top-level YAML key per item.)*

Largest files: `staff_runes.yml` (176), `foods.yml` (99), `armors.yml` (97), `wand_runes.yml` (81), `materials.yml` (74), `sword_runes.yml` (70), `research.yml` (63), `tools.yml` (57), `mage_armors.yml` (44), `ingredients.yml` (44), `gemstones.yml` (40), `helmets.yml` (37), `pets.yml` (34), `icons.yml` (33), `herbs.yml` (32), `utils.yml` (29), `loot.yml` (28), `medicines.yml` (25), `special_weapons.yml` (21), `consumables.yml` (19), `armor_runes.yml` (17), `music.yml` (15), `surgery.yml` (14), `masks.yml` (14), `lore.yml` (13), `mage_staffs.yml` (12), `artifact.yml` (11), `ring.yml` (10), `miscellanea.yml` (10), `instruments.yml` (9), `amulet.yml` (9), `sword.yml` (8), `seithr_runes.yml` (8), `currency.yml` (8), `cerrith_runes.yml` (8), `books.yml` (7), `greataxes.yml` (6). Weapon-class files sit at 5 each (warhammers, spears, shortswords, shortbows, shields, polearms, mage_wands, mage_swords, longswords, longbows, greathammers, daggers, crossbows, battleaxes, banners). **57 of the 116 files are empty placeholders.**

#### Item types (`plugins/MMOItems/item-types.yml`)
**98 type entries.** 23 are hidden base types (`hide-in-game: true`): DAGGER, SPEAR, HAMMER, GAUNTLET, WHIP, STAFF, BOW, CROSSBOW, MUSKET, LUTE, ARMOR, TOOL, CATALYST, OFF_CATALYST, MAIN_CATALYST, ORNAMENT, ACCESSORY, CONSUMABLE, MISCELLANEOUS, SKIN, GEM_STONE, BLOCK. The player-visible types:

**Weapons** — Sword, Battleaxes, Daggers, Warhammers, Spears, Polearms, Greathammers, Longswords, Greataxes, Shortbows, Longbows, Crossbows, Guns, Lutes, Mage Blades (`MAGE_SWORDS`), Mage Wands, Mage Staffs, Lore Weapons, Special Weapons, Throwables

**Off-hand / defensive** — Shortswords, Shields, Banners, Jewelry (all children of `OFF_CATALYST`)

**Armour** — Armors, Mage Armors, Helmets, Special Armors

**Tools** — Tools, Fishing Rods

**Gems & runes** — Gem Stones, **Cerrith Runes**, **Oseni Runes**, **Seithr Runes**, **Armor Runes**

**Accessories (MMOInventory slots)** — Amulet, Artifact, Ring, Masks

**Materials & consumables** — Materials, Herbs, Medicines, Currency, Keys, Lockpicks, Consumables, Utils, Loot, Pets, Books, Research, Lore, Music, Instruments, Miscellanea, Crafting, Blocks, Surgery, Icons

**Helper types** — 24 internal variants (`HELPER_ONEHANDED`, `HELPER_POLEARMS`, `HELPER_GREATHAMMERS`, `HELPER_LONGSWORDS`, `HELPER_GREATAXES`, `HELPER_BOWS`, `HELPER_MUSKETS`, `HELPER_LUTES`, `HELPER_MAGE_SWORDS`, `HELPER_MAGE_WANDS`, `HELPER_MAGE_STAFFS`, `HELPER_SHORTSWORDS`, `HELPER_SHIELDS`, `HELPER_ARMORS`, `HELPER_TOOLS`, `HELPER_MISCELLANEA`, `HELPER_CONSUMABLES`, `HELPER_GEMSTONES`, `HELPER_JEWELERY`). These have `hide-in-game: false` but almost all their item files are empty (only `helper_armors.yml` and `helper_miscellanea.yml` hold 1 item each).

#### Tiers / rarities (`plugins/MMOItems/item-tiers.yml`)
**11 tiers**, in the file's order:

| Tier | Display | Generation chance | Capacity base / scale | Deconstruct essence | Loss coefficient |
|---|---|---|---|---|---|
| TRASH | `&8&lTRASH` | — | — | — | — |
| COMMON | `&7&lCOMMON` (parent TRASH) | — | — | — | — |
| UNCOMMON | `&8&lUNCOMMON` | 0.15 | 6 / 0.10 | `UNCOMMON_WEAPON_ESSENCE` | 2 |
| RARE | `&6&lRARE` | 0.06 | 9 / 0.15 | `RARE_WEAPON_ESSENCE` | 3 |
| VERY_RARE | `&e&lVERY RARE` | 0.03 | 10 / 0.17 | `VERY_RARE_WEAPON_ESSENCE` | 3 |
| LEGENDARY | `&b&lLEGENDARY` | 0.01 | 12 / 0.20 | `LEGENDARY_WEAPON_ESSENCE` | 4 |
| MYTHICAL | `&5&lMYTHICAL` | 0.003 | 15 / 0.30 | `MYTHICAL_WEAPON_ESSENCE` | 5 |
| EPIC | `&4&lEPIC` | — | — | `EPIC_WEAPON_ESSENCE` | 6 |
| MAGICAL | `&2&lMAGICAL` | — | — | `MAGICAL_WEAPON_ESSENCE` | 3 |
| UNIQUE | `&c&lUNIQUE` | — | — | `UNIQUE_WEAPON_ESSENCE` | 9 |

Deconstructing an item **always** yields either 1 essence of its tier (success) or `WEAPON_POWDER` (failure). All tiers use `spread: .1` / `max-spread: .3` and unidentification `range: 6`. **UNCOMMON is the only tier with `item-glow` configured** (hint: true, colour GRAY).

Default tier for untagged items is **Common** (`config.yml` → `default-tier-name: Common`); default item capacity base 3.

> **Only 5 items in the whole `item/` folder actually declare a `tier:`** (2 LEGENDARY, 2 EPIC, 1 RARE). The tier system is therefore mostly used for generated/dropped loot rather than the hand-built catalogue. Flagged under Uncertain.

#### Item sets (`plugins/MMOItems/item-sets.yml`)
Nine sets: ARCANE, STEEL, GINGERBREAD, DRAGON, PSYCHIC, UNDEADSLAYER, SPELLCASTER, OMNIELEMENTAL, HATRED. Examples: *Arcane Set* — [3] +20 % Magic Damage, [4] +30 Max Mana & permanent Speed I. *Steel Set* — [3] +5 % Damage Reduction, [4] +10 %. *Dragon Set* — [4] a magical shield absorbing 60 % of damage for 5 s when hit, 10 s cooldown. *Hatred Set* — [2] −6 % damage taken and a `LIFE_ENDER` fire meteor on hit, 30 s cooldown.

> **No item in `plugins/MMOItems/item/` declares a `set:` key**, so these set bonuses are unreachable as configured. The list matches MMOItems' stock example file. Flagged under Uncertain.

#### Upgrade templates (`plugins/MMOItems/upgrade-templates.yml`)
Only two, and both look like stock examples:
- `weapon-default`: +3 % Attack Damage, +2 Critical Strike Chance, +1 % PvE Damage per upgrade level.
- `armor-template-example`: +3 % Armor, +2 % Armor Toughness, +5 % Block Rating, +5 % Dodge Rating, +5 % Parry Rating.

#### Gem sockets & runes — the real socketing system
This is genuinely custom server content. Sockets are named strings; a rune fits a socket only if its `gem-color` matches the socket name exactly.

**Socket/rune families found** (`item/sword_runes.yml`, `staff_runes.yml`, `wand_runes.yml`, `armor_runes.yml`, `gemstones.yml`):

| Family | Tiers available | Socket names |
|---|---|---|
| Sword runes | Common / Rare / Epic / Legendary | `<tier> Sword Spell Rune`, `<tier> Sword Support Rune` |
| Staff runes | Common / Rare / Epic / Legendary | `<tier> Staff Projectile Rune`, `<tier> Staff Support Rune`, `<tier> Staff Minor Spell Rune`, `<tier> Staff Major Spell Rune` |
| Wand runes | Common / Rare / Epic / Legendary | `<tier> Wand Minor Spell Rune`, `<tier> Wand Major Spell Rune` |
| Mage armour runes | Common / Rare / Epic / Legendary | `<tier> Mage Armor Rune` |
| Generic armour runes | Minor / Lesser / Greater / Ascendant | `<tier> Armor Rune` |
| Generic runes | Minor / Lesser / Greater / Ascendant | `<tier> Rune` |
| Gemstones | Basic / Polished / Radiant / Mythical | `Basic Gemstone`, `Polished Gemstone`, `Radiant Gemstone`, `Mythical Gemstone` |
| **Magic schools** (staff sockets, special) | — | `Arcanum`, `Bloodmagic`, `Illusion`, `Necromancy`, `Shadowmancy`, `Spiritual` × Projectile / Support / Minor Spell / Major Spell |

Rune counts by socket name (number of distinct rune items carrying that `gem-color`): Legendary Staff Major Spell 16; Legendary Sword Spell 15; Legendary Wand Major Spell 15; Epic/Rare/Common Staff Major Spell 13 each; Epic/Rare/Common Wand Major Spell 12 each; Legendary Staff Minor Spell 10; Epic/Rare/Common Staff Minor Spell 9 each; Epic/Rare/Common Sword Spell 10 each; Legendary Staff Projectile 8; Legendary Wand Minor Spell 8; Epic/Rare/Common Staff Projectile 7 each; Epic/Rare/Common Wand Minor Spell 7 each; Sword Support 6 per tier; Staff Support 6 per tier; each Gemstone grade 10; each generic Rune / Armor Rune grade 5 / 4.

Runes carry a school line in their lore, e.g. `§7Type: <#466629>Cerrith`, tying them to the Cerrith / Oseni / Seithr rune item-types.

**Runes grant abilities, and higher tiers lower the cooldown.** Worked example — `RUNE_OF_BACKSTEP` (`item/sword_runes.yml`): ability `BACKSTEP`, trigger mode `RIGHT_CLICK`, mana cost **10 at every tier**; cooldown **18.0 s (Common) → 16.0 s (Rare) → lower still at Epic/Legendary**.

There is also a **rune recycler**: `RECYCLER_SWORD_RUNE` — "§a§lRecycle §r§f1x Sword Runestone", ingredients "2x Any Sword Rune".

Gear with sockets is currently limited to six files: `lutes.yml`, `mage_armors.yml`, `mage_staffs.yml`, `mage_swords.yml`, `mage_wands.yml`, `shortbows.yml`. Mage armour is by far the most socketed (28 `Legendary Mage Armor Rune` sockets across the file, plus 4 each of Common/Rare/Epic).

Mage staffs are the clearest progression example — each material tier gets **4 sockets** of the matching rune tier:

| Staff | Durability | Sockets |
|---|---|---|
| Iron Mage Staff | 500 | none |
| Steel Mage Staff | 1000 | Rare ×4 (Projectile, Support, Minor Spell, Major Spell) |
| Abyssalite Mage Staff | 2000 | Epic ×4 |
| Mythril Mage Staff | 4000 | (next tier up, see file) |

All mage staffs are `two-handed: true`, `unstackable: true`, `repair-type: mage`, `required-class: Mage`, and disable repairing/enchanting/smithing/smelting/crafting.

#### Class restrictions on gear
Count of `required-class` entries across all item files:

| Class | Items restricted to it |
|---|---|
| Warrior | 79 |
| Paladin | 79 |
| Mage | 65 |
| Guardian | 53 |
| Archer | 39 |
| Bard | 28 |
| Musketeer | 19 |
| *"Gaurdian"* | 1 — **typo**, this restriction will never match |

#### Displayed types a player sees on item tooltips
Top values from `displayed-type:` across `item/*.yml`: Material (73), Research (63), Staff Major Spell Rune (55), **Light Armor (53)**, Wand Major Spell Rune (51), Sword Spell Rune (45), **Mage Armor (44)**, Blank Gemstone (40), Ingredient (38), Staff Minor Spell Rune (37), Herb (32), Wand Minor Spell Rune (29), Tool (29), Staff Projectile Rune (29), Sword Support Rune (24), Staff Support Rune (24), **Medium Armor (24)**, Medicine (24), **Heavy Armor (24)**, Protective Gear (20), Potion (15), Surgery (14), Fruit (13), Ammunition (13), Mage Staff (12), Mask (10), Archeology (10), `'&cUnknown'` (10), Dagger (9), Amulet (9), Sword (8), Fishing Rod (8), Vegetable (7), Key (7), Currency (7), Artisan Tool (7), Greataxe (6), and 5 each of Warhammer, Spear, Shortsword, Shortbow, Shield, Polearm, Mage Wand, Mage Blade, Longsword, Longbow, Greathammer, Crossbow, Battleaxe, Cooking Utensil, Loot, Minor Rune, Lesser Rune, Greater Rune.

Food and drink use tiered display names: `Food (II)` ×19, `Food (III)` ×16, `Food (IV)` ×15, `Food (V)` ×14, `Drink (III)` ×9.

There are therefore **four armour weights players will see** — Light Armor, Medium Armor, Heavy Armor and Mage Armor — matching the class `attribute-lore` equipment lists in MMOCore.

#### Repair system
`repair-type` values across the catalogue: **general 199**, **mage 60**, **tool 22**, **fisher 3**. Almost all gear sets `disable-repairing: true` for the vanilla anvil.

#### Example weapon / armour numbers

Base swords (`item/sword.yml`):

| Item | Attack damage | Attack speed | Durability | Class |
|---|---|---|---|---|
| Wooden Sword | 2.0 | 1.6 | 60 | — |
| Stone Sword | 2.5 | 1.6 | 120 | — |
| Iron Sword | 3.5 | 1.6 | 500 | Warrior |

Light armour (`item/armors.yml`):

| Item | Armor | Extra | Durability |
|---|---|---|---|
| Leather Helmet / Chestpiece / Leggings / Boots | 0.25 each | — | 300 each |
| Light Iron Helmet (and set) | 0.5 | +0.004 Movement Speed | 500 |

Mage staff durability ladder: Iron 500 → Steel 1000 → Abyssalite 2000 → Mythril 4000.

### Crafting stations — full inventory

**14 stations, 661 recipes total.** *(Method: for each file, counted 4-space-indented keys inside the `recipes:` block.)*

| Station (display name) | File | Recipes |
|---|---|---|
| Block Station | `block-station.yml` | 129 |
| Copper Station | `copper-station.yml` | 118 |
| Forester Station | `forester-station.yml` | 117 |
| Ingot Station | `ingot-station.yml` | 61 |
| Tool Station | `tool-station.yml` | 48 |
| Alchemy Station | `alchemy-station.yml` | 36 |
| Medicine Station | `medicine-station.yml` | 35 |
| Animal Station | `animal-station.yml` | 32 |
| Research Station | `research-station.yml` | 28 |
| Instrument Station | `instrument-station.yml` | 16 |
| Archeology Station | `archeology-station.yml` | 12 |
| "Enginner Station" *(sic — typo in the config's `name:` field)* | `engineer-station.yml` | 12 |
| Meal Prep Station | `meal-prep-station.yml` | 9 |
| Fishing Station | `fishing-station.yml` | 8 |

Note: `copper-station.yml`'s GUI title is mislabelled `Block Station ({page}/{max_page})` — a copy-paste bug players will see.

**Crafting times used:** 2 s (367 recipes), 5 s (219), 10 s (60), 1 s (14), 15 s (1).

**Recipe gating.** 367 ingredient entries are `vanilla{}` items, **231 recipes are locked behind a permission**, and **16 recipes are Bard-only** (`class{list=Bard}` — the instrument station). The permission gates and the exact text players see:

| Permission node | Shown to the player as | Recipes gated |
|---|---|---|
| `professions.tree_crafter` | "Requires Tree Maker" | 115 |
| `professions.physician` | "Requires Physician" | 35 (30 gold-coloured + 5 green) |
| `professions.breeder_1` / `_2` / `_3` | "Requires Breeder I / II / III" | 10 / 4 / 5 |
| `professions.transmutation_1` / `_2` | "Requires Transmutation I / II" | 10 / 3 |
| `professions.fisher` | "Requires Fisher" | 7 |
| `professions.artisan` | "Requires Artisan" | 7 |
| `professions.potion_brewer_1` / `_2` | "Requires Potion Brewer I / II" | 5 / 4 |
| `professions.goldsmith` | "Requires Goldsmith" | 4 |
| `mcpet.pet_master_1` | "Requires Pet Master I" | 4 |
| `professions.vehicle_mechanic` | "Requires Vehicle Mechanic" | 2 |
| `professions.axe_maker_1/2/3` | "Requires Axe Maker I / II / III" | 1 each |
| `professions.pickaxe_maker_1/2/3` | "Requires Pickaxe Maker I / II / III" | 1 each |
| `professions.shovel_maker_1/2/3` | "Requires Shovel Maker I / II / III" | 1 each |
| `professions.hoe_maker_1/2/3` | "Requires Hoe Maker I / II / III" | 1 each |
| `professions.alchemy_collector_maker_1/2/3` | "Requires Alchemy Collector Maker I / II / III" | 1 each |
| `tfmc.thief` | "Requires Thief Character Trait" | 1 |
| `gilded` | "Requires Gilded+" | 1 — a **donor rank** gate |

> This is a **second, permission-based profession system separate from MMOCore's three professions.** MMOCore's Crafter/Agriculturist/Herborist do NOT unlock these recipes; a `professions.*` permission node does. Player-facing profession titles that exist only here: **Tree Maker, Physician, Breeder I–III, Transmutation I–II, Fisher, Artisan, Potion Brewer I–II, Goldsmith, Pet Master I, Vehicle Mechanic, Axe/Pickaxe/Shovel/Hoe/Alchemy Collector Maker I–III, Thief (a "Character Trait")**. How players earn those nodes is outside MMOItems' config and is **unverified**.

**Recipes can also award MMOCore profession EXP.** Example from `tool-station.yml`: crafting an Iron Axe fires `exp{profession=herborist;amount=5}`, an Iron Pickaxe fires `exp{profession=crafter;amount=5}`, an Iron Hoe fires `exp{profession=forager;amount=5}`.

**Recipes can output ItemsAdder items directly.** The whole Meal Prep Station is ItemsAdder output — `itemsadder{id=frying_pan}`, `saucepan`, `pot`, `cutting_board`, `butter_churn`, `butter_plate`, `plate`, `bowl`, `tool_shelf`; each 2 s and one IRON_INGOT or OAK_PLANKS.

Station condition types the GUI can display (`language/crafting-stations.yml`): profession level, mana, money, MMOCore level, stellium, stamina, permission, placeholder, attribute, class, food. Ingredient sources supported: mmoitem, vanilla, mythic, **itemsadder**.

### Player command table — MMOItems

**MMOItems registers no command a normal player can run.** From the jar's `plugin.yml` there are only two commands, and only three command classes exist in the jar (`PluginCommand`, `UpdateItemCommand`, `CraftingStationCommand`):

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | Players interact with MMOItems purely through station blocks, applying runes/gems, and consumables |

**Admin/staff commands excluded:**

| Command | Aliases | Permission | Default |
|---|---|---|---|
| `/mmoitems` | `/mi` | subcommands gated by `mmoitems.admin` | op |
| `/mi stations open <station> <player>` | — | `mmoitems.admin` | op — the documented way to open a station from an NPC |
| `/mi give <type> <id> <player> [amount]` | — | `mmoitems.admin` | op — used by MMOCore's Mage exp-table |
| `/updateitem` | `/upitem`, `/itemup` | `mmoitems.update` | op |
| `/soulbound` | — | `mmoitems.soulbound` | op |

Other MMOItems permission nodes (all default **op** or **false**, i.e. not player-facing): `mmoitems.edit.op`, `mmoitems.bypass.item`, `mmoitems.bypass.ability`, `mmoitems.bypass.class`, `mmoitems.bypass.soulbound`, `mmoitems.bypass.level`, `mmoitems.update-notify`.

Note `config.yml` sets `permissions.items: true` and `enable_item_granted_permissions: true` — **items on this server can require and grant permission nodes**, which is plausibly how the `professions.*` recipe gates are handed out. Unverified. Ability permission checks are **off** (`permissions.abilities: false`).

### Numbers that matter to players — MMOItems

- **Crafting queue: up to 64 items at once**, per station.
- **Crafting times: 1 s, 2 s, 5 s, 10 s or 15 s** per recipe.
- **Item level spread: 2** (`item-level-spread: 2`).
- **Durability loss cap: 0** (`durability.loss_cap: 0` — no cap configured).
- **Soulbound:** damage base 1, +1 per soulbound level; **items are kept on death** (`keep-on-death: true`) and **can be dropped** (`can-drop: true`).
- **Legacy ranged weapon defaults** (lutes, muskets): attack speed 0.67, range 16, recoil 0.1.
- **Pickaxe power defaults:** Wooden 5, Stone 10, Golden 15, Iron 20, Diamond 25, Netherite 30.
- **Lootsplosion is on** — dropped items burst out with colour, offset 0.2, height 0.6 — and **dropped items glow by tier** (`dropped-items.tier-glow: true`) with tier hints.
- **Action bar tells you** about: ability cooldown, item cooldown, not enough mana, not enough stamina, two-handed conflict, can't-use-item, mitigation. Item-break notifications are **off**.
- **Cooldown progress bar character:** `█`. **Stat range dash:** `⎓`.
- **Two-handed restriction is enforced** — you cannot use the off hand with a two-handed weapon.
- **Skins are locked** (`locked-skins: true`) — a skin already applied cannot be swapped ("A skin has already been applied onto your {item}!").
- **Custom block world-gen is disabled**; mushroom drops are replaced (`custom-blocks.replace-mushroom-drops: true`).
- **Blacklisted block:** OBSIDIAN cannot be used as a custom block.
- **Vanilla interactions all remain enabled** (interact, repair, enchant, smelt, smith, craft, arrow-shooting are all `false` under `disable-interactions`) — restrictions are applied per-item instead.
- **Recipe book is used** for MMOItems recipes (`recipes.use-recipe-book: true`).
- **On item revision** the server keeps: enchantments, soulbound, gems, upgrades, tier, skins, modifications, advanced enchantments. It does **not** keep display name, lore or rerolls. Revisions are disabled on craft (`disable-on.craft: true`). `MANGO` and `STEEL_HELMET` are excluded from phat-loot revision.
- **Inventory stat refresh delay: 20 ticks (1 s)** (`inventory-update-delay: 20`); the plugin does **not** iterate the whole inventory (`iterate-whole-inventory: false`) — only equipped slots count.
- **Gem upgrade default: NEVER** (`gem-upgrade-default: NEVER`) — gems do not inherit item upgrade levels. Unsocketed gems are **not** regenerated (`regenerate-gems-when-unsocketed: false`) but extra gems **are** dropped (`drop-extra-gems: true`).

### Cross-links — MMOItems
- **TFMCCore** (`plugins/TFMCCore/stations.yml`) — binds all 14 crafting stations to world blocks. **Without this plugin, players have no way to open a station.**
- **ItemsAdder** — 6 stations sit on ItemsAdder furniture (`tfmc:medicine_station`, `tfmc:ammunition_station`, `tfmc:meal_prep_station`, `tfmc:fishing_station`, `tfmc:animal_station`, `tfmc:archeology_station`); the Meal Prep Station outputs ItemsAdder items; `itemsadder{}` is a supported ingredient type.
- **MMOCore** — `required-class` uses MMOCore class names; recipes award MMOCore profession EXP; station conditions can check MMOCore level, mana, stamina, stellium and attributes.
- **MMOInventory** — the Amulet / Ring / Artifact item types exist solely to fill MMOInventory accessory slots.
- **MythicLib** — hard dependency; stat and ability engine.
- **MythicMobs** — `plugindata/mm_factions.yml`; `mythic{}` ingredients supported.
- **LuckPerms** — carries the 231 `professions.*` / `tfmc.thief` / `gilded` recipe gates.
- **Vault / DenarEconomy** — money conditions on recipes.
- **MCPets** — `mcpet.pet_master_1` gates 4 recipes; there is a `PETS` item type with 34 items.
- **GemInfusion** — a separate plugin folder exists on this server; its relationship to MMOItems gem sockets was **not investigated** (out of scope for this dossier).
- **CustomFishing / CustomCrops / BreweryX / Cooking / Archaeo / GunsAndGadgets / MusicalInstruments** — plugin folders exist that thematically overlap with the Fishing / Animal / Alchemy / Meal Prep / Archeology / Guns / Instruments item types and stations. The exact hand-off was not traced.
- Soft-depends declared but not confirmed in use: WorldGuard, Residence, BossShopPro, MMOProfiles, PlaceholderAPI, Denizen, MythicEnchants.

### Uncertain / unverified — MMOItems
1. **How players earn the `professions.*` permission nodes** that unlock 231 of the 661 recipes. Not configured anywhere in MMOItems; likely LuckPerms plus another plugin. The LuckPerms H2 database is not readable as text.
2. **Item sets appear unused** — nine sets are defined but no item declares `set:`.
3. **Tiers are barely applied to hand-built items** — only 5 of 1,395 items declare a `tier:`.
4. **Upgrade templates look like stock examples** and no item file declares an `upgrade:` block, so the upgrade/refining system may be inactive for hand-built gear.
5. **`drops.yml` is empty** (`blocks:`, `customblocks:`, `monsters:` all blank) — MMOItems contributes no block or mob drops of its own.
6. **`custom-stats.yml` contains only a stock "MyLuck" test stat.**
7. **`gen-templates.yml` is stock** (basic / slime-chunks-only / mountain / nether ore templates) and world-gen is disabled anyway.
8. **`modifiers/example_modifiers.yml` and `tooltips/example_tooltips.yml`** were not read in detail; their file names indicate stock examples.
9. The typo `required-class: Gaurdian` on one item means that restriction can never match — impact unknown.
10. Per-file item counts were derived by grepping top-level YAML keys; a handful of files could contain non-item top-level keys, so individual counts may be off by one or two. The method is stated so it can be re-run.
11. **Individual recipe ingredient lists were not transcribed** — only totals, gates, times and representative examples. A full recipe-by-recipe table would need a second pass over `plugins/MMOItems/crafting-stations/*.yml` (~7,900 lines).
12. **`item.zip`** exists in the MMOItems folder and was not opened; it may be a backup of the item folder.

---

## 3. MMOInventory

### What it is
MMOInventory adds extra equipment slots beyond vanilla armour — on this server, four accessory slots that live in the bottom row of your normal inventory.

### How a player actually uses it

1. Open your **normal vanilla inventory (E)**. The active inventory on this server is `tfmc_inventory`, which is `type: vanilla` — it places its slots **directly into the player's 3×9 inventory grid** rather than into a separate GUI (`plugins/MMOInventory/inventory/tfmc_inventory.yml`).
2. You'll see four placeholder items in **inventory slots 9, 10, 11, 12** (the leftmost four of the top storage row): Ring Slot, Amulet Slot, Artifact Slot I, Artifact Slot II.
3. **Drag and click** an accessory onto the matching slot to equip it — the placeholder lore reads "Drag & Click an accessory onto this slot to equip it."
4. Only the right MMOItems type fits: Ring Slot accepts `mmoitemstype{type=RING}`, Amulet Slot accepts `AMULET`, both Artifact slots accept `ARTIFACT`.
5. Equipped accessories' stats apply to your character through MythicLib.
6. **There is no player command.** The custom-inventory GUI (`/custominv`) belongs to the *disabled* legacy inventory — see below.

### Content it adds ON THIS SERVER

Three inventory definitions exist; **only one is enabled**.

| File | ID | Type | Enabled | Notes |
|---|---|---|---|---|
| `inventory/tfmc_inventory.yml` | `tfmc_inventory` | vanilla | **yes** | The live one |
| `inventory/default_mmoinventory.yml` | `mmoinventory1_legacy` | custom | no | Stock MMOInventory 1 migration layout |
| `inventory/vanilla_inventory.yml` | `vanilla_inventory` | vanilla | no | Stock 5-slot example (Amulet, Bracelet, Gloves, Left Ring, Right Ring) |

**Live slots (`tfmc_inventory`) — 4 slots:**

| Slot name | Vanilla inventory slot | Accepts | Placeholder icon |
|---|---|---|---|
| Ring Slot | 9 | MMOItems type `RING` | DIAMOND_HOE, custom-model-data 8 |
| Amulet Slot | 10 | MMOItems type `AMULET` | DIAMOND_HOE, custom-model-data 5 |
| Artifact Slot I | 11 | MMOItems type `ARTIFACT` | DIAMOND_HOE, custom-model-data 10 |
| Artifact Slot II | 12 | MMOItems type `ARTIFACT` | DIAMOND_HOE, custom-model-data 10 |

Matching MMOItems stock: `item/ring.yml` (10 rings), `item/amulet.yml` (9 amulets), `item/artifact.yml` (11 artifacts).

**The disabled `mmoinventory1_legacy` layout** (documented because it shows what is configured but *not* what players see): a 4-row custom GUI titled "Equipment" with **HELMET, CHESTPLATE, LEGGINGS, BOOTS, OFF_HAND, ELYTRA, LEFT_RING, RIGHT_RING, AMULET, BRACELET, GLOVES, ARTIFACT_1, ARTIFACT_2, ARTIFACT_3** (artifact slots additionally require `unique{enabled=true}` so you cannot equip duplicates), an Information button reading `%mmocore_level%`, `%mmocore_class%`, `%vault_eco_balance%`, `%mythiclib_stat_max_health%`, `%mythiclib_stat_defense%`, `%mythiclib_stat_attack_damage%` (clicking it runs `/p`), and a Close button. Opening plays `BLOCK_CHEST_OPEN`, closing plays `BLOCK_CHEST_CLOSE`. Open command `custominv` with aliases `mmoinv`, `rpginv`, `rpginventory`, permission `custom_inv.open.mmoinventory_default`. **All of this is inert because `enabled: false`.**

**Elytra handling** (config-level, applies globally): elytras auto-deploy after a **4-block fall** (`elytra_deployment.fall_distance_threshold: 4`) and deployment is skipped while Slow Falling is active. Equipping shows the action-bar message `☄ Equipped Elytras ☄` for 40 ticks with sound `ITEM_ARMOR_EQUIP_ELYTRA`; unequipping shows `☄ Unequipped Elytras ☄` (`plugins/MMOInventory/language.yml`). **Note there is no enabled ELYTRA slot on `tfmc_inventory`**, so whether this is reachable is unverified.

**Player data confirms low usage:** all 22 files in `plugins/MMOInventory/userdata/` read `{"Version":1,"Elytra":{"Deployed":false,"Equipped":false},"Inventories":{}}` — i.e. **no player currently has anything equipped in an MMOInventory slot**.

### Player command table — MMOInventory

**No player command.**

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | The live inventory is `type: vanilla`; its slots appear in the normal inventory with no command needed |

`/custominv` (aliases `mmoinv`, `rpginv`, `rpginventory`, permission `custom_inv.open.mmoinventory_default`) is defined but belongs to the **disabled** `mmoinventory1_legacy` inventory.

**Admin/staff commands excluded:**

| Command | Aliases | Permission | Default |
|---|---|---|---|
| `/mmoinventory` | `/rpginventory`, `/mmoinv`, `/rpginv` | `mmoinventory.admin` | op — includes reloading and inspecting another player's inventory ("You are now inspecting {player}'s inventory {inventory}.") |

> Alias collision worth noting: `/mmoinv` and `/rpginv` are listed **both** as admin aliases of `/mmoinventory` in the jar's `plugin.yml` **and** as aliases of the (disabled) `custominv` command. Which wins is unverified.

### Numbers that matter to players — MMOInventory
- **4 extra equipment slots** on this server: 1 Ring, 1 Amulet, 2 Artifacts.
- **Elytra auto-deploy at 4 blocks of fall distance**, skipped under Slow Falling.
- **Auto-save every 1800 s (30 min)**.
- **Stacked items cannot be equipped** (`disable-equiping-stacked-items: true`, a dupe-bug guard).
- The live inventory is `type: vanilla`, so `drop_on_death` does not apply — accessory retention follows the world's `keepInventory` rule.

### Cross-links — MMOInventory
- **MMOItems** — every slot restriction is `mmoitemstype{type=…}`; MMOItems declares `loadbefore: [MMOInventory]`.
- **MythicLib** — hard dependency; applies accessory stats.
- **MMOCore** — the (disabled) info panel reads `%mmocore_level%` / `%mmocore_class%` and runs `/p` on click.
- **Vault** — `%vault_eco_balance%` in the disabled info panel.
- **PlaceholderAPI** — supplies the above placeholders.
- **Oraxen** — file generation hook is **off** (`generate-oraxen-files: false`); the server uses ItemsAdder instead.
- **ItemsAdder** — MMOInventory's own resource pack is **disabled** (`resource-pack.enabled: false`), so the slot icon textures must come from `tfmc_pack` if they render at all.
- `provides: [RPGInventory]` — MMOInventory registers itself as RPGInventory for compatibility with other plugins.

### Uncertain / unverified — MMOInventory
1. **Whether the Ring/Amulet/Artifact placeholder icons render correctly.** They use legacy integer `custom-model-data` (8, 5, 10) on a DIAMOND_HOE, while the rest of the server has moved to ItemsAdder. Whether `tfmc_pack` provides matching DIAMOND_HOE models was not confirmed.
2. **Elytra auto-deploy reachability** — there is no enabled elytra slot, so the feature may be dead config.
3. **Alias collision** between `/mmoinv` / `/rpginv` (admin command vs. disabled custominv command).
4. **MySQL is disabled**; all data is flat-file, and every player file is currently empty of equipped items — so no live example of a filled slot could be observed.

---

## 4. ItemsAdder

### What it is
ItemsAdder is the plugin that makes the server *look* custom: it delivers the server's resource pack (`tfmc_pack`) to your client and turns plain Minecraft items into the custom-textured food, tools, armour, building blocks, placeable furniture and chat emojis you see everywhere on this server.

### How a player actually uses it

1. **You download a resource pack when you join.** ItemsAdder hosts it itself and shows a title screen "&a&lApplying resourcepack..." / "&6Please be patient, it will only take some seconds!" while it applies (`plugins/ItemsAdder/config.yml` → `resource-pack.title.enabled: true`; `plugins/ItemsAdder/lang/en.yml` → `resourcepack-apply-title` / `resourcepack-apply-subtitle`).
2. **While the pack is being applied you are frozen.** `resource-pack.protect-player` sets `lock-player: true`, `cancel_commands: true`, `cancel_teleport: true`, `force_cancel_movement: true`.
3. **From then on ItemsAdder content is just items.** Custom blocks are placed and broken like vanilla blocks; furniture is placed like an item frame and is solid (you can walk into it); custom food is eaten normally.
4. **Emojis in chat** are typed as `:name:` and are replaced by an image — but only if you hold the matching permission (see the command/permission section; the server's LuckPerms audit log shows the emoji permission being granted to `donator`, `qa` and `lore`, not to `default`).
5. **You cannot browse the catalogue yourself** unless staff grant you `ia.user.ia` — see "Player command table" below. Nothing in this server's `plugin.yml` gives a normal player any ItemsAdder command by default.

### The resource pack

**Name:** `tfmc_pack` — this is the folder `plugins/ItemsAdder/contents/tfmc_pack/`, which holds only `resourcepack/assets/` (no item configs). It carries the server's class/mob **sound** banks (`archer_sounds`, `archmage_sounds`, `assassin_sounds`, `awakened_mage_sounds`, `bard_sounds`, `dimitrios_sounds`, `druid_sounds`, `ent_sounds`, `glacia_sounds`, `mage_sounds`, `necromancer_sounds`, `null_sounds`, `paladin_sounds`, `rms_dark_forest_sounds`, `shadowmancer_sounds`, `shaman_sounds`, `summoner_sounds`, `thunder_ronin_sounds`, `warrior_sounds`, `water_samurai_sounds`) plus `assets/minecraft/{models,textures,sounds,optifine}`. **Important:** `tfmc_pack` is the *pack asset folder*, not the whole pack — the final pack is built by merging **every** `contents/*/resourcepack/` folder into one zip.

**How it is built and served** (`plugins/ItemsAdder/config.yml`):

| Key | Value | Meaning |
|---|---|---|
| `resource-pack.uuid` | `d69238f2-b7ce-30b0-8262-17cd9490f29d` | pack UUID sent to clients |
| `resource-pack.hosting.self-host.enabled` | `true` | **ItemsAdder hosts the pack itself** |
| `resource-pack.hosting.self-host.server-ip` | `188.40.119.246` | host address |
| `resource-pack.hosting.self-host.pack-port` | `9900` (`append-port: true`) | the pack is downloaded from port 9900 |
| `resource-pack.hosting.self-host.protection.rate_limit` | `enabled: true`, `max_requests: 3` per `period_seconds: 2`, cooldown `30` min after `5` failed attempts | anti-scrape throttle |
| `resource-pack.hosting.{no-host,simple_self_host,lobfile,external-host}` | all `enabled: false` | no other hosting method is active |
| `resource-pack.auto_apply.enabled` | **`false`** | ItemsAdder does **not** push the pack itself on join |
| `resource-pack.kick-player-on-decline` | **`false`** | declining the pack does **not** kick you |
| `resource-pack.kick-player-on-fail` | **`false`** | a failed download does **not** kick you |
| `resource-pack.command.usage-cooldown-seconds` | `60` | `/iatexture` can be re-run once per minute |
| `resource-pack.allow_other_plugins_resourcepacks` | `false` | other plugins may not send their own pack |
| `resource-pack.zip.merge_other_plugins_resourcepacks_folders` | `- ModelEngine/resource pack` | ModelEngine's pack is merged into `tfmc_pack`'s zip |
| `resource-pack.zip.protect-file-from-unzip` | `protection_1/2/3: true`, `short_texture_references: true` | the built zip is obfuscated — confirmed: every entry in `plugins/ItemsAdder/output/generated.zip` reports a bogus 1337-byte size and mangled headers |

**What happens if you decline:** nothing punitive. Both `kick-player-on-decline` and `kick-player-on-fail` are `false`, so you stay connected and simply see vanilla textures — every custom item falls back to its base material (paper, baked potato, diamond hoe, leather armour, …). If the pack errors, the messages in `plugins/ItemsAdder/lang/en.yml` apply, e.g. `resourcepack-error-failed-download`: "&4Failed to download resourcepack. Check your CLIENT log to know the reason."

> Because `auto_apply.enabled: false`, the actual *send* must come from `server.properties` (`resource-pack` / `require-resource-pack`) or a proxy. The server root was not part of the inspected files — see Uncertain.

### Namespace catalogue

`plugins/ItemsAdder/contents/` contains **40 folders**. A folder name is *not* automatically the namespace — the namespace is whatever `info.namespace` says inside that folder's ymls, and on this server **six folders share the namespace `lzfurniture` and five share `elitecreatures`**. The table below lists every folder, its real namespace, and its defined-entry counts (parsed from every non-resourcepack `.yml` in the folder).

Counts are **config-defined entries**: `items:` entries with `specific_properties.block` are counted as blocks, with `behaviours.furniture` as furniture, with `specific_properties.armor` as armour pieces; everything else is a plain item.

| Folder | Namespace (`info.namespace`) | Cfg files | Items | Blocks | Furniture | Armour | Font images | Purpose / owning-consuming plugin |
|---|---|---|---|---|---|---|---|---|
| `_iainternal` | `_iainternal`, `_common` | 14 | 7 | 0 | 0 | 0 | 27 | ItemsAdder's own GUI icons, dictionaries and the cooldown-bar HUD. Owner: **ItemsAdder itself** |
| `customfishing` | `customfishing` | 2 | 64 | 0 | 0 | 0 | 0 | Fishing rods/baits/UI glyph fonts. Owner: **CustomFishing** (`plugins/CustomFishing/config.yml` sets `font: "customfishing:offset_chars"`) |
| `french_tavern` | `elitecreatures` | 2 | 0 | 0 | 20 | 0 | 0 | Bought decoration pack — tavern furniture. Consumer plugin: **none found** (decorative, placed by builders) |
| `funeral` | `elitecreatures` | 2 | 0 | 0 | 20 | 0 | 0 | Bought decoration pack — graveyard/funeral props. Consumer: none found |
| `grafitti` | `elitecreatures` | 2 | 0 | 0 | 32 | 0 | 0 | Bought decoration pack — graffiti decals. Consumer: none found |
| `gunsandgadets` | *(none — assets only)* | 0 | 0 | 0 | 0 | 0 | 0 | `resourcepack/assets/gunsandgadgets` + gun sounds. Owner: **GunsAndGadgets** (`plugins/GunsAndGadgets/config.yml` references `tfmc:`) |
| `ia_tfmc` | **`tfmc`** | 6 | 20 | 4 | 33 | 0 | 0 | **The server's own core namespace** — crafting stations, gathering nodes, rails, plushies. Consumers: MMOItems crafting stations, AdvancedCrafting, Cooking, Magic, Games, Dowsing, Infestations, InteractibleFurniture |
| `iaalchemy` | `iaalchemy` | 40 | 22 | 2 | 4 | 3 | 11 | Stock vendor pack (alchemy machines, mana bar). Consumer: none found — **unused vendor content** |
| `iafestivities` | `iafestivities` | 24 | 9 | 0 | 5 | 0 | 0 | Stock vendor pack (halloween + christmas). Consumer: none found |
| `iageneric` | `iageneric` | 11 | 35 | 0 | 0 | 0 | 0 | Stock vendor pack (medals, coins, misc props). Consumer: none found |
| `iasurvival` | `iasurvival` | 167 | 150 | 27 | 0 | 16 | 5 | Stock vendor "survival" pack (tools, ores, fish, thirst HUD). Referenced by **BirdMessenger**, **Dowsing**, **MarketBlock** |
| `iawearables` | `iawearables` | 12 | 26 | 0 | 0 | 0 | 0 | Stock vendor pack — cosmetic hats (`behaviours.hat`). Consumer: none found |
| `izcozy` | `lzfurniture` | 1 | 0 | 0 | 14 | 0 | 0 | Furniture pack "cozy". Owner: **Woodworking** (`plugins/Woodworking/projects/cozy.yml` → `item: ia.lzfurniture:cozy_armchair`) |
| `izwitch` | `lzfurniture` | 1 | 0 | 0 | 10 | 0 | 0 | Furniture pack "witch". Owner: Woodworking (which project file is unverified) |
| `lzfurniture` | `lzfurniture` | 1 | 0 | 0 | 13 | 0 | 0 | Base furniture pack. Owner: **Woodworking** |
| `marauder_pack` | `lzfurniture` | 1 | 0 | 0 | 22 | 0 | 0 | Furniture pack "marauder". Owner: **Woodworking** (`projects/marauder.yml`) |
| `market_pack` | `lzfurniture` | 1 | 0 | 0 | 29 | 0 | 0 | Furniture pack "market". Owner: **Woodworking** (`projects/market.yml`) |
| `mcemojis` | `mcemojis` | 1 | 0 | 0 | 0 | 0 | 275 | Chat emojis that are pictures of vanilla items |
| `mcicons` | `mcicons` | 2 | 32 | 0 | 0 | 0 | 0 | GUI arrow/tick/cross icon items. Used by **Recycler** (`gui.yml`) and **Research** (`gui.yml`) |
| `parasitic_worm` | `parasitic_worm` | 1 | 1 | 0 | 0 | 0 | 0 | One item. Used by **Infestations** (`plugins/Infestations/groups.yml`) and **ModelEngine** |
| `playbox_custom_crops` | `playbox_custom_crops` | 41 | 92 | 2 | 170 | 0 | 3 | Crop seeds, produce and the growth-stage furniture models. Owner: **CustomCrops** (`plugins/CustomCrops/contents/crops/*.yml` → `seed: playbox_custom_crops:apple_seeds`) |
| `royal_pack_2` | `lzfurniture` | 1 | 0 | 0 | 11 | 0 | 0 | Furniture pack "royal". Owner: **Woodworking** (`projects/royal.yml`) |
| `rpg_pet_pack_vol6_brawlers` | *(none — assets only)* | 0 | 0 | 0 | 0 | 0 | 0 | Pet models/sounds for **ModelEngine / MCPets** (which one is unverified) |
| `skeleton_pack` | *(none — assets only)* | 0 | 0 | 0 | 0 | 0 | 0 | `assets/emdungeonskeletons` mob models/sounds — **ModelEngine / MythicMobs** (unverified) |
| `tfmc_armor` | `tfmc_armor` | 20 | 0 | 0 | 0 | **502** | 0 | **All custom armour skins on the server.** Consumers: **ArmourShop** (`plugins/ArmourShop/Categories/*.yml`), **AdvancedCrafting** (`model-schemes/basic.yml`, `stats.yml`) |
| `tfmc_armorshop` | `tfmc_armorshop` | 1 | 1 | 0 | 0 | 0 | 0 | A single test dagger (`ukindaickyngl_test_dagger.yml`). Consumer: **ArmourShop** (`Categories/i_daggers.yml`) |
| `tfmc_banner` | *(none — assets only)* | 0 | 0 | 0 | 0 | 0 | 0 | `assets/tfmc/textures/entity/banner` + `.../shield` — custom banner and shield patterns |
| `tfmc_blocks` | `tfmc_blocks` | 2 | 0 | **93** | 0 | 0 | 0 | The server's custom building blocks and metal/ore blocks. Referenced by **Research** (`aspects/elements.yml`) and **Thievery** (`categories.yml`) |
| `tfmc_cooking` | `tfmc_cooking` | 5 | **301** | 0 | 0 | 0 | 0 | Every cooking ingredient, intermediate, dish and cooking tool. Owner: **Cooking** (`plugins/Cooking/config.yml`, `crafting-stations.yml`, `conversions.yml`, `baking-trays.yml`, `models.yml`) and **DrinkBuilder** (`ingredients.yml`) |
| `tfmc_dead_pack` | **`dead_pack`** | 2 | 1 | 0 | 49 | 0 | 0 | Corpse/gore decoration props. Consumer: none found (decorative) |
| `tfmc_drinks` | `tfmc_drinks` | 1 | 0 | 0 | 0 | 0 | 0 | **Empty** — the file contains literally `items: {}` |
| `tfmc_drinks_dev` | `tfmc_drinks_dev` | 1 | 0 | 0 | 0 | 0 | 0 | **Empty** — `items: {}` |
| `tfmc_games` | `tfmc_games` | 2 | 55 | 0 | 0 | 0 | 0 | Playing cards and the deck. Owner: **Games** (`plugins/Games/cards.yml` → `item: ia.tfmc_games:cerrith_1`) |
| `tfmc_magic` | `tfmc_magic` | 2 | 98 | 0 | 0 | 0 | 0 | Magic artifact models (orbs, gems, books, amulets, bracelets). Owner: **Magic** (`plugins/Magic/artifacts/model-schemes.yml` → `orb(ia.tfmc_magic:oseni_orb_0)`) |
| `tfmc_pack` | *(none — assets only)* | 0 | 0 | 0 | 0 | 0 | 0 | **The resource-pack asset folder** — class/mob sound banks and `assets/minecraft` models & textures |
| `tfmc_submissions` | `tfmc_submissions` | 11 | 16 | 0 | 0 | 0 | 0 | Player-submitted roleplay items (each file is named `<player>_<item>.yml`). Consumers: **ArmourShop** (`Categories/ps_items.yml`), **RPCharacters** character data |
| `torture` | `elitecreatures` | 2 | 0 | 0 | 20 | 0 | 0 | Bought decoration pack — torture devices. Consumer: none found |
| `twitteremojis` | `twitteremojis` | 1 | 0 | 0 | 0 | 0 | 266 | Twemoji-style chat emojis |
| `urban` | `elitecreatures` | 2 | 0 | 0 | 26 | 0 | 0 | Bought decoration pack — urban street props. Consumer: none found |
| `vehicleframework` | *(none — assets only)* | 0 | 0 | 0 | 0 | 0 | 0 | Vehicle + ammunition models/sounds. Owner: **VehicleFramework** (`plugins/VehicleFramework/config.yml`) |
| **TOTAL** | **26 distinct namespaces** | **380** | **930** | **128** | **478** | **521** | **587** | 2 057 item-like entries + 587 font images |

**Six folders define no configs at all** (`gunsandgadets`, `rpg_pet_pack_vol6_brawlers`, `skeleton_pack`, `tfmc_banner`, `tfmc_pack`, `vehicleframework`): they exist purely so their textures/models/sounds get merged into the generated pack.

**Stale namespaces in the ID cache.** `plugins/ItemsAdder/storage/items_ids_cache.yml` holds **2 603 permanently assigned CustomModelData IDs** across 48 base materials, and it includes namespaces that **no longer have a content folder**: `cleric` (40 IDs), `tfmc_samurai` (16), `tfmc_steampunk_hats` (14), `arctic_knight` (9), `rrpg_void_edge_class` (8), `customcrops` (8), `amethyst` (4), `tfmc_pack` (32) and `__manually_handled` (12). These are reservations left over from removed content, not live items.


### Item catalogue

Every plain item and armour piece defined on this server, grouped by namespace and by source file. **1 451 entries** total (930 plain items + 521 armour pieces). Custom blocks (128) and furniture (478) are listed separately in the next subsection.

Display names are reproduced **exactly as written in the yml**, including legacy `&`-colour codes and `<#rrggbb>` hex codes — that is what a player sees, minus the colour formatting. Where a pack uses ItemsAdder's dictionary system the raw value is a key such as `display-name-coin`; the resolved English string from that pack's `configs/_dictionaries/en.yml` is shown and the key noted.

Nothing in this catalogue is truncated.


#### Server core items — namespace `tfmc` (20 entries)


**`plugins/ItemsAdder/contents/ia_tfmc/contents/base.yml`** — 20 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc:alchemy_station` | Medicine Station |
| `tfmc:lure` | Lure |
| `tfmc:gold_coin` | Gold Coin |
| `tfmc:train_track` | Train Track |
| `tfmc:track_small` | Track Small |
| `tfmc:track_medium` | Track Medium |
| `tfmc:track_large` | Track Large |
| `tfmc:railroad_switch` | Railroad Switch |
| `tfmc:artifact_display` | Artifact Display |
| `tfmc:pedestal` | Pedestal |
| `tfmc:tool_shelf` | Tool Shelf |
| `tfmc:frying_pan` | Frying Pan |
| `tfmc:saucepan` | Saucepan |
| `tfmc:cutting_board` | Cutting Board |
| `tfmc:plate` | Plate |
| `tfmc:pot` | Pot |
| `tfmc:bowl` | Bowl |
| `tfmc:butter_churn` | Butter Churn |
| `tfmc:butter_plate` | Butter Plate |
| `tfmc:bucket` | Bucket |


#### Cooking — namespace `tfmc_cooking` (301 entries)


**`plugins/ItemsAdder/contents/tfmc_cooking/contents/furniture.yml`** — 20 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_cooking:tool_shelf` | Tool Shelf |
| `tfmc_cooking:frying_pan` | Frying Pan |
| `tfmc_cooking:saucepan` | Saucepan |
| `tfmc_cooking:cutting_board` | Cutting Board |
| `tfmc_cooking:plate` | Plate |
| `tfmc_cooking:pot` | Pot |
| `tfmc_cooking:bowl` | Bowl |
| `tfmc_cooking:butter_churn` | Butter Churn |
| `tfmc_cooking:butter_plate` | Butter Plate |
| `tfmc_cooking:fire_pit` | Fire Pit |
| `tfmc_cooking:fire_pit_turner` | Fire Pit Turner |
| `tfmc_cooking:mixing_bowl` | Mixing Bowl |
| `tfmc_cooking:oven_bottom` | Oven Bottom |
| `tfmc_cooking:oven_top` | Oven Top |
| `tfmc_cooking:bread_tray` | Bread Tray |
| `tfmc_cooking:milling_stone` | Milling Stone |
| `tfmc_cooking:milling_stone_top` | Milling Stone Top |
| `tfmc_cooking:meat_hook` | Meat Hook |
| `tfmc_cooking:sausage_maker` | Sausage Maker |
| `tfmc_cooking:liquid_container` | Liquid Container |


**`plugins/ItemsAdder/contents/tfmc_cooking/contents/ingredients.yml`** — 26 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_cooking:tomato` | Tomato |
| `tfmc_cooking:onion` | Onion |
| `tfmc_cooking:lettuce` | Lettuce |
| `tfmc_cooking:cucumber` | Cucumber |
| `tfmc_cooking:corn` | Corn |
| `tfmc_cooking:basil` | Basil |
| `tfmc_cooking:black_pepper` | Black Pepper |
| `tfmc_cooking:salt` | Salt |
| `tfmc_cooking:cinnamon` | Cinnamon |
| `tfmc_cooking:vanilla` | Vanilla |
| `tfmc_cooking:nutmeg` | Nutmeg |
| `tfmc_cooking:spice_leaf` | Spice Leaf |
| `tfmc_cooking:olive` | Olive |
| `tfmc_cooking:pistachio` | Pistachio |
| `tfmc_cooking:rhubarb` | Rhubarb |
| `tfmc_cooking:garlic` | Garlic |
| `tfmc_cooking:strawberry` | Strawberry |
| `tfmc_cooking:orange` | Orange |
| `tfmc_cooking:plum` | Plum |
| `tfmc_cooking:banana` | Banana |
| `tfmc_cooking:grape` | Grape |
| `tfmc_cooking:lemon` | Lemon |
| `tfmc_cooking:lime` | Lime |
| `tfmc_cooking:peach` | Peach |
| `tfmc_cooking:pineapple` | Pineapple |
| `tfmc_cooking:cherry` | Cherry |


**`plugins/ItemsAdder/contents/tfmc_cooking/contents/intermediates.yml`** — 25 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_cooking:cup_of_water` | Cup of Water |
| `tfmc_cooking:empty_cup` | Empty Cup |
| `tfmc_cooking:cup_of_milk` | Cup of Milk |
| `tfmc_cooking:flour` | Flour |
| `tfmc_cooking:yeast` | Yeast |
| `tfmc_cooking:dough` | Dough |
| `tfmc_cooking:cheese` | Cheese |
| `tfmc_cooking:caramel` | Caramel |
| `tfmc_cooking:cooking_chocolate` | Cooking Chocolate |
| `tfmc_cooking:cooking_oil` | Cooking Oil |
| `tfmc_cooking:cream` | Cream |
| `tfmc_cooking:egg_carton` | Egg Carton |
| `tfmc_cooking:fried_egg` | Fried Egg |
| `tfmc_cooking:grilled_mushroom` | Grilled Mushroom |
| `tfmc_cooking:maple_syrup` | Maple Syrup |
| `tfmc_cooking:mashed_potatoes` | Mashed Potatoes |
| `tfmc_cooking:mustard` | Mustard |
| `tfmc_cooking:mustard_seeds` | Mustard Seeds |
| `tfmc_cooking:olive_oil` | Olive Oil |
| `tfmc_cooking:popcorn` | Popcorn |
| `tfmc_cooking:rice` | Rice |
| `tfmc_cooking:stock` | Stock |
| `tfmc_cooking:sunflower_seeds` | Sunflower Seeds |
| `tfmc_cooking:strawberry_jam` | Strawberry Jam |
| `tfmc_cooking:tomato_sauce` | Tomato Sauce |


**`plugins/ItemsAdder/contents/tfmc_cooking/contents/items.yml`** — 230 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_cooking:tomato_rotten` | Tomato Rotten |
| `tfmc_cooking:carrot_rotten` | Carrot Rotten |
| `tfmc_cooking:wheat_rotten` | Wheat Rotten |
| `tfmc_cooking:apple_rotten` | Apple Rotten |
| `tfmc_cooking:beetroot_rotten` | Beetroot Rotten |
| `tfmc_cooking:potato_rotten` | Potato Rotten |
| `tfmc_cooking:onion_rotten` | Onion Rotten |
| `tfmc_cooking:lettuce_rotten` | Lettuce Rotten |
| `tfmc_cooking:cucumber_rotten` | Cucumber Rotten |
| `tfmc_cooking:corn_rotten` | Corn Rotten |
| `tfmc_cooking:basil_rotten` | Basil Rotten |
| `tfmc_cooking:black_pepper_rotten` | Black Pepper Rotten |
| `tfmc_cooking:cinnamon_rotten` | Cinnamon Rotten |
| `tfmc_cooking:vanilla_rotten` | Vanilla Rotten |
| `tfmc_cooking:nutmeg_rotten` | Nutmeg Rotten |
| `tfmc_cooking:spice_leaf_rotten` | Spice Leaf Rotten |
| `tfmc_cooking:olive_rotten` | Olive Rotten |
| `tfmc_cooking:pistachio_rotten` | Pistachio Rotten |
| `tfmc_cooking:rhubarb_rotten` | Rhubarb Rotten |
| `tfmc_cooking:garlic_rotten` | Garlic Rotten |
| `tfmc_cooking:strawberry_rotten` | Strawberry Rotten |
| `tfmc_cooking:orange_rotten` | Orange Rotten |
| `tfmc_cooking:plum_rotten` | Plum Rotten |
| `tfmc_cooking:banana_rotten` | Banana Rotten |
| `tfmc_cooking:grape_rotten` | Grape Rotten |
| `tfmc_cooking:lemon_rotten` | Lemon Rotten |
| `tfmc_cooking:lime_rotten` | Lime Rotten |
| `tfmc_cooking:peach_rotten` | Peach Rotten |
| `tfmc_cooking:pineapple_rotten` | Pineapple Rotten |
| `tfmc_cooking:cherry_rotten` | Cherry Rotten |
| `tfmc_cooking:cut_carrot` | Cut Carrot |
| `tfmc_cooking:cut_carrot_cooked` | Cut Carrot Cooked |
| `tfmc_cooking:cut_carrot_boiled` | Cut Carrot Boiled |
| `tfmc_cooking:cut_carrot_burnt` | Cut Carrot Burnt |
| `tfmc_cooking:cut_carrot_rotten` | Cut Carrot Rotten |
| `tfmc_cooking:chopped_carrot` | Chopped Carrot |
| `tfmc_cooking:chopped_carrot_rotten` | Chopped Carrot Rotten |
| `tfmc_cooking:cut_potato` | Cut Potato |
| `tfmc_cooking:cut_potato_cooked` | Cut Potato Cooked |
| `tfmc_cooking:cut_potato_boiled` | Cut Potato Boiled |
| `tfmc_cooking:cut_potato_burnt` | Cut Potato Burnt |
| `tfmc_cooking:cut_potato_rotten` | Cut Potato Rotten |
| `tfmc_cooking:chopped_potato` | Chopped Potato |
| `tfmc_cooking:chopped_potato_rotten` | Chopped Potato Rotten |
| `tfmc_cooking:cut_beetroot` | Cut Beetroot |
| `tfmc_cooking:cut_beetroot_cooked` | Cut Beetroot Cooked |
| `tfmc_cooking:cut_beetroot_boiled` | Cut Beetroot Boiled |
| `tfmc_cooking:cut_beetroot_burnt` | Cut Beetroot Burnt |
| `tfmc_cooking:cut_beetroot_rotten` | Cut Beetroot Rotten |
| `tfmc_cooking:chopped_beetroot` | Chopped Beetroot |
| `tfmc_cooking:chopped_beetroot_rotten` | Chopped Beetroot Rotten |
| `tfmc_cooking:cut_pumpkin` | Cut Pumpkin |
| `tfmc_cooking:cut_pumpkin_cooked` | Cut Pumpkin Cooked |
| `tfmc_cooking:cut_pumpkin_boiled` | Cut Pumpkin Boiled |
| `tfmc_cooking:cut_pumpkin_burnt` | Cut Pumpkin Burnt |
| `tfmc_cooking:cut_pumpkin_rotten` | Cut Pumpkin Rotten |
| `tfmc_cooking:chopped_pumpkin` | Chopped Pumpkin |
| `tfmc_cooking:chopped_pumpkin_rotten` | Chopped Pumpkin Rotten |
| `tfmc_cooking:cut_tomato` | Cut Tomato |
| `tfmc_cooking:cut_tomato_cooked` | Cut Tomato Cooked |
| `tfmc_cooking:cut_tomato_boiled` | Cut Tomato Boiled |
| `tfmc_cooking:cut_tomato_burnt` | Cut Tomato Burnt |
| `tfmc_cooking:cut_tomato_rotten` | Cut Tomato Rotten |
| `tfmc_cooking:chopped_tomato` | Chopped Tomato |
| `tfmc_cooking:chopped_tomato_rotten` | Chopped Tomato Rotten |
| `tfmc_cooking:cut_onion` | Cut Onion |
| `tfmc_cooking:cut_onion_cooked` | Cut Onion Cooked |
| `tfmc_cooking:cut_onion_boiled` | Cut Onion Boiled |
| `tfmc_cooking:cut_onion_burnt` | Cut Onion Burnt |
| `tfmc_cooking:cut_onion_rotten` | Cut Onion Rotten |
| `tfmc_cooking:chopped_onion` | Chopped Onion |
| `tfmc_cooking:chopped_onion_rotten` | Chopped Onion Rotten |
| `tfmc_cooking:cut_lettuce` | Cut Lettuce |
| `tfmc_cooking:cut_lettuce_cooked` | Cut Lettuce Cooked |
| `tfmc_cooking:cut_lettuce_boiled` | Cut Lettuce Boiled |
| `tfmc_cooking:cut_lettuce_burnt` | Cut Lettuce Burnt |
| `tfmc_cooking:cut_lettuce_rotten` | Cut Lettuce Rotten |
| `tfmc_cooking:chopped_lettuce` | Chopped Lettuce |
| `tfmc_cooking:chopped_lettuce_rotten` | Chopped Lettuce Rotten |
| `tfmc_cooking:cut_cucumber` | Cut Cucumber |
| `tfmc_cooking:cut_cucumber_cooked` | Cut Cucumber Cooked |
| `tfmc_cooking:cut_cucumber_boiled` | Cut Cucumber Boiled |
| `tfmc_cooking:cut_cucumber_burnt` | Cut Cucumber Burnt |
| `tfmc_cooking:cut_cucumber_rotten` | Cut Cucumber Rotten |
| `tfmc_cooking:chopped_cucumber` | Chopped Cucumber |
| `tfmc_cooking:chopped_cucumber_rotten` | Chopped Cucumber Rotten |
| `tfmc_cooking:cut_corn` | Cut Corn |
| `tfmc_cooking:cut_corn_cooked` | Cut Corn Cooked |
| `tfmc_cooking:cut_corn_boiled` | Cut Corn Boiled |
| `tfmc_cooking:cut_corn_burnt` | Cut Corn Burnt |
| `tfmc_cooking:cut_corn_rotten` | Cut Corn Rotten |
| `tfmc_cooking:chopped_corn` | Chopped Corn |
| `tfmc_cooking:chopped_corn_rotten` | Chopped Corn Rotten |
| `tfmc_cooking:chopped_olive` | Chopped Olive |
| `tfmc_cooking:chopped_olive_rotten` | Chopped Olive Rotten |
| `tfmc_cooking:chopped_pistachio` | Chopped Pistachio |
| `tfmc_cooking:chopped_pistachio_rotten` | Chopped Pistachio Rotten |
| `tfmc_cooking:chopped_rhubarb` | Chopped Rhubarb |
| `tfmc_cooking:chopped_rhubarb_rotten` | Chopped Rhubarb Rotten |
| `tfmc_cooking:chopped_garlic` | Chopped Garlic |
| `tfmc_cooking:chopped_garlic_rotten` | Chopped Garlic Rotten |
| `tfmc_cooking:red_meat_steak_raw` | Red Meat Steak raw |
| `tfmc_cooking:red_meat_steak_cooked` | Red Meat Steak cooked |
| `tfmc_cooking:red_meat_steak_burnt` | Red Meat Steak burnt |
| `tfmc_cooking:red_meat_steak_rotten` | Red Meat Steak rotten |
| `tfmc_cooking:red_meat_roast_raw_8` | Red Meat Roast raw 8 |
| `tfmc_cooking:red_meat_roast_raw_7` | Red Meat Roast raw 7 |
| `tfmc_cooking:red_meat_roast_raw_6` | Red Meat Roast raw 6 |
| `tfmc_cooking:red_meat_roast_raw_5` | Red Meat Roast raw 5 |
| `tfmc_cooking:red_meat_roast_raw_4` | Red Meat Roast raw 4 |
| `tfmc_cooking:red_meat_roast_raw_3` | Red Meat Roast raw 3 |
| `tfmc_cooking:red_meat_roast_raw_2` | Red Meat Roast raw 2 |
| `tfmc_cooking:red_meat_roast_raw_1` | Red Meat Roast raw 1 |
| `tfmc_cooking:red_meat_roast_cooked_8` | Red Meat Roast cooked 8 |
| `tfmc_cooking:red_meat_roast_cooked_7` | Red Meat Roast cooked 7 |
| `tfmc_cooking:red_meat_roast_cooked_6` | Red Meat Roast cooked 6 |
| `tfmc_cooking:red_meat_roast_cooked_5` | Red Meat Roast cooked 5 |
| `tfmc_cooking:red_meat_roast_cooked_4` | Red Meat Roast cooked 4 |
| `tfmc_cooking:red_meat_roast_cooked_3` | Red Meat Roast cooked 3 |
| `tfmc_cooking:red_meat_roast_cooked_2` | Red Meat Roast cooked 2 |
| `tfmc_cooking:red_meat_roast_cooked_1` | Red Meat Roast cooked 1 |
| `tfmc_cooking:red_meat_roast_burnt_8` | Red Meat Roast burnt 8 |
| `tfmc_cooking:red_meat_roast_burnt_7` | Red Meat Roast burnt 7 |
| `tfmc_cooking:red_meat_roast_burnt_6` | Red Meat Roast burnt 6 |
| `tfmc_cooking:red_meat_roast_burnt_5` | Red Meat Roast burnt 5 |
| `tfmc_cooking:red_meat_roast_burnt_4` | Red Meat Roast burnt 4 |
| `tfmc_cooking:red_meat_roast_burnt_3` | Red Meat Roast burnt 3 |
| `tfmc_cooking:red_meat_roast_burnt_2` | Red Meat Roast burnt 2 |
| `tfmc_cooking:red_meat_roast_burnt_1` | Red Meat Roast burnt 1 |
| `tfmc_cooking:red_meat_roast_rotten_8` | Red Meat Roast rotten 8 |
| `tfmc_cooking:red_meat_roast_rotten_7` | Red Meat Roast rotten 7 |
| `tfmc_cooking:red_meat_roast_rotten_6` | Red Meat Roast rotten 6 |
| `tfmc_cooking:red_meat_roast_rotten_5` | Red Meat Roast rotten 5 |
| `tfmc_cooking:red_meat_roast_rotten_4` | Red Meat Roast rotten 4 |
| `tfmc_cooking:red_meat_roast_rotten_3` | Red Meat Roast rotten 3 |
| `tfmc_cooking:red_meat_roast_rotten_2` | Red Meat Roast rotten 2 |
| `tfmc_cooking:red_meat_roast_rotten_1` | Red Meat Roast rotten 1 |
| `tfmc_cooking:pork_steak_raw` | Pork Steak Raw |
| `tfmc_cooking:pork_steak_cooked` | Pork Steak Cooked |
| `tfmc_cooking:pork_steak_burnt` | Pork Steak Burnt |
| `tfmc_cooking:pork_steak_rotten` | Pork Steak Rotten |
| `tfmc_cooking:sausage_raw` | Sausage Raw |
| `tfmc_cooking:sausage_cooked` | Sausage Cooked |
| `tfmc_cooking:sausage_rotten` | Sausage Rotten |
| `tfmc_cooking:sausage_burnt` | Sausage Burnt |
| `tfmc_cooking:sausage_chain_raw_1` | Sausage Chain Raw (5) |
| `tfmc_cooking:sausage_chain_raw_2` | Sausage Chain Raw (4) |
| `tfmc_cooking:sausage_chain_raw_3` | Sausage Chain Raw (3) |
| `tfmc_cooking:sausage_chain_raw_4` | Sausage Chain Raw (2) |
| `tfmc_cooking:sausage_chain_raw_5` | Sausage Chain Raw (1) |
| `tfmc_cooking:sausage_chain_cooked_1` | Sausage Chain Cooked (5) |
| `tfmc_cooking:sausage_chain_cooked_2` | Sausage Chain Cooked (4) |
| `tfmc_cooking:sausage_chain_cooked_3` | Sausage Chain Cooked (3) |
| `tfmc_cooking:sausage_chain_cooked_4` | Sausage Chain Cooked (2) |
| `tfmc_cooking:sausage_chain_cooked_5` | Sausage Chain Cooked (1) |
| `tfmc_cooking:sausage_chain_rotten_1` | Sausage Chain Rotten (5) |
| `tfmc_cooking:sausage_chain_rotten_2` | Sausage Chain Rotten (4) |
| `tfmc_cooking:sausage_chain_rotten_3` | Sausage Chain Rotten (3) |
| `tfmc_cooking:sausage_chain_rotten_4` | Sausage Chain Rotten (2) |
| `tfmc_cooking:sausage_chain_rotten_5` | Sausage Chain Rotten (1) |
| `tfmc_cooking:sausage_chain_burnt_1` | Sausage Chain Burnt (5) |
| `tfmc_cooking:sausage_chain_burnt_2` | Sausage Chain Burnt (4) |
| `tfmc_cooking:sausage_chain_burnt_3` | Sausage Chain Burnt (3) |
| `tfmc_cooking:sausage_chain_burnt_4` | Sausage Chain Burnt (2) |
| `tfmc_cooking:sausage_chain_burnt_5` | Sausage Chain Burnt (1) |
| `tfmc_cooking:bread_raw` | Bread Raw |
| `tfmc_cooking:bread_cooked` | Bread Cooked |
| `tfmc_cooking:bread_burnt` | Bread Burnt |
| `tfmc_cooking:bread_rotten` | Bread Rotten |
| `tfmc_cooking:butter` | Butter |
| `tfmc_cooking:butter_pan` | Butter (Pan) |
| `tfmc_cooking:butter_piece` | Butter Piece |
| `tfmc_cooking:water` | Water |
| `tfmc_cooking:milk` | Milk |
| `tfmc_cooking:gray` | Gray |
| `tfmc_cooking:brown_light` | Brown Light |
| `tfmc_cooking:brown_dark` | Brown Dark |
| `tfmc_cooking:red_light` | Red Light |
| `tfmc_cooking:red_dark` | Red Dark |
| `tfmc_cooking:gray_plated` | Gray Plated |
| `tfmc_cooking:brown_light_plated` | Brown Light Plated |
| `tfmc_cooking:brown_dark_plated` | Brown Dark Plated |
| `tfmc_cooking:red_light_plated` | Red Light Plated |
| `tfmc_cooking:red_dark_plated` | Red Dark Plated |
| `tfmc_cooking:ladle` | Ladle |
| `tfmc_cooking:masher` | Masher |
| `tfmc_cooking:cutting_knife` | Cutting Knife |
| `tfmc_cooking:flour_model` | Flour (Bowl) |
| `tfmc_cooking:yeast_model` | Yeast (Bowl) |
| `tfmc_cooking:dough_model` | Dough (Bowl) |
| `tfmc_cooking:wood_model` | Wood (Oven) |
| `tfmc_cooking:wood_burnt_model` | Burnt Wood (Oven) |
| `tfmc_cooking:oven_fire_model` | Oven Fire |
| `tfmc_cooking:water_block` | Water Block |
| `tfmc_cooking:milk_block` | Milk Block |
| `tfmc_cooking:grain` | Grain |
| `tfmc_cooking:bag` | Bag |
| `tfmc_cooking:bag_on_stand` | Bag On Stand |
| `tfmc_cooking:poultry_roast_raw_6` | Poultry Roast raw 6 |
| `tfmc_cooking:poultry_roast_raw_5` | Poultry Roast raw 5 |
| `tfmc_cooking:poultry_roast_raw_4` | Poultry Roast raw 4 |
| `tfmc_cooking:poultry_roast_raw_3` | Poultry Roast raw 3 |
| `tfmc_cooking:poultry_roast_raw_2` | Poultry Roast raw 2 |
| `tfmc_cooking:poultry_roast_raw_1` | Poultry Roast raw 1 |
| `tfmc_cooking:poultry_roast_cooked_6` | Poultry Roast cooked 6 |
| `tfmc_cooking:poultry_roast_cooked_5` | Poultry Roast cooked 5 |
| `tfmc_cooking:poultry_roast_cooked_4` | Poultry Roast cooked 4 |
| `tfmc_cooking:poultry_roast_cooked_3` | Poultry Roast cooked 3 |
| `tfmc_cooking:poultry_roast_cooked_2` | Poultry Roast cooked 2 |
| `tfmc_cooking:poultry_roast_cooked_1` | Poultry Roast cooked 1 |
| `tfmc_cooking:poultry_roast_burnt_6` | Poultry Roast burnt 6 |
| `tfmc_cooking:poultry_roast_burnt_5` | Poultry Roast burnt 5 |
| `tfmc_cooking:poultry_roast_burnt_4` | Poultry Roast burnt 4 |
| `tfmc_cooking:poultry_roast_burnt_3` | Poultry Roast burnt 3 |
| `tfmc_cooking:poultry_roast_burnt_2` | Poultry Roast burnt 2 |
| `tfmc_cooking:poultry_roast_burnt_1` | Poultry Roast burnt 1 |
| `tfmc_cooking:poultry_roast_rotten_6` | Poultry Roast rotten 6 |
| `tfmc_cooking:poultry_roast_rotten_5` | Poultry Roast rotten 5 |
| `tfmc_cooking:poultry_roast_rotten_4` | Poultry Roast rotten 4 |
| `tfmc_cooking:poultry_roast_rotten_3` | Poultry Roast rotten 3 |
| `tfmc_cooking:poultry_roast_rotten_2` | Poultry Roast rotten 2 |
| `tfmc_cooking:poultry_roast_rotten_1` | Poultry Roast rotten 1 |
| `tfmc_cooking:poultry_roast_leg_raw` | Poultry Roast Leg raw |
| `tfmc_cooking:poultry_roast_leg_cooked` | Poultry Roast Leg cooked |
| `tfmc_cooking:poultry_roast_leg_burnt` | Poultry Roast Leg burnt |
| `tfmc_cooking:poultry_roast_leg_rotten` | Poultry Roast Leg rotten |
| `tfmc_cooking:poultry_roast_filet_raw` | Poultry Roast Filet raw |
| `tfmc_cooking:poultry_roast_filet_cooked` | Poultry Roast Filet cooked |
| `tfmc_cooking:poultry_roast_filet_burnt` | Poultry Roast Filet burnt |
| `tfmc_cooking:poultry_roast_filet_rotten` | Poultry Roast Filet rotten |


#### Magic artifacts — namespace `tfmc_magic` (98 entries)

> **Note:** every entry in this file has `display_name` identical to its id (e.g. `arcanum_orb_3`). These are model carriers consumed by the Magic plugin, which supplies the real in-game name; a player should never see the raw name unless something is misconfigured.


**`plugins/ItemsAdder/contents/tfmc_magic/contents/items.yml`** — 98 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_magic:arcanum_amulet_178` | arcanum_amulet_178 |
| `tfmc_magic:arcanum_book_22` | arcanum_book_22 |
| `tfmc_magic:arcanum_book_29` | arcanum_book_29 |
| `tfmc_magic:arcanum_book_30` | arcanum_book_30 |
| `tfmc_magic:arcanum_book_42` | arcanum_book_42 |
| `tfmc_magic:arcanum_bracelet_155` | arcanum_bracelet_155 |
| `tfmc_magic:arcanum_gem_140` | arcanum_gem_140 |
| `tfmc_magic:arcanum_gem_141` | arcanum_gem_141 |
| `tfmc_magic:arcanum_gem_162` | arcanum_gem_162 |
| `tfmc_magic:arcanum_gem_180` | arcanum_gem_180 |
| `tfmc_magic:arcanum_gem_181` | arcanum_gem_181 |
| `tfmc_magic:arcanum_orb_3` | arcanum_orb_3 |
| `tfmc_magic:arcanum_orb_4` | arcanum_orb_4 |
| `tfmc_magic:arcanum_orb_7` | arcanum_orb_7 |
| `tfmc_magic:arcanum_orb_8` | arcanum_orb_8 |
| `tfmc_magic:arcanum_ring_150` | arcanum_ring_150 |
| `tfmc_magic:arcanum_ring_170` | arcanum_ring_170 |
| `tfmc_magic:arcanum_ring_175` | arcanum_ring_175 |
| `tfmc_magic:bloodmagic_book_27` | bloodmagic_book_27 |
| `tfmc_magic:bloodmagic_eye_orb_18` | bloodmagic_eye_orb_18 |
| `tfmc_magic:bloodmagic_eye_orb_19` | bloodmagic_eye_orb_19 |
| `tfmc_magic:cerrith_amulet_158` | cerrith_amulet_158 |
| `tfmc_magic:cerrith_book_23` | cerrith_book_23 |
| `tfmc_magic:cerrith_book_43` | cerrith_book_43 |
| `tfmc_magic:cerrith_book_56` | cerrith_book_56 |
| `tfmc_magic:cerrith_bracelet_154` | cerrith_bracelet_154 |
| `tfmc_magic:cerrith_brooch_14` | cerrith_brooch_14 |
| `tfmc_magic:cerrith_brooch_16` | cerrith_brooch_16 |
| `tfmc_magic:cerrith_gem_165` | cerrith_gem_165 |
| `tfmc_magic:cerrith_gem_185` | cerrith_gem_185 |
| `tfmc_magic:cerrith_jar_116` | cerrith_jar_116 |
| `tfmc_magic:cerrith_orb_1` | cerrith_orb_1 |
| `tfmc_magic:cerrith_ring_149` | cerrith_ring_149 |
| `tfmc_magic:cerrith_ring_174` | cerrith_ring_174 |
| `tfmc_magic:illusion_book_59` | illusion_book_59 |
| `tfmc_magic:manuscript_47` | manuscript_47 |
| `tfmc_magic:manuscript_48` | manuscript_48 |
| `tfmc_magic:manuscript_49` | manuscript_49 |
| `tfmc_magic:manuscript_50` | manuscript_50 |
| `tfmc_magic:manuscript_51` | manuscript_51 |
| `tfmc_magic:mitlan_book_41` | mitlan_book_41 |
| `tfmc_magic:mitlan_book_55` | mitlan_book_55 |
| `tfmc_magic:necromancy_book_28` | necromancy_book_28 |
| `tfmc_magic:necromancy_book_45` | necromancy_book_45 |
| `tfmc_magic:necromancy_jar_117` | necromancy_jar_117 |
| `tfmc_magic:necromancy_necklace_196` | necromancy_necklace_196 |
| `tfmc_magic:necromancy_orb_12` | necromancy_orb_12 |
| `tfmc_magic:necromancy_skull_142` | necromancy_skull_142 |
| `tfmc_magic:oseni_amulet_156` | oseni_amulet_156 |
| `tfmc_magic:oseni_amulet_159` | oseni_amulet_159 |
| `tfmc_magic:oseni_amulet_177` | oseni_amulet_177 |
| `tfmc_magic:oseni_amulet_195` | oseni_amulet_195 |
| `tfmc_magic:oseni_book_20` | oseni_book_20 |
| `tfmc_magic:oseni_book_35` | oseni_book_35 |
| `tfmc_magic:oseni_book_40` | oseni_book_40 |
| `tfmc_magic:oseni_bracelet_151` | oseni_bracelet_151 |
| `tfmc_magic:oseni_bracelet_152` | oseni_bracelet_152 |
| `tfmc_magic:oseni_brooch_13` | oseni_brooch_13 |
| `tfmc_magic:oseni_brooch_15` | oseni_brooch_15 |
| `tfmc_magic:oseni_gem_164` | oseni_gem_164 |
| `tfmc_magic:oseni_jar_113` | oseni_jar_113 |
| `tfmc_magic:oseni_necklace_197` | oseni_necklace_197 |
| `tfmc_magic:oseni_orb_0` | oseni_orb_0 |
| `tfmc_magic:oseni_orb_11` | oseni_orb_11 |
| `tfmc_magic:oseni_ring_147` | oseni_ring_147 |
| `tfmc_magic:oseni_ring_166` | oseni_ring_166 |
| `tfmc_magic:oseni_ring_167` | oseni_ring_167 |
| `tfmc_magic:oseni_ring_171` | oseni_ring_171 |
| `tfmc_magic:oseni_ring_172` | oseni_ring_172 |
| `tfmc_magic:seithr_amulet_157` | seithr_amulet_157 |
| `tfmc_magic:seithr_book_21` | seithr_book_21 |
| `tfmc_magic:seithr_book_24` | seithr_book_24 |
| `tfmc_magic:seithr_book_26` | seithr_book_26 |
| `tfmc_magic:seithr_book_44` | seithr_book_44 |
| `tfmc_magic:seithr_book_46` | seithr_book_46 |
| `tfmc_magic:seithr_bracelet_153` | seithr_bracelet_153 |
| `tfmc_magic:seithr_gem_163` | seithr_gem_163 |
| `tfmc_magic:seithr_necklace_198` | seithr_necklace_198 |
| `tfmc_magic:seithr_orb_10` | seithr_orb_10 |
| `tfmc_magic:seithr_orb_2` | seithr_orb_2 |
| `tfmc_magic:seithr_orb_5` | seithr_orb_5 |
| `tfmc_magic:seithr_orb_9` | seithr_orb_9 |
| `tfmc_magic:seithr_ring_148` | seithr_ring_148 |
| `tfmc_magic:seithr_ring_168` | seithr_ring_168 |
| `tfmc_magic:seithr_ring_173` | seithr_ring_173 |
| `tfmc_magic:shadowmancy_book_25` | shadowmancy_book_25 |
| `tfmc_magic:shadowmancy_book_39` | shadowmancy_book_39 |
| `tfmc_magic:shadowmancy_book_57` | shadowmancy_book_57 |
| `tfmc_magic:shadowmancy_jar_114` | shadowmancy_jar_114 |
| `tfmc_magic:shadowmancy_jar_115` | shadowmancy_jar_115 |
| `tfmc_magic:shared_book_37` | shared_book_37 |
| `tfmc_magic:shared_brooch_17` | shared_brooch_17 |
| `tfmc_magic:shared_brooch_6` | shared_brooch_6 |
| `tfmc_magic:spirit_amulet_176` | spirit_amulet_176 |
| `tfmc_magic:spirit_book_36` | spirit_book_36 |
| `tfmc_magic:spirit_book_38` | spirit_book_38 |
| `tfmc_magic:spirit_jar_106` | spirit_jar_106 |
| `tfmc_magic:spirit_necklace_199` | spirit_necklace_199 |


#### Card games — namespace `tfmc_games` (55 entries)


**`plugins/ItemsAdder/contents/tfmc_games/contents/items.yml`** — 55 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_games:deck` | Deck of Cards |
| `tfmc_games:card_back` | Card Back |
| `tfmc_games:card_base` | Card Base |
| `tfmc_games:cerrith_1` | Cerrith Ace |
| `tfmc_games:cerrith_2` | Cerrith 2 |
| `tfmc_games:cerrith_3` | Cerrith 3 |
| `tfmc_games:cerrith_4` | Cerrith 4 |
| `tfmc_games:cerrith_5` | Cerrith 5 |
| `tfmc_games:cerrith_6` | Cerrith 6 |
| `tfmc_games:cerrith_7` | Cerrith 7 |
| `tfmc_games:cerrith_8` | Cerrith 8 |
| `tfmc_games:cerrith_9` | Cerrith 9 |
| `tfmc_games:cerrith_10` | Cerrith 10 |
| `tfmc_games:cerrith_11` | Cerrith Jack |
| `tfmc_games:cerrith_12` | Cerrith Queen |
| `tfmc_games:cerrith_13` | Cerrith King |
| `tfmc_games:mitlan_1` | Mitlan Ace |
| `tfmc_games:mitlan_2` | Mitlan 2 |
| `tfmc_games:mitlan_3` | Mitlan 3 |
| `tfmc_games:mitlan_4` | Mitlan 4 |
| `tfmc_games:mitlan_5` | Mitlan 5 |
| `tfmc_games:mitlan_6` | Mitlan 6 |
| `tfmc_games:mitlan_7` | Mitlan 7 |
| `tfmc_games:mitlan_8` | Mitlan 8 |
| `tfmc_games:mitlan_9` | Mitlan 9 |
| `tfmc_games:mitlan_10` | Mitlan 10 |
| `tfmc_games:mitlan_11` | Mitlan Jack |
| `tfmc_games:mitlan_12` | Mitlan Queen |
| `tfmc_games:mitlan_13` | Mitlan King |
| `tfmc_games:oseni_1` | Oseni Ace |
| `tfmc_games:oseni_2` | Oseni 2 |
| `tfmc_games:oseni_3` | Oseni 3 |
| `tfmc_games:oseni_4` | Oseni 4 |
| `tfmc_games:oseni_5` | Oseni 5 |
| `tfmc_games:oseni_6` | Oseni 6 |
| `tfmc_games:oseni_7` | Oseni 7 |
| `tfmc_games:oseni_8` | Oseni 8 |
| `tfmc_games:oseni_9` | Oseni 9 |
| `tfmc_games:oseni_10` | Oseni 10 |
| `tfmc_games:oseni_11` | Oseni Jack |
| `tfmc_games:oseni_12` | Oseni Queen |
| `tfmc_games:oseni_13` | Oseni King |
| `tfmc_games:seithr_1` | Seithr Ace |
| `tfmc_games:seithr_2` | Seithr 2 |
| `tfmc_games:seithr_3` | Seithr 3 |
| `tfmc_games:seithr_4` | Seithr 4 |
| `tfmc_games:seithr_5` | Seithr 5 |
| `tfmc_games:seithr_6` | Seithr 6 |
| `tfmc_games:seithr_7` | Seithr 7 |
| `tfmc_games:seithr_8` | Seithr 8 |
| `tfmc_games:seithr_9` | Seithr 9 |
| `tfmc_games:seithr_10` | Seithr 10 |
| `tfmc_games:seithr_11` | Seithr Jack |
| `tfmc_games:seithr_12` | Seithr Queen |
| `tfmc_games:seithr_13` | Seithr King |


#### Player-submitted roleplay items — namespace `tfmc_submissions` (16 entries)


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/caution0l_ignis_fatuus_s_journal.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:caution0l_ignis_fatuus_s_journal` | Ignis Fatuus's Journal |
| `tfmc_submissions:caution0l_ignis_fatuus_s_journal_signed` | Ignis Fatuus's Journal |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/drefvelin_great_knife_bro.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:drefvelin_great_knife_bro` | Great Knife Bro |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/euryonice_roslyn_s_dagger.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:euryonice_roslyn_s_dagger` | Roslyn's Dagger |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/euryonice_roslyn_s_journal.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:euryonice_roslyn_s_journal` | Roslyn's Journal |
| `tfmc_submissions:euryonice_roslyn_s_journal_signed` | Roslyn's Journal |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/green005_jojo_s_archive.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:green005_jojo_s_archive` | Jojo's Archive |
| `tfmc_submissions:green005_jojo_s_archive_signed` | Jojo's Archive |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/junglefoxgz_rigging_knife.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:junglefoxgz_rigging_knife` | Rigging Knife |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/root_toot_doctrina_medica_nova.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:root_toot_doctrina_medica_nova` | Doctrina Medica Nova |
| `tfmc_submissions:root_toot_doctrina_medica_nova_signed` | Doctrina Medica Nova |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/root_toot_exhumer_s_spade.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:root_toot_exhumer_s_spade` | Exhumer's Spade |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/sulgodar_avaendir_s_cane.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:sulgodar_avaendir_s_cane` | Avaendir's Cane |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/sulgodar_avaendir_s_staff.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:sulgodar_avaendir_s_staff` | Avaendir's Staff |


**`plugins/ItemsAdder/contents/tfmc_submissions/configs/sulgodar_flumph_mating_rituals.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_submissions:sulgodar_flumph_mating_rituals` | Flumph Mating Rituals |
| `tfmc_submissions:sulgodar_flumph_mating_rituals_signed` | Flumph Mating Rituals |


#### Armour-shop test item — namespace `tfmc_armorshop` (1 entries)


**`plugins/ItemsAdder/contents/tfmc_armorshop/configs/ukindaickyngl_test_dagger.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armorshop:ukindaickyngl_test_dagger` | Test Dagger |


#### Custom armour — namespace `tfmc_armor` (502 entries)

> ArmourShop and AdvancedCrafting reference these by `ia.tfmc_armor:<id>`. `legacy_armor.yml`, `original_rothil_zerratoris_armor.yml` and the `s1`-`s4` faction files are historical sets; whether they are still purchasable is a question for the ArmourShop section, not ItemsAdder.


**`plugins/ItemsAdder/contents/tfmc_armor/configs/aa.yml`** — 14 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:wildlands_steel_chestplate` | &7Insulated Steel Chestplate |
| `tfmc_armor:wildlands_steel_leggings` | &7Insulated Steel Leggings |
| `tfmc_armor:wildlands_steel_boots` | &7Insulated Steel Boots |
| `tfmc_armor:wildlands_abyssalite_chestplate` | &7Insulated Abyssalite Chestplate |
| `tfmc_armor:wildlands_abyssalite_leggings` | &7Insulated Abyssalite Leggings |
| `tfmc_armor:wildlands_abyssalite_boots` | &7Insulated Abyssalite Boots |
| `tfmc_armor:wildlands_mythril_chestplate` | <#9BE1F3>Insulated Mythril Chestplate |
| `tfmc_armor:wildlands_mythril_leggings` | <#9BE1F3>Insulated Mythril Leggings |
| `tfmc_armor:wildlands_mythril_boots` | <#9BE1F3>Insulated Mythril Boots |
| `tfmc_armor:zerratoris_wildlands_mythril_chestplate` | <#9BE1F3>Insulated Mythril Chestplate |
| `tfmc_armor:dryad_wildlands_helmet` | &aDryad Exploration Helmet |
| `tfmc_armor:dryad_wildlands_chestplate` | &aDryad Exploration Chestplate |
| `tfmc_armor:dryad_wildlands_leggings` | &aDryad Exploration Leggings |
| `tfmc_armor:dryad_wildlands_boots` | &aDryad Exploration Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/forestman_armor.yml`** — 12 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:forestman_iron_helmet` | &2Forestman Scout Helmet |
| `tfmc_armor:forestman_iron_chestplate` | &2Forestman Scout Chestplate |
| `tfmc_armor:forestman_iron_leggings` | &2Forestman Scout Leggings |
| `tfmc_armor:forestman_iron_boots` | &2Forestman Scout Boots |
| `tfmc_armor:forestman_steel_helmet` | &2Forestman Warrior Helmet |
| `tfmc_armor:forestman_steel_chestplate` | &2Forestman Warrior Chestplate |
| `tfmc_armor:forestman_steel_leggings` | &2Forestman Warrior Leggings |
| `tfmc_armor:forestman_steel_boots` | &2Forestman Warrior Boots |
| `tfmc_armor:forestman_abyssalite_helmet` | &2Forestman Guardian Helmet |
| `tfmc_armor:forestman_abyssalite_chestplate` | &2Forestman Guardian Chestplate |
| `tfmc_armor:forestman_abyssalite_leggings` | &2Forestman Guardian Leggings |
| `tfmc_armor:forestman_abyssalite_boots` | &2Forestman Guardian Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/hraftar_armor.yml`** — 12 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:hraftar_iron_helmet` | &9Hraftar Raider Helmet |
| `tfmc_armor:hraftar_iron_chestplate` | &9Hraftar Raider Chestplate |
| `tfmc_armor:hraftar_iron_leggings` | &9Hraftar Raider Leggings |
| `tfmc_armor:hraftar_iron_boots` | &9Hraftar Raider Boots |
| `tfmc_armor:hraftar_steel_helmet` | &9Hraftar Berserker Helmet |
| `tfmc_armor:hraftar_steel_chestplate` | &9Hraftar Berserker Chestplate |
| `tfmc_armor:hraftar_steel_leggings` | &9Hraftar Berserker Leggings |
| `tfmc_armor:hraftar_steel_boots` | &9Hraftar Berserker Boots |
| `tfmc_armor:hraftar_abyssalite_helmet` | &9Hraftar Champion Helmet |
| `tfmc_armor:hraftar_abyssalite_chestplate` | &9Hraftar Champion Chestplate |
| `tfmc_armor:hraftar_abyssalite_leggings` | &9Hraftar Champion Leggings |
| `tfmc_armor:hraftar_abyssalite_boots` | &9Hraftar Champion Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/imperial_armor.yml`** — 12 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:imperial_iron_helmet` | &6Imperial Guard Helmet |
| `tfmc_armor:imperial_iron_chestplate` | &6Imperial Guard Chestplate |
| `tfmc_armor:imperial_iron_leggings` | &6Imperial Guard Leggings |
| `tfmc_armor:imperial_iron_boots` | &6Imperial Guard Boots |
| `tfmc_armor:imperial_steel_helmet` | &6Imperial Soldier Helmet |
| `tfmc_armor:imperial_steel_chestplate` | &6Imperial Soldier Chestplate |
| `tfmc_armor:imperial_steel_leggings` | &6Imperial Soldier Leggings |
| `tfmc_armor:imperial_steel_boots` | &6Imperial Soldier Boots |
| `tfmc_armor:imperial_abyssalite_helmet` | &6Imperial Legionnaire Helmet |
| `tfmc_armor:imperial_abyssalite_chestplate` | &6Imperial Legionnaire Chestplate |
| `tfmc_armor:imperial_abyssalite_leggings` | &6Imperial Legionnaire Leggings |
| `tfmc_armor:imperial_abyssalite_boots` | &6Imperial Legionnaire Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/infantry_armor.yml`** — 19 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:line_white_chestplate` | &fWhite Line Infantry Jacket |
| `tfmc_armor:line_green_chestplate` | &2Green Line Infantry Jacket |
| `tfmc_armor:line_brown_chestplate` | &6Brown Line Infantry Jacket |
| `tfmc_armor:line_blue_chestplate` | &9Blue Line Infantry Jacket |
| `tfmc_armor:line_red_chestplate` | &cRed Line Infantry Jacket |
| `tfmc_armor:line_leggings` | &fLine Infantry Leggings |
| `tfmc_armor:infantry_brown_chestplate` | &6Brown Infantry Jacket |
| `tfmc_armor:infantry_brown_leggings` | &6Brown Infantry Leggings |
| `tfmc_armor:eastern_hillman_chestplate` | &7Eastern Hillman Jacket |
| `tfmc_armor:eastern_hillman_leggings` | &7Eastern Hillman Leggings |
| `tfmc_armor:eastern_hillman_boots` | &7Eastern Hillman Boots |
| `tfmc_armor:infantry_green_chestplate` | &aGreen Infantry Jacket |
| `tfmc_armor:infantry_green_leggings` | &aGreen Infantry Leggings |
| `tfmc_armor:infantry_blue_chestplate` | &9Blue Infantry Jacket |
| `tfmc_armor:infantry_blue_leggings` | &9Blue Infantry Leggings |
| `tfmc_armor:infantry_tan_chestplate` | &7Tan Infantry Jacket |
| `tfmc_armor:infantry_tan_leggings` | &7Tan Infantry Leggings |
| `tfmc_armor:infantry_red_chestplate` | &cRed Infantry Jacket |
| `tfmc_armor:infantry_red_leggings` | &cRed Infantry Leggings |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/legacy_armor.yml`** — 48 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:legacy_tyvanian_iron_helmet` | &9Blue Levy Helmet |
| `tfmc_armor:legacy_tyvanian_iron_chestplate` | &9Blue Levy Chestplate |
| `tfmc_armor:legacy_tyvanian_iron_leggings` | &9Blue Levy Leggings |
| `tfmc_armor:legacy_tyvanian_iron_boots` | &9Blue Levy Boots |
| `tfmc_armor:legacy_tyvanian_steel_helmet` | &9Blue Soldier Helmet |
| `tfmc_armor:legacy_tyvanian_steel_chestplate` | &9Blue Soldier Chestplate |
| `tfmc_armor:legacy_tyvanian_steel_leggings` | &9Blue Soldier Leggings |
| `tfmc_armor:legacy_tyvanian_steel_boots` | &9Blue Soldier Boots |
| `tfmc_armor:legacy_tyvanian_abyssalite_helmet` | &9Blue Knight Helmet |
| `tfmc_armor:legacy_tyvanian_abyssalite_chestplate` | &9Blue Knight Chestplate |
| `tfmc_armor:legacy_tyvanian_abyssalite_leggings` | &9Blue Knight Leggings |
| `tfmc_armor:legacy_tyvanian_abyssalite_boots` | &9Blue Knight Boots |
| `tfmc_armor:legacy_decorated_iron_helmet` | &6Decorated Levy Helmet |
| `tfmc_armor:legacy_decorated_iron_chestplate` | &6Decorated Levy Chestplate |
| `tfmc_armor:legacy_decorated_iron_leggings` | &6Decorated Levy Leggings |
| `tfmc_armor:legacy_decorated_iron_boots` | &6Decorated Levy Boots |
| `tfmc_armor:legacy_decorated_steel_helmet` | &6Decorated Soldier Helmet |
| `tfmc_armor:legacy_decorated_steel_chestplate` | &6Decorated Soldier Chestplate |
| `tfmc_armor:legacy_decorated_steel_leggings` | &6Decorated Soldier Leggings |
| `tfmc_armor:legacy_decorated_steel_boots` | &6Decorated Soldier Boots |
| `tfmc_armor:legacy_decorated_abyssalite_helmet` | &6Decorated Knight Helmet |
| `tfmc_armor:legacy_decorated_abyssalite_chestplate` | &6Decorated Knight Chestplate |
| `tfmc_armor:legacy_decorated_abyssalite_leggings` | &6Decorated Knight Leggings |
| `tfmc_armor:legacy_decorated_abyssalite_boots` | &6Decorated Knight Boots |
| `tfmc_armor:brightsteel_helmet` | &6Decorated Knight Helmet |
| `tfmc_armor:brightsteel_chestplate` | &6Decorated Knight Chestplate |
| `tfmc_armor:brightsteel_leggings` | &6Decorated Knight Leggings |
| `tfmc_armor:brightsteel_boots` | &6Decorated Knight Boots |
| `tfmc_armor:legacy_mythril_helmet` | &6Decorated Knight Helmet |
| `tfmc_armor:legacy_mythril_chestplate` | &6Decorated Knight Chestplate |
| `tfmc_armor:legacy_mythril_leggings` | &6Decorated Knight Leggings |
| `tfmc_armor:legacy_mythril_boots` | &6Decorated Knight Boots |
| `tfmc_armor:legacy_illusion_mage_helmet` | <gradient:#4bc0c8:#c779d0:#feac5e>Illusion Mage Hood</gradient> |
| `tfmc_armor:legacy_illusion_mage_chestplate` | <gradient:#4bc0c8:#c779d0:#feac5e>Illusion Mage Robes</gradient> |
| `tfmc_armor:legacy_illusion_mage_leggings` | <gradient:#4bc0c8:#c779d0:#feac5e>Illusion Mage Leggings</gradient> |
| `tfmc_armor:legacy_illusion_mage_boots` | <gradient:#4bc0c8:#c779d0:#feac5e>Illusion Mage Boots</gradient> |
| `tfmc_armor:legacy_arcanum_mage_helmet` | <gradient:#12c2e9:#c471ed:#df4ff6>Arcanum Mage Hood</gradient> |
| `tfmc_armor:legacy_arcanum_mage_chestplate` | <gradient:#12c2e9:#c471ed:#df4ff6>Arcanum Mage Robes</gradient> |
| `tfmc_armor:legacy_arcanum_mage_leggings` | <gradient:#12c2e9:#c471ed:#df4ff6>Arcanum Mage Leggings</gradient> |
| `tfmc_armor:legacy_arcanum_mage_boots` | <gradient:#12c2e9:#c471ed:#df4ff6>Arcanum Mage Boots</gradient> |
| `tfmc_armor:legacy_bloodmagic_mage_helmet` | <gradient:#aa0000:#d10202:#e80505>Bloodmagic Mage Hood</gradient> |
| `tfmc_armor:legacy_bloodmagic_mage_chestplate` | <gradient:#aa0000:#d10202:#e80505>Bloodmagic Mage Robes</gradient> |
| `tfmc_armor:legacy_bloodmagic_mage_leggings` | <gradient:#aa0000:#d10202:#e80505>Bloodmagic Mage Leggings</gradient> |
| `tfmc_armor:legacy_bloodmagic_mage_boots` | <gradient:#aa0000:#d10202:#e80505>Bloodmagic Mage Boots</gradient> |
| `tfmc_armor:legacy_necromancy_mage_helmet` | <gradient:#390a39:#aa00aa:#ca03ca>Necromancy Mage Hood</gradient> |
| `tfmc_armor:legacy_necromancy_mage_chestplate` | <gradient:#390a39:#aa00aa:#ca03ca>Necromancy Mage Robes</gradient> |
| `tfmc_armor:legacy_necromancy_mage_leggings` | <gradient:#390a39:#aa00aa:#ca03ca>Necromancy Mage Leggings</gradient> |
| `tfmc_armor:legacy_necromancy_mage_boots` | <gradient:#390a39:#aa00aa:#ca03ca>Necromancy Mage Boots</gradient> |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/mage_armor.yml`** — 28 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:custom_mage_helmet` | &fCustom Mage Hood |
| `tfmc_armor:custom_mage_chestplate` | &fCustom Mage Robes |
| `tfmc_armor:custom_mage_leggings` | &fCustom Mage Leggings |
| `tfmc_armor:custom_mage_boots` | &fCustom Mage Boots |
| `tfmc_armor:iron_mage_helmet` | &fIron Mage Hood |
| `tfmc_armor:iron_mage_chestplate` | &fIron Mage Robes |
| `tfmc_armor:iron_mage_leggings` | &fIron Mage Leggings |
| `tfmc_armor:iron_mage_boots` | &fIron Mage Boots |
| `tfmc_armor:mage_steel_helmet` | &7Steel Mage Hood |
| `tfmc_armor:mage_steel_chestplate` | &7Steel Mage Robes |
| `tfmc_armor:mage_steel_leggings` | &7Steel Mage Leggings |
| `tfmc_armor:mage_steel_boots` | &7Steel Mage Boots |
| `tfmc_armor:mage_abyssalite_helmet` | &8Abyssalite Mage Hood |
| `tfmc_armor:mage_abyssalite_chestplate` | &8Abyssalite Mage Robes |
| `tfmc_armor:mage_abyssalite_leggings` | &8Abyssalite Mage Leggings |
| `tfmc_armor:mage_abyssalite_boots` | &8Abyssalite Mage Boots |
| `tfmc_armor:mage_mythril_helmet` | &3Mythril Mage Hood |
| `tfmc_armor:mage_mythril_chestplate` | &3Mythril Mage Robes |
| `tfmc_armor:mage_mythril_leggings` | &3Mythril Mage Leggings |
| `tfmc_armor:mage_mythril_boots` | &3Mythril Mage Boots |
| `tfmc_armor:tan_mage_helmet` | &6Tan Mage Hood |
| `tfmc_armor:tan_mage_chestplate` | &6Tan Mage Robes |
| `tfmc_armor:tan_mage_leggings` | &6Tan Mage Leggings |
| `tfmc_armor:tan_mage_boots` | &6Tan Mage Boots |
| `tfmc_armor:cherry_dryad_helmet` | <#ad5fc9>Mage Crown |
| `tfmc_armor:cherry_dryad_chestplate` | <#ad5fc9>Mage Chestplate |
| `tfmc_armor:cherry_dryad_leggings` | <#ad5fc9>Mage Leggings |
| `tfmc_armor:cherry_dryad_boots` | <#ad5fc9>Mage Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/medieval_armor.yml`** — 128 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:medieval_leather_green_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_green_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_green_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_green_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_green_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_green_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_green_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_green_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_green_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_green_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_green_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_green_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_green_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_green_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_green_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_green_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_blue_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_blue_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_blue_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_blue_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_blue_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_blue_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_blue_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_blue_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_blue_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_blue_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_blue_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_blue_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_blue_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_blue_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_blue_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_blue_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_bluegreen_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_bluegreen_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_bluegreen_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_bluegreen_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_bluegreen_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_bluegreen_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_bluegreen_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_bluegreen_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_bluegreen_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_bluegreen_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_bluegreen_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_bluegreen_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_bluegreen_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_bluegreen_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_bluegreen_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_bluegreen_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_red_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_red_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_red_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_red_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_red_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_red_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_red_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_red_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_red_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_red_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_red_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_red_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_red_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_red_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_red_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_red_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_redyellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_redyellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_redyellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_redyellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_redyellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_redyellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_redyellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_redyellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_redyellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_redyellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_redyellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_redyellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_redyellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_redyellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_redyellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_redyellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellow_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellow_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellow_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellow_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_stripe_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_stripe_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_stripe_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_stripe_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_stripe_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_stripe_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_stripe_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_stripe_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_stripe_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_stripe_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_stripe_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_stripe_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_stripe_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_stripe_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_stripe_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_stripe_boots` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellowpurple_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellowpurple_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellowpurple_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_leather_yellowpurple_boots` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellowpurple_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellowpurple_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellowpurple_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_chain_yellowpurple_boots` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellowpurple_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellowpurple_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellowpurple_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_steel_yellowpurple_boots` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellowpurple_helmet` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellowpurple_chestplate` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellowpurple_leggings` | *(no display_name)* |
| `tfmc_armor:medieval_abyssalite_yellowpurple_boots` | *(no display_name)* |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/miscellaneous_armor.yml`** — 20 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:dwarven_helmet` | &6Dwarven Beardling Heavy Chain Helmet |
| `tfmc_armor:dwarven_chestplate` | &6Dwarven Beardling Heavy Chain Chestplate |
| `tfmc_armor:dwarven_leggings` | &6Dwarven Beardling Heavy Chain Leggings |
| `tfmc_armor:dwarven_boots` | &6Dwarven Beardling Heavy Chain Boots |
| `tfmc_armor:scale_helmet` | &fFish Scale Helmet |
| `tfmc_armor:scale_chestplate` | &fFish Scale Chestplate |
| `tfmc_armor:scale_leggings` | &fFish Scale Leggings |
| `tfmc_armor:scale_boots` | &fFish Scale Boots |
| `tfmc_armor:cervalic_order_helmet` | &6Cervalic Helmet |
| `tfmc_armor:cervalic_order_chestplate` | &6Cervalic Chestplate |
| `tfmc_armor:cervalic_order_leggings` | &6Cervalic Leggings |
| `tfmc_armor:cervalic_order_boots` | &6Cervalic Boots |
| `tfmc_armor:papal_helmet` | <#dd51ed>Papal Robes Helmet |
| `tfmc_armor:papal_chestplate` | <#dd51ed>Papal Robes Chestplate |
| `tfmc_armor:papal_leggings` | <#dd51ed>Papal Robes Leggings |
| `tfmc_armor:papal_boots` | <#dd51ed>Papal Robes Boots |
| `tfmc_armor:vampire_helmet` | <#dd51ed>Papal Robes Helmet |
| `tfmc_armor:vampire_chestplate` | <#dd51ed>Papal Robes Chestplate |
| `tfmc_armor:vampire_leggings` | <#dd51ed>Papal Robes Leggings |
| `tfmc_armor:vampire_boots` | <#dd51ed>Papal Robes Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/original_rothil_zerratoris_armor.yml`** — 40 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:original_rothil_zerratoris_mage_helmet` | Zerratoris Mage Hood |
| `tfmc_armor:original_rothil_zerratoris_mage_chestplate` | Zerratoris Mage Robes |
| `tfmc_armor:original_rothil_zerratoris_mage_leggings` | Zerratoris Mage Leggings |
| `tfmc_armor:original_rothil_zerratoris_mage_boots` | Zerratoris Mage Boots |
| `tfmc_armor:original_rothil_zerratoris_light_mythril_helmet` | Light Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_light_mythril_chestplate` | Light Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_light_mythril_leggings` | Light Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_light_mythril_boots` | Light Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_medium_mythril_helmet` | Medium Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_medium_mythril_chestplate` | Medium Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_medium_mythril_leggings` | Medium Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_medium_mythril_boots` | Medium Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_heavy_mythril_helmet` | Heavy Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_heavy_mythril_chestplate` | Heavy Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_heavy_mythril_leggings` | Heavy Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_heavy_mythril_boots` | Heavy Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_light_abyssalite_helmet` | Light Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_light_abyssalite_chestplate` | Light Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_light_abyssalite_leggings` | Light Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_light_abyssalite_boots` | Light Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_medium_abyssalite_helmet` | Medium Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_medium_abyssalite_chestplate` | Medium Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_medium_abyssalite_leggings` | Medium Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_medium_abyssalite_boots` | Medium Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_heavy_abyssalite_helmet` | Heavy Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_heavy_abyssalite_chestplate` | Heavy Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_heavy_abyssalite_leggings` | Heavy Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_heavy_abyssalite_boots` | Heavy Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_light_steel_helmet` | Light Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_light_steel_chestplate` | Light Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_light_steel_leggings` | Light Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_light_steel_boots` | Light Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_medium_steel_helmet` | Medium Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_medium_steel_chestplate` | Medium Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_medium_steel_leggings` | Medium Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_medium_steel_boots` | Medium Zerratoris Mythril Boots |
| `tfmc_armor:original_rothil_zerratoris_heavy_steel_helmet` | Heavy Zerratoris Mythril Helmet |
| `tfmc_armor:original_rothil_zerratoris_heavy_steel_chestplate` | Heavy Zerratoris Mythril Chestplate |
| `tfmc_armor:original_rothil_zerratoris_heavy_steel_leggings` | Heavy Zerratoris Mythril Leggings |
| `tfmc_armor:original_rothil_zerratoris_heavy_steel_boots` | Heavy Zerratoris Mythril Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/pirate_armor.yml`** — 16 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:pirate_iron_helmet` | &6Pirate Raider Helmet |
| `tfmc_armor:pirate_iron_chestplate` | &6Pirate Raider Chestplate |
| `tfmc_armor:pirate_iron_leggings` | &6Pirate Raider Leggings |
| `tfmc_armor:pirate_iron_boots` | &6Pirate Raider Boots |
| `tfmc_armor:pirate_steel_helmet` | &6Pirate Buccaneer Helmet |
| `tfmc_armor:pirate_steel_chestplate` | &6Pirate Buccaneer Chestplate |
| `tfmc_armor:pirate_steel_leggings` | &6Pirate Buccaneer Leggings |
| `tfmc_armor:pirate_steel_boots` | &6Pirate Buccaneer Boots |
| `tfmc_armor:pirate_abyssalite_helmet` | &6Pirate Swashbuckler Helmet |
| `tfmc_armor:pirate_abyssalite_chestplate` | &6Pirate Swashbuckler Chestplate |
| `tfmc_armor:pirate_abyssalite_leggings` | &6Pirate Swashbuckler Leggings |
| `tfmc_armor:pirate_abyssalite_boots` | &6Pirate Swashbuckler Boots |
| `tfmc_armor:pirate_infantry_helmet` | &6Pirate Musketeer Helmet |
| `tfmc_armor:pirate_infantry_chestplate` | &6Pirate Musketeer Jacket |
| `tfmc_armor:pirate_infantry_leggings` | &6Pirate Musketeer Leggings |
| `tfmc_armor:pirate_infantry_boots` | &6Pirate Musketeer Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/rothil_zerratoris_armor.yml`** — 40 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:rothil_zerratoris_mage_helmet` | Zerratoris Mage Hood |
| `tfmc_armor:rothil_zerratoris_mage_chestplate` | Zerratoris Mage Robes |
| `tfmc_armor:rothil_zerratoris_mage_leggings` | Zerratoris Mage Leggings |
| `tfmc_armor:rothil_zerratoris_mage_boots` | Zerratoris Mage Boots |
| `tfmc_armor:rothil_zerratoris_light_mythril_helmet` | Light Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_light_mythril_chestplate` | Light Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_light_mythril_leggings` | Light Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_light_mythril_boots` | Light Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_medium_mythril_helmet` | Medium Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_medium_mythril_chestplate` | Medium Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_medium_mythril_leggings` | Medium Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_medium_mythril_boots` | Medium Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_heavy_mythril_helmet` | Heavy Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_heavy_mythril_chestplate` | Heavy Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_heavy_mythril_leggings` | Heavy Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_heavy_mythril_boots` | Heavy Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_light_abyssalite_helmet` | Light Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_light_abyssalite_chestplate` | Light Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_light_abyssalite_leggings` | Light Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_light_abyssalite_boots` | Light Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_medium_abyssalite_helmet` | Medium Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_medium_abyssalite_chestplate` | Medium Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_medium_abyssalite_leggings` | Medium Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_medium_abyssalite_boots` | Medium Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_heavy_abyssalite_helmet` | Heavy Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_heavy_abyssalite_chestplate` | Heavy Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_heavy_abyssalite_leggings` | Heavy Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_heavy_abyssalite_boots` | Heavy Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_light_steel_helmet` | Light Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_light_steel_chestplate` | Light Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_light_steel_leggings` | Light Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_light_steel_boots` | Light Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_medium_steel_helmet` | Medium Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_medium_steel_chestplate` | Medium Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_medium_steel_leggings` | Medium Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_medium_steel_boots` | Medium Zerratoris Mythril Boots |
| `tfmc_armor:rothil_zerratoris_heavy_steel_helmet` | Heavy Zerratoris Mythril Helmet |
| `tfmc_armor:rothil_zerratoris_heavy_steel_chestplate` | Heavy Zerratoris Mythril Chestplate |
| `tfmc_armor:rothil_zerratoris_heavy_steel_leggings` | Heavy Zerratoris Mythril Leggings |
| `tfmc_armor:rothil_zerratoris_heavy_steel_boots` | Heavy Zerratoris Mythril Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/s1factions_armor.yml`** — 12 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:malevorian_helmet` | &cMalevorian Helmet |
| `tfmc_armor:malevorian_chestplate` | &cMalevorian Chestplate |
| `tfmc_armor:malevorian_leggings` | &cMalevorian Leggings |
| `tfmc_armor:malevorian_boots` | &cMalevorian Boots |
| `tfmc_armor:threadholm_mage_helmet` | &eThreadholm Mage Hood |
| `tfmc_armor:threadholm_mage_chestplate` | &eThreadholm Mage Robes |
| `tfmc_armor:threadholm_mage_leggings` | &eThreadholm Mage Leggings |
| `tfmc_armor:threadholm_mage_boots` | &eThreadholm Mage Boots |
| `tfmc_armor:malevorian_mage_helmet` | &cMalevorian Mage Hood |
| `tfmc_armor:malevorian_mage_chestplate` | &cMalevorian Mage Robes |
| `tfmc_armor:malevorian_mage_leggings` | &cMalevorian Mage Leggings |
| `tfmc_armor:malevorian_mage_boots` | &cMalevorian Mage Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/s2factions_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:aemg_helmet` | &6A.E.M.G Helmet |
| `tfmc_armor:aemg_chestplate` | &6A.E.M.G Chestplate |
| `tfmc_armor:aemg_leggings` | &6A.E.M.G Leggings |
| `tfmc_armor:aemg_boots` | &6A.E.M.G Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/s3factions_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:white_raven_brotherhood_helmet` | <#4F4240>White Raven Helmet |
| `tfmc_armor:white_raven_brotherhood_chestplate` | <#4F4240>White Raven Chestplate |
| `tfmc_armor:white_raven_brotherhood_leggings` | <#4F4240>White Raven Leggings |
| `tfmc_armor:white_raven_brotherhood_boots` | <#4F4240>White Raven Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/s4factions_armor.yml`** — 59 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:drakhanate_imperialist_iron_helmet` | #<c22b2b>Osenic Chain Helmet |
| `tfmc_armor:drakhanate_imperialist_iron_chestplate` | #<c22b2b>Osenic Chain Chestplate |
| `tfmc_armor:drakhanate_imperialist_iron_leggings` | #<c22b2b>Osenic Chain Leggings |
| `tfmc_armor:drakhanate_imperialist_iron_boots` | #<c22b2b>Osenic Chain Boots |
| `tfmc_armor:drakhanate_imperialist_steel_helmet` | #<c22b2b>Osenic Steel Helmet |
| `tfmc_armor:drakhanate_imperialist_steel_chestplate` | #<c22b2b>Osenic Steel Chestplate |
| `tfmc_armor:drakhanate_imperialist_steel_leggings` | #<c22b2b>Osenic Steel Leggings |
| `tfmc_armor:drakhanate_imperialist_steel_boots` | #<c22b2b>Osenic Steel Boots |
| `tfmc_armor:drakhanate_imperialist_abyssalite_helmet` | #<c22b2b>Osenic Abyssalite Helmet |
| `tfmc_armor:drakhanate_imperialist_abyssalite_chestplate` | #<c22b2b>Osenic Abyssalite Chestplate |
| `tfmc_armor:drakhanate_imperialist_abyssalite_leggings` | #<c22b2b>Osenic Abyssalite Leggings |
| `tfmc_armor:drakhanate_imperialist_abyssalite_boots` | #<c22b2b>Osenic Abyssalite Boots |
| `tfmc_armor:drakhanate_imperialist_mythril_helmet` | #<c22b2b>Osenic Abyssalite Helmet |
| `tfmc_armor:drakhanate_imperialist_mythril_chestplate` | #<c22b2b>Osenic Abyssalite Chestplate |
| `tfmc_armor:drakhanate_imperialist_mythril_leggings` | #<c22b2b>Osenic Abyssalite Leggings |
| `tfmc_armor:drakhanate_imperialist_mythril_boots` | #<c22b2b>Osenic Abyssalite Boots |
| `tfmc_armor:drakhanate_ravoukar_soldier_helmet` | <#96544b>Ravoukar Mask |
| `tfmc_armor:drakhanate_ravoukar_soldier_chestplate` | <#96544b>Ravoukar Enforcer Chestplate |
| `tfmc_armor:drakhanate_ravoukar_soldier_leggings` | <#96544b>Ravoukar Enforcer Leggings |
| `tfmc_armor:drakhanate_ravoukar_soldier_boots` | <#96544b>Ravoukar Enforcer Boots |
| `tfmc_armor:drakhanate_ravoukar_guard_chestplate` | <#96544b>Ravoukar Guard Enforcer Chestplate |
| `tfmc_armor:drakhanate_ravoukar_guard_leggings` | <#96544b>Ravoukar Guard Enforcer Leggings |
| `tfmc_armor:drakhanate_ravoukar_guard_boots` | <#96544b>Ravoukar Guard Enforcer Boots |
| `tfmc_armor:drakhanate_ravoukar_camo_helmet` | <#96544b>Ravoukar Mask (Tan) |
| `tfmc_armor:drakhanate_ravoukar_camo_chestplate` | <#96544b>Ravoukar Enforcer Chestplate (Tan) |
| `tfmc_armor:drakhanate_ravoukar_camo_leggings` | <#96544b>Ravoukar Enforcer Leggings (Tan) |
| `tfmc_armor:drakhanate_ravoukar_camo_boots` | <#96544b>Ravoukar Enforcer Boots (Tan) |
| `tfmc_armor:valnaari_helmet` | <#eb9d02>Valanaar Iron Helmet |
| `tfmc_armor:valnaari_chestplate` | <#eb9d02>Valanaar Iron Chestplate |
| `tfmc_armor:valnaari_leggings` | <#eb9d02>Valanaar Iron Leggings |
| `tfmc_armor:valnaari_boots` | <#eb9d02>Valanaar Iron Boots |
| `tfmc_armor:valnaari_elite_helmet` | <#eb9d02>Valanaar Steel Helmet |
| `tfmc_armor:valnaari_elite_chestplate` | <#eb9d02>Valanaar Steel Chestplate |
| `tfmc_armor:valnaari_elite_leggings` | <#eb9d02>Valanaar Steel Leggings |
| `tfmc_armor:valnaari_elite_boots` | <#eb9d02>Valanaar Steel Boots |
| `tfmc_armor:valnaari_mage_helmet` | <#eb9d02>Valanaar Mage Hood |
| `tfmc_armor:valnaari_mage_chestplate` | <#eb9d02>Valanaar Mage Robes |
| `tfmc_armor:valnaari_mage_leggings` | <#eb9d02>Valanaar Mage Leggings |
| `tfmc_armor:valnaari_mage_boots` | <#eb9d02>Valanaar Mage Boots |
| `tfmc_armor:valnaari_battlemage_helmet` | <#eb9d02>Valanaar Mage Hood |
| `tfmc_armor:valnaari_battlemage_chestplate` | <#eb9d02>Valanaar Mage Robes |
| `tfmc_armor:valnaari_battlemage_leggings` | <#eb9d02>Valanaar Mage Leggings |
| `tfmc_armor:valnaari_battlemage_boots` | <#eb9d02>Valanaar Mage Boots |
| `tfmc_armor:prism_concord_helmet` | <#808080>Prism Helmet |
| `tfmc_armor:prism_concord_chestplate` | <#808080>Prism Chestplate |
| `tfmc_armor:prism_concord_leggings` | <#808080>Prism Leggings |
| `tfmc_armor:prism_concord_boots` | <#808080>Prism Boots |
| `tfmc_armor:verdant_peacekeeper_helmet` | <#a19381>Heavy Helm |
| `tfmc_armor:verdant_peacekeeper_chestplate` | <#a19381>Heavy Chestplate |
| `tfmc_armor:verdant_peacekeeper_leggings` | <#a19381>Heavy Leggings |
| `tfmc_armor:verdant_peacekeeper_boots` | <#a19381>Heavy Boots |
| `tfmc_armor:verdant_grovekeeper_helmet` | <#bd6fc7>Heavy Mage Crown |
| `tfmc_armor:verdant_grovekeeper_chestplate` | <#bd6fc7>Heavy Mage Chestplate |
| `tfmc_armor:verdant_grovekeeper_leggings` | <#bd6fc7>Heavy Mage Leggings |
| `tfmc_armor:verdant_grovekeeper_boots` | <#bd6fc7>Heavy Mage Boots |
| `tfmc_armor:house_tenceur_helmet` | <#4f4240>Tenceur Helmet |
| `tfmc_armor:house_tenceur_chestplate` | <#4f4240>Tenceur Chestplate |
| `tfmc_armor:house_tenceur_leggings` | <#4f4240>Tenceur Leggings |
| `tfmc_armor:house_tenceur_boots` | <#4f4240>Tenceur Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/samurai_armor.yml`** — 12 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:samurai_iron_chestplate` | &6Samurai Guard Chestplate |
| `tfmc_armor:samurai_iron_leggings` | &6Samurai Guard Leggings |
| `tfmc_armor:samurai_iron_boots` | &6Samurai Guard Boots |
| `tfmc_armor:samurai_steel_chestplate` | &6Samurai Warrior Chestplate |
| `tfmc_armor:samurai_steel_leggings` | &6Samurai Warrior Leggings |
| `tfmc_armor:samurai_steel_boots` | &6Samurai Warrior Boots |
| `tfmc_armor:samurai_abyssalite_chestplate` | &6Samurai Shimin Chestplate |
| `tfmc_armor:samurai_abyssalite_leggings` | &6Samurai Shimin Leggings |
| `tfmc_armor:samurai_abyssalite_boots` | &6Samurai Shimin Boots |
| `tfmc_armor:samurai_infantry_chestplate` | &6Samurai Arquebusier Chestplate |
| `tfmc_armor:samurai_infantry_leggings` | &6Samurai Arquebusier Leggings |
| `tfmc_armor:samurai_infantry_boots` | &6Samurai Arquebusier Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/special_armor.yml`** — 6 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:blindfold_helmet` | &7Blindfold |
| `tfmc_armor:heart_of_cerrith` | &#01953D&lT&#159F3D&lh&#29AA3C&le &#51BE3B&lH&#66C93B&le&#7AD33B&la&#8EDD3A&lr&#A2E73A&lt &#CAFC39&lo&#B4F139&lf &#87DA3A&lC&#71CE3B&le&#5AC33B&lr&#44B73C&lr&#2EAC3C&li&#17A03D&lt&#01953D&lh |
| `tfmc_armor:luthenite_mage_helmet` | &cLuthenite Mage Hood |
| `tfmc_armor:luthenite_mage_chestplate` | &cLuthenite Mage Robes |
| `tfmc_armor:luthenite_mage_leggings` | &cLuthenite Mage Leggings |
| `tfmc_armor:luthenite_mage_boots` | &cLuthenite Mage Boots |


**`plugins/ItemsAdder/contents/tfmc_armor/configs/wildmage_armor.yml`** — 16 entries

| Namespaced ID | `display_name` |
|---|---|
| `tfmc_armor:devotee_of_the_tower_helmet` | <#DDD622> Babylon Helmet |
| `tfmc_armor:devotee_of_the_tower_chestplate` | <#DDD622>Babylon Chestplate |
| `tfmc_armor:devotee_of_the_tower_leggings` | <#DDD622> Babylon Leggings |
| `tfmc_armor:devotee_of_the_tower_boots` | <#DDD622> Babylon Boots |
| `tfmc_armor:grave_robber_helmet` | <#549A64>Gourmet Helmet |
| `tfmc_armor:grave_robber_chestplate` | <#540A64>Gourmet Robes |
| `tfmc_armor:grave_robber_leggings` | <#540A64>Gourmet Pants |
| `tfmc_armor:grave_robber_boots` | <#540A64>Gourmet Boots |
| `tfmc_armor:female_bloodmage_helmet` | <gradient:#aa0000:#d10202:#e80505>Female Bloodmage Crown</gradient> |
| `tfmc_armor:female_bloodmage_chestplate` | <gradient:#aa0000:#d10202:#e80505>Female Bloodmage Robes</gradient> |
| `tfmc_armor:female_bloodmage_leggings` | <gradient:#aa0000:#d10202:#e80505>Female Bloodmage Pants</gradient> |
| `tfmc_armor:female_bloodmage_boots` | <gradient:#aa0000:#d10202:#e80505>Female Bloodmage Boots</gradient> |
| `tfmc_armor:banshee_helmet` | Yorimir Helmet |
| `tfmc_armor:banshee_chestplate` | Yorimir Chestplate |
| `tfmc_armor:banshee_leggings` | Yorimir Leggings |
| `tfmc_armor:banshee_boots` | Yorimir Boots |


#### Fishing — namespace `customfishing` (64 entries)


**`plugins/ItemsAdder/contents/customfishing/configs/customfishing.yml`** — 64 entries

| Namespaced ID | `display_name` |
|---|---|
| `customfishing:rainbow_fish` | *(no display_name)* |
| `customfishing:radioactive_fish` | *(no display_name)* |
| `customfishing:tuna_fish` | *(no display_name)* |
| `customfishing:tuna_fish_silver_star` | *(no display_name)* |
| `customfishing:tuna_fish_golden_star` | *(no display_name)* |
| `customfishing:pike_fish` | *(no display_name)* |
| `customfishing:pike_fish_silver_star` | *(no display_name)* |
| `customfishing:pike_fish_golden_star` | *(no display_name)* |
| `customfishing:gold_fish` | *(no display_name)* |
| `customfishing:gold_fish_silver_star` | *(no display_name)* |
| `customfishing:gold_fish_golden_star` | *(no display_name)* |
| `customfishing:perch_fish` | *(no display_name)* |
| `customfishing:perch_fish_silver_star` | *(no display_name)* |
| `customfishing:perch_fish_golden_star` | *(no display_name)* |
| `customfishing:mullet_fish` | *(no display_name)* |
| `customfishing:mullet_fish_silver_star` | *(no display_name)* |
| `customfishing:mullet_fish_golden_star` | *(no display_name)* |
| `customfishing:sardine_fish` | *(no display_name)* |
| `customfishing:sardine_fish_silver_star` | *(no display_name)* |
| `customfishing:sardine_fish_golden_star` | *(no display_name)* |
| `customfishing:carp_fish` | *(no display_name)* |
| `customfishing:carp_fish_silver_star` | *(no display_name)* |
| `customfishing:carp_fish_golden_star` | *(no display_name)* |
| `customfishing:cat_fish` | *(no display_name)* |
| `customfishing:cat_fish_silver_star` | *(no display_name)* |
| `customfishing:cat_fish_golden_star` | *(no display_name)* |
| `customfishing:octopus_fish` | *(no display_name)* |
| `customfishing:octopus_fish_silver_star` | *(no display_name)* |
| `customfishing:octopus_fish_golden_star` | *(no display_name)* |
| `customfishing:sunfish_fish` | *(no display_name)* |
| `customfishing:sunfish_fish_silver_star` | *(no display_name)* |
| `customfishing:sunfish_fish_golden_star` | *(no display_name)* |
| `customfishing:red_spnapper_fish` | *(no display_name)* |
| `customfishing:red_spnapper_silver_star` | *(no display_name)* |
| `customfishing:red_spnapper_fish_golden_star` | *(no display_name)* |
| `customfishing:salmon_void_fish` | *(no display_name)* |
| `customfishing:salmon_void_silver_star` | *(no display_name)* |
| `customfishing:salmon_void_fish_golden_star` | *(no display_name)* |
| `customfishing:woodskip_fish` | *(no display_name)* |
| `customfishing:woodskip_silver_star` | *(no display_name)* |
| `customfishing:woodskip_fish_golden_star` | *(no display_name)* |
| `customfishing:sturgeon_fish` | *(no display_name)* |
| `customfishing:sturgeon_silver_star` | *(no display_name)* |
| `customfishing:sturgeon_fish_golden_star` | *(no display_name)* |
| `customfishing:blue_jellyfish` | *(no display_name)* |
| `customfishing:blue_jellyfish_silver_star` | *(no display_name)* |
| `customfishing:blue_jellyfish_golden_star` | *(no display_name)* |
| `customfishing:pink_jellyfish` | *(no display_name)* |
| `customfishing:pink_jellyfish_silver_star` | *(no display_name)* |
| `customfishing:pink_jellyfish_golden_star` | *(no display_name)* |
| `customfishing:beginner_rod` | <b><#EEE9E9>Beginner's Fishing Rod |
| `customfishing:silver_rod` | <b><#C0C0C0>Silver Fishing Rod |
| `customfishing:golden_rod` | <b><#FFD700>Golden Fishing Rod |
| `customfishing:star_rod` | <b><#FFFF00>Star Fishing Rod |
| `customfishing:bone_rod` | <b><#CD2626>Bone Fishing Rod |
| `customfishing:magical_rod` | <b><#7B68EE>Magical Fishing Rod |
| `customfishing:master_rod` | <b><#FFFF00>Master's Fishing Rod |
| `customfishing:simple_bait` | <b><#00BFFF>Simple lures |
| `customfishing:magnetic_bait` | <b><red>Magn<blue>etic <gray>lures |
| `customfishing:wild_bait` | <b><#2E8B57>Wild lures |
| `customfishing:delicate_hook` | <#1E90FF>Delicate hook |
| `customfishing:fishfinder` | <#1E90FF>Fish Finder |
| `customfishing:splash_water` | *(no display_name)* |
| `customfishing:splash_lava` | *(no display_name)* |


#### Crops - seeds and produce — namespace `playbox_custom_crops` (92 entries)

> **Note:** the produce items literally ship the placeholder text `(Place grade_1star Unicode Here)` in their `display_name` (e.g. `playbox_custom_crops/configs/banana.yml` line 15: `display_name: '&fBanana (Place grade_1star Unicode Here)'`). The pack author intended the `grade_1star`/`grade_2star`/`grade_3star` font-image glyphs to be pasted there. Unless CustomCrops renames them, players see that literal text.


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/apple.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:apple_seeds` | Apple Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/banana.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:banana_seeds` | Banana Seed |
| `playbox_custom_crops:banana_1star` | &fBanana (Place grade_1star Unicode Here) |
| `playbox_custom_crops:banana_2star` | &fBanana (Place grade_2star Unicode Here) |
| `playbox_custom_crops:banana_3star` | &fBanana (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/base.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:tem_seed` |  |
| `playbox_custom_crops:watering_can` | Watering Can |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/basil.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:basil_seeds` | Basil Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/blackpepper.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:blackpepper_seeds` | Black Pepper Seeds |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/cabbage.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:cabbage_seeds` | Cabbage Seed |
| `playbox_custom_crops:cabbage_1star` | &fCabbage (Place grade_1star Unicode Here) |
| `playbox_custom_crops:cabbage_2star` | &fCabbage (Place grade_2star Unicode Here) |
| `playbox_custom_crops:cabbage_3star` | &fCabbage (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/cactusfruit.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:cactusfruit_seeds` | Cactus Fruit Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/cherry.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:cherry_seeds` | Cherry Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/chinese_cabbage.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:chinesecabbage_seeds` | Chinese Cabbage Seeds |
| `playbox_custom_crops:chinese_cabbage` | Chinese Cabbage |
| `playbox_custom_crops:chinese_cabbage_silver_star` | Chinese Cabbage (Silver Star) |
| `playbox_custom_crops:chinese_cabbage_golden_star` | Chinese Cabbage (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/cinnamon.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:cinnamon_seeds` | Cinnamon Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/corn.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:corn_seeds` | Corn Seed |
| `playbox_custom_crops:corn_1star` | &fCorn (Place grade_1star Unicode Here) |
| `playbox_custom_crops:corn_2star` | &fCorn (Place grade_2star Unicode Here) |
| `playbox_custom_crops:corn_3star` | &fCorn (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/cucumber.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:cucumber_seeds` | Cucumber Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/eggplant.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:eggplant_seeds` | Eggplant Seeds |
| `playbox_custom_crops:eggplant` | Eggplant |
| `playbox_custom_crops:eggplant_silver_star` | Eggplant (Silver Star) |
| `playbox_custom_crops:eggplant_golden_star` | Eggplant (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/garlic.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:garlic_seeds` | Garlic Seeds |
| `playbox_custom_crops:garlic` | Garlic |
| `playbox_custom_crops:garlic_silver_star` | Garlic (Silver Star) |
| `playbox_custom_crops:garlic_golden_star` | Garlic (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/grape.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:grape_seeds` | Grape Seeds |
| `playbox_custom_crops:grape` | Grape |
| `playbox_custom_crops:grape_silver_star` | Grape (Silver Star) |
| `playbox_custom_crops:grape_golden_star` | Grape (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/hop.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:hop_seeds` | Hop Seeds |
| `playbox_custom_crops:hop` | Hop |
| `playbox_custom_crops:hop_silver_star` | Hop (Silver Star) |
| `playbox_custom_crops:hop_golden_star` | Hop (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/lemon.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:lemon_seeds` | Lemon Seed |
| `playbox_custom_crops:lemon_1star` | &fLemon (Place grade_1star Unicode Here) |
| `playbox_custom_crops:lemon_2star` | &fLemon (Place grade_2star Unicode Here) |
| `playbox_custom_crops:lemon_3star` | &fLemon (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/lettuce.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:lettuce_seeds` | Lettuce Seed |
| `playbox_custom_crops:lettuce_1star` | &fLettuce (Place grade_1star Unicode Here) |
| `playbox_custom_crops:lettuce_2star` | &fLettuce (Place grade_2star Unicode Here) |
| `playbox_custom_crops:lettuce_3star` | &fLettuce (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/lime.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:lime_seeds` | Lime Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/mustard.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:mustard_seeds` | Mustard Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/nutmeg.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:nut_seeds` | Nut Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/olive.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:olive_seeds` | Olive Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/onion.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:onion_seeds` | Onion Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/orange.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:orange_seeds` | Orange Seed |
| `playbox_custom_crops:orange_1star` | &fOrange (Place grade_1star Unicode Here) |
| `playbox_custom_crops:orange_2star` | &fOrange (Place grade_2star Unicode Here) |
| `playbox_custom_crops:orange_3star` | &fOrange (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/peach.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:peach_seeds` | Peach Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/pepper.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:pepper_seeds` | Pepper Seeds |
| `playbox_custom_crops:pepper` | Pepper |
| `playbox_custom_crops:pepper_silver_star` | Pepper (Silver Star) |
| `playbox_custom_crops:pepper_golden_star` | Pepper (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/pineapple.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:pineapple_seeds` | Pineapple Seed |
| `playbox_custom_crops:pineapple_1star` | &fPineapple (Place grade_1star Unicode Here) |
| `playbox_custom_crops:pineapple_2star` | &fPineapple (Place grade_2star Unicode Here) |
| `playbox_custom_crops:pineapple_3star` | &fPineapple (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/pistachio.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:pistachio_seeds` | Pistachio Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/pitaya.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:pitaya_seeds` | Pitaya Seeds |
| `playbox_custom_crops:pitaya` | Pitaya |
| `playbox_custom_crops:pitaya_silver_star` | Pitaya (Silver Star) |
| `playbox_custom_crops:pitaya_golden_star` | Pitaya (Golden Star) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/plum.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:plum_seeds` | Plum Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/promegranate.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:promegranate_seeds` | Promegranate Seed |
| `playbox_custom_crops:promegranate_1star` | &fPromegranate (Place grade_1star Unicode Here) |
| `playbox_custom_crops:promegranate_2star` | &fPromegranate (Place grade_2star Unicode Here) |
| `playbox_custom_crops:promegranate_3star` | &fPromegranate (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/redpacket.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:redpacket_seeds` | Red Packet Tree Seed |
| `playbox_custom_crops:redpacket` | Red Packet |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/rhubarb.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:rhubarb_seeds` | Rhubarb Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/rice.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:rice_seeds` | Rice Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/spiceleaf.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:spiceleaf_seeds` | Spice Leaf Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/strawberry.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:strawberry_seeds` | Strawberry Seed |
| `playbox_custom_crops:strawberry_1star` | &fStrawberry (Place grade_1star Unicode Here) |
| `playbox_custom_crops:strawberry_2star` | &fStrawberry (Place grade_2star Unicode Here) |
| `playbox_custom_crops:strawberry_3star` | &fStrawberry (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/tomato.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:tomato_seeds` | Tomato Seed |
| `playbox_custom_crops:tomato_1star` | &fTomato (Place grade_1star Unicode Here) |
| `playbox_custom_crops:tomato_2star` | &fTomato (Place grade_2star Unicode Here) |
| `playbox_custom_crops:tomato_3star` | &fTomato (Place grade_3star Unicode Here) |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/vanilla.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:vanilla_seeds` | Vanilla Seed |


**`plugins/ItemsAdder/contents/playbox_custom_crops/configs/yeast.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `playbox_custom_crops:yeast_seeds` | Yeast Seed |


#### Vendor pack: survival — namespace `iasurvival` (166 entries)


**`plugins/ItemsAdder/contents/iasurvival/configs/armors/items/bronze_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_helmet` | Bronze Helmet *(via dictionary key `display-name-bronze_helmet`)* |
| `iasurvival:bronze_chestplate` | Bronze Chestplate *(via dictionary key `display-name-bronze_chestplate`)* |
| `iasurvival:bronze_leggings` | Bronze Leggings *(via dictionary key `display-name-bronze_leggings`)* |
| `iasurvival:bronze_boots` | Bronze Boots *(via dictionary key `display-name-bronze_boots`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/armors/items/dark_amethyst_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_helmet` | Dark Amethyst Helmet *(via dictionary key `display-name-dark_amethyst_helmet`)* |
| `iasurvival:dark_amethyst_chestplate` | Dark Amethyst Chestplate *(via dictionary key `display-name-dark_amethyst_chestplate`)* |
| `iasurvival:dark_amethyst_leggings` | Dark Amethyst Leggings *(via dictionary key `display-name-dark_amethyst_leggings`)* |
| `iasurvival:dark_amethyst_boots` | Dark Amethyst Boots *(via dictionary key `display-name-dark_amethyst_boots`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/armors/items/obsidian_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:obsidian_helmet` | Obsidian Helmet *(via dictionary key `display-name-obsidian_helmet`)* |
| `iasurvival:obsidian_chestplate` | Obsidian Chestplate *(via dictionary key `display-name-obsidian_chestplate`)* |
| `iasurvival:obsidian_leggings` | Obsidian Leggings *(via dictionary key `display-name-obsidian_leggings`)* |
| `iasurvival:obsidian_boots` | Obsidian Boots *(via dictionary key `display-name-obsidian_boots`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/armors/items/ruby_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_helmet` | Ruby Helmet *(via dictionary key `display-name-ruby_helmet`)* |
| `iasurvival:ruby_chestplate` | Ruby Chestplate *(via dictionary key `display-name-ruby_chestplate`)* |
| `iasurvival:ruby_leggings` | Ruby Leggings *(via dictionary key `display-name-ruby_leggings`)* |
| `iasurvival:ruby_boots` | Ruby Boots *(via dictionary key `display-name-ruby_boots`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/bows/colored_bows.yml`** — 6 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:black_bow` | Black Dyed Bow *(via dictionary key `display-name-black_bow`)* |
| `iasurvival:red_bow` | Red Dyed Bow *(via dictionary key `display-name-red_bow`)* |
| `iasurvival:green_bow` | Green Dyed Bow *(via dictionary key `display-name-green_bow`)* |
| `iasurvival:blue_bow` | Blue Dyed Bow *(via dictionary key `display-name-blue_bow`)* |
| `iasurvival:purple_bow` | Purple Dyed Bow *(via dictionary key `display-name-purple_bow`)* |
| `iasurvival:cyan_bow` | Cyan Dyed Bow *(via dictionary key `display-name-cyan_bow`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/black_moor_goldfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:black_moor_goldfish` | Black Moor Goldfish *(via dictionary key `display-name-black_moor_goldfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/blue_parrotfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:blue_parrotfish` | Blue Parrotfish *(via dictionary key `display-name-blue_parrotfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/cod_nigiri.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cod_nigiri` | Cod Nigiri *(via dictionary key `display-name-cod_nigiri`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/cooked_black_moor_goldfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_black_moor_goldfish` | Cooked Black Moor Goldfish *(via dictionary key `display-name-cooked_black_moor_goldfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/cooked_blue_parrotfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_blue_parrotfish` | Cooked Blue Parrotfish *(via dictionary key `display-name-cooked_blue_parrotfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/cooked_goldfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_goldfish` | Cooked Goldfish *(via dictionary key `display-name-cooked_goldfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/cooked_green_sunfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_green_sunfish` | Cooked Green Sunfish *(via dictionary key `display-name-cooked_green_sunfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/cooked_tuna.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_tuna` | Cooked Tuna *(via dictionary key `display-name-cooked_tuna`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/goldfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:goldfish` | Goldfish *(via dictionary key `display-name-goldfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/green_sunfish.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:green_sunfish` | Green Sunfish *(via dictionary key `display-name-green_sunfish`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/pufferfish_nigiri.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:pufferfish_nigiri` | Pufferfish Nigiri *(via dictionary key `display-name-pufferfish_nigiri`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/salmon_nigiri.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:salmon_nigiri` | Salmon Nigiri *(via dictionary key `display-name-salmon_nigiri`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/tropical_fish_nigiri.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:tropical_fish_nigiri` | Tropical Fish Nigiri *(via dictionary key `display-name-tropical_fish_nigiri`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/fishes/tuna.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:tuna` | Tuna *(via dictionary key `display-name-tuna`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/baguette.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:baguette` | Baguette *(via dictionary key `display-name-baguette`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/broken_egg.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:broken_egg` | Broken egg *(via dictionary key `display-name-broken_egg`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/cheese.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cheese` | Cheese *(via dictionary key `display-name-cheese`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/chili_powder.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:chili_powder` | Chili Powder *(via dictionary key `display-name-chili_powder`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/chips.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:chips` | Chips *(via dictionary key `display-name-chips`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/cooked_donut_base.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_donut_base` | Cooked Donut base *(via dictionary key `display-name-cooked_donut_base`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/cooked_sausage.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cooked_sausage` | Cooked Sausage *(via dictionary key `display-name-cooked_sausage`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/donut_base.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:donut_base` | Donut base *(via dictionary key `display-name-donut_base`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/dough.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dough` | Dough *(via dictionary key `display-name-dough`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/flour.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:flour` | Flour *(via dictionary key `display-name-flour`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/french_fries.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:french_fries` | French Fries *(via dictionary key `display-name-french_fries`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/fried_egg.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:fried_egg` | Fried egg *(via dictionary key `display-name-fried_egg`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/fried_potato_sticks.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:fried_potato_sticks` | Fried Potato Sticks *(via dictionary key `display-name-fried_potato_sticks`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/hamburger.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:hamburger` | Hamburger *(via dictionary key `display-name-hamburger`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/hotdog.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:hotdog` | Hotdog *(via dictionary key `display-name-hotdog`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/jam_jars.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:jar` | Jar *(via dictionary key `display-name-jar`)* |
| `iasurvival:sweet_berries_jam_jar` | Sweet Berries Jam Jar *(via dictionary key `display-name-sweet_berries_jam_jar`)* |
| `iasurvival:pear_jam_jar` | Pear Jam Jar *(via dictionary key `display-name-pear_jam_jar`)* |
| `iasurvival:apple_jam_jar` | Apple Jam Jar *(via dictionary key `display-name-apple_jam_jar`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/ketchup.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ketchup` | Ketchup *(via dictionary key `display-name-ketchup`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/ketchup_bottle.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ketchup_bottle` | Ketchup Bottle *(via dictionary key `display-name-ketchup_bottle`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/nether_donut.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:nether_donut` | Nether Donut *(via dictionary key `display-name-nether_donut`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/peeled_potato.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:peeled_potato` | Peeled Potato *(via dictionary key `display-name-peeled_potato`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/pink_donut.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:pink_donut` | Pink Donut *(via dictionary key `display-name-pink_donut`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/pizza.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:pizza` | Pizza *(via dictionary key `display-name-pizza`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/potato_sticks.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:potato_sticks` | Potato Sticks *(via dictionary key `display-name-potato_sticks`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sausage.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sausage` | Sausage *(via dictionary key `display-name-sausage`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_baguette.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_baguette` | Sliced Baguette *(via dictionary key `display-name-sliced_baguette`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_bread.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_bread` | Sliced Bread *(via dictionary key `display-name-sliced_bread`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_bread_with_apple_jam.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_bread_with_apple_jam` | Sliced Bread With Apple Jam *(via dictionary key `display-name-sliced_bread_with_apple_jam`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_bread_with_pear_jam.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_bread_with_pear_jam` | Sliced Bread With Pear Jam *(via dictionary key `display-name-sliced_bread_with_pear_jam`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_bread_with_sweet_berries_jam.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_bread_with_sweet_berries_jam` | Sliced Bread With Sweet Barries Jam *(via dictionary key `display-name-sliced_bread_with_sweet_berries_jam`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_cheese.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_cheese` | Sliced Cheese *(via dictionary key `display-name-sliced_cheese`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_raw_beef.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_raw_beef` | Sliced Raw Beef *(via dictionary key `display-name-sliced_raw_beef`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sliced_roast_beef.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sliced_roast_beef` | Sliced Roast Beef *(via dictionary key `display-name-sliced_roast_beef`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sweet.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sweet` | Sweet *(via dictionary key `display-name-sweet`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/sweet_stick.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sweet_stick` | Sweet stick *(via dictionary key `display-name-sweet_stick`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/various/taco.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:taco` | Taco *(via dictionary key `display-name-taco`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/banana.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:banana` | Banana *(via dictionary key `display-name-banana`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/chili_pepper.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:chili_pepper` | Chili pepper *(via dictionary key `display-name-chili_pepper`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/garlic.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:garlic` | Garlic *(via dictionary key `display-name-garlic`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/lettuce.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:lettuce` | Lettuce *(via dictionary key `display-name-lettuce`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/pear.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:pear` | Pear *(via dictionary key `display-name-pear`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/rice.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:rice` | Rice *(via dictionary key `display-name-rice`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/food/items/vegetable_and_fruit/tomato.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:tomato` | Tomato *(via dictionary key `display-name-tomato`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/aqua_aura.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:aqua_aura` | Aqua Aura *(via dictionary key `display-name-aqua_aura`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/bronze_ingot.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_ingot` | Bronze Ingot *(via dictionary key `display-name-bronze_ingot`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/cassiterite.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cassiterite` | Cassiterite *(via dictionary key `display-name-cassiterite`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/cassiterite_fragment.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cassiterite_fragment` | Cassiterite Fragment *(via dictionary key `display-name-cassiterite_fragment`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/coal_nugget.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:coal_nugget` | Coal Nugget *(via dictionary key `display-name-coal_nugget`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/crystal.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:crystal` | Crystal *(via dictionary key `display-name-crystal`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/dark_amethyst.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst` | Dark Amethyst *(via dictionary key `display-name-dark_amethyst`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/dark_amethyst_prism.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_prism` | Dark Amethyst prism *(via dictionary key `display-name-dark_amethyst_prism`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/end_crystals.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:end_crystals` | End Crystals *(via dictionary key `display-name-end_crystals`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/end_ingot.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:end_ingot` | End Ingot *(via dictionary key `display-name-end_ingot`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/end_shard.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:end_shard` | End Shard *(via dictionary key `display-name-end_shard`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/fossil.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:fossil` | Fossil *(via dictionary key `display-name-fossil`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/knowledge_fragment.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:knowledge_fragment` | Knowledge Fragment *(via dictionary key `display-name-knowledge_fragment`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/raw_tin.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:raw_tin` | Raw Tin *(via dictionary key `display-name-raw_tin`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/raw_tin_and_copper_ingot_dust.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:raw_tin_and_copper_ingot_dust` | Raw Tin and Copper Ingot Dust *(via dictionary key `display-name-raw_tin_and_copper_ingot_dust`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/ruby.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby` | Ruby *(via dictionary key `display-name-ruby`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/spinel.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:spinel` | Spinel *(via dictionary key `display-name-spinel`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/ores/items/turquoise.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:turquoise` | Turquoise *(via dictionary key `display-name-turquoise`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/shields/items/bronze_shield.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_shield` | Bronze Shield *(via dictionary key `display-name-bronze_shield`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/shields/items/dark_amethyst_shield.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_shield` | Dark Amethyst Shield *(via dictionary key `display-name-dark_amethyst_shield`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/shields/items/ender_shield.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ender_shield` | Ender Shield *(via dictionary key `display-name-ender_shield`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/shields/items/obsidian_shield.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:obsidian_shield` | Obsidian Shield *(via dictionary key `display-name-obsidian_shield`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/shields/items/ruby_shield.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_shield` | Ruby Shield *(via dictionary key `display-name-ruby_shield`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/amethyst_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_sword` | Dark Amethyst Sword *(via dictionary key `display-name-dark_amethyst_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/bronze_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_sword` | Bronze Sword *(via dictionary key `display-name-bronze_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/end_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:end_sword` | End Sword *(via dictionary key `display-name-end_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/knife.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:knife` | Knife *(via dictionary key `display-name-knife`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/ruby_dagger.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_dagger` | Ruby dagger *(via dictionary key `display-name-ruby_dagger`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/ruby_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_sword` | Ruby Sword *(via dictionary key `display-name-ruby_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/special/aqualight_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:aqualight_sword` | Aqualight *(via dictionary key `display-name-aqualight_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/special/bloodnite_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bloodnite_sword` | Bloodnite *(via dictionary key `display-name-bloodnite_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/special/emerald_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:emerald_sword` | Emerald Sword *(via dictionary key `display-name-emerald_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/special/firesword_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:firesword_sword` | Fire Sword *(via dictionary key `display-name-firesword_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/special/rusteroth_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:rusteroth_sword` | Rusteroth *(via dictionary key `display-name-rusteroth_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/special/vyderlight_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:vyderlight_sword` | Vyderlight *(via dictionary key `display-name-vyderlight_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/swords/items/sweets_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sweets_sword` | Sweets Sword *(via dictionary key `display-name-sweets_sword`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:boiled_water_bucket` | Boiled Water Bucket *(via dictionary key `display-name-boiled_water_bucket`)* |
| `iasurvival:waterskin` | Waterskin *(via dictionary key `display-name-waterskin`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/bloody_mary.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bloody_mary` | Bloody Mary *(via dictionary key `display-name-bloody_mary`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/coffee.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:coffee` | Coffee *(via dictionary key `display-name-coffee`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/cola.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cola` | Cola *(via dictionary key `display-name-cola`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/cup_of_hot_water.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cup_of_hot_water` | Cup of hot water *(via dictionary key `display-name-cup_of_hot_water`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/cup_of_water.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:cup_of_water` | Cup of water *(via dictionary key `display-name-cup_of_water`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/drink_glass.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:drink_glass` | Drink Glass *(via dictionary key `display-name-drink_glass`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/empty_cup.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:empty_cup` | Empty cup *(via dictionary key `display-name-empty_cup`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/thirst/items/hot_chocolate.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:hot_chocolate` | Hot chocolate *(via dictionary key `display-name-hot_chocolate`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/bronze_axe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_axe` | Bronze Axe *(via dictionary key `display-name-bronze_axe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/bronze_hoe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_hoe` | Bronze hoe *(via dictionary key `display-name-bronze_hoe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/bronze_pickaxe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_pickaxe` | Bronze Pickaxe *(via dictionary key `display-name-bronze_pickaxe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/bronze_shovel.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:bronze_shovel` | Bronze Shovel *(via dictionary key `display-name-bronze_shovel`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/chisel.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:chisel` | Chisel *(via dictionary key `display-name-chisel`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/colored_shears.yml`** — 6 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:black_shears` | Black Dyed Shears *(via dictionary key `display-name-black_shears`)* |
| `iasurvival:red_shears` | Red Dyed Shears *(via dictionary key `display-name-red_shears`)* |
| `iasurvival:green_shears` | Green Dyed Shears *(via dictionary key `display-name-green_shears`)* |
| `iasurvival:blue_shears` | Blue Dyed Shears *(via dictionary key `display-name-blue_shears`)* |
| `iasurvival:purple_shears` | Purple Dyed Shears *(via dictionary key `display-name-purple_shears`)* |
| `iasurvival:cyan_shears` | Cyan Dyed Shears *(via dictionary key `display-name-cyan_shears`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/dark_amethyst_axe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_axe` | Dark Amethyst Axe *(via dictionary key `display-name-dark_amethyst_axe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/dark_amethyst_hoe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_hoe` | Dark Amethyst hoe *(via dictionary key `display-name-dark_amethyst_hoe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/dark_amethyst_pickaxe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_pickaxe` | Dark Amethyst Pickaxe *(via dictionary key `display-name-dark_amethyst_pickaxe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/dark_amethyst_shovel.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:dark_amethyst_shovel` | Dark Amethyst Shovel *(via dictionary key `display-name-dark_amethyst_shovel`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/diamond_hammer.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:diamond_hammer` | &3&lDiamond hammer *(via dictionary key `display-name-diamond_hammer`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/fishing_rods.yml`** — 6 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:black_fishing_rod` | Black Dyed Fishing Rod *(via dictionary key `display-name-black_fishing_rod`)* |
| `iasurvival:red_fishing_rod` | Red Dyed Fishing Rod *(via dictionary key `display-name-red_fishing_rod`)* |
| `iasurvival:green_fishing_rod` | Green Dyed Fishing Rod *(via dictionary key `display-name-green_fishing_rod`)* |
| `iasurvival:blue_fishing_rod` | Blue Dyed Fishing Rod *(via dictionary key `display-name-blue_fishing_rod`)* |
| `iasurvival:purple_fishing_rod` | Purple Dyed Fishing Rod *(via dictionary key `display-name-purple_fishing_rod`)* |
| `iasurvival:cyan_fishing_rod` | Cyan Dyed Fishing Rod *(via dictionary key `display-name-cyan_fishing_rod`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/ruby_axe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_axe` | Ruby Axe *(via dictionary key `display-name-ruby_axe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/ruby_hoe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_hoe` | Ruby hoe *(via dictionary key `display-name-ruby_hoe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/ruby_pickaxe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_pickaxe` | Ruby Pickaxe *(via dictionary key `display-name-ruby_pickaxe`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/tools/items/ruby_shovel.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:ruby_shovel` | Ruby Shovel *(via dictionary key `display-name-ruby_shovel`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/various/items/books.yml`** — 3 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:letter` | Letter *(via dictionary key `display-name-letter`)* |
| `iasurvival:letter_written_letter` | Sealed Letter *(via dictionary key `display-name-letter_written_letter`)* |
| `iasurvival:letter_open_letter` | Opened Letter *(via dictionary key `display-name-letter_open_letter`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/various/items/other.yml`** — 6 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:nest` | Nest *(via dictionary key `display-name-nest`)* |
| `iasurvival:eggs_nest` | Eggs Nest *(via dictionary key `display-name-eggs_nest`)* |
| `iasurvival:plastic` | Plastic *(via dictionary key `display-name-plastic`)* |
| `iasurvival:plastic_plate` | Plastic plate *(via dictionary key `display-name-plastic_plate`)* |
| `iasurvival:iron_plate` | Iron Plate *(via dictionary key `display-name-iron_plate`)* |
| `iasurvival:tobacco` | Tobacco *(via dictionary key `display-name-tobacco`)* |


**`plugins/ItemsAdder/contents/iasurvival/configs/various/items/swords_skins.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iasurvival:sword_skin_rusteroth` | Sword Skin Rusteroth *(via dictionary key `display-name-sword_skin_rusteroth`)* |
| `iasurvival:sword_skin_bloodnite` | Sword Skin Bloodnite *(via dictionary key `display-name-sword_skin_bloodnite`)* |
| `iasurvival:sword_skin_vyderlight` | Sword Skin Vyderlight *(via dictionary key `display-name-sword_skin_vyderlight`)* |
| `iasurvival:sword_skin_aqualight` | Sword Skin Aqualight *(via dictionary key `display-name-sword_skin_aqualight`)* |


#### Vendor pack: alchemy — namespace `iaalchemy` (25 entries)


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/arcane_ring.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:arcane_ring` | Arcane Ring *(via dictionary key `display-name-arcane_ring`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/astral_bow.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:astral_bow` | Astral bow *(via dictionary key `display-name-astral_bow`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/astral_pickaxe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:astral_pickaxe` | &3Astral Pickaxe *(via dictionary key `display-name-astral_pickaxe`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/blank.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:blank` | display-name-blank |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/demoniac_hammer.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:demoniac_hammer` | &4&lDemoniac Hammer *(via dictionary key `display-name-demoniac_hammer`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/demoniac_pickaxe.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:demoniac_pickaxe` | &4&lDemoniac Pickaxe *(via dictionary key `display-name-demoniac_pickaxe`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/energy.yml`** — 3 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:energy_orb` | &5Energy Orb *(via dictionary key `display-name-energy_orb`)* |
| `iaalchemy:small_energy_capsule` | &dSmall Energy Capsule *(via dictionary key `display-name-small_energy_capsule`)* |
| `iaalchemy:energy_capsule` | &6Energy Capsule *(via dictionary key `display-name-energy_capsule`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/healing_crystals.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:healing_crystals` | Healing Crystals *(via dictionary key `display-name-healing_crystals`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_amulet.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:mysterious_amulet` | Mysterious Amulet *(via dictionary key `display-name-mysterious_amulet`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_armor.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:mysterious_hood` | Mysterious Hood *(via dictionary key `display-name-mysterious_hood`)* |
| `iaalchemy:mysterious_robe` | Mysterious Robe *(via dictionary key `display-name-mysterious_robe`)* |
| `iaalchemy:mysterious_leggings` | Mysterious Leggings *(via dictionary key `display-name-mysterious_leggings`)* |
| `iaalchemy:mysterious_boots` | Mysterious Boots *(via dictionary key `display-name-mysterious_boots`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_artifact.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:mysterious_artifact` | Mysterious Artifact *(via dictionary key `display-name-mysterious_artifact`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_books.yml`** — 2 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:mysterious_book` | Mysterious Book *(via dictionary key `display-name-mysterious_book`)* |
| `iaalchemy:mysterious_book_decrypted` | Decrypted Mysterious Book *(via dictionary key `display-name-mysterious_book_decrypted`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_material.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:mysterious_material` | Mysterious Material *(via dictionary key `display-name-mysterious_material`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_sword.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:mysterious_sword` | Mysterious Sword *(via dictionary key `display-name-mysterious_sword`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/philosopher_stone.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:philosopher_stone` | Philosopher's Stone *(via dictionary key `display-name-philosopher_stone`)* |


**`plugins/ItemsAdder/contents/iaalchemy/configs/items/potions.yml`** — 4 entries

| Namespaced ID | `display_name` |
|---|---|
| `iaalchemy:diamonds_finder_potion` | Diamonds finder potion *(via dictionary key `display-name-diamonds_finder_potion`)* |
| `iaalchemy:emeralds_finder_potion` | Emeralds finder potion *(via dictionary key `display-name-emeralds_finder_potion`)* |
| `iaalchemy:strange_potion` | Strange potion *(via dictionary key `display-name-strange_potion`)* |
| `iaalchemy:antidote` | Antidote *(via dictionary key `display-name-antidote`)* |


#### Vendor pack: generic — namespace `iageneric` (35 entries)


**`plugins/ItemsAdder/contents/iageneric/configs/items.yml`** — 35 entries

| Namespaced ID | `display_name` |
|---|---|
| `iageneric:bug_medal` | &6BugFinder medal *(via dictionary key `display-name-bug_medal`)* |
| `iageneric:cute_medal` | &6Cuteness medal *(via dictionary key `display-name-cute_medal`)* |
| `iageneric:donator_medal` | &6Donator medal *(via dictionary key `display-name-donator_medal`)* |
| `iageneric:coin` | Coin *(via dictionary key `display-name-coin`)* |
| `iageneric:banknote` | Banknote *(via dictionary key `display-name-banknote`)* |
| `iageneric:sack_of_money` | Sack Of Money *(via dictionary key `display-name-sack_of_money`)* |
| `iageneric:plastic_bag` | Plastic Bag *(via dictionary key `display-name-plastic_bag`)* |
| `iageneric:light_blue_coupon` | Generic Coupon *(via dictionary key `display-name-light_blue_coupon`)* |
| `iageneric:turquoise_coupon` | Generic Coupon *(via dictionary key `display-name-turquoise_coupon`)* |
| `iageneric:purple_coupon` | Generic Coupon *(via dictionary key `display-name-purple_coupon`)* |
| `iageneric:green_coupon` | Generic Coupon *(via dictionary key `display-name-green_coupon`)* |
| `iageneric:red_coupon` | Generic Coupon *(via dictionary key `display-name-red_coupon`)* |
| `iageneric:black_coupon` | Generic Coupon *(via dictionary key `display-name-black_coupon`)* |
| `iageneric:white_coupon` | Generic Coupon *(via dictionary key `display-name-white_coupon`)* |
| `iageneric:golden_coupon` | Generic Coupon *(via dictionary key `display-name-golden_coupon`)* |
| `iageneric:blue_ring` | Generic Ring *(via dictionary key `display-name-blue_ring`)* |
| `iageneric:light_blue_ring` | Generic Ring *(via dictionary key `display-name-light_blue_ring`)* |
| `iageneric:turquoise_ring` | Generic Ring *(via dictionary key `display-name-turquoise_ring`)* |
| `iageneric:purple_ring` | Generic Ring *(via dictionary key `display-name-purple_ring`)* |
| `iageneric:green_ring` | Generic Ring *(via dictionary key `display-name-green_ring`)* |
| `iageneric:red_ring` | Generic Ring *(via dictionary key `display-name-red_ring`)* |
| `iageneric:black_ring` | Generic Ring *(via dictionary key `display-name-black_ring`)* |
| `iageneric:white_ring` | Generic Ring *(via dictionary key `display-name-white_ring`)* |
| `iageneric:golden_ring` | Generic Ring *(via dictionary key `display-name-golden_ring`)* |
| `iageneric:marriage_ring` | Marriage Ring *(via dictionary key `display-name-marriage_ring`)* |
| `iageneric:blue_key` | Generic Key *(via dictionary key `display-name-blue_key`)* |
| `iageneric:light_blue_key` | Generic Key *(via dictionary key `display-name-light_blue_key`)* |
| `iageneric:turquoise_key` | Generic Key *(via dictionary key `display-name-turquoise_key`)* |
| `iageneric:purple_key` | Generic Key *(via dictionary key `display-name-purple_key`)* |
| `iageneric:green_key` | Generic Key *(via dictionary key `display-name-green_key`)* |
| `iageneric:red_key` | Generic Key *(via dictionary key `display-name-red_key`)* |
| `iageneric:black_key` | Generic Key *(via dictionary key `display-name-black_key`)* |
| `iageneric:white_key` | Generic Key *(via dictionary key `display-name-white_key`)* |
| `iageneric:golden_key` | Generic Key *(via dictionary key `display-name-golden_key`)* |
| `iageneric:carton_box` | Carton Box *(via dictionary key `display-name-carton_box`)* |


#### Vendor pack: wearable hats — namespace `iawearables` (26 entries)


**`plugins/ItemsAdder/contents/iawearables/configs/items.yml`** — 26 entries

| Namespaced ID | `display_name` |
|---|---|
| `iawearables:deadmau5_hat` | &9deadmau5_hat *(via dictionary key `display-name-deadmau5_hat`)* |
| `iawearables:top_hat` | Top Hat *(via dictionary key `display-name-top_hat`)* |
| `iawearables:welding_mask` | Welding Mask *(via dictionary key `display-name-welding_mask`)* |
| `iawearables:mining_helmet` | Mining Helmet *(via dictionary key `display-name-mining_helmet`)* |
| `iawearables:dog_mask` | Dog Mask *(via dictionary key `display-name-dog_mask`)* |
| `iawearables:ruby_pickaxe_hat` | Ruby Pickaxe Hat *(via dictionary key `display-name-ruby_pickaxe_hat`)* |
| `iawearables:straw_hat` | Straw Hat *(via dictionary key `display-name-straw_hat`)* |
| `iawearables:cool_sunglasses` | Cool Sunglasses *(via dictionary key `display-name-cool_sunglasses`)* |
| `iawearables:cigar` | Cigar *(via dictionary key `display-name-cigar`)* |
| `iawearables:glasses` | Glasses *(via dictionary key `display-name-glasses`)* |
| `iawearables:biker_helmet` | Biker Helmet *(via dictionary key `display-name-biker_helmet`)* |
| `iawearables:demoniac_red_wings` | Demoniac Red Wings *(via dictionary key `display-name-demoniac_red_wings`)* |
| `iawearables:demoniac_turquoise_wings` | Demoniac Turquoise Wings *(via dictionary key `display-name-demoniac_turquoise_wings`)* |
| `iawearables:demoniac_purple_wings` | Demoniac Purple Wings *(via dictionary key `display-name-demoniac_purple_wings`)* |
| `iawearables:demoniac_blue_wings` | Demoniac Blue Wings *(via dictionary key `display-name-demoniac_blue_wings`)* |
| `iawearables:demoniac_black_wings` | Demoniac Black Wings *(via dictionary key `display-name-demoniac_black_wings`)* |
| `iawearables:all_black_cat_tail` | All Black Cat Tail *(via dictionary key `display-name-all_black_cat_tail`)* |
| `iawearables:black_cat_tail` | Black Cat Tail *(via dictionary key `display-name-black_cat_tail`)* |
| `iawearables:white_cat_tail` | White Cat Tail *(via dictionary key `display-name-white_cat_tail`)* |
| `iawearables:ender_dragon_wings` | Ender Dragon Wings *(via dictionary key `display-name-ender_dragon_wings`)* |
| `iawearables:red_backpack` | Red Backpack *(via dictionary key `display-name-red_backpack`)* |
| `iawearables:turquoise_backpack` | Turquoise Backpack *(via dictionary key `display-name-turquoise_backpack`)* |
| `iawearables:purple_backpack` | Purple Backpack *(via dictionary key `display-name-purple_backpack`)* |
| `iawearables:blue_backpack` | Blue Backpack *(via dictionary key `display-name-blue_backpack`)* |
| `iawearables:black_backpack` | Black Backpack *(via dictionary key `display-name-black_backpack`)* |
| `iawearables:brown_backpack` | Brown Backpack *(via dictionary key `display-name-brown_backpack`)* |


#### Vendor pack: festivities — namespace `iafestivities` (9 entries)


**`plugins/ItemsAdder/contents/iafestivities/configs/christmas/santa_hat.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:santa_hat` | &cSanta Hat *(via dictionary key `display-name-santa_hat`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/axe_hat.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:axe_hat` | Axe Hat *(via dictionary key `display-name-axe_hat`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/bat_wings.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:bat_wings` | Bat Wings *(via dictionary key `display-name-bat_wings`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/bones_backpack.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:bones_backpack` | Bones &fBackpack *(via dictionary key `display-name-bones_backpack`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/cave_spider_backpack.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:cave_spider_backpack` | Cave Spider &fBackpack *(via dictionary key `display-name-cave_spider_backpack`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/dark_jack_o_lantern_backpack.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:dark_jack_o_lantern_backpack` | &4Dark &6Jack o'Lantern &fBackpack *(via dictionary key `display-name-dark_jack_o_lantern_backpack`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/jack_o_lantern_backpack.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:jack_o_lantern_backpack` | &6Jack o'Lantern &fBackpack *(via dictionary key `display-name-jack_o_lantern_backpack`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/spider_backpack.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:spider_backpack` | Spider &fBackpack *(via dictionary key `display-name-spider_backpack`)* |


**`plugins/ItemsAdder/contents/iafestivities/configs/halloween/witch_hat.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `iafestivities:witch_hat` | Witch Hat *(via dictionary key `display-name-witch_hat`)* |


#### GUI icons — namespace `mcicons` (32 entries)


**`plugins/ItemsAdder/contents/mcicons/configs/icons.yml`** — 32 entries

| Namespaced ID | `display_name` |
|---|---|
| `mcicons:icon_left_gray` | display-name-icon_left_gray |
| `mcicons:icon_left_blue` | display-name-icon_left_blue |
| `mcicons:icon_right_gray` | display-name-icon_right_gray |
| `mcicons:icon_right_blue` | display-name-icon_right_blue |
| `mcicons:icon_up_gray` | display-name-icon_up_gray |
| `mcicons:icon_up_blue` | display-name-icon_up_blue |
| `mcicons:icon_down_gray` | display-name-icon_down_gray |
| `mcicons:icon_down_blue` | display-name-icon_down_blue |
| `mcicons:icon_next_white` | display-name-icon_next_white |
| `mcicons:icon_next_orange` | display-name-icon_next_orange |
| `mcicons:icon_back_white` | display-name-icon_back_white |
| `mcicons:icon_back_orange` | display-name-icon_back_orange |
| `mcicons:icon_cancel` | display-name-icon_cancel |
| `mcicons:icon_confirm` | display-name-icon_confirm |
| `mcicons:icon_lock` | display-name-icon_lock |
| `mcicons:icon_unlock` | display-name-icon_unlock |
| `mcicons:icon_web` | display-name-icon_web |
| `mcicons:icon_ender_chest` | display-name-icon_ender_chest |
| `mcicons:icon_refresh` | display-name-icon_refresh |
| `mcicons:icon_time_day` | display-name-icon_time_day |
| `mcicons:icon_time_midnight` | display-name-icon_time_midnight |
| `mcicons:icon_time_night` | display-name-icon_time_night |
| `mcicons:icon_time_noon` | display-name-icon_time_noon |
| `mcicons:icon_time_sunrise` | display-name-icon_time_sunrise |
| `mcicons:icon_time_sunset` | display-name-icon_time_sunset |
| `mcicons:icon_toggle_off` | display-name-icon_toggle_off |
| `mcicons:icon_toggle_on` | display-name-icon_toggle_on |
| `mcicons:icon_arrow_chest` | display-name-icon_arrow_chest |
| `mcicons:icon_plus` | display-name-icon_plus |
| `mcicons:icon_color_picker` | display-name-icon_color_picker |
| `mcicons:icon_comment` | display-name-icon_comment |
| `mcicons:icon_search` | display-name-icon_search |


#### Parasitic worm — namespace `parasitic_worm` (1 entries)


**`plugins/ItemsAdder/contents/parasitic_worm/configs/parasitic_worm.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `parasitic_worm:parasitic_worm` | Parasitic Worm |


#### Dead pack - item — namespace `dead_pack` (1 entries)


**`plugins/ItemsAdder/contents/tfmc_dead_pack/configs/base.yml`** — 1 entries

| Namespaced ID | `display_name` |
|---|---|
| `dead_pack:killing_pike_2` | Killing Pike 2 |


#### ItemsAdder internal GUI items — namespace `_iainternal` (7 entries)


**`plugins/ItemsAdder/contents/_iainternal/configs/icons.yml`** — 7 entries

| Namespaced ID | `display_name` |
|---|---|
| `_iainternal:icon_left_blue` | display-name-icon_left_blue |
| `_iainternal:icon_right_blue` | display-name-icon_right_blue |
| `_iainternal:icon_search` | display-name-icon_search |
| `_iainternal:icon_cancel` | display-name-icon_cancel |
| `_iainternal:icon_arrow_chest` | display-name-icon_arrow_chest |
| `_iainternal:icon_back_orange` | display-name-icon_back_orange |
| `_iainternal:icon_next_orange` | display-name-icon_next_orange |


### Custom blocks

**128 custom blocks** are defined. Every one of them uses ItemsAdder's `REAL_NOTE` technique (a disguised note block) except one `REAL_WIRE` block, so to a client without the pack they look like note blocks / tripwire. All are placed and broken like ordinary blocks.

Registered block state IDs are listed in `plugins/ItemsAdder/storage/real_blocks_note_ids_cache.yml` (127 entries) and `real_wire_ids_cache.yml` (3 entries).

#### `tfmc_blocks` — 93 blocks

Source: `plugins/ItemsAdder/contents/tfmc_blocks/configs/blocks.yml`

| Namespaced ID | Display name | Hardness | Light | Break tool |
|---|---|---|---|---|
| `tfmc_blocks:maplewood_log` | &7Maplewood Log | 8 | 1 | AXE |
| `tfmc_blocks:elderwood_log` | &8Elderwood Log | 8 | 1 | AXE |
| `tfmc_blocks:demonwood_log` | &4Demonwood Log | 8 | 1 | AXE |
| `tfmc_blocks:maplewood_plank` | &7Maplewood Plank | 8 | 1 | AXE |
| `tfmc_blocks:elderwood_plank` | &8Elderwood Plank | 8 | 1 | AXE |
| `tfmc_blocks:demonwood_plank` | &4Demonwood Plank | 8 | 1 | AXE |
| `tfmc_blocks:ignitium_block` | &6Block of Ignitium | 8 | 1 | PICKAXE |
| `tfmc_blocks:coke_block` | &8Block of Coke | 8 | 1 | PICKAXE |
| `tfmc_blocks:tin_block` | &7Block of Tin | 8 | 1 | PICKAXE |
| `tfmc_blocks:bronze_block` | &6Block of Bronze | 8 | 1 | PICKAXE |
| `tfmc_blocks:steel_block` | &7Block of Steel | 8 | 1 | PICKAXE |
| `tfmc_blocks:abyssalite_block` | &8Block of Abyssalite | 8 | 1 | PICKAXE |
| `tfmc_blocks:mythril_block1` | &3Block of Mythril | 8 | 8 | PICKAXE |
| `tfmc_blocks:mythril_block2` | &3Exposed Mythril | 8 | 1 | PICKAXE |
| `tfmc_blocks:mythril_block3` | &3Weathered Mythril | 8 | 1 | PICKAXE |
| `tfmc_blocks:mythril_block4` | &3Oxidized Mythril | 8 | 1 | PICKAXE |
| `tfmc_blocks:mural_sun_tl` | &6Ancient Mural - Sun (Top Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_sun_tr` | &6Ancient Mural - Sun (Top Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_sun_bl` | &6Ancient Mural - Sun (Bottom Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_sun_br` | &6Ancient Mural - Sun (Bottom Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_spell_tl` | &6Ancient Mural - Spell (Top Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_spell_tr` | &6Ancient Mural - Spell (Top Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_spell_bl` | &6Ancient Mural - Spell (Bottom Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_spell_br` | &6Ancient Mural - Spell (Bottom Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_summon_tl` | &6Ancient Mural - Summon (Top Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_summon_tr` | &6Ancient Mural - Summon (Top Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_summon_bl` | &6Ancient Mural - Summon (Bottom Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_summon_br` | &6Ancient Mural - Summon (Bottom Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_beast_tl` | &6Ancient Mural - Beast (Top Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_beast_tr` | &6Ancient Mural - Beast (Top Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_beast_bl` | &6Ancient Mural - Beast (Bottom Left) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_beast_br` | &6Ancient Mural - Beast (Bottom Right) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_2` | &6Ancient Mural - Decarith (2) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_3` | &6Ancient Mural - Decarith (3) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_4` | &6Ancient Mural - Decarith (4) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_5` | &6Ancient Mural - Decarith (5) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_6` | &6Ancient Mural - Decarith (6) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_7` | &6Ancient Mural - Decarith (7) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_8` | &6Ancient Mural - Decarith (8) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_9` | &6Ancient Mural - Decarith (9) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_10` | &6Ancient Mural - Decarith (10) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_11` | &6Ancient Mural - Decarith (11) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_12` | &6Ancient Mural - Decarith (12) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_13` | &6Ancient Mural - Decarith (13) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_14` | &6Ancient Mural - Decarith (14) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_15` | &6Ancient Mural - Decarith (15) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_decarith_16` | &6Ancient Mural - Decarith (16) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_1` | &6Ancient Mural - Barrier (1) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_2` | &6Ancient Mural - Barrier (2) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_3` | &6Ancient Mural - Barrier (3) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_4` | &6Ancient Mural - Barrier (4) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_5` | &6Ancient Mural - Barrier (5) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_6` | &6Ancient Mural - Barrier (6) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_7` | &6Ancient Mural - Barrier (7) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_8` | &6Ancient Mural - Barrier (8) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_9` | &6Ancient Mural - Barrier (9) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_10` | &6Ancient Mural - Barrier (10) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_11` | &6Ancient Mural - Barrier (11) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_12` | &6Ancient Mural - Barrier (12) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_13` | &6Ancient Mural - Barrier (13) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_14` | &6Ancient Mural - Barrier (14) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_15` | &6Ancient Mural - Barrier (15) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_barrier_16` | &6Ancient Mural - Barrier (16) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_1` | &6Ancient Mural - Ascension (1) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_2` | &6Ancient Mural - Ascension (2) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_3` | &6Ancient Mural - Ascension (3) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_4` | &6Ancient Mural - Ascension (4) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_5` | &6Ancient Mural - Ascension (5) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_6` | &6Ancient Mural - Ascension (6) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_7` | &6Ancient Mural - Ascension (7) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_8` | &6Ancient Mural - Ascension (8) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_9` | &6Ancient Mural - Ascension (9) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_10` | &6Ancient Mural - Ascension (10) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_11` | &6Ancient Mural - Ascension (11) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_12` | &6Ancient Mural - Ascension (12) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_13` | &6Ancient Mural - Ascension (13) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_14` | &6Ancient Mural - Ascension (14) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_15` | &6Ancient Mural - Ascension (15) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_ascension_16` | &6Ancient Mural - Ascension (16) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_1` | &6Ancient Mural - Prelates (1) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_2` | &6Ancient Mural - Prelates (2) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_5` | &6Ancient Mural - Prelates (5) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_6` | &6Ancient Mural - Prelates (6) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_7` | &6Ancient Mural - Prelates (7) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_8` | &6Ancient Mural - Prelates (8) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_9` | &6Ancient Mural - Prelates (9) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_10` | &6Ancient Mural - Prelates (10) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_11` | &6Ancient Mural - Prelates (11) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_12` | &6Ancient Mural - Prelates (12) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_13` | &6Ancient Mural - Prelates (13) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_14` | &6Ancient Mural - Prelates (14) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_15` | &6Ancient Mural - Prelates (15) | 1.5 | 1 | PICKAXE |
| `tfmc_blocks:mural_prelates_16` | &6Ancient Mural - Prelates (16) | 1.5 | 1 | PICKAXE |

#### `iasurvival` — 27 blocks

Source: `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/decorative/modern_quartz.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/decorative/modern_sandstone.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/decorative/modern_stone.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/decorative/nice_stone.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/decorative/nice_wood.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/amethyst_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/amethyst_prism_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/aqua_aura_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/cassiterite_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/crystal_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/ruby_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/spinel_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/blocks/items/minerals/turquoise_block.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/machinery/customization_table.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/machinery/restoration_table.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/aqua_aura_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/blaze_powder_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/cassiterite_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/coal_dirt_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/dark_amethyst_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/end_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/forgotten_crying_obsidian.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/gold_dirt_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/iron_dirt_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/ruby_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/spinel_ore.yml`, `plugins/ItemsAdder/contents/iasurvival/configs/ores/items/turquoise_ore.yml`

| Namespaced ID | Display name | Hardness | Light | Break tool |
|---|---|---|---|---|
| `iasurvival:modern_quartz` | Modern Quartz | — | — | PICKAXE, pickaxe |
| `iasurvival:modern_sandstone` | Modern Sandstone | — | — | PICKAXE, pickaxe |
| `iasurvival:modern_stone` | Modern Stone | — | — | PICKAXE, pickaxe |
| `iasurvival:nice_stone` | Nice Stone | — | — | AXE, axe |
| `iasurvival:nice_wood` | Nice Wood | — | — | HAND, AXE, axe |
| `iasurvival:dark_amethyst_block` | Block of Dark Amethyst | — | — | PICKAXE, pickaxe |
| `iasurvival:dark_amethyst_prism_block` | Block of Dark Amethyst Prism | — | — | PICKAXE, pickaxe |
| `iasurvival:aqua_aura_block` | Block of Aqua Aura | — | — | PICKAXE, pickaxe |
| `iasurvival:cassiterite_block` | Block of Cassiterite | — | — | PICKAXE, pickaxe |
| `iasurvival:crystal_block` | Block of Crystal | — | — | PICKAXE, pickaxe |
| `iasurvival:ruby_block` | Block of Ruby | — | — | PICKAXE, pickaxe |
| `iasurvival:spinel_block` | Block of Spinel | — | — | PICKAXE, pickaxe |
| `iasurvival:turquoise_block` | Block of Turquoise | — | — | PICKAXE, pickaxe |
| `iasurvival:customization_table` | Customization Table | — | — | any |
| `iasurvival:restoration_table` | Restoration Table | — | 6 | any |
| `iasurvival:aqua_aura_ore` | Aqua Aura Ore | 1.8 | — | PICKAXE, pickaxe, _hammer |
| `iasurvival:blaze_powder_ore` | Blaze Powder Ore | 4.5 | — | PICKAXE, pickaxe |
| `iasurvival:cassiterite_ore` | Cassiterite Ore | 3 | — | PICKAXE, pickaxe, _hammer |
| `iasurvival:coal_dirt_ore` | Coal Dirt Ore | — | — | HAND, PICKAXE, SHOVEL, pickaxe, shovel |
| `iasurvival:dark_amethyst_ore` | Dark Amethyst Ore | 4 | — | PICKAXE, pickaxe, _hammer |
| `iasurvival:end_ore` | End Ore | 3 | 12 | DIAMOND_PICKAXE, PICKAXE, pickaxe, _hammer |
| `iasurvival:forgotten_crying_obsidian` | &9Forgotten Crying Obsidian | 8 | — | PICKAXE, pickaxe |
| `iasurvival:gold_dirt_ore` | Gold Dirt Ore | — | — | HAND, PICKAXE, SHOVEL, pickaxe, shovel |
| `iasurvival:iron_dirt_ore` | Iron Dirt Ore | — | — | HAND, PICKAXE, SHOVEL, pickaxe, shovel |
| `iasurvival:ruby_ore` | Ruby Ore | 4 | — | PICKAXE, pickaxe, _hammer |
| `iasurvival:spinel_ore` | Spinel Ore | 2.5 | — | PICKAXE, pickaxe, _hammer |
| `iasurvival:turquoise_ore` | Turquoise Ore | 2 | — | PICKAXE, pickaxe, _hammer |

#### `tfmc` — 4 blocks

Source: `plugins/ItemsAdder/contents/ia_tfmc/contents/base.yml`

| Namespaced ID | Display name | Hardness | Light | Break tool |
|---|---|---|---|---|
| `tfmc:weapon_station` | Weapon Station | 8 | 2 | any |
| `tfmc:engineering_table` | Engineering Table | 16 | — | any |
| `tfmc:dockyard` | Dockyard | 16 | — | any |
| `tfmc:alchemy_station_placed` | *(none)* | — | — | any |

#### `iaalchemy` — 2 blocks

Source: `plugins/ItemsAdder/contents/iaalchemy/configs/items/mysterious_ore.yml`, `plugins/ItemsAdder/contents/iaalchemy/configs/items/nether_alchemy_ore.yml`

| Namespaced ID | Display name | Hardness | Light | Break tool |
|---|---|---|---|---|
| `iaalchemy:mysterious_ore` | Mysterious Ore | 8 | 9 | DIAMOND_PICKAXE, PICKAXE, pickaxe, _hammer |
| `iaalchemy:nether_alchemy_ore` | Nether Alchemy Ore | 6 | — | PICKAXE, pickaxe |

#### `playbox_custom_crops` — 2 blocks

Source: `plugins/ItemsAdder/contents/playbox_custom_crops/configs/base.yml`

| Namespaced ID | Display name | Hardness | Light | Break tool |
|---|---|---|---|---|
| `playbox_custom_crops:pot` | Pot | — | — | any |
| `playbox_custom_crops:watered_pot` | Watered Pot | — | — | any |


### Furniture

**478 furniture pieces** are defined (items with a `behaviours.furniture` block). Furniture is placed like an item frame, has its own hitbox, and is broken by hitting it. Of these, **27 are sittable** (`furniture_sit`) and **2 are trade machines** (`furniture_trade_machine`) that open a shop GUI on right-click.

Nothing else in the furniture configs defines a right-click action — interaction behaviour for stations (Alloy Forge, Engineering Table, …) is supplied by the *consuming* plugin, not by ItemsAdder. See `plugins/TFMCCore/stations.yml` and the MMOItems crafting-station section above.

#### `playbox_custom_crops` — 170 furniture pieces

**Folder `playbox_custom_crops/`** — 170 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `playbox_custom_crops:apple_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:apple_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:apple_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:apple_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:apple_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:apple_stage_6` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:banana_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:banana_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:banana_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:banana_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:banana_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:basil_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:basil_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:basil_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:basil_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:blackpepper_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:blackpepper_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:blackpepper_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:blackpepper_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cabbage_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cabbage_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cabbage_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cactusfruit_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cactusfruit_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cactusfruit_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cactusfruit_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cactusfruit_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cherry_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cherry_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cherry_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cherry_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cherry_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:chinesecabbage_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:chinesecabbage_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:chinesecabbage_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:chinesecabbage_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cinnamon_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cinnamon_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cinnamon_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cinnamon_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cinnamon_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:corn_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:corn_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:corn_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:corn_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cucumber_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cucumber_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cucumber_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:cucumber_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:eggplant_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:eggplant_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:eggplant_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:eggplant_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:garlic_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:garlic_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:garlic_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:garlic_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:grape_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:grape_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:grape_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:grape_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:grape_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:grape_stage_6` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:hop_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:hop_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:hop_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:hop_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lemon_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lemon_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lemon_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lemon_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lemon_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lettuce_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lettuce_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lettuce_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lime_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lime_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lime_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lime_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:lime_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:mustard_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:mustard_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:mustard_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:mustard_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:mustard_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:nutmeg_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:nutmeg_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:nutmeg_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:nutmeg_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:nutmeg_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:olive_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:olive_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:olive_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:olive_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:olive_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:onion_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:onion_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:onion_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:orange_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:orange_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:orange_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:orange_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:orange_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:peach_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:peach_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:peach_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:peach_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:peach_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pepper_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pepper_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pepper_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pepper_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pepper_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pineapple_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pineapple_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pineapple_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pineapple_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pistachio_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pistachio_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pistachio_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pistachio_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pitaya_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pitaya_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pitaya_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pitaya_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pitaya_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:pitaya_stage_6` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:plum_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:plum_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:plum_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:plum_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:plum_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:plum_stage_6` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:promegranate_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:promegranate_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:promegranate_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:promegranate_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:promegranate_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:redpacket_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:redpacket_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:redpacket_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:redpacket_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:redpacket_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:redpacket_stage_6` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rhubarb_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rhubarb_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rhubarb_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rice_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rice_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rice_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:rice_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:spiceleaf_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:spiceleaf_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:spiceleaf_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:strawberry_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:strawberry_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:strawberry_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:tomato_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:tomato_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:tomato_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:tomato_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:vanilla_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:vanilla_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:vanilla_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:vanilla_stage_4` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:vanilla_stage_5` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:yeast_stage_1` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:yeast_stage_2` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:yeast_stage_3` | *(none — texture carrier)* |  |  |
| `playbox_custom_crops:yeast_stage_4` | *(none — texture carrier)* |  |  |

#### `elitecreatures` — 118 furniture pieces

**Folder `french_tavern/`** — 20 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `elitecreatures:french_medieval_furniture_v1_box` | Box |  |  |
| `elitecreatures:french_medieval_furniture_v1_bread_basket` | Bread Basket |  |  |
| `elitecreatures:french_medieval_furniture_v1_carpet` | Carpet |  |  |
| `elitecreatures:french_medieval_furniture_v1_chair_1` | Chair 1 | yes |  |
| `elitecreatures:french_medieval_furniture_v1_chair_2` | Chair 2 | yes |  |
| `elitecreatures:french_medieval_furniture_v1_coffin` | Coffin |  |  |
| `elitecreatures:french_medieval_furniture_v1_cup` | Cup |  |  |
| `elitecreatures:french_medieval_furniture_v1_curtain` | Curtain |  |  |
| `elitecreatures:french_medieval_furniture_v1_folding_chair` | Folding Chair | yes |  |
| `elitecreatures:french_medieval_furniture_v1_food` | Food |  |  |
| `elitecreatures:french_medieval_furniture_v1_hanging_light` | Hanging Light |  | placeable on ceiling; emits light 10 |
| `elitecreatures:french_medieval_furniture_v1_horseman_decoration` | Horseman Decoration |  |  |
| `elitecreatures:french_medieval_furniture_v1_logo` | Logo |  | placeable on walls |
| `elitecreatures:french_medieval_furniture_v1_long_desk` | Long Desk |  |  |
| `elitecreatures:french_medieval_furniture_v1_picture_1` | Picture 1 |  | placeable on walls |
| `elitecreatures:french_medieval_furniture_v1_picture_2` | Picture 2 |  | placeable on walls |
| `elitecreatures:french_medieval_furniture_v1_picture_3` | Picture 3 |  | placeable on walls |
| `elitecreatures:french_medieval_furniture_v1_wall_lamp` | Wall Lamp |  | placeable on walls; emits light 10 |
| `elitecreatures:french_medieval_furniture_v1_weapon_1` | Weapon 1 |  | placeable on walls |
| `elitecreatures:french_medieval_furniture_v1_weapon_2` | Weapon 2 |  | placeable on walls |

**Folder `funeral/`** — 20 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `elitecreatures:funeral_furniture_v1_bench` | Bench | yes |  |
| `elitecreatures:funeral_furniture_v1_candle` | Candle |  | emits light 10 |
| `elitecreatures:funeral_furniture_v1_candle_gift` | Candle Gift |  | emits light 10 |
| `elitecreatures:funeral_furniture_v1_chair` | Chair | yes |  |
| `elitecreatures:funeral_furniture_v1_coffin_1` | Coffin 1 |  |  |
| `elitecreatures:funeral_furniture_v1_coffin_2` | Coffin 2 |  |  |
| `elitecreatures:funeral_furniture_v1_coffin_black` | Coffin Black |  |  |
| `elitecreatures:funeral_furniture_v1_cross` | Cross |  | placeable on walls |
| `elitecreatures:funeral_furniture_v1_flower_basket` | Flower Basket |  |  |
| `elitecreatures:funeral_furniture_v1_flower_bowl` | Flower Bowl |  |  |
| `elitecreatures:funeral_furniture_v1_flower_stand_1` | Flower Stand 1 |  |  |
| `elitecreatures:funeral_furniture_v1_flower_stand_2` | Flower Stand 2 |  |  |
| `elitecreatures:funeral_furniture_v1_incense` | Incense |  |  |
| `elitecreatures:funeral_furniture_v1_jar` | Jar |  |  |
| `elitecreatures:funeral_furniture_v1_memory_table` | Memory Table |  |  |
| `elitecreatures:funeral_furniture_v1_normal_tombstone` | Normal Tombstone |  |  |
| `elitecreatures:funeral_furniture_v1_picture` | Picture |  |  |
| `elitecreatures:funeral_furniture_v1_picture_funeral` | Picture Funeral |  |  |
| `elitecreatures:funeral_furniture_v1_ribbon` | Ribbon |  |  |
| `elitecreatures:funeral_furniture_v1_standing_candle` | Standing Candle |  | emits light 10 |

**Folder `grafitti/`** — 32 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `elitecreatures:graffiti_decoration_v1_graffiti_1` | Graffiti 1 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_2` | Graffiti 2 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_3` | Graffiti 3 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_4` | Graffiti 4 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_5` | Graffiti 5 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_6` | Graffiti 6 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_7` | Graffiti 7 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_8` | Graffiti 8 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_9` | Graffiti 9 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_10` | Graffiti 10 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_11` | Graffiti 11 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_12` | Graffiti 12 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_13` | Graffiti 13 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_14` | Graffiti 14 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_15` | Graffiti 15 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_16` | Graffiti 16 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_17` | Graffiti 17 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_18` | Graffiti 18 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_19` | Graffiti 19 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_20` | Graffiti 20 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_21` | Graffiti 21 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_22` | Graffiti 22 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_23` | Graffiti 23 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_24` | Graffiti 24 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_25` | Graffiti 25 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_26` | Graffiti 26 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_27` | Graffiti 27 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_28` | Graffiti 28 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_29` | Graffiti 29 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_30` | Graffiti 30 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_31` | Graffiti 31 |  | placeable on walls |
| `elitecreatures:graffiti_decoration_v1_graffiti_32` | Graffiti 32 |  | placeable on walls |

**Folder `torture/`** — 20 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `elitecreatures:torture_machine_decoration_v1_axe` | Axe |  |  |
| `elitecreatures:torture_machine_decoration_v1_bear_trap` | Bear Trap |  |  |
| `elitecreatures:torture_machine_decoration_v1_cage` | Cage |  |  |
| `elitecreatures:torture_machine_decoration_v1_chain_wall` | Chain Wall |  | placeable on walls |
| `elitecreatures:torture_machine_decoration_v1_electric_chair` | Electric Chair | yes |  |
| `elitecreatures:torture_machine_decoration_v1_execution_target_shooting` | Execution Target Shooting |  |  |
| `elitecreatures:torture_machine_decoration_v1_guillotine` | Guillotine |  |  |
| `elitecreatures:torture_machine_decoration_v1_hanging` | Hanging |  |  |
| `elitecreatures:torture_machine_decoration_v1_hanging_cage` | Hanging Cage |  |  |
| `elitecreatures:torture_machine_decoration_v1_iron_cage` | Iron Cage |  |  |
| `elitecreatures:torture_machine_decoration_v1_iron_maiden` | Iron Maiden |  |  |
| `elitecreatures:torture_machine_decoration_v1_medieval_stocks` | Medieval Stocks |  |  |
| `elitecreatures:torture_machine_decoration_v1_medival_stretch` | Medival Stretch |  |  |
| `elitecreatures:torture_machine_decoration_v1_opened_ironmaiden` | Opened Ironmaiden |  |  |
| `elitecreatures:torture_machine_decoration_v1_punish_bracalets` | Punish Bracalets |  |  |
| `elitecreatures:torture_machine_decoration_v1_spanish_boot_hanging_on_wall` | Spanish Boot Hanging On Wall |  | placeable on walls |
| `elitecreatures:torture_machine_decoration_v1_spanish_donkey` | Spanish Donkey |  |  |
| `elitecreatures:torture_machine_decoration_v1_thorn_chair` | Thorn Chair | yes |  |
| `elitecreatures:torture_machine_decoration_v1_thumbscrew` | Thumbscrew |  |  |
| `elitecreatures:torture_machine_decoration_v1_torture_device` | Torture Device |  |  |

**Folder `urban/`** — 26 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `elitecreatures:urban_city_decoration_v1_barrier` | Barrier |  |  |
| `elitecreatures:urban_city_decoration_v1_bench` | Bench | yes |  |
| `elitecreatures:urban_city_decoration_v1_billboard` | Billboard |  |  |
| `elitecreatures:urban_city_decoration_v1_bin_1` | Bin 1 |  |  |
| `elitecreatures:urban_city_decoration_v1_bin_2` | Bin 2 |  |  |
| `elitecreatures:urban_city_decoration_v1_bus_stop` | Bus Stop |  |  |
| `elitecreatures:urban_city_decoration_v1_bus_stop_sign` | Bus Stop Sign |  |  |
| `elitecreatures:urban_city_decoration_v1_dumpster` | Dumpster |  |  |
| `elitecreatures:urban_city_decoration_v1_electrical_cabinet` | Electrical Cabinet |  |  |
| `elitecreatures:urban_city_decoration_v1_fence` | Fence |  | placeable on walls |
| `elitecreatures:urban_city_decoration_v1_fire_hydrant` | Fire Hydrant |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_1` | Garbage 1 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_2` | Garbage 2 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_3` | Garbage 3 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_4` | Garbage 4 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_5` | Garbage 5 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_6` | Garbage 6 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_7` | Garbage 7 |  |  |
| `elitecreatures:urban_city_decoration_v1_garbage_set` | Garbage Set |  |  |
| `elitecreatures:urban_city_decoration_v1_graffiti_1` | Graffiti 1 |  | placeable on walls |
| `elitecreatures:urban_city_decoration_v1_graffiti_2` | Graffiti 2 |  | placeable on walls |
| `elitecreatures:urban_city_decoration_v1_lamp_post` | Lamp Post |  | emits light 10 |
| `elitecreatures:urban_city_decoration_v1_mailbox` | Mailbox |  |  |
| `elitecreatures:urban_city_decoration_v1_signpost` | Signpost |  |  |
| `elitecreatures:urban_city_decoration_v1_traffic_lights_1` | Traffic Lights 1 |  | emits light 10 |
| `elitecreatures:urban_city_decoration_v1_traffic_lights_2` | Traffic Lights 2 |  | emits light 10 |

#### `lzfurniture` — 99 furniture pieces

**Folder `izcozy/`** — 14 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `lzfurniture:cozy_carpet` | Cozy Rug |  |  |
| `lzfurniture:cozy_armchair` | Cozy Armchair | yes |  |
| `lzfurniture:cozy_chair` | Cozy Chair | yes |  |
| `lzfurniture:cozy_book` | Cozy Book |  |  |
| `lzfurniture:cozy_fireplace` | Cozy Fireplace |  | emits light 6 |
| `lzfurniture:cozy_grandfatherclock` | Cozy Grandfather Clock |  |  |
| `lzfurniture:cozy_painting` | Cozy Painting |  | placeable on walls |
| `lzfurniture:cozy_luggage` | Cozy Luggage |  |  |
| `lzfurniture:cozy_piano` | Cozy Piano |  |  |
| `lzfurniture:cozy_radiator` | Cozy Radiator |  |  |
| `lzfurniture:cozy_sideboard` | Cozy Sideboard |  |  |
| `lzfurniture:cozy_sofa` | Cozy Sofa | yes |  |
| `lzfurniture:cozy_television` | Cozy Television |  |  |
| `lzfurniture:cozy_bench` | Cozy Bench | yes |  |

**Folder `izwitch/`** — 10 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `lzfurniture:witch_armchair` | Witch Armhair | yes |  |
| `lzfurniture:witch_cabin_full` | Witch Cabin Full |  |  |
| `lzfurniture:witch_cabin_empty` | Witch Cabin Empty |  |  |
| `lzfurniture:witch_candles` | Witch Candles |  | emits light 10 |
| `lzfurniture:witch_carpet` | Witch Carpet |  |  |
| `lzfurniture:witch_cauldron` | Witch Cauldron |  |  |
| `lzfurniture:witch_desk` | Witch Desk |  |  |
| `lzfurniture:witch_glass_1` | Witch Glass 1 |  |  |
| `lzfurniture:witch_glass_2` | Witch Glass 2 |  |  |
| `lzfurniture:witch_scry_ball` | Witch Scry Ball |  |  |

**Folder `lzfurniture/`** — 13 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `lzfurniture:medievalroyal_chair` | Medieval Royal Chair | yes |  |
| `lzfurniture:medievalroyal_banner` | Medieval Royal Banner |  | placeable on walls |
| `lzfurniture:medievalroyal_dish_fruits` | Medieval Royal Dish with Fruits |  |  |
| `lzfurniture:medievalroyal_books` | Medieval Royal Books |  |  |
| `lzfurniture:medievalroyal_bookshelf` | Medieval Royal Bookshelf |  |  |
| `lzfurniture:medievalroyal_shelf` | Medieval Royal Shelf |  |  |
| `lzfurniture:medievalroyal_dish` | Medieval Royal Dish |  |  |
| `lzfurniture:medievalroyal_stool` | Medieval Royal Stool | yes |  |
| `lzfurniture:medievalroyal_candleholder` | Medieval Royal Candleholder |  | emits light 15 |
| `lzfurniture:medievalroyal_candle` | Medieval Royal Candle |  | emits light 12 |
| `lzfurniture:medievalroyal_sofa` | Medieval Royal Sofa | yes |  |
| `lzfurniture:medievalroyal_sofa_big` | Medieval Royal Double Sofa | yes |  |
| `lzfurniture:medievalroyal_table` | Medieval Royal Table |  |  |

**Folder `marauder_pack/`** — 22 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `lzfurniture:marauder_coins` | Marauder Coins |  |  |
| `lzfurniture:marauder_coins_small` | Marauder Coins Small |  |  |
| `lzfurniture:marauder_goldbars` | Marauder Goldbars |  |  |
| `lzfurniture:marauder_desk` | Marauder Desk |  |  |
| `lzfurniture:marauder_globe` | Marauder Globe |  |  |
| `lzfurniture:marauder_goldbag` | Marauder Bag with Gold |  |  |
| `lzfurniture:marauder_map` | Marauder Map |  |  |
| `lzfurniture:marauder_paperrolls` | Marauder Paperrolls |  |  |
| `lzfurniture:marauder_planks` | Marauder Planks |  |  |
| `lzfurniture:marauder_rum_bottles` | Marauder Rum Bottles | yes |  |
| `lzfurniture:marauder_sideboard` | Marauder Sideboard |  |  |
| `lzfurniture:marauder_telescope` | Marauder Telescope |  |  |
| `lzfurniture:marauder_vase` | Marauder Vase |  |  |
| `lzfurniture:marauder_bar` | Marauder Bar |  | placeable on walls |
| `lzfurniture:marauder_bar_rope` | Marauder Bar With Rope |  | placeable on walls |
| `lzfurniture:marauder_bar_curtain_left` | Marauder Bar With Curtain Left |  | placeable on walls |
| `lzfurniture:marauder_bar_curtain_right` | Marauder Bar With Curtain Right |  | placeable on walls |
| `lzfurniture:marauder_books` | Marauder Books |  |  |
| `lzfurniture:marauder_canon` | Marauder Canon |  |  |
| `lzfurniture:marauder_chest_closed` | Marauder Chest Closed |  |  |
| `lzfurniture:marauder_chest_open` | Marauder Chest Open |  |  |
| `lzfurniture:marauder_captain_chair` | Marauder Captain Chair | yes |  |

**Folder `market_pack/`** — 29 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `lzfurniture:medieval_market_stalltable` | Market Stall Table |  |  |
| `lzfurniture:medieval_market_scarecrow` | Market Scarecrow |  |  |
| `lzfurniture:medieval_market_campfire` | Market Campfire |  | emits light 8 |
| `lzfurniture:medieval_market_chest` | Market Chest |  |  |
| `lzfurniture:medieval_market_direction_sign` | Market Direction Sign |  |  |
| `lzfurniture:medieval_market_hangingpot` | Market Hanging Pot |  | placeable on ceiling |
| `lzfurniture:medieval_market_haybales` | Market Haybales |  |  |
| `lzfurniture:medieval_market_lantern` | Market Lantern |  | emits light 17 |
| `lzfurniture:medieval_market_marketstall_red` | Market Red Stall |  |  |
| `lzfurniture:medieval_market_marketstall_purple` | Market Purple Stall |  |  |
| `lzfurniture:medieval_market_open_chest` | Market Chest Open |  |  |
| `lzfurniture:medieval_market_pot` | Market Cooking Pot |  |  |
| `lzfurniture:medieval_market_bench` | Market Bench | yes |  |
| `lzfurniture:medieval_market_box` | Market Box |  |  |
| `lzfurniture:medieval_market_box_apples` | Market Box with Apples |  |  |
| `lzfurniture:medieval_market_box_bread` | Market Box with Bread |  |  |
| `lzfurniture:medieval_market_bed` | Market Bed | yes |  |
| `lzfurniture:medieval_market_barell` | Market Barell |  |  |
| `lzfurniture:medieval_market_bath` | Market Bath | yes |  |
| `lzfurniture:medieval_market_bag` | Market Bag |  |  |
| `lzfurniture:medieval_market_chair` | Market Chair | yes |  |
| `lzfurniture:medieval_market_stool` | Market Stool | yes |  |
| `lzfurniture:medieval_market_table` | Market Table |  |  |
| `lzfurniture:medieval_market_wagon_red` | Market Vendor Wagon Red |  |  |
| `lzfurniture:medieval_market_wagon_purple` | Market Vendor Wagon Purple |  |  |
| `lzfurniture:medieval_market_wagon2` | Market Hay Wagon |  |  |
| `lzfurniture:medieval_market_wall_lantern` | Market Wall Lantern |  | placeable on walls; emits light 17 |
| `lzfurniture:medieval_market_well` | Market Well |  |  |
| `lzfurniture:medieval_market_wood_pile` | Market Wood Pile |  |  |

**Folder `royal_pack_2/`** — 11 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `lzfurniture:medieval_carpet` | Medieval Carpet |  |  |
| `lzfurniture:medievalroyal_carpet` | Medieval Royal Carpet |  |  |
| `lzfurniture:medievalroyal_throne` | Medieval Royal Throne | yes |  |
| `lzfurniture:medievalroyal_bed` | Medieval Royal Bed | yes |  |
| `lzfurniture:medievalroyal_chandelier` | Medieval Royal Chandelier |  | placeable on ceiling; emits light 15 |
| `lzfurniture:medievalroyal_mirror` | Medieval Royal Mirror |  |  |
| `lzfurniture:medievalroyal_painting_2x1` | Medieval Royal Painting |  | placeable on walls |
| `lzfurniture:medievalroyal_painting_3x2` | Medieval Royal Big Painting |  | placeable on walls |
| `lzfurniture:medievalroyal_pillow` | Medieval Royal Pillow | yes |  |
| `lzfurniture:medievalroyal_tablecandleholder` | Medieval Royal Table Candleholder |  | emits light 13 |
| `lzfurniture:medievalroyal_torch` | Medieval Royal Torch |  | placeable on walls; emits light 12 |

#### `dead_pack` — 49 furniture pieces

**Folder `tfmc_dead_pack/`** — 49 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `dead_pack:frozen_1` | Frozen Wizard 1 |  |  |
| `dead_pack:dead_troll_1` | Dead troll 1 |  |  |
| `dead_pack:dead_swamp_noose_1` | Swamp Noose 1 |  | placeable on ceiling |
| `dead_pack:dead_swamp_noose_2` | Swamp Noose 2 |  | placeable on ceiling |
| `dead_pack:ground_arrow_1` | Ground Arrow 1 |  | placeable on floor/ceiling/walls |
| `dead_pack:ground_arrow_2` | Ground Arrow 2 |  | placeable on floor/ceiling/walls |
| `dead_pack:ground_arrow_3` | Ground Arrow 3 |  | placeable on floor/ceiling/walls |
| `dead_pack:swamp_soldier_dead_1` | Dead Swamp Soldier 1 |  |  |
| `dead_pack:swamp_soldier_dead_2` | Dead Swamp Soldier 2 |  |  |
| `dead_pack:swamp_soldier_dead_3` | Dead Swamp Soldier 3 |  |  |
| `dead_pack:swamp_soldier_dead_4` | Dead Swamp Soldier 4 |  |  |
| `dead_pack:swamp_soldier_dead_5` | Dead Swamp Soldier 5 |  |  |
| `dead_pack:swamp_soldier_dead_6` | Dead Swamp Soldier 6 |  |  |
| `dead_pack:swamp_soldier_dead_7` | Dead Swamp Soldier 7 |  |  |
| `dead_pack:swamp_soldier_dead_8` | Dead Swamp Soldier 8 |  |  |
| `dead_pack:swamp_soldier_dead_9` | Dead Swamp Soldier 9 |  |  |
| `dead_pack:swamp_soldier_dead_10` | Dead Swamp Soldier 10 |  |  |
| `dead_pack:swamp_soldier_leg` | Dead Swamp Leg |  |  |
| `dead_pack:dead_traveler` | Dead traveler 1 |  |  |
| `dead_pack:killing_pike_inuit_1` | Killing Pike Snow 1 |  |  |
| `dead_pack:killing_pike_inuit_2` | Killing Pike Snow 2 |  |  |
| `dead_pack:killing_pike_inuit_3` | Killing Pike Snow 3 |  |  |
| `dead_pack:killing_pike_inuit_4` | Killing Pike Snow 4 |  |  |
| `dead_pack:killing_pike_1` | Killing Pike 1 |  |  |
| `dead_pack:killing_pike_3` | Killing Pike 3 |  |  |
| `dead_pack:killing_pike_4` | Killing Pike 4 |  |  |
| `dead_pack:killing_pike_swamp_1` | Killing Pike Swamp 1 |  |  |
| `dead_pack:killing_pike_swamp_2` | Killing Pike Swamp 2 |  |  |
| `dead_pack:killing_pike_swamp_3` | Killing Pike Swamp 3 |  |  |
| `dead_pack:killing_pike_swamp_4` | Killing Pike Swamp 4 |  |  |
| `dead_pack:dead_jeremiah` | Dead Jeremiah |  | placeable on walls |
| `dead_pack:jeremiah_head` | Jeremiah Head |  | placeable on floor/walls |
| `dead_pack:jeremiah_body` | Jeremiah Body |  | placeable on floor/walls |
| `dead_pack:jeremiah_leg` | Jeremiah Leg |  | placeable on floor/walls |
| `dead_pack:jeremiah_arm` | Jeremiah Arm |  | placeable on floor/walls |
| `dead_pack:killing_wall_1` | Killing Wall 1 |  | placeable on walls |
| `dead_pack:killing_noose_1` | Killing Noose 1 |  | placeable on ceiling |
| `dead_pack:killing_noose_2` | Killing Noose 2 |  | placeable on ceiling |
| `dead_pack:killing_noose_3` | Killing Noose 3 |  | placeable on ceiling |
| `dead_pack:killing_noose_4` | Killing Noose 4 |  | placeable on ceiling |
| `dead_pack:killing_water_1` | Killing Water 1 |  | placeable on ceiling |
| `dead_pack:dave_1` | Dave Winter's Head |  |  |
| `dead_pack:dead_rimgrod` | Dead Rimgrod |  | placeable on walls |
| `dead_pack:dead_necro_seithr_soldier_1` | Dead Necro-Seithr Soldier 1 |  |  |
| `dead_pack:dead_necro_seithr_soldier_2` | Dead Necro-Seithr Soldier 2 |  |  |
| `dead_pack:dead_necro_seithr_soldier_sitting` | Sitting Dead Necro-Seithr Soldier |  |  |
| `dead_pack:dead_necro_seithr_archer` | Dead Necro-Seithr Archer |  |  |
| `dead_pack:dead_necro_seithr_archer_sitting` | Sitting Dead Necro-Seithr Archer |  |  |
| `dead_pack:dead_necro_seithr_golem` | Dead Necro-Seithr Golem |  |  |

#### `tfmc` — 33 furniture pieces

**Folder `ia_tfmc/`** — 33 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `tfmc:alloy_forge` | Alloy Forge |  |  |
| `tfmc:ingredient_converter` | Ingredient Converter |  |  |
| `tfmc:stone_statue` | Stone Statue |  |  |
| `tfmc:woodworking_station` | Woodworking Station |  |  |
| `tfmc:bank` | Faction Bank |  |  |
| `tfmc:ammunition_station` | Engineer Station |  |  |
| `tfmc:gunsmithing_station` | Gunsmithing Station |  |  |
| `tfmc:market_block` | Market Block |  |  |
| `tfmc:arcane_extractor` | &5Arcane Extractor |  |  |
| `tfmc:cooking_station` | Cooking Station |  |  |
| `tfmc:meal_prep_station` | Meal Prep Station |  |  |
| `tfmc:magic_crafting_station` | Magic Station |  |  |
| `tfmc:fishing_station` | Fishing Station |  |  |
| `tfmc:animal_station` | Animal Station |  |  |
| `tfmc:archeology_station` | Archeology Table |  |  |
| `tfmc:archeology_cabinet` | Archeology Cabinet |  |  |
| `tfmc:voting_booth` | Voting Booth |  |  |
| `tfmc:medicine_station` | Medicine Station |  |  |
| `tfmc:recycling_station` | Recycling Station |  |  |
| `tfmc:syringe_1` | Syringe |  |  |
| `tfmc:cherry_pie` | Cherry Pie |  |  |
| `tfmc:general_node` | General Node |  |  |
| `tfmc:mining_node` | Mining Node |  |  |
| `tfmc:farming_node` | Farming Node |  |  |
| `tfmc:quarry_node` | Quarry Node |  |  |
| `tfmc:wood_node` | Forestry Node |  |  |
| `tfmc:royal_node` | Royal Node |  |  |
| `tfmc:royal_node_revenor` | Royal Node (Revenor) |  |  |
| `tfmc:royal_node_domenia` | Royal Node (Domenia) |  |  |
| `tfmc:royal_node_sabarissa` | Royal Node (Sabarissa) |  |  |
| `tfmc:kellen_plushie_1` | Kellen Plushie |  |  |
| `tfmc:kellen_plushie_6` | Kellen Plushie |  |  |
| `tfmc:shark_plushie` | Shark Plushie |  |  |

#### `iafestivities` — 5 furniture pieces

**Folder `iafestivities/`** — 5 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `iafestivities:christmas_candle` | Christmas Candle |  | emits light 8 |
| `iafestivities:christmas_tree` | Christmas Tree |  | emits light 15 |
| `iafestivities:christmas_wreath` | Christmas Wreath |  |  |
| `iafestivities:decorative_candy_cane` | Decorative Candy Cane |  |  |
| `iafestivities:decorative_pumpkin` | Decorative Pumpkin |  | emits light 15 |

#### `iaalchemy` — 4 furniture pieces

**Folder `iaalchemy/`** — 4 pieces

| Namespaced ID | Display name | Sittable | Notes |
|---|---|---|---|
| `iaalchemy:alchemy_candles` | Alchemy Candles |  | emits light 8 |
| `iaalchemy:mysterious_stone` | Mysterious Stone |  | emits light 13 |
| `iaalchemy:energy_converter` | Energy Converter |  | opens a trade/shop GUI; emits light 7 |
| `iaalchemy:energy_extractor` | Energy Extractor |  | opens a trade/shop GUI; emits light 7 |


### Emojis, chat glyphs, fonts and HUDs

#### How you type an emoji

ItemsAdder replaces text of the form `:name:` with an image. The matching pattern is hard-coded in the plugin jar as the regex `:([a-z_\-0-9]+):` (string extracted from `ItemsAdder_4.0.17.jar`), so a trigger may only contain lowercase letters, digits, `_` and `-`. There is **no namespace prefix in the trigger** - you type `:smile:`, not `:twitteremojis:smile:`.

Where replacement is switched on (`plugins/ItemsAdder/config.yml` → `font_images`):

| Context | Key | Enabled |
|---|---|---|
| Chat | `font_images.chat.enabled` | **true** |
| Hover tooltip on the replaced emoji + click-to-suggest | `font_images.chat.add_hover_suggestion` | **true** |
| TAB auto-completion of emoji names (1.19.1+) | `font_images.chat.tab_autocompletion_1_19_1_plus` | **true** |
| Commands | `font_images.command.enabled` | **true**, and also in command blocks (`commandblocks: true`) |
| Commands excluded from replacement | `font_images.command.excluded` | `home`, `sethome`, `tpa` |
| Signs | `font_images.sign.enabled` | **true** |
| Books | `font_images.book.enabled` | **true** |
| Anvil rename box | `font_images.anvil.enabled` | **true** |
| Inventory titles | `font_images.inventory-title.enabled` | **true** |
| Custom item names and lore | `font_images.customitem_name_and_lore.enabled` | **true** |
| Scoreboard team prefixes/suffixes | `font_images.scoreboard-teams.enabled` | **false** |

Hovering a replaced emoji shows (`plugins/ItemsAdder/lang/en.yml` → `font-image-chat-hover`):

> `Emoji: {font_image}` / `Usage: {placeholder}` / "HINT: You can use the `/e` command to send public messages/commands with emojis easier. Write the emoji name and press TAB. Examples: `/e Hello smile` prints `Hello :smile:`; `/e /tell Notch Hello smile` sends the command `/tell Notch Hello :smile:`"

The browsing GUI is `/iaimage` (aliases `/iaemoji`, `/emoji`, `/e`), titled **"&3&lEmoji List"** (`lang/en.yml` → `emoji-gui-title`). Every emoji in both emoji packs has `show_in_gui: true`.

**Permissions.** Each font image declares a `permission:` value, and ItemsAdder checks `ia.user.image.use.<that value>`. In both emoji packs the `permission` value is simply the emoji's own id, so `:smile:` needs `ia.user.image.use.smile` (or the wildcard `ia.user.image.use.*`). The LuckPerms action log (`plugins/LuckPerms/luckperms-h2-v2.mv.db`) records `ia.user.image.use.*` being granted to the groups **`donator`**, **`qa`** and **`lore`** (each paired with the removal of an older `tfmc.emojis` node) - and **not** to `default`. Emojis therefore look like a rank perk, not a baseline feature. Whether that is still the live permission state was not verified (see Uncertain).

Also relevant: `ia.user.image.chat`, `ia.user.image.sign`, `ia.user.image.book`, `ia.user.image.anvil`, `ia.user.image.command`, `ia.user.image.hints`, `ia.user.image.gui` (all extracted from the jar; none is declared `default: true` in `plugin.yml`).

**Text effects** are a separate ItemsAdder feature and are enabled in chat, item names/lore, signs, books and anvils (`config.yml` → `text_effects`), gated by `ia.user.text_effect.*` nodes. **No `text_effects:` block is defined in any content file on this server**, so there is nothing for players to use.

**Fonts.** `resource-pack.custom-font.enabled: false` and `resource-pack.thin-font.enabled: false` - the server uses the vanilla font. `resource-pack.fix_force_unicode_font_images: true`. The generated pack contains `assets/minecraft/font/default.json` and `assets/minecraft/font/uniform.json` (auto-generated by ItemsAdder), plus CustomFishing's own font providers `assets/customfishing/font/{default,icons,offset_chars}.json` - those belong to CustomFishing, not to ItemsAdder's `font_images` system.

#### Font-image inventory (587 total)

`plugins/ItemsAdder/storage/font_images_unicode_cache.yml` confirms 587 assigned glyph characters, matching the config count exactly.

| Namespace | Count | What it is | Typed as |
|---|---|---|---|
| `mcemojis` | 275 | Pictures of vanilla Minecraft items, drawn from `minecraft:item/<thing>` textures at `scale_ratio: 9`, `y_position: 8` | `:mc_<item>:` |
| `twitteremojis` | 266 | Twemoji-style smileys, food, animals, zodiac, symbols, digits | `:<name>:` |
| `_iainternal` | 27 | GUI backgrounds and the 21-frame cooldown bar - **not typeable content**, used by ItemsAdder's own menus | n/a |
| `iaalchemy` | 11 | Machine GUI overlays + 6-frame mana bar (vendor pack, HUD disabled) | n/a |
| `iasurvival` | 5 | Customization-table GUI overlays + 3 thirst-bar pieces (vendor pack, HUD disabled) | n/a |
| `playbox_custom_crops` | 3 | `grade_1star`, `grade_2star`, `grade_3star` crop-quality stars | used inside crop item names |


#### HUDs (3 defined, 1 enabled)

`config.yml` → `huds.enabled: true`, `huds.force_color.enabled: false`.

| HUD | Namespace | File | Type | `enabled` | What it is |
|---|---|---|---|---|---|
| `small_cooldown_bar` | `_iainternal` | `contents/_iainternal/configs/huds/hud_cooldown.yml` | `FRAMES` (21 frames, `x_position_pixels: -97`) | **true** | The item-cooldown bar. `show.auto: false`, so it is shown on demand rather than permanently; it is driven by the player stat `small_cooldown_bar` (start/max 20, min 0) |
| `mana_bar` | `iaalchemy` | `contents/iaalchemy/configs/huds/huds.yml` | `FRAMES` (6 frames, `x_position_pixels: 100`) | **false** | Vendor pack mana bar - **disabled, players never see it** |
| `thirst_bar` | `iasurvival` | `contents/iasurvival/configs/thirst/hud_thirst.yml` | `STATUS` (`x_position_pixels: 10`, `direction: LEFT`, value 10/10 with over-time decrement triggers) | **false** | Vendor pack thirst system - **disabled, there is no thirst mechanic on this server** |

Alongside the HUD, `config.yml` → `cooldown_bars` is `enabled: true` with `refresh_ticks: 1` and a **boss bar** of colour `WHITE`, style `SOLID`. So an item on cooldown shows as a white boss bar at the top of the screen.

Player stat storage for HUD values is `player_stats.save_type: CUSTOM_NBT`.

`ia.user.hud.show.*` is the **only ItemsAdder permission in `plugin.yml` declared `default: true`** - every player can see HUDs. The three bypass nodes (`ia.user.hud.bypass.triggers.*`, `...commands.*`, `...api.*`) are declared `default: false`.

#### Complete emoji trigger lists

These are every string a player can type. Nothing is omitted.

**`twitteremojis` - 266 triggers** (`plugins/ItemsAdder/contents/twitteremojis/configs/*.yml`)

`:0:`, `:1:`, `:2:`, `:3:`, `:4:`, `:5:`, `:6:`, `:7:`, `:8:`, `:9:`, `:alarmclock:`, `:alien:`, `:angry:`, `:angry1:`, `:angry2:`, `:angry3:`, `:anxious:`, `:aquarius:`, `:aries:`, `:asterisk:`, `:atm:`, `:avocado:`, `:bacon:`, `:baguette:`, `:bandage:`, `:bat:`, `:biceps:`, `:biohazard:`, `:blocked:`, `:blood:`, `:blush:`, `:bye:`, `:callme:`, `:cancel:`, `:capricorn:`, `:carrot:`, `:chair:`, `:chick:`, `:chick1:`, `:chick2:`, `:clap:`, `:coffin:`, `:cold:`, `:confirm:`, `:confused:`, `:confused1:`, `:couple:`, `:cowboy:`, `:crab:`, `:croissant:`, `:crossedfingers:`, `:cry:`, `:cry1:`, `:crycat:`, `:cucumber:`, `:dead:`, `:dead1:`, `:dollar:`, `:doubleexclamation:`, `:down:`, `:drops:`, `:drumstick:`, `:duck:`, `:eagle:`, `:eggplant:`, `:eject:`, `:evil:`, `:explodehead:`, `:eyes:`, `:facemask:`, `:fastdown:`, `:fastforward:`, `:fastreverse:`, `:fastup:`, `:fbowing:`, `:fear:`, `:fear1:`, `:fear3:`, `:featcat:`, `:ffacepalm:`, `:fidk:`, `:finger:`, `:fire:`, `:fish:`, `:flamingo:`, `:fmage:`, `:fno:`, `:fok:`, `:frown:`, `:frown2:`, `:frown3:`, `:frown4:`, `:frown5:`, `:frown6:`, `:gemini:`, `:giraffe:`, `:halo:`, `:hamburger:`, `:handshake:`, `:hashtag:`, `:heart:`, `:heart1:`, `:heart2:`, `:heart3:`, `:heart4:`, `:heart5:`, `:heart6:`, `:hehe:`, `:hot:`, `:hourglass:`, `:hourglass1:`, `:hug:`, `:ice:`, `:ill:`, `:inlove:`, `:inlove1:`, `:inlovecat:`, `:jackolantern:`, `:kebab:`, `:kiss:`, `:kiss1:`, `:kiss2:`, `:kiss3:`, `:lasttrack:`, `:laugh:`, `:laugh2:`, `:laugh3:`, `:laugh4:`, `:laughcat:`, `:left:`, `:leftcurve:`, `:leo:`, `:lion:`, `:lock:`, `:luck:`, `:lying:`, `:m:`, `:mad:`, `:mbowing:`, `:medal:`, `:mfacepalm:`, `:midk:`, `:mmage:`, `:mmh:`, `:mno:`, `:mok:`, `:money:`, `:moneyface:`, `:monkey1:`, `:monkey2:`, `:monkey3:`, `:monocle:`, `:moon:`, `:moon1:`, `:moon2:`, `:moon3:`, `:moon4:`, `:moon5:`, `:nausea:`, `:nerd:`, `:neutral:`, `:nexttrack:`, `:no1:`, `:noexpression:`, `:nomouth:`, `:ok:`, `:ok1:`, `:owl:`, `:pan:`, `:party:`, `:party1:`, `:pause:`, `:peace:`, `:peach:`, `:pencil:`, `:person:`, `:pick:`, `:pig:`, `:pisces:`, `:pizza:`, `:play:`, `:playpause:`, `:please:`, `:poo:`, `:potato:`, `:puke:`, `:punch:`, `:question:`, `:radioactive:`, `:raisedfist:`, `:raisedhand:`, `:record:`, `:redcircle:`, `:reverse:`, `:riceball:`, `:rightarrow:`, `:rightcurve:`, `:robot:`, `:rock:`, `:rolling:`, `:rooster:`, `:sad:`, `:sagittarius:`, `:salad:`, `:salt:`, `:scorpio:`, `:scorpion:`, `:shark:`, `:shh:`, `:shrimp:`, `:sleeping:`, `:sleepy:`, `:small:`, `:smile:`, `:smile2:`, `:smile3:`, `:smile4:`, `:smile5:`, `:smile6:`, `:smilecat:`, `:sneeze:`, `:soccerball:`, `:sparkles:`, `:squid:`, `:star:`, `:starcrescent:`, `:stareyes:`, `:stop:`, `:stopsign:`, `:sun:`, `:sunglasses:`, `:surprised:`, `:sushi:`, `:sweat:`, `:taurus:`, `:think:`, `:think1:`, `:think2:`, `:think3:`, `:think4:`, `:think5:`, `:think6:`, `:tongue:`, `:tree:`, `:trex:`, `:turkey:`, `:twofingers:`, `:unamused:`, `:unicorn:`, `:unlock:`, `:up:`, `:upsidedown:`, `:virgo:`, `:voltage:`, `:warning:`, `:wc:`, `:what:`, `:wink:`, `:woozy:`, `:write:`, `:xd:`, `:yawn:`, `:yinyang:`, `:yum:`, `:zebra:`, `:zip:`

**`mcemojis` - 275 triggers** (`plugins/ItemsAdder/contents/mcemojis/configs/*.yml`)

`:mc_acacia_boat:`, `:mc_acacia_door:`, `:mc_acacia_sign:`, `:mc_apple:`, `:mc_armor_stand:`, `:mc_arrow:`, `:mc_baked_potato:`, `:mc_bamboo:`, `:mc_barrier:`, `:mc_beef:`, `:mc_beetroot:`, `:mc_beetroot_seeds:`, `:mc_beetroot_soup:`, `:mc_bell:`, `:mc_birch_boat:`, `:mc_birch_door:`, `:mc_birch_sign:`, `:mc_black_dye:`, `:mc_blaze_powder:`, `:mc_blaze_rod:`, `:mc_blue_dye:`, `:mc_bone:`, `:mc_bone_meal:`, `:mc_book:`, `:mc_bow:`, `:mc_bowl:`, `:mc_bow_pulling_0:`, `:mc_bow_pulling_1:`, `:mc_bow_pulling_2:`, `:mc_bread:`, `:mc_brewing_stand:`, `:mc_brick:`, `:mc_brown_dye:`, `:mc_bucket:`, `:mc_cake:`, `:mc_campfire:`, `:mc_carrot:`, `:mc_carrot_on_a_stick:`, `:mc_cauldron:`, `:mc_chainmail_boots:`, `:mc_chainmail_chestplate:`, `:mc_chainmail_helmet:`, `:mc_chainmail_leggings:`, `:mc_charcoal:`, `:mc_chest_minecart:`, `:mc_chicken:`, `:mc_chorus_fruit:`, `:mc_clay_ball:`, `:mc_clock:`, `:mc_coal:`, `:mc_cocoa_beans:`, `:mc_cod:`, `:mc_cod_bucket:`, `:mc_command_block_minecart:`, `:mc_comparator:`, `:mc_compass:`, `:mc_cooked_beef:`, `:mc_cooked_chicken:`, `:mc_cooked_cod:`, `:mc_cooked_mutton:`, `:mc_cooked_porkchop:`, `:mc_cooked_rabbit:`, `:mc_cooked_salmon:`, `:mc_cookie:`, `:mc_creeper_banner_pattern:`, `:mc_crossbow_arrow:`, `:mc_crossbow_firework:`, `:mc_crossbow_pulling_0:`, `:mc_crossbow_pulling_1:`, `:mc_crossbow_pulling_2:`, `:mc_crossbow_standby:`, `:mc_cyan_dye:`, `:mc_dark_oak_boat:`, `:mc_dark_oak_door:`, `:mc_dark_oak_sign:`, `:mc_diamond:`, `:mc_diamond_axe:`, `:mc_diamond_boots:`, `:mc_diamond_chestplate:`, `:mc_diamond_helmet:`, `:mc_diamond_hoe:`, `:mc_diamond_horse_armor:`, `:mc_diamond_leggings:`, `:mc_diamond_pickaxe:`, `:mc_diamond_shovel:`, `:mc_diamond_sword:`, `:mc_dragon_breath:`, `:mc_dried_kelp:`, `:mc_egg:`, `:mc_elytra:`, `:mc_emerald:`, `:mc_enchanted_book:`, `:mc_ender_eye:`, `:mc_ender_pearl:`, `:mc_end_crystal:`, `:mc_experience_bottle:`, `:mc_feather:`, `:mc_fermented_spider_eye:`, `:mc_filled_map:`, `:mc_filled_map_markings:`, `:mc_firework_rocket:`, `:mc_firework_star:`, `:mc_firework_star_overlay:`, `:mc_fire_charge:`, `:mc_fishing_rod:`, `:mc_fishing_rod_cast:`, `:mc_flint:`, `:mc_flint_and_steel:`, `:mc_flower_banner_pattern:`, `:mc_flower_pot:`, `:mc_furnace_minecart:`, `:mc_ghast_tear:`, `:mc_glass_bottle:`, `:mc_glistering_melon_slice:`, `:mc_globe_banner_pattern:`, `:mc_glowstone_dust:`, `:mc_golden_apple:`, `:mc_golden_axe:`, `:mc_golden_boots:`, `:mc_golden_carrot:`, `:mc_golden_chestplate:`, `:mc_golden_helmet:`, `:mc_golden_hoe:`, `:mc_golden_horse_armor:`, `:mc_golden_leggings:`, `:mc_golden_pickaxe:`, `:mc_golden_shovel:`, `:mc_golden_sword:`, `:mc_gold_ingot:`, `:mc_gold_nugget:`, `:mc_gray_dye:`, `:mc_green_dye:`, `:mc_gunpowder:`, `:mc_heart_of_the_sea:`, `:mc_hopper:`, `:mc_hopper_minecart:`, `:mc_ink_sac:`, `:mc_iron_axe:`, `:mc_iron_boots:`, `:mc_iron_chestplate:`, `:mc_iron_door:`, `:mc_iron_helmet:`, `:mc_iron_hoe:`, `:mc_iron_horse_armor:`, `:mc_iron_ingot:`, `:mc_iron_leggings:`, `:mc_iron_nugget:`, `:mc_iron_pickaxe:`, `:mc_iron_shovel:`, `:mc_iron_sword:`, `:mc_item_frame:`, `:mc_jungle_boat:`, `:mc_jungle_door:`, `:mc_jungle_sign:`, `:mc_kelp:`, `:mc_knowledge_book:`, `:mc_lantern:`, `:mc_lapis_lazuli:`, `:mc_lava_bucket:`, `:mc_lead:`, `:mc_leather:`, `:mc_leather_horse_armor:`, `:mc_light_blue_dye:`, `:mc_light_gray_dye:`, `:mc_lime_dye:`, `:mc_lingering_potion:`, `:mc_magenta_dye:`, `:mc_magma_cream:`, `:mc_map:`, `:mc_melon_seeds:`, `:mc_melon_slice:`, `:mc_milk_bucket:`, `:mc_minecart:`, `:mc_mojang_banner_pattern:`, `:mc_mushroom_stew:`, `:mc_music_disc_11:`, `:mc_music_disc_13:`, `:mc_music_disc_blocks:`, `:mc_music_disc_cat:`, `:mc_music_disc_chirp:`, `:mc_music_disc_far:`, `:mc_music_disc_mall:`, `:mc_music_disc_mellohi:`, `:mc_music_disc_stal:`, `:mc_music_disc_strad:`, `:mc_music_disc_wait:`, `:mc_music_disc_ward:`, `:mc_mutton:`, `:mc_name_tag:`, `:mc_nautilus_shell:`, `:mc_nether_brick:`, `:mc_nether_star:`, `:mc_nether_wart:`, `:mc_oak_boat:`, `:mc_oak_door:`, `:mc_oak_sign:`, `:mc_orange_dye:`, `:mc_painting:`, `:mc_paper:`, `:mc_phantom_membrane:`, `:mc_pink_dye:`, `:mc_poisonous_potato:`, `:mc_popped_chorus_fruit:`, `:mc_porkchop:`, `:mc_potato:`, `:mc_potion:`, `:mc_potion_overlay:`, `:mc_prismarine_crystals:`, `:mc_prismarine_shard:`, `:mc_pufferfish:`, `:mc_pufferfish_bucket:`, `:mc_pumpkin_pie:`, `:mc_pumpkin_seeds:`, `:mc_purple_dye:`, `:mc_quartz:`, `:mc_rabbit:`, `:mc_rabbit_foot:`, `:mc_rabbit_hide:`, `:mc_rabbit_stew:`, `:mc_redstone:`, `:mc_red_dye:`, `:mc_repeater:`, `:mc_rotten_flesh:`, `:mc_ruby:`, `:mc_saddle:`, `:mc_salmon:`, `:mc_salmon_bucket:`, `:mc_seagrass:`, `:mc_sea_pickle:`, `:mc_shears:`, `:mc_shulker_shell:`, `:mc_skull_banner_pattern:`, `:mc_slime_ball:`, `:mc_snowball:`, `:mc_spawn_egg:`, `:mc_spawn_egg_overlay:`, `:mc_spectral_arrow:`, `:mc_spider_eye:`, `:mc_splash_potion:`, `:mc_spruce_boat:`, `:mc_spruce_door:`, `:mc_spruce_sign:`, `:mc_stick:`, `:mc_stone_axe:`, `:mc_stone_hoe:`, `:mc_stone_pickaxe:`, `:mc_stone_shovel:`, `:mc_stone_sword:`, `:mc_string:`, `:mc_structure_void:`, `:mc_sugar:`, `:mc_sugar_cane:`, `:mc_suspicious_stew:`, `:mc_sweet_berries:`, `:mc_tipped_arrow_base:`, `:mc_tipped_arrow_helmet:`, `:mc_tnt_minecart:`, `:mc_totem_of_undying:`, `:mc_trident:`, `:mc_tropical_fish:`, `:mc_tropical_fish_bucket:`, `:mc_turtle_egg:`, `:mc_turtle_helmet:`, `:mc_water_bucket:`, `:mc_wheat:`, `:mc_wheat_seeds:`, `:mc_white_dye:`, `:mc_wooden_axe:`, `:mc_wooden_hoe:`, `:mc_wooden_pickaxe:`, `:mc_wooden_shovel:`, `:mc_wooden_sword:`, `:mc_writable_book:`, `:mc_written_book:`, `:mc_yellow_dye:`

**Non-typeable font images** (GUI/HUD only, listed for completeness):

- `_iainternal` (27): `no_recipe`, `crafting`, `cooking`, `blank_menu`, `anvil_repair`, `smithing`, and `small_cooldown_bar_0` through `small_cooldown_bar_20`
- `iaalchemy` (11): `energy_extractor_left`, `energy_extractor_right`, `energy_converter_left`, `energy_converter_right`, `alchemy_category`, `mana_bar_0`..`mana_bar_5`
- `iasurvival` (5): `customization_table_left`, `customization_table_right`, `thirst_bar_positive`, `thirst_bar_negative`, `thirst_bar_half`
- `playbox_custom_crops` (3): `grade_1star`, `grade_2star`, `grade_3star`



### Player command table — ItemsAdder

`ItemsAdder_4.0.17.jar` → `plugin.yml` declares **31 commands, and every single one carries a `permission:` node**. The `permissions:` block of that same `plugin.yml` declares defaults for only five nodes:

| Node | Declared default |
|---|---|
| `ia.user.hud.show.*` | **`true`** |
| `ia.user.hud.bypass.triggers.*` | `false` |
| `ia.user.hud.bypass.commands.*` | `false` |
| `ia.user.hud.bypass.api.*` | `false` |
| `ia.admin.iaconfig.*`, `ia.user.ia.categories`, `ia.user.ia.categories.others`, `ia.admin.iacolor.others` | *(no `default:` key — Bukkit falls back to op)* |

**No command permission is declared with a default at all.** Bukkit's fallback for an undeclared permission is `OP`, so **strictly per `plugin.yml` there are zero ItemsAdder commands a normal player can run, and zero permission nodes with `default: true` that map to a command.** The only `default: true` node on the whole plugin is `ia.user.hud.show.*`, which is not a command — it just lets everyone see HUDs.

What players actually get therefore depends entirely on LuckPerms grants. Reading the LuckPerms action log inside `plugins/LuckPerms/luckperms-h2-v2.mv.db` turns up exactly three ItemsAdder grants, none of them to `default`:

| Node | Granted to group | Source |
|---|---|---|
| `ia.*` | `moderator` | LuckPerms action log |
| `ia.admin` | `lore` | LuckPerms action log |
| `ia.user.image.use.*` | `donator`, `qa`, `lore` (each replacing an older `tfmc.emojis` node) | LuckPerms action log |

#### Commands in the `ia.user.*` tier (player-tier, but still not default-true)

These are the commands ItemsAdder itself classifies as user commands. On this server each still needs an explicit grant.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/ia [category] [player]` | — | **Opens the item catalogue GUI**, or jumps straight to one category | `ia.user.ia` (no declared default → op). Sub-nodes: `ia.user.ia.categories`, `ia.user.ia.categories.others`, `ia.user.ia.search`, `ia.user.ia.seeitem.<category>`. GUI layout in `plugins/ItemsAdder/ia_gui.yml`. **This is the player-facing browsing command — there is no `/iainv`.** |
| `/iaimage` | `/iaemoji`, `/emoji`, `/e` | Opens the **"&3&lEmoji List"** GUI of all font images with `show_in_gui: true`; `/e <text>` sends a chat message or command with emoji names auto-replaced | `ia.user.image.gui` (no declared default → op) |
| `/iarecipe [item] [player]` | `/iaguide` | Shows the recipe GUI for an item | `ia.user.iarecipe` (→ op). `ia.user.iarecipe.others` for viewing on behalf of someone else |
| `/iatexture [all\|player]` | `/iapack` | Forces the client to re-download/re-apply the resource pack | `ia.user.iatexture` (→ op); `ia.user.iatexture.all` for everyone. Rate-limited to once per **60 s** (`config.yml` → `resource-pack.command.usage-cooldown-seconds: 60`) |
| `/iaemote <emote\|stop\|stop-now> [player]` | `/emote` | Plays a custom player animation | `ia.user.iaemote` (→ op); `ia.user.iaemote.use.<emote>`, `ia.user.iaemote.others`. **No `emotes:` are defined in any content file on this server**, so there is nothing to play |
| `/iasha1 <local\|online>` | — | Prints the SHA-1 of the resource pack | `ia.user.iasha1` (→ op). Diagnostic |
| `/iadisguise <entityId>` | — | Disguise as a custom entity | `ia.user.disguise` (→ op). **No custom entities are defined on this server** |
| `/iaundisguise` | — | Remove the disguise | `ia.user.disguise` (→ op) |
| `/crops` | — | Toggles rendering of CustomCrops-style crop models for you | `ia.user.crops` (→ op); `ia.admin.crops.others` to toggle for someone else. Relevant because `playbox_custom_crops` defines 170 crop furniture models and `config.yml` → `crops` caps rendering at 1 400 models within 32 blocks |

Other `ia.user.*` nodes exist that are not commands but gate ordinary play (all extracted from the jar, none declared `default: true`): `ia.user.block.place.<id>` / `ia.user.block.break.<id>`, `ia.user.furniture.place.<suffix>` / `ia.user.furniture.break.<suffix>`, `ia.user.complex_furniture.place.<suffix>` / `.break.<suffix>`, `ia.user.craft.<id>`, `ia.user.recipe.<id>`, `ia.user.iacraft`, `ia.user.iasearchgui`, `ia.user.image.{chat,sign,book,anvil,command,hints}`, `ia.user.text_effect.{chat,sign,book,anvil,command,use.<id>}`.

> Since these permissions are op-default and `ia.*` is only granted to `moderator`, either the server grants them through a LuckPerms group not captured in the action log, or normal players can only place/break ItemsAdder blocks and furniture because the plugin does not enforce these nodes unless configured. **Not verified — see Uncertain.** The one place a suffix *is* configured is `dead_pack` (`ia.user.furniture.break.dead_pack.swamp` / `.necro_seithr`).

#### Admin / staff commands (excluded from the player table)

All of these use an `ia.admin.*` node with no declared default, i.e. op-only unless granted.

| Command | Aliases | Permission | What it does |
|---|---|---|---|
| `/iaget <item> [amount]` | — | `ia.admin.iaget` | Give yourself a custom item |
| `/iagive <player> <item> [amount] [silent]` | — | `ia.admin.iagive` | Give a custom item to a player |
| `/iadrop <item> <player\|x y z world> [amount]` | — | `ia.admin.iadrop` | Drop a custom item in the world |
| `/iaremove <player> <item> [amount] [silent]` | — | `ia.admin.iaremove` | Remove a custom item from an inventory |
| `/iatag` | — | `ia.admin.iatag` | Show the held item's debug NBT (`ia.admin.iatag.show-in-console` too) |
| `/iacustommodeldata` | — | `ia.admin.custommodeldata` | Show the held item's CustomModelData |
| `/iaplayerstat <read\|write\|increment\|decrement> <player> <attr> [value]` | — | `ia.admin.iaplayerstat` (`.read` / `.write`) | Set a HUD-backing player stat |
| `/iarepair` | — | `ia.admin.iarepair` | Repair held item |
| `/iarename <name>` | — | `ia.admin.iarename` | Rename held item (supports emojis and text effects) |
| `/iadurability` | `/iadur` | `ia.admin.iadurability` | Modify held item durability |
| `/iareload` | — | `ia.admin.iareload` | Reload configs |
| `/iazip [--uncompressed]` | `/iaz` | `ia.admin.iazip` | Reload + rebuild the resource-pack zip |
| `/iablock` | — | `ia.admin.iablock` | Info about the block you look at |
| `/ialiquid [x y z]` | — | `ia.admin.ialiquid` | Info about a custom liquid |
| `/iahud [name]` | — | `ia.admin.iahud` | Force show/hide a HUD |
| `/iainfo` | — | `ia.admin.iainfo` | Plugin info |
| `/iaspawntree <namespace>` | — | `ia.admin.iaspawntree` | Spawn a custom tree |
| `/iaplaytotemanimation <totem> <player> [silent]` | `/totemanimation` | `ia.admin.iatotemanimation` | Play a totem animation |
| `/iaplaysound <sound> <player> [vol] [pitch]` | `/playcustomsound` | `ia.admin.iaplaysound` | Play an ItemsAdder sound |
| `/iacleancache <items\|blocks>` | — | `ia.admin.iacleancache` | Free unused IDs from the caches |
| `/iahitbox` | — | `ia.admin.iahitbox` | Visualise furniture hitboxes |
| `/iaconfig` | — | `ia.admin.iaconfig` (+ `.item.delete`, `.item.disable`, `.recipes.deleteofitem`, `.recipes.disableofitem`, `.namespace.delete`, `.namespace.disable`) | Destructive config editing |
| `/iaentity` | — | `ia.admin.iaentity` | Manage custom entities |
| `/iacolor` | — | `ia.admin.iacolor` (`.others`) | Colour the held item |
| `/iaitem` | — | `ia.admin.iaitem` | Manage custom items |
| `/iadebug` | — | `ia.admin.iadebug` | Developer debug actions |

**Can players browse the catalogue themselves?** Yes in principle — `/ia` opens a paginated category GUI built from the `categories:` blocks scattered through the content packs — **49 category definitions, 42 distinct names**: `alchemy`, `armors`, `axes`, `blocks`, `bows`, `christmas`, `customfishing`, `dead_pack`, `eatables`, `fishes`, `fishing_rods`, `french_medieval_furniture_v1`, `funeral_furniture_v1`, `generic_items`, `graffiti_decoration_v1`, `halloween`, `hats`, `hoes`, `icons`, `machines`, `minerals`, `ores`, `pickaxes`, `playbox_custom_crops`, `potions`, `seeds`, `shears`, `shields`, `shovels`, `swords`, `tfmc`, `tfmc_armor`, `tfmc_blocks`, `tfmc_cooking`, `tfmc_games`, `tfmc_magic_artifacts`, `thirst`, `torture_machine_decoration_v1`, `urban_city_decoration_v1`, `various`, `vegetables`, `wearables`. Sorted alphabetically in the GUI (`ia_gui.yml` → `settings.categories_view.order.alphabetical: true`). **There is no `/iainv`.** But `ia.user.ia` is not default-true and no LuckPerms grant of it to `default` was found, so on this server the catalogue GUI is realistically staff-only.

### Cross-links — ItemsAdder

ItemsAdder is the texture/ID backbone that at least fourteen other plugins depend on. Every link below is a literal reference found in that plugin's own config:

| Plugin | Namespace(s) consumed | Evidence |
|---|---|---|
| **Cooking** | `tfmc_cooking`, `tfmc` | `plugins/Cooking/config.yml` (`butter: ia.tfmc_cooking:butter`), `crafting-stations.yml` (`tool: ia.tfmc_cooking:cutting_knife`), `conversions.yml`, `baking-trays.yml`, `models.yml` |
| **DrinkBuilder** | `tfmc_cooking` | `plugins/DrinkBuilder/ingredients.yml`, `config.yml` |
| **Magic** | `tfmc_magic` | `plugins/Magic/artifacts/model-schemes.yml` (`orb(ia.tfmc_magic:oseni_orb_0) all`) |
| **Games** | `tfmc_games`, `tfmc` | `plugins/Games/cards.yml` (`item: ia.tfmc_games:cerrith_1`), `games.yml`, `config.yml` |
| **ArmourShop** | `tfmc_armor`, `tfmc_armorshop`, `tfmc_submissions` | `plugins/ArmourShop/Categories/a_default.yml` (`helmet: ia.tfmc_armor:mage_steel_helmet`), `a_forest.yml`, `a_hraftar.yml`, `a_imperial.yml`, `i_daggers.yml`, `ps_items.yml` |
| **AdvancedCrafting** | `tfmc_armor`, `tfmc` | `plugins/AdvancedCrafting/model-schemes/basic.yml` (`helmet(ia.tfmc_armor:iron_mage_helmet)`), `stats.yml`, `config.yml` |
| **CustomFishing** | `customfishing` | `plugins/CustomFishing/config.yml` (`font: "customfishing:offset_chars"`), `commands.yml`, `contents/minigame/tfmc_{easy,normal,hard}.yml` |
| **CustomCrops** | `playbox_custom_crops` | `plugins/CustomCrops/contents/crops/*.yml` (`seed: playbox_custom_crops:apple_seeds`, `model: playbox_custom_crops:apple_stage_1`), `contents/watering-cans/default.yml` |
| **Woodworking** | `lzfurniture` | `plugins/Woodworking/projects/cozy.yml` (`item: ia.lzfurniture:cozy_armchair`), `marauder.yml`, `market.yml`, `royal.yml`, `categories.yml` |
| **MMOItems** | `tfmc` (stations) | `plugins/MMOItems/crafting-stations/{archeology,block,ingot,meal-prep,tool}-station.yml` — the stations a player clicks are `tfmc` furniture |
| **Research** | `tfmc_blocks`, `tfmc_games`, `lzfurniture`, `mcicons` | `plugins/Research/aspects/elements.yml`, `plugins/Research/gui.yml` |
| **Thievery** | `tfmc_blocks` | `plugins/Thievery/categories.yml` |
| **Recycler** | `mcicons` | `plugins/Recycler/gui.yml` |
| **Infestations** | `parasitic_worm`, `tfmc` | `plugins/Infestations/groups.yml`, `config.yml` |
| **InteractibleFurniture** | `tfmc`, `tfmc_cooking` | `plugins/InteractibleFurniture/furniture/cooking.yml`, `shelf.yml`, `magic.yml` |
| **GunsAndGadgets** | `tfmc` + `gunsandgadets` assets | `plugins/GunsAndGadgets/config.yml` |
| **VehicleFramework** | `vehicleframework` assets | `plugins/VehicleFramework/config.yml` |
| **Dowsing** | `tfmc`, `iasurvival` | `plugins/Dowsing/blocks.yml`, `production_methods.yml` |
| **BirdMessenger**, **MarketBlock** | `iasurvival` | `plugins/BirdMessenger/config.yml`, `pending_mail.yml`, `plugins/MarketBlock/trades/tobacco.json` |
| **TFMCCore** | `tfmc` | `plugins/TFMCCore/animal-whistle-config.yml`, `letters-config.yml`, `lorestones-config.yml` |
| **Archaeo** | ItemsAdder API | `plugins/Archaeo/config.yml` |
| **RPCharacters** | `tfmc_submissions` | `plugins/RPCharacters/data/characterdata/**.json` |
| **ModelEngine** | resource pack merge | `config.yml` → `resource-pack.zip.merge_other_plugins_resourcepacks_folders: [ModelEngine/resource pack]`; `dead_pack` and `parasitic_worm` textures appear under `plugins/ModelEngine/resource pack/assets/` |

**Relationship to the rest of the RPG stack (sections 1–3):**
- **MMOItems** — `plugin.yml` lists MMOItems in ItemsAdder's `softdepend`. MMOItems crafting stations are ItemsAdder `tfmc` furniture; MMOItems items that use ItemsAdder textures reference them via the MMOItems material system.
- **MMOInventory** — its own resource pack is disabled (`resource-pack.enabled: false` in `plugins/MMOInventory/config.yml`), so its Ring/Amulet/Artifact slot icons rely on legacy DIAMOND_HOE CustomModelData values that must come from `tfmc_pack`. `items_ids_cache.yml` confirms ItemsAdder assigns `DIAMOND_HOE` CustomModelData values, but whether IDs 5/8/10 in particular are ItemsAdder-owned is **unverified** (ItemsAdder's own numbering starts at `CustomModelData-starting-value.ALL: 10000`, so 5/8/10 are *outside* ItemsAdder's range and are probably hand-made pack entries).
- **MMOCore** — no direct reference found in either direction.
- **Oraxen** — MMOItems declares `loadbefore: [Oraxen]` but Oraxen is not installed; ItemsAdder is the only custom-item texture system on this server.

### Uncertain / unverified — ItemsAdder

1. **How the resource pack is actually sent to players.** `resource-pack.auto_apply.enabled: false`, so ItemsAdder does not push it on join, yet `self-host` is enabled on port 9900. The send must come from `server.properties` (`resource-pack` / `resource-pack-sha1` / `require-resource-pack`) or a proxy. The server root directory was not part of the inspected files — only `plugins/`. To confirm: read `server.properties`, or the proxy's config.
2. **Whether declining really has no consequence.** `kick-player-on-decline: false` is ItemsAdder's own setting; if `require-resource-pack=true` is set in `server.properties`, vanilla would kick regardless. Same missing file.
3. **Live LuckPerms permission state.** Grants were read out of the *action log* inside the H2 database (`ia.*` → `moderator`, `ia.admin` → `lore`, `ia.user.image.use.*` → `donator`/`qa`/`lore`). The current effective node set could not be dumped from the binary H2 file. To confirm: `/lp group default permission info` or an SQL dump of the `luckperms_group_permissions` table.
4. **Whether normal players can place/break ItemsAdder blocks and furniture at all.** `ia.user.block.place.*`, `ia.user.furniture.place.*` etc. are op-default in `plugin.yml`; no grant to `default` was found. Either ItemsAdder only enforces these when a `permission_suffix` is set (only `dead_pack` sets one on this server) or the server grants them elsewhere. To confirm: test in game, or inspect the effective `default` group.
5. **Emoji trigger delimiter.** `:name:` is taken from the regex `:([a-z_\-0-9]+):` extracted from the jar's bytecode strings, not from a config file. Behaviour under a modified `font_images` config was not tested.
6. **128 `tfmc_armor` entries have no `display_name` at all** (every entry in `configs/medieval_armor.yml`), and **52 of the 64 `customfishing` items** likewise. Those items will show their base material name unless the consuming plugin (ArmourShop / CustomFishing) renames them. Not verified in game.
7. **`playbox_custom_crops` produce ships placeholder names** — `display_name: '&fBanana (Place grade_1star Unicode Here)'` and 60+ similar. Whether CustomCrops overrides the name before a player sees it was not verified.
8. **`tfmc_magic`'s 98 items all have `display_name` equal to their id** (`arcanum_orb_3`, `oseni_gem_162`, …). Presumed to be renamed by the Magic plugin at runtime; not verified.
9. **Owner of the decoration namespaces `elitecreatures` (118 furniture) and `dead_pack` (49 furniture + 1 item).** No plugin config references them; they appear to be builder-only decoration. A grep across `plugins/` found no consumer.
10. **`rpg_pet_pack_vol6_brawlers` and `skeleton_pack`** contain only models/sounds; which plugin renders them (ModelEngine, MCPets or MythicMobs) was not determined.
11. **`tfmc_drinks` and `tfmc_drinks_dev` are empty** (`items: {}`). Whether drinks moved to BreweryX/DrinkBuilder entirely, or this is abandoned work, is unknown.
12. **Stale cache namespaces** (`cleric`, `tfmc_samurai`, `tfmc_steampunk_hats`, `arctic_knight`, `rrpg_void_edge_class`, `amethyst`, `customcrops`, `tfmc_pack`) hold 133 reserved CustomModelData IDs with no content folder. Whether any player still holds one of those items (which would now render as a missing model) is unknown; `/iacleancache` has evidently not been run.
13. **Resource-pack contents could not be inspected.** `plugins/ItemsAdder/output/generated.zip` is deliberately corrupted against extraction (`zip.protect-file-from-unzip.protection_1/2/3: true`) — every entry reports a fake 1337-byte size. Claims about what the pack contains are therefore based on the source `contents/*/resourcepack/` folders, not the shipped zip.
14. **No custom entities, emotes, liquids, trees or world populators from ItemsAdder are in use** beyond the vendor packs' unused definitions — but `entities.custom_entities.enabled: true` and `liquids.enabled: true` are switched on in config, so dead config is possible rather than certain.

15. **40 unresolved dictionary keys.** 338 items use `display-name-…` dictionary placeholders; 298 resolve from the owning pack's `configs/_dictionaries/en.yml` (369 English entries across all packs). The remaining 40 have no English entry and would render the raw key in-game.
16. **One malformed furniture entry.** `dead_pack:killing_pike_2` (`plugins/ItemsAdder/contents/tfmc_dead_pack/configs/base.yml`) has its furniture keys at the wrong indentation — `fixed_rotation`, `hitbox`, `placeable_on` and `solid` sit as siblings of `behaviours` rather than inside `behaviours.furniture`. It is therefore counted as a plain item rather than furniture above, and may not place correctly in game.
17. **`_common` namespace.** One `_iainternal` file declares `info.namespace: _common`; it contributes no items, blocks or glyphs. Harmless, recorded for completeness.

### Recipes and unlocks

From `plugins/ItemsAdder/config.yml` → `recipes`: crafting, cooking, anvil and smithing custom recipes are all **enabled**; custom recipes **unlock automatically** (`custom-recipes.unlock.automatically: true`) and **every recipe is unlocked on join** (`all-on-join: true`), so the vanilla recipe book shows them from the start. No vanilla recipes are removed (`remove-vanilla-recipes.enabled: false`). A no-permission popup appears inside the recipe book (`show-no-permission-popup-in-recipebook: true`) but no chat message is sent (`show-no-permission-chat-message: false`). The matching message if you try to craft something you lack the node for is "You don't have permission to craft this item!" (`plugins/ItemsAdder/lang/en.yml` → `no-craft-permission`).

Only **2 recipe sets** are defined inside ItemsAdder content itself (`contents/ia_tfmc/contents/advanced-crafting.yml` and one in `contents/iawearables/`). Essentially all real crafting on this server is handled by **MMOItems crafting stations**, **AdvancedCrafting**, **Cooking** and **Woodworking** instead — see their own sections.

### Custom blocks and furniture — where to find them

The full per-ID tables for the **128 custom blocks** and **478 furniture pieces** are in the "Custom blocks" and "Furniture" subsections above, between the item catalogue and the emoji section. Blocks are listed with hardness, emitted light level and required break tool; furniture is grouped by source folder and flags the 27 sittable pieces and 2 trade-machine pieces.

---
