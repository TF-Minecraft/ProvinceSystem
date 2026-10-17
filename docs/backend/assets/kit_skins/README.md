# Kit default skins

Default editable-kit PNGs ship in `backend/assets/kit_skins/` in the TFMCWeb checkout as `{skin_png}.png` (for
example `knife_skin.png`).

**Production:** RPCharacters uploads these on creation-catalog sync via
`PUT /characters/plugin/kit-skins/{name}` from `plugins/RPCharacters/assets/`. The API stores them in
`backend/src/data/plugin-assets/kit_skins/`, the data mount, so they survive image rebuilds, and reads that folder
before the shipped one. The masked wardrobe template (`PUT /characters/plugin/wardrobe-templates/masked`) is stored the
same way in `plugin-assets/wardrobe/`. Do not hand-copy assets onto the website host.

**Lookup order:** `KIT_SKINS_DIR` when set, the synced folder, the shipped folder, then a sibling RPCharacters
checkout's `rpcharacters/src/main/resources/assets/{skin_png}.png` when present.
