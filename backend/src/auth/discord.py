"""Synchronous, injectable Discord OAuth client. Never include response bodies in errors."""
from __future__ import annotations

import httpx

from .config import SNOWFLAKE_MAX_LEN, AuthConfig

SCOPES = "identify guilds.members.read"
_TEXT_MAX = 64


class DiscordError(RuntimeError):
    """A stable, non-sensitive failure code."""


def _text(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:_TEXT_MAX] if value else None


class DiscordClient:
    def __init__(self, config: AuthConfig, http: httpx.Client | None = None):
        self.config = config
        self.http = http or httpx.Client(timeout=10.0)

    def close(self) -> None:
        self.http.close()

    def exchange_code(self, code: str) -> str:
        try:
            response = self.http.post(
                f"{self.config.api_base}/oauth2/token",
                data={"grant_type": "authorization_code", "code": code, "redirect_uri": self.config.redirect_uri},
                auth=(self.config.client_id, self.config.client_secret),
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError:
            raise DiscordError("discord_http_failed") from None
        if response.status_code != 200:
            raise DiscordError("discord_exchange_failed")
        try:
            token = response.json()["access_token"]
        except (ValueError, KeyError, TypeError):
            raise DiscordError("discord_bad_token") from None
        if not isinstance(token, str) or not token:
            raise DiscordError("discord_bad_token")
        return token

    def _get(self, path: str, token: str) -> httpx.Response:
        try:
            return self.http.get(
                f"{self.config.api_base}{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
        except httpx.HTTPError:
            raise DiscordError("discord_http_failed") from None

    def identity(self, token: str) -> dict:
        response = self._get("/users/@me", token)
        if response.status_code != 200:
            raise DiscordError("discord_identity_failed")
        try:
            data = response.json()
            user_id = data["id"]
        except (ValueError, KeyError, TypeError):
            raise DiscordError("discord_bad_identity") from None
        # Snowflakes stay decimal strings end to end.
        if not isinstance(user_id, str) or not user_id.isdigit() or len(user_id) > SNOWFLAKE_MAX_LEN:
            raise DiscordError("discord_bad_identity")
        return {
            "discord_user_id": user_id,
            "discord_username": _text(data.get("username")),
            "discord_global_name": _text(data.get("global_name")),
            "discord_avatar": _text(data.get("avatar")),
        }

    def guild_member(self, token: str) -> dict | None:
        """The user's membership of the server, or None; members still on rules screening do not count.

        `nick` is their server nickname, None when they have not set one.
        """
        response = self._get(f"/users/@me/guilds/{self.config.guild_id}/member", token)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise DiscordError("discord_guild_check_failed")
        try:
            data = response.json()
            pending = data.get("pending")
        except (ValueError, AttributeError):
            raise DiscordError("discord_guild_check_failed") from None
        if pending is True:
            return None
        return {"nick": _text(data.get("nick"))}

    def is_guild_member(self, token: str) -> bool:
        """True for a full member; members still on rules screening do not count."""
        return self.guild_member(token) is not None

    def revoke(self, token: str) -> None:
        """Best effort: the site keeps no Discord tokens after sign-in."""
        try:
            self.http.post(
                f"{self.config.api_base}/oauth2/token/revoke",
                data={"token": token, "token_type_hint": "access_token"},
                auth=(self.config.client_id, self.config.client_secret),
            )
        except httpx.HTTPError:
            pass
