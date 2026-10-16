"""Write raw ledger snapshots and promote one UTC day to its canonical row."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import shutil

from src import database

from ..util.atomic import _day_lock, _write_atomic
from ..util.maplock import map_lock
from .schema import is_deletion_safe, json_safe, normalize_snapshot, scrub_snapshot  # noqa: F401
from .store import (
    daily_path,
    daily_root,
    is_valid_day,
    ledger_lock_path,
    mark_deleted,
    open_connection,
    raw_day_dir,
    raw_root,
    raw_snapshot_path,
    replace_day_factions,
    replace_day_guilds,
    touch_registry,
    upsert_day,
)
from ..util.dirs import validate_map

logger = logging.getLogger(__name__)

_TEMP_PREFIX = ".ledger-"


def _pack(snapshot: dict) -> bytes:
    """Deterministic gzip so identical content hashes and caches identically."""
    body = json.dumps(
        json_safe(snapshot), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return gzip.compress(body, mtime=0)


def store_raw(map_id: str, snapshot: dict) -> str:
    """Persist one normalised snapshot under raw/{day}/. Returns its path.

    The sha8 in the filename is of the packed bytes, so a retry of the identical
    snapshot lands on the same name and overwrites itself instead of doubling
    the day. Two genuinely different snapshots in the same second stay distinct.

    Takes this map's ledger lock even though it only ever *adds* a file. `raw/`
    lives inside `ledger_root`, which `ledger/wipe.py` renames away wholesale,
    and unlike promote this runs **synchronously on the upload request** — so a
    store_raw landing mid-wipe either fails the upload outright or re-creates
    `raw/{day}/` under a root the wipe has already set aside, stranding the only
    durable copy of that 5-minute sample outside both trees.
    """
    validate_map(map_id)
    day = snapshot["day"]
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")

    packed = _pack(snapshot)
    sha8 = hashlib.sha1(packed).hexdigest()[:8]
    hhmmss = snapshot["captured_at"][11:19].replace(":", "")

    # No day lock: the filename is content-addressed, so two writers for the
    # same (day, second) are writing identical bytes to identical names and
    # `_write_atomic` already makes that safe. Only the whole-tree ops need
    # excluding.
    with map_lock(ledger_lock_path(map_id)):
        day_dir = raw_day_dir(map_id, day)
        os.makedirs(day_dir, exist_ok=True)
        path = raw_snapshot_path(map_id, day, hhmmss, sha8)
        _write_atomic(path, packed, prefix=_TEMP_PREFIX)
    return path


def _read_raw(path: str) -> dict | None:
    try:
        with gzip.open(path, "rb") as fh:
            parsed = json.loads(fh.read())
    except (OSError, ValueError):
        # A torn or truncated raw file must not stop the day from promoting;
        # there are up to 288 more of them.
        logger.warning("Ledger skipping unreadable raw snapshot %s", path, exc_info=True)
        return None
    return parsed if isinstance(parsed, dict) else None


# Files a degraded day has already been read and found not-complete, keyed by
# raw day directory. Promote runs on *every* upload, so without this a day that
# never reports complete re-gunzips all ~288 of its files 288 times over — 80k
# decompressions in the request threadpool for one bad day. Bounded because a
# degraded day is rare and the entry dies with the process; correctness never
# depends on it (see the superset check in `_canonical_snapshot`).
_SCANNED_INCOMPLETE: dict[str, set[str]] = {}
_SCAN_CACHE_MAX_DAYS = 32


def clear_scan_cache() -> None:
    """Forget the per-day incomplete-scan memo. For pruning and for tests."""
    _SCANNED_INCOMPLETE.clear()


def _remember_incomplete(day_dir: str, names: set[str]) -> None:
    if len(_SCANNED_INCOMPLETE) >= _SCAN_CACHE_MAX_DAYS and day_dir not in _SCANNED_INCOMPLETE:
        _SCANNED_INCOMPLETE.clear()
    _SCANNED_INCOMPLETE[day_dir] = names


def _canonical_snapshot(map_id: str, day: str) -> dict | None:
    """The day's canonical snapshot: latest `complete`, else latest overall.

    Scans newest-first and stops at the first complete one, so the normal case
    reads exactly one file even though a day holds ~288.

    A day that never reported complete has no such early exit, and promote runs
    on every upload — so files already read and found not-complete are
    remembered and skipped on the next pass. The newest file is always re-read
    (it is the fallback, and one read is the point of the memo). If the
    directory no longer contains everything the memo names, the raw files were
    replaced or pruned underneath us and the memo is dropped rather than
    trusted.
    """
    day_dir = raw_day_dir(map_id, day)
    try:
        names = sorted(
            name for name in os.listdir(day_dir) if name.endswith(".json.gz")
        )
    except OSError:
        return None

    known = _SCANNED_INCOMPLETE.get(day_dir, set())
    if not known <= set(names):
        known = set()

    fallback: dict | None = None
    scanned: set[str] = set(known)
    for position, name in enumerate(reversed(names)):
        # position 0 is the newest file: read it even when it is memoised,
        # because it is the fallback this call has to return.
        if position and name in known:
            continue
        snapshot = _read_raw(os.path.join(day_dir, name))
        if snapshot is None:
            # An unreadable file is not going to become readable; memoise it so
            # the next promote does not retry the gunzip either.
            scanned.add(name)
            continue
        if snapshot.get("complete") is True:
            _SCANNED_INCOMPLETE.pop(day_dir, None)
            return snapshot
        scanned.add(name)
        if fallback is None:
            fallback = snapshot
    if fallback is None and known:
        # Every readable candidate was memoised away — the newest file must be
        # torn. Fall back to a full scan rather than promoting nothing.
        _SCANNED_INCOMPLETE.pop(day_dir, None)
        return _canonical_snapshot(map_id, day)
    _remember_incomplete(day_dir, scanned)
    return fallback


def promote_day(map_id: str, day: str) -> dict | None:
    """Recompute one UTC day's canonical snapshot and index it.

    Runs as a BackgroundTask behind a logging wrapper, and takes the same
    per-(map, day) lock as the chronicle capture so two uploads landing in the
    same 5-minute window cannot interleave a half-written index.

    It also takes this map's cross-process ledger lock, outer to the day lock
    (the same nesting order the chronicle capture uses), so a promote cannot
    land in the middle of `ledger/wipe.py` moving the tree aside and deleting
    the rows, or of a `reindex` rebuilding them.
    """
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")

    with map_lock(ledger_lock_path(map_id)), _day_lock(f"ledger:{map_id}", day):
        return _promote_locked(map_id, day)


def _promote_locked(map_id: str, day: str) -> dict | None:
    snapshot = _canonical_snapshot(map_id, day)
    if snapshot is None:
        return None

    os.makedirs(daily_root(map_id), exist_ok=True)
    _write_atomic(daily_path(map_id, day), _pack(snapshot), prefix=_TEMP_PREFIX)
    index_snapshot(map_id, snapshot)
    return snapshot


def _snapshot_deletion_safe(snapshot: dict) -> bool:
    """Whether this snapshot may delete, tolerating pre-`deletion_safe` files.

    `daily/*.json.gz` written before the flag existed carry `complete` only;
    recompute the cross-check for those rather than assuming either answer.
    """
    stored = snapshot.get("deletion_safe")
    if isinstance(stored, bool):
        return stored
    return is_deletion_safe(
        snapshot.get("complete") is True,
        snapshot.get("factions") or [],
        snapshot.get("global") or {},
    )


def index_snapshot(map_id: str, snapshot: dict) -> None:
    """Write one canonical snapshot into the index. Shared with `reindex`.

    All five writes share one connection and one transaction. Split across five
    transactions they were five separately visible states, so a reader
    landing between them saw the new `map_ledger_days` row against the previous
    promotion's faction rows — a day that reports 40 factions and serves 12.

    The same reasoning is why `reindex_day` does *not* call `store.delete_day`
    first: `upsert_day` and the two `replace_day_*` calls already replace every
    row this day owns, inside this transaction, so a separate delete only
    published a state where the day had vanished.
    """
    # `reindex_day` reads daily files that may predate the scrub in normalize_snapshot.
    snapshot = scrub_snapshot(snapshot)
    day = snapshot["day"]
    factions = snapshot.get("factions") or []
    guilds = snapshot.get("guilds") or []

    with open_connection() as conn:
        # Backs up the file lock the callers hold: one index write per map at a
        # time, whatever process or host it comes from.
        database.advisory_lock(conn, f"ledger:index:{map_id}")
        upsert_day(map_id, snapshot, conn=conn)
        replace_day_factions(map_id, day, factions, conn=conn)
        replace_day_guilds(map_id, day, guilds, conn=conn)
        touch_registry(map_id, day, snapshot["captured_at"], factions, conn=conn)

        marked = 0
        if _snapshot_deletion_safe(snapshot):
            # Absence means deletion only here. In a partial snapshot the
            # plugin simply did not get to the rest of the factions, and a
            # complete one whose faction_count disagrees with its own array
            # is not trusted to speak for the whole server either.
            marked = mark_deleted(
                map_id,
                day,
                snapshot["captured_at"],
                [f["key"] for f in factions],
                conn=conn,
            )

    if marked:
        logger.info(
            "Ledger marked %d faction(s) deleted on %s for map '%s'",
            marked,
            day,
            map_id,
        )


def reindex_day(map_id: str, day: str) -> dict | None:
    """Re-index one day from its stored `daily/` file, no raw scan.

    Same locks as `promote_day`: this rewrites the day's index rows, so it must
    not run inside a wipe, and it must not race a promote of the same day.
    """
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    with map_lock(ledger_lock_path(map_id)), _day_lock(f"ledger:{map_id}", day):
        return _reindex_locked(map_id, day)


def _reindex_locked(map_id: str, day: str) -> dict | None:
    snapshot = _read_raw(daily_path(map_id, day))
    if snapshot is None:
        return None
    # One transaction: see `index_snapshot`. The delete that used to run here
    # was both redundant (the replace_day_* calls delete inside the same
    # transaction) and visible, so a reader between the two saw the day gone.
    index_snapshot(map_id, snapshot)
    return snapshot


def prune_raw(map_id: str, keep_days: int) -> list[str]:
    """Drop raw day folders older than the newest `keep_days` of them.

    Deliberately unused: retention is keep-everything, and the daily canonical
    is recomputed from raw, so pruning is irreversible loss of the 5-minute
    resolution. Kept here so ops has one obvious place to add a call rather than
    inventing a second deletion path.
    """
    validate_map(map_id)
    if keep_days < 1:
        raise ValueError("keep_days must be >= 1")
    try:
        days = sorted(name for name in os.listdir(raw_root(map_id)) if is_valid_day(name))
    except OSError:
        return []
    removed: list[str] = []
    for day in days[:-keep_days] if keep_days < len(days) else []:
        shutil.rmtree(raw_day_dir(map_id, day), ignore_errors=True)
        removed.append(day)
    if removed:
        clear_scan_cache()
    return removed
