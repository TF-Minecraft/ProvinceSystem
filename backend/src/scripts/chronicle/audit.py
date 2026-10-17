"""Audit trail for staff-triggered chronicle wipes and their restores.

The CLI wipe's real protection was that it needed shell access on the box. Once
the same operation is reachable from a browser session that protection is gone,
so the replacement is this table: every wipe records who asked for it, why, how
much went away and where the bytes were set aside. Nothing here deletes rows —
a restore stamps the existing row rather than clearing it.
"""

from __future__ import annotations

from dataclasses import dataclass

from src import database

_TABLE = "map_chronicle_wipes"

# Explicit rather than `SELECT *`: `_row_to_record` unpacks by name, so the
# column order here is documentation, not a dependency, but a `SELECT *`
# would silently start returning any column a future migration adds to the
# table and make this the one place in the codebase that has to track that.
_COLUMNS = (
    "id",
    "map_id",
    "extract(epoch FROM wiped_at)::bigint AS wiped_at",
    "wiped_by",
    "day_count",
    "backup_path",
    "reason",
    "extract(epoch FROM restored_at)::bigint AS restored_at",
    "restored_by",
)

_UNKNOWN_ACTOR = "unknown"


@dataclass(frozen=True)
class WipeRecord:
    id: int
    map_id: str
    wiped_at: int
    wiped_by: str
    day_count: int
    backup_path: str | None
    reason: str
    restored_at: int | None
    restored_by: str | None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "map_id": self.map_id,
            "wiped_at": self.wiped_at,
            "wiped_by": self.wiped_by,
            "day_count": self.day_count,
            "backup_path": self.backup_path,
            "reason": self.reason,
            "restored_at": self.restored_at,
            "restored_by": self.restored_by,
            "restored": self.restored_at is not None,
        }


def _row_to_record(row) -> WipeRecord:
    return WipeRecord(
        id=int(row["id"]),
        map_id=str(row["map_id"]),
        wiped_at=int(row["wiped_at"]),
        wiped_by=str(row["wiped_by"]),
        day_count=int(row["day_count"] or 0),
        backup_path=row["backup_path"],
        reason=str(row["reason"] or ""),
        restored_at=int(row["restored_at"]) if row["restored_at"] is not None else None,
        restored_by=row["restored_by"],
    )


def record_wipe(
    map_id: str,
    *,
    wiped_at: int,
    wiped_by: str,
    day_count: int,
    backup_path: str | None,
    reason: str,
) -> int:
    """Insert one audit row; returns its id (the handle a restore is asked for)."""
    with database.connect() as conn:
        row = conn.execute(
            f"INSERT INTO {_TABLE} "
            "(map_id, wiped_at, wiped_by, day_count, backup_path, reason) "
            "VALUES (%s, to_timestamp(%s), %s, %s, %s, %s) RETURNING id",
            (
                map_id,
                int(wiped_at),
                (wiped_by or "").strip() or _UNKNOWN_ACTOR,
                int(day_count),
                backup_path,
                reason,
            ),
        ).fetchone()
    return int(row["id"])


def list_wipes(map_id: str, limit: int = 100) -> list[WipeRecord]:
    """This map's wipe history, newest first. Never crosses map boundaries."""
    with database.connect() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(_COLUMNS)} FROM {_TABLE} WHERE map_id = %s "
            "ORDER BY wiped_at DESC, id DESC LIMIT %s",
            (map_id, max(1, int(limit))),
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def get_wipe(map_id: str, wipe_id: int) -> WipeRecord | None:
    """One audit row, scoped to the map — an id from another map reads as absent."""
    with database.connect() as conn:
        row = conn.execute(
            f"SELECT {', '.join(_COLUMNS)} FROM {_TABLE} WHERE id = %s AND map_id = %s",
            (int(wipe_id), map_id),
        ).fetchone()
    return _row_to_record(row) if row is not None else None


def last_wiped_at(map_id: str, *, conn=None) -> int | None:
    """Newest wipe stamp for this map, or None if it has never been wiped.

    This is what lets a viewer tell "wiped" apart from "never captured": both
    leave the chronicle index with `days: []`. Pass `conn` to read it in the
    caller's snapshot.
    """
    sql = f"SELECT extract(epoch FROM MAX(wiped_at))::bigint AS stamp FROM {_TABLE} WHERE map_id = %s"
    if conn is not None:
        row = conn.execute(sql, (map_id,)).fetchone()
    else:
        with database.connect() as owned:
            row = owned.execute(sql, (map_id,)).fetchone()
    if row is None or row["stamp"] is None:
        return None
    return int(row["stamp"])


def mark_restored(map_id: str, wipe_id: int, *, restored_at: int, restored_by: str) -> None:
    """Stamp the restore bookkeeping. Scoped by map_id as well as id."""
    with database.connect() as conn:
        conn.execute(
            f"UPDATE {_TABLE} SET restored_at = to_timestamp(%s), restored_by = %s "
            "WHERE id = %s AND map_id = %s",
            (
                int(restored_at),
                (restored_by or "").strip() or _UNKNOWN_ACTOR,
                int(wipe_id),
                map_id,
            ),
        )
