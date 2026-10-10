"""Issue and redeem skins codes; opaque upload sessions."""

from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from .db import connect

SESSION_TTL_HOURS = 8
CHARACTER_REMEMBER_TTL_DAYS = 30
ALLOWED_SCOPES = frozenset({"skin", "drink", "profile", "skin_staff"})
REDEEMABLE_SKIN_SCOPES = frozenset({"skin", "skin_staff"})
SCOPE_LORE_UPLOAD = "lore_upload"
DEFAULT_REALM_ID = "main"
_REALM_ID_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


class CodeError(ValueError):
    """Invalid, expired, revoked, or already-redeemed code."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_plaintext_code() -> str:
    """Readable XXXX-XXXX-XXXX from hex groups."""
    raw = secrets.token_hex(6).upper()  # 12 hex chars
    return f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"


def _code_ttl_hours() -> int:
    raw = os.environ.get("SKINS_CODE_TTL_HOURS", "48").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 48


def _normalize_scope(scope: str | None) -> str:
    raw = (scope or "skin").strip().lower()
    if not raw:
        raw = "skin"
    if raw not in ALLOWED_SCOPES:
        raise CodeError("scope must be 'skin', 'drink', 'skin_staff', or 'profile'")
    return raw


def normalize_realm_id(realm_id: str | None) -> str:
    """Trim/lower realm; empty/None → main. Reject invalid charset."""
    raw = (realm_id or "").strip().lower()
    if not raw:
        return DEFAULT_REALM_ID
    if not _REALM_ID_RE.match(raw):
        raise CodeError(
            "realm_id must be 1–32 chars of a-z, 0-9, underscore, or hyphen"
        )
    return raw


def _is_staff_scope(scope: str) -> bool:
    return (scope or "").strip().lower() == "skin_staff"


def _code_is_consumed(conn, code_id: int, scope: str) -> bool:
    """True when the token was used for a submission (skin/drink) or redeemed (profile)."""
    normalized = (scope or "").strip().lower()
    if normalized == "drink":
        row = conn.execute(
            "SELECT 1 FROM drink_submissions WHERE code_id = ? LIMIT 1",
            (code_id,),
        ).fetchone()
        return row is not None
    if normalized in REDEEMABLE_SKIN_SCOPES:
        row = conn.execute(
            "SELECT 1 FROM submissions WHERE code_id = ? LIMIT 1",
            (code_id,),
        ).fetchone()
        return row is not None
    row = conn.execute(
        "SELECT redeemed_at FROM codes WHERE id = ?",
        (code_id,),
    ).fetchone()
    return row is not None and row["redeemed_at"] is not None


def mark_code_consumed(code_id: int, consumed_at: str | None = None) -> None:
    """Mark a skin/drink code used after a successful submission."""
    when = consumed_at or _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            "UPDATE codes SET redeemed_at = ? WHERE id = ?",
            (when, int(code_id)),
        )
        conn.commit()


def ensure_lore_upload_code(player_uuid: str, realm_id: str | None) -> int:
    """Internal per-player code for kit-origin submissions (not player-redeemable)."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise CodeError("player_uuid is required")
    realm = normalize_realm_id(realm_id)
    identity_hash = hash_secret(f"lore-upload:{uuid.lower()}")
    now = _utcnow()
    created_at = _iso(now)
    expires_at = _iso(now + timedelta(days=365 * 50))

    with connect() as conn:
        row = conn.execute(
            """
            SELECT id FROM codes
            WHERE LOWER(player_uuid) = LOWER(?)
              AND LOWER(scope) = ?
            LIMIT 1
            """,
            (uuid, SCOPE_LORE_UPLOAD),
        ).fetchone()
        if row is not None:
            return int(row["id"])
        conn.execute(
            """
            INSERT INTO codes (
                code_hash, player_uuid, scope, realm_id,
                created_at, expires_at, redeemed_at, revoked
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
            """,
            (identity_hash, uuid, SCOPE_LORE_UPLOAD, realm, created_at, expires_at),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id FROM codes WHERE code_hash = ?",
            (identity_hash,),
        ).fetchone()
    if row is None:
        raise CodeError("failed to create lore upload code")
    return int(row["id"])


def _prepare_skin_drink_redeem(conn, code_id: int) -> None:
    """Replace sessions and clear redemption time for a code with no submission.

    Skin and drink codes remain reusable until a submission consumes them;
    callers must check consumption before resetting the session here.
    """
    conn.execute("DELETE FROM sessions WHERE code_id = ?", (code_id,))
    conn.execute(
        "UPDATE codes SET redeemed_at = NULL WHERE id = ?",
        (code_id,),
    )


def get_cosmetic_mint_status(player_uuid: str) -> dict:
    """Last mint across shared cosmetic scopes (skin + drink) for TFMCWeb cooldown.

    Staff resets (``cosmetic_mint_resets``) clear the clock: only mints after the
    latest reset count toward cooldown.
    """
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise CodeError("player_uuid is required")
    with connect() as conn:
        reset_row = conn.execute(
            """
            SELECT MAX(reset_at) AS reset_at
            FROM cosmetic_mint_resets
            WHERE LOWER(player_uuid) = LOWER(?)
            """,
            (uuid,),
        ).fetchone()
        reset_at = reset_row["reset_at"] if reset_row else None
        if reset_at:
            row = conn.execute(
                """
                SELECT MAX(created_at) AS last_at
                FROM codes
                WHERE LOWER(player_uuid) = LOWER(?)
                  AND LOWER(scope) IN ('skin', 'drink')
                  AND created_at > ?
                """,
                (uuid, str(reset_at)),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT MAX(created_at) AS last_at
                FROM codes
                WHERE LOWER(player_uuid) = LOWER(?)
                  AND LOWER(scope) IN ('skin', 'drink')
                """,
                (uuid,),
            ).fetchone()
    last_at = row["last_at"] if row else None
    if last_at is None:
        return {"last_mint_at": None, "player_uuid": uuid}
    return {"last_mint_at": str(last_at), "player_uuid": uuid}


def reset_cosmetic_mint_cooldowns(
    player_uuid: str, staff_uuid: str | None = None
) -> dict:
    """Staff clear of shared skin+drink mint cooldown for a player."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise CodeError("player_uuid is required")
    staff = (staff_uuid or "").strip() or None
    reset_at = _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO cosmetic_mint_resets (player_uuid, reset_at, staff_uuid)
            VALUES (?, ?, ?)
            """,
            (uuid, reset_at, staff),
        )
        conn.commit()
    return {"ok": True, "player_uuid": uuid, "reset_at": reset_at}


def issue_code(
    player_uuid: str,
    scope: str | None = "skin",
    realm_id: str | None = None,
) -> dict:
    from .discord_link import get_identity_status

    uuid = (player_uuid or "").strip()
    if not uuid:
        raise CodeError("player_uuid is required")
    normalized = _normalize_scope(scope)
    realm = normalize_realm_id(realm_id)

    status = get_identity_status(uuid)
    if not status.get("eligible"):
        raise CodeError("Link Discord in-game with /linkdiscord first")

    # Mint cooldown for skin/drink is owned by TFMCWeb (shared clock).
    # This endpoint only checks Discord eligibility and inserts the code.

    plaintext = generate_plaintext_code()
    now = _utcnow()
    expires = now + timedelta(hours=_code_ttl_hours())
    expires_at = _iso(expires)

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO codes (
                code_hash, code_plaintext, player_uuid, scope, realm_id,
                created_at, expires_at, redeemed_at, revoked
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)
            """,
            (
                hash_secret(plaintext),
                plaintext,
                uuid,
                normalized,
                realm,
                _iso(now),
                expires_at,
            ),
        )
        conn.commit()

    return {
        "code": plaintext,
        "expires_at": expires_at,
        "scope": normalized,
        "realm_id": realm,
    }


def list_active_codes() -> list[dict]:
    """Unused, unrevoked, unexpired codes that still have plaintext."""
    now = _iso(_utcnow())
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT
                c.code_plaintext AS code,
                c.player_uuid AS player_uuid,
                c.scope AS scope,
                d.minecraft_name AS minecraft_name,
                c.created_at AS created_at,
                c.expires_at AS expires_at
            FROM codes c
            LEFT JOIN discord_links d ON d.player_uuid = c.player_uuid
            WHERE c.revoked = 0
              AND c.expires_at > ?
              AND c.code_plaintext IS NOT NULL
              AND TRIM(c.code_plaintext) != ''
              AND (
                (
                  LOWER(c.scope) IN ('skin', 'skin_staff')
                  AND NOT EXISTS (
                    SELECT 1 FROM submissions s WHERE s.code_id = c.id
                  )
                )
                OR (
                  LOWER(c.scope) = 'drink'
                  AND NOT EXISTS (
                    SELECT 1 FROM drink_submissions d WHERE d.code_id = c.id
                  )
                )
                OR (
                  LOWER(c.scope) = 'profile'
                  AND c.redeemed_at IS NULL
                )
              )
            ORDER BY c.created_at ASC
            """,
            (now,),
        ).fetchall()
    return [
        {
            "code": row["code"],
            "player_uuid": row["player_uuid"],
            "scope": str(row["scope"]).strip().lower(),
            "minecraft_name": row["minecraft_name"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
        }
        for row in rows
    ]


def get_linked_minecraft_name(player_uuid: str) -> str | None:
    """Display name from the player's Discord link, or None when unlinked."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT minecraft_name FROM discord_links WHERE player_uuid = ?",
            (uuid,),
        ).fetchone()
    if row is None:
        return None
    name = (row["minecraft_name"] or "").strip()
    return name or None


def revoke_code(plaintext: str) -> dict:
    code = (plaintext or "").strip()
    if not code:
        raise CodeError("code is required")

    code_hash = hash_secret(code)
    now = _utcnow()

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM codes WHERE code_hash = ?",
            (code_hash,),
        ).fetchone()

        if row is None:
            raise CodeError("Invalid code")
        if row["revoked"]:
            raise CodeError("Code has already been revoked")
        scope = str(row["scope"]).strip().lower()
        if _code_is_consumed(conn, row["id"], scope):
            raise CodeError("Code has already been redeemed")
        if _parse_iso(row["expires_at"]) < now:
            raise CodeError("Code has expired")

        conn.execute(
            "UPDATE codes SET revoked = 1 WHERE id = ?",
            (row["id"],),
        )
        conn.commit()

    return {"ok": True, "code": code}


SITE_STAFF_PERMISSION = "tfmc.map.staff"
STAFF_TOKEN_CREATE_PERM = "tfmcweb.token.create"
STAFF_TOKEN_CREATE_STAFF_PERM = "tfmcweb.token.create.staff"


def _mask_player_uuid(player_uuid: str) -> str:
    uuid = (player_uuid or "").strip().lower()
    if not uuid:
        return ""
    if len(uuid) <= 8:
        return uuid
    return f"{uuid[:8]}..."


def inspect_code(plaintext: str) -> dict:
    """Read-only code lookup for dev tooling. Does not redeem or create sessions."""
    code = (plaintext or "").strip()
    if not code:
        raise CodeError("code is required")

    code_hash = hash_secret(code)
    now = _utcnow()

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM codes WHERE code_hash = ?",
            (code_hash,),
        ).fetchone()

        if row is None:
            return {"valid": False, "error": "Invalid code"}

        scope = str(row["scope"]).strip().lower()
        realm_id = str(row["realm_id"]).strip().lower()
        player_uuid = str(row["player_uuid"] or "").strip().lower()
        revoked = bool(row["revoked"])
        expired = _parse_iso(row["expires_at"]) < now
        consumed = _code_is_consumed(conn, row["id"], scope)

    from src.characters.rpc_player_meta import (
        has_map_staff_access,
        resolve_web_entitlements,
    )

    staff = _is_staff_scope(scope)
    entitlements = resolve_web_entitlements(
        player_uuid,
        staff=staff,
        realm_id=realm_id,
    )
    permission_flags = entitlements.get("permission_flags") or {}
    if not isinstance(permission_flags, dict):
        permission_flags = {}

    if revoked:
        status = "revoked"
    elif expired:
        status = "expired"
    elif consumed:
        status = "consumed"
    else:
        status = "active"

    skin_kinds = entitlements.get("skin_kinds")
    if not isinstance(skin_kinds, list):
        skin_kinds = []

    return {
        "valid": True,
        "status": status,
        "scope": scope,
        "realm_id": realm_id,
        "staff": staff,
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "revoked": revoked,
        "consumed": consumed,
        "expired": expired,
        "player_uuid_masked": _mask_player_uuid(player_uuid),
        "site_staff_access": has_map_staff_access(
            player_uuid,
            realm_id,
            SITE_STAFF_PERMISSION,
        ),
        "staff_token_perms": {
            STAFF_TOKEN_CREATE_PERM: bool(
                permission_flags.get(STAFF_TOKEN_CREATE_PERM)
            ),
            STAFF_TOKEN_CREATE_STAFF_PERM: bool(
                permission_flags.get(STAFF_TOKEN_CREATE_STAFF_PERM)
            ),
        },
        "entitlements": {
            "meta_synced": bool(entitlements.get("meta_synced")),
            "max_3d_pair_bytes": int(entitlements.get("max_3d_pair_bytes") or 0),
            "skin_kinds": [str(k) for k in skin_kinds],
            "name_colour_stops": int(entitlements.get("name_colour_stops") or 0),
            "allow_armor_3d_helmet": bool(
                entitlements.get("allow_armor_3d_helmet")
            ),
        },
    }


def redeem_code(plaintext: str) -> dict:
    code = (plaintext or "").strip()
    if not code:
        raise CodeError("code is required")

    code_hash = hash_secret(code)
    now = _utcnow()

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM codes WHERE code_hash = ?",
            (code_hash,),
        ).fetchone()

        if row is None:
            raise CodeError("Invalid code")
        if row["revoked"]:
            raise CodeError("Code has been revoked")
        scope = str(row["scope"]).strip().lower()
        if _code_is_consumed(conn, row["id"], scope):
            raise CodeError("Code has already been used")
        if _parse_iso(row["expires_at"]) < now:
            raise CodeError("Code has expired")
        if scope not in REDEEMABLE_SKIN_SCOPES:
            if scope == "drink":
                raise CodeError("This code is for drinks, not skins")
            raise CodeError("This code is for profile login, not skins")

        _prepare_skin_drink_redeem(conn, row["id"])

        session_token = secrets.token_urlsafe(32)
        session_expires = now + timedelta(hours=SESSION_TTL_HOURS)
        session_expires_at = _iso(session_expires)
        created_at = _iso(now)

        conn.execute(
            """
            INSERT INTO sessions (token_hash, code_id, player_uuid, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                hash_secret(session_token),
                row["id"],
                row["player_uuid"],
                session_expires_at,
                created_at,
            ),
        )
        conn.commit()

    from src.characters.rpc_player_meta import resolve_web_entitlements

    entitlements = resolve_web_entitlements(
        row["player_uuid"],
        staff=_is_staff_scope(scope),
        realm_id=str(row["realm_id"]).strip().lower(),
    )
    return {
        "session_token": session_token,
        "player_uuid": row["player_uuid"],
        "expires_at": session_expires_at,
        "code_id": row["id"],
        "scope": scope,
        "realm_id": str(row["realm_id"]).strip().lower(),
        "staff": _is_staff_scope(scope),
        "name_colour_stops": entitlements["name_colour_stops"],
        "max_3d_pair_bytes": entitlements["max_3d_pair_bytes"],
        "skin_token_cooldown_days": entitlements["skin_token_cooldown_days"],
        "skin_kinds": entitlements["skin_kinds"],
        "allow_armor_3d_helmet": entitlements["allow_armor_3d_helmet"],
        "meta_synced": entitlements.get("meta_synced", False),
    }


def redeem_profile_code(plaintext: str, remember_me: bool = False) -> dict:
    """Consume a profile-scoped code and create a Bearer session."""
    code = (plaintext or "").strip()
    if not code:
        raise CodeError("code is required")

    code_hash = hash_secret(code)
    now = _utcnow()
    remember = bool(remember_me)

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM codes WHERE code_hash = ?",
            (code_hash,),
        ).fetchone()

        if row is None:
            raise CodeError("Invalid code")
        if row["revoked"]:
            raise CodeError("Code has been revoked")
        if row["redeemed_at"]:
            raise CodeError("Code has already been redeemed")
        if _parse_iso(row["expires_at"]) < now:
            raise CodeError("Code has expired")
        scope = str(row["scope"]).strip().lower()
        if scope != "profile":
            raise CodeError("This code is for skins, not profile login")

        session_token = secrets.token_urlsafe(32)
        if remember:
            session_expires = now + timedelta(days=CHARACTER_REMEMBER_TTL_DAYS)
        else:
            session_expires = now + timedelta(hours=SESSION_TTL_HOURS)
        session_expires_at = _iso(session_expires)
        created_at = _iso(now)

        conn.execute(
            "UPDATE codes SET redeemed_at = ? WHERE id = ?",
            (created_at, row["id"]),
        )
        conn.execute(
            """
            INSERT INTO sessions (token_hash, code_id, player_uuid, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                hash_secret(session_token),
                row["id"],
                row["player_uuid"],
                session_expires_at,
                created_at,
            ),
        )
        conn.commit()

    return {
        "session_token": session_token,
        "player_uuid": row["player_uuid"],
        "expires_at": session_expires_at,
        "code_id": row["id"],
        "scope": scope,
        "realm_id": str(row["realm_id"]).strip().lower(),
        "remember_me": remember,
    }


def site_profile_realm() -> str:
    """The realm this site's Profile shows when opened through a linked Discord account."""
    try:
        return normalize_realm_id(os.environ.get("PROFILE_REALM_ID"))
    except CodeError:
        return DEFAULT_REALM_ID


def start_linked_profile_session(player_uuid: str) -> dict:
    """A profile session for a player whose Discord account is linked, without an in-game code.

    Sessions belong to a code, so this records a profile code that is spent at once and
    has no plaintext. The caller has already checked the Discord sign-in and the link.
    """
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise CodeError("player_uuid is required")
    realm = site_profile_realm()
    now = _utcnow()
    created_at = _iso(now)
    session_token = secrets.token_urlsafe(32)
    session_expires_at = _iso(now + timedelta(hours=SESSION_TTL_HOURS))

    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO codes (
                code_hash, code_plaintext, player_uuid, scope, realm_id,
                created_at, expires_at, redeemed_at, revoked
            ) VALUES (?, NULL, ?, 'profile', ?, ?, ?, ?, 0)
            """,
            (hash_secret(f"discord-profile:{secrets.token_urlsafe(32)}"), uuid, realm,
             created_at, created_at, created_at),
        )
        code_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO sessions (token_hash, code_id, player_uuid, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (hash_secret(session_token), code_id, uuid, session_expires_at, created_at),
        )
        conn.commit()

    return {
        "session_token": session_token,
        "player_uuid": uuid,
        "expires_at": session_expires_at,
        "scope": "profile",
        "realm_id": realm,
        "remember_me": False,
    }


def redeem_drink_code(plaintext: str) -> dict:
    """Consume a drink-scoped code and create a Bearer session."""
    from src.characters.rpc_player_meta import resolve_web_entitlements

    code = (plaintext or "").strip()
    if not code:
        raise CodeError("code is required")

    code_hash = hash_secret(code)
    now = _utcnow()

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM codes WHERE code_hash = ?",
            (code_hash,),
        ).fetchone()

        if row is None:
            raise CodeError("Invalid code")
        if row["revoked"]:
            raise CodeError("Code has been revoked")
        scope = str(row["scope"]).strip().lower()
        if scope != "drink":
            if scope in REDEEMABLE_SKIN_SCOPES:
                raise CodeError("This code is for skins, not drinks")
            if scope == "profile":
                raise CodeError("This code is for profile login, not drinks")
            raise CodeError("This code is not a drink token")
        if _code_is_consumed(conn, row["id"], scope):
            raise CodeError("Code has already been used")
        if _parse_iso(row["expires_at"]) < now:
            raise CodeError("Code has expired")

        _prepare_skin_drink_redeem(conn, row["id"])

        session_token = secrets.token_urlsafe(32)
        session_expires = now + timedelta(hours=SESSION_TTL_HOURS)
        session_expires_at = _iso(session_expires)
        created_at = _iso(now)

        conn.execute(
            """
            INSERT INTO sessions (token_hash, code_id, player_uuid, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                hash_secret(session_token),
                row["id"],
                row["player_uuid"],
                session_expires_at,
                created_at,
            ),
        )
        conn.commit()

    entitlements = resolve_web_entitlements(
        str(row["player_uuid"]),
        realm_id=str(row["realm_id"]).strip().lower(),
    )
    return {
        "session_token": session_token,
        "player_uuid": row["player_uuid"],
        "expires_at": session_expires_at,
        "code_id": row["id"],
        "scope": scope,
        "realm_id": str(row["realm_id"]).strip().lower(),
        "allow_drink_texture": entitlements["allow_drink_texture"],
        "allow_drink_message": entitlements["allow_drink_message"],
        "name_colour_stops": entitlements["name_colour_stops"],
        "meta_synced": entitlements.get("meta_synced", False),
    }


def revoke_session(token: str) -> dict:
    """Delete the session for this Bearer token (idempotent)."""
    raw = (token or "").strip()
    if not raw:
        return {"ok": True, "revoked": False}

    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (hash_secret(raw),),
        )
        conn.commit()
        deleted = cur.rowcount > 0

    return {"ok": True, "revoked": deleted}


def get_session(token: str) -> dict | None:
    raw = (token or "").strip()
    if not raw:
        return None

    now = _utcnow()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT
                s.id AS id,
                s.token_hash AS token_hash,
                s.code_id AS code_id,
                s.player_uuid AS player_uuid,
                s.expires_at AS expires_at,
                s.created_at AS created_at,
                c.scope AS scope,
                c.realm_id AS realm_id
            FROM sessions s
            JOIN codes c ON c.id = s.code_id
            WHERE s.token_hash = ?
            """,
            (hash_secret(raw),),
        ).fetchone()

    if row is None:
        return None
    if _parse_iso(row["expires_at"]) < now:
        return None
    scope = str(row["scope"]).strip().lower()
    return {
        "id": row["id"],
        "token_hash": row["token_hash"],
        "code_id": row["code_id"],
        "player_uuid": row["player_uuid"],
        "expires_at": row["expires_at"],
        "created_at": row["created_at"],
        "scope": scope,
        "realm_id": str(row["realm_id"]).strip().lower(),
        "staff": _is_staff_scope(scope),
    }


def _self_test() -> None:
    """Mint/redeem scope checks. Run: python -m src.skins.codes"""
    from .db import migrate
    from .discord_link import LinkError, complete_link, start_link, unlink_by_uuid

    migrate()
    uuid = "00000000-0000-4000-8000-000000000105"
    discord_id = "discord-scope-selftest-105"
    try:
        unlink_by_uuid(uuid)
    except LinkError:
        pass

    invalid = inspect_code("NOT-A-REAL-CODE-XXXX")
    assert invalid["valid"] is False and invalid.get("error")

    try:
        issue_code(uuid, "skin")
        raise AssertionError("expected unlinked mint to fail")
    except CodeError as e:
        assert "Link Discord" in str(e)

    start = start_link(uuid, "ScopeTest")
    assert "code" in start
    complete_link(start["code"], discord_id, "ScopeTestUser")

    skin = issue_code(uuid, "skin")
    assert skin["scope"] == "skin" and skin["code"]
    inspected_skin = inspect_code(skin["code"])
    assert inspected_skin["valid"] is True
    assert inspected_skin["status"] == "active"
    assert inspected_skin["scope"] == "skin"
    assert inspected_skin["staff"] is False
    session = redeem_code(skin["code"])
    assert session.get("session_token")

    char = issue_code(uuid, "profile")
    assert char["scope"] == "profile"
    try:
        redeem_code(char["code"])
        raise AssertionError("expected profile code skins redeem to fail")
    except CodeError as e:
        assert "profile login" in str(e).lower()

    char_session = redeem_profile_code(char["code"], remember_me=False)
    assert char_session.get("scope") == "profile"
    assert char_session.get("remember_me") is False
    assert get_session(char_session["session_token"]) is not None
    exp1 = _parse_iso(char_session["expires_at"])
    assert timedelta(hours=7) < (exp1 - _utcnow()) < timedelta(hours=9)

    try:
        redeem_profile_code(char["code"])
        raise AssertionError("expected second profile redeem to fail")
    except CodeError as e:
        assert "already been redeemed" in str(e).lower()

    skin_for_char = issue_code(uuid, "skin")
    try:
        redeem_profile_code(skin_for_char["code"])
        raise AssertionError("expected skin code on profile redeem to fail")
    except CodeError as e:
        assert "skins" in str(e).lower()

    char2 = issue_code(uuid, "profile")
    remembered = redeem_profile_code(char2["code"], remember_me=True)
    assert remembered.get("remember_me") is True
    exp30 = _parse_iso(remembered["expires_at"])
    assert timedelta(days=29) < (exp30 - _utcnow()) < timedelta(days=31)

    revoked = revoke_session(remembered["session_token"])
    assert revoked["ok"] is True and revoked["revoked"] is True
    assert get_session(remembered["session_token"]) is None
    assert revoke_session(remembered["session_token"])["revoked"] is False

    try:
        issue_code(uuid, "bogus")
        raise AssertionError("expected bad scope to fail")
    except CodeError as e:
        assert "scope" in str(e).lower()

    # Skin codes are the default scope.
    defaulted = issue_code(uuid)
    assert defaulted["scope"] == "skin"

    staff_skin = issue_code(uuid, "skin_staff")
    assert staff_skin["scope"] == "skin_staff"
    inspected_staff = inspect_code(staff_skin["code"])
    assert inspected_staff["valid"] is True
    assert inspected_staff["staff"] is True
    assert inspected_staff["scope"] == "skin_staff"

    to_revoke = issue_code(uuid, "skin")
    revoke_code(to_revoke["code"])
    inspected_revoked = inspect_code(to_revoke["code"])
    assert inspected_revoked["valid"] is True
    assert inspected_revoked["status"] == "revoked"
    assert inspected_revoked["revoked"] is True

    inspected_consumed = inspect_code(char["code"])
    assert inspected_consumed["valid"] is True
    assert inspected_consumed["status"] == "consumed"
    assert inspected_consumed["consumed"] is True

    try:
        unlink_by_uuid(uuid)
    except LinkError:
        pass
    print("codes scope self-test OK")


if __name__ == "__main__":
    _self_test()
