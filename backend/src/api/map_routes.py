from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
import os, time

from .http_headers import conditional_file_response, map_asset_cache
from .webp_cache import webp_variant
from .map_access import ensure_map_access
from ..scripts.util.dirs import input_file
from ..scripts.mapgen.previewgen import map_preview_path
from ..scripts.util.imagechecker import find_province

map_router = APIRouter()

_CACHE_TTL_SECONDS = 300  # 5 minutes

_PROVINCE_META_CACHE: dict[str, dict] = {}

def get_province_meta_cached(map_name: str) -> dict[int, dict]:
    now = time.time()

    entry = _PROVINCE_META_CACHE.get(map_name)

    if (
        entry is None or
        now - entry["loaded_at"] > _CACHE_TTL_SECONDS
    ):
        from ..scripts.loader.province_metadata import load_province_metadata
        _PROVINCE_META_CACHE[map_name] = {
            "data": load_province_metadata(map_name),
            "loaded_at": now,
        }

    return _PROVINCE_META_CACHE[map_name]["data"]

def _resolve_base_map_path(map_name: str) -> str | None:
    path = input_file(map_name, "map.png")
    return path if os.path.exists(path) else None

def _base_map_response(
    path: str,
    base_label: str,
    accept: str | None,
    if_none_match: str | None,
    if_modified_since: str | None,
):
    """Serve the base map, preferring a cached WebP copy when the client can use it.

    Falls back to the PNG whenever no fresh WebP exists yet, so the first request
    after a map regen is never blocked on the encode.
    """
    webp = webp_variant(path, accept=accept)
    served = str(webp) if webp else path
    media_type = "image/webp" if webp else "image/png"

    response = conditional_file_response(
        served,
        media_type=media_type,
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )
    response.headers["X-Map-Base"] = base_label
    # The body depends on whether the client advertised WebP, so caches must key on it.
    response.headers["Vary"] = "Accept"
    return response


@map_router.get("/{map_name}/map/preview")
async def get_map_preview(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """Low-res placeholder shown while the full base map downloads.

    Deliberately not routed through _base_map_response/webp_variant: the file is
    already WebP and must be served whatever the Accept header says, since its
    whole purpose is to render before the real map arrives.
    """
    entry = ensure_map_access(map_name, authorization)
    map_name = entry.id
    path = map_preview_path(map_name)
    if not os.path.exists(path):
        return JSONResponse({"error": "Map not found"}, 404)
    return conditional_file_response(
        path,
        media_type="image/webp",
        cache_control=map_asset_cache(entry, authorization),
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )

@map_router.get("/{map_name}/map")
async def get_base_map(
    map_name: str,
    authorization: str | None = Header(default=None),
    accept: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    path = _resolve_base_map_path(map_name)
    if not path:
        return JSONResponse({"error": "Map not found"}, 404)
    return _base_map_response(
        path, "original", accept, if_none_match, if_modified_since
    )

@map_router.get("/{map_name}/map/province/{coords}")
async def get_province(
    map_name: str,
    coords: str,
    authorization: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    try:
        x, z = map(int, coords.split(","))
    except ValueError:
        raise HTTPException(400, "Invalid coordinates")

    t0 = time.time()
    pid = find_province(map_name, x, z)
    print(f"[{map_name}] province lookup {time.time() - t0:.3f}s")

    if pid == 0:
        return JSONResponse({"province_id": 0}, 404)
    return JSONResponse({"province_id": pid})

@map_router.get("/{map_name}/province/{coords}/meta")
async def get_province_meta(
    map_name: str,
    coords: str,
    authorization: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id

    try:
        x, z = map(int, coords.split(","))
    except ValueError:
        raise HTTPException(400, "Invalid coordinates")

    pid = find_province(map_name, x, z)
    if pid == 0:
        return JSONResponse({"province_id": 0}, status_code=404)

    meta = get_province_meta_cached(map_name).get(pid)
    if not meta:
        return JSONResponse({"province_id": pid})

    return JSONResponse({
        "province_id": pid,
        "terrain": meta.get("terrain"),
        "fertility": meta.get("fertility"),
    })
