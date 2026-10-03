import json
import math
import os

from ..loader.provinces import load_provinces
from ..loader.province_metadata import load_province_metadata
from ..util.dirs import input_file, validate_map
from .geometry_cache import MapGeometryCache
from .map_paint_numpy import (
    load_provinces_array,
    paint_from_rgb_lut,
    rgba_array_to_image,
)


INFRASTRUCTURE_TERRAIN_MIN = 0.30
INFRASTRUCTURE_TERRAIN_MAX = 0.75
INFRASTRUCTURE_COLOR_STOPS = (
    (244, 160, 160),
    (140, 70, 170),
    (20, 40, 120),
)
INFRASTRUCTURE_ALPHA = 200
SKIP_TERRAINS = {"water", "sea"}


def infrastructure_to_color(value: float) -> tuple[int, int, int] | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        if not math.isfinite(value):
            return None
    except OverflowError:
        return None
    t = max(
        0.0,
        min(
            1.0,
            (value - INFRASTRUCTURE_TERRAIN_MIN)
            / (INFRASTRUCTURE_TERRAIN_MAX - INFRASTRUCTURE_TERRAIN_MIN),
        ),
    )
    stops = INFRASTRUCTURE_COLOR_STOPS
    if t <= 0.5:
        first, second, fraction = stops[0], stops[1], t * 2
    else:
        first, second, fraction = stops[1], stops[2], (t - 0.5) * 2
    return tuple(
        math.floor(a + (b - a) * fraction + 0.5)
        for a, b in zip(first, second)
    )


def create_infrastructure_map(
    map_name: str,
    filename: str = "infrastructure",
    cache: MapGeometryCache | None = None,
):
    validate_map(map_name)

    province_rgb_to_id = load_provinces(map_name)
    province_meta = load_province_metadata(map_name)
    try:
        with open(input_file(map_name, "province_data.json"), "r") as f:
            province_data = json.load(f)
    except (OSError, json.JSONDecodeError):
        province_data = []
    if not isinstance(province_data, list):
        province_data = []

    province_by_id = {
        p.get("id"): p
        for p in province_data
        if isinstance(p, dict) and isinstance(p.get("id"), (int, str))
    }
    rgb_to_rgba = {}

    for rgb, pid in province_rgb_to_id.items():
        meta = province_meta.get(pid)
        if not isinstance(meta, dict) or meta.get("terrain") in SKIP_TERRAINS:
            continue
        row = province_by_id.get(pid)
        if row is None:
            row = province_by_id.get(str(pid))
        if not isinstance(row, dict):
            continue
        color = infrastructure_to_color(row.get("effective_terrain"))
        if color is not None:
            rgb_to_rgba[rgb] = (*color, INFRASTRUCTURE_ALPHA)

    provinces = (
        cache.provinces_rgba
        if cache is not None
        else load_provinces_array(input_file(map_name, "provinces.png"))
    )
    painted = paint_from_rgb_lut(provinces, rgb_to_rgba, skip_black=False)
    painted_pixels = int((painted[:, :, 3] > 0).sum())
    output_path = os.path.abspath(
        os.path.join(
            os.path.dirname(input_file(map_name, "dummy")),
            "..", "..", "output", map_name, "maps", f"{filename}.png"
        )
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    rgba_array_to_image(painted).save(output_path, "PNG")
    print(f"🛠 Infrastructure map generated → {output_path} | painted={painted_pixels:,}")
