"""Map chronicle read routes + the localhost-gated manual capture trigger."""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .http_headers import add_no_cache, conditional_file_response, conditional_json_response
from .internal_access import require_localhost
from .map_access import ensure_map_access
from .map_registry import get_map_entry
from ..scripts.chronicle.audit import last_wiped_at
from ..scripts.chronicle.store import (
    CHRONICLE_FILES,
    geometry_version,
    get_snapshot,
    is_valid_day,
    list_day_rows,
    read_view,
    resolve_stored_file,
)
from ..scripts.loader.markers import (
    build_markers_response_from,
    load_province_centroids,
    normalize_raw_markers,
)
from ..scripts.util.dirs import defines_file

logger = logging.getLogger(__name__)

chronicle_router = APIRouter()

_GEOMETRY_FILENAME = "province_id_runs.bin.gz"

# How far back a manual snapshot may be aimed. The sources a capture reads
# (input/{map}/*.json, defines/{map}/*.json) only ever hold *current* state, so
# backfilling an old day stores today's data under a false date; the window
# exists purely so an operator can repair a gap the daily upload-triggered
# capture missed while the server was down. A month is comfortably longer than
# any realistic outage and short enough that the route cannot be used to spray
# thousands of day directories and index rows.
_MAX_BACKFILL_DAYS = 31
# map_name -> (mtime, size, sha256). The digest is a pure function of the
# artifact's bytes, so freshness-by-mtime+size is enough to reuse it and the
# index route stops re-hashing 353 KB on every request. Same idea as
# webp_cache._is_fresh; unbounded is fine because the key set is the map list.
_geometry_version_cache: dict[str, tuple[float, int, str | None]] = {}


def _cached_geometry_version(map_name: str) -> str | None:
    try:
        stat = os.stat(defines_file(map_name, _GEOMETRY_FILENAME))
    except OSError:
        # No artifact yet: let store decide what None means and cache nothing,
        # so the first build after this is picked up immediately.
        _geometry_version_cache.pop(map_name, None)
        return geometry_version(map_name)

    cached = _geometry_version_cache.get(map_name)
    if cached is not None and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
        return cached[2]

    version = geometry_version(map_name)
    _geometry_version_cache[map_name] = (stat.st_mtime, stat.st_size, version)
    return version


# Maps with a triggered capture queued or running in *this* process. The
# threadpool a BackgroundTask runs on is process-local and has 40 slots, so a
# LAN peer looping POST /{map}/chronicle/snapshot could fill it and stall every
# other request on the box; one in-flight capture per map is all this route ever
# needs. `maplock.map_lock` is the cross-process guard and `capture_snapshot`
# still takes it — but it cannot be used here: it is reentrant *per thread* and
# held for the length of a `with`, while the acquire would happen on the request
# thread and the release on a different threadpool thread once the response has
# already gone out.
_in_flight_guard = threading.Lock()
# map_id -> monotonic time the slot was claimed.
_in_flight_maps: dict[str, float] = {}

# A slot older than this is treated as abandoned. The claim happens in the
# handler and the release in the BackgroundTask, and a response that fails to
# send means the task never runs - without an expiry that map would answer 409
# for the life of the process. Comfortably longer than any real capture (a full
# one is a few seconds of gzip over a handful of JSON sources) and short enough
# that a stuck map recovers inside one operator coffee break.
_CAPTURE_SLOT_TTL_SECONDS = 15 * 60


def _begin_capture(map_id: str) -> bool:
    """Claim the single capture slot for `map_id`. False when one is in flight."""
    now = time.monotonic()
    with _in_flight_guard:
        claimed_at = _in_flight_maps.get(map_id)
        if claimed_at is not None and now - claimed_at < _CAPTURE_SLOT_TTL_SECONDS:
            return False
        if claimed_at is not None:
            logger.warning(
                "Reclaiming a chronicle capture slot for map '%s' held for %.0fs; "
                "its background task never released it",
                map_id,
                now - claimed_at,
            )
        _in_flight_maps[map_id] = now
        return True


def _end_capture(map_id: str) -> None:
    with _in_flight_guard:
        _in_flight_maps.pop(map_id, None)


def _run_capture(map_name: str, day: str | None) -> None:
    """Background wrapper: capture_snapshot raises, a BackgroundTask must not.

    The 200 has already gone out by the time this runs, so a failure can only be
    reported in the log. capture_if_due swallows its own errors the same way;
    capture_snapshot deliberately keeps raising for direct callers.

    Releases the map's in-flight slot on every exit, so one failed capture never
    wedges the trigger for the life of the process.
    """
    from ..scripts.chronicle.capture import capture_snapshot

    try:
        capture_snapshot(map_name, day)
    except Exception:
        logger.warning(
            "Chronicle capture failed for map '%s' day '%s'",
            map_name,
            day,
            exc_info=True,
        )
    finally:
        _end_capture(map_name)


def _is_capturable_day(day: str) -> bool:
    """A well-formed day inside the manual-capture window.

    is_valid_day alone accepts 0001-01-01 through 9999-12-31, which turns the
    trigger route into an unbounded directory + index-row generator.
    """
    if not is_valid_day(day):
        return False
    parsed = datetime.strptime(day, "%Y-%m-%d").date()
    today = datetime.now(timezone.utc).date()
    if parsed > today:
        # There is nothing to capture for a day that has not happened; a future
        # day would also sort ahead of every real snapshot in the index.
        return False
    return parsed >= today - timedelta(days=_MAX_BACKFILL_DAYS)


def _incomplete_days(day_manifests: list[tuple[str, dict]]) -> list[dict]:
    """Days whose manifest recorded a missing or unparsable source.

    Takes the rows the caller already fetched rather than looking each day up
    again: the manifest lives in the index row, and a get_snapshot per day was a
    database connection per day of history on every index request.
    """
    out: list[dict] = []
    for day, manifest in day_manifests:
        missing = [str(name) for name in (manifest.get("missing") or [])]
        invalid = [str(name) for name in (manifest.get("invalid") or [])]
        if missing or invalid:
            out.append({"day": day, "missing": missing, "invalid": invalid})
    return out


def _stale_geometry_days(
    day_rows: list[tuple[str, dict, object]], live_version: str | None
) -> list[str]:
    """Days whose stored geometry sha differs from the live geometry sha.

    "Explore a day" repaints a stored day's province-id lists onto the *live*
    province geometry. If the province map has been redrawn since a day was
    captured, those ids land on today's shapes and the viewer quietly lies about
    the past, so the client needs to be able to say so.

    A stored version of None means "unknown", not "stale": rows captured before
    the column was populated would otherwise all light up, and a warning that
    fires on everything is a warning nobody reads. Same for a non-string value
    from a damaged row — it cannot be compared, so it is not reported.

    If the live version is None (the geometry artifact is missing entirely,
    store.geometry_version returns None) there is nothing to compare against, so
    nothing is flagged rather than every day being flagged.

    Reads the rows the caller already fetched — no extra query, no extra stat.
    Ordering follows `day_rows`, which is the same ascending order as `days`
    and `incomplete_days`.
    """
    if not isinstance(live_version, str):
        return []
    return [
        day
        for day, _manifest, stored in day_rows
        if isinstance(stored, str) and stored != live_version
    ]


@chronicle_router.get("/{map_name}/chronicle/index")
def get_chronicle_index(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    """Days available for scrubbing, plus the geometry the client should paint.

    A map that has never been captured is the normal state on day zero, so an
    empty index is a 200 with empty fields rather than a 404 — the viewer needs
    to be able to say "no history yet" without treating it as an error.

    Served through conditional_json_response like the other computed-JSON routes
    in data_routes: this is the one response that must never be heuristically
    cached, since a stale copy silently hides newly captured days. The ETag
    still turns an unchanged index into a bodiless 304.

    Declared `def`, not `async def`: every line below is blocking - database
    reads and a file stat - and an `async def` handler runs on the event loop itself, so one
    slow index request stalls every other connection on the box. Starlette runs
    a sync handler in its threadpool instead.
    """
    entry = ensure_map_access(map_name, authorization)
    # Everything below keys off the *registry* id, never the raw path segment:
    # ensure_map_access normalises (strip + lower) before its lookup, so
    # "/%20MaIn/..." passes the gate as "main". Feeding the raw segment onward
    # either raised out of validate_map as a 500 or, worse, quietly queried a
    # map_id that does not exist and reported an empty history.
    map_id = entry.id

    # One query for both fields: `days` is the row order this returns, so the
    # response ordering is unchanged from the old list_days + per-day lookup.
    # One snapshot for the rows and the wipe stamp, so a wipe committing in
    # between cannot report days that are gone alongside the wipe that took them.
    with read_view() as conn:
        day_rows = list_day_rows(map_id, conn=conn)
        wiped_at = last_wiped_at(map_id, conn=conn)
    days = [day for day, _manifest, _geometry in day_rows]
    incomplete = _incomplete_days([(day, manifest) for day, manifest, _ in day_rows])
    live_geometry_version = _cached_geometry_version(map_id)
    stale_geometry = _stale_geometry_days(day_rows, live_geometry_version)
    return conditional_json_response(
        {
            "days": days,
            "first": days[0] if days else None,
            "last": days[-1] if days else None,
            "geometry_version": live_geometry_version,
            # Additive only. A capture runs as a BackgroundTask after the 200
            # has gone out, so a source that was absent or torn is otherwise
            # visible only in the server log; surfacing it here lets a monitor
            # notice a permanently partial day without shelling into the box.
            "incomplete_days": incomplete,
            "incomplete_day_count": len(incomplete),
            # Additive only: `days` stays a plain string[] because the timelapse
            # consumes it as one. A day listed here was captured against a
            # different province geometry than the one the client will paint it
            # onto, so its borders/labels cannot be trusted for that date.
            "stale_geometry_days": stale_geometry,
            # Additive only. An empty `days` means "never captured" *or* "wiped",
            # and the viewer told users the first thing in both cases. This is
            # the unix stamp of the newest staff wipe of this map (null when it
            # has never been wiped), so the two can be told apart.
            "last_wiped_at": wiped_at,
        },
        if_none_match=if_none_match,
    )


@chronicle_router.get("/{map_name}/chronicle/{day}/data/{name}")
def get_chronicle_data(
    map_name: str,
    day: str,
    name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """One stored snapshot file, gzipped exactly as it sits on disk.

    `name` is checked against the fixed CHRONICLE_FILES tuple before any path is
    built, so a traversal attempt never reaches the filesystem at all. The body
    is served as application/gzip, which server.EXCLUDED_FROM_GZIP keeps the
    GZip middleware from re-compressing; the client gunzips it itself, the same
    way it already handles province_id_grid.bin.gz.

    Sync body, so `def` rather than `async def` - see get_chronicle_index.
    """
    entry = ensure_map_access(map_name, authorization)
    map_id = entry.id  # see get_chronicle_index: never trust the raw segment

    if name not in CHRONICLE_FILES:
        raise HTTPException(status_code=400, detail=f"Unknown chronicle file '{name}'")
    if not is_valid_day(day):
        raise HTTPException(status_code=400, detail="Invalid chronicle day")

    path = resolve_stored_file(map_id, day, name)
    if path is None:
        return add_no_cache(JSONResponse({"error": "Snapshot not found"}, 404))

    try:
        return conditional_file_response(
            path,
            media_type="application/gzip",
            if_none_match=if_none_match,
            if_modified_since=if_modified_since,
        )
    except OSError:
        # resolve_stored_file checked existence; a wipe or a temp-file replace
        # between that check and the stat inside the response would otherwise
        # surface as an uncaught FileNotFoundError -> 500. The file is gone, so
        # the honest answer is the same 404 the missing-snapshot path gives.
        return add_no_cache(JSONResponse({"error": "Snapshot not found"}, 404))


def _load_stored_json(map_id: str, day: str, name: str) -> object | None:
    """Parsed contents of one stored gzip, or None when it is not usable.

    A day can legitimately lack a source — Phase 1 records that in the
    manifest's missing/invalid lists — so absence and corruption both degrade to
    None for the caller to turn into an empty payload, never into a 500.
    """
    path = resolve_stored_file(map_id, day, name)
    if path is None:
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        # Deliberately broad. The contract above is absolute - a stored source
        # can be absent or torn and must still answer 200 - so enumerating
        # decoder exceptions is a guess that keeps being wrong: a damaged
        # deflate stream under an intact header raises zlib.error, which is
        # neither OSError nor ValueError, while truncation raises EOFError and
        # bad magic raises BadGzipFile. Nothing here is worth a 500, and a
        # captured day is immutable, so an escape would be permanent. The
        # WARNING below (with exc_info) keeps the real cause visible.
        logger.warning(
            "Unreadable chronicle file '%s' for map '%s' day '%s'",
            name,
            map_id,
            day,
            exc_info=True,
        )
        return None


def _json_safe(value):
    """Replace non-finite floats with null, recursively.

    json.dumps defaults to allow_nan=True and emits bare NaN/Infinity, which is
    not JSON - the viewer's JSON.parse rejects the whole body, so one poisoned
    number loses the entire day. Sanitising rather than passing allow_nan=False
    is on purpose: raising would only trade an unreadable response for a 500 on
    a day that can never be recaptured. Coordinates are already dropped by
    _finite_int; this covers every other numeric field (population, thresholds)
    that flows through the enrichment untouched.
    """
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


@chronicle_router.get("/{map_name}/chronicle/{day}/markers")
def get_chronicle_markers(
    map_name: str,
    day: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    """One stored day's markers, enriched exactly like /{map}/data/markers.

    The viewer never consumes raw map_markers.json; it consumes the built
    payload from build_markers_response, which joins settlements, installations,
    forts and wars against province centroids and ZoC overlays. Rather than
    reimplement that join client-side for history, the same enrichment runs
    against the day's stored files.

    Province centroids come from the *live* defines: geometry is static and
    shared across days, and no per-day centroid snapshot exists.

    Known limitation: the fort ZoC overlay PNGs the enriched forts point at
    (`zoc_url`) are live artifacts, not per-day snapshots. An old day's fort may
    therefore reference an overlay image that has since changed or been deleted.
    That is accepted — snapshotting images is out of scope.

    Sync body, so `def` rather than `async def` - see get_chronicle_index. This
    is the heaviest of the three: three database reads, two gunzip+parse passes
    and the centroid load, which a timelapse build issues once per day.
    """
    entry = ensure_map_access(map_name, authorization)
    map_id = entry.id  # see get_chronicle_index: never trust the raw segment

    if not is_valid_day(day):
        raise HTTPException(status_code=400, detail="Invalid chronicle day")

    # get_snapshot, not resolve_stored_file: resolve returns None both for "no
    # snapshot for this day" and for "this day has no map_markers", and only the
    # first is a 404 — a captured day with a missing source is a real, empty day.
    if get_snapshot(map_id, day) is None:
        return add_no_cache(JSONResponse({"error": "Snapshot not found"}, 404))

    raw = normalize_raw_markers(_load_stored_json(map_id, day, "map_markers"), map_id)
    stored_overlays = _load_stored_json(map_id, day, "zoc_overlays")
    overlays = stored_overlays if isinstance(stored_overlays, dict) else {}

    payload = build_markers_response_from(
        raw,
        load_province_centroids(map_id),
        overlays,
        map_id,
    )
    # The stored file is the authority for this route's data, but map_id is an
    # identifier the response hands back: a day captured with "map_id": "dev"
    # would otherwise have /main/chronicle/... report itself as dev. The
    # registry id the gate resolved is the only trustworthy source. Left alone
    # in load_raw_markers so the live /{map}/data/markers route is unchanged.
    payload["map_id"] = map_id
    return conditional_json_response(
        body=json.dumps(_json_safe(payload), sort_keys=True, ensure_ascii=False),
        if_none_match=if_none_match,
    )


@chronicle_router.post("/{map_name}/chronicle/snapshot")
async def create_chronicle_snapshot(
    map_name: str,
    request: Request,
    background_tasks: BackgroundTasks,
    day: str | None = None,
):
    """Queue one capture for this map. Deliberately has no `force`.

    `force=true` re-writes a day that is already stored — the chronicle is the
    only copy of that day — and this route's only gate is `require_localhost`,
    which `internal_access` widens to the whole RFC1918 LAN. Rewriting stored
    history is a staff action, so it lives on the staff routes (which take
    `ensure_map_staff_write`) and on the CLI, not here. No caller in the repo
    passed it.
    """
    require_localhost(request)

    # require_localhost is not actually localhost-only (internal_access accepts
    # the RFC1918 ranges, i.e. the whole LAN on a game-server host), so it is
    # not a sufficient gate on its own: without a registry check any alphanumeric
    # string was an acceptable "map" and capture_snapshot would happily makedirs
    # a day directory, write a manifest and insert an index row for it.
    entry = get_map_entry(map_name)
    if entry is None:
        raise HTTPException(status_code=404, detail="Map not found")
    map_id = entry.id

    if day is not None and not _is_capturable_day(day):
        raise HTTPException(status_code=400, detail="Invalid chronicle day")

    if not _begin_capture(map_id):
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "map": map_id,
                "day": day,
                "message": "A chronicle capture is already running for this map.",
            },
        )

    background_tasks.add_task(_run_capture, map_id, day)

    return JSONResponse(
        content={
            "success": True,
            "map": map_id,
            "day": day,
            "message": "Chronicle snapshot started.",
        }
    )
