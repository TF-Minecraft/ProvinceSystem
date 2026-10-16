"""Parse and normalise one SimpleFactions economy snapshot.

The authority for field types is `Map/export/ChronicleSnapshot.java`, not SF's
`docs/planning/chronicle-export/03-chronicle-payload.md` — the doc example has
`rank`/`rank_level` swapped. See `_faction_rank`.

Nothing here touches the filesystem or the database; `normalize_snapshot` is a
pure function so the route can validate before it commits to any write.
"""

from __future__ import annotations

import hashlib
import logging
import math
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

LEDGER_SCHEMA_VERSION = 1

# Caps are refusal thresholds, not truncation: a payload past them is either a
# different game or a bug, and silently storing half of it would poison the
# series with a drop nothing can distinguish from mass deletion.
MAX_FACTIONS = 2000
MAX_GUILDS = 5000
MAX_BODY_BYTES = 8 * 1024 * 1024

# A breakdown is `{component: amount}` for one faction's wealth or prestige.
# The game has a fixed, small set of components; an unbounded dict is a planted
# payload, and every distinct key across a range becomes a full-length column in
# `ledger_routes._breakdown_columns`, so ~200k keys in one 8 MiB body turn any
# later `fields=full` read into a multi-gigabyte allocation.
MAX_BREAKDOWN_KEYS = 64
MAX_BREAKDOWN_KEY_CHARS = 64

# Nesting cap for the free-form corners of the payload (`wars`). `json.loads`
# already raises RecursionError past ~1000 levels, but the recursive walks here
# and in `json.dumps` run on top of the request's own stack, so cap the depth
# where it can still be answered as a 400.
MAX_NESTING_DEPTH = 32

# `captured_at` skew bounds. The day derived from this field is the partition
# key for the whole series *and* the ordering that `_resolve_range` clamps the
# default window against, so a single snapshot dated 9999-12-31 pushes every
# real day outside the default range and empties every chart, with no per-day
# delete route to undo it. There is no legitimate reason for a snapshot to be
# dated before SimpleFactions existed or more than a clock-skew allowance into
# the future.
MIN_CAPTURED_AT = datetime(2020, 1, 1, tzinfo=timezone.utc)
MAX_CAPTURED_AT_SKEW_SECONDS = 24 * 60 * 60

# The index's integer columns are bigint; anything outside this range fails
# deep inside `index_snapshot`, which the background promotion
# swallows *after* the POST answered 200 — leaving the day permanently and
# silently unindexed. Out-of-range values are dropped here instead, exactly as
# non-finite floats are.
_INT64_MIN = -(2**63)
_INT64_MAX = 2**63 - 1

# The upload mode string is the plugin's, and the plugin owns the URL. Pinned
# here so the collision with the timelapse `chronicle` is greppable.
LEDGER_UPLOAD_MODE = "chronicle"

_GLOBAL_INT_FIELDS = (
    "faction_count",
    "guild_count",
    "claimed_provinces",
    "population",
    "active_wars",
)
_GLOBAL_FLOAT_FIELDS = (
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

_FACTION_STR_FIELDS = ("name", "rgb", "overlord", "tier", "highest_title")
_FACTION_FLOAT_FIELDS = (
    "wealth",
    "bank",
    "vassal_wealth",
    "net_income",
    "inflation_delta",
    "trade_power",
    "prestige",
    "rank_up_at",
    "rank_down_at",
)
_FACTION_INT_FIELDS = (
    "prestige_position",
    "wealth_position",
    "provinces",
    "realm_size",
    "tier_index",
    "members",
    "members_with_vassals",
    "settlements",
    "population",
    "installations",
    "forts",
)

_GUILD_STR_FIELDS = ("name", "type", "faction_id")
_GUILD_FLOAT_FIELDS = ("wealth", "bank", "trade_power", "credit_score")
_GUILD_INT_FIELDS = ("expansions", "size")


class LedgerPayloadError(ValueError):
    """A snapshot we refuse to store. `.status` is the HTTP code to answer with."""

    def __init__(self, detail: str, status: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status = status


def faction_key(faction_id: str, founded_at) -> str:
    """Stable identity for a faction across the whole series.

    Ids derive from the faction name and are reused after a faction is deleted,
    so `id` alone silently welds two unrelated factions into one series. The NUL
    separator keeps ("ab", "c") from colliding with ("a", "bc").
    """
    raw = f"{faction_id}\x00{founded_at}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def parse_instant(value) -> datetime:
    """ISO-8601 instant -> aware UTC datetime. Raises LedgerPayloadError."""
    if not isinstance(value, str) or not value.strip():
        raise LedgerPayloadError("captured_at must be an ISO-8601 instant")
    text = value.strip()
    # Reads Java Instant's trailing Z; nanosecond fractions truncate to microseconds.
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise LedgerPayloadError(f"Unparsable captured_at '{text}'") from None
    if parsed.tzinfo is None:
        # SF emits `Instant.toString()`, always zoned. A naive value is a
        # hand-built payload; read it as UTC rather than as local server time.
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def check_capture_bounds(captured_at: datetime, *, now: datetime | None = None) -> None:
    """Refuse a `captured_at` outside the sane window. Raises LedgerPayloadError.

    Bounds: not before `MIN_CAPTURED_AT` (2020-01-01Z) and not more than
    `MAX_CAPTURED_AT_SKEW_SECONDS` (24h) past the receiving server's clock. A
    day of allowance covers a plugin host with a badly-set clock or timezone
    without letting one POST park the series in the far future — where it would
    become `days[-1]`, drag the default range with it, and hide every real day
    from every viewer.
    """
    moment = captured_at.astimezone(timezone.utc)
    if moment < MIN_CAPTURED_AT:
        raise LedgerPayloadError(
            f"captured_at '{moment.isoformat()}' is before "
            f"{MIN_CAPTURED_AT.date().isoformat()}"
        )
    reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if (moment - reference).total_seconds() > MAX_CAPTURED_AT_SKEW_SECONDS:
        raise LedgerPayloadError(
            f"captured_at '{moment.isoformat()}' is more than "
            f"{MAX_CAPTURED_AT_SKEW_SECONDS} seconds in the future"
        )


def snapshot_day(captured_at) -> str:
    """Partition key: the UTC date of `captured_at`, never `server_day`.

    The in-game day counts server uptime and stops during downtime, so it drifts
    against the wall clock and cannot key a calendar series.
    """
    if isinstance(captured_at, datetime):
        moment = captured_at.astimezone(timezone.utc)
    else:
        moment = parse_instant(captured_at)
    return moment.strftime("%Y-%m-%d")


def json_safe(value, _depth: int = 0):
    """Replace non-finite floats with null, recursively.

    Mirrors `api.chronicle_routes._json_safe`: json.dumps defaults to
    allow_nan=True and emits bare NaN/Infinity, which is not JSON, so one
    poisoned number would lose the whole stored day on the viewer's JSON.parse.

    Raises `LedgerPayloadError` past `MAX_NESTING_DEPTH` rather than recursing
    into an 8 MiB `[[[[…]]]]`: the walk here (and the `json.dumps` in
    `ingest.store_raw` behind it) would otherwise exhaust the stack and surface
    as a 500 instead of the 400 an unusable payload deserves.
    """
    if _depth > MAX_NESTING_DEPTH:
        raise LedgerPayloadError(
            f"Snapshot nests deeper than {MAX_NESTING_DEPTH} levels"
        )
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item, _depth + 1) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item, _depth + 1) for item in value]
    return value


def _as_float(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    return None


def _as_int(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if _INT64_MIN <= value <= _INT64_MAX else None
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        number = int(value)
        return number if _INT64_MIN <= number <= _INT64_MAX else None
    return None


def _as_str(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _as_breakdown(value, what: str) -> dict[str, float]:
    """`{type: amount}` with non-numeric amounts dropped, not zeroed.

    Key count and key length are refusal thresholds, like `MAX_FACTIONS`: the
    game's component set is small and fixed, so a wider dict is not a bigger
    game, and every distinct key becomes a full-length column on every later
    read of the range (`ledger_routes._breakdown_columns`).
    """
    if not isinstance(value, dict):
        return {}
    if len(value) > MAX_BREAKDOWN_KEYS:
        raise LedgerPayloadError(
            f"{what} has {len(value)} keys, cap is {MAX_BREAKDOWN_KEYS}"
        )
    out: dict[str, float] = {}
    for key, amount in value.items():
        text = str(key)
        if len(text) > MAX_BREAKDOWN_KEY_CHARS:
            raise LedgerPayloadError(
                f"{what} has a key longer than {MAX_BREAKDOWN_KEY_CHARS} characters"
            )
        number = _as_float(amount)
        if number is not None:
            out[text] = number
    return out


def _legacy_guild_wealth_key(name: str, type_name: str) -> str:
    """The colored `name (type)` string SimpleFactions used as a wealth key."""
    return f"{name} #a39ba8({type_name}#a39ba8)"


def remap_wealth_breakdown_keys(snapshot: dict) -> int:
    """Rewrite display-name wealth keys to guild ids. Mutates `snapshot`.

    SimpleFactions used to key sub-guild wealth as
    `{name} #a39ba8({type}#a39ba8)`, which trips `MAX_BREAKDOWN_KEY_CHARS`.
    The same snapshot already lists `guilds[]` with `id`/`name`/`type`/
    `faction_id`, so the rewrite is exact, not fuzzy. Component keys (`Bank`,
    `Nodes`) and already-id keys are left alone.

    Returns how many keys were rewritten. Called on ingest *before* the
    64-char cap so an old plugin jar still uploads, and by the daily rewrite
    CLI so stored days join the same series.
    """
    guilds = snapshot.get("guilds")
    factions = snapshot.get("factions")
    if not isinstance(guilds, list) or not isinstance(factions, list):
        return 0

    by_faction: dict[str, dict[str, str]] = {}
    for guild in guilds:
        if not isinstance(guild, dict):
            continue
        guild_id = guild.get("id")
        name = guild.get("name")
        type_name = guild.get("type")
        faction_id = guild.get("faction_id")
        if not isinstance(guild_id, str) or not guild_id:
            continue
        if not isinstance(name, str) or not isinstance(type_name, str):
            continue
        if not isinstance(faction_id, str) or not faction_id:
            continue
        by_faction.setdefault(faction_id, {})[
            _legacy_guild_wealth_key(name, type_name)
        ] = guild_id

    remapped = 0
    for faction in factions:
        if not isinstance(faction, dict):
            continue
        faction_id = faction.get("id")
        lookup = by_faction.get(faction_id) if isinstance(faction_id, str) else None
        if not lookup:
            continue
        blob = faction.get("wealth_breakdown")
        if not isinstance(blob, dict):
            continue
        rewritten: dict = {}
        for key, amount in blob.items():
            text = str(key)
            new_key = lookup.get(text, text)
            if new_key != text:
                remapped += 1
            rewritten[new_key] = amount
        faction["wealth_breakdown"] = rewritten
    return remapped


def _as_str_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for text in (_as_str(item) for item in value) if text is not None]


def _faction_rank(raw: dict, faction_id: str) -> tuple[str | None, int | None]:
    """`rank` is the name, `rank_level` the number — per the Java, not the doc.

    SF's own payload doc shows the two swapped. Rather than trust either, accept
    whichever way round they arrive and log the mismatch: raising would drop
    every snapshot for the whole season over two cosmetic fields.

    A *numeric* `rank` is the tell, whatever `rank_level` holds. When the
    counterpart is a string the two are simply swapped. When it is not (null, or
    numeric too) there is no rank name in the payload at all, and letting
    `_as_str` turn `rank: 3` into the rank *named* "3" would put a fake label on
    every chart and every tooltip for the rest of the season. Take the number as
    the level and leave the name null.
    """
    rank = raw.get("rank")
    level = raw.get("rank_level")
    if not isinstance(rank, (int, float)) or isinstance(rank, bool):
        return _as_str(rank), _as_int(level)

    logger.warning(
        "Ledger faction '%s' sent a numeric rank (rank=%r, rank_level=%r); "
        "reading the number as the rank level, per the Java types",
        faction_id,
        rank,
        level,
    )
    if isinstance(level, str):
        rank, level = level, rank
    else:
        rank, level = None, rank
    return _as_str(rank), _as_int(level)


def _require_dict(payload, what: str) -> dict:
    if not isinstance(payload, dict):
        raise LedgerPayloadError(f"{what} must be a JSON object")
    return payload


def _normalize_global(raw) -> dict:
    source = raw if isinstance(raw, dict) else {}
    out: dict = {}
    for field in _GLOBAL_INT_FIELDS:
        out[field] = _as_int(source.get(field))
    for field in _GLOBAL_FLOAT_FIELDS:
        out[field] = _as_float(source.get(field))
    return out


def _normalize_faction(raw, index: int) -> dict:
    raw = _require_dict(raw, f"factions[{index}]")
    faction_id = _as_str(raw.get("id"))
    if not faction_id:
        raise LedgerPayloadError(f"factions[{index}] is missing 'id'")
    founded_at = _as_str(raw.get("founded_at"))
    if founded_at is None:
        # Without founded_at there is no identity — a reused id would merge two
        # factions' histories, which is exactly what faction_key exists to stop.
        raise LedgerPayloadError(f"factions[{index}] is missing 'founded_at'")

    rank, rank_level = _faction_rank(raw, faction_id)
    out: dict = {
        "key": faction_key(faction_id, founded_at),
        "id": faction_id,
        "founded_at": founded_at,
        "rank": rank,
        "rank_level": rank_level,
        "subjects": _as_str_list(raw.get("subjects")),
        "wars": json_safe(raw.get("wars")) if isinstance(raw.get("wars"), list) else [],
        "wealth_breakdown": _as_breakdown(
            raw.get("wealth_breakdown"), f"factions[{index}].wealth_breakdown"
        ),
        "prestige_breakdown": _as_breakdown(
            raw.get("prestige_breakdown"), f"factions[{index}].prestige_breakdown"
        ),
    }
    for field in _FACTION_STR_FIELDS:
        out[field] = _as_str(raw.get(field))
    for field in _FACTION_FLOAT_FIELDS:
        out[field] = _as_float(raw.get(field))
    for field in _FACTION_INT_FIELDS:
        out[field] = _as_int(raw.get(field))
    return out


def _normalize_guild(raw, index: int) -> dict:
    raw = _require_dict(raw, f"guilds[{index}]")
    guild_id = _as_str(raw.get("id"))
    if not guild_id:
        raise LedgerPayloadError(f"guilds[{index}] is missing 'id'")
    out: dict = {"id": guild_id}
    for field in _GUILD_STR_FIELDS:
        out[field] = _as_str(raw.get(field))
    for field in _GUILD_FLOAT_FIELDS:
        out[field] = _as_float(raw.get(field))
    for field in _GUILD_INT_FIELDS:
        out[field] = _as_int(raw.get(field))
    return out


def normalize_snapshot(payload, map_id: str) -> dict:
    """Validate one upload and reduce it to the shape the store persists.

    `map_id` is the registry id from the URL and always wins: the payload's own
    `map_id` is kept for the caller to compare but never used as a key. Unknown
    extra keys are ignored so a plugin-side field addition cannot 400 a season,
    and `events` is discarded outright (SF always sends it empty).
    """
    payload = _require_dict(payload, "Ledger snapshot")

    captured_at = parse_instant(payload.get("captured_at"))
    # Before anything is stored: the day derived here is a partition key and a
    # range anchor, and there is no route that deletes a single indexed day.
    check_capture_bounds(captured_at)
    day = snapshot_day(captured_at)

    complete = payload.get("complete") is True

    factions_raw = payload.get("factions")
    if complete and "factions" not in payload:
        # A complete snapshot is the one thing that can delete the whole
        # registry. A truncated or half-serialised POST loses its tail, so the
        # `factions` key simply vanishes — and defaulting that to `[]` makes a
        # broken upload byte-for-byte indistinguishable from a genuine
        # server-wide wipe. An empty *present* list is still accepted: that is
        # how an empty server reports itself.
        raise LedgerPayloadError(
            "A complete snapshot must carry a 'factions' array, even an empty one"
        )
    if factions_raw is None:
        factions_raw = []
    if not isinstance(factions_raw, list):
        raise LedgerPayloadError("'factions' must be an array")
    if len(factions_raw) > MAX_FACTIONS:
        raise LedgerPayloadError(
            f"Snapshot has {len(factions_raw)} factions, cap is {MAX_FACTIONS}"
        )

    guilds_raw = payload.get("guilds")
    if guilds_raw is None:
        guilds_raw = []
    if not isinstance(guilds_raw, list):
        raise LedgerPayloadError("'guilds' must be an array")
    if len(guilds_raw) > MAX_GUILDS:
        raise LedgerPayloadError(
            f"Snapshot has {len(guilds_raw)} guilds, cap is {MAX_GUILDS}"
        )

    # Before `_as_breakdown`'s 64-char cap: colored guild titles are not
    # component ids, and the same snapshot already names each guild's id.
    remap_wealth_breakdown_keys({"factions": factions_raw, "guilds": guilds_raw})

    factions: list[dict] = []
    seen_keys: set[str] = set()
    for index, raw in enumerate(factions_raw):
        faction = _normalize_faction(raw, index)
        if faction["key"] in seen_keys:
            # Two rows for one identity would make "present" depend on dict
            # ordering; last one wins, loudly.
            logger.warning(
                "Ledger snapshot repeats faction id=%r founded_at=%r",
                faction["id"],
                faction["founded_at"],
            )
            factions = [item for item in factions if item["key"] != faction["key"]]
        seen_keys.add(faction["key"])
        factions.append(faction)

    guilds: list[dict] = []
    seen_guilds: set[str] = set()
    for index, raw in enumerate(guilds_raw):
        guild = _normalize_guild(raw, index)
        if guild["id"] in seen_guilds:
            guilds = [item for item in guilds if item["id"] != guild["id"]]
        seen_guilds.add(guild["id"])
        guilds.append(guild)

    global_block = _normalize_global(payload.get("global"))

    return {
        "schema_version": _as_int(payload.get("schema_version")) or 0,
        "ledger_schema_version": LEDGER_SCHEMA_VERSION,
        "map_id": map_id,
        # Compared by the route, never used to route or key anything.
        "payload_map_id": _as_str(payload.get("map_id")),
        "day": day,
        "captured_at": captured_at.isoformat().replace("+00:00", "Z"),
        "captured_at_ts": int(captured_at.timestamp()),
        "server_day": _as_int(payload.get("server_day")),
        "day_progress_seconds": _as_int(payload.get("day_progress_seconds")),
        # Only a complete snapshot may be read as "everything absent is deleted".
        "complete": complete,
        "deletion_safe": is_deletion_safe(complete, factions, global_block),
        "global": global_block,
        "factions": factions,
        "guilds": guilds,
    }


def is_deletion_safe(complete: bool, factions: list[dict], global_block: dict) -> bool:
    """May absence in this snapshot be read as deletion?

    `complete: true` is necessary but not sufficient. The plugin counts the
    factions it *knows about* into `global.faction_count` separately from the
    array it serialises, so the two disagreeing means the array is short of what
    the server actually holds — a truncated body, a serialiser that gave up
    partway, a flag set before the list was filled. Any of those would delete
    every faction the array is missing, permanently, on a map that is fine.

    Refusing deletions on a mismatch costs nothing: the day still indexes, the
    registry still refreshes, and the next honest complete snapshot (one every
    five minutes) performs whatever deletion is genuinely due.
    """
    if not complete:
        return False
    declared = global_block.get("faction_count")
    if declared is None:
        # A genuine SF complete snapshot always carries `global.faction_count`.
        # Treating its absence as "nothing to cross-check, `complete` stands on
        # its own" made the whole cross-check optional: a hand-built POST could
        # simply omit `global` and have every live faction on the map stamped
        # deleted. The day still indexes; only the deletions are refused.
        logger.warning(
            "Ledger complete snapshot carries no global.faction_count; "
            "refusing to process deletions from it"
        )
        return False
    if declared != len(factions):
        logger.warning(
            "Ledger complete snapshot declares faction_count=%r but carries %d "
            "faction(s); refusing to process deletions from it",
            declared,
            len(factions),
        )
        return False
    return True
