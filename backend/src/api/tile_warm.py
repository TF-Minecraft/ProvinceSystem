"""Queue tile builds after map regeneration.

Without warming, the first reader after each regeneration triggers the
pyramid and region-composite builds, then waits for fresh tiles or uses the
full-size image if the source has never been tiled. Prosperity regenerates
after every trade update, every few minutes on the live map, so most readers
would encounter this delay.

Warming starts the builds before a viewer requests the mode, so they are
ready or under way when it opens. Current sources return immediately without
rebuilding.
"""

from __future__ import annotations

from pathlib import Path

from ..scripts.util.dirs import input_file, map_image
from ..scripts.util.regen_types import MODES as REGION_MODES
from . import region_composite, tile_cache

# The full-map rasters the viewer tiles as `mapdata-{mode}`, except the
# province map, which is the unchanging input pick map (see file_routes).
RASTER_MODES = ("terrain", "fertility", "prosperity", "infestation")


def warm_map_tiles(map_name: str) -> None:
    """Queue background builds for every tiled layer of `map_name` that is
    out of date. Returns at once; the builds run one at a time."""
    # Warm the satellite input too, so the first visitor need not trigger it.
    # Queue without hashing on the caller; even the source check can decode a
    # full raster after a rewrite, and regeneration also calls this from CLI.
    base = Path(input_file(map_name, "map.png"))
    if base.is_file():
        tile_cache.warm_source(base)
    sources = [Path(input_file(map_name, "provinces.png"))]
    sources.extend(Path(map_image(map_name, mode)) for mode in (*REGION_MODES, *RASTER_MODES))
    for source in sources:
        if source.is_file():
            is_raster = source.name == "provinces.png" or any(
                source.name == f"{mode}_map.png" for mode in RASTER_MODES
            )
            tile_cache.warm_source(source, warm_pick=True, tiles=is_raster)
    for mode in REGION_MODES:
        if region_composite.has_inputs(map_name, mode):
            region_composite.ready_composite(map_name, mode)
