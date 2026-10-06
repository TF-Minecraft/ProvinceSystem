"""Discord handles and server nicknames for linked players, looked up by user id.

Sign-in only reveals a player's own names, so links made through the game
(or before handles were checked) may know neither. With a bot token
(DISCORD_BOT_TOKEN, from the Discord application's Bot page) the site asks
Discord directly: the server member record gives the handle and the server
nickname when the bot is in the TFMC server (DISCORD_GUILD_ID); otherwise
the user record still gives the handle. Without a token nothing here runs.

Every link is refreshed on start and then every REFRESH_SECONDS, one request
at a time, waiting out rate limits; a profile with no known handle is looked
up as it is opened.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass

import httpx

from src.skins.db import connect
from src.skins.discord_link import remember_discord_nicknames, remember_discord_usernames

from .config import API_BASE_DEFAULT, SNOWFLAKE_MAX_LEN

logger = logging.getLogger(__name__)

REFRESH_SECONDS = 6 * 3600
# A profile waits at most this long for Discord.
PROFILE_TIMEOUT_SECONDS = 3.0
# One lookup per player per this long from profile views, whatever the answer.
PROFILE_RETRY_SECONDS = 600
# Longest rate-limit wait honoured before giving up on a request.
MAX_RETRY_WAIT_SECONDS = 30.0

_RECENT: dict[str, float] = {}
_RECENT_LOCK = threading.Lock()


@dataclass(frozen=True)
class BotConfig:
    token: str
    guild_id: str
    api_base: str

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    @classmethod
    def from_env(cls) -> BotConfig:
        return cls(
            token=os.getenv("DISCORD_BOT_TOKEN", "").strip(),
            guild_id=os.getenv("DISCORD_GUILD_ID", "").strip(),
            api_base=(os.getenv("DISCORD_API_BASE", "").strip() or API_BASE_DEFAULT).rstrip("/"),
        )


class BotTokenRejected(Exception):
    """Discord refused the bot token: stop until it is fixed, rather than ask again for every player."""


class NameLookup:
    def __init__(self, config: BotConfig, http: httpx.Client | None = None, timeout: float = 10.0):
        self.config = config
        self.http = http or httpx.Client(timeout=timeout)

    def close(self) -> None:
        self.http.close()

    def _get(self, path: str) -> httpx.Response | None:
        for _ in range(3):
            try:
                response = self.http.get(
                    f"{self.config.api_base}{path}",
                    headers={"Authorization": f"Bot {self.config.token}", "Accept": "application/json"},
                )
            except httpx.HTTPError:
                return None
            if response.status_code == 401:
                raise BotTokenRejected()
            if response.status_code != 429:
                return response
            try:
                wait = float(response.json().get("retry_after", 1.0))
            except (ValueError, AttributeError, TypeError):
                wait = 1.0
            if wait > MAX_RETRY_WAIT_SECONDS:
                return None
            time.sleep(wait)
        return None

    def lookup(self, discord_id: str) -> dict | None:
        """{"username", "nickname", "in_server"} for a user id, or None when Discord does not say."""
        if not discord_id.isdigit() or len(discord_id) > SNOWFLAKE_MAX_LEN:
            return None
        if self.config.guild_id:
            response = self._get(f"/guilds/{self.config.guild_id}/members/{discord_id}")
            if response is not None and response.status_code == 200:
                data = _json(response)
                user = data.get("user") if isinstance(data, dict) else None
                if isinstance(user, dict):
                    return {"username": user.get("username"), "nickname": data.get("nick"), "in_server": True}
            # 404: not in the server (or the bot is not); 403: the bot cannot see members. Fall back.
        response = self._get(f"/users/{discord_id}")
        if response is None or response.status_code != 200:
            return None
        data = _json(response)
        if not isinstance(data, dict):
            return None
        return {"username": data.get("username"), "nickname": None, "in_server": False}


def _json(response: httpx.Response):
    try:
        return response.json()
    except ValueError:
        return None


def store(discord_id: str, found: dict) -> None:
    """Keep what Discord said: the handle, and the nickname only if it answered as a server member."""
    remember_discord_usernames([{"discord_user_id": discord_id, "discord_username": found["username"]}], overwrite=True)
    if found["in_server"]:
        remember_discord_nicknames([{"discord_user_id": discord_id, "discord_nickname": found["nickname"]}])


def refresh_all(lookup: NameLookup) -> int:
    """Look up every linked player once; how many Discord answered for."""
    with connect() as conn:
        ids = [row["discord_user_id"] for row in conn.execute("SELECT discord_user_id FROM discord_links")]
    answered = 0
    for discord_id in ids:
        found = lookup.lookup(str(discord_id))
        if found:
            store(str(discord_id), found)
            answered += 1
    return answered


def refresh_one(discord_id: str) -> bool:
    """Look one player up now, if a bot token is set and they were not tried in the last PROFILE_RETRY_SECONDS."""
    config = BotConfig.from_env()
    if not config.enabled:
        return False
    now = time.monotonic()
    with _RECENT_LOCK:
        if now - _RECENT.get(discord_id, -PROFILE_RETRY_SECONDS) < PROFILE_RETRY_SECONDS:
            return False
        _RECENT[discord_id] = now
    lookup = NameLookup(config, timeout=PROFILE_TIMEOUT_SECONDS)
    try:
        found = lookup.lookup(discord_id)
    except BotTokenRejected:
        logger.warning("Discord rejected DISCORD_BOT_TOKEN; names are not looked up")
        return False
    finally:
        lookup.close()
    if not found:
        return False
    store(discord_id, found)
    return True


async def refresh_loop(stop: asyncio.Event) -> None:
    """Refresh every link's names on start and every REFRESH_SECONDS until stopped."""
    while not stop.is_set():
        config = BotConfig.from_env()
        lookup = NameLookup(config)
        try:
            answered = await asyncio.to_thread(refresh_all, lookup)
            logger.info("Discord names refreshed for %s links", answered)
        except BotTokenRejected:
            logger.warning("Discord rejected DISCORD_BOT_TOKEN; names are not looked up")
        except Exception:
            logger.exception("Discord name refresh failed")
        finally:
            lookup.close()
        try:
            await asyncio.wait_for(stop.wait(), timeout=REFRESH_SECONDS)
        except asyncio.TimeoutError:
            pass


def clear_recent() -> None:
    with _RECENT_LOCK:
        _RECENT.clear()
