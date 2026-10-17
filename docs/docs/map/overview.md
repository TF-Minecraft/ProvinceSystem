# Map platform overview

Turn the live political map from flat colour blobs into a **fantasy cartography product**: parchment terrain, muted realm overlays, nation labels, rich nation popups, settlements and forts, war layers, daily chronicle snapshots, and wealth analytics - while staying fast on desktop and mobile.

**Repos:** TFMCWeb (FE + BE mapgen) · SimpleFactions (export + upload) · TFMCWeb (staff map gate)

**Technical refs:** [generation.md](generation.md) · [viewer.md](viewer.md) · [title-editor.md](title-editor.md) · [wars-on-map.md](wars-on-map.md)

## Goals

| Area | Status |
|------|--------|
| Fast refined layout, click modal, drill-down, cropped overlays, mobile | Shipped |
| Xaero world map → colour base + ink parchment washes | Shipped |
| Fantasy muted nation overlays | Shipped |
| Nation / title / trade labels; terrain/fertility/trade/prosperity/infestation modes | Shipped |
| Pan and zoom (wheel + middle-mouse pan, clamped bounds) | Shipped |
| Staff-only maps (configurable per `mapId`) | Shipped |
| Named capitals / guild settlements | Shipped |
| Forts + zone of control | Shipped |
| Wars: campaign route line + battle pins | Shipped |
| Wars: occupier nation fill (`occupied_by`) | Shipped |
| Daily map snapshots (chronicle) | Shipped |
| Nation / global wealth charts over time ([ledger.md](ledger.md)) | Shipped |
| Staff web map title editor (county → empire) | Shipped |

## Architecture

```mermaid
flowchart TD
  subgraph inputs [Inputs]
    Xaero[map.png Xaero plain background]
    Prov[provinces.png]
    SF[SimpleFactions JSON upload]
  end
  subgraph backend [TFMCWeb backend]
    Parch[parchment_base generator]
    Political[political layers muted fills borders]
    Labels[label layer frontend SVG]
    Markers[capitals forts war overlays]
    Pick[pick-safe reference layer]
    Chronicle[daily snapshot plus event log]
    Analytics[wealth time series]
  end
  subgraph frontend [Next.js map]
    Canvas[pan zoom layer compositor]
    Panel[nation modal drill]
    Charts[wealth charts optional route]
  end
  Xaero --> Parch
  Prov --> Political
  Prov --> Pick
  SF --> Markers
  SF --> Analytics
  Political --> Canvas
  Parch --> Canvas
  Labels --> Canvas
  Markers --> Canvas
  Pick --> Canvas
  Panel --> Canvas
  Analytics --> Charts
```

### Layer model

| Layer | Source | Purpose |
|-------|--------|---------|
| `parchment_base` | `input/{map}/map.png` + grade/texture → `output/.../parchment_base.png` | Terrain backdrop |
| `political_{mode}` | `provinces.png` + nation defines | Desaturated fills, borders, hover |
| `labels_{mode}` | Province graph + nation names (frontend SVG) | Straight text per contiguous blob |
| `markers` | SF export (`capitals`, `forts`, …) | Town/fort icons |
| `war_{id}` | SF war export | Campaign line, battle pins, occupier fill |
| `pick_{mode}` | Raw RGB map (`apply_overrides=False`) | Hit-testing only; never styled away |

Pick layer must stay separate from display (see [`mapgen.py`](../../../backend/src/scripts/mapgen/mapgen.py) `apply_overrides=False` rule) so vassal pixels remain selectable.

## Locked product rules

| Rule | Choice |
|------|--------|
| Grid alignment | `map.png` and `provinces.png` share the same pixel grid per `mapId` |
| Nation colour | Desaturated/dulled vs raw `rgb` in nation.json; parchment masked interior optional |
| Interaction | **Click** → nation detail modal; **Ctrl+click** (Cmd on Mac) → drill into subjects; mobile: tap + explicit drill |
| Staff maps | Gated by profile Bearer session + `permission_flags["tfmc.map.staff"]` from TFMCWeb/LP sync; `public` vs staff per map in PS `maps.yml` + SF `mapRef` |
| SF export | Draft schema: [`map-export-schema.json`](../assets/map-export-schema.json) |
| Wars | **Do not infer** frontlines from territory diffs alone; require SF war export ([`WarMapExporter.java`](https://github.com/TF-Minecraft/SimpleFactions/blob/main/src/main/java/net/tfminecraft/simplefactions/map/export/WarMapExporter.java)) |
| Chronicle | Daily composited snapshot + structured event log (prefer SF-emitted events over pure JSON diff) |
| Wealth history | Ledger series from the SF `chronicle` upload ([ledger.md](ledger.md)) |

## SimpleFactions contract (summary)

Nation upload (`nation.json`) already carries `balance`, `provinces`, `relations`, etc. Extensions for map platform:

- `capitals` - faction + guild named capitals with province id and map pixel coords
- `settlements` - guild towns beyond distance threshold from faction capital
- `forts` - fort id, province, ZOC province list
- `wars` - belligerents, campaign route slice, battle schedule pins, `occupied_by_*` lists
- `province_data.occupied_by` - occupier faction id for nation-overlay remap
- `events` - explicit chronicle events (war declared, province taken, capital moved, …)
- `global_wealth` - optional aggregate for charts

Capitals must be **named in-game** via SF (`setcapital` / guild capital rules) before they appear on the web map.

Full SF ↔ API pipeline: [integrations/simplefactions.md](../integrations/simplefactions.md).

## Success criteria (map platform MVP)

- Parchment terrain + muted nations readable on desktop and phone
- Click nation → modal with size, subjects, culture, relations, wealth
- `main` public; staff maps hidden without permission
- Named capitals visible when SF exports them
- Daily map snapshots stored
- Nation wealth chart over season ([ledger.md](ledger.md))

Operator checklists: [STAGING.md](../../STAGING.md).

## Out of scope (v1)

- Vector / WebGL map engine rewrite
- Auto-generated oversimplified animation video
- Rewriting mapgen in another language
