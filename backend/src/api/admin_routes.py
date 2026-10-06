"""Staff panel API. Every route checks the caller's role on the server.

Reads need a staff role. Writes also need the site's own origin, and the
service re-checks the actor and target inside the write; refusals by a
signed-in caller are audited.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from src.api.auth_routes import _config, _no_store, current_user, require_same_origin, session_cookie
from src.auth import admin, audit, roles, users

admin_router = APIRouter(prefix="/admin", tags=["admin"])


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
