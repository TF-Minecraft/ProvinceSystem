"""Staff-facing skin notification outbox (player DMs via bot)."""

from __future__ import annotations

from datetime import datetime, timezone

from src import database

from .codes import api_time


class NotificationError(ValueError):
    """Notification not found or invalid."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enqueue_submitted(
    submission_id: str,
    discord_user_id: str,
    *,
    display_name: str,
    kind: str,
    slug: str,
) -> int:
    payload = database.Jsonb(
        {
            "submission_id": submission_id,
            "display_name": display_name,
            "kind": kind,
            "slug": slug,
        }
    )
    with database.connect() as conn:
        return int(conn.execute(
            """
            INSERT INTO skin_notifications (
                type, submission_id, discord_user_id, payload, created_at, delivered_at
            ) VALUES ('submitted', %s, %s, %s, %s, NULL)
            RETURNING id
            """,
            (submission_id, discord_user_id, payload, _utcnow()),
        ).fetchone()["id"])


def list_undelivered() -> list[dict]:
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM skin_notifications
            WHERE delivered_at IS NULL
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()

    return [
        {
            "id": row["id"],
            "type": row["type"],
            "submission_id": row["submission_id"],
            "discord_user_id": row["discord_user_id"],
            "payload": row["payload"],
            "created_at": api_time(row["created_at"]),
        }
        for row in rows
    ]


def ack_notification(notification_id: int) -> dict:
    with database.connect() as conn:
        # The first ack sets the time; later ones report it.
        row = conn.execute(
            """
            UPDATE skin_notifications SET delivered_at = COALESCE(delivered_at, %s)
            WHERE id = %s
            RETURNING delivered_at
            """,
            (_utcnow(), notification_id),
        ).fetchone()
    if row is None:
        raise NotificationError("Notification not found")
    return {"id": notification_id, "delivered_at": api_time(row["delivered_at"])}
