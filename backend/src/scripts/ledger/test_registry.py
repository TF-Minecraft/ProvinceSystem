"""Faction registry: (id, founded_at) identity and complete-gated deletion."""

from __future__ import annotations

from pathlib import Path

from src.scripts.ledger import ingest, store, wipe
from src.scripts.ledger.schema import faction_key, normalize_snapshot

from .conftest import MAP, _guild_day_rows, faction_payload, snapshot_payload

ALBA_FOUNDED = "2026-01-01T00:00:00Z"


def _promote(day: str, *, complete: bool = True, factions=None, hour: str = "12") -> None:
    snapshot = normalize_snapshot(
        snapshot_payload(
            captured_at=f"{day}T{hour}:00:00Z",
            complete=complete,
            factions=factions if factions is not None else [faction_payload()],
        ),
        MAP,
    )
    ingest.store_raw(MAP, snapshot)
    ingest.promote_day(MAP, day)


def _by_key(map_id: str) -> dict[str, dict]:
    return {row["faction_key"]: row for row in store.list_registry(map_id)}


def test_first_seen_is_written_once_and_last_seen_follows(env: Path) -> None:
    _promote("2026-08-30")
    _promote("2026-08-31", factions=[faction_payload(name="Alba Renewed", rgb="#00ff00")])

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["first_seen_day"] == "2026-08-30"
    assert row["first_seen_at"] == "2026-08-30T12:00:00Z"
    assert row["last_seen_day"] == "2026-08-31"
    # Display fields always take the newest value.
    assert row["last_name"] == "Alba Renewed"
    assert row["last_rgb"] == "#00ff00"


def test_backfilling_an_earlier_day_moves_first_seen_back_only(env: Path) -> None:
    _promote("2026-08-31")
    _promote("2026-08-30")

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["first_seen_day"] == "2026-08-30"
    assert row["last_seen_day"] == "2026-08-31"
    assert row["last_seen_at"] == "2026-08-31T12:00:00Z"


def test_reused_id_with_a_new_founded_at_is_a_second_row(env: Path) -> None:
    _promote(
        "2026-08-30",
        factions=[
            faction_payload(),
            faction_payload(founded_at="2026-05-05T00:00:00Z", name="Alba II"),
        ],
    )

    rows = store.list_registry(MAP)
    assert len(rows) == 2
    assert {row["faction_id"] for row in rows} == {"alba"}
    assert {row["founded_at"] for row in rows} == {ALBA_FOUNDED, "2026-05-05T00:00:00Z"}


def test_absence_in_an_incomplete_snapshot_is_not_deletion(env: Path) -> None:
    _promote("2026-08-30")
    _promote("2026-08-31", complete=False, factions=[])

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["deleted_day"] is None
    assert row["deleted_at"] is None


def test_absence_in_a_complete_snapshot_is_deletion(env: Path) -> None:
    _promote("2026-08-30")
    _promote("2026-08-31", complete=True, factions=[])

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["deleted_day"] == "2026-08-31"
    assert row["deleted_at"] == "2026-08-31T12:00:00Z"


def test_reappearance_clears_the_deletion(env: Path) -> None:
    _promote("2026-08-30")
    _promote("2026-08-31", complete=True, factions=[])
    _promote("2026-09-01")

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["deleted_day"] is None
    assert row["last_seen_day"] == "2026-09-01"


def test_backfilling_a_complete_day_does_not_bury_a_live_faction(env: Path) -> None:
    """An old complete day that predates the faction must not delete it."""
    _promote("2026-09-01")
    _promote("2026-08-30", complete=True, factions=[])

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["deleted_day"] is None


def test_promoting_the_same_day_twice_does_not_double_the_registry(env: Path) -> None:
    _promote("2026-08-30", hour="10")
    _promote("2026-08-30", hour="11")

    assert len(store.list_registry(MAP)) == 1


def test_wipe_clears_every_ledger_table(env: Path) -> None:
    _promote("2026-08-30")
    assert wipe.wipe_map(MAP) == 0

    assert store.list_registry(MAP) == []
    assert store.list_days(MAP) == []
    assert store.read_faction_days(MAP, "2026-08-30", "2026-08-30") == []
    assert _guild_day_rows(MAP, "2026-08-30", "2026-08-30") == []
    # The bytes are set aside, never deleted.
    assert Path(store.ledger_root(MAP)).exists() is False
    backups = list(Path(store.ledger_root(MAP)).parent.glob("ledger.bak.*"))
    assert len(backups) == 1
    assert (backups[0] / "daily" / "2026-08-30.json.gz").exists()


def test_deletion_survives_more_than_999_present_factions(env: Path) -> None:
    """The present keys go in as one array parameter, whatever their number.

    SQLite once refused an inlined `NOT IN (?, …)` past 999 variables, and the
    day never indexed on exactly the busy servers the 2000 cap was sized for.
    """
    _crowded_deletion()


def _crowded_deletion() -> None:
    crowd = [
        faction_payload(id=f"nation{index:04d}", name=f"Nation {index}")
        for index in range(1200)
    ]
    _promote("2026-08-30", factions=[*crowd, faction_payload()])
    assert len(store.list_registry(MAP)) == 1201

    # The same crowd minus one faction: only that one may be marked deleted.
    _promote("2026-08-31", factions=crowd)

    rows = _by_key(MAP)
    assert rows[faction_key("alba", ALBA_FOUNDED)]["deleted_day"] == "2026-08-31"
    still_alive = [row for row in rows.values() if row["deleted_day"] is None]
    assert len(still_alive) == 1200


def test_a_complete_day_whose_faction_count_disagrees_deletes_nothing(env: Path) -> None:
    """A truncated array is indistinguishable from a wipe without this guard."""
    _promote("2026-08-30")
    # `global` passed explicitly, so conftest leaves its count alone: the
    # payload claims two factions and carries none.
    payload = snapshot_payload(
        captured_at="2026-08-31T12:00:00Z",
        complete=True,
        factions=[],
        **{"global": {"faction_count": 2, "faction_wealth": 1000.0}},
    )
    snapshot = normalize_snapshot(payload, MAP)
    assert snapshot["deletion_safe"] is False
    ingest.store_raw(MAP, snapshot)
    ingest.promote_day(MAP, "2026-08-31")

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["deleted_day"] is None
    # The day still indexed — refusing the deletion is not refusing the day.
    assert "2026-08-31" in [entry["day"] for entry in store.list_days(MAP)]


def test_a_genuinely_empty_server_still_deletes(env: Path) -> None:
    """The other direction: `factions: []` that the globals agree with."""
    _promote("2026-08-30")
    _promote("2026-08-31", complete=True, factions=[])

    row = _by_key(MAP)[faction_key("alba", ALBA_FOUNDED)]
    assert row["deleted_day"] == "2026-08-31"
