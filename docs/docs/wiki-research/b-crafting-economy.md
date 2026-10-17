# Wiki research dossier — Crafting & Economy cluster

**Scope:** AdvancedCrafting, Gathering, Recycler, MarketBlock, DenarEconomy, ArmourShop, ExcellentCrates
**Status:** factual dossier for a wiki writer. Not player-facing prose.
**Method:** live server config folders at `C:\Users\MSI\Desktop\plugins\<Plugin>\` (read-only), plugin jars decompiled with `javap` (jars are Java 25 class files; a copy was version-patched to read them), GitHub sources cloned to `C:\Users\MSI\Desktop\plugin-src\`, and the ItemsAdder pack at `C:\Users\MSI\Desktop\plugins\ItemsAdder\contents\`.

### Source repositories

| Plugin | GitHub repo | Notes |
|---|---|---|
| AdvancedCrafting | [TF-Minecraft/AdvancedCrafting](https://github.com/TF-Minecraft/AdvancedCrafting) | |
| Gathering | [TF-Minecraft/Gathering](https://github.com/TF-Minecraft/Gathering) | |
| Recycler | [TF-Minecraft/Recycler](https://github.com/TF-Minecraft/Recycler) | |
| MarketBlock | [TF-Minecraft/MarketBlock](https://github.com/TF-Minecraft/MarketBlock) | **Not** the same plugin as BarterShops ([TF-Minecraft/BarterShops](https://github.com/TF-Minecraft/BarterShops), `net.tfminecraft.bartershops.ShopMain`), a separate installed jar with no data folder. |
| DenarEconomy | [TF-Minecraft/DenarEconomy](https://github.com/TF-Minecraft/DenarEconomy) | Facts below come from the live 0.1.8 jar. |
| ArmourShop | [TF-Minecraft/ArmourShop](https://github.com/TF-Minecraft/ArmourShop) | |
| ExcellentCrates | third-party (NightExpress) | Jar + configs only. |

### ID-prefix convention used across these plugins (TLibs item paths)

| Prefix | Meaning |
|---|---|
| `v.` | vanilla material, e.g. `v.iron_ingot` |
| `m.` | MMOItems item, `m.<TYPE>.<ID>`, e.g. `m.currency.gold_coin` |
| `ia.` | ItemsAdder item, `ia.<namespace>:<id>`, e.g. `ia.tfmc_armor:medieval_steel_red_chestplate` |
| `iab(...)` / `iaf(...)` | ItemsAdder **block** / ItemsAdder **furniture**, e.g. `iaf(tfmc:alloy_forge)` |
| `localmodel(MAT.CMD)` | vanilla material + custom model data, e.g. `localmodel(IRON_SWORD.22)` |

---

# 1. AdvancedCrafting

**Files:** `C:\Users\MSI\Desktop\plugins\AdvancedCrafting\` — `config.yml`, `ingredients.yml`, `recipes/{armor,bows,weapons}.yml`, `qualities.yml`, `crafting-hits.yml`, `hit-types.yml`, `ingredient-types.yml`, `socket-groups.yml`, `conversions.yml`, `stats.yml`, `naming-schemes/basic.yml`, `model-schemes/basic.yml`, `colour-schemes/basic.yml`. Jar: `advancedcrafting-1.1.9.jar`.

## What it is

A hands-on blacksmithing system: you pick a recipe at a Weapon Station, feed it raw materials, then physically hammer/carve the item with smithing tools — how accurately you hit decides the item's quality, stats and socket slots. A second station (the Alloy Forge) lets you invent and name your own metal alloys.

## How a player actually uses it

**A. Crafting an item (Weapon Station)**

1. Craft or find a **Weapon Station** (`iaf(tfmc:weapon_station)`, display name "Weapon Station") and place it. Vanilla crafting-table recipe (`ItemsAdder\contents\ia_tfmc\contents\base.yml`): top row 3× IRON_INGOT, middle IRON_INGOT + empty + IRON_INGOT, bottom row 3× OAK_PLANKS.
2. Right-click the station → GUI titled **`§7Select Category`** → choose Armor / Weapons / Bows (`recipe-categories.yml`) → GUI **`§7Select Recipe`** → pick a recipe. Message: `§aRecipe <name> §aselected!`. A station that already holds a recipe rejects a second one: `§cStation already has a recipe selected`.
3. Right-click the station while holding each required **ingredient** item to load it in. The recipe lists ingredient *types* and counts (e.g. `metal.4`), so you choose which metal/wood/leather to use — that choice determines the finished item's name, colour, model and stats. Rejections: `§cThis item cannot be used for crafting`, `§cThis item type is not needed for the recipe`, `§cYou already have the needed amount of this type`.
4. Right-click the station while holding each **smithing tool** to apply hits. Each ingredient you loaded contributes a required number of hits per tool (`hits:` list in `ingredients.yml`). A title on screen shows `<hit name>` and `current/needed`. Rejections: `§cThis item cannot be used for crafting hits`, `§cThis tool is not needed for this craft`, `§cYou dont need more hits with this tool`.
5. Finish the craft. Guards: `§cYou have to add all the items before smithing` and `You need to complete all the hits before finishing`.
6. Breaking the station cancels the project (`§cProject cancelled`) and drops the inserted materials.

**B. Refining a raw material (Ingredient Converter)**

Right-click an **Ingredient Converter** (`iaf(tfmc:ingredient_converter)`, display name "Ingredient Converter") holding a listed material. The plugin stamps AdvancedCrafting ingredient data onto the item (`Ingredient.buildTo`) and opens a **`§7Stat Preview`** GUI showing what stats that ingredient contributes. Vanilla recipe (`base.yml` → `advanced-crafting.yml`): row1 3× IRON_INGOT, row2 OAK_PLANKS + empty + OAK_PLANKS, row3 OAK_PLANKS + IRON_INGOT + OAK_PLANKS. If the held item has no stats matching any template: `§cThis item has no stats matching any template.`

**C. Inventing an alloy (Alloy Forge)**

1. Place an **Alloy Forge** (`iaf(tfmc:alloy_forge)`, display name "Alloy Forge"). Vanilla recipe: 8× IRON_INGOT in a ring around an empty centre (`advanced-crafting.yml`).
2. The forge needs **lava** (`AlloyManager.hasLava`) — verify placement requirements in game.
3. Right-click the forge holding ingredients to load them. The forge tracks a **Base** (`§eBase:`, shown as `§70/1` → `§71/1`) plus **Catalysts** (`§eCatalysts:`). Only ingredients with `base: true` can be the base; everything else is a catalyst. Errors: `§cThis item is not an ingredient`, `§cThis ingredient cannot be used as the base`, `§cThis ingredient is already part of the recipe`, `§cThe alloy forge cannot fit any more ingredients`, `§cbase cannot be mixed with a <type> catalyst`.
4. Forge it. Minimum: `§cYou need at least 2 ingredients to make an alloy`.
5. If the alloy recipe is new, you get a naming prompt: `§cThe naming prompt times out in 60 seconds.` Run **`/alloy name <NewName>`**. Name rules: `[a-zA-Z_]+` only — `§cName can only contain letters (A–Z) and underscores (_).`; underscores are rendered as spaces. Success: `§aNamed the new alloy <id>`. If the server runs out of free generated alloy names: `§4There were no free alloy names! Contact the admins so they can add more!`
6. A named alloy is stored server-wide in the alloy database and can then be used as a crafting ingredient by anyone.

## Quality: the exact formula (verified in bytecode)

`CraftingStation.calculatePercentage()`:

For every distinct required hit entry, let `pct = 100 × your_hits / required_hits`.

| Condition | Contribution to the score |
|---|---|
| `pct ≤ 100` | `pct` |
| `100 < pct < 200` | `200 − pct` (symmetric overshoot penalty) |
| `pct ≥ 200` | `0` |

Final quality % = `round( sum of contributions ÷ number of hit entries )`. **Hitting exactly the required number of every tool = 100%.** Both under- and over-hitting lose quality at the same rate.

### Quality tiers (`qualities.yml`)

| Threshold (%) | Display name | Internal value | Socket granted (group `gemstones`) |
|---|---|---|---|
| 0 | `§fRusted` (crude) | 1 | none |
| 50 | `§aTempered` (common) | 2 | Basic Gemstone |
| 75 | `§9Polished` (rare) | 3 | Polished Gemstone |
| 90 | `§5Gleaming` (epic) | 4 | Radiant Gemstone |
| 100 | `§6Masterwork` (legendary) | 5 | Mythical Gemstone |

Mage armour uses socket group `mage_armor_runes` instead: Minor / Lesser / Greater / Ascendant Armor Rune at common/rare/epic/legendary (`socket-groups.yml`).

`config.yml` → `max-factor: 1.2` caps the stat multiplier. `global-stat-offsets: movement_speed: 100` divides movement-speed ingredient values by 100 before applying.

## Smithing tools (`crafting-hits.yml`)

| Hit id | In-game tool name | MMOItems path | Hit type |
|---|---|---|---|
| `hit` | `§7Hit` — Hammer Tool | `m.tools.hammer_tool` | Metal |
| `small_hit` | `§7Small Hit` — Small Hammer Tool | `m.tools.small_hammer_tool` | Metal |
| `etch` | `§7Etch` — Etching Tool | `m.tools.etching_tool` | Artisan |
| `whittle` | `§7Whittle` — Whittling Tool | `m.tools.whittling_tool` | Artisan |
| `engrave` | `§7Engrave` — Engraving Tool | `m.tools.engraving_tool` | Artisan |
| `sew` | `§7Sew` — Sewing Needle | `m.tools.sewing_needle` | Artisan |

Tool display names from `plugins\MMOItems\item\tools.yml`: `<#7f7d80>Hammer Tool`, `Small Hammer Tool`, `Etching Tool`, `Whittling Tool`, `Engraving Tool`, `Sewing Needle`, `Branding Tool`.
Hit types (`hit-types.yml`): `metal` = `§7Metal`, `artisan` = `§7Artisan`, `other` = `§7Other`.

## Ingredient types (`ingredient-types.yml`)

`metal` (#9e968a), `wood` (#964B00), `crystal` (#ce89d6), `leather` (#f29857), `feather` (#faf9f7), `wool` (#ede2af), `paper` (#faf9f7), `enchanted_dust` (#FF55FF).
`config.yml` → `combinations:` allows `metal` and `wood` slots to also accept `crystal`.

## RECIPE TABLES (`recipes/*.yml`)

`%material%` in the name is replaced by the name generated from the main ingredient (see Naming below). Every recipe uses socket group `gemstones` unless noted.

### Armor (`recipes/armor.yml`)

| Recipe id | Output name | Slot | Main type | Stat template | Inputs | Socket group |
|---|---|---|---|---|---|---|
| light_helmet | Light %material% Helmet | helmet | metal | light_armor | metal ×4, feather ×4 | gemstones |
| light_chestplate | Light %material% Chestplate | chestplate | metal | light_armor | metal ×4, feather ×4 | gemstones |
| light_leggings | Light %material% Leggings | leggings | metal | light_armor | metal ×4, feather ×4 | gemstones |
| light_boots | Light %material% Boots | boots | metal | light_armor | metal ×4, feather ×4 | gemstones |
| medium_helmet | Medium %material% Helmet | helmet | metal | medium_armor | metal ×4, leather ×4 | gemstones |
| medium_chestplate | Medium %material% Chestplate | chestplate | metal | medium_armor | metal ×4, leather ×4 | gemstones |
| medium_leggings | Medium %material% Leggings | leggings | metal | medium_armor | metal ×4, leather ×4 | gemstones |
| medium_boots | Medium %material% Boots | boots | metal | medium_armor | metal ×4, leather ×4 | gemstones |
| heavy_helmet | Heavy %material% Helmet | helmet | metal | heavy_armor | metal ×4, wool ×4 | gemstones |
| heavy_chestplate | Heavy %material% Chestplate | chestplate | metal | heavy_armor | metal ×4, wool ×4 | gemstones |
| heavy_leggings | Heavy %material% Leggings | leggings | metal | heavy_armor | metal ×4, wool ×4 | gemstones |
| heavy_boots | Heavy %material% Boots | boots | metal | heavy_armor | metal ×4, wool ×4 | gemstones |
| infantry_helmet | Infantry %material% Cap | helmet | metal | infantry_armor | paper ×4, metal ×4, feather ×4 | gemstones |
| infantry_chestplate | Infantry %material% Jacket | chestplate | metal | infantry_armor | paper ×4, metal ×4, feather ×4 | gemstones |
| infantry_leggings | Infantry %material% Leggings | leggings | metal | infantry_armor | paper ×4, metal ×4, feather ×4 | gemstones |
| infantry_boots | Infantry %material% Boots | boots | metal | infantry_armor | paper ×4, metal ×4, feather ×4 | gemstones |
| mage_helmet | Mage %material% Hood | helmet | metal | mage_armor | enchanted_dust ×4, metal ×4, feather ×4 | **mage_armor_runes** |
| mage_chestplate | Mage %material% Robes | chestplate | metal | mage_armor | enchanted_dust ×4, metal ×4, feather ×4 | **mage_armor_runes** |
| mage_leggings | Mage %material% Leggings | leggings | metal | mage_armor | enchanted_dust ×4, metal ×4, feather ×4 | **mage_armor_runes** |
| mage_boots | Mage %material% Boots | boots | metal | mage_armor | enchanted_dust ×4, metal ×4, feather ×4 | **mage_armor_runes** |

Infantry recipes use `model-type: paper`, mage recipes `model-type: enchanted_dust` (these drive which model scheme the finished item gets).

### Weapons (`recipes/weapons.yml`)

| Recipe id | Output name | Type | Main type | Inputs |
|---|---|---|---|---|
| sword | %material% Sword | sword | metal | metal ×4, leather ×2, wool ×2 |
| shortswords | %material% Shortsword | shortsword | metal | metal ×4, leather ×2, wool ×2 |
| dagger | %material% Dagger | dagger | metal | metal ×4, leather ×2, wool ×2 |
| battleaxe | %material% Battleaxe | battleaxe | metal | metal ×4, leather ×2, wool ×2 |
| warhammer | %material% Warhammer | warhammer | metal | metal ×4, leather ×2, wool ×2 |
| spear | %material% Spear | spear | metal | metal ×4, leather ×2, wool ×2 |
| longsword | %material% Longsword | longsword | metal | **metal ×8**, leather ×2, wool ×2 |
| greataxe | %material% Greataxe | greataxe | metal | **metal ×8**, leather ×2, wool ×2 |
| greathammer | %material% Greathammer | greathammer | metal | **metal ×8**, leather ×2, wool ×2 |
| polearm | %material% Polearm | polearm | metal | **metal ×8**, leather ×2, wool ×2 |
| shield | %material% Shield | shield | metal | **wood ×4**, leather ×2, wool ×2 |
| banner | %material% Battle Standard | banner | metal | **wood ×4**, leather ×2, wool ×2 |

### Bows (`recipes/bows.yml`)

| Recipe id | Output name | Type | Main type | Inputs |
|---|---|---|---|---|
| shortbow | %material% Shortbow | shortbow | wood | wood ×4, feather ×4 |
| crossbow | %material% Crossbow | crossbow | wood | wood ×4, feather ×4 |
| longbow | %material% Longbow | longbow | wood | **wood ×8**, feather ×4 |

## INGREDIENT TABLE (`ingredients.yml`, 67 entries)

Columns: item path, weight, value, type, tier, MMOCore XP given, permission namespace required, and the hits each unit adds to the craft.

### Base metals & woods (`base: true` — can be an alloy base)

| Ingredient | Path | Type | Tier | Value | Wt | XP | Perm namespace | Hits added per unit |
|---|---|---|---|---|---|---|---|---|
| iron_ingot | `v.iron_ingot` | metal | 1 | 2 | 2 | crafter 2.0 | iron_smith | hit ×4, small_hit ×1 |
| steel_ingot | `m.materials.steel_ingot` | metal | 2 | 4 | 2 | crafter 4.0 | steel_smith | hit ×5, small_hit ×2 |
| bronze_ingot | `m.materials.bronze_ingot` | metal | 2 | 6 | 2 | crafter 5.0 | abyssalite_smith | hit ×1, small_hit ×5 |
| abyssalite_ingot | `m.materials.abyssalite_ingot` | metal | 3 | 8 | 2 | crafter 6.0 | abyssalite_smith | hit ×6, small_hit ×2 |
| mythril_ingot | `m.materials.mythril_ingot` | metal | 4 | 10 | 2 | crafter 8.0 | mythril_smith | hit ×3, small_hit ×5 |
| refined_barkwood | `m.materials.refined_barkwood` | wood | 1 | 2 | 2 | crafter 2.0 | iron_smith | etch ×2, whittle ×1, engrave ×1 |
| refined_maplewood | `m.materials.refined_maplewood` | wood | 2 | 4 | 2 | crafter 4.0 | steel_smith | etch ×1, whittle ×2, engrave ×1 |
| refined_elderwood | `m.materials.refined_elderwood` | wood | 3 | 8 | 2 | crafter 6.0 | abyssalite_smith | etch ×1, whittle ×1, engrave ×2 |
| refined_demonwood | `m.materials.refined_demonwood` | wood | 4 | 10 | 2 | crafter 8.0 | mythril_smith | etch ×2, whittle ×1, engrave ×3 |

### Gemstone catalysts (all weight 1, type `crystal`, model-scheme `default`, no XP/permission entry)

| Tier | Value | Gemstones (`m.gemstones.*`) | Hits added per unit |
|---|---|---|---|
| 1 | 1 | agate | hit ×3 |
| 1 | 1 | jasper | small_hit ×1 |
| 1 | 1 | onyx | etch ×1 |
| 1 | 1 | tourmaline | whittle ×3 |
| 1 | 1 | pearl | engrave ×2 |
| 1 | 1 | coral | sew ×1 |
| 1 | 1 | chrysoprase | hit ×1 |
| 1 | 1 | larimar | small_hit ×3 |
| 1 | 1 | rhodonite | etch ×3 |
| 1 | 1 | vesuvianite | whittle ×1 |
| 2 | 2 | turquoise | hit ×3, small_hit ×2 |
| 2 | 2 | peridot | hit ×1, etch ×1 |
| 2 | 2 | malachite | hit ×1, whittle ×1 |
| 2 | 2 | zircon | hit ×1, engrave ×3 |
| 2 | 2 | apatite | hit ×3, sew ×1 |
| 2 | 2 | carnelian | small_hit ×3, etch ×1 |
| 2 | 2 | labradorite | small_hit ×3, whittle ×3 |
| 2 | 2 | sardonyx | small_hit ×3, engrave ×3 |
| 2 | 2 | variscite | small_hit ×2, sew ×1 |
| 2 | 2 | wulfenite | etch ×2, whittle ×3 |
| 3 | 3 | aquamarine *(typed `metal`, not crystal — see Uncertain)* | hit ×2, small_hit ×1, etch ×1 |
| 3 | 3 | garnet | hit ×2, small_hit ×2, whittle ×2 |
| 3 | 3 | opal | hit ×1, small_hit ×1, engrave ×2 |
| 3 | 3 | tanzanite | hit ×1, small_hit ×1, sew ×2 |
| 3 | 3 | moonstone | hit ×1, etch ×2, whittle ×2 |
| 3 | 3 | sunstone | hit ×2, etch ×1, engrave ×2 |
| 3 | 3 | spinel | hit ×1, etch ×2, sew ×1 |
| 3 | 3 | alexandrite | hit ×2, whittle ×2, engrave ×1 |
| 3 | 3 | firestone | hit ×1, whittle ×1, sew ×1 |
| 3 | 3 | cloudstone | hit ×2, engrave ×1, sew ×1 |
| 4 | 4 | ruby | hit ×1, small_hit ×2, etch ×2, whittle ×2 |
| 4 | 4 | sapphire | hit ×2, small_hit ×1, etch ×2, engrave ×2 |
| 4 | 4 | topaz | hit ×1, small_hit ×2, etch ×1, sew ×1 |
| 4 | 4 | citrine | hit ×1, small_hit ×1, whittle ×2, engrave ×2 |
| 4 | 4 | morganite | hit ×2, small_hit ×1, whittle ×2, sew ×1 |
| 4 | 4 | crystallite | hit ×1, small_hit ×1, engrave ×2, sew ×2 |
| 4 | 4 | tigers_eye | hit ×2, etch ×1, whittle ×1, engrave ×2 |
| 4 | 4 | serpents_eye | hit ×1, etch ×2, whittle ×2, sew ×2 |
| 4 | 4 | musgravite | hit ×1, etch ×2, engrave ×1, sew ×1 |
| 4 | 4 | taaffeite | hit ×2, whittle ×2, engrave ×2, sew ×2 |

### Other catalysts

| Ingredient | Path | Type | Tier | Value | Wt | Hits added |
|---|---|---|---|---|---|---|
| ignitium | `m.materials.ignitium` | crystal | 3 | 2 | 2 | small_hit ×2, engrave ×3, sew ×2 |
| raw_tin | `m.materials.raw_tin` | crystal | 4 | 4 | 2 | hit ×6, engrave ×4 |
| abyssalite_fragment | `m.materials.abyssalite_fragment` | crystal | 4 | 6 | 2 | hit ×4, small_hit ×3, etch ×1, whittle ×3, engrave ×2, sew ×2 |
| mythril_fragment | `m.materials.mythril_fragment` | crystal | 4 | 8 | 2 | hit ×2, small_hit ×4, etch ×2, whittle ×2, engrave ×3, sew ×3 |

### Animal / cloth / misc components (all value 1 unless noted)

| Ingredient | Path | Type | Tier | Wt | Hits added |
|---|---|---|---|---|---|
| leather | `m.materials.leather` | leather | 1 | 1 | etch ×1, whittle ×2, sew ×2 |
| rare_leather | `m.materials.rare_leather` | leather | 2 | 1 | etch ×3, whittle ×2, sew ×1 |
| epic_leather | `m.materials.epic_leather` | leather | 3 | 1 | etch ×2, whittle ×1, sew ×3 |
| legendary_leather | `m.materials.legendary_leather` | leather | 4 | 1 | etch ×2, whittle ×2, sew ×3 |
| feather | `v.feather` | feather | 1 | 1 | etch ×2, whittle ×1, sew ×1 |
| rare_feather | `m.materials.rare_feather` | feather | 2 | 1 | etch ×2, whittle ×1, sew ×1 |
| epic_feather | `m.materials.epic_feather` | feather | 3 | 1 | etch ×1, whittle ×3, sew ×2 |
| legendary_feather | `m.materials.legendary_feather` | feather | 4 | 1 | etch ×2, whittle ×3, sew ×1 |
| wool | `v.white_wool` | wool | 1 | 1 | etch ×1, whittle ×2, sew ×3 |
| rare_wool | `m.materials.rare_wool` | wool | 2 | 2 | etch ×2, whittle ×2, sew ×2 |
| epic_wool | `m.materials.epic_wool` | wool | 3 | 1 | etch ×1, whittle ×1, sew ×3 |
| legendary_wool | `m.materials.legendary_wool` | wool | 4 | 1 | etch ×2, whittle ×1, sew ×4 |
| paper | `v.paper` | paper | 1 | **50** | value 2 | sew ×1 |
| enchanted_dust | `m.currency.enchanted_dust` (`&dEnchanted Dust`) | enchanted_dust | 1 | **50** | value 2 | sew ×1 |

## Permission gating (profession tiers)

`config.yml` → `permission-prefix: professions.`, and `ProfessionPermissions.fullPermission` builds the node as **`<prefix><namespace>_<tier>`** — i.e. `professions.iron_smith_1`, `professions.steel_smith_2`, … `professions.mythril_smith_4`. Namespaces and their GUI display strings (`config.yml`):

| Namespace | Display | Gates |
|---|---|---|
| `ingredient` | `#e6a817Ingredient` | ingredient conversion |
| `iron_smith` | `#e6a817Iron_Smith` | iron ingot, refined barkwood |
| `steel_smith` | `#e6a817Steel_Smith` | steel ingot, refined maplewood |
| `abyssalite_smith` | `#e6a817Abyssalite_Smith` | bronze ingot, abyssalite ingot, refined elderwood |
| `mythril_smith` | `#e6a817Mythril_Smith` | mythril ingot, refined demonwood |
| `alloy` (`alloy-permission-namespace`) | — | alloy tiers |

Failure messages: `§cYou need the <namespace> tier <n> permission to use this material.` and `§cYou need at least one of the <namespace> permissions.` These are LuckPerms nodes granted by staff/progression, **not** something a player can self-grant.

## Naming, colour and model schemes

- `naming-schemes/basic.yml` — a crafted item's `%material%` name is drawn from a per-type name pool: **metal** (42 names: Ferranite, Blackiron, Bloodsteel, Ironshade, Grimcore, Starsteel, Vulcrite, Dragonsmelt, Echosteel, Umbralloy, Abyssium, Tenebron, Nocturnite, Obscurium, Celestium, Mythbane, Whitesilver, Lunathril, Ferrasteel, Ironclast, Steelcore, Rustbane, Fabulite, Grayshard, Voidiron, Nethersteel, Blackcore, Ironveil, Dreadmetal, Mythiron, Brightiron, Darksteel, Stygmetal, Abyssforge, Gloomiron, Moonsteel, Gleamsteel, Mythsteel, Shinesilver, Shadowmyth, Aetherbound, Eclipsium), **wood** (40 names: Ironbark, Stonebark, … Voidgrain, Sinwood), **crystal** (40 names: Soulglass, Crystalflare, … Starcrystal).
- `colour-schemes/basic.yml` — scheme `mixed` uses item `m.crafting.alloy` with custom-model-data 6–53 and a 48-entry hex palette; scheme `wood` is used for wood.
- `model-schemes/basic.yml` — per-material model sets. Example `iron`: sword `v.iron_sword.0`, battleaxe `v.iron_axe.4`, dagger `v.iron_sword.4`, warhammer `v.iron_shovel.2`, spear `v.iron_hoe.2`, polearm `v.iron_hoe.6`, greathammer `v.iron_shovel.6`, longsword `v.iron_sword.8`, greataxe `v.iron_axe.8`, armour = chainmail. `steel` → iron armour + `.1/.5/.3/.7/.9` weapon models; `bronze` reuses steel armour with `iron_sword.22/23/24`, `iron_axe.12/13`, `iron_shovel.14/15`, `iron_hoe.3/8`; `abyssalite`, `mythril`, `barkwood`, `maplewood`, `elderwood`, `demonwood`, `infantry`, `mage` schemes also exist. `default` is intentionally empty (catalysts get no model).

## Stat templates (`stats.yml`, 328 lines)

Each item type has a template naming which MMOItems stats it can roll and optional multipliers. Examples: `sword` (`§fSword`, icon `m.sword.steel_sword`, base `attack_speed(1.6)`, stats: attack_damage, attack_speed, physical_damage, magic_damage, spell_vampirism, lifesteal, max_item_damage); `battleaxe` adds `movement_speed` and factor `attack_damage: 0.90`; `dagger` adds `critical_strike_chance` and factor `attack_damage: 0.90`. `config.yml` maps 27 internal stat keys to display names (`stat-aliases`), e.g. `max_item_damage→Durability`, `blunt_rating→Blunt Rating`, `pvp_damage_reduction→PvP Damage Reduction`.

## Content it adds

| Thing | ID | Display name | Source |
|---|---|---|---|
| Weapon Station (crafting station) | `iaf(tfmc:weapon_station)` | "Weapon Station" | `ia_tfmc/contents/base.yml` |
| Alloy Forge | `iaf(tfmc:alloy_forge)` | "Alloy Forge" | `ia_tfmc/contents/advanced-crafting.yml` |
| Ingredient Converter | `iaf(tfmc:ingredient_converter)` | "Ingredient Converter" | `ia_tfmc/contents/advanced-crafting.yml` |
| Scrap (failure/leftover item) | `crafting.scrap` → MMOItems `SCRAP` | `&8Unusable Scrap` (IRON_INGOT, CMD 5) | `MMOItems/item/crafting.yml`; `config.yml` `scrap-path` |
| Branding tool | `m.tools.skin_branding_tool` | `<#7f7d80>Branding Tool` | `config.yml` `branding-tool` |
| GUIs | — | `§7Select Category`, `§7Select Recipe`, `§7Stat Preview` | `CraftingManager`/`InventoryManager` |

`conversions.yml` lists the 67 item paths the Ingredient Converter recognises and the ingredient id each maps to.

## Player command table (no permission node required)

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/alloy name <NewName>` | none | Names the alloy you just discovered at the forge | **No permission check anywhere** — verified in `CommandManager.onCommand` bytecode: the `alloy`/`name` branch calls `AlloyManager.nameAlloy` directly with no `AdminPermissions.require`. `plugin.yml` declares no `permission:` on the `alloy` command. Name must match `[a-zA-Z_]+`; underscores become spaces; 60-second prompt window. Errors if you have no pending alloy: `§cYou have no alloy to name`. |

There are **no other player commands**. All actual gameplay is block interaction, not commands.

### Admin/staff commands excluded — all require `advancedcrafting.admin` (`plugin.yml`, default `op`)

Each of these calls `AdminPermissions.require(sender)` (confirmed individually in bytecode):

| Command | Purpose |
|---|---|
| `/ac reload` | Reload configs (`[AdvancedCrafting] Reload complete.`) |
| `/ac sync recipes [repair]` | Rebuild alloy recipe index |
| `/ac refresh` | Recompute stats on the held crafted item (`§aItem stats refreshed.` / `§7No changes applied.` / `§cHold a crafted AdvancedCrafting item.`) |
| `/ac inspect` | Dump craft provenance of the held item |
| `/ac give alloy <id> [player]` | Give an alloy item |
| `/ac info alloy <id>` | Print alloy info |
| `/ac craft <percent>` | Force a craft at a chosen quality — "Right-click the crafting station with all materials ready (30s)." |

## Numbers that matter to players

- Quality thresholds: 0 / 50 / 75 / 90 / 100 % → Rusted / Tempered / Polished / Gleaming / Masterwork.
- Overshoot penalty is symmetric: 150 % of required hits scores the same as 50 %.
- `max-factor: 1.2` — ceiling on the stat multiplier.
- Ingredient tiers 1–4; base metal values 2/4/6/8/10; woods 2/4/8/10; gemstone values 1/2/3/4 by tier.
- MMOCore `crafter` XP per base ingredient: iron 2.0, steel 4.0, bronze 5.0, abyssalite 6.0, mythril 8.0 (woods: 2.0 / 4.0 / 6.0 / 8.0).
- Alloy naming prompt: 60 seconds. Admin force-craft prompt: 30 seconds.
- Alloys need a base (`base: true` ingredient) + at least 1 catalyst; minimum 2 ingredients total.

## Cross-links

- **MMOItems / MythicLib** — hard dependency; all crafted output is an MMOItem built from a template (`template:` key), and stats are written via `MMOStatApplicator`.
- **MMOCore** — hard dependency; grants `crafter` profession XP per ingredient (`xp: crafter(n)`).
- **TLibs** — item/block resolution (`iab()`, `iaf()`, `v.`, `m.`, `ia.` paths) and the socket-tier-group registry that socket names must match.
- **ItemsAdder** — the three station furniture items and their vanilla crafting recipes.
- **LuckPerms** — `professions.*_<tier>` nodes gate every base material.
- **Thievery** — `Utils/ThieveryBridge` class exists in the jar (interaction not investigated).
- **Recycler** — has a dedicated `AdvancedCraftingProvider` that reads `CraftProvenance` off crafted items to refund their original ingredients/alloys.
- **ArmourShop** — skins are applied on top of AdvancedCrafting output; `base-sets.yml` explicitly lists `*_custom_*` templates (the AC output templates) as skinnable bases.

## Uncertain / unverified (AdvancedCrafting)

- The Alloy Forge calls `hasLava(Player)` and runs a `tickCycle()` — the forge appears to need lava and to smelt over time, but the exact lava requirement (bucket in hand vs. lava under the block) and the cycle duration were not confirmed.
- How the finished item is actually claimed from the station (click the result in the GUI vs. auto-drop) was not confirmed; `drop()` / `drop(int)` methods exist.
- The `scrap-path: crafting.scrap` item is configured but no code path referencing `scrapPath` was found in the jar — it may be unused in 1.1.9.
- `stats.yml` is 328 lines; only the first few templates were transcribed. The full per-type stat lists should be read directly if the wiki needs them.
- `aquamarine` is declared `type: metal` / `scheme: metal` while every other gemstone is `crystal` — likely a config typo, but it is what is live.
- `data/revisions.json` (stat-template revision tracking) was not analysed.
- Alloy stat math (`BucketStatAverager`, `MajorityTierResolver`, `StatTemplateMath`) — how an alloy's stats are derived from its base + catalysts — was not decoded.

---

# 2. Gathering

**Files:** `C:\Users\MSI\Desktop\plugins\Gathering\` — `config.yml`, `categories.yml`, `spot-types.yml`, `Data/spots.json`, `Data/chunk-cache.json`. Jar: `gathering-0.1.0-ALPHA.jar` (version string `0.1.0-ALPHA`).

## What it is

Hidden gathering spots spawn in the wild; your character notices them when you walk close enough, and then you right-click to harvest loot.

## How a player actually uses it

1. Spots spawn automatically on eligible blocks inside the configured world region. They are **invisible until discovered**, and discovery is tracked **per RP character**, not per account (`GatheringSpot.discoveredByCharacter` is a `Map<UUID,Long>` keyed by RPCharacter UUID; `CharacterBridge.getActiveCharacter(Player)`).
2. Walk near one. Every **12 seconds** the plugin rolls passive discovery for players within **6.0 blocks** (`config.yml` → `passive-discovery`). On success you get: `&7*You notice something glinting nearby...*`
3. A discovered spot shows a particle ring (radius 0.45, refreshed every 10 ticks).
4. **Right-click** the spot block to gather (`SpotGatherHandler.onInteract`). Loot is rolled from the spot type's weighted categories and kicked out as items with a small velocity. If nothing is there: `§cNothing to gather here.`
5. The spot is consumed and its chunk goes on cooldown.

### Discovery chance formula (`SpotDiscoveryService.computeChance`, config values)

`base-chance: 0.06` per 12-second tick, plus:
- `wisdom-weight: 0.02` per point of Wisdom
- `intelligence-weight: 0.015` per point of Intelligence
- `profession.level-weight: 0.01` per level of the **herbalism** profession (`profession.enabled: true`, `profession.id: herbalism`)

(The attribute/profession terms are read from RPCharacters and MMOCore; the exact combination — additive vs. multiplicative — was not decoded, only the weights.)

## Content it adds (as currently configured)

### Spot types (`spot-types.yml`) — **only one is defined**

| Spot type | Biomes | Y range | Spawn block | Max active | Chunk cooldown | Profession | Category rolls |
|---|---|---|---|---|---|---|---|
| `forest-herbs` | FOREST, BIRCH_FOREST, DARK_FOREST | 60–300 | `GRASS_BLOCK` | 3 | 10 minutes | herbalism | `money` weight 8 → 1-2 drops; `money` weight 2 → 1 drop |

### Drop categories (`categories.yml`)

Line format is `"<path> <min>-<max> <weight>"`.

| Category | Entries | Notes |
|---|---|---|
| `common-herbs` | `v.emerald 1-2` w5; `v.emerald 1-3` w3 | **Not referenced by any spot type** |
| `rare-herbs` | `v.emerald 2-4` w4; `v.diamond 1-1` w1 | **Not referenced by any spot type** |
| `money` | `m.currency.stack_of_coins 2-4` w4 | The only category actually in use |

So in the live configuration the **only** thing a Gathering spot can ever give is **2–4 Stack of Gold Denars** (`m.currency.stack_of_coins`, `&6Stack of Gold Denars`, worth 10 denars each → 20–40d per drop roll, 1–2 rolls).

### Spawn parameters (`config.yml`)

| Setting | Value |
|---|---|
| `spawn-interval-minutes` | `010` (10) |
| `chunk-cooldown-minutes` | `4320` (3 days) |
| `spawn-attempts-per-tick` | 3 |
| `probe-column-attempts` | 12 |
| World region | world `world`, chunk X 0–400, chunk Z 0–400 |
| Particle interval / ring radius | 10 ticks / 0.45 |
| Gather kick velocity | 0.42–0.78 vertical, 0.015–0.045 horizontal, `burst-particles: false` |

### Live data

`Data/spots.json` is currently `[]` — **zero spots exist on the server right now**. `Data/chunk-cache.json` holds the per-chunk cooldown/exclusion cache (`ChunkCacheDatabase` with `CacheData` and `ExcludedChunk` records).

Spot record fields (`GatheringSpot`): `id` (UUID), `world`, `blockX`, `blockY`, `blockZ`, `spotTypeId`, `spawnBlockMaterial`, `spawnedAtMs`, `discoveredByCharacter` (map of character UUID → timestamp).

## Player command table

**Empty.** Gathering exposes no player-usable command. `plugin.yml` declares one command, `/gathering`, with `permission: gathering.admin` (default `op`), and the only permission node found in the jar is `gathering.admin`.

### Admin commands excluded (all `gathering.admin`)

| Command | What it does |
|---|---|
| `/gathering reload` | `§aGathering configs reloaded.` |
| `/gathering clearcache [world]` | `§aCleared excluded chunk cache for world …` / `§aCleared all excluded chunk caches.` |
| `/gathering status` | `§6Gathering status:` + active spots / chunks on cooldown / excluded chunks |
| `/gathering forcespawn <spotType> [chunkX chunkZ]` | Force a spot; errors `§cUnknown spot type:`, `§cChunk already has an active spot.`, `§cNo valid surface in chunk` |
| `/gathering adminmode <on\|off>` | Toggles admin mode (makes spots visible/manipulable) |

## Cross-links

- **RPCharacters** (hard dependency) — discovery is per active RP character; Wisdom/Intelligence attributes feed the discovery chance.
- **MMOCore** (soft dependency) — `herbalism` profession level feeds discovery chance.
- **TLibs** (hard dependency) — item path resolution (`v.`, `m.` paths in `categories.yml`).
- **DenarEconomy** — indirectly: the only configured loot is denar coin items.

## Uncertain / unverified (Gathering)

- Whether a **tool** is required to gather — no tool check was found; it appears to be a bare right-click, but this was not confirmed against the `onInteract` bytecode in detail.
- Exact arithmetic combining base chance + attribute weights + profession bonus.
- Whether gathering awards MMOCore herbalism XP (no XP call was located, unlike AdvancedCrafting).
- `max-active: 3` — unclear whether this is per world, per biome, or per spot type globally.
- The plugin is labelled `0.1.0-ALPHA` and currently has 0 live spots, 1 spot type, and 2 of its 3 loot categories unused. It may not be live content yet — confirm with staff before writing a player guide.

---

# 3. Recycler

**Files:** `C:\Users\MSI\Desktop\plugins\Recycler\` — `config.yml`, `gui.yml`, `messages.yml`, `recipes/example.yml`. Jar: `recycler-0.1.0.jar`.

## What it is

A station that breaks an item back down into a share of the materials it was made from — the more worn the item, the less you get back.

## How a player actually uses it

1. Place / find a **Recycling Station**: `iaf(tfmc:recycling_station)`, display name **"Recycling Station"** (`ItemsAdder\contents\ia_tfmc\contents\base.yml`; note it reuses the `furniture/armor_station` model). Vanilla crafting-table recipe: row1 3× IRON_INGOT, row2 empty + empty + IRON_INGOT, row3 3× OAK_PLANKS.
2. Right-click it (sound `block.stone_button.click_on`). A **27-slot (3×9) GUI** opens.
3. **Slot layout is hardcoded** (`GridLayout.class`, constants read directly):

| Slot | Role |
|---|---|
| `0` | **Confirm** button — icon `ia.mcicons:icon_confirm` |
| `10` | **Input** slot — drop the item to recycle here |
| columns `4`–`8` (slots 4–8, 13–17, 22–26) | **Preview** of what you would get back |
| arrow slots | `ia.mcicons:icon_right_gray` |
| remaining slots in columns 0–2 | filler, `v.gray_stained_glass_pane` |

4. Put an item in the input slot. Accepted → `entity.item_frame.place` sound; rejected → `entity.villager.no` + `§cThat item cannot be recycled here.` (not recyclable) or `§cThat item cannot be deposited here.` (blocked by deposit policy).
5. The preview refreshes (`block.grindstone.use`). If the result would be nothing: `§cNothing would be returned from recycling this item.` and, because `block_confirm_when_zero_yield: true`, the confirm is blocked.
6. Click confirm (`block.anvil.use`) → `block.anvil.land` + CRIT particles, outputs are spawned and kicked out of the station, and you get `§aRecycling complete.`
7. Items left in the station are escrowed and returned: `§7Your item was returned from the recycling station.`

## How the yield is calculated

`outputs = floor( base_outputs × max_return_rate × durability_factor )`

- `max_return_rate: 0.8` → **80 %** of the original materials at full durability (`config.yml`).
- `durability_factor` (`DurabilityScaler.factor`): for MMOItems, `clamp(MMOITEMS_CUSTOM_DURABILITY / MMOITEMS_MAX_DURABILITY, 0..1)`; falls back to the vanilla durability ratio; `1.0` for items with no meta.
- Outputs are rounded **down** (floor), and a zero result is refused.

## What can be recycled — the provider chain

Four providers, tried in priority order (`provider/` package):

| Provider | Handles | How it resolves outputs |
|---|---|---|
| `AdvancedCraftingProvider` (priority 10) | Any item carrying AdvancedCrafting `CraftProvenance` | Walks the recorded `CraftInput` list; `kind = "ingredient"` → refunds that ingredient path × amount; `kind = "alloy"` → expands the alloy back into its constituent ingredients |
| `GunsAndGadgetsProvider` | GunsAndGadgets weapons | not decoded |
| `ConfigProvider` | Items listed in `recipes/*.yml` | Explicit input → output list |
| `RecycleProviderChain` | — | Orchestrates the above |

### Config recipe format (`recipes/example.yml`) — this is the **only** config recipe file present

```yaml
recipes:
  iron_sword:
    input: v.iron_sword          # TLibs path, matched by ItemChecker
    outputs:
      - v.iron_ingot 2           # "<path> <amount>" lines
```

So the only hand-written recipe on the server is **Iron Sword → 2 Iron Ingots** (before the 0.8 × durability scaling, i.e. 1 ingot at full durability since `floor(2 × 0.8 × 1.0) = 1`). Everything else that is recyclable is recyclable because it was made by AdvancedCrafting or GunsAndGadgets.

## Deposit policy (`config.yml`)

| Setting | Value | Effect |
|---|---|---|
| `deposit.whitelist_mode` | `false` | Blacklist mode |
| `deposit.whitelist_paths` | `[]` | — |
| `deposit.blacklist_paths` | `[]` | Nothing explicitly banned |
| `deposit.block_unbreakable` | `true` | Unbreakable items are refused |

## Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | Recycler has **no player command**. |

**`recycler.use` has `default: true`** in `plugin.yml` ("Allows using the recycling station"), so **every player has it by default** — it is the node checked by `config.yml` → `station.permission: recycler.use` when you right-click the station. It is a *usage* permission, not a command.

### Admin commands excluded

| Command | Permission | What it does |
|---|---|---|
| `/recycler reload` | `recycler.admin` (default `op`) | `§a[Recycler] Reloaded configs.` / `§c[Recycler] Reload failed - check console.` |

## Numbers that matter to players

- **80 %** maximum material return (`max_return_rate: 0.8`), multiplied by the item's remaining durability fraction, then **rounded down**.
- A fully-broken item returns nothing and the confirm button is blocked.
- Result items are flung out with velocity 0.09–0.19 vertical / 0.01–0.03 horizontal, trail for 140 ticks, staggered 3 ticks apart.
- No cooldown or per-use cost is configured.

## Cross-links

- **ItemsAdder** (hard dependency) — the station furniture and GUI icons (`mcicons`).
- **TLibs** (hard dependency) — item path matching.
- **AdvancedCrafting** (soft dependency) — the primary source of recyclable items, via `CraftProvenance`.
- **GunsAndGadgets** (soft dependency) — gun recycling.
- **MMOItems / MythicLib** (soft dependency) — custom durability NBT drives the return rate.
- Fires a `RecycleCompleteEvent` other plugins can listen to.

## Uncertain / unverified (Recycler)

- `GunsAndGadgetsProvider` output logic was not decoded.
- Whether a left-click or right-click opens the station (an interact listener exists; right-click is assumed from the `open` sound config).
- Whether the station is per-player or shared state while open (an `EscrowManager` exists, implying items are held server-side).
- No `messages.yml` entry exists for "no permission", so what a player without `recycler.use` sees is unconfirmed.

---

# 4. MarketBlock

**Files:** `C:\Users\MSI\Desktop\plugins\MarketBlock\` — `config.yml`, `categories.yml`, `quests.yml`, `quest-tiers.yml`, `trades/*.json` (33 files). Jar: `marketblock-0.0.1.jar` (`plugin.yml` `version: 1.0`).

## What it is

A shop block that buys raw materials off you for denars, at a price that sags the more of that material the market has already absorbed and slowly recovers over time.

## How a player actually uses it

1. Find a **Market Block**: `iaf(tfmc:market_block)`, display name **"Market Block"** (`ia_tfmc/contents/base.yml`). Vanilla crafting recipe: row1 INK_SAC + PAPER + OAK_PLANKS, row2 3× OAK_PLANKS, row3 OAK_PLANKS + empty + OAK_PLANKS.
2. Right-click it → GUI **`§7Market Categories`**, showing the 5 categories.
3. Click a category → GUI **`§7Trades`**, listing that category's trades in the 28 slots configured in `config.yml` (`slots: [10..16, 19..25, 28..34, 37..43]`). Each trade icon shows the item, its current price, and a coloured **demand bar** (`DemandFormatter`, interpolated hex colour).
4. Click a trade to **sell**. The plugin checks you have the full bundle (`§cYou don't have enough items for this trade.`), removes exactly `amount` of that item, pays you `calculatePrice(trade)` denars via `DenarEconomy.getMoneyManager().addMoney(...)`, plays a sound, and drops the market's demand for that item.
5. There is a **Back** button (`§cBack`).

**MarketBlock is sell-only.** There is no buy path in `TradeManager.tradeClick`.

## The price formula (verified in `PriceCalculator.calculatePrice`)

```
half  = demandLimit / 2
price = max( 0.01 , round( restingPrice × (demand / half) × 100 ) / 100 )
```

Because every live trade has `demand = demandLimit = 20`, `half = 10`, so **the current price of every trade is exactly 2 × its resting price** — until someone sells into it.

### Demand movement

| Event | Effect | Source |
|---|---|---|
| A player sells one bundle | `demand −= min(1.0, random() × priceChange)` (i.e. a random 0–1 drop with `priceChange: 1`), floored at `1.0` | `Trade.sell()` |
| Recovery tick | `demand += max(1.0, random() × 7)` (so **1–7 per tick**), capped at `demandLimit` | `Trade.demand()` |
| Recovery interval | **72 000 ticks = 1 hour** | `TradeManager.start()` → `runTaskTimer(..., 72000L)` |
| Admin `/marketblock reset <id>` | `demand = demandLimit / 2` | `Trade.resetDemand()` |

Net effect for players: prices fall as the market is flooded (down to a floor of `restingPrice × 0.1`, i.e. `demand=1`), and recover fully within a couple of hours of being left alone.

## TRADE TABLE (`trades/*.json`, all 33 files)

All trades currently have `demand limit: 20`, `demand: 20`, `price change: 1`, `group: 0`.
**Current price = resting × 2** (see formula). The price is for the **whole bundle**, not per item.

| Trade id | Item | Bundle size | Resting price (d) | Current price (d) | Price per item (d) | Category |
|---|---|---|---|---|---|---|
| wheat | `v.WHEAT` | 32 | 1 | 2 | 0.0625 | Farming |
| carrots | `v.CARROT` | 64 | 1 | 2 | 0.031 | Farming |
| potatoes | `v.POTATO` | 64 | 1 | 2 | 0.031 | Farming |
| beetroot | `v.BEETROOT` | 64 | 1 | 2 | 0.031 | Farming |
| melon_slice | `v.MELON_SLICE` | 16 | 1 | 2 | 0.125 | Farming |
| pumpkin | `v.PUMPKIN` | 16 | 2 | 4 | 0.25 | Farming |
| sugar_cane | `v.SUGAR_CANE` | 32 | 1 | 2 | 0.0625 | Farming |
| honey | `v.HONEY_BOTTLE` | 16 | 4 | 8 | 0.5 | Farming |
| honeycomb | `v.HONEYCOMB` | 16 | 4 | 8 | 0.5 | Farming |
| salt | `m.ingredients.salt` | 32 | 2 | 4 | 0.125 | Farming |
| spiceleaf | `m.ingredients.spice_leaf` | 8 | 4 | 8 | 1.0 | Farming |
| tobacco | `ia.iasurvival:tobacco` | 4 | 2 | 4 | 1.0 | Farming |
| coal | `v.coal` | 32 | 3 | 6 | 0.1875 | Mining |
| copper | `v.COPPER_INGOT` | 32 | 3 | 6 | 0.1875 | Mining |
| iron_ingot | `v.IRON_INGOT` | 16 | 4 | 8 | 0.5 | Mining |
| redstone | `v.REDSTONE` | 64 | 1 | 2 | 0.031 | Mining |
| lapis_lazuli | `v.LAPIS_LAZULI` | 32 | 5 | 10 | 0.3125 | Mining |
| amethyst | `v.AMETHYST_SHARD` | 4 | 1 | 2 | 0.5 | Mining |
| diamond | `v.DIAMOND` | **1** | 2 | 4 | **4.0** | Mining |
| tin | `m.materials.raw_tin` | 12 | 8 | 16 | 1.33 | Mining |
| oak_wood | `v.OAK_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| spruce_wood | `v.SPRUCE_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| birch_wood | `v.Birch_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| jungle_wood | `v.JUNGLE_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| acacia_wood | `v.ACACIA_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| darkoak_wood | `v.DARK_OAK_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| mangrove_wood | `v.MANGROVE_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| cherry_wood | `v.CHERRY_LOG` | 32 | 1 | 2 | 0.0625 | Woodcutting |
| cod | `v.COD` | 16 | 3 | 6 | 0.375 | Fishing |
| salmon | `v.SALMON` | 16 | 4 | 8 | 0.5 | Fishing |
| string | `v.string` | 32 | 6 | 12 | 0.375 | Other |
| silk | `m.materials.silk` | 4 | 2 | 4 | 1.0 | Other |
| enchanted_dust | `m.currency.enchanted_dust` | 8 | 6 | 12 | 1.5 | Other |

**Best denars-per-item right now:** Diamond (4.0 d each), Enchanted Dust (1.5 d), Raw Tin (1.33 d), Spice Leaf / Tobacco / Silk (1.0 d).

## Categories (`categories.yml`)

| Id | Display name | Icon |
|---|---|---|
| `farming` | `#b3d177Farming` | `v.wheat` |
| `mining` | `#ad9084Mining` | `v.iron_ingot` |
| `woodcutting` | `#a3702fWoodcutting` | `v.oak_log` |
| `fishing` | `#7fb2d4Fishing` | `v.cod` |
| `other` | `#d8d8d8Other` | `v.string` |

## Quests — **configured but NOT implemented**

`quests.yml` contains a single key, `max-fulfillment: 100`. `quest-tiers.yml` defines 5 tiers. However **`QuestLoader.class` in the jar has no methods at all** (only a default constructor), and no quest-related string appears anywhere else in the jar. **There is no quest gameplay in this build.** The tier data is recorded here only so a future wiki page is not blindsided:

| Tier | Display name | Weight | Item factor | Scaling | Reward count | Reward pool |
|---|---|---|---|---|---|---|
| common | `#8da88cCommon` | 80.0 | 0.1 | −0.2 | 1–2 | money 2–9; `m.materials.bark` 1–2; `m.materials.salt` 2–3; `v.diamond` 1–3 |
| uncommon | `#43d18aUncommon` | 14.0 | 0.3 | — | 1–3 | money 12–29; bark 6–9; salt 7–12; diamond 4–8 |
| rare | `#6060dbRare` | 4.0 | 0.3 | — | 1–3 | same as uncommon |
| epic | `#9c27d6§lEpic` | 1.4 | 0.3 | — | 1–3 | same as uncommon |
| legendary | `#f2992c§lLegendary` | 0.6 | 0.3 | — | 1–3 | same as uncommon |

(Weights total 100.0. Note the rare/epic/legendary reward pools are identical to uncommon — almost certainly unfinished.)

## Player command table

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none intended)* | — | — | See the warning below. |

**`/marketblock` is a staff tool, but the jar contains ZERO permission checks.** `grep -r hasPermission` over the entire `marketblock-0.0.1.jar` returns nothing, and `plugin.yml` declares the `marketblock` command with **no `permission:` key and no `permissions:` section**. Bukkit therefore lets any player run every subcommand:

| Command | Effect if a player runs it |
|---|---|
| `/marketblock reload` | Reloads MarketBlock configs |
| `/marketblock add` | Starts a chat conversation to create a new trade from the held item (`§aPlease enter the trade ID in chat:`; requires a non-air item: `§cYou must hold an item in your hand to add a trade.`) |
| `/marketblock delete <id>` | Deletes a trade from the database permanently |
| `/marketblock reset <id>` | Resets one trade's demand to `limit / 2` |
| `/marketblock resetall` | Resets every trade's demand |
| *(no args)* | `§cUsage: /marketblock add OR /marketblock delete <id>` |

**Flag this to the server owner before publishing anything about it.** For the wiki, the player-facing answer is "MarketBlock has no player commands — you use the block"; the command list above should be treated as staff-only *by convention*, not by enforcement.

## Numbers that matter to players

- Current price = **2 ×** the listed resting price for every trade (all demand is at cap).
- Selling drops demand by a random **0–1** per bundle; price floor is `restingPrice × 0.1` (demand clamped at 1).
- Demand recovers **1–7 points every hour**, capped at 20 — a fully drained trade recovers in roughly 3–19 hours.
- Minimum possible price: **0.01 d**.
- All payouts go into your **pouch**, subject to DenarEconomy taxation (see below).

## Cross-links

- **DenarEconomy** (hard dependency) — payouts call `MoneyManager.addMoney(player, price, ..)`, which fires `PlayerEarnMoneyEvent` and applies tax.
- **TLibs** (hard dependency) — item path resolution.
- **ItemsAdder** — the Market Block furniture; `ia.iasurvival:tobacco` is an ItemsAdder crop.
- **MMOItems** — `m.ingredients.salt`, `m.ingredients.spice_leaf`, `m.materials.silk`, `m.materials.raw_tin`, `m.currency.enchanted_dust`.
- **AdvancedCrafting** — raw tin and enchanted dust are also AdvancedCrafting ingredients, so the market competes with crafting for them.

## Uncertain / unverified (MarketBlock)

- `Trade.sell()` contains leftover **debug code**: it calls `Bukkit.getPlayer("drefvelin")` and sends that player two messages with the demand value before and after every sale. If "drefvelin" is offline this is a null dereference risk. Not player-facing, but worth reporting.
- `group: 0` on every trade — the `group` field's purpose (paging? shared demand pools?) was not determined.
- The GUI lore format for a trade icon (exact price/demand-bar text) was not transcribed; `DemandFormatter` renders a bar with an interpolated hex colour and a fixed `TOTAL_BARS` count that was not read.
- Whether the demand recovery task also persists to `trades/*.json` on a schedule, or only on shutdown.
- `config.yml` has only `slots` and `market-block` — no configurable tax, cooldown, or per-player sell limit exists.

---

# 5. DenarEconomy

**Files:** `C:\Users\MSI\Desktop\plugins\DenarEconomy\` — `coins.yml`, `drops.yml`, `messages.yml`, `PlayerData\<uuid>.json` (32 player files). Jar: `denareconomy-0.1.8.jar`. Source (outdated): `plugin-src\denareconomy`.

## What it is

The server's money system: gold and silver **denars** that exist both as real coin items you can carry and drop, and as a pouch/bank balance.

## The two accounts

Every player has two balances (`PlayerData\<uuid>.json`):

```json
{ "id": "<uuid>",
  "pouch": { "amount": 30.00, "taxable": true },
  "bank":  { "amount": 0.00,  "taxable": false } }
```

- **Pouch** — carried money. `taxable: true`. **Dropped in full on death** unless you keep it (see below).
- **Bank** — stored money. `taxable: false`. Safe on death. Deposits/withdrawals require a faction bank chunk.

## Currency table (`coins.yml`)

| Coin id | Item | Display name (`MMOItems\item\currency.yml`) | Value in denars | Withdrawable |
|---|---|---|---|---|
| `gold_pouch` | `m.currency.pouch_of_coins` | `&6Pouch of Gold Denars` | **100.0** | yes |
| `gold_stack` | `m.currency.stack_of_coins` | `&6Stack of Gold Denars` | **10.0** | yes |
| `gold_handful` | `m.currency.handful_of_coins` | `&6Handful of Gold Denars` | **5.0** | yes |
| `gold_denar` | `m.currency.gold_coin` | `&6Gold Denar` | **1.0** | yes |
| `silver_stack` | `m.currency.silver_coin10` | `&6Stack of Silver Denars` | **0.1** | yes |
| `silver_handful` | `m.currency.silver_coin5` | `&6Handful of Silver Denars` | **0.05** | yes |
| `silver_coin` | `m.currency.silver_coin` | `&6Silver Denar` | **0.01** | yes |
| `gold_ingot` | `v.gold_ingot` | (vanilla Gold Ingot) | **1.0** | **no** (`withdraw: false`) |

**Conversions:** 1 Gold Denar = 100 Silver Denars. 5 Silver = a Handful of Silver. 10 Silver = a Stack of Silver. 5 Gold = a Handful of Gold. 10 Gold = a Stack of Gold. 100 Gold = a Pouch of Gold. Money is tracked to **2 decimal places** (all arithmetic goes through `round(x × 100) / 100`).

A vanilla **Gold Ingot picked up off the ground is worth 1 denar**, but you can never withdraw one from your balance.

- **Picking up any coin item** cancels the vanilla pickup, removes the item, and credits your pouch (`MoneyManager.pickupCoin`). Coins carry PDC keys `chained`, `chained_to`, `silent`, `customValue`, `nonstack` — large drops are chained item entities that get cleaned up together.
- The currency symbol in all messages is a lowercase **`d`** rendered in gold (`#b39122<amount>#dbaf1dd`).

## Earning money

**Block-break drops (`drops.yml`)** — breaking these blocks has a chance to drop coins directly:

| Block | Chance | Denars |
|---|---|---|
| `stone` | 3 % | 0.5 – 1.0 |
| `deepslate` | **10 %** | 0.5 – 1.0 |
| `oak_log`, `spruce_log`, `birch_log`, `jungle_log`, `acacia_log`, `dark_oak_log`, `mangrove_log`, `cherry_log` | 8 % each | 0.2 – 0.4 |
| `wheat`, `carrot`, `potato`, `beetroot` | 4 % each | 1.0 – 1.5 |

Other income routes: selling at a **Market Block**, **Gathering** spots (which drop `stack_of_coins`), and anything else that calls `MoneyManager.addMoney`.

**Tax:** `MoneyManager.doTaxes` fires a `PlayerEarnMoneyEvent` that other plugins (SimpleFactions) can modify; the earn message shows `#dbaf1d+#b39122<amount>#dbaf1dd` followed by `#44524f(<tax> in tax)` when tax was taken. The **tax rate itself is set by SimpleFactions, not by DenarEconomy** — it is not in any DenarEconomy config file.

## Death

`MoneyManager.onPlayerDeath` → `PouchDeathPolicy.shouldDropPouch(keepPouch, keepInventory)`:

| Condition | Result |
|---|---|
| Player has the `simplefactions.keep-pouch` metadata | Pouch kept |
| Otherwise, `keepInventory` is on | Pouch kept |
| Otherwise | **Entire pouch is zeroed and dropped as coin items at the death location** |

The **bank balance is never lost on death.**

## Player command table (no permission node required)

`plugin.yml` declares `deco` and `pouch` with **no `permission:` keys and no `permissions:` section**, and `CommandManager` in the 0.1.8 jar contains **no `hasPermission` call whatsoever**. Every subcommand below is available to every player.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/pouch` | none | Spawns a floating hologram above you showing your pouch balance (`&6Balance: <amount>d`) for 100 ticks (5 s) | **5-second cooldown** (`POUCH_COOLDOWN_MILLIS = 5000`); on cooldown: `&cWait <n>s before using that again.` Shows `&6Showing <amount>d...` |
| `/deco bal` | none | Prints both balances: `Current Pouch Balance: <x>d` and `Current Bank Balance: <y>d` | — |
| `/deco pay <amount>` | none | Drops that amount out of your pouch as physical coin items for someone else to pick up | `MoneyManager.pay`. Errors: `&cNo amount specified`, `&cInvalid amount` |
| `/deco toitem <amount>` | none | Converts pouch balance into coin **items** in your inventory, using the largest denominations first (`amountToItems`) | Skips any coin with `withdraw: false` — you can never get gold ingots out. Error: `Not enough funds in pouch` |
| `/deco deposit <amount>` | none | Moves pouch → bank | Requires being **in a faction** AND standing **inside your faction's bank chunk**. Errors: `&cNeed to be in a faction to use the banking system`, `&cYour faction has no bank chunk`, `&cYou need to be in your faction's bank chunk to deposit/withdraw`, `Not enough funds in pouch`. Prints a Bank Report and plays `BLOCK_NOTE_BLOCK_CHIME` |
| `/deco withdraw <amount>` | none | Moves bank → pouch | Same faction bank-chunk requirements; `Not enough funds in bank` |
| `/deco baltop` | none | Top balances leaderboard: `========== [Balance Top <limit>] ==========` then `<rank> <name> - <amount>d` | Amount formatted `%.2f`. The `limit` value is read from the database query, not from a config file |
| *(bad input)* | — | `&cUnknown subcommand or wrong usage.` | — |

Tab completion offers `bal, pay, toitem, deposit, withdraw, baltop` and `<amount>` as the second argument.

### Admin/staff commands excluded

**None exist.** DenarEconomy 0.1.8 ships no admin command and no permission node. Balance manipulation is done through the API (`addMoneyToAccount`, `changeBal`, `getServerBal`) by other plugins.

## Numbers that matter to players

- Denominations: 0.01 / 0.05 / 0.1 / 1 / 5 / 10 / 100 denars (silver coin → gold pouch).
- Money is kept to 2 decimals.
- `/pouch` cooldown 5 s, hologram lasts 5 s.
- Coin drop chances while mining/farming: deepslate 10 %, logs 8 %, crops 4 %, stone 3 %.
- Death: 100 % of the pouch, 0 % of the bank.
- Tax percentage: **set by SimpleFactions — not in DenarEconomy config.**

## Cross-links

- **SimpleFactions** — banking requires a faction and a claimed **bank chunk**; the `simplefactions.keep-pouch` metadata protects the pouch on death; SimpleFactions applies tax through `PlayerEarnMoneyEvent`.
- **MMOItems / MythicLib** (hard dependency) — all coin items are MMOItems.
- **TLibs** (hard dependency) — item resolution and hex formatting.
- **MarketBlock**, **Gathering** — income sources.
- Exposes events other plugins hook: `PlayerEarnMoneyEvent`, `PlayerBankPulseEvent`, `PlayerDepositMaterialsEvent`.
- `EconomyBridge` (`economy-bridge-1.2.0.jar`) is installed and likely exposes denars to Vault-style consumers — **not verified**.

## Uncertain / unverified (DenarEconomy)

- The **tax rate** and when it applies (only faction-taxed income? all income?) — governed by SimpleFactions, outside this dossier's scope.
- `/deco baltop` row limit is not in any config file that was found.
- `MoneyManager.depositMaterials` listens for a right-click with a specific material and only fires `PlayerDepositMaterialsEvent` — the actual "deposit materials" behaviour is implemented in another plugin (likely SimpleFactions). What the player holds/clicks was not determined.
- `PlayerBankPulseEvent` — purpose not determined.
- Whether `/deco pay` targets a player or just drops coins on the ground: the 0.1.8 signature is `pay(Player, double)` with no target argument, so it drops coins. Confirm in game.
- The role of the `taxable` flag on each account beyond pouch-true / bank-false.

---

# 6. ArmourShop

**Files:** `C:\Users\MSI\Desktop\plugins\ArmourShop\` — `config.yml`, `categories.yml`, `base-sets.yml`, `permission-groups.yml`, `Categories\*.yml` (43 files), `pack\grip_templates\*.json`, `pending-reload.yml`. Jar: `armourshop-1.1.2.jar`. Source: `plugin-src\armourshop` (commit `b1462f1`, 2026-07-13).

## What it is

A cosmetic wardrobe: open a menu, spend a Skin Scroll, and restyle the armour or weapon you are carrying without changing a single one of its stats.

## How a player actually uses it

1. Run **`/armourshop`** with no arguments. GUI **`§7Armourshop Type`** opens with two choices: **Armour skins** (slot 0) and **Item skins** (slot 1), each lored `§7Armour skins` / `§7Item skins` + `#21de21Click to View`.
2. Pick one → GUI **`§7Armourshop Categories`**. Each category icon is lored `§a<n> §eArmor Sets` or `§a<n> §eItems`. Slot 53 is the back button. **Categories you lack the permission for are skipped entirely** (`InventoryManager` lines 47–58) — you never see them.
3. Click a category → a paged GUI titled with the category's own display name. Navigation: **slot 3 = previous page**, **slot 4 = back to categories**, **slot 5 = next page**. Skins are laid out on the slots in `config.yml` → `start-points` (armour: 9,18,27,36,45,14,23,32,41,50) / `item-start-points` (40 slots). Each skin icon is lored `§eTier: §f<BaseSet>` and, when a scroll is required, `§7Scroll: <scroll display name>`. **Skins you lack the permission for are hidden** (line 90).
4. Click a skin to apply it. The plugin:
   - If the skin needs a **scroll**, it searches your whole inventory for that scroll. Missing → `§cLacking Scroll` + villager-no sound, nothing happens.
   - Scans your inventory for the **first item that matches the skin's base set** for that armour slot / item type (`BaseSet.contains(item, type)`). None → `§cNo item to apply skin on in your inventory` + villager-no sound.
   - Merges the skin onto that item via `TLibs ArmorMerger.merge(item, optionalName, skinPath)` — the item keeps its stats; only appearance (and, for `add-name: true` skins, the display name) changes.
   - **Consumes 1 scroll** and plays `ENTITY_PLAYER_LEVELUP`.
5. To revert, use the **"Reset to Default"** category (`a_default`), whose 7 entries are free (no scroll, no permission) and map each tier back to its vanilla/base look.

## Skin categories (`categories.yml` + `Categories\*.yml`)

**Total: 297 skin definitions across 43 category files.**

### Armour categories (`a_*`)

| File id | Display name | Colour | Icon | Sets | Scroll required | Permission gated |
|---|---|---|---|---|---|---|
| `a_default` | Reset to Default | #7F7D80 | `v.iron_chestplate` | 7 | **0 — free** | no |
| `a_medieval` | Medieval | #d0b37f | `ia.tfmc_armor:medieval_steel_blue_chestplate` | 32 | 24 | no |
| `a_forest` | Forest | #275c03 | `ia.tfmc_armor:forestman_steel_chestplate` | 3 | 3 | no |
| `a_hraftar` | Hraftar | #61d99d | `ia.tfmc_armor:hraftar_steel_chestplate` | 3 | 3 | no |
| `a_pirate` | Pirate | #7f3a33 | `ia.tfmc_armor:pirate_steel_chestplate` | 4 | 4 | no |
| `a_samurai` | Samurai | #ea7812 | `ia.tfmc_armor:samurai_steel_chestplate` | 5 | 5 | no |
| `a_imperial` | Imperial | #c9b86a | `ia.tfmc_armor:imperial_steel_chestplate` | 3 | 3 | no |
| `a_original_rothil_zerratoris` | Original Rothil Zerratoris | #a12a23 | `ia.tfmc_armor:original_rothil_zerratoris_medium_steel_chestplate` | 15 | 15 | no |
| `a_rothil_zerratoris` | Rothil Zerratoris | #3c44aa | `ia.tfmc_armor:rothil_zerratoris_medium_steel_chestplate` | 15 | 0 | **yes — `armourshop.rothil_zerratoris`** (on the category *and* all 15 sets) |
| `a_miscellaneous` | Miscellaneous Sets | #67777d | `ia.tfmc_armor:dwarven_chestplate` | 5 | 5 | no |
| `a_infantry` | Infantry Sets | #ffaa55 | `ia.tfmc_armor:line_red_chestplate` | 11 | 11 | no |
| `a_mage` | Mage Sets | #ff55ff | `ia.tfmc_armor:mage_steel_chestplate` | 2 | 2 | no |
| `a_wildmagic` | Wild Mage Sets | gradient #12c2e9→#c471ed→#df4ff6 | `ia.tfmc_armor:devotee_of_the_tower_chestplate` | 4 | 4 | no (an `armourshop.wildmagic` permission line is **commented out**) |
| `a_s1factions` | Tricontinental Faction Sets | gradient #12c2e9→#3b4e60→#9b967b | `ia.tfmc_armor:threadholm_mage_chestplate` | 4 | 4 | no |
| `a_s2factions` | Decarian Faction Sets | gradient #c9b86a→#ab19b1→#3d5662 | `ia.tfmc_armor:aemg_chestplate` | 1 | 1 | no |
| `a_s3factions` | Urcerrithian Faction Sets | gradient #682029→#2f2386→#302530 | `ia.tfmc_armor:white_raven_brotherhood_chestplate` | 1 | 1 | no |
| `a_s4factions` | Calavorian Faction Sets | gradient #722b22→#274d70→#3d6841 | `ia.tfmc_armor:drakhanate_imperialist_steel_chestplate` | 15 | 15 | no |
| `a_legacy` | Legacy Sets | #704214 | `ia.tfmc_armor:legacy_decorated_iron_chestplate` | 12 | 12 | no |
| `ps_armor` | Player Armor | #a0a0a0 | `ia.tfmc_armor:medieval_steel_yellowpurple_chestplate` | **0** (empty — filled by player submissions) | — | per-submission |

### Item categories (`i_*`, all `is-item: true`, colour #7f7d80)

| File id | Display name | Icon | Skins | Scroll required |
|---|---|---|---|---|
| `i_helmets` | Helmets | `m.helmets.helmet` | 23 | 23 |
| `i_shields` | Shields | `m.shields.steel_shield` | 23 | 23 |
| `i_mage_staffs` | Mage Staffs | `m.mage_staffs.mage_steel_staff` | 11 | 11 |
| `i_mage_wands` | Mage Wands | `m.mage_wands.mage_steel_wand` | 10 | 10 |
| `i_longswords` | Longswords | `m.longswords.steel_longsword` | 9 | 9 |
| `i_polearms` | Polearms | `m.polearms.steel_polearm` | 9 | 9 |
| `i_swords` | Swords | `m.sword.steel_sword` | 8 | 8 |
| `i_daggers` | Daggers | `m.daggers.steel_dagger` | 7 | 7 (1 also permission-gated) |
| `i_warhammers` | Warhammers | `m.warhammers.steel_warhammer` | 6 | 6 |
| `i_longbows` | Longbows | `m.longbows.maplewood_longbow` | 5 | 5 |
| `i_tools` | Tools | `m.miscellanea.steel_tools` | 5 | 5 |
| `i_battleaxes` | Battleaxes | `m.battleaxes.steel_battleaxe` | 4 | 4 |
| `i_consumables` | Consumables | `m.consumables.major_health_potion` | 4 | 4 |
| `i_greataxes` | Greataxes | `m.greataxes.steel_greataxe` | 3 | 3 |
| `i_greathammers` | Greathammers | `m.greathammers.steel_greathammer` | 3 | 3 |
| `i_spears` | Spears | `m.spears.steel_spear` | 3 | 3 |
| `i_shortbows` | Shortbows | `m.shortbows.maplewood_shortbow` | 3 | 3 |
| `i_crossbows` | Crossbows | `m.miscellanea.maplewood_crossbows` | 3 | 3 |
| `i_battle_standards` | Battle Standards | `m.banners.maplewood_banner` | 3 | 3 |
| `i_shortswords` | Shortswords | `m.shortswords.steel_shortsword` | 1 | 1 |
| `i_mage_blades` | Mage Blades | `m.mage_swords.mage_steel_sword` | 1 | 1 |
| `i_guns` | Guns | `m.guns.rifle_template` | **0** (the only entry is commented out) | — |
| `ps_items` | Player Items | `m.sword.iron_sword` | 11 | 0 — **all 11 permission-gated** (`armourshop.submission.<id>`) |

### Scroll cost distribution (across all categories)

| Scroll | MMOItems id | Display name | Number of skins requiring it |
|---|---|---|---|
| Common Item Skin Scroll | `m.loot.common_item_skin_scroll` | `&aCommon Item Skin Scroll` | **83** |
| Rare Item Skin Scroll | `m.loot.rare_item_skin_scroll` | `&9Rare Item Skin Scroll` | **76** |
| Legendary Item Skin Scroll | `m.loot.legendary_item_skin_scroll` | `&6Legendary Item Skin Scroll` | **50** |
| Epic Item Skin Scroll | `m.loot.epic_item_skin_scroll` | `&5Epic Item Skin Scroll` | **47** |

(`config.yml` → `scrolls:` lists these four with labels Common / Rare / Epic / Legendary, synced to the TFMCWeb catalog.)

### Example skin entries

```yaml
# Categories/a_medieval.yml — armour set, free tier
medieval_red_leather:
  name: "Red Levy"
  colour: "#a21919"
  set: leather                       # base set it can be applied to
  helmet: ia.tfmc_armor:medieval_leather_red_helmet
  chestplate: ia.tfmc_armor:medieval_leather_red_chestplate
  leggings: ia.tfmc_armor:medieval_leather_red_leggings
  boots: ia.tfmc_armor:medieval_leather_red_boots

# Categories/a_medieval.yml — same family, higher tier, costs a scroll
medieval_red_steel:
  name: "Red Soldier"
  set: steel
  scroll: m.loot.common_item_skin_scroll
  ... ia.tfmc_armor:medieval_steel_red_*

# Categories/i_swords.yml — weapon skin using a local model
gilded_sword:
  name: "Gilded Sword"
  colour: "#b79829"
  set: swords
  scroll: m.loot.epic_item_skin_scroll
  item: localmodel(IRON_SWORD.29)

# Categories/ps_items.yml — a player-submitted skin
drefvelin_great_knife_bro:
  name: Great Knife Bro
  colour: ['#555555', '#ff5555', '#aa0000']
  styles: [bold, italic]
  add-name: true                     # applying it renames the item
  set: knives
  permission: armourshop.submission.drefvelin_great_knife_bro
  item: ia.tfmc_submissions:drefvelin_great_knife_bro
```

Named tiers visible in `i_swords.yml` (scroll cost ladder): Bronze Sword / Gladius Sword (common) → Tribal Sword / Broken Sword (rare) → Gilded Sword / Cutlass (epic) → A.E.M.G Sword / Drakhanate Sword (legendary).

### Base sets (`base-sets.yml`)

A base set is the list of item templates a skin can legally be merged onto. Sets observed: `leather`, `iron`, `steel`, `abyssalite`, `mythril`, `mage`, `infantry`, plus item sets `swords`, `knives`, `rifles`, etc. Example — `iron` accepts `helmets.light/medium/heavy_chainmail_helmet` **and** `helmets.light/medium/heavy_custom_helmet` (the AdvancedCrafting output templates), with the equivalent lists for chestplate/leggings/boots; `steel` accepts `*_steel_*` plus the same `*_custom_*` templates. **This is the direct bridge between AdvancedCrafting and ArmourShop: player-forged `custom` gear is skinnable by every tier's skins.**

## Donator / rank entitlements (`permission-groups.yml`)

This governs **uploading your own skin** through TFMCWeb, not browsing the shop.

| Group | Tier | LuckPerms node | Display name | Name-colour stops | Skin-token cooldown | Skin kinds unlocked (cumulative up the tiers) | 3D armour helmet |
|---|---|---|---|---|---|---|---|
| *(default)* | — | — | — | 0 | **−1 = cannot mint skin tokens** | none | no |
| noble | 1 | `rpchar.group.noble` | Noble (blue gradient) | 1 | **28 days** | handheld, large_handheld, bow, large_bow, crossbow, book | no |
| gilded | 2 | `rpchar.group.gilded` | Gilded (orange gradient) | 2 | **21 days** | + armor_set | no |
| ascended | 3 | `rpchar.group.ascended` | Ascended (purple gradient, bold) | 20 | **14 days** | + item_3d, shield, helmet_3d, gun | **yes** |
| legacy | 4 | `rpchar.group.legacy` | Legacy (green gradient, bold) | 20 | **7 days** | (inherits all lower tiers) | **yes** |

Defaults: `max-3d-pair-bytes: 30720` (30 KB combined texture+model budget), `name-colour-stops: 0`. Resolution rules are documented in the file header: skin-kinds are the **union** of all groups at or below your tier; cooldown and `allow-armor-3d-helmet` come from **your** tier; integer perks take the **max** across matching groups. Staff mint (`skin_staff`) bypasses cooldown, kinds and the armour-3D-helmet gate.

Player skin submissions land in `Categories/ps_armor.yml` and `Categories/ps_items.yml` and are gated by `armourshop.submission.<id>` — i.e. only the submitter (and anyone granted the node) sees their own skin.

## Player command table (no permission node required)

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/armourshop` | none | Opens the skin shop (`§7Armourshop Type` → categories → skins) | Verified in the 1.1.2 jar: the `args.length == 0` branch calls `InventoryManager.typeView(player)` with **no** `Permissions.isAdmin` check. Players-only (console falls through). |

`plugin.yml` declares only `armourshop.admin` with **`default: false`**, so no player has it.

### Admin/staff subcommands excluded — all call `Permissions.isAdmin` (`armourshop.admin`, default false)

| Command | What it does |
|---|---|
| `/armourshop reload` | Reload configs. Denied: `§a[ArmourShop] §cYou do not have access to this command` |
| `/armourshop token create …` | **Redirects:** `[ArmourShop] Use /token create skin (TFMCWeb) instead.` |
| `/armourshop token delete <code>` | Delete a skin token (`Deleted token …`, `Could not delete token.`) |
| `/armourshop listtokens` | `Fetching active tokens…` → `Active tokens (<n>):` or `No active unused tokens.` |
| `/armourshop pack pull` | `Pulling approved skins…`; guards with `Pack pull already running.` |
| `/armourshop pack sync` | `Syncing pending-reload queue from TFMCWeb…` → `Pending-reload synced: <n> → <n> id(s) (approved, not yet applied).` |
| `/armourshop catalog sync` | `Syncing catalog to TFMCWeb…` → `Catalog synced: categories=<n> skin_sets=<n> scrolls=<n>` |
| `/armourshop submission delete <id>` | `Deleting submission…` |
| `/armourshop skin delete <id>` | `Deleting staff skin…` |

## Numbers that matter to players

- **297** skin definitions across 43 categories; 256 of them cost a scroll.
- Scroll cost tiers: Common (83 skins), Rare (76), Epic (47), Legendary (50). **1 scroll consumed per application.**
- The "Reset to Default" category (7 entries) is **free**.
- Applying a skin **never changes item stats** — it is purely cosmetic (stat-preserving `ArmorMerger.merge`).
- Rank skin-token cooldowns: Noble 28 d, Gilded 21 d, Ascended 14 d, Legacy 7 d; non-ranked players cannot mint tokens at all.
- 3D model budget: 30 KB combined texture+model for all ranks by default.
- `config.yml` → `pack-apply.force-reload-time: "06:00"` — approved skins are pulled into the resource pack daily at 06:00 server time, with a 5-second delay between `/iareload` and `/iazip`.

## Cross-links

- **ItemsAdder** (hard dependency) — every armour skin is an `ia.tfmc_armor:*` item; submissions land in `ia.tfmc_submissions:*`; the plugin writes into `plugins/ItemsAdder/contents` and triggers `/iareload` + `/iazip`.
- **TFMCWeb** (hard dependency) — issues skin tokens; `/token create skin` lives there.
- **TFMCWeb** (this repo) — the web catalog ArmourShop syncs categories/skin sets/scrolls to, and pulls approved player submissions from (`api/ProvinceSystemClient`, `api/GatewayClient`).
- **LuckPerms** (soft dependency) — `rpchar.group.*` rank nodes, `armourshop.rothil_zerratoris`, `armourshop.submission.<id>`; `pack/shop/LuckPermsGrant` grants nodes on purchase.
- **MMOItems / MythicLib** (soft dependency) — base item templates and scroll items.
- **AdvancedCrafting** — `base-sets.yml` lists the `*_custom_*` templates, i.e. player-forged gear, as skinnable.
- **GunsAndGadgets** — `config.yml` → `pack-apply.guns-skins-yml` writes gun skins into `plugins/GunsAndGadgets/skins.yml`.
- **RPCharacters** — shares the same `rpchar.group.*` entitlement nodes.

## Uncertain / unverified (ArmourShop)

- How a player **obtains** skin scrolls (loot? crates? shop?) is not defined in any ArmourShop file — they are MMOItems `m.loot.*` items. The `ExcellentCrates` section below and MythicMobs loot tables are the likely sources; not confirmed.
- The **full skin list per category** was not transcribed — only counts, scroll-cost tallies, and representative entries. The wiki writer should read `Categories\*.yml` directly if per-skin tables are needed (297 rows).
- `pending-reload.yml` was not read.
- `pack/grip_templates/{grip_top,grip_middle,grip_bottom}.json` relate to 3D handheld model generation; not analysed.
- Whether applying a skin is reversible for free in all cases (the `a_default` category has 7 entries covering leather/iron/steel/abyssalite/mythril/mage/infantry, so a player on a base set outside that list may have no free reset).
- `a_wildmagic` has its permission line commented out — currently open to everyone; may be unintentional.
- `i_guns` is an empty category that will still render in the menu with `§a0 §eItems`.

---


# 7. ExcellentCrates

**Files:** `C:\Users\MSI\Desktop\plugins\ExcellentCrates\` — `config.yml`, `engine.yml`, `crates/{festive_crate,voting_crate,voting_crate_1,voting_crate_2,voting_crate_3,war_crate}.yml`, `keys/{candy_key,vote,vote_1,vote_2,vote_3,war_key}.yml`, `menu/default.yml`, `previews/default.yml`, `ui/{confirmation,crate_open_amount,crate_open_costs}.yml`, `openings/` and `openingsv2/` animation configs, `milestones.yml`, `lang/lang_en.yml` (2063 lines), `data.db` (SQLite), `openings.log`. Jar: `ExcellentCrates-6.6.1.jar` (`su.nightexpress.excellentcrates.CratesPlugin`, third-party, developer NightExpress). Hard dependency `nightcore` (`nightcore-2.13.2.jar`); soft-depends PlaceholderAPI, ProtocolLib, packetevents.

## What it is

A loot-box ("crate") system: a player spends a key item to open a crate and receives one randomly weighted reward from that crate's list, shown through a CS:GO-style case-opening animation.

## How a player actually uses it (as designed by the plugin)

1. **Get a key.** Keys are separate items from crates (`keys/*.yml`). On this server every key is a physical MMOItems item built on a `minecraft:tripwire_hook` base (`ItemData.Provider: mmoitems`), e.g. the `vote` key is MMOItems `UTILS:VOTE_KEY_PROLOGUE` displayed as **"§6Prologue Vote Key"**. None of the six keys are `Virtual: true`, so they exist as physical, tradeable/droppable inventory items, not just database counters.
2. **Find a crate block.** A crate is a `minecraft:player_head`-based block/item with a custom skin (all six crates use the same generic gold-treasure-chest player-head skin, only the name text differs, e.g. "Festive Crate Crate", "Voting Crate Crate", "War Crate Crate" — note the doubled "Crate Crate" in the literal name string, likely an unfixed naming bug, see Uncertain). Interaction (`config.yml` → `Click_Actions`): **RIGHT-click = open**, **LEFT-click = preview** (rewards list, no cost), **SHIFT+RIGHT-click = mass-open** (up to `Mass_Opening_Limit: 30` at once, must be sneaking per `MassOpening.SneakToUse: true`).
3. **Opening plays an animation.** All six crates have `Animation.Enabled: true`, `Animation.Id: csgo` — a scrolling/roulette-style reveal (`openingsv2/csgo.yml`) rather than an instant reward. `Opening_Allow_Skip: false`, so the animation cannot be skipped; the GUI auto-closes `Opening_Close_Time: 20` ticks (1 second) after it finishes.
4. **Claim.** The won item is delivered automatically at the end of the animation (or, if `Display_Reward_Above_Block: true` and no animation were configured, would hover over the block — moot here since all six crates do have animations enabled).
5. **Preview.** Left-clicking opens the `previews/default.yml` GUI (`Preview.Enabled: true`, `Id: default` on every crate) listing every possible reward and rarity for that crate, rate-limited globally to one preview request per `Preview_Cooldown: 2500` ms per player.

## Reality check: none of this is currently reachable in the world

Every one of the six crate configs has **`Block: Positions: []`** — i.e. **zero crate blocks are placed anywhere on the server right now** (verified by reading the raw `Block.Positions` list in all six `crates/*.yml` files; there is no separate block-location table in `data.db`, which only holds `excellentcrates_users`, `excellentcrates_crate_data`, `excellentcrates_reward_data`, `excellentcrates_reward_limits`). The `/crates` menu GUI (`menu/default.yml`) is also still on its **factory-default placeholder** — its only configured slot is the literal example `your_crate_id: 13`, not any of the six real crate IDs. So a player cannot currently reach any crate by walking up to a block or by opening a `/crates menu`.

Despite that, `openings.log` and the `excellentcrates_crate_data` table show **real, historical player opens** of `voting_crate`, `voting_crate_1`, `voting_crate_2` and `voting_crate_3` (e.g. `[23/06/2025 13:27:50] XxFran10xX won Diamond ... from Voting Crate (ID: voting_crate)`; DB row `(1, 'voting_crate', ..., 'XxFran10xX', 'diamond')`). `festive_crate` and `war_crate` have **no** log/DB entries at all — they appear never to have been opened. Since every `/crates` sub-command (`open`, `openfor`, `give`, `key give`, etc. — see Perms table below) requires an OP-level permission node with no player-default, these opens were almost certainly triggered by **console commands from another system**, not by player block interaction. The server has `VotingPlugin-7.0.jar` and `VotifierPlus-1.4.3.jar` installed, and the key names line up exactly with vote-crate tiers (`vote`/`vote_1`/`vote_2`/`vote_3` ↔ `UTILS:VOTE_KEY_PROLOGUE/ACT_1/ACT_2/ACT_3`), strongly suggesting the actual player flow is: **vote → some bridge (VotingPlugin/TFMCCore, not found in VotingPlugin's own `Rewards/` folder, which only contains its stock `ExampleBasic.yml`/`ExampleAdvanced.yml`) gives the key item and runs `/crates open` or `/crates openfor` as console** — not "find a block in the world." This exact bridge command was **not located** in any config read (see Uncertain).

## The actual crates on this server

| Display name | Internal ID | File | Key that opens it | How the key is obtained | Physical block placed? | Ever opened (per `openings.log`/DB) |
|---|---|---|---|---|---|---|
| Festive Crate | `festive_crate` | `crates/festive_crate.yml` | `candy_key` (MMOItems `LOOT:CANDY_KEY`, "Candy Key") | Not configured anywhere read (no shop/vote/drop link found) — likely seasonal/staff-given | No (`Positions: []`) | No |
| Voting Crate | `voting_crate` | `crates/voting_crate.yml` | `vote` (MMOItems `UTILS:VOTE_KEY_PROLOGUE`, "§6Prologue Vote Key") | Voting (inferred from key name + VotingPlugin/VotifierPlus install; exact command not found) | No | **Yes** — diamond, gold ingot, common skin scroll wins logged |
| Voting Crate | `voting_crate_1` | `crates/voting_crate_1.yml` | `vote_1` (`UTILS:VOTE_KEY_ACT_1`, "§6Act I Vote Key") | Voting (Act 1 tier, inferred) | No | **Yes** — heavy activity logged (ignitium, gold ingot, materials, skin scrolls) |
| Voting Crate | `voting_crate_2` | `crates/voting_crate_2.yml` | `vote_2` (`UTILS:VOTE_KEY_ACT_2`, "§6Act II Vote Key") | Voting (Act 2 tier, inferred) | No | **Yes** — one logged win (Ignitium ×2, epic tier) |
| Voting Crate | `voting_crate_3` | `crates/voting_crate_3.yml` | `vote_3` (`UTILS:VOTE_KEY_ACT_3`, "§6Act III Vote Key") | Voting (Act 3 tier, inferred) | No | **Yes** — one logged win (common skin scroll) |
| War Crate | `war_crate` | `crates/war_crate.yml` | `war_key` (MMOItems `LOOT:WAR_KEY`, "War Key") | Not configured anywhere read — name ("Act III War Key" per the key's in-game display) suggests a story/event drop, not vote or shop | No | No |

All six crates share the same settings otherwise: `Permission_Required: false` (no permission needed to interact with the block itself, once one exists), `Preview.Enabled: true` / `Id: default`, `Animation.Id: csgo`, `Hologram.Enabled: true` / `Template: default` (except `voting_crate` which uses the `voting_crate` hologram template defined in `config.yml`, with lines "Left click to preview! / Right click to open! / Shift Right click to mass open!"), and a `CostOptions` block that requires exactly 1 of that crate's own key per open (`Entries: '0': Type: key, Amount: 1`).

There is also a stale backup file `crates/backups/voting_crate.yml.backup535`, an old auto-save of `voting_crate.yml` from the in-game editor — not a live crate, just editor history.

## Full reward tables

Weights are per-reward `Weight` values under `Rewards.List`; percentage = weight ÷ sum of all weights in that crate. `config.yml` → `Rewards.Rarities` (`common` 65 / `rare` 25 / `epic` 7 / `legendary` 3, all `Default: false`) is a **cosmetic tag used for coloring/labels only** — actual odds are driven entirely by each reward's own `Weight`, not by these global rarity weights. Item names are resolved from `MMOItems/item/*.yml` `name:` fields where the reward uses `Provider: mmoitems`; vanilla rewards show their vanilla item/count directly.

### Festive Crate (`festive_crate`) — total weight 218.0, 24 rewards, key: `candy_key`

| Reward | Weight | % | Rarity tag | Item | Qty |
|---|---|---|---|---|---|
| lootnoble_rank | 15.0 | 6.88% | legendary | Noble Rank (rank-grant item, `LOOT:NOBLE_RANK`) | 1 |
| lootgilded_rank | 10.0 | 4.59% | legendary | Gilded Rank (`LOOT:GILDED_RANK`) | 1 |
| lootascended_rank | 5.0 | 2.29% | legendary | Ascended Rank (`LOOT:ASCENDED_RANK`) | 1 |
| materialsabyssalite_ingot | 10.0 | 4.59% | common | Abyssalite Ingot | 6 |
| materialsabyssalite_ingot_1 | 10.0 | 4.59% | rare | Abyssalite Ingot | 12 |
| lootarmor_runestone | 10.0 | 4.59% | common | **Broken reward — see Uncertain** (`LOOT:ARMOR_RUNESTONE`, item ID does not exist) | 2 |
| lootarmor_runestone_1 | 10.0 | 4.59% | rare | **Broken reward — see Uncertain** | 4 |
| lootmythical_gemstone_pouch | 10.0 | 4.59% | common | Pouch of Mythical Gemstones | 1 |
| lootmythical_gemstone_pouch_1 | 10.0 | 4.59% | rare | Pouch of Mythical Gemstones | 2 |
| lootmythical_gemstone_pouch_2 | 10.0 | 4.59% | epic | Pouch of Mythical Gemstones | 3 |
| lootrare_material_pouch | 10.0 | 4.59% | common | Pouch of Rare Materials | 1 |
| materialsmythrilite | 10.0 | 4.59% | common | Mythrilite | 1 |
| materialsmythrilite_1 | 10.0 | 4.59% | rare | Mythrilite | 2 |
| materialsmythrilite_2 | 10.0 | 4.59% | epic | Mythrilite | 3 |
| materialsmythril_ingot | 8.0 | 3.67% | common | Mythril Ingot | 1 |
| materialsmythril_ingot_1 | 8.0 | 3.67% | rare | Mythril Ingot | 2 |
| materialsmythril_ingot_2 | 8.0 | 3.67% | epic | Mythril Ingot | 3 |
| currencypouch_of_coins | 8.0 | 3.67% | common | Pouch of Gold Denars | 2 |
| currencypouch_of_coins_1 | 8.0 | 3.67% | rare | Pouch of Gold Denars | 3 |
| currencypouch_of_coins_2 | 8.0 | 3.67% | epic | Pouch of Gold Denars | 4 |
| materialslegendary_leather | 8.0 | 3.67% | epic | Perfect Quality Leather | 12 |
| materialslegendary_wool | 8.0 | 3.67% | epic | Perfect Quality Wool | 12 |
| materialslegendary_feather | 8.0 | 3.67% | epic | Perfect Quality Feather | 12 |
| booksskill_point_book | 6.0 | 2.75% | epic | Skill Training Manual | 1 |

### Voting Crate — Prologue tier (`voting_crate`) — total weight 170.0, 17 rewards, key: `vote`

| Reward | Weight | % | Rarity tag | Item | Qty |
|---|---|---|---|---|---|
| lootcommon_item_skin_scroll | 10.0 | 5.88% | common | Common Item Skin Scroll | 1 |
| iron_ingot | 10.0 | 5.88% | common | vanilla Iron Ingot | 4 |
| gold_ingot | 10.0 | 5.88% | common | vanilla Gold Ingot | 2 |
| diamond | 10.0 | 5.88% | common | vanilla Diamond | 1 |
| lootrare_item_skin_scroll | 10.0 | 5.88% | rare | Rare Item Skin Scroll | 1 |
| materialsrare_leather | 10.0 | 5.88% | rare | Good Quality Leather | 1 |
| materialsrare_feather | 10.0 | 5.88% | rare | Good Quality Feather | 1 |
| materialsrare_wool | 10.0 | 5.88% | rare | Good Quality Wool | 1 |
| materialsignitium | 10.0 | 5.88% | rare | Ignitium | 1 |
| lootepic_item_skin_scroll | 10.0 | 5.88% | epic | Epic Item Skin Scroll | 1 |
| materialsrare_leather_epic | 10.0 | 5.88% | epic | Good Quality Leather | 2 |
| materialsrare_feather_epic | 10.0 | 5.88% | epic | Good Quality Feather | 2 |
| materialsrare_wool_epic | 10.0 | 5.88% | epic | Good Quality Wool | 2 |
| materialsignitium_epic | 10.0 | 5.88% | epic | Ignitium | 2 |
| materialsignitium_legendary | 10.0 | 5.88% | legendary | Ignitium | 4 |
| lootbasic_gemstone_pouch | 10.0 | 5.88% | legendary | Pouch of Basic Gemstones | 1 |
| currencypouch_of_coins | 10.0 | 5.88% | legendary | Pouch of Gold Denars | 1 |

Every reward is exactly weight 10 (flat 5.88% each) — this is the "flattest"/most even crate on the server.

### Voting Crate — Act I tier (`voting_crate_1`) — total weight 285.0, 21 rewards, key: `vote_1`

| Reward | Weight | % | Rarity tag | Item | Qty |
|---|---|---|---|---|---|
| materialsignitium | 50.0 | 17.54% | common | Ignitium | 16 |
| lootcommon_item_skin_scroll | 25.0 | 8.77% | common | Common Item Skin Scroll | 1 |
| unknown_key | 20.0 | 7.02% | common | Unknown Key (`LOOT:TRIAL_KEY`) | 1 |
| boss_ticket_1 | 15.0 | 5.26% | common | Withered Remains Ticket | 1 |
| boss_ticket_2 | 15.0 | 5.26% | common | Ice General Ticket | 1 |
| lootrare_item_skin_scroll | 10.0 | 3.51% | rare | Rare Item Skin Scroll | 1 |
| materialsrare_leather | 10.0 | 3.51% | rare | Good Quality Leather | 1 |
| materialsrare_feather | 10.0 | 3.51% | rare | Good Quality Feather | 1 |
| materialsrare_wool | 10.0 | 3.51% | rare | Good Quality Wool | 1 |
| materialstin | 10.0 | 3.51% | rare | Tin | 1 |
| materialsabyssalite | 10.0 | 3.51% | rare | Abyssalite Fragment | 1 |
| lootepic_item_skin_scroll | 10.0 | 3.51% | epic | Epic Item Skin Scroll | 1 |
| materialsrare_leather_epic | 10.0 | 3.51% | epic | Good Quality Leather | 2 |
| materialsrare_feather_epic | 10.0 | 3.51% | epic | Good Quality Feather | 2 |
| materialsrare_wool_epic | 10.0 | 3.51% | epic | Good Quality Wool | 2 |
| materialstin_epic | 10.0 | 3.51% | epic | Tin | 2 |
| materialsabyssalite_epic | 10.0 | 3.51% | epic | Abyssalite Fragment | 2 |
| materialstin_legendary | 10.0 | 3.51% | legendary | Tin | 4 |
| materialsabyssalite_legendary | 10.0 | 3.51% | legendary | Abyssalite Fragment | 4 |
| lootbasic_gemstone_pouch | 10.0 | 3.51% | legendary | Pouch of Polished Gemstones (item ID `LOOT:POLISHED_GEMSTONE_POUCH`, reward key still named `lootbasic_...` — a leftover copy-paste name) | 1 |
| currencypouch_of_coins | 10.0 | 3.51% | legendary | Pouch of Gold Denars | 1 |

### Voting Crate — Act II tier (`voting_crate_2`) — total weight 240.0, 21 rewards, key: `vote_2`

| Reward | Weight | % | Rarity tag | Item | Qty |
|---|---|---|---|---|---|
| materialsignitium | 40.0 | 16.67% | common | Ignitium | 16 |
| materialstin_common | 20.0 | 8.33% | common | Tin | 2 |
| materialsabyssalite_common | 20.0 | 8.33% | common | Abyssalite Fragment | 2 |
| lootcommon_item_skin_scroll | 10.0 | 4.17% | common | Common Item Skin Scroll | 1 |
| unknown_key | 4.0 | 1.67% | common | Unknown Key (`LOOT:TRIAL_KEY`) | 1 |
| boss_ticket_1 | 3.0 | 1.25% | common | Withered Remains Ticket | 1 |
| boss_ticket_2 | 3.0 | 1.25% | common | Ice General Ticket | 1 |
| lootrare_item_skin_scroll | 10.0 | 4.17% | rare | Rare Item Skin Scroll | 1 |
| materialsrare_leather | 10.0 | 4.17% | rare | Good Quality Leather | 1 |
| materialsrare_feather | 10.0 | 4.17% | rare | Good Quality Feather | 1 |
| materialsrare_wool | 10.0 | 4.17% | rare | Good Quality Wool | 1 |
| materialstin_rare | 10.0 | 4.17% | rare | Tin | 4 |
| materialsabyssalite_rare | 10.0 | 4.17% | rare | Abyssalite Fragment | 4 |
| lootepic_item_skin_scroll | 10.0 | 4.17% | epic | Epic Item Skin Scroll | 1 |
| materialsrare_leather_epic | 10.0 | 4.17% | epic | Good Quality Leather | 2 |
| materialsrare_feather_epic | 10.0 | 4.17% | epic | Good Quality Feather | 2 |
| materialsrare_wool_epic | 10.0 | 4.17% | epic | Good Quality Wool | 2 |
| materialsmythril_legendary | 10.0 | 4.17% | legendary | Mythril Fragment | 2 |
| materialsmythrilite_legendary | 10.0 | 4.17% | legendary | Mythrilite | 1 |
| lootbasic_gemstone_pouch | 10.0 | 4.17% | legendary | Pouch of Radiant Gemstones (`LOOT:RADIANT_GEMSTONE_POUCH`; reward key again mislabelled `lootbasic_...`) | 1 |
| currencypouch_of_coins | 10.0 | 4.17% | legendary | Pouch of Gold Denars | 1 |

### Voting Crate — Act III tier (`voting_crate_3`) — total weight 301.0, 23 rewards, key: `vote_3`

| Reward | Weight | % | Rarity tag | Item | Qty |
|---|---|---|---|---|---|
| materialsabyssalite_fragment | 40.0 | 13.29% | common | Abyssalite Fragment | 8 |
| materialsraw_tin | 40.0 | 13.29% | common | Tin | 8 |
| materialsignitium | 20.0 | 6.64% | common | Ignitium | 64 |
| materialsmythrilite | 20.0 | 6.64% | common | Mythrilite | 1 |
| materialsmythril_fragment | 20.0 | 6.64% | common | Mythril Fragment | 2 |
| lootcommon_item_skin_scroll | 10.0 | 3.32% | common | Common Item Skin Scroll | 1 |
| loottrial_key | 5.0 | 1.66% | common | Unknown Key (`LOOT:TRIAL_KEY`) | 1 |
| lootboss_ticket_1 | 3.0 | 1.00% | common | Withered Remains Ticket | 1 |
| lootboss_ticket_2 | 3.0 | 1.00% | common | Ice General Ticket | 1 |
| lootrare_item_skin_scroll | 10.0 | 3.32% | rare | Rare Item Skin Scroll | 1 |
| materialsepic_leather | 10.0 | 3.32% | rare | Great Quality Leather | 1 |
| materialsepic_feather | 10.0 | 3.32% | rare | Great Quality Feather | 1 |
| materialsepic_wool | 10.0 | 3.32% | rare | Great Quality Wool | 1 |
| materialsmythrilite_1 | 10.0 | 3.32% | rare | Mythrilite | 2 |
| materialsmythril_fragment_1 | 10.0 | 3.32% | rare | Mythril Fragment | 4 |
| lootepic_item_skin_scroll | 10.0 | 3.32% | epic | Epic Item Skin Scroll | 1 |
| materialsepic_leather_1 | 10.0 | 3.32% | epic | Great Quality Leather | 2 |
| materialsepic_feather_1 | 10.0 | 3.32% | epic | Great Quality Feather | 2 |
| materialsepic_wool_1 | 10.0 | 3.32% | epic | Great Quality Wool | 2 |
| lootmythical_gemstone_pouch | 10.0 | 3.32% | legendary | Pouch of Mythical Gemstones | 1 |
| currencypouch_of_coins | 10.0 | 3.32% | legendary | Pouch of Gold Denars | 1 |
| materialsmythrilite_2 | 10.0 | 3.32% | legendary | Mythrilite | 4 |
| materialsmythril_fragment_2 | 10.0 | 3.32% | legendary | Mythril Fragment | 8 |

Note the Act III crate's flagship "common" reward is **64 Ignitium**, a much larger payout than lower tiers' Ignitium rolls (16) — tiers scale reward *quantity* up, not just rarity odds.

### War Crate (`war_crate`) — total weight 226.1, 26 rewards, key: `war_key`

| Reward | Weight | % | Rarity tag | Item | Qty |
|---|---|---|---|---|---|
| materialsabyssalite_ingot | 10.0 | 4.42% | common | Abyssalite Ingot | 8 |
| foodschocolate_cake | 10.0 | 4.42% | common | Chocolate Cake | 64 |
| materialsarcane_crystal | 10.0 | 4.42% | common | Arcane Crystal | 32 |
| lootarmor_runestone | 10.0 | 4.42% | common | **Broken reward — see Uncertain** (`LOOT:STAFF_RUNESTONE`, item ID does not exist) | 1 |
| materialsmythril_fragment_1 | 10.0 | 4.42% | common | Mythril Fragment | 4 |
| loottrial_key | 8.0 | 3.54% | common | Unknown Key | 1 |
| materialsmythrilite_1 | 8.0 | 3.54% | common | Mythrilite | 2 |
| materialsmythril_fragment | 10.0 | 4.42% | rare | Mythril Fragment | 8 |
| lootarmor_runestone_1 | 8.0 | 3.54% | rare | **Broken reward — see Uncertain** (`LOOT:ARMOR_RUNESTONE`, does not exist) | 1 |
| loottrial_key_1 | 8.0 | 3.54% | rare | Unknown Key | 2 |
| materialsmythrilite_3 | 8.0 | 3.54% | rare | Mythrilite | 4 |
| lootmythical_gemstone_pouch | 10.0 | 4.42% | rare | Pouch of Mythical Gemstones | 1 |
| currencypouch_of_coins | 10.0 | 4.42% | rare | Pouch of Gold Denars | 1 |
| materialsmythril_fragment_2 | 10.0 | 4.42% | epic | Mythril Fragment | 12 |
| lootarmor_runestone_2 | 8.0 | 3.54% | epic | **Broken reward — see Uncertain** (`LOOT:ARMOR_RUNESTONE`) | 2 |
| loottrial_key_2 | 8.0 | 3.54% | epic | Unknown Key | 3 |
| materialsmythrilite | 8.0 | 3.54% | epic | Mythrilite | 6 |
| lootmythical_gemstone_pouch_1 | 10.0 | 4.42% | epic | Pouch of Mythical Gemstones | 2 |
| currencypouch_of_coins_1 | 10.0 | 4.42% | epic | Pouch of Gold Denars | 3 |
| materialsmythril_fragment_3 | 10.0 | 4.42% | legendary | Mythril Fragment | 16 |
| lootarmor_runestone_3 | 8.0 | 3.54% | legendary | **Broken reward — see Uncertain** (`LOOT:ARMOR_RUNESTONE`) | 4 |
| materialsmythrilite_2 | 8.0 | 3.54% | legendary | Mythrilite | 8 |
| lootmythical_gemstone_pouch_2 | 10.0 | 4.42% | legendary | Pouch of Mythical Gemstones | 3 |
| currencypouch_of_coins_2 | 10.0 | 4.42% | legendary | Pouch of Gold Denars | 5 |
| booksskill_point_book | 6.0 | 2.65% | legendary | Skill Training Manual | 1 |
| dead_bush | **0.1** | **0.04%** | common | vanilla Dead Bush, custom-named "Dead Bush" with lore *"Oh well... Guess you're the king of nowhere..."* | 1 |

The `dead_bush` "troll" reward at weight 0.1 is a deliberate ultra-rare joke/consolation item (≈1 in 2,261 openings) — this is intentional crate design (a common pattern in loot-box plugins), not a bug.

### Broken/unresolvable rewards — verified against `MMOItems/item/*.yml`

The IDs `LOOT:ARMOR_RUNESTONE` and `LOOT:STAFF_RUNESTONE`, referenced by `lootarmor_runestone*` rewards in `festive_crate.yml` and `war_crate.yml`, **do not exist** in any MMOItems config file read (`MMOItems/item/loot.yml` only defines `MINOR_ARMOR_RUNESTONE`, `LESSER_ARMOR_RUNESTONE`, `GREATER_ARMOR_RUNESTONE`, `ASCENDANT_ARMOR_RUNESTONE` — no plain `ARMOR_RUNESTONE`, and no `STAFF_RUNESTONE` at all). Any player who rolls one of these reward slots (combined ≈4.6–4.4% of Festive Crate and ≈14.6% of War Crate's total weight) will very likely receive a broken/air item or a console error rather than the intended rune — **wiki should not promise these as real drops until staff fixes the IDs.**

## Player command table

**None.** Every `/crates` (aliases: `ecrates`, `excellentcrates`, `crate`, `case`, `cases` — `engine.yml` → `Command_Aliases`) sub-command decompiles to a permission node under `su.nightexpress.excellentcrates.config.Perms`, and only **one** permission in the whole plugin is declared `PermissionDefault.TRUE`:

| Permission | Default | What it's for |
|---|---|---|
| `excellentcrates.include.giveall` | **TRUE** | Not a command — it only controls whether *this player themself* is included when an admin runs the key `giveall` sub-command. Purely a targeting flag for an admin action; grants the player no ability of their own. |

Because that is the only `TRUE`-default permission and it doesn't correspond to a runnable player command, **the player command table is empty.** The way players actually interact with crates is entirely non-command: right/left/shift-right clicking a placed crate block (see "How a player actually uses it"), which is gated by the crate's own `Permission_Required` flag (`false` on all six crates here) rather than by any of the `excellentcrates.command.*` nodes.

### Admin/staff commands excluded (all default `OP`, verified from `Perms.class` bytecode strings — none carry `PermissionDefault.TRUE`)

| Command | Permission | What it does |
|---|---|---|
| `/crates reload` | `excellentcrates.command.reload` | Reload configs |
| `/crates editor` | `excellentcrates.command.editor` | Open the in-game crate editor GUI |
| `/crates drop <crate> [x y z world]` | `excellentcrates.command.drop` | Drop a physical crate block/item at a location |
| `/crates dropkey <key> [x y z world]` | `excellentcrates.command.dropkey` | Drop a physical key item |
| `/crates give <player> <crate> [amount]` | `excellentcrates.command.give` | Give a crate item to a player |
| `/crates open <crate>` | `excellentcrates.command.open` | Open a crate as yourself, bypassing block/cost |
| `/crates openfor <player> <crate>` | `excellentcrates.command.openfor` | Open a crate for another player (console-usable) — **most likely mechanism for the vote-crate opens seen in `openings.log`** |
| `/crates key give <player> <key> <amount>` | `excellentcrates.command.key.give` | Give key items |
| `/crates key take <player> <key> <amount>` | `excellentcrates.command.key.take` | Remove key items |
| `/crates key set <player> <key> <amount>` | `excellentcrates.command.key.set` | Set exact key count |
| `/crates key show [player]` / `.show.others` | `excellentcrates.command.key.show[.others]` | Inspect key counts |
| `/crates menu [player]` / `.menu.others` | `excellentcrates.command.menu[.others]` | Open the `/crates` GUI menu for self/others |
| `/crates preview <crate>` / `.others` | `excellentcrates.command.preview[.others]` | Force-open the preview GUI |
| `/crates resetcooldown <player> <crate>` | `excellentcrates.command.resetcooldown` | Reset a player's open cooldown/streak |
| (mass-open gameplay permission, not a command) | `excellentcrates.massopen` | Declared with the plain 2-arg `Permission` constructor (no explicit default in `Perms.class`), which Bukkit resolves to **OP by default** — meaning shift-right-click mass-opening is gated behind an OP-default permission unless LuckPerms grants it to the default group. **Not verified against the live LuckPerms config; flagged in Uncertain.** |
| (global bypass) | `excellentcrates.bypass.crate.opencooldown` | Bypasses per-crate open cooldowns |

## Numbers that matter to players

- **Key cost per open:** exactly 1 key of the matching type (`CostOptions` → `Entries: '0': Type: key, Amount: 1`) on every crate. No denar/vote-point cost options are configured.
- **Open cooldowns:** `festive_crate` has `OpeningCooldown.Enabled: true` but `Value: 0` (effectively no wait). `voting_crate*` and `war_crate` all have `OpeningCooldown.Enabled: false`. **No crate on this server currently rate-limits repeat opens** (assuming you have keys).
- **Mass-opening:** capped globally at `Mass_Opening_Limit: 30` openings per batch (`config.yml`); requires sneaking (`MassOpening.SneakToUse: true`) and is blocked for crates with no cost option (`AllowForNoCost: false` — not an issue here since all crates have a key cost); gated by `excellentcrates.massopen` (see permission table above).
- **Preview spam guard:** `Preview_Cooldown: 2500` ms between preview GUI requests, server-wide per player (resets on quit).
- **Reward "Limits" (pity/scarcity caps):** only used on `festive_crate`'s three rank rewards — `lootascended_rank` capped at `GlobalAmount: 3` (server-wide, ever), `lootgilded_rank` at `GlobalAmount: 5`, `lootnoble_rank` at `GlobalAmount: 8`. All other rewards across all six crates have `Limits.Enabled: false` (`GlobalAmount`/`PlayerAmount: -1`, i.e. unlimited). No pity/guarantee-after-N-losses mechanic is configured anywhere (no `CooldownType` other than the unused default `CUSTOM`, and no bad-luck-protection settings were found).
- **No global rarity odds:** the `Rewards.Rarities` weights in `config.yml` (common 65 / rare 25 / epic 7 / legendary 3) are **not** what determines your odds — every individual reward's own `Weight` field is what the RNG actually uses (see reward tables above). The rarity tag is cosmetic labeling only.
- **Animation timing:** `Opening_Close_Time: 20` ticks (1 s) auto-close after the CS:GO-style roll finishes; `Opening_Allow_Skip: false` means you must watch it play out.
- **Milestones feature is globally OFF:** `config.yml` → `Milestones.Enabled: false`. The fully-built `milestones.yml` GUI (open-count-based bonus rewards, "X Openings" tiers) exists but does nothing right now.

## Features configured but INERT

- **No crate is physically placed anywhere.** All six `crates/*.yml` files have `Block.Positions: []`. There is no in-world location a player can walk to and right-click.
- **The `/crates menu` GUI is unconfigured.** `menu/default.yml` → `Crate.Slots` only contains the shipped example `your_crate_id: 13`; none of `festive_crate`, `voting_crate`, `voting_crate_1/2/3`, or `war_crate` are wired into it. Even a player with permission to run `/crates menu` would see an empty/placeholder menu.
- **`festive_crate` and `war_crate` have zero recorded openings** in `openings.log` or `excellentcrates_crate_data` — unlike the four voting crates, there's no evidence either has ever been reachable or triggered for a real player. Their key-acquisition path (candy_key, war_key) is not configured in any file read (no shop price, no vote tier, no drop table) — wiki should not describe how to "get" these keys without confirming with staff.
- **`lootarmor_runestone`/`lootarmor_runestone_1/2/3` (Festive/War Crates) and the War Crate's runestone slot referencing `LOOT:STAFF_RUNESTONE`** point at MMOItems IDs that don't exist in the current `MMOItems/item/*.yml` set — these reward slots are live in the weight table but will not hand out a valid item as configured (see "Broken/unresolvable rewards" above).
- **Milestones system** (`milestones.yml`) is fully configured (GUI, completed/incompleted item states, pointer slots) but `Milestones.Enabled: false` in `config.yml` — inert.
- **`excellentcrates.massopen` defaults to OP-only** (see permission table) — unless overridden in LuckPerms, the shift-right-click mass-open feature the config otherwise enables (`Features.MassOpening: true`) is not actually usable by ordinary players.
- Reward-key naming glitches (not gameplay-breaking, but wiki-relevant if quoting internal names): `voting_crate_1`'s and `voting_crate_2`'s legendary gemstone-pouch rewards are still keyed `lootbasic_gemstone_pouch` even though they now grant `LOOT:POLISHED_GEMSTONE_POUCH` and `LOOT:RADIANT_GEMSTONE_POUCH` respectively (leftover from copy-pasting the Prologue tier's reward list).
- Every crate's in-hand/block item name is literally **"\<Crate Name\> Crate"** (e.g. "Festive Crate Crate", "War Crate Crate") per the raw `minecraft:custom_name` NBT in `ItemProvider.Data.Value` — almost certainly an unintentional doubled "Crate" that a wiki should not repeat as the "correct" name without flagging it to staff.

## Cross-links

- **MMOItems** — nearly every reward across all six crates, and every key item, is an MMOItems item (`Provider: mmoitems`, IDs like `MATERIALS:*`, `LOOT:*`, `CURRENCY:POUCH_OF_COINS`, `BOOKS:SKILL_POINT_BOOK`). Two reward IDs are broken/missing from the current MMOItems config (see above).
- **DenarEconomy** — `CURRENCY:POUCH_OF_COINS` ("Pouch of Gold Denars") rewards feed directly into the denar economy once opened/used.
- **AdvancedCrafting** — reward materials (Mythrilite, Mythril/Abyssalite Ingots & Fragments, Ignitium, Rare/Epic/Legendary Leather/Wool/Feather, Tin) are AdvancedCrafting ingredient-table items (cross-reference `ingredients.yml` in Section 1) — crates are a secondary supply source for smithing materials.
- **VotingPlugin / VotifierPlus** — installed on the server and strongly implicated (by key naming and by real logged opens with no in-world block or menu entry) as the trigger for `voting_crate`/`voting_crate_1/2/3` opens, most likely via console `/crates open` or `/crates openfor`. The exact bridging command was not found in VotingPlugin's own `Rewards/` configs (which only contain the plugin's stock example files) — likely lives in the server's in-house `TFMCCore` plugin, which was out of scope for this pass.
- **LuckPerms** — governs all `excellentcrates.command.*` (OP-default) and `excellentcrates.massopen` (OP-default) nodes; without explicit grants, non-staff players cannot run any `/crates` sub-command or mass-open.
- **MMOCore/RPCharacters** — no direct integration found (no XP grants, no character-scoping) — crates appear to be strictly account/UUID-scoped via `excellentcrates_users`.

## Uncertain / unverified

- **The exact vote → crate/key pipeline.** Evidence (key names matching vote tiers, real logged opens with no reachable block/menu, VotingPlugin+VotifierPlus installed) strongly implies vote rewards give a key and trigger `/crates open` or `/crates openfor`, but the actual command was not found in any config read in this pass — it is likely inside the server's custom `TFMCCore` plugin, which was not opened.
- **`festive_crate` and `war_crate` acquisition.** No shop price, vote tier, or drop table for `candy_key` or `war_key` was found anywhere read. Do not describe these as "obtainable" without confirming with staff; they may be seasonal-event or manual staff-give-only.
- **Whether `excellentcrates.massopen` is actually granted to normal players via LuckPerms** — the permission itself resolves to OP-default in the plugin's own code, but LuckPerms group config was not audited in this pass.
- **Whether `Hold_Key_To_Open: false` and `PlaceholderAPI_For_Rewards: false` have any player-visible effect given crates are currently unreachable in-world** — moot until a crate block actually exists.
- The doubled "Crate Crate" in every crate's item display name, and the `lootbasic_gemstone_pouch` reward-key/item mismatches in `voting_crate_1`/`voting_crate_2` — flagged as likely unintentional but not confirmed with NightExpress/staff.
- The `LOOT:ARMOR_RUNESTONE` and `LOOT:STAFF_RUNESTONE` broken reward IDs — confirmed absent from every `MMOItems/item/*.yml` file grepped, but the *runtime* failure behavior (item silently becomes air vs. plugin throws/logs an error vs. some fallback) was not observed directly, since no test server was run.
- `openings/` vs `openingsv2/` — two parallel animation-config directories exist (`openings/inventory/{chests_full,csgo,enclosing,mystery,roulette,storm}.yml`, `openings/world/simple_roll.yml`, and `openingsv2/{chests_full,chests_mini,csgo,enclosing,hacking_x4,mystery,roulette,tnt_ignite}.yml`); all six live crates reference `Animation.Id: csgo`, but which directory (v1 vs v2) that ID resolves against in 6.6.1 was not confirmed by reading plugin code — assumed `openingsv2/csgo.yml` since that folder looks like the newer format.
