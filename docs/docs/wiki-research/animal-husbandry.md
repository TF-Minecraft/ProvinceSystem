# Animal husbandry and Market Block correction

Checked 2026-09-20 against Desktop/plugins/Cooking/husbandry.yml,
Desktop/plugins/cooking-0.1.5-ALPHA.jar (javap bytecode),
Desktop/plugins/MMOItems/item/pets.yml, and cooking-src sources/docs.
The supplied JAR and active configuration take precedence over source design notes.

- Ownership: named Ownership Token, 15 animals including co-ownership;
  Universal Feed consumes a use, Glove clears Dirty without consumption.
- Care: maximum 200, +1/hour happy, -1/hour after 24h affliction grace;
  loaded affliction interval 4-8h, mean 6h; unloaded gain capped at 8h;
  long-unload force after 8h. Growth 1h, chicken override 45m.
- Species and slaughter products follow the active species map, including
  camel leather and llama feathers. Do not substitute the source-doc defaults.
- JAR HusbandryQualityRange.of computes minimum stars from effective genetics
  and maximum stars from raw genetics. HusbandryHarvest.buildFood rolls within
  this range. The source document's claim that care cannot affect stars is stale.
- The JAR uses harvest-mode lists and string product paths. The source checkout
  has a newer, incompatible nested species structure. Active sheep/goat entries
  have no shear product string; JAR HusbandryHarvestListener exits for blank
  strings, leaving ordinary sheep shearing intact. Do not promise custom goat
  shearing or the configured 20/40-minute custom shear timers in the public guide.
- Milk cooldown 20m; eggs 10m; chicken shed timer 8h, 15% eligible-check chance.
  No new player commands are exposed for husbandry.

Market Block: ItemsAdder/contents/ia_tfmc/contents/base.yml has pattern
FEA / BBB / BAB, F=INK_SAC, E=PAPER, B=OAK_PLANKS, A=empty.
This agrees with the user's in-game screenshot: five individual planks,
empty top-right and bottom-middle. Synthetic Ink substitution is confirmed by
the user-supplied screenshot; represented as a recipe note.
