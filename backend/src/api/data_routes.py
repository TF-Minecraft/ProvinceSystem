from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
import json, logging, os, time
import math

from .http_headers import (
    add_no_cache,
    conditional_file_response,
    conditional_json_response,
    make_etag,
)
from .internal_access import require_localhost
from .map_access import ensure_map_access
from .map_registry import get_map_entry
from .path_safety import is_safe_segment, resolve_within
from .request_body import read_json_body
from .editor_validation import (
    TITLE_TIERS,
    RegionsValidationError,
    TitleValidationError,
    validate_regions_payload,
    validate_title_tier,
)
from ..scripts.chronicle.chapter_identity import write_chapter_identity
from ..scripts.util.dirs import input_file, defines_file, validate_map
# Imported at module scope on purpose, unlike capture_if_due below. A lazy
# `from ... import` inside the handler re-runs the import machinery per request,
# and src/skins/test_drinks.py permanently aliases sys.modules["src.skins.db"];
# a lazy bind after those tests have run would hand the ledger a *different*
# module object with an unpatched DB_PATH, silently reading and writing the
# wrong database while reporting success. These modules import nothing that
# imports this one, so there is no cycle to dodge.
from ..scripts.ledger import ingest as ledger_ingest
from ..scripts.ledger.schema import (
    LEDGER_UPLOAD_MODE,
    MAX_BODY_BYTES as LEDGER_MAX_BODY_BYTES,
    LedgerPayloadError,
    normalize_snapshot,
)
from ..scripts.loader.markers import build_markers_response
from ..scripts.util.maplock import MapLockBusy
from ..scripts.util.overlay_metadata import load_overlay_metadata
from ..scripts.util.regen_types import MODES as REGION_MODES
from ..scripts.mapgen.infestationgen import create_infestation_map, load_infestation_by_id
from ..scripts.loader.province_metadata import load_province_metadata
from ..scripts.mapgen.zocgen import generate_zoc_overlays

logger = logging.getLogger(__name__)

data_router = APIRouter()

CACHE_TTL = 300
_province_cache = {}

# Ceiling for a non-ledger upload body. Every existing mode is a hand-sized JSON
# document (the largest on disk is province_data.json at ~70 KB), so this bounds
# the memory one localhost POST can claim without coming near a real payload —
# the read is behaviour-identical below the limit. 8 MiB is ~100x the largest
# real payload and matches the ledger's own schema.MAX_BODY_BYTES; the previous
# 64 MiB let one LAN POST claim two orders of magnitude more than any mode can
# legitimately send.
UPLOAD_MAX_BODY_BYTES = 8 * 1024 * 1024

# What a 503 from a locked ledger tells the caller to wait. Matches
# `maplock.DEFAULT_TIMEOUT`, which is how long `store_raw` already waited before
# giving up, so the retry lands after roughly one more lock window.
LEDGER_LOCK_RETRY_AFTER_SECONDS = 30

def _map_dir(path_builder, map_name: str) -> str:
    """The per-map directory `path_builder` (input_file / defines_file) writes to."""
    return os.path.dirname(path_builder(map_name, "_"))

def clear_province_cache(map_name: str) -> None:
    _province_cache.pop(map_name, None)

def add_cors(response: Response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    return response;

def compute_trade_shares(trade: dict):
    total = sum(v.get("trade", 0) for v in trade.values())
    if total <= 0:
        return {}, None, 0.0

    shares, dominant, best = {}, None, 0.0
    for g, d in trade.items():
        v = d.get("trade", 0)
        r = v / total
        shares[g] = r
        if v > best:
            best, dominant = v, g
    return shares, dominant, best / total


def _finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False

# These come from the plugin's province_data row. provinces.txt is free-form
# key=value, so a stray infrastructure=unknown must not survive into the hover.
_MEASUREMENT_FIELDS = ("terrain_value", "infrastructure", "infrastructure_fill", "effective_terrain")

def build_compiled_provinces(map_name: str):
    meta = load_province_metadata(map_name)

    with open(input_file(map_name, "province_data.json"), encoding="utf-8") as f:
        pdata = json.load(f)

    by_id = {p["id"]: p for p in pdata}
    infest = load_infestation_by_id(map_name)
    out = {}

    for pid, m in meta.items():
        p = by_id.get(pid, {})
        if not p:
            try:
                p = by_id.get(int(pid), {})
            except (TypeError, ValueError):
                p = {}
        trade = p.get("trade") or {}
        shares, dom, ratio = compute_trade_shares(trade)
        inf = infest.get(pid)
        if inf is None:
            try:
                inf = infest.get(int(pid))
            except (TypeError, ValueError):
                inf = None

        province = {
            **{key: value for key, value in m.items() if key not in _MEASUREMENT_FIELDS},
            "province_id": pid,
            "prosperity": p.get("prosperity", 0),
            "trade": trade,
            "trade_total": sum(v.get("trade", 0) for v in trade.values()),
            "trade_shares": shares,
            "dominant_guild": dom,
            "dominance_ratio": ratio,
            "infestation_severity": inf.get("severity") if inf else None,
            "infestation_group": inf.get("group") if inf else None,
            "infestation_display": (inf.get("display") or inf.get("group")) if inf else None,
        }
        for field in _MEASUREMENT_FIELDS:
            value = p.get(field)
            if _finite_number(value):
                province[field] = value
        out[pid] = province

    return out

@data_router.get("/{map_name}/compiled_data/provinces")
async def get_compiled_provinces(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    # ensure_map_access normalises (strip + lower) before its registry lookup,
    # so "/%20MaIn/..." is granted as "main". Every downstream filesystem, cache
    # and database key below must use that normalised id, or an attacker-chosen
    # path segment reaches validate_map/open() and 500s instead of 404ing.
    map_name = ensure_map_access(map_name, authorization).id
    now = time.time()
    cached = _province_cache.get(map_name)

    if not cached or now - cached["ts"] >= CACHE_TTL:
        data = build_compiled_provinces(map_name)
        # Serialize once per rebuild and keep the bytes: the ETag is a hash of
        # the body, so a TTL rollover that produces identical data keeps the
        # same tag and the client revalidates into a 304 instead of
        # re-downloading ~185KB it already has.
        cached = {
            "ts": now,
            "data": data,
            "body": json.dumps(data, sort_keys=True, ensure_ascii=False),
        }
        _province_cache[map_name] = cached

    return conditional_json_response(
        body=cached["body"],
        if_none_match=if_none_match,
    )

@data_router.get("/{map_name}/data/province_label_grid_bin")
async def get_province_label_grid_bin(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    path = defines_file(map_name, "province_label_grid.bin.gz")
    if not os.path.exists(path):
        return add_no_cache(JSONResponse({"error": "Data not found"}, 404))
    try:
        return conditional_file_response(
            path,
            media_type="application/gzip",
            if_none_match=if_none_match,
            if_modified_since=if_modified_since,
        )
    except OSError:
        return add_no_cache(JSONResponse({"error": "Data not found"}, 404))

@data_router.get("/{map_name}/data/markers")
async def get_map_markers(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    # Markers are assembled from several files (map_markers.json, centroids, zoc
    # overlays), so there is no single file to stat and no cache entry to key
    # on. Hash the built payload instead: still cheap next to the JSON encode,
    # and the tag changes the instant any input does, so a marker upload is
    # picked up as immediately as it was under no-store.
    payload = build_markers_response(map_name)
    return conditional_json_response(
        body=json.dumps(payload, sort_keys=True, ensure_ascii=False),
        if_none_match=if_none_match,
    )

# Same body for both 404 paths below, and deliberately free of the caller's
# input: this route is public.
_ARTIFACT_NOT_FOUND = "Artifact not found"


def _gzip_artifact_response(
    map_name: str,
    filename: str,
    *,
    if_none_match: str | None,
    if_modified_since: str | None,
):
    """Serve a defines artifact as its on-disk gzip bytes, or a plain 404.

    Body only — every caller still applies its own auth gate first, and the
    gates deliberately differ between the public and the editor routes.
    """
    path = defines_file(map_name, filename)
    if not os.path.isfile(path):
        # Public route: the body echoes neither the requested map nor the
        # build command that would create the artifact. Handing an
        # unauthenticated caller back its own input, plus a module path to run,
        # is free reconnaissance; the operator fix belongs in docs, not here.
        raise HTTPException(status_code=404, detail=_ARTIFACT_NOT_FOUND)
    try:
        return conditional_file_response(
            path,
            media_type="application/gzip",
            if_none_match=if_none_match,
            if_modified_since=if_modified_since,
        )
    except OSError as exc:
        # isfile() above and the stat inside the response are two separate
        # syscalls; a regen replacing the artifact in between must 404 like any
        # other absent artifact rather than raising into a 500.
        raise HTTPException(status_code=404, detail=_ARTIFACT_NOT_FOUND) from exc

@data_router.get("/{map_name}/data/province_id_runs")
async def get_province_id_runs(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """Public sibling of /{map}/editor/province-runs.

    Same bytes, lower gate: this is static geometry with no ownership in it, and
    the chronicle viewer needs it on public maps. The editor route keeps its
    staff gate because it is reached from the write-side tooling — the two are
    intentionally separate, not a duplication to fold together.
    """
    map_name = ensure_map_access(map_name, authorization).id
    return _gzip_artifact_response(
        map_name,
        "province_id_runs.bin.gz",
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )

@data_router.get("/{map_name}/data/province_id_grid_q4")
async def get_province_id_grid_q4(
    map_name: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    """Quarter-scale province id grid for timelapse playback.

    Optional artifact: a map whose grid has not been rebuilt with --scale simply
    404s, and the client falls back to the full-resolution runs.
    """
    map_name = ensure_map_access(map_name, authorization).id
    return _gzip_artifact_response(
        map_name,
        "province_id_grid_q4.bin.gz",
        if_none_match=if_none_match,
        if_modified_since=if_modified_since,
    )


def _join_overlay_metadata(map_name: str, mode: str, path: str) -> str | None:
    """One mode's region data with each entry's generated crop box attached.

    The map needs `overlay` to position a cropped region PNG, but that box is an
    output artifact describing an image under output/, not something an author
    (or the title editor) writes. Regen records it beside the PNGs and it is
    joined back on by `rgb` here, so defines/ holds title data only and a
    fullregen is the whole story for making overlays appear.

    None means "nothing to join": no sidecar (this mode's regions have never
    been generated) or a defines file this cannot parse. The caller then streams
    the file verbatim, exactly as it did before the join existed.
    """
    overlays = load_overlay_metadata(map_name, mode)
    if not overlays:
        return None

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None

    if not isinstance(data, dict):
        return None

    for region in data.values():
        if not isinstance(region, dict):
            continue
        rgb = region.get("rgb")
        if not isinstance(rgb, str):
            continue
        entry = overlays.get(rgb)
        if entry:
            region.update(entry)

    return json.dumps(data, ensure_ascii=False)


@data_router.get("/{map_name}/data/{file}")
async def get_map_name_data(
    map_name: str,
    file: str,
    authorization: str | None = Header(default=None),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    map_name = ensure_map_access(map_name, authorization).id
    if not is_safe_segment(file):
        return add_no_cache(JSONResponse({"error": "Data not found"}, 404))
    path = resolve_within(
        _map_dir(defines_file, map_name), defines_file(map_name, f"{file}.json")
    )
    if path is None or not os.path.exists(path):
        return add_no_cache(JSONResponse({"error": "Data not found"}, 404))

    # Only the region modes carry overlays, and only they pay the parse. The
    # streaming path below stays for everything else, which is where it earns
    # its keep: province_centroids/province_neighbors are 60-80 KB of static
    # geometry that must keep 304ing on an mtime.
    if file in REGION_MODES:
        joined = _join_overlay_metadata(map_name, file, path)
        if joined is not None:
            return conditional_json_response(
                body=joined,
                if_none_match=if_none_match,
            )

    # The response body was always the file verbatim; parsing and re-encoding it
    # only cost CPU. Streaming the file lets the shared ETag/Last-Modified
    # helper turn an unchanged geometry blob into a 304.
    try:
        return conditional_file_response(
            path,
            media_type="application/json",
            if_none_match=if_none_match,
            if_modified_since=if_modified_since,
        )
    except OSError:
        # exists() and the stat inside the response are separate syscalls: a
        # rewrite in between is a 404, not a 500.
        return add_no_cache(JSONResponse({"error": "Data not found"}, 404))

# The bounded reader lives in `request_body` so the staff routes can share it;
# the module-local name is kept because tests and call sites reference it.
_read_json_body = read_json_body


def _run_promote_ledger_day(map_id: str, day: str) -> None:
    """Background wrapper: promote_day raises, a BackgroundTask must not.

    Same shape as `chronicle_routes._run_capture` — the 200 has already gone out
    by the time this runs, so a failure can only be reported in the log. The raw
    snapshot is already on disk at this point and `promote_day` is idempotent, so
    a lost promotion is repaired by the next upload (or `reindex`), never by
    re-POSTing.
    """
    try:
        ledger_ingest.promote_day(map_id, day)
    except Exception:
        logger.warning(
            "Ledger promote failed for map '%s' day '%s'", map_id, day, exc_info=True
        )


@data_router.post("/{map_name}/data/upload/{mode}")
async def upload_region_data(
    map_name: str,
    mode: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    require_localhost(request)
    validate_map(map_name)
    if not is_safe_segment(mode):
        raise HTTPException(status_code=400, detail="Invalid upload mode")

    mode_norm = (mode or "").strip().lower()
    is_ledger = mode_norm == LEDGER_UPLOAD_MODE
    payload = await _read_json_body(
        request, LEDGER_MAX_BODY_BYTES if is_ledger else UPLOAD_MAX_BODY_BYTES
    )

    if is_ledger:
        # SF POSTs one economy snapshot here every 300s per map. Without this
        # branch the mode falls through to the defines/ writer below and the
        # whole season collapses into a single overwritten file. The mode string
        # stays `chronicle` because the plugin owns the URL; everything on this
        # side is `ledger` (see scripts/ledger/__init__.py).
        entry = get_map_entry(map_name)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Unknown map '{map_name}'")
        map_id = entry.id

        if isinstance(payload, dict):
            claimed = str(payload.get("map_id") or "").strip().lower()
            if claimed and claimed != map_id:
                if get_map_entry(claimed) is not None:
                    # The payload names a *different* registered map: this is a
                    # misrouted upload, and storing it would corrupt two series.
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Snapshot map_id '{claimed}' does not match URL map "
                            f"'{map_id}'"
                        ),
                    )
                # Anything else is a naming difference between the plugin and
                # our registry. Rejecting would silently drop every snapshot for
                # this map forever; the URL's registry id is authoritative.
                logger.warning(
                    "Ledger snapshot for map '%s' claims map_id '%s'; storing "
                    "under the URL's registry id",
                    map_id,
                    claimed,
                )

        try:
            snapshot = normalize_snapshot(payload, map_id)
        except LedgerPayloadError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.detail) from exc

        # Raw write is synchronous: it is the only durable copy of this
        # 5-minute sample, and a BackgroundTask failure after a 200 would lose
        # it silently. Promotion is derived from raw and can be retried.
        try:
            # Off the event loop: `store_raw` is blocking (gzip + fsync) and now
            # waits on the per-map ledger lock for up to 30s, which a promote or
            # a reindex can hold for a long raw scan. Awaited, not queued as a
            # BackgroundTask - this is the only durable copy of the sample, so
            # the caller has to learn whether it landed.
            await run_in_threadpool(ledger_ingest.store_raw, map_id, snapshot)
        except MapLockBusy as exc:
            # `store_raw` takes the per-map ledger lock and gives up after 30s.
            # A staff wipe or restore holding it longer is a *temporary* state,
            # not a bad request: answer 503 + Retry-After so the plugin retries
            # this 5-minute sample instead of seeing a 500 and dropping it.
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Map '{map_id}' ledger is locked by a maintenance "
                    "operation; retry shortly."
                ),
                headers={"Retry-After": str(LEDGER_LOCK_RETRY_AFTER_SECONDS)},
            ) from exc
        # Last-seen chapter label for this live socket. After store_raw so a
        # 400/409/503 never stamps identity. URL registry id, not payload
        # map_id or chapter_id — those never route.
        write_chapter_identity(map_id, payload)
        background_tasks.add_task(_run_promote_ledger_day, map_id, snapshot["day"])

        # ORDER MATTERS - keep capture_if_due last, for the same reason as the
        # legacy path below. See the comment there.
        from ..scripts.chronicle.capture import capture_if_due

        # `map_id`, not the raw `map_name` segment. `validate_map` only checks
        # `isalnum()`, so "/MAIN/data/upload/chronicle" reaches here with the
        # ledger rows keyed on "main" and the segment still "MAIN"; handing the
        # segment to the chronicle forked an orphan day series under "MAIN"
        # whose sources never exist, retried on every upload forever. The
        # registry id is the same key the ledger write above uses, and the same
        # one every chronicle read route resolves through `ensure_map_access`.
        background_tasks.add_task(capture_if_due, map_id)

        # Return before the defines/ write: nothing about this mode belongs in
        # defines/{map}/chronicle.json, and `_province_cache` holds compiled
        # province geometry that an economy snapshot cannot invalidate.
        return JSONResponse(
            {
                "message": f"ledger snapshot stored for '{map_id}'",
                "map": map_id,
                "day": snapshot["day"],
                "captured_at": snapshot["captured_at"],
                "server_day": snapshot["server_day"],
                "complete": snapshot["complete"],
                "factions": len(snapshot["factions"]),
                "guilds": len(snapshot["guilds"]),
            }
        )

    if mode_norm in TITLE_TIERS:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Title data must be a JSON object")
        if not payload:
            return JSONResponse({"message": f"{mode} upload skipped (empty) for '{map_name}'"})
        try:
            payload = validate_title_tier(mode_norm, payload, map_name)
        except TitleValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif mode_norm == "regions":
        # Gameplay zones (permadeath etc.), not a de jure title and not a map
        # overlay. Empty {} still writes so a wipe can clear the file.
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=400, detail="Regions data must be a JSON object"
            )
        try:
            payload = validate_regions_payload(payload)
        except RegionsValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    builder = (
        input_file
        if mode in {"nation", "guilds", "province_data", "queue", "map_markers", "infestation_data"}
        else defines_file
    )
    path = resolve_within(_map_dir(builder, map_name), builder(map_name, f"{mode}.json"))
    if path is None:
        raise HTTPException(status_code=400, detail="Invalid upload mode")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    if mode_norm == "map_markers":
        # Same stamp as the ledger branch. Nation, titles, and other modes
        # must not create or overwrite this file.
        stamp_map = map_name
        entry = get_map_entry(map_name)
        if entry is not None:
            stamp_map = entry.id
        write_chapter_identity(stamp_map, payload)

    _province_cache.pop(map_name, None)

    # No scheduler exists in this app, so the daily chronicle rides the SF
    # upload: capture_if_due returns immediately unless today has no snapshot
    # yet. Imported here rather than at module scope because chronicle.capture
    # reads through the loader/mapgen stack that already imports this module.
    from ..scripts.chronicle.capture import capture_if_due

    if mode_norm == "map_markers":
        background_tasks.add_task(generate_zoc_overlays, map_name)
    if mode_norm == "infestation_data":
        background_tasks.add_task(create_infestation_map, map_name)

    # ORDER MATTERS - keep capture_if_due last. BackgroundTasks run in the order
    # they were added, and the chronicle snapshots defines/{map}/zoc_overlays.json
    # off disk. Queued first, a map_markers upload would capture the *previous*
    # overlays alongside the new markers, so every stored day held a zoc overlay
    # that disagreed with the markers in the same snapshot - permanently, since
    # the chronicle is the only copy of that day.
    background_tasks.add_task(capture_if_due, map_name)

    return JSONResponse({"message": f"{mode} data saved for '{map_name}'"})
