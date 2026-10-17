"""Undo one backing-up chronicle wipe: put the day folders and index rows back.

The wipe is deliberately non-destructive — day directories are renamed to
`chronicle.bak.<stamp>` and index rows are copied into
`map_chronicle_snapshots_archive` before they leave the live table — so a
restore is a *move back*, not a rebuild. Nothing in this module deletes
snapshot bytes or archive rows either: the worst outcome of a half-finished
restore is that some days are back and some are still in the backup, which the
same call fixes when it is retried.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

from src import database

from ..util.dirs import validate_map
from ..util.maplock import map_lock
from .store import chronicle_lock_path, chronicle_root, is_valid_day

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

_BACKUP_MARKER = ".bak."


class RestoreError(ValueError):
    """A restore that must not proceed. `code` is the machine-readable reason."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RestoreResult:
    map_id: str
    backup_path: str | None
    # Day directories moved back out of the backup.
    restored_days: list[str]
    # Day directories left in the backup because live data already occupies them.
    skipped_days: list[str]
    # Archive index rows re-inserted into the live table.
    restored_rows: int


def validate_backup_path(map_id: str, backup_path: str) -> str:
    """Resolve `backup_path` and prove it is this map's own backup directory.

    The path comes out of an audit row, and a row is not a capability: it is
    re-derived and re-checked here against `OUTPUT_DIR/{map}/` every time. The
    checks are deliberately narrow — the resolved path must sit *directly*
    inside this map's output directory and its name must be a
    `chronicle.bak.*` sibling of the live chronicle root — so neither a
    traversal (`../../etc`), a symlink pointing out of the tree (realpath
    resolves it before the comparison), nor a stray absolute path from another
    map can be handed to `shutil.move`.
    """
    validate_map(map_id)
    if not isinstance(backup_path, str) or not backup_path.strip():
        raise RestoreError("bad_backup_path", "Backup path is empty")

    root = chronicle_root(map_id)
    map_dir = os.path.realpath(os.path.dirname(root))
    resolved = os.path.realpath(backup_path)

    if os.path.dirname(resolved) != map_dir:
        raise RestoreError(
            "bad_backup_path",
            "Backup path is outside this map's output directory",
        )
    prefix = os.path.basename(root) + _BACKUP_MARKER
    if not os.path.basename(resolved).startswith(prefix):
        raise RestoreError(
            "bad_backup_path",
            "Backup path is not a chronicle backup directory",
        )
    return resolved


def live_day_count(map_id: str) -> int:
    validate_map(map_id)
    with database.connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS n FROM {_LIVE_TABLE} WHERE map_id = %s",
            (map_id,),
        ).fetchone()
    return int(row["n"] if row is not None else 0)


def has_live_data(map_id: str) -> bool:
    """True when this map still has a chronicle — index rows or day folders.

    Both halves matter: a wipe that crashed between the archive insert and the
    directory move leaves rows without a backup, and one that crashed after the
    move leaves a directory a fresh capture has already started refilling.
    """
    if live_day_count(map_id) > 0:
        return True
    root = chronicle_root(map_id)
    try:
        return bool(os.listdir(root))
    except OSError:
        return False


def _archived_days(map_id: str, archived_at: int) -> list[str]:
    with database.connect() as conn:
        rows = conn.execute(
            f"SELECT day FROM {_ARCHIVE_TABLE} WHERE map_id = %s AND archived_at = to_timestamp(%s) "
            "ORDER BY day ASC",
            (map_id, int(archived_at)),
        ).fetchall()
    return [str(row["day"]) for row in rows]


def _reinsert_rows(map_id: str, archived_at: int, exclude: set[str]) -> int:
    """Copy archived index rows back into the live table. Idempotent.

    `ON CONFLICT DO NOTHING` rather than an upsert: a day that is live right now
    (either because a retry already restored it, or because a merge is
    happening around live data) keeps whatever is on disk for it. `exclude`
    drops the days whose directories were *not* moved back, so a row never ends
    up describing bytes that are not the ones it was captured from.
    """
    columns = ", ".join(_COLUMNS)
    with database.connect() as conn:
        return conn.execute(
            f"INSERT INTO {_LIVE_TABLE} ({columns}) "
            f"SELECT {columns} FROM {_ARCHIVE_TABLE} "
            "WHERE map_id = %s AND archived_at = to_timestamp(%s) AND day <> ALL(%s::text[]) "
            "ORDER BY day ASC "
            "ON CONFLICT (map_id, day) DO NOTHING",
            (map_id, int(archived_at), sorted(exclude)),
        ).rowcount


def restore_wipe(
    map_id: str,
    *,
    archived_at: int,
    backup_path: str | None,
    merge: bool = False,
) -> RestoreResult:
    """Move one wipe's day folders back and re-insert its archived index rows.

    Ordering mirrors the wipe in reverse — directories first, then rows — for
    the same crash-recovery reason. A crash after a move but before the insert
    leaves bytes on disk that no index row points at, which is invisible to
    readers and is fixed by re-running; the opposite order would publish index
    rows for days whose files are still sitting in the backup, i.e. a chronicle
    that 404s day by day.

    Every step is idempotent: a day directory that is already in place is left
    alone (and its archived row is not re-inserted), and the row insert ignores
    conflicts, so retrying after a partial failure is always safe. Archive rows
    and backup bytes are never deleted — only the (now empty) backup directory
    is removed, and only if it is genuinely empty.

    `merge=False` (the default, and what the route requires an explicit opt-in
    to change) assumes the caller has already refused when live data exists.
    With `merge=True`, days that already exist live win: the backup copy stays
    in the backup directory and is reported in `skipped_days`. Restoring never
    overwrites live snapshot bytes.
    """
    validate_map(map_id)

    # Held for the whole restore, across processes: the directory moves and the
    # row re-insert are separate steps, and `capture_if_due` runs from every
    # upload. A capture landing between them would occupy a day directory the
    # archived row is about to be published for. Reentrant, so an HTTP caller
    # already holding it can still call this.
    with map_lock(chronicle_lock_path(map_id)):
        return _restore_locked(
            map_id, archived_at=archived_at, backup_path=backup_path
        )


def _restore_locked(
    map_id: str,
    *,
    archived_at: int,
    backup_path: str | None,
) -> RestoreResult:
    """Body of `restore_wipe`; caller holds the map lock.

    `merge` is not threaded through on purpose: the merge decision is entirely
    "a day directory that already exists wins", which this does unconditionally.
    """
    root = chronicle_root(map_id)
    resolved = validate_backup_path(map_id, backup_path) if backup_path else None

    archived = _archived_days(map_id, archived_at)
    backup_exists = bool(resolved) and os.path.isdir(resolved)
    if not backup_exists and not archived:
        # Nothing left to put back anywhere. Either this wipe was already
        # restored and its directory consumed, or the backup was removed
        # outside the app — say so rather than reporting a hollow success.
        raise RestoreError("nothing_to_restore", "No backup contents left to restore")

    restored_days: list[str] = []
    skipped_days: list[str] = []

    if backup_exists:
        os.makedirs(root, exist_ok=True)
        for name in sorted(os.listdir(resolved)):
            source = os.path.join(resolved, name)
            if not is_valid_day(name) or not os.path.isdir(source):
                # Not something the capture wrote; leave it where it is rather
                # than moving an unknown name into the live chronicle.
                continue
            destination = os.path.join(root, name)
            if os.path.exists(destination):
                skipped_days.append(name)
                continue
            shutil.move(source, destination)
            restored_days.append(name)

    exclude = set(skipped_days)
    if not backup_exists:
        # The backup directory is gone (consumed by an earlier restore, or
        # removed outside the app) but archive rows survive. Publishing a row
        # for a day with no directory would make the index advertise a day that
        # 404s file by file, so only re-insert the days whose bytes are
        # actually back in the live tree.
        exclude.update(
            day for day in archived if not os.path.isdir(os.path.join(root, day))
        )

    inserted = _reinsert_rows(map_id, archived_at, exclude=exclude)

    if backup_exists:
        try:
            os.rmdir(resolved)
        except OSError:
            # Still holds skipped days or unrecognised files: keep it, it is the
            # only copy of whatever is left in it.
            pass

    return RestoreResult(
        map_id=map_id,
        backup_path=resolved,
        restored_days=restored_days,
        skipped_days=skipped_days,
        restored_rows=inserted,
    )
