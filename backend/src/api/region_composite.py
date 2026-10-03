"""One full-map image of a mode's region overlays, as the viewer first shows it.

A region mode (realms, counties, duchies, ...) is drawn from one cropped PNG
per region. Switching to a mode meant fetching and decoding every one of them —
85 for counties — before the map had colour, while the labels, which come with
the region data, were already on screen.

This flattens the overlays the viewer shows by default into a single image so
it can be tiled like the base map (`tile_cache`): a mode switch then costs the
handful of tiles on screen. The default view is every region with an `rgb`, no
`overlord` (subjects open only on drill-down) and, on the realm map, at least
one province — the same rules as the frontend's `filterMapModeRegions` and
`initialMapObjectVisibility`. Drilled-in layouts still use the separate PNGs.

The composite is versioned by the mtimes of its inputs: the mode's defines
JSON, which says who is visible, and the overlay sidecar, which regen rewrites
whenever it redraws a region.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path

from ..scripts.util.dirs import defines_file, input_file, region_image, region_overlay_file
from ..scripts.util.overlay_metadata import load_overlay_metadata
from . import tile_cache

_COMPOSITE_DIR = Path(__file__).resolve().parent.parent / "output" / "_derived" / "composite"

# Bump when the way a composite is drawn changes, so existing ones rebuild.
_COMPOSITE_FORMAT = 2

_building: set[str] = set()
_building_lock = threading.Lock()


def _mtime_ns(path: str | os.PathLike[str]) -> int | None:
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


def _composite_dir(map_name: str, mode: str) -> Path:
    key = hashlib.sha1(f"{map_name}/{mode}".encode("utf-8"), usedforsecurity=False).hexdigest()
    return _COMPOSITE_DIR / key


def composite_path(map_name: str, mode: str) -> Path:
    """The mode's composite. One fixed path, so its tile pyramid replaces the
    previous version in place (see `tile_cache.build_pyramid`)."""
    return _composite_dir(map_name, mode) / "composite.png"


def _load_regions(map_name: str, mode: str) -> dict | None:
    try:
        with open(defines_file(map_name, f"{mode}.json"), encoding="utf-8") as f:
            regions = json.load(f)
    except (OSError, ValueError):
        return None
    return regions if isinstance(regions, dict) else None


def composite_version(map_name: str, mode: str) -> str | None:
    """Identity of what the composite would contain, or None with no inputs.

    Deliberately not the defines file's mtime: on a live map SimpleFactions
    rewrites it every few minutes with new wealth figures while who is visible
    stays the same. Only the visible set and the overlay images (regen rewrites
    the sidecar whenever it redraws them) change the picture.
    """
    overlays_mtime = _mtime_ns(region_overlay_file(map_name, mode))
    base_mtime = _mtime_ns(input_file(map_name, "map.png"))
    if overlays_mtime is None or base_mtime is None:
        return None
    regions = _load_regions(map_name, mode)
    if regions is None:
        return None
    visible = sorted(default_visible_regions(mode, regions))
    raw = json.dumps([_COMPOSITE_FORMAT, visible, overlays_mtime, base_mtime])
    return hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()


def _built_version(map_name: str, mode: str) -> str | None:
    try:
        return (_composite_dir(map_name, mode) / "composite.version").read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        return None


def default_visible_regions(mode: str, regions: dict) -> list[str]:
    """`rgb` strings of the regions the viewer shows before any drill-down."""
    visible = []
    for region in regions.values():
        if not isinstance(region, dict):
            continue
        rgb = region.get("rgb")
        if not isinstance(rgb, str):
            continue
        if region.get("overlord"):
            continue
        if mode == "nation":
            provinces = region.get("provinces")
            if not isinstance(provinces, list) or not provinces:
                continue
        visible.append(rgb)
    return visible


def build_composite(map_name: str, mode: str) -> Path | None:
    from PIL import Image

    version = composite_version(map_name, mode)
    if version is None:
        return None
    target = composite_path(map_name, mode)
    if target.is_file() and _built_version(map_name, mode) == version:
        return target

    regions = _load_regions(map_name, mode) or {}
    boxes = load_overlay_metadata(map_name, mode)

    with Image.open(input_file(map_name, "map.png")) as base:
        size = base.size
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))

    for rgb in default_visible_regions(mode, regions):
        # Sidecar entries are `{"overlay": {x, y, w, h}, "overlay_nested": ...}`,
        # the fields the data route merges onto each region.
        box = (boxes.get(rgb) or {}).get("overlay")
        if not isinstance(box, dict):
            continue
        png = region_image(map_name, mode, f"{rgb.replace(',', '_')}.png")
        try:
            with Image.open(png) as overlay:
                layer = overlay.convert("RGBA")
        except OSError:
            continue
        x, y = int(box.get("x", 0)), int(box.get("y", 0))
        canvas.alpha_composite(layer, dest=(max(0, x), max(0, y)))

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        # Fast, low compression: this file is read once, by the tiler.
        canvas.save(tmp, "PNG", compress_level=1)
        os.chmod(tmp, 0o644)
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    (target.parent / "composite.version").write_text(version, encoding="utf-8")
    return target


def _build_in_background(map_name: str, mode: str) -> None:
    key = f"{map_name}/{mode}"
    with _building_lock:
        if key in _building:
            return
        _building.add(key)

    def run() -> None:
        try:
            with tile_cache.BUILD_LOCK:
                composite = build_composite(map_name, mode)
                if composite is not None:
                    tile_cache.build_pyramid(composite)
        except Exception as exc:  # pragma: no cover - background best effort
            print(f"[tiles] composite build failed for {key}: {exc}")
        finally:
            with _building_lock:
                _building.discard(key)

    threading.Thread(target=run, name="region-composite", daemon=True).start()


def ready_composite(map_name: str, mode: str, *, background: bool = True) -> Path | None:
    """The composite, once its current version and tile pyramid are built.

    None while either is building (a build is started), and None without
    starting anything when the mode has no inputs.
    """
    version = composite_version(map_name, mode)
    if version is None:
        return None
    target = composite_path(map_name, mode)
    if (
        target.is_file()
        and _built_version(map_name, mode) == version
        and tile_cache.existing_manifest(target) is not None
    ):
        return target
    if background:
        _build_in_background(map_name, mode)
        return None
    with tile_cache.BUILD_LOCK:
        built = build_composite(map_name, mode)
        if built is not None:
            tile_cache.build_pyramid(built)
    return built


def latest_manifest(map_name: str, mode: str) -> dict | None:
    """The composite's current tile pyramid or, while a newer one is being
    built (`ready_composite` starts it), the last one finished. None only when
    no composite of this mode has been tiled yet."""
    target = composite_path(map_name, mode)
    if ready_composite(map_name, mode) is not None:
        return tile_cache.existing_manifest(target)
    return tile_cache.latest_manifest(target)


def has_inputs(map_name: str, mode: str) -> bool:
    return composite_version(map_name, mode) is not None
