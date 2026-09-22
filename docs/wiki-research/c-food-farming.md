# Wiki research dossier — Food & Farming cluster

Scope: **Cooking, DrinkBuilder, BreweryX, CustomCrops, CustomFishing, FarmingUpgrade**

Status: factual dossier for a wiki writer. Every non-obvious claim cites a file path. Anything I could not confirm is listed in the "Uncertain / unverified" block of each section — **do not** fill those gaps by guessing.

Sources used:
- Live server plugin folders `C:\Users\MSI\Desktop\plugins\<Plugin>\` (read-only; authoritative for this server).
- Jar `plugin.yml` extracted from `C:\Users\MSI\Desktop\plugins\*.jar`.
- Source clones in `C:\Users\MSI\Desktop\plugin-src\Cooking` (github.com/drefvelin/cooking, HEAD `09a58ee`, 2026-08-31) and `C:\Users\MSI\Desktop\plugin-src\DrinkBuilder` (github.com/drefvelin/drinkbuilder).
- ItemsAdder pack `C:\Users\MSI\Desktop\plugins\ItemsAdder\contents\tfmc_cooking\contents\*.yml` for display names.

---

## 1. Cooking

### What it is
A furniture-driven cooking system: you place real cooking props in the world (pan, pot, cutting board, oven, milling stone, butter churn, fire pit…), put ingredients on them, and the plugin tracks each food item's freshness, cooked state, seasoning and a 1–5 star quality rating that all show up in the item's name and lore.

### How a player actually uses it
The plugin has **no player commands at all** — everything is physical interaction with furniture (provided by `InteractibleFurniture`).

General loop, from `plugin-src/Cooking/src/main/java/net/tfminecraft/cooking/manager/CraftingManager.java` and `.../CookingManager.java`:
1. Place the cooking furniture (Frying Pan, Pot, Cutting Board, Plate, Bowl, Mixing Bowl, Milling Stone, Oven Bottom + Oven Top, Bread Tray, Fire Pit, Butter Churn, Butter Plate, Meat Hook, Sausage Maker, Liquid Container, Tool Shelf, Saucepan). Full furniture list: `plugins/ItemsAdder/contents/tfmc_cooking/contents/furniture.yml`.
2. **Right-click the furniture holding an ingredient** → the item is placed into one of the furniture's slots and is rendered on top of it (`FurnitureSlotItemAddEvent`).
3. **Right-click with an empty hand** → take the item back out, or operate the station (churn, turn the spit, stir).
4. Stations that need heat (`requires-heat: true` for the frying pan, `plugins/Cooking/cookware.yml`) only cook when a heat source is under them. The configured heat chain is `oven_bottom` (source, type `oven`) → `oven_top` (consumer, `lookup: block-below`) in `plugins/Cooking/config.yml`.
5. Cooking ticks **once per second** (`runTaskTimer(..., 20L, 20L)` in `CookingManager.tickCycle`), so all `time:` / `burn:` numbers in `types.yml` are **seconds**.

Station-specific interactions:

| Station | Held item / action | Result |
|---|---|---|
| **Cutting Board** | Hold **Cutting Knife** (`ia.tfmc_cooking:cutting_knife`) and interact | Runs a cutting/chopping recipe on up to 4 slots; all inputs must share one origin (`single-origin: true`, `max-slots: 4`) — `plugins/Cooking/crafting-stations.yml` |
| **Frying Pan** | Place food, needs heat below; manual take only (`manual-add: false, manual-take: true`) | Cooks over time; burns if left on |
| **Pot** | Accepts a **Water Bucket** (`pot-water-input: v.water_bucket`), then up to five mains: cut vegetables, steak, poultry filet, fish filet, jellyfish cubes, or octopus. After mashing, one garnish, one spice, salt, and pepper | A masher turns a main into soup at any time and marks it boiled. Extras are not shown in the pot. The bowl shows each boiled main. Shift-right-click carries the bowl. |
| **Fire Pit** | Put a roast on the spit ("content" slot); right-click with the **Fire Pit Turner** | Rotates and roasts a whole joint |
| **Meat Hook** + **Cutting Knife** | Carve a cooked roast | Yields the cuts in `plugins/Cooking/carve-sequences.yml` |
| **Milling Stone** | Insert 8 Wheat, then perform 4 "revolutions" over 60 ticks | 1 batch of Flour — `plugins/Cooking/milling-recipes.yml` |
| **Mixing Bowl** | Add Flour + Cup of Water + Yeast, then stir **3 times** (10 ticks per stir, 20° tilt) | Dough — `plugins/Cooking/config.yml` (`mixing-*` keys) |
| **Bread Tray** in an **Oven** | Fill the 2 moulds with Dough (2 outputs per mould), light the oven with logs | Bread — `plugins/Cooking/baking-trays.yml` |
| **Butter Churn** | Right-click with Milk Bucket to load (hand is replaced with the bucket), then repeatedly right-click the stick; churn animation has a ~1 s cooldown (`startCooldown(f, 20 * 50L)`) | Butter, **3 churns** (`butter-churn-count: 3`) delivered onto a carried **Butter Plate** |
| **Sausage Maker** | Feed 3 meats; crank | Sausage Chain (6-tick crank, 4° wobble, 10-tick cooldown — `plugins/Cooking/config.yml`) |
| **Cauldron (vanilla block)** | Right-click a vanilla cauldron while holding a **sauce** or **soup** item | Handled in `CookingManager.empty()` — empties/serves the liquid |

### Content it adds ON THIS SERVER

**Cooking recipes — Cutting Board** (`plugins/Cooking/crafting-stations.yml`). "Ratio" = outputs per input.

| Recipe | Input | Ratio | Output | Tag applied |
|---|---|---|---|---|
| cut_vegetables | any `vegetable_1` raw veg | 2 | `vegetable_cut` (same origin) | `cut.0` (Cut) |
| chop_vegetables | any `vegetable_cut` | 1 | `vegetable_chopped` garnish | `cut.1` (Chopped) |
| chop_olive | Olive (`vegetable_chop_only`) | 1 | `garnish_chopped` Olive | `cut.1` |
| chop_pistachio | Pistachio | 1 | `garnish_chopped` Pistachio | `cut.1` |
| chop_rhubarb | Rhubarb | 1 | `garnish_chopped` Rhubarb | `cut.1` |
| chop_garlic | Garlic | 1 | `garnish_chopped` Garlic | `cut.1` |
| cut_seafood | one `seafood_whole` | 1 fish per knife use | one filet, jellyfish cubes, or octopus. Food and nutrition stay the portion type levels. | freshness |

`vegetable_1` (has a cut step): Carrot, Potato, Tomato, Onion, Lettuce, Cucumber, Corn, Beetroot, Pumpkin.
`vegetable_chop_only` (no cut step, straight to chopped): Olive, Pistachio, Rhubarb, Garlic. (`plugins/Cooking/types.yml`)

**Milling** (`milling-recipes.yml`): 8× Wheat → Flour. Station `milling_stone`, 4 revolutions, 60 ticks (3 s).

**Mixing** (`config.yml`, `mixing-ingredients`): Flour + Cup of Water + Yeast → Dough. 3 stirs × 10 ticks.

**Baking** (`baking-trays.yml`): Bread Tray has 2 moulds; each mould takes Dough and yields **2 Bread**. Bake **5 s**, burns at **10 s**. Oven burn tick every 20 ticks; burn chance per tick 0.08 (fresh wood) / 0.12 (burnt wood).

**Oven fuel** (`config.yml`, `oven-fuel`): any of oak / spruce / birch / jungle / acacia / dark_oak / mangrove / cherry / pale_oak logs and wood, plus crimson & warped stems and hyphae (22 entries).

**Cooking times per food type** (`plugins/Cooking/types.yml`; seconds; "burn" = seconds until it becomes Burnt):

| Type | Station | Cook (s) | Burn (s) |
|---|---|---|---|
| `roast` (Whole Chicken / Beef Roast / Venison Roast) | fire_pit | 20 | 40 |
| `meat_poultry` (Chicken) | frying_pan | 12 | 25 |
| `meat_poultry_leg` (Chicken Leg) | frying_pan | 15 | 30 |
| `meat_red_meat` (Steak / Beef / Venison) | frying_pan | 15 | 30 |
| `meat_pork` (Pork) | frying_pan | 15 | 30 |
| `sausage` | frying_pan | 15 | 30 |
| `vegetable_cut` | frying_pan | 15 | 30 |
| `vegetable_cut` | pot | 15 | 30 |
| `meat_poultry` (Chicken) | pot | 15 | 30 |
| `meat_red_meat` (Steak / Beef / Venison) | pot | 15 | 30 |
| `seafood_fish_filet` | pot | 15 | 30 |
| `seafood_jellyfish` | pot | 15 | 30 |
| `seafood_octopus` | pot | 15 | 30 |

**Carving sequences** (`plugins/Cooking/carve-sequences.yml`) — each right-click with the knife takes one cut off, in order:

| Sequence | Cuts available | Yields in order | Food / Nutrition per cut |
|---|---|---|---|
| `poultry` (Whole Chicken) | 6 | Chicken Leg ×2, Chicken ×3, then **2 Bone** | Leg 2.0 / 1.5; Chicken 1.0 / 1.0; Bone 0 / 0 |
| `red_meat` (Beef/Venison Roast) | 8 | Beef ×7, then **4 Bone** | Beef 1.5 / 1.0; Bone 0 / 0 |
| `sausage` (Sausage Chain) | 5 | Sausage ×5 (origin "Mixed") | 1.0 / 1.0 |

**Base food values** (`types.yml`): Bread food 4 / nutrition 3; Wheat, Flour, Yeast, Dough all 1/1; Cup of Milk 2/2; Butter 2/2; Salt and Sugar 0/0 (seasoning/sweetener never spoil).

**Ingredients the plugin recognises** (`plugins/Cooking/conversions.yml`, 40 entries) — feeding any of these into a station converts it into a tracked food item:
- Vanilla: Wheat, Carrot, Potato, Beetroot, Apple, Pumpkin, Beef, Porkchop, Chicken, Sugar, Milk Bucket.
- ItemsAdder `tfmc_cooking`: Yeast, Dough, Tomato, Onion, Lettuce, Cucumber, Corn, Olive, Pistachio, Rhubarb, Garlic, Salt, Basil, Black Pepper, Cinnamon, Vanilla, Nutmeg, Spice Leaf, Strawberry, Orange, Plum, Banana, Grape, Lemon, Lime, Peach, Pineapple, Cherry, Cup of Milk, Butter.

**Categories shown in item lore** (`config.yml`, `dictionary`): Red Meat, Poultry, Fish, Vegetable, Fruit, Dairy, Spice, Herb, Sauce, Garnish, Liquid.

**Sauce colours** (`config.yml`, `sauce-dict`): white/milk, dark red, light red, light brown, gray, dark brown — each with a plated variant.

### Player command table
**There are no player commands.** The jar declares exactly one command:

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | Cooking is 100 % furniture interaction |

Excluded admin/staff commands (`unzip -p plugins/cooking-0.1.4-ALPHA.jar plugin.yml`):
- `/cooking builditem <string>`, `/cooking preview <target> …` — permission `cooking.admin`, **default: op**.

### Numbers that matter to players

**Quality / stars** (`plugins/Cooking/quality.yml`, `permission_effects.yml`):
- Harvested/picked-up ingredients roll **1–5 stars**.
- Permission `tfmc.cooking.better_crops` raises the minimum roll to **2 stars**.
- Permission `tfmc.cooking.skilled_chef` gives a **15 % chance of +1 star** on an active craft.
- Composition (`plugins/Cooking/composition.yml`): `legacy-mode: false`, so "mains" set the base quality and "extras" only modify. Star gap-up chance **0.12 per star**, gap-down **0.15 per star**. Extras that never count as a main: seasoning, sweetener, flour, salt, pepper (plus per-station overrides — e.g. dairy is an extra in a Frying Pan, and the Sausage Maker has no extras so all three meats average).

**Ageing** — all tag thresholds are in **seconds of real time** (`FoodItem.java` stores `LAST_UPDATE` millis and computes `seconds = elapsed / 1000`). From `plugins/Cooking/tags.yml`:

| Track | Step | Starts at | Nutrition × | Food × | Quality penalty |
|---|---|---|---|---|---|
| `freshness` (most food) | Fresh | 0 s | 1.5 | — | — |
| | Stale | 1600 s (26 m 40 s) | 0.8 | — | −0.25 |
| | Rotten | 3200 s (53 m 20 s) | 0.05 | 0.6 | −0.75 |
| `dairy_freshness` (milk, cup of milk) | Fresh | 0 s | 1.5 | — | — |
| | **Sour** | 400 s (6 m 40 s) | 0.8 | — | −0.25 |
| | Rotten | 800 s (13 m 20 s) | 0.05 | 0.6 | −0.75 |
| `butter_freshness` | Fresh → **Rancid** → Rotten | 0 / 1600 / 3200 s | 1.5 / 0.8 / 0.05 | — / — / 0.6 | — / −0.25 / −0.75 |
| `warmth` | Hot | 0 s | 1.5 | 1.5 | — |
| | Warm | 10 s | 1.2 | 1.5 | — |
| | Cold | 20 s | — | — | — |
| `soup_thickness` | Thin / Light / Creamy / Velvety / Thick | 0 / 300 / 900 / 1800 / 3600 s | 1.0 / 1.2 / 1.4 / 1.75 / 2.0 | same | — |

Other multipliers (`tags.yml`): Raw ×0.5 nutrition; **Cooked** ×1.5 nutrition, ×1.5 food; **Burnt** ×0.1 nutrition, ×0.2 food; **Boiled** ×1.5 / ×1.5. Seasoned ×1.1 nutrition; Well Seasoned ×1.2 nutrition, ×1.1 food. Sauce: Unreduced ×0.5/×0.5, **Simmered** ×1.5/×1.5, Overcooked ×0.1/×0.2. Creamy ×1.1/×1.05; Thick ×1.05/×1.05. Flavour tags: Sweet ×1.05 food; Fruity ×1.08/×1.03; Richly Fruity ×1.15/×1.05; Aromatic ×1.05 food; Rounded ×1.05/×1.05. Salted butter gives +5 % craft quality, Spiced butter +10 %.

**Naming** (`plugins/Cooking/naming.yml`): a composed dish shows up to **3 filler origins** and up to **2 addons**; dough shows up to 2 fillers. Prefix tracks that appear in the name: `sweet`, `butter_salted`, `butter_spiced`. "Spice Leaf" appears in names as the adjective "Spiced".

**Liquid handling** (`config.yml`): 1 bucket = **3 liquid blocks**, a Liquid Container holds max **6 blocks**, 1 cup = **1 block**.

### Cross-links
- **InteractibleFurniture** — every station is a furniture entity with slots; **TLibs** and **TFMCCore** are hard dependencies (`plugin.yml: depend: [TLibs, InteractibleFurniture, TFMCCore]`). TFMCCore's `ItemScanService` is what re-stamps freshness on items in your inventory.
- **ItemsAdder** pack `tfmc_cooking` supplies every model, ingredient and rotten-variant item (`plugins/ItemsAdder/contents/tfmc_cooking/contents/{items,ingredients,intermediates,furniture,categories}.yml`).
- **CustomCrops** grows the produce (tomato, onion, lettuce, cucumber, corn, olive, pistachio, rhubarb, garlic, all the fruits and spices) — but see the mismatch flagged below.
- **DrinkBuilder** reuses the same `tfmc_cooking` ingredients as brewing inputs.
- **LuckPerms** — `tfmc.cooking.better_crops` and `tfmc.cooking.skilled_chef` are meant to be granted there (`permission_effects.yml` header).

### Uncertain / unverified
- **Ingredient-namespace mismatch.** `plugins/Cooking/conversions.yml` accepts `ia.tfmc_cooking:tomato` etc., while `plugins/CustomCrops/contents/crops/tomato.yml` drops `MMOItems:FOODS:TOMATO`. `plugins/MIReplacer/config.yml` converts *vanilla → MMOItems*, not MMOItems → ItemsAdder. I could **not** confirm how an MMOItems-format crop drop becomes a Cooking-recognised ItemsAdder ingredient. `plugins/DrinkBuilder/ingredients.yml` labels the MMOItems fruit entries "(MMO legacy)", which suggests a migration in progress. **Verify in-game before writing this into the wiki.**
- The public source clone (`plugin-src/Cooking`) does **not** contain oven, milling-stone, sausage-maker or mixing-bowl handler classes even though the live `plugins/Cooking/` config configures them — the live jar (`cooking-0.1.4-ALPHA.jar`) is ahead of the public repo. Descriptions of those four stations above are inferred from their config keys, not read from code.
- `plugins/Cooking/models.yml` (3149 lines) is a model→ItemsAdder mapping table; I did not enumerate it.
- Exact star-display format in item lore was not read from code.
- `quality.yml`'s legacy `composition.exclude-categories` block is inert because `legacy-mode: false`.

---

## 2. DrinkBuilder

### What it is
A donator perk: you design your own alcoholic drink on the TFMC website, staff approve it, and the plugin automatically creates it as a real brewable BreweryX recipe plus a custom-textured bottle on the server.

### How a player actually uses it
DrinkBuilder has **no in-game player commands**. The flow (from `plugin-src/DrinkBuilder/src/main/java/net/tfminecraft/DrinkBuilder/`):
1. Player with a donator rank opens the **ProvinceSystem website** drinks page (`/drinks`) and builds a drink: name (with colour stops), ingredients from the allowlist, cooking time, distill runs & time, barrel wood, age, difficulty, alcohol, lore, drink message, drink title, glint, potion effects, colour, and (higher ranks only) a custom bottle texture.
2. The submission is reviewed. `AssetSyncService` uploads `potion_overlay.png` and `glass_bottle.png` to the API so the website and Discord review sheets can render a preview (`plugins/DrinkBuilder/assets/README.txt`).
3. On approval, `PackPullRunner` pulls the pending drink and `RecipesYmlMerger.merge()` writes a new section into `plugins/BreweryX/recipes.yml` **keyed by the submission id**, and `IaDrinksWriter` writes the item into the ItemsAdder pack `tfmc_drinks`. The plugin then triggers `/iareload` and, after `ia-reload-delay-seconds: 8`, `/iazip` (`plugins/DrinkBuilder/config.yml`).
4. From then on the drink is **brewed exactly like any other BreweryX brew** — cauldron, distillation, barrel ageing (see §3).

Evidence for the live example: `plugins/BreweryX/recipes.yml` contains the recipe key `dev_ukindaickyngl_big_gulp` (name "Big Gulp", ingredients Milk_Bucket ×1 + Rabbit_Foot ×1 + `MMOItems:BARK` ×1, cooking time 4, 0 distills, oak wood, age 0, difficulty 3, alcohol 0, colour `12c436`) — a player submission merged by this plugin.

### Content it adds ON THIS SERVER

**Rank entitlements** (`plugins/DrinkBuilder/permission-groups.yml`) — resolved as MAX colour stops across matching groups, texture allowed if ANY group allows it:

| Group | Tier | LuckPerms node | Name colour stops | Custom drink texture |
|---|---|---|---|---|
| *(default)* | — | — | 0 | No |
| noble | 1 | `rpchar.group.noble` | 1 | No |
| gilded | 2 | `rpchar.group.gilded` | 2 | **Yes** |
| ascended | 3 | `rpchar.group.ascended` | 8 | **Yes** |
| legacy | 4 | `rpchar.group.legacy` | 8 | **Yes** |

The website hard-caps colour stops at 8.

**Banned potion effects on player drinks** (`plugins/DrinkBuilder/effects-blacklist.yml`, 12): absorption, dolphins_grace, fire_resistance, haste, health_boost, instant_health, invisibility, regeneration, resistance, saturation, speed, strength.

**Ingredient allowlist** (`plugins/DrinkBuilder/ingredients.yml`, **127 entries**). Categories are display labels from `categories.yml`: Grain, Sweetener, Produce, Spice, Dairy, Pantry, Exotic, Other.

- **Vanilla (27)** — Wheat, Wheat Seeds *(grain)*; Sugar, Sugar Cane, Honey Bottle, Honeycomb *(sweetener)*; Apple, Sweet Berries, Glow Berries, Potato, Pumpkin, Beetroot, Brown Mushroom, Red Mushroom, Kelp, Melon Slice, Carrot *(produce)*; Cocoa Beans *(spice)*; Milk Bucket, Egg *(dairy)*; Nether Wart, Chorus Fruit, Fermented Spider Eye, Spider Eye, Rabbit Foot, Glistering Melon Slice, Golden Carrot *(exotic)*.
- **ItemsAdder `tfmc_cooking` (31)** — Grape, Strawberry, Cherry, Orange, Lemon, Lime, Plum, Peach, Pineapple, Banana, Rhubarb, Tomato, Cucumber, Lettuce, Olive, Onion, Pistachio *(produce)*; Corn, Flour, Grain *(grain)*; Garlic, Cinnamon, Vanilla Bean, Nutmeg, Black Pepper, Basil, Spice Leaf *(spice)*; Butter, Milk *(dairy)*; Water *(pantry)*.
- **MMOItems (69)** — Yeast, Rice, Sunflower Seeds *(grain)*; Salt, Pepper, Mustard Seeds *(spice)*; Vinegar, Cooking Oil, Olive Oil, Cup of Water *(pantry)*; Maple Syrup, Caramel, Cooking Chocolate, Strawberry Jam *(sweetener)*; Cream, Cheese, Cup of Milk *(dairy)*; Cactus Fruit *(produce)*; 13 "(MMO legacy)" fruit/spice duplicates (Grape, Strawberry, Cherry, Orange, Lemon, Lime, Plum, Peach, Pineapple, Banana, Rhubarb, Cinnamon, Vanilla, Nutmeg); and 36 **exotic** foraged items: Birch Seed, Bark, Frost Flowers, Frost Tubes, Blazed Root, Death Fruit, Fire Leaf, Poison Leaf, Grapeberries, Mirkberries, Nightshade, Kelpberry, Fiery Fruit, Eye Fruit, Thorn Root, Frost Root, Caveshroom, Clover, Dying Leaf, Autumn Leaf, Spot Leaf, Long Leaf, Dwindle Leaf, Arcane Leaf, Glowpea Pod, Pumpkin Spore, Flatshroom, Barkshroom, Serpent Root, Poison Root, Burrow Root, Holt Core, Cloro Core.

**Recipe fields a player can set** (`RecipesYmlMerger.merge()`): `name` (quality-tiered, with colour stops), `ingredients` (with per-item amount), `cookingtime`, `distillruns`, `distilltime`, `wood`, `age`, `difficulty` (default 1), `alcohol` (default 0), `lore`, `drinkmessage`, `drinktitle`, `glint`, `effects`, and either a `customModelData` (texture drinks, allocated from the range **20000–29999**, `plugins/DrinkBuilder/config.yml` + `cmd-state.yml`) or a plain `color`.

**Hard safety rule:** `RecipesYmlMerger` contains the explicit line *"Never write player/server commands from player submissions."* — `servercommands` / `playercommands` are never generated from a submission.

### Player command table
**No player commands.**

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | Drink creation happens on the website, not in chat |

Excluded admin/staff commands (`unzip -p plugins/drinkbuilder-1.0-SNAPSHOT.jar plugin.yml`), all permission `drinkbuilder.admin`, **default: op**:
- `/drinkbuilder reload`
- `/drinkbuilder catalog sync`
- `/drinkbuilder pack pull [force]`
- `/drinkbuilder pack reapply <id>`
- `/drinkbuilder drink delete <id>`

### Numbers that matter to players
- Colour stops in the drink name: 0 / 1 / 2 / 8 / 8 by rank (table above); website cap 8.
- Custom-model-data budget for textured drinks: **20000–29999** (10 000 slots; `cmd-state.yml` currently at `next: 20000`, `freed: []` → effectively none issued yet).
- 12 blacklisted effects.
- 127 allowed ingredients.
- After approval there is an **8-second** delay between the pack reload and the zip step, so a new drink is not instantly visible.

### Cross-links
- **BreweryX** — the output of DrinkBuilder *is* a BreweryX recipe in `plugins/BreweryX/recipes.yml`. All brewing mechanics come from §3.
- **ItemsAdder** — packs `tfmc_drinks` and `tfmc_drinks_dev` hold the generated bottle items.
- **ProvinceSystem website / TFMCWeb** — `depend: [TLibs, TFMCWeb]`; `ProvinceSystemClient` and `GatewayClient` talk to the site API.
- **RPCharacters** — shares the exact same LuckPerms donator group nodes (`rpchar.group.*`), stated in the `permission-groups.yml` header.
- **Cooking / CustomCrops / MMOItems** — supply the ingredients.

### Uncertain / unverified
- The exact website UI (page layout, submission form, review queue, how a player is notified of approval) lives in the ProvinceSystem web app, not in the plugin folder. Not inspected.
- Whether a rejected/expired submission refunds anything, and whether there is a per-player drink limit — not found in plugin config.
- Whether `/drinks` is a website route or also an in-game command elsewhere — the `permission-groups.yml` comment says "ProvinceSystem `/drinks`", which reads as a web route.

---

## 3. BreweryX

### What it is
Realistic alcohol brewing: ferment ingredients in a heated cauldron, optionally distil them in a brewing stand, then age them in an oak/spruce/etc. barrel — and get properly drunk, with slurred chat and stumbling.

### How a player actually uses it
1. **Ferment.** Place a **cauldron over a fire/campfire**, fill with water, and right-click it while holding ingredients to throw them in (permission `brewery.cauldron.insert`, default true). Right-click the cauldron with a **clock/watch** to read the current cook time (`brewery.cauldron.time`). Note `useOffhandForCauldron: false` — you must use your **main hand**.
2. **Bottle.** Right-click the cauldron with a **glass bottle** to draw off one brew (`brewery.cauldron.fill`).
3. **Distil (optional).** Put the bottle in a **Brewing Stand** with glowstone dust; it runs the configured number of distill runs.
4. **Age (optional).** Build a barrel and right-click it to open (`brewery.createbarrel` / `brewery.openbarrel`, both default true). Signs on barrels **must contain the keyword** (`requireKeywordOnSigns: true`). Vanilla Minecraft barrels also age brews (`ageInMCBarrels: true`) but hold at most **6 brews** (`maxBrewsInMCBarrels: 6`), and vanilla barrels are exempt from the "brews only" restriction (`exemptVanillaBarrels: true`). Large barrels are **3 rows** of inventory, small barrels **1 row** (`barrelInvSizeLarge: 3`, `barrelInvSizeSmall: 1`), and large barrels can be opened from anywhere (`openLargeBarrelEverywhere: true`).
5. **Seal (optional).** A **Sealing Table** is craftable and enabled, and it is a **Smoker** block (`craftSealingTable: true`, `enableSealingTable: true`, `sealingTableBlock: SMOKER`). Sealing strips a brew down for selling in shops. *(The `/brew seal` command is admin-only here; the block is the player route.)*
6. **Drink.** Quality is always shown on the label (`alwaysShowQuality: true`); the raw alcohol number is hidden but an indicator is shown (`alwaysShowAlc: false`, `alwaysShowAlcIndicator: true`). Drinking prints a status message (`showStatusOnDrink: true`).

All config: `plugins/BreweryX/config.yml`.

### Content it adds ON THIS SERVER

**Base brews (cauldron stage)** — `plugins/BreweryX/cauldron.yml`. Cooking these ingredients in a cauldron produces the named intermediate liquid:

| Ingredients | Cauldron result |
|---|---|
| Wheat | Fermented wheat |
| Sugar Cane | Sugar brew |
| Sugar | Sugarwater |
| Apple | Apple must |
| Sweet Berries | Grape must |
| Potato | Potatomash |
| Short Grass | Boiled herbs |
| Red Mushroom | Mushroom brew |
| Brown Mushroom | Mushroom brew |
| Cocoa Beans | Chocolately brew |
| Milk Bucket | Milky water |
| Cornflower **or** Blue Orchid (`blue-flowers`) | Blueish brew |
| Cactus | Agave brew |
| Poisonous Potato | Poisonous Broth |
| Egg | Sticky brew |
| Oak Sapling | Stringy herb broth |
| Vine | Boiled herbs |
| Rotten Flesh | Foul pest |
| Melon Slice | Melon juice |
| Wheat Seeds / Melon Seeds / Pumpkin Seeds | Bitter brew |
| Bone Meal | Bony Brew |
| Cookie | Chocolately sap |
| Fermented Spider Eye | Fermented Eye |
| Ghast Tear | Sad brew |
| Snowball | Icewater |
| Gold Nugget | Glistering brew |
| Glowstone Dust | Glowing brew |
| Sugar Cane ×3 + Apple | Apple-Sugar brew |
| Short Grass + Poisonous Potato | Boiled acidy herbs |
| Cornflower/Blue Orchid + Wheat | Juniper brew |
| Cornflower/Blue Orchid + Wheat + Apple | Fruity juniper brew |
| Egg + Sugar + Milk Bucket | Smooth egg mixture |

*(The `ex` example entry — Bedrock ×2 + Diamond — is a template, not obtainable.)*

**Full brew recipes** — `plugins/BreweryX/recipes.yml`. `wood` is the barrel type (0 = any/none, 1 birch, 2 oak, 3 jungle, 4 spruce, 5 acacia, 6 dark oak in BreweryX's numbering); `age` is in **in-game barrel "years"** where 1 year = **20 minutes real time** (`agingYearDuration: 20`). Names are Bad / Normal / Good quality tiers.

| Recipe | Ingredients | Cook (min) | Distil runs × time | Wood | Age (yr) | Difficulty | Alcohol | Effects |
|---|---|---|---|---|---|---|---|---|
| Wheatbeer | Wheat ×3 | 8 | — | 1 | 2 | 1 | 5 | — |
| Beer | Wheat ×6 | 8 | — | 0 | 3 | 1 | 6 | — |
| Darkbeer | Wheat ×6 | 8 | — | 6 | 8 | 2 | 7 | — |
| Red Wine | Sweet Berries ×5 | 5 | — | 0 | 20 | 4 | 8 | — |
| Mead | Sugar Cane ×6 | 3 | — | 2 | 4 | 2 | 9 | — |
| Apple Mead | Sugar Cane ×6 + Apple ×2 | 4 | — | 2 | 4 | 4 | 11 | Water Breathing I–II, 150 |
| Apple Cider | Apple ×14 | 7 | — | 0 | 3 | 4 | 7 | — |
| Apple Liquor / Calvados | Apple ×12 | 16 | 3 × default | 5 | 6 | 5 | 14 | — |
| Whiskey | Wheat ×10 | 10 | 2 × 50 | 4 | 18 | 7 | 26 | — |
| Rum | Sugar Cane ×18 | 6 | 2 × 30 | 2 | 14 | 6 | 30 | Fire Resistance I 20–100, Poison I→0 30→0 |
| Vodka | Potato ×10 | 15 | 3 × default | — | 0 | 4 | 20 | Weakness 15, Poison 10 |
| Mushroom Vodka | Potato ×10 + Red Mushroom ×3 + Brown Mushroom ×3 | 18 | 5 × default | — | 0 | 7 | 18 | Weakness 80, Nausea 27, Night Vision 50–80, Blindness 12–2, Slowness 10–3 |
| Gin | Wheat ×9 + blue-flowers ×6 + Apple ×1 | 6 | 2 × default | — | — | 6 | 20 | — |
| Tequila | Cactus ×8 | 15 | 2 × default | 1 | 12 | 5 | 20 | — |
| Absinthe | Short Grass ×15 | 3 | 6 × 80 | — | — | 8 | 42 | Poison 15–25 |
| Green Absinthe | Short Grass ×17 + Poisonous Potato ×2 | 5 | 6 × 85 | — | — | 9 | 46 | Poison 25–40, Instant Damage II, Night Vision 40–60 |
| Potato soup | Potato ×5 + Short Grass ×3 | 3 | — | — | — | 1 | 0 | Instant Health 0–1 |
| Coffee | Cocoa Beans ×12 + Milk Bucket ×2 | 2 | — | — | — | 3 | **−6** | Regeneration I 2–5, Speed I 30–140 |
| Eggnog / Advocaat | Egg ×5 + Sugar ×2 + Milk Bucket ×1 | 2 | — | — | 3 | 4 | 10 | — |
| Golden Vodka | Potato ×10 + Gold Nugget ×2 | 18 | 3 × default | — | 0 | 6 | 20 | Weakness 28, Poison 4 |
| Burning Whiskey | Wheat ×10 + Blaze Powder ×2 | 12 | 3 × 55 | 4 | 18 | 7 | 28 | drinkmessage: "You get a burning feeling in your mouth" |
| Hot Chocolate | Cookie ×3 | 2 | — | — | — | 2 | 0 | Haste 40 |
| Iced Coffee | Cookie ×8 + Snowball ×4 + Milk Bucket ×1 | 1 | — | — | — | 4 | **−8** | Regeneration 30, Speed 10 |
| **Big Gulp** *(player-created via DrinkBuilder)* | Milk Bucket ×1 + Rabbit Foot ×1 + MMOItems:BARK ×1 | 4 | 0 | oak | 0 | 3 | 0 | — (colour `12c436`) |

*(The `ex` recipe in `recipes.yml` has `enabled: false` and is not obtainable.)*

**Custom item aliases** usable in recipes (`plugins/BreweryX/custom-items.yml`): `blue-flowers` = Cornflower **or** Blue Orchid; `rasp` = any item named "&cRaspberry"; `modelitem` = paper with CMD 10234 or 30334; plus two unused examples (`ex-item`, `ex-item2`).

### Player command table
Base command `/breweryx`, **aliases `/brewery` and `/brew`** (`commandAliases: [brewery, brew]` in `plugins/BreweryX/config.yml`).

The permission group `brewery.user` has **`default: true`** in the jar's `plugin.yml`, so every player has its children. Those are the player commands:

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/brew help [page]` | `/brewery help`, `/breweryx help` | Shows the paged command list | No permission node |
| `/brew info` | as above | Shows **your** current drunkenness % and quality | `brewery.cmd.info` — granted by `brewery.user`, **default true** |
| `/brew unlabel` | as above | Removes the detailed brewing label from the potion in your hand | `brewery.cmd.unlabel` — **default true** |
| `/brew version` | as above | Shows BreweryX version / misc info | `brewery.cmd.version` — **default true** |

Also granted to every player by default (not commands, but worth a wiki note): `brewery.createbarrel` (small + big), `brewery.openbarrel` (small, big, and vanilla MC barrels), `brewery.cauldron.time`, `brewery.cauldron.insert`, `brewery.cauldron.fill`.

Excluded — moderator (`brewery.mod`, no default) and admin (`brewery.admin`, **default op**) commands:
`/brew info <player>`, `/brew seal`, `/brew puke [player] [amount]`, `/brew set <player> <drunkenness> [quality]`, `/brew create|give <recipe> [quality] [player]`, `/brew drink <recipe> [quality] [player]`, `/brew copy [qty]`, `/brew delete`, `/brew static`, `/brew distill [runs]`, `/brew age <barrel type> <time>`, `/brew simulate <options> [ingredients]`, `/brew itemname`, `/brew reload`, `/brew reloadaddons`, `/brew datamanager`, `/brew wakeup add|list|check|remove`.
Bypass nodes (staff): `brewery.bypass.logindeny`, `brewery.bypass.overdrink`, `brewery.bypass.teleport`, `brewery.bypass.chatdistort` (explicitly `default: false`).

### Numbers that matter to players
- **Ageing rate: 1 barrel "year" = 20 minutes real time** (`agingYearDuration: 20`). Red Wine's `age: 20` therefore needs ~**6 h 40 m** in a barrel; Whiskey and Burning Whiskey (`age: 18`) ~**6 h**; Rum (14) ~**4 h 40 m**; Tequila (12) ~**4 h**; Darkbeer (8) ~**2 h 40 m**.
- **Cooking time** in recipes is in minutes of cauldron boil.
- **Difficulty 1–9** — how precisely you must hit the cook time / distill runs / age to get the good-quality tier. Absinthe (8) and Green Absinthe (9) are the hardest; beers and Potato soup (1) the easiest.
- **Alcohol 0–46** per drink. Coffee (−6) and Iced Coffee (−8) **reduce** drunkenness.
- **Sobering up**: `drainItems: [BREAD/4, MILK_BUCKET/2]` — eating bread drains 4 drunkenness, drinking milk drains 2. Base natural recovery is the `brewery.recovery.2` node (2 per minute) and alcohol sensitivity is `brewery.sensitive.100` (100 %).
- **Hangover lasts up to 7 days** (`hangoverDays: 7`).
- **Being drunk**: stumbling is at **100 %** strength (`stumblePercent: 100`); chat distortion is **on** (`enableChatDistortion: true`) and also distorts these commands: `/gl /global /fl /s /letter /g /l /lokal /local /mail send /m /msg /w /whisper /reply /r /t /tell`. Text inside `*…*` or `[…]` is **not** distorted (`distortBypass`). Signs are not distorted.
- **Puking**: enabled, spawns **Soul Sand** items that despawn after **60 s** (`enablePuke`, `pukeItem: [SOUL_SAND]`, `pukeDespawntime: 60`).
- **Login while hammered**: you can be denied login (`enableLoginDisallow: true`) but you are **not kicked for overdrinking** (`enableKickOnOverdrink: false`). Wakeup points are enabled (`enableWake: true`) and passing out sends you home via `cmd: home` (`enableHome: true`, `homeType: 'cmd: home'`).
- Barrel capacity: large 3 rows, small 1 row, vanilla MC barrel max 6 brews. Hoppers can dump brews out of barrels (`brewHopperDump: true`).
- Brews are **not** restricted to barrels only (`onlyAllowBrewsInBarrels: false`).

### Cross-links
- **DrinkBuilder** writes player-designed recipes directly into `recipes.yml` (see the `dev_ukindaickyngl_big_gulp` entry).
- **ItemsAdder** and **MMOItems** are soft-depends and are usable as recipe ingredients (Big Gulp uses `MMOItems:BARK`).
- **Land/region protection**: WorldGuard, GriefPrevention, Towny, Lands, LWC, BlockLocker are all enabled (`useWorldGuard/useLWC/useGriefPrevention/useTowny/useLands/useBlockLocker: true`) — barrels respect them. **LogBlock** and **CoreProtect**-style logging: `useLogBlock: true`.
- **Essentials** — `homeType: 'cmd: home'` runs `/home` when a drunk player passes out.
- **PlaceholderAPI** soft-depend for drunkenness placeholders.
- Storage is **SQLite** at `plugins/BreweryX/brewery-data.db`.

### Uncertain / unverified
- BreweryX's numeric `wood:` → tree-species mapping is a plugin-internal table; I did **not** read it out of the jar. The mapping given above (0 any, 1 birch, 2 oak, 3 jungle, 4 spruce, 5 acacia, 6 dark oak) is the documented upstream default and should be re-checked before publishing. Note the Big Gulp entry uses the newer string form `wood: oak`.
- `newBarrelTypeAlgorithm: false` — the practical effect on which barrel types satisfy which recipe was not verified.
- What exactly "sealing" strips from a brew, and whether players can actually use the Sealing Table without `brewery.cmd.seal` — the block is enabled and craftable, but I did not confirm the block's permission check.
- Distill time default (when `distilltime` is omitted) was not read from the jar.
- The `weekend`-style rewards/economy value of brews (ChestShop/Shopkeepers integration) is not configured in this folder.

---

## 4. CustomCrops

### What it is
A farming system that replaces vanilla crop blocks with 30 custom, multi-stage crops planted in watered pots — with watering cans, sprinklers, fertilisers, and per-crop profession permissions.

### How a player actually uses it
1. **Get a pot.** The pot uses vanilla farmland underneath (`vanilla-farmland: true`, `plugins/CustomCrops/contents/pots/default.yml`). Till ground as normal.
2. **Water the pot.** Options:
   - Right-click the pot with a **water bottle/potion** (`fill-method.method_1: item: POTION`, returns a Glass Bottle, +1 water).
   - Right-click water with the **Watering Can** to fill it, then right-click pots to water a **3×3 area**.
   - The pot **absorbs rain and nearby water automatically** (`absorb-rainwater: true`, `absorb-nearby-water: true`).
   - Place a **Sprinkler** and fill it with a Water Bucket (+3) or Potion (+1).
   Right-clicking a pot shows a water bar hologram for 10 ticks.
3. **Plant.** Right-click the watered pot holding the crop's seed item. You need the crop's **profession permission** or you get *"You don't have permission to plant this crop"*.
4. **Wait.** Crops advance one growth point per tick cycle **only while the pot's moisture is above 6** (`grow-conditions: moisture-more-than 6`, identical in all 30 crop files). Growth ticks are scheduled every **3 world ticks-of-the-plugin** with `random-tick-speed: 30` and `min-tick-unit: 200` (`plugins/CustomCrops/config.yml`).
5. **Speed it up (optional).** Right-click the growing crop with **Bone Meal** for a chance at +1 or +2 points (see numbers below), or apply a fertiliser to the pot.
6. **Harvest.** Right-click the fully-grown crop **with an empty hand** (or break it). You get the produce plus a seed back.

All crops are `type: ITEM_FRAME` display entities, so they are **not** vanilla crop blocks.

### Content it adds ON THIS SERVER

**30 crops** (`plugins/CustomCrops/contents/crops/*.yml`). Every crop drops **2–4 produce (100 % chance)** and **1 seed (100 % chance)**. "Points" = growth stages (max-points). "Regrows" means harvesting a mature plant rolls it back to point 2 instead of destroying it (a tree/bush), so you keep harvesting from the same plant.

| Crop | Seed item | Permission | Growth points | Produce (2–4) | Regrows? |
|---|---|---|---|---|---|
| Apple | `playbox_custom_crops:apple_seeds` | `professions.fruits` | 5 | vanilla `APPLE` | **Yes** (→2) |
| Banana | `…:banana_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:BANANA` | **Yes** |
| Cactus Fruit | `…:cactusfruit_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:CACTUS_FRUIT` | **Yes** |
| Cherry | `…:cherry_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:CHERRY` | **Yes** |
| Grape | `…:grape_seeds` | `professions.fruits` | 5 | `MMOItems:FOODS:GRAPE` | **Yes** |
| Lemon | `…:lemon_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:LEMON` | **Yes** |
| Lime | `…:lime_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:LIME` | **Yes** |
| Orange | `…:orange_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:ORANGE` | **Yes** |
| Peach | `…:peach_seeds` | `professions.fruits` | 4 | `MMOItems:FOODS:PEACH` | **Yes** |
| Pineapple | `…:pineapple_seeds` | `professions.fruits` | 3 | `MMOItems:FOODS:PINEAPPLE` | No |
| Pistachio | `…:pistachio_seeds` | `professions.fruits` | 3 | `MMOItems:FOODS:PISTACHIO` | **Yes** |
| Plum | `…:plum_seeds` | `professions.fruits` | 5 | `MMOItems:FOODS:PLUM` | **Yes** |
| Strawberry | `…:strawberry_seeds` | `professions.fruits` | 2 | `MMOItems:FOODS:STRAWBERRY` | No |
| Tomato | `…:tomato_seeds` | `professions.fruits` | 3 | `MMOItems:FOODS:TOMATO` | No |
| Corn | `…:corn_seeds` | `professions.vegetables` | 3 | `MMOItems:FOODS:CORN` | No |
| Cucumber | `…:cucumber_seeds` | `professions.vegetables` | 3 | `MMOItems:FOODS:CUCUMBER` | No |
| Garlic | `…:garlic_seeds` | `professions.vegetables` | 3 | `MMOItems:FOODS:GARLIC` | No |
| Lettuce | `…:lettuce_seeds` | `professions.vegetables` | 2 | `MMOItems:FOODS:LETTUCE` | No |
| Mustard | `…:mustard_seeds` | `professions.vegetables` | 4 | `MMOItems:INGREDIENTS:MUSTARD_SEEDS` | No |
| Olive | `…:olive_seeds` | `professions.vegetables` | 4 | `MMOItems:FOODS:OLIVE` | **Yes** |
| Onion | `…:onion_seeds` | `professions.vegetables` | 2 | `MMOItems:FOODS:ONION` | No |
| Rhubarb | `…:rhubarb_seeds` | `professions.vegetables` | 2 | `MMOItems:FOODS:RHUBARB` | No |
| Rice | `…:rice_seeds` | `professions.vegetables` | 3 | `MMOItems:INGREDIENTS:RICE` | No |
| Yeast | `…:yeast_seeds` | `professions.vegetables` | 3 | `MMOItems:INGREDIENTS:YEAST` | No |
| Basil | `…:basil_seeds` | `professions.spices` | 3 | `MMOItems:INGREDIENTS:BASIL` | No |
| Black Pepper | `…:blackpepper_seeds` | `professions.spices` | 3 | `MMOItems:INGREDIENTS:PEPPER` | No |
| Cinnamon | `…:cinnamon_seeds` | `professions.spices` | 4 | `MMOItems:INGREDIENTS:CINNAMON` | No |
| Nutmeg | `…:nut_seeds` | `professions.spices` | 4 | `MMOItems:INGREDIENTS:NUTMEG` | No |
| Spice Leaf | `…:spiceleaf_seeds` | `professions.spices` | 2 | `MMOItems:INGREDIENTS:SPICE_LEAF` | No |
| Vanilla | `…:vanilla_seeds` | `professions.spices` | 4 | `MMOItems:INGREDIENTS:VANILLA` | No |

**Three professions gate the whole system**: `professions.fruits` (14 crops), `professions.vegetables` (10), `professions.spices` (6). Without the node you can neither plant nor harvest that crop.

**Watering Can** (`plugins/CustomCrops/contents/watering-cans/default.yml`):

| Property | Value |
|---|---|
| Item | `playbox_custom_crops:watering_can` |
| Capacity | 20 water |
| Water used per use | 5 |
| Area watered | 3 × 3 |
| Refill | right-click a water source, +5 per click |
| Works with sprinklers | sprinkler_1, 2, 3 |

**Sprinklers** (`plugins/CustomCrops/contents/sprinklers/default.yml`) — furniture; refill with Water Bucket (+3, returns Bucket) or Potion (+1, returns Glass Bottle). **Sneak + right-click forces an immediate watering tick.**

| Sprinkler | Range | Storage | Water per tick | Working mode |
|---|---|---|---|---|
| sprinkler_1 | 1 (3×3) | 4 | 1 | 2 |
| sprinkler_2 | 1 (3×3) | 4 | 1 | 1 |
| sprinkler_3 | **2 (5×5)** | 4 | 1 | 1 |

**Fertilisers** (`plugins/CustomCrops/contents/fertilizers/default.yml`) — 15 items in 5 families × 3 tiers. "Times" = number of pot tick cycles it lasts. "Before plant" = must be applied to an empty pot.

| Fertiliser | Type | Lasts (ticks) | Apply before planting? | Effect |
|---|---|---|---|---|
| quality_1 | QUALITY | 28 | Yes | Quality roll ratio **7 / 2 / 1** (70 % / 20 % / 10 %) |
| quality_2 | QUALITY | 28 | Yes | Ratio **11 / 6 / 3** (55 % / 30 % / 15 %) |
| quality_3 | QUALITY | 28 | Yes | Ratio **2 / 2 / 1** (40 % / 40 % / 20 %) |
| soil_retain_1 | SOIL_RETAIN | 28 | No | 10 % chance to not consume water |
| soil_retain_2 | SOIL_RETAIN | 28 | No | 20 % chance |
| soil_retain_3 | SOIL_RETAIN | 28 | No | 30 % chance |
| speed_grow_1 | SPEED_GROW | 14 | Yes | 50 % chance of +1 extra growth point |
| speed_grow_2 | SPEED_GROW | 14 | Yes | 70 % → +1, 10 % → +2 |
| speed_grow_3 | SPEED_GROW | 14 | Yes | 80 % → +1, 40 % → +2, 10 % → +3 |
| variation_1 | VARIATION | 14 | No | 2 % extra chance of a crop variant |
| variation_2 | VARIATION | 14 | No | 4 % |
| variation_3 | VARIATION | 14 | No | 8 % |
| yield_increase_1 | YIELD_INCREASE | 14 | Yes | 80 % → +1 drop, 40 % → +2, 10 % → +3 |
| yield_increase_2 | YIELD_INCREASE | 14 | Yes | 100 % → +1, 60 % → +2, 20 % → +3 |
| yield_increase_3 | YIELD_INCREASE | 14 | Yes | 100 % → +2, 40 % → +3 |

### Player command table
**No player commands.** Every command in `plugins/CustomCrops/commands.yml` carries an explicit admin permission node.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | All interaction is right-clicking pots and crops |

Excluded admin/staff commands (`plugins/CustomCrops/commands.yml`), base `/customcrops` with alias `/ccrops`:
`reload` (`customcrops.command.reload`), `season get` / `season set`, `date get` / `date set`, `debug data` / `debug worlds` / `debug insight` (`customcrops.command.debug`), `force-tick`, `unsafe restore` / `unsafe delete` / `unsafe fix`.

### Numbers that matter to players
- **Watering is mandatory**: a crop only advances while pot moisture is **> 6**. Pot max water storage is **7** (`pots/default.yml`), so effectively the pot must be at **full water (7)** to grow.
- **Crops die**: every tick cycle where the crop is **not fully grown**, there is a **5 % chance of death** (`death-conditions.no_water`: `random 0.05` AND `point-less-than <max-points>`). This is identical in all 30 crop files. *(See the caveat in Uncertain below.)*
- **Bone Meal**: **10 % chance of +1 point**, **5 % chance of +2 points** per use (`custom-bone-meal.default.chance: {'1': 0.1, '2': 0.05}`) — identical on all 30 crops.
- **Yield**: always **2–4 produce + 1 seed** per harvest, before fertiliser bonuses.
- **Growth points needed**: 2 (Lettuce, Onion, Rhubarb, Spice Leaf, Strawberry) up to 5 (Apple, Grape, Plum).
- **Default quality ratio** when no fertiliser is used: **17 / 2 / 1** (85 % / 10 % / 5 %) — `plugins/CustomCrops/config.yml`, `mechanics.default-quality-ratio`.
- **Tick cadence**: `random-tick-speed: 30`, `min-tick-unit: 200`, crop/pot/sprinkler all `SCHEDULED_TICK` with `tick-interval: 3`.
- Trampling custom crops is **prevented** (`vanilla-farmland.prevent-trampling: true`).
- Crop stage items **cannot be dropped/picked up** as items (`prevent-dropping-stage-items: true`).

### Cross-links
- **MMOItems** — nearly every harvest is an MMOItems `FOODS:` or `INGREDIENTS:` item.
- **ItemsAdder** — the pack `playbox_custom_crops` supplies seeds, crop stage models, pots and watering can; `customcrops:` namespace supplies sprinklers and fertilisers (`plugins/ItemsAdder/contents/playbox_custom_crops`).
- **LuckPerms** — the `professions.fruits` / `.vegetables` / `.spices` nodes are the gate. These are almost certainly tied to the server's **profession/job system**.
- **PlaceholderAPI** — `other-settings.placeholder-register` maps `{skill-level}` to `%levelplugin_farming%`.
- **Cooking / DrinkBuilder** consume the produce.
- **FarmingUpgrade** does **not** apply here — CustomCrops crops are item-frame entities, not vanilla crop blocks.

### Uncertain / unverified
- **Seasons are OFF** on this server (`worlds.settings._DEFAULT_.season.enable: false`), so no crop has a seasonal restriction. Scarecrows (`scarecrow.enable: false`) and greenhouses (`greenhouse.enable: false`) are also **disabled** — do not describe them in the wiki.
- **Offline growth is OFF** (`offline-tick.enable: false`) — crops do not advance while the chunk/server is unloaded for that player. (Not fully verified whether this means server-wide or per-chunk.)
- Only the world **`TFMC_Map`** is enabled (`worlds.mode: whitelist`, `list: [TFMC_Map]`); nether and end are explicitly disabled.
- The `death-conditions` block is literally `random 0.05 AND point-less-than <max>` with **no water condition attached** despite the key being named `no_water`. I could not confirm from config alone whether the plugin implicitly only evaluates death conditions on unwatered pots. **Verify before writing "your crops have a 5 % chance to die every tick" into the wiki.**
- Exact real-time duration of one growth point is not derivable from config alone (`tick-interval: 3` × `min-tick-unit: 200` × `random-tick-speed: 30` needs the plugin's internal tick semantics). **Measure in-game.**
- `fertilized-pots.enable: false` — fertilised pots do **not** get a distinct visual model.
- Where players obtain seeds, watering cans, sprinklers and fertilisers (shop, quest, crafting) is not defined in this plugin's folder.

---

## 5. CustomFishing

### What it is
Replaces vanilla fishing with a skill minigame: when something bites you play a bar/hold/tension/dance minigame, and what you catch depends on your rod tier, the biome, and any hook and bait you have equipped.

### How a player actually uses it
1. **Get a rod.** Four tiers, all MMOItems (`plugins/CustomFishing/contents/rod/tfmc.yml`): `MMOItems:FISHING_RODS:FISHING_ROD`, `:STEEL_ROD`, `:ABYSSALITE_ROD`, `:MYTHRIL_ROD`.
2. **Attach a hook (optional).** Right-click the **rod** while holding a hook to attach it; the hook's remaining uses appear in the rod's lore. **Right-click the rod** (with the hook attached) to remove it. Lore text: *"Tip: Click the rod to add the hook"* / *"Right click the rod to remove the hook"* (`plugins/CustomFishing/contents/hook/tfmc.yml`).
3. **Equip bait (optional).** Put the bait in your **off-hand** — the lore says *"Put in the off-hand to use"* (`plugins/CustomFishing/contents/bait/tfmc.yml`).
4. **Cast.** Vanilla cast. Wait time is **100–600 ticks (5–30 s)** base, clamped to **50–1200 ticks (2.5–60 s)** after all modifiers (`plugins/CustomFishing/config.yml`, `mechanics.fishing-wait-time`).
5. **Play the minigame.** When it bites, one of 17 minigames fires, at a difficulty tier set by your rod. Hold/Tension games prompt *"Press SNEAK to start"*; the Dance game maps ↑ = Jump, ↓ = Sneak, ← = Left-click, → = Right-click.
6. **Win → you get the loot** (plus a title "GG!"/"Good Job!" and, for sized fish, an actionbar showing the fish's length in cm and your personal record). **Lose →** "The fish got away…".
7. **Cook it.** A configured TFMC fish becomes a Cooking `seafood_whole` you can eat raw (food 6, nutrition 6), the same way you can eat a raw carrot. Cooking quality comes from the rod band (basic 1-2, steel 2-3, abyssalite 3-4, mythril 4-5), not CustomFishing stars. Cut it on the cutting board, then boil the portion in the pot. Cook times are in the Cooking section above.
8. **Sell.** `/sellfish` opens the Fish Market GUI.

### Content it adds ON THIS SERVER

**Rod → bait → hook → minigame tiers:**

| Rod (MMOItems id) | Matching bait | Matching hook | Hook durability | Hook wait-time × | Minigame tier | Exclusive loot family |
|---|---|---|---|---|---|---|
| `FISHING_ROD` | Fish Bait | Iron Hook | 250 uses | 0.9 | **easy** | fish_* (Raw Jellyfish, Raw Oarfish, Fish Scale/Fin/Sting/Tooth) |
| `STEEL_ROD` | Piranha Bait | Steel Hook | 500 uses | 0.8 | **normal** | piranha_* (Raw Piranha, Piranha Scale/Fin/Tooth, Jellyfish Sting) |
| `ABYSSALITE_ROD` | Shark Bait | Abyssalite Hook | 1000 uses | 0.7 | **hard** | shark_* (Raw Shark, Shark Scale/Fin/Tooth, Manta Sting) |
| `MYTHRIL_ROD` | Mythril/Orca Bait | Mythril Hook | 1500 uses | 0.6 | **very hard** | orca_* (Raw Orca, Orca Scale/Fin/Tooth, Shark Sting) |

Each bait gives **`group-mod <tier>_materials:+50`** and **`weight-mod cod/salmon/tropical_fish/pufferfish: −200`** — i.e. it strongly pushes you off vanilla fish and onto that tier's crafting materials (`contents/bait/tfmc.yml`).

**Minigames** (`plugins/CustomFishing/contents/minigame/tfmc_{easy,normal,hard,very_hard}.yml`) — 17 per tier:
- 7 × "Rainbow" (`game-type: accurate_click`, 7 sections, only one is a hit, **15 s** timer)
- 7 × "Accurate Click Bar" (`accurate_click`, 11 sections with a graded success band 0.2 / 0.6 / **1.0** / 0.6 / 0.2, **15–30 s**)
- 1 × Hold (`hold`) — hold sneak to keep the pointer in the judgment band; 3 holds required (3 s, 3 s, 4 s), **30 s**
- 1 × Tension (`tension`) — the fish struggles and tension spikes; fail if tension peaks, **30 s**
- 1 × Dance (`dance`) — press the arrow sequence; button count = difficulty ÷ 4; easy tier uses only ←→, higher tiers use ←→↑↓, **20 s**

Difficulty ranges per tier (higher = harder):

| Tier | Rainbow | Accurate Click Bar | Hold | Tension | Dance |
|---|---|---|---|---|---|
| easy (Fishing Rod) | 15–30 | 15–30 → 10–20 | 15–35 | 20–35 | 15–30 |
| normal (Steel Rod) | 30–60 | 30–60 → 20–30 | 35–60 | 35–50 | 30–60 |
| hard (Abyssalite Rod) | 60–90 | 60–90 | 60–90 | 60–90 | 60–90 |
| very hard (Mythril Rod) | 90–100 | 90–100 | 90–100 | 90–100 | 90–100 |

Selection weight within a tier: each Rainbow and each Click Bar variant `+1`, but Hold, Tension and Dance are `+7` each — so you get the big three far more often than any single bar variant.

**16 custom TFMC fish** (`plugins/CustomFishing/contents/item/tfmc_fish_fishingrod.yml`) — all render as `cod` with a custom model. Size is recorded and compared to your personal record.

| Fish | Biome group | Size range (cm) | CMD |
|---|---|---|---|
| Tuna Fish | tfmc_ocean | 30–200 | 50001 |
| Pike Fish | tfmc_ocean | 15–150 | 50004 |
| Sardine Fish | tfmc_ocean | 5–30 | 50016 |
| Sunfish | tfmc_ocean | 15–300 | — |
| Cat Fish | tfmc_cold_ocean | 20–250 | — |
| Void Salmon | tfmc_cold_ocean | 10–120 | — |
| Woodskip Fish | tfmc_cold_ocean | 5–40 | — |
| Sturgeon Fish | tfmc_cold_ocean | 20–300 | — |
| Red Snapper Fish | tfmc_warm_ocean | 10–100 | — |
| Octopus | tfmc_warm_ocean | 10–80 | — |
| Jellyfish (blue) | tfmc_warm_ocean | 1–40 | — |
| Jellyfish (pink) | tfmc_warm_ocean | 1–40 | — |
| Gold Fish | tfmc_river | 5–30 | — |
| Perch Fish | tfmc_river | 10–60 | — |
| Mullet Fish | tfmc_river | 10–120 | — |
| Carp Fish | tfmc_river | 20–80 | — |

**Water loot table** (`plugins/CustomFishing/loot-conditions.yml`). Weights are additive; `group_total:X:+N` spreads N across every member of group X. Identical shape for all four rods, only the tier-exclusive groups and the guide book change:

| Biome group | Biomes | Loot weights (Fishing Rod example) |
|---|---|---|
| ocean_loot | ocean, deep_ocean | cod **+200**, fish_ingredients **+200**, fragments **+200**, fish_materials **+200**, tfmc_ocean **+100**, disc_fragment +40, fossil +30, raredisc_fragment +20, fisher_fish_book **+5**, vanilla_disc_1 +5 |
| cold_ocean_loot | cold_ocean, deep_cold_ocean, frozen_ocean, deep_frozen_ocean | cod +100, salmon +100, then as above with tfmc_cold_ocean +100 and vanilla_disc_2 +5 |
| warm_ocean_loot | lukewarm_ocean, deep_lukewarm_ocean, warm_ocean | tropical_fish +100, pufferfish +100, tfmc_warm_ocean +100, vanilla_disc_3 +5, rest as above |
| river_loot | river, beach | salmon +200, tfmc_river +100, vanilla_disc_4 +5, rest as above |

**Land / non-water loot** — fishing in any other biome (the `!biome` exclusion list) gives blocks, mob drops and pottery sherds instead:

| Biome group | Biomes | Loot weights |
|---|---|---|
| coldland_loot | jagged_peaks, frozen_peaks, stony_peaks, snowy_slopes, snowy_taiga, snowy_plains, ice_spikes | coldland_blocks **+400**, mob_drops +250, fragments +130, pottery_1 +200, fossil +20 |
| highland_loot | meadow, cherry_grove | highland_blocks +400, mob_drops +250, fragments +130, pottery_2 +200, fossil +20 |
| forest_loot | forest, windswept_forest, flower_forest, birch_forest, old_growth_birch_forest, dark_forest | forest_blocks +400, …, pottery_3 +200 |
| taiga_loot | taiga, old_growth_pine_taiga, old_growth_spruce_taiga, windswept_hills, windswept_gravelly_hills, grove | taiga_blocks +400, …, pottery_4 +200 |
| jungle_loot | jungle, sparse_jungle, bamboo_jungle, pale_garden | jungle_blocks +400, …, pottery_5 +200 |
| swamp_loot | swamp, mangrove_swamp | swamp_blocks +400, …, pottery_6 +200 |
| flatland_loot | plains, sunflower_plains | flatland_blocks +400, …, pottery_7 +200 |
| aridland_loot | desert, savanna_plateau, windswept_savanna, badlands, wooded_badlands, eroded_badlands | aridland_blocks +400, …, pottery_8 +200 |

**Loot group contents** (`contents/item/tfmc_land_fishingrod.yml`, `tfmc_water_fishingrod.yml`):

| Group | Members (quantity given) |
|---|---|
| coldland_blocks | Ice ×4, Snowball ×16 |
| highland_blocks | Cherry Log ×4 |
| forest_blocks | Oak Log ×4, Birch Log ×4, Dark Oak Log ×4 |
| taiga_blocks | Spruce Log ×4 |
| jungle_blocks | Jungle Log ×4 |
| swamp_blocks | Mangrove Log ×4, Lily Pad ×4 |
| flatland_blocks | Honey Bottle ×4, Honeycomb ×4 |
| aridland_blocks | Sand ×4, Red Sand ×4 |
| mob_drops | Bone ×4, Rotten Flesh ×1, String ×1, Spider Eye ×1 |
| fragments | `MATERIALS:RAWIRON_FRAGMENT` ×1–10, `RAWGOLD_FRAGMENT` ×1–10, `DIAMOND_FRAGMENT` ×1–10 |
| fish_ingredients | `INGREDIENTS:RAW_JELLYFISH` ×2, `RAW_OARFISH` ×2 |
| fish_materials | `MATERIALS:FISH_SCALE`, `FISH_FIN`, `FISH_STING`, `FISH_TOOTH` (×1 each) |
| piranha_ingredients / piranha_materials | `RAW_PIRANHA` ×2 / `PIRANHA_SCALE`, `PIRANHA_FIN`, `JELLYFISH_STING`, `PIRANHA_TOOTH` |
| shark_ingredients / shark_materials | `RAW_SHARK` ×2 / `SHARK_SCALE`, `SHARK_FIN`, `MANTA_STING`, `SHARK_TOOTH` |
| orca_ingredients / orca_materials | `RAW_ORCA` ×2 / `ORCA_SCALE`, `ORCA_FIN`, `SHARK_STING`, `ORCA_TOOTH` |
| pottery_1 | Angler, Archer, Arms Up sherds (×4 each) |
| pottery_2 | Blade, Brewer, Burn |
| pottery_3 | Danger, Explorer, Flow |
| pottery_4 | Friend, Guster, Heart |
| pottery_5 | Heartbreak, Howl, Miner |
| pottery_6 | Mourner, Plenty, Prize |
| pottery_7 | Scrape, Sheaf, Shelter |
| pottery_8 | Skull, Snort |
| vanilla_disc_1 | 13, Cat, Blocks, Chirp, Far |
| vanilla_disc_2 | Mall, Mellohi, Stal, Strad, Ward |
| vanilla_disc_3 | 11, Wait, Otherside, 5 |
| vanilla_disc_4 | Pigstep, Relic, Creator, Precipice |
| *(ungrouped, water)* | Fossil ×1, Disc Fragment ×1, Rare Disc Fragment ×1 |

**Guide books** — one per rod tier, weight `+5`: `FISHER_FISH_BOOK` "Fish Simple Guide", `FISHER_PIRANHA_BOOK` "Fisher General Guide", `FISHER_SHARK_BOOK` "Fisher Advanced Guide", `FISHER_ORCA_BOOK` "Fisher Expert Guide".

**Fish Market GUI** (`plugins/CustomFishing/config.yml`, `mechanics.market`), title "Fish Market":
- Layout: 9×5, with a 7×3 area to drop items in, a "sell these" button at the bottom-middle and a "sell everything in inventory" slot, plus a red Close pane.
- **Daily earnings cap: 10 000 coins** (`limitation.enable: true`, `earnings: "10000"`). Multiplier 1.
- Price formula: **`{base} + {bonus} × {size}`** — larger fish are worth more.
- Base prices set in config: Cod 10, Pufferfish 10, Salmon 10, Tropical Fish 10, Paper(CMD 999) 5.
- Bundles and shulker boxes are **not** accepted (`impossible_requirement`).

**Global effect**: while the `weekend_competition` is running, wait time is multiplied by **0.85**.

### Player command table
From `plugins/CustomFishing/commands.yml` + jar `plugin.yml` permission defaults.

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/sellfish` | — | Opens the **Fish Market** GUI to sell your catch | Permission `customfishing.sellfish`, **`default: true`** in the jar's `plugin.yml` → every player has it. Daily cap 10 000 coins. |
| `/fishingbag` | — | Would open your personal Fishing Bag | Permission `fishingbag.user`, **`default: true`**. **BUT** `mechanics.fishing-bag.enable: false` in `config.yml`, so the bag feature is switched off on this server — see Uncertain. |

Excluded admin/staff commands (`plugins/CustomFishing/commands.yml`), base `/customfishing`, alias `/cfishing`:
`reload`; `items get` / `items give` / `items give-by-uuid` / `items import`; `competition start` / `stop` / `end`; `open market` / `open bag`; `fishingbag edit-online` / `edit-offline`; `data unlock` / `export` / `import`; `statistics set` / `reset` / `query` / `add`; `debug loot` / `debug biome` / `debug snbt`. Also `fishingbag.collectloot` is **`default: false`** (staff-only).

### Numbers that matter to players
- **Wait for a bite: 5–30 s** base (100–600 ticks), floor 2.5 s / ceiling 60 s after modifiers.
- **Hook wait-time multipliers**: Iron ×0.9, Steel ×0.8, Abyssalite ×0.7, Mythril ×0.6.
- **Hook durability**: Iron 250, Steel 500, Abyssalite 1000, Mythril 1500 uses. Durability shows in the rod's lore as *"<Hook>: {dur} times left"*. Durability is displayed as `Durability: {dur} / {max}`.
- **Bait** shifts loot by group `+50` and de-weights the four vanilla fish by `−200`.
- **Minigame timers**: Rainbow 15 s, Click Bar 15–30 s, Hold 30 s (3+3+4 s of holding), Tension 30 s, Dance 20 s.
- **Fish sizes**: 1 cm (Jellyfish) up to 300 cm (Sunfish, Sturgeon). A new personal best plays a cowbell + bell and shows a gold `[New Record]` actionbar.
- **Market daily cap: 10 000 coins**; price scales with fish size.
- **Lava and void fishing are DISABLED** (`lava-fishing.enable: false`, `void-fishing.enable: false`).
- Multiple loot items spawn 4 ticks apart (`multiple-loot-spawn-delay: 4`).
- Totems: multiple different types may be active at once, but not two of the same type (`totem.allow-multiple-type: true`, `allow-same-type: false`).

### Cross-links
- **MMOItems** — all four rods are MMOItems, and nearly every custom drop is dispatched via `mi give <TYPE> <ID> {player} …`. `item-detection-order` puts MMOItems first.
- **MMOCore** — **every** successful catch runs `mmocore admin exp give {player} fisher <n>`: **10 XP** for vanilla fish / blocks / fragments / discs, **20 XP** for TFMC ingredients, materials, guide books and pottery sherds. This is the server's **Fisher profession** XP source.
- **Vault / an economy plugin** (likely DenarEconomy or EconomyBridge) — `/sellfish` pays out via `give-money`.
- **ItemsAdder** — pack `customfishing` holds the fonts, bars, offsets and fish models.
- **Cooking** — `RAW_*` fish ingredients feed the cooking pipeline.
- **PlaceholderAPI** — `{date}`, `{yaw}` registered.
- Storage: **H2** (`plugins/CustomFishing/h2.mv.db`, `database.yml`).

### Uncertain / unverified
- **Fishing Bag is disabled** (`mechanics.fishing-bag.enable: false`) even though `/fishingbag` is enabled with a `default: true` permission. I could not confirm what the command does when the feature is off (silently nothing, or an error). **Test in-game before documenting `/fishingbag`.**
- **The fishing competition never runs**: `weekend_competition` has `min-players: 20000`, no `start-weekday`, no `start-time`, and `duration: 0` (`contents/competition/default.yml`). Bossbar and actionbar are both `enable: false`. Treat competitions as **not a live feature** unless staff start one manually with `/cfishing competition start`.
- **The upstream sample loot in `contents/item/default.yml` (1318 lines) is unreachable.** Its items live in groups `ocean`, `river`, `cave`, `lava`, `swamp`, `warm_ocean`, `no_star`, `silver_star`, `golden_star` — none of which appear in `loot-conditions.yml`. Do **not** document star-rated fish, cave fish or lava fish as obtainable.
- Consequently the default **Luck of the Sea** enchant effects (`contents/enchant/default.yml`, `silver_star:+2/+4/+6`, `golden_star:+1/+2/+3`) target groups that no reachable loot belongs to, so Luck of the Sea is probably **inert** here. **Lure** (`lure:1` → `wait-time −80`) is conditioned on `in-lava OR in-void`, both of which are disabled — also likely inert. Not confirmed by testing.
- `contents/equipment/default.yml` (Angler's Helmet, Deep Sea Chestplate, Swift Leggings…) and `contents/totem/default.yml` are upstream defaults referencing the same unreachable star groups; I found no TFMC-specific equipment or totem file. Probably unused — **verify with staff**.
- The **Fish Finder** (`contents/util/default.yml`, CMD 50000, 3 s cooldown) scans water for species, but `global-loot-property.show-in-fishfinder: false` makes every loot entry hidden by default. Whether it shows anything at all here is unconfirmed.
- `global-loot-property.disable-game: true` is the default, and the TFMC loot files individually re-enable the minigame with `disable-game: false` on the *good* drops only. So catching a plain vanilla cod or a log may be **instant with no minigame**, while catching a TFMC ingredient/material/sherd plays one. This reading is from config structure, not from code — **verify**.
- Auto-fishing and skip-game are hard-blocked (`impossible_requirement`) — nobody can skip the minigame.
- How players obtain rods, baits and hooks (shop, craft, quest) is not in this plugin's folder.

---

## 6. FarmingUpgrade

### What it is
A small quality-of-life plugin for vanilla farming: enchanted hoes harvest and replant a whole area in one click, and farmland stays wet far more easily.

### How a player actually uses it
1. **Harvest an area**: right-click (break) a mature vanilla crop with a hoe. Every mature crop within the hoe's radius is harvested at once, the drops go **straight into your inventory** (`collectDefault: true`), and each is **automatically replanted** (`replantDefault: true`) after a random **10–20 tick** delay (0.5–1 s).
2. **Plant an area**: with a hoe that has `plant` enabled (`plantDefault: true`), you can plant seeds across all empty farmland inside the radius in one action. Planting does **not** damage the tool — only harvesting does.
3. **Immature crops are safe**: `onlyHarvestMature: true` means the area-harvest never destroys unripe crops.
4. Unbreaking on the hoe works normally to save durability (`applyUnbreaking: true`).

All from `plugins/FarmingUpgrade/config.yml`.

### Content it adds ON THIS SERVER
No items, no blocks, no recipes. It **modifies vanilla mechanics only**.

**Crops it treats as farmable** (`toolUpgrade.crops`): Wheat ↔ Wheat Seeds, Potatoes ↔ Potato, Carrots ↔ Carrot, Beetroots ↔ Beetroot Seeds, Nether Wart ↔ Nether Wart. Nothing else is area-harvested or auto-replanted.

**Hoe tool table** (`toolUpgrade.tools`) — matched top-to-bottom, first match wins:

| Tool | Base radius | Damage per harvest |
|---|---|---|
| Wooden Hoe | **+0.5** | 1 |
| Stone Hoe | **+0.5** | 1 |
| Iron Hoe | **−5.0** | 1 |
| Diamond Hoe | **−6.0** | 1 |
| Netherite Hoe | **−7.0** | 1 |

All tools inherit `replant: true`, `collect: true`, `plant: true` from the defaults.

**Trampling**: `trampleUpgrade` is active. Crops are reset to their first growth stage instead of the farmland being destroyed — but **walking/running does not trample at all** (`trampleByWalking: false`). Empty farmland **can** still be stomped back to dirt (`dryEmptyOnTrample: true`). Trampleable crops: Wheat, Melon Stem, Pumpkin Stem, Potatoes, Carrots, Beetroots, Nether Wart.

**Bonemeal upgrade is DISABLED** (the entire `bonemealUpgrade` block is commented out) — bonemeal behaves exactly like vanilla.

### Player command table
**No player commands.**

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| *(none)* | — | — | Purely passive mechanics |

Excluded admin/staff commands (`unzip -p plugins/farmingupgrade-1.7.2.jar plugin.yml`):
- `/farmingupgrade` — help + config reload. Permission `farmingupgrade.administrator`, **default: op**.

### Numbers that matter to players

**Radius formula** (`radiusPerEfficiencyLevel: 2.0`): `total radius = base radius + 2.0 × Efficiency level`, then **rounded down**. A radius of 0 affects only the clicked block; radius 1 = 3×3; radius 2 = 5×5.

| Hoe | Eff 0 | Eff I | Eff II | Eff III | Eff IV | Eff V |
|---|---|---|---|---|---|---|
| Wooden / Stone (base +0.5) | 0 → 1 block | 2 → **5×5** | 4 → **9×9** | 6 → 13×13 | 8 → 17×17 | 10 → 21×21 |
| Iron (base −5.0) | 1 block | 1 block | 1 block | 1 → **3×3** | 3 → **7×7** | 5 → 11×11 |
| Diamond (base −6.0) | 1 block | 1 block | 1 block | 1 block | 2 → **5×5** | 4 → **9×9** |
| Netherite (base −7.0) | 1 block | 1 block | 1 block | 1 block | 1 → **3×3** | 3 → **7×7** |

**Read that table carefully — it is deliberately inverted.** On this server an **unenchanted Wooden or Stone Hoe already gets a bigger effective area than an unenchanted Netherite Hoe**, because the better metals carry a large negative base radius. Higher-tier hoes only "catch up" with enough Efficiency, and even at Efficiency V a Netherite Hoe (7×7) is smaller than a Wooden Hoe at Efficiency II (9×9). This is a real, verified configuration choice in `plugins/FarmingUpgrade/config.yml` — flag it to the wiki writer as a likely point of player confusion.

**Hydration** (`hydrationUpgrade`) — hugely more generous than vanilla:

| Setting | This server | Vanilla |
|---|---|---|
| Horizontal water search radius | **12 blocks** | 4 |
| Search distance upward | **3 blocks** | 0 |
| Search distance downward | **3 blocks** | 0 |
| Unhydrated farmland turns to dirt | **No** (`dry: false`) | Yes |

So one water source hydrates a **25×25 footprint** and spans 3 blocks up/down, and dry farmland **never** reverts to dirt.

**Other numbers**: replant delay 10–20 ticks; tool damage 1 per harvest action (all hoes); particle multipliers all 1.0; tool swing particle on.

### Cross-links
- **Vanilla farming only.** It does *not* touch CustomCrops (item-frame entities, not crop blocks), and CustomCrops runs its own `vanilla-farmland.prevent-trampling` and moisture logic on pots.
- **Cooking** — the vanilla Wheat / Carrot / Potato / Beetroot this speeds up are Cooking's `conversions.yml` inputs (Wheat → Flour → Dough → Bread).
- **BreweryX** — Wheat, Potato and Apple farming feeds the beer / vodka / cider recipes.
- Land protection plugins are not referenced by FarmingUpgrade; area-harvest respecting WorldGuard/Towny claims is **unverified**.

### Uncertain / unverified
- Whether the area-harvest respects **WorldGuard / Towny / GriefPrevention / Lands** claim boundaries. FarmingUpgrade 1.7.2 declares no soft-depend on any of them in its `plugin.yml`. **Test before documenting.**
- Exact rounding: the config says "rounded down" for both the efficiency contribution and the total. I assumed `floor(base + 2×eff)`. The table above should be spot-checked in-game, especially the Wooden Hoe at Efficiency 0 (0.5 → 0).
- Whether "radius 0" means one block or a 3×3 — the config comment says *"0 radius means that only the clicked block is affected"*, which I took at face value.
- Golden Hoe is **not** in the tool list, so a golden hoe gets no FarmingUpgrade behaviour at all. Not verified in-game.
- The `nbt:`/`lore:`/`permission:` tool-filter features are all commented-out examples — no NBT-tagged or permission-gated special hoes exist on this server.

---

## Appendix — cross-plugin threads for the wiki writer

1. **The produce chain**: CustomCrops (grow) → MMOItems / ItemsAdder `tfmc_cooking` (item) → Cooking (cut, cook, plate) and DrinkBuilder/BreweryX (brew). See the namespace-mismatch warning in §1.
2. **The fishing chain**: CustomFishing (catch) → MMOItems `INGREDIENTS:RAW_*` → Cooking; and CustomFishing → MMOCore `fisher` profession XP → presumably the same profession system that grants `professions.fruits/vegetables/spices` for CustomCrops.
3. **Profession permissions** appear in two different namespaces: `professions.*` (CustomCrops), `tfmc.cooking.*` (Cooking quality perks). Both are LuckPerms nodes. Who grants them and how is **not** in these plugin folders.
4. **Donator ranks** `rpchar.group.noble / gilded / ascended / legacy` gate DrinkBuilder and are shared with RPCharacters.
5. **Money sinks/sources in this cluster**: `/sellfish` (max 10 000 coins/day) is the only one configured here.
