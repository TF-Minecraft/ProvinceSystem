# ProvinceSystem

> TF-Minecraft's web home for maps, characters, and custom creations.

ProvinceSystem powers the TFMC website and its connected world services. It brings together the interactive map, character creation, skin submissions, custom drinks, and player guides.

It connects the Minecraft world with a browser experience: players can explore the political landscape, manage character details, and work on creations that return to the game through the companion plugins.

## Features

- **Interactive world maps** — explore provinces and political information, including nations, settlements, installations, and wars.
- **World history** — browse the chronicle and archived map chapters to revisit changes in the world.
- **Character creation and profiles** — create characters and manage their profiles, wardrobes, and kits through the website.
- **Custom skin submissions** — submit supported cosmetic skins through an in-game-code-linked workflow.
- **Drink design** — create BreweryX recipes and submit custom drinks for staff review.
- **Accounts and staff tools** — sign in with Discord, manage linked accounts and supporter status, and use role-controlled player, activity, rail, and permission panels.
- **Player knowledge hub** — browse the wiki's guides to crafting, professions, equipment, economy, and other server features.

## Connected to the server

[SimpleFactions](https://github.com/TF-Minecraft/SimpleFactions), [RPCharacters](https://github.com/TF-Minecraft/RPCharacters), and [DrinkBuilder](https://github.com/TF-Minecraft/DrinkBuilder) connect the website to their respective in-game experiences.

## Documentation

[Project documentation](https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/README.md)

Technical documentation is maintained in [TF-Minecraft/Docs](https://github.com/TF-Minecraft/Docs).

[Previews and deployment](https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/DEPLOY.md)

## Tests

CI uses Node 22 and Python 3.12. From the repository root, install dependencies
and run the frontend Vitest and backend pytest suites with the same JUnit output:

```sh
(cd frontend && npm ci && npm test -- --reporter=default --reporter=junit --outputFile.junit=../test-results/frontend.xml)
(cd backend && python -m pip install -r requirements.txt -r requirements-dev.txt && python -m pytest -q --junitxml=../test-results/backend.xml)
```

CI uploads `test-results/frontend.xml` and `test-results/backend.xml`, then builds
the Next.js frontend. No coverage threshold is enforced. The suites exercise
website components, application logic, and APIs in isolation; they do not run a
live Minecraft server, companion plugins, or real external-service flows.

## License

Copyright (c) 2026 TF-Minecraft contributors.

TF-Minecraft-authored material in this repository is licensed under the
[Artistic License 2.0](LICENSE). Third-party dependencies and bundled material
retain their own licenses.
