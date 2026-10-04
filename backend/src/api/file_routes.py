from fastapi import APIRouter, Header, HTTPException, Query
from pathlib import Path

from .http_headers import conditional_file_response
from .map_access import ensure_map_access
from .path_safety import is_safe_segment, resolve_within
from .webp_cache import webp_variant
from .tile_cache import MAX_LOD, MAX_PICK_SCALE, lod_variant, pick_variant, run_derivative
from ..scripts.util import dirs
from ..scripts.util.dirs import (
    map_image,
    region_image,
    banner_image,
    zoc_dir,
    zoc_image,
    validate_map,
    input_file,
)
from ..scripts.util.zoc_paths import safe_fort_filename

ROUTER_DIR = Path(__file__).resolve().parent
OUTPUT_BASE = ROUTER_DIR.parent / "output"

file_router = APIRouter()


def _image_response(
    file_path,
    accept: str | None,
    if_none_match: str | None,
    if_modified_since: str | None,
):
    """Serve a display-only overlay, preferring a cached WebP copy.

    Same shape as `map_routes._base_map_response`: falls back to the PNG while
    no fresh WebP exists, so a request is never blocked on the encode.

    Only for images the browser merely draws. The `mapdata` pick maps are read
    back pixel-by-pixel to resolve region ids, so they stay raw PNG.
    """
    webp = webp_variant(file_path, accept=accept)
    served = str(webp) if webp else str(file_path)
    media_type = "image/webp" if webp else "image/png"

    response = conditional_file_response(
        served,
        media_type=media_type,
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )
    # The body depends on whether the client advertised WebP, so caches must key on it.
    response.headers["Vary"] = "Accept"
    return response


def resolve_mapdata_path(map_name: str, map_type: str) -> Path | None:
    """The full-map raster behind a map mode, or None if there is none.

    `map_name` must already have passed the access check.
    """
    if not is_safe_segment(map_type):
        return None

    # The province mode paints the source pick map itself, so there is
    # nothing to generate and nothing for a regen to keep in sync.
    if map_type == "province":
        try:
            validate_map(map_name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        root = Path(dirs.INPUT_DIR) / map_name
        file_path = Path(input_file(map_name, "provinces.png"))
    else:
        root = OUTPUT_BASE / map_name
        file_path = (
            OUTPUT_BASE
            / map_name
            / "maps"
            / f"{map_type}_map.png"
        )

    file_path = resolve_within(root, file_path)
    if file_path is None or not file_path.is_file():
        return None
    return file_path


@file_router.get("/{map_name}/mapdata/{map_type}")
async def get_map_file(
    map_name: str,
    map_type: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
    scale: int = Query(default=0, ge=0, le=MAX_PICK_SCALE),
):
    entry = ensure_map_access(map_name, authorization)
    map_name = entry.id
    file_path = resolve_mapdata_path(map_name, map_type)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Map not found")
    # Phones ask for a smaller copy: the full-size pick canvas is more than
    # iOS Safari will hold (see tile_cache.pick_variant). Called directly
    # (not through FastAPI) the parameter is still its Query default.
    if isinstance(scale, int) and scale > 0:
        file_path = await run_derivative(pick_variant, file_path, scale)
        if file_path is None:
            raise HTTPException(status_code=404, detail="Map not found")

    # Deliberately NOT routed through webp_variant: this is the pick map. The
    # client draws it to an offscreen canvas and reads exact RGB values back to
    # resolve province/county ids, and lossy WebP would corrupt those lookups.
    # Revalidate on every use so these colours agree with the live region data.
    return conditional_file_response(
        file_path,
        media_type="image/png",
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )


@file_router.get("/{map_name}/regions/{map_type}/{file_name}")
async def get_region_file(
    map_name: str,
    map_type: str,
    file_name: str,
    authorization: str | None = Header(default=None),
    accept: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
    lod: int = Query(default=0, ge=0, le=MAX_LOD),
):
    entry = ensure_map_access(map_name, authorization)
    map_name = entry.id
    # Ensure .png extension
    stem = file_name[:-4] if file_name.endswith(".png") else file_name
    if not is_safe_segment(map_type) or not is_safe_segment(stem):
        raise HTTPException(status_code=404, detail="Region overlay not found")
    file_name = f"{stem}.png"

    root = OUTPUT_BASE / map_name / "regions"
    file_path = resolve_within(root, root / map_type / file_name)

    if file_path is None or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Region overlay not found")

    # A zoomed-out client asks for a reduced copy rather than decoding the
    # full crop only to draw it a few pixels across.
    if isinstance(lod, int) and lod > 0:
        reduced = await run_derivative(lod_variant, file_path, lod)
        if reduced is not None:
            # Dimensions and colours must revalidate with the live overlay metadata.
            return conditional_file_response(
                reduced,
                media_type="image/webp",
                if_none_match=if_none_match,
                if_modified_since=if_modified_since,
            )

    return _image_response(file_path, accept, if_none_match, if_modified_since)


@file_router.get("/{map_name}/banners/{mode}/{file_name}")
async def get_banner_file(
    map_name: str,
    mode: str,
    file_name: str,
    authorization: str | None = Header(default=None),
    accept: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    # Banners are only ever PNGs, requested with the extension included.
    if (
        not is_safe_segment(mode)
        or not file_name.endswith(".png")
        or not is_safe_segment(file_name[:-4])
    ):
        raise HTTPException(status_code=404, detail="Banner not found")

    file_path = resolve_within(
        Path(dirs.OUTPUT_DIR) / map_name / "banners",
        banner_image(map_name, mode, file_name),
    )

    if file_path is None or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Banner not found")

    return _image_response(file_path, accept, if_none_match, if_modified_since)


@file_router.get("/{map_name}/zoc/{fort_id}")
async def get_zoc_overlay(
    map_name: str,
    fort_id: str,
    authorization: str | None = Header(default=None),
    accept: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    try:
        validate_map(map_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    fort_id = fort_id.strip()
    if fort_id.lower().endswith(".png"):
        fort_id = fort_id[:-4]
    safe_id = safe_fort_filename(fort_id)
    if safe_id is None:
        raise HTTPException(status_code=400, detail="Invalid fort id")

    file_path = resolve_within(zoc_dir(map_name), zoc_image(map_name, safe_id))
    if file_path is None or not file_path.is_file():
        raise HTTPException(status_code=404, detail="ZOC overlay not found")

    return _image_response(file_path, accept, if_none_match, if_modified_since)
