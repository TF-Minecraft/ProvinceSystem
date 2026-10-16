"""Chronicle storage layout + Postgres index for daily map snapshots."""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone

from src.api.map_registry import get_map_entry
from src.skins.codes import CodeError, normalize_realm_id
from src import database

from ..util.dirs import OUTPUT_DIR, defines_file, validate_map

# The set of source files a snapshot captures. Order is the manifest order.
# New names are appended, never inserted: days captured before a name existed
# simply have no entry for it, and the read route answers those with its normal
# missing-file 404.
CHRONICLE_FILES: tuple[str, ...] = (
    "nation",
    "province_data",
    "map_markers",
    "trade",
    "guilds",
    "zoc_overlays",
    "empire",
    "infestation_data",
    "county",
    "duchy",
    "kingdom",
)

# Sources a map may legitimately never have. `empire.json` only exists once
# someone draws empires, and `infestation_data.json` only once the plugin uploads
# one — map `main` has none at all today. An absent file here is recorded in the
# manifest's `absent` list rather than `missing`, so it does not mark the day
# incomplete, does not make capture_if_due force a re-capture on every upload,
# and does not show up as a problem in verify. A file in this set that is
# *present but torn* is still `invalid`: that is a real fault, not an absence.
#
# County, duchy and kingdom *are* captured (appended above). Players found titles
# in-game, so those files are required day state, not live geography. Terrain /
# fertility / the province outline stay uncaptured.
OPTIONAL_CHRONICLE_FILES: frozenset[str] = frozenset(
    {
        "empire",
        "infestation_data",
    }
)

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# A `same_as` chain should be one hop in practice; the bound only exists so
# corrupt/cyclic manifests cannot spin the server.
_MAX_SAME_AS_HOPS = 64

_DEFAULT_REALM_ID = "main"


def chronicle_root(map_name: str) -> str:
    validate_map(map_name)
    return os.path.join(OUTPUT_DIR, map_name, "chronicle")


def chronicle_lock_path(map_name: str) -> str:
    """The per-map chronicle lock file — a sibling of the tree, never inside it.

    A wipe renames `chronicle/` aside, so a lock file living under it would be
    carried off mid-operation and the next acquire would create a fresh one.
    """
    return chronicle_root(map_name) + ".lock"


def chronicle_day_dir(map_name: str, day: str) -> str:
    if not is_valid_day(day):
        raise ValueError("Invalid chronicle day")
    return os.path.join(chronicle_root(map_name), day)


def stored_file_path(map_name: str, day: str, name: str) -> str:
    if name not in CHRONICLE_FILES:
        raise ValueError(f"Unknown chronicle file '{name}'")
    return os.path.join(chronicle_day_dir(map_name, day), f"{name}.json.gz")


def today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def is_valid_day(day: str) -> bool:
    """Strict YYYY-MM-DD — also rejects real-looking but invalid dates."""
    if not isinstance(day, str) or not _DAY_RE.match(day):
        return False
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def geometry_version(map_name: str) -> str | None:
    """sha256 of the static province geometry, or None if not generated yet."""
    validate_map(map_name)
    path = defines_file(map_name, "province_id_runs.bin.gz")
    if not os.path.exists(path):
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def realm_for_map(map_name: str) -> str:
    validate_map(map_name)
    entry = get_map_entry(map_name)
    if entry is None:
        return _DEFAULT_REALM_ID
    try:
        return normalize_realm_id(getattr(entry, "realm_id", None))
    except CodeError:
        # An unusable realm in maps.yml must not block history accruing.
        return _DEFAULT_REALM_ID


def _manifest(value) -> dict:
    """The stored manifest, or {} when it is not an object.

    `manifest` is jsonb, so it arrives parsed. A row whose manifest is a list
    (or a bare string/number) would otherwise reach callers as
    `manifest["files"]` -> AttributeError, i.e. a 500 on a read route.
    """
    return value if isinstance(value, dict) else {}


def _snapshot_row(conn, map_id: str, day: str) -> dict | None:
    """Read one indexed snapshot on a caller-owned connection."""
    row = conn.execute(
        "SELECT map_id, day, realm_id, captured_at, bytes, "
        "geometry_version, manifest FROM map_chronicle_snapshots "
        "WHERE map_id = %s AND day = %s",
        (map_id, day),
    ).fetchone()
    if row is None:
        return None
    return {
        "map_id": row["map_id"],
        "day": row["day"],
        "realm_id": row["realm_id"],
        "captured_at": row["captured_at"],
        "bytes": row["bytes"],
        "geometry_version": row["geometry_version"],
        "manifest": _manifest(row["manifest"]),
    }


def upsert_snapshot(
    map_id: str,
    day: str,
    realm_id: str,
    captured_at: int,
    byte_count: int,
    geometry_version: str | None,
    manifest: dict,
) -> None:
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid chronicle day")
    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO map_chronicle_snapshots
                (map_id, day, realm_id, captured_at, bytes,
                 geometry_version, manifest)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (map_id, day) DO UPDATE SET
                realm_id = excluded.realm_id,
                captured_at = excluded.captured_at,
                bytes = excluded.bytes,
                geometry_version = excluded.geometry_version,
                manifest = excluded.manifest
            """,
            (
                map_id,
                day,
                realm_id,
                int(captured_at),
                int(byte_count),
                geometry_version,
                database.Jsonb(manifest),
            ),
        )


def latest_day(map_id: str) -> str | None:
    validate_map(map_id)
    with database.connect() as conn:
        row = conn.execute(
            "SELECT day FROM map_chronicle_snapshots WHERE map_id = %s "
            "ORDER BY day DESC LIMIT 1",
            (map_id,),
        ).fetchone()
    return row["day"] if row else None


def list_days(map_id: str) -> list[str]:
    validate_map(map_id)
    with database.connect() as conn:
        rows = conn.execute(
            "SELECT day FROM map_chronicle_snapshots WHERE map_id = %s "
            "ORDER BY day ASC",
            (map_id,),
        ).fetchall()
    return [row["day"] for row in rows]


def read_view():
    """One read-only REPEATABLE READ transaction for a whole read route.

    The index route reads the day rows and the newest wipe stamp; one snapshot
    keeps a wipe committing between the two from showing days that are gone.
    """
    return database.transaction(isolation="repeatable read", read_only=True)


def list_day_rows(map_id: str, *, conn=None) -> list[tuple[str, dict, str | None]]:
    """Every indexed day with its manifest and stored geometry version.

    Oldest first — one connection, one ordered SELECT. See list_day_manifests
    for why the index route must not go back to the database per day; the
    stored `geometry_version` rides along in the same row so the index can
    compare it against the live geometry without a second pass.

    A manifest that is not an object (e.g. a list) degrades to {} rather than
    raising: an unreadable row must not take down the index for every other
    day. The geometry version is handed back exactly as stored — including None
    — so callers can decide what "unknown" means. Pass `conn` to read in the
    caller's snapshot.
    """
    validate_map(map_id)
    sql = (
        "SELECT day, manifest, geometry_version FROM map_chronicle_snapshots "
        "WHERE map_id = %s ORDER BY day ASC"
    )
    if conn is not None:
        rows = conn.execute(sql, (map_id,)).fetchall()
    else:
        with database.connect() as owned:
            rows = owned.execute(sql, (map_id,)).fetchall()
    return [
        (row["day"], _manifest(row["manifest"]), row["geometry_version"])
        for row in rows
    ]


def list_day_manifests(map_id: str) -> list[tuple[str, dict]]:
    """Every indexed day with its manifest, oldest first — one query, one connection.

    The index route needs a field out of each day's manifest, which it used to
    get with a get_snapshot per day, each on its own connection, so the cost
    scaled with the length of history: two years of captures meant 730
    connections per index request, all of it on one thread before the ETag was
    even computed. The rows already arrive in one ordered SELECT for list_days,
    so the manifest can ride along in the same one.

    A manifest that is not an object degrades to {} rather than raising: an
    unreadable row must not take down the index for every other day.
    """
    return [(day, manifest) for day, manifest, _ in list_day_rows(map_id)]


def get_snapshot(map_id: str, day: str) -> dict | None:
    validate_map(map_id)
    if not is_valid_day(day):
        return None
    with database.connect() as conn:
        return _snapshot_row(conn, map_id, day)


def previous_snapshot(map_id: str, day: str) -> dict | None:
    """Newest snapshot strictly before `day` — the dedup baseline for a capture."""
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid chronicle day")
    with database.connect() as conn:
        row = conn.execute(
            "SELECT day FROM map_chronicle_snapshots "
            "WHERE map_id = %s AND day < %s ORDER BY day DESC LIMIT 1",
            (map_id, day),
        ).fetchone()
        return _snapshot_row(conn, map_id, row["day"]) if row else None


def days_referencing(map_id: str, day: str) -> list[str]:
    """Days *after* `day` whose manifest resolves a file through it.

    `previous_snapshot` only ever looks backwards, so nothing else in the
    capture path can see that later days are depending on this day's bytes.
    Overwriting `day` would silently change what those days serve — their own
    recorded sha256 would still describe the old content and no reader hashes
    on the way out. Callers use this to refuse the overwrite instead.
    """
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid chronicle day")
    with database.connect() as conn:
        rows = conn.execute(
            "SELECT day, manifest FROM map_chronicle_snapshots "
            "WHERE map_id = %s AND day > %s ORDER BY day ASC",
            (map_id, day),
        ).fetchall()

    referencing: list[str] = []
    for row in rows:
        manifest = row["manifest"]
        if not isinstance(manifest, dict):
            # A manifest that is not an object cannot be shown to point here,
            # but it also cannot be shown not to — treat it as a blocker.
            referencing.append(row["day"])
            continue
        files = manifest.get("files") or {}
        if not isinstance(files, dict) or any(
            isinstance(entry, dict) and entry.get("same_as") == day
            for entry in files.values()
        ):
            referencing.append(row["day"])
    return referencing


def resolve_stored_file(map_name: str, day: str, name: str) -> str | None:
    """Path to the bytes for (day, name), following `same_as` back-pointers."""
    validate_map(map_name)
    if name not in CHRONICLE_FILES or not is_valid_day(day):
        return None

    with database.connect() as conn:
        seen: set[str] = set()
        current = day
        for _ in range(_MAX_SAME_AS_HOPS):
            if current in seen:
                return None
            seen.add(current)

            snapshot = _snapshot_row(conn, map_name, current)
            if snapshot is None:
                return None
            entry = (snapshot["manifest"].get("files") or {}).get(name)
            if not isinstance(entry, dict):
                return None

            same_as = entry.get("same_as")
            if same_as:
                if not is_valid_day(same_as):
                    return None
                current = same_as
                continue

            path = stored_file_path(map_name, current, name)
            return path if os.path.exists(path) else None
        return None
