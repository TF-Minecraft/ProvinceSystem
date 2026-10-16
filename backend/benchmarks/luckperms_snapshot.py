"""Times applying a LuckPerms snapshot from the TFMCWeb bridge on Postgres.

    DATABASE_URL=postgresql://… python benchmarks/luckperms_snapshot.py [--players 2000] [--nodes 10]

Point it at a scratch database: it migrates it and replaces the LuckPerms mirror.
Each player has `--nodes` nodes (a rank, a track step, permissions, a
server-only node and a timed one); there are 40 groups of 30 nodes and 6 tracks.
It times `mirror.replace_snapshot` (validation, then one transaction: lock
lp_state, delete the five tables, COPY them back) several times, each a newer
revision over a full mirror. `--executemany` times the same rows written with
INSERT … executemany instead of COPY, for comparison.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(BACKEND), str(BACKEND / "src")]
os.environ.setdefault("SKINS_DEV", "1")


def _node(key: str, **extra) -> dict:
    return {"key": key, "value": True, "contexts": {}, "expiry": 0, **extra}


def _payload(players: int, per_player: int, revision: int) -> dict:
    groups = [{"name": f"group{g}", "weight": g * 10, "display_name": None,
               "nodes": [_node(f"group.group{g - 1}")] * (g > 0) + [_node(f"perm.{g}.{n}") for n in range(29)]}
              for g in range(40)]
    users = []
    for i in range(players):
        nodes = [_node(f"group.group{i % 40}"), _node("tips.off", contexts={"server": ["main"]}),
                 _node(f"kits.daily.{i % 7}", expiry=4_000_000_000)]
        nodes += [_node(f"jobs.{i % 13}.{n}") for n in range(max(0, per_player - len(nodes)))]
        users.append({"uuid": f"{i:08x}-0000-4000-8000-{i:012x}", "name": f"Player{i}", "nodes": nodes[:per_player]})
    tracks = [{"name": f"track{t}", "groups": [f"group{g}" for g in range(t * 6, t * 6 + 6)]} for t in range(6)]
    return {"server": "main", "generated_at": 1792076432, "revision": revision, "hash": f"h{revision}",
            "groups": groups, "tracks": tracks, "users": users}


def _executemany(conn, groups, tracks, users) -> None:
    """The rows `_write_snapshot` copies, written with executemany instead."""
    from src.luckperms import mirror

    with conn.cursor() as cur:
        cur.executemany("INSERT INTO lp_groups (name, display_name, weight) VALUES (%s, %s, %s) ON CONFLICT (name) DO UPDATE "
                        "SET display_name = excluded.display_name, weight = excluded.weight",
                        [(g["name"], g["display_name"], g["weight"]) for g, _ in groups])
        cur.executemany("INSERT INTO lp_group_nodes (group_name, key, value, contexts, expiry) VALUES (%s, %s, %s, %s, %s)",
                        [mirror._node_row(g["name"], n) for g, owned in groups for n in owned])
        cur.executemany("INSERT INTO lp_tracks (name, groups_json) VALUES (%s, %s) ON CONFLICT (name) DO UPDATE "
                        "SET groups_json = excluded.groups_json", [(t["name"], json.dumps(t["groups"])) for t in tracks])
        cur.executemany("INSERT INTO lp_users (uuid, name) VALUES (%s, %s) ON CONFLICT (uuid) DO UPDATE SET name = excluded.name",
                        [(u["uuid"], u["name"]) for u, _ in users])
        cur.executemany("INSERT INTO lp_user_nodes (uuid, key, value, contexts, expiry) VALUES (%s, %s, %s, %s, %s)",
                        [mirror._node_row(u["uuid"], n) for u, owned in users for n in owned])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--players", type=int, default=2000)
    parser.add_argument("--nodes", type=int, default=10, help="nodes per player")
    parser.add_argument("--repeat", type=int, default=7)
    parser.add_argument("--executemany", action="store_true", help="write with executemany instead of COPY")
    args = parser.parse_args()

    from src import database
    from src.database.migrate import migrate
    from src.luckperms import mirror

    migrate()
    if args.executemany:
        mirror._write_snapshot = _executemany
    with database.connect() as conn:
        stored = conn.execute("SELECT max(revision) AS r FROM lp_state").fetchone()["r"] or 0
    payloads = [_payload(args.players, args.nodes, stored + 1 + n) for n in range(args.repeat + 1)]
    mirror.replace_snapshot(payloads[0])  # a full mirror to replace
    times = []
    for payload in payloads[1:]:
        start = time.perf_counter()
        result = mirror.replace_snapshot(payload)
        times.append((time.perf_counter() - start) * 1000)
        assert result["users"] == args.players, result
    with database.connect() as conn:
        user_nodes = conn.execute("SELECT count(*) AS n FROM lp_user_nodes").fetchone()["n"]
    print(f"{args.players} players, {user_nodes} player nodes, 40 groups x 30 nodes, 6 tracks; "
          f"{'executemany' if args.executemany else 'COPY'}")
    print(f"replace_snapshot  median {statistics.median(times):7.1f} ms   min {min(times):7.1f} ms   "
          f"max {max(times):7.1f} ms   (n={len(times)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
