"""Resolve player-owned roster characters vs pending web creates."""

from __future__ import annotations

from typing import Any

from src.skins.db import connect


class PendingCreateError(ValueError):
    """Character id is neither roster nor an owned pending create."""

    def __init__(self, message: str, *, status_code: int = 403) -> None:
        super().__init__(message)
        self.status_code = status_code


def fetch_owned_pending_create(
    player_uuid: str, create_id: str
) -> dict[str, Any] | None:
    """Return pending create row dict when owned and pending, else None."""
    uuid = (player_uuid or "").strip()
    cid = (create_id or "").strip()
    if not uuid or not cid:
        return None
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, player_uuid, status, character_id, realm_id,
                   wardrobe_active_slot
            FROM character_creates
            WHERE id = ? AND player_uuid = ?
              AND LOWER(COALESCE(status, '')) = 'pending'
            """,
            (cid, uuid),
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def resolve_player_character(
    player_uuid: str,
    character_id: str,
) -> dict[str, Any]:
    """Owned roster character or pending create for player session routes.

    Returns dict with ``kind`` in (``roster``, ``pending``), ``player_uuid``,
    ``character_id`` (roster id or create id), ``realm_id``, and
    ``wardrobe_active_slot``.
  """
    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    if not uuid or not cid:
        raise PendingCreateError("character_id is required", status_code=400)

    with connect() as conn:
        row = conn.execute(
            """
            SELECT player_uuid, character_id, wardrobe_active_slot, realm_id
            FROM character_roster
            WHERE player_uuid = ? AND character_id = ?
            """,
            (uuid, cid),
        ).fetchone()
    if row is not None:
        return {
            "kind": "roster",
            "player_uuid": str(row["player_uuid"]),
            "character_id": str(row["character_id"]),
            "realm_id": row["realm_id"],
            "wardrobe_active_slot": row["wardrobe_active_slot"],
        }

    pending = fetch_owned_pending_create(uuid, cid)
    if pending is not None:
        active = pending.get("wardrobe_active_slot")
        return {
            "kind": "pending",
            "player_uuid": str(pending["player_uuid"]),
            "character_id": str(pending["id"]),
            "create_id": str(pending["id"]),
            "realm_id": pending.get("realm_id"),
            "wardrobe_active_slot": active,
        }

    raise PendingCreateError("Character not found", status_code=403)
