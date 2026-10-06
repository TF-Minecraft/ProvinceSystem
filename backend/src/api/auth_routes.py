"""Discord sign-in and the signed-in account: Minecraft and Patreon linking.

Sessions are HttpOnly cookies because the site and API share an origin.
Requests that change state must come from the site's own origin.
"""
from __future__ import annotations

import hmac
import logging
import os
import re
import time
from collections import defaultdict
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from src.api.prod_guard import is_production
from src.auth import users
from src.auth.config import AuthConfig
from src.auth.discord import DiscordClient, DiscordError
from src.patreon import linking as patreon_linking
from src.patreon import service as patreon_service
from src.patreon.config import Config as PatreonConfig
from src.skins.discord_link import (
    LinkError,
    complete_link,
    get_link_for_discord_id,
    preview_link,
    unlink_by_discord_id,
)

logger = logging.getLogger("auth")

auth_router = APIRouter(tags=["auth"])

_CODE_MAX = 32
_HEX12 = re.compile(r"[0-9A-F]{12}")
_LINK_RATE_LIMIT = 10
_LINK_RATE_WINDOW_SEC = 600.0
_LINK_RATE_BUCKETS: dict[int, list[float]] = defaultdict(list)
_LOCAL_HOSTS = {"localhost", "127.0.0.1"}


def session_cookie(config: AuthConfig) -> str:
    return "__Host-tfmc_session" if config.secure_cookies else "tfmc_session"


def state_cookie(config: AuthConfig) -> str:
    return "__Host-tfmc_discord_state" if config.secure_cookies else "tfmc_discord_state"


def build_client(config: AuthConfig) -> DiscordClient:
    return DiscordClient(config)


def _config() -> AuthConfig:
    config = AuthConfig.from_env()
    if not config.enabled or config.problems():
        raise HTTPException(503, detail="discord_auth_disabled")
    return config


def _no_store(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    return response


def _set_cookie(response: Response, config: AuthConfig, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path="/", httponly=True,
        secure=config.secure_cookies, samesite="lax",
    )


def _clear_cookie(response: Response, config: AuthConfig, name: str) -> None:
    response.delete_cookie(name, path="/", httponly=True, secure=config.secure_cookies, samesite="lax")


def _site_redirect(config: AuthConfig, path: str, **query: str) -> RedirectResponse:
    target = config.site_origin + path + ("?" + urlencode(query) if query else "")
    return _no_store(RedirectResponse(target, status_code=302))


def require_same_origin(request: Request, config: AuthConfig) -> None:
    """CSRF guard for cookie-authenticated writes.

    Browsers send Origin on every cross-origin and same-origin POST, so a
    missing header is refused. Local development also accepts other
    localhost ports, because the dev frontend and API run on separate ports.
    """
    if request.headers.get("sec-fetch-site", "same-origin") not in {"same-origin", "same-site"}:
        raise HTTPException(403, detail="cross_site_request")
    origin = (request.headers.get("origin") or "").strip()
    if origin and origin == config.site_origin:
        return
    if origin and not is_production():
        parts = urlsplit(origin)
        if parts.scheme == "http" and parts.hostname in _LOCAL_HOSTS:
            return
    raise HTTPException(403, detail="bad_origin")


def current_user(request: Request, config: AuthConfig) -> dict:
    user = users.session_user(request.cookies.get(session_cookie(config)))
    if user is None:
        raise HTTPException(401, detail="not_signed_in")
    return user


def _check_link_rate(user_id: int) -> None:
    now = time.monotonic()
    bucket = _LINK_RATE_BUCKETS[user_id]
    bucket[:] = [t for t in bucket if t > now - _LINK_RATE_WINDOW_SEC]
    if len(bucket) >= _LINK_RATE_LIMIT:
        raise HTTPException(429, detail="Too many link attempts; try again in a few minutes")
    bucket.append(now)


def normalise_code(value: str) -> str:
    """Accept pasted codes in any case, with or without the dashes."""
    raw = "".join((value or "").split()).upper()
    if len(raw) > _CODE_MAX:
        raise HTTPException(400, detail="Invalid link code")
    if _HEX12.fullmatch(raw):
        return f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"
    return raw


def _minecraft(user: dict) -> dict | None:
    link = get_link_for_discord_id(user["discord_user_id"])
    if link is None:
        return None
    return {key: link[key] for key in ("player_uuid", "minecraft_name", "linked_at", "in_grace", "grace_until")}


def _patreon(user: dict) -> dict | None:
    if not PatreonConfig.from_env().enabled:
        return None
    return patreon_service.status(discord_user_id=user["discord_user_id"])


# --------------------
# Sign-in
# --------------------

@auth_router.get("/auth/discord/start")
def discord_start(return_to: str | None = None):
    config = _config()
    state, url = users.start_sign_in(config, return_to)
    response = _no_store(RedirectResponse(url, status_code=302))
    _set_cookie(response, config, state_cookie(config), state, int(users.STATE_TTL.total_seconds()))
    return response


@auth_router.get("/auth/discord/callback")
def discord_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    config = _config()
    cookie_state = request.cookies.get(state_cookie(config)) or ""
    status, return_to, token = "error", users.RETURN_DEFAULT, None
    if state and cookie_state and hmac.compare_digest(cookie_state, state):
        saved = users.consume_state(state)
        if saved is None:
            status = "expired"
        elif error is not None:
            status, return_to = "denied", saved
        else:
            return_to = saved
            token = _finish_sign_in(config, code)
            status = "ok" if token else "error"
    else:
        status = "expired"
    logger.info("Discord sign-in callback status=%s", status)
    response = (
        _site_redirect(config, return_to) if token
        else _site_redirect(config, users.RETURN_DEFAULT, signin=status)
    )
    _clear_cookie(response, config, state_cookie(config))
    if token:
        _set_cookie(response, config, session_cookie(config), token, int(users.SESSION_TTL.total_seconds()))
    return response


def _finish_sign_in(config: AuthConfig, code: str | None) -> str | None:
    if not code or len(code) > 512 or any(ch.isspace() for ch in code):
        return None
    client = build_client(config)
    try:
        access_token = client.exchange_code(code)
        try:
            identity = client.identity(access_token)
            member = None
            try:
                member = client.guild_member(access_token)
                guild_member = member is not None
            except DiscordError as exc:
                # Sign-in still works; linking asks for a fresh check.
                logger.warning("Discord guild check failed code=%s", exc)
                guild_member = False
        finally:
            client.revoke(access_token)
    except DiscordError as exc:
        logger.warning("Discord sign-in failed code=%s", exc)
        return None
    finally:
        client.close()
    return users.sign_in(identity, guild_member=guild_member, member=member)


@auth_router.post("/auth/logout")
def logout(request: Request):
    config = _config()
    require_same_origin(request, config)
    users.revoke_session(request.cookies.get(session_cookie(config)))
    response = _no_store(Response(content='{"ok":true}', media_type="application/json"))
    _clear_cookie(response, config, session_cookie(config))
    return response


# --------------------
# Account
# --------------------

class CodeBody(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)


@auth_router.get("/account")
def get_account(request: Request, response: Response):
    config = _config()
    user = current_user(request, config)
    _no_store(response)
    return {
        "user": {
            "discord_user_id": user["discord_user_id"],
            "discord_username": user["discord_username"],
            "discord_global_name": user["discord_global_name"],
            "avatar_url": users.avatar_url(user),
            "role": user["role"],
        },
        "guild": {
            "member": bool(user["guild_member"]),
            "checked_at": user["guild_checked_at"],
            "fresh": users.guild_check_fresh(user),
        },
        "minecraft": _minecraft(user),
        "patreon": _patreon(user),
    }


@auth_router.post("/account/minecraft/preview")
def minecraft_preview(request: Request, body: CodeBody, response: Response):
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    _check_link_rate(user["user_id"])
    _no_store(response)
    try:
        return preview_link(normalise_code(body.code))
    except LinkError as e:
        raise HTTPException(400, detail=str(e)) from e


@auth_router.post("/account/minecraft/link")
def minecraft_link(request: Request, body: CodeBody, response: Response):
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    _check_link_rate(user["user_id"])
    # A link grants server access, so it needs proof of current membership.
    if not user["guild_member"]:
        raise HTTPException(403, detail="not_guild_member")
    if not users.guild_check_fresh(user):
        raise HTTPException(403, detail="guild_check_stale")
    _no_store(response)
    try:
        complete_link(normalise_code(body.code), user["discord_user_id"], user["discord_username"])
    except LinkError as e:
        raise HTTPException(400, detail=str(e)) from e
    return {"minecraft": _minecraft(user)}


@auth_router.post("/account/minecraft/unlink")
def minecraft_unlink(request: Request, response: Response):
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    _no_store(response)
    try:
        unlink_by_discord_id(user["discord_user_id"])
    except LinkError as e:
        raise HTTPException(400, detail=str(e)) from e
    return {"minecraft": None}


@auth_router.post("/account/patreon/start")
def patreon_start(request: Request, response: Response):
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    if not PatreonConfig.from_env().enabled:
        raise HTTPException(503, detail="patreon_disabled")
    if not os.getenv("PATREON_CLIENT_ID", "").strip():
        raise HTTPException(503, detail="patreon_client_unconfigured")
    _no_store(response)
    try:
        # The subject and its name come only from the signed-in user.
        return patreon_linking.start_link(
            discord_user_id=user["discord_user_id"],
            discord_username=user["discord_username"] or user["discord_global_name"],
        )
    except patreon_service.ServiceError as e:
        raise HTTPException(400, detail=str(e)) from e
