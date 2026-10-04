"""Drink Builder API: redeem, submit, staff review, plugin catalog/meta."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from src.skins.auth import (
    AuthError,
    HEADER_PLUGIN_KEY,
    HEADER_STAFF_KEY,
    is_secondary_plugin_key,
    require_plugin_key,
    require_staff_key,
)
from src.api.path_safety import is_safe_filename, is_safe_segment, resolve_within
from src.skins import db as skins_db
from src.skins.codes import CodeError, get_session, redeem_drink_code
from src.skins.drink_review_sheet import DrinkReviewSheetError, build_drink_review_sheet
from src.skins.drinks import (
    DrinkError,
    DrinkNotificationError,
    ack_drink_notification,
    approve_drink_submission,
    assign_drink_texture_cmd,
    create_drink_submission,
    deny_drink_submission,
    get_drink_catalog,
    get_drink_for_plugin,
    get_drink_submission_for_owner,
    list_deletable_drinks,
    list_drinks_pending_apply,
    list_pending_drinks,
    list_player_textures,
    list_undelivered_drink_notifications,
    mark_drinks_applied,
    replace_drink_catalog,
    resolve_drink_asset,
    resolve_drink_submission_file,
    revoke_drink_submission,
    save_drink_asset,
)

logger = logging.getLogger("drinks.routes")

drinks_router = APIRouter(prefix="/drinks", tags=["drinks"])


class RedeemBody(BaseModel):
    code: str = Field(..., min_length=1)


class DenyBody(BaseModel):
    reason: str = Field(..., min_length=1)


class TextureCmdBody(BaseModel):
    cmd: int = Field(..., ge=1)
    ia_item_id: str = Field(..., min_length=1)


class AppliedBody(BaseModel):
    submission_ids: list[str] = Field(default_factory=list)


def _session_from_auth(authorization: str | None):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401, detail="Missing or invalid Authorization Bearer token"
        )
    token = authorization[7:].strip()
    row = get_session(token)
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return row


def _require_drink_session(authorization: str | None):
    row = _session_from_auth(authorization)
    if str(row.get("scope") or "").strip().lower() != "drink":
        raise HTTPException(status_code=403, detail="Drink session required")
    return row


def _require_plugin(x_plugin_key: str | None) -> None:
    try:
        require_plugin_key(x_plugin_key)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


def _require_staff(x_staff_key: str | None) -> None:
    try:
        require_staff_key(x_staff_key)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


@drinks_router.post("/redeem")
def post_redeem(body: RedeemBody):
    try:
        return redeem_drink_code(body.code)
    except CodeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@drinks_router.get("/catalog")
def get_catalog():
    return get_drink_catalog()


@drinks_router.get("/assets/{filename}")
def get_drink_creator_asset(filename: str):
    """Public PNG assets synced from DrinkBuilder (glass_bottle / potion_overlay)."""
    path = resolve_drink_asset(filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    response = FileResponse(
        path,
        media_type="image/png",
        filename=path.name,
        headers={"Cache-Control": "public, max-age=60"},
    )
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    return response


@drinks_router.get("/textures")
def get_my_textures(
    authorization: str | None = Header(default=None),
):
    session = _require_drink_session(authorization)
    return {"textures": list_player_textures(session["player_uuid"])}


@drinks_router.post("/submissions")
async def post_submission(
    authorization: str | None = Header(default=None),
    recipe: str = Form(...),
    existing_texture_id: str | None = Form(default=None),
    texture: UploadFile | None = File(default=None),
):
    session = _require_drink_session(authorization)
    try:
        recipe_obj = json.loads(recipe)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail="recipe must be valid JSON") from e
    if not isinstance(recipe_obj, dict):
        raise HTTPException(status_code=400, detail="recipe must be a JSON object")

    png_bytes: bytes | None = None
    if texture is not None:
        png_bytes = await texture.read()
        if not png_bytes:
            png_bytes = None

    try:
        return create_drink_submission(
            session,
            recipe_obj,
            png_bytes=png_bytes,
            existing_texture_id=existing_texture_id,
        )
    except DrinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _owner_session_from_auth(authorization: str | None):
    row = _session_from_auth(authorization)
    scope = str(row.get("scope") or "").strip().lower()
    if scope in ("drink", "profile"):
        return row
    raise HTTPException(
        status_code=403,
        detail="Drink or profile session required",
    )


@drinks_router.get("/submissions/{submission_id}")
def get_submission(
    submission_id: str,
    authorization: str | None = Header(default=None),
):
    session = _owner_session_from_auth(authorization)
    row = get_drink_submission_for_owner(submission_id, session["player_uuid"])
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return row


@drinks_router.get("/staff/pending")
def staff_pending(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    return {"submissions": list_pending_drinks()}


@drinks_router.get("/submissions/{submission_id}/review-sheet")
def get_drink_review_sheet(
    submission_id: str,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    """Staff composite PNG: custom texture or tinted base potion for color-only."""
    _require_staff(x_staff_key)
    try:
        data = build_drink_review_sheet(submission_id)
    except DrinkReviewSheetError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if data is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return Response(content=data, media_type="image/png")


def _resolve_drink_file_safely(submission_id: str, filename: str):
    """resolve_drink_submission_file behind the shared path-parameter guards.

    That resolver checks the file name but joins the submission id as-is, so a
    Windows `%5C` in the id would walk out of the submissions tree.
    """
    if not is_safe_segment(submission_id) or not is_safe_filename(filename):
        return None
    path = resolve_drink_submission_file(submission_id, filename)
    if path is None:
        return None
    return resolve_within(
        skins_db.DRINKS_DIR / "submissions" / submission_id, path
    )


@drinks_router.get("/staff/submissions/{submission_id}/files/{filename}")
def staff_file(
    submission_id: str,
    filename: str,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    path = _resolve_drink_file_safely(submission_id, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="File not found")
    media = "image/png" if path.suffix.lower() == ".png" else "application/octet-stream"
    return FileResponse(path, media_type=media, filename=path.name)


@drinks_router.post("/submissions/{submission_id}/approve")
def post_approve(
    submission_id: str,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        result = approve_drink_submission(submission_id)
    except DrinkError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e
    logger.info("drink approved submission=%s status=%s", submission_id, result.get("status"))
    return result


@drinks_router.post("/submissions/{submission_id}/deny")
def post_deny(
    submission_id: str,
    body: DenyBody,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        result = deny_drink_submission(submission_id, body.reason)
    except DrinkError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e
    logger.info("drink denied submission=%s", submission_id)
    return result


@drinks_router.get("/staff/notifications")
def staff_notifications(
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    return {"notifications": list_undelivered_drink_notifications()}


@drinks_router.post("/staff/notifications/{notification_id}/ack")
def staff_notification_ack(
    notification_id: int,
    x_staff_key: str | None = Header(default=None, alias=HEADER_STAFF_KEY),
):
    _require_staff(x_staff_key)
    try:
        return ack_drink_notification(notification_id)
    except DrinkNotificationError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@drinks_router.put("/plugin/catalog")
def plugin_put_catalog(
    body: dict,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    if is_secondary_plugin_key(x_plugin_key):
        # Dev/tutorial servers push on every start; only the primary server's copy is kept.
        return {**get_drink_catalog(), "ignored": True}
    try:
        return replace_drink_catalog(body)
    except DrinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@drinks_router.put("/plugin/assets/{filename}")
async def plugin_put_asset(
    filename: str,
    request: Request,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    """DrinkBuilder uploads glass_bottle.png / potion_overlay.png (raw PNG body)."""
    _require_plugin(x_plugin_key)
    if is_secondary_plugin_key(x_plugin_key):
        return {"ok": True, "ignored": True, "filename": filename}
    data = await request.body()
    try:
        return save_drink_asset(filename, data)
    except DrinkError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@drinks_router.get("/plugin/pending-apply")
def plugin_pending_apply(
    realm_id: str | None = None,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"submissions": list_drinks_pending_apply(realm_id)}


@drinks_router.get("/plugin/submissions/{submission_id}/files/{filename}")
def plugin_file(
    submission_id: str,
    filename: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    path = _resolve_drink_file_safely(submission_id, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="File not found")
    media = "image/png" if path.suffix.lower() == ".png" else "application/octet-stream"
    return FileResponse(path, media_type=media, filename=path.name)


@drinks_router.post("/plugin/textures/{texture_id}/cmd")
def plugin_texture_cmd(
    texture_id: str,
    body: TextureCmdBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return assign_drink_texture_cmd(texture_id, body.cmd, body.ia_item_id)
    except DrinkError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e


@drinks_router.post("/plugin/applied")
def plugin_applied(
    body: AppliedBody,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    applied = mark_drinks_applied(body.submission_ids)
    return {"applied": applied}


@drinks_router.get("/plugin/drinks/deletable")
def plugin_drinks_deletable(
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    return {"drinks": list_deletable_drinks()}


@drinks_router.get("/plugin/drinks/{submission_id}")
def plugin_drink_get(
    submission_id: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    row = get_drink_for_plugin(submission_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return row


@drinks_router.post("/plugin/drinks/{submission_id}/revoke")
def plugin_drink_revoke(
    submission_id: str,
    x_plugin_key: str | None = Header(default=None, alias=HEADER_PLUGIN_KEY),
):
    _require_plugin(x_plugin_key)
    try:
        return revoke_drink_submission(submission_id)
    except DrinkError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e)) from e
