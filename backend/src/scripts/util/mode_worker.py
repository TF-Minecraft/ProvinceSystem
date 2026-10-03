"""Picklable per-mode worker for parallel fullregen."""

from __future__ import annotations

import sys
import time


def run_mode(map_name: str, mode: str, full_regions: bool) -> dict:
    """Run map + region generation for one political mode.

    Each worker loads its own geometry cache (isolated process).
    Returns timing data for merge into the parent _RegenTimings.
    """
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    from ..mapgen.geometry_cache import MapGeometryCache
    from ..mapgen.infrastructuregen import create_infrastructure_map
    from ..mapgen.mapgen import create_map
    from ..mapgen.prosperitygen import create_prosperity_map
    from ..mapgen.regiongen import generate_regions

    start = time.perf_counter()
    steps: dict[str, float] = {}

    print(f"🛠️ [{map_name}] Processing mode: {mode} (worker)")

    cache_start = time.perf_counter()
    cache = MapGeometryCache.load(map_name)
    steps[f"{mode}.cache"] = time.perf_counter() - cache_start

    if mode == "trade":
        t0 = time.perf_counter()
        create_prosperity_map(map_name, "prosperity_map", cache=cache)
        steps[f"{mode}.prosperity"] = time.perf_counter() - t0
        t0 = time.perf_counter()
        create_infrastructure_map(map_name, "infrastructure_map", cache=cache)
        steps[f"{mode}.infrastructure"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    create_map(map_name, mode, f"{mode}_map", False, cache=cache)
    steps[f"{mode}.map"] = time.perf_counter() - t0
    print(f"🗺️ [{map_name}] Map generated for {mode}")

    t0 = time.perf_counter()
    generate_regions(
        map_name,
        mode,
        # Every mode, trade included; see regeneration._run_mode_serial.
        borders=True,
        queued_regen=(not full_regions and mode != "trade"),
        cache=cache,
    )
    steps[f"{mode}.regions"] = time.perf_counter() - t0
    print(f"🎨 [{map_name}] Regions generated for {mode}")

    return {
        "mode": mode,
        "elapsed_s": time.perf_counter() - start,
        "steps": steps,
    }
