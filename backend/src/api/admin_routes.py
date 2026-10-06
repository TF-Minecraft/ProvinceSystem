"""Staff panel API. Every route checks the caller's role on the server.

Reads need a staff role. Writes also need the site's own origin, and the
service re-checks the actor and target inside the write; refusals by a
signed-in caller are audited.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from src.api.auth_routes import _config, _no_store, current_user, require_same_origin, session_cookie
from src.auth import admin, audit, players, roles, users
from src.coreprotect.reader import CoreProtectConfig

admin_router = APIRouter(prefix="/admin", tags=["admin"])

# Unix seconds well past any real window; keeps query values inside SQLite's integers.
MAX_TIME = 2 ** 40


class RoleBody(BaseModel):
    role: str = Field(..., max_length=16)
    reason: str = Field(..., max_length=admin.REASON_MAX * 2)


class ReasonBody(BaseModel):
    reason: str = Field(..., max_length=admin.REASON_MAX * 2)


def _staff(request: Request) -> dict:
    user = current_user(request, _config())
    if not roles.is_staff(user["role"]):
        raise HTTPException(403, detail="forbidden")
    return user


def _capable(request: Request, capability: str) -> dict:
    user = _staff(request)
    if not roles.can(user["role"], capability):
        raise HTTPException(403, detail="forbidden")
    return user


def _players(request: Request, response: Response, run, capability: str = "view_players"):
    viewer = _capable(request, capability)
    _no_store(response)
    try:
        return run(CoreProtectConfig.from_env(), viewer)
    except players.PlayerError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None


def _account_json(row: dict) -> dict:
    return {
        "user_id": row["user_id"],
        "discord_user_id": row["discord_user_id"],
        "discord_username": row["discord_username"],
        "discord_global_name": row["discord_global_name"],
        "avatar_url": users.avatar_url(row),
        "role": row["role"],
        "minecraft_name": row.get("minecraft_name"),
        "created_at": row["created_at"],
        "last_login_at": row["last_login_at"],
    }


def _write(request: Request, action: str, target_id: int, run):
    config = _config()
    token = request.cookies.get(session_cookie(config))
    try:
        require_same_origin(request, config)
    except HTTPException as exc:
        actor = users.session_user(token)
        if actor is not None:
            audit.record_refusal(actor=actor, action=action, outcome="denied",
                                 detail={"error": exc.detail, "target_user_id": target_id})
        raise
    try:
        return run(token)
    except admin.AdminError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None


@admin_router.get("/me")
def get_me(request: Request, response: Response):
    user = _staff(request)
    _no_store(response)
    return {
        "user_id": user["user_id"],
        "discord_username": user["discord_username"],
        "role": user["role"],
        "capabilities": roles.capabilities(user["role"]),
        "assignable_roles": roles.assignable_roles(user["role"]),
    }


@admin_router.get("/staff")
def get_staff(request: Request, response: Response):
    _staff(request)
    _no_store(response)
    return {"staff": [_account_json(row) for row in admin.list_staff()]}


@admin_router.get("/accounts/lookup")
def lookup_accounts(request: Request, response: Response, q: str = ""):
    _staff(request)
    _no_store(response)
    return {"accounts": [_account_json(row) for row in admin.lookup(q)]}


@admin_router.get("/players")
def get_players(request: Request, response: Response, q: str = "", sort: str = "last_seen",
                page: int = Query(1, ge=1, le=10_000)):
    return _players(request, response, lambda config, _viewer: players.directory(config, q, sort, page))


@admin_router.get("/players/{player_uuid}")
def get_player(player_uuid: str, request: Request, response: Response):
    return _players(request, response, lambda config, _viewer: players.profile(config, player_uuid))


@admin_router.get("/players/{player_uuid}/sessions")
def get_player_sessions(player_uuid: str, request: Request, response: Response, before: str | None = None,
                        limit: int = Query(20, ge=1, le=100)):
    return _players(request, response,
                    lambda config, _viewer: players.player_sessions(config, player_uuid, before, limit))


@admin_router.get("/players/{player_uuid}/activity")
def get_player_activity(player_uuid: str, request: Request, response: Response, before: str | None = None,
                        limit: int = Query(20, ge=1, le=100), kinds: str | None = None):
    return _players(request, response,
                    lambda config, viewer: players.player_activity(config, player_uuid, before, limit, kinds,
                                                                   viewer))


@admin_router.get("/players/{player_uuid}/movement")
def get_player_movement(player_uuid: str, request: Request, response: Response,
                        since: int | None = Query(None, ge=0, le=MAX_TIME),
                        until: int | None = Query(None, ge=0, le=MAX_TIME)):
    return _players(request, response,
                    lambda config, viewer: players.player_movement(config, player_uuid, since, until, viewer),
                    "view_player_movement")


@admin_router.get("/movement")
def get_movement(request: Request, response: Response,
                 since: int | None = Query(None, ge=0, le=MAX_TIME),
                 until: int | None = Query(None, ge=0, le=MAX_TIME)):
    return _players(request, response,
                    lambda config, viewer: players.everyone_movement(config, since, until, viewer),
                    "view_player_movement")


@admin_router.post("/accounts/{user_id}/role")
def post_role(user_id: int, body: RoleBody, request: Request, response: Response):
    _no_store(response)
    return _write(request, "account.role.change", user_id,
                  lambda token: admin.change_role(token, user_id, body.role, body.reason))


@admin_router.post("/accounts/{user_id}/sessions/revoke")
def post_revoke_sessions(user_id: int, body: ReasonBody, request: Request, response: Response):
    _no_store(response)
    return _write(request, "account.sessions.revoke", user_id,
                  lambda token: admin.revoke_sessions(token, user_id, body.reason))


# Request validation runs before the handlers above, so malformed writes are
# audited here: the action, the target and which fields failed, never values.
_WRITE_ROUTES = (
    (re.compile(r"^/admin/accounts/([^/]+)/role$"), "account.role.change"),
    (re.compile(r"^/admin/accounts/([^/]+)/sessions/revoke$"), "account.sessions.revoke"),
)


def _audit_invalid_write(request: Request, exc: RequestValidationError) -> None:
    if request.method != "POST":
        return
    for pattern, action in _WRITE_ROUTES:
        match = pattern.match(request.url.path)
        if match:
            break
    else:
        return
    try:
        actor = users.session_user(request.cookies.get(session_cookie(_config())))
    except HTTPException:
        return
    if actor is None:
        return
    raw_id = match.group(1)
    fields = sorted({".".join(str(part) for part in error.get("loc", ())[1:]) for error in exc.errors()})
    audit.record_refusal(
        actor=actor, action=action, outcome="invalid",
        detail={"error": "invalid_request", "fields": fields,
                "target_user_id": int(raw_id) if raw_id.isdigit() else None},
    )


async def _validation_handler(request: Request, exc: RequestValidationError):
    await run_in_threadpool(_audit_invalid_write, request, exc)
    return await request_validation_exception_handler(request, exc)


def install(app: FastAPI) -> None:
    """Mount the staff routes and audit their malformed writes."""
    app.include_router(admin_router)
    app.add_exception_handler(RequestValidationError, _validation_handler)
