# Gameplay guide authoring

Everything under `/wiki` is a public player manual. Write for someone joining the server for the first time. Explain the goal, the first action, the normal loop, costs, cooldowns, and consequences in plain language. Keep useful reference tables and link the next related activity.

## Content rules

- Use only facts supported by the research dossiers in [`docs/wiki-research`](../../../docs/wiki-research/) or another approved read-only source.
- Describe player actions. Leave plugin names, configuration details, database details, permission nodes, deployment notes, audit findings, and developer jargon in the research dossiers.
- Do not publish staff or administration commands, bug reports, draft notices, uncertainty reports, or unavailable workflows.
- Include every ordinary player command supported by the evidence. Omit commands that require an operator or an unconfirmed external grant.
- Keep real gameplay cautions, costs, cooldowns, item consumption, death effects, and irreversible choices.
- Do not use em dash characters or em dash HTML or JavaScript escapes. Use a comma, colon, parentheses, or a full stop. Use `N/A` or `None` for an empty table value.
- `WikiPage` displays an `Updated` date. Use the optional `lastModified` prop for a page-specific revision; otherwise the maintained `WIKI_LAST_MODIFIED` date is used.
- Cards and callouts use a uniform neutral border. Do not add a coloured left border.
- Use `SeeAlso` only with registered, existing player pages.

## Add a section

Create one module under `app/wiki/data`, export a `WikiSection`, add it exactly once to `data/registry.ts`, and export its data module from `data/index.ts`. Registration supplies the sidebar, overview, recipes, and command index.

```ts
import type { WikiSection } from "./types";

export const beekeepingSection: WikiSection = {
  nav: {
    href: "/wiki/beekeeping",
    label: "Beekeeping",
    category: "gathering",
    blurb: "Raise bees and turn honeycomb into useful materials.",
  },
};
```

Create `app/wiki/beekeeping/page.tsx` with the shared authoring kit:

```tsx
import { Callout, DataTable, SeeAlso, StatGrid, WikiPage, WikiSectionHeading } from "@/app/components/wiki";

export default function BeekeepingPage() {
  return (
    <WikiPage title="Beekeeping" intro="Raise bees and collect honey." lastModified="2026-09-11">
      <WikiSectionHeading id="start" intro="What you need before your first hive.">Getting started</WikiSectionHeading>
      {/* Concrete steps and reference data */}
      <SeeAlso hrefs={["/wiki/materials"]} />
    </WikiPage>
  );
}
```

Use the public barrel at `@/app/components/wiki` for `Callout`, `CommandTable`, `DataTable`, `ItemChip`, `SeeAlso`, `StatGrid`, `WikiPage`, and `WikiSectionHeading`. Import the client-only 3D viewers and instrument keyboard directly from their files.

## Commands

Store command rows in the section data and pass the same rows to `CommandTable`. The command index derives its rows from the registry. `CommandTable` displays only rows whose `access` is omitted or is `player`; permission-gated rows remain internal data and never render.

```ts
export const beekeepingCommands: WikiCommandSet = {
  system: "Beekeeping",
  href: "/wiki/beekeeping",
  commands: [
    {
      command: "/hives",
      description: "Lists your hives.",
    },
  ],
};
```

Set the `WikiCommandSet.commands` array to `[]` when the feature has no player command and interaction happens through blocks, items, or menus. Never invent a command.

## Recipes and assets

Recipes registered on a section join `allRecipes`, which supplies station pages and material usage lists. Use the helpers from `@/app/wiki/data`:

| Helper | Result | Use |
|---|---|---|
| `T("materials/coke.png")` | `/wiki/textures/materials/coke.png` | Wiki textures |
| `V("diamond.png")` | `/wiki/textures/vanilla/diamond.png` | Vanilla textures |
| `M("alchemy-station.json")` | `/wiki/models/alchemy-station.json` | Wiki models |
| `empty` | Empty crafting slot | Crafting grids |
| `slugify(name)` | URL-safe slug | Detail links |

Place referenced assets under `frontend/public/wiki`. Ingredient and station links depend on exact names, so reuse the registered names.

Source artwork that the site does not serve stays outside `public/`. The ammunition sprite source is `frontend/assets/wiki/ammo_sheet.png`; the wiki serves the cut 16×16 icons from `frontend/public/wiki/textures/ammunition/`. The grindstone station page renders `models/vanilla/grindstone.json` with the vanilla `grindstone_*` textures under `textures/vanilla/`. The `models/stations/grindstone.json` model and `textures/stations/grindstone/` textures are kept in the repository but are not referenced by the wiki data.

## Validation

From `frontend/`, run `npm run lint`, `npm run format:check`, `npm test` and `npx tsc --noEmit --pretty false`, then the guarded production build with `PS_PRODUCTION=1 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run build`. Check every `SeeAlso` target, every top-level wiki route, dynamic detail routes, referenced assets, visible command filtering, and a rendered-output scan for prohibited player-facing copy. Verify the desktop sidebar has its own bounded vertical scroll and that smaller layouts retain normal page flow.
