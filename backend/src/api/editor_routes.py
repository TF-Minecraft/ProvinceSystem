"""Staff-gated map title editor API routes."""

from __future__ import annotations

import json
import os

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .data_routes import clear_province_cache
from .http_headers import add_revalidate, conditional_file_response
from .editor_validation import TITLE_TIERS, TitleValidationError, validate_title_tier
from .map_access import ensure_map_staff_write
from .regen_routes import _regen_start_message
from src.scripts.loader.provinces import load_province_catalog
from src.scripts.province_id_grid import GRID_FILENAME, RUNS_FILENAME
from src.scripts.util.dirs import defines_file, input_file, validate_map
from src.scripts.util.regeneration import run_regeneration
from src.scripts.util.regen_types import parse_regen_type
from src.scripts.util.task_lock import get_map_lock

editor_router = APIRouter()


@editor_router.post("/{map_name}/editor/titles/{tier}")
async def save_title_tier(
    map_name: str,
    tier: str,
    request: Request,
    authorization: str | None = Header(default=None),
):
    map_name = ensure_map_staff_write(map_name, authorization).id

    tier_norm = (tier or "").strip().lower()
    if tier_norm not in TITLE_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown title tier '{tier}'. Expected one of: {', '.join(sorted(TITLE_TIERS))}",
        )

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Title data must be a JSON object")

    try:
        clean = validate_title_tier(tier_norm, payload, map_name)
    except TitleValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    path = defines_file(map_name, f"{tier_norm}.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(clean, handle, ensure_ascii=False, indent=2)

    clear_province_cache(map_name)

    return JSONResponse(
        {"ok": True, "tier": tier_norm, "count": len(clean)}
    )


@editor_router.post("/{map_name}/editor/regen/{regen_type}")
async def editor_regenerate(
    map_name: str,
    regen_type: str,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    map_name = ensure_map_staff_write(map_name, authorization).id

    try:
        validate_map(map_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        parse_regen_type(regen_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    map_lock = get_map_lock(map_name)
    if map_lock.locked():
        raise HTTPException(
            status_code=429,
            detail=f"Regeneration already in progress for map '{map_name}'.",
        )

    background_tasks.add_task(run_regeneration, map_name, regen_type)

    return JSONResponse(
        {
            "ok": True,
            "regen_type": regen_type,
            "message": _regen_start_message(regen_type),
        }
    )


@editor_router.get("/{map_name}/editor/provinces")
async def get_editor_provinces(
    map_name: str,
    authorization: str | None = Header(default=None),
):
    map_name = ensure_map_staff_write(map_name, authorization).id

    try:
        provinces = load_province_catalog(map_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return add_revalidate(JSONResponse({"provinces": provinces}))


@editor_router.get("/{map_name}/editor/pick/provinces")
async def get_editor_province_pick(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """Staff-only raw provinces.png for editor province RGB hit-testing."""
    map_name = ensure_map_staff_write(map_name, authorization).id

    try:
        validate_map(map_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    path = input_file(map_name, "provinces.png")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Province pick map not found")

    return conditional_file_response(
        path,
        media_type="image/png",
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )


@editor_router.get("/{map_name}/editor/province-index")
async def get_editor_province_index(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """Staff-only province id grid for editor hit-testing (gzip province_id_grid bytes)."""
    map_name = ensure_map_staff_write(map_name, authorization).id

    try:
        validate_map(map_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    grid_path = defines_file(map_name, GRID_FILENAME)
    if not os.path.isfile(grid_path):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Province grid not found for map '{map_name}'. "
                f"Run: python -m scripts.tools.build_province_id_grid --map {map_name}"
            ),
        )

    # The grid file on disk is already exactly the gzip payload the client
    # wants. Reading it into a ~82 MB numpy array, re-serializing and re-gzipping
    # it per request produced identical bytes while blocking the event loop, so
    # stream the file instead and let the client revalidate with a 304.
    return conditional_file_response(
        grid_path,
        media_type="application/gzip",
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )


@editor_router.get("/{map_name}/editor/province-runs")
async def get_editor_province_runs(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """Run-length encoded sibling of the province id grid (~350 KB vs ~495 KB).

    Same staff gate and same on-disk-bytes-verbatim handling as the grid route
    above. Behind NEXT_PUBLIC_EDITOR_PROVINCE_RUNS on the client, which falls
    back to the grid whenever this 404s, so a map without the artifact keeps
    working.
    """
    map_name = ensure_map_staff_write(map_name, authorization).id

    try:
        validate_map(map_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    runs_path = defines_file(map_name, RUNS_FILENAME)
    if not os.path.isfile(runs_path):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Province runs not found for map '{map_name}'. "
                f"Run: python -m scripts.tools.build_province_id_grid --map {map_name}"
            ),
        )

    return conditional_file_response(
        runs_path,
        media_type="application/gzip",
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )
