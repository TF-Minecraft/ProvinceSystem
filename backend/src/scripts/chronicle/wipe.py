"""Backing-up wipe of one map's chronicle: `python -m src.scripts.chronicle.wipe --map dev`.

Nothing here deletes snapshot bytes. The day folders are renamed aside and the
index rows are copied into `map_chronicle_snapshots_archive` before they leave
the live table, mirroring the snapshot-then-mutate pattern in
`src/precedent/db.py`.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass

from src import database
from src.database.migrate import MigrationError, migrate

from ..util.atomic import CrossDeviceError, rename_aside
from ..util.dirs import validate_map
from ..util.maplock import MapLockBusy, map_lock
from .store import chronicle_lock_path, chronicle_root

_LIVE_TABLE = "map_chronicle_snapshots"
_ARCHIVE_TABLE = "map_chronicle_snapshots_archive"
_COLUMNS = (
    "map_id",
    "day",
    "realm_id",
    "captured_at",
    "bytes",
    "geometry_version",
    "manifest",
)


def _row_count(conn, map_name: str) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) AS n FROM {_LIVE_TABLE} WHERE map_id = %s", (map_name,)
    ).fetchone()
    return int(row["n"] if row is not None else 0)


def _free_archived_at(conn, map_name: str, archived_at: int) -> int:
    """Advance to a second this map has no archive rows for.

    The archive is keyed `(map_id, day, archived_at)`, so two wipes within the
    same second would make the archive upsert overwrite the first run's rows.
    """
    while conn.execute(
        f"SELECT 1 FROM {_ARCHIVE_TABLE} WHERE map_id = %s AND archived_at = to_timestamp(%s) LIMIT 1",
        (map_name, archived_at),
    ).fetchone():
        archived_at += 1
    return archived_at


def _archive_rows(map_name: str, archived_at: int) -> int:
    """Copy this map's index rows into the archive, leaving the live rows.

    Split from the delete so the directory move can happen in between: see the
    ordering note in `wipe_map`.
    """
    columns = ", ".join(_COLUMNS)
    updates = ", ".join(
        f"{column} = excluded.{column}" for column in _COLUMNS if column not in ("map_id", "day")
    )
    with database.connect() as conn:
        return conn.execute(
            f"INSERT INTO {_ARCHIVE_TABLE} ({columns}, archived_at) "
            f"SELECT {columns}, to_timestamp(%s) FROM {_LIVE_TABLE} WHERE map_id = %s "
            f"ON CONFLICT (map_id, day, archived_at) DO UPDATE SET {updates}",
            (archived_at, map_name),
        ).rowcount


def _delete_rows(map_name: str) -> None:
    with database.connect() as conn:
        conn.execute(f"DELETE FROM {_LIVE_TABLE} WHERE map_id = %s", (map_name,))


def _unique_backup_path(root: str, archived_at: int) -> str:
    """A backup path nothing occupies yet.

    Renaming onto an *existing* directory either fails or (via the old
    `shutil.move`) moved the source **inside** it, so two wipes in the same
    second would nest one chronicle inside the other's backup.
    """
    backup = f"{root}.bak.{archived_at}"
    suffix = 1
    while os.path.exists(backup):
        backup = f"{root}.bak.{archived_at}-{suffix}"
        suffix += 1
    return backup


@dataclass(frozen=True)
class WipeResult:
    """What one wipe actually did — the record an audit row is written from."""

    map_id: str
    # The archive stamp: keys the archived index rows *and* the backup dir name.
    archived_at: int
    # Index rows copied into the archive and removed from the live table.
    day_count: int
    # Where the day directories went, or None when there was no directory.
    backup_path: str | None
    # False when there was nothing to wipe at all (no directory, no rows).
    performed: bool


def _wipe_state(map_name: str) -> tuple[str, bool, int, int]:
    """(root, has_dir, live_row_count, free_archive_stamp) for one map.

    Split out so the dry-run print and the real wipe read the same state, and so
    an HTTP caller can reuse the whole flow without argparse or stdout.
    """
    validate_map(map_name)

    root = chronicle_root(map_name)
    has_dir = os.path.isdir(root)
    with database.connect() as conn:
        rows = _row_count(conn, map_name)
        archived_at = _free_archived_at(conn, map_name, int(time.time()))
    return root, has_dir, rows, archived_at


def perform_wipe(map_name: str) -> WipeResult:
    """Archive + set aside one map's chronicle. Prints nothing; returns the record.

    This is `wipe_map` minus the CLI: the ordering comment below is the whole
    reason the function exists in this shape, so the HTTP route reuses it rather
    than growing a second, subtly different implementation.

    Held under this map's cross-process lock for the whole run, including the
    state read: the three steps below are three separate transactions plus a
    rename, and `capture_if_due` runs from every upload. Without the lock a
    capture landing after the archive insert writes a live row that the delete
    at the end removes with no archive copy — that day is then unrecoverable by
    `restore_wipe`. The lock is reentrant, so an HTTP caller that already holds
    it (to answer "already running" without blocking) can still call this.
    """
    with map_lock(chronicle_lock_path(map_name)):
        return _perform_wipe_locked(map_name)


def _perform_wipe_locked(map_name: str) -> WipeResult:
    root, has_dir, rows, archived_at = _wipe_state(map_name)

    if not has_dir and not rows:
        return WipeResult(
            map_id=map_name,
            archived_at=archived_at,
            day_count=0,
            backup_path=None,
            performed=False,
        )

    backup = _unique_backup_path(root, archived_at)

    # Archive-insert, then move the directory, then delete the live rows.
    # Every failure point leaves a state that is detectable and recoverable:
    # a crash before the move leaves the live rows intact (the archive rows are
    # harmless duplicates a re-run replaces), and a crash after it leaves rows
    # for a directory already set aside, which reads as a broken chronicle and
    # is fixed by re-running. Deleting the rows *first* is the one order that
    # can end with a live row for a day whose directory has just been moved
    # away — a crashed re-run landing between the commit and the move writes
    # exactly that row. (Concurrent captures are excluded by the map lock the
    # caller holds; this ordering is about crashes.)
    moved = _archive_rows(map_name, archived_at)

    if has_dir:
        rename_aside(root, backup)

    _delete_rows(map_name)

    return WipeResult(
        map_id=map_name,
        archived_at=archived_at,
        day_count=moved,
        backup_path=backup if has_dir else None,
        performed=True,
    )


def wipe_map(map_name: str, *, dry_run: bool = False) -> int:
    """CLI entry point: the same work as `perform_wipe`, narrated to stdout."""
    root, has_dir, rows, archived_at = _wipe_state(map_name)

    if not has_dir and not rows:
        print(f"Nothing to wipe for map '{map_name}'.")
        return 0

    if dry_run:
        backup = _unique_backup_path(root, archived_at)
        print(f"[dry-run] would archive {rows} index row(s) for map '{map_name}'")
        if has_dir:
            print(f"[dry-run] would move {root} -> {backup}")
        else:
            print(f"[dry-run] no chronicle directory at {root}")
        return 0

    result = perform_wipe(map_name)
    print(f"Archived {result.day_count} index row(s) for map '{map_name}'.")
    if result.backup_path is not None:
        print(f"Moved {root} -> {result.backup_path}")
    else:
        print(f"No chronicle directory at {root} (index rows only).")

    return 0


def main(argv: list[str] | None = None) -> int:
    # Map names and backup paths can contain non-ASCII; a cp1252 console would
    # otherwise mangle the only record of where the files went.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Archive and set aside one map's chronicle snapshots.",
    )
    # Required, and no --all: this is destructive-adjacent and run by deploy, so
    # the operator names the map every time.
    parser.add_argument("--map", required=True, help="Map id, e.g. dev")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen and change nothing.",
    )
    args = parser.parse_args(argv)

    try:
        validate_map(args.map)
        # A dry run changes nothing, including the schema.
        if not args.dry_run:
            migrate()
        return wipe_map(args.map, dry_run=args.dry_run)
    except (database.NotConfiguredError, database.DatabaseError, MigrationError) as exc:
        parser.error(f"Database: {exc}")
        return 2
    except MapLockBusy:
        parser.error(
            f"Another chronicle wipe, restore or capture is running for "
            f"'{args.map}'. Wait for it to finish and re-run."
        )
        return 2
    except (ValueError, CrossDeviceError) as exc:
        parser.error(str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
