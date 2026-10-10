"""Discord sign-in and the signed-in account: Minecraft and Patreon linking.

Sessions are HttpOnly cookies because the site and API share an origin.
Requests that change state must come from the site's own origin.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import secrets
import time
from collections import defaultdict
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from src.api.prod_guard import is_production
from src.auth import account_overview, guild_check, preview_sign_in, users
from src.auth.config import AuthConfig
from src.auth import microsoft_link
from src.auth.discord import DiscordClient, DiscordError
from src.auth.microsoft import MicrosoftClient, MicrosoftConfig, MicrosoftError
from src.patreon import linking as patreon_linking
from src.patreon import service as patreon_service
from src.patreon.config import Config as PatreonConfig
from src.skins.codes import start_linked_profile_session
from src.skins.discord_link import (
    LinkError,
    complete_link,
    get_link_for_discord_id,
    link_verified_profile,
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


def microsoft_state_cookie(config: AuthConfig) -> str:
    return "__Host-tfmc_microsoft_state" if config.secure_cookies else "tfmc_microsoft_state"


def build_client(config: AuthConfig) -> DiscordClient:
    return DiscordClient(config)


def build_microsoft_client(config: MicrosoftConfig) -> MicrosoftClient:
    return MicrosoftClient(config)


def _config() -> AuthConfig:
    config = AuthConfig.from_env()
    if not (config.enabled or config.via_site) or config.problems():
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
    return {key: link.get(key) for key in
            ("player_uuid", "minecraft_name", "linked_at", "in_grace", "grace_until", "link_method")}


def _patreon(user: dict) -> dict | None:
    if not PatreonConfig.from_env().enabled:
        return None
    return patreon_service.status(discord_user_id=user["discord_user_id"])


# --------------------
# Sign-in
# --------------------

@auth_router.get("/auth/discord/start")
def discord_start(request: Request, return_to: str | None = None):
    config = _config()
    if config.via_site:
        return _preview_start(request, config, return_to)
    state, url = users.start_sign_in(config, return_to)
    response = _no_store(RedirectResponse(url, status_code=302))
    _set_cookie(response, config, state_cookie(config), state, int(users.STATE_TTL.total_seconds()))
    return response


@auth_router.get("/auth/discord/callback")
def discord_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    config = _config()
    if config.via_site:
        raise HTTPException(404, detail="Not Found")
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


# --------------------
# Branch previews sign in through dev (src/auth/preview_sign_in.py)
# --------------------

PREVIEW_START_PATH = "/api/auth/preview/start"
PREVIEW_CALLBACK_PATH = "/api/auth/preview/callback"


def _preview_start(request: Request, config: AuthConfig, return_to: str | None) -> Response:
    """On a preview: send the browser to the sign-in site, which returns it with a ticket.

    Signing in again while signed in is "I've joined, check again", so dev must not hand
    back the check it already has.
    """
    state = secrets.token_urlsafe(32)
    params = {"site": config.site_origin, "state": state, "return_to": users.clean_return_to(return_to)}
    if users.session_user(request.cookies.get(session_cookie(config))) is not None:
        params["recheck"] = "1"
    query = urlencode(params)
    response = _no_store(RedirectResponse(f"{config.sign_in_site}{PREVIEW_START_PATH}?{query}", status_code=302))
    _set_cookie(response, config, state_cookie(config), state, int(users.STATE_TTL.total_seconds()))
    return response


@auth_router.get("/auth/preview/start")
def preview_start(
    request: Request,
    site: str | None = None,
    state: str | None = None,
    return_to: str | None = None,
    recheck: str | None = None,
):
    """On dev: hand the signed-in player to a preview, signing them in here first if needed."""
    config = _config()
    target = preview_sign_in.preview_site(site)
    if config.via_site or target is None or not preview_sign_in.valid_token(state):
        raise HTTPException(404, detail="Not Found")
    back = users.clean_return_to(return_to)
    # Discord's callback returns the browser here, now signed in and freshly checked.
    again = PREVIEW_START_PATH + "?" + urlencode({"site": target, "state": state, "return_to": back})
    if users.clean_return_to(again) != again:
        again = PREVIEW_START_PATH + "?" + urlencode({"site": target, "state": state})
    user = users.session_user(request.cookies.get(session_cookie(config)))
    if user is None:
        return discord_start(request, again)
    # Linking on the preview needs a recent check, and only dev can make one: with the
    # bot, or else by signing in again. `again` drops recheck, so this ends.
    user, answered = guild_check.check(user)
    if not answered and (recheck == "1" or not users.guild_check_recent(user)):
        return discord_start(request, again)
    ticket = preview_sign_in.issue(target, user)
    logger.info("Preview sign-in ticket user_id=%s site=%s", user["user_id"], target)
    query = urlencode({"ticket": ticket, "state": state, "return_to": back})
    response = _no_store(RedirectResponse(f"{target}{PREVIEW_CALLBACK_PATH}?{query}", status_code=302))
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class RedeemBody(BaseModel):
    ticket: str = Field(..., max_length=256)
    site: str = Field(..., max_length=256)


@auth_router.post("/auth/preview/redeem")
def preview_redeem(body: RedeemBody, response: Response):
    """On dev: the preview's backend trades a ticket for the player it carries."""
    config = _config()
    site = preview_sign_in.preview_site(body.site)
    if config.via_site or site is None:
        raise HTTPException(404, detail="Not Found")
    player = preview_sign_in.redeem(body.ticket, site)
    if player is None:
        raise HTTPException(410, detail="ticket_invalid")
    _no_store(response)
    return player


@auth_router.get("/auth/preview/callback")
def preview_callback(
    request: Request, ticket: str | None = None, state: str | None = None, return_to: str | None = None
):
    """On a preview: open a session for the player dev's ticket carries."""
    config = _config()
    if not config.via_site:
        raise HTTPException(404, detail="Not Found")
    cookie_state = request.cookies.get(state_cookie(config)) or ""
    status, token = "expired", None
    if (
        preview_sign_in.valid_token(state)
        and preview_sign_in.valid_token(cookie_state)
        and hmac.compare_digest(cookie_state, state)
        and preview_sign_in.valid_token(ticket)
    ):
        player = preview_sign_in.fetch_player(config, ticket)
        token = preview_sign_in.sign_in(player) if player else None
        status = "ok" if token else "error"
    logger.info("Preview sign-in callback status=%s", status)
    response = (
        _site_redirect(config, users.clean_return_to(return_to)) if token
        else _site_redirect(config, users.RETURN_DEFAULT, signin=status)
    )
    # The ticket is in this URL; keep it out of the next page's Referer.
    response.headers["Referrer-Policy"] = "no-referrer"
    _clear_cookie(response, config, state_cookie(config))
    if token:
        _set_cookie(response, config, session_cookie(config), token, int(users.SESSION_TTL.total_seconds()))
    return response


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
    minecraft = _minecraft(user)
    # Only linking needs a recent check, so only unlinked players wait for one.
    user, answered = guild_check.check(user) if minecraft is None else (user, True)
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
            # False when Discord could not be asked: only a new sign-in can show a change.
            "can_recheck": answered,
        },
        "minecraft": minecraft,
        "microsoft_link": MicrosoftConfig.from_env().usable,
        "patreon": _patreon(user),
    }


def _linked_player(user: dict) -> str:
    link = get_link_for_discord_id(user["discord_user_id"])
    if link is None:
        raise HTTPException(409, detail="minecraft_not_linked")
    return link["player_uuid"]


@auth_router.get("/account/overview")
def get_account_overview(request: Request, response: Response):
    """Rank and time on the server for the linked Minecraft account; parts are null when unknown."""
    config = _config()
    user = current_user(request, config)
    _no_store(response)
    link = get_link_for_discord_id(user["discord_user_id"])
    if link is None:
        return {"activity": None, "rank": None}
    return {
        "activity": account_overview.activity(link["player_uuid"]),
        "rank": account_overview.rank(link["player_uuid"]),
    }


@auth_router.get("/account/minecraft/head")
def get_minecraft_head(request: Request):
    """The linked player's skin face. Only your own, so the site is no open Mojang proxy."""
    config = _config()
    user = current_user(request, config)
    png = account_overview.head(_linked_player(user))
    if png is None:
        raise HTTPException(404, detail="head_unavailable")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@auth_router.post("/account/profile-session")
def profile_session(request: Request, response: Response):
    """Open Profile for the linked Minecraft account, in place of an in-game code."""
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    _no_store(response)
    player_uuid = _linked_player(user)
    _check_link_rate(user["user_id"])
    logger.info("Profile session from Discord user_id=%s player_uuid=%s", user["user_id"], player_uuid)
    return start_linked_profile_session(player_uuid)


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
    user = guild_check.fresh(user)
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


# Callback outcomes the account page explains; anything else reads as "error".
_MICROSOFT_OUTCOMES = {
    "no_xbox_profile", "xbox_child_account", "xbox_region_blocked", "xbox_adult_verification", "no_java_profile",
}
_LINK_CONFLICTS = {
    "This Discord account is already linked to a different Minecraft player": "discord_taken",
    "This Minecraft account is already linked to a different Discord account": "minecraft_taken",
    "This link attempt is no longer valid": "expired",
}


@auth_router.post("/account/minecraft/microsoft/start")
def minecraft_microsoft_start(request: Request):
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    microsoft = MicrosoftConfig.from_env()
    if not microsoft.usable:
        raise HTTPException(503, detail="microsoft_link_disabled")
    _check_link_rate(user["user_id"])
    user = guild_check.fresh(user)
    if not user["guild_member"]:
        raise HTTPException(403, detail="not_guild_member")
    if not users.guild_check_fresh(user):
        raise HTTPException(403, detail="guild_check_stale")
    if get_link_for_discord_id(user["discord_user_id"]) is not None:
        raise HTTPException(409, detail="already_linked")
    state, url = microsoft_link.start(microsoft, user)
    response = _no_store(Response(content=json.dumps({"authorize_url": url}), media_type="application/json"))
    _set_cookie(response, config, microsoft_state_cookie(config), state, int(microsoft_link.STATE_TTL.total_seconds()))
    return response


@auth_router.get("/auth/microsoft/callback")
def microsoft_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    config = _config()
    cookie_state = request.cookies.get(microsoft_state_cookie(config)) or ""
    outcome = _microsoft_outcome(request, config, code, state, error, cookie_state)
    logger.info("Microsoft link callback outcome=%s", outcome)
    response = _site_redirect(config, users.RETURN_DEFAULT, minecraft=outcome)
    # The authorisation code is in this URL; keep it out of the next page's Referer.
    response.headers["Referrer-Policy"] = "no-referrer"
    _clear_cookie(response, config, microsoft_state_cookie(config))
    return response


def _microsoft_outcome(request, config, code, state, error, cookie_state) -> str:
    if not (
        microsoft_link.valid_state(state)
        and microsoft_link.valid_state(cookie_state)
        and hmac.compare_digest(cookie_state, state)
    ):
        return "expired"
    saved = microsoft_link.consume(state)
    if saved is None:
        return "expired"
    try:
        return _finish_microsoft_link(request, config, code, error, saved)
    finally:
        microsoft_link.finish(saved)


def _finish_microsoft_link(request, config, code, error, saved) -> str:
    user = users.session_user(request.cookies.get(session_cookie(config)))
    if user is None or user["session_id"] != saved["session_id"]:
        return "expired"
    if error is not None:
        return "denied"
    microsoft = MicrosoftConfig.from_env()
    if not microsoft.usable:
        return "unavailable"
    user = guild_check.fresh(user)
    if not user["guild_member"]:
        return "not_guild_member"
    if not users.guild_check_fresh(user):
        return "guild_check_stale"
    if not code or len(code) > 2048 or not code.isascii() or not code.isprintable() or " " in code:
        return "error"
    client = build_microsoft_client(microsoft)
    try:
        profile = client.java_profile(code, saved["code_verifier"])
    except MicrosoftError as exc:
        logger.warning("Microsoft link failed code=%s", exc)
        return str(exc) if str(exc) in _MICROSOFT_OUTCOMES else "error"
    finally:
        client.close()
    try:
        link_verified_profile(
            profile["player_uuid"],
            profile["minecraft_name"],
            user["discord_user_id"],
            user["discord_username"],
            still_allowed=lambda conn: microsoft_link.still_valid(conn, saved),
        )
    except LinkError as exc:
        return _LINK_CONFLICTS.get(str(exc), "error")
    logger.info("Minecraft linked by Microsoft user_id=%s player_uuid=%s", user["user_id"], profile["player_uuid"])
    return "linked"


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


@auth_router.post("/account/patreon/unlink")
def patreon_unlink(request: Request, response: Response):
    config = _config()
    require_same_origin(request, config)
    user = current_user(request, config)
    if not PatreonConfig.from_env().enabled:
        raise HTTPException(503, detail="patreon_disabled")
    _no_store(response)
    try:
        return patreon_service.unlink(discord_user_id=user["discord_user_id"])
    except patreon_service.ServiceError as e:
        raise HTTPException(400, detail=str(e)) from e


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
