"""Backing-up wipe of one map's ledger: `python -m src.scripts.ledger.wipe --map dev`.

Nothing here deletes snapshot bytes — the ledger tree is renamed aside, exactly
like `scripts/chronicle/wipe.py` moves the chronicle tree.

Unlike the chronicle there is no `*_archive` table. The chronicle's index rows
*are* the only record of a day's manifest, so they have to be copied before they
go; every ledger row is derivable from `daily/{day}.json.gz`, which the backup
directory still holds, and `reindex.py --map X` rebuilds all four tables from it.
Four archive tables would be four more things to keep in step for no recovery
the backup does not already give.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from src import database
from src.database.migrate import MigrationError, migrate

from ..util.atomic import CrossDeviceError, rename_aside
from ..util.dirs import validate_map
from ..util.maplock import MapLockBusy, map_lock
from .store import ledger_lock_path, ledger_root

_TABLES = (
    "map_ledger_faction_days",
    "map_ledger_guild_days",
    "map_ledger_days",
    "map_ledger_factions",
)


def _row_counts(conn, map_name: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in _TABLES:
        row = conn.execute(
            f"SELECT COUNT(*) AS n FROM {table} WHERE map_id = %s", (map_name,)
        ).fetchone()
        counts[table] = int(row["n"] if row is not None else 0)
    return counts


def _unique_backup_path(root: str, stamp: int) -> str:
    """A backup path nothing occupies yet.

    Renaming onto an *existing* directory either fails or (via the old
    `shutil.move`) moved the source **inside** it, so two wipes in the same
    second would nest one ledger inside the other's backup.
    """
    backup = f"{root}.bak.{stamp}"
    suffix = 1
    while os.path.exists(backup):
        backup = f"{root}.bak.{stamp}-{suffix}"
        suffix += 1
    return backup


def wipe_map(map_name: str, *, dry_run: bool = False) -> int:
    validate_map(map_name)
    # `promote_day` runs as a BackgroundTask on every upload and only takes the
    # per-(map, day) lock, so without this a promote landing between the move
    # below and the DELETE loop re-creates `daily/{day}.json.gz` in a fresh root
    # and re-inserts rows the loop then deletes. Cross-process, because the CLI
    # is a different process from the server it is wiping under.
    with map_lock(ledger_lock_path(map_name)):
        return _wipe_locked(map_name, dry_run=dry_run)


def _wipe_locked(map_name: str, *, dry_run: bool) -> int:
    root = ledger_root(map_name)
    has_dir = os.path.isdir(root)
    with database.connect() as conn:
        counts = _row_counts(conn, map_name)
    total = sum(counts.values())

    if not has_dir and not total:
        print(f"Nothing to wipe for map '{map_name}'.")
        return 0

    backup = _unique_backup_path(root, int(time.time()))

    if dry_run:
        for table, count in counts.items():
            print(f"[dry-run] would delete {count} row(s) from {table}")
        if has_dir:
            print(f"[dry-run] would move {root} -> {backup}")
        else:
            print(f"[dry-run] no ledger directory at {root}")
        return 0

    # Move the directory first, then delete the rows. A crash in between leaves
    # rows pointing at a tree that has moved, which reads as a broken ledger and
    # is fixed by re-running; the other order can end with a live row for a day
    # whose bytes have just been set aside by a concurrent promote.
    if has_dir:
        # Rename, never a copy — the module docstring promises the tree is
        # "renamed aside", and `shutil.move` quietly became copytree+rmtree
        # across a filesystem boundary. Same helper as the chronicle wipe.
        rename_aside(root, backup)
        print(f"Moved {root} -> {backup}")
    else:
        print(f"No ledger directory at {root} (index rows only).")

    # Count what the DELETEs actually removed, not what the pre-move census
    # said: the two disagree whenever anything changed in between, and the
    # printed number is the only record the operator gets.
    deleted = 0
    with database.connect() as conn:
        for table in _TABLES:
            cursor = conn.execute(
                f"DELETE FROM {table} WHERE map_id = %s", (map_name,)
            )
            deleted += cursor.rowcount or 0
    print(f"Deleted {deleted} index row(s) for map '{map_name}'.")

    return 0


def main(argv: list[str] | None = None) -> int:
    # Map names and backup paths can contain non-ASCII; a cp1252 console would
    # otherwise mangle the only record of where the files went.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Set aside one map's ledger snapshots and drop its index rows.",
    )
    # Required, and no --all: this is destructive-adjacent, so the operator
    # names the map every time.
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
    except (database.NotConfiguredError, database.OperationalError, MigrationError) as exc:
        parser.error(f"Database: {exc}")
        return 2
    except MapLockBusy:
        parser.error(
            f"Another ledger wipe, ingest or reindex is running for "
            f"'{args.map}'. Wait for it to finish and re-run."
        )
        return 2
    except (ValueError, CrossDeviceError) as exc:
        parser.error(str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
