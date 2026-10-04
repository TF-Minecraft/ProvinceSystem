"""Pre-build the WebP copies of the base map images.

The API falls back to the original PNG whenever no fresh WebP exists, so the
site stays correct without this — visitors just pay the full PNG until the
background encode finishes. Run this after a map regen to skip that window.

    python -m scripts.tools.warm_map_webp            # every map
    python -m scripts.tools.warm_map_webp --map main
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from ..util.dirs import INPUT_DIR, input_file

try:
    # Imported as part of the `src` package (server / regeneration).
    from ...api.webp_cache import cache_path_for, webp_variant
except ImportError:
    # Run as a CLI from backend/src, where `src` is not a package root.
    from api.webp_cache import cache_path_for, webp_variant


def webp_warm_sources(map_name: str) -> list[str]:
    """Base images this map warms. Public so regeneration can stamp them."""
    candidates = [input_file(map_name, "map.png")]
    return [path for path in candidates if os.path.isfile(path)]


def _discover_maps() -> list[str]:
    if not os.path.isdir(INPUT_DIR):
        return []
    return sorted(
        name
        for name in os.listdir(INPUT_DIR)
        if os.path.isdir(os.path.join(INPUT_DIR, name))
    )


def warm(map_names: list[str]) -> int:
    built = 0
    for map_name in map_names:
        sources = webp_warm_sources(map_name)
        if not sources:
            print(f"[{map_name}] no base map image, skipping")
            continue

        for source in sources:
            target = cache_path_for(source)
            started = time.time()
            # background=False encodes inline and returns the finished file.
            webp_variant(source, accept="image/webp", background=False)
            size_mb = target.stat().st_size / 1e6
            original_mb = os.path.getsize(source) / 1e6
            print(
                f"[{map_name}] {os.path.basename(source)}: "
                f"{original_mb:.1f} MB -> {size_mb:.1f} MB "
                f"in {time.time() - started:.0f}s"
            )
            built += 1
    return built


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--map", dest="map_name", help="only this map")
    args = parser.parse_args()

    map_names = [args.map_name] if args.map_name else _discover_maps()
    if not map_names:
        print("No maps found.")
        return 1

    built = warm(map_names)
    print(f"Done. {built} image(s) encoded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
