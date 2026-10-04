import os
import time

from ..util.colour_mapping import build_color_mapping
from ..util.dirs import input_file, validate_map
from .geometry_cache import MapGeometryCache
from .map_paint_numpy import (
    load_provinces_array,
    paint_from_province_id_lut,
    paint_from_rgb_lut,
    rgba_array_to_image,
)


def create_map(
    map_name: str,
    mode: str,
    filename: str,
    cache: MapGeometryCache | None = None,
):
    """Paint a pick map with each region's raw RGB.

    Vassals retain their own colours so picking can distinguish them from
    overlords. Display washes and borders belong to the region overlays.
    """
    start_time = time.perf_counter()
    validate_map(map_name)

    province_to_color = build_color_mapping(map_name, mode)

    if cache is not None:
        provinces = cache.provinces_rgba
    else:
        provinces = load_provinces_array(input_file(map_name, "provinces.png"))

    # --------------------------------------------------------------
    # Output path
    # --------------------------------------------------------------
    output_path = os.path.abspath(
        os.path.join(
            os.path.dirname(input_file(map_name, "dummy")),
            "..", "..", "output", map_name, "maps", f"{filename}.png"
        )
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # --------------------------------------------------------------
    # Empty mapping → transparent output
    # --------------------------------------------------------------
    if not province_to_color:
        if cache is not None:
            painted = paint_from_province_id_lut(
                cache.province_id_map,
                cache.rgb_to_id,
                {},
            )
        else:
            painted = paint_from_rgb_lut(provinces, {})
        rgba_array_to_image(painted).save(output_path, "PNG")
        print(f"🗺️ Empty map generated → {output_path}")
        return

    if cache is not None:
        painted = paint_from_province_id_lut(
            cache.province_id_map,
            cache.rgb_to_id,
            province_to_color,
            skip_black=True,
        )
    else:
        painted = paint_from_rgb_lut(
            provinces,
            province_to_color,
            skip_black=True,
        )
    out = rgba_array_to_image(painted)

    # --------------------------------------------------------------
    # Save output
    # --------------------------------------------------------------
    out.save(output_path, "PNG")

    elapsed = time.perf_counter() - start_time
    print(
        f"🗺️ Map generated for '{map_name}' "
        f"(mode={mode}) "
        f"in {elapsed:.2f}s → {output_path}"
    )
