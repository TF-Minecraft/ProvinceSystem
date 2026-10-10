"""Confirm TFMC server membership with the bot, so a signed-in player is not sent to sign in again.

Linking needs membership checked within GUILD_CHECK_MAX_AGE. Sign-in checks it; after
that the site asks Discord with DISCORD_BOT_TOKEN instead. Without a token, or when
Discord gives no clear answer, the session keeps its last check and the account page
offers a Discord sign-in instead.

One bot request runs at a time, so a request that arrives while another session's (or
its own) check is in flight waits for that answer rather than acting on the old one.
Discord's rate limits and outages pause every check; a session's own "not a member" or
unclear answer is reused for a short while, so reloading cannot flood Discord.
"""
from __future__ import annotations

import threading
import time

import httpx

from . import users
from .discord_names import BotConfig

TIMEOUT_SECONDS = 3.0
# A session's "not a member" answer is reused this long; it may have just joined.
NOT_MEMBER_REUSE_SECONDS = 15
# A session whose check got no clear answer is not asked about again for this long.
UNCLEAR_RETRY_SECONDS = 60
# Discord unreachable or failing: nobody is checked for this long.
OUTAGE_PAUSE_SECONDS = 30
# Discord's "Unknown Member" and "Unknown User": not in the server.
_NOT_MEMBER_CODES = {10007, 10013}
_RECENT_MAX = 2000

_STATE_LOCK = threading.Lock()
_CHECK_LOCK = threading.Lock()
_paused_until = 0.0
# session id -> (reuse until, answered): answered is True for "not a member", False for unclear.
_RECENT: dict[int, tuple[float, bool]] = {}


def _ask(discord_user_id: str, http: httpx.Client | None) -> tuple[bool | None, float]:
    """(member?, seconds to pause every check). Member is None when Discord does not say."""
    config = BotConfig.from_env()
    if not config.enabled or not config.guild_id or not discord_user_id.isdigit():
        return None, 0.0
    client = http or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = client.get(
            f"{config.api_base}/guilds/{config.guild_id}/members/{discord_user_id}",
            headers={"Authorization": f"Bot {config.token}", "Accept": "application/json"},
        )
    except httpx.HTTPError:
        return None, OUTAGE_PAUSE_SECONDS
    finally:
        if http is None:
            client.close()
    if response.status_code == 200:
        return True, 0.0
    body = _json(response)
    if response.status_code == 429:
        try:
            wait = float(body.get("retry_after", OUTAGE_PAUSE_SECONDS))
        except (AttributeError, TypeError, ValueError):
            wait = OUTAGE_PAUSE_SECONDS
        return None, max(wait, 1.0)
    if response.status_code == 404 and body.get("code") in _NOT_MEMBER_CODES:
        return False, 0.0
    return None, OUTAGE_PAUSE_SECONDS if response.status_code >= 500 else 0.0


def _json(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def member_now(discord_user_id: str, http: httpx.Client | None = None) -> bool | None:
    """Whether the user is in the TFMC server now, or None when Discord does not say."""
    return _ask(discord_user_id, http)[0]


def _with_check(user: dict, member: bool, checked_at: str | None) -> dict:
    return {**user, "guild_member": 1 if member else 0, "guild_checked_at": checked_at}


def _prune(now: float) -> None:
    for key in [k for k, (until, _) in _RECENT.items() if until <= now]:
        del _RECENT[key]
    if len(_RECENT) >= _RECENT_MAX:
        _RECENT.clear()


def check(user: dict, http: httpx.Client | None = None) -> tuple[dict, bool]:
    """The session user with the newest membership check, and whether that is a clear answer.

    False means Discord could not be asked (no bot token, paused or unclear), so only a
    new Discord sign-in can show a change.
    """
    global _paused_until
    if users.guild_check_fresh(user):
        return user, True
    session_id = user["session_id"]
    with _CHECK_LOCK:
        # A check that finished while this request waited is used as it is.
        state = users.guild_state(session_id)
        if state is not None:
            user = _with_check(user, bool(state["guild_member"]), state["guild_checked_at"])
            if users.guild_check_fresh(user):
                return user, True
        now = time.monotonic()
        with _STATE_LOCK:
            _prune(now)
            recent = _RECENT.get(session_id)
            if recent is not None:
                return user, recent[1]
            if now < _paused_until:
                return user, False
        member, pause = _ask(user["discord_user_id"], http)
        now = time.monotonic()
        with _STATE_LOCK:
            if pause:
                _paused_until = max(_paused_until, now + pause)
            if member is None:
                _RECENT[session_id] = (now + UNCLEAR_RETRY_SECONDS, False)
                return user, False
            if not member:
                _RECENT[session_id] = (now + NOT_MEMBER_REUSE_SECONDS, True)
        checked_at = users.record_guild_check(session_id, member)
        return _with_check(user, member, checked_at), True


def fresh(user: dict, http: httpx.Client | None = None) -> dict:
    """The session user with the newest membership check, asking the bot when theirs is stale."""
    return check(user, http)[0]


def clear() -> None:
    global _paused_until
    with _STATE_LOCK:
        _RECENT.clear()
        _paused_until = 0.0
