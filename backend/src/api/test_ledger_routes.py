"""API tests for the ledger read routes.

The app under test is assembled here from `ledger_router` alone rather than
imported from `server`. That keeps the tests scoped to the router's own
contract, and it also sidesteps `server.py`'s GZip middleware configuration,
which fails to construct against older Starlette builds — a pre-existing
environment mismatch that has nothing to do with these routes.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
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

from src.api.ledger_routes import (  # noqa: E402
    DEFAULT_FACTION_COUNT,
    MAX_FACTION_KEYS,
    MAX_FULL_FACTION_DAYS,
    MAX_RANGE_DAYS,
    ledger_router,
)
from src.api.http_headers import make_etag  # noqa: E402
from src.api.map_registry import clear_map_registry_cache  # noqa: E402
from src.scripts.ledger import ingest, store  # noqa: E402
from src.scripts.ledger.schema import faction_key, normalize_snapshot  # noqa: E402
from src import database  # noqa: E402

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
BRAN_KEY = faction_key("bran", "2026-01-02T00:00:00Z")


def _faction(**overrides) -> dict:
    faction = {
        "id": "alba",
        "founded_at": "2026-01-01T00:00:00Z",
        "name": "Alba",
        "rgb": "#ff0000",
        "overlord": None,
        "subjects": [],
        "wealth": 1000.0,
        "wealth_breakdown": {"provinces": 800.0, "trade": 200.0},
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


def _payload(day: str, *, complete: bool = True, factions=None, server_day: int = 41):
    return {
        "schema_version": 1,
        "map_id": "main",
        "captured_at": f"{day}T12:00:00Z",
        "server_day": server_day,
        "day_progress_seconds": 900,
        "complete": complete,
        "global": {
            "faction_count": len(factions or [_faction()]),
            "guild_count": 0,
            "claimed_provinces": 12,
            "population": 340,
            "active_wars": 0,
            "max_wealth_prestige": 900.0,
            "faction_wealth": 1000.0,
            "pouch_wealth": 50.0,
            "player_bank_wealth": 25.0,
            "liquid_wealth": 75.0,
            "guild_liquid_wealth": 10.0,
            "node_wealth": 5.0,
            "expansion_wealth": 2.0,
            "guild_income": 3.0,
        },
        "factions": [_faction()] if factions is None else factions,
        "guilds": [],
        "events": [],
    }


@pytest.fixture
def ledger_env(tmp_path, monkeypatch, postgres):
    registry = tmp_path / "maps.yml"
    registry.write_text(TEST_REGISTRY, encoding="utf-8")
    monkeypatch.setenv("MAP_REGISTRY_PATH", str(registry))
    clear_map_registry_cache()

    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))

    try:
        yield tmp_path
    finally:
        clear_map_registry_cache()


@pytest.fixture
def client(ledger_env):
    app = FastAPI()
    app.include_router(ledger_router)
    with TestClient(app) as test_client:
        yield test_client


def _store_day(map_id: str, day: str, **kwargs) -> dict:
    """Write one day's raw snapshot and promote it, exactly as the route does."""
    snapshot = normalize_snapshot(_payload(day, **kwargs), map_id)
    ingest.store_raw(map_id, snapshot)
    ingest.promote_day(map_id, day)
    return snapshot


# --- index -------------------------------------------------------------------


def test_index_without_days_is_empty_not_error(client):
    body = client.get("/main/ledger/index").json()
    assert body["days"] == []
    assert body["first"] is None
    assert body["last"] is None
    assert body["latest_complete_day"] is None
    assert body["incomplete_days"] == []
    assert body["server_day_first"] is None
    assert body["factions"] == []


def test_index_lists_days_and_registry(client):
    _store_day("main", "2026-01-01", server_day=41)
    _store_day("main", "2026-01-02", server_day=42)

    body = client.get("/main/ledger/index").json()
    assert body["days"] == ["2026-01-01", "2026-01-02"]
    assert body["first"] == "2026-01-01"
    assert body["last"] == "2026-01-02"
    assert body["latest_complete_day"] == "2026-01-02"
    assert body["server_day_first"] == 41
    assert body["server_day_last"] == 42

    (row,) = body["factions"]
    assert row["key"] == ALBA_KEY
    assert row["id"] == "alba"
    assert row["founded_at"] == "2026-01-01T00:00:00Z"
    assert row["name"] == "Alba"
    assert row["rgb"] == "#ff0000"
    assert row["first_seen_day"] == "2026-01-01"
    assert row["last_seen_day"] == "2026-01-02"
    assert row["deleted_day"] is None
    assert row["deleted_at"] is None


def test_index_reports_incomplete_days(client):
    _store_day("main", "2026-01-01", complete=False)
    _store_day("main", "2026-01-02")

    body = client.get("/main/ledger/index").json()
    assert body["incomplete_days"] == ["2026-01-01"]
    assert body["latest_complete_day"] == "2026-01-02"


def test_index_etag_answers_304(client):
    _store_day("main", "2026-01-01")
    first = client.get("/main/ledger/index")
    assert first.status_code == 200
    etag = first.headers["etag"]

    second = client.get("/main/ledger/index", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.content == b""


def test_staff_map_is_403_and_public_map_is_200(client):
    assert client.get("/dev/ledger/index").status_code == 403
    assert client.get("/main/ledger/index").status_code == 200


def test_unknown_map_is_404(client):
    assert client.get("/nosuchmap/ledger/index").status_code == 404


# --- series ------------------------------------------------------------------


def test_series_is_columnar_on_a_shared_day_axis(client):
    _store_day("main", "2026-01-01")
    _store_day("main", "2026-01-02")

    body = client.get("/main/ledger/series").json()
    assert body["days"] == ["2026-01-01", "2026-01-02"]
    assert body["server_day"] == [41, 41]
    assert body["captured_at"] == ["2026-01-01T12:00:00Z", "2026-01-02T12:00:00Z"]
    assert body["complete"] == [True, True]
    assert body["global"]["faction_wealth"] == [1000.0, 1000.0]
    # Never summed into a single "money supply" number by the server.
    assert body["global"]["pouch_wealth"] == [50.0, 50.0]
    assert body["global"]["player_bank_wealth"] == [25.0, 25.0]
    assert body["truncated"] is False

    (faction,) = body["factions"]
    assert faction["key"] == ALBA_KEY
    assert faction["name"] == "Alba"
    assert faction["series"]["wealth"] == [1000.0, 1000.0]
    assert faction["rank"] == ["Kingdom", "Kingdom"]
    assert faction["tier"] == ["king", "king"]


def test_series_carries_rank_thresholds_not_config(client):
    """`rank_up_at`/`rank_down_at` ship as per-day series, per the client type."""
    _store_day("main", "2026-01-01")

    (faction,) = client.get("/main/ledger/series").json()["factions"]
    assert faction["series"]["rank_up_at"] == [600.0]
    assert faction["series"]["rank_down_at"] == [400.0]


def test_series_projection_fields_stay_separate(client):
    _store_day("main", "2026-01-01")
    (faction,) = client.get("/main/ledger/series").json()["factions"]
    assert faction["series"]["net_income"] == [12.5]
    assert faction["series"]["inflation_delta"] == [-0.5]
    # No server-side stock delta anywhere in the response.
    assert "wealth_delta" not in faction["series"]


def test_absent_day_is_null_not_zero(client):
    _store_day("main", "2026-01-01", factions=[_faction()])
    _store_day(
        "main",
        "2026-01-02",
        factions=[_faction(id="bran", founded_at="2026-01-02T00:00:00Z", name="Bran")],
    )

    body = client.get(f"/main/ledger/series?factions={ALBA_KEY},{BRAN_KEY}").json()
    assert body["days"] == ["2026-01-01", "2026-01-02"]
    alba = next(f for f in body["factions"] if f["key"] == ALBA_KEY)
    bran = next(f for f in body["factions"] if f["key"] == BRAN_KEY)
    assert alba["series"]["wealth"] == [1000.0, None]
    assert bran["series"]["wealth"] == [None, 1000.0]
    assert alba["rank"] == ["Kingdom", None]


def test_core_omits_breakdowns_and_full_includes_them(client):
    _store_day("main", "2026-01-01")

    core = client.get("/main/ledger/series").json()["factions"][0]
    assert core["breakdowns"] == {"wealth": {}, "prestige": {}}

    full = client.get("/main/ledger/series?fields=full").json()["factions"][0]
    assert full["breakdowns"]["wealth"] == {"provinces": [800.0], "trade": [200.0]}
    assert full["breakdowns"]["prestige"] == {"wealth": [300.0]}


def test_breakdown_keys_union_across_the_range(client):
    _store_day("main", "2026-01-01", factions=[_faction(wealth_breakdown={"a": 1.0})])
    _store_day("main", "2026-01-02", factions=[_faction(wealth_breakdown={"b": 2.0})])

    (faction,) = client.get("/main/ledger/series?fields=full").json()["factions"]
    assert faction["breakdowns"]["wealth"] == {"a": [1.0, None], "b": [None, 2.0]}


def test_series_defaults_to_top_factions_by_wealth(client):
    factions = [
        _faction(
            id=f"f{n}",
            founded_at="2026-01-01T00:00:00Z",
            name=f"F{n}",
            wealth=float(n),
        )
        for n in range(DEFAULT_FACTION_COUNT + 5)
    ]
    _store_day("main", "2026-01-01", factions=factions)

    body = client.get("/main/ledger/series").json()
    assert len(body["factions"]) == DEFAULT_FACTION_COUNT
    wealths = [f["series"]["wealth"][0] for f in body["factions"]]
    assert wealths == sorted(wealths, reverse=True)
    assert body["truncated"] is True


def test_deleted_factions_do_not_make_every_default_request_truncated(client):
    """`truncated` counts factions with rows in range, not registry rows.

    The registry is cumulative and keeps every faction the map ever held, so
    comparing the default selection against it reported `truncated: true` on
    nearly every mature map's default request.
    """
    survivors = [
        _faction(id=f"f{n}", founded_at="2026-01-01T00:00:00Z", name=f"F{n}")
        for n in range(3)
    ]
    _store_day("main", "2026-01-01", factions=[*survivors, _faction()])
    # `alba` disbands: it stays in the registry forever, deleted.
    _store_day("main", "2026-01-02", factions=survivors)

    registry = client.get("/main/ledger/index").json()["factions"]
    assert len(registry) == 4
    assert any(row["deleted_day"] == "2026-01-02" for row in registry)

    body = client.get("/main/ledger/series?start=2026-01-02&end=2026-01-02").json()
    assert len(body["factions"]) == 3
    assert body["truncated"] is False


def test_more_factions_in_range_than_the_default_is_still_truncated(client):
    factions = [
        _faction(id=f"f{n}", founded_at="2026-01-01T00:00:00Z", name=f"F{n}")
        for n in range(DEFAULT_FACTION_COUNT + 2)
    ]
    _store_day("main", "2026-01-01", factions=factions)
    assert client.get("/main/ledger/series").json()["truncated"] is True


def test_too_many_faction_keys_is_400(client):
    _store_day("main", "2026-01-01")
    keys = ",".join(str(n) for n in range(MAX_FACTION_KEYS + 1))
    res = client.get(f"/main/ledger/series?factions={keys}")
    assert res.status_code == 400
    assert str(MAX_FACTION_KEYS) in res.json()["detail"]


def test_explicit_range_over_the_cap_is_400(client):
    _store_day("main", "2026-01-01")
    res = client.get("/main/ledger/series?start=2020-01-01&end=2026-01-01")
    assert res.status_code == 400
    assert str(MAX_RANGE_DAYS) in res.json()["detail"]


@pytest.mark.parametrize("day", ["nope", "2026-13-01", "2026-1-1", "../../etc"])
def test_invalid_range_day_is_400(client, day):
    assert client.get(f"/main/ledger/series?start={day}").status_code == 400


def test_reversed_range_is_400(client):
    res = client.get("/main/ledger/series?start=2026-02-01&end=2026-01-01")
    assert res.status_code == 400


def test_series_range_filters_days(client):
    _store_day("main", "2026-01-01")
    _store_day("main", "2026-01-02")
    _store_day("main", "2026-01-03")

    body = client.get("/main/ledger/series?start=2026-01-02&end=2026-01-02").json()
    assert body["days"] == ["2026-01-02"]
    assert body["factions"][0]["series"]["wealth"] == [1000.0]


def test_series_etag_answers_304(client):
    _store_day("main", "2026-01-01")
    first = client.get("/main/ledger/series")
    second = client.get(
        "/main/ledger/series", headers={"If-None-Match": first.headers["etag"]}
    )
    assert second.status_code == 304


def test_series_on_empty_map_is_empty_arrays(client):
    body = client.get("/main/ledger/series").json()
    assert body["days"] == []
    assert body["factions"] == []
    assert body["global"]["faction_wealth"] == []
    assert body["truncated"] is False


# --- faction detail ----------------------------------------------------------


def test_faction_detail_is_full_plus_relations(client):
    _store_day(
        "main",
        "2026-01-01",
        factions=[_faction(overlord="bran", subjects=["cair"], wars=[{"vs": "bran"}])],
    )

    body = client.get(f"/main/ledger/faction/{ALBA_KEY}").json()
    assert body["key"] == ALBA_KEY
    assert body["days"] == ["2026-01-01"]
    assert body["complete"] == [True]
    assert body["breakdowns"]["wealth"] == {"provinces": [800.0], "trade": [200.0]}
    assert body["overlord"] == ["bran"]
    assert body["subjects"] == [["cair"]]
    assert body["wars"] == [[{"vs": "bran"}]]


def test_unknown_faction_key_is_404(client):
    _store_day("main", "2026-01-01")
    assert client.get("/main/ledger/faction/deadbeef").status_code == 404


def test_unknown_key_probe_does_not_read_outside_the_resolved_range(client):
    """The probe used to range-read `all_days[0]..all_days[-1]`, which is
    unbounded by MAX_RANGE_DAYS on a route that otherwise enforces it."""
    _store_day("main", "2026-01-01")

    reads: list[tuple] = []
    original = store.read_faction_days

    def recording(map_id, start, end, *args, **kwargs):
        reads.append((start, end))
        return original(map_id, start, end, *args, **kwargs)

    store.read_faction_days = recording
    try:
        assert client.get("/main/ledger/faction/deadbeef").status_code == 404
        # A known key still resolves, and only over the requested window.
        res = client.get(
            f"/main/ledger/faction/{ALBA_KEY}?start=2026-01-01&end=2026-01-01"
        )
        assert res.status_code == 200
    finally:
        store.read_faction_days = original

    assert all(start >= "2026-01-01" and end <= "2026-01-01" for start, end in reads)


# --- day ---------------------------------------------------------------------


def test_day_route_streams_the_stored_gzip(client):
    _store_day("main", "2026-01-01")

    res = client.get("/main/ledger/day/2026-01-01")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/gzip"
    stored = json.loads(gzip.decompress(res.content))
    assert stored["day"] == "2026-01-01"
    assert stored["map_id"] == "main"


def test_missing_day_is_404(client):
    assert client.get("/main/ledger/day/2026-01-01").status_code == 404


@pytest.mark.parametrize("day", ["nope", "2026-13-01", "2026-1-1"])
def test_bad_day_is_400(client, day):
    assert client.get(f"/main/ledger/day/{day}").status_code == 400


def test_day_route_is_gated_on_the_staff_map(client):
    assert client.get("/dev/ledger/day/2026-01-01").status_code == 403


def test_breakdown_columns_cap_keys_from_an_already_stored_row():
    """A row already in the DB must not detonate a read (finding 3, read half).

    `_breakdown_columns` unions the keys across the whole range and allocates a
    full-length array per key, so an over-wide breakdown that got in by any
    means turns one authenticated `fields=full` request into an unbounded
    allocation. The ingest cap and this cap are separately reachable.
    """
    from src.api.ledger_routes import _breakdown_columns
    from src.scripts.ledger.schema import (
        MAX_BREAKDOWN_KEYS,
        MAX_BREAKDOWN_KEY_CHARS,
    )

    wide = {f"k{i}": float(i) for i in range(MAX_BREAKDOWN_KEYS * 10)}
    wide["x" * (MAX_BREAKDOWN_KEY_CHARS + 1)] = 1.0
    rows = [{"day": "2026-01-01", "wealth_breakdown": wide, "prestige_breakdown": {}}]

    out = _breakdown_columns(rows, {"2026-01-01": 0}, 1)

    assert len(out["wealth"]) <= MAX_BREAKDOWN_KEYS
    assert all(len(key) <= MAX_BREAKDOWN_KEY_CHARS for key in out["wealth"])


def test_a_faction_row_outside_the_day_axis_is_skipped_not_a_500():
    """The day axis and the faction rows are two queries (finding 8).

    A faction row can name a day the axis does not carry - a promotion
    committing between the two reads, or a day row deleted under them - and
    `index[row["day"]]` made that a KeyError, i.e. a 500 on a public route.
    """
    from src.api.ledger_routes import _faction_block

    rows = [
        {"day": "2026-01-01", "faction_key": ALBA_KEY, "wealth": 1.0, "name": "Alba"},
        {"day": "2026-01-09", "faction_key": ALBA_KEY, "wealth": 2.0, "name": "Alba"},
    ]

    block = _faction_block(rows, {"2026-01-01": 0}, 1, full=True)

    assert block["series"]["wealth"] == [1.0]


def test_a_breakdown_row_outside_the_day_axis_is_skipped_not_a_500():
    from src.api.ledger_routes import _breakdown_columns

    rows = [
        {"day": "2026-01-01", "wealth_breakdown": {"provinces": 1.0}, "prestige_breakdown": {}},
        {"day": "2026-01-09", "wealth_breakdown": {"provinces": 2.0}, "prestige_breakdown": {}},
    ]

    out = _breakdown_columns(rows, {"2026-01-01": 0}, 1)

    assert out["wealth"]["provinces"] == [1.0]


def test_faction_detail_survives_a_row_outside_the_day_axis(client, monkeypatch):
    """Same skip on `/ledger/faction/{key}`, which builds its own axis."""
    _store_day("main", "2026-01-01")
    real_read = store.read_faction_days

    def _with_a_stray_day(*args, **kwargs):
        rows = real_read(*args, **kwargs)
        if rows:
            stray = dict(rows[0])
            stray["day"] = "2099-01-01"
            rows = rows + [stray]
        return rows

    monkeypatch.setattr(store, "read_faction_days", _with_a_stray_day)

    res = client.get(f"/main/ledger/faction/{ALBA_KEY}")

    assert res.status_code == 200
    assert res.json()["days"] == ["2026-01-01"]


# --- fields=full allocation cap ----------------------------------------------


def test_the_cap_cannot_refuse_a_request_the_axis_caps_accept(client):
    """The cap is a backstop, not a policy the viewer can trip over.

    `_parse_faction_keys` bounds the key list at MAX_FACTION_KEYS and
    `_resolve_range` bounds the axis at MAX_RANGE_DAYS, so their product is the
    largest response the route can ever build. The viewer asks for
    `fields=full` over the whole history with every selected faction
    (useLedgerSeries.ts), and a smaller cap 400s that request on any map with a
    few hundred days of history.
    """
    assert MAX_FULL_FACTION_DAYS == MAX_FACTION_KEYS * MAX_RANGE_DAYS
    assert DEFAULT_FACTION_COUNT * MAX_RANGE_DAYS <= MAX_FULL_FACTION_DAYS


def test_the_cap_counts_the_resolved_axis_not_the_requested_span(client):
    """A one-day map must answer a six-year request, not refuse it.

    The days a map actually holds are what gets allocated; the requested span
    is just a filter. Counting the span refused a response the size of one row.
    """
    _store_day("main", "2026-01-01")
    keys = ",".join(f"k{n}" for n in range(MAX_FACTION_KEYS))
    res = client.get(
        f"/main/ledger/series?start=2025-01-02&end=2026-01-01&factions={keys}&fields=full"
    )
    assert res.status_code == 200
    assert res.json()["days"] == ["2026-01-01"]


def test_a_full_read_past_the_cap_is_400(client, monkeypatch):
    """Boundary check. Two real days x one key is 2 faction-days.

    The constant is monkeypatched rather than storing 29200 faction-days: the
    branch under test is the comparison, and building 730 days x 40 factions of
    real snapshots would cost minutes per run.
    """
    monkeypatch.setattr("src.api.ledger_routes.MAX_FULL_FACTION_DAYS", 1)
    _store_day("main", "2026-01-01")
    _store_day("main", "2026-01-02")

    res = client.get(f"/main/ledger/series?factions={ALBA_KEY}&fields=full")

    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "2 faction-days" in detail
    assert "cap is 1" in detail


def test_the_same_read_is_fine_with_fields_core(client, monkeypatch):
    """`core` has no breakdown arrays, so the per-axis caps already bound it."""
    monkeypatch.setattr("src.api.ledger_routes.MAX_FULL_FACTION_DAYS", 1)
    _store_day("main", "2026-01-01")
    _store_day("main", "2026-01-02")

    res = client.get(f"/main/ledger/series?factions={ALBA_KEY}&fields=core")

    assert res.status_code == 200


def test_the_default_faction_selection_is_never_refused(client):
    """A bare `?fields=full` - what the viewer sends - must always be served."""
    _store_day("main", "2026-01-01")
    _store_day("main", "2026-01-02")

    res = client.get("/main/ledger/series?fields=full")

    assert res.status_code == 200
    assert res.json()["days"] == ["2026-01-01", "2026-01-02"]


# --- series ETag -------------------------------------------------------------


def test_series_etag_is_not_a_hash_of_the_body(client):
    """Derived from the day/registry rows, so the body is encoded once.

    Hashing the encoded body means the structure, the JSON string and its UTF-8
    copy are all alive at once - the peak this route's cap exists to bound.
    """
    _store_day("main", "2026-01-01")
    res = client.get("/main/ledger/series?fields=full")

    assert res.status_code == 200
    assert res.headers["etag"] != make_etag(res.text)


def test_re_promoting_a_day_changes_the_series_etag(client):
    """A cheap tag is only correct if it moves whenever the rows move."""
    _store_day("main", "2026-01-01")
    first = client.get("/main/ledger/series?fields=full")
    assert first.status_code == 200

    # A later snapshot for the same day, with different numbers: promotion
    # re-picks the canonical snapshot, so every row for the day changes.
    payload = _payload("2026-01-01", factions=[_faction(wealth=4242.0)])
    payload["captured_at"] = "2026-01-01T18:00:00Z"
    ingest.store_raw("main", normalize_snapshot(payload, "main"))
    ingest.promote_day("main", "2026-01-01")

    second = client.get("/main/ledger/series?fields=full")
    assert second.status_code == 200
    assert second.json()["factions"][0]["series"]["wealth"] == [4242.0]
    assert second.headers["etag"] != first.headers["etag"]

    # And the new tag still revalidates.
    third = client.get(
        "/main/ledger/series?fields=full",
        headers={"If-None-Match": second.headers["etag"]},
    )
    assert third.status_code == 304


def test_a_renamed_faction_changes_the_series_etag(client):
    """The registry supplies labels for factions with no rows in range."""
    _store_day("main", "2026-01-01")
    first = client.get(f"/main/ledger/series?fields=full&factions={ALBA_KEY}")

    _store_day("main", "2026-01-02", factions=[_faction(name="Alba Reborn")])
    second = client.get(
        f"/main/ledger/series?fields=full&factions={ALBA_KEY}"
        "&start=2026-01-01&end=2026-01-01"
    )

    assert second.headers["etag"] != first.headers["etag"]


def test_a_full_read_inside_the_cap_still_works(client):
    _store_day("main", "2026-01-01")
    res = client.get(
        f"/main/ledger/series?start=2026-01-01&end=2026-01-01"
        f"&factions={ALBA_KEY}&fields=full"
    )
    assert res.status_code == 200
    assert res.json()["factions"][0]["breakdowns"]["wealth"]["provinces"] == [800.0]


# --- one connection per request ----------------------------------------------


def test_series_opens_one_connection_per_request(client, monkeypatch):
    """Seven connections per request, for one response."""
    _store_day("main", "2026-01-01")
    _store_day("main", "2026-01-02")

    pool = database.get_pool()
    real_borrow = pool.connection
    borrows = 0

    def _counting_borrow(*args, **kwargs):
        nonlocal borrows
        borrows += 1
        return real_borrow(*args, **kwargs)

    monkeypatch.setattr(pool, "connection", _counting_borrow)

    res = client.get("/main/ledger/series?fields=full")

    assert res.status_code == 200
    assert borrows == 1


def test_store_reads_still_open_their_own_connection_by_default(client):
    """The `conn` parameter is optional; every other caller is unchanged."""
    _store_day("main", "2026-01-01")
    assert [row["day"] for row in store.list_days("main")] == ["2026-01-01"]
    assert store.latest_complete_day("main") == "2026-01-01"
    assert len(store.list_registry("main")) == 1
    assert len(store.read_global_days("main", "2026-01-01", "2026-01-01")) == 1
    assert len(store.read_faction_days("main", "2026-01-01", "2026-01-01")) == 1
    assert store.count_factions_in_range("main", "2026-01-01", "2026-01-01") == 1


def test_breakdown_columns_still_carry_a_normal_breakdown(client):
    _store_day("main", "2026-01-01")
    body = client.get("/main/ledger/series?fields=full").json()
    breakdowns = body["factions"][0]["breakdowns"]
    assert breakdowns["wealth"]["provinces"] == [800.0]
    assert breakdowns["wealth"]["trade"] == [200.0]
