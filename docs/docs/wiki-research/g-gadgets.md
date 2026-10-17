# Wiki Research Dossier — "Gadgets" cluster

**Plugins covered:** MusicalInstruments, InteractibleFurniture, VehicleFramework, VFBuilders, GunsAndGadgets, Images

**Status:** factual dossier for a wiki writer. Every non-obvious claim is cited to a file path. Guesses are marked, never silent.

**Sources used**
- Live server data: `C:\Users\MSI\Desktop\plugins\<Plugin>\` (read-only)
- Source checkouts: `C:\Users\MSI\Desktop\plugin-src\{interactiblefurniture, vehicleframework, vfbuilders, gunsandgadgets, musical-instruments}`
- Resource pack / item defs: `C:\Users\MSI\Desktop\plugins\ItemsAdder\contents\...`, `C:\Users\MSI\Desktop\plugins\MMOItems\...`, `C:\Users\MSI\Desktop\plugins\ModelEngine\...`

**Deployed versions at research time** (snapshot from each jar's `plugin.yml`; not kept current)

| Plugin | Jar | Version |
|---|---|---|
| MusicalInstruments | `plugins\musicalinstruments-2.3.jar` | 2.3 |
| InteractibleFurniture | `plugins\interactiblefurniture-0.1.3-BETA.jar` | 0.1.3-BETA |
| VehicleFramework | `plugins\vehicleframework-1.1.11.jar` | 1.1.11 |
| VFBuilders | `plugins\vfbuilders-1.0.0.jar` | 1.0.0 |
| GunsAndGadgets | `plugins\gunsandgadgets-1.0.3.jar` | 1.0.3 |
| Images | `plugins\images-2.5.9.jar` | 2.5.9 (by Andavin, third-party) |

> **Version caveat that affects everything below.** Two source checkouts do not match the deployed jar:
> - `musical-instruments` source is **2.4**, the server runs **2.3**. Shallow clone, so no diff was possible.
> - `interactiblefurniture` source is **older** than the shipped jar (no `nested`, no `debug` command). Those subcommands were read from jar bytecode strings.

---

# 0. Cross-cutting: 3D model assets for the wiki

## 0.1 What the existing wiki renderer can load

- Component: `C:\Users\MSI\Desktop\TFMCWeb\frontend\app\components\wiki\StationModelViewer.tsx`
- Data field: `model?: { url: string; texture: string }` on `Slot` (data.ts:6) and `StationInfo` (data.ts:843)
- Path helpers: `T = (p) => "/wiki/textures/" + p` (data.ts:20), `M = (p) => "/wiki/models/" + p` (data.ts:858)
- Callers: `app\wiki\stations\[slug]\page.tsx:36` (full, OrbitControls) and `app\components\wiki\CraftingGrid.tsx:18` (`variant="thumb"`, controls disabled)

It is **raw three.js** (`three@^0.185.1`, `OrbitControls`) — no react-three-fiber, and there is no GLTFLoader anywhere in the repo. It `fetch()`es `url` as JSON and treats it as a **vanilla Minecraft JSON model**.

**Supported:** top-level `elements[]` with `from`/`to` (0–16 px space, divided by 16), per-face `uv:[u1,v1,u2,v2]` assumed on the **0–16 grid** (`texture_size` is read into the type but never used), single-axis `rotation:{angle,axis,origin}`, one `THREE.Mesh` per element in one `THREE.Group`, auto-framing from the bounding box.

**NOT supported:**
- `parent` inheritance — never read.
- **Multiple textures.** The `textures` map and `#0`/`#1`/`#particle` variables are parsed into the type but **never dereferenced**; every face gets the same single `texture` PNG via one shared `MeshLambertMaterial`. This is the biggest constraint.
- `display` transforms, `faces[].rotation`, `tintindex`, `cullface`.
- Blockbench `groups`/outliner, bones, per-bone transforms, animations, multi-part rigs.
- GLTF / OBJ / `.bbmodel`.
- Multi-axis rotation (one `rotateOnAxis` per element only).

Assets live at `frontend\public\wiki\models\*.json` (4 files today: alchemy/animal/engineer/magic station) and `frontend\public\wiki\textures\**` (141 PNGs). Each mounted viewer creates its **own WebGLRenderer + rAF loop**; browsers cap WebGL contexts at roughly 8–16, so a grid of 21 vehicle previews on one page is a genuine risk. Cleanup disposes renderer and controls but **not** geometries, material, or texture (GPU leak on repeated mount/unmount).

A separate, simpler `cubeFaces?: {up,down,north,south,east,west: string}` field exists at data.ts:855 for plain 6-face cube blocks.

## 0.2 Vehicles — where the models actually live

**Vehicles are ModelEngine rigs, not ItemsAdder items.** There is no ItemsAdder item for any vehicle. VehicleFramework hard-depends on ModelEngine (`plugin.yml`: `depend: [NBTAPI, ModelEngine, ProtocolLib, TLibs]`), and each vehicle YAML's `model:` key is a ModelEngine blueprint id.

Source of truth: `C:\Users\MSI\Desktop\plugins\ModelEngine\blueprints\**\<id>.bbmodel` — Blockbench project files with `meta.model_format: "free"`, `box_uv: false`, the **texture embedded as a base64 data-URI inside the .bbmodel itself**, plus an `animations[]` array and an `outliner[]` bone tree.

ModelEngine also emits a generated resource pack at
`C:\Users\MSI\Desktop\plugins\ModelEngine\resource pack\assets\modelengine\models\<vehicle>\<bone>.json`
with textures at `...\assets\modelengine\textures\entity\models\<vehicle>.png`.
**These are not usable.** It is **one JSON per bone** (57 separate files for `small_car`), each in its own local space with **no bone offset baked in** — e.g. `chassis.json` starts at `from [4.67, 8.0, 12.33]` and `front_axle.json` at `from [-10.0, 7.0, 7.0]`, both centred on their own origin. Loading any one renders a disconnected fragment; loading all 57 at the origin produces a pile.

### All 21 vehicle models

| Vehicle ID | Display name | `.bbmodel` path (under `plugins\ModelEngine\blueprints\`) | Elements | bbmodel `resolution` | Textures | Embedded PNG size(s) | Rotated el. | Multi-axis rot. | Anims | Model size (blocks X×Y×Z) |
|---|---|---|---|---|---|---|---|---|---|---|
| `aa_turret` | Anti-Air Turret | `aa_turret.bbmodel` | 16 | 64×64 | 1 | 32×32 | 1 | **1** | 2 | 2.0 × 1.5 × 3.0 |
| `anti_air` | Anti-Air | `anti_air.bbmodel` | 30 | 128×128 | 1 | 64×64 | 0 | 0 | 1 | 4.7 × 2.6 × 4.7 |
| `behemoth` | Behemoth | `vehicles/airships/behemoth.bbmodel` | 499 | 128×128 | **4** | 128×128, 32×32, 64×64, 64×64 | 4 | **4** | 17 | 11.8 × 10.4 × 18.0 |
| `biplane` | Biplane | `biplane.bbmodel` | 102 | 32×32 | **2** | 64×64, 16×16 | 0 | 0 | 5 | 11.2 × 3.2 × 9.5 |
| `bomber` | Bomber | `bomber.bbmodel` | 347 | 256×256 | 1 | 128×128 | 11 | 0 | 6 | 30.0 × 10.6 × 19.4 |
| `cloudskimmer` | Cloudskimmer | `cloudskimmer.bbmodel` | 249 | 192×192 | **4** | 96×96, 16×16, 32×32, 32×32 | 1 | **1** | 7 | 10.5 × 5.6 × 8.9 |
| `coal_car` | Coal Car | `vehicles/trains/coal_car.bbmodel` | 112 | 64×64 | **3** | 32×32, 32×32, 16×16 | 2 | 0 | 2 | 2.1 × 2.5 × 5.5 |
| `cruiser` | Cruiser | `cruiser.bbmodel` | 352 | 256×256 | **3** | 128×128, 32×32, 64×64 | 62 | **2** | 11 | 12.9 × 20.5 × 24.7 |
| `field_artillery` | Field Artillery | `field_artillery.bbmodel` | 40 | 64×64 | 1 | 32×32 | 0 | 0 | 3 | 1.9 × 1.9 × 5.2 |
| `fixed_artillery` | Fixed Artillery | `fixed_artillery.bbmodel` | 27 | 64×64 | 1 | 128×128 | 0 | 0 | 1 | 4.8 × 2.8 × 3.9 |
| `gunboat` | Gunboat | `gunboat.bbmodel` | 170 | 128×128 | **2** | 64×64, 16×16 | 2 | 0 | 7 | 10.5 × 6.1 × 7.6 |
| `gyrobomber` | Gyrobomber | `gyrobomber.bbmodel` | 371 | 192×192 | **2** | 96×96, 16×16 | 29 | 0 | 5 | 13.0 × 17.8 × 15.6 |
| `horse_cart` | Horse Cart | `vehicles/land/horse_cart.bbmodel` | 99 | 96×96 | **2** | 48×48, 16×16 | 0 | 0 | 4 | 6.2 × 2.8 × 8.4 |
| `ironclad` | Ironclad | `ironclad.bbmodel` | 200 | 256×256 | **3** | 128×128, 128×128, 32×32 | 7 | **1** | 9 | 9.4 × 18.8 × 19.3 |
| `monoplane` | Monoplane | `monoplane.bbmodel` | 74 | 128×128 | 1 | 64×64 | 0 | 0 | 5 | 11.6 × 3.0 × 8.2 |
| `passenger_car` | Passenger Car | `vehicles/trains/passenger_car.bbmodel` | 380 | 96×96 | **4** | 48×48, 32×32, 16×16, 16×16 | 0 | 0 | 2 | 4.0 × 5.0 × 10.7 |
| `simple_locomotive` | Simple Locomotive | `simple_locomotive.bbmodel` | 139 | 128×128 | **4** | 64×64, 16×16, 32×32, 32×32 | 0 | 0 | 2 | 7.4 × 3.9 × 9.4 |
| `sloop` | Sloop | `sloop.bbmodel` | 362 | 128×128 | **4** | 128×128, 32×32, 64×64, 16×16 | 4 | 0 | 10 | 12.1 × 12.6 × 13.5 |
| `small_car` | Small Car | `vehicles/land/small_car.bbmodel` | 108 | 128×128 | 1 | 64×64 | 4 | **2** | 4 | 3.4 × 3.4 × 7.8 |
| `torpedoboat` | Torpedoboat | `torpedoboat.bbmodel` | 138 | 128×128 | 1 | 64×64 | 2 | 0 | 6 | 13.3 × 7.9 × 8.9 |
| `wooden_cart` | Wooden Cart | `vehicles/land/wooden_cart.bbmodel` | 161 | 64×64 | **5** | 48×48, 32×32, 16×16, 16×16, 32×32 | 1 | 0 | 4 | 3.0 × 2.8 × 7.8 |

Display names come from the `name:` key of `plugins\VehicleFramework\vehicles\<id>.yml`; all are stored with the `§l§e` (bold + yellow) prefix, e.g. `"§l§eAnti-Air Turret"`. The player-visible text is the plain part.

### Skin variants (extra models for the same vehicle)

Defined under `skins:` in each `plugins\VehicleFramework\vehicles\<id>.yml`. Most vehicles have exactly one skin (the base model). Four have more:

- **`biplane`** — 13: Biplane; Biplane (Black) `biplane_black`; (Yellow) `biplane_chinese`; (Purple Imvata) `biplane_purple`; (Revenor) `biplane_revenor`; (Domenia) `biplane_domenia`; (Sabarissa) `biplane_sabarissa`; (Brown) `biplane_sabarissa_brown`; (Pirate) `biplane_pirate`; (Prism) `biplane_prism`; (Norain) `biplane_norain`; (Zerratoris) `biplane_zerratoris`; (Oseni) `biplane_oseni`
- **`monoplane`** — 13: same suffix set, names "Monoplane (…)"
- **`cloudskimmer`** — 3: base, `cloudskimmer_prism`, `cloudskimmer_norain`
- **`gyrobomber`** — 2: base, `gyrobomber_prism`

**Missing skin assets.** `.bbmodel` files exist for the `_black`, `_chinese`, `_purple`, `_revenor`, `_domenia`, `_sabarissa`, `_sabarissa_brown`, `_pirate` variants. They do **NOT** exist for: `biplane_prism`, `biplane_norain`, `biplane_zerratoris`, `biplane_oseni`, `monoplane_prism`, `monoplane_norain`, `monoplane_zerratoris`, `monoplane_oseni`, `cloudskimmer_prism`, `cloudskimmer_norain`, `gyrobomber_prism`. Verified with `find` over `plugins\ModelEngine\blueprints`. **Unverified** whether these are faction/donator skins delivered from another source or dead references.

Note the base gunboat skin has a typo in the config: `name: "Guboat"` (`plugins\VehicleFramework\vehicles\gunboat.yml`), while the vehicle's own display name is correctly `"§l§eGunboat"`.

## 0.3 Format verdict for vehicles — NOT a copy of the station pattern

**A `.bbmodel` cannot be fed to `StationModelViewer` as-is.** A conversion step is required. The good news: it is deterministic and can be done offline.

What has to happen, per vehicle:

1. **Extract the embedded texture.** Each `textures[i].source` is a `data:image/png;base64,...` string. Base64-decode it to a PNG under `frontend\public\wiki\textures\vehicles\`.
2. **Emit `elements` straight from the bbmodel's flat `elements[]` array.** In the `free` model format the element `from`/`to` are already in one shared model space (e.g. `small_car` element 0 is `from [-18, 9.75, -25]`, `origin [16, 9.75, -24]`), so the rest pose renders correctly while **ignoring the `outliner` groups entirely**. This is exactly why the bbmodel is the right source and the per-bone ModelEngine JSONs are not.
3. **Rescale the UVs.** bbmodel face UVs are in the project's `resolution` pixel space (e.g. `small_car` north face `uv:[16, 0, 52, 2]` at resolution 128). The viewer assumes the 0–16 grid. Conversion: `uv_out = uv_in * 16 / resolution.width`.
   **Verified:** `16 × 16/128 = 2.0` and `52 × 16/128 = 6.5`, which exactly matches ModelEngine's own generated `front_axle.json` face `uv:[2.0, 0.0, 6.5, 0.25]`. Note `resolution` is often **2× the actual PNG dimensions** (small_car: resolution 128×128, embedded PNG 64×64) — use `resolution`, not the PNG size.
4. **Resolve `faces[].texture`** (an integer index into `textures[]`) into a texture variable — and for the **13 multi-texture vehicles**, merge the 2–5 PNGs into one atlas and re-offset the UVs, because the viewer supports only one texture.
5. **Handle multi-axis rotation.** Six vehicles have elements rotated on two axes: `aa_turret` (1 element), `behemoth` (4), `cloudskimmer` (1), `cruiser` (2), `ironclad` (1), `small_car` (2). The viewer applies one axis. Either nest pivot objects or accept 1–4 mis-oriented cubes per model.
6. **Discard animations.** 1–17 clips per model are irrelevant to a static preview. (If an animated preview is ever wanted, that is a completely different renderer — the bone hierarchy in `outliner` would then become mandatory.)

**Cost summary — the honest version:**

| Group | Blocker | Work needed |
|---|---|---|
| `anti_air`, `bomber`, `field_artillery`, `fixed_artillery`, `monoplane`, `small_car`\*, `torpedoboat` (7) | none beyond UV rescale | Write a `.bbmodel → wiki JSON` converter script. Straightforward, one-off. (\*`small_car` has 2 multi-axis elements.) |
| `aa_turret`, `behemoth`, `biplane`, `cloudskimmer`, `coal_car`, `cruiser`, `gunboat`, `gyrobomber`, `horse_cart`, `ironclad`, `passenger_car`, `simple_locomotive`, `sloop`, `wooden_cart` (14) | **multi-texture** (2–5 PNGs) | Additionally needs PNG atlas packing + UV re-offset, **or** extending `StationModelViewer` to resolve the `textures` map into a `THREE.Mesh` material array. |
| `behemoth` (499 el.), `passenger_car` (380), `gyrobomber` (371), `sloop` (362), `cruiser` (352), `bomber` (347) | **draw-call count** | The viewer creates one mesh per element. 350–500 meshes × several simultaneous canvases will hurt. Merge element geometries into a single `BufferGeometry` before shipping a gallery page. |

**Recommendation to state plainly:** extending the existing viewer to (a) resolve the `textures` map into a material array and (b) merge element geometries is likely less work and more robust than an offline atlas packer. Either way, **vehicle previews are a new piece of engineering, not a copy-paste of the station pattern.** The converter script itself is the smaller half of the job.

## 0.4 Assets for the other three systems

| System | Model format | Directly loadable by `StationModelViewer`? |
|---|---|---|
| **Guns** (27 models: carry/reload/aim × 9 gun skins) | Vanilla JSON, **no `parent`**, 6–23 `elements`, single-axis rotation only. `plugins\ItemsAdder\contents\tfmc_pack\resourcepack\assets\minecraft\models\item\guns\*.json`; textures `...\textures\item\guns\*.png` (32 PNGs) | **YES — drop-in.** Most declare 2 texture keys but both point at the *same* PNG (e.g. `rifle_matchlock_carry.json` maps `"0"` and `"particle"` to `item/guns/rifle_matchlock`), so the single-texture limit is harmless. Use the `_carry` variant for a neutral pose. |
| **Furniture** (cooking + magic) | Vanilla JSON, no `parent`, 1–23 `elements`. `plugins\ItemsAdder\contents\tfmc_cooking\resourcepack\assets\tfmc_cooking\models\furniture\*.json` (21 files) and `plugins\ItemsAdder\contents\ia_tfmc\resourcepack\assets\tfmc\models\furniture\{pedestal,artifact_display,lure}.json`. Textures in the sibling `textures\furniture\` folders. | **YES — drop-in.** Caveats: `pot.json` keys its texture as `"1"` not `"0"` with `particle` pointing at a *different* PNG (`frying_pan`); several models share one PNG (`bowl`, `butter_plate`, `mixing_bowl`, `plate` all use `furniture/plate.png`). |
| **Instruments** (9) | **Flat 2D sprites.** `plugins\ItemsAdder\contents\tfmc_pack\resourcepack\assets\minecraft\models\item\instruments\*.json` are all `parent: minecraft:item/generated` + `layer0`, with **zero `elements`**. | **NO — and there is no 3D model to convert.** Use the PNG directly; the wiki already does (`frontend\public\wiki\textures\instruments\*.png`, 9 files). |
| **Gunsmithing Station** block | `plugins\ItemsAdder\contents\ia_tfmc\resourcepack\assets\tfmc\models\furniture\gunsmithing_station.json` — 29 elements but **6 distinct texture variables** (`market_block/wood_m`, `ammunition_station/wood2`, `ammunition_station/wood1`, `market_block/manifest`, `furniture/pistol`, particle `ammunition_station/bullet`) | **NO** — needs an atlas merge, same problem as the multi-texture vehicles. |
| **Engineering Table / Dockyard** | Plain 6-face cube blocks (`generate: true` in `plugins\ItemsAdder\contents\ia_tfmc\contents\base.yml:620` and `:641`), 4 PNGs each at `...\assets\tfmc\textures\block\machinery\{engineering_table,dockyard}\{bottom,side,front,top}.png` | Use the existing **`cubeFaces`** field (data.ts:855), not `model`. |

---

*(Sections 1–6 follow below.)*

# 1. MusicalInstruments

**Deployed:** `musicalinstruments-2.3.jar`. Source checkout is **2.4** — the two `config.yml` files are byte-identical and the only `plugin.yml` difference is that 2.4 adds `Nexo` to `softdepend`. Everything below was cross-checked against the 2.3 jar's `plugin.yml`; the Java was read from the 2.4 source, so **behaviour claims come from 2.4 source, not 2.3 bytecode.**

## 1.1 What it is

Nine hand-held instruments that turn your number keys into a keyboard: hold one in your **off-hand** and tap 1–8 to play notes that everyone within 64 blocks can hear.

## 1.2 How a player actually uses it

1. Craft the instrument at the **Instrument Station** (MMOItems). Every recipe has `conditions: class{list=Bard}` — you must be the **Bard** class (`plugins\MMOItems\crafting-stations\instrument-station.yml`).
2. Put the instrument in the **off-hand** slot. The main hand is irrelevant.
3. Tap number keys **1–8**. Each key press fires `PlayerItemHeldEvent`, which plays one sound.
4. Hold **Shift** while tapping 1–8 for the second layer (chord or higher octave, see table).
5. Key 9 does nothing musical — the plugin force-sets your selected slot back to slot 9 (`setHeldItemSlot(8)`) after **every** note, so repeated presses of the same key keep working (`musical-instruments\src\main\java\tfmc\justin\listeners\InstrumentListener.java`).
6. `/instruments keybinds` prints the note layout for whatever is in your off-hand.

## 1.3 Content it adds

The plugin itself adds **no items**. It binds to nine existing MMOItems (`plugins\MMOItems\item\instruments.yml`, type `INSTRUMENTS`). All nine use material `Stick` with custom model data and the lore line `§eHold in off-hand §7to play it`.

| Display name | MMOItems ID | TLibs path | CMD | Shift layer |
|---|---|---|---|---|
| Accordion | `INSTRUMENTS.ACCORDION` | `m.instruments.accordion` | 54 | chords |
| Bagpipe | `INSTRUMENTS.BAGPIPE` | `m.instruments.bagpipe` | 46 | octave up (notes 9–16) |
| Celtic Harp | `INSTRUMENTS.CELTIC_HARP` | `m.instruments.celtic_harp` | 47 | chords |
| Dulcimer | `INSTRUMENTS.DULCIMER` | `m.instruments.dulcimer` | 48 | chords |
| Flute | `INSTRUMENTS.FLUTE` | `m.instruments.flute` | 49 | octave up |
| Kalimba | `INSTRUMENTS.KALIMBA` | `m.instruments.kalimba` | 50 | chords |
| Lute | `INSTRUMENTS.LUTE` | `m.instruments.lute` | 51 | chords |
| Trumpet | `INSTRUMENTS.TRUMPET` | `m.instruments.trumpet` | 52 | octave up |
| Vielle | `INSTRUMENTS.VIELLE` | `m.instruments.vielle` | 53 | chords |

## 1.4 Player command table

`/instruments` has **no aliases** (`plugin.yml`).

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/instruments keybinds` | none | Prints the note/chord layout for the instrument in your off-hand | Permission `instruments.use`, **`default: true`**. Player-only. Says `§cYou must be holding an instrument in your off-hand!` if the off-hand is not an instrument. |
| `/instruments list` | none | Prints every instrument loaded on the server (9) | Permission `instruments.use`, **`default: true`**. Works from console too; does not need an instrument in hand. |

**Excluded (staff):** `/instruments give <instrument>` (`instruments.give`, `default: op`), `/instruments reload` (`instruments.reload`, `default: op`).

## 1.5 Numbers that matter to players

- **Volume `4.0` on every instrument** → audible radius **64 blocks** (1 volume = 16 blocks; stated in the config comment at `plugins\MusicalInstruments\config.yml`).
- **Pitch `1.0`** on every instrument — nothing is transposed.
- Sounds play in the **`RECORDS` sound category** (`InstrumentListener.java`), i.e. they are controlled by the *Jukebox/Note Blocks* slider in Minecraft's sound options, **not** Master or Ambient.
- Sound origin is the **player's own location**, not the instrument's.
- One `NOTE` particle spawns 2 blocks above the player's head per note.
- There is **no cooldown and no rate limit** on notes.
- Instrument crafting time at the Instrument Station: **10 s** for all nine.

### Crafting costs (Instrument Station, Bard class required for all)

| Instrument | Ingredients |
|---|---|
| Flute | 1 Bone, 2 Stick |
| Lute | 3 Oak Planks, 1 String, 1 Stick |
| Vielle | 3 Oak Log, 1 String, 1 Stick |
| Trumpet | 2 Iron Ingot, 3 Copper Ingot |
| Celtic Harp | 3 Gold Ingot, 2 String, 2 Stick |
| Kalimba | 3 Iron Ingot, 3 Note Block, 2 Stick |
| Dulcimer | 1 Iron Ingot, 2 String, 2 Stick, 4 Oak Planks |
| Accordion | 4 Oak Planks, **2 MMOItems Leather**, 3 String |
| Bagpipe | **3 MMOItems Flutes**, **5 MMOItems Leather** |

## 1.6 What the existing wiki page GETS WRONG or OMITS

Pages read: `frontend\app\wiki\musical-instruments\page.tsx`, `frontend\app\wiki\musical-instruments\[slug]\page.tsx`; data at `frontend\app\wiki\data.ts:128-305`.

**Verified correct** (do not "fix" these): the 64-block range; the off-hand requirement; the chord/octave split (6 chord — accordion, celtic_harp, dulcimer, kalimba, lute, vielle; 3 octave — bagpipe, flute, trumpet — matches `config.yml` exactly); the slot-9 snap-back and the stated reason for it; the Bard class requirement on all nine recipes; the two player commands and their descriptions; every ingredient name and quantity in all nine recipes.

**Wrong / misleading:**

1. **"Leather" is not vanilla leather.** `data.ts:226` and `data.ts:238` render the Accordion's and Bagpipe's leather with `T("vanilla/leather.png")`. The recipe demands `mmoitem{type=MATERIALS,id=LEATHER}` (`instrument-station.yml`). MMOItems `MATERIALS.LEATHER` *uses* vanilla `LEATHER` as its base material with no custom name (`plugins\MMOItems\item\materials.yml:719`), but MMOItems matches ingredients by item tag — **leather dropped by a cow will not satisfy this recipe.** Players will get stuck here. Same trap for the Bagpipe's 3 Flutes: they must be the crafted MMOItems Flute.
2. **"Can I craft an instrument without being a Bard? — No."** Accurate for *crafting*, but the FAQ's phrasing implies you cannot *use* one. The MMOItems instrument definitions carry **no `required-class` and no stat requirements** (`plugins\MMOItems\item\instruments.yml`), and `InstrumentListener` performs no class or permission check whatsoever. **A non-Bard handed an instrument can play it perfectly.** This matters because instruments are tradeable.
3. **The Commands table gives no permission context.** Both commands sit behind `instruments.use`, which is `default: true`, so no normal player is ever blocked. Worth one line so players do not ask staff for access.

**Omitted, and worth adding:**

4. **Sound category.** Notes play under `SoundCategory.RECORDS`. A player with the *Jukebox/Note Blocks* slider at 0 hears nothing while every other setting "looks" fine. This is the most likely real-world "my instrument is silent" cause and the FAQ does not mention it.
5. **No cooldown.** Nothing rate-limits notes; the note simply retriggers.
6. **Your main hand is not locked, but your slot is.** Because the plugin forces hotbar slot 9 after each note, whatever sits in slot 9 is what you visibly hold while playing.
7. **The Instrument Station also makes four Lutes that are not instruments.** `IRON_LUTE`, `STEEL_LUTE`, `ABYSSALITE_LUTE`, `MYTHRIL_LUTE` (MMOItems type `LUTES`) share the station and the Bard gate but are **Bard weapons**, not MusicalInstruments content (`instrument-station.yml:12-108`). The page says "There are nine instruments" with no disambiguation; a player browsing the station sees 13+ Bard-locked entries.
8. **Alternate high-tier Lute recipes exist.** Each Lute tier has a second recipe (`steel-lute2`, `abyssalite-lute2`, `mythril-lute2`) that swaps 2 ingots for 4 quality Feathers and is hidden unless you already hold the ingredients (`hide-when-no-ingredients: true`).
9. **Instrument recipes are never hidden.** All nine use `hide-when-locked: false`, so a non-Bard *sees* them greyed out. The Lute weapon recipes use `hide-when-locked: true` and vanish entirely. This explains why the station looks different to different players.
10. **The note particle.** A note particle appears above your head — a visible cue to bystanders that you are the one playing.

## 1.7 Features configured but INERT

None found. All nine instruments resolve to existing MMOItems, and every sound key in `config.yml` follows the `instruments.<name>_<n><letter>_<single|chord>` scheme the resource pack provides.

## 1.8 Cross-links

- **MMOItems crafting stations** — the Instrument Station is the only source.
- **MMOCore classes** — the Bard class gate.
- **The wiki's own keyboard widget** (`frontend\app\components\wiki\InstrumentKeyboard.tsx`) plays `/wiki/sounds/instruments/<folder>/*.ogg`, mirroring the in-game sound keys.

## 1.9 Uncertain / unverified

- Deployed jar is **2.3**; all behavioural reads come from the **2.4** source. Commands, permissions and config are identical, but I could not diff the listener bytecode.
- Whether `class{list=Bard}` is case-sensitive against the MMOCore class id (a `bard.yml` exists at `plugins\MMOCore\classes\`).
- I did not confirm the resource pack ships every `instruments.*` sound key (144 keys across 9 instruments).

---

# 2. InteractibleFurniture

**Deployed:** `interactiblefurniture-0.1.3-BETA.jar`, whose `plugin.yml` still says `version: 1.0`. The source checkout is **older than the jar** — no `carry`, no `nested`, no `debug`. Those were read from jar bytecode strings.

## 2.1 What it is

The system that lets custom furniture — pots, pans, shelves, pedestals — be placed as real 3D objects in the world, rotated, picked back up, and used as displays you can slot individual items into.

## 2.2 How a player actually uses it

1. **Place:** hold the furniture item and **right-click** a block. The furniture spawns as an `ItemDisplay` and one item is consumed. Floor pieces need a floor surface; the Tool Shelf needs a wall (`FurniturePlacementHandler.handlePlacement`).
2. **Rotation:** pieces with `rotate: true` snap to face you *at placement time*. There is **no re-rotate interaction** — to turn a piece you pick it up and place it again. Only the **Tool Shelf** has `rotate: false` (it takes the wall's facing).
3. **Slot an item in:** right-click the furniture at the spot where the slot sits. If your held item is on that slot's whitelist it goes into the slot and is rendered in 3D. Right-click it again to take it back.
4. **Pick up:** right-click the furniture with a **completely empty main hand** *and* with **all slots empty**. Both conditions are required (`FurnitureManager.processFurnitureInteraction`). It returns to your inventory.
5. **Carry (cooking pans/plates only):** **sneak + right-click** a `carry: true` piece to lift it; it then floats along with you. Right-click a surface to set it down. Carried furniture cannot be interacted with while held.
6. **Break:** **left-click / punch** the furniture, or break the block it is attached to.
7. There is a **200 ms interaction cooldown** per player between any two furniture interactions.

## 2.3 Content it adds

The plugin adds **no items of its own** — it attaches behaviour to existing ItemsAdder items. 26 definitions load from `plugins\InteractibleFurniture\furniture\*.yml`.

### Cooking set (`furniture\cooking.yml`, 18 pieces)

| Display name | ItemsAdder ID | Surface | Rotates | Pick up | Carry | Solid | Interactive slots |
|---|---|---|---|---|---|---|---|
| Frying Pan | `tfmc_cooking:frying_pan` | floor | yes | yes | **yes** | no | `left`, `right` (cut veg / meats); `butter` is display-only |
| Saucepan | `tfmc_cooking:saucepan` | floor | yes | yes | **yes** | no | **none clickable** (2 hidden inputs + liquid display) |
| Pot | `tfmc_cooking:pot` | floor | yes | yes | **yes** | no | `ladle_slot` — accepts only `tfmc_cooking:ladle`; 5 hidden inputs + liquid |
| Bowl | `tfmc_cooking:bowl` | floor | yes | yes | **yes** | no | **none clickable** (all inputs `interactible: false`) |
| Cutting Board | `tfmc_cooking:cutting_board` | floor | yes | yes | no | no | see `cooking.yml:430` |
| Butter Churn | `tfmc_cooking:butter_churn` | floor | yes | yes | no | no | see `cooking.yml:479` |
| Butter Plate | `tfmc_cooking:butter_plate` | floor | yes | yes | **yes** | no | see `cooking.yml:544` |
| Plate | `tfmc_cooking:plate` | floor | yes | yes | **yes** | no | see `cooking.yml:601` |
| Bucket | `tfmc_cooking:bucket` | floor | yes | yes | no | no | see `cooking.yml:691` |
| Fire Pit | `tfmc_cooking:fire_pit` | floor | yes | yes | no | no | `place-inside: true` |
| Meat Hook | `tfmc_cooking:meat_hook` | **`floor: false`, `wall: false`** | yes | yes | no | no | see 2.6 |
| Mixing Bowl | `tfmc_cooking:mixing_bowl` | floor | yes | yes | no | no | see `cooking.yml:959` |
| Milling Stone | `tfmc_cooking:milling_stone` | floor | yes | yes | no | no | see `cooking.yml:1038` |
| Oven Bottom | `tfmc_cooking:oven_bottom` | floor | yes | yes | no | **yes** | see `cooking.yml:1170` |
| Bread Tray | `tfmc_cooking:bread_tray` | floor | yes | yes | **yes** | no | see `cooking.yml:1297` |
| Oven Top | `tfmc_cooking:oven_top` | floor | yes | yes | no | no | see `cooking.yml:1374` |
| Liquid Container | `tfmc_cooking:liquid_container` | floor | yes | yes | no | **yes** | see `cooking.yml:1412` |
| Sausage Maker | `tfmc_cooking:sausage_maker` | floor | yes | yes | no | no | see `cooking.yml:1481` |

Place sound `block.wood.place`, break sound `block.wood.break` for every cooking piece.

### Shelf (`furniture\shelf.yml`)

| Display name | ItemsAdder ID | Surface | Slots |
|---|---|---|---|
| Tool Shelf | `tfmc_cooking:tool_shelf` | **wall only**, `rotate: false` | `left`, `middle`, `right` — each accepts **only** `tfmc_cooking:cutting_knife`, `tfmc_cooking:ladle`, `tfmc_cooking:masher` |

### Magic / display set (`furniture\magic.yml`)

| Display name | ItemsAdder ID | Surface | Solid | Slots |
|---|---|---|---|---|
| Pedestal | `tfmc:pedestal` | floor | **yes** | 1 slot, whitelist `*` — **holds any item**, displayed tilted 67.5° |
| Artifact Display | `tfmc:artifact_display` | floor | **yes** | 1 slot, whitelist `*` |
| Lure | `tfmc:lure` | floor | no | **no slots — placement only** |

Place/break sound for all three: `block.ancient_debris.place` / `.break`.

**Pedestal is by far the most-used piece on the live server:** 11 of the 26 placed-furniture records in `plugins\InteractibleFurniture\data\chunks\TFMC_Map\*.json` are pedestals.

## 2.4 Player command table

**None.** InteractibleFurniture exposes zero commands a normal player can usefully run.

**Excluded (staff):** `/if reload` (`interactiblefurniture.reload`, `default: op`); `/if nested attach`, `/if nested detach` (gated on the same reload permission per jar bytecode); `/if debug <on|off>` (`interactiblefurniture.debug`, `default: op`).

Note: the shipped jar's `plugin.yml` declares **no top-level permission on the `if` command** (the source version does). A normal player can therefore *run* `/if` — they will only ever get the usage line or "You do not have permission…".

## 2.5 Numbers that matter to players

- **200 ms** cooldown between furniture interactions, per player (`FurnitureManager.onPlayerInteract`).
- Pick-up requires **empty main hand AND zero filled slots**.
- Pan / Pot / Bowl slot whitelists are `c.vegetable(type=vegetable_cut)`, `c.meat(type=meat_red_meat)`, `c.meat(type=meat_pork)`, `c.meat(type=meat_poultry)`, `c.meat(type=meat_poultry_leg)` — **raw uncut vegetables are rejected**; they must be cut first.
- Solid furniture (`oven_bottom`, `liquid_container`, `pedestal`, `artifact_display`) places invisible **barrier blocks** you can stand on; punching any barrier removes the whole piece.
- Non-solid furniture can only be clicked on the exact block face it is attached to.

### Where the furniture comes from

| Piece | Station | Cost | Craft time |
|---|---|---|---|
| Frying Pan, Saucepan, Pot | Meal Prep Station | 1 Iron Ingot each | 2 s |
| Cutting Board, Butter Churn, Butter Plate, Plate, Bowl, Tool Shelf | Meal Prep Station | 1 Oak Planks each | 2 s |
| Pedestal | Block Station | 2 Cobblestone | 5 s |
| Artifact Display | Block Station | 2 Cobblestone | 5 s |
| Lure | Block Station | 2 Oak Planks | 2 s |

(`plugins\MMOItems\crafting-stations\meal-prep-station.yml`; `...\block-station.yml:532-546`.)

## 2.6 Features configured but INERT

1. **`furniture\example.yml` is live on the production server.** The loader reads every `.yml` in the folder (`FurnitureLoader.load`), so four demo entries are active: `chair` = `v.bamboo_stairs`, `wall_shelf` = `v.bamboo_fence_gate`, `large_table` = `v.bamboo_planks`, `layered_example` = `v.bamboo_mosaic`. **Right-clicking with vanilla bamboo stairs / planks / mosaic / fence gate should place an InteractibleFurniture object instead of the vanilla block.** None has `pickup: true`, so the only removal is to punch it. No such object exists in the live chunk data. **Staff-facing note — do not put this in the player wiki until tested in-game.**
2. **Meat Hook has `floor: false` and `wall: false`** (`cooking.yml:905`). With both placement surfaces disabled, `isValidPlacementSurface` should reject every placement — yet one Meat Hook exists in the live world at `TFMC_Map 1933, 332, 2254` with `originBlockFace: DOWN` (`data\chunks\TFMC_Map\120_140.json`). Probably a ceiling (`roof`) placement or a pre-config-change leftover. **Do not tell players the Meat Hook is placeable until this is retested.**
3. **Saucepan and Bowl have no clickable slots.** Every slot in both is `interactible: false`. Players cannot put anything in them by hand; the Cooking plugin drives their contents.
4. **No recipe found for 10 cooking pieces:** Bucket, Fire Pit, Meat Hook, Mixing Bowl, Milling Stone, Oven Bottom, Oven Top, Bread Tray, Liquid Container, Sausage Maker. A grep over every `.yml` under `plugins\` found no crafting recipe and no shop entry. All are referenced by the **Cooking** plugin's configs, so acquisition is probably that plugin's business. **Flag for the Cooking researcher; do not tell players to craft them.**
5. **`sounds.yml` is a stub** — only `v.stick` and `v.blaze_rod` mappings, matching the demo `wall_shelf` whitelist. No shipped content uses it.

## 2.7 Cross-links

- **ItemsAdder** (`ia_tfmc`, `tfmc_cooking` packs) — supplies every furniture item and model.
- **Cooking plugin** — owns the actual cooking gameplay; IF only provides the placeable object and its slots. `plugins\Cooking\config.yml` maps `frying-pan: frying_pan`, `pot: pot`, `oven-bottom: oven_bottom` etc. directly onto these furniture ids.
- **MMOItems crafting stations** — Meal Prep Station and Block Station are the acquisition points.
- **VFBuilders** deletes a construction station when the station furniture is broken (`vfbuilders\managers\StationManager.onFurnitureBreak`) — note this listens to **ItemsAdder's** `FurnitureBreakEvent`, not IF's.
- **Magic / artifacts** — the Pedestal and Artifact Display are that system's display furniture.
- **TLibs** — item/block path resolution (`v.`, `m.`, `ia.`, `c.`).
- **MythicMobs** — a hard `depend` in `plugin.yml`; no gameplay use found in the available source.

## 2.8 Uncertain / unverified

- The **carry** trigger (sneak + right-click) was inferred from the constant-pool ordering `getByCarrier → isSneaking → canCarry → carry` in `FurnitureManager.class`. Not confirmed by decompilation.
- `/if nested attach|detach` — what "nested furniture" does for players is unknown; the strings suggest attaching a child piece to a nearby parent. No config exposes it.
- Whether `example.yml` placements actually fire in-game (see 2.6.1).
- Slot hit detection picks the **nearest slot to the click point**, so pieces with several slots at near-identical offsets (the Pot's five inputs) may be finicky. Not measured.

---

# 3. VehicleFramework

**Deployed:** `vehicleframework-1.1.11.jar`. The source checkout also reports `1.1.11` but is **demonstrably older than the jar** — the live `config.yml` has `ticket-item`, `weapon-degraded-reload-multiplier`, `terrain-follow-debug` and `ground-engine-logging`, none of which the source's `ConfigLoader` reads, and the jar contains classes (`Vehicles/Handlers/VehicleTicketInteract`, `Managers/OwnershipGUIManager`) that the source lacks or has in older form. Claims below are marked where they came from bytecode strings rather than source.

## 3.1 What it is

The engine behind every driveable machine on the server: cars, carts, trains, sailing ships, ironclads, biplanes and airships — each a multi-seat 3D vehicle with its own engine, fuel tank, armour, damage model and mounted guns.

## 3.2 How a player actually uses it

**You cannot spawn a vehicle.** `/vf spawn` requires `vehicleframework.spawn`, whose declared default is `false` (`plugins\VehicleFramework\permissions.yml`). Players obtain vehicles **only** by building them at a VFBuilders station — see section 4.

Once a vehicle exists in the world:

1. **Claim it.** The first player to right-click an unowned vehicle becomes its owner: `§aYou are now the owner of §e<name>§a.` (`VehicleManager.claimOwnership`). Ownership is stored as `player_<name>`.
2. **Enter it.** Right-click the vehicle → a **Select Seat** GUI opens. Click a seat to sit in it. Clicking another seat while already aboard moves you.
3. **Drive it.** Controls are per-vehicle and per-state; run `/vf keybinds` while seated to print the live mapping. The common land/air/sea set is:
   - `W` = throttle up, `S` = throttle down, `A` / `D` = turn.
   - `SHIFT` = reopen the Seat Selection menu.
   - `SPACE` = lights (Small Car) or weapon fire (gunner seats).
   - `LEFT_CLICK` = horn (Small Car).
   - Horse Cart and the carts use `W`/`S` = forward/backward instead of a throttle.
   - Only the **captain** seat can steer (`VehicleMovementController` checks `SeatType.CAPTAIN`).
4. **Fuel it.** Hold the fuel item and right-click the vehicle. See 3.5.
5. **Shoot.** Sit in the seat a weapon is bound to. `RIGHT_CLICK` = reload (loads whatever ammo item is in your hand), `SPACE` = fire, `W/A/S/D` = traverse the gun. The Mounted Rifle (`gun_turret`) instead aims at your **cursor** up to 120 blocks.
6. **Repair.** Hold the repair item and right-click. You must either be **outside** the vehicle (and it must not be flying or moving faster than 0.2) or be sitting in a **mechanic** seat. A Repair Vehicle GUI opens with a **Repair Tool** and a **Water Bucket** (to put out fires). Walking away or closing the window cancels the repair.
7. **Re-skin.** Hold the skin item and right-click to open **Select Skin**.
8. **Store cargo.** Right-click a vehicle with containers to open its inventory (Behemoth, Cloudskimmer, Coal Car, Wooden Cart).
9. **Tow.** Sneak + right-click a towable vehicle to select it, then sneak + right-click the tower to attach. Sneak + right-click the tower again to detach. Selection is dropped if you move more than 8 blocks away.
10. **Destroy it.** Hold a **Blaze Rod** and right-click → the vehicle is removed instantly with the message `§cRemoved`. **There is no confirmation and no ownership check in the source's interact chain.** See 3.7.

### Ownership, whitelist and tickets

- `allow-whitelist: true` **and** `whitelisted-by-default: true` in `plugins\VehicleFramework\config.yml`. Per `OwnerData`, a new vehicle is created with **whitelist mode already ON**.
- The whitelist is only enforced once the vehicle has an owner (`VehicleManager` line ~341). So: an unclaimed vehicle is open to everyone; **the moment someone claims it, it becomes owner-only** until they add names.
- The owner opens **Ownership Settings** from slot 25 of the Seat Selection GUI (only the owner sees it work). Options, from `OwnershipGUIManager` bytecode strings:
  - *Whitelisting: ON/OFF* — "When enabled only whitelisted players can enter"
  - *Whitelist* (chest icon) — "Click to manage whitelist"; add via "Click, then type a player name in chat"; shows "Players on whitelist: N"
  - *Tickets: ON/OFF* — "When enabled, passenger seats need a ticket" / "Owner right-clicks with the ticket item to mint"
  - *Reset owner* (barrier) — "Resets the owner of this vehicle to none"
- **Tickets:** with tickets enabled, the owner holds the ticket item (**Paper**, `ticket-item: v.paper`) and right-clicks the vehicle to mint tickets stamped with that vehicle's id; passengers need one to take a passenger seat. Message on failure: `§cTickets are not enabled on this vehicle`. *(Read from `VehicleTicketInteract.class` / `VehicleTicketItems.class` strings — the ticket system is not in the source checkout.)*
- The owner can **eject** a player by clicking their occupied (yellow) seat in the Seat Selection GUI. The ejected player gets `§cYou have been removed from the vehicle by the owner and cannot re-enter for 60 seconds.`

## 3.3 Content it adds — all 21 vehicles

Display names carry a `§l§e` prefix in config; the player-visible text is the plain part. Seats are written `captain / mechanic / passenger`.

| ID | Display name | Kind | Seats (C/M/P) | Components (HP) | Engine fuel | Top speed | Turn rate | Weapons | Cargo |
|---|---|---|---|---|---|---|---|---|---|
| `small_car` | Small Car | Land, terrain-following | 1/0/0 | geared_engine 200, hull 150 | Arcane Fuel | 0.45 (3rd gear) ≈ 9 b/s | 0.70 | — | — |
| `wooden_cart` | Wooden Cart | Land, horse-drawn, towable | 1/0/2 | harness 100, hull 150 | none (horses) | n/a | 0.40 | — | Cart Inventory, 54 slots |
| `horse_cart` | Horse Cart | Land, horse-drawn, **can tow** | 1/0/1 | harness 100, hull 150 | none (horses) | n/a | 0.20 | Rear Rifle | — |
| `simple_locomotive` | Simple Locomotive | Train (`tracked`) | 1/0/0 | engine 200, hull 30 | Coal Blocks | 0.60 ≈ 12 b/s | 0.20 | — | — |
| `coal_car` | Coal Car | Train car (`tracked`) | 0/0/1 | hull 30 | — | n/a | — | — | Coal Bunker, 27 slots, **only accepts Coal Blocks** |
| `passenger_car` | Passenger Car | Train car (`tracked`) | 0/0/8 | hull 30 | — | n/a | — | — | — |
| `gunboat` | Gunboat | Sailing ship | 1/1/3 | sails 140, hull 290 (sinkable) | **none — wind** | 0.37 ≈ 7.4 b/s | 0.24 | Front Cannon | — |
| `sloop` | Sloop | Sailing ship | 1/1/10 | sails 200, hull 400 (sinkable), pump 80 | **none — wind** | 0.30 ≈ 6 b/s | 0.20 | 4 × Naval Cannon (2 per broadside) | — |
| `torpedoboat` | Torpedoboat | Steamship | 1/1/1 | engine 200, hull 400, pump 80 | Coal Blocks | 0.40 ≈ 8 b/s | 0.35 | Torpedo Launcher (fixed) | — |
| `ironclad` | Ironclad | Steamship | 1/5/6 | engine 200, hull 400, pump 80 | Coal Blocks | 0.30 ≈ 6 b/s | 0.20 | Front Cannon, Anti-Air Turret | — |
| `cruiser` | Cruiser | Steamship | 1/4/10 | engine 500, hull 800, pump 150 | Coal Blocks | 0.22 ≈ 4.4 b/s | 0.14 | Front Turret, Back Turret, 2 × Anti-Air Turret | — |
| `monoplane` | Monoplane | Aircraft | 1/0/0 | engine 200, hull 400, wings 200 (lift) | Arcane Fuel | 0.70 ≈ 14 b/s | 0.20 | Front Rifles, Bomb Bay | — |
| `biplane` | Biplane | Aircraft | 1/1/0 | engine 200, hull 400, wings 200 (lift 6.1) | Arcane Fuel | **0.80 ≈ 16 b/s — fastest vehicle** | 0.30 | Front Rifles, Rear Rifle, Bomb Bay | — |
| `bomber` | Bomber | Aircraft | 1/2/0 | engine 450, hull 800, wings 600 | Arcane Fuel | 0.60 ≈ 12 b/s | 0.10 | Front Rifle, Rear Rifle, Bomb Bay (bomb racks) | — |
| `cloudskimmer` | Cloudskimmer | Airship | 1/1/3 | engine 180, hull 290, balloon 240 | Arcane Fuel | 0.37 ≈ 7.4 b/s | 0.24 | Anti-Air Turret, Bomb Bay | Cargo Hold, 54 slots |
| `gyrobomber` | Gyrobomber | Airship | 1/1/5 | engine 400, hull 900, balloon 2000 | Arcane Fuel | 0.15 ≈ 3 b/s | 0.12 | 2 × Bomb Bay, 4 × Rifle turret (front/rear/left/right) | — |
| `behemoth` | Behemoth | Airship, flagship | 1/2/13 | engine 580, hull 1150, balloon 2000 (lift 0.2) | Arcane Fuel | 0.27 ≈ 5.4 b/s | 0.16 | Front Cannon (autocannon), Left + Right Cannon, 4 × Anti-Air Turret | **4 × Cargo Hold, 54 slots each** |
| `aa_turret` | Anti-Air Turret | Emplacement | 1/0/0 | hull 30 | — | static | — | Anti-Air Turret | — |
| `anti_air` | Anti-Air | Emplacement | 1/0/0 | hull 50 | — | static | — | Flak Cannon | — |
| `field_artillery` | Field Artillery | Emplacement, **towable** | 1/0/0 | hull 40 | — | static | — | Field Artillery (naval cannon) | — |
| `fixed_artillery` | Fixed Artillery | Emplacement | 1/0/0 | hull 80 | — | static | — | Flak Cannon (naval cannon template) | — |

Speeds are the raw `speed:` value from `plugins\VehicleFramework\vehicles\<id>.yml`, applied as `setVelocity` once per tick at 100% throttle (`engine.getSpeed() = speed × throttle/100`, `VehicleMovementController.apply`). The blocks-per-second figures are therefore `speed × 20` **ignoring drag and terrain** — treat them as a ranking, not a stopwatch. For scale, a sprinting player is roughly 5.6 b/s.

### Skins

Skins are chosen in the **Select Skin** GUI after right-clicking with the skin item. Full skin lists per vehicle are in **section 0.2** above. Short version: `biplane` and `monoplane` each have 13, `cloudskimmer` 3, `gyrobomber` 2, everything else 1. **11 of those skin entries have no `.bbmodel` on disk** — see 3.7.

### Ammunition (6 types, `plugins\VehicleFramework\ammunition\`)

| Name | ID | Item | Rounds per item | Damage | Range / radius | Notes |
|---|---|---|---|---|---|---|
| Bullets | `bullet` | `m.utils.bullet_box` | **100** | 15 | 120 blocks | Used by rifles and AA turrets |
| Flak Shells | `flak_bullet` | `m.utils.flak_shells` | **30** | 20 | 160 blocks, blast radius 10 | Explosive, `yield: 0.0` (no terrain damage) |
| Cannonball | `cannonball` | `m.utils.cannonball` | 1 | 20 | radius 8 | Explosive, **sets fire**, yield 2.0, applies Poison 10 s |
| Small Bomb | `small_bomb` | `m.utils.small_bomb` | 1 | 20 | radius 10 | Fuse 20 ticks (1 s), yield 2.5 |
| Small Bomb (rack) | `small_bomb_rack` | `m.utils.small_bomb_rack` | **8** | 20 | radius 10 | Same bomb, 8 per load. Bomber, Cloudskimmer, Gyrobomber |
| Clusterbomb | `clusterbomb` | `m.utils.clusterbomb` | 1 | 20 + 15 per sub | radius 10, subs radius 8 | **24 submunitions**, spread 7.5, fuse 60 ticks (3 s). Behemoth, Cruiser, Fixed Artillery |
| Torpedo | `torpedo` | `m.utils.torpedo` | 1 | 20 | radius 10 | Fuse 80 ticks (4 s). Torpedoboat only |

**Rounds loaded = `rounds` × number of exit bones.** The Biplane's Front Rifles have 2 barrels, so one Bullet Box loads **200** rounds there (`AmmunitionHandler.reload`).

### Weapon templates (`plugins\VehicleFramework\templates\weapons\`)

| Template | In-game name | Reload | Cooldown between shots | Ammo | Aiming |
|---|---|---|---|---|---|
| `gun_turret` | Mounted Rifle | 5 s | 4 ticks (0.2 s) | bullet | **Cursor aim, 120 block range**, 12 projectile damage, roll limited to ±60° |
| `naval_cannon` | Naval Cannon | 5 s | 5 ticks (0.25 s) | cannonball (+ clusterbomb on some) | `W/A/S/D` traverse |
| `aa_turret` | Anti-Air Turret | 10 s | 10 ticks (0.5 s) | bullet | `W/A/S/D` traverse |
| `autocannon` | Autocannon | 5 s | 12 ticks (0.6 s) | flak_bullet | `W/A/S/D` traverse |
| `flak_cannon` | Flak Cannon | 10 s | 15 ticks (0.75 s) | flak_bullet | `W/A/S/D` traverse |

Weapon keybinds: `RIGHT_CLICK` = reload, `SPACE` = shoot, `W/S` = elevate/depress, `A/D` = traverse (the naval cannon has W/S inverted relative to the others). Reload shows a `§aReloading: Ns` title and ends with `§aReloaded!`.

### Armour and damage types

Damage is scaled by an **armour template** (per component) then by a **role** (per component). Higher number = *more* damage taken.

| Armour | FALL | entity_attack | entity_explosion | small_bomb | cannonball | torpedo | flak_bullet |
|---|---|---|---|---|---|---|---|
| `aircraft` | 0.0 | 0.1 | 1.3 | 5.0 | 5.0 | — | 5.0 |
| `airship` | 0.0 | 0.1 | 2.0 | **10.0** | 1.8 | 7.0 | 2.0 |
| `armored` | 0.0 | 0.1 | 1.5 | 6.0 | 1.3 | 5.0 | — |
| `wooden` | 0.0 | 0.1 | 2.0 | **10.0** | 1.8 | 7.0 | — |
| `wagon` | 0.0 | 0.1 | 1.5 | 3.0 | 1.3 | — | — |
| `emplacement` | — | 0.1 | 1.3 | 3.0 | 2.0 | 0.2 | — |

Player-facing takeaways: **melee barely scratches a vehicle (×0.1)**; **falling never damages one (×0.0 — except emplacements, which have no FALL entry)**; **bombs are devastating against wooden ships and airships (×10)**; **torpedoes are almost useless against emplacements (×0.2)**.

Role multipliers (`templates\roles\roles.yml`) sit on top: aircraft engines and wings take **×1.5 and ×1.2 bullet damage** — planes are the softest thing to rifle fire in the game. Ship pumps take ×15 / ×10 from small bombs.

### Destruction

| Template | Used by | Fragments | Duration |
|---|---|---|---|
| `explode_small` | — (defined, see 3.7) | 4 | 320 ticks (16 s) |
| `explode_medium` | Small Car, Horse Cart, Wooden Cart | 10 | 320 ticks |
| `explode_large` | — (defined, see 3.7) | 30 | 320 ticks |
| `ship` | Cruiser and other `float: true` hulls | 30 | 320 ticks, plus a separate 320-tick **sink** sequence |

Ships with `sinkable: true` hulls (Gunboat, Sloop, and the steamships) take on water and sink; the **pump** component (Sloop, Ironclad, Cruiser, Torpedoboat) is what keeps them afloat. Pumps have very low HP (80–150) and are extremely vulnerable to bombs.

## 3.4 Player command table

The `vf` command has **no aliases** (`plugin.yml`).

| Command | Aliases | What it does | Notes |
|---|---|---|---|
| `/vf keybinds` | none | Prints the control mapping for the vehicle you are currently in, for its current state (Ground / Flying / Floating) | **No permission check at all** — the check runs *before* `Permissions.canSpawn`. Player-only. Says `§cYou are not in a vehicle` otherwise. |
| `/vf findvehicles` | none | Lists every vehicle you own and its world + coordinates | **No permission check at all.** Player-only. Says `§7You do not own any vehicles.` if you own none. Stored-but-unloaded vehicles show `§7location unknown (stored)`. |

**Excluded (staff / permissioned):** `/vf ammo` (gives 64 of every ammo type — `vehicleframework.spawn`), `/vf kill <radius>` (`vehicleframework.spawn`), `/vf spawn <vehicle>` (`vehicleframework.spawn`, declared `default: false`), `/vf takeover` (`vf.admin`), `/vf reload` (`vf.admin`), `/vf tracktest` (`vf.admin`), `/vf trackcheck` (`vf.admin`).

> **Bug worth knowing:** `CommandManager.onCommand` reads `args[0]` before checking `args.length`, so a bare `/vf` throws an `ArrayIndexOutOfBoundsException` and the player sees "An internal error occurred while attempting to perform this command." Do not document `/vf` on its own as a help command.

## 3.5 Numbers that matter to players

### Fuel

Only two fuels exist (`plugins\VehicleFramework\fuel.yml`):

| Fuel | Item | Units per item | Refuel while running? |
|---|---|---|---|
| **Coal Blocks** | `v.coal_block` (vanilla Coal Block) | 100 | **Yes** (`refuel-while-running: true`) |
| **Arcane Fuel** | `m.utils.arcane_fuel` (MMOItems) | 100 | **No** |

A vehicle only accepts its own fuel: `§cThis vehicle only accepts <fuel> §cas fuel`. Refuelling while the engine is on (arcane-fuel vehicles) gives `§cCannot refuel while the engine is on`; a full tank gives `§cFuel tank is full`. One item is consumed per right-click.

**Fuel burns at a flat rate per second whenever the engine is running and the throttle is off zero — throttle position does not change consumption** (`FuelTank.tick` clamps the throttle percentage with `Math.max(1, percentage)`, so it is always ≥ 1). Cruising at 20% costs exactly as much as full power.

| Vehicle | Fuel | Tank | Burn/s | Items for a full tank | Run time on a full tank |
|---|---|---|---|---|---|
| Small Car | Arcane Fuel | 500 | 1 | 5 | ~8 min 20 s |
| Monoplane | Arcane Fuel | 900 | 1 | 9 | ~15 min |
| Cloudskimmer | Arcane Fuel | 1800 | 1 | 18 | ~30 min |
| Biplane | Arcane Fuel | 2200 | 3 | 22 | ~12 min 13 s |
| Bomber | Arcane Fuel | 4500 | 5 | 45 | ~15 min |
| Gyrobomber | Arcane Fuel | 5000 | 5 | 50 | ~16 min 40 s |
| Behemoth | Arcane Fuel | **16000** | 12 | **160** | ~22 min 13 s |
| Torpedoboat | Coal Blocks | 600 | 2 | 6 | ~5 min |
| Ironclad | Coal Blocks | 1200 | 5 | 12 | ~4 min |
| Cruiser | Coal Blocks | 2400 | 10 | 24 | ~4 min |
| Simple Locomotive | Coal Blocks | 4800 | 5 | 48 | ~16 min |
| Gunboat, Sloop | **none — sails** | — | — | — | unlimited |
| Carts, emplacements, train cars | none | — | — | — | — |

Fuel level is reported on every refuel as `§aFuel: §e<current>/<capacity>`.

### Tool items (`plugins\VehicleFramework\config.yml`)

| Purpose | Config key | Item |
|---|---|---|
| Repair | `repair-item` | `m.utils.vehicle_repair` — MMOItems **Vehicle Repair** tool |
| Re-skin | `skin-item` | `m.utils.vehicle_skin` — MMOItems **Vehicle Paint** |
| Destroy | `destroy-item` | `v.blaze_rod` — **a plain vanilla Blaze Rod** |
| Mint tickets | `ticket-item` | `v.paper` — plain vanilla Paper |

Vehicle Repair and Vehicle Paint are crafted at the **Engineer Station** (`plugins\MMOItems\crafting-stations\engineer-station.yml`):
- **Vehicle Repair** — 4 Iron Ingot, 5 s, requires `professions.vehicle_mechanic`; grants 10 Crafter XP.
- **Vehicle Paint** — 1 Common Item Skin Scroll, 5 s, requires `professions.vehicle_mechanic` **and** the `gilded` permission (a donor rank).

### Repair

- Repair time per component, in seconds (from each vehicle yml): hulls 100 s (train cars/locomotive hull 100, Sloop/Cruiser/Ironclad hulls 100), engines 60 s, balloons 200 s, pumps 40 s, wings 100 s.
- A weapon at **0% health reloads 2× slower** (`weapon-degraded-reload-multiplier: 2.0`, linear scale).
- A damaged engine **caps your throttle to its health percentage** (`Throttle.increase` refuses to go above `max × health%`). A half-wrecked engine means half speed, permanently, until repaired.
- Repair is blocked while **flying** (`§cCannot repair while flying`) and while **moving faster than 0.2** (`§cCannot repair while moving`) unless you are in a **mechanic** seat.

### Other

- **Despawn distance: 160 blocks.** Walk further than that and the vehicle unloads (it is not destroyed — `/vf findvehicles` still reports it).
- **Eject cooldown: 60 seconds.**
- **Explosions break blocks** — `block-damage: true` on this server. Cannon and bomb hits will crater terrain. Blocks in `convert-explosion` degrade rather than vanish: Grass Block → Dirt, Stone Bricks → Cracked Stone Bricks, Stone → Cobblestone.
- **Captain-seat entry logging is OFF** (`enable-logging: false`).
- **Automatic backups every 6000 ticks (5 minutes)** to `plugins\VehicleFramework\data\backup\`.
- Tow selection is dropped if you move more than **8 blocks** from the selected vehicle.
- The Small Car's gearbox: Reverse (throttle 0 → −20, speed 0.25), First (0–40, accel 3, speed 0.25), Second (40–75, accel 2, speed 0.35), Third (75–100, accel 1, speed 0.45). It starts in gear 1 and `requires-start: true`.
- Small Car headlights: 2 lights, power 8, falloff 1, toggled with `SPACE`.

## 3.6 Train tracks (`plugins\VehicleFramework\trains.yml`)

Trains run on a spline-track system, not vanilla rails. Track-laying items:

| Item | TLibs path | Role |
|---|---|---|
| Track Small | `ia.tfmc:track_small` | lay a short segment |
| Track Medium | `ia.tfmc:track_medium` | lay a medium segment |
| Track Large | `ia.tfmc:track_large` | lay a long segment |
| Train Track | `ia.tfmc:train_track` | the track piece itself (64 per craft at the Block Station) |
| Railroad Switch | `ia.tfmc:railroad_switch` | switch/junction marker |
| Iron Shovel | `v.iron_shovel` | layer tool |
| Iron Pickaxe | `v.iron_pickaxe` | remover |
| Clock | `v.clock` | recorder |
| Diamond Shovel | `v.diamond_shovel` | junction tool |

Limits that will bite a builder: **max turn 35°**, **minimum lay distance 8 blocks**, **snap distance 3**, **join distance 1.5**, **minimum junction spacing 16**, **maximum junction length 32**, **desired grade 6°, maximum grade 10°**. In survival/adventure mode the track grows **one sample every 4 ticks** (creative rebakes the whole stroke at once). Switch throw speed is **90°/second**.

## 3.7 Features configured but INERT or broken

1. **11 skin entries have no model file.** `biplane_prism`, `biplane_norain`, `biplane_zerratoris`, `biplane_oseni`, `monoplane_prism`, `monoplane_norain`, `monoplane_zerratoris`, `monoplane_oseni`, `cloudskimmer_prism`, `cloudskimmer_norain`, `gyrobomber_prism` are listed under `skins:` but have no `.bbmodel` under `plugins\ModelEngine\blueprints`. Verified by `find`. Selecting one will at best show nothing. **Do not list these as available skins.**
2. **`gunboat.yml` skin name typo:** the base skin is called `"Guboat"` in the Select Skin GUI while the vehicle is correctly `Gunboat`.
3. **`explode_small` and `explode_large` death templates are defined but unused** — no vehicle references them (`grep` over `vehicles\*.yml` finds only `explode_medium` and `ship`).
4. **`mythicmob: "none"`** — the MythicMobs integration is disabled. The `softdepend` on MythicMobs and CoreProtect does nothing player-visible.
5. **The Blaze Rod destroy item has no guard in the source's interact chain.** `VehicleManager` checks the destroy item *before* any owner or whitelist test. If that ordering is unchanged in 1.1.11, **anyone holding a Blaze Rod can delete any vehicle they can right-click**, including one they do not own. This is the single highest-impact thing in this dossier. **Verify in-game before publishing anything about the Blaze Rod — and flag it to staff either way.**
6. **Fuel consumption ignores throttle** (see 3.5) — probably not intended, but it is the shipped behaviour.
7. **Debug switches are all off** and should never be mentioned to players: `weapon-aim-debug`, `terrain-follow-debug`, `ground-engine-logging`, `enable-logging`. `trains.yml` has `debug-logging: true`, which only writes server-side logs.
8. **`/vf` with no arguments errors out** (see 3.4).
9. `plugins\VehicleFramework\data\tracks\TFMC_Map\` contains exactly **one** laid track. The train system is effectively unused on the live server so far.

## 3.8 Cross-links

- **VFBuilders** — the *only* player route to a vehicle. See section 4.
- **ModelEngine** — every vehicle is a ModelEngine rig (`depend`). See section 0.2.
- **MMOItems** — all ammunition, Arcane Fuel, Vehicle Repair and Vehicle Paint are MMOItems `UTILS` items crafted at the **Engineer Station**. See 3.5 and section 4.
- **RPCharacters professions** — `professions.vehicle_mechanic` (Crafter tree, cost 2) gates the repair and paint tools.
- **ItemsAdder** (`ia_tfmc`) — the Engineering Table, Dockyard and all train-track items.
- **TLibs** — every item path (`v.`, `m.`, `ia.`) and `NBTAPI`/`ProtocolLib` for packet-level vehicle control.
- **GunsAndGadgets** imports VehicleFramework classes directly (`LightEffect`, `ActiveVehicle`) — the two plugins share the muzzle-light effect.
- **Simple Factions / WorldGuard** — not referenced anywhere in VehicleFramework. Whether vehicle weapons respect claims or PvP flags is **unverified**.

## 3.9 Uncertain / unverified

- **Source is older than the deployed jar.** Tickets, the ownership GUI and `refuelWhileRunning`/`engineBlocksRefuel` were read from jar constant pools, not decompiled code. Exact flows may differ.
- Blocks-per-second figures are `speed × 20` and ignore drag, water and terrain-follow.
- Whether the Blaze Rod destroy path has an owner check in 1.1.11 (see 3.7.5).
- Whether vehicle weapons are blocked in protected regions / non-PvP areas.
- How horses attach to the carts (`mount-bones: horse_mount1/2` plus a lead interaction) — the mechanic exists, but the exact player steps were not confirmed. The Horse Cart visibly tilts 25° when both horse mounts are empty.
- Whether balloon `lift` is blocks/tick; the Behemoth's 0.2 and the Cloudskimmer's absence of a stated ceiling mean **no altitude limit was found in any config**.
- Whether the 11 missing skins are delivered from a donor/faction source outside `plugins\ModelEngine\blueprints`.

---

# 4. VFBuilders

**Deployed:** `vfbuilders-1.0.0.jar` (`plugin.yml` says `version: 1.0`). The source checkout matches the deployed feature set.

## 4.1 What it is

The construction system: the two workbenches where a qualified engineer spends materials and real time to build a vehicle, which then spawns on a spot you pick nearby.

## 4.2 How a player actually uses it

1. **Get the profession.** Every blueprint needs an **Engineer** rank from the RPCharacters *Crafter* profession tree (`plugins\RPCharacters\professions\crafter.yml`), bought with Crafter points in `/profile`:
   - **Engineer I** — cost 1 point — "Unlocks constructing Ground vehicles"
   - **Engineer II** — cost 2, requires Engineer I — "Unlocks constructing Naval vehicles"
   - **Engineer III** — cost 3, requires Engineer II — "Unlocks constructing Air vehicles"
2. **Build a station.** Both are vanilla crafting-table recipes (`plugins\ItemsAdder\contents\ia_tfmc\contents\base.yml`):
   - **Engineering Table** — `AAA / BBB / BBB` = 3 Iron Ingot on the top row, 6 Oak Planks below.
   - **Dockyard** — `AAA / BAB / BBB` = 4 Iron Ingot, 5 Oak Planks (iron in the top row and the centre).
   Both are hardness 16, blast resistance 14.
3. **Right-click the station.** A **category** GUI opens showing only the categories you have permission for. Categories whose blueprints you cannot build are hidden entirely (`InventoryManager:41,67`).
4. **Pick a category, then a blueprint.** The blueprint icon's lore lists its seat count, weapon count, every component with its HP, the build time, and the full input list.
5. **Have the inputs in your inventory.** Clicking a blueprint you cannot afford gives `§cLacking items`.
6. **Pick the spawn spot.** The GUI closes and you get `§aSelect spawn location by left-clicking within 12 blocks.` A green particle line is drawn from the station to you. **Left-click** where you want the vehicle. If you are too far: `§cToo far from the station! (max 12 blocks)`.
7. Inputs are consumed, you get `§aSpawn location set!` and a title `§eStarted Constructing <vehicle>`. A hologram appears above the station: `§eConstructing §6<name>` and `§7Time: §f<countdown>`.
8. **Wait.** The timer ticks down one second per second.
9. **Be nearby when it finishes.** Completion is deferred until **a player is within 96 blocks** of the spawn point. The vehicle appears with explosion/cloud/enchantment particles and an iron-golem-repair plus beacon-activate sound.
10. **Claim it** by right-clicking it (see 3.2).

If you do not left-click within **30 seconds** the placement is cancelled: `§cVehicle placement cancelled (timeout).`

**Cancelling / losing a build:** breaking the station block (or its ItemsAdder furniture) mid-build removes the station (`§cStation removed.`) and **drops all the inputs back on the ground** at the station (`ActiveStation.cancelConstruction` → `Blueprint.drop`).

## 4.3 Content it adds — categories and blueprints

### Categories (`plugins\VFBuilders\categories.yml`)

| Category | Station | Display name | Description |
|---|---|---|---|
| `wooden_ships` | Dockyard | Wooden Ships | "Sailships made of primarliy wood" *(typo is in the config)* |
| `iron_ships` | Dockyard | Iron Ships | "Steamships with iron hulls and steam engines" |
| `planes` | Engineering Table | Planes | "Planes build from wood and wool powered by an arcane engine" |
| `airships` | Engineering Table | Airships | "Airships build from wood and wool powered by an arcane engine" |
| `carts` | Engineering Table | Carts | "Horse-drawn carriages" |
| `train` | Engineering Table | Train | "Trains and train cars — Must be spawned on rails" |
| `fixed` | Engineering Table | Fixed Guns | "Fixed guns which cannot be moved on their own though some may be towed" |
| `cars` | Engineering Table | Cars | "Cars that run on arcane fuel" |

**Note:** the categories themselves carry no permission, so **every category is visible to everyone**. What is hidden is the individual blueprints inside. A player with no Engineer rank sees eight empty categories.

### All 21 blueprints (`plugins\VFBuilders\blueprints\*.yml`)

| Blueprint | Category | Requires | Build time | Inputs |
|---|---|---|---|---|
| Wooden Cart | carts | Engineer I | **6 min** | 64 Oak Log, 16 Iron Ingot, 16 Stick |
| Small Car | cars | Engineer I | **12 min** | 32 Oak Log, 32 Iron Ingot, 2 Lantern, 2 Arcane Crystal |
| Coal Car | train | Engineer I | **12 min** | 16 Oak Log, 16 Iron Ingot, 8 Stick |
| Passenger Car | train | Engineer I | **12 min** | 16 Oak Log, 16 Iron Ingot, 8 Stick, 16 Cyan Wool |
| Cloudskimmer | airships | Engineer III | **12 min** | 32 Oak Log, 32 White Wool, 32 Iron Ingot, 2 Arcane Crystal |
| Horse Cart | carts | Engineer I | **24 min** | 64 Oak Log, 16 Iron Ingot, 16 Stick, 8 Steel Ingot |
| Anti-Air Turret | fixed | Engineer I | **24 min** | 16 Iron Ingot, 8 Oak Log, 8 Steel Ingot |
| Simple Locomotive | train | Engineer I | **24 min** | 32 Oak Log, 32 Iron Ingot, 8 Furnace, 16 Stick |
| Gunboat | wooden_ships | Engineer II | **24 min** | 64 Oak Log, 64 White Wool, 4 Steel Ingot |
| Monoplane | planes | Engineer III | **24 min** | 16 Oak Log, 16 White Wool, 16 Iron Ingot, 8 Steel Ingot, 8 Arcane Crystal |
| Field Artillery | fixed | Engineer I | **48 min** | 32 Iron Ingot, 16 Oak Log, 16 Steel Ingot |
| Torpedoboat | iron_ships | Engineer II | **48 min** | 64 Iron Ingot, 4 Furnace, 8 Steel Ingot |
| Sloop | wooden_ships | Engineer II | **48 min** | 128 Oak Log, 128 White Wool, 16 Steel Ingot |
| Biplane | planes | Engineer III | **48 min** | 32 Oak Log, 32 White Wool, 32 Iron Ingot, 16 Steel Ingot, 16 Arcane Crystal |
| Gyrobomber | airships | Engineer III | **48 min** | 64 Oak Log, 64 White Wool, 64 Iron Ingot, 16 Steel Ingot, 16 Arcane Crystal |
| Ironclad | iron_ships | Engineer II | **1 h 12 min** | 128 Iron Ingot, 8 Furnace, 16 Steel Ingot |
| Fixed Artillery | fixed | Engineer I | **1 h 36 min** | 64 Iron Ingot, 32 Oak Log, 32 Steel Ingot |
| Anti-Air | fixed | Engineer I | **1 h 36 min** | 64 Iron Ingot, 32 Oak Log, 32 Steel Ingot |
| Bomber | planes | Engineer III | **1 h 36 min** | 64 Oak Log, 64 White Wool, 64 Iron Ingot, 32 Steel Ingot, 32 Arcane Crystal |
| Cruiser | iron_ships | Engineer II | **1 h 36 min** | 256 Iron Ingot, 16 Furnace, 32 Steel Ingot |
| Behemoth | airships | Engineer III | **1 h 36 min** | 128 Oak Log, 128 White Wool, 128 Iron Ingot, 32 Steel Ingot, 32 Arcane Crystal |

`time:` is in **seconds** (`StationManager.tickCycle` ticks once per 20 server ticks). 720 = 12 min, 5760 = 1 h 36 min.

`m.materials.steel_ingot` and `m.materials.arcane_crystal` are MMOItems materials; everything else is vanilla.

**Cheapest path to a vehicle:** Engineer I + a Wooden Cart (64 Oak Log, 16 Iron Ingot, 16 Stick, 6 minutes) — and it comes with a 54-slot inventory.

## 4.4 Player command table

**None.** VFBuilders exposes exactly one command and it is staff-only.

**Excluded (staff):** `/vfbuilders reload` — `vfbuilders.reload`, `default: op`. `CommandManager.canReload` also allows any op. Any other argument prints `§cUsage: /vfbuilders reload` to anyone who types it.

## 4.5 Numbers that matter to players

- **Construction max distance: 12 blocks** (`plugins\VFBuilders\config.yml`). You must be within 12 blocks of the station when you left-click the spawn spot.
- **Placement selection timeout: 30 seconds.**
- **Completion proximity: 96 blocks.** A finished vehicle will not spawn unless a player is within 96 blocks; the station holds it until someone comes back.
- Build times: **6 minutes to 1 hour 36 minutes** (table above).
- The green particle trail from station to spawn point redraws every **5 ticks (0.25 s)**.
- Inputs are re-checked at left-click time; if you spent them in between you get `§cYou no longer have the required items.`
- Engineer point costs: I = 1, II = 2, III = 3, so **6 Crafter points total** to unlock airships and planes.

## 4.6 Features configured but INERT

1. **Categories have no permission gate.** `BlueprintCategory` supports `permission:` (`InventoryManager:41`) but none of the eight categories sets one, so a brand-new player sees all eight and finds every one of them empty. Worth explaining in the wiki so it does not read as a bug.
2. **The Train category lore says "Must be spawned on rails"** — but nothing in `StationManager.onPlayerLeftClick` validates the spawn location at all. The only check is the 12-block distance. Placing a locomotive off-track is not prevented by the plugin; **unverified whether VehicleFramework rejects it downstream.**
3. **`blueprints/*.yml` supports a `disabled:` flag** (documented in `parts.yml` for GunsAndGadgets and honoured for blueprints via `hasDisabledPart`); no blueprint uses it. All 21 are live.
4. **Live station data is empty.** `plugins\VFBuilders\data\stations.json` records no active constructions at snapshot time.

## 4.7 Cross-links

- **VehicleFramework** — hard `depend`; VFBuilders calls `VehicleManager.spawn` directly and reads seat/weapon/component data straight off the `Vehicle` object for its GUI lore.
- **RPCharacters** — the Crafter profession tree grants `professions.engineer_1/2/3`.
- **MMOCore** — Crafter profession levelling supplies the points.
- **ItemsAdder** (`ia_tfmc`) — `tfmc:engineering_table` and `tfmc:dockyard` are the two station blocks.
- **InteractibleFurniture / ItemsAdder furniture** — `StationManager.onFurnitureBreak` listens to ItemsAdder's `FurnitureBreakEvent` so a furniture-type station can be removed.
- **MMOItems** — Steel Ingot and Arcane Crystal inputs; the Engineer Station is where Arcane Fuel and ammunition come from.
- **TLibs** — `iab(tfmc:engineering_table)` block-path resolution and `TimeFormatter` for the hologram countdown.
- **Events other plugins can hook:** `BeginVehicleConstructionEvent` (cancellable) and `VehicleConstructEvent`. Something on this server may well be using them for land-claim checks — **unverified**.

## 4.8 Uncertain / unverified

- Whether any other plugin cancels `BeginVehicleConstructionEvent` (e.g. faction land checks). If one does, players will see the placement silently abort with no message — the handler returns without messaging when cancelled.
- Whether trains actually refuse to spawn off-track.
- The exact `/profile` UI path to buy Engineer ranks — that is RPCharacters' business, not covered here.
- Whether the construction hologram survives a chunk unload (holograms are armour stands and `updateHologram` skips unloaded chunks).

---

# 5. GunsAndGadgets

**Deployed:** `gunsandgadgets-1.0.3.jar`. The source checkout is the same version and the live configs match the shipped resources, so this section is well-grounded.

## 5.1 What it is

A build-your-own-firearm system: at a Gunsmithing Station you bolt together a barrel, loader, chamber, action and stock into a musket, pistol, blunderbuss or rocket launcher whose accuracy, fire rate, reload speed and magazine size come from the parts you chose.

## 5.2 How a player actually uses it

1. **Be a Musketeer.** Every part in `parts.yml` declares `class: Musketeer`, which stamps `REQUIRED_CLASS: Musketeer` onto the finished gun. `GunManager.checkClass` silently refuses to fire for anyone whose MMOCore class is not Musketeer (unless they have `gg.bypass_class`). **Nothing happens at all — no message.**
2. **Get the smithing permissions.** Each part lists a `permissions:` entry (`iron_smith`, `steel_smith`, `abyssalite_smith`, `mythril_smith`). Parts you lack permission for are **hidden** from the GUI, not greyed out (`InventoryManager.hasPermissionForPart`). These correspond to the RPCharacters *Crafter* tree's smith ranks. **See 5.8 — the exact node string does not obviously match.**
3. **Craft a Gunsmithing Station.** Vanilla crafting table, pattern `ADA / BCB / BCB`: top row Copper Ingot, **Iron Ingot**, Copper Ingot; middle and bottom rows Oak Planks, empty, Oak Planks (`plugins\ItemsAdder\contents\ia_tfmc\contents\base.yml:52`). It is ItemsAdder furniture (`tfmc:gunsmithing_station`), floor-only, solid, 1×1×1.
4. **Right-click the station** (do not sneak). A type-selection GUI opens: **Rifle, Pistol, Shotgun, Launcher**.
5. **Fill the five slots.** Slot 10 barrel, 11 loader, 12 chamber, 13 action, 14 stock (`part-types.yml`). Required parts per type (`config.yml`):
   - Rifle: barrel, loader, chamber, action, stock
   - Shotgun: barrel, loader, chamber, action, stock
   - Pistol: barrel, loader, chamber, action *(no stock)*
   - Launcher: barrel, loader, chamber, action *(no stock)*
6. **Click the output in slot 16** to craft. The combined part costs are taken from your inventory. Failures: `§cLacking inputs`, `§cOne or more parts are no longer available for crafting.`, or a class-conflict list.
7. **Load it.** Hold the gun, **right-click with ammo in your inventory**. The gun switches to its reload model, a progress bar appears in your subtitle, and after the reload time it switches to the aim model with rounds loaded. `§aReloaded!`-equivalent is the model change; the gun is ready.
8. **Fire.** **Right-click** again. Each right-click fires one round if the fire-rate cooldown has elapsed. When the last round is spent the gun reverts to the carry model.
9. **You cannot dual-wield.** If a gun is in your **off-hand**, every gun interaction is cancelled outright (`handleGunUse` first block). Rifle and Launcher templates are also `two-handed: true` in MMOItems, so the off-hand is blocked anyway.

## 5.3 Content it adds

### Gun types and their base items (`plugins\MMOItems\item\guns.yml`)

| Type | MMOItems template | TLibs path | Base material | Two-handed |
|---|---|---|---|---|
| Rifle | `GUNS.RIFLE_TEMPLATE` — "Rifle Template" | `m.guns.rifle_template` | Stone Hoe, CMD 22 | **yes** |
| Pistol | `GUNS.PISTOL_TEMPLATE` — "Pistol Template" | `m.guns.pistol_template` | Stone Hoe, CMD 31 | no |
| Shotgun | `GUNS.SHOTGUN_TEMPLATE` — "Shotgun Template" | `m.guns.shotgun_template` | Stone Hoe, CMD 19 | no |
| Launcher | `GUNS.LAUNCHER_TEMPLATE` — "Launcher Template" | `m.guns.launcher_template` | Stone Hoe, CMD 35 | **yes** |

### The 9 skins (`plugins\GunsAndGadgets\skins.yml`)

A skin is picked automatically from your parts via `skin-impact` weights; you do not choose it. Each skin has three model states — **carry** (Stone Hoe CMD), **reload** (Stone Hoe CMD), **aim** (Crossbow CMD).

| Skin | Type | carry / reload / aim |
|---|---|---|
| `rifle_matchlock` | rifle | stone_hoe 21 / 22 / crossbow 17 |
| `rifle_steamlock` | rifle | 23 / 24 / crossbow 18 |
| `rifle_flintlock` | rifle | 25 / 26 / crossbow 19 |
| `rifle_arclock` | rifle | 27 / 28 / crossbow 20 |
| `pistol_matchlock` | pistol | 29 / 30 / crossbow 21 |
| `pistol_flintlock` | pistol | 31 / 32 / crossbow 22 |
| `pistol_steamlock` | pistol | 33 / 34 / crossbow 23 |
| `blunderbuss` | shotgun | 19 / 20 / crossbow 16 |
| `launcher` | launcher | 35 / 36 / crossbow 24 |

### The 17 parts (`plugins\GunsAndGadgets\parts.yml`)

Stat columns: **Acc** accuracy, **FR** fire rate, **Rld** reload, **Spd** projectile speed, **Cap** capacity, **Dmg** damage.

**Barrels**

| Part | For | Tier | Acc | FR | Rld | Spd | Calibers | Cost | Smith rank |
|---|---|---|---|---|---|---|---|---|---|
| Smoothbore Barrel (Long) | rifle | I | +5 | | | 10 | ironshot | 4 Iron Ingot | iron |
| Rifled Barrel (Long) | rifle | II | +10 | | −4 | 8 | ironshot, steelshot | 4 Steel Ingot | steel |
| Smoothbore Barrel (Short) | pistol | I | +3 | | | 8 | ironshot | 4 Iron Ingot | iron |
| Rifled Barrel (Short) | pistol | II | +7 | | −4 | 7 | ironshot, steelshot | 4 Steel Ingot | steel |
| Spread Barrel | shotgun | II | **−8** | | −10 | | spreadshot | 4 Steel Ingot | steel |
| Launcher Barrel | launcher | III | −6 | +16 | −10 | | rocket | 4 Abyssalite Ingot | abyssalite |

**Loaders**

| Part | For | Tier | Acc | FR | Rld | Spd | Cost | Smith rank |
|---|---|---|---|---|---|---|---|---|
| Muzzle Loader | all four | I | +4 | +2 | +4 | 4 | 2 Iron Ingot | iron |
| Breech Loader | rifle, shotgun, launcher | IV | +2 | +5 | **+12** | 3 | 2 Mythril Ingot | mythril |

**Chambers**

| Part | For | Tier | Cap | Acc | FR | Rld | Spd | Dmg | Cost | Smith rank |
|---|---|---|---|---|---|---|---|---|---|---|
| Single Shot | rifle, pistol, shotgun | I | 1 | +2 | | +2 | 3 | | 2 Iron Ingot | iron |
| Single Shot (launcher) | launcher | III | 1 | +8 | | +4 | 4 | | 2 Abyssalite Ingot | abyssalite |
| Quad Shot | launcher | IV | **4** | +2 | | −10 | 3 | | 2 Mythril Ingot | mythril |
| Revolver | rifle, pistol | III | **6** | +4 | +4 | −12 | 1 | **−3** | 2 Abyssalite Ingot | abyssalite |

**Actions**

| Part | For | Tier | Acc | FR | Rld | Spd | Caliber override | Cost | Smith rank |
|---|---|---|---|---|---|---|---|---|---|
| Steamlock | rifle, pistol | I | +1 | +4 | | −3 | **forces pebbleshot** | 2 Iron Ingot | iron |
| Matchlock | rifle, pistol, shotgun | II | +1 | +1 | | | | 2 Steel Ingot | steel |
| Flintlock | rifle, pistol, shotgun | III | +2 | +2 | | | | 2 Abyssalite Ingot | abyssalite |
| Rocketlock | launcher | III | +3 | **−10** | −6 | | | 2 Abyssalite Ingot | abyssalite |
| Experimental Arclock | rifle | IV | **+8** | **−12** | −10 | 8 | **forces bronzeshot** | 2 Mythril Ingot | mythril |

**Stocks** (rifle and shotgun only)

| Part | Tier | Acc | Cost | Smith rank |
|---|---|---|---|---|
| Oak Stock | I | +3 | 2 Refined Barkwood | iron |
| Maplewood Stock | II | +4 | 2 Refined Maplewood | steel |
| Elderwood Stock | III | +5 | 2 Refined Elderwood | abyssalite |
| "Elderwood Stock" (`demonwood_stock`) | IV | +6 | 2 Refined Demonwood | mythril |

> **Naming bug:** `demonwood_stock` has `name: "§8Elderwood Stock"` and the same model (`model=30`) as `elderwood_stock`. In-game the Tier III and Tier IV stocks are **indistinguishable by name or icon** — the only difference is +5 vs +6 accuracy and the material cost.

### The 6 ammunition types (`plugins\GunsAndGadgets\ammunition.yml`)

| Ammo | MMOItems | Dmg | Acc | Pierce | Projectiles | Special |
|---|---|---|---|---|---|---|
| Pebbleshot | `UTILS.PEBBLESHOT` | 8 | −2 | 1 | 1 | **smokeless, no muzzle flash** |
| Spreadshot | `UTILS.SPREADSHOT` | 1 each | | 0 | **16** | range +20 |
| Ironshot | `UTILS.IRONSHOT` | 9 | −1 | 4 | 1 | |
| Steelshot | `UTILS.STEELSHOT` | 12 | +4 | 5 | 1 | |
| Bronzeshot | `UTILS.BRONZESHOT` | **16** | +6 | 8 | 1 | Arclock only |
| Rocket | `UTILS.ROCKET` | 18 | +2 | 14 | 1 | **explosive, 8-block blast** |

Ammunition is crafted at the **Alchemy Station** (`plugins\MMOItems\crafting-stations\alchemy-station.yml:439-495`), 5 s each:

| Ammo | Output | Ingredients |
|---|---|---|
| Pebbleshot | **64** | 2 Gravel |
| Ironshot | **64** | 1 Gunpowder, 1 Iron Ingot |
| Steelshot | **32** | 1 Gunpowder, 1 Steel Ingot |
| Spreadshot | **32** | 1 Gunpowder, 1 Iron Ingot |
| Bronzeshot | **16** | 1 Gunpowder, 1 Bronze Ingot |
| Rocket | **8** | 1 Gunpowder, 1 Iron Ingot |

Pebbleshot, Spreadshot and Bronzeshot use `hide-when-locked: true` — they are invisible until you meet the condition. Ironshot and Rocket are always visible.

## 5.4 Player command table

**None.** GunsAndGadgets has exactly one command and both of its subcommands are permissioned.

**Excluded (staff):** `/gg reload` and `/gg refresh` — both require `gunsandgadgets.reload`, `default: op`. A player who types `/gg` with no argument sees `§eUsage: /gg reload | /gg refresh`; the command node itself carries `permission: gunsandgadgets.reload`, so a normal player gets the permission message instead.

Player-relevant permissions that exist but are **not** granted by default: `gg.bypass_class` (fire without being a Musketeer) and `gg.bypass_crafting_cost` (craft without spending materials).

## 5.5 Numbers that matter to players

### Accuracy → spread cone (`StatCalculator.calculateAccuracy`)

| Total accuracy stat | Spread |
|---|---|
| −10 | ~40° (hard cap) |
| −5 | ~40° |
| 0 | 5.0° |
| 5 | 2.5° |
| 10 | ~2.07° |
| 20 | 1.2° |
| 25 | ~0.64° |
| 30 | 0.07° |

Below 0 the penalty is **exponential** (`25 × 1.1^(−stat)`, capped at 40°). A Blunderbuss (Spread Barrel, −8) is deliberately a wall of pellets. Minimum possible spread after all modifiers is 0.02°.

### Fire rate → seconds between shots (`StatCalculator.calculateFireRate`)

| Fire-rate stat | Cooldown |
|---|---|
| −30 | 4.0 s |
| −10 | ~2.0 s |
| 0 | 1.0 s |
| 5 | 0.75 s |
| 10 | 0.5 s |
| 15 | 0.3 s |
| 20 or more | 0.1 s |

### Reload → ticks (`StatCalculator.calculateReloadTicks`)

`60 ticks × (1 − reloadStat × 0.05)`, reload stat clamped to ±20, result clamped to **10–200 ticks (0.5 s – 10 s)**.

| Reload stat | Reload time |
|---|---|
| −20 | 6.0 s |
| −10 | 4.5 s |
| 0 | **3.0 s** |
| +10 | 1.5 s |
| +20 | 0.5 s |

**Moving interrupts reloading.** Every tick the plugin measures how far you moved; if you moved more than ~0.05 blocks it rolls `min(1, distance × 2)` to *skip* that tick. Move half a block in a tick and the reload tick is skipped 100% of the time — **sprinting stops the reload dead**. Stand still to reload.

### Range

`(gun range + ammo range) × 2` if either is set; otherwise **rockets fly 160 blocks** and everything else uses `clamp(speed × 10, 96, 192)`. With a Rifled Long Barrel + Muzzle Loader + Single Shot (speed 8+4+3 = 15) that is **150 blocks**.

### Damage and armour penetration

Damage = gun damage stat + ammo damage. Only the Revolver modifies gun damage (**−3**), so in practice your damage is your ammunition.

`pierce` decides how much of that damage **ignores armour entirely**: `piercePercent = min(1, pierce / 20)`. The pierced portion is applied as raw vanilla damage; the rest goes through MythicLib as `PROJECTILE` damage (so MMOCore defence stats, resistances and enchantments apply).

| Ammo | Pierce | Armour-ignoring share |
|---|---|---|
| Pebbleshot | 1 | 5% |
| Spreadshot | 0 | 0% |
| Ironshot | 4 | 20% |
| Steelshot | 5 | 25% |
| Bronzeshot | 8 | 40% |
| Rocket | 14 | **70%** |

### Rockets

- Blast radius **8 blocks**, damage falls off linearly with distance.
- Base explosion damage is **2× the projectile damage** at the centre.
- **Block damage is OFF** on this server (`block-damage: false`) — rockets do not crater terrain.
- **Self-damage is catastrophic.** If the shooter is inside the blast, the code multiplies their damage by `damage × 2 × scale` *again* (`ProjectileShooter.explode`). At point blank with a Rocket that is roughly 36 × 36 = well over a thousand. Treat "do not shoot a rocket at your own feet" as an absolute rule.
- Rockets travel at 0.3 × speed; everything else at 0.7 × speed.

### Charisma

`config.yml` maps the MMOCore **Charisma** attribute to:
- `accuracy-per-level: 1.0` → **1% smaller spread cone per Charisma point**
- `reload-reduction-per-level: 1.0` → **1% faster reload per Charisma point**

Both are applied as `1 − total/100`, so 50 Charisma halves your spread and your reload time. (At 100+ Charisma the multiplier goes to zero or negative — **untested, flag to staff**.)

### Ammunition consumption

One reload consumes **`capacity` ammo items** and loads exactly that many rounds. A Revolver takes 6 items per reload; a Single Shot takes 1. If you have fewer than `capacity`, it takes what you have and loads that many. The reload uses **the first matching caliber found** in your inventory — with a Rifled Barrel (ironshot *and* steelshot) you cannot choose which; it picks whichever it finds first.

### A worked example

Rifle = Rifled Barrel (Long) + Muzzle Loader + Single Shot + Matchlock + Maplewood Stock, firing Steelshot:

- Accuracy 10+4+2+1+4 = 21, plus ammo +4 = **25 → 0.64° spread**
- Fire rate 2+1 = 3 → **0.85 s between shots**
- Reload −4+4+2 = 2 → **2.7 s**
- Capacity 1 → one shot per reload, one Steelshot consumed
- Damage **12**, of which **25% ignores armour**
- Range **150 blocks**
- Total build cost: 4 Steel Ingot + 2 Iron Ingot + 2 Iron Ingot + 2 Steel Ingot + 2 Refined Maplewood

## 5.6 PvP and restrictions

There is **no PvP flag, region check, faction check or safe-zone check anywhere in GunsAndGadgets.** Damage is routed through MythicLib's `registerAttack`, so whatever MythicLib / MMOCore / the server's protection plugins do to a normal projectile attack is what happens here. `intersectsCollision` means bullets stop at solid blocks — but **leaves and any block whose name contains `GLASS` are bullet-passable** (`isBulletPassable`), so glass windows and hedges offer no cover.

The real gates are:
- **Musketeer class** to fire at all (silent failure otherwise).
- **Smith permissions** to see parts in the crafting GUI.
- **Two-handed** on rifles and launchers.
- Guns marked **BROKEN** cannot be used (see 5.7).

## 5.7 Features configured but INERT

1. **`scoped` option on `rifle_arclock` does nothing.** `skins.yml` declares `options: - scoped`, and the string `scoped` appears nowhere in the plugin source. There is **no zoom, no scope overlay**. Do not promise players one.
2. **`demonwood_stock` is indistinguishable from `elderwood_stock`** in name and model (see 5.3).
3. **`disabled: true` on parts** is documented at the top of `parts.yml` and honoured by `hasDisabledPart`, but **no part uses it** — all 17 are craftable.
4. **`stat_refresh_debug: false`** — staff-only diagnostic.
5. **BROKEN guns.** If a gun references a part id that no longer exists in `parts.yml`, `GunBrokenMarker` renames it to `§c§lBROKEN`, adds a `§7Missing parts: …` lore line, and blocks all use. `plugins\GunsAndGadgets\data\revisions.json` tracks part revisions so stat changes propagate via `/gg refresh`. **This is a real state a player can end up in after a config change, and the wiki should say what it means and that staff must fix it.**
6. **Legacy muskets are dead.** `GunManager.preventOldMuskets` cancels `UntargetedWeaponUseEvent` for any MMOItems item of type `MUSKETS`. If any old musket items are still in circulation, **they do nothing at all**.
7. **`rocket-sound: minecraft:block.lava.extinguish`** is configured; whether it plays is unverified.
8. `required-parts` lists `stock` for shotgun but the **Spread Barrel is the only shotgun barrel** and no shotgun-specific stock exists — shotguns use the same four rifle stocks.

## 5.8 Cross-links

- **MMOCore classes** — the **Musketeer** class (`plugins\MMOCore\classes\musketeer.yml`) is a hard gate on firing.
- **MMOCore attributes** — **Charisma** improves accuracy and reload speed.
- **MythicLib** — all non-pierce damage is registered as a `PROJECTILE` attack, so MMOCore stats, defences and on-hit effects apply.
- **MMOItems** — the four gun templates, all six ammunition items, and the Alchemy Station that makes ammo.
- **RPCharacters** — the Crafter profession tree grants `professions.iron_smith` / `steel_smith` / `abyssalite_smith` / `mythril_smith` (costs 1 / 2 / 3 / 4, each requiring the previous).
- **ItemsAdder** (`ia_tfmc`) — the Gunsmithing Station furniture and the gun models (`tfmc_pack` → `assets\minecraft\models\item\guns\*.json`, see section 0.4).
- **VehicleFramework** — GunsAndGadgets imports `LightEffect` and `ActiveVehicle` from it directly; muzzle flashes use VF's dynamic light system. Vehicle-mounted rifles use VF's own `gun_turret`, not this plugin.
- **AdvancedCrafting** uses the same `iron_smith` / `steel_smith` namespace for its ingredient tiers (`plugins\AdvancedCrafting\config.yml:57`), so the smith ranks span both systems.
- **Materials chain** — Steel, Bronze, Abyssalite and Mythril Ingots come from the Ingot Station; Refined Barkwood / Maplewood / Elderwood / Demonwood from the woodworking chain.

## 5.9 Uncertain / unverified

- **The smith permission nodes may not match.** `parts.yml` uses bare node strings (`iron_smith`) and `InventoryManager.hasPermissionForPart` calls `player.hasPermission("iron_smith")` verbatim. RPCharacters grants `professions.iron_smith` (`plugins\RPCharacters\professions\crafter.yml:90`). AdvancedCrafting treats `iron_smith` as a *namespace* it expands. Unless LuckPerms also grants the bare node, **every part in the Gunsmithing Station would be hidden from every player**. I could not read the LuckPerms H2 database to confirm. **This is the single most important thing to test in-game before writing the page.**
- Whether Charisma above 100 breaks accuracy (the multiplier can go to zero or negative).
- The exact skin-selection algorithm from `skin-impact` weights — I read the config, not the resolver.
- Whether guns have durability. None was found: no `max_item_damage` on the templates and no durability handling in the source.
- Whether the `name-impact` system produces readable gun names in practice (entries like `Musket 1 10`, `(Revolver) 2 10`, `#3a3e4dRocket 0 100` are a priority/weight format, not plain names).
- Whether any server protection plugin blocks gun damage in safe zones.

---

# 6. Images

**Deployed:** `images-2.5.9.jar` by **Andavin** — a third-party plugin, not in-house. Source is not on the server; everything below is from the jar's `plugin.yml`, its bytecode constant pools, `plugins\Images\config.yml`, and a direct SQLite query of `plugins\Images\images.db`.

## 6.1 What it is

A staff tool for rendering arbitrary picture files onto walls of item frames and maps.

## 6.2 Verdict: STAFF-ONLY — EXCLUDE FROM THE WIKI

Three independent facts support this:

1. **Every command is permission-gated and none of those permissions is declared in `plugin.yml`.** The jar's `plugin.yml` registers the `image` command with **no `permissions:` block at all**, while `CreateCommand`, `DeleteCommand`, `DeleteNearCommand`, `ImportCommand`, `ListCommand`, `TransferCommand` and `ImageCommand` each check a node:
   - `images.command.create`
   - `images.command.create.url`
   - `images.command.delete`
   - `images.command.delete.near`
   - `images.command.import`
   - `images.command.list`
   - `images.command.manage`
   - `images.command.transfer`
   - `images.restricted.bypass`

   An undeclared Bukkit permission defaults to **op-only**. Unless LuckPerms explicitly grants one of these to a player group, no normal player can run any part of `/image`.

2. **No image has ever been created on this server.** `plugins\Images\images.db` is a SQLite file containing exactly one table, `custom_images`, with **0 rows** (verified by query). The file is 8192 bytes — a bare header plus an empty page.

3. **Nothing else references it.** No in-house plugin config mentions Images, and there is no `ConditionalEvents`, `HelpCommand` or `AACommandsFiller` entry pointing at `/image`.

**Recommendation: exclude Images from the player-facing wiki entirely.** If it later gets used for, say, faction banners or a map room, it will need its own page written from scratch.

## 6.3 Player command table

**None.**

**Excluded (staff):** `/image create|delete|list|import` — aliases `/customimage`, `/images`, `/img` (from `plugin.yml`). The bytecode also shows `transfer`, `delete near`, `resize` and `size` subcommands not mentioned in the usage string.

## 6.4 Numbers (staff-facing only)

From `plugins\Images\config.yml`:

- `invisible-frames: true` — the item frames and maps behind an image are hidden so the pixels appear to float.
- `show-distance: 64` / `hide-distance: 74` — image sections render within 64 blocks and unload past 74.
- `database.type: SQLITE`, file `plugins\Images\images.db`.
- `permissions.creator-restricted: false` — **anyone with the edit permissions could modify anyone else's image.** Currently moot (zero images) but worth telling staff before they start using it.

## 6.5 Features configured but INERT

Effectively the whole plugin. It is installed, configured with defaults, and has never been used.

## 6.6 Cross-links

None. Images has `softdepend: [Multiverse-Core, PlotSquared, ProtocolLib]`; only ProtocolLib is installed on this server.

## 6.7 Uncertain / unverified

- I could not read `plugins\LuckPerms\luckperms-h2-v2.mv.db` (compressed H2 format), so I cannot **prove** no player group has been granted `images.command.*`. The zero-row database makes it academic, but if staff want certainty, run `/lp group default permission info` and check for `images.`.
- Whether the plugin is even being loaded successfully (its `api-version` is `1.13`, well behind the server's 1.21).
