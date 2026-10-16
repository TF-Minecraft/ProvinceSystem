"""Shared fixture for the ledger tests. Filesystem and DB are fully isolated."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from src import database  # noqa: E402
from src.scripts.ledger import store  # noqa: E402

MAP = "testmap"


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, postgres) -> Path:
    """Redirect output/ into tmp_path; the index is the emptied test Postgres."""
    # store binds OUTPUT_DIR by value at import time.
    monkeypatch.setattr(store, "OUTPUT_DIR", str(tmp_path / "output"))
    return tmp_path


def snapshot_payload(**overrides) -> dict:
    """A minimal but complete SF-shaped payload, in the Java's field types."""
    payload = {
        "schema_version": 1,
        "map_id": MAP,
        "captured_at": "2026-09-01T12:00:00Z",
        "server_day": 41,
        "day_progress_seconds": 900,
        "complete": True,
        "global": {
            "faction_count": 1,
            "guild_count": 1,
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
        "factions": [faction_payload()],
        "guilds": [guild_payload()],
        "events": [],
    }
    payload.update(overrides)
    # Keep `global.faction_count` honest with the array unless a test overrode
    # `global` on purpose: ingest cross-checks the two and refuses deletions
    # when they disagree, so a stale count would silently disarm every
    # deletion test below.
    if "global" not in overrides and isinstance(payload.get("global"), dict):
        payload["global"]["faction_count"] = len(payload.get("factions") or [])
        payload["global"]["guild_count"] = len(payload.get("guilds") or [])
    return payload


def faction_payload(**overrides) -> dict:
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
        "prestige_breakdown": {"wealth": 300.0, "war": 200.0},
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


def _guild_day_rows(map_id: str, start: str, end: str) -> list[dict]:
    """Guild rows across an inclusive day range, ordered by (guild, day).

    `store.read_guild_days` was removed as dead production code (no route
    ever called it — see finding 7 of the storage-mechanics review); tests
    that still want to assert on promoted guild rows read them directly here
    instead of resurrecting an unused public function.
    """
    columns = ("day", *store.GUILD_DAY_COLUMNS)
    with database.connect() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(store._quote(c) for c in columns)} "
            "FROM map_ledger_guild_days WHERE map_id = %s AND day >= %s AND day <= %s "
            "ORDER BY guild_id ASC, day ASC",
            (map_id, start, end),
        ).fetchall()
    return [{column: row[column] for column in columns} for row in rows]


def guild_payload(**overrides) -> dict:
    guild = {
        "id": "masons",
        "faction_id": "alba",
        "name": "Masons",
        "type": "CRAFT",
        "wealth": 40.0,
        "bank": 10.0,
        "expansions": 2,
        "trade_power": 1.5,
        "credit_score": 0.8,
        "size": 6,
    }
    guild.update(overrides)
    return guild
