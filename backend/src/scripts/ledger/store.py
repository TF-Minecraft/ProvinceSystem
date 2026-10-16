"""Ledger storage layout + Postgres index for economy snapshots.

Layout mirrors the chronicle's: paths are derived, never stored, and every
function borrows a pooled connection for itself unless a caller hands one in
(`open_connection`, `read_view`) to group several statements into one
transaction. Range reads are one ordered SELECT — see `read_faction_days` for
why per-day queries are forbidden here.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from src import database

from ..util.dirs import OUTPUT_DIR, validate_map

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Column order is shared between the writer and every reader so a row can be
# turned back into a dict without naming the columns twice.
FACTION_DAY_COLUMNS: tuple[str, ...] = (
    "faction_key",
    "faction_id",
    "founded_at",
    "name",
    "rgb",
    "overlord",
    "wealth",
    "bank",
    "vassal_wealth",
    "net_income",
    "inflation_delta",
    "trade_power",
    "prestige",
    "rank",
    "rank_level",
    "rank_up_at",
    "rank_down_at",
    "prestige_position",
    "wealth_position",
    "provinces",
    "realm_size",
    "tier",
    "tier_index",
    "highest_title",
    "members",
    "members_with_vassals",
    "settlements",
    "population",
    "installations",
    "forts",
)
_FACTION_DAY_JSON_COLUMNS: tuple[str, ...] = (
    "wealth_breakdown",
    "prestige_breakdown",
    "subjects",
    "wars",
)

GUILD_DAY_COLUMNS: tuple[str, ...] = (
    "guild_id",
    "faction_id",
    "name",
    "type",
    "wealth",
    "bank",
    "expansions",
    "trade_power",
    "credit_score",
    "size",
)

# The snapshot names these two `key`/`id`; the column names carry the "faction"
# prefix so a joined row stays readable.
_FACTION_COLUMN_SOURCE = {"faction_key": "key", "faction_id": "id"}

_REGISTRY_COLUMNS: tuple[str, ...] = (
    "faction_key",
    "faction_id",
    "founded_at",
    "first_seen_day",
    "first_seen_at",
    "last_seen_day",
    "last_seen_at",
    "last_name",
    "last_rgb",
    "deleted_day",
    "deleted_at",
)

_DAY_COLUMNS: tuple[str, ...] = (
    "day",
    "captured_at",
    "captured_at_ts",
    "server_day",
    "day_progress_seconds",
    "complete",
    "schema_version",
    "faction_count",
    "guild_count",
)


def _empty_for(column: str):
    return {} if column.endswith("breakdown") else []


def _json_column(faction: dict, column: str) -> database.Jsonb:
    value = faction.get(column)
    if not isinstance(value, (dict, list)):
        value = _empty_for(column)
    return database.Jsonb(value)


def _quote(column: str) -> str:
    """`rank` is a window function name; quote every column uniformly."""
    return f'"{column}"'


def _iso(value):
    """A stored time in the form `schema.normalize_snapshot` wrote it.

    `captured_at` and the registry times are timestamptz; the API and the series
    ETag carry them as `…Z` strings with microseconds only when there are any.
    """
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def _global_block(value) -> dict:
    """The stored global block as a dict, keys sorted.

    Promotion indexes the snapshot it read back from its packed file, which
    `ingest._pack` writes with sorted keys, so the JSON text SQLite kept had
    them sorted. jsonb keeps keys in its own order; sorting them again keeps
    the series ETag, which hashes the block's repr, byte-identical.
    """
    if not isinstance(value, dict):
        # A block that is a list would reach callers as `["field"]` -> TypeError
        # on a read route; degrade to empty like the chronicle manifests.
        return {}
    return dict(sorted(value.items()))


def open_connection():
    """A pooled connection the caller owns, for running several writes as one unit.

    `with store.open_connection() as conn:` is one transaction. Every function
    here still borrows its own when `conn` is omitted; pass one in when a group
    of writes must become visible together — `ingest.index_snapshot` is the
    reason this exists.
    """
    return database.connect()


def read_view():
    """One read-only REPEATABLE READ transaction for a whole read route.

    The read routes fan out over several of the functions below. Under READ
    COMMITTED each statement sees its own snapshot, so a promotion committing
    between the day-axis query and the faction-row query would show a faction
    row for a day the axis did not return, or tag the response with an ETag
    computed from a different state than the body. One snapshot for the whole
    request rules that out.
    """
    return database.transaction(isolation="repeatable read", read_only=True)


def _read(conn, action):
    """Run `action(conn)`, borrowing a connection only if the caller passed none."""
    if conn is not None:
        return action(conn)
    with database.connect() as owned:
        return action(owned)


def _write(conn, action):
    """Run `action(conn)`, in its own transaction if the caller passed no connection."""
    if conn is not None:
        return action(conn)
    with database.connect() as owned:
        return action(owned)


# --- paths -------------------------------------------------------------------


def ledger_root(map_name: str) -> str:
    validate_map(map_name)
    return os.path.join(OUTPUT_DIR, map_name, "ledger")


def ledger_lock_path(map_name: str) -> str:
    """The per-map ledger lock file — a sibling of the tree, never inside it.

    A wipe renames `ledger/` aside, so a lock file living under it would be
    carried off mid-operation and the next acquire would create a fresh one.
    """
    return ledger_root(map_name) + ".lock"


def raw_root(map_name: str) -> str:
    return os.path.join(ledger_root(map_name), "raw")


def raw_day_dir(map_name: str, day: str) -> str:
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    return os.path.join(raw_root(map_name), day)


def raw_snapshot_path(map_name: str, day: str, hhmmss: str, sha8: str) -> str:
    return os.path.join(raw_day_dir(map_name, day), f"{hhmmss}Z-{sha8}.json.gz")


def daily_root(map_name: str) -> str:
    return os.path.join(ledger_root(map_name), "daily")


def daily_path(map_name: str, day: str) -> str:
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    return os.path.join(daily_root(map_name), f"{day}.json.gz")


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


# --- writes ------------------------------------------------------------------


def upsert_day(map_id: str, snapshot: dict, *, conn=None) -> None:
    """Record `snapshot` as the canonical daily row for its UTC day."""
    validate_map(map_id)
    day = snapshot["day"]
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")

    def action(conn):
        conn.execute(
            """
            INSERT INTO map_ledger_days
                (map_id, day, captured_at, captured_at_ts, server_day,
                 day_progress_seconds, complete, schema_version,
                 faction_count, guild_count, globals)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (map_id, day) DO UPDATE SET
                captured_at = excluded.captured_at,
                captured_at_ts = excluded.captured_at_ts,
                server_day = excluded.server_day,
                day_progress_seconds = excluded.day_progress_seconds,
                complete = excluded.complete,
                schema_version = excluded.schema_version,
                faction_count = excluded.faction_count,
                guild_count = excluded.guild_count,
                globals = excluded.globals
            """,
            (
                map_id,
                day,
                # timestamptz keeps microseconds; Java's nanoseconds round.
                snapshot["captured_at"],
                int(snapshot["captured_at_ts"]),
                snapshot.get("server_day"),
                snapshot.get("day_progress_seconds"),
                bool(snapshot.get("complete")),
                int(snapshot.get("schema_version") or 0),
                len(snapshot.get("factions") or []),
                len(snapshot.get("guilds") or []),
                database.Jsonb(snapshot.get("global") or {}),
            ),
        )

    _write(conn, action)


def _copy_rows(conn, table: str, columns: tuple[str, ...], rows: list[tuple]) -> None:
    """Bulk-insert `rows` with COPY: a third of the time of 2,000 INSERTs."""
    if not rows:
        return
    names = ", ".join(_quote(column) for column in columns)
    with conn.cursor().copy(f"COPY {table} ({names}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)


def replace_day_factions(
    map_id: str, day: str, factions: list[dict], *, conn=None
) -> None:
    """Swap this day's faction rows wholesale, inside one transaction.

    Delete-then-insert rather than upsert: a faction that left between two
    promotions of the same day must not survive as a stale row.
    """
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    columns = ("map_id", "day", *FACTION_DAY_COLUMNS, *_FACTION_DAY_JSON_COLUMNS)
    rows = [
        (
            map_id,
            day,
            *(
                faction.get(_FACTION_COLUMN_SOURCE.get(column, column))
                for column in FACTION_DAY_COLUMNS
            ),
            *(_json_column(faction, column) for column in _FACTION_DAY_JSON_COLUMNS),
        )
        for faction in factions
    ]

    def action(conn):
        conn.execute(
            "DELETE FROM map_ledger_faction_days WHERE map_id = %s AND day = %s",
            (map_id, day),
        )
        _copy_rows(conn, "map_ledger_faction_days", columns, rows)

    _write(conn, action)


def replace_day_guilds(
    map_id: str, day: str, guilds: list[dict], *, conn=None
) -> None:
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    columns = ("map_id", "day", *GUILD_DAY_COLUMNS)
    rows = [
        (
            map_id,
            day,
            guild.get("id"),
            *(guild.get(column) for column in GUILD_DAY_COLUMNS[1:]),
        )
        for guild in guilds
    ]

    def action(conn):
        conn.execute(
            "DELETE FROM map_ledger_guild_days WHERE map_id = %s AND day = %s",
            (map_id, day),
        )
        _copy_rows(conn, "map_ledger_guild_days", columns, rows)

    _write(conn, action)


def touch_registry(
    map_id: str, day: str, captured_at: str, factions: list[dict], *, conn=None
) -> None:
    """Insert/refresh registry rows for every faction present on `day`.

    `first_seen_*` is written once on insert and never moved; name and rgb are
    display fields and always take the newest value. A row that reappears has
    its `deleted_*` cleared — the faction was never gone, only absent from an
    incomplete snapshot, or it came back.
    """
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    if not factions:
        return
    rows = [
        (
            map_id,
            faction["key"],
            faction["id"],
            faction["founded_at"],
            day,
            captured_at,
            day,
            captured_at,
            faction.get("name"),
            faction.get("rgb"),
        )
        for faction in factions
    ]

    def action(conn):
        conn.cursor().executemany(
            """
            INSERT INTO map_ledger_factions AS f
                (map_id, faction_key, faction_id, founded_at,
                 first_seen_day, first_seen_at, last_seen_day, last_seen_at,
                 last_name, last_rgb)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (map_id, faction_key) DO UPDATE SET
                first_seen_day = LEAST(f.first_seen_day, excluded.first_seen_day),
                first_seen_at = CASE
                    WHEN excluded.first_seen_day < f.first_seen_day
                    THEN excluded.first_seen_at ELSE f.first_seen_at END,
                last_seen_day = GREATEST(f.last_seen_day, excluded.last_seen_day),
                last_seen_at = CASE
                    WHEN excluded.last_seen_day >= f.last_seen_day
                    THEN excluded.last_seen_at ELSE f.last_seen_at END,
                last_name = excluded.last_name,
                last_rgb = excluded.last_rgb,
                deleted_day = NULL,
                deleted_at = NULL
            """,
            rows,
        )

    _write(conn, action)


def mark_deleted(map_id: str, day: str, captured_at: str, present_keys, *, conn=None) -> int:
    """Mark every live faction absent from `day` as deleted on it.

    Caller must have checked `deletion_safe`: absence in a partial snapshot
    means the plugin ran out of budget, not that the faction was disbanded.
    Returns the number of rows marked.

    The present keys go in as one array parameter (`<> ALL(%s)`), so the
    2,000-faction cap costs one parameter, not one per key.
    """
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    keys = list(present_keys)

    def action(conn):
        # `last_seen_day <= day` guards a backfill: re-promoting an old day
        # must not bury a faction that is alive in later days.
        sql = (
            "UPDATE map_ledger_factions SET deleted_day = %s, deleted_at = %s "
            "WHERE map_id = %s AND deleted_day IS NULL AND last_seen_day <= %s"
        )
        params: list = [day, captured_at, map_id, day]
        if keys:
            sql += " AND faction_key <> ALL(%s::text[])"
            params.append(keys)
        return conn.execute(sql, params).rowcount

    return _write(conn, action)


def delete_day(map_id: str, day: str) -> None:
    """Drop every indexed row for one day. Used by reindex before a rebuild."""
    validate_map(map_id)
    if not is_valid_day(day):
        raise ValueError("Invalid ledger day")
    with database.connect() as conn:
        for table in (
            "map_ledger_faction_days",
            "map_ledger_guild_days",
            "map_ledger_days",
        ):
            conn.execute(
                f"DELETE FROM {table} WHERE map_id = %s AND day = %s", (map_id, day)
            )


# --- reads -------------------------------------------------------------------


def _day_dict(row) -> dict:
    out = {column: row[column] for column in _DAY_COLUMNS}
    out["captured_at"] = _iso(out["captured_at"])
    out["complete"] = bool(out["complete"])
    return out


def list_days(map_id: str, *, conn=None) -> list[dict]:
    """Every indexed day, oldest first — one connect, one ordered SELECT.

    `globals` is deliberately not selected: the index route only needs the
    per-day metadata, and the globals blob is the bulk of the row.
    """
    validate_map(map_id)
    rows = _read(
        conn,
        lambda c: c.execute(
            f"SELECT {', '.join(_quote(col) for col in _DAY_COLUMNS)} "
            "FROM map_ledger_days WHERE map_id = %s ORDER BY day ASC",
            (map_id,),
        ).fetchall(),
    )
    return [_day_dict(row) for row in rows]


def latest_complete_day(map_id: str, *, conn=None) -> str | None:
    validate_map(map_id)
    row = _read(
        conn,
        lambda c: c.execute(
            "SELECT day FROM map_ledger_days WHERE map_id = %s AND complete "
            "ORDER BY day DESC LIMIT 1",
            (map_id,),
        ).fetchone(),
    )
    return row["day"] if row else None


def get_day(map_id: str, day: str) -> dict | None:
    """One day's metadata plus its parsed `global` block."""
    validate_map(map_id)
    if not is_valid_day(day):
        return None
    with database.connect() as conn:
        row = conn.execute(
            f"SELECT {', '.join(_quote(c) for c in _DAY_COLUMNS)}, globals "
            "FROM map_ledger_days WHERE map_id = %s AND day = %s",
            (map_id, day),
        ).fetchone()
    if row is None:
        return None
    out = _day_dict(row)
    out["global"] = _global_block(row["globals"])
    return out


def list_registry(map_id: str, *, conn=None) -> list[dict]:
    """The faction registry, first-seen order. One connect, one ordered SELECT."""
    validate_map(map_id)
    rows = _read(
        conn,
        lambda c: c.execute(
            f"SELECT {', '.join(_quote(col) for col in _REGISTRY_COLUMNS)} "
            "FROM map_ledger_factions WHERE map_id = %s "
            "ORDER BY first_seen_day ASC, faction_id ASC",
            (map_id,),
        ).fetchall(),
    )
    return [
        {column: _iso(row[column]) for column in _REGISTRY_COLUMNS} for row in rows
    ]


def read_global_days(map_id: str, start: str, end: str, *, conn=None) -> list[dict]:
    """Per-day metadata + globals across an inclusive day range, oldest first.

    One ordered SELECT for the whole range. The chronicle index route used to
    issue one query per day, each on its own connection, so the cost scaled with
    the length of history — two years of captures meant 730 connections before
    the ETag was even computed. See the `chronicle.store.list_day_manifests`
    docstring; do not reintroduce it here, where the range read is the hot path
    rather than the index.
    """
    validate_map(map_id)
    if not is_valid_day(start) or not is_valid_day(end):
        raise ValueError("Invalid ledger day")
    rows = _read(
        conn,
        lambda c: c.execute(
            f"SELECT {', '.join(_quote(col) for col in _DAY_COLUMNS)}, globals "
            "FROM map_ledger_days WHERE map_id = %s AND day >= %s AND day <= %s "
            "ORDER BY day ASC",
            (map_id, start, end),
        ).fetchall(),
    )

    out: list[dict] = []
    for row in rows:
        entry = _day_dict(row)
        entry["global"] = _global_block(row["globals"])
        out.append(entry)
    return out


def read_faction_days(
    map_id: str,
    start: str,
    end: str,
    faction_keys=None,
    *,
    full: bool = False,
    conn=None,
) -> list[dict]:
    """Faction rows across an inclusive day range, ordered by (key, day).

    One connect, one ordered SELECT for the *whole* range and *every* requested
    key — never a query per day and never a query per faction. `full` adds the
    JSON columns (breakdowns, subjects, wars), which are most of the payload
    size; the columnar `fields=core` read must not pay for them.
    """
    validate_map(map_id)
    if not is_valid_day(start) or not is_valid_day(end):
        raise ValueError("Invalid ledger day")

    columns = ("day", *FACTION_DAY_COLUMNS)
    if full:
        columns = (*columns, *_FACTION_DAY_JSON_COLUMNS)

    sql = (
        f"SELECT {', '.join(_quote(c) for c in columns)} "
        "FROM map_ledger_faction_days "
        "WHERE map_id = %s AND day >= %s AND day <= %s"
    )
    params: list = [map_id, start, end]
    if faction_keys is not None:
        keys = list(faction_keys)
        if not keys:
            return []
        sql += " AND faction_key = ANY(%s::text[])"
        params.append(keys)
    sql += " ORDER BY faction_key ASC, day ASC"

    rows = _read(conn, lambda c: c.execute(sql, params).fetchall())

    out: list[dict] = []
    for row in rows:
        entry = {column: row[column] for column in columns}
        for column in _FACTION_DAY_JSON_COLUMNS if full else ():
            # jsonb arrives parsed; the columns are NOT NULL, the guard is for safety.
            if entry[column] is None:
                entry[column] = _empty_for(column)
        out.append(entry)
    return out


def count_factions_in_range(map_id: str, start: str, end: str, *, conn=None) -> int:
    """How many distinct factions actually have rows in an inclusive range.

    The registry is *cumulative* — it keeps every faction the map ever held,
    deleted ones included — so it is the wrong denominator for "did the default
    selection leave anything out?". A mature map's registry outnumbers its live
    factions permanently, which made `truncated` true on every default request.
    """
    validate_map(map_id)
    if not is_valid_day(start) or not is_valid_day(end):
        raise ValueError("Invalid ledger day")
    row = _read(
        conn,
        lambda c: c.execute(
            "SELECT COUNT(DISTINCT faction_key) AS total FROM map_ledger_faction_days "
            "WHERE map_id = %s AND day >= %s AND day <= %s",
            (map_id, start, end),
        ).fetchone(),
    )
    return int(row["total"]) if row else 0


def faction_has_any_row(map_id: str, faction_key: str, *, conn=None) -> bool:
    """Does this key appear anywhere in the map's history?

    `SELECT 1 … LIMIT 1` on the `(map_id, faction_key, day)` index: the caller
    only wants to tell "unknown key" from "known key, no rows in this window",
    and materialising a faction's whole history to answer that would sidestep
    every range cap the route enforces.
    """
    validate_map(map_id)
    row = _read(
        conn,
        lambda c: c.execute(
            "SELECT 1 FROM map_ledger_faction_days "
            "WHERE map_id = %s AND faction_key = %s LIMIT 1",
            (map_id, faction_key),
        ).fetchone(),
    )
    return row is not None
