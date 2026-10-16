"""Rebuild one map's ledger index from disk: `python -m src.scripts.ledger.reindex --map dev`.

`daily/*.json.gz` is the source of truth here, not `raw/`: it is what promote
already picked as canonical, so a reindex reproduces the same rows without
re-deciding. Use `--from-raw` to re-run the canonical choice as well, e.g. after
fixing a promote bug.
"""

from __future__ import annotations

import argparse
import os
import sys

from src import database
from src.database.migrate import MigrationError, migrate

from ..util.dirs import validate_map
from ..util.maplock import MapLockBusy, map_lock
from .ingest import promote_day, reindex_day
from .store import daily_root, is_valid_day, ledger_lock_path, raw_root


def _days_on_disk(root: str, suffix: str) -> list[str]:
    try:
        names = os.listdir(root)
    except OSError:
        return []
    days = [
        name[: -len(suffix)] if suffix else name
        for name in names
        if (name.endswith(suffix) if suffix else True)
    ]
    return sorted(day for day in days if is_valid_day(day))


def reindex_map(map_name: str, *, from_raw: bool = False, dry_run: bool = False) -> int:
    validate_map(map_name)

    if from_raw:
        days = _days_on_disk(raw_root(map_name), "")
        source = "raw"
    else:
        days = _days_on_disk(daily_root(map_name), ".json.gz")
        source = "daily"

    if not days:
        print(f"No {source} ledger days on disk for map '{map_name}'.")
        return 0

    if dry_run:
        print(f"[dry-run] would reindex {len(days)} day(s) from {source} ({days[0]}..{days[-1]})")
        return 0

    # One lock for the whole loop, not one per day: a server that is still
    # ingesting would otherwise slip a promote (or a staff wipe) between two
    # days of the rebuild and leave the index half old, half new. The lock is
    # reentrant, so the per-day acquire inside promote_day/reindex_day is free.
    done = 0
    with map_lock(ledger_lock_path(map_name)):
        for day in days:
            result = (
                promote_day(map_name, day)
                if from_raw
                else reindex_day(map_name, day)
            )
            if result is None:
                print(f"  skipped {day} (nothing readable)")
                continue
            done += 1
    print(f"Reindexed {done}/{len(days)} day(s) for map '{map_name}' from {source}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    # Map names can contain non-ASCII; a cp1252 console would mangle the output.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Rebuild one map's ledger index from stored snapshots.",
    )
    parser.add_argument("--map", required=True, help="Map id, e.g. dev")
    parser.add_argument(
        "--from-raw",
        action="store_true",
        help="Re-run the canonical choice from raw/ instead of reading daily/.",
    )
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
        return reindex_map(args.map, from_raw=args.from_raw, dry_run=args.dry_run)
    except (database.NotConfiguredError, database.OperationalError, MigrationError) as exc:
        parser.error(f"Database: {exc}")
        return 2
    except MapLockBusy:
        parser.error(
            f"Another ledger wipe, ingest or reindex is running for "
            f"'{args.map}'. Wait for it to finish and re-run."
        )
        return 2
    except ValueError as exc:
        parser.error(str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
