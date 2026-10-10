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
        "link_method": row["link_method"] if "link_method" in row.keys() else None,
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
        "link_method": link.get("link_method"),
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


def is_discord_username(value: str) -> bool:
    """Whether text is shaped like a Discord account handle (not a display name or nickname)."""
    return _DISCORD_USERNAME_RE.fullmatch(value.strip()) is not None


_NICKNAME_MAX = 32


def _sanitize_discord_nickname(value: str | None) -> str | None:
    """A server nickname: any text up to Discord's 32 characters, without control characters."""
    raw = " ".join(str(value or "").split())
    if not raw or len(raw) > _NICKNAME_MAX or any(ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        return None
    return raw


def remember_discord_nicknames(updates: list[dict]) -> dict:
    """Store each link's current server nickname.

    None or blank clears it (they have no nickname). A value that is not a
    valid nickname (too long, control characters) is skipped, keeping the
    stored one, rather than taken as a clear.
    """
    if not isinstance(updates, list):
        raise LinkError("updates must be a list")
    if len(updates) > _USERNAME_UPDATES_MAX:
        raise LinkError("too many nickname updates")
    updated = 0
    with connect() as conn:
        for item in updates:
            if not isinstance(item, dict):
                continue
            discord_id = str(item.get("discord_user_id") or "").strip()
            if not discord_id:
                continue
            raw = item.get("discord_nickname")
            nickname = _sanitize_discord_nickname(raw)
            if nickname is None and str(raw or "").strip():
                continue
            cur = conn.execute(
                "UPDATE discord_links SET discord_nickname = ? WHERE discord_user_id = ?",
                (nickname, discord_id),
            )
            updated += cur.rowcount
        conn.commit()
    return {"updated": updated}


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


def _usable_code_row(conn, code: str, now: datetime):
    plaintext = (code or "").strip()
    if not plaintext:
        raise LinkError("code is required")
    row = conn.execute(
        "SELECT * FROM discord_link_codes WHERE code_hash = ?",
        (hash_secret(plaintext),),
    ).fetchone()
    if row is None:
        raise LinkError("Invalid link code")
    if row["used_at"]:
        raise LinkError("Link code has already been used")
    if _parse_iso(row["expires_at"]) < now:
        raise LinkError("Link code has expired")
    return row


def preview_link(code: str) -> dict:
    """Name the Minecraft account a code would link, without using the code."""
    with connect() as conn:
        row = _usable_code_row(conn, code, _utcnow())
        linked = conn.execute(
            "SELECT 1 FROM discord_links WHERE player_uuid = ?",
            (row["player_uuid"],),
        ).fetchone()
    if linked is not None:
        raise LinkError("This Minecraft account is already linked to a Discord account")
    return {
        "player_uuid": str(row["player_uuid"]),
        "minecraft_name": row["minecraft_name"],
        "expires_at": row["expires_at"],
    }


def complete_link(
    code: str,
    discord_user_id: str,
    discord_username: str | None = None,
) -> dict:
    """Bind Discord snowflake to Minecraft UUID.

    The snowflake is the identity. A Discord account username is stored only
    so staff lookup can show it. Nicks and display names are ignored, and a
    link still succeeds when the supplied name is not a username.

    Validation and the write share one immediate transaction, so two
    redemptions of the same code cannot both succeed. A link never replaces
    another: an older code minted before the player linked is refused, and
    linking spends every other outstanding code for that player.
    """
    discord_id = (discord_user_id or "").strip()
    if not (code or "").strip():
        raise LinkError("code is required")
    if not discord_id:
        raise LinkError("discord_user_id is required")

    username = _sanitize_discord_username(discord_username)
    now = _utcnow()

    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = _usable_code_row(conn, code, now)
        result = _bind(conn, row["player_uuid"], row["minecraft_name"], discord_id, username, now, "code")
        conn.commit()
    return result


def link_verified_profile(
    player_uuid: str,
    minecraft_name: str,
    discord_user_id: str,
    discord_username: str | None = None,
    still_allowed=None,
) -> dict:
    """Bind a Minecraft account whose ownership Microsoft has just confirmed.

    Same rules as a code: never replaces an existing link in either direction.
    `still_allowed(conn)` runs inside the write; returning False refuses the link.
    """
    uuid = (player_uuid or "").strip().lower()
    discord_id = (discord_user_id or "").strip()
    if not uuid:
        raise LinkError("player_uuid is required")
    if not discord_id:
        raise LinkError("discord_user_id is required")
    try:
        name = assert_optional_display_name(minecraft_name, field="minecraft_name", max_len=_MC_NAME_MAX)
    except TextValidationError as exc:
        raise LinkError(str(exc)) from exc

    username = _sanitize_discord_username(discord_username)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if still_allowed is not None and not still_allowed(conn):
            raise LinkError("This link attempt is no longer valid")
        result = _bind(conn, uuid, name, discord_id, username, _utcnow(), "microsoft")
        conn.commit()
    return result


def _bind(conn, player_uuid: str, minecraft_name: str | None, discord_id: str, username: str | None, now: datetime,
          method: str) -> dict:
    """Write the link inside the caller's immediate transaction."""
    linked_at = _iso(now)
    existing = conn.execute(
        "SELECT player_uuid FROM discord_links WHERE discord_user_id = ?",
        (discord_id,),
    ).fetchone()
    if existing is not None and existing["player_uuid"] != player_uuid:
        raise LinkError(
            "This Discord account is already linked to a different Minecraft player"
        )
    if existing is None and conn.execute(
        "SELECT 1 FROM discord_links WHERE player_uuid = ?",
        (player_uuid,),
    ).fetchone() is not None:
        raise LinkError(
            "This Minecraft account is already linked to a different Discord account"
        )

    if existing is None:
        conn.execute(
            """
            INSERT INTO discord_links (
                player_uuid, discord_user_id, minecraft_name,
                discord_username, linked_at, left_guild_at, grace_until, link_method
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
            """,
            (player_uuid, discord_id, minecraft_name, username, linked_at, method),
        )
    else:
        # Same pair again: refresh names, keep the original link and grace.
        conn.execute(
            """
            UPDATE discord_links
            SET minecraft_name = COALESCE(?, minecraft_name),
                discord_username = COALESCE(?, discord_username)
            WHERE player_uuid = ?
            """,
            (minecraft_name, username, player_uuid),
        )
        linked_at = conn.execute(
            "SELECT linked_at FROM discord_links WHERE player_uuid = ?",
            (player_uuid,),
        ).fetchone()["linked_at"]
    conn.execute(
        """
        UPDATE discord_link_codes SET used_at = ?
        WHERE player_uuid = ? AND used_at IS NULL
        """,
        (_iso(now), player_uuid),
    )
    enqueue_link_success(
        player_uuid,
        discord_username=username,
        conn=conn,
    )
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


def get_link_for_discord_id(discord_user_id: str) -> dict | None:
    """Discord link for a Discord account, after expiring due graces."""
    discord_id = (discord_user_id or "").strip()
    if not discord_id:
        return None
    expire_due_graces()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM discord_links WHERE discord_user_id = ?",
            (discord_id,),
        ).fetchone()
    if row is None:
        return None
    return _status_from_row(row)


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


def _cancel_microsoft_attempts(conn, discord_id: str) -> None:
    """Unlinking cancels Microsoft link attempts still open for that Discord account."""
    conn.execute(
        "DELETE FROM microsoft_link_states WHERE user_id IN (SELECT id FROM users WHERE discord_user_id = ?)",
        (discord_id,),
    )


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
            _cancel_microsoft_attempts(conn, discord_id)
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
        discord_id = str(row["discord_user_id"])
        conn.execute("DELETE FROM discord_links WHERE player_uuid = ?", (uuid,))
        _cancel_microsoft_attempts(conn, discord_id)
        conn.commit()

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
        _cancel_microsoft_attempts(conn, discord_id)
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
