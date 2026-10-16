"""In-game warnings store + Discord moderation outbox (bot polls)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src import database
from src.skins.codes import _parse_iso, api_time
from src.text_validation import (
    TextValidationError,
    assert_optional_display_name,
    assert_prose,
)


class ModerationError(ValueError):
    """Invalid moderation payload."""


_REASON_MAX = 500
_STAFF_NAME_MAX = 32
_MC_NAME_MAX = 16


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _enqueue(
    notice_type: str,
    discord_user_id: str,
    player_uuid: str | None,
    payload: dict[str, Any],
    *,
    conn=None,
) -> int:
    ntype = (notice_type or "").strip()
    discord_id = (discord_user_id or "").strip()
    if not ntype:
        raise ModerationError("notice type is required")
    if not discord_id:
        raise ModerationError("discord_user_id is required for outbox")

    body = database.Jsonb(payload if isinstance(payload, dict) else {})
    uuid = (player_uuid or "").strip() or None

    def _insert(c) -> int:
        return int(c.execute(
            """
            INSERT INTO moderation_notifications (
                type, discord_user_id, player_uuid, payload, created_at, delivered_at
            ) VALUES (%s, %s, %s, %s, %s, NULL)
            RETURNING id
            """,
            (ntype, discord_id, uuid, body, _utcnow()),
        ).fetchone()["id"])

    if conn is not None:
        return _insert(conn)

    with database.connect() as c:
        return _insert(c)


def record_warning(
    player_uuid: str,
    reason: str,
    *,
    staff_uuid: str | None = None,
    staff_name: str | None = None,
    discord_user_id: str | None = None,
    minecraft_name: str | None = None,
) -> dict:
    """Persist warning; enqueue Discord DM if discord_user_id present."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise ModerationError("player_uuid is required")
    try:
        text = assert_prose(reason, min_len=1, max_len=_REASON_MAX, field="reason")
    except TextValidationError as e:
        raise ModerationError(str(e)) from e

    created_at = _iso_now()
    staff_id = (staff_uuid or "").strip() or None
    try:
        staff = assert_optional_display_name(
            staff_name, max_len=_STAFF_NAME_MAX, field="staff name"
        )
        mc_name = assert_optional_display_name(
            minecraft_name, max_len=_MC_NAME_MAX, field="minecraft name"
        )
    except TextValidationError as e:
        raise ModerationError(str(e)) from e
    discord_id = (discord_user_id or "").strip() or None

    with database.connect() as conn:
        warning_id = int(conn.execute(
            """
            INSERT INTO player_warnings (
                player_uuid, staff_uuid, staff_name, reason, created_at
            ) VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (uuid, staff_id, staff, text, _parse_iso(created_at)),
        ).fetchone()["id"])
        mirrored = False
        notice_id = None
        if discord_id:
            notice_id = _enqueue(
                "warn",
                discord_id,
                uuid,
                {
                    "warning_id": warning_id,
                    "minecraft_name": mc_name,
                    "reason": text,
                    "staff_name": staff,
                    "staff_uuid": staff_id,
                },
                conn=conn,
            )
            mirrored = True

    return {
        "ok": True,
        "warning_id": warning_id,
        "mirrored": mirrored,
        "notification_id": notice_id,
        "created_at": created_at,
    }


def enqueue_ban_event(
    event: str,
    *,
    player_uuid: str | None = None,
    discord_user_id: str | None = None,
    minecraft_name: str | None = None,
    reason: str | None = None,
    duration: str | None = None,
    staff_name: str | None = None,
) -> dict:
    """Enqueue ban or unban Discord side-effect. No outbox if unlinked."""
    etype = (event or "").strip().lower()
    if etype not in ("ban", "unban"):
        raise ModerationError("event must be 'ban' or 'unban'")

    discord_id = (discord_user_id or "").strip() or None
    if not discord_id:
        return {"ok": True, "mirrored": False, "notification_id": None}

    uuid = (player_uuid or "").strip() or None
    try:
        payload = {
            "minecraft_name": assert_optional_display_name(
                minecraft_name, max_len=_MC_NAME_MAX, field="minecraft name"
            ),
            "reason": (
                assert_prose(reason, min_len=1, max_len=_REASON_MAX, field="reason")
                if (reason or "").strip()
                else None
            ),
            "duration": (duration or "").strip() or None,
            "staff_name": assert_optional_display_name(
                staff_name, max_len=_STAFF_NAME_MAX, field="staff name"
            ),
        }
    except TextValidationError as e:
        raise ModerationError(str(e)) from e
    notice_id = _enqueue(etype, discord_id, uuid, payload)
    return {"ok": True, "mirrored": True, "notification_id": notice_id}


_ADDRESSEE_MAX = 256
_CONTENTS_MAX = 500


def enqueue_bird_mail(
    *,
    player_uuid: str | None = None,
    discord_user_id: str | None = None,
    addressee_character: str,
    sender_minecraft_name: str | None = None,
    contents_preview: str | None = None,
) -> dict:
    """Enqueue bird mail Discord DM. No outbox if unlinked."""
    discord_id = (discord_user_id or "").strip() or None
    if not discord_id:
        return {"ok": True, "mirrored": False, "notification_id": None}

    uuid = (player_uuid or "").strip() or None
    character = (addressee_character or "").strip()
    if not character:
        raise ModerationError("addressee_character is required")
    if len(character) > _ADDRESSEE_MAX:
        raise ModerationError(
            f"addressee_character cannot exceed {_ADDRESSEE_MAX} characters"
        )

    try:
        sender = assert_optional_display_name(
            sender_minecraft_name, max_len=_MC_NAME_MAX, field="sender minecraft name"
        )
        contents = (
            assert_prose(
                contents_preview,
                min_len=1,
                max_len=_CONTENTS_MAX,
                field="contents preview",
            )
            if (contents_preview or "").strip()
            else None
        )
    except TextValidationError as e:
        raise ModerationError(str(e)) from e

    payload = {
        "addressee_character": character,
        "sender_minecraft_name": sender,
        "contents_preview": contents,
    }
    notice_id = _enqueue("bird_mail", discord_id, uuid, payload)
    return {"ok": True, "mirrored": True, "notification_id": notice_id}


def list_undelivered_moderation() -> list[dict]:
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM moderation_notifications
            WHERE delivered_at IS NULL
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()

    return [
        {
            "id": row["id"],
            "type": row["type"],
            "discord_user_id": row["discord_user_id"],
            "player_uuid": row["player_uuid"],
            "payload": row["payload"],
            "created_at": api_time(row["created_at"]),
        }
        for row in rows
    ]


def ack_moderation(ids: list[int]) -> dict:
    raw_ids = [int(i) for i in (ids or []) if i is not None]
    if not raw_ids:
        return {"acked": [], "delivered_at": None}

    now = _utcnow()
    with database.connect() as conn:
        # Already delivered notices are acked again without moving their time.
        conn.execute(
            "UPDATE moderation_notifications SET delivered_at = %s WHERE id = ANY(%s) AND delivered_at IS NULL",
            (now, raw_ids),
        )
        known = {
            row["id"]
            for row in conn.execute("SELECT id FROM moderation_notifications WHERE id = ANY(%s)", (raw_ids,))
        }
    acked = [notice_id for notice_id in raw_ids if notice_id in known]

    return {"acked": acked, "delivered_at": api_time(now) if acked else None}


def _self_test() -> None:
    """Runs against DATABASE_URL: python -m src.skins.moderation"""
    uuid = "00000000-0000-4000-8000-000000000107"
    discord_id = "999888777666555444"

    with database.connect() as conn:
        conn.execute("DELETE FROM player_warnings WHERE player_uuid = %s", (uuid,))
        conn.execute(
            "DELETE FROM moderation_notifications WHERE player_uuid = %s", (uuid,)
        )

    unlinked = record_warning(uuid, "test unlinked", staff_name="Tester")
    assert unlinked["ok"] and not unlinked["mirrored"]

    linked = record_warning(
        uuid,
        "test linked",
        staff_name="Tester",
        discord_user_id=discord_id,
        minecraft_name="WarnTest",
    )
    assert linked["mirrored"] and linked["notification_id"]

    skipped = enqueue_ban_event("ban", player_uuid=uuid, reason="x")
    assert not skipped["mirrored"]

    banned = enqueue_ban_event(
        "ban",
        player_uuid=uuid,
        discord_user_id=discord_id,
        minecraft_name="WarnTest",
        reason="grief",
        duration="8h",
        staff_name="Mod",
    )
    assert banned["mirrored"]

    bird = enqueue_bird_mail(
        player_uuid=uuid,
        discord_user_id=discord_id,
        addressee_character="Test Character",
        sender_minecraft_name="Sender",
        contents_preview="Hello from the bird.",
    )
    assert bird["mirrored"]

    notices = list_undelivered_moderation()
    ours = [n for n in notices if n.get("player_uuid") == uuid]
    assert len(ours) >= 3
    ack = ack_moderation([n["id"] for n in ours])
    assert len(ack["acked"]) >= 3
    left = [n for n in list_undelivered_moderation() if n.get("player_uuid") == uuid]
    assert not left
    print("moderation self-test OK")


if __name__ == "__main__":
    _self_test()
