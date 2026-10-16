"""In-game plugin notice outbox (ArmourShop / TFMCWeb polls and delivers)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src import database

from .codes import api_time


class PluginNoticeError(ValueError):
    """Notice not found or invalid."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enqueue_plugin_notice(
    notice_type: str,
    player_uuid: str,
    payload: dict[str, Any] | None = None,
    *,
    conn=None,
) -> int:
    """Enqueue a plugin notice. Optional conn shares caller's transaction."""
    ntype = (notice_type or "").strip()
    uuid = (player_uuid or "").strip()
    if not ntype:
        raise PluginNoticeError("notice type is required")
    if not uuid:
        raise PluginNoticeError("player_uuid is required")

    body = database.Jsonb(payload if isinstance(payload, dict) else {})

    def _insert(c) -> int:
        return int(c.execute(
            """
            INSERT INTO plugin_notices (
                type, player_uuid, payload, created_at, delivered_at
            ) VALUES (%s, %s, %s, %s, NULL)
            RETURNING id
            """,
            (ntype, uuid, body, _utcnow()),
        ).fetchone()["id"])

    if conn is not None:
        return _insert(conn)

    with database.connect() as c:
        return _insert(c)


def enqueue_link_success(
    player_uuid: str,
    *,
    discord_username: str | None = None,
    conn=None,
) -> int:
    """Enqueue a link_success notice. Optional conn shares caller's transaction."""
    name = (discord_username or "").strip() or None
    return enqueue_plugin_notice(
        "link_success",
        player_uuid,
        {"discord_username": name},
        conn=conn,
    )


def _legacy_payload(notice_type: str, payload: dict) -> dict:
    # JSONB does not preserve insertion order. These are the outbox producers'
    # legacy wire schemas; none currently contains a nested object.
    keys = {
        "link_success": ("discord_username",),
        "guild_left_grace": ("discord_user_id", "grace_until", "left_guild_at"),
        "guild_rejoined": ("discord_user_id",),
        "grace_expired": ("discord_user_id", "grace_until"),
    }.get(notice_type, ())
    ordered = {key: payload[key] for key in keys if key in payload}
    ordered.update(payload)
    return ordered


def list_undelivered_plugin_notices() -> list[dict]:
    # Expire guild-leave graces so plugins learn via grace_expired notices.
    from .discord_link import expire_due_graces

    expire_due_graces()

    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM plugin_notices
            WHERE delivered_at IS NULL
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()

    return [
        {
            "id": row["id"],
            "type": row["type"],
            "player_uuid": row["player_uuid"],
            "payload": _legacy_payload(row["type"], row["payload"]),
            "created_at": api_time(row["created_at"]),
        }
        for row in rows
    ]


def ack_plugin_notices(ids: list[int]) -> dict:
    raw_ids = [int(i) for i in (ids or []) if i is not None]
    if not raw_ids:
        return {"acked": [], "delivered_at": None}

    now = _utcnow()
    with database.connect() as conn:
        # Already delivered notices are acked again without moving their time.
        conn.execute(
            "UPDATE plugin_notices SET delivered_at = %s WHERE id = ANY(%s) AND delivered_at IS NULL",
            (now, raw_ids),
        )
        known = {row["id"] for row in conn.execute("SELECT id FROM plugin_notices WHERE id = ANY(%s)", (raw_ids,))}
    acked = [notice_id for notice_id in raw_ids if notice_id in known]

    return {"acked": acked, "delivered_at": api_time(now) if acked else None}
