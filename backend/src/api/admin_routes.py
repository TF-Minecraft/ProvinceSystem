"""Staff panel API. Every route checks the caller's role on the server.

Reads need a staff role. Writes also need the site's own origin, and the
service re-checks the actor and target inside the write; refusals by a
signed-in caller are audited.
"""
from __future__ import annotations

import json
import re
import urllib.parse

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, StrictBool
from starlette.concurrency import run_in_threadpool

from src.api.auth_routes import (
    _config,
    _no_store,
    _set_cookie,
    current_user,
    require_same_origin,
    seconds_left,
    session_cookie,
    staff_cookie,
)
from src.auth import admin, audit, players, roles, users, view_as
from src.coreprotect.reader import CoreProtectConfig
from src.rail import network as rail
from src.servers import inventory as servers
from src.servers import control as server_control
from src.skins.db import connect
from src.characters.creation_catalog import get_catalog
from src.auth.users import session_user_in
from src.scripts.util.dirs import validate_map

admin_router = APIRouter(prefix="/admin", tags=["admin"])

# Unix seconds well past any real window; keeps query values inside SQLite's integers.
MAX_TIME = 2 ** 40


class RoleBody(BaseModel):
    role: str = Field(..., max_length=16)
    reason: str = Field(..., max_length=admin.REASON_MAX * 2)


class ReasonBody(BaseModel):
    reason: str = Field(..., max_length=admin.REASON_MAX * 2)


class ServerPlanBody(BaseModel):
    mode: str = Field(..., pattern=r"^(restart|latest)$")


class ServerJobBody(ReasonBody):
    id: str = Field(..., pattern=r"^[0-9a-f]{32}$")
    emergency_override: StrictBool = False
    replace_test_builds: list[str] = Field(default_factory=list, max_length=100)


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


def _write(request: Request, action: str, target: dict, run):
    config = _config()
    token = request.cookies.get(session_cookie(config))
    try:
        require_same_origin(request, config)
    except HTTPException as exc:
        actor = users.session_user(token)
        if actor is not None:
            audit.record_refusal(actor=actor, action=action, outcome="denied",
                                 detail={"error": exc.detail, **target})
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
def get_players(request: Request, response: Response, q: str = "", view: str = "minecraft", sort: str = "name",
                order: str = "asc", page: int = Query(1, ge=1, le=10_000)):
    return _players(request, response,
                    lambda config, _viewer: players.directory(config, q, view, sort, order, page))


@admin_router.get("/players/{player_uuid}")
def get_player(player_uuid: str, request: Request, response: Response):
    return _players(request, response, lambda config, _viewer: players.profile(config, player_uuid))


@admin_router.get("/characters/creation-catalog")
def get_player_character_catalog(request: Request, response: Response):
    _capable(request, "view_players")
    _no_store(response)
    return get_catalog()


@admin_router.get("/players/{player_uuid}/sessions")
def get_player_sessions(player_uuid: str, request: Request, response: Response, before: str | None = None,
                        limit: int = Query(20, ge=1, le=100)):
    return _players(request, response,
                    lambda config, _viewer: players.player_sessions(config, player_uuid, before, limit))


@admin_router.get("/players/{player_uuid}/characters/{character_id:path}/{kind}")
def get_player_character_picture(player_uuid: str, character_id: str, kind: str, request: Request,
                                 realm_id: str = "main"):
    _capable(request, "view_players")
    if kind not in {"face", "figure"}:
        raise HTTPException(404, detail="not_found")
    try:
        png = players.character_picture(player_uuid, realm_id, character_id, kind)
    except players.PlayerError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None
    response = Response(png, media_type="image/png")
    _no_store(response)
    return response


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


@admin_router.get("/players/{player_uuid}/sessions/{session_id}/movement")
def get_session_movement(player_uuid: str, session_id: str, request: Request, response: Response):
    return _players(request, response,
                    lambda config, viewer: players.session_movement(config, player_uuid, session_id, viewer),
                    "view_player_movement")


@admin_router.get("/movement")
def get_movement(request: Request, response: Response,
                 since: int | None = Query(None, ge=0, le=MAX_TIME),
                 until: int | None = Query(None, ge=0, le=MAX_TIME)):
    return _players(request, response,
                    lambda config, viewer: players.everyone_movement(config, since, until, viewer),
                    "view_player_movement")


@admin_router.get("/rail")
def get_rail(request: Request, response: Response, map: str = Query("main", max_length=32)):
    _capable(request, "view_rail")
    _no_store(response)
    try:
        validate_map(map)
    except ValueError:
        raise HTTPException(400, detail="bad_map") from None
    try:
        return rail.load_network(rail.RailConfig.from_env(), map)
    except rail.RailUnavailable as exc:
        return {"status": exc.code, "world": rail.RailConfig.from_env().world, "updated_at": None,
                "unreadable_files": 0, "lines": [], "tracks": [], "junctions": [], "stops": []}


@admin_router.get("/servers")
def get_servers(request: Request, response: Response):
    _capable(request, "view_servers")
    _no_store(response)
    return servers.overview()


@admin_router.get("/servers/control")
def get_server_control(request: Request, response: Response):
    _capable(request, "view_servers")
    _no_store(response)
    return server_control.status()


@admin_router.post("/servers/{server}/plan")
def plan_server(server: str, body: ServerPlanBody, request: Request, response: Response):
    _capable(request, "manage_servers")
    require_same_origin(request, _config())
    _no_store(response)
    try:
        return server_control.plan(server, body.mode)
    except server_control.ControlError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None


def _server_write(request: Request, server: str, operation: str, body: ServerJobBody):
    action = "server." + operation
    actor = None
    config = _config()
    token = request.cookies.get(session_cookie(config))
    try:
        # Recheck role and session under the same write lock as the audit entry.
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            actor = session_user_in(conn, token)
            if actor is None:
                raise HTTPException(401, detail="not_signed_in")
            require_same_origin(request, config)
            if not roles.can(actor["role"], "manage_servers") or actor.get("acting_user_id"):
                raise HTTPException(403, detail="forbidden")
            reason = admin.clean_reason(body.reason)
            if body.emergency_override and (server != "main" or operation != "start"):
                raise HTTPException(400, detail="bad_server_action")
            if body.replace_test_builds and operation != "start":
                raise HTTPException(400, detail="bad_server_action")
            detail = {"server": server, "job_id": body.id}
            if operation == "start":
                detail["emergency_override"] = body.emergency_override
                detail["replace_test_builds"] = body.replace_test_builds
            # Record the intent before crossing the process boundary. The host
            # persists the accepted job; the same id can safely be retried.
            audit.record(conn, actor=actor, action=action, outcome="requested", reason=reason, detail=detail)
            conn.commit()
        result = server_control.request(operation, server=server,
                                        **{"plan_id" if operation == "start" else "job_id": body.id},
                                        **({"emergency_override": body.emergency_override} if operation == "start" else {}),
                                        # Sent only when used, so an older host helper still accepts plain starts.
                                        **({"replace_test_builds": body.replace_test_builds} if body.replace_test_builds else {}),
                                        actor=f"{urllib.parse.urlparse(config.site_url).hostname}:user:{actor['user_id']}", reason=reason)
        audit.record_refusal(actor=actor, action=action, outcome="ok", reason=reason, detail=detail)
        return result
    except (HTTPException, admin.AdminError, server_control.ControlError) as exc:
        code = exc.detail if isinstance(exc, HTTPException) else exc.code
        status = exc.status_code if isinstance(exc, HTTPException) else exc.status
        if actor is not None:
            audit.record_refusal(actor=actor, action=action, outcome="denied" if status in {401, 403} else "failed",
                                 detail={"server": server, "job_id": body.id, "error": code})
        raise HTTPException(status, detail=code) from None


@admin_router.post("/servers/{server}/start")
def start_server(server: str, body: ServerJobBody, request: Request, response: Response):
    _no_store(response)
    return _server_write(request, server, "start", body)


@admin_router.post("/servers/{server}/cancel")
def cancel_server(server: str, body: ServerJobBody, request: Request, response: Response):
    _no_store(response)
    return _server_write(request, server, "cancel", body)


@admin_router.post("/servers/{server}/reopen")
def reopen_server(server: str, body: ServerJobBody, request: Request, response: Response):
    _no_store(response)
    return _server_write(request, server, "reopen", body)


@admin_router.post("/servers/{server}/resolve")
def resolve_server(server: str, body: ServerJobBody, request: Request, response: Response):
    _no_store(response)
    return _server_write(request, server, "resolve", body)


@admin_router.post("/accounts/{user_id}/role")
def post_role(user_id: int, body: RoleBody, request: Request, response: Response):
    _no_store(response)
    return _write(request, "account.role.change", {"target_user_id": user_id},
                  lambda token: admin.change_role(token, user_id, body.role, body.reason))


@admin_router.post("/accounts/{user_id}/sessions/revoke")
def post_revoke_sessions(user_id: int, body: ReasonBody, request: Request, response: Response):
    _no_store(response)
    return _write(request, "account.sessions.revoke", {"target_user_id": user_id},
                  lambda token: admin.revoke_sessions(token, user_id, body.reason))


@admin_router.post("/players/{player_uuid}/view-as")
def post_view_as(player_uuid: str, request: Request):
    """View the site as a player: their session, view only, while the admin's own waits in a cookie."""
    config = _config()
    staff = request.cookies.get(session_cookie(config))
    view = _write(request, "account.view_as.start", {"player_uuid": player_uuid[:64]},
                  lambda token: view_as.start(token, player_uuid))
    response = _no_store(Response(content=json.dumps({"expires_at": view["expires_at"], "return_to": "/profile"}),
                                  media_type="application/json"))
    _set_cookie(response, config, session_cookie(config), view["token"], seconds_left(view["expires_at"]))
    _set_cookie(response, config, staff_cookie(config), staff, seconds_left(view["staff_expires_at"]))
    return response


# Request validation runs before the handlers above, so malformed writes are
# audited here: the action, the target and which fields failed, never values.
_WRITE_ROUTES = (
    (re.compile(r"^/admin/servers/[^/]+/start$"), "server.start"),
    (re.compile(r"^/admin/servers/[^/]+/cancel$"), "server.cancel"),
    (re.compile(r"^/admin/servers/[^/]+/reopen$"), "server.reopen"),
    (re.compile(r"^/admin/servers/[^/]+/resolve$"), "server.resolve"),
    (re.compile(r"^/admin/accounts/([^/]+)/role$"), "account.role.change"),
    (re.compile(r"^/admin/accounts/([^/]+)/sessions/revoke$"), "account.sessions.revoke"),
    (re.compile(r"^/admin/luckperms/changes$"), "luckperms.change"),
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
    raw_id = match.group(1) if match.groups() else ""
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
    from src.api.database_routes import database_router
    from src.api.luckperms_routes import plugin_router, staff_router

    app.include_router(admin_router)
    app.include_router(database_router)
    app.include_router(staff_router)
    app.include_router(plugin_router)
    app.add_exception_handler(RequestValidationError, _validation_handler)
