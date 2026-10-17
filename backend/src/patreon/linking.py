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
from contextlib import nullcontext
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit

from src import database
from .client import PatreonClient, PatreonError
from .config import Config
from .resolver import iso, utcnow
from . import service

logger = logging.getLogger("patreon")

STATE_TTL = timedelta(minutes=10)
CONFIRM_TTL = timedelta(minutes=10)
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


def start_link(*, discord_user_id=None, player_uuid=None, discord_username=None, minecraft_name=None) -> dict:
    discord, player = service._clean_subjects(discord_user_id, player_uuid)
    if bool(discord) == bool(player) or (discord and (len(discord) > 64 or "\x00" in discord)):
        raise service.ServiceError("invalid_subject")
    client_id = os.getenv("PATREON_CLIENT_ID", "").strip()
    if not client_id or any(ch.isspace() for ch in client_id):
        raise service.ServiceError("patreon_client_unconfigured")
    token = secrets.token_urlsafe(32)
    target_kind = "discord" if discord else "minecraft"
    target_name = discord_username if discord else minecraft_name
    if not target_name:
        target_name = _known_name(discord, player)
    # Postgres text cannot hold NUL; a name with one falls back to the subject.
    target_name = (target_name or "").replace("\x00", "").strip() or discord or player
    # A random state needs no lock: it cannot collide with another.
    with database.connect() as conn:
        conn.execute("DELETE FROM patreon_oauth_states WHERE expires_at <= %s OR used_at IS NOT NULL", (utcnow(),))
        now = utcnow()
        expires = now + STATE_TTL
        conn.execute("INSERT INTO patreon_oauth_states (state_hash, discord_user_id, player_uuid, target_kind, target_name, expires_at) "
                     "VALUES (%s, %s, %s, %s, %s, %s)",
                     (hashlib.sha256(token.encode("utf-8")).hexdigest(), discord, player, target_kind, target_name, expires))
    redirect_uri = os.getenv("PATREON_REDIRECT_URI", REDIRECT_DEFAULT).strip() or REDIRECT_DEFAULT
    query = urlencode([
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("scope", "identity"),
        ("state", token),
    ])
    return {"authorize_url": "https://www.patreon.com/oauth2/authorize?" + query, "expires_at": iso(expires)}


def _known_name(discord: str | None, player: str | None) -> str | None:
    """The name a Discord link (or, for a player, their latest link code) gives the subject."""
    column, value = ("discord_user_id", discord) if discord else ("player_uuid", player)
    name_column = "discord_username" if discord else "minecraft_name"
    with database.connect() as conn:
        known = conn.execute(f"SELECT {name_column} AS name FROM discord_links WHERE {column} = %s", (value,)).fetchone()
        if (not known or not known["name"]) and player:
            known = conn.execute("SELECT minecraft_name AS name FROM discord_link_codes WHERE player_uuid = %s AND minecraft_name IS NOT NULL ORDER BY created_at DESC LIMIT 1", (player,)).fetchone()
    return known["name"] if known else None


def consume_state(token: str | None) -> dict | None:
    if not token or len(token) > 256:
        return None
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with database.connect() as conn:
        conn.execute("LOCK TABLE patreon_oauth_states IN ROW EXCLUSIVE MODE")
        conn.execute("SELECT state_hash FROM patreon_oauth_states WHERE state_hash = %s FOR UPDATE", (digest,))
        now = utcnow()
        # Compare-and-set: one UPDATE checks and spends the state, so two callbacks cannot both get it.
        row = conn.execute(
            """
            UPDATE patreon_oauth_states SET used_at = %s
            WHERE state_hash = %s AND used_at IS NULL AND expires_at > %s
              AND target_kind IS NOT NULL AND target_kind <> '' AND target_name IS NOT NULL AND target_name <> ''
            RETURNING discord_user_id, player_uuid, target_kind, target_name
            """,
            (now, digest, now)).fetchone()
    return dict(row) if row else None


def redirect_url(status: str, tier: str = "") -> str:
    confirm = tier if status == "pending" else ""
    status = status if status in PUBLIC_STATUSES else "error"
    if status != "ok" or not _TIER.fullmatch(tier or ""):
        tier = ""
    base = os.getenv("PATREON_PUBLIC_SITE_URL", SITE_DEFAULT).strip() or SITE_DEFAULT
    parts = urlsplit(base)
    if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
        parts = urlsplit(SITE_DEFAULT)
    path = (parts.path or "").rstrip("/") + "/patreon/linked"
    if confirm:
        return urlunsplit((parts.scheme, parts.netloc, path, "", urlencode({"confirm": confirm})))
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
    logger.info("Patreon oauth callback status=%s", status if status in PUBLIC_STATUSES or status == "pending" else "error")
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
            attributes = identity.get("attributes") if isinstance(identity, dict) else None
            name = attributes.get("full_name") if isinstance(attributes, dict) else None
            name = name if isinstance(name, str) and name.strip() else "Patreon account"
        finally:
            access = None
            if isinstance(token, dict):
                token.clear()
        if not _USER_ID.fullmatch(user_id):
            return "error", ""
        confirm = secrets.token_urlsafe(32)
        name = name.replace("\x00", "")  # Postgres text cannot hold NUL
        name = name if name.strip() else "Patreon account"
        with database.connect() as conn:
            conn.execute("DELETE FROM patreon_pending_links WHERE expires_at <= %s OR used_at IS NOT NULL", (utcnow(),))
            now = utcnow()
            conn.execute("INSERT INTO patreon_pending_links (token_hash, patreon_user_id, patreon_name, discord_user_id, player_uuid, target_kind, target_name, expires_at) "
                         "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                         (hashlib.sha256(confirm.encode()).hexdigest(), user_id, name, subject["discord_user_id"], subject["player_uuid"], subject["target_kind"], subject["target_name"], now + CONFIRM_TTL))
        return "pending", confirm
    finally:
        client.close()


def _pending(token: str, *, consume: bool = False, conn=None) -> dict | None:
    """The live confirmation for a token. `consume` spends it: only one caller gets it back."""
    if not token or len(token) > 256:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    with (database.connect() if conn is None else nullcontext(conn)) as conn:
        if consume:
            conn.execute("LOCK TABLE patreon_pending_links IN ROW EXCLUSIVE MODE")
            conn.execute("SELECT token_hash FROM patreon_pending_links WHERE token_hash = %s FOR UPDATE", (digest,))
        now = utcnow()
        if consume:
            # Compare-and-set: of two confirms (or a confirm and a cancel) only one gets the row.
            row = conn.execute("UPDATE patreon_pending_links SET used_at = %s "
                               "WHERE token_hash = %s AND used_at IS NULL AND expires_at > %s RETURNING *",
                               (now, digest, now)).fetchone()
        else:
            row = conn.execute("SELECT * FROM patreon_pending_links WHERE token_hash = %s AND used_at IS NULL AND expires_at > %s",
                               (digest, now)).fetchone()
    return dict(row) if row else None


def pending_link(token: str) -> dict:
    row = _pending(token)
    if row is None:
        return {"status": "expired"}
    return {key: row[key] for key in ("target_kind", "target_name", "patreon_name")}


def cancel_link(token: str) -> dict:
    return {"status": "ok" if _pending(token, consume=True) else "expired"}


def confirm_link(token: str) -> dict:
    status, tier = "error", ""
    try:
        status, tier = _confirm_link(token)
    except (PatreonError, service.ServiceError):
        logger.warning("Patreon link confirmation failed")
    except Exception:
        logger.warning("Patreon link confirmation failed")
    logger.info("Patreon link confirmation status=%s", status)
    return {"status": status, "tier": tier}


def _confirm_link(token: str) -> tuple[str, str]:
    failure = reply = None
    with database.transaction(lock=service.PATREON_LOCK) as conn:
        subject = _pending(token, consume=True, conn=conn)
        if subject is None:
            return "expired", ""
        user_id = subject["patreon_user_id"]
        try:
            # Keep the spend on an ordinary error, as before. Expiry instead
            # rolls back this whole transaction: token, link and outboxes.
            with conn.transaction():
                config = Config.from_env()
                result = service.create_or_update_link(user_id, discord_user_id=subject["discord_user_id"], player_uuid=subject["player_uuid"], method="oauth", config=config, conn=conn)
                if result != "ok":
                    reply = (result if result in {"already_linked", "relink_cooldown"} else "error"), ""
                else:
                    known = conn.execute("SELECT 1 FROM patreon_members WHERE patreon_user_id = %s", (user_id,)).fetchone()
                    if known:
                        reply = _tier_status(service.recompute_link(user_id, config=config, conn=conn, link_success=True), config)
        except Exception as exc:
            failure = exc
        if subject["expires_at"] <= utcnow():
            conn.rollback()
            return "expired", ""
    if failure is not None:
        raise failure
    if reply is not None:
        return reply
    # An unknown patron: fetch them with no transaction open, then recompute.
    client = build_client(config)
    try:
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
    with database.connect() as conn:
        conn.execute("INSERT INTO patreon_webhook_members (member_id, recorded_at) VALUES (%s, %s) "
                     "ON CONFLICT (member_id) DO UPDATE SET recorded_at = excluded.recorded_at",
                     (member_id, utcnow()))


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
            with database.connect() as conn:
                conn.execute("DELETE FROM patreon_webhook_members WHERE member_id = %s", (member_id,))
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
        with database.connect() as conn:
            ids = [row["member_id"] for row in conn.execute("SELECT member_id FROM patreon_webhook_members ORDER BY recorded_at")]
        for member_id in ids:
            refresh_webhook_member_sync(member_id, config=config, client=client)
    except Exception:
        logger.warning("Patreon webhook refresh retained")
