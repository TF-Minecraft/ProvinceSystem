"""Times a ledger day promotion and `/ledger/series` on Postgres at the factions cap.

    DATABASE_URL=postgresql://… python benchmarks/ledger_promotion.py [--days 90] [--factions 2000]

Point it at a scratch database: it migrates it and writes ledger rows for the
map `bench`. Every day carries `--factions` factions (the cap is 2,000) and 200
guilds. The first `--promote` days go through `ingest.promote_day` (raw file
read, daily file write, index), the rest through `ingest.index_snapshot` only,
to build history quickly. Then it times `/ledger/series` the way the viewer
asks for it: the default (top 12 by wealth, core), 40 chosen factions with
`fields=full`, and the index.
"""
from __future__ import annotations

import argparse
import os
import random
import statistics
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(BACKEND), str(BACKEND / "src")]
os.environ.setdefault("SKINS_DEV", "1")

MAP = "bench"


def _faction(index: int, day: int, rng: random.Random) -> dict:
    wealth = 1000.0 + index * 10 + day + rng.random()
    return {
        "id": f"nation{index:04d}", "founded_at": f"2026-01-01T00:00:{index % 60:02d}.{index:06d}Z",
        "name": f"Nation {index}", "rgb": "#%06x" % (index * 2654435761 % 0xFFFFFF),
        "overlord": f"nation{index - 1:04d}" if index % 7 == 0 and index else None,
        "subjects": [f"nation{index + 1:04d}"] if index % 7 == 6 else [],
        "wealth": wealth, "bank": wealth * 0.1, "vassal_wealth": 0.0, "net_income": rng.uniform(-50, 50),
        "inflation_delta": rng.uniform(-1, 1), "trade_power": rng.uniform(0, 20), "prestige": wealth / 2,
        "wealth_breakdown": {"Bank": wealth * 0.1, "Nodes": wealth * 0.5, f"guild{index:04d}": wealth * 0.4},
        "prestige_breakdown": {"wealth": wealth / 4, "war": wealth / 4},
        "rank": "Kingdom", "rank_level": 3, "rank_up_at": 600.0, "rank_down_at": 400.0,
        "prestige_position": index + 1, "wealth_position": index + 1, "provinces": 12, "realm_size": 12,
        "tier": "king", "tier_index": 4, "highest_title": f"King of {index}", "members": 5,
        "members_with_vassals": 5, "settlements": 3, "population": 340, "installations": 2, "forts": 1,
        "wars": [{"enemy": f"nation{(index + 3) % 2000:04d}", "since": "2026-01-01"}] if index % 11 == 0 else [],
    }


def _payload(day: date, factions: int, rng: random.Random) -> dict:
    fs = [_faction(i, day.toordinal() % 1000, rng) for i in range(factions)]
    guilds = [
        {"id": f"guild{i:04d}", "faction_id": f"nation{i:04d}", "name": f"Guild {i}", "type": "CRAFT",
         "wealth": 40.0, "bank": 10.0, "expansions": 2, "trade_power": 1.5, "credit_score": 0.8, "size": 6}
        for i in range(200)
    ]
    return {
        "schema_version": 1, "map_id": MAP, "captured_at": f"{day.isoformat()}T12:00:00.123456789Z",
        "server_day": day.toordinal() % 1000, "day_progress_seconds": 900, "complete": True,
        "global": {"faction_count": factions, "guild_count": len(guilds), "claimed_provinces": 12000,
                   "population": 340000, "active_wars": 3, "max_wealth_prestige": 900.0,
                   "faction_wealth": 1e7, "pouch_wealth": 5e5, "player_bank_wealth": 2e5, "liquid_wealth": 7e5,
                   "guild_liquid_wealth": 1e4, "node_wealth": 5e3, "expansion_wealth": 2e3, "guild_income": 3.0},
        "factions": fs, "guilds": guilds, "events": [],
    }


def _timed(work, repeat: int) -> list[float]:
    times = []
    for _ in range(repeat):
        start = time.perf_counter()
        work()
        times.append((time.perf_counter() - start) * 1000)
    return times


def _report(label: str, times: list[float]) -> None:
    print(f"{label:<44} median {statistics.median(times):8.1f} ms   max {max(times):8.1f} ms   (n={len(times)})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--factions", type=int, default=2000)
    parser.add_argument("--promote", type=int, default=5, help="days timed through promote_day")
    parser.add_argument("--repeat", type=int, default=7)
    args = parser.parse_args()

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.api import map_registry
    from src.database.migrate import migrate
    from src.scripts.ledger import ingest, store
    from src.scripts.ledger.schema import normalize_snapshot

    tmp = Path(tempfile.mkdtemp(prefix="ledger-bench-"))
    (tmp / "maps.yml").write_text(
        f"maps:\n  - id: {MAP}\n    public: true\n    display_name: Bench\n    realm_id: {MAP}\n", encoding="utf-8"
    )
    os.environ["MAP_REGISTRY_PATH"] = str(tmp / "maps.yml")
    map_registry.clear_map_registry_cache()
    store.OUTPUT_DIR = str(tmp / "output")
    migrate()

    rng = random.Random(7)
    first = date.today() - timedelta(days=args.days)
    promote, index = [], []
    for offset in range(args.days):
        day = first + timedelta(days=offset)
        start = time.perf_counter()
        snapshot = normalize_snapshot(_payload(day, args.factions, rng), MAP)
        normalised = (time.perf_counter() - start) * 1000
        if offset < args.promote:
            ingest.store_raw(MAP, snapshot)
            promote += _timed(lambda: ingest.promote_day(MAP, snapshot["day"]), 1)
        else:
            index += _timed(lambda: ingest.index_snapshot(MAP, snapshot), 1)
    print(f"{args.days} days x {args.factions} factions + 200 guilds; normalise one payload: {normalised:.0f} ms")
    _report("promote_day (raw read, daily write, index)", promote)
    if index:
        _report("index_snapshot (index only)", index)
    _report("re-promote one day (replace rows)", _timed(lambda: ingest.promote_day(MAP, first.isoformat()), 3))

    app = FastAPI()
    from src.api.ledger_routes import ledger_router

    app.include_router(ledger_router)
    keys = [row["faction_key"] for row in store.list_registry(MAP)][:40]
    with TestClient(app) as client:
        def get(url: str):
            response = client.get(url)
            assert response.status_code == 200, response.text
            return response

        for label, url in (
            ("/ledger/series (default: top 12, core)", f"/{MAP}/ledger/series"),
            ("/ledger/series (40 factions, full)", f"/{MAP}/ledger/series?fields=full&factions={','.join(keys)}"),
            ("/ledger/index", f"/{MAP}/ledger/index"),
        ):
            get(url)
            _report(label, _timed(lambda: get(url), args.repeat))
    return 0


if __name__ == "__main__":
    sys.exit(main())
