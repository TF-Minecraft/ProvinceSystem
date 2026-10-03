"""Patron OAuth linking and webhook intake. Tokens and identities are not logged."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit

from src.skins import db
from .client import PatreonClient, PatreonError
from .config import Config
from .resolver import iso, parse, utcnow
from . import service

logger = logging.getLogger("patreon")

STATE_TTL = timedelta(minutes=10)
REDIRECT_DEFAULT = "https://www.tfminecraft.net/api/patreon/oauth/callback"
SITE_DEFAULT = "https://www.tfminecraft.net"
PUBLIC_STATUSES = {"ok", "not_a_member", "already_linked", "relink_cooldown", "expired", "denied", "error"}
KNOWN_EVENTS = frozenset({
    "members:create",
    "members:update",
    "members:delete",
    "members:pledge:create",
    "members:pledge:update",
    "members:pledge:delete",
})
_SAFE_SYNC = {"patreon_sync_busy", "patreon_sync_failed", "patreon_disabled"}
_USER_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_MEMBER_ID = re.compile(r"[A-Za-z0-9_-]{1,80}")
_TIER = re.compile(r"[a-z0-9_]{1,32}")


def build_client(config: Config | None = None) -> PatreonClient:
    return PatreonClient(config or Config.from_env())


def start_link(*, discord_user_id=None, player_uuid=None) -> dict:
    discord, player = service._clean_subjects(discord_user_id, player_uuid)
    if bool(discord) == bool(player) or (discord and len(discord) > 64):
        raise service.ServiceError("invalid_subject")
    client_id = os.getenv("PATREON_CLIENT_ID", "").strip()
    if not client_id or any(ch.isspace() for ch in client_id):
        raise service.ServiceError("patreon_client_unconfigured")
    token = secrets.token_urlsafe(32)
    now = utcnow()
    expires = now + STATE_TTL
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM patreon_oauth_states WHERE expires_at<=? OR used_at IS NOT NULL", (iso(now),))
        conn.execute("INSERT INTO patreon_oauth_states(state_hash,discord_user_id,player_uuid,expires_at) VALUES (?,?,?,?)",
                     (hashlib.sha256(token.encode("utf-8")).hexdigest(), discord, player, iso(expires)))
    redirect_uri = os.getenv("PATREON_REDIRECT_URI", REDIRECT_DEFAULT).strip() or REDIRECT_DEFAULT
    query = urlencode([
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("scope", "identity"),
        ("state", token),
    ])
    return {"authorize_url": "https://www.patreon.com/oauth2/authorize?" + query, "expires_at": iso(expires)}


def consume_state(token: str | None) -> dict | None:
    if not token or len(token) > 256:
        return None
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utcnow()
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT discord_user_id, player_uuid, expires_at, used_at FROM patreon_oauth_states WHERE state_hash=?", (digest,)).fetchone()
        if row is None or row["used_at"] is not None or parse(row["expires_at"]) <= now:
            return None
        updated = conn.execute("UPDATE patreon_oauth_states SET used_at=? WHERE state_hash=? AND used_at IS NULL", (iso(now), digest))
        if updated.rowcount != 1:
            return None
        return {"discord_user_id": row["discord_user_id"], "player_uuid": row["player_uuid"]}


def redirect_url(status: str, tier: str = "") -> str:
    status = status if status in PUBLIC_STATUSES else "error"
    if status != "ok" or not _TIER.fullmatch(tier or ""):
        tier = ""
    base = os.getenv("PATREON_PUBLIC_SITE_URL", SITE_DEFAULT).strip() or SITE_DEFAULT
    parts = urlsplit(base)
    if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
        parts = urlsplit(SITE_DEFAULT)
    path = (parts.path or "").rstrip("/") + "/patreon/linked"
    return urlunsplit((parts.scheme, parts.netloc, path, urlencode([("status", status), ("tier", tier)]), ""))


def finish_callback(code: str | None, state: str | None, *, denied: bool) -> tuple[str, str]:
    status, tier = "error", ""
    try:
        status, tier = _finish_callback(code, state, denied=denied)
    except PatreonError as exc:
        logger.warning("Patreon oauth callback failed code=%s", exc)
    except service.ServiceError as exc:
        logger.warning("Patreon oauth callback failed code=%s", exc)
    except Exception:
        logger.warning("Patreon oauth callback failed")
    logger.info("Patreon oauth callback status=%s", status)
    return status, tier


def _finish_callback(code: str | None, state: str | None, *, denied: bool) -> tuple[str, str]:
    if denied:
        if state:
            consume_state(state)
        return "denied", ""
    subject = consume_state(state)
    if not subject:
        return "expired", ""
    if not code or len(code) > 2048 or any(ch.isspace() for ch in code):
        return "error", ""
    config = Config.from_env()
    client = build_client(config)
    try:
        token = client.exchange_authorization_code(code)
        try:
            access = token.get("access_token") if isinstance(token, dict) else None
            if not isinstance(access, str) or not access:
                return "error", ""
            identity = client.identity(access)
            user_id = str(identity.get("id") or "") if isinstance(identity, dict) else ""
        finally:
            access = None
            if isinstance(token, dict):
                token.clear()
        if not _USER_ID.fullmatch(user_id):
            return "error", ""
        with db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            result = service.create_or_update_link(user_id, discord_user_id=subject["discord_user_id"], player_uuid=subject["player_uuid"], method="oauth", config=config, conn=conn)
            if result != "ok":
                return (result if result in {"already_linked", "relink_cooldown"} else "error"), ""
            known = conn.execute("SELECT 1 FROM patreon_members WHERE patreon_user_id=?", (user_id,)).fetchone()
            if known:
                return _tier_status(service.recompute_link(user_id, config=config, conn=conn, link_success=True), config)
        synced = service.sync_now(config=config, client=client)
        if not synced.get("ok"):
            detail = synced.get("detail")
            logger.warning("Patreon oauth member sync failed code=%s", detail if detail in _SAFE_SYNC else "patreon_sync_failed")
            return "error", ""
        return _tier_status(service.recompute_link(user_id, config=config, link_success=True), config)
    finally:
        client.close()


def _tier_status(body: dict, config: Config) -> tuple[str, str]:
    if not body.get("linked"):
        return "error", ""
    tier = body.get("tier_key") or ""
    if tier not in {item.key for item in config.tiers}:
        tier = ""
    return ("ok" if tier else "not_a_member"), tier


def signature_ok(raw: bytes, header: str | None, secret: str) -> bool:
    expected = hmac.new(secret.encode("utf-8"), raw, hashlib.md5).hexdigest().encode("ascii")
    try:
        given = (header or "").strip().lower().encode("ascii")
    except UnicodeEncodeError:
        given = b""
    if len(given) != len(expected):
        hmac.compare_digest(expected, expected)
        return False
    return hmac.compare_digest(expected, given)


def member_id_from_webhook(raw: bytes) -> str:
    try:
        document = json.loads(raw)
        data = document["data"]
        if not isinstance(data, dict) or data.get("type") != "member":
            raise ValueError()
        member_id = data.get("id")
        if isinstance(member_id, bool) or not isinstance(member_id, (str, int)):
            raise ValueError()
        member_id = str(member_id)
        if not _MEMBER_ID.fullmatch(member_id):
            raise ValueError()
        return member_id
    except (TypeError, ValueError, KeyError, json.JSONDecodeError):
        raise ValueError("invalid_webhook") from None


def record_webhook_member(member_id: str):
    with db.connect() as conn:
        conn.execute("INSERT INTO patreon_webhook_members(member_id, recorded_at) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET recorded_at=excluded.recorded_at",
                     (member_id, iso(utcnow())))


def refresh_webhook_member_sync(member_id: str, *, config: Config | None = None, client=None):
    owns_client = client is None
    config = config or Config.from_env()
    client = client or build_client(config)
    try:
        try:
            result = service.refresh_member(member_id, config=config, client=client)
        except Exception:
            logger.warning("Patreon webhook refresh retained")
            return
        if result.get("ok"):
            with db.connect() as conn:
                conn.execute("DELETE FROM patreon_webhook_members WHERE member_id=?", (member_id,))
            return
        detail = result.get("detail")
        logger.warning("Patreon webhook refresh retained code=%s", detail if detail in _SAFE_SYNC else "patreon_sync_failed")
    finally:
        if owns_client:
            client.close()


async def refresh_webhook_member(member_id: str):
    await asyncio.to_thread(refresh_webhook_member_sync, member_id)


def retry_pending_webhooks(*, config=None, client=None):
    try:
        with db.connect() as conn:
            ids = [row[0] for row in conn.execute("SELECT member_id FROM patreon_webhook_members ORDER BY recorded_at")]
        for member_id in ids:
            refresh_webhook_member_sync(member_id, config=config, client=client)
    except Exception:
        logger.warning("Patreon webhook refresh retained")
