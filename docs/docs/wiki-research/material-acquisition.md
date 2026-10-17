# Tin, Ignitium, Niter and Arcane Crystal acquisition

Checked 2026-09-12 against `C:/Users/MSI/Desktop/plugins`, the cloned server configuration. This is evidence for the wiki, not a claim to have tested drops on a running Minecraft server. No server configuration was edited.

## Mining and logging

All config paths below are relative to `C:/Users/MSI/Desktop/plugins`.

| Evidence | Consequence |
| --- | --- |
| `TFMCCore/drops.yml:414–444` | Lucky Miner: iron, gold, diamond, redstone, lapis, emerald and copper ores, including each deepslate variant. Coal, nether ores and stone are not in this rule. Permission `professions.lucky_miner`; no special custom tool requirement. Ignitium `0.002`; Niter and Arcane Crystal each `0.0005`. |
| `TFMCCore/drops.yml:436` | `raw_tin(0.001)` is commented out. Do not advertise a 0.1% Tin mining chance. |
| `TFMCCore/drops.yml:646–666` | Tree Gatherer IV: spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove, pale oak logs. Permission `professions.tree_gatherer_4`; Ignitium `0.0001`. |
| `RPCharacters/professions/crafter.yml:158–168` | Player-facing perk name Lucky Miner I; grants the mining permission. |
| `RPCharacters/professions/herborist.yml:179–191` | Player-facing perk name Tree Gatherer IV; grants the logging permission. |

Fractional probability semantics were verified from the local implementation at `C:/Users/MSI/Desktop/plugin-src/tfmccore/src/main/java/net/tfminecraft/tfmccore/`:

- `reference/DropEntry.java:7–20` parses the parenthesized value as the chance; default amount is one.
- `reference/Drop.java:117–132` checks block, permissions and configured tools.
- `reference/Drop.java:142–150` compares `Math.random()` to the chance. Therefore the base chances are **0.2% Ignitium per eligible ore, 0.05% Niter/Arcane Crystal per eligible ore, and 0.01% Ignitium per eligible log**. One shared random seed is used for the rule: these are marginal item probabilities, not mutually exclusive outcomes.
- `reference/Drop.java:165–181` applies modifiers and Fortune via `1 - (1 - chance)^(fortuneLevel + 1)`. The pages label all percentages “before Fortune”; no constant chance is promised for enchanted tools.

## Detector

`geiger_counter/config.yml:101–126` labels rewards as weighted and sets `active-list: prologue` at line 116. Tier weights at 107–112 do not sum to 100. The nearby percentage comments cannot establish exact item probabilities; no normalized or unconditional percentages are published.

- Prologue Ignitium rewards: common 2 at line 126, rare 4 at 134, epic 8 at 142, legendary 16 at 149. Act 1 also includes these amounts (159–185).
- Tin appears in **Default** (192–208) and **Event** (263–279), with common entries 4, 4, 8 and uncommon 12. Neither is the selected Prologue pool. Tin's detector route is explicitly marked currently unavailable.

## Dowsing production

`Dowsing/production_methods.yml:24–33` defines Rare Ore Mine (`rare_ore_focus`) and adds Niter and Arcane Crystal with value 50 each. Other production methods add output entries, including `nothing` in the Stone Tools and Iron Tools methods. The page identifies this source but does **not** turn the two 50 values into unconditional 50% chances.

## Loot rewards

- `ConditionalEvents/events/loot.yml:254–289`: right-click Pouch of Rare Materials; the configured actions give 3, 6, 9 or 12 Ignitium. The page lists amounts without deriving branch probabilities from ordered condition thresholds.
- `ExcellentCrates/crates/voting_crate_3.yml:53–66`: Voting Crate variant includes 64 Ignitium, reward weight 20. `:163–176`: Tin amount 8, weight 40. Additional variants include Tin (`voting_crate_1.yml:229–242`, `voting_crate_2.yml:153`, and further entries) and Ignitium (`voting_crate.yml:207–351`, `_1.yml:53–66`, `_2.yml:53–66`). Multiple variants share the display name; the wiki does not claim which variant is currently offered. Players are directed to the available crate preview.
- `ExcellentCrates/crates/war_crate.yml:415–428`: Arcane Crystal amount 32, weight 10. Again this is a configured reward pool, with availability checked in game and exact chance unverified.

Crate weights and rarity categories alone are not converted to player-facing drop percentages.

## Block conversions

`MMOItems/crafting-stations/ingot-station.yml`:

- `:290–294`: pack 4 Ignitium into one Block of Ignitium; `:403–412`: unpack one block into 4 Ignitium, 5 seconds.
- `:300–304`: pack 4 Tin into one Block of Tin; `:423–432`: unpack one block into 4 Tin, 5 seconds.

These are storage conversions requiring material already owned. The generated recipes remain authoritative and unchanged by this fix. Their stable keys are `gen-ingot-station-ignitium-block2` and `gen-ingot-station-tin-block2`.

## Same pattern outside this scope

Other material recipes also include unpacking (for example Coke and processed ingots), but those entries have primary production recipes and are not the four acquisition corrections requested. Tin is called “Raw Tin” in Bronze recipe ingredient display strings (`ingot-station.yml:73,82`), so the existing name-based reverse index misses those Bronze uses; this is a separate name-alias issue. The material fallback wording has been made neutral for every undocumented material. The old `dropOnlyMaterials` export name remains because the recipe generator scans this catalogue.

## Verification

- `npx vitest run app/wiki/materials/materials.test.tsx app/wiki/data/registry.test.ts app/wiki/wikiRoutes.test.tsx`: 63 passed (9 acquisition regressions). The initial seven acquisition regressions all failed before the fix.
- `npx vitest run scripts/build-wiki-search-index.test.mjs lib/wikiSearch.test.ts`: 8 passed.
- Live requests to `http://127.0.0.1:3000/wiki/materials` and the four target detail routes returned HTTP 200 and passed visible acquisition/chance/unpacking assertions using `extractSearchEntries`.
- Refreshed only affected material routes with `node scripts/validate-live-wiki.mjs --refresh-route <route>`: overview, the four target details, and 49 other details whose shared fallback wording changed. This reads live HTTP responses, not `.next` production HTML.
- Independently fetched all 54 refreshed routes and compared extracted entries to `public/wiki/search-index.json`: all 160 affected records matched; index remains 553 records. No material record retained “No crafting recipe.”
- Reviewed every `material.recipe` caller: only the material detail renderer and catalogue indexing logic use it. Unpacking is now rendered separately and recipe registration remains intact.

Full-suite limitations: `npm test -- --reporter=dot` produced 1430 passes, one skip, and the unrelated `app/lib/titleProvinces.test.ts:117` failure `AssertionError: expected [ Array(80) ] to deeply equal [ Array(47) ]`. `npx tsc --noEmit --incremental false` reported existing unrelated test typing errors in countyAssignment, duchyAssignment, paintTitleLayers, mapLabels and loreSkinMode, with no wiki errors. No production build or dev-server restart was performed.
