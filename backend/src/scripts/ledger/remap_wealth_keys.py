"""Rewrite daily canonical snapshots: colored guild wealth keys -> guild ids.

`python -m src.scripts.ledger.remap_wealth_keys --map main [--dry-run]`

Only `daily/*.json.gz` is touched. Reindex from daily after this; do not
`--from-raw`, which would promote old-key raw files over the rewritten days.
"""

from __future__ import annotations

import argparse
import os
import sys

from ..util.atomic import _write_atomic
from ..util.dirs import validate_map
from ..util.maplock import MapLockBusy, map_lock
from .ingest import _pack, _read_raw
from .schema import remap_wealth_breakdown_keys
from .store import daily_path, daily_root, is_valid_day, ledger_lock_path

_TEMP_PREFIX = ".ledger-"


def _daily_days(map_name: str) -> list[str]:
    try:
        names = os.listdir(daily_root(map_name))
    except OSError:
        return []
    days = [
        name[: -len(".json.gz")]
        for name in names
        if name.endswith(".json.gz")
    ]
    return sorted(day for day in days if is_valid_day(day))


def remap_map(map_name: str, *, dry_run: bool = False) -> int:
    validate_map(map_name)

    days = _daily_days(map_name)
    if not days:
        print(f"No daily ledger days on disk for map '{map_name}'.")
        return 0

    changed_days = 0
    remapped_keys = 0

    def consider(day: str) -> None:
        nonlocal changed_days, remapped_keys
        snapshot = _read_raw(daily_path(map_name, day))
        if snapshot is None:
            print(f"  skipped {day} (nothing readable)")
            return
        count = remap_wealth_breakdown_keys(snapshot)
        if count == 0:
            return
        remapped_keys += count
        changed_days += 1
        if dry_run:
            print(f"  {day}: {count} key(s)")
            return
        _write_atomic(daily_path(map_name, day), _pack(snapshot), prefix=_TEMP_PREFIX)
        print(f"  {day}: {count} key(s)")

    if dry_run:
        for day in days:
            consider(day)
        print(
            f"[dry-run] would rewrite {changed_days}/{len(days)} day(s) "
            f"for map '{map_name}' ({remapped_keys} key(s))."
        )
        return 0

    with map_lock(ledger_lock_path(map_name)):
        for day in days:
            consider(day)
    print(
        f"Rewrote {changed_days}/{len(days)} day(s) for map '{map_name}' "
        f"({remapped_keys} key(s))."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description=(
            "Rewrite daily ledger snapshots so wealth_breakdown guild bands "
            "use guild ids instead of colored display names."
        ),
    )
    parser.add_argument("--map", required=True, help="Map id, e.g. main")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen and change nothing.",
    )
    args = parser.parse_args(argv)

    try:
        return remap_map(args.map, dry_run=args.dry_run)
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
