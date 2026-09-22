# ProvinceSystem

> TF-Minecraft's web home for maps, characters, and custom creations.

ProvinceSystem powers the TFMC website and its connected world services. What began as the province and political-map system now brings together the interactive map, character creation, skin submissions, custom drinks, and player guides.

It connects the Minecraft world with a browser experience: players can explore the political landscape, manage character details, and work on creations that return to the game through the companion plugins.

## Features

- **Interactive world maps** — explore provinces and political information, including nations, settlements, installations, and wars.
- **World history** — browse the chronicle and archived map chapters to revisit changes in the world.
- **Character creation and profiles** — create characters and manage their profiles, wardrobes, and kits through the website.
- **Custom skin submissions** — submit supported cosmetic skins through an in-game-code-linked workflow.
- **Drink design** — create BreweryX recipes and submit custom drinks for staff review.
- **Player knowledge hub** — browse the wiki's guides to crafting, professions, equipment, economy, and other server features.

## Connected to the server

[SimpleFactions](https://github.com/TF-Minecraft/SimpleFactions), [RPCharacters](https://github.com/TF-Minecraft/RPCharacters), and [DrinkBuilder](https://github.com/TF-Minecraft/DrinkBuilder) connect the website to their respective in-game experiences.

## Documentation

[Project documentation](https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/README.md)

Technical documentation is maintained in [TF-Minecraft/Docs](https://github.com/TF-Minecraft/Docs).

## Generated map files

`backend/src/output/` holds local runtime output and is not versioned. Keep the
authored map inputs in `backend/src/input/` and definitions in `backend/src/defines/`.
To populate a fresh checkout, install `backend/requirements.txt`, then run from
`backend/` for each map you serve (for example, `main` and `dev`):

```sh
python -m src.scripts.tools.run_regen --map main --type fullregen
python -m src.scripts.mapgen.mapmodes.terrain_mapmode --map main
python -m src.scripts.mapgen.mapmodes.fertility_mapmode --map main
```

Run these commands before starting the backend; regeneration updates compiled
definitions as well as map images. Docker Compose mounts the same output directory.
When updating an existing deployment across the output-file cleanup, back up its
output directory outside the checkout before pulling, then restore it afterward.
Preserve runtime history and other server data: map regeneration only replaces
rendered map assets, and does not reconstruct historical records.

The retained ammo sprite source is `frontend/assets/wiki/ammo_sheet.png`. The
grindstone assets are in `frontend/public/wiki/models/stations/` and
`frontend/public/wiki/textures/stations/grindstone/`; temporary duplicate copies
do not need to be committed.

## License

Copyright (c) 2026 TF-Minecraft contributors.

TF-Minecraft-authored material in this repository is licensed under the
[Artistic License 2.0](LICENSE). Third-party dependencies and bundled material
retain their own licenses.
