"""Discord sign-in for branch previews, through the dev site.

Discord only returns players to addresses registered with it, so a preview at
https://<slug>.tfminecraft.net cannot run Discord sign-in itself. Dev does it
for them: the preview sends the browser to dev, dev signs the player in (or
uses the session it already has) and sends them back with a single-use ticket.
The preview redeems the ticket with dev for the player's identity, role and
membership check, and opens its own session. Previews never hold the Discord
secret.

Dev sets PREVIEW_SIGN_IN_DOMAIN and hands tickets only to preview hosts under
it. A preview sets SIGN_IN_SITE to dev's address.
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

import httpx

from src.skins.codes import hash_secret
from src.skins.db import connect

from . import users
from .config import SNOWFLAKE_MAX_LEN, AuthConfig
from .roles import ROLES

TICKET_TTL = timedelta(seconds=120)
TIMEOUT_SECONDS = 10.0
REDEEM_PATH = "/api/auth/preview/redeem"
_TOKEN = re.compile(r"[A-Za-z0-9_-]{16,256}")
# Matches ps-preview and .github/scripts/preview_slug.py.
_SLUG = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?")
_RESERVED = {"www", "dev", "api", "mail", "map", "admin", "staff", "play", "mc", "status", "preview", "t3"}
_TEXT_MAX = 64


def valid_token(value: str | None) -> bool:
    return bool(value) and _TOKEN.fullmatch(value) is not None


def preview_site(value: str | None) -> str | None:
    """The preview origin dev may send a ticket to, or None."""
    domain = os.getenv("PREVIEW_SIGN_IN_DOMAIN", "").strip().lower()
    if not domain or not value:
        return None
    parts = urlsplit(value)
    host = parts.hostname or ""
    slug, _, rest = host.partition(".")
    if (
        parts.scheme != "https"
        or parts.netloc != host
        or parts.path
        or parts.query
        or parts.fragment
        or rest != domain
        or not _SLUG.fullmatch(slug)
        or slug in _RESERVED
    ):
        return None
    return f"https://{host}"


def issue(site: str, user: dict) -> str:
    """A ticket for the signed-in dev user, redeemable once by that preview."""
    ticket = secrets.token_urlsafe(32)
    now = users._utcnow()
    with connect() as conn:
        conn.execute("DELETE FROM preview_sign_in_tickets WHERE expires_at <= ?", (users._iso(now),))
        conn.execute(
            """
            INSERT INTO preview_sign_in_tickets
                (ticket_hash, site, user_id, guild_member, guild_checked_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                hash_secret(ticket), site, user["user_id"], 1 if user["guild_member"] else 0,
                user["guild_checked_at"], users._iso(now + TICKET_TTL),
            ),
        )
        conn.commit()
    return ticket


def redeem(ticket: str | None, site: str | None) -> dict | None:
    """Spend a ticket once; the player it carries, or None if unknown, expired or for another site."""
    if not valid_token(ticket) or not site:
        return None
    digest = hash_secret(ticket)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """
            SELECT t.site, t.guild_member, t.guild_checked_at, t.expires_at,
                   u.discord_user_id, u.discord_username, u.discord_global_name, u.discord_avatar, u.role
            FROM preview_sign_in_tickets t JOIN users u ON u.id = t.user_id
            WHERE t.ticket_hash = ?
            """,
            (digest,),
        ).fetchone()
        conn.execute("DELETE FROM preview_sign_in_tickets WHERE ticket_hash = ?", (digest,))
        conn.commit()
    if row is None or row["site"] != site or users._parse_iso(row["expires_at"]) <= users._utcnow():
        return None
    return {
        "discord_user_id": row["discord_user_id"],
        "discord_username": row["discord_username"],
        "discord_global_name": row["discord_global_name"],
        "discord_avatar": row["discord_avatar"],
        "role": row["role"],
        "guild_member": bool(row["guild_member"]),
        "guild_checked_at": row["guild_checked_at"],
    }


def _text(value) -> str | None:
    return value[:_TEXT_MAX] if isinstance(value, str) and value else None


def _checked_at(value) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        users._parse_iso(value)
    except ValueError:
        return None
    return value


def _player(body) -> dict | None:
    """Dev's answer, checked field by field; None if anything is off."""
    if not isinstance(body, dict):
        return None
    discord_id = body.get("discord_user_id")
    if not isinstance(discord_id, str) or not discord_id.isdigit() or len(discord_id) > SNOWFLAKE_MAX_LEN:
        return None
    checked_at = _checked_at(body.get("guild_checked_at"))
    if body.get("role") not in ROLES or not isinstance(body.get("guild_member"), bool) or checked_at is None:
        return None
    return {
        "discord_user_id": discord_id,
        "discord_username": _text(body.get("discord_username")),
        "discord_global_name": _text(body.get("discord_global_name")),
        "discord_avatar": _text(body.get("discord_avatar")),
        "role": body["role"],
        "guild_member": body["guild_member"],
        "guild_checked_at": checked_at,
    }


def fetch_player(config: AuthConfig, ticket: str, http: httpx.Client | None = None) -> dict | None:
    """Redeem a ticket with the sign-in site; the player, or None when refused or unreachable."""
    client = http or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = client.post(
            config.sign_in_site + REDEEM_PATH,
            json={"ticket": ticket, "site": config.site_origin},
            headers={"Accept": "application/json"},
        )
        if response.status_code != 200:
            return None
        return _player(response.json())
    except (httpx.HTTPError, ValueError):
        return None
    finally:
        if http is None:
            client.close()


def sign_in(player: dict) -> str:
    """Open a preview session for the player dev vouched for."""
    return users.sign_in(
        player,
        guild_member=player["guild_member"],
        guild_checked_at=player["guild_checked_at"],
        role=player["role"],
    )
