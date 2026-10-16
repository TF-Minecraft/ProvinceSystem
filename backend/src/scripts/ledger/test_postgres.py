"""The ledger index on Postgres: stored types, ETag inputs and concurrent access."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import database
from src.api.ledger_routes import ledger_router
from src.api.map_registry import clear_map_registry_cache
from src.scripts.ledger import ingest, store
from src.scripts.ledger.schema import faction_key, normalize_snapshot

from .conftest import MAP, faction_payload, snapshot_payload

WAIT = 10


def _promote(captured_at: str, factions, *, complete: bool = True, map_id: str = MAP) -> dict:
    snapshot = normalize_snapshot(
        snapshot_payload(captured_at=captured_at, complete=complete, factions=factions, map_id=map_id),
        map_id,
    )
    ingest.store_raw(map_id, snapshot)
    ingest.promote_day(map_id, snapshot["day"])
    return snapshot


# --- stored types -------------------------------------------------------------


def test_captured_at_reads_back_in_the_form_it_was_written(env: Path) -> None:
    _promote("2026-09-01T12:00:00Z", [faction_payload()])
    _promote("2026-09-02T08:30:15.123456Z", [faction_payload()])
    _promote("2026-09-03T23:59:59.5Z", [faction_payload()])

    days = store.list_days(MAP)
    assert [row["captured_at"] for row in days] == [
        "2026-09-01T12:00:00Z",
        "2026-09-02T08:30:15.123456Z",
        "2026-09-03T23:59:59.500000Z",
    ]
    registry = store.list_registry(MAP)[0]
    assert registry["first_seen_at"] == "2026-09-01T12:00:00Z"
    assert registry["last_seen_at"] == "2026-09-03T23:59:59.500000Z"
    assert store.get_day(MAP, "2026-09-03")["captured_at"] == "2026-09-03T23:59:59.500000Z"


def test_nanoseconds_round_to_microseconds(env: Path) -> None:
    """Java's nanoseconds (old daily files) round once; nothing compares them finer."""
    snapshot = normalize_snapshot(snapshot_payload(), MAP)
    snapshot["captured_at"] = "2026-09-01T12:00:00.123456789Z"
    ingest.index_snapshot(MAP, snapshot)

    assert store.list_days(MAP)[0]["captured_at"] == "2026-09-01T12:00:00.123457Z"
    assert store.list_registry(MAP)[0]["last_seen_at"] == "2026-09-01T12:00:00.123457Z"


def test_json_columns_arrive_parsed_not_emptied(env: Path) -> None:
    """jsonb hands back dicts and lists; a `json.loads` fallback would have read them as {}."""
    wars = [{"enemy": "bran", "since": "2026-08-01", "attacker": True}]
    _promote("2026-09-01T12:00:00Z", [faction_payload(subjects=["cale"], wars=wars)])

    row = store.read_faction_days(MAP, "2026-09-01", "2026-09-01", full=True)[0]
    assert row["wealth_breakdown"] == {"provinces": 800.0, "trade": 200.0}
    assert row["prestige_breakdown"] == {"wealth": 300.0, "war": 200.0}
    assert row["subjects"] == ["cale"]
    assert row["wars"] == wars
    day = store.get_day(MAP, "2026-09-01")
    assert day["complete"] is True
    assert list(day["global"]) == sorted(day["global"])
    assert day["global"]["faction_wealth"] == 1000.0


def test_founded_at_and_the_faction_key_stay_byte_exact(env: Path) -> None:
    founded = "2026-01-02T00:00:00.000000001Z"
    _promote("2026-09-01T12:00:00Z", [faction_payload(founded_at=founded)])

    row = store.list_registry(MAP)[0]
    assert row["founded_at"] == founded
    assert row["faction_key"] == faction_key("alba", founded)


def test_series_etags_match_the_sqlite_index(env: Path, monkeypatch) -> None:
    """The same data answers with the same ETags it had on SQLite, so clients keep their 304s.

    The tags were taken from the SQLite build for exactly this dataset.
    """
    registry = env / "maps.yml"
    registry.write_text(
        "maps:\n  - id: main\n    public: true\n    display_name: Adavaar\n    realm_id: main\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

    def faction(fid: str, founded: str, wealth: float) -> dict:
        return faction_payload(
            id=fid,
            founded_at=founded,
            name=fid.title(),
            subjects=["x"],
            wealth=wealth,
            wealth_breakdown={"provinces": wealth * 0.8, "trade": wealth * 0.2},
            prestige_breakdown={"wealth": 300.0},
            highest_title="King",
            wars=[{"enemy": "b", "since": "2026-01-01", "attacker": True}],
        )

    days = [
        ("2026-01-01T12:00:00Z", True),
        ("2026-01-02T08:30:15.123456Z", True),
        ("2026-01-03T23:59:59.5Z", False),
    ]
    for index, (captured_at, complete) in enumerate(days):
        factions = [
            faction("alba", "2026-01-01T00:00:00Z", 1000.0 + index),
            faction("bran", "2026-01-02T00:00:00.000000001Z", 2000.5 - index),
        ][: 1 if index == 2 else 2]
        payload = snapshot_payload(
            map_id="main", captured_at=captured_at, complete=complete, factions=factions, guilds=[]
        )
        payload["global"].update(
            faction_count=len(factions), guild_count=0, max_wealth_prestige=900.5,
            faction_wealth=1000.25,
        )
        snapshot = normalize_snapshot(payload, "main")
        ingest.store_raw("main", snapshot)
        ingest.promote_day("main", snapshot["day"])

    app = FastAPI()
    app.include_router(ledger_router)
    alba = faction_key("alba", "2026-01-01T00:00:00Z")
    try:
        with TestClient(app) as client:
            tags = {
                url: client.get(url).headers["etag"]
                for url in (
                    "/main/ledger/series",
                    "/main/ledger/series?fields=full",
                    "/main/ledger/index",
                    f"/main/ledger/faction/{alba}",
                )
            }
    finally:
        clear_map_registry_cache()

    assert tags == {
        "/main/ledger/series": '"d9effd5899353165014df1a6e567bd6245ca4f13"',
        "/main/ledger/series?fields=full": '"63a6ff61850bf61d2d46f001410410ab74ebd240"',
        "/main/ledger/index": '"6264d9e380b177e86d82887ab0cf6b625c2e30c6"',
        f"/main/ledger/faction/{alba}": '"3198b641fd63cbe679bc9e33099d6347cd215e38"',
    }


# --- concurrent access --------------------------------------------------------


def _in_thread(target, *args) -> tuple[threading.Thread, list]:
    outcome: list = []

    def run() -> None:
        try:
            outcome.append(target(*args))
        except BaseException as exc:  # surfaced by the test
            outcome.append(exc)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, outcome


def test_a_reader_never_sees_half_a_promotion(env: Path, monkeypatch) -> None:
    """All five writes are one transaction: a reader sees the old day or the new one."""
    _promote("2026-09-01T10:00:00Z", [faction_payload()])
    snapshot = normalize_snapshot(
        snapshot_payload(
            captured_at="2026-09-01T11:00:00Z",
            factions=[faction_payload(), faction_payload(id="bran", founded_at="2026-02-01T00:00:00Z")],
        ),
        MAP,
    )

    inside, release = threading.Event(), threading.Event()
    real_guilds = store.replace_day_guilds

    def paused(*args, **kwargs):
        real_guilds(*args, **kwargs)
        inside.set()
        assert release.wait(WAIT)

    monkeypatch.setattr(ingest, "replace_day_guilds", paused)
    writer, outcome = _in_thread(ingest.index_snapshot, MAP, snapshot)
    assert inside.wait(WAIT)

    # The day row and two faction rows are written but not committed.
    assert store.get_day(MAP, "2026-09-01")["captured_at"] == "2026-09-01T10:00:00Z"
    assert len(store.read_faction_days(MAP, "2026-09-01", "2026-09-01")) == 1
    assert len(store.list_registry(MAP)) == 1

    release.set()
    writer.join(WAIT)
    assert outcome == [None]
    assert store.get_day(MAP, "2026-09-01")["captured_at"] == "2026-09-01T11:00:00Z"
    assert len(store.read_faction_days(MAP, "2026-09-01", "2026-09-01")) == 2
    assert len(store.list_registry(MAP)) == 2


def test_a_read_view_keeps_one_snapshot_across_a_promotion(env: Path) -> None:
    """The series route's day axis, ETag inputs and faction rows all come from one state."""
    _promote("2026-09-01T12:00:00Z", [faction_payload()])

    with store.read_view() as conn:
        assert [row["day"] for row in store.list_days(MAP, conn=conn)] == ["2026-09-01"]

        # A promotion commits on another connection while the request is mid-way.
        _promote("2026-09-02T12:00:00Z", [faction_payload()])
        assert len(store.list_days(MAP)) == 2

        assert [row["day"] for row in store.read_global_days(MAP, "2026-09-01", "2026-09-30", conn=conn)] == [
            "2026-09-01"
        ]
        assert [
            row["day"] for row in store.read_faction_days(MAP, "2026-09-01", "2026-09-30", conn=conn)
        ] == ["2026-09-01"]
        assert store.list_registry(MAP, conn=conn)[0]["last_seen_day"] == "2026-09-01"


def test_a_read_view_is_read_only(env: Path) -> None:
    with pytest.raises(database.Error), store.read_view() as conn:
        store.upsert_day(MAP, normalize_snapshot(snapshot_payload(), MAP), conn=conn)


def test_index_writes_for_one_map_take_turns(env: Path) -> None:
    """The advisory lock backs up the file lock: one index write per map at a time."""
    snapshot = normalize_snapshot(snapshot_payload(), MAP)

    with database.connect() as holder:
        database.advisory_lock(holder, f"ledger:index:{MAP}")
        writer, outcome = _in_thread(ingest.index_snapshot, MAP, snapshot)
        writer.join(0.5)
        assert writer.is_alive()
        assert store.list_days(MAP) == []

    writer.join(WAIT)
    assert outcome == [None]
    assert [row["day"] for row in store.list_days(MAP)] == ["2026-09-01"]


def test_index_writes_for_other_maps_do_not_wait(env: Path) -> None:
    snapshot = normalize_snapshot(snapshot_payload(map_id="other"), "other")

    with database.connect() as holder:
        database.advisory_lock(holder, f"ledger:index:{MAP}")
        writer, outcome = _in_thread(ingest.index_snapshot, "other", snapshot)
        writer.join(WAIT)
        assert outcome == [None]
