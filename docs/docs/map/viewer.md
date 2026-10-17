# Map viewer (performance and UX)

Product goals: [overview.md](overview.md).

## Cropped overlays

[`regiongen.py`](../../../backend/src/scripts/mapgen/regiongen.py) saves each region PNG (and its `_hover`, `_nested` and `_nested_hover` variants) cropped to its painted pixels with 2 px padding. The crop boxes (`x`, `y`, `w`, `h`, keyed by `r,g,b`) go to `output/{map}/regions/{mode}/overlays.json`; queued regen merges boxes for the regions it touched, fullregen replaces the file. Data routes join each box onto its region as `overlay` / `overlay_nested`, and [`overlayStyle.ts`](../../../frontend/app/components/map/overlayStyle.ts) positions the PNG with percentages of the base map size. A region without a box is not drawn. [`file_routes.py`](../../../backend/src/api/file_routes.py) serves files by name.

## Pan and zoom

Desktop pan/zoom on `/map/{id}`:

- Wheel zoom toward cursor
- Middle-mouse pan
- Clamped bounds

## Hover / lookup performance

Keep **one** full-resolution lookup surface (the existing mapdata canvas). Nation hover: [`useRegionHover.ts`](../../../frontend/app/hooks/useRegionHover.ts); province modes: [`useProvinceHover.ts`](../../../frontend/app/hooks/useProvinceHover.ts).

Live map assets (pick PNGs, region overlays, banners, ZOC, and defines JSON such as `nation.json`) revalidate with ETag (`private, no-cache`) and CORS on the file response so a 304 can still be drawn onto the pick canvas. If a reverse proxy uses `proxy_cache`, it must honour origin `Cache-Control`. After deploy, users who already cached an old PNG may need one hard reload.

## Drill-down and nesting

- Independent nations: visible cropped bases.
- Drill-down: hide parent base, show `_nested` + subject crops.
- Hover: only the active visible layer's `_hover` crop.
