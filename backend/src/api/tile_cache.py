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
A request finds a ready pyramid for the source's current pixels or, while a
background thread builds that one, the previous version's; only a source that
has never been tiled answers "not ready" (the client then uses the single
image). Each build lives in a directory named after its pixel fingerprint, so a
regenerated map invalidates itself and a reader never sees a half-written
level. Regeneration starts the builds itself (`tile_warm`) rather than
leaving them to the first visitor.

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
import time
from collections import OrderedDict
from pathlib import Path

from anyio import CapacityLimiter, to_thread
from PIL import __version__ as PILLOW_VERSION, features

TILE_SIZE = 256
_QUALITY = 80
_METHOD = 4

_ROUTER_DIR = Path(__file__).resolve().parent
_CACHE_DIR = _ROUTER_DIR.parent / "output" / "_derived" / "tiles"

_building: set[str] = set()
_building_lock = threading.Lock()

# One full-map build at a time. Each holds a 6400 px image (~160 MB) and its
# smaller levels in memory; several modes asked for at once must queue rather
# than stack up in the API's memory.
BUILD_LOCK = threading.Lock()


def _source_key(source: Path) -> str:
    return hashlib.sha1(
        str(source.resolve()).encode("utf-8"), usedforsecurity=False
    ).hexdigest()


# Include encoder inputs so an algorithm or Pillow upgrade cannot change an
# immutable URL's meaning. File timestamps only memoise the expensive hash.
_RENDERER_VERSION = (
    f"tiles-v2:{TILE_SIZE}:{_QUALITY}:{_METHOD}:lod-lossless-2:pick-nearest-6:"
    f"{PILLOW_VERSION}:{features.version('webp')}"
)
_versions: OrderedDict[Path, tuple[tuple, str]] = OrderedDict()
_versions_lock = threading.Lock()
_DERIVATIVE_LIMITER = CapacityLimiter(2)

# Keep the current pyramid plus at most two retired generations. The retired
# byte budget is per source; the current generation is always allowed to live.
RETAIN_SECONDS = 3600
RETAIN_GENERATIONS = 2
RETAIN_BYTES = 256 * 1024 * 1024


async def run_derivative(function, *args):
    """Bound image work separately from the API's ordinary request workers.

    The entire call, including its blocking locks and fingerprint reads, runs
    in the worker. A cold phone request must not pause unrelated API traffic.
    """
    return await to_thread.run_sync(function, *args, limiter=_DERIVATIVE_LIMITER)


def _signature(stat) -> tuple:
    return (stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, _RENDERER_VERSION)


def _read_source(source: Path):
    from PIL import Image

    # Read and hash the very image we render. A replacement during an encode
    # can then only publish an older, internally consistent generation.
    with source.open("rb") as stream:
        before = _signature(os.fstat(stream.fileno()))
        with Image.open(stream) as opened:
            image = opened.convert("RGBA")
        if _signature(os.fstat(stream.fileno())) != before:
            image.close()
            raise OSError(f"Map changed while reading {source}")
    digest = hashlib.sha256(f"{_RENDERER_VERSION}:{image.size}:RGBA".encode())
    # Avoid another full-map byte buffer alongside Pillow's decoded image.
    for y in range(0, image.height, 64):
        digest.update(image.crop((0, y, image.width, min(y + 64, image.height))).tobytes())
    version = digest.hexdigest()
    if _signature(source.stat()) == before:
        with _versions_lock:
            _versions[source] = (before, version)
            _versions.move_to_end(source)
            while len(_versions) > 256:
                _versions.popitem(last=False)
    return image, version


def _source_snapshot(source: Path):
    """Return a memoised version, or keep the newly decoded pixels for a build.

    Hashing and then reopening a cold 6400 px PNG doubles its decode cost. The
    caller can reuse this snapshot if its derivative has not been built yet.
    """
    try:
        signature = _signature(source.stat())
        with _versions_lock:
            cached = _versions.get(source)
            if cached is not None and cached[0] == signature:
                return None, cached[1]
        return _read_source(source)
    except OSError:
        return None, None


def _version_of(source: Path) -> str | None:
    image, version = _source_snapshot(source)
    if image is not None:
        image.close()
    return version


def valid_version(version: str) -> bool:
    # Numeric generations remain readable across the first content-hash build.
    return version.isascii() and (
        version.isdigit()
        or (len(version) == 64 and all(c in "0123456789abcdef" for c in version))
    )


def cleanup_pyramids(source: Path, current: str) -> None:
    """Retire old generations, with age, count and byte ceilings.

    Age starts when a generation is superseded, not when it was built: a map
    unchanged for months still deserves a grace period for its open pages.
    Cleanup runs on warming/builds, including unchanged-content cache hits.
    """
    parent = pyramid_dir(source, current).parent
    if not parent.is_dir():
        return
    retired = []
    now = time.time()
    for directory in parent.iterdir():
        if not valid_version(directory.name) or not directory.is_dir():
            continue
        marker = directory / ".retired"
        if directory.name == current:
            marker.unlink(missing_ok=True)
            continue
        if not marker.exists():
            marker.touch()
        retired.append((marker.stat().st_mtime, directory))
    total = 0
    for index, (stamp, directory) in enumerate(sorted(retired, reverse=True)):
        size = sum(p.stat().st_size for p in directory.rglob("*") if p.is_file())
        total += size
        if index >= RETAIN_GENERATIONS or now - stamp > RETAIN_SECONDS or total > RETAIN_BYTES:
            shutil.rmtree(directory, ignore_errors=True)


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
    ever finds a complete pyramid. Retired versions have a bounded grace period
    so an open page can finish loading its existing manifest.
    """
    source_path = Path(source)
    image, version = _source_snapshot(source_path)
    if version is None:
        return None
    final = pyramid_dir(source_path, version)
    if (final / "manifest.json").is_file():
        if image is not None:
            image.close()
        cleanup_pyramids(source_path, version)
        return read_manifest(final)

    if image is None:
        image, version = _read_source(source_path)
    final = pyramid_dir(source_path, version)

    parent = final.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=parent, prefix=".build-"))
    # mkdtemp makes the directory private (0700); the finished pyramid is an
    # ordinary readable cache like the rest of output/.
    os.chmod(staging, 0o755)
    try:
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
            # Only a complete competing publication can excuse a failed rename.
            if read_manifest(final) is None:
                raise
            shutil.rmtree(staging, ignore_errors=True)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    finally:
        image.close()
        current.close()

    # A source may have changed during this build. Preserve its already-built
    # current generation even when an older worker happens to finish last.
    current_version = _version_of(source_path)
    kept_version = (
        current_version
        if current_version and read_manifest(pyramid_dir(source_path, current_version))
        else version
    )
    cleanup_pyramids(source_path, kept_version)
    return read_manifest(final)


def read_manifest(directory: Path) -> dict | None:
    try:
        return json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _build_in_background(source: Path, *, warm_pick: bool = False, tiles: bool = True) -> None:
    key = f"{source.resolve()}:{warm_pick}:{tiles}"
    with _building_lock:
        if key in _building:
            return
        _building.add(key)

    def run() -> None:
        try:
            with BUILD_LOCK:
                # The phone pick image is small and needed before interaction;
                # prepare it before spending seconds on all the display tiles.
                if warm_pick:
                    pick_variant(source, 1)
                if tiles:
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
    """The manifest for `source`'s current version.

    While that version builds, the newest one already built: a map regenerated
    every few minutes (prosperity follows every trade update) would otherwise
    answer "not ready" for most of its life and send readers the full-size
    image. None only when nothing has been built yet.
    """
    source_path = Path(source)
    version = _version_of(source_path)
    if version is None:
        return None
    manifest = read_manifest(pyramid_dir(source_path, version))
    if manifest is not None:
        return manifest
    if background:
        _build_in_background(source_path)
        return latest_manifest(source_path)
    return build_pyramid(source_path)


def latest_manifest(source: os.PathLike[str] | str) -> dict | None:
    """The newest finished pyramid of `source`, whatever its version.

    Its tiles stay on disk through the bounded retention window, so it can be
    served while that build runs (`tile_file` keeps answering for it).
    """
    parent = _CACHE_DIR / _source_key(Path(source))
    try:
        versions = [
            entry for entry in parent.iterdir()
            if valid_version(entry.name) and (entry / "manifest.json").is_file()
        ]
    except OSError:
        return None
    for directory in sorted(
        versions, key=lambda entry: (entry / "manifest.json").stat().st_mtime_ns, reverse=True
    ):
        manifest = read_manifest(directory)
        if manifest is not None:
            return manifest
    return None


def existing_manifest(source: os.PathLike[str] | str) -> dict | None:
    """The manifest for `source`'s current version if built; never builds."""
    version = _version_of(Path(source))
    if version is None:
        return None
    return read_manifest(pyramid_dir(source, version))


def tile_file(
    source: os.PathLike[str] | str, version: str, level: int, x: int, y: int
) -> Path | None:
    """A tile of `version`, while that version's pyramid is still on disk.

    Versions live in separate directories, so a URL can never answer with
    different pixels; an older version keeps serving through a bounded
    grace period, which lets a client holding the previous manifest finish
    loading rather than 404 the moment the source changes.
    """
    if not valid_version(version):
        return None
    path = pyramid_dir(Path(source), version) / str(level) / f"{x}_{y}.webp"
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

    Call through run_derivative in async routes, including lock acquisition.
    Lossless WebP keeps the overlay's hard alpha edges.
    """
    if lod <= 0:
        return Path(source)
    lod = min(lod, MAX_LOD)
    source_path = Path(source)
    image, version = _source_snapshot(source_path)
    if version is None:
        return None
    target = _LOD_DIR / f"{_source_key(source_path)}_{version}_{lod}.webp"
    if target.is_file():
        if image is not None:
            image.close()
        return target

    with _lod_lock:
        if target.is_file():
            if image is not None:
                image.close()
            return target
        if image is None:
            image, version = _read_source(source_path)
        target = _LOD_DIR / f"{_source_key(source_path)}_{version}_{lod}.webp"
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            image.reduce(2**lod).save(tmp, "WEBP", lossless=True, method=2)
            os.replace(tmp, target)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        finally:
            image.close()
        previous = sorted(
            (p for p in target.parent.glob(f"{_source_key(source_path)}_*_{lod}.webp") if p != target),
            key=lambda p: p.stat().st_mtime_ns, reverse=True,
        )
        for stale in previous[RETAIN_GENERATIONS:]:
            stale.unlink(missing_ok=True)
    return target


# ---------------------------------------------------------------------------
# Reduced pick maps
#
# The client reads region ids back out of a `mapdata` pick map pixel by pixel,
# from a canvas the pick map's own size: 6400 px square, some 160 MB, and over
# the 16.7-megapixel limit iOS Safari puts on a canvas. A phone that held it
# alongside the map ran out of memory and Safari reloaded the page, again and
# again. `pick_variant` serves the pick map reduced by 2**scale with nearest-
# neighbour sampling, so every pixel is still exactly one region's colour.
# ---------------------------------------------------------------------------

MAX_PICK_SCALE = 2

_PICK_DIR = _ROUTER_DIR.parent / "output" / "_derived" / "pick"
_pick_lock = threading.Lock()


def pick_variant(source: os.PathLike[str] | str, scale: int) -> Path | None:
    """`source` reduced by 2**scale, nearest-neighbour, as a PNG; cached."""
    from PIL import Image

    if scale <= 0:
        return Path(source)
    scale = min(scale, MAX_PICK_SCALE)
    source_path = Path(source)
    image, version = _source_snapshot(source_path)
    if version is None:
        return None
    target = _PICK_DIR / f"{_source_key(source_path)}_{version}_{scale}.png"
    if target.is_file():
        if image is not None:
            image.close()
        return target

    with _pick_lock:
        if target.is_file():
            if image is not None:
                image.close()
            return target
        if image is None:
            image, version = _read_source(source_path)
        target = _PICK_DIR / f"{_source_key(source_path)}_{version}_{scale}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            factor = 2**scale
            size = (max(1, image.width // factor), max(1, image.height // factor))
            reduced = image.resize(size, Image.Resampling.NEAREST)
            reduced.save(tmp, "PNG", compress_level=6)
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        finally:
            image.close()
        previous = sorted(
            (p for p in target.parent.glob(f"{_source_key(source_path)}_*_{scale}.png") if p != target),
            key=lambda p: p.stat().st_mtime_ns, reverse=True,
        )
        for stale in previous[RETAIN_GENERATIONS:]:
            stale.unlink(missing_ok=True)
    return target

