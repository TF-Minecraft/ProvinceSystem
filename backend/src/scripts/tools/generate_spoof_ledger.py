"""Generate a spoof season of ledger (economy) snapshots and ingest them.

Builds a synthetic SimpleFactions "chronicle" upload season — the economy
snapshot mode described in `docs/map/ledger.md` — and feeds every snapshot
through the real ingest path (`ledger.schema.normalize_snapshot` +
`ledger.ingest.store_raw` + `ledger.ingest.promote_day`) so the raw/daily
storage layout, canonical-daily promotion, faction registry, and Postgres index
are all genuinely exercised, the same way a real 300s-interval upload season
would build them up. Nothing is hand-written into the database.

The season is deliberately not "clean" test data: it scripts the handful of
behaviours that are easy to get subtly wrong and hard to eyeball from a
production dump —

* wealth is a multi-component stock (bank / mining nodes / guild expansions /
  trade ventures) that drifts and occasionally shocks, not one line scaled up
* one faction's prestige visibly falls purely because rivals got richer while
  its own wealth sits flat (`wealthShare`, per the ledger doc's second trap)
* `rank_up_at` / `rank_down_at` move over the season and get crossed in both
  directions
* `net_income` / `inflation_delta` / `guild_income` are scripted as
  independent full-day projections that disagree with the observed
  day-over-day stock change (the ledger doc's third trap)
* one faction is deleted mid-season (`complete: true`, absent afterwards) and
  its id is later reused by a new faction with a different `founded_at`, so
  `(id, founded_at)` identity has two distinct rows to keep apart
* one full UTC day has no snapshots at all (a gap) and one has every snapshot
  `complete: false` (a degraded day), to exercise the null-gap and
  fallback-canonical paths

By default snapshots are ingested directly (no server needed). `--post` sends
them over HTTP to `POST http://127.0.0.1:8000/{map}/data/upload/chronicle`
instead, to exercise the route end to end against a running dev server.

Faction identity: by default (`--ids-from-map`, which is implied unless
`--synthetic-ids` is given) the faction ids/names/colours are the *real*
nation ids captured in the target map's own chronicle history — the union
of every nation id appearing in that map's `chronicle/{day}/nation.json.gz`
across the season window, read via `chronicle.store`. This is what lets the
timelapse studio's ledger chart panel resolve a focused nation
(`useLedgerSeries.resolveFactionKey`, which matches on the map's nation id)
against seeded ledger data: matching against invented `faction_0..faction_N`
ids never resolves, because those ids never appear in any `nation.json`.
`--factions N` then means "use up to N of the real nations that were
actually captured"; if the map has fewer than that in the window, all of
them are used and a warning is printed. If the map has none captured at
all, the run fails with a message pointing at `--synthetic-ids`, which
restores the old invented-id behaviour (`faction_0..faction_N` with
generated names/colours) for maps with no chronicle history yet (e.g. a
fresh `dev` map).
"""

from __future__ import annotations

import argparse
import gzip
import json
import random
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from ...api.map_registry import get_map_entry
from ..chronicle.store import list_days as chronicle_list_days
from ..chronicle.store import resolve_stored_file as chronicle_resolve_stored_file
from ..ledger import ingest as ledger_ingest
from ..ledger.schema import LedgerPayloadError, normalize_snapshot
from ..ledger.store import is_valid_day, list_days as ledger_list_days, today_utc
from ..util.dirs import validate_map

DEFAULT_MAP = "dev"
DEFAULT_SEED = 1337
UPLOAD_URL_FMT = "http://127.0.0.1:8000/{map}/data/upload/chronicle"

# Fallback calendar anchor used only when the caller doesn't pin an
# `--end-day` (and `--end-day` itself isn't supplied, so `main()` falls back
# to today's UTC date instead). Season day 0 is otherwise derived from
# `--end-day` / `--days` in `main()` and threaded through `build_season` as
# `season_start`, so a fixed `--seed` together with a fixed `--end-day` still
# gives a byte-identical season on every run.
SEASON_START = datetime(2026, 1, 5, tzinfo=timezone.utc)

WEALTH_COMPONENTS = ("bank", "mining_nodes", "guild_expansions", "trade_ventures")
PRESTIGE_COMPONENTS = ("Military", "Territory", "Diplomacy")  # "Wealth" is computed, not stored here

FACTION_NAME_POOL = [
    "Alba", "Doria", "Kestrel Reach", "Vaelmoor", "Thornwatch", "Sable Coast",
    "Ashford", "Greymantle", "Ironhold", "Sunreach", "Nightfall Union",
    "Brackenfen", "Wyrmspire", "Highcrest", "Salt Marches", "Cindermoor",
]
GUILD_NAME_POOL = ["Masons", "Cartographers", "Ironmongers", "Vintners", "Shipwrights"]


def default_seed() -> int:
    return DEFAULT_SEED


_FALLBACK_RGB_HEX = "#888888"


def _rgb_to_hex(value: object) -> str:
    """Best-effort convert a `nation.json` rgb ("r,g,b" small ints) to "#rrggbb".

    `nation.json` and the ledger payload disagree on rgb representation --
    the former is a comma-separated triplet, the latter (and everything
    downstream, e.g. `_make_faction`'s synthetic colours) is a CSS hex
    string. A missing, malformed, or out-of-range value degrades to a
    neutral grey instead of raising: one bad nation record in one day's
    chronicle capture must not abort seeding the whole season.
    """
    if isinstance(value, str):
        parts = value.split(",")
        if len(parts) == 3:
            try:
                r, g, b = (int(part.strip()) for part in parts)
            except ValueError:
                return _FALLBACK_RGB_HEX
            if all(0 <= component <= 255 for component in (r, g, b)):
                return "#%02x%02x%02x" % (r, g, b)
    return _FALLBACK_RGB_HEX


def collect_real_nations(map_id: str, start_day: str, end_day: str) -> dict[str, dict[str, str]]:
    """Union of real nation ids captured in `map_id`'s chronicle days in [start_day, end_day].

    Reads each in-window day's `nation.json.gz` through the chronicle store
    helpers (`chronicle.store.list_days` / `resolve_stored_file`), not by
    globbing paths by hand, so `same_as` de-dup and the day index stay the
    single source of truth. Nations come and go across a season, so this is
    a union across every captured day in the window, not just the map's
    current `input/{map}/nation.json` -- a nation gone by the window's last
    day must still be an eligible id (e.g. for the delete/reuse set-piece).

    Returns `{nation_id: {"name": str, "rgb": "#rrggbb"}}`, keyed on the
    real nation id. When an id appears on multiple days its name/rgb are
    taken from the latest day it appears on in-window, matching what the
    map looks like "now". A day whose `nation.json` is missing, unreadable,
    or not the expected `{id: {...}}` shape is skipped rather than aborting
    the whole collection.
    """
    days = [day for day in chronicle_list_days(map_id) if start_day <= day <= end_day]
    nations: dict[str, dict[str, str]] = {}
    for day in days:
        path = chronicle_resolve_stored_file(map_id, day, "nation")
        if not path:
            continue
        try:
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        for nation_id, entry in data.items():
            if not isinstance(nation_id, str) or not nation_id or not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if not isinstance(name, str) or not name:
                name = nation_id
            nations[nation_id] = {"name": name, "rgb": _rgb_to_hex(entry.get("rgb"))}
    return nations


@dataclass
class FactionState:
    id: str
    founded_at: str
    name: str
    rgb: str
    wealth_components: dict[str, float]
    prestige_components: dict[str, float]
    rank_up_at: float
    rank_down_at: float
    rank_level: int
    rank_name: str
    tier: str
    tier_index: int
    overlord: str | None = None
    subjects: list[str] = field(default_factory=list)
    provinces: int = 4
    settlements: int = 2
    members: int = 3
    installations: int = 1
    forts: int = 0
    deleted_on_day: int | None = None
    prev_wealth_total: float | None = None


def _drift(rng: random.Random, value: float, *, pct: float, shock_chance: float,
           shock_range: tuple[float, float], floor: float = 1.0) -> float:
    """One day of semi-independent stock movement: small drift, rare shock."""
    value *= 1.0 + rng.uniform(-pct, pct)
    if rng.random() < shock_chance:
        value *= rng.uniform(*shock_range)
    return max(floor, value)


def _make_faction(
    rng: random.Random,
    index: int,
    founded_at: str,
    *,
    faction_id: str | None = None,
    name: str | None = None,
    rgb: str | None = None,
) -> FactionState:
    """Roll a faction's economy/prestige stats; identity fields default to synthetic.

    `faction_id`/`name`/`rgb` are overridable so a real map nation's identity
    (see `collect_real_nations`) can be dropped in without disturbing the
    random stat generation below, which stays keyed off `index`/`rng` either
    way so `--seed` reproducibility is unaffected by which id ends up on it.
    """
    if faction_id is None:
        faction_id = f"faction_{index}"
    if name is None:
        name = FACTION_NAME_POOL[index % len(FACTION_NAME_POOL)]
    if rgb is None:
        rgb = "#%02x%02x%02x" % (rng.randrange(40, 230), rng.randrange(40, 230), rng.randrange(40, 230))
    base = rng.uniform(400.0, 4000.0)
    wealth_components = {
        comp: base * w
        for comp, w in zip(
            WEALTH_COMPONENTS,
            [rng.uniform(0.15, 0.4) for _ in WEALTH_COMPONENTS],
        )
    }
    prestige_components = {comp: rng.uniform(50.0, 250.0) for comp in PRESTIGE_COMPONENTS}
    prestige_now = sum(prestige_components.values())
    return FactionState(
        id=faction_id,
        founded_at=founded_at,
        name=name,
        rgb=rgb,
        wealth_components=wealth_components,
        prestige_components=prestige_components,
        rank_up_at=prestige_now + rng.uniform(150.0, 400.0),
        rank_down_at=max(50.0, prestige_now - rng.uniform(150.0, 400.0)),
        rank_level=rng.randint(1, 3),
        rank_name=rng.choice(["Tribe", "Kingdom", "Empire"]),
        tier=rng.choice(["settler", "lord", "king"]),
        tier_index=rng.randint(1, 4),
        provinces=rng.randint(3, 20),
        settlements=rng.randint(1, 6),
        members=rng.randint(2, 12),
        installations=rng.randint(0, 4),
        forts=rng.randint(0, 2),
    )


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _day_str(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def _scaled_event_offsets(days: int) -> tuple[int, int, int, int]:
    """Day-indices for the four scripted edge cases, scaled to `days`.

    The original `max()`/`min()`-floored formulas were tuned against a
    60-day season and only happened to stay in-bounds and collision-free
    there; at shorter lengths (11-13 days, for instance) the reuse and
    degraded days land on the same index. This computes proportional
    targets (same shape as the original tuning: delete ~20% in, gap ~33%
    in, reuse shortly after delete, degraded ~66% in) and then resolves
    each one against `[0, days - 1]` and against the indices already
    claimed, so all four are guaranteed in-window and mutually distinct
    for any `days >= 10` (the floor `build_season` already enforces).

    Returns `(gap_day_index, degraded_day_index, delete_day_index,
    reuse_day_index)`.
    """
    last = days - 1
    used: set[int] = set()

    def place(target: int) -> int:
        v = max(0, min(last, target))
        while v in used and v < last:
            v += 1
        while v in used and v > 0:
            v -= 1
        if v in used:
            raise ValueError(
                f"--days={days} is too short to fit all scripted edge cases "
                "without them colliding on the same day"
            )
        used.add(v)
        return v

    delete_day_index = place(max(1, round(days * 0.20)))
    gap_day_index = place(max(1, round(days * 0.33)))
    reuse_day_index = place(max(delete_day_index + 1, delete_day_index + max(2, round(days * 0.18))))
    degraded_day_index = place(max(reuse_day_index + 1, round(days * 0.66)))

    return gap_day_index, degraded_day_index, delete_day_index, reuse_day_index


# Cumulative shrink/growth the rank thresholds go through over a season, at
# the original 60-day tuning (0.985/day for 60 days, 1.025/day for 60 days).
# `_scaled_rank_drift_rates` picks a per-day rate for any `--days` that
# reproduces this same *total* movement by the end of the season, instead of
# always applying the flat 60-day per-day rate — at 14 days the flat rate
# only moves the bar ~19%/61%, which is rarely enough to cross a
# 150-400-point margin. `days == 60` reduces exactly to the original
# constants, so the default season is unaffected.
_RANK_UP_TOTAL_FACTOR_AT_60 = 0.985**60
_RANK_DOWN_TOTAL_FACTOR_AT_60 = 1.025**60


def _scaled_rank_drift_rates(days: int) -> tuple[float, float]:
    """Return (rank_up_daily_factor, rank_down_daily_factor) for `days`.

    Both are chosen so that applying them once per day for the whole season
    reproduces the same total movement the original flat 60-day rates
    (0.985 / 1.025 per day) produce over 60 days -- shrinking `rank_up_at`
    to ~40% of its start and growing `rank_down_at` to ~4.4x its start --
    regardless of how long the season actually is. Shorter seasons get a
    proportionally more aggressive per-day rate so the threshold crossings
    the season is built to demonstrate still have room to actually happen.
    """
    rank_up_factor = _RANK_UP_TOTAL_FACTOR_AT_60 ** (1.0 / days)
    rank_down_factor = _RANK_DOWN_TOTAL_FACTOR_AT_60 ** (1.0 / days)
    return rank_up_factor, rank_down_factor


def build_season(
    *,
    map_id: str,
    days: int,
    faction_count: int,
    snapshots_per_day: int,
    seed: int,
    season_start: datetime = SEASON_START,
    real_identities: list[tuple[str, str, str]] | None = None,
) -> list[dict]:
    """Return the ordered list of raw payload dicts (SF's wire shape) for one season.

    Scripted set-pieces, scaled relative to `days` (see `_scaled_event_offsets`
    and `_scaled_rank_drift_rates`) so they still land inside the season,
    distinct from each other, and with room to actually happen for any
    `--days` >= 10 (the floor enforced below), not just the original 60-day
    tuning:
      - gap_day_index: a UTC day with zero snapshots
      - degraded_day_index: a UTC day where every snapshot is complete=false
      - delete_day_index: faction 0 is removed from the roster (complete:true)
      - reuse_day_index: a *new* faction reappears under faction 0's id
      - rising faction (index 1): rank_up_at drifts down, its prestige crosses it
      - falling faction (index 2): rank_down_at drifts up, its prestige crosses it
      - flat faction (index 3): wealth pinned near-flat while a boom faction
        (index 4, if present) grows hard, so faction 3's Wealth-share prestige
        visibly falls despite flat finances

    `real_identities`, when given, is `[(faction_id, name, rgb), ...]` -- one
    entry per faction, `len(real_identities) == faction_count` -- carrying a
    real map nation's identity (from `collect_real_nations`) onto faction
    index `i` instead of the synthetic `faction_i`/name-pool/random-colour
    identity `_make_faction` invents by default. Index 0 is still the
    delete/reuse faction and indices 1-3 are still the rising/falling/flat
    roles -- only *whose* real id ends up in each role changes, never the
    scripted behaviour itself. `boom` (index 4) is optional either way, so
    the minimum viable roster is 4, not 5 -- a map that only ever had 4
    nations captured in the window can still run the full scripted season,
    just without a boom faction.
    """
    if days < 10:
        raise ValueError("--days must be at least 10 to fit the scripted events")
    if faction_count < 4:
        raise ValueError(
            "--factions must be at least 4 to fit the scripted roles "
            "(delete/reuse, rising, falling, flat)"
        )
    if real_identities is not None and len(real_identities) != faction_count:
        raise ValueError(
            f"real_identities has {len(real_identities)} entrie(s) but faction_count is "
            f"{faction_count}"
        )

    rng = random.Random(seed)

    gap_day_index, degraded_day_index, delete_day_index, reuse_day_index = _scaled_event_offsets(days)

    factions: list[FactionState] = []
    for i in range(faction_count):
        founded_offset_days = rng.randint(30, 400)
        founded_at = _iso(season_start - timedelta(days=founded_offset_days))
        if real_identities is not None:
            real_id, real_name, real_rgb = real_identities[i]
            factions.append(
                _make_faction(rng, i, founded_at, faction_id=real_id, name=real_name, rgb=real_rgb)
            )
        else:
            factions.append(_make_faction(rng, i, founded_at))

    rising = factions[1]
    falling = factions[2]
    flat = factions[3]
    boom = factions[4] if faction_count > 4 else None

    rank_up_daily_factor, rank_down_daily_factor = _scaled_rank_drift_rates(days)

    guild_defs = []
    for gi, name in enumerate(GUILD_NAME_POOL[: min(4, faction_count)]):
        guild_defs.append(
            {
                "id": f"guild_{gi}",
                "faction_id": factions[gi % faction_count].id,
                "name": name,
                "type": rng.choice(["CRAFT", "MERCHANT", "MILITARY"]),
                "wealth": rng.uniform(50.0, 400.0),
                "bank": rng.uniform(5.0, 80.0),
                "expansions": rng.randint(0, 3),
                "trade_power": rng.uniform(0.5, 5.0),
                "credit_score": rng.uniform(0.3, 1.0),
                "size": rng.randint(2, 10),
            }
        )

    reused_faction: FactionState | None = None

    payloads: list[dict] = []
    server_day = 100
    prev_guild_wealth_total: float | None = None

    for day_index in range(days):
        day_dt = season_start + timedelta(days=day_index)
        is_gap_day = day_index == gap_day_index
        is_degraded_day = day_index == degraded_day_index
        is_delete_day = day_index == delete_day_index
        is_reuse_day = day_index == reuse_day_index

        if is_gap_day:
            # The server was down the whole UTC day: no snapshots, and the
            # in-game clock does not advance either (it counts uptime, not
            # wall-clock days) -- this is the one stall in server_day.
            continue

        # --- advance every faction's economy by one day ------------------
        season_progress = day_index / max(1, days - 1)

        for faction in factions:
            if faction.deleted_on_day is not None:
                continue
            for comp in WEALTH_COMPONENTS:
                if faction is flat:
                    # Pinned near-flat on purpose: only rounding-level jitter,
                    # no drift and no shocks, so any later share-driven
                    # prestige dip cannot be blamed on this faction's own
                    # finances moving. Must NOT also run through the generic
                    # drift below, or "flat" is a lie.
                    faction.wealth_components[comp] *= 1.0 + rng.uniform(-0.001, 0.001)
                elif faction is boom:
                    # A hard, monotonic climb: guarantees global wealth rises
                    # over the season even though everyone else random-walks.
                    faction.wealth_components[comp] *= 1.0 + rng.uniform(0.02, 0.05)
                else:
                    faction.wealth_components[comp] = _drift(
                        rng,
                        faction.wealth_components[comp],
                        pct=0.06,
                        shock_chance=0.05,
                        shock_range=(0.6, 1.5),
                    )

            for comp in PRESTIGE_COMPONENTS:
                if faction is flat:
                    faction.prestige_components[comp] *= 1.0 + rng.uniform(-0.002, 0.002)
                else:
                    faction.prestige_components[comp] = max(
                        10.0,
                        faction.prestige_components[comp] * (1.0 + rng.uniform(-0.03, 0.03)),
                    )

            # Threshold set-pieces: the game's own rebalancing moves the bar,
            # not the faction's actions.
            if faction is rising:
                faction.rank_up_at *= rank_up_daily_factor  # bar drifts down hard all season
            if faction is falling:
                faction.rank_down_at *= rank_down_daily_factor  # bar drifts up hard all season

        # If today is the delete day (or later), faction 0 drops out of the
        # roster for good until the reuse day re-founds the name.
        if is_delete_day and factions[0].deleted_on_day is None:
            factions[0].deleted_on_day = day_index

        if is_reuse_day and reused_faction is None:
            # Same id (and, per the ledger doc, same name) as the deleted
            # faction 0, but a fresh roll of everything else -- a new nation
            # founded under a name/id someone else gave up, not a revival of
            # the old one. In real-id mode `factions[0].id` is the real
            # nation id; in synthetic mode it's already `faction_0`, so
            # passing it explicitly is a no-op there but required here.
            reused_faction = _make_faction(
                rng, 0, _iso(day_dt), faction_id=factions[0].id, name=factions[0].name
            )
            factions.append(reused_faction)

        live_factions = [f for f in factions if f.deleted_on_day is None or f.deleted_on_day > day_index]
        # A faction founded on the reuse day should not appear before it.
        live_factions = [
            f for f in live_factions
            if f is not reused_faction or day_index >= reuse_day_index
        ]

        total_wealth_now = 0.0
        faction_wealth_by_id: dict[int, float] = {}
        for f in live_factions:
            w = sum(f.wealth_components.values())
            faction_wealth_by_id[id(f)] = w
            total_wealth_now += w

        max_wealth_prestige = 300.0  # scale for the Wealth prestige component

        guild_total_wealth_now = 0.0
        for g in guild_defs:
            g["wealth"] = _drift(rng, g["wealth"], pct=0.05, shock_chance=0.04, shock_range=(0.7, 1.4), floor=1.0)
            g["bank"] = _drift(rng, g["bank"], pct=0.08, shock_chance=0.03, shock_range=(0.5, 1.6), floor=0.0)
            guild_total_wealth_now += g["wealth"]

        # --- one or more snapshots for this UTC day -----------------------
        n_snapshots = max(1, snapshots_per_day)
        # Spread captured_at realistically across the day (roughly every
        # ~6-9 hours for a 3-a-day cadence), sorted ascending.
        offsets_seconds = sorted(
            rng.randint(0, 86399) for _ in range(n_snapshots)
        )

        for snap_index, offset in enumerate(offsets_seconds):
            captured_at = day_dt + timedelta(seconds=offset)
            is_last_of_day = snap_index == len(offsets_seconds) - 1

            if is_degraded_day:
                complete = False
            elif is_last_of_day and day_index % 5 == 0 and day_index not in (delete_day_index, reuse_day_index):
                # Occasionally the newest snapshot of the day is partial, so
                # promotion has to fall back past it to an earlier complete
                # one instead of trusting "latest" blindly.
                complete = False
            else:
                complete = True

            faction_entries = []
            for f in live_factions:
                wealth_total = faction_wealth_by_id[id(f)]
                wealth_share = (wealth_total / total_wealth_now) if total_wealth_now > 0 else 0.0
                wealth_prestige = max_wealth_prestige * wealth_share
                prestige_breakdown = dict(f.prestige_components)
                prestige_breakdown["Wealth"] = round(wealth_prestige, 3)
                prestige_total = sum(prestige_breakdown.values())

                # Full-day projections, deliberately their own process rather
                # than a derivative of the stock above -- see the ledger doc's
                # third trap. A day-over-day observed delta is a *different*
                # quantity and must not leak into these.
                observed_delta = (
                    wealth_total - f.prev_wealth_total
                    if f.prev_wealth_total is not None
                    else 0.0
                )
                net_income = observed_delta * rng.uniform(0.2, 0.6) + rng.uniform(-40.0, 60.0)
                inflation_delta = rng.uniform(-3.0, 3.0)

                faction_entries.append(
                    {
                        "id": f.id,
                        "founded_at": f.founded_at,
                        "name": f.name,
                        "rgb": f.rgb,
                        "overlord": f.overlord,
                        "subjects": list(f.subjects),
                        "wealth": round(wealth_total, 3),
                        "wealth_breakdown": {k: round(v, 3) for k, v in f.wealth_components.items()},
                        "bank": round(f.wealth_components["bank"], 3),
                        "vassal_wealth": 0.0,
                        "net_income": round(net_income, 3),
                        "inflation_delta": round(inflation_delta, 3),
                        "trade_power": round(rng.uniform(1.0, 12.0), 3),
                        "prestige": round(prestige_total, 3),
                        "prestige_breakdown": prestige_breakdown,
                        "rank": f.rank_name,
                        "rank_level": f.rank_level,
                        "rank_up_at": round(f.rank_up_at, 3),
                        "rank_down_at": round(f.rank_down_at, 3),
                        "prestige_position": 0,
                        "wealth_position": 0,
                        "provinces": f.provinces,
                        "realm_size": f.provinces,
                        "tier": f.tier,
                        "tier_index": f.tier_index,
                        "highest_title": f"{f.rank_name} of {f.name}",
                        "members": f.members,
                        "members_with_vassals": f.members,
                        "settlements": f.settlements,
                        "population": f.members * rng.randint(8, 20),
                        "installations": f.installations,
                        "forts": f.forts,
                        "wars": [],
                    }
                )
                f.prev_wealth_total = wealth_total

            # Rank positions, computed honestly off this snapshot's own numbers.
            for pos, entry in enumerate(sorted(faction_entries, key=lambda e: -e["wealth"]), start=1):
                entry["wealth_position"] = pos
            for pos, entry in enumerate(sorted(faction_entries, key=lambda e: -e["prestige"]), start=1):
                entry["prestige_position"] = pos

            guild_entries = [dict(g) for g in guild_defs]
            for g in guild_entries:
                g["wealth"] = round(g["wealth"], 3)
                g["bank"] = round(g["bank"], 3)
                g["credit_score"] = round(g["credit_score"], 3)
                g["trade_power"] = round(g["trade_power"], 3)

            guild_income_delta = (
                guild_total_wealth_now - prev_guild_wealth_total
                if prev_guild_wealth_total is not None
                else 0.0
            )
            # Again a deliberately independent forecast, not the observed delta.
            guild_income = guild_income_delta * rng.uniform(0.1, 0.5) + rng.uniform(-10.0, 15.0)
            prev_guild_wealth_total = guild_total_wealth_now

            global_block = {
                "faction_count": len(faction_entries),
                "guild_count": len(guild_entries),
                "claimed_provinces": sum(f["provinces"] for f in faction_entries),
                "population": sum(f["population"] for f in faction_entries),
                "active_wars": 0,
                "max_wealth_prestige": max_wealth_prestige,
                "faction_wealth": round(total_wealth_now, 3),
                "pouch_wealth": round(rng.uniform(200.0, 900.0), 3),
                "player_bank_wealth": round(rng.uniform(100.0, 600.0), 3),
                "liquid_wealth": round(rng.uniform(300.0, 1200.0), 3),
                "guild_liquid_wealth": round(guild_total_wealth_now * rng.uniform(0.1, 0.3), 3),
                "node_wealth": round(rng.uniform(50.0, 400.0), 3),
                "expansion_wealth": round(rng.uniform(20.0, 250.0), 3),
                "guild_income": round(guild_income, 3),
            }

            payload = {
                "schema_version": 1,
                "map_id": map_id,
                "captured_at": _iso(captured_at),
                "server_day": server_day,
                "day_progress_seconds": offset,
                "complete": complete,
                "global": global_block,
                "factions": faction_entries,
                "guilds": guild_entries,
                "events": [],
            }
            payloads.append(payload)

        server_day += 1

    return payloads


def _summarize(payloads: list[dict]) -> None:
    days = sorted({p["day"] if "day" in p else p["captured_at"][:10] for p in payloads})
    complete = sum(1 for p in payloads if p["complete"])
    print(f"Built {len(payloads)} snapshot(s) across {len(days)} day(s) with data "
          f"({days[0]} .. {days[-1]}); {complete} complete, {len(payloads) - complete} partial.")


def ingest_direct(map_id: str, payloads: list[dict]) -> None:
    """Feed every payload through the real normalize -> store_raw -> promote_day path."""
    from src.database.migrate import migrate

    migrate()

    days_touched: list[str] = []
    for payload in payloads:
        try:
            snapshot = normalize_snapshot(payload, map_id)
        except LedgerPayloadError as exc:
            print(
                f"REJECTED by normalize_snapshot (status {exc.status}): {exc.detail}\n"
                f"  captured_at={payload.get('captured_at')!r}",
                file=sys.stderr,
            )
            raise
        ledger_ingest.store_raw(map_id, snapshot)
        # The real route queues promotion as a BackgroundTask after every
        # upload; do the same here so the canonical-choice logic (latest
        # complete, memoised incomplete scans, etc.) runs exactly as it would
        # in production, not once-per-day as a shortcut.
        ledger_ingest.promote_day(map_id, snapshot["day"])
        if snapshot["day"] not in days_touched:
            days_touched.append(snapshot["day"])

    print(f"Ingested {len(payloads)} snapshot(s) directly for map '{map_id}' "
          f"({len(days_touched)} distinct day(s)).")


class LedgerIndexUnreadable(RuntimeError):
    """The index exists but could not be read, so "has history?" is unanswered."""


def existing_ledger_days(map_id: str) -> list[str]:
    """Days this map already holds in `map_ledger_days`.

    Two outcomes, kept distinct because they mean different things to the
    guard:

    * `[]` - a readable index that is genuinely empty for this map.
    * a non-empty list - real history, which `--force` gates.

    Anything else (no `DATABASE_URL`, an unreachable database, a migration
    failure) raises `LedgerIndexUnreadable`. Swallowing that into "no history"
    would fail *open*: the one case where the script cannot tell whether it is
    about to overwrite a season is the case where it must not proceed silently.
    """
    from src.database.migrate import migrate

    try:
        migrate()
        return [row["day"] for row in ledger_list_days(map_id)]
    except Exception as exc:
        raise LedgerIndexUnreadable(
            f"Could not read the ledger index for {map_id!r}: {exc}"
        ) from exc


def guard_target_map(parser: argparse.ArgumentParser, map_id: str, force: bool) -> None:
    """Refuse to spray synthetic economy history over a map that matters.

    Three refusals, because they protect against different mistakes:

    * A **public** map (`public: true` in `config/maps.yml`) is a live map real
      players read. There is no undo for `store_raw` + `promote_day`, so no flag
      unlocks this — seed `dev`, or make the map non-public first. The old guard
      hardcoded `main`, which left every other public map wide open the moment
      it was registered.
    * A map the registry **does not know** is not thereby safe: it is either a
      typo or a map registered somewhere this process cannot see, and "not in
      my registry" is not evidence that nobody reads it. Treated as unknown and
      gated on `--force`.
    * A map that **already has ledger rows** may be a staff-only map that is
      nonetheless holding history someone cares about. That is recoverable-ish
      and only needs an explicit `--force`.
    """
    entry = get_map_entry(map_id)
    if entry is not None and entry.public:
        parser.error(
            f"Refusing to write spoof ledger data onto public map {map_id!r} "
            f"({entry.display_name}): it is served to real users and this "
            "script has no undo. Use --map dev, or a map registered with "
            "public: false."
        )
    if entry is None and not force:
        parser.error(
            f"Map {map_id!r} is not in this backend's registry "
            "(src/config/maps.yml), so this script cannot tell whether it is "
            "public. Use a registered non-public map, or pass --force."
        )

    try:
        days = existing_ledger_days(map_id)
    except LedgerIndexUnreadable as exc:
        if not force:
            parser.error(f"{exc}. Fix the database, or pass --force.")
        print(f"{exc}; continuing because --force was given.", file=sys.stderr)
        days = None
    if days:
        print(
            f"Map {map_id!r} already holds {len(days)} ledger day(s) "
            f"({days[0]} .. {days[-1]}) in map_ledger_days.",
            file=sys.stderr,
        )
        if not force:
            parser.error(
                f"Refusing to write spoof ledger data onto map {map_id!r}, which "
                f"already has {len(days)} indexed ledger day(s). Wipe it first "
                "(python -m src.scripts.ledger.wipe) or pass --force."
            )


def describe_target(map_id: str, payloads: list[dict], *, post: bool) -> None:
    """Print what is about to be written, before anything is written."""
    entry = get_map_entry(map_id)
    registered = "unregistered" if entry is None else (
        "public" if entry.public else "staff-only"
    )
    days = sorted({p["day"] for p in payloads})
    destination = UPLOAD_URL_FMT.format(map=map_id) if post else "the local ledger store + Postgres index"
    print(
        f"About to write {len(payloads)} spoof snapshot(s) covering "
        f"{len(days)} day(s) ({days[0]} .. {days[-1]}) for map {map_id!r} "
        f"({registered}) into {destination}."
    )


def post_http(map_id: str, payloads: list[dict]) -> None:
    url = UPLOAD_URL_FMT.format(map=map_id)
    ok = 0
    for payload in payloads:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="POST", headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
                ok += 1
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            print(
                f"POST rejected ({exc.code}) for captured_at={payload['captured_at']}: {detail}",
                file=sys.stderr,
            )
        except urllib.error.URLError as exc:
            print(f"POST failed for {url}: {exc}", file=sys.stderr)
            raise
    print(f"POSTed {ok}/{len(payloads)} snapshot(s) to {url}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Generate a spoof season of ledger (economy) snapshots and ingest them "
        "through the real store_raw/promote_day path (or POST them to a running server)."
    )
    parser.add_argument("--map", default=DEFAULT_MAP, help=f"Map id (default: {DEFAULT_MAP})")
    parser.add_argument("--days", type=int, default=60, help="Season length in UTC days (default: 60)")
    parser.add_argument(
        "--end-day",
        default=None,
        metavar="YYYY-MM-DD",
        help="Last UTC day of the season; the season spans "
        "[end_day - days + 1, end_day] inclusive (default: today's UTC date)",
    )
    parser.add_argument("--factions", type=int, default=8, help="Number of factions (default: 8)")
    parser.add_argument(
        "--snapshots-per-day",
        type=int,
        default=3,
        help="Snapshots per UTC day, so canonical-daily selection has something to pick between (default: 3)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help=f"Random seed, fixed by default for reproducible runs (default: {DEFAULT_SEED})",
    )
    parser.add_argument(
        "--post",
        action="store_true",
        help="POST snapshots to a running server instead of ingesting directly",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the season and print a summary; write/POST nothing",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Required to target a map that already has rows in map_ledger_days. "
        "Never unlocks a public map -- those are refused outright.",
    )
    id_group = parser.add_mutually_exclusive_group()
    id_group.add_argument(
        "--ids-from-map",
        action="store_true",
        help="Use the real nation ids/names/colours captured in the map's own chronicle "
        "history (default whenever the map has any captured chronicle data)",
    )
    id_group.add_argument(
        "--synthetic-ids",
        action="store_true",
        help="Use invented faction_0..faction_N ids with generated names/colours instead "
        "of the map's real nation ids -- required for a map with no chronicle history yet",
    )
    args = parser.parse_args()

    map_id = args.map.strip().lower()
    validate_map(map_id)
    if not args.dry_run:
        guard_target_map(parser, map_id, args.force)

    end_day_str = args.end_day if args.end_day is not None else today_utc()
    if not is_valid_day(end_day_str):
        parser.error(
            f"--end-day must be a valid calendar date in YYYY-MM-DD form, got {args.end_day!r}"
        )
    end_day_dt = datetime.strptime(end_day_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    season_start = end_day_dt - timedelta(days=args.days - 1)
    season_start_day = _day_str(season_start)

    faction_count = args.factions
    real_identities: list[tuple[str, str, str]] | None = None
    if not args.synthetic_ids:
        real_nations = collect_real_nations(map_id, season_start_day, end_day_str)
        if not real_nations:
            parser.error(
                f"No captured chronicle nation data found for map {map_id!r} in "
                f"{season_start_day}..{end_day_str}, so real nation ids cannot be used "
                "(pass --synthetic-ids to use invented faction ids instead, e.g. for a "
                "fresh map with no chronicle history yet)."
            )
        real_ids = sorted(real_nations)
        if len(real_ids) < faction_count:
            print(
                f"Map {map_id!r} only has {len(real_ids)} captured nation id(s) in "
                f"{season_start_day}..{end_day_str}; using all of them instead of "
                f"--factions={faction_count}.",
                file=sys.stderr,
            )
            faction_count = len(real_ids)
        else:
            real_ids = real_ids[:faction_count]
        real_identities = [(nid, real_nations[nid]["name"], real_nations[nid]["rgb"]) for nid in real_ids]
        print(
            f"Using {len(real_identities)} real nation id(s) from map {map_id!r}: "
            f"{', '.join(real_ids)}"
        )

    payloads = build_season(
        map_id=map_id,
        days=args.days,
        faction_count=faction_count,
        snapshots_per_day=args.snapshots_per_day,
        seed=args.seed,
        season_start=season_start,
        real_identities=real_identities,
    )
    # Stamp each payload with its own partition day for the summary only;
    # normalize_snapshot recomputes this properly from captured_at.
    for p in payloads:
        p["day"] = p["captured_at"][:10]

    _summarize(payloads)

    if args.dry_run:
        print("[dry-run] nothing written.")
        return

    describe_target(map_id, payloads, post=args.post)

    if args.post:
        post_http(map_id, payloads)
    else:
        ingest_direct(map_id, payloads)


if __name__ == "__main__":
    main()
