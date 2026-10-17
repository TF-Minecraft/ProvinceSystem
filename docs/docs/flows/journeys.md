# End-to-end journeys

Master journeys across the full TFMC platform. Detail docs: [integrations/simplefactions.md](../integrations/simplefactions.md) map, [cosmetics/skins.md](../cosmetics/skins.md) / [integrations/armourshop.md](../integrations/armourshop.md) / [integrations/discord-bot.md](../integrations/discord-bot.md) skins and bot.

## Platform overview

```mermaid
flowchart TB
  subgraph web [TFMCWeb]
    Hub[Hub_and_Map]
    SkinsUI[Skins_UI]
    API[FastAPI]
  end
  subgraph mc [Minecraft]
    SF[SimpleFactions]
    TW[TFMCWebBridge]
    AS[ArmourShop]
    IA[ItemsAdder_tfmc_submissions]
  end
  subgraph disc [tfmc_bot]
    SkinsCog[Skins_review]
    BanCog[Ban_warn_roles]
  end
  SF -->|upload_regen| API
  Hub --> API
  SkinsUI --> API
  TW -->|codes| API
  AS -->|pull_via_TFMCWeb| API
  API --> SkinsCog
  SkinsCog -->|approve_deny| API
  AS --> IA
  BanCog -.->|Discord_only| PlayersDisc[Discord_users]
```

---

## Flow 1 - Map border update

**Actors:** Player/staff on MC, SimpleFactions, TFMCWeb, website visitors.

| Step | Who | What |
|------|-----|------|
| 1 | Gameplay | Nation claims change |
| 2 | SimpleFactions | Enqueue affected region RGB; persist nation JSON |
| 3 | SimpleFactions | `POST /{map}/data/upload/…` via TFMCWeb `ProvinceSystemGateway` (nation, queue, `map_markers`, …) |
| 4 | SimpleFactions | `GET /{map}/{key}/api/regenerate/…` via gateway |
| 5 | TFMCWeb | Compile + mapgen + regiongen → `output/{map}/` |
| 6 | Visitor | Opens `/map/{mapId}`; loads mapdata, regions, defines JSON |
| 7 | Visitor | Hover/drill-down on MapViewer; settlement pins on political modes when zoomed in |

**Failure modes:** wrong `mapRef`; empty `output/`; regen lock; stale CDN/browser cache (API FileResponse).

**Local without SF:** seed input/defines + manual fullregen ([ops/local-dev.md](../ops/local-dev.md)).

---

## Flow 2 - Skin submission to usable cosmetic

**Actors:** Donator, TFMCWeb, ArmourShop, website, Discord staff, ItemsAdder, LuckPerms.

| Step | Who | What |
|------|-----|------|
| 0a | Donator | In-game TFMCWeb `/linkdiscord` → one-time code |
| 0b | Donator | Discord `/linkdiscord <code>` → UUID ↔ Discord id linked |
| 1 | Donator | Profile Skins tab: **New skin** (`POST /profile/skins/start`; refused if rank disallowed or on cooldown). Or in game: `/token create skin` (perm `tfmcweb.token.create`; TFMCWeb applies the same rank and cooldown) |
| 2 | TFMCWeb | For a code: `POST /skins/codes` scope=skin; shows plaintext once (**click-to-copy**) |
| 3 | Donator | The editor opens in the Skins tab (`/profile?tab=skins&skin=new`) with the session (includes `skin_kinds` + `allow_armor_3d_helmet`); a code is redeemed first under the Skins tab's Use a code or at Profile sign-in |
| 4 | Donator | KindPicker filtered by rank; picks **`base_set`**; grip for large; **Item name**; uploads PNGs per [cosmetics/naming.md](../cosmetics/naming.md) |
| 5 | API | Requires Discord link; validates kind whitelist, naming, sizes, `base_set`↔kind; stores fixed stems + `discord_user_id`; status `pending`; enqueues submitted notify |
| 5b | tfmc_bot | DM player: submission received |
| 6 | tfmc_bot | Skins cog posts review embed to `#bot-feed` **with raw submission PNGs** (+ kind / `base_set` / grip) |
| 7 | Staff | Approve or Deny (+ reason) from visuals |
| 8 | API | Status `approved` / denied (deny purges row) |
| 8b | tfmc_bot | DM player: approved, or denied + reason |
| 9 | ArmourShop | Pulls approved; writes `tfmc_submissions`; shop set in `ps_armor` / `ps_items` with `set: {base_set}`; LP `armourshop.submission.{slug}` |
| 10 | ArmourShop | Deferred IA reload when safe; ack `applied` |
| 11 | Donator | Opens ArmourShop; sees set; applies onto matching BaseSet gear |

**Failure modes:** not Discord-linked; rank cannot mint / shared skin↔drink cooldown (TFMCWeb); kind not allowed for rank; armor 3D helmet without entitlement; bad item name / id; wrong pixel size; incomplete armor slots; bad/missing `base_set`; Discord double-approve; closed DMs (review still works); reload while players online; LP missing so shop hides set; wrong BaseSet gear in inventory so apply finds nothing.

---

## Flow 2b - Staff curated skin (no Discord review)

**Actors:** Staff, TFMCWeb, website, ArmourShop, ItemsAdder.

| Step | Who | What |
|------|-----|------|
| 0 | ArmourShop | On load: sync categories + skin-set keys + scrolls → API |
| 1 | Staff | `/token create skin staff` → redeem on Profile (sign-in or the Skins tab's Use a code) |
| 2 | Staff | Same kind upload + **category** + **scroll** dropdowns |
| 3 | API | Auto-approve (no bot / pending) |
| 4 | ArmourShop | Pull → write **`tfmc_armorshop`** + upsert chosen category YAML with scroll |
| 5 | Staff/players | Apply via ArmourShop using scroll (not submission LP) |

---

## Flow 2c - Donator drink (BreweryX)

**Status:** Code **shipped**. Human verify: [STAGING.md](../../STAGING.md).

**Actors:** Donator, TFMCWeb, DrinkBuilder, website, Discord staff, ItemsAdder, BreweryX.

| Step | Who | What |
|------|-----|------|
| 1 | Donator | Profile Drinks tab: **New drink**, or `/token create drink` (shared cooldown with skin) |
| 2 | Donator | The brew form opens in the Drinks tab (`/profile?tab=drinks&drink=new`; a code is redeemed first); fill brew form; Noble color-only / Gilded+ texture or reuse |
| 3 | API | Validate ingredients allowlist + effects blacklist; store pending |
| 4 | Bot | Review embed + sheet; Approve/Deny |
| 5 | DrinkBuilder | If texture: write `tfmc_drinks` CMD; merge `recipes.yml`; Brewery reload |
| 6 | Donator | Brew in-game |

**Playbook:** [cosmetics/drinks.md](../cosmetics/drinks.md)

---

## Flow 3 - Staff Discord ban notify + role mute

**Actors:** Staff, TFMCWeb, Essentials (or CE), tfmc_bot, Discord user.

| Step | Who | What |
|------|-----|------|
| 1 | Staff | Ban in-game: Essentials `/tempban` / `/ban` (or CE `/tfmc ban`) |
| 2 | TFMCWeb | Listens → enqueues moderation outbox (linked Discord id) |
| 3 | Bot | Polls outbox → DM user → staff log → add **Banned** role (`BANNED_ROLE_ID`) |
| 4 | Discord | Role denies speak in configured channels |
| 5 | Staff | In-game `/unban` → TFMCWeb → bot clears Banned role (no player DM) |

**Manual fallback:** Discord `/minecraftban` / `/minecraftunban` / `/minecraftwarn` still work without the MC mirror.

**Warn:** TFMCWeb `/warning` → in-game chat (if online) + store + bot DM + log. Unlinked: store only.

**Non-goal:** bot does not execute MC bans.

---

## Flow 4 - Map chronicle

Daily map timelapse snapshots and economy ledger charts: [map/ledger.md](../map/ledger.md).

---

## Flow map (skins + map together)

```mermaid
sequenceDiagram
  participant Donator
  participant TW as TFMCWeb
  participant SF as SimpleFactions
  participant API as TFMCWeb
  participant Web
  participant Bot as tfmc_bot

  Note over SF,Web: Map path independent
  SF->>API: upload and regen
  Web->>API: fetch map assets

  Note over Donator,Bot: Skins path
  Donator->>TW: /token create skin
  TW->>API: issue code
  Donator->>Web: redeem and upload
  Web->>API: submission
  API->>Bot: pending
  Bot->>API: approve
  Note over API: ArmourShop pulls approved
```

---

## Definition of done (platform MVP)

- Flow 1 works on live map; map platform delivers parchment UX, modals, settlements, forts, chronicle and wealth charts.
- Flow 2 works for all enabled skin kinds with Discord approve and ArmourShop apply.
- Flow 3 DM/log + **Banned role add/clear** shipped.
- Naming enforced on Flow 2.
- Local testing possible for API/UI without Paper ([ops/local-dev.md](../ops/local-dev.md)).
