"""Upload-route tests for the ledger branch, and the regression that guards
every other mode's on-disk bytes.

The app is assembled from `data_router` alone rather than imported from
`server` — see the note in `test_ledger_routes.py`.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
import threading
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.api import data_routes  # noqa: E402
from src.api.data_routes import data_router  # noqa: E402
from src.api.map_registry import clear_map_registry_cache  # noqa: E402
from src.scripts.chronicle import capture as chronicle_capture  # noqa: E402
from src.scripts.ledger import ingest as ledger_ingest  # noqa: E402
from src.scripts.ledger import store  # noqa: E402
from src.scripts.ledger.schema import MAX_BODY_BYTES as LEDGER_MAX_BODY_BYTES  # noqa: E402
from src.scripts.ledger.schema import faction_key  # noqa: E402
from src.scripts.util import dirs  # noqa: E402
from src.scripts.util.maplock import MapLockBusy  # noqa: E402
from src.skins import db as skins_db  # noqa: E402

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

ALBA_KEY = faction_key("alba", "2026-01-01T00:00:00Z")

LOCALHOST = ("127.0.0.1", 12345)


def _faction(**overrides) -> dict:
    faction = {
        "id": "alba",
        "founded_at": "2026-01-01T00:00:00Z",
        "name": "Alba",
        "rgb": "#ff0000",
        "overlord": None,
        "subjects": [],
        "wealth": 1000.0,
        "wealth_breakdown": {"provinces": 800.0},
        "bank": 100.0,
        "vassal_wealth": 0.0,
        "net_income": 12.5,
        "inflation_delta": -0.5,
        "trade_power": 7.0,
        "prestige": 500.0,
        "prestige_breakdown": {"wealth": 300.0},
        "rank": "Kingdom",
        "rank_level": 3,
        "rank_up_at": 600.0,
        "rank_down_at": 400.0,
        "prestige_position": 1,
        "wealth_position": 1,
        "provinces": 12,
        "realm_size": 12,
        "tier": "king",
        "tier_index": 4,
        "highest_title": "King of Alba",
        "members": 5,
        "members_with_vassals": 5,
        "settlements": 3,
        "population": 340,
        "installations": 2,
        "forts": 1,
        "wars": [],
    }
    faction.update(overrides)
    return faction


def _snapshot(**overrides) -> dict:
    payload = {
        "schema_version": 1,
        "map_id": "main",
        "captured_at": "2026-09-01T12:00:00Z",
        "server_day": 41,
        "day_progress_seconds": 900,
        "complete": True,
        "global": {"faction_count": 1, "faction_wealth": 1000.0},
        "factions": [_faction()],
        "guilds": [],
        "events": [],
    }
    payload.update(overrides)
    # `global.faction_count` tracks the array unless a test overrides `global`:
    # the two disagreeing is exactly what disarms deletions on the ingest side.
    if "global" not in overrides:
        payload["global"]["faction_count"] = len(payload.get("factions") or [])
    return payload


@pytest.fixture
def upload_env(tmp_path, monkeypatch, postgres):
    registry = tmp_path / "maps.yml"
    registry.write_text(TEST_REGISTRY, encoding="utf-8")
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(skins_db, "DATA_DIR", data_dir)
    monkeypatch.setattr(skins_db, "DB_PATH", data_dir / "province.db")
    monkeypatch.setattr(skins_db, "SKINS_DIR", data_dir / "skins")
    monkeypatch.setattr(skins_db, "WARDROBE_DIR", data_dir / "wardrobe")
    monkeypatch.setattr(skins_db, "DRINKS_DIR", data_dir / "drinks")

    monkeypatch.setattr(dirs, "INPUT_DIR", str(tmp_path / "input"))
    monkeypatch.setattr(dirs, "DEFINES_DIR", str(tmp_path / "defines"))
    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))

    # The daily timelapse capture rides the upload; it reads the real defines
    # tree and is not what these tests are about.
    captures: list[str] = []
    monkeypatch.setattr(
        chronicle_capture, "capture_if_due", lambda map_name: captures.append(map_name)
    )
    monkeypatch.setattr(
        "src.api.data_routes.generate_zoc_overlays", lambda map_name: None
    )
    monkeypatch.setattr(
        "src.api.data_routes.create_infestation_map", lambda map_name: None
    )

    skins_db.migrate()
    try:
        yield {"root": tmp_path, "captures": captures}
    finally:
        clear_map_registry_cache()


@pytest.fixture
def client(upload_env):
    app = FastAPI()
    app.include_router(data_router)
    with TestClient(app, client=LOCALHOST) as test_client:
        yield test_client


# --- regression: existing modes keep byte-identical on-disk behaviour ---------


def _expected_bytes(payload: object) -> str:
    """Exactly what the pre-ledger handler wrote: json.dump(..., indent=2)."""
    return json.dumps(payload, ensure_ascii=False, indent=2)


def test_input_mode_bytes_are_unchanged(client, upload_env):
    """`nation` is an `input/` mode — same path, same bytes, same side effects."""
    payload = {"nations": [{"id": "alba", "name": "Álba", "wealth": 1.5}]}
    res = client.post("/main/data/upload/nation", json=payload)
    assert res.status_code == 200
    assert res.json() == {"message": "nation data saved for 'main'"}

    path = upload_env["root"] / "input" / "main" / "nation.json"
    assert path.read_text(encoding="utf-8") == _expected_bytes(payload)
    # The legacy path resolves the map from the raw segment, not the registry.
    assert upload_env["captures"] == ["main"]


def test_defines_mode_bytes_are_unchanged(client, upload_env):
    """`zoc_overlays` is an unknown mode, so it falls through to `defines/`."""
    payload = {"forts": {"f1": {"url": "/x.png"}}}
    res = client.post("/main/data/upload/zoc_overlays", json=payload)
    assert res.status_code == 200
    assert res.json() == {"message": "zoc_overlays data saved for 'main'"}

    path = upload_env["root"] / "defines" / "main" / "zoc_overlays.json"
    assert path.read_text(encoding="utf-8") == _expected_bytes(payload)


def test_ledger_mode_writes_no_defines_file(client, upload_env):
    client.post("/main/data/upload/chronicle", json=_snapshot())
    assert not (upload_env["root"] / "defines" / "main" / "chronicle.json").exists()


# --- ledger branch -----------------------------------------------------------


def test_ledger_upload_stores_raw_and_promotes(client, upload_env):
    res = client.post("/main/data/upload/chronicle", json=_snapshot())
    assert res.status_code == 200
    body = res.json()
    assert body["map"] == "main"
    assert body["day"] == "2026-09-01"
    assert body["captured_at"] == "2026-09-01T12:00:00Z"
    assert body["complete"] is True
    assert body["factions"] == 1

    raw_dir = upload_env["root"] / "output" / "main" / "ledger" / "raw" / "2026-09-01"
    assert len(list(raw_dir.glob("*.json.gz"))) == 1

    daily = upload_env["root"] / "output" / "main" / "ledger" / "daily" / "2026-09-01.json.gz"
    assert daily.exists()
    stored = json.loads(gzip.decompress(daily.read_bytes()))
    assert stored["day"] == "2026-09-01"
    assert store.list_days("main")[0]["day"] == "2026-09-01"


def test_two_snapshots_in_one_day_keep_both_raw_files(client, upload_env):
    client.post("/main/data/upload/chronicle", json=_snapshot())
    client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(captured_at="2026-09-01T12:05:00Z"),
    )

    raw_dir = upload_env["root"] / "output" / "main" / "ledger" / "raw" / "2026-09-01"
    assert len(list(raw_dir.glob("*.json.gz"))) == 2
    assert [row["day"] for row in store.list_days("main")] == ["2026-09-01"]


def test_capture_if_due_still_runs_last_on_the_ledger_branch(client, upload_env):
    client.post("/main/data/upload/chronicle", json=_snapshot())
    # Queued behind the promote, and keyed off the URL segment like every
    # other mode - see the next test.
    assert upload_env["captures"] == ["main"]


@pytest.mark.parametrize("segment", ["Main", "MAIN"])
def test_a_mixed_case_url_captures_under_the_registry_id(client, upload_env, segment):
    """The timelapse must not fork an orphan series under the URL's casing.

    `validate_map` only enforces `isalnum()`, so "/MAIN/data/upload/chronicle"
    stores its ledger rows under "main" while the raw segment stays "MAIN".
    Handing that segment to `capture_if_due` started a second chronicle series
    under a map id whose sources never exist - a permanently-incomplete
    manifest, retried on every upload forever.
    """
    res = client.post(f"/{segment}/data/upload/chronicle", json=_snapshot())
    assert res.status_code == 200
    assert res.json()["map"] == "main"
    assert upload_env["captures"] == ["main"]
    # Storage is unaffected: still one series, under the registry id.
    assert [row["day"] for row in store.list_days("main")] == ["2026-09-01"]


def test_incomplete_snapshot_never_marks_a_deletion(client, upload_env):
    client.post("/main/data/upload/chronicle", json=_snapshot())
    client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(
            captured_at="2026-09-02T12:00:00Z", complete=False, factions=[]
        ),
    )

    rows = store.list_registry("main")
    assert [row["deleted_day"] for row in rows] == [None]


def test_complete_snapshot_marks_absence_as_deletion(client, upload_env):
    client.post("/main/data/upload/chronicle", json=_snapshot())
    client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(captured_at="2026-09-02T12:00:00Z", factions=[]),
    )

    (row,) = store.list_registry("main")
    assert row["faction_key"] == ALBA_KEY
    assert row["deleted_day"] == "2026-09-02"


def test_reused_id_with_a_new_founded_at_is_a_separate_identity(client, upload_env):
    client.post("/main/data/upload/chronicle", json=_snapshot())
    client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(
            captured_at="2026-09-02T12:00:00Z",
            factions=[_faction(founded_at="2026-06-01T00:00:00Z")],
        ),
    )

    keys = {row["faction_key"] for row in store.list_registry("main")}
    assert len(keys) == 2
    assert ALBA_KEY in keys


def test_partition_is_on_captured_at_not_server_day(client, upload_env):
    """Two snapshots with the same `server_day` but different UTC dates split."""
    client.post("/main/data/upload/chronicle", json=_snapshot(server_day=41))
    client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(captured_at="2026-09-02T00:30:00Z", server_day=41),
    )

    assert [row["day"] for row in store.list_days("main")] == [
        "2026-09-01",
        "2026-09-02",
    ]


def test_map_id_mismatch_against_an_unknown_name_is_accepted(client, upload_env):
    res = client.post(
        "/main/data/upload/chronicle", json=_snapshot(map_id="Adavaar-Overworld")
    )
    assert res.status_code == 200
    assert res.json()["map"] == "main"
    assert store.list_days("main")


def test_map_id_case_difference_is_accepted(client, upload_env):
    res = client.post("/main/data/upload/chronicle", json=_snapshot(map_id="MAIN"))
    assert res.status_code == 200
    assert res.json()["map"] == "main"


def test_map_id_naming_a_different_registered_map_is_409(client, upload_env):
    res = client.post("/main/data/upload/chronicle", json=_snapshot(map_id="dev"))
    assert res.status_code == 409
    assert not store.list_days("main")


def test_unknown_map_on_the_ledger_branch_is_404(client, upload_env):
    res = client.post("/nosuchmap/data/upload/chronicle", json=_snapshot())
    assert res.status_code == 404


def test_bad_snapshot_is_400_and_writes_nothing(client, upload_env):
    res = client.post(
        "/main/data/upload/chronicle", json=_snapshot(captured_at="not-a-date")
    )
    assert res.status_code == 400
    assert not (upload_env["root"] / "output" / "main").exists()


def test_faction_without_founded_at_is_400(client, upload_env):
    faction = _faction()
    faction.pop("founded_at")
    res = client.post("/main/data/upload/chronicle", json=_snapshot(factions=[faction]))
    assert res.status_code == 400


def test_non_localhost_upload_is_403(upload_env):
    app = FastAPI()
    app.include_router(data_router)
    with TestClient(app, client=LOCALHOST) as remote:
        res = remote.post(
            "/main/data/upload/chronicle",
            json=_snapshot(),
            headers={"X-Forwarded-For": "8.8.8.8"},
        )
    assert res.status_code == 403


def test_store_raw_runs_off_the_event_loop(client, upload_env, monkeypatch):
    """`store_raw` blocks on gzip, fsync and a 30s lock wait.

    `upload_region_data` is `async def`, so calling it directly would park the
    whole event loop - every other connection on the box - behind a wipe that
    happens to hold the map's ledger lock. It has to go through the threadpool.
    """
    real_store_raw = ledger_ingest.store_raw
    real_normalize = data_routes.normalize_snapshot
    seen: dict[str, str] = {}

    def _normalize(payload, map_id):
        # Runs on the event loop itself, a few lines above the call under test.
        seen["loop"] = threading.current_thread().name
        return real_normalize(payload, map_id)

    def _store_raw(map_id, snapshot):
        seen["store_raw"] = threading.current_thread().name
        return real_store_raw(map_id, snapshot)

    monkeypatch.setattr(data_routes, "normalize_snapshot", _normalize)
    monkeypatch.setattr("src.scripts.ledger.ingest.store_raw", _store_raw)

    res = client.post("/main/data/upload/chronicle", json=_snapshot())

    assert res.status_code == 200
    assert seen["store_raw"] != seen["loop"]


def test_a_locked_ledger_is_503_with_retry_after(client, upload_env, monkeypatch):
    """A staff wipe/restore holding the map lock is temporary, not a 500.

    `store_raw` takes the per-map ledger lock and raises `MapLockBusy` when it
    cannot get it inside 30s. The plugin re-POSTs on a 503; a 500 loses the
    sample, and this is the only durable copy of it.
    """
    def _busy(*args, **kwargs):
        raise MapLockBusy("held by a wipe")

    monkeypatch.setattr("src.scripts.ledger.ingest.store_raw", _busy)

    res = client.post("/main/data/upload/chronicle", json=_snapshot())

    assert res.status_code == 503
    assert res.headers["retry-after"] == "30"
    assert "locked" in res.json()["detail"]
    # Nothing was promoted or captured behind the failed write.
    assert upload_env["captures"] == []


# --- public artifact 404s ----------------------------------------------------
#
# Lives here rather than in `test_chronicle_routes.py` because that module
# builds its client from `server.app`; this one mounts `data_router` alone.


@pytest.mark.parametrize("route", ["province_id_runs", "province_id_grid_q4"])
def test_public_artifact_404_echoes_nothing_back(client, upload_env, route):
    """No caller input, no build command: this route needs no authentication."""
    res = client.get(f"/MaIn/data/{route}")
    assert res.status_code == 404
    detail = res.json()["detail"]
    assert detail == "Artifact not found"
    assert "MaIn" not in detail
    assert "build_province_id_grid" not in detail


# --- body reader -------------------------------------------------------------


def test_oversize_ledger_body_is_413(client, upload_env, monkeypatch):
    monkeypatch.setattr("src.api.data_routes.LEDGER_MAX_BODY_BYTES", 64)
    res = client.post("/main/data/upload/chronicle", json=_snapshot())
    assert res.status_code == 413
    assert not (upload_env["root"] / "output" / "main").exists()


def test_oversize_legacy_body_is_413(client, upload_env, monkeypatch):
    monkeypatch.setattr("src.api.data_routes.UPLOAD_MAX_BODY_BYTES", 8)
    res = client.post("/main/data/upload/nation", json={"nations": [1, 2, 3]})
    assert res.status_code == 413
    assert not (upload_env["root"] / "input" / "main").exists()


def test_non_ledger_cap_is_not_more_than_the_ledger_cap(client, upload_env):
    """The non-ledger modes are ~70 KB documents; the cap was 64 MiB.

    Pinned against the ledger's own `schema.MAX_BODY_BYTES` rather than a bare
    number so the two cannot drift back apart: no upload mode on this route may
    claim more memory than the largest payload the app actually receives.
    """
    from src.api.data_routes import UPLOAD_MAX_BODY_BYTES

    assert UPLOAD_MAX_BODY_BYTES == 8 * 1024 * 1024
    assert UPLOAD_MAX_BODY_BYTES <= LEDGER_MAX_BODY_BYTES


def test_a_body_at_the_cap_is_still_accepted(client, upload_env, monkeypatch):
    """The ceiling is exclusive of nothing: exactly `limit` bytes still parse."""
    payload = {"nations": []}
    body = json.dumps(payload).encode("utf-8")
    monkeypatch.setattr("src.api.data_routes.UPLOAD_MAX_BODY_BYTES", len(body))
    res = client.post(
        "/main/data/upload/nation",
        content=body,
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 200


def test_malformed_json_is_400_not_500(client, upload_env):
    res = client.post(
        "/main/data/upload/chronicle",
        content=b"{not json",
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 400


def test_legacy_mode_malformed_json_is_400_not_500(client, upload_env):
    res = client.post(
        "/main/data/upload/nation",
        content=b"",
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 400


def test_deeply_nested_json_is_400_not_500(client, upload_env):
    """`json.loads` raises RecursionError, not ValueError, on deep nesting.

    The reader caught only ValueError, so 8 MiB of `[[[[…]]]]` surfaced as a
    500 from an unhandled exception rather than the 400 it is.
    """
    depth = 20000
    body = ("[" * depth) + ("]" * depth)
    res = client.post(
        "/main/data/upload/chronicle",
        content=body.encode("ascii"),
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 400


def test_a_far_future_captured_at_is_refused_by_the_upload(client, upload_env):
    """Finding 2, end to end: nothing is stored and no day is indexed."""
    payload = _snapshot()
    payload["captured_at"] = "9999-12-31T00:00:00Z"

    res = client.post("/main/data/upload/chronicle", json=payload)

    assert res.status_code == 400
    assert store.list_days("main") == []  # nothing indexed


def _chapter_identity_path(upload_env) -> Path:
    return upload_env["root"] / "input" / "main" / "chapter_identity.json"


def test_chronicle_upload_stamps_chapter_identity(client, upload_env):
    res = client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(chapter_id="Vardera", chapter_name="  Vardera  "),
    )
    assert res.status_code == 200
    assert res.json()["map"] == "main"
    assert store.list_days("main")
    assert json.loads(_chapter_identity_path(upload_env).read_text(encoding="utf-8")) == {
        "chapter_id": "vardera",
        "chapter_name": "Vardera",
    }


def test_chronicle_upload_without_chapter_keys_stamps_unknown(client, upload_env):
    res = client.post("/main/data/upload/chronicle", json=_snapshot())
    assert res.status_code == 200
    assert json.loads(_chapter_identity_path(upload_env).read_text(encoding="utf-8")) == {
        "chapter_id": "unknown",
        "chapter_name": "Unknown",
    }


def test_chapter_id_naming_a_registered_map_is_not_409(client, upload_env):
    res = client.post(
        "/main/data/upload/chronicle",
        json=_snapshot(chapter_id="dev", chapter_name="Dev"),
    )
    assert res.status_code == 200
    assert res.json()["map"] == "main"
    assert store.list_days("main")
    assert json.loads(_chapter_identity_path(upload_env).read_text(encoding="utf-8")) == {
        "chapter_id": "dev",
        "chapter_name": "Dev",
    }


def test_map_id_naming_a_different_registered_map_still_409_and_does_not_stamp(
    client, upload_env
):
    res = client.post("/main/data/upload/chronicle", json=_snapshot(map_id="dev"))
    assert res.status_code == 409
    assert not store.list_days("main")
    assert not _chapter_identity_path(upload_env).exists()


def test_map_markers_upload_stamps_chapter_identity(client, upload_env):
    payload = {"markers": [], "chapter_id": "vardera", "chapter_name": "Vardera"}
    res = client.post("/main/data/upload/map_markers", json=payload)
    assert res.status_code == 200
    markers_path = upload_env["root"] / "input" / "main" / "map_markers.json"
    assert json.loads(markers_path.read_text(encoding="utf-8")) == payload
    assert json.loads(_chapter_identity_path(upload_env).read_text(encoding="utf-8")) == {
        "chapter_id": "vardera",
        "chapter_name": "Vardera",
    }


def test_nation_upload_does_not_write_chapter_identity(client, upload_env):
    payload = {
        "nations": [{"id": "alba", "name": "Álba", "wealth": 1.5}],
        "chapter_id": "vardera",
        "chapter_name": "Vardera",
    }
    res = client.post("/main/data/upload/nation", json=payload)
    assert res.status_code == 200
    assert not _chapter_identity_path(upload_env).exists()
    nation_path = upload_env["root"] / "input" / "main" / "nation.json"
    assert json.loads(nation_path.read_text(encoding="utf-8")) == payload


def test_title_upload_does_not_write_chapter_identity(client, upload_env):
    # Empty titles skip the write entirely; a non-empty object still must not stamp.
    payload = {"chapter_id": "vardera", "chapter_name": "Vardera"}
    res = client.post("/main/data/upload/county", json=payload)
    # May 400 on validation or skip-empty; either way identity must not appear.
    assert not _chapter_identity_path(upload_env).exists()
    assert res.status_code in (200, 400)
