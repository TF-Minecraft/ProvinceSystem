"""Copy a live map tree onto a frozen dest id. Does not wipe the source.

Library only — no HTTP and no CLI. Dest ``main`` / ``dev`` are refused so this
cannot freeze the live socket. Tests use throwaway ids, never ``calavorn``.
"""

from __future__ import annotations

import os
import re
import shutil
import time
from dataclasses import dataclass

import yaml

from src.api.map_registry import _registry_path, clear_map_registry_cache
from src import database

from ..ledger.ingest import reindex_day
from ..ledger.store import daily_root, is_valid_day as is_ledger_day, ledger_lock_path
from ..util.atomic import rename_aside
from ..util import dirs
from ..util.maplock import map_lock

_CHAPTER_ID_RE = re.compile(r"[a-z0-9]+")

FORBIDDEN_DEST = frozenset({"main", "dev"})
UNKNOWN_DEST = "unknown"

_LEDGER_TABLES = (
    "map_ledger_faction_days",
    "map_ledger_guild_days",
    "map_ledger_days",
    "map_ledger_factions",
)


class ArchiveCopyError(ValueError):
    """A copy that must not proceed. ``code`` is the machine-readable reason."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ArchiveCopyResult:
    source_id: str
    dest_id: str
    display_name: str
    days: list[str]


def _normalize_id(raw: str) -> str | None:
    slug = (raw or "").strip().lower()
    if not slug or _CHAPTER_ID_RE.fullmatch(slug) is None:
        return None
    return slug


def archive_lock_path(dest_id: str) -> str:
    """Sibling of ``output/{dest}``, never inside it.

    ``chronicle.lock`` lives under ``output/{dest}/``. Taking that lock creates
    the dest folder and then rename-aside of the tree fails on Windows (open
    lock handle). The archive lock sits next to the map directory instead.
    """
    return os.path.join(dirs.OUTPUT_DIR, dest_id) + ".archive.lock"


def _map_dir(root: str, map_id: str) -> str:
    return os.path.join(root, map_id)


def _unique_sibling(path: str, kind: str, stamp: int) -> str:
    candidate = f"{path}.{kind}.{stamp}"
    suffix = 1
    while os.path.exists(candidate):
        candidate = f"{path}.{kind}.{stamp}-{suffix}"
        suffix += 1
    return candidate


def _replace_tree(source_path: str, dest_path: str, stamp: int) -> None:
    """Make dest match source: copy if source exists, else set dest aside."""
    dest_exists = os.path.exists(dest_path)
    source_exists = os.path.isdir(source_path)
    if not source_exists:
        if dest_exists:
            rename_aside(dest_path, _unique_sibling(dest_path, "bak", stamp))
        return

    parent = os.path.dirname(dest_path)
    os.makedirs(parent, exist_ok=True)
    staging = _unique_sibling(dest_path, "archive-new", stamp)
    shutil.copytree(source_path, staging)
    if os.path.exists(dest_path):
        rename_aside(dest_path, _unique_sibling(dest_path, "bak", stamp))
    rename_aside(staging, dest_path)


def _source_present(source_id: str) -> bool:
    return os.path.isdir(_map_dir(dirs.INPUT_DIR, source_id)) or os.path.isdir(
        _map_dir(dirs.DEFINES_DIR, source_id)
    )


def _clone_chronicle_rows(source_id: str, dest_id: str) -> list[str]:
    """Replace dest's chronicle index rows with source's, in one transaction."""
    with database.connect() as conn:
        conn.execute(
            "DELETE FROM map_chronicle_snapshots WHERE map_id = %s", (dest_id,)
        )
        rows = conn.execute(
            "INSERT INTO map_chronicle_snapshots "
            "(map_id, day, realm_id, captured_at, bytes, geometry_version, manifest) "
            "SELECT %s, day, %s, captured_at, bytes, geometry_version, manifest "
            "FROM map_chronicle_snapshots WHERE map_id = %s RETURNING day",
            (dest_id, dest_id, source_id),
        ).fetchall()
    return sorted(row["day"] for row in rows)


def _delete_ledger_rows(map_id: str) -> None:
    with database.connect() as conn:
        for table in _LEDGER_TABLES:
            conn.execute(f"DELETE FROM {table} WHERE map_id = %s", (map_id,))


def _reindex_copied_ledger(dest_id: str) -> None:
    root = daily_root(dest_id)
    try:
        names = os.listdir(root)
    except OSError:
        return
    days = sorted(
        name[: -len(".json.gz")]
        for name in names
        if name.endswith(".json.gz") and is_ledger_day(name[: -len(".json.gz")])
    )
    if not days:
        return
    _delete_ledger_rows(dest_id)
    with map_lock(ledger_lock_path(dest_id)):
        for day in days:
            reindex_day(dest_id, day)


def _upsert_registry_row(dest_id: str, display_name: str) -> None:
    path = str(_registry_path())
    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ArchiveCopyError("registry_invalid", "Map registry root must be an object")
    raw_maps = data.get("maps")
    if not isinstance(raw_maps, list) or not raw_maps:
        raise ArchiveCopyError(
            "registry_invalid", "Map registry requires a non-empty maps list"
        )

    row = {
        "id": dest_id,
        "public": True,
        "archived": True,
        "display_name": display_name,
        "realm_id": dest_id,
    }
    replaced = False
    new_maps: list = []
    for item in raw_maps:
        if isinstance(item, dict) and str(item.get("id") or "").strip().lower() == dest_id:
            new_maps.append(row)
            replaced = True
        else:
            new_maps.append(item)
    if not replaced:
        new_maps.append(row)
    data["maps"] = new_maps

    tmp = path + ".archive-new"
    with open(tmp, "w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=True)
    os.replace(tmp, path)
    clear_map_registry_cache()


def archive_map(
    source_id: str,
    dest_id: str,
    display_name: str,
    *,
    allow_unknown: bool = False,
) -> ArchiveCopyResult:
    source = _normalize_id(source_id)
    dest = _normalize_id(dest_id)
    if dest is None:
        raise ArchiveCopyError("dest_invalid", "Archive dest must be alphanumeric")
    if source is None:
        raise ArchiveCopyError("source_invalid", "Archive source must be alphanumeric")
    if dest in FORBIDDEN_DEST:
        raise ArchiveCopyError(
            "dest_live_socket",
            f"Archive dest cannot be '{dest}' (live socket)",
        )
    if dest == UNKNOWN_DEST and not allow_unknown:
        raise ArchiveCopyError(
            "dest_unknown",
            "Archive dest 'unknown' needs an extra confirm",
        )
    if dest == source:
        raise ArchiveCopyError("dest_is_source", "Archive dest cannot equal source")
    name = (display_name or "").strip()
    if not name:
        raise ArchiveCopyError("display_name_empty", "Archive display_name is empty")
    if not _source_present(source):
        raise ArchiveCopyError(
            "source_missing",
            f"No input/ or defines/ tree for source '{source}'",
        )

    stamp = int(time.time())
    with map_lock(archive_lock_path(dest), blocking=False):
        _replace_tree(
            _map_dir(dirs.INPUT_DIR, source), _map_dir(dirs.INPUT_DIR, dest), stamp
        )
        _replace_tree(
            _map_dir(dirs.DEFINES_DIR, source),
            _map_dir(dirs.DEFINES_DIR, dest),
            stamp,
        )
        _replace_tree(
            _map_dir(dirs.OUTPUT_DIR, source),
            _map_dir(dirs.OUTPUT_DIR, dest),
            stamp,
        )
        days = _clone_chronicle_rows(source, dest)
        _reindex_copied_ledger(dest)
        _upsert_registry_row(dest, name)

    return ArchiveCopyResult(
        source_id=source, dest_id=dest, display_name=name, days=days
    )
