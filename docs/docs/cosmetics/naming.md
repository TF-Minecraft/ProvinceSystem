# Naming conventions

Players enter an **Item name** (ArmourShop label). The technical submission id is derived by the **API** from the player's linked **Minecraft IGN** plus the item name - never from upload filenames and never a random UUID.

Style locked: **`lowercase_snake_case`** (same family as `tfmc_armor` ids like `forestman_chain_helmet`).

## Two names per submission

| Field | Used for | Who sets it |
|-------|----------|-------------|
| **Item name** (`display_name`) | ArmourShop label, IA display, Discord title | Player / staff types it (spaces/capitals OK) |
| **Submission id** (`id` == `slug`) | Disk / IA / shop / LP / delete / tab-complete | API builds it (see lanes below) |

### Player lane

API builds `{sanitized_ign}_{slugify(display_name)}` from the linked Minecraft IGN plus item name. Do not ask players for a "slug" or an id. Staff Discord embeds show the human id directly (e.g. `drefvelin_blue_knight`), plus Minecraft/Discord names - never a UUID.

### Staff lane (curated shop skins)

API builds **display-slug only**: `slugify(display_name)` (e.g. item name `Blue Levy` → `blue_levy`). No MC IGN prefix - the key must be unique in the target ArmourShop category (catalog `skin_sets` + active DB submissions). Collision → reject as invalid; choose a different item name. Pack namespace is `tfmc_armorshop`; delete via `/armourshop skin delete`.

## Submission id rules

- **IGN source (player only):** `discord_links.minecraft_name`, captured at submit time and sanitized to `[a-z0-9_]+` (lowercased, non-alnum runs collapsed to `_`, leading digit gets a `p_`/`skin_` guard, capped to 16 chars). Frozen into the id at creation.
- **Item name → slug fragment:** `slugify_display_name` lowercases, collapses separators to `_`, and caps length so the combined id fits the 48-char rule.
- **Player full id:** `{sanitized_ign}_{slugify(display_name)}`, e.g. IGN `Drefvelin` + item name `Blue Knight` → `drefvelin_blue_knight`.
- **Staff full id:** `slugify(display_name)` only.

### Skin id rules

- Base regex: `^[a-z][a-z0-9_]{1,47}$` (2-48 chars total). `assert_slug` separately rejects double underscores `__` and the reserved ids below.
- Must start with a letter; only `a-z`, `0-9`, `_`; no spaces, hyphens, capitals, dots, unicode, or leading `_`. A trailing `_` passes validation, though generated ids trim it.
- Must be unique among `pending` / `approved` / `applied` (`denied` / `revoked` may reuse).
- Same player cannot submit another **active** skin with the same **display_name** slug (case-insensitive).
- Reserved ids: `test`, `texture`, `null`, `undefined`, `admin`, `tfmc`, `new` (Profile's editor is `?tab=skins&skin=new`).

## Upload filenames (ignored for identity)

Filenames are **freeform** - the API only validates PNG magic bytes, max size, and exact pixel dimensions per slot. Server-side stems always come from the submission id (and tier, for armor).

### `armor_set` (multi-tier)

One submission holds **1-6 tiers** from the allowlist `iron | steel | abyssalite | mythril | mage | infantry`. Each tier needs all six multipart fields: `{tier}_helmet`, `{tier}_chestplate`, `{tier}_leggings`, `{tier}_boots`, `{tier}_layer_1`, `{tier}_layer_2`.

Plus a form field `tiers` - a JSON array, e.g. `["iron","steel"]`. Exact sizes: icons **16×16**; layers **64×32**. Every PNG in a submission must have distinct upload bytes (SHA-256).

*Legacy single-tier path:* unprefixed fields plus `base_set` still accepted for backward compatibility.

### `handheld` / `large_handheld`

One `texture` field. Sizes: `handheld` **16×16**; `large_handheld` **32×32**. `large_handheld` also requires `grip_preset` (`bottom` | `middle` | `top`).

### `bow` / `large_bow` / `crossbow`

Fields `texture`, `pull_0`, `pull_1`, `pull_2` (bow four + `charged` for crossbow). Sizes: `bow` **16×16**; `large_bow` **32×32**.

### `item_3d` / `shield` / `helmet_3d` / `mask` / `gun`

Multipart `texture` + model JSON(s). Combined texture+JSON pair byte budget from ArmourShop `permission-groups.yml`. Shield blocking model is **not** uploaded (ArmourShop clones at apply).

### `book`

Multipart `unsigned` + `signed`, both **16×16**, `base_set: books`.

All enabled non-armor kinds also require **`base_set`** (ArmourShop BaseSet id filtered by kind). Armor uses `tiers` instead of `base_set`.

## ItemsAdder / ArmourShop mapping

| Use | Pattern |
|-----|---------|
| IA armor piece ids (per tier) | `{id}_{tier}_helmet`, … |
| IA `armors_rendering` key (per tier) | `{id}_{tier}` |
| IA item id (non-armor) | `{id}` |
| ArmourShop set key, armor (per tier) | `{id}_{tier}` |
| Gun shop item | `gunskin({id})` |
| LP permission (shared across tiers) | `armourshop.submission.{id}` |

## Player-facing copy (examples)

> Item name: what ArmourShop shows (e.g. Blue Knight).
> Upload any PNG file - the name doesn't matter, just make sure it's the right size for that slot.

## Name colours vs Apply name

- **`name_colours` / `name_styles`** - how the SkinSet display name looks in ArmourShop. Independent of apply-name.
- **`add_name`** - when applying the skin in-game, keep the base item's existing name on the skinned piece. Does **not** gate colours.
