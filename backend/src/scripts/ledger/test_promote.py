"""Canonical daily selection and the index rows it produces."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from src import database
from src.scripts.ledger import ingest, store
from src.scripts.ledger.schema import normalize_snapshot

from .conftest import (
    MAP,
    _guild_day_rows,
    faction_payload,
    guild_payload,
    snapshot_payload,
)

DAY = "2026-09-01"


def _post(**overrides) -> dict:
    snapshot = normalize_snapshot(snapshot_payload(**overrides), MAP)
    ingest.store_raw(MAP, snapshot)
    return snapshot


def test_canonical_is_the_latest_complete_snapshot_of_the_day(env: Path) -> None:
    _post(captured_at=f"{DAY}T10:00:00Z", complete=True, server_day=1)
    _post(captured_at=f"{DAY}T11:00:00Z", complete=True, server_day=2)
    # A later *incomplete* snapshot must not displace a complete one.
    _post(captured_at=f"{DAY}T12:00:00Z", complete=False, server_day=3)

    promoted = ingest.promote_day(MAP, DAY)
    assert promoted["server_day"] == 2

    row = store.get_day(MAP, DAY)
    assert row["complete"] is True
    assert row["server_day"] == 2
    assert row["captured_at"] == f"{DAY}T11:00:00Z"


def test_a_day_with_no_complete_snapshot_falls_back_to_the_latest(env: Path) -> None:
    _post(captured_at=f"{DAY}T10:00:00Z", complete=False, server_day=1)
    _post(captured_at=f"{DAY}T12:00:00Z", complete=False, server_day=2)

    promoted = ingest.promote_day(MAP, DAY)
    assert promoted["server_day"] == 2

    row = store.get_day(MAP, DAY)
    assert row["complete"] is False
    assert store.latest_complete_day(MAP) is None


def test_promote_writes_the_daily_file(env: Path) -> None:
    _post()
    ingest.promote_day(MAP, DAY)

    path = Path(store.daily_path(MAP, DAY))
    assert path.exists()
    body = json.loads(gzip.decompress(path.read_bytes()))
    assert body["day"] == DAY
    assert body["factions"][0]["id"] == "alba"


def test_promote_indexes_globals_factions_and_guilds(env: Path) -> None:
    _post()
    ingest.promote_day(MAP, DAY)

    day_row = store.get_day(MAP, DAY)
    assert day_row["global"]["faction_wealth"] == 1000.0
    # Never auto-summed with pouch/player-bank wealth.
    assert day_row["global"]["pouch_wealth"] == 50.0
    assert day_row["faction_count"] == 1

    factions = store.read_faction_days(MAP, DAY, DAY, full=True)
    assert len(factions) == 1
    assert factions[0]["rank"] == "Kingdom"
    assert factions[0]["rank_level"] == 3
    assert factions[0]["rank_up_at"] == 600.0
    assert factions[0]["wealth_breakdown"] == {"provinces": 800.0, "trade": 200.0}

    guilds = _guild_day_rows(MAP, DAY, DAY)
    assert [guild["guild_id"] for guild in guilds] == ["masons"]
    assert guilds[0]["credit_score"] == 0.8


def test_core_read_omits_the_json_columns(env: Path) -> None:
    _post()
    ingest.promote_day(MAP, DAY)

    core = store.read_faction_days(MAP, DAY, DAY)[0]
    assert "wealth_breakdown" not in core
    assert core["wealth"] == 1000.0


def test_repromote_replaces_rather_than_accumulates(env: Path) -> None:
    _post(captured_at=f"{DAY}T10:00:00Z")
    ingest.promote_day(MAP, DAY)

    _post(
        captured_at=f"{DAY}T11:00:00Z",
        factions=[faction_payload(id="beta", founded_at="2026-02-02T00:00:00Z")],
        guilds=[guild_payload(id="smiths")],
    )
    ingest.promote_day(MAP, DAY)

    factions = store.read_faction_days(MAP, DAY, DAY)
    assert [row["faction_id"] for row in factions] == ["beta"]
    guilds = _guild_day_rows(MAP, DAY, DAY)
    assert [row["guild_id"] for row in guilds] == ["smiths"]


def test_range_reads_are_ordered_and_inclusive(env: Path) -> None:
    for day in ("2026-08-30", "2026-08-31", "2026-09-01"):
        _post(captured_at=f"{day}T12:00:00Z")
        ingest.promote_day(MAP, day)

    days = store.list_days(MAP)
    assert [row["day"] for row in days] == ["2026-08-30", "2026-08-31", "2026-09-01"]

    globals_range = store.read_global_days(MAP, "2026-08-31", "2026-09-01")
    assert [row["day"] for row in globals_range] == ["2026-08-31", "2026-09-01"]

    faction_range = store.read_faction_days(MAP, "2026-08-30", "2026-09-01")
    assert [row["day"] for row in faction_range] == [
        "2026-08-30",
        "2026-08-31",
        "2026-09-01",
    ]
    assert store.latest_complete_day(MAP) == "2026-09-01"


def test_read_faction_days_filters_by_key(env: Path) -> None:
    _post(
        factions=[
            faction_payload(),
            faction_payload(id="beta", founded_at="2026-02-02T00:00:00Z"),
        ]
    )
    ingest.promote_day(MAP, DAY)

    keys = {row["faction_id"]: row["faction_key"] for row in store.list_registry(MAP)}
    only_beta = store.read_faction_days(MAP, DAY, DAY, [keys["beta"]])
    assert [row["faction_id"] for row in only_beta] == ["beta"]
    assert store.read_faction_days(MAP, DAY, DAY, []) == []


def test_reindex_day_rebuilds_from_the_daily_file(env: Path) -> None:
    _post()
    ingest.promote_day(MAP, DAY)
    store.delete_day(MAP, DAY)
    assert store.get_day(MAP, DAY) is None

    assert ingest.reindex_day(MAP, DAY) is not None
    assert store.get_day(MAP, DAY)["server_day"] == 41
    assert len(store.read_faction_days(MAP, DAY, DAY)) == 1


def test_unreadable_raw_snapshot_does_not_block_the_day(env: Path) -> None:
    _post(captured_at=f"{DAY}T10:00:00Z", complete=True, server_day=1)
    torn = Path(store.raw_day_dir(MAP, DAY)) / "235959Z-deadbeef.json.gz"
    torn.write_bytes(b"not gzip")

    promoted = ingest.promote_day(MAP, DAY)
    assert promoted["server_day"] == 1


def test_promote_of_an_empty_day_is_a_noop(env: Path) -> None:
    assert ingest.promote_day(MAP, DAY) is None
    assert store.get_day(MAP, DAY) is None


def test_a_degraded_day_is_not_rescanned_in_full_on_every_promote(env: Path) -> None:
    """Promote runs on every upload; a day with no complete snapshot must not
    re-gunzip all ~288 of its files each time."""
    ingest.clear_scan_cache()
    for minute in range(12):
        _post(captured_at=f"{DAY}T10:{minute:02d}:00Z", complete=False)

    reads: list[str] = []
    original = ingest._read_raw

    def counting_read(path: str):
        reads.append(path)
        return original(path)

    ingest._read_raw = counting_read
    try:
        first = ingest._canonical_snapshot(MAP, DAY)
        first_count = len(reads)
        reads.clear()
        second = ingest._canonical_snapshot(MAP, DAY)
        second_count = len(reads)
    finally:
        ingest._read_raw = original
        ingest.clear_scan_cache()

    assert first["complete"] is False
    # Same answer both times - the memo must not change what is promoted.
    assert second["captured_at"] == first["captured_at"]
    assert first_count == 12
    # Only the newest file, which is the fallback this call has to return.
    assert second_count == 1


def test_a_new_snapshot_still_wins_after_a_memoised_scan(env: Path) -> None:
    ingest.clear_scan_cache()
    _post(captured_at=f"{DAY}T10:00:00Z", complete=False, server_day=1)
    assert ingest._canonical_snapshot(MAP, DAY)["server_day"] == 1

    _post(captured_at=f"{DAY}T11:00:00Z", complete=False, server_day=2)
    assert ingest._canonical_snapshot(MAP, DAY)["server_day"] == 2

    # And a complete one arriving later still beats the memoised partials.
    _post(captured_at=f"{DAY}T11:30:00Z", complete=True, server_day=3)
    canonical = ingest._canonical_snapshot(MAP, DAY)
    assert canonical["complete"] is True
    assert canonical["server_day"] == 3
    ingest.clear_scan_cache()


def test_index_snapshot_uses_one_connection_for_all_five_writes(env: Path, monkeypatch) -> None:
    """Split across five transactions, a reader between them saw the new day
    row against the previous promotion's faction rows."""
    snapshot = _post(captured_at=f"{DAY}T10:00:00Z", complete=True)

    opened = 0
    original = database.connect

    def counting_connect(*args, **kwargs):
        nonlocal opened
        opened += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(database, "connect", counting_connect)
    ingest.index_snapshot(MAP, snapshot)

    assert opened == 1
