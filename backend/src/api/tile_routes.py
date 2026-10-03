"""Tiled versions of the full-map rasters. See `tile_cache` for why."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse

from . import file_routes, map_routes
from .http_headers import add_cors, conditional_json_response
from .map_access import ensure_map_access
from .tile_cache import ready_manifest, tile_file

tile_router = APIRouter()

# `base` is the satellite map the viewer draws under everything; `mapdata-X`
# is mode X's full-map raster (terrain, fertility, province, ...).
_MAPDATA_PREFIX = "mapdata-"


def _tile_source(map_name: str, layer: str) -> Path | None:
    if layer == "base":
        path = map_routes._resolve_base_map_path(map_name, "satellite")
        return Path(path) if path else None
    if layer.startswith(_MAPDATA_PREFIX):
        return file_routes.resolve_mapdata_path(map_name, layer[len(_MAPDATA_PREFIX):])
    return None


@tile_router.get("/{map_name}/tiles/{layer}/manifest")
async def get_tile_manifest(
    map_name: str,
    layer: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    """The pyramid's shape, or `{"ready": false}` while it is being built.

    Not ready is a normal answer (202), not an error: the client keeps drawing
    the single image and asks again later.
    """
    map_name = ensure_map_access(map_name, authorization).id
    source = _tile_source(map_name, layer)
    if source is None:
        raise HTTPException(status_code=404, detail="Layer not found")

    manifest = ready_manifest(source)
    if manifest is None:
        response = conditional_json_response({"ready": False})
        response.status_code = 202
        return response
    return conditional_json_response(
        {"ready": True, **manifest}, if_none_match=if_none_match
    )


@tile_router.get("/{map_name}/tiles/{layer}/{version}/{level}/{x}/{y}.webp")
async def get_tile(
    map_name: str,
    layer: str,
    version: str,
    level: int,
    x: int,
    y: int,
    authorization: str | None = Header(default=None),
):
    entry = ensure_map_access(map_name, authorization)
    source = _tile_source(entry.id, layer)
    if source is None or not version.isdigit() or min(level, x, y) < 0:
        raise HTTPException(status_code=404, detail="Tile not found")

    path = tile_file(source, version, level, x, y)
    if path is None:
        raise HTTPException(status_code=404, detail="Tile not found")

    response = FileResponse(path, media_type="image/webp")
    # The version is part of the URL and a stale one is refused above, so a
    # tile URL never changes meaning: cache it for good. Staff maps stay out
    # of shared caches.
    scope = "public" if entry.public else "private"
    response.headers["Cache-Control"] = f"{scope}, max-age=31536000, immutable"
    return add_cors(response)
