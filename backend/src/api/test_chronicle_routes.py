"""API tests for the chronicle read routes and the localhost capture trigger."""

from __future__ import annotations

import gzip
import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi.testclient import TestClient  # noqa: E402

from src.api.map_registry import clear_map_registry_cache  # noqa: E402
from src.scripts.chronicle import store  # noqa: E402
from src import database  # noqa: E402
from src.skins import db as skins_db  # noqa: E402
from server import app  # noqa: E402

TEST_REGISTRY = """
maps:
  - id: main
    public: true
    display_name: Adavaar
    realm_id: main
  - id: dev
    public: false
    display_name: Adavaar
    realm_id: dev
    staff_permission: tfmc.map.staff
"""


@pytest.fixture
def chronicle_env(tmp_path, monkeypatch, postgres):
    """Point the chronicle at a throwaway output dir and the test Postgres.

    Everything the routes touch — day folders and the index table — has to live
    under tmp_path or in the emptied test database; the real src/output must
    never be written by a test run.
    """
    registry = tmp_path / "maps.yml"
    registry.write_text(TEST_REGISTRY, encoding="utf-8")
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(skins_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(skins_db, "SKINS_DIR", data_dir / "skins")
    monkeypatch.setattr(skins_db, "WARDROBE_DIR", data_dir / "wardrobe")
    monkeypatch.setattr(skins_db, "DRINKS_DIR", data_dir / "drinks")

    output_dir = tmp_path / "output"
    monkeypatch.setattr(store, "OUTPUT_DIR", str(output_dir))

    try:
        yield tmp_path
    finally:
        clear_map_registry_cache()


@pytest.fixture
def client(chronicle_env):
    with TestClient(app) as test_client:
        yield test_client


def _write_day(
    map_name: str,
    day: str,
    name: str,
    payload: object,
    geometry_version: str | None = None,
) -> None:
    path = store.stored_file_path(map_name, day, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle)
    store.upsert_snapshot(
        map_name,
        day,
        "main",
        int(time.time()),
        os.path.getsize(path),
        geometry_version,
        {"files": {name: {"sha256": "x", "bytes": os.path.getsize(path)}}},
    )


def test_index_without_snapshots_is_empty_not_error(client):
    res = client.get("/main/chronicle/index")
    assert res.status_code == 200
    body = res.json()
    assert body["days"] == []
    assert body["first"] is None
    assert body["last"] is None


def test_index_lists_days_ascending(client):
    _write_day("main", "2026-01-01", "nation", {"a": 1})
    _write_day("main", "2026-01-02", "nation", {"a": 2})

    body = client.get("/main/chronicle/index").json()
    assert body["days"] == ["2026-01-01", "2026-01-02"]
    assert body["first"] == "2026-01-01"
    assert body["last"] == "2026-01-02"


def test_data_route_serves_gzip_bytes(client):
    _write_day("main", "2026-01-01", "nation", {"a": 1})

    res = client.get("/main/chronicle/2026-01-01/data/nation")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/gzip"
    # httpx does not transparently decode application/gzip, exactly as the
    # browser does not — the client is expected to gunzip it itself.
    assert json.loads(gzip.decompress(res.content)) == {"a": 1}


def test_missing_snapshot_is_404(client):
    res = client.get("/main/chronicle/2026-01-01/data/nation")
    assert res.status_code == 404


@pytest.mark.parametrize(
    "name",
    ["../../secret", "manifest", "nation.json", "..", "queue"],
)
def test_bad_file_name_is_rejected_without_touching_disk(client, monkeypatch, name):
    def _boom(*args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("filesystem reached with an unvalidated name")

    monkeypatch.setattr(store, "resolve_stored_file", _boom)
    monkeypatch.setattr("src.api.chronicle_routes.resolve_stored_file", _boom)

    res = client.get(f"/main/chronicle/2026-01-01/data/{name}")
    assert res.status_code in (400, 404)
    if res.status_code == 400:
        assert "Unknown chronicle file" in res.json()["detail"]


@pytest.mark.parametrize("day", ["nope", "2026-13-01", "2026-1-1", "../../etc"])
def test_bad_day_is_rejected(client, day):
    res = client.get(f"/main/chronicle/{day}/data/nation")
    assert res.status_code in (400, 404)


def test_dev_map_requires_staff_but_main_is_public(client):
    assert client.get("/dev/chronicle/index").status_code == 403
    assert client.get("/main/chronicle/index").status_code == 200


def test_snapshot_post_rejects_non_localhost(client):
    res = client.post(
        "/main/chronicle/snapshot",
        headers={"X-Forwarded-For": "8.8.8.8"},
    )
    assert res.status_code == 403


def test_snapshot_post_from_localhost_schedules_capture(chronicle_env, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        "src.scripts.chronicle.capture.capture_snapshot",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )
    # `force` is not part of this route's surface any more: a LAN peer must not
    # be able to re-write an already-stored day. An unknown query parameter is
    # ignored by FastAPI, so the request still succeeds - without forcing.
    with TestClient(app, client=("127.0.0.1", 12345)) as test_client:
        res = test_client.post("/main/chronicle/snapshot?force=true")

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["map"] == "main"
    assert "force" not in body
    assert calls == [(("main", None), {})]


@pytest.fixture
def defines_dir(chronicle_env, monkeypatch):
    """Empty stand-in for src/defines so artifact presence is under test control."""
    root = chronicle_env / "defines"

    def _defines_file(map_name: str, filename: str) -> str:
        return str(root / map_name / filename)

    monkeypatch.setattr("src.api.data_routes.defines_file", _defines_file)
    return root


@pytest.mark.parametrize(
    "route, filename",
    [
        ("province_id_runs", "province_id_runs.bin.gz"),
        ("province_id_grid_q4", "province_id_grid_q4.bin.gz"),
    ],
)
def test_public_artifact_routes_404_without_artifact(client, defines_dir, route, filename):
    res = client.get(f"/main/data/{route}")
    assert res.status_code == 404
    # These routes are public: the body must not echo the caller's map segment
    # back, nor name the command that would build the artifact.
    assert res.json()["detail"] == "Artifact not found"


@pytest.mark.parametrize(
    "route, filename",
    [
        ("province_id_runs", "province_id_runs.bin.gz"),
        ("province_id_grid_q4", "province_id_grid_q4.bin.gz"),
    ],
)
def test_public_artifact_routes_serve_bytes_verbatim(client, defines_dir, route, filename):
    target = defines_dir / "main" / filename
    target.parent.mkdir(parents=True)
    target.write_bytes(gzip.compress(b"geometry"))

    res = client.get(f"/main/data/{route}")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/gzip"
    assert gzip.decompress(res.content) == b"geometry"


@pytest.mark.parametrize("route", ["province_id_runs", "province_id_grid_q4"])
def test_public_artifact_routes_are_map_gated(client, defines_dir, route):
    assert client.get(f"/dev/data/{route}").status_code == 403


def test_index_is_revalidated_not_heuristically_cached(client):
    res = client.get("/main/chronicle/index")
    # A stale index silently hides newly captured days, so the browser must
    # re-check every time even though it may keep the body.
    assert "no-cache" in res.headers["cache-control"]
    assert res.headers["etag"]

    again = client.get(
        "/main/chronicle/index", headers={"If-None-Match": res.headers["etag"]}
    )
    assert again.status_code == 304


def test_geometry_version_is_memoized_per_artifact(client, chronicle_env, monkeypatch):
    from src.api import chronicle_routes

    artifact = chronicle_env / "defines" / "main" / "province_id_runs.bin.gz"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"geometry")
    monkeypatch.setattr(
        chronicle_routes,
        "defines_file",
        lambda map_name, filename: str(chronicle_env / "defines" / map_name / filename),
    )

    hashed: list[str] = []
    monkeypatch.setattr(
        chronicle_routes,
        "geometry_version",
        lambda map_name: hashed.append(map_name) or "deadbeef",
    )
    chronicle_routes._geometry_version_cache.clear()

    first = client.get("/main/chronicle/index").json()["geometry_version"]
    second = client.get("/main/chronicle/index").json()["geometry_version"]

    assert first == second == "deadbeef"
    assert hashed == ["main"], "artifact unchanged, so it must be hashed once"

    # Rebuilding the artifact has to invalidate the memo.
    os.utime(artifact, (0, 0))
    client.get("/main/chronicle/index")
    assert len(hashed) == 2

    chronicle_routes._geometry_version_cache.clear()


def test_background_capture_swallows_and_logs_failures(chronicle_env, monkeypatch, caplog):
    from src.api import chronicle_routes

    def _explode(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("src.scripts.chronicle.capture.capture_snapshot", _explode)

    with caplog.at_level("WARNING"):
        # Must not raise: this runs in a BackgroundTask after the 200 was sent.
        chronicle_routes._run_capture("main", "2026-01-01")

    assert "Chronicle capture failed" in caplog.text
    assert "2026-01-01" in caplog.text


# ---------------------------------------------------------------------------
# Regression: the access gate normalises the map id, downstream work must too
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("segment", ["%20main", "MaIn", "MAIN%20"])
def test_index_normalises_map_id_like_the_access_gate(client, segment):
    """ensure_map_access grants " main"/"MaIn" as "main", so the routes must
    query "main" as well.

    Before the fix the whitespace form raised ValueError("Invalid map name") out
    of validate_map into an uncaught 500 (anonymous, unauthenticated), and the
    case form returned a cheerful 200 with days: [] because it queried a map_id
    that does not exist.
    """
    _write_day("main", "2026-01-01", "nation", {"a": 1})

    res = client.get(f"/{segment}/chronicle/index")
    assert res.status_code == 200
    assert res.json()["days"] == ["2026-01-01"]


@pytest.mark.parametrize("segment", ["%20main", "MaIn"])
def test_data_route_normalises_map_id_like_the_access_gate(client, segment):
    _write_day("main", "2026-01-01", "nation", {"a": 1})

    res = client.get(f"/{segment}/chronicle/2026-01-01/data/nation")
    assert res.status_code == 200
    assert json.loads(gzip.decompress(res.content)) == {"a": 1}


def test_public_data_routes_normalise_map_id(client, defines_dir):
    target = defines_dir / "main" / "province_id_runs.bin.gz"
    target.parent.mkdir(parents=True)
    target.write_bytes(gzip.compress(b"geometry"))

    for segment in ("%20main", "MaIn"):
        res = client.get(f"/{segment}/data/province_id_runs")
        assert res.status_code == 200, segment
        assert gzip.decompress(res.content) == b"geometry"


# ---------------------------------------------------------------------------
# Regression: the snapshot trigger is registry-gated and time-bounded
# ---------------------------------------------------------------------------


def _localhost_client():
    return TestClient(app, client=("127.0.0.1", 12345))


def test_snapshot_post_rejects_unregistered_map(chronicle_env, monkeypatch):
    """require_localhost accepts the whole LAN, so it cannot be the only gate:
    an unregistered map would otherwise get a day directory and an index row."""
    calls: list[tuple] = []
    monkeypatch.setattr(
        "src.scripts.chronicle.capture.capture_snapshot",
        lambda *args, **kwargs: calls.append(args),
    )
    with _localhost_client() as test_client:
        res = test_client.post("/notamap/chronicle/snapshot")

    assert res.status_code == 404
    assert calls == []


def test_snapshot_post_normalises_the_map_id(chronicle_env, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        "src.scripts.chronicle.capture.capture_snapshot",
        lambda *args, **kwargs: calls.append(args),
    )
    with _localhost_client() as test_client:
        res = test_client.post("/MaIn/chronicle/snapshot")

    assert res.status_code == 200
    assert res.json()["map"] == "main"
    assert calls == [("main", None)]


@pytest.mark.parametrize("day", ["9999-12-31", "0001-01-01", "2000-06-01"])
def test_snapshot_post_rejects_days_outside_the_backfill_window(
    chronicle_env, monkeypatch, day
):
    calls: list[tuple] = []
    monkeypatch.setattr(
        "src.scripts.chronicle.capture.capture_snapshot",
        lambda *args, **kwargs: calls.append(args),
    )
    with _localhost_client() as test_client:
        res = test_client.post(f"/main/chronicle/snapshot?day={day}")

    assert res.status_code == 400
    assert calls == []


def test_snapshot_post_accepts_a_recent_day(chronicle_env, monkeypatch):
    from datetime import datetime, timedelta, timezone

    day = (datetime.now(timezone.utc).date() - timedelta(days=2)).strftime("%Y-%m-%d")
    calls: list[tuple] = []
    monkeypatch.setattr(
        "src.scripts.chronicle.capture.capture_snapshot",
        lambda *args, **kwargs: calls.append(args),
    )
    with _localhost_client() as test_client:
        res = test_client.post(f"/main/chronicle/snapshot?day={day}")

    assert res.status_code == 200
    assert calls == [("main", day)]


# ---------------------------------------------------------------------------
# Regression: a vanished file is a 404, not a 500
# ---------------------------------------------------------------------------


def test_file_removed_between_resolve_and_stat_is_404(client, monkeypatch):
    _write_day("main", "2026-01-01", "nation", {"a": 1})
    path = store.stored_file_path("main", "2026-01-01", "nation")

    def _resolve_then_delete(*args, **kwargs):
        # Stand-in for a wipe or a temp-file replace landing between
        # resolve_stored_file's exists() and conditional_file_response's stat().
        os.remove(path)
        return path

    monkeypatch.setattr(
        "src.api.chronicle_routes.resolve_stored_file", _resolve_then_delete
    )

    res = client.get("/main/chronicle/2026-01-01/data/nation")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Regression: partial captures are visible in the index
# ---------------------------------------------------------------------------


def test_index_reports_days_with_missing_or_invalid_sources(client):
    _write_day("main", "2026-01-01", "nation", {"a": 1})
    store.upsert_snapshot(
        "main",
        "2026-01-02",
        "main",
        int(time.time()),
        0,
        None,
        {"files": {}, "missing": ["trade"], "invalid": ["nation"]},
    )

    body = client.get("/main/chronicle/index").json()
    # Additive fields only - the original shape is untouched.
    assert body["days"] == ["2026-01-01", "2026-01-02"]
    assert body["incomplete_day_count"] == 1
    assert body["incomplete_days"] == [
        {"day": "2026-01-02", "missing": ["trade"], "invalid": ["nation"]}
    ]


def test_index_reports_no_incomplete_days_for_a_clean_capture(client):
    _write_day("main", "2026-01-01", "nation", {"a": 1})

    body = client.get("/main/chronicle/index").json()
    assert body["incomplete_days"] == []
    assert body["incomplete_day_count"] == 0


# ---------------------------------------------------------------------------
# Regression: the chronicle must not capture a stale zoc_overlays.json
# ---------------------------------------------------------------------------


def test_marker_upload_regenerates_zoc_overlays_before_capturing(monkeypatch, tmp_path, postgres):
    """capture_if_due reads zoc_overlays.json off disk, so it has to run after
    generate_zoc_overlays or every stored day holds overlays that disagree with
    the markers captured beside them."""
    from src.api import data_routes

    order: list[str] = []
    monkeypatch.setattr(
        data_routes, "generate_zoc_overlays", lambda m: order.append("zoc")
    )
    monkeypatch.setattr(
        "src.scripts.chronicle.capture.capture_if_due",
        lambda m: order.append("capture"),
    )
    monkeypatch.setattr(
        data_routes, "input_file", lambda m, f: str(tmp_path / m / f)
    )
    monkeypatch.setattr(
        data_routes, "defines_file", lambda m, f: str(tmp_path / m / f)
    )

    with TestClient(app, client=("127.0.0.1", 12345)) as test_client:
        res = test_client.post("/main/data/upload/map_markers", json={"markers": []})

    assert res.status_code == 200
    assert order == ["zoc", "capture"]


# ---------------------------------------------------------------------------
# Per-day markers: the same enrichment as /{map}/data/markers, over stored files
# ---------------------------------------------------------------------------


def _write_day_files(map_name: str, day: str, files: dict) -> None:
    """Like _write_day but records several sources under one snapshot row."""
    manifest_files: dict = {}
    total = 0
    for name, payload in files.items():
        path = store.stored_file_path(map_name, day, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            json.dump(payload, handle)
        size = os.path.getsize(path)
        total += size
        manifest_files[name] = {"sha256": "x", "bytes": size}
    store.upsert_snapshot(
        map_name, day, "main", int(time.time()), total, None, {"files": manifest_files}
    )


_MARKERS_DAY = {
    "map_id": "main",
    "exported_at": "2026-01-01T00:00:00Z",
    "settlement_large_population_threshold": 500,
    "settlements": [
        {"id": "s1", "name": "Rimehold", "province_id": "7", "population": 900}
    ],
    "installations": [{"id": "i1", "name": "Mill", "province_id": "7"}],
    "forts": [{"id": "f1", "name": "Gate", "province_id": "7"}],
    "wars": [],
}


def test_markers_route_returns_the_enriched_shape(client):
    _write_day_files(
        "main",
        "2026-01-01",
        {"map_markers": _MARKERS_DAY, "zoc_overlays": {}},
    )

    res = client.get("/main/chronicle/2026-01-01/markers")
    assert res.status_code == 200
    body = res.json()
    assert set(["settlements", "installations", "forts", "wars"]) <= set(body)
    assert body["map_id"] == "main"
    assert body["exported_at"] == "2026-01-01T00:00:00Z"
    assert body["settlement_large_population_threshold"] == 500
    assert [s["name"] for s in body["settlements"]] == ["Rimehold"]
    assert [i["name"] for i in body["installations"]] == ["Mill"]
    assert [f["name"] for f in body["forts"]] == ["Gate"]
    assert body["wars"] == []


def test_markers_route_unknown_day_is_404(client):
    _write_day_files("main", "2026-01-01", {"map_markers": _MARKERS_DAY})

    res = client.get("/main/chronicle/2026-01-02/markers")
    assert res.status_code == 404
    assert res.json() == {"error": "Snapshot not found"}
    assert "no-store" in res.headers["cache-control"] or "no-cache" in res.headers["cache-control"]


@pytest.mark.parametrize("day", ["2026-13-99", "../..", "nope", "2026-1-1"])
def test_markers_route_bad_day_is_400_without_touching_disk(client, monkeypatch, day):
    def _boom(*args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("filesystem reached with an unvalidated day")

    monkeypatch.setattr("src.api.chronicle_routes.resolve_stored_file", _boom)
    monkeypatch.setattr("src.api.chronicle_routes.get_snapshot", _boom)

    res = client.get(f"/main/chronicle/{day}/markers")
    # "../.." cannot match the {day} segment at all, so it is a routing 404.
    assert res.status_code in (400, 404)
    if res.status_code == 400:
        assert res.json()["detail"] == "Invalid chronicle day"


def test_markers_route_missing_source_is_an_empty_payload_not_500(client):
    # A captured day whose map_markers source was absent: Phase 1 records that
    # in the manifest, and the route must still answer 200.
    store.upsert_snapshot(
        "main",
        "2026-01-01",
        "main",
        int(time.time()),
        0,
        None,
        {"files": {}, "missing": ["map_markers", "zoc_overlays"]},
    )

    res = client.get("/main/chronicle/2026-01-01/markers")
    assert res.status_code == 200
    body = res.json()
    assert body["settlements"] == []
    assert body["installations"] == []
    assert body["forts"] == []
    assert body["wars"] == []
    assert body["map_id"] == "main"
    assert body["exported_at"] is None


def test_markers_route_is_realm_scoped_like_the_other_chronicle_routes(client):
    _write_day_files("main", "2026-01-01", {"map_markers": _MARKERS_DAY})

    assert client.get("/dev/chronicle/2026-01-01/markers").status_code == 403
    assert client.get("/main/chronicle/2026-01-01/markers").status_code == 200


@pytest.mark.parametrize("segment", ["%20main", "MaIn", "MAIN%20"])
def test_markers_route_normalises_map_id_like_the_access_gate(client, segment):
    """The gate grants " main"/"MaIn" as "main"; feeding the raw segment onward
    raised ValueError out of validate_map as an anonymous 500."""
    _write_day_files("main", "2026-01-01", {"map_markers": _MARKERS_DAY})

    res = client.get(f"/{segment}/chronicle/2026-01-01/markers")
    assert res.status_code == 200, res.text
    assert [s["name"] for s in res.json()["settlements"]] == ["Rimehold"]


def test_markers_route_revalidates_with_an_etag(client):
    _write_day_files("main", "2026-01-01", {"map_markers": _MARKERS_DAY})

    res = client.get("/main/chronicle/2026-01-01/markers")
    assert res.headers["etag"]
    again = client.get(
        "/main/chronicle/2026-01-01/markers",
        headers={"If-None-Match": res.headers["etag"]},
    )
    assert again.status_code == 304


# ---------------------------------------------------------------------------
# Regression: a captured day is immutable, so anything that 500s the markers
# route 500s it forever. Every degraded input below must answer 200.
# ---------------------------------------------------------------------------


def _strict_json(text: str) -> object:
    """json.loads that refuses NaN/Infinity, the way a browser's JSON.parse does."""

    def _reject(constant: str):
        raise AssertionError(f"response carries the bare JSON literal {constant!r}")

    return json.loads(text, parse_constant=_reject)


def test_markers_route_survives_non_finite_coordinates(client):
    """Python's json accepts the Infinity/NaN literals on the way in, so one bad
    coordinate from the game plugin lands in a stored day. round(inf) raises
    OverflowError, which _finite_int did not catch."""
    day = {
        "map_id": "main",
        "settlements": [
            {
                # No province_id, so there is no centroid fallback to mask the
                # coordinates being rejected.
                "id": "s1",
                "name": "Rimehold",
                "center_x": float("inf"),
                "center_z": float("nan"),
            }
        ],
        "installations": [],
        "forts": [],
        "wars": [],
    }
    _write_day_files("main", "2026-01-01", {"map_markers": day})

    res = client.get("/main/chronicle/2026-01-01/markers")
    assert res.status_code == 200, res.text
    body = _strict_json(res.text)
    settlement = body["settlements"][0]
    assert settlement["name"] == "Rimehold"
    # Unusable coordinates are dropped, not rounded into a bogus pixel.
    assert "map_x" not in settlement
    assert "map_y" not in settlement


def test_markers_route_survives_a_damaged_deflate_stream(client):
    """A valid gzip header over a torn deflate stream raises zlib.error, which is
    neither OSError nor ValueError - truncation (EOFError) and bad magic
    (BadGzipFile) were the only corruption shapes previously covered."""
    _write_day_files("main", "2026-01-01", {"map_markers": _MARKERS_DAY})
    path = store.stored_file_path("main", "2026-01-01", "map_markers")
    # Rewritten with gzip.compress so the header is exactly 10 bytes (gzip.open
    # adds an FNAME field); byte 10 is then the first deflate byte, and BFINAL=1
    # with the reserved BTYPE=11 is rejected as an invalid block type - a torn
    # stream under an intact header, not a CRC mismatch or a truncation.
    blob = bytearray(gzip.compress(json.dumps(_MARKERS_DAY).encode("utf-8")))
    blob[10] = 0x07
    Path(path).write_bytes(bytes(blob))

    res = client.get("/main/chronicle/2026-01-01/markers")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["settlements"] == []
    assert body["installations"] == []
    assert body["forts"] == []
    assert body["wars"] == []


def test_markers_route_body_is_always_valid_json(client):
    """json.dumps defaults to allow_nan=True and emits bare NaN/Infinity, which
    the viewer's JSON.parse rejects outright. Numeric fields other than the
    coordinates (population here) are never coerced, so they must be sanitised."""
    day = {
        "map_id": "main",
        "settlement_large_population_threshold": float("inf"),
        "settlements": [
            {
                "id": "s1",
                "name": "Rimehold",
                "province_id": 7,
                "population": float("nan"),
            }
        ],
        "installations": [],
        "forts": [],
        "wars": [],
    }
    _write_day_files("main", "2026-01-01", {"map_markers": day})

    res = client.get("/main/chronicle/2026-01-01/markers")
    assert res.status_code == 200, res.text
    body = _strict_json(res.text)
    assert body["settlements"][0]["population"] is None
    assert body["settlement_large_population_threshold"] is None


def test_markers_route_map_id_comes_from_the_registry_not_the_file(client):
    """The stored file is attacker-adjacent content; map_id is an identifier the
    response hands back, so it comes from the registry entry the gate resolved."""
    day = dict(_MARKERS_DAY, map_id="dev")
    _write_day_files("main", "2026-01-01", {"map_markers": day})

    body = client.get("/main/chronicle/2026-01-01/markers").json()
    assert body["map_id"] == "main"


# ---------------------------------------------------------------------------
# Regression: the index must not open a connection per day of history
# ---------------------------------------------------------------------------


def _count_borrows(monkeypatch) -> list[int]:
    """Count connections borrowed from the pool, however the code reaches it."""
    pool = database.get_pool()
    real = pool.connection
    calls: list[int] = []

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(pool, "connection", counting)
    return calls


def test_index_query_count_does_not_scale_with_day_count(client, monkeypatch):
    """One connection for fifty days, not fifty.

    The index used to call get_snapshot per day to read its manifest, each on
    its own connection. On a real map that is one connection per day of
    history before the ETag is even computed, so the constant matters, not
    just the wall clock.
    """
    start = date(2026, 2, 1)
    for index in range(50):
        _write_day("main", (start + timedelta(days=index)).isoformat(), "nation", {"a": index})

    calls = _count_borrows(monkeypatch)

    body = client.get("/main/chronicle/index").json()

    assert len(body["days"]) == 50
    # The day rows, their manifests and the newest wipe stamp share one snapshot.
    assert len(calls) == 1


def test_index_shape_is_unchanged_with_many_days(client):
    """The single-query path must answer exactly what the per-day loop did."""
    _write_day("main", "2026-03-01", "nation", {"a": 1})
    store.upsert_snapshot(
        "main",
        "2026-03-02",
        "main",
        int(time.time()),
        0,
        None,
        {"files": {}, "missing": ["trade"]},
    )
    _write_day("main", "2026-03-03", "nation", {"a": 3})
    store.upsert_snapshot(
        "main",
        "2026-03-04",
        "main",
        int(time.time()),
        0,
        None,
        {"files": {}, "invalid": ["guilds"]},
    )

    body = client.get("/main/chronicle/index").json()

    assert body["days"] == ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]
    assert body["first"] == "2026-03-01"
    assert body["last"] == "2026-03-04"
    # Ordered as `days` is, and each entry carries both lists even when empty.
    assert body["incomplete_days"] == [
        {"day": "2026-03-02", "missing": ["trade"], "invalid": []},
        {"day": "2026-03-04", "missing": [], "invalid": ["guilds"]},
    ]
    assert body["incomplete_day_count"] == 2


def _set_manifest(day: str, manifest) -> None:
    """Overwrite one stored manifest with any JSON value, bypassing the store."""
    with database.connect() as conn:
        conn.execute(
            "UPDATE map_chronicle_snapshots SET manifest = %s "
            "WHERE map_id = %s AND day = %s",
            (database.Jsonb(manifest), "main", day),
        )


def test_index_survives_a_manifest_that_is_not_an_object(client):
    """A manifest that is a bare string degrades to "complete", never to a 500."""
    _write_day("main", "2026-04-01", "nation", {"a": 1})
    _set_manifest("2026-04-01", "{not json")

    res = client.get("/main/chronicle/index")
    assert res.status_code == 200
    assert res.json()["days"] == ["2026-04-01"]
    assert res.json()["incomplete_days"] == []


# ---------------------------------------------------------------------------
# Regression: a day captured against older province geometry must be flagged
# ---------------------------------------------------------------------------


def _pin_live_geometry(monkeypatch, version):
    """Force the live geometry sha the index compares stored versions against."""
    from src.api import chronicle_routes

    monkeypatch.setattr(
        chronicle_routes, "_cached_geometry_version", lambda map_name: version
    )


def test_index_flags_days_whose_stored_geometry_differs_from_live(client, monkeypatch):
    """The whole point: stored ids painted on redrawn shapes lie about the past."""
    _pin_live_geometry(monkeypatch, "live-sha")
    _write_day("main", "2026-05-01", "nation", {"a": 1}, geometry_version="old-sha")
    _write_day("main", "2026-05-02", "nation", {"a": 2}, geometry_version="live-sha")

    body = client.get("/main/chronicle/index").json()

    assert body["stale_geometry_days"] == ["2026-05-01"]
    assert body["geometry_version"] == "live-sha"


def test_index_does_not_flag_a_day_matching_live_geometry(client, monkeypatch):
    _pin_live_geometry(monkeypatch, "live-sha")
    _write_day("main", "2026-05-01", "nation", {"a": 1}, geometry_version="live-sha")

    assert client.get("/main/chronicle/index").json()["stale_geometry_days"] == []


def test_index_treats_a_null_stored_geometry_as_unknown_not_stale(client, monkeypatch):
    """Rows captured before the column was populated must not all light up.

    A warning that fires on every historical day is a warning nobody reads, so
    "unknown" is deliberately not "stale".
    """
    _pin_live_geometry(monkeypatch, "live-sha")
    _write_day("main", "2026-05-01", "nation", {"a": 1}, geometry_version=None)

    body = client.get("/main/chronicle/index").json()
    assert body["days"] == ["2026-05-01"]
    assert body["stale_geometry_days"] == []


def test_index_flags_nothing_when_the_live_geometry_is_missing(client, monkeypatch):
    """store.geometry_version returns None with no artifact - nothing to compare."""
    _pin_live_geometry(monkeypatch, None)
    _write_day("main", "2026-05-01", "nation", {"a": 1}, geometry_version="old-sha")
    _write_day("main", "2026-05-02", "nation", {"a": 2}, geometry_version="older-sha")

    body = client.get("/main/chronicle/index").json()
    assert body["geometry_version"] is None
    assert body["stale_geometry_days"] == []


def test_stale_geometry_days_ignores_a_non_string_stored_version():
    """A damaged row cannot be compared, so it is unknown rather than stale.

    Driven at the helper because the database enforces text values; only
    in-process corruption can produce these types.
    """
    from src.api.chronicle_routes import _stale_geometry_days

    rows = [
        ("2026-05-01", {}, "old-sha"),
        ("2026-05-02", {}, b"binary"),
        ("2026-05-03", {}, 17),
        ("2026-05-04", {}, None),
        ("2026-05-05", {}, "live-sha"),
    ]

    assert _stale_geometry_days(rows, "live-sha") == ["2026-05-01"]
    assert _stale_geometry_days(rows, None) == []


def test_stale_geometry_days_are_ordered_and_shaped_like_days(client, monkeypatch):
    """Ascending like `days`/`incomplete_days`, and `days` stays a flat string[].

    ChronicleStudio and ChronicleDayViewer both consume `days` as string[], so
    the new field must be strictly additive.
    """
    _pin_live_geometry(monkeypatch, "live-sha")
    _write_day("main", "2026-06-03", "nation", {"a": 3}, geometry_version="old-sha")
    _write_day("main", "2026-06-01", "nation", {"a": 1}, geometry_version="old-sha")
    _write_day("main", "2026-06-02", "nation", {"a": 2}, geometry_version="live-sha")

    body = client.get("/main/chronicle/index").json()

    assert body["days"] == ["2026-06-01", "2026-06-02", "2026-06-03"]
    assert all(isinstance(day, str) for day in body["days"])
    assert body["stale_geometry_days"] == ["2026-06-01", "2026-06-03"]
    # Nothing else about the response moved. `last_wiped_at` joined the shape
    # with the staff wipe routes: an empty `days` means "never captured" *or*
    # "wiped", and the viewer needs to tell those apart.
    assert set(body) == {
        "days",
        "first",
        "last",
        "geometry_version",
        "incomplete_days",
        "incomplete_day_count",
        "stale_geometry_days",
        "last_wiped_at",
    }
    assert body["first"] == "2026-06-01"
    assert body["last"] == "2026-06-03"
    assert body["incomplete_days"] == []
    assert body["incomplete_day_count"] == 0
    # Never wiped, so null rather than absent.
    assert body["last_wiped_at"] is None


def test_index_without_snapshots_has_no_stale_geometry_days(client, monkeypatch):
    _pin_live_geometry(monkeypatch, "live-sha")
    body = client.get("/main/chronicle/index").json()
    assert body["days"] == []
    assert body["stale_geometry_days"] == []


@pytest.mark.parametrize("segment", ["%20main", "MaIn", "MAIN%20"])
def test_stale_geometry_days_use_the_normalised_map_id(client, monkeypatch, segment):
    """Same trap as everywhere else here: entry.id, never the raw path segment."""
    _pin_live_geometry(monkeypatch, "live-sha")
    _write_day("main", "2026-07-01", "nation", {"a": 1}, geometry_version="old-sha")

    res = client.get(f"/{segment}/chronicle/index")
    assert res.status_code == 200
    assert res.json()["days"] == ["2026-07-01"]
    assert res.json()["stale_geometry_days"] == ["2026-07-01"]


def test_stale_geometry_costs_no_extra_database_connections(client, monkeypatch):
    """One connect for the whole index, geometry comparison included."""
    _pin_live_geometry(monkeypatch, "live-sha")
    for index in range(10):
        _write_day(
            "main",
            (date(2026, 8, 1) + timedelta(days=index)).isoformat(),
            "nation",
            {"a": index},
            geometry_version="old-sha" if index % 2 else "live-sha",
        )

    calls = _count_borrows(monkeypatch)

    body = client.get("/main/chronicle/index").json()

    assert len(calls) == 1
    assert len(body["stale_geometry_days"]) == 5


def test_index_with_a_list_manifest_still_reports_stale_geometry(
    client, monkeypatch
):
    """A manifest that is not an object must not cost the day its geometry warning, or 500."""
    _pin_live_geometry(monkeypatch, "live-sha")
    _write_day("main", "2026-09-01", "nation", {"a": 1}, geometry_version="old-sha")
    _set_manifest("2026-09-01", [1, 2, 3])

    res = client.get("/main/chronicle/index")
    assert res.status_code == 200
    assert res.json()["stale_geometry_days"] == ["2026-09-01"]
    assert res.json()["incomplete_days"] == []


def test_snapshot_row_degrades_a_list_manifest_instead_of_raising(client):
    """_snapshot_row used to hand a list straight through to `.get` -> 500."""
    _write_day("main", "2026-10-01", "nation", {"a": 1})
    _set_manifest("2026-10-01", [1, 2, 3])

    assert store.get_snapshot("main", "2026-10-01")["manifest"] == {}
    # The read route resolves through the manifest, so it must 404, not 500.
    assert client.get("/main/chronicle/2026-10-01/data/nation").status_code == 404
