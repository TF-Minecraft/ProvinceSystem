"""Start a map's tile builds as soon as a regeneration has redrawn it.

`tile_cache` and `region_composite` build a pyramid when one is first asked
for, so the first reader after every regeneration waited on the build (or, for
a map that had never been tiled, got the full-size image). Prosperity follows
every trade update, every few minutes on the live map, so that was most
readers. Starting the builds here instead has them ready, or under way, by
the time anyone opens the mode; anything already current returns at once.
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
    sources = [Path(map_image(map_name, mode)) for mode in RASTER_MODES]
    sources.append(Path(input_file(map_name, "provinces.png")))
    for source in sources:
        if source.is_file():
            tile_cache.ready_manifest(source)
    for mode in REGION_MODES:
        if region_composite.has_inputs(map_name, mode):
            region_composite.ready_composite(map_name, mode)
