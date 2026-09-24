"""Minecraft UUID ↔ Discord user id linking via one-time codes + guild grace."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

from .codes import generate_plaintext_code, hash_secret
from .db import connect
from .plugin_notices import enqueue_link_success, enqueue_plugin_notice
from src.text_validation import TextValidationError, assert_optional_display_name


class LinkError(ValueError):
    """Invalid, expired, used, or conflicting Discord link."""


_MC_NAME_MAX = 16
_DISCORD_USERNAME_MAX = 32
_USERNAME_UPDATES_MAX = 500
# Discord account usernames: lowercase, 2–32 characters, letters, digits,
# underscore, and period. Consecutive periods are rejected. A period may
# start or end the name. Display names and nicks are dropped.
_DISCORD_USERNAME_RE = re.compile(
    r"^(?=.{2,32}$)(?!.*\.\.)[a-z0-9_.]+$"
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _link_ttl_minutes() -> int:
    raw = os.environ.get("SKINS_LINK_TTL_MINUTES", "15").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 15


def _guild_grace_minutes() -> int:
    raw = os.environ.get("IDENTITY_GUILD_GRACE_MINUTES", "60").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 60


def _row_to_link(row) -> dict:
    grace = row["grace_until"] if "grace_until" in row.keys() else None
    left = row["left_guild_at"] if "left_guild_at" in row.keys() else None
    return {
        "player_uuid": str(row["player_uuid"]),
        "discord_user_id": str(row["discord_user_id"]),
        "minecraft_name": row["minecraft_name"],
        "discord_username": row["discord_username"],
        "linked_at": row["linked_at"],
        "left_guild_at": left,
        "grace_until": grace,
    }


def _status_from_row(row, *, now: datetime | None = None) -> dict:
    link = _row_to_link(row)
    now = now or _utcnow()
    grace_until = link.get("grace_until")
    in_grace = False
    if grace_until:
        try:
            in_grace = _parse_iso(str(grace_until)) > now
        except (TypeError, ValueError):
            in_grace = False
    return {
        "linked": True,
        "eligible": True,
        "in_grace": in_grace,
        "player_uuid": link["player_uuid"],
        "discord_user_id": link["discord_user_id"],
        "discord_username": link["discord_username"],
        "minecraft_name": link["minecraft_name"],
        "linked_at": link["linked_at"],
        "left_guild_at": link.get("left_guild_at"),
        "grace_until": grace_until,
    }


def _unlinked_status(player_uuid: str) -> dict:
    return {
        "linked": False,
        "eligible": False,
        "in_grace": False,
        "player_uuid": player_uuid,
        "discord_user_id": None,
        "discord_username": None,
        "minecraft_name": None,
        "linked_at": None,
        "left_guild_at": None,
        "grace_until": None,
    }


def start_link(
    player_uuid: str, minecraft_name: str | None = None
) -> dict:
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise LinkError("player_uuid is required")

    with connect() as conn:
        existing = conn.execute(
            """
            SELECT discord_username FROM discord_links
            WHERE player_uuid = ?
            """,
            (uuid,),
        ).fetchone()
        if existing is not None:
            username = existing["discord_username"]
            if username is not None:
                username = str(username).strip() or None
            return {
                "already_linked": True,
                "discord_username": username,
            }

        try:
            name = assert_optional_display_name(
                minecraft_name, max_len=_MC_NAME_MAX, field="minecraft name"
            )
        except TextValidationError as e:
            raise LinkError(str(e)) from e
        plaintext = generate_plaintext_code()
        now = _utcnow()
        expires_at = _iso(now + timedelta(minutes=_link_ttl_minutes()))
        created_at = _iso(now)

        conn.execute(
            """
            INSERT INTO discord_link_codes (
                code_hash, player_uuid, minecraft_name, created_at, expires_at, used_at
            ) VALUES (?, ?, ?, ?, ?, NULL)
            """,
            (hash_secret(plaintext), uuid, name, created_at, expires_at),
        )
        conn.commit()

    return {"code": plaintext, "expires_at": expires_at}


def _sanitize_discord_username(value: str | None) -> str | None:
    """Keep a Discord account username. Anything else is omitted, never fatal."""
    raw = str(value or "").strip()
    if not raw or len(raw) > _DISCORD_USERNAME_MAX:
        return None
    if _DISCORD_USERNAME_RE.fullmatch(raw) is None:
        return None
    return raw


def remember_discord_usernames(
    updates: list[dict],
    *,
    overwrite: bool = False,
) -> dict:
    """Fill stored usernames for existing links. Does not create links."""
    if not isinstance(updates, list):
        raise LinkError("updates must be a list")
    if len(updates) > _USERNAME_UPDATES_MAX:
        raise LinkError("too many username updates")

    updated = 0
    with connect() as conn:
        for item in updates:
            if not isinstance(item, dict):
                continue
            discord_id = str(item.get("discord_user_id") or "").strip()
            name = _sanitize_discord_username(item.get("discord_username"))
            if not discord_id or name is None:
                continue
            if overwrite:
                sql = """
                    UPDATE discord_links
                    SET discord_username = ?
                    WHERE discord_user_id = ?
                """
            else:
                sql = """
                    UPDATE discord_links
                    SET discord_username = ?
                    WHERE discord_user_id = ?
                      AND (
                        discord_username IS NULL
                        OR trim(discord_username) = ''
                      )
                """
            cur = conn.execute(sql, (name, discord_id))
            updated += cur.rowcount
        conn.commit()
    return {"updated": updated}


def complete_link(
    code: str,
    discord_user_id: str,
    discord_username: str | None = None,
) -> dict:
    """Bind Discord snowflake to Minecraft UUID.

    The snowflake is the identity. A Discord account username is stored only
    so staff lookup can show it. Nicks and display names are ignored, and a
    link still succeeds when the supplied name is not a username.
    """
    plaintext = (code or "").strip()
    discord_id = (discord_user_id or "").strip()
    if not plaintext:
        raise LinkError("code is required")
    if not discord_id:
        raise LinkError("discord_user_id is required")

    username = _sanitize_discord_username(discord_username)
    code_hash = hash_secret(plaintext)
    now = _utcnow()
    linked_at = _iso(now)

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM discord_link_codes WHERE code_hash = ?",
            (code_hash,),
        ).fetchone()

        if row is None:
            raise LinkError("Invalid link code")
        if row["used_at"]:
            raise LinkError("Link code has already been used")
        if _parse_iso(row["expires_at"]) < now:
            raise LinkError("Link code has expired")

        player_uuid = row["player_uuid"]
        minecraft_name = row["minecraft_name"]

        existing = conn.execute(
            "SELECT player_uuid FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
        if existing is not None and existing["player_uuid"] != player_uuid:
            raise LinkError(
                "This Discord account is already linked to a different Minecraft player"
            )

        conn.execute(
            "DELETE FROM discord_links WHERE player_uuid = ?",
            (player_uuid,),
        )
        conn.execute(
            """
            INSERT INTO discord_links (
                player_uuid, discord_user_id, minecraft_name,
                discord_username, linked_at, left_guild_at, grace_until
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
            """,
            (player_uuid, discord_id, minecraft_name, username, linked_at),
        )
        conn.execute(
            "UPDATE discord_link_codes SET used_at = ? WHERE id = ?",
            (linked_at, row["id"]),
        )
        enqueue_link_success(
            player_uuid,
            discord_username=username,
            conn=conn,
        )
        conn.commit()

    return {
        "player_uuid": player_uuid,
        "discord_user_id": discord_id,
        "discord_username": username,
        "minecraft_name": minecraft_name,
        "linked_at": linked_at,
    }


def get_discord_id_for_uuid(player_uuid: str) -> str | None:
    uuid = (player_uuid or "").strip()
    if not uuid:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT discord_user_id FROM discord_links WHERE player_uuid = ?",
            (uuid,),
        ).fetchone()
    if row is None:
        return None
    return str(row["discord_user_id"])


def get_link_for_uuid(player_uuid: str) -> dict | None:
    """Active Discord link row for UUID (includes grace fields)."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        return None
    with connect() as conn:
        row = conn.execute(
            """
            SELECT player_uuid, discord_user_id, minecraft_name,
                   discord_username, linked_at, left_guild_at, grace_until
            FROM discord_links
            WHERE player_uuid = ?
            """,
            (uuid,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_link(row)


def record_guild_left(discord_user_id: str) -> dict:
    """Start 1h grace; keep link row. Idempotent if already in grace."""
    discord_id = (discord_user_id or "").strip()
    if not discord_id:
        raise LinkError("discord_user_id is required")

    now = _utcnow()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
        if row is None:
            raise LinkError("No Minecraft link for this Discord account")

        existing_grace = row["grace_until"] if "grace_until" in row.keys() else None
        if existing_grace:
            try:
                if _parse_iso(str(existing_grace)) > now:
                    return _status_from_row(row, now=now)
            except (TypeError, ValueError):
                pass

        left_at = _iso(now)
        grace_until = _iso(now + timedelta(minutes=_guild_grace_minutes()))
        conn.execute(
            """
            UPDATE discord_links
            SET left_guild_at = ?, grace_until = ?
            WHERE discord_user_id = ?
            """,
            (left_at, grace_until, discord_id),
        )
        enqueue_plugin_notice(
            "guild_left_grace",
            str(row["player_uuid"]),
            {
                "discord_user_id": discord_id,
                "grace_until": grace_until,
                "left_guild_at": left_at,
            },
            conn=conn,
        )
        conn.commit()
        refreshed = conn.execute(
            "SELECT * FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
    return _status_from_row(refreshed, now=now)


def record_guild_joined(discord_user_id: str) -> dict:
    """Clear grace if present; stay linked."""
    discord_id = (discord_user_id or "").strip()
    if not discord_id:
        raise LinkError("discord_user_id is required")

    now = _utcnow()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
        if row is None:
            raise LinkError("No Minecraft link for this Discord account")

        was_in_grace = False
        grace = row["grace_until"] if "grace_until" in row.keys() else None
        if grace:
            was_in_grace = True

        conn.execute(
            """
            UPDATE discord_links
            SET left_guild_at = NULL, grace_until = NULL
            WHERE discord_user_id = ?
            """,
            (discord_id,),
        )
        if was_in_grace:
            enqueue_plugin_notice(
                "guild_rejoined",
                str(row["player_uuid"]),
                {"discord_user_id": discord_id},
                conn=conn,
            )
        conn.commit()
        refreshed = conn.execute(
            "SELECT * FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
    return _status_from_row(refreshed, now=now)


def expire_due_graces() -> int:
    """Delete links whose grace_until has passed; enqueue grace_expired. Returns count."""
    now = _utcnow()
    now_iso = _iso(now)
    expired = 0
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT player_uuid, discord_user_id, grace_until
            FROM discord_links
            WHERE grace_until IS NOT NULL AND grace_until <= ?
            """,
            (now_iso,),
        ).fetchall()
        for row in rows:
            uuid = str(row["player_uuid"])
            discord_id = str(row["discord_user_id"])
            conn.execute(
                "DELETE FROM discord_links WHERE player_uuid = ?",
                (uuid,),
            )
            enqueue_plugin_notice(
                "grace_expired",
                uuid,
                {
                    "discord_user_id": discord_id,
                    "grace_until": row["grace_until"],
                },
                conn=conn,
            )
            expired += 1
        if expired:
            conn.commit()
    return expired


def get_identity_status(player_uuid: str) -> dict:
    """Plugin-facing status; expires due graces first."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise LinkError("player_uuid is required")
    expire_due_graces()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM discord_links WHERE player_uuid = ?",
            (uuid,),
        ).fetchone()
    if row is None:
        return _unlinked_status(uuid)
    return _status_from_row(row)


def unlink_by_uuid(player_uuid: str) -> dict:
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise LinkError("player_uuid is required")

    with connect() as conn:
        row = conn.execute(
            "SELECT player_uuid, discord_user_id FROM discord_links WHERE player_uuid = ?",
            (uuid,),
        ).fetchone()
        if row is None:
            raise LinkError("No Discord link for this Minecraft player")
        conn.execute("DELETE FROM discord_links WHERE player_uuid = ?", (uuid,))
        conn.commit()
        discord_id = str(row["discord_user_id"])

    return {
        "ok": True,
        "player_uuid": uuid,
        "discord_user_id": discord_id,
    }


def unlink_by_discord_id(discord_user_id: str) -> dict:
    discord_id = (discord_user_id or "").strip()
    if not discord_id:
        raise LinkError("discord_user_id is required")

    with connect() as conn:
        row = conn.execute(
            "SELECT player_uuid, discord_user_id FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
        if row is None:
            raise LinkError("No Minecraft link for this Discord account")
        player_uuid = str(row["player_uuid"])
        conn.execute(
            "DELETE FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        )
        conn.commit()

    return {
        "ok": True,
        "player_uuid": player_uuid,
        "discord_user_id": discord_id,
    }


if __name__ == "__main__":
    from .db import migrate
    from .plugin_notices import ack_plugin_notices, list_undelivered_plugin_notices

    migrate()

    assert _sanitize_discord_username("DiscordTwo") is None
    assert _sanitize_discord_username("a..b") is None
    assert _sanitize_discord_username("a") is None
    assert _sanitize_discord_username("ab") == "ab"
    assert _sanitize_discord_username(".a.b.") == ".a.b."

    u1 = "00000000-0000-0000-0000-00000000a501"
    u2 = "00000000-0000-0000-0000-00000000a502"
    d1 = "111111111111111111"
    d2 = "222222222222222222"

    with connect() as conn:
        conn.execute("DELETE FROM discord_links WHERE player_uuid IN (?, ?)", (u1, u2))
        conn.execute(
            "DELETE FROM discord_link_codes WHERE player_uuid IN (?, ?)", (u1, u2)
        )
        conn.execute(
            "DELETE FROM plugin_notices WHERE player_uuid IN (?, ?)", (u1, u2)
        )
        conn.commit()

    started = start_link(u1, "TestPlayer")
    assert "code" in started and "expires_at" in started
    done = complete_link(started["code"], d1, discord_username="DiscordOne🔥")
    assert done["player_uuid"] == u1
    assert done["discord_user_id"] == d1
    assert done["minecraft_name"] == "TestPlayer"
    assert done["discord_username"] is None
    assert get_discord_id_for_uuid(u1) == d1

    notices = list_undelivered_plugin_notices()
    link_notices = [
        n
        for n in notices
        if n["player_uuid"] == u1 and n["type"] == "link_success"
    ]
    assert len(link_notices) >= 1
    assert link_notices[-1]["payload"].get("discord_username") is None
    ack_plugin_notices([link_notices[-1]["id"]])

    again = start_link(u1, "TestPlayer")
    assert again.get("already_linked") is True
    assert again.get("discord_username") is None

    # Guild leave grace
    left = record_guild_left(d1)
    assert left["linked"] and left["in_grace"] and left["grace_until"]
    assert get_link_for_uuid(u1) is not None
    left_again = record_guild_left(d1)
    assert left_again["in_grace"]  # idempotent

    joined = record_guild_joined(d1)
    assert joined["linked"] and not joined["in_grace"]
    assert joined["grace_until"] is None

    # Force expiry
    record_guild_left(d1)
    past = _iso(_utcnow() - timedelta(minutes=5))
    with connect() as conn:
        conn.execute(
            "UPDATE discord_links SET grace_until = ? WHERE player_uuid = ?",
            (past, u1),
        )
        conn.commit()
    n = expire_due_graces()
    assert n >= 1
    assert get_link_for_uuid(u1) is None
    status = get_identity_status(u1)
    assert not status["linked"] and not status["eligible"]

    expired_notices = [
        n
        for n in list_undelivered_plugin_notices()
        if n["player_uuid"] == u1 and n["type"] == "grace_expired"
    ]
    assert len(expired_notices) >= 1

    # Relink for alt check
    started2 = start_link(u1, "TestPlayer")
    done2 = complete_link(started2["code"], d2, discord_username="discordtwo")
    assert done2["discord_username"] == "discordtwo"
    assert get_identity_status(u1)["discord_username"] == "discordtwo"
    assert get_discord_id_for_uuid(u1) == d2
    filled = remember_discord_usernames(
        [{"discord_user_id": d2, "discord_username": "other"}]
    )
    assert filled["updated"] == 0
    replaced = remember_discord_usernames(
        [{"discord_user_id": d2, "discord_username": "renamed_user"}],
        overwrite=True,
    )
    assert replaced["updated"] == 1
    assert get_identity_status(u1)["discord_username"] == "renamed_user"
    skipped = remember_discord_usernames(
        [{"discord_user_id": d2, "discord_username": "Bad Name"}],
        overwrite=True,
    )
    assert skipped["updated"] == 0
    assert get_identity_status(u1)["discord_username"] == "renamed_user"

    started3 = start_link(u2)
    try:
        complete_link(started3["code"], d2)
    except LinkError:
        pass
    else:
        raise SystemExit("expected LinkError for discord already linked")

    try:
        complete_link(started2["code"], d1)
    except LinkError:
        pass
    else:
        raise SystemExit("expected LinkError for reused code")

    out = unlink_by_uuid(u1)
    assert out["ok"] and get_discord_id_for_uuid(u1) is None
    try:
        unlink_by_uuid(u1)
    except LinkError:
        pass
    else:
        raise SystemExit("expected LinkError for unlink when not linked")

    started4 = start_link(u1, "TestPlayer")
    complete_link(started4["code"], d1, discord_username="DiscordOne")
    out2 = unlink_by_discord_id(d1)
    assert out2["ok"] and get_discord_id_for_uuid(u1) is None

    print("discord_link ok")
