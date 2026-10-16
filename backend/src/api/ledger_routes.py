"""Read routes for the economy ledger (SimpleFactions snapshots).

`ledger` is the economy series; `chronicle` remains the map timelapse — see
`src/scripts/ledger/__init__.py` for why the two names exist side by side.

Everything here is a plain `def`, not `async def`: every body is synchronous
database reads plus JSON encoding, so FastAPI runs it in the threadpool instead of
blocking the event loop (same reasoning as `chronicle_routes.get_chronicle_index`).

Shapes are frozen against `frontend/app/lib/map/ledgerData.ts`. The series
responses are **columnar** — one shared `days[]` axis and one array per field —
because a row-per-day-per-faction shape repeats every key name once per day and
costs several megabytes over a two-year range. `null` at index `i` means the
faction (or field) was absent from that day, which is deliberately distinct
from `0`.

**No server-side deltas.** `net_income` / `inflation_delta` / `guild_income` are
full-day projections from the game and are served as their own series; a stock
delta is the client's to compute, and mixing the two would silently present a
projection as an observed change.
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from .http_headers import (
    add_no_cache,
    conditional_file_response,
    conditional_json_response,
    make_etag,
)
from .map_access import ensure_map_access
from ..scripts.ledger import store
from ..scripts.ledger.schema import MAX_BREAKDOWN_KEYS, MAX_BREAKDOWN_KEY_CHARS

logger = logging.getLogger(__name__)

ledger_router = APIRouter()

# A request past either cap is answered 400, never silently trimmed: a partial
# page that looks complete is worse than an error the caller can react to.
MAX_RANGE_DAYS = 730
MAX_FACTION_KEYS = 40
DEFAULT_FACTION_COUNT = 12

# Backstop on the *product* of the two axes above, for `fields=full` only:
# `_breakdown_columns` allocates one full-length array per breakdown key per
# faction, so 40 factions x 730 days x 64 keys x 2 breakdowns is ~3.7M list
# slots from one unauthenticated request. Deliberately set to the product of the
# per-axis caps rather than anything smaller: every request that passes
# `_parse_faction_keys` and `_resolve_range` is *by construction* at or under
# this, so no caller the API already accepts - the viewer included, which asks
# for `fields=full` over the whole history with every selected faction - can be
# refused by it. It exists to catch a future caps change that would multiply out
# to something far larger, not to police today's clients. The allocation itself
# is bounded by serialising the payload only once; see `_series_etag`.
MAX_FULL_FACTION_DAYS = MAX_FACTION_KEYS * MAX_RANGE_DAYS

# Mirrors `schema._GLOBAL_INT_FIELDS + _GLOBAL_FLOAT_FIELDS`, and
# `LedgerGlobalField` on the client. faction_wealth / pouch_wealth /
# player_bank_wealth are three separate series on purpose — they overlap in
# ways only the game knows, so they must never be summed here or downstream.
GLOBAL_FIELDS: tuple[str, ...] = (
    "faction_count",
    "guild_count",
    "claimed_provinces",
    "population",
    "active_wars",
    "max_wealth_prestige",
    "faction_wealth",
    "pouch_wealth",
    "player_bank_wealth",
    "liquid_wealth",
    "guild_liquid_wealth",
    "node_wealth",
    "expansion_wealth",
    "guild_income",
)

# Mirrors `LedgerFactionField`. `rank_up_at` / `rank_down_at` are in here
# because the rank threshold lines are drawn from the per-faction values the
# snapshot carried that day — never from `ranks.yml`, which is mutable config
# with no history and would redraw every past day whenever staff edit it.
FACTION_SERIES_FIELDS: tuple[str, ...] = (
    "wealth",
    "bank",
    "vassal_wealth",
    "net_income",
    "inflation_delta",
    "trade_power",
    "prestige",
    "rank_up_at",
    "rank_down_at",
    "prestige_position",
    "wealth_position",
    "provinces",
    "realm_size",
    "members",
    "members_with_vassals",
    "settlements",
    "population",
    "installations",
    "forts",
)

# Label columns carried alongside the numeric series as string arrays.
FACTION_LABEL_FIELDS: tuple[str, ...] = ("rank", "tier")

_BREAKDOWN_COLUMNS = {"wealth": "wealth_breakdown", "prestige": "prestige_breakdown"}


# --- helpers -----------------------------------------------------------------


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _require_day(value: str, what: str) -> str:
    if not store.is_valid_day(value):
        raise _bad_request(f"Invalid ledger {what} '{value}', expected YYYY-MM-DD")
    return value


def _day_span(start: str, end: str) -> int:
    """Inclusive length of a day range, in days."""
    first = date.fromisoformat(start)
    last = date.fromisoformat(end)
    return (last - first).days + 1


def _resolve_range(
    days: list[str], start: str | None, end: str | None
) -> tuple[str, str, bool]:
    """Clamp/validate a requested range against what the map actually holds.

    An *explicit* over-long range is a 400 — the caller asked for something the
    API refuses to serve. A range that is only long because it *defaulted* to
    the whole of history is clamped to the newest `MAX_RANGE_DAYS` and flagged
    `truncated`, so a map that has been running for three years still answers
    its own charts instead of erroring on every default request.
    """
    explicit = start is not None or end is not None
    if start is not None:
        start = _require_day(start.strip(), "start")
    if end is not None:
        end = _require_day(end.strip(), "end")

    if start is not None and end is not None and end < start:
        raise _bad_request("Ledger range end precedes start")

    if not days:
        # No history: answer an empty range rather than inventing today's date,
        # which would make `days[]` and the range disagree.
        resolved_start = start or (end or "0001-01-01")
        resolved_end = end or resolved_start
        if explicit and _day_span(resolved_start, resolved_end) > MAX_RANGE_DAYS:
            raise _bad_request(
                f"Ledger range exceeds {MAX_RANGE_DAYS} days"
            )
        return resolved_start, resolved_end, False

    resolved_end = end or days[-1]
    resolved_start = start or days[0]
    if resolved_end < resolved_start:
        raise _bad_request("Ledger range end precedes start")

    if _day_span(resolved_start, resolved_end) > MAX_RANGE_DAYS:
        if explicit:
            raise _bad_request(f"Ledger range exceeds {MAX_RANGE_DAYS} days")
        clamped = date.fromisoformat(resolved_end) - timedelta(days=MAX_RANGE_DAYS - 1)
        return clamped.isoformat(), resolved_end, True
    return resolved_start, resolved_end, False


def _require_affordable_full_read(full: bool, size: int, faction_count: int) -> None:
    """400 when a `fields=full` read would allocate past MAX_FULL_FACTION_DAYS.

    `size` is the length of the resolved day axis - the days the map actually
    holds in range - not the requested span. The two differ by a lot: a one-day
    map answers `start=2020-01-01&end=2026-01-01` with a single column, and
    charging that request for 2192 days would refuse a response the size of one
    row. What is being bounded is the allocation, and the allocation is
    `size * faction_count` arrays.

    Refused rather than trimmed, like every other cap on this route: a partial
    answer that looks complete is worse than an error the caller can react to.
    `fields=core` is never checked - it has no breakdown arrays, so the per-axis
    caps already bound it.
    """
    if not full or faction_count <= 0:
        return
    faction_days = size * faction_count
    if faction_days > MAX_FULL_FACTION_DAYS:
        raise _bad_request(
            f"Ledger 'fields=full' response covers {faction_days} faction-days, "
            f"cap is {MAX_FULL_FACTION_DAYS}. Narrow the day range, ask for "
            "fewer factions, or use fields=core."
        )


def _series_etag(
    *,
    map_id: str,
    fields: str,
    range_start: str,
    range_end: str,
    keys: list[str],
    truncated: bool,
    day_rows: list[dict],
    registry: dict[str, dict],
) -> str:
    """Identity of a series response, derived without serialising the payload.

    `conditional_json_response` otherwise hashes the encoded body, which for a
    `fields=full` range means the structure, the JSON string and a second UTF-8
    copy of that string all alive at once. Everything the body is built from is
    already in memory here and is O(days + factions) rather than
    O(days x factions x breakdown keys), so the tag comes from that instead and
    the body is encoded exactly once, for sending.

    Correctness rests on covering every input the payload is built from:

    * the request itself (map, fields, resolved range, key set, `truncated`);
    * every day row's full identity. `captured_at` / `captured_at_ts` name the
      canonical snapshot the day was promoted from, so re-promoting a day onto a
      different snapshot changes them - and with them every faction row and
      global that day contributes;
    * the registry rows the response reads labels out of, which is how a
      faction with no rows in range still gets its name and colour.
    """
    parts: list[object] = [map_id, fields, range_start, range_end, truncated]
    parts.extend(keys)
    for row in day_rows:
        # Every column the store returns, not a hand-listed subset: a column
        # added to `map_ledger_days` later joins the tag automatically instead
        # of silently falling out of it.
        parts.extend(f"{name}={value}" for name, value in sorted(row.items()))
    for key in keys:
        entry = registry.get(key)
        if entry is None:
            continue
        parts.append(key)
        parts.extend(
            entry.get(column)
            for column in ("faction_id", "founded_at", "last_name", "last_rgb")
        )
    return make_etag(*parts)


def _parse_faction_keys(raw: str | None) -> list[str] | None:
    """`?factions=k,k` -> deduplicated key list, or None for "server picks"."""
    if raw is None:
        return None
    keys: list[str] = []
    seen: set[str] = set()
    for part in raw.split(","):
        key = part.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    if not keys:
        return None
    if len(keys) > MAX_FACTION_KEYS:
        raise _bad_request(
            f"Ledger request asks for {len(keys)} factions, cap is {MAX_FACTION_KEYS}"
        )
    return keys


def _default_faction_keys(
    map_id: str, days: list[str], anchor: str | None, *, conn=None
) -> list[str]:
    """Top `DEFAULT_FACTION_COUNT` factions by wealth on the anchor day.

    The anchor is `latest_complete_day` so the ranking comes from a snapshot
    known to hold every faction; ranking off a partial day would pick whichever
    factions the plugin happened to reach before it ran out of budget. Falls
    back to the newest indexed day when nothing ever reported complete.
    """
    day = anchor or (days[-1] if days else None)
    if day is None:
        return []
    rows = store.read_faction_days(map_id, day, day, conn=conn)
    rows.sort(key=lambda row: (row.get("wealth") is None, -(row.get("wealth") or 0.0)))
    return [row["faction_key"] for row in rows[:DEFAULT_FACTION_COUNT]]


def _group_by_key(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["faction_key"], []).append(row)
    return grouped


def _global_columns(day_rows: list[dict], index: dict[str, int], size: int) -> dict:
    columns = {field: [None] * size for field in GLOBAL_FIELDS}
    for row in day_rows:
        position = index[row["day"]]
        blob = row.get("global") or {}
        for field in GLOBAL_FIELDS:
            columns[field][position] = blob.get(field)
    return columns


def _breakdown_columns(
    rows: list[dict], index: dict[str, int], size: int
) -> dict[str, dict[str, list]]:
    """Per-breakdown-key columns, keys unioned across the whole range.

    A key that appears only on some days still gets a full-length array so the
    client can stack without re-deriving the key set per day; `null` marks the
    days where that component was absent, which a chart must draw as a gap and
    not as a component that fell to zero.

    The key set is capped again here even though `schema._as_breakdown` refuses
    an over-wide breakdown on the way in: the union runs over the whole
    requested range, this allocates one full-length array per key, and a row
    that predates the ingest cap (or arrived by any other path) must not be able
    to turn a read into an unbounded allocation.
    """
    out: dict[str, dict[str, list]] = {}
    for name, column in _BREAKDOWN_COLUMNS.items():
        keys: list[str] = []
        seen: set[str] = set()
        dropped = 0
        for row in rows:
            blob = row.get(column)
            if not isinstance(blob, dict):
                continue
            for key in blob:
                if key in seen:
                    continue
                if len(str(key)) > MAX_BREAKDOWN_KEY_CHARS or len(keys) >= MAX_BREAKDOWN_KEYS:
                    dropped += 1
                    continue
                seen.add(key)
                keys.append(key)
        if dropped:
            logger.warning(
                "Ledger %s breakdown omitted %d key(s) past the %d-key cap",
                name,
                dropped,
                MAX_BREAKDOWN_KEYS,
            )
        keys.sort()
        series = {key: [None] * size for key in keys}
        for row in rows:
            blob = row.get(column)
            if not isinstance(blob, dict):
                continue
            position = index.get(row["day"])
            if position is None:
                continue  # see _faction_block
            for key, amount in blob.items():
                if key in series:
                    series[key][position] = amount
        out[name] = series
    return out


def _faction_block(
    rows: list[dict],
    index: dict[str, int],
    size: int,
    *,
    full: bool,
    registry: dict[str, dict] | None = None,
    key: str | None = None,
) -> dict:
    """One faction's columnar block. `rows` are this faction's rows, day-ascending."""
    faction_key = key or (rows[0]["faction_key"] if rows else "")
    registry_row = (registry or {}).get(faction_key) or {}

    series = {field: [None] * size for field in FACTION_SERIES_FIELDS}
    labels = {field: [None] * size for field in FACTION_LABEL_FIELDS}
    for row in rows:
        # `.get`, not `[...]`: the day axis and the faction rows are two
        # separate queries, and a faction row can carry a day the axis does not
        # (an `index_snapshot` committing between them, a row whose day row was
        # deleted). A KeyError here is a 500 on a public read route, so a day
        # with no column to write into is skipped instead.
        position = index.get(row["day"])
        if position is None:
            continue
        for field in FACTION_SERIES_FIELDS:
            series[field][position] = row.get(field)
        for field in FACTION_LABEL_FIELDS:
            labels[field][position] = row.get(field)

    # Name and rgb are the *latest* label, not per-day arrays: a faction that
    # renames mid-season should appear under one current name in a legend.
    latest = rows[-1] if rows else {}
    return {
        "key": faction_key,
        "id": latest.get("faction_id") or registry_row.get("faction_id") or "",
        "founded_at": latest.get("founded_at") or registry_row.get("founded_at") or "",
        "name": latest.get("name") or registry_row.get("last_name") or "",
        "rgb": latest.get("rgb") or registry_row.get("last_rgb") or "",
        "series": series,
        "rank": labels["rank"],
        "tier": labels["tier"],
        "breakdowns": (
            _breakdown_columns(rows, index, size)
            if full
            else {"wealth": {}, "prestige": {}}
        ),
    }


def _day_axis(day_rows: list[dict]) -> tuple[list[str], dict[str, int]]:
    days = [row["day"] for row in day_rows]
    return days, {day: position for position, day in enumerate(days)}


# --- routes ------------------------------------------------------------------


@ledger_router.get("/{map_name}/ledger/index")
def get_ledger_index(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    """Every indexed day plus the faction registry.

    Keyed off `entry.id`, never the raw path segment: `ensure_map_access`
    normalises (strip + lower) before its registry lookup, so "/%20MaIn/..." is
    granted as "main" and every filesystem/database key below must use that same
    normalised id.
    """
    map_id = ensure_map_access(map_name, authorization).id

    # One snapshot for the three reads, so the days and the registry agree.
    with store.read_view() as conn:
        day_rows = store.list_days(map_id, conn=conn)
        latest_complete = store.latest_complete_day(map_id, conn=conn)
        registry_rows = store.list_registry(map_id, conn=conn)
    days = [row["day"] for row in day_rows]
    server_days = [row["server_day"] for row in day_rows if row["server_day"] is not None]

    payload = {
        "days": days,
        "first": days[0] if days else None,
        "last": days[-1] if days else None,
        "latest_complete_day": latest_complete,
        # A day is incomplete when its canonical snapshot never reported
        # `complete: true`. Absence on such a day is not deletion, and a client
        # must not read a dip in faction_count there as factions disbanding.
        "incomplete_days": [row["day"] for row in day_rows if not row["complete"]],
        # Exposed alongside `days` but never used to partition: the in-game day
        # counts server uptime and stops during downtime, so it drifts against
        # the wall clock. Partitioning is on `captured_at`'s UTC date.
        "server_day_first": server_days[0] if server_days else None,
        "server_day_last": server_days[-1] if server_days else None,
        "factions": [
            {
                "key": row["faction_key"],
                "id": row["faction_id"],
                "founded_at": row["founded_at"],
                "name": row["last_name"],
                "rgb": row["last_rgb"],
                "first_seen_day": row["first_seen_day"],
                "first_seen_at": row["first_seen_at"],
                "last_seen_day": row["last_seen_day"],
                "last_seen_at": row["last_seen_at"],
                # Set only from a `complete: true` snapshot that stopped
                # including the faction — see `ingest.index_snapshot`.
                "deleted_day": row["deleted_day"],
                "deleted_at": row["deleted_at"],
            }
            for row in registry_rows
        ],
    }
    return conditional_json_response(payload, if_none_match=if_none_match)


@ledger_router.get("/{map_name}/ledger/series")
def get_ledger_series(
    map_name: str,
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    factions: str | None = Query(default=None),
    fields: str = Query(default="core"),
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    """Columnar series over a day range for a bounded set of factions.

    `fields=core` (the default) omits the breakdown maps, which are the bulk of
    the payload; `fields=full` includes them. The numeric series are the same
    either way — the client charts several of them at once and a second
    round-trip per field would be worse than the bytes.
    """
    map_id = ensure_map_access(map_name, authorization).id

    normalized_fields = (fields or "core").strip().lower()
    if normalized_fields not in {"core", "full"}:
        raise _bad_request("Ledger 'fields' must be 'core' or 'full'")
    full = normalized_fields == "full"

    requested_keys = _parse_faction_keys(factions)

    # One connection and one snapshot for the whole request, passed through
    # every store call below. Each of them used to open its own, which was
    # seven connects for one response; sharing one also makes the day axis, the
    # ETag inputs and the faction rows a single consistent view of the database.
    with store.read_view() as conn:
        all_days = [row["day"] for row in store.list_days(map_id, conn=conn)]
        range_start, range_end, truncated = _resolve_range(all_days, start, end)

        if not all_days:
            return conditional_json_response(
                {
                    "days": [],
                    "server_day": [],
                    "captured_at": [],
                    "complete": [],
                    "global": {field: [] for field in GLOBAL_FIELDS},
                    "factions": [],
                    "truncated": False,
                },
                if_none_match=if_none_match,
            )

        day_rows = store.read_global_days(map_id, range_start, range_end, conn=conn)
        days, index = _day_axis(day_rows)
        size = len(days)

        if requested_keys is None:
            keys = _default_faction_keys(
                map_id,
                all_days,
                store.latest_complete_day(map_id, conn=conn),
                conn=conn,
            )
            # Against the factions that actually have rows in the resolved
            # range, not against the registry: the registry is cumulative and
            # keeps every faction the map ever held, so comparing to it reported
            # `truncated` on every default request the moment a map's first
            # faction was deleted.
            in_range = store.count_factions_in_range(
                map_id, range_start, range_end, conn=conn
            )
            truncated = truncated or in_range > len(keys)
        else:
            keys = requested_keys

        _require_affordable_full_read(full, size, len(keys))

        registry = {
            row["faction_key"]: row for row in store.list_registry(map_id, conn=conn)
        }
        etag = _series_etag(
            map_id=map_id,
            fields=normalized_fields,
            range_start=range_start,
            range_end=range_end,
            keys=keys,
            truncated=truncated,
            day_rows=day_rows,
            registry=registry,
        )
        rows = store.read_faction_days(
            map_id, range_start, range_end, keys, full=full, conn=conn
        )
        grouped = _group_by_key(rows)

    payload = {
        "days": days,
        "server_day": [row["server_day"] for row in day_rows],
        "captured_at": [row["captured_at"] for row in day_rows],
        "complete": [row["complete"] for row in day_rows],
        "global": _global_columns(day_rows, index, size),
        "factions": [
            _faction_block(
                grouped.get(key, []), index, size, full=full, registry=registry, key=key
            )
            # Requested order is preserved so the client's colour assignment is
            # stable across refetches; a key with no rows in range still gets an
            # all-null block rather than vanishing from the response.
            for key in keys
            if key in grouped or key in registry
        ],
        "truncated": truncated,
    }
    # `etag=` on purpose: the default hashes the encoded body, which doubles the
    # peak memory of exactly the response this route's cap is about.
    return conditional_json_response(payload, etag=etag, if_none_match=if_none_match)


@ledger_router.get("/{map_name}/ledger/faction/{key}")
def get_ledger_faction(
    map_name: str,
    key: str,
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    """One faction's full series, plus its overlord/subject/war history.

    Always `full`: a single faction over one range is small enough that a `core`
    variant would only add a mode for the client to get wrong.
    """
    map_id = ensure_map_access(map_name, authorization).id

    # One snapshot for every read below; see get_ledger_series.
    with store.read_view() as conn:
        all_days = [row["day"] for row in store.list_days(map_id, conn=conn)]
        range_start, range_end, _ = _resolve_range(all_days, start, end)

        registry = {
            row["faction_key"]: row for row in store.list_registry(map_id, conn=conn)
        }
        if key not in registry and all_days:
            # An indexed-row probe, not a range read: this only distinguishes
            # "unknown key" from "known key with nothing in the requested
            # window", and reading `all_days[0]..all_days[-1]` to answer it
            # materialised the faction's entire history, sidestepping
            # MAX_RANGE_DAYS on a route that otherwise enforces it.
            if not store.faction_has_any_row(map_id, key, conn=conn):
                return add_no_cache(JSONResponse({"error": "Faction not found"}, 404))

        day_rows = (
            store.read_global_days(map_id, range_start, range_end, conn=conn)
            if all_days
            else []
        )
        rows = (
            store.read_faction_days(
                map_id, range_start, range_end, [key], full=True, conn=conn
            )
            if all_days
            else []
        )
    days, index = _day_axis(day_rows)
    size = len(days)

    block = _faction_block(rows, index, size, full=True, registry=registry, key=key)

    overlord: list = [None] * size
    subjects: list = [[] for _ in range(size)]
    wars: list = [[] for _ in range(size)]
    for row in rows:
        position = index.get(row["day"])
        if position is None:
            continue  # see _faction_block
        overlord[position] = row.get("overlord")
        subjects[position] = row.get("subjects") or []
        wars[position] = row.get("wars") or []

    payload = {
        **block,
        "days": days,
        "server_day": [row["server_day"] for row in day_rows],
        "captured_at": [row["captured_at"] for row in day_rows],
        "complete": [row["complete"] for row in day_rows],
        "overlord": overlord,
        "subjects": subjects,
        "wars": wars,
    }
    return conditional_json_response(payload, if_none_match=if_none_match)


@ledger_router.get("/{map_name}/ledger/day/{day}")
def get_ledger_day(
    map_name: str,
    day: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """One day's canonical snapshot, streamed as the gzip bytes on disk.

    Served as application/gzip so `server.EXCLUDED_FROM_GZIP` keeps the GZip
    middleware from re-compressing it; the client gunzips it itself, exactly as
    it already does for the chronicle's stored files.
    """
    map_id = ensure_map_access(map_name, authorization).id
    _require_day(day, "day")

    path = store.daily_path(map_id, day)
    if not os.path.isfile(path):
        return add_no_cache(JSONResponse({"error": "Ledger day not found"}, 404))
    try:
        return conditional_file_response(
            path,
            media_type="application/gzip",
            if_none_match=if_none_match,
            if_modified_since=if_modified_since,
        )
    except OSError:
        # isfile() and the stat inside the response are two syscalls; a promote
        # replacing the file in between is a 404, not a 500.
        return add_no_cache(JSONResponse({"error": "Ledger day not found"}, 404))
