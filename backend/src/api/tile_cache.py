"""Tile pyramids for full-map images, cached on disk.

The map page used to draw each full-map raster (the 6400x6400 satellite base,
the terrain/fertility/... mode maps) as one image. A browser has to decode the
whole thing — 41 megapixels — and decode it again at every new zoom scale,
even when the reader can see a twentieth of it. That decode is what made
zooming stutter.

This is what Google Maps does instead: cut the image into 256 px tiles at a
ladder of resolutions, each level half the size of the one above, so a client
only ever fetches and decodes the handful of tiles on screen, at the level
that matches its zoom.

Building a pyramid takes a few seconds, so it is never done inside a request.
A request either finds a ready pyramid for the source's current mtime or gets
"not ready" (the client keeps using the single image) while a background
thread builds it. Each build lives in a directory named after the source's
mtime, so a regenerated map invalidates itself and a reader never sees a
half-written level.

Tiles are lossy WebP: they are only ever drawn, never read back. The pick maps
the client reads pixel-by-pixel still come from the original PNG routes.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import tempfile
import threading
from pathlib import Path

TILE_SIZE = 256
_QUALITY = 80
_METHOD = 4

_ROUTER_DIR = Path(__file__).resolve().parent
_CACHE_DIR = _ROUTER_DIR.parent / "output" / "_derived" / "tiles"

_building: set[str] = set()
_building_lock = threading.Lock()


def _source_key(source: Path) -> str:
    return hashlib.sha1(
        str(source.resolve()).encode("utf-8"), usedforsecurity=False
    ).hexdigest()


def _version_of(source: Path) -> str | None:
    try:
        return str(source.stat().st_mtime_ns)
    except OSError:
        return None


def pyramid_dir(source: os.PathLike[str] | str, version: str) -> Path:
    return _CACHE_DIR / _source_key(Path(source)) / version


def max_level_for(width: int, height: int) -> int:
    """The level at which the image is at full resolution.

    Level 0 fits in a single tile; each level above doubles the size.
    """
    longest = max(width, height, 1)
    return max(0, math.ceil(math.log2(longest / TILE_SIZE)))


def _encode_level(image, level_dir: Path) -> None:
    width, height = image.size
    level_dir.mkdir(parents=True, exist_ok=True)
    for ty in range(math.ceil(height / TILE_SIZE)):
        for tx in range(math.ceil(width / TILE_SIZE)):
            box = (
                tx * TILE_SIZE,
                ty * TILE_SIZE,
                min(width, (tx + 1) * TILE_SIZE),
                min(height, (ty + 1) * TILE_SIZE),
            )
            image.crop(box).save(
                level_dir / f"{tx}_{ty}.webp",
                "WEBP",
                quality=_QUALITY,
                method=_METHOD,
            )


def build_pyramid(source: os.PathLike[str] | str) -> dict | None:
    """Build every level for `source` and return its manifest.

    Built into a temporary directory and renamed into place, so a reader only
    ever finds a complete pyramid. Older versions of the same source are
    removed once the new one is in place.
    """
    from PIL import Image

    source_path = Path(source)
    version = _version_of(source_path)
    if version is None:
        return None
    final = pyramid_dir(source_path, version)
    if (final / "manifest.json").is_file():
        return read_manifest(final)

    parent = final.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=parent, prefix=".build-"))
    # mkdtemp makes the directory private (0700); the finished pyramid is an
    # ordinary readable cache like the rest of output/.
    os.chmod(staging, 0o755)
    try:
        with Image.open(source_path) as opened:
            opened.load()
            mode = "RGBA" if "A" in opened.getbands() or "transparency" in opened.info else "RGB"
            image = opened.convert(mode)

        width, height = image.size
        top = max_level_for(width, height)
        levels: list[dict] = [{}] * (top + 1)
        current = image
        for level in range(top, -1, -1):
            if level != top:
                # Box-filtered halving: fast, and exact enough for terrain.
                current = current.reduce(2)
            levels[level] = {"width": current.size[0], "height": current.size[1]}
            _encode_level(current, staging / str(level))

        manifest = {
            "version": version,
            "width": width,
            "height": height,
            "tile_size": TILE_SIZE,
            "max_level": top,
            "levels": levels,
            "format": "webp",
        }
        (staging / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        try:
            os.replace(staging, final)
        except OSError:
            # Another build of the same version won the race; theirs is as good.
            shutil.rmtree(staging, ignore_errors=True)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    for sibling in parent.iterdir():
        if sibling.name != version and not sibling.name.startswith(".build-"):
            shutil.rmtree(sibling, ignore_errors=True)
    return read_manifest(final)


def read_manifest(directory: Path) -> dict | None:
    try:
        return json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _build_in_background(source: Path) -> None:
    key = str(source.resolve())
    with _building_lock:
        if key in _building:
            return
        _building.add(key)

    def run() -> None:
        try:
            build_pyramid(source)
        except Exception as exc:  # pragma: no cover - background best effort
            print(f"[tiles] build failed for {source}: {exc}")
        finally:
            with _building_lock:
                _building.discard(key)

    threading.Thread(target=run, name="tile-pyramid", daemon=True).start()


def ready_manifest(
    source: os.PathLike[str] | str, *, background: bool = True
) -> dict | None:
    """The manifest for `source`'s current version, or None while it builds."""
    source_path = Path(source)
    version = _version_of(source_path)
    if version is None:
        return None
    manifest = read_manifest(pyramid_dir(source_path, version))
    if manifest is not None:
        return manifest
    if background:
        _build_in_background(source_path)
        return None
    return build_pyramid(source_path)


def tile_file(
    source: os.PathLike[str] | str, version: str, level: int, x: int, y: int
) -> Path | None:
    """A tile of the *current* version, or None.

    A stale version is refused rather than served: its URL is cached forever
    by clients, so it must never answer with different pixels.
    """
    source_path = Path(source)
    if _version_of(source_path) != version:
        return None
    path = pyramid_dir(source_path, version) / str(level) / f"{x}_{y}.webp"
    return path if path.is_file() else None


# ---------------------------------------------------------------------------
# Reduced copies of single overlays
#
# Realm overlays are cropped to their region, so they are not full-map sized,
# but the large ones are still thousands of pixels across and are decoded at
# full size even when the whole world is on screen. `lod=n` serves a copy
# reduced by 2**n, which the client asks for when zoomed out far enough that
# the full size would only be thrown away.
# ---------------------------------------------------------------------------

MAX_LOD = 3

_LOD_DIR = _ROUTER_DIR.parent / "output" / "_derived" / "lod"
_lod_lock = threading.Lock()


def lod_variant(source: os.PathLike[str] | str, lod: int) -> Path | None:
    """`source` reduced by 2**lod, cached next to other derived images.

    Built synchronously: overlays are small enough that one reduce and encode
    takes a few milliseconds, and a request for a reduced copy has nothing
    better to fall back to. Lossless WebP keeps the overlay's hard alpha edges.
    """
    from PIL import Image

    if lod <= 0:
        return Path(source)
    lod = min(lod, MAX_LOD)
    source_path = Path(source)
    version = _version_of(source_path)
    if version is None:
        return None
    target = _LOD_DIR / f"{_source_key(source_path)}_{version}_{lod}.webp"
    if target.is_file():
        return target

    with _lod_lock:
        if target.is_file():
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            with Image.open(source_path) as opened:
                opened.load()
                image = opened.convert("RGBA")
            image.reduce(2**lod).save(tmp, "WEBP", lossless=True, method=2)
            os.replace(tmp, target)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        for stale in target.parent.glob(f"{_source_key(source_path)}_*_{lod}.webp"):
            if stale != target:
                stale.unlink(missing_ok=True)
    return target
