"""LuckPerms in the staff panel, and the TFMCWeb bridge that feeds and applies it.

Plugin routes need the primary plugin key: LuckPerms storage is shared, so
only one server applies changes. Staff routes follow admin_routes: reads need
a staff role, writes also need the site's own origin, and refusals by a
signed-in caller are audited.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from src.api.admin_routes import _capable, _write
from src.api.auth_routes import _no_store
from src.api.patreon_routes import require_writer
from src.api.request_body import read_json_body
from src.auth import admin
from src.luckperms import changes, mirror, views

SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024
RESULTS_MAX_BYTES = 4 * 1024 * 1024

plugin_router = APIRouter(prefix="/luckperms/plugin", tags=["luckperms"], dependencies=[Depends(require_writer)])
staff_router = APIRouter(prefix="/admin/luckperms", tags=["admin"])


@plugin_router.put("/snapshot")
async def put_snapshot(request: Request):
    payload = await read_json_body(request, SNAPSHOT_MAX_BYTES)
    try:
        return await run_in_threadpool(mirror.replace_snapshot, payload)
    except mirror.SnapshotError as exc:
        raise HTTPException(400, detail=exc.code) from None


class HashBody(BaseModel):
    hash: str = Field(..., max_length=128)
    revision: int = Field(..., gt=0)


@plugin_router.post("/snapshot/unchanged")
def post_unchanged(body: HashBody):
    if mirror.mark_unchanged(body.hash, body.revision):
        return {"ok": True}
    return {"ok": False, "need_full": True}


@plugin_router.get("/changes")
def get_changes(response: Response):
    _no_store(response)
    return {"changes": changes.fetch_for_bridge()}


@plugin_router.post("/changes/results")
async def post_results(request: Request):
    payload = await read_json_body(request, RESULTS_MAX_BYTES)
    if not isinstance(payload, dict):
        raise HTTPException(400, detail="bad_results")
    try:
        return await run_in_threadpool(changes.record_results, payload.get("results"))
    except admin.AdminError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None


# --------------------
# Staff
# --------------------


def _read(request: Request, response: Response, run):
    viewer = _capable(request, "view_luckperms")
    _no_store(response)
    try:
        return run(viewer)
    except admin.AdminError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None


@staff_router.get("")
def get_overview(request: Request, response: Response):
    return _read(request, response, views.overview)


@staff_router.get("/groups/{name}")
def get_group(name: str, request: Request, response: Response):
    return _read(request, response, lambda viewer: views.group_detail(viewer, name))


@staff_router.get("/players")
def get_players(request: Request, response: Response, q: str = "", group: str | None = None,
                page: int = Query(1, ge=1, le=10_000)):
    return _read(request, response, lambda viewer: views.users(viewer, q, group, page))


@staff_router.get("/players/{player_uuid}")
def get_player(player_uuid: str, request: Request, response: Response):
    return _read(request, response, lambda viewer: views.user_detail(viewer, player_uuid))


@staff_router.get("/changes")
def get_recent_changes(request: Request, response: Response):
    return _read(request, response, lambda _viewer: {"changes": changes.list_changes()})


@staff_router.get("/changes/{change_id}")
def get_change(change_id: int, request: Request, response: Response):
    return _read(request, response, lambda _viewer: changes.get_change(change_id))


class ChangeBody(BaseModel):
    target_type: str = Field(..., max_length=8)
    target: str = Field(..., max_length=64)
    ops: list[dict] = Field(..., max_length=changes.OPS_MAX)
    reason: str = Field(..., max_length=admin.REASON_MAX * 2)


@staff_router.post("/changes")
def post_change(body: ChangeBody, request: Request, response: Response):
    _no_store(response)
    return _write(request, "luckperms.change", None,
                  lambda token: changes.queue_change(token, body.target_type, body.target, body.ops, body.reason))
