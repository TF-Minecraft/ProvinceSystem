"""Confirm TFMC server membership with the bot, so a signed-in player is not sent to sign in again.

Linking needs membership checked within GUILD_CHECK_MAX_AGE. Sign-in checks it; after
that the site asks Discord with DISCORD_BOT_TOKEN instead. Without a token, or when
Discord gives no clear answer, the session keeps its last check.
"""
from __future__ import annotations

import threading
import time

import httpx

from . import users
from .discord_names import BotConfig

TIMEOUT_SECONDS = 3.0
# After an unclear answer, the same session is not asked about again for this long.
RETRY_SECONDS = 60
# Discord's "Unknown Member" and "Unknown User": not in the server.
_NOT_MEMBER_CODES = {10007, 10013}

_TRIED: dict[int, float] = {}
_TRIED_LOCK = threading.Lock()


def member_now(discord_user_id: str, http: httpx.Client | None = None) -> bool | None:
    """Whether the user is in the TFMC server now, or None when Discord does not say."""
    config = BotConfig.from_env()
    if not config.enabled or not config.guild_id or not discord_user_id.isdigit():
        return None
    client = http or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = client.get(
            f"{config.api_base}/guilds/{config.guild_id}/members/{discord_user_id}",
            headers={"Authorization": f"Bot {config.token}", "Accept": "application/json"},
        )
    except httpx.HTTPError:
        return None
    finally:
        if http is None:
            client.close()
    if response.status_code == 200:
        return True
    if response.status_code == 404:
        try:
            code = response.json().get("code")
        except (ValueError, AttributeError):
            return None
        return False if code in _NOT_MEMBER_CODES else None
    return None


def fresh(user: dict, http: httpx.Client | None = None) -> dict:
    """The session user with a recent membership check, asking the bot when theirs is stale."""
    if users.guild_check_fresh(user):
        return user
    now = time.monotonic()
    with _TRIED_LOCK:
        if now - _TRIED.get(user["session_id"], -RETRY_SECONDS) < RETRY_SECONDS:
            return user
        _TRIED[user["session_id"]] = now
    member = member_now(user["discord_user_id"], http)
    if member is None:
        return user
    with _TRIED_LOCK:
        _TRIED.pop(user["session_id"], None)
    checked_at = users.record_guild_check(user["session_id"], member)
    return {**user, "guild_member": 1 if member else 0, "guild_checked_at": checked_at}


def clear() -> None:
    with _TRIED_LOCK:
        _TRIED.clear()
