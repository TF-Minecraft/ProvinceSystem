# Dossier: Magic, Research, Codex

Factual research dossier for the player wiki. Sources are the live server plugin data
folders under `C:\Users\MSI\Desktop\plugins\` (read-only), the deployed jar manifests,
MMOItems/MMOCore/ItemsAdder configs, and the resource pack.

Nothing in this file is guide prose. Every non-obvious claim cites a file path.

Source code: [TF-Minecraft/Magic](https://github.com/TF-Minecraft/Magic) and
[TF-Minecraft/Research](https://github.com/TF-Minecraft/Research).
`C:\Users\MSI\Desktop\plugin-src\advancedresearch` is a
*different, unrelated* plugin (`net.tfminecraft.advancedresearch`, archived as
TF-Minecraft/AdvancedResearch), **not** the deployed
`Research` plugin (`net.tfminecraft.research.Research`). All Magic and Research facts
below are derived from live config + data files and the jar `plugin.yml`.

---

# 1. MAGIC

Deployed jar: `C:\Users\MSI\Desktop\plugins\magic-0.1.0.jar`
Data folder: `C:\Users\MSI\Desktop\plugins\Magic\`
`plugin.yml`: `name: Magic`, `version: 0.1.0`, author Drefvelin,
`depend: [TLibs, ItemsAdder, TFMCCore, InteractibleFurniture]`,
`softdepend: [RPCharacters, MMOItems, MythicLib, MMOCore]`.

## 1.1 What it is

Magic is the server's mage progression system: you build your own staff, wand or blade
out of parts, slot spell runes into it, and then "attune" it to one of ten magical
elements by charging it with aura you have gathered from shrines and artifacts — and
your character carries a personal **Resonance** score per element that decides whether a
weapon will even fire for you.

## 1.2 The four moving parts (what the player actually tracks)

| Concept | Where it lives | What it means |
|---|---|---|
| **Resonance** (per element, 0-100) | on your *character* | How attuned you personally are to an element. Gates whether a weapon accepts a charge, and scales mana/damage/cooldown. |
| **Equilibrium** (-100 .. +100) | on your *character* | Corruption (negative) vs Tranquility (positive). Moves when you cast. |
| **Cast mode** (Surge / Flow) | on your *character* | Which direction casting pushes your Equilibrium. |
| **Aura** (per element) | on *artifacts* and *charges* | A physical resource stored in items, gathered from shrines, spent to attune weapons. |

Source: `Magic/config.yml`, `Magic/gui.yml`, `Magic/charges.yml`.
Per-character storage: `Magic/data/characters/<characterId>.json`, e.g.
`{"characterId":"...","ownerUuid":"...","castMode":"flow","equilibrium":0.0,"resonance":{}}`.
Note the key is a **character** id, not a player UUID — Magic is per-RP-character
(RPCharacters integration; `open.no_character: "You need an active character to view resonance."`
in `Magic/messages.yml`).

## 1.3 How a player actually uses it — step by step

### Step 0 — Be a Mage
`MMOCore/classes/mage.yml` — class `<#ff55ff>&lMage`, "Mages command the forces of magic,
casting spells via runes." Allowed gear listed in that file: Mage Staffs, Mage Wands,
Mage Blades, Mage Armor; it also warns "Mages are expensive to gear!". The weapon
templates carry `MMOITEMS_REQUIRED_CLASS:"Mage"` (seen in the serialised station item in
`Magic/data/gear-stations.yml`).

### Step 1 — Open your Resonance screen
Run **`/resonance`** (alias `/res`). A GUI titled `Resonance` opens
(`Magic/gui.yml: title`). Layout (`Magic/gui.yml` + `Magic/elements/elements.yml`):

- Slot 4: your character head, showing Resonance bar, Equilibrium bar and Mental points.
- Slot 12: **Surge** (`v.BLAZE_POWDER`, lore "Power now. Corruption later.")
- Slot 14: **Flow** (`v.AMETHYST_SHARD`, lore "Slow start. Stronger at depth.")
- The ten element icons at fixed slots — see the element table below.

Selected mode is shown with a lime pane, unselected with a gray pane.
Default cast mode is `flow` (`config.yml: default_cast_mode`).

### Step 2 — Build the weapon at a Magic Station
The station is the ItemsAdder furniture **"Magic Station"**, id `tfmc:magic_crafting_station`
(`Magic/config.yml: gear.station: iaf(tfmc:magic_crafting_station)`;
display name from `ItemsAdder/contents/ia_tfmc/contents/base.yml:405`).

It is **craftable by players** — vanilla-style 3x3 recipe
(`ItemsAdder/contents/ia_tfmc/contents/base.yml:103`):

```
B B B      B = BLACKSTONE
B A B      A = GOLD_INGOT
B C B      C = AMETHYST_SHARD
```

Interacting with the station opens the assembly GUI. Part slots
(`Magic/gear/part-types.yml`):

| Slot | Part type |
|---|---|
| 10 | Core |
| 11 | Handle |
| 12 | Tome |
| 13 | Tome2 |
| 14 | Tome3 |

Output slot is **16**; you have **5 seconds** to confirm
(`Magic/config.yml: gear.output-slot: 16`, `gear.confirm_seconds: 5`).

Archetypes (`Magic/gear/archetypes.yml`):

| Archetype | Display | MMOItems template | Melee | Required parts |
|---|---|---|---|---|
| `staff` | Staff ("Mage Staff") | `m.mage_staffs.mage_custom_staff` | no | core, handle, tome, tome2, tome3 |
| `wand` | Wand | `m.mage_wands.mage_custom_wand` | no | core, handle, tome |
| `sword` | Sword ("Mage Blade") | `m.mage_swords.mage_custom_sword` | **yes** | core, handle, tome |

A finished weapon can hold at most **4 empty sockets**; extras are dropped at craft
(comment at top of `Magic/gear/parts.yml`).

Station messages: `"This station already holds a weapon"`, `"There is nothing on this
station"`, `"You lack the materials for those parts."`, `"That combination cannot be
prepared."`, `"The weapon rests on the station"` (`Magic/messages.yml: gear.*`).

### Step 3 — Slot runes (this is where spells come from)
Each part contributes socket(s) of a named tier. The socket colour string is
`<prefix> <suffix>`: prefix from your resonance band
(`Magic/gear/socket-colours.yml`: 1=Common, 2=Rare, 3=Epic, 4=Legendary, default Common),
suffix from the archetype (`Minor Rune` / `Lesser Rune` / `Greater Rune` /
`Ascedant Rune` — note the typo `Ascedant` is what is actually written to items in
`archetypes.yml`, while `socket-colours.yml` labels say `Ascendant Rune`).

Real example from a live station item (`Magic/data/gear-stations.yml`, station `1`):
lore line `◆ Empty Common Minor Rune Gem Socket`, NBT
`"magic:gear_parts":"iron_staff_core:1,oak_handle:1,normal_oak_tome:1,normal_oak_tome2:1,normal_oak_tome3:1"`.

Runes are **MMOItems gemstones** (`MMOItems/item/cerrith_runes.yml`,
`oseni_runes.yml`, `seithr_runes.yml`) and each one carries the ability that becomes the
spell. Full list in §1.6.

### Step 4 — Gather aura: shrines, meditation, artifacts
- Place an **Artifact** on a **Pedestal** (`ia.tfmc:pedestal`, InteractibleFurniture id
  `pedestal`, config `InteractibleFurniture/furniture/magic.yml`).
- The plugin scans a **9x9x9 cube** (Chebyshev radius 4, centre skipped) around the
  pedestal and scores the *scenery blocks* per element
  (`Magic/artifacts/shrines.yml: radius: 4`).
- You need at least **2 distinct block families** and a score of **0.15**
  (`min_families: 2`, `min_score: 0.15`). A full charge cycle takes **15 seconds**
  (`full_charge_seconds: 15`). When the artifact is full: `"There is no aura to be
  gathered from this shrine"`.
- Standing at a shrine and **meditating** raises your personal Resonance
  (`Magic/config.yml: meditation`).

### Step 5 — Imprint and fill an Enchanted Charge
A **charge** is a crafting consumable, not an artifact. Placed on a pedestal it is
**imprinted** with every element that shrine scores, then filled from the shrine
(`Magic/charges.yml` header comment; message `charge.imprint.done: "The charge takes on
the shrine's elements"`; failure `"This shrine holds nothing for the charge"`). A weak
shrine cannot fill a high-tier charge — that is the tier gate, stated explicitly in
`charges.yml`.

### Step 6 — Apply the charge at the station: the ORB MINIGAME
Right-clicking a prepared weapon on the station with a charge does **not** write the
attunement straight away — it starts a timed orb-hitting minigame
(`Magic/gear/orbs.yml`).

Chat on start: `"Strike the pale orbs. You need {target}. The rust ones tear the weapon"`
Progress line: `"{hits}/{target} caught  {rift} rift  {seconds}s"`
Completion: `"The weapon settles at {band}, holding {percent}% of the charge"`
Failure: `"The charge scatters. Nothing takes hold."` / `"The weapon is left with {rift}% rift."`
(`Magic/messages.yml: gear.orbs.*`)

- **Pale/blue orbs (good)**: END_ROD particle, dust `[120,220,255]`.
- **Rust/orange orbs (bad)**: SMOKE particle, dust `[220,90,40]`. Hitting one adds **+5
  permanent Rift** to the weapon, capped at 100.
- Missing a good orb costs **8%** of the run (`miss_penalty: 0.08`).
- **The charge is spent up front** — disconnecting ends the run with whatever was captured.
- Difficulty keys off the charge **item tier (1-4)**, not the displayed resonance band.
  A *low* tier charge is the forgiving game.
- If your resonance is below what the charge demands you get a warning first:
  `"This charge is beyond your resonance:"` + `"{element}: need {need}, you have {have}"`
  + `"Right-click again to commit anyway"` (`messages.yml: gear.charge.*`).

### Step 7 — Cast
Hold the weapon, right-click to fire the rune's ability. Three ways it can fail
(`Magic/messages.yml: cast`):

| Outcome | Title | Subtitle | Costs you |
|---|---|---|---|
| **Whiff** | `*Whiff*` | `Rift {rift}%` (or `Too many staffs`) | Mana **and** cooldown already spent |
| **Refused** | `*Refused*` | `This weapon is beyond you` / `This weapon holds no {element}` | **Nothing** |
| **Damaged** | `*Damaged*` | `This weapon will not answer` | Weapon needs rune reclaim at an empty station |

Refusal chat is throttled to **once per 30 s** per player/weapon/element
(`config.yml: cast.refuse_chat_seconds: 30`). Refusal chat reads
`"The weapon asks for {element} {need}. You carry {have}."` or, for a foreign element,
`"This weapon was never attuned to {element}. Apply a {element} charge at a station."`

### Step 8 — Repair / reclaim
If a config revision leaves a weapon holding runes it can no longer seat, it is
**Damaged**. Right-click an **empty station** to reclaim its runes
(`messages.yml: cast.broken_chat`, `gear.reclaim.*`: `"You work {count} loose rune(s)
free of the weapon"`, `"The weapon holds together again"`, or `"The weapon is still
missing parts: {missing}. Ask staff to restore them."`).

## 1.4 The ten elements

`Magic/elements/elements.yml`. Every element uses the same resonance curve:
at 0 Resonance `mana +20%, damage -20%, cooldown +20%`; at 100 Resonance
`mana -20%, damage +20%, cooldown -20%`.

| Element | Display name | Colour | GUI slot | Icon | Notes |
|---|---|---|---|---|---|
| `spirit` | Spirit | `#e8d5a3` | 20 | `v.FEATHER` | |
| `arcanum` | Arcanum | `#aa00aa` | 22 | `v.ENCHANTED_BOOK` | only element with `decay_per_hour: -0.035` |
| `illusion` | Illusion | `#e070b0` | 24 | `v.ENDER_PEARL` | |
| `cerrith` | Cerrith | `#466629` | 28 | `m.cerrith_runes.rune_of_cerrith_glyph` | healing/support |
| `seithr` | Seithr | `#15E5FF` | 30 | `m.seithr_runes.rune_of_cold_embrace` | ice/control |
| `oseni` | Oseni | `#e29a00` | 32 | `m.oseni_runes.rune_of_oseni_glyph` | fire/damage |
| `mitlan` | Mitlan | `#5555ff` | 34 | `v.LAPIS_LAZULI` | water |
| `necromancy` | Necromancy | `#00aaaa` | 38 | `v.WITHER_SKELETON_SKULL` | |
| `shadowmancy` | Shadowmancy | `#555555` | 40 | `v.INK_SAC` | |
| `bloodmagic` | Bloodmagic | `#aa0000` | 42 | `v.REDSTONE` | |

`aura_decay_per_hour: 0` on all ten — **artifact aura never decays.**

## 1.5 Shrine scenery — what to build for each element

`Magic/artifacts/shrines.yml`. Build a pedestal shrine and surround it (9x9x9) with
blocks from at least **2** of the listed families. Each family has a `max_count`
(diminishing returns past that) and a `weight`.

**Important:** the following elements have `scenery_charge: false`, meaning **a shrine
of that element will NOT fill from block ticks** even if you build it perfectly:
`arcanum`, `spirit`, `illusion`, `necromancy`, `shadowmancy`. Only **cerrith, oseni,
seithr, mitlan, bloodmagic** actually charge from scenery.

| Element | Families (max_count, weight) | Block highlights |
|---|---|---|
| cerrith | floor(12,1.0), water(4,1.2), grass(10,1.0), grove(10,1.0), flowers(8,0.9), crops(8,0.9), bushes(6,1.0), moss(8,0.8), **firefly(1, weight 6.0)** | Grass/moss/podzol/rooted dirt; water; short & tall grass, ferns, moss carpet; azalea + leaves/saplings tag; small & tall flowers, spore blossom, pink petals, cave vines, wildflowers, leaf litter; crops tag + sugar cane/pumpkin/melon; sweet berry bush/bush/dead bush; mossy cobblestone & stone bricks. **A single FIREFLY_BUSH carries weight 6.0 — by far the most efficient cerrith block.** |
| oseni | lava(6,1.4), hearth(10,1.1), metal(8,0.9), kiln(10,0.8) | Lava; magma block, netherrack, basalt, smooth basalt, blackstone, campfire, furnace, blast furnace, smoker; copper block, raw copper block, cut copper, coal block/ore/deepslate coal ore; orange & red terracotta (plain and glazed), plain terracotta, nether bricks, red nether bricks. |
| seithr | lava(6,1.2), ice(14,1.2), pale(10,0.9) | Lava (shared with oseni); the `ice` block tag + snow, snow block, powder snow; calcite, quartz block/pillar/smooth quartz, white concrete, white wool. |
| mitlan | water(8,1.3), sea(12,1.0), silt(10,0.9), dead_reef(10,1.1) | Water/bubble column; kelp, seagrass, prismarine family, sea lantern, conduit; mud, muddy mangrove roots, packed mud, clay, wet sponge; all fifteen dead coral blocks/corals/fans. |
| arcanum *(inert)* | study(16,1.1), amethyst(10,1.0), ley(6,1.2) | Bookshelf, chiseled bookshelf, lectern, enchanting table; amethyst block, budding amethyst, all bud sizes, cluster; ender chest, end rod, lodestone, crying obsidian, respawn anchor, brewing stand. |
| spirit *(inert)* | soul_light(8,1.2), soul_ground(6,0.6), cherry(12,0.9), pale_light(8,1.0) | Soul lantern/torch/wall torch/campfire; soul sand & soil; cherry leaves/log/wood/stripped log/sapling, pink petals; sea lantern, all three froglights, quartz pillar. |
| illusion *(inert)* | glass(16,1.0), chorus(10,1.1), glaze(12,0.9), lichen(8,0.7) | Glass, glass pane, tinted glass, white & black stained glass + pane; chorus plant/flower, purpur block/pillar; white, light blue, magenta, pink, purple, cyan glazed terracotta; glow lichen. |
| necromancy *(inert)* | grave(10,1.1), marrow(8,1.2), sculk(8,0.7), web(8,0.8) | Soul sand & soil; bone block, skeleton & wither skeleton skull, wither rose; sculk, catalyst, sensor, shrieker, calibrated sensor; cobweb, deepslate tiles/tile slab/bricks. |
| shadowmancy *(inert)* | heavy(12,1.1), dusk_wood(12,0.9), veil(8,0.6), wart(8,0.8) | Blackstone family, obsidian, crying obsidian; dark oak + mangrove logs/wood/leaves/planks/roots; sculk vein, tinted glass, black candle & candle cake, black wool & concrete; nether wart block, warped wart block, warped nylium. |
| bloodmagic | redstone(4,0.5), nether(**`max-count` typo**,1.0), nether_decor(**`max-count` typo**,1.0), wart(8,1.0), crimson(12,1.1), cloth(8,0.7) | Redstone block/ore/deepslate ore/wire; nether brick family + crimson stem/hyphae, crimson nylium, netherrack; weeping vines, crimson fungus, crimson roots; nether wart & wart block; red wool, red concrete, red candle, campfire. |

**Config bug worth flagging:** in the `bloodmagic` block the `nether` and `nether_decor`
families use the key `max-count` (hyphen) where every other family uses `max_count`
(underscore). If the plugin reads `max_count` only, those two families fall back to a
default cap. Unverified whether the jar tolerates both — a finding, not a fact.

Shrine FX per element (sounds/particles) are in `shrines.yml: fx:` — cosmetic only.
Hear distance is `16 * volume` blocks.

## 1.6 Spell runes — the complete list

Runes are MMOItems gemstones. `Magic/skills.yml` binds each skill id to the element that
gates it ("The element decides two things: which weapon requirement gates the cast, and
which alignment band the weapon contributes. A skill with no binding is never gated.").
Costs and cooldowns come from the rune item definitions.

### Cerrith (`MMOItems/item/cerrith_runes.yml`) — 8 runes

| Rune item id | Display name | Socket tier | Skill id | Cooldown | Mana | Effect values |
|---|---|---|---|---|---|---|
| `RUNE_OF_HEALING_ORB` | Healing Orb | Minor Rune | `Healing_Orb` | 10.0 s | 4.0 | heal 4.0 |
| `RUNE_OF_SHIELDING_ORB` | Shielding Orb | Minor Rune | `Shielding_Orb` | 10.0 s | 4.0 | shield_power 4.0, shield_duration 10.0 |
| `RUNE_OF_HAND_CURE` | Hand Cure | Lesser Rune | `Hand_Cure` | 15.0 s | 6.0 | heal 6.0 |
| `RUNE_OF_BLESSING_OF_SWIFTNESS` | Blessing of Swiftness | Lesser Rune | `Blessing_Of_Swiftness` | 15.0 s | 6.0 | duration 10.0 |
| `RUNE_OF_CERRITH_GLYPH` | Cerrith Glyph | Greater Rune | `Cerrith_Glyph` | 20.0 s | 8.0 | duration 8.0, shield_duration 10.0 |
| `RUNE_OF_RESTORATION` | Restoration | Greater Rune | `Restoration` | 20.0 s | 8.0 | — |
| `RUNE_OF_BLESSING_OF_HEALING` | Blessing of Healing | Ascendant Rune | `Blessing_Of_Healing` | 20.0 s | 10.0 | heal 10.0 |
| `RUNE_OF_MANA_TRANSFER` | Mana Transfer | Ascendant Rune | `Mana_Transfer` | **1.0 s** | 4.0 | toggle-type skill; low cooldown is deliberate (in-file comment) |

### Oseni (`MMOItems/item/oseni_runes.yml`) — 4 runes

| Rune item id | Display name | Socket tier | Skill id | Cooldown | Mana | Effect values |
|---|---|---|---|---|---|---|
| `RUNE_OF_FIRE_SHARD` | Fire Shard | Minor Rune | `Fire_Shard` | 10.0 s | 4.0 | damage 4.0 |
| `RUNE_OF_FIRE_BREATH` | Fire Breath | Lesser Rune | `Fire_Breath` | 15.0 s | 4.0 | burnt_damage 3.0, burnt_duration 2.0 |
| `RUNE_OF_OSENI_GLYPH` | Oseni Glyph | Greater Rune | `Oseni_Glyph` | 20.0 s | 8.0 | duration 8.0, damage 8.0 |
| `RUNE_OF_FIRE_RAIN` | Fire Rain | Ascendant Rune | `Fire_Rain` | 20.0 s | 10.0 | damage 10.0 |

### Seithr (`MMOItems/item/seithr_runes.yml`) — 8 runes

| Rune item id | Display name | Socket tier | Skill id | Cooldown | Mana | Effect values |
|---|---|---|---|---|---|---|
| `RUNE_OF_SILENCING_SHARD` | Silencing Shard | Minor Rune | `Silencing_Shard` | 10.0 s | 4.0 | duration 4.0 |
| `RUNE_OF_ICE_SHARD` | Ice Shard | Minor Rune | `Ice_Shard` | 10.0 s | 4.0 | duration 4.0 |
| `RUNE_OF_ICE_SHIELD` | Ice Shield | Lesser Rune | `Ice_Shield` | 15.0 s | 6.0 | shield_power, shield_duration 10.0 |
| `RUNE_OF_ICE_WAVE` | Ice Wave | Lesser Rune | `Ice_Wave` | 15.0 s | 6.0 | duration 10.0 |
| `RUNE_OF_SEITHR_GLYPH` | Seithr Glyph | Greater Rune | `Seithr_Glyph` | 20.0 s | 8.0 | duration 8.0, frozen_duration 4.0 |
| `RUNE_OF_COLD_EMBRACE` | Cold Embrace | Greater Rune | `Cold_Embrace` | 20.0 s | 8.0 | duration 8.0 |
| `RUNE_OF_FROSTVEIL` | Frostveil | Ascendant Rune | `Frostveil` | 20.0 s | 10.0 | duration 10.0 |
| `RUNE_OF_FROZEN_TOMB` | Frozen Tomb | Ascendant Rune | `Frozen_Tomb` | 20.0 s | 10.0 | duration 4.0, damage 10.0 |

All runes use `mode: RIGHT_CLICK`, base material `ECHO_SHARD`, and carry the lore line
`§7Type: <element colour><Element>`.

**Total: 20 spell runes across only 3 of the 10 elements.** Mitlan, Arcanum, Spirit,
Illusion, Necromancy, Shadowmancy, Bloodmagic have **no runes and therefore no spells**
(`Magic/skills.yml` binds nothing for them; no `*_runes.yml` exists for them).

## 1.7 Weapon parts and their costs

`Magic/gear/parts.yml`. `m.currency.enchanted_dust` is the shared magic currency.

### Cores (`sockets: {}` — cores grant no sockets in this config)

| Part id | Display name | Archetype | Cost |
|---|---|---|---|
| `iron_staff_core` / `iron_wand_core` / `iron_sword_core` | Iron Magical Core `#d8d8d8` | staff / wand / sword | 4x Iron Ingot + 4x Enchanted Dust |
| `steel_staff_core` / `steel_wand_core` / `steel_sword_core` | Steel Magical Core `#7f7d80` | staff / wand / sword | 4x Steel Ingot + 4x Enchanted Dust |
| `abyssalite_staff_core` / `_wand_` / `_sword_` | Abyssalite Magical Core `#3b4e60` | staff / wand / sword | 4x Abyssalite Ingot + 4x Enchanted Dust |
| `mythril_staff_core` / `_wand_` / `_sword_` | Mythril Magical Core `#9be1f3` | staff / wand / sword | 4x Mythril Ingot + 4x Enchanted Dust |

Core lore *claims* rune slots (staff cores: "one"/"two"/"three"/"four rune slots"; wand
and sword cores: 1/1/2/2, plus flavour about mana channeling or blade edge), but
**every core in `parts.yml` has an empty `sockets: {}` map.** See §1.14 — this is the
biggest discrepancy in the Magic config.

### Handles (usable on staff, wand and sword)

| Part id | Display name | Cost | Socket granted |
|---|---|---|---|
| `oak_handle` | Oak Magical Handle | 2x Stick + 2x Enchanted Dust | 1x minor_rune |
| `basic_handle` | Basic Magical Handle | 2x Stick + 4x Enchanted Dust | 1x lesser_rune |
| `petty_handle` | Petty Magical Handle | 2x Stick + 6x Enchanted Dust | 1x greater_rune |
| `heavy_handle` | Heavy Magical Handle | 2x Stick + 8x Enchanted Dust | 1x ascendant_rune |

### Tomes (slot `tome` — all three archetypes)

| Part id | Display name | Cost | Socket granted |
|---|---|---|---|
| `normal_oak_tome` | Simple Tome | 2x Book | **none** ("A mundane book with no effect") |
| `oak_tome` | Simple Magical Tome | 2x Book + 2x Enchanted Dust | 1x minor_rune |
| `basic_tome` | Basic Magical Tome | 2x Book + 4x Enchanted Dust | 1x lesser_rune |
| `petty_tome` | Petty Magical Tome | 2x Book + 6x Enchanted Dust | 1x greater_rune |
| `heavy_tome` | Heavy Magical Tome | 2x Book + 8x Enchanted Dust | 1x ascendant_rune |

### Tome2 / Tome3 (staff only, except the "normal" filler)
Identical costs and sockets to the Tome list above, with ids suffixed `2` / `3`:
`oak_tome2`, `basic_tome2`, `petty_tome2`, `heavy_tome2`, `oak_tome3`, `basic_tome3`,
**`petty_tom32`** (sic — typo in the id), `heavy_tome3`. `normal_oak_tome2` and
`normal_oak_tome3` accept all three archetypes and grant nothing.

**Practical maximum for a staff:** handle (1) + tome (1) + tome2 (1) + tome3 (1) = **4
sockets**, exactly the documented ceiling. A wand or sword gets handle + tome = **2 sockets**.

## 1.8 Enchanted Charges

`Magic/charges.yml` + `MMOItems/item/materials.yml:848-900`.

| Tier | Roman | MMOItems id | Display name | Item path | Aura cap per element |
|---|---|---|---|---|---|
| 1 | I | `ENCHANTED_CHARGE_1` | `&6Enchanted Charge I` | `m.materials.enchanted_charge_1` | 40 |
| 2 | II | `ENCHANTED_CHARGE_2` | `&6Enchanted Charge II` | `m.materials.enchanted_charge_2` | 75 |
| 3 | III | `ENCHANTED_CHARGE_3` | `&6Enchanted Charge III` | `m.materials.enchanted_charge_3` | 110 |
| 4 | IV | `ENCHANTED_CHARGE_4` | `&6Enchanted Charge IV` | `m.materials.enchanted_charge_4` | 150 |

All four: material `AMETHYST_SHARD`, CMD 9.0, CMD string `16`, lore
`&7Use on a magic weapon to imbue resonance`, fake Unbreaking 1 for the glint.

**Displayed band thresholds** (`charges.yml: bands.default`) — a charge showing
"Cerrith II" gathered at least 40 cerrith aura:

| Band shown | Aura required |
|---|---|
| `-` | below 10 (imprinted but empty) |
| I | 10 |
| II | 40 |
| III | 75 |
| IV | 110 |

### Orb minigame difficulty by charge tier (`Magic/gear/orbs.yml`)

| Charge tier | Orbs live at once | Chance an orb is good | Speed | Window | Good hits needed |
|---|---|---|---|---|---|
| 1 | 4 | 75% | 0.8x | 220 ticks (11.0 s) | 4 |
| 2 | 5 | 65% | 1.0x | 200 ticks (10.0 s) | 5 |
| 3 | 6 | 55% | 1.15x | 180 ticks (9.0 s) | 6 |
| 4 | 8 | 45% | 1.3x | 160 ticks (8.0 s) | 8 |

Shared orb settings: hit radius 0.5, click range 12 blocks, orbit radius 2.4, orbit
height 1.1, bob 0.25, orbit period 90 ticks, fade-in 10 ticks, orb lifetime 70 ticks,
spawn every 14 ticks, default window 200 ticks.

**Rift:** +5 per bad orb hit, cap 100. A later successful charge removes **10 Rift**
(`rift.per_recharge: 10`) — never on the first charge. Rift is the whiff chance shown as
`Rift {rift}%` on a failed cast.

## 1.9 Artifacts

Template item: `m.miscellanea.template_artifact` (`Magic/artifacts/generator.yml`).
Glint on (`config.yml: artifacts.glint: true`). Hard aura ceiling per element: **150**
(`config.yml: artifacts.aura_cap`).

### Rarity table

| Rarity | Display | Colour | Weight | % of rolls | Elements on the item | Primary aura cap |
|---|---|---|---|---|---|---|
| common | Common | `#7d9b6a` | 65 | 65% | 1 | 0-25 |
| uncommon | Uncommon | `#5aa0c8` | 20 | 20% | 1-2 | 26-45 |
| rare | Rare | `#5b6fd4` | 10 | 10% | 1-2 | 46-65 |
| epic | Epic | `#9b4dc4` | 4 | 4% | 1-3 | 66-90 |
| legendary | Legendary | `#d4a017` | 1 | 1% | 1-4 | 91-150 |

### Element weight when rolling an artifact type

| Element | Weight | Primary cap common→legendary | Secondary cap common→legendary |
|---|---|---|---|
| cerrith | 22 | 0-25 / 26-45 / 46-65 / 66-90 / 91-150 | 0-18 / 18-32 / 32-48 / 48-70 / 70-110 |
| seithr | 18 | same as cerrith | same as cerrith |
| oseni | 18 | same as cerrith | same as cerrith |
| mitlan | 14 | same as cerrith | same as cerrith |
| bloodmagic | 8 | 4-12 / 12-22 / 22-36 / 36-55 / 55-80 | 2-6 / 5-10 / 8-14 / 12-20 / 16-28 |
| necromancy | 6 | 3-10 / 10-18 / 18-30 / 30-48 / 48-70 | 2-5 / 4-8 / 6-12 / 10-16 / 12-22 |
| spirit | 5 | 2-6 / 6-12 / 12-22 / 22-36 / 36-55 | 1-3 / 2-4 / 3-5 / 4-6 / 5-8 |
| shadowmancy | 4 | 2-7 / 7-14 / 14-24 / 24-40 / 40-60 | 1-3 / 2-5 / 3-6 / 4-7 / 5-10 |
| illusion | 4 | 2-7 / 7-14 / 14-24 / 24-40 / 40-60 | 1-3 / 2-5 / 3-6 / 4-7 / 5-10 |
| arcanum | **1** | 1-2 / 2-4 / 4-8 / 8-14 / 14-24 | 1-1 / 1-2 / 1-2 / 1-3 / 1-3 |

None are disabled (`disable: false` on all ten).

**BUT:** `random_pool: planar_four`, so any artifact rolled without an explicit element
— which is every artifact the server actually generates, see §1.10 — can only be
**oseni, seithr, cerrith or mitlan**. The other six elements' artifacts are effectively
unobtainable through the normal drop path.

### Affinity groups (for multi-element artifacts)

| Group id | Members |
|---|---|
| `planar_four` | oseni, seithr, cerrith, mitlan |
| `death_arts` | necromancy, shadowmancy, bloodmagic |
| `with_arcanum` | arcanum + all nine others |
| `veil` | illusion, cerrith |
| `animus` | spirit, seithr, cerrith |

**Exclusion rule:** `never: [oseni, seithr, cerrith, mitlan] with: [necromancy,
shadowmancy, bloodmagic]` — a planar element and a death art never appear on the same
artifact.

### Naming
Artifacts are named from `Magic/artifacts/naming-schemes.yml` (a per-element noun list
per object shape: orb, brooch, book, ring, bracelet, amulet, necklace, gem, jar,
manuscript) with an optional adjective from `Magic/artifacts/adjectives.yml`.

Adjective chance by rarity (`adjectives.yml: chance`):

| Rarity | Chance of an adjective |
|---|---|
| common | 100% |
| uncommon | 100% |
| rare | 50% |
| epic | 25% |
| legendary | 15% |

Global adjective pool: common `Faded / Hollow / Dormant`, uncommon `Faint / Waning /
Veiled`, rare `Steady / Keen`, epic `Vivid / Prime`, legendary `True / Unbound /
Ancient`. Per-element overrides exist under `by_element:` (e.g. arcanum common
`Rusted / Blank / Sealed`, uncommon `Relic / Tarnished`, rare `Lucid / Unsealed`).

Example oseni nouns: orbs `Kilnheart, Clinker, Brand-Seed, Cinderbead, Hearthknot,
Slagpearl, Coal-Tear, Bellows-Eye, Ash-Pip, Forge-Dew`; books `Soot Canticle, Kiln
Psalter, Brand Ordinances, Cinder Ledger, Hearth Hours, Slag Hymnal, Ash Ordinary,
Bellows Primer, Ember Gloss, Furnace Rubric`; rings `Brand-Ring, Bellows Hoop, Kiln Band,
Cinder Ring, Coal-Band`; brooches `Forge-Brooch, Kiln Pin, Ashen Fibula, Hearth Pin`;
gems `Fire-Chip, Kiln Splinter, Clinker Facet, Brand-Glass, Slag Spark, Hearth Glint,
Ash Crystal, Forge Fleck`; jars `Cinder Phial, Kiln Crock, Ash Pot, Brand Vial`.

### Models
`Magic/artifacts/model-schemes.yml` maps each of the ten elements to a pool of ItemsAdder
models from the **`tfmc_magic`** namespace, tagged by rarity band. Examples:
`ia.tfmc_magic:oseni_orb_0` (all rarities), `ia.tfmc_magic:oseni_orb_11`
(epic-legendary only), `ia.tfmc_magic:cerrith_brooch_14` (rare-legendary),
`ia.tfmc_magic:shared_book_37` (common-uncommon), plus shared
`ia.tfmc_magic:manuscript_47`..`51`.

**Per prior research, all 98 `tfmc_magic` ItemsAdder items have display names identical
to their ids** — the real, player-visible name is written at runtime by Magic from the
naming scheme. Do not quote ItemsAdder names in the wiki.

## 1.10 Where artifacts come from

The **only** non-admin artifact source found anywhere in the server config is the
**Dowsing** plugin's `Artifact Mine` production method
(`plugins/Dowsing/production_methods.yml:60-73`):

```
artifact_mine:
    prerequisite: diamond_tools
    item: name "§dArtifact Mine", material m.loot.staff_runestone
    effects:
        - prestige(8)
        - time_modifier(200)
        - upkeep(20)
        - add_drop(magic.(rarity=common),65)
        - add_drop(magic.(rarity=uncommon),25)
        - add_drop(magic.(rarity=rare),7)
        - add_drop(magic.(rarity=legendary),3)
    cost:
        - m.currency.enchanted_dust(4)
```

Notes for the wiki:
- The Artifact Mine costs **4x Enchanted Dust**, needs the `diamond_tools` prerequisite,
  gives 8 prestige, time modifier 200 and 20 upkeep.
- Drop weights 65 / 25 / 7 / 3 → common 65%, uncommon 25%, rare 7%, legendary 3%.
- **`epic` is missing from the Artifact Mine drop list.** Epic artifacts are defined and
  weighted in `generator.yml` but there is no player path to one. Flag this.

## 1.11 Numbers that matter to players

### Resonance and Equilibrium (`Magic/config.yml`)

| Setting | Value | Meaning |
|---|---|---|
| `default_resonance` | 0.0 | Everyone starts at 0 in every element |
| `resonance.decay_per_hour` | **-0.02** | Resonance bleeds away slowly; you must keep meditating |
| `equilibrium.default` / `min` / `max` | 0.0 / -100.0 / +100.0 | |
| `equilibrium.passive_corrupt_per_hour` | 0.05 | Corruption creeps up on its own |
| `equilibrium.corrupt_compound_strength` | 1.25 | Corruption compounds |
| `equilibrium.tranquility_decay_per_hour` | 0.03 | Tranquility bleeds away |
| `tick.interval_ticks` / `seconds_per_hour` | 20 / 3600 | Rates above are per **real** hour |

### Equilibrium bonus bands

Surge (corruption side):

| Corruption | Mana | Damage | Cooldown |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 15 | -5% | +10% | -10% |
| 60 | -10% | +15% | -15% |
| 100 | -5% | +10% | -10% |

Note the **peak is at 60 Corruption, not 100** — pushing to 100 makes you *worse*.

Tranquility (flow side):

| Tranquility | Mana | Damage | Cooldown |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 100 | **-20%** | **+25%** | -5% |

Tranquility at 100 is strictly better on mana and damage than any Surge band; Surge wins
on cooldown. This matches the GUI lore: Surge = "Power now. Corruption later.",
Flow = "Slow start. Stronger at depth."

### Cast drift (`config.yml: cast_drift`)
Spending mana moves your Equilibrium: `drift = mana / 1000`, minimum `0.01`.
40 mana → 0.04. **Surge** adds corruption (negative), **Flow** adds tranquility (positive).

### Meditation (`config.yml: meditation`)

| Setting | Value |
|---|---|
| Pedestal furniture | `pedestal`, slot `*` |
| Cardinal offset / diagonal offset | 4 / 3 |
| Start orb range | 2.5 blocks |
| Orb hit radius / click range | 0.5 / 12 blocks |
| **Mental cost per hit** | 1 |
| **Resonance gained per hit** | **4.0** |
| Surge lock | 10 seconds |
| Max live orbs | 8 |
| Spawn interval | 40 ticks (2.0 s) |
| Orbit period / radius | 80 ticks / 2.4 |
| Flow equilibrium gain per session | 0.02 – 0.06 |
| Surge equilibrium gain per session | 0.02 – 0.10 |

**Mental Points** are not defined in Magic's own config — they are the shared Focus pool
in `TFMCCore/focus.yml`: **max 150**, **+10 per hour** (+0.5/h per MMOCore Wisdom point,
+0.25/h per Intelligence point), regenerating offline, and **spent by both Magic
meditation and Research experiments**. A full pool = 150 orb hits = **600 Resonance**,
and takes 15 real hours to refill at base rate. Full detail in §2.3.

Meditation messages: `"Can't meditate here, no artifacts"`, `"Nothing to gain from
meditating here"`, `"Meditation complete at this site"`, `"You are too tired to meditate
now"` (Mental points exhausted), `"You stop meditating"` (`Magic/messages.yml: meditation`).

### Attunement / Muffle (`config.yml: attunement`)
Artifacts you meditate on get "muffled" — the same artifact gives less over time.

| Setting | Value | Meaning |
|---|---|---|
| `users.ttl_days` | 7 | A user's claim on an artifact expires after 7 days |
| Yield split | `divide` | If **n** people are attuned to one artifact, each gets `resonance_per_hit / n`, and session cap is `usableFill / n` |
| `muffled.off_per_hour` | 0.04166667 (= 1/24) | Full muffle in **24 hours** of use |
| `muffled.recover_per_hour` | 0.00595238 (= 1/168) | Clears in **7 days** |
| Display furniture | `artifact_display` (`ia.tfmc:artifact_display`) | |

**Accepted storage locations that do NOT muffle:** player inventory, pedestal,
artifact_display, item frames. **Chests and other containers raise muffle**, silently
(config comment: "Chests and other containers raise muffle. No chat."). This is a real
trap for players — put it in the wiki.

## 1.12 Bloodmagic sacrifice rites

`Magic/artifacts/sacrifice.yml`. `enabled: true` globally.

**How it works:** hold the **sacrificial dagger** (`m.lore_weapons.bloodmagic_dagger`),
have a victim within **4 blocks**, stand at a pedestal shrine whose bloodmagic scenery
aura is at least **50**, and **speak the incantation in the `rp` RPCharacters chat
channel** (`require_rpcharacters: true`, `rp_channel: rp`, `match: starts_with`,
`case_insensitive: true`, `hide_incantation: false` — i.e. the words are NOT hidden from
chat). The rite then charges for **10 seconds** (`charge_seconds: 10`).

| Setting | Value |
|---|---|
| `min_scenery_aura` | 50 (shrine must reach this) |
| `hint_min_aura` | 20 (silent below this; "too weak" between 20 and 50) |
| `victim_range` | 4 blocks |
| `charge_seconds` | 10 |
| `require_dagger_in_hand` | true |
| `one_rite_per_caster` | true |
| `refuse_new_words_while_active` | true |
| `scenery_charge` | **false** globally for sacrifice paths |

### Outcome tiers by how full the charge bar is at the kill

| Tier | Charge fraction | Aura gained | Injury to victim |
|---|---|---|---|
| none | below 0.20 | — | — |
| **wound** | 0.20 – 0.40 | 20% of cap | `healing` (healable injury) |
| **maim** | 0.40 – 1.0 | 55% of cap | `permanent` |
| **death** | 1.0 (full bar) | **100%** | **`permadeath: true`** |

Artifact lore written by the rite: `"Filled with the pain of {character}"` (wound),
`"Filled with the screams of {character}"` (maim), `"Filled with the soul of {character}"`
(death).

### Incantations (these are literal chat lines)

| School | Enabled | Incantation |
|---|---|---|
| `bloodmagic` | **yes** | `Lorin Vekar Drakun Talis` |
| `necromancy` | **no** (`enabled: false`) | `Vorthas Luneth... Taro Vekran` |
| `shadowmancy` | **no** (`enabled: false`) | **`Need to do`** — placeholder text, never written |

Only the **Bloodmagic** rite works. Necromancy and Shadowmancy rites are disabled.

Sacrifice messages (`Magic/messages.yml: sacrifice`): ambient dread lines
`"You are filled with dread"`, `"The end feels near"`, `"The feeling subsides"`; place
hints `"The shrine awaits your offering"` / `"The shrine is too weak"`; failures
`"You need the sacrificial dagger in hand"`, `"No offering is in reach"`, `"Nothing here
reacts to those words"`, `"The shrine is too weak to hear you"`, `"A rite is already
underway"`, `"That vessel can hold no more"`.

FX: `BLOCK_SCULK_SHRIEKER_SHRIEK` on wound/maim/death, `ENTITY_WARDEN_SONIC_BOOM` on
completion.

## 1.13 Player command table

`magic.use` has `default: true` in the jar's `plugin.yml`, so **every player has it**.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/resonance` | `/res` | Opens your Resonance profile GUI: per-element resonance bars, Equilibrium (Corruption/Tranquility) bar, Mental points, and the Surge/Flow cast-mode toggle. | Permission `magic.use`, **default `true`** — no setup needed. Requires an active RP character, otherwise `"You need an active character to view resonance."` |

That is the **only** player-facing command in Magic. Everything else in the system is
done by physically interacting with the world: crafting a Magic Station, clicking it,
placing artifacts on pedestals, meditating, and speaking incantations in the `rp` chat
channel.

### Admin/staff commands EXCLUDED (permission `magic.admin`, default `op`)

`/magic reload`, `/magic open`, `/magic resonance <get|set|add|reset> ...`,
`/magic artifact <roll|give|create|path|setfill> ...`, `/magic fillchest <element|random|all>`,
`/magic shrine fill <element> <amount>`, `/magic refresh`.
Legacy alias permission: `magic.admin.reload` (default `op`).

## 1.14 Features configured but INERT

Ordered by how badly a wiki could mislead a player.

1. **Enchanted Charges have no crafting recipe anywhere.** `ENCHANTED_CHARGE_1..4` exist
   as MMOItems materials and `Magic/charges.yml` describes them as "crafted elsewhere
   (one separate item per tier)", but a grep across every `.yml`/`.json` in
   `C:\Users\MSI\Desktop\plugins` finds them referenced **only** in
   `MMOItems/item/materials.yml` and `Magic/charges.yml`. No AdvancedCrafting recipe, no
   shop, no loot table, no Research output. **Without a charge, no weapon can ever be
   attuned, and every cast is "Refused".** This is the most important unverified blocker
   in Magic — confirm with staff before the wiki tells players how to attune anything.
2. **Spell runes have no obtainable source in config either.** `RUNE_OF_*` ids appear
   only in their own `MMOItems/item/*_runes.yml` files and (for icons)
   `Magic/elements/elements.yml`. No drop table, recipe or shop entry references them.
   Research produces `runestone` / `staff_runestone` outputs (see §2), which is the
   likely intended source, but that link is **not** present in config — mark as a guess.
3. **Cores grant zero sockets.** Every core in `Magic/gear/parts.yml` has `sockets: {}`
   while its lore promises one to four rune slots. As shipped, all sockets come from the
   handle and tomes, so an Iron core and a Mythril core are mechanically **identical**.
   The wiki must not tell players to upgrade cores for more rune slots.
4. **Alignment bonus is disabled.** `config.yml: gear.alignment.enabled: false`. The
   configured per-tier bonuses (tier 1 +3% dmg / -3% cd, tier 2 +5%/-5%, tier 3 +8%/-8%,
   tier 4 +10%/-10%) do nothing. The config comment says it "ships disabled" as a
   power-creep knob.
5. **Five elements cannot charge from scenery.** `arcanum`, `spirit`, `illusion`,
   `necromancy`, `shadowmancy` all have `scenery_charge: false`
   (`Magic/artifacts/shrines.yml`). Their shrine block lists are fully authored but
   building one does nothing. Only admin `/magic shrine fill` works on them.
6. **Seven of ten elements have no spells at all.** Only Cerrith, Oseni and Seithr have
   rune files. Mitlan, Arcanum, Spirit, Illusion, Necromancy, Shadowmancy and Bloodmagic
   are fully defined as elements (GUI slot, colour, artifact tables, shrine scenery) but
   there is nothing to cast with them.
7. **Necromancy and Shadowmancy sacrifice rites are disabled**, and the Shadowmancy
   incantation is literally the placeholder string `"Need to do"`.
8. **Epic artifacts are unreachable** via the only player drop source (Artifact Mine
   drops common/uncommon/rare/legendary only — §1.10).
9. **Six of ten artifact elements are effectively unreachable** because
   `random_pool: planar_four` restricts unspecified rolls to oseni/seithr/cerrith/mitlan,
   and the Artifact Mine specifies only rarity, never element.
10. **MythicMobs ritual FX mobs are unreferenced.** Per the cross-system brief,
    `BLOODMAGIC_RUNE_PORTAL`, `NECROMANCY_RUNE_PORTAL`, `ILLUSION_PORTAL_MAZE`,
    `ILLUSION_PORTAL_TOWER` and `Shadow_Fragment` have zero references. **I found nothing
    in the Magic plugin folder that spawns MythicMobs at all** — no MythicMobs mob id
    appears anywhere under `plugins/Magic`. Magic's rites use plain Bukkit
    sounds/particles (`sacrifice.yml: fx`, `shrines.yml: fx`). So either those mobs are
    for an unbuilt ritual feature, or they are driven from somewhere outside Magic.
    Treat "Magic triggers ritual portals" as **false** unless staff say otherwise.
11. Typos that could confuse a reader: socket suffix is written `Ascedant Rune`
    (`archetypes.yml`) but labelled `Ascendant Rune` (`socket-colours.yml`, which itself
    keys them `asecandt_rune` / `asecandt_armor_rune`); part id `petty_tom32`; bloodmagic
    families use `max-count` instead of `max_count`; core lore says "balde edge" and
    "blade egde".
12. `socket-colours.yml` also lists armor socket labels (`minor_armor_rune` …
    `asecandt_armor_rune`) and `MMOItems/item/armor_runes.yml` exists, but **Magic's
    `archetypes.yml` defines no armour archetype** — there is no way to craft or socket
    mage armour through the Magic station.
13. `config.yml: logging: true` with `wipe-log: true` writes `plugins/Magic/logs/aura.log`
    and deletes it on every reload — staff-facing only.

## 1.15 Cross-links

| System | How Magic touches it |
|---|---|
| **RPCharacters** | Resonance/Equilibrium are stored **per character**, not per player (`Magic/data/characters/*.json` keyed by `characterId` + `ownerUuid`). Sacrifice rites require the `rp` chat channel. |
| **MMOCore** | The Mage class (`MMOCore/classes/mage.yml`) gates all mage weapons; the mana pool spells draw on comes from MMOCore. |
| **MMOItems** | Weapon templates (`MAGE_CUSTOM_STAFF` / `MAGE_CUSTOM_WAND` / `MAGE_CUSTOM_SWORD`, item types `MAGE_STAFFS` / `MAGE_WANDS` / `MAGE_SWORDS`), all runes as gemstones, all parts, Enchanted Charges, `template_artifact`, `m.currency.enchanted_dust`, `m.lore_weapons.bloodmagic_dagger`. |
| **MythicLib** | Skill handlers named in `Magic/skills.yml` (`Healing_Orb`, `Fire_Rain`, `Frozen_Tomb`, …). The brief notes MythicLib skill files `tfmc_cerrith.yml`, `tfmc_seithr.yml`, `tfmc_oseni.yml`, `tfmc_illusion.yml`, `hydromancy.yml` — the first three match Magic's three implemented elements; `tfmc_illusion.yml` and `hydromancy.yml` (Mitlan?) have **no runes**, consistent with §1.14.6. |
| **ItemsAdder** | Magic Station furniture `tfmc:magic_crafting_station`, `tfmc:pedestal`, `tfmc:artifact_display`, and the 98-item `tfmc_magic` artifact model namespace. |
| **InteractibleFurniture** | Hard dependency. Provides the pedestal/artifact_display slot behaviour (`InteractibleFurniture/furniture/magic.yml`). |
| **Dowsing** | The `artifact_mine` production method is the only player artifact source; it uses `m.loot.staff_runestone` as its icon item and Enchanted Dust as its cost. |
| **TLibs** | Item path syntax (`v.`, `m.`, `ia.`, `iaf(...)`) and socket tier groups (`socket-colours.yml` says its prefixes "must match tlibs socket-tier-groups keys exactly"). |
| **TFMCCore** | Hard dependency; role not determinable from config alone. |
| **Research** | Shares the `enchanted_dust` / `runestone` / `staff_runestone` / `arcane_crystal` material vocabulary — see §2. |

## 1.16 Uncertain / unverified (Magic)

- **How a player obtains an Enchanted Charge.** Not found. Blocker — see §1.14.1.
- **How a player obtains a rune.** Not found. Research runestones are a plausible source
  but the link is **a guess**.
- ~~Where Mental points come from~~ — **RESOLVED while researching Research**: they are
  the shared Focus pool in `TFMCCore/focus.yml`. Max **150**, regen **10 per hour**
  (+0.5/h per Wisdom, +0.25/h per Intelligence), regenerates offline. One meditation orb
  hit costs 1, so a full pool buys 150 hits = **600 Resonance**. See §2.3.
- **Exact assembly GUI interaction** (does the station open on right-click? is it a
  drag-in-parts GUI?). Inferred from slot config and messages; not read from code.
- **Whether the `alignment` block would even apply if enabled** — untested.
- **Whether "Too many staffs" whiff** (`messages.yml: cast.whiff_sub_staffs`) means a
  limit on staffs carried or staffs equipped. Not determinable from config.
- **Whether `magic:gear_archetype_revision` mismatches auto-break weapons.** The
  `*Damaged*` path and `data/revisions.json` (per-part `revision` + `hash`) imply that
  editing a part's config bumps its revision and marks existing weapons damaged, but the
  exact rule is in code. Live data shows sword archetype revision 6 and staff revision 7.
- **Exact shrine scoring formula.** Weights and `max_count` are known; how they combine
  into the 0-1 `min_score: 0.15` is not.
- No source repository exists for Magic; nothing here is confirmed against code.

---

# 2. RESEARCH

Deployed jar: `C:\Users\MSI\Desktop\plugins\research-1.0.0.jar`
Data folder: `C:\Users\MSI\Desktop\plugins\Research\`
`plugin.yml`: `name: Research`, `version: 0.13.0` (note: the jar filename says 1.0.0, the
manifest says 0.13.0), author Drefvelin,
`depend: [MMOItems, MythicLib, ItemsAdder, TLibs, TFMCCore]`, `softdepend: [MMOCore]`.

## 2.1 What it is

Research is a deduction minigame played at a Lectern: you put a Research Paper in, then
feed it items one at a time to work out which hidden "Aspects" (Fire, Metal, Arcane…) the
paper is about, and when you have confirmed enough of them the paper turns into a
Completed Thesis that pops out of the lectern.

## 2.2 How a player actually uses it — step by step

### Step 1 — Get Parchment Paper
Sneak-right-click a **Cartography Table** to open the MMOItems station
**"Research Station"** (`TFMCCore/stations.yml`: `research-station: block: v(cartography_table),
click: shift_right`; station file `MMOItems/crafting-stations/research-station.yml`).

Craft **Parchment Paper** (`<#ffaa55>Parchment Paper`, `RESEARCH:SCRIBE_PAPER`):

| Output | Ingredients | Crafting time | Gives |
|---|---|---|---|
| 1x Parchment Paper | 1x vanilla Paper + 1x Alchemy Powder (`MATERIALS:ALCHEMY_POWDER`) | 5 s | 10 Herborist profession EXP |

**Every** recipe at this station grants `exp{profession=herborist;amount=10}`.

### Step 2 — Turn Parchment Paper into a Research Paper
At the same Cartography Table, combine **Parchment Paper + the subject material**. All
recipes take 5 s (15 s for the rare paper) and hide themselves when you lack the
ingredient (`hide-when-no-ingredients: true`).

| Recipe id | Produces | Second ingredient |
|---|---|---|
| `r-ignitium` | `R_IGNITIUM` | Ignitium |
| `r-bronze` | `R_BRONZE` | Bronze Ingot |
| `r-abyssalite-fragment` / `r-abyssalite-ingot` | `R_ABYSSALITE` | Abyssalite Fragment **or** Abyssalite Ingot |
| `r-mythril` / `r-mythrilite` / `r-mythril-ingot` | `R_MYTHRIL` | Mythril Fragment **or** Mythrilite **or** Mythril Ingot |
| `r-elderwood` / `r-refined-elderwood` | `R_ELDERWOOD` | Elderwood **or** Refined Elderwood |
| `r-demonwood` / `r-refined-demonwood` | `R_DEMONWOOD` | Demonwood **or** Refined Demonwood |
| `r-enchanted-dust` | `R_ENCHANTED_DUST` | Enchanted Dust |
| `r-arcane-crystal` | `R_ARCANE_CRYSTAL` | Arcane Crystal |
| `r-gunpowder` | `R_GUNPOWDER` | vanilla Gunpowder |
| `r-silver-denar-1/5/10`, `r-gold-denar-1/5/10/100` | `R_DENAR` | Silver Denar, Handful/Stack of Silver Denars, Gold Denar, Handful/Stack/Pouch of Gold Denars |
| `r-runestone1/2/3/4` | `R_RUNESTONE` | Sword Runestone **or** Wand Runestone **or** Staff Runestone **or** Armor Runestone |
| `r-infusion` | `R_INFUSION` | Infusion Ticket (`LOOT:INFUSION_TOKEN`) |
| `r-rare-research-paper` | `RARE_RESEARCH_PAPER` | **Lost Knowledge Fragment** — 15 s craft |

All ordinary papers share the display name `<#ffaa55>Research Paper` with lore
`&7Study: &fXXXXXX` / `<#ffaa55>Research &7this paper in a &fLectern` / `&7to unlock its
secrets and gain &eEXP&7!` (`MMOItems/item/research.yml`). The rare one is
`<#55ffaa>Unknown Research Paper` and its Study line is obfuscated
(`&7Study: &f&k@@@@@@@ @@@@@@@@`) — **you do not know what it is until you research it.**

### Step 3 — Start the project at a Lectern
Hold the paper and use a **Lectern** (`Research/config.yml: station.block: LECTERN`,
`permission: ""` = **anyone may use one**).

- `"Hold a research paper in your hand to use this station."` if empty-handed.
- `"That item cannot start a research project."` for a wrong item.
- `"This station is in use by someone else."` — **one owner per lectern.** The station file
  records `owner_uuid` (`Research/data/stations/TFMC_Map_3728_354_2982.json`).
- On start: `"Started research project."`, sound `entity.player.levelup` (vol 0.8, pitch
  1.1) and 30 HAPPY_VILLAGER particles in a 0.8 radius.
- **Breaking the lectern destroys the project**: `"Research at this lectern was destroyed."`

The GUI is titled `#ffaa55Research Station` (`Research/gui.yml: labels.inventory_title`).

### Step 4 — Run experiments
Put an item into the grid to "test" it. Each test costs **1 Mental Point**
(`Research/config.yml: mental_points.experiment_cost: 1`). If you are out:
`"You are too exhausted to research right now."`

Every item in the game is tagged with aspects in `Research/aspects/elements.yml`
(`primary_items` and `secondary_items` lists). Testing an item awards:

| | Points |
|---|---|
| Aspect is a **primary** of the item | **2** |
| Aspect is a **secondary** of the item | **1** |

(`Research/config.yml: experiment.primary_points: 2`, `secondary_points: 1`)

Rules:
- You may test each item **once per project** — `"You have already tested this item for
  this project."`
- Items with no aspect tags: `"That item cannot be used in experiments."`
- If an aspect is **not** part of the hidden recipe and you accumulate **3 points** into it,
  it is **Rejected** for this project (`experiment.reject_points: 3`) and shown in red.
- `"This experiment only contains rejected aspects."` blocks a wasted test.
- Preview shows `+{points} points` before you confirm ("Confirm Experiment" button,
  `#82d461`).

Aspect statuses shown in the GUI: `Status: Testing` / `Status: Confirmed` /
`Status: Rejected`, with `Points: {current} / {required}`.

### Step 5 — Reveal and confirm aspects
Each hidden aspect goes through three visibility stages, all measured as a **fraction of
that aspect's `required_points`** — and all three thresholds are lowered by your **MMOCore
Intelligence** attribute (`Research/config.yml: attributes.discovery.mmocore_id: intelligence`).

| Stage | Config | Base | Per Intelligence point | Floor |
|---|---|---|---|---|
| Row appears as "Undiscovered Aspect" + bar | `aspect_discovery` | **26%** of required points | -1% | 10% |
| Real identity shown and **CONFIRMED** | `aspect_confirm` | **42%** of required points | -1% | 25% |
| Product (what the paper actually makes) revealed | `attributes.discovery` | after N confirmed aspects (per-project, below) | **-0.1 aspects per point** | max bonus **2** |

The config's own worked examples:
- Discovery: 1 INT → `1/4` and `2/8` discovers; 4 INT → `2/9`; 6 INT → `1/5`, `2/10`;
  10 INT → `1/6`; 12 INT → `1/7`; 14 INT → `1/8`; 15 INT → `1/9`; 16+ INT → `1/10`.
- Confirm: 2 INT → `2/5`, `4/10`; 9 INT → `1/3`, `2/6`, `3/9`; 12 INT → `3/10`;
  14 INT → `2/7`; 17+ INT → `1/4`, `2/8`.
- Product reveal: **5 Intelligence reveals 1 aspect earlier, 15 Intelligence reveals 2 earlier.**

Messages: `"Aspect confirmed: {aspect}"`, `"You have identified the research product."`

### Step 6 — Complete
Fill every aspect to its `required_points` and the project completes:
`#ff55ffResearch completed!`

- Sound `ui.toast.challenge_complete` (vol 1.0, pitch 1.15), then
  `entity.firework_rocket.twinkle` 8 ticks later; 50 TOTEM_OF_UNDYING particles + 30
  FIREWORK particles.
- **The result item pops out above the lectern — it is NOT put in your inventory**
  (`Research/config.yml: station.result_spawn`). It is kicked upward with velocity
  0.35–0.75 (horizontal 0.05–0.12) and leaves a particle trail for 140 ticks.
  The floating item is labelled `{amount}x {item}`.
- Chat: `"You received {item}."`

The output is a **Completed Thesis** (`<#ffaa55>Completed Thesis`, lore
`&eRight Click &7to unlock its secrets...`) which you then right-click to claim.

### Step 7 — Or scrap it
The GUI has a **Scrap** button (`#c45749Scrap`) with a confirmation screen titled
`Confirm Scrap`. Warning: `"WARNING! The project will not be refunded!"`
On confirm: `"Research project scrapped."`

## 2.3 Mental Points (Focus) — the real limiting resource

Mental Points are **shared between Research experiments and Magic meditation** and are
stored per RP character. They live in `TFMCCore/focus.yml`, not in Research's own config:

```
# Character-keyed mental points (Focus). Not stats.
# Consumed by Research experiments and Magic meditation.
max: 150
base_per_hour: 10
regen_interval_ticks: 72000
offline_regen: true
regen_bonuses:
  - mmocore_id: wisdom        extra_per_hour_per_point: 0.5
  - mmocore_id: intelligence  extra_per_hour_per_point: 0.25
```

| Number | Value |
|---|---|
| Maximum pool | **150** |
| Base regeneration | **10 per hour** |
| Regen tick interval | 72000 ticks = **1 hour** |
| Regenerates while offline | **yes** |
| Wisdom bonus | +0.5 per hour per point |
| Intelligence bonus | +0.25 per hour per point |
| Cost of one Research experiment | **1** |
| Cost of one Magic meditation orb hit | **1** |

At base rate a full pool of 150 takes **15 real hours** to refill, and buys 150
experiments (or 150 meditation hits = 600 Resonance).

Chat display: `"Mental Points: {amount}"`.

## 2.4 The 31 Aspects

`Research/aspects/elements.yml`. Each aspect has a display name, a three-word lore hint,
an icon, a grid colour, and input/confirm sounds. Item counts are the size of that
aspect's `primary_items` / `secondary_items` lists — i.e. **how many different items in
the game push that aspect**.

| Aspect id | Display name | Hex | Lore hint | Primary items | Secondary items |
|---|---|---|---|---|---|
| `air` | Air | `#FCE65C` | Wind, Sky, Varden | 3 | 26 |
| `arcane` | Arcane | `#7702E0` | Reality, The Cosmos, Arcanum | 4 | 10 |
| `beast` | Beast | `#6E4C2A` | Animal, Humanoid, Monster | 54 | 73 |
| `blood` | Blood | `#691515` | Flesh, Vampirism, Blood Magic | 10 | 15 |
| `conflict` | Conflict | `#871616` | Weapon, Offense, War | 99 | 27 |
| `creation` | Creation | `#FCA239` | Construction, Repair, Tool | 317 | 150 |
| `darkness` | Darkness | `#171717` | No Light, Black, Night | 14 | 22 |
| `death` | Death | `#292929` | Remains, Decay, Disease | 91 | 18 |
| `earth` | Earth | `#4D3828` | Rock, Crystal, Metora | 337 | 28 |
| `energy` | Energy | `#87CDFC` | Power, Strength, Potential | 12 | 41 |
| `entropy` | Entropy | `#2B2D2F` | Chaos, Destruction, Damage | 22 | 53 |
| `exchange` | Exchange | `#EFF0E2` | Conversion, Mutation, Alchemy | 16 | 46 |
| `fire` | Fire | `#F76F2D` | Heat, Burning, Osenis | 12 | 62 |
| `ice` | Ice | `#73E4FC` | Cold, Frost, Seithrin | **8** | **5** |
| `knowledge` | Knowledge | `#2758C4` | Wisdom, Information, Learning | 26 | 54 |
| `life` | Life | `#C03131` | Health, Vitality, Healing | 23 | 68 |
| `light` | Light | `#FCEDC0` | Luminosity, White, Day | 52 | 20 |
| `machine` | Machine | `#BF5935` | Technology, Device, Mechanism | 24 | 40 |
| `magic` | Magic | `#42114E` | Mana, Spellcraft, Sorcery | 22 | 99 |
| `metal` | Metal | `#99A2B7` | Alloy, Ingot, Ore | 120 | 242 |
| `nature` | Nature | `#2D9E37` | Plant, Greenery, Cerrith | 350 | 147 |
| `necromancy` | Necromancy | `#052830` | Undeath, Corruption, Necromantic Magic | 13 | 21 |
| `order` | Order | `#DAD4CC` | Balance, Control, Organization | 125 | 119 |
| `protection` | Protection | `#62656D` | Armour, Defense, Safety | 137 | 81 |
| `sensation` | Sensation | `#C561B7` | Perception, Emotion, Illusion Magic | 81 | 168 |
| `spirit` | Spirit | `#6BFC00` | Soul, Essence, Spiritual Magic | **4** | 48 |
| `sustenance` | Sustenance | `#76B437` | Food, Drink, Hunger | 131 | 124 |
| `time` | Time | `#3204EE` | Moment, Season, Era | **3** | 17 |
| `void` | Void | `#000000` | Vacuum, Nonexistence, Shadow Magic | **4** | 11 |
| `water` | Water | `#23B78C` | Ocean, Fluid, Mitlan | 20 | 75 |
| `wealth` | Wealth | `#FCC25F` | Value, Rarity, Treasure | 43 | 44 |

**Practical wiki takeaway:** the aspects with tiny primary lists — Time (3), Arcane (4),
Spirit (4), Void (4), Air (3), Ice (8) — are the hard ones to fill and are the reason
projects stall. Nature (350), Earth (337) and Creation (317) are trivial.

The lore hints double as an in-fiction glossary: Fire = "Osenis", Ice = "Seithrin",
Nature = "Cerrith", Water = "Mitlan", Air = "Varden", Arcane = "Arcanum", Earth =
"Metora" — these are the same names as Magic's elements (see §1.4), so the two systems
share a cosmology.

Example aspect entry (`arcane`): icon `m.icons.RESEARCH_ARCANE_ICON`, grid colour purple,
input sound `block.end_portal_frame.fill`, confirm sound
`null_sounds:samus.void_blackhole_summon`; primary items `MAGE_ARCANUM_STAFF`,
`m.materials.arcane_crystal`, `ARCANE_FUEL`, `GEIGER_COUNTER`; secondary items
`ia.lzfurniture:marauder_telescope`, `v.crying_obsidian`, the four Arcanum Mage armour
pieces, `DEAD_GEIGER_COUNTER`, `ARCANE_LEAF`, `MORGANITE`, `v.heavy_core`.

## 2.5 Every research project (the unlock chain, as structured data)

An **input** (`Research/inputs/*.yml`) is the paper you hold. It rolls one **output**
(`Research/outputs/*.yml`) from a weighted list. The output defines the aspect puzzle and
the reward.

### 2.5.1 Ordinary papers — deterministic, one paper to one project

| Paper you craft | Project | Aspects and required points | Total pts | Product revealed after N confirmed | Reward item |
|---|---|---|---|---|---|
| `R_ABYSSALITE` | Abyssalite | necromancy 2, metal 3, wealth 3, creation 2 | 10 | 7 | `c_abyssalite` (Completed Thesis) |
| `R_ALCHEMY` | Alchemy | knowledge 2, order 2, exchange 4, creation 2 | 10 | 7 | `c_alchemy` |
| `R_ARCANE_CRYSTAL` | Arcane Crystal | arcane 3, earth 3, energy 2, machine 2 | 10 | 7 | `c_arcane_crystal` |
| `R_BRONZE` | Bronze | machine 2, metal 4, creation 4 | 10 | 6 | `c_bronze` |
| `R_DEMONWOOD` | Demonwood | blood 2, nature 4, fire 2 | 8 | 6 | **`r_demonwood`** — see §2.8 |
| `R_DENAR` | Denar | wealth 5, metal 3, order 2 | 10 | 6 | `c_denar` |
| `R_ELDERWOOD` | Elderwood | nature 4, time 2, arcane 2, knowledge 2 | 10 | 7 | `c_elderwood` |
| `R_ENCHANTED_DUST` | Enchanted Dust | time 2, magic 4, entropy 2, creation 2 | 10 | 7 | `c_enchanted_dust` |
| `R_GUNPOWDER` | Gunpowder | entropy 3, energy 3, exchange 2, conflict 2 | 10 | 7 | `c_gunpowder` |
| `R_IGNITIUM` | Ignitium | exchange 2, fire 4, earth 4 | 10 | 6 | `c_ignitium` |
| `R_INFUSION` | Infusion | spirit 2, magic 3, earth 2, nature 3 | 10 | 7 | `c_infusion` |
| `R_MYTHRIL` | Mythril | magic 2, metal 3, wealth 3, time 2 | 10 | 7 | `c_mythril` |
| `R_RUNESTONE` | Runestone | exchange 3, magic 4, wealth 3 | 10 | 3 | `c_runestone` |
| `R_TRACE_DETECTION` | Trace Detection | arcane 3, knowledge 2, wealth 3, machine 2 | 10 | 7 | `c_trace_detection` |

### 2.5.2 Staff Runestone — the one project that gives a SPELL RUNE

| Input item | Project | Aspects | Total | Reveal after | Reward |
|---|---|---|---|---|---|
| `m.loot.staff_runestone` (**Staff Runestone**, the raw loot item, not a paper) | `staff_runestone` | entropy 4, fire 3, arcane 2 | 9 | 2 | **template `t.runestones`** |

`Research/templates/runestones.yml`:

| Result | Weight | Chance |
|---|---|---|
| `m.seithr_runes.rune_of_ice_shard` — **Ice Shard** (Seithr, Minor Rune) | 1.0 | 50% |
| `m.oseni_runes.rune_of_fire_breath` — **Fire Breath** (Oseni, Lesser Rune) | 1.0 | 50% |

**This is the confirmed link between Research and Magic**: a live station file
(`Research/data/stations/TFMC_Map_3728_354_2982.json`) shows
`"input_id":"staff_runestone"`, `"resolved_result_ref":"m.oseni_runes.rune_of_fire_breath"`.
Only **2 of the 20 Magic runes** are obtainable this way.

That same file also shows the aspect grid holds **6 slots**, with blanks:
`"aspect_slot_order": ["entropy","fire","","","arcane",""]` — so the hidden aspects are
spread across a 6-row grid and you cannot tell from the layout how many there are.

### 2.5.3 Lost Knowledge Fragment (input file is broken — see §2.8)

| Declared input | Possible projects | Weight | Chance |
|---|---|---|---|
| `m.research.lost_fragment` | `seithr_essence` | 1.0 | 67% |
| | `decarian_codex` | 0.5 | 33% |

### 2.5.4 Unknown Research Paper (`RARE_RESEARCH_PAPER`) — the lore lottery

One paper, **13 possible projects**, rolled at start. Total weight 13.4.

| Project | Weight | Chance | Aspects and required points | Total pts | Reveal after | Reward |
|---|---|---|---|---|---|---|
| The Cervalic Order | 1.1 | 8.2% | order 4, knowledge 6, arcane 5, conflict 3 | **18** | 3 | `cr_the_cervalic_order` |
| Mitlan, the Water Plane | 1.1 | 8.2% | water 7, entropy 5, conflict 5, time 3 | **20** | 3 | `cr_mitlan_the_water_plane` |
| The Reclamation | 1.1 | 8.2% | protection 4, nature 4, order 4, time 4 | 16 | 3 | `cr_the_reclamation` |
| Vestanger | 1.1 | 8.2% | creation 5, wealth 7, sustenance 3, earth 3 | **18** | 3 | `cr_vestanger` |
| The Petty Mage Guild | 1.0 | 7.5% | sensation 2, knowledge 4, magic 4, entropy 3 | 13 | 3 | `cr_the_petty_mage_guild` |
| The Imperial Arcane Academy | 1.0 | 7.5% | arcane 4, knowledge 4, magic 4 | 12 | 2 | `cr_the_imperial_arcane_academy` |
| The Oseni Loyalists | 1.0 | 7.5% | conflict 4, fire 4, entropy 4 | 12 | 2 | `cr_the_oseni_loyalists` |
| Seithr Essence | 1.0 | 7.5% | exchange 3, water 3, sustenance 3, ice 3 | 12 | 3 | `cr_seithr_essence` |
| Malice Crawlers | 1.0 | 7.5% | beast 3, necromancy 5, conflict 3 | 11 | 2 | `cr_malice_crawlers` |
| The Crown of Servitude | 1.0 | 7.5% | spirit 3, wealth 3, necromancy 3, order 3 | 12 | 3 | `cr_the_crown_of_servitude` |
| Arcane Instability | 1.0 | 7.5% | arcane 5, entropy 4, exchange 4 | 13 | 2 | `cr_arcane_instability` |
| Arcanum Fever | 1.0 | 7.5% | arcane 5, death 5, exchange 3 | 13 | 2 | `cr_arcanum_fever` |
| The Decarian Wasteland | 1.0 | 7.5% | void 2, arcane 4, entropy 4, earth 2 | 12 | 3 | `cr_the_decarian_wasteland` |

All rare rewards are `<#55ffaa>Completed Thesis` items (`CR_*` in
`MMOItems/item/research.yml`), right-clicked to "unlock their secrets".

Note **Mitlan, the Water Plane** (20 points, needs water 7) and **Vestanger** (18 points,
needs wealth 7) are the two hardest; **Malice Crawlers** (11) is the easiest.

### 2.5.5 Decarian Codex

| Declared input | Project | Aspects | Total | Reveal after | Reward |
|---|---|---|---|---|---|
| `m.research.r_` (the **generic** Research Paper template) | `decarian_codex` | `destruction` 6, `fire` 3, `arcanum` 4 | 13 | 2 | `c_arcane_crystal` |

**Two of its three aspects do not exist.** See §2.8.

## 2.6 Where the raw inputs come from

| Item | Source |
|---|---|
| **Lost Knowledge Fragment** (`RESEARCH:LOST_KNOWLEDGE_SCRAP`) | 1. Mining with the `professions.lucky_miner` permission: **0.2%** per ore block (`TFMCCore/drops.yml:444`). 2. Tree gathering with `professions.tree_gatherer_4`: **0.1%** per log (`TFMCCore/drops.yml:666`). 3. **Geiger counter digs** — appears in the common, rare and epic tiers of several dig lists (`geiger_counter/config.yml`, e.g. lines 130, 163, 216, 226-227, 287, 297-298; some tiers list it twice, doubling its odds). 4. **Dungeon loot** (`MythicDungeons/loottables.yml` around line 95, weight 4 in that table). |
| **Staff Runestone** (`LOOT:STAFF_RUNESTONE`) | Also the icon item of Dowsing's Artifact Mine; exact drop source not determined here. |
| Ignitium, Bronze Ingot, Abyssalite, Mythril, Elderwood, Demonwood, Arcane Crystal, Enchanted Dust, Denars, Infusion Ticket, Sword/Wand/Staff/Armor Runestones | Ordinary server economy/professions — each is simply combined with Parchment Paper. |
| **Alchemy Powder** | Required for every single Parchment Paper. This is the true entry gate to the whole system. |

## 2.7 Player command table (Research)

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | Research registers exactly one command, `/research`, and it requires `research.admin` (`default: op`). |

**There is no player command in Research at all.** The entire system is played by
shift-right-clicking a Cartography Table and right-clicking a Lectern.

### Admin/staff commands EXCLUDED
`/research reload` — permission `research.admin`, `default: op`.
(`config.yml: station.permission: ""` means **no permission is required to use a
lectern**, which is the only permission knob that affects players.)

## 2.8 Features configured but INERT or BROKEN (Research)

These are config-level defects found by cross-checking ids. Each one would send a wiki
reader after something that does not work.

1. **The Lost Knowledge Fragment research input points at a non-existent item.**
   `Research/inputs/lost_knowledge_fragment.yml` declares
   `start_item: m.research.lost_fragment`, but the MMOItems id is `LOST_KNOWLEDGE_SCRAP`
   (`MMOItems/item/research.yml:49`). A grep for `LOST_FRAGMENT` across
   `C:\Users\MSI\Desktop\plugins` returns **nothing**. So **you cannot start a research
   project by putting a Lost Knowledge Fragment in a lectern** — the two projects it
   would unlock (`seithr_essence`, `decarian_codex`) are unreachable by that route.
   The fragment *does* still work as a Cartography Table ingredient for the Unknown
   Research Paper, which is almost certainly the intended use, and `seithr_essence` is
   also reachable from the rare paper. **`decarian_codex` has no working route at all.**
2. **The `decarian_codex` project references two aspects that do not exist.** Its aspects
   are `destruction`, `fire` and `arcanum`; only `fire` is defined in
   `Research/aspects/elements.yml`. The catalogue defines `entropy` (Chaos, Destruction,
   Damage) and `arcane`, not `destruction` / `arcanum`. Verified by script against all 31
   defined aspect ids.
3. **The `decarian_codex` input uses the generic paper template.**
   `Research/inputs/decarian_codex.yml` has `start_item: m.research.r_` — `R_` is the
   *unfilled template* Research Paper, not a subject-specific one. Combined with (2),
   the Decarian Codex is comprehensively broken.
4. **The Decarian Codex reward is a duplicate.** Its `result` is `m.research.c_arcane_crystal`
   — the same Completed Thesis the Arcane Crystal project gives.
5. **The Demonwood project rewards the research paper, not the thesis.**
   `Research/outputs/demonwood.yml` has `result: item: m.research.r_demonwood`, while
   `C_DEMONWOOD` exists in `MMOItems/item/research.yml:235` and is never referenced.
   As shipped, completing Demonwood hands back the paper you started with.
6. **Three research papers are handed out by Codex/ConditionalEvents but do not exist.**
   `ConditionalEvents/events/codex.yml` runs
   `mi give RESEARCH R_THE_THREE_KINGDOMS`, `mi give RESEARCH R_CALAVORN` and
   `mi give RESEARCH R_THE_CALAVORIAN_MURALS`. None of these three ids exist in
   `MMOItems/item/research.yml`, and Research has no input or output for them. The
   `RH_` / `CH_` templates (`<#aa55ff>Unknown Research Paper` / `Completed Thesis`) exist
   but have no concrete children. **These lore rewards are almost certainly failing
   silently.** High-value finding — see §3 for the Codex triggers that fire them.
7. **`bronze.yml` and `demonwood.yml` inputs omit the `weight:` key** on their single
   output. Harmless with one entry, but inconsistent.
8. **`external_modifiers: {}`** is empty — the documented
   `experiment.aspect_point_bonus_percent` hook is configured but unused.
9. **The `Study: XXXXXX` lore placeholder** is literally `XXXXXX` on every `R_*` and `C_*`
   item in `MMOItems/item/research.yml`. Either the plugin rewrites it at runtime or
   players see literal Xs. Unverified.
10. No source repository exists for Research; nothing above is confirmed against code.

## 2.9 Cross-links (Research)

| System | How Research touches it |
|---|---|
| **TFMCCore** | Owns the Mental Points / Focus pool (`TFMCCore/focus.yml`) shared with Magic, and maps the Research Station to the Cartography Table (`TFMCCore/stations.yml`). Also the `lucky_miner` / `tree_gatherer_4` profession drops of Lost Knowledge Fragments (`TFMCCore/drops.yml`). |
| **MMOItems** | Every paper, thesis and station recipe. The `RESEARCH` item type. |
| **MMOCore** | **Intelligence** lowers all three reveal thresholds; **Wisdom** and **Intelligence** speed Mental Point regen. Research Paper lore promises player EXP on completion. |
| **Magic** | The `staff_runestone` project is the only config-visible source of Magic spell runes (Ice Shard / Fire Breath). Research also studies Enchanted Dust, Arcane Crystal and Runestones — Magic's core materials. Aspect lore names (Osenis, Seithrin, Cerrith, Mitlan, Arcanum) match Magic's elements. |
| **Codex** | Every completed research registers as a Codex discovery in the `research` category; `%codex_total_discoveries_research%` drives four achievements (§3). |
| **MythicDungeons** | Dungeon loot tables drop Lost Knowledge Fragments. |
| **Geiger Counters** (`geiger_counter` plugin) | Dig loot tables drop Lost Knowledge Fragments across common/rare/epic tiers. |
| **Dowsing** | Staff Runestone is the Artifact Mine's icon item; the Artifact Mine feeds Magic. |
| **ItemsAdder** | GUI buttons `ia.mcicons:icon_confirm` / `icon_cancel`. |
| **Herborist profession** | Every Cartography Table research recipe grants 10 Herborist EXP. |

## 2.10 Uncertain / unverified (Research)

- **Exact GUI slot layout.** `Research/gui.yml` says outright: "Layout (slot numbers) is
  in plugin code (GridLayout)." Only icons, labels and colours are configurable. The live
  station file shows a 6-entry `aspect_slot_order`, which suggests 6 aspect rows.
- **How much player EXP a completed research gives.** The item lore promises EXP; no
  amount appears in any config file. **Unknown.**
- **How `resolved_output_id` is chosen** — weighted random at project start is the obvious
  reading of the `outputs:` weight lists, and the live station file is consistent with it,
  but it is not stated anywhere.
- **What "wave pulse" / `pulse_color` do** (`gui.yml: wave_pulse_default`, per-aspect
  `pulse_color`). Cosmetic feedback of some kind; behaviour is in code.
- **Whether the `Study: XXXXXX` placeholder is rewritten at runtime.**
- **What a Completed Thesis actually gives when right-clicked** ("Right Click to unlock
  its secrets..."). No config anywhere defines the payload. This is the single biggest
  gap in the Research chain — a wiki cannot say what the reward *is*.
- **Whether the six-slot grid ever shows decoy aspects.** The blanks in
  `aspect_slot_order` might be decoys or just unused rows. **Guess either way.**

---

# 3. CODEX

Deployed jar: `C:\Users\MSI\Desktop\plugins\Codex-2.9.1.jar`
Data folder: `C:\Users\MSI\Desktop\plugins\Codex\`
`plugin.yml`: `name: Codex`, `version: 2.9.1`, author **Ajneb97** — this is a
**third-party plugin** (Modrinth: "codex-rpg-discoveries"), not in-house. All the content
is server-authored config. `softdepend: [WorldGuard, WorldEdit, PlaceholderAPI,
MythicMobs, Residence]`.

## 3.1 What it is

The Codex is your in-game journal: an illustrated book of everything your character has
discovered — places, people, researched subjects, secrets and achievements — that fills
itself in as you play, and pays out MMOCore EXP for filling it.

## 3.2 How a player actually uses it

1. Type **`/codex`**. A 45-slot GUI opens titled `&8Codex &7» &8All Categories`
   (`Codex/inventory.yml: main_inventory`).
2. Five category icons sit in slots 20-24:

   | Slot | Category | GUI title |
   |---|---|---|
   | 20 | Points of Interest | `#3c44aaCodex » Points of Interest` |
   | 21 | Research | `#ffaa55Codex » Research` |
   | 22 | Characters | (characters category) |
   | 23 | Special | (special category) |
   | 24 | Achievements | (achievements category) |

   Slot 40 is a BARRIER `&7Close Codex`.
3. Click a category. Unlocked entries show as a coloured dye with their name, description
   and `&8&oDiscovered on <dd/MM/yyyy>`. Locked entries show as a **GRAY_DYE named `&c?!`**
   (achievements use `&c???`) with the lore `&7You haven't unlocked this achievement yet.`
   plus, for achievements, a **cryptic hint** — see the hint column in §3.5.
4. Clicking an **unlocked** Research, Character or Special entry runs
   `codex open %player% <sub_inventory>` and opens a multi-page lore book (e.g.
   `research_ignitium` → three pages titled `Ignitium I / II / III`).
5. Categories are paginated with Next/Previous Page player heads in slots 41 / 39.
6. When something unlocks you get a full-screen title `&a&lCODEX UPDATED` plus a centred
   chat banner and `ENTITY_PLAYER_LEVELUP` at pitch 0.1.

Progress is shown on each category icon as `&7Unlocked: %unlocked% &8[%progress_bar%&8]
&8(&7%percentage%&8)` with a 20-segment green/red bar (`Codex/config.yml:
progress_bar_placeholder`). Player data autosaves every **300 seconds**; MySQL is
**disabled** (flat files in `Codex/players/<uuid>.yml`).

## 3.3 How entries get unlocked

Codex itself has no triggers — **every unlock is a `codex unlock` console command fired
by ConditionalEvents, MythicDungeons functions, or (for Research) by right-clicking a
Completed Thesis.**

### Research entries
`ConditionalEvents/events/codex_research.yml`. Right-click a **Completed Thesis**; the
event matches on `%item_name% == Completed Thesis` plus the exact lore line
`%item_lore_line_3% == Study: <Subject>`, then:

```
- console_command: mi take RESEARCH C_IGNITIUM %player% 1
- console_command: codex unlock %player% research ignitium
```

The thesis is **consumed**. If you already own that entry you instead get
`"You have already unlocked this Research."` / `"Perhaps somebody else may be willing to
purchase it...?"` — i.e. **duplicate theses are tradeable to other players**, which is an
intended part of the economy.

### Achievements
See §3.5 for the full trigger table.

### Characters and Special
Unlock commands exist in ConditionalEvents (`codex unlock %player% special cavepaintings`
etc.); clicking them opens the lore sub-inventory.

## 3.4 Content it adds on this server

### 3.4.1 Research category — 39 defined entries across 3 pages

Page 1 (orange `#ffaa55`, the material/technique studies — each maps 1:1 to a Research
plugin project, §2.5.1):

| Codex id | Display name | Opens |
|---|---|---|
| `ignitium` | Ignitium | `research_ignitium` |
| `bronze` | Bronze | `research_bronze` |
| `abyssalite` | Abyssalite | `research_abyssalite` |
| `mythril` | Mythril | `research_mythril` |
| `elderwood` | Elderwood | `research_elderwood` |
| `demonwood` | Demonwood | `research_demonwood` |
| `enchanted_dust` | Enchanted Dust | `research_enchanted_dust` |
| `arcane_crystal` | Arcane Crystals | `research_arcane_crystal` |
| `alchemy` | Alchemy | `research_alchemy` |
| `gunpowder` | Gunpowder | `research_gunpowder` |
| `denar` | Imperial Denar | `research_denar` |
| `runestone` | Runestones | `research_runestone` |
| `gem_infusion` | Gemstone Infusion | `research_infusion` |
| `trace_detection` | Arcane Trace Detection | `research_arcane_trace_detection` |
| `arcane_instability` | Arcane Instability | (green tier, listed on page 1) |

Pages 2-3 (green `#55ffaa`, the **lore** studies — each grants **100 MMOCore main EXP**
on unlock):

`the_ancient_cerrith` (The Ancient Cerrith), `the_ancients` (The Ancients),
`the_arcanum` (The Arcanum), `arcanum_fever` (Arcanum Fever), `arcanum_souls`
(Arcanum Souls), `cerrith_cores` (Cerrith Cores), `the_cerrithian_schism`
(The Cerrithian Schism), `the_cervalic_order` (The Cervalic Order),
`the_crown_of_servitude` (The Crown of Servitude), `the_decarian_cataclysm`
(The Decarian Cataclysm), `the_decarian_wasteland` (The Decarian Wasteland),
`the_delorians` (The Delorians), `the_heroes_of_bastion` (The Heroes of Bastion),
`the_imperial_arcane_academy` (The Imperial Arcane Academy), `malice_crawlers`
(Malice Crawlers), `mitlan_the_water_plane` (Mitlan, the Water Plane),
`the_oseni_loyalists` (The Oseni Loyalists), `the_petty_mage_guild`
(The Petty Mage Guild), `the_reclamation` (The Reclamation), `the_rothil_zerratoris`
(The Rothil Zerratoris), `seithr_essence` (Seithr Essence), `the_solmyrith_empire`
(The Solmyrith Empire), `tyvanis` (Tyvanis), `vestanger` (Vestanger).

**13 of these 24 lore entries correspond to the 13 Unknown Research Paper projects in
§2.5.4.** The other 11 (`the_ancient_cerrith`, `the_ancients`, `the_arcanum`,
`arcanum_souls`, `cerrith_cores`, `the_cerrithian_schism`, `the_decarian_cataclysm`,
`the_delorians`, `the_heroes_of_bastion`, `the_rothil_zerratoris`, `the_solmyrith_empire`,
`tyvanis`) have **no matching Research project** — they must come from lore papers that
do not exist yet (see §3.6).

Each research entry opens a 27-slot lore book. Example real text
(`Codex/inventory.yml: research_ignitium`, three pages `Ignitium I/II/III`): the history
of weaponry from copper to bronze to iron, the accidental discovery of ignitium by human
mages affixing shards to weapons, and the dwarves perfecting steel by using ignitium as a
catalyst in coal coke production. `research_the_rothil_zerratoris` is four pages
describing an anti-Oseni syndicate founded in 352 AE, led by Logarothar the Narrator and
eleven Chief Wayfarers, that moved on Calavorn in 372 AE under Talyn, the Clerk.

### 3.4.2 Characters category — 25 entries

All named `#aa55ff&l<Name>`; each opens `character_<id>`:

Empress Zenyra Solithar, Logarothar the Narrator, Haldorim the Host, Armitor the Knight,
Cerrevictis the Physician, Thalorim the Squire, Servitor the Yeoman, Torvim the Miller,
Mercator the Merchant, Ancientorim the Priestess, Evocator the Summoner, Talyn the Clerk,
Cerraraxo the Parson, Deputy Godric Dannorath, Deputy Robyn Galeroot, Deputy Zisel Eidel,
God-Emperor Thalrix, Zorander Zul, Archnecromancer Erandor, The Lady of the Tower,
Sirocco Kassar, Ankala Kravaxis, Sagittarius the Planewalker, Andromeda the Planewalker,
Ramon Zentharon.

### 3.4.3 Special category — 3 entries

| Id | Display name (rendered as a dark-teal gradient) | Opens |
|---|---|---|
| `cavepaintings` | The Ancient Cerrith Murals | `special_cavepaintings` |
| `the_umbrythikon` | The Umbrythikon | `special_the_umbrythikon` |
| `the_planewalker` | The Planewalker | `special_the_planewalker` |

`special_cavepaintings` is a two-page book about the murals of Calavorn, "some of the
final remnants of the Ancient Cerrith, the progenitor race to all sapient life in the
Earth Plane", created after the Cerrithian Schism when the survivors were driven
underground — one mural depicts "an extinct beast of monumental scale, perhaps the species
to which the colossal husk in the Zerraxon Jungle belonged."

### 3.4.4 Points of Interest category — **1 placeholder**

`Codex/categories/poi.yml` contains exactly one discovery, `placeholder1`, named
`#3c44aa&lPLACEHOLDER`. See §3.6.1 — this is the most misleading thing in Codex.

## 3.5 Achievements — the full table

`Codex/categories/achievements.yml` + triggers. All achievement rewards are MMOCore main
EXP via `mmocore admin exp give %player% main <n>`.

### "Serious" achievements

| Id | Display name | Locked hint shown in GUI | MMOCore EXP | How it actually fires |
|---|---|---|---|---|
| `die` | You Died! | *Feel the cold embrace of death.* | none | `player_death`, one time (`ConditionalEvents/events/codex.yml: codex_die`) |
| `calavorn_100` | Calavorian Historian | (no hint) | **1650** | `%codex_total_discoveries_calavorn% >= 37` |
| `threekingdoms_100` | Trinitarian Traveler | *Tour the Three Kingdoms and learn their history.* | **1650** | `%codex_total_discoveries_threekingdoms% >= 12` |
| `5_research` | Scholarly Ambition | *Learn a few new things via research.* | **1650** | `%codex_total_discoveries_research% >= 5` |
| `10_research` | Rising Researcher | *Learn a handful of new things via research.* | **2750** | `>= 10` |
| `25_research` | Top of the Class | *Learn a variety of new things via research.* | **5500** | `>= 25` |
| `all_research` | The Next Lorewalker | *Learn everything there is to know from research.* | **11000** | `>= 49` |
| `event_attendee` | I Was There | *Be present during a pivotal moment in history.* | **1100** | **no trigger found** — staff-granted |
| `world_boss_1` | Demon Slayer | *Slay a lost Malice Crawler, a powerful necromantic being.* | **1650** | Right-click the SOUL_LANTERN at `-940, 181, 1698` in `TFMC_Map`; granted to **everyone within 50 blocks** (`x_world_bosses.yml: boss1_leave`) |
| `world_boss_2` | No Maidens? | *Slay the memory of a fallen Seithr warlord.* | **1650** | Right-click the SOUL_LANTERN at `-1467, 162, 1724` in `TFMC_Map`; granted to everyone within 50 blocks (`x_world_bosses.yml: boss2_leave`) |
| `starter_dungeon` | Wise Mystical Tree | *Venture into a land of natural whimsy and wonder.* | **2750** | `MythicDungeons/maps/startdungeon/functions.yml` — granted to the whole party (`%md_party_member_1..8%`) |
| `dungeon_1` | Part 8 at 10m 7s | *Cleanse an ancient stronghold of antiplanar corruption.* | **2750** | **no trigger found** |
| `minidungeon_1` | That's Not What Happened... Is It? | *Relive the events of the past through the lens of a broken machine.* | **1650** | `MythicDungeons/maps/Minidungeon_1/functions.yml` — whole party |
| `minidungeon_2` | An Act's Conclusion | *Escape an enemy camp with stolen resources in tow.* | **1650** | Right-click the SEA_LANTERN at `1340, 216, 2641` in `TFMC_Map` holding an item with CMD 60, while `%md_dungeon_name% == dungeon1` (`codex.yml: minidungeon1complete`) |
| `minidungeon_3` | Heavy Is The Crown | *Recover a treasured heirloom from a hidden royal tomb.* | **2750** | **no trigger found** |

**Total obtainable EXP from the serious achievements: 33 550** (excluding the three with
no trigger, which would add another 6 500).

### "Troll" achievements — all fire off `player_command`, one time each

These are **case-sensitive substring matches on anything you type after a command**
(`%args_substring_1-100% contains ...`). They mostly trigger from chat-style commands.

| Id | Display name | Locked hint | Trigger phrase(s) |
|---|---|---|---|
| `tf` | What Does TF Stand For? | *The great mystery of our time...* | `tf`, `TF`, `Tf`, `tf.`, `TF.` |
| `gg` | GG | *Can't win with this king...* | `gg`, `Gg`, `GG`, `gg.`, `GG.` |
| `no_u` | No U | *Stop whining, you're just bad at the game.* | `skill issue` (4 casings) |
| `find_out_ic` | Found Out | *Hey guys, what did I miss?* | `find out ic` (5 casings) |
| `erp` | #hall-of-fame | *Surely everyone reads the rules. Surely.* | `erp`, `ERP`, `Erp` |
| `if_i_speak` | Big Trouble | *I am preferential to remaining silent.* | `if i speak` (4 casings) — also plays `troll.mourinho1` |
| `hoi4` | HALLO ALLIES | *ÜLTIMATE IMBECILES!* | `hoi4`, `hoi 4`, `hoi IV` and casings — also plays `troll.geoff1` |
| `afk` | Stuck In Traffic | *brb rq.* | running `/afk` |
| `one_sex` | WHAT?!?! ONE SEX?!?! | *I hope you passed your literacy class.* | `one sex` (4 casings) |
| `tommykay` | TommyKay the DJ | *Let's call out his name!* | `tommykay` / `tommy kay` and casings — also plays `troll.tommy1` |
| `aneesh` | The Legend of Aneesh | *The man, the myth, the legend...* | `aneesh`, `Olyn`, `0lyn`, `_sly`, `Apostasy`, `fa1c` and casings |

The generic achievement unlock banner is deliberately jokey:
`&7Achievement?: %name%` … `&7&oUse &e&o/codex &7&oto witness the consequence of your
transgressions.` with a `troll.sus1` sound.

There is also a **metagaming blocker**: typing `/describe`, `/minecraft:me`,
`/minecraft:msg`, `/eme`, `/minecraft:tell` or `/minecraft:w ` is cancelled with
`&cNice try, buster.` and fires `codex unlock %player% achievements metagaming` — see
§3.6.3.

## 3.6 Features configured but INERT or BROKEN (Codex)

1. **The Points of Interest category contains a single entry literally named
   "PLACEHOLDER".** `Codex/categories/poi.yml` defines only `placeholder1`
   (`#3c44aa&lPLACEHOLDER`), and `category_poi` in `inventory.yml` shows only slot 11.
   Meanwhile `Codex/inventory.yml` still contains a fully written
   `county_justinia` sub-inventory (Feremont / Valenfort / Castelor, with keywords,
   duchy and kingdom lines) that **nothing links to**. The POI category is not usable
   content. The wiki must not promise it.
2. **The `calavorn` and `threekingdoms` categories no longer exist.** Live player files
   in `Codex/players/` are full of them — e.g. `Archbishqp` has 16 `calavorn`
   discoveries (`isle_of_dryaris`, `calavorian_sea`, `valthar_peninsula`,
   `varshroki_highlands`, `nerresine_plain`, `the_frontier`, `vyrric_isles`,
   `domenian_basin`, `arvene_plains` …) and 5 `threekingdoms` discoveries
   (`doulons`, `arves`, `faunon`, `nerresia`, `justinia`). But
   `Codex/categories/` contains only `achievements.yml`, `characters.yml`, `poi.yml`,
   `research.yml`, `special.yml`. **Those unlocks are orphaned — the player cannot see
   them in the GUI**, and the two achievements that depend on
   `%codex_total_discoveries_calavorn%` / `..._threekingdoms%` are very likely
   unreachable. ConditionalEvents still fires `codex unlock %player% threekingdoms
   justinia` and `codex unlock %player% calavorn calavorn` into a category that is not
   loaded.
3. **The `metagaming` achievement does not exist.**
   `ConditionalEvents/events/codex.yml: codex_metagaming` runs
   `codex unlock %player% achievements metagaming`, but there is no `metagaming`
   discovery in `Codex/categories/achievements.yml`. The command fails silently; the
   metagaming *block* itself still works.
4. **Three achievements have no trigger anywhere:** `dungeon_1` (Part 8 at 10m 7s),
   `minidungeon_3` (Heavy Is The Crown) and `event_attendee` (I Was There). Verified by
   grepping every `.yml` under `plugins` for `achievements <id>` outside the Codex
   category file. `event_attendee` is plausibly intentional (staff-granted at events);
   the two dungeon ones look unfinished. **`ConditionalEvents/events/x_dungeons.yml` is
   entirely commented out.**
5. **`minidungeon_1complete` is mislabelled.** The event named `minidungeon1complete`
   requires `%md_dungeon_name% == dungeon1` but grants `minidungeon_2`. Either the event
   name or the dungeon check is wrong. Worth staff confirmation.
6. **Eleven Research Codex entries have no Research project that produces them:**
   `the_ancient_cerrith`, `the_ancients`, `the_arcanum`, `arcanum_souls`, `cerrith_cores`,
   `the_cerrithian_schism`, `the_decarian_cataclysm`, `the_delorians`,
   `the_heroes_of_bastion`, `the_rothil_zerratoris`, `the_solmyrith_empire`, `tyvanis`.
   Some also appear in `codex_research.yml` unlock events (e.g. `vampirism`,
   `slightly_magic_shard`, `orca_scale`, `syrindell`, `limvidar_the_widow`,
   `tamarith_the_great_elderwood`, `legends_of_the_calavorian_sea`, `ramon_zentharon`)
   that are **not even in `Codex/categories/research.yml`** — those unlocks would fail.
7. **`all_research` requires 49 research discoveries**
   (`%codex_total_discoveries_research% >= 49`) but `Codex/categories/research.yml`
   defines **39**. As written, "The Next Lorewalker" (11 000 EXP) is **mathematically
   impossible**. This is a hard blocker and a high-value finding.
8. **Completed Thesis right-click may not match.** The ConditionalEvents conditions
   require `%item_custom_model_data% == 23` for ordinary theses and `== 25` for the
   kingdom/bundle theses, but the MMOItems definitions set
   `custom-model-data: 3.0` for every `C_*` and `5.0` for every `CR_*`
   (`MMOItems/item/research.yml`). No installed plugin was found that rewrites CMD
   (MIReplacer's config does not touch it). If ConditionalEvents reads the raw component,
   **no thesis right-click fires and the entire Research Codex category is unreachable.**
   Consistent with the evidence: **not one of the 13 live player files has a single
   `research` discovery.** I could not prove it from config alone — **this needs a
   five-minute in-game test before the wiki documents the thesis step.**
9. **`C_REVENOR`, `C_DOMENIA`, `C_SABARISSA`, `C_CALAVORN` and the `*_BUNDLE` items do not
   exist** in `MMOItems/item/research.yml`, yet `codex_research.yml` has full
   right-click handlers and bundle-opening handlers for them. Dead config.
10. **Three lore research papers are given out but do not exist as items** —
    `R_THE_THREE_KINGDOMS` (awarded for having all 9 Three Kingdoms discoveries),
    `R_CALAVORN` (awarded at 36 Calavorn discoveries) and `R_THE_CALAVORIAN_MURALS`
    (awarded for finding all four murals). See §2.8.6. The mural hunt itself is fully
    implemented — four mural locations at `390,110,2655`, `291,110,2710`,
    `2246,121,2954`, `888,102,2213` in `TFMC_Map`, each granting a LuckPerms permission
    `mural.beast` / `mural.sun` / `mural.spell` / `mural.summon` — and it ends by handing
    you a paper that does not exist.
11. `update_notify: true` and `config_version: 2` are plugin housekeeping; MySQL is off.

## 3.7 Player command table (Codex)

The jar declares only `codex` with **no permission**, so it is open to everyone.
Decompiled strings from `cx/ajneb97/commands/MainCommand.class` and
`cx/ajneb97/utils/PlayerUtils.class` show the only permission node is **`codex.admin`**,
checked by `isCodexAdmin` for the admin subcommands.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/codex` | none | Opens the Codex GUI (`main_inventory`) — the five categories and your progress. | **No permission node.** Available to every player. |
| `/codex help` | none | Prints the 2-page command list `- - - - - CODEX COMMANDS (1/2) - - - - -`. | No permission. Pages 2 lists the admin commands even for normal players. |

There are **no other player commands**. Everything else in Codex is unlocked by playing.

### Admin/staff commands EXCLUDED (permission `codex.admin`)

| Command |
|---|
| `/codex unlock <player> <category> <discovery> [true/false]` |
| `/codex resetplayer <player>/* [category] [discovery]` |
| `/codex reload` |
| `/codex open <player> <inventory>` |
| `/codex verify` |

(`/codex open` is also used **by the plugin itself** as a reward action to show a player
their lore book, so players trigger it indirectly by clicking an entry.)

## 3.8 Numbers that matter to players (Codex)

| Thing | Value |
|---|---|
| Lore research entry unlock | **100 MMOCore main EXP** each (24 lore entries = 2400 EXP if all were reachable) |
| `5_research` / `10_research` / `25_research` / `all_research` | 1650 / 2750 / 5500 / **11 000** EXP |
| `calavorn_100`, `threekingdoms_100`, `world_boss_1`, `world_boss_2`, `minidungeon_1`, `minidungeon_2` | 1650 EXP each |
| `starter_dungeon`, `dungeon_1`, `minidungeon_3` | 2750 EXP each |
| `event_attendee` | 1100 EXP |
| World boss credit radius | **50 blocks** from the lantern |
| Dungeon achievement party size | up to **8** members |
| Codex autosave | every **300 s** |
| Date format shown on entries | `dd/MM/yyyy` |
| Progress bar | 20 segments, `&a\|` filled / `&c\|` empty |

## 3.9 Cross-links (Codex)

| System | How Codex touches it |
|---|---|
| **Research** | Completed Theses are the unlock key for the whole Research category; `%codex_total_discoveries_research%` drives four achievements. Codex is also where the *lore* of every researched subject is actually read. |
| **MMOCore** | Every meaningful reward is `mmocore admin exp give %player% main <n>` into the main level track. |
| **ConditionalEvents** | Owns 100% of Codex's trigger logic (`events/codex.yml`, `events/codex_research.yml`, `events/x_world_bosses.yml`, `events/x_dungeons.yml`). |
| **MythicDungeons** | `maps/startdungeon/functions.yml` and `maps/Minidungeon_1/functions.yml` grant party-wide achievements; dungeon loot tables feed Research. |
| **MythicMobs** | Softdepend; the two world bosses ("a lost Malice Crawler", "the memory of a fallen Seithr warlord"). |
| **LuckPerms** | The mural hunt stores progress as permissions (`mural.beast/sun/spell/summon`). |
| **PlaceholderAPI** | `%codex_total_discoveries_<category>%`, `%codex_has_discovery_<cat>:<id>%`. |
| **MMOItems** | All the thesis/paper items; `mi give` / `mi take` in every unlock event. |
| **Magic** | Indirect only: the Codex lore names (Cerrith, Oseni, Seithr, Mitlan, Arcanum, the Cerrithian Schism, the planes) are the same cosmology Magic's elements use. |

## 3.10 Uncertain / unverified (Codex)

- **The custom-model-data mismatch in §3.6.8 is the biggest open question in this
  dossier.** It would invalidate the entire "right-click your thesis" step. Config
  evidence points to broken; live player data is consistent with broken; but it must be
  tested in game.
- **Whether `%codex_total_discoveries_calavorn%` returns 0 or a stored count** when the
  category file is absent. Determines whether `calavorn_100` is reachable. **Unknown.**
- **Whether the `all_research >= 49` threshold means staff intend ~10 more research
  entries**, or the number is simply stale. **Guess: stale or aspirational.**
- **Character and Special sub-inventory contents** beyond `special_cavepaintings` were not
  read line by line; only `special_cavepaintings`, `county_justinia`, `research_ignitium`
  and `research_the_rothil_zerratoris` are quoted above.
- **Whether troll achievements fire on chat or only on commands.** The event type is
  `player_command`, so plain chat should not trigger them — but this server routes RP
  speech through commands (`/me`, `/describe`, RPCharacters channels), so in practice
  they may fire from roleplay. **Unverified.**
- Codex is third-party; its GUI behaviour is as documented by Ajneb97, not by this server.

---

# 4. CROSS-SYSTEM SUMMARY FOR THE WIKI WRITER

The three plugins form one intended loop:

```
professions / dungeons / geiger digs
        -> Lost Knowledge Fragment
              -> (Cartography Table) Unknown Research Paper
                    -> (Lectern) Research minigame, costs Mental Points
                          -> Completed Thesis
                                -> (right-click) Codex lore entry + 100 MMOCore EXP
                                      -> 5/10/25/all research achievements (up to 11 000 EXP)

Staff Runestone -> (Lectern) Research -> Magic spell rune (Ice Shard / Fire Breath)
Dowsing Artifact Mine -> Magic artifact -> pedestal shrine -> aura
                                              -> Enchanted Charge -> attune a mage weapon
Mental Points (TFMCCore focus.yml, max 150, +10/h) are spent by BOTH
Research experiments and Magic meditation.
```

**The three places that loop is currently cut:**

1. **No obtainable Enchanted Charge** → no mage weapon can ever be attuned (§1.14.1).
2. **Completed Thesis right-click CMD mismatch** → Research may never register in Codex
   (§3.6.8), which would also make all four research achievements unreachable.
3. **`all_research` needs 49 entries; only 39 exist** (§3.6.7).

Each of these should be put to staff before the player wiki documents the step.
