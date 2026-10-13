"""Death, will and estate fields from RPCharacters' roster push.

Estates live in their own table keyed by (realm_id, death_id), so a roster push that
drops a character never deletes its estate. Older revisions never replace newer ones.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any

ESTATE_STATUSES = frozenset({"OPEN", "HELD", "CANCELLED", "DECIDED", "REVERTED"})
ESTATE_PARTS = ("money", "property", "guild_locks", "letters")

_KIND_RE = re.compile(r"^[A-Z_]{1,24}$")
_PARTICIPANT_RE = re.compile(r"^[a-z0-9._-]{1,64}$")
_MAX_PARTICIPANTS = 32
_MAX_COUNTS = 32
_MAX_NAME = 64
_MAX_ID = 64


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_from_epoch_ms(raw: Any) -> str | None:
    """Epoch milliseconds (or an ISO string) to the site's ISO form; None if unusable."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        if raw <= 0:
            return None
        try:
            moment = datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
        return moment.strftime("%Y-%m-%dT%H:%M:%SZ")
    text = str(raw).strip()
    if not text:
        return None
    if text.isdigit():
        return iso_from_epoch_ms(int(text))
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_ms_from_epoch_ms(raw: Any) -> str | None:
    """Like iso_from_epoch_ms but keeps milliseconds, for ordering pushes inside one second."""
    if raw is None or isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw <= 0:
        return iso_from_epoch_ms(raw)
    try:
        moment = datetime.fromtimestamp(int(raw) / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(raw) % 1000:03d}Z"


def _short_text(raw: Any, limit: int) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text[:limit] if text else None


def _revision(raw: Any) -> int | None:
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def death_fields(raw: dict) -> tuple[str | None, str | None]:
    """(died_at ISO, death_id) as pushed; None clears."""
    return iso_from_epoch_ms(raw.get("died_at")), _short_text(raw.get("death_id"), _MAX_ID)


def will_fields(raw: dict) -> tuple[str | None, str | None, int] | None:
    """(heir id, heir name, revision), or None when the push carries no will revision."""
    revision = _revision(raw.get("will_revision"))
    if revision is None:
        return None
    heir_id = _short_text(raw.get("will_heir_id"), _MAX_ID)
    heir_name = _short_text(raw.get("will_heir_name"), _MAX_NAME) if heir_id else None
    return heir_id, heir_name, revision


def store_will(
    conn: sqlite3.Connection,
    player_uuid: str,
    realm: str,
    character_id: str,
    will: tuple[str | None, str | None, int],
) -> bool:
    """Write a will unless the row already holds a newer revision. True when written."""
    heir_id, heir_name, revision = will
    cur = conn.execute(
        """
        UPDATE character_roster
        SET will_heir_id = ?, will_heir_name = ?, will_revision = ?
        WHERE player_uuid = ? AND realm_id = ? AND character_id = ?
          AND (will_revision IS NULL OR will_revision <= ?)
        """,
        (heir_id, heir_name, revision, player_uuid, realm, character_id, revision),
    )
    return cur.rowcount > 0


def _recipient(raw: Any) -> dict[str, str | None] | None:
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "").strip().upper()
    if not _KIND_RE.match(kind):
        return None
    return {"kind": kind, "name": _short_text(raw.get("name"), _MAX_NAME)}


def _counts(raw: Any) -> dict[str, int]:
    out: dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        if len(out) >= _MAX_COUNTS:
            break
        label = _short_text(key, _MAX_ID)
        if not label or isinstance(value, bool):
            continue
        try:
            out[label] = max(0, int(value))
        except (TypeError, ValueError):
            continue
    return out


def _participants(raw: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        if len(out) >= _MAX_PARTICIPANTS:
            break
        pid = str(key or "").strip().lower()
        if not _PARTICIPANT_RE.match(pid) or not isinstance(value, dict):
            continue
        outcome = str(value.get("outcome") or "").strip().upper()
        out[pid] = {
            "outcome": outcome if _KIND_RE.match(outcome) else None,
            "revision": _revision(value.get("revision")),
            "counts": _counts(value.get("counts")),
        }
    return out


def parse_estate(raw: Any, death_id: str | None) -> dict[str, Any] | None:
    """A pushed estate object, cleaned; None when it is unusable (missing death id, status or revision)."""
    if not isinstance(raw, dict):
        return None
    did = _short_text(raw.get("death_id"), _MAX_ID) or death_id
    status = str(raw.get("status") or "").strip().upper()
    revision = _revision(raw.get("revision"))
    if not did or status not in ESTATE_STATUSES or revision is None:
        return None
    recipients = {}
    raw_recipients = raw.get("recipients")
    if isinstance(raw_recipients, dict):
        for part in ESTATE_PARTS:
            parsed = _recipient(raw_recipients.get(part))
            if parsed is not None:
                recipients[part] = parsed
    money_moved = raw.get("money_moved_cents")
    try:
        money_cents = None if money_moved is None or isinstance(money_moved, bool) else max(0, int(money_moved))
    except (TypeError, ValueError):
        money_cents = None
    return {
        "death_id": did,
        "status": status,
        "revision": revision,
        "updated_at": iso_ms_from_epoch_ms(raw.get("updated_at")),
        "payload": {
            "due_at": iso_from_epoch_ms(raw.get("due_at")),
            "decided_at": iso_from_epoch_ms(raw.get("decided_at")),
            "heir_name": _short_text(raw.get("heir_name"), _MAX_NAME),
            "recipients": recipients,
            "money_moved_cents": money_cents,
            "participants": _participants(raw.get("participants")),
        },
    }


def store_estate(
    conn: sqlite3.Connection,
    player_uuid: str,
    realm: str,
    character_id: str,
    estate: dict[str, Any],
) -> bool:
    """Insert or replace one estate unless the stored one is newer. True when written.

    Newer means a higher revision, or the same revision with a later ``updated_at``.
    An estate already stored for another character is left alone.
    """
    existing = conn.execute(
        """
        SELECT character_id, revision, source_updated_at
        FROM character_estates WHERE realm_id = ? AND death_id = ?
        """,
        (realm, estate["death_id"]),
    ).fetchone()
    if existing is not None:
        if existing["character_id"] != character_id:
            return False
        if estate["revision"] < existing["revision"]:
            return False
        stored_at = existing["source_updated_at"]
        if (
            estate["revision"] == existing["revision"]
            and stored_at
            and (estate["updated_at"] is None or estate["updated_at"] < stored_at)
        ):
            return False
    conn.execute(
        """
        INSERT INTO character_estates (
            realm_id, death_id, player_uuid, character_id, status, revision,
            source_updated_at, payload, received_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(realm_id, death_id) DO UPDATE SET
            player_uuid = excluded.player_uuid,
            status = excluded.status,
            revision = excluded.revision,
            source_updated_at = excluded.source_updated_at,
            payload = excluded.payload,
            received_at = excluded.received_at
        """,
        (
            realm,
            estate["death_id"],
            player_uuid,
            character_id,
            estate["status"],
            estate["revision"],
            estate["updated_at"],
            json.dumps(estate["payload"], separators=(",", ":")),
            _iso_now(),
        ),
    )
    return True


def _estate_out(row: sqlite3.Row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload"] or "{}")
    except (TypeError, json.JSONDecodeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return {
        "death_id": row["death_id"],
        "status": row["status"],
        "revision": row["revision"],
        "due_at": payload.get("due_at"),
        "decided_at": payload.get("decided_at"),
        "heir_name": payload.get("heir_name"),
        "recipients": payload.get("recipients") or {},
        "money_moved_cents": payload.get("money_moved_cents"),
        "participants": payload.get("participants") or {},
    }


def estate_for(
    conn: sqlite3.Connection, realm: str, character_id: str, death_id: str | None
) -> dict[str, Any] | None:
    """The estate of the character's current death; its latest stored one when the death id is unknown."""
    if death_id:
        row = conn.execute(
            "SELECT * FROM character_estates WHERE realm_id = ? AND death_id = ? AND character_id = ?",
            (realm, death_id, character_id),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT * FROM character_estates WHERE realm_id = ? AND character_id = ?
            ORDER BY received_at DESC LIMIT 1
            """,
            (realm, character_id),
        ).fetchone()
    return _estate_out(row) if row is not None else None
