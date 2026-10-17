# Alchemist Collector herb acquisition

Checked 2026-09-12 against the read-only cloned server configuration under
`C:/Users/MSI/Desktop/plugins`. This evidence covers active rules only. The wiki does not
publish the configured probabilities or item statistics for these herb sources.

## Active rule coverage

All four collector tiers define the same twelve block-to-herb mappings. The active Iron
rules are at `TFMCCore/drops.yml:3-96`, Steel at `:97-190`, Abyssalite at `:191-284`, and
Mythril at `:285-378`. Each rule names exactly one required tool and sets
`vanilla_drops: false`. None of these herb rules contains `required_permissions`.

| Herb output | Block harvested | Iron evidence | Steel | Abyssalite | Mythril |
| --- | --- | --- | --- | --- | --- |
| Dying Leaf | Oak or dark oak leaves | `:3-10` | `:97-104` | `:191-198` | `:285-292` |
| Birch Seed | Birch leaves | `:11-17` | `:105-111` | `:199-205` | `:293-299` |
| Autumn Leaf | Spruce leaves | `:18-24` | `:112-118` | `:206-212` | `:300-306` |
| Spot Leaf | Jungle leaves | `:25-31` | `:119-125` | `:213-219` | `:307-313` |
| Fire Leaf | Acacia leaves | `:32-38` | `:126-132` | `:220-226` | `:314-320` |
| Long Leaf | Mangrove leaves | `:39-45` | `:133-139` | `:227-233` | `:321-327` |
| Dwindle Leaf | Cherry leaves | `:46-52` | `:140-146` | `:234-240` | `:328-334` |
| Burrow Root | Oak, dark oak, birch, or spruce logs | `:53-62` | `:147-156` | `:241-250` | `:335-344` |
| Thorn Root | Jungle, acacia, mangrove, or cherry logs | `:63-72` | `:157-166` | `:251-260` | `:345-354` |
| Clover | Fern, large fern, short grass, or tall grass | `:73-82` | `:167-176` | `:261-270` | `:355-364` |
| Pumpkin Spore | Pumpkin | `:83-89` | `:177-183` | `:271-277` | `:365-371` |
| Kelpberry | Kelp | `:90-96` | `:184-190` | `:278-284` | `:372-378` |

The exact player-facing tool names come from `MMOItems/item/tools.yml:430-433`,
`:448-451`, `:468-471`, and `:488-491`: Iron, Steel, Abyssalite, and Mythril Alchemist
Collector. The output names match `MMOItems/item/herbs.yml`: Dying Leaf and Birch Seed at
`:1-16`, Autumn Leaf through Dwindle Leaf at `:23-71`, Kelpberry through Pumpkin Spore at
`:199-225`, Clover at `:210-214`, Thorn Root at `:265-269`, and Burrow Root at `:298-302`.

The material catalogue also contains ten legacy herbs with no active collector rule:
Nightshade, Grapeberries, Arcane Leaf, Fiery Fruit, Barkshroom, Caveshroom, Flatshroom,
Death Fruit, Blazed Root, and Serpent Root. They retain the neutral unknown-acquisition
fallback. Attaching the collector instructions to any of them would contradict the active
drop table. The remaining MMOItems herb definitions likewise are not collector outputs and
were not added to the material catalogue for this change.

A broader exact-ID/name scan across `C:/Users/MSI/Desktop/plugins` found those ten legacy
items only in `MMOItems/item/herbs.yml` (definitions),
`MMOItems/crafting-stations/medicine-station.yml` (recipe ingredients),
`DrinkBuilder/ingredients.yml` (drink ingredient registration), and
`Research/aspects/elements.yml` (research/aspect associations). None of those references
creates or gathers the herb. No other plugin config matched these ten IDs, so the available
configuration does not establish an acquisition source for their existing material pages.

## Runtime behavior checked

`plugin-src/tfmccore/src/main/java/net/tfminecraft/tfmccore/reference/Drop.java:117-139`
requires both the configured block and configured held tool before suppressing vanilla
drops. Lines `:142-150` then run the configured custom drop. This supports the public
wording about the held collector, harvested block, lack of a permission requirement, and
suppressed normal drops without exposing probabilities.

## Verification

`npx vitest run app/wiki/materials/herbAcquisition.test.tsx` covers all twelve output
mappings from repository-owned expectations, the four newly catalogued herbs, and the
rendered Dying Leaf page. It does not depend on the external plugin directory at test time.
