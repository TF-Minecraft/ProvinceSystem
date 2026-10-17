"""The site's copy of LuckPerms, as the TFMCWeb bridge last published it.

The bridge's snapshot replaces every table in one transaction. A change
result carries its target's state, which replaces just that target, so the
panel shows an applied change before the next snapshot arrives.

Lock order in every LuckPerms transaction: `lp_state` first (`lock_state`, or
`record_poll`'s upsert), then users and sessions, then `lp_changes` rows. Every
writer of the mirror tables holds `lp_state` FOR UPDATE, so a transaction holding
it FOR SHARE reads one consistent mirror.

Times are timestamptz, stored to the second as before; they leave this package
as `YYYY-MM-DDTHH:MM:SSZ`.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import psycopg

from src import database
from src.auth.players import canonical_uuid

from . import nodes

USERS_MAX = 50_000
NODES_MAX = 2_000_000
NAME_MAX = 36
# The bridge polls every few seconds; a minute of silence means it is gone.
CONNECTED_SECONDS = 60
PAGE_SIZE = 50
QUERY_MAX = 64


class SnapshotError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _stamp(ts: float | None = None) -> datetime:
    """A time to store: now (or `ts`), to the whole second, as the Z strings were."""
    return datetime.fromtimestamp(int(ts if ts is not None else time.time()), timezone.utc)


def _iso(value: datetime | None) -> str | None:
    """A stored time in the API form, `YYYY-MM-DDTHH:MM:SSZ`; None stays None."""
    return None if value is None else value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _age(stamp: datetime | None, now: float) -> float | None:
    if stamp is None:
        return None
    return max(0.0, now - stamp.timestamp())


def lock_state(conn, *, share: bool = False) -> dict:
    """Seed and lock the `lp_state` row: the first lock of a LuckPerms transaction.

    FOR UPDATE for a transaction that changes the mirror or settles changes; FOR SHARE
    for one that must read a single consistent mirror while snapshots wait.
    """
    conn.execute("INSERT INTO lp_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
    return conn.execute(f"SELECT * FROM lp_state WHERE id = 1 FOR {'SHARE' if share else 'UPDATE'}").fetchone()


def _node_rows(raw_nodes) -> list[dict]:
    if not isinstance(raw_nodes, list):
        raise SnapshotError("bad_snapshot")
    try:
        return [nodes.from_snapshot(node) for node in raw_nodes]
    except nodes.NodeError:
        raise SnapshotError("bad_snapshot") from None


def _group(raw) -> tuple[dict, list[dict]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("name"), str) or not raw["name"]:
        raise SnapshotError("bad_snapshot")
    weight = raw.get("weight")
    display = raw.get("display_name")
    return (
        {
            "name": raw["name"].lower()[:NAME_MAX * 2],
            "display_name": display if isinstance(display, str) else None,
            "weight": weight if isinstance(weight, int) and not isinstance(weight, bool) else None,
        },
        _node_rows(raw.get("nodes", [])),
    )


def _user(raw) -> tuple[dict, list[dict]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("uuid"), str):
        raise SnapshotError("bad_snapshot")
    uuid = canonical_uuid(raw["uuid"])
    if uuid is None:
        raise SnapshotError("bad_snapshot")
    name = raw.get("name")
    return {"uuid": uuid, "name": name[:NAME_MAX] if isinstance(name, str) and name else None}, _node_rows(
        raw.get("nodes", []))


def _track(raw) -> dict:
    if (not isinstance(raw, dict) or not isinstance(raw.get("name"), str) or not raw["name"]
            or not isinstance(raw.get("groups"), list)
            or not all(isinstance(g, str) for g in raw["groups"])):
        raise SnapshotError("bad_snapshot")
    return {"name": raw["name"].lower(), "groups": [g.lower() for g in raw["groups"]]}


def _node_row(owner: str, n: dict) -> tuple:
    return owner, n["key"], n["value"], nodes.contexts_json(n["contexts"]), n["expiry"]


def _copy(conn, table: str, columns: str, rows) -> None:
    with conn.cursor().copy(f"COPY {table} ({columns}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)


def _insert_group(conn, group: dict, group_nodes: list[dict]) -> None:
    conn.execute(
        "INSERT INTO lp_groups (name, display_name, weight) VALUES (%s, %s, %s) "
        "ON CONFLICT (name) DO UPDATE SET display_name = excluded.display_name, weight = excluded.weight",
        (group["name"], group["display_name"], group["weight"]))
    _copy(conn, "lp_group_nodes", "group_name, key, value, contexts, expiry",
          (_node_row(group["name"], n) for n in group_nodes))


def _insert_user(conn, user: dict, user_nodes: list[dict]) -> None:
    conn.execute("INSERT INTO lp_users (uuid, name) VALUES (%s, %s) "
                 "ON CONFLICT (uuid) DO UPDATE SET name = excluded.name", (user["uuid"], user["name"]))
    _copy(conn, "lp_user_nodes", "uuid, key, value, contexts, expiry",
          (_node_row(user["uuid"], n) for n in user_nodes))


def _last_wins(rows: list[dict], key: str) -> list[dict]:
    """One row per key, the last one listed, as INSERT OR REPLACE kept."""
    return list({row[key]: row for row in rows}.values())


def _write_snapshot(conn, groups, tracks, users) -> None:
    """Load a whole snapshot into the emptied tables with COPY."""
    _copy(conn, "lp_groups", "name, display_name, weight",
          ((g["name"], g["display_name"], g["weight"]) for g in _last_wins([g for g, _ in groups], "name")))
    _copy(conn, "lp_group_nodes", "group_name, key, value, contexts, expiry",
          (_node_row(g["name"], n) for g, group_nodes in groups for n in group_nodes))
    _copy(conn, "lp_tracks", "name, group_names",
          ((t["name"], json.dumps(t["groups"])) for t in _last_wins(tracks, "name")))
    _copy(conn, "lp_users", "uuid, name",
          ((u["uuid"], u["name"]) for u in _last_wins([u for u, _ in users], "uuid")))
    _copy(conn, "lp_user_nodes", "uuid, key, value, contexts, expiry",
          (_node_row(u["uuid"], n) for u, user_nodes in users for n in user_nodes))


def replace_snapshot(payload) -> dict:
    if not isinstance(payload, dict):
        raise SnapshotError("bad_snapshot")
    for field in ("groups", "tracks", "users"):
        if not isinstance(payload.get(field), list):
            raise SnapshotError("bad_snapshot")
    if len(payload["users"]) > USERS_MAX:
        raise SnapshotError("snapshot_too_large")
    snapshot_hash = payload.get("hash")
    server = payload.get("server")
    generated_at = payload.get("generated_at")
    revision = _revision(payload.get("revision"))
    groups = [_group(raw) for raw in payload["groups"]]
    tracks = [_track(raw) for raw in payload["tracks"]]
    users = [_user(raw) for raw in payload["users"]]
    if sum(len(n) for _, n in users) + sum(len(n) for _, n in groups) > NODES_MAX:
        raise SnapshotError("snapshot_too_large")
    stamp = _stamp()
    try:
        with database.connect() as conn:
            if not _newer(lock_state(conn), revision):
                conn.rollback()
                return {"ok": True, "stale": True}
            # DELETE, not TRUNCATE: its ACCESS EXCLUSIVE lock would stall every panel read.
            for table in ("lp_group_nodes", "lp_groups", "lp_tracks", "lp_user_nodes", "lp_users"):
                conn.execute(f"DELETE FROM {table}")
            _write_snapshot(conn, groups, tracks, users)
            conn.execute(
                """
                UPDATE lp_state SET server = %s, hash = %s, generated_at = to_timestamp(%s), revision = %s,
                    received_at = %s, checked_at = %s
                WHERE id = 1
                """,
                (str(server)[:32] if server else None, str(snapshot_hash)[:128] if snapshot_hash else None,
                 generated_at if isinstance(generated_at, int) else None, revision, stamp, stamp),
            )
    except psycopg.DataError:
        # What Postgres cannot store (a NUL in a key, a number past bigint) refuses the snapshot.
        raise SnapshotError("bad_snapshot") from None
    return {"ok": True, "groups": len(groups), "tracks": len(tracks), "users": len(users)}


def _revision(raw) -> int:
    if not isinstance(raw, int) or isinstance(raw, bool) or raw <= 0:
        raise SnapshotError("bad_revision")
    return raw


def _newer(state: dict | None, revision: int) -> bool:
    return state is None or state["revision"] is None or revision > state["revision"]


def mark_unchanged(snapshot_hash, revision) -> bool:
    if not isinstance(snapshot_hash, str) or not snapshot_hash or "\x00" in snapshot_hash:
        return False
    revision = _revision(revision)
    with database.connect() as conn:
        # One statement: it row-locks lp_state, and takes no other lock.
        updated = conn.execute(
            "UPDATE lp_state SET checked_at = %s, revision = %s WHERE id = 1 AND hash = %s AND revision < %s",
            (_stamp(), revision, snapshot_hash, revision)).rowcount
    return updated == 1


def apply_state(conn, target_type: str, target: str, state, revision) -> None:
    """Replace one target with the state a change result reported, on the caller's transaction.

    Ignored unless newer than everything stored. The stored hash no longer
    describes the mirror, so the next unchanged check asks for a full snapshot.
    The caller holds `lp_state` FOR UPDATE.
    """
    if target_type not in ("user", "group"):
        return
    revision = _revision(revision)
    if not _newer(conn.execute("SELECT revision FROM lp_state WHERE id = 1").fetchone(), revision):
        return
    # Parse and match before deleting anything, so a bad state leaves the mirror alone.
    if state is not None and not isinstance(state, dict):
        raise SnapshotError("bad_snapshot")
    if target_type == "user":
        parsed = _user(state) if state is not None else None
        if parsed is not None and parsed[0]["uuid"] != target:
            raise SnapshotError("bad_snapshot")
        conn.execute("DELETE FROM lp_user_nodes WHERE uuid = %s", (target,))
        conn.execute("DELETE FROM lp_users WHERE uuid = %s", (target,))
        if parsed is not None:
            _insert_user(conn, *parsed)
    else:
        parsed = _group(state) if state is not None else None
        if parsed is not None and parsed[0]["name"] != target:
            raise SnapshotError("bad_snapshot")
        conn.execute("DELETE FROM lp_group_nodes WHERE group_name = %s", (target,))
        conn.execute("DELETE FROM lp_groups WHERE name = %s", (target,))
        if parsed is not None:
            _insert_group(conn, *parsed)
    conn.execute("UPDATE lp_state SET hash = NULL, revision = %s WHERE id = 1", (revision,))


def record_poll(conn) -> None:
    """Note an applying bridge's poll. The upsert seeds and row-locks `lp_state`, so as a
    transaction's first statement it is that transaction's `lp_state` lock."""
    conn.execute(
        "INSERT INTO lp_state (id, polled_at) VALUES (1, %s) "
        "ON CONFLICT (id) DO UPDATE SET polled_at = excluded.polled_at",
        (_stamp(),),
    )


def status(conn=None) -> dict:
    def read(c):
        return c.execute("SELECT server, received_at, checked_at, polled_at FROM lp_state WHERE id = 1").fetchone()

    if conn is None:
        with database.connect() as own:
            row = read(own)
    else:
        row = read(conn)
    now = time.time()
    polled = _age(row["polled_at"], now) if row else None
    return {
        "server": row["server"] if row else None,
        "snapshot_at": _iso(row["received_at"]) if row else None,
        "checked_at": _iso(row["checked_at"]) if row else None,
        "has_snapshot": bool(row and row["received_at"]),
        "applying": polled is not None and polled <= CONNECTED_SECONDS,
        "polled_at": _iso(row["polled_at"]) if row else None,
    }


# --------------------
# Reads
# --------------------


def _node(row) -> dict:
    # Contexts were stored with sorted keys; jsonb reorders them, so sort them back.
    return {"key": row["key"], "value": row["value"], "contexts": dict(sorted(row["contexts"].items())),
            "expiry": row["expiry"]}


def _sort_key(node: dict):
    return (node["key"].lower(), json.dumps(node["contexts"], sort_keys=True), node["expiry"], not node["value"])


def load_groups(conn) -> dict[str, dict]:
    groups = {row["name"]: {"name": row["name"], "display_name": row["display_name"], "weight": row["weight"],
                            "nodes": []}
              for row in conn.execute("SELECT name, display_name, weight FROM lp_groups")}
    for row in conn.execute("SELECT group_name, key, value, contexts, expiry FROM lp_group_nodes"):
        if row["group_name"] in groups:
            groups[row["group_name"]]["nodes"].append(_node(row))
    for group in groups.values():
        group["nodes"].sort(key=_sort_key)
    return groups


def load_tracks(conn) -> list[dict]:
    return [{"name": row["name"], "groups": row["group_names"]}
            for row in conn.execute("SELECT name, group_names FROM lp_tracks ORDER BY name")]


def user_nodes(conn, uuid: str) -> list[dict]:
    rows = conn.execute("SELECT key, value, contexts, expiry FROM lp_user_nodes WHERE uuid = %s", (uuid,))
    return sorted((_node(row) for row in rows), key=_sort_key)


def user_row(conn, uuid: str) -> dict | None:
    row = conn.execute("SELECT uuid, name FROM lp_users WHERE uuid = %s", (uuid,)).fetchone()
    return dict(row) if row else None


def parents(group: dict, now: int, *, global_only: bool = True) -> list[str]:
    """Groups this group inherits directly."""
    out = []
    for node in group["nodes"]:
        name = nodes.group_of(node["key"])
        if name and node["value"] and nodes.active(node, now) and (not global_only or not node["contexts"]):
            out.append(name)
    return out


def meta_value(group: dict, prefix: str, now: int) -> tuple[int, str] | None:
    """The highest-priority prefix or suffix a group sets itself (global, active)."""
    best = None
    for node in group["nodes"]:
        key = node["key"]
        if not key.lower().startswith(prefix + ".") or not node["value"] or node["contexts"]:
            continue
        if not nodes.active(node, now):
            continue
        parts = key.split(".", 2)
        if len(parts) != 3:
            continue
        try:
            priority = int(parts[1])
        except ValueError:
            continue
        if best is None or priority > best[0]:
            best = (priority, parts[2])
    return best


def inherited(groups: dict[str, dict], direct: list[str], now: int) -> list[str]:
    """Every group reached from these, in breadth-first order, each once."""
    seen: list[str] = []
    queue = list(direct)
    while queue:
        name = queue.pop(0)
        if name in seen or name not in groups:
            continue
        seen.append(name)
        queue.extend(parents(groups[name], now))
    return seen


def rank_group(groups: dict[str, dict], user_node_list: list[dict], now: int) -> str | None:
    """The heaviest group a player inherits globally: what LuckPerms shows as their rank."""
    direct = [nodes.group_of(n["key"]) for n in user_node_list
              if nodes.group_of(n["key"]) and n["value"] and not n["contexts"] and nodes.active(n, now)]
    chain = inherited(groups, [d for d in direct if d], now) or (["default"] if "default" in groups else [])
    if not chain:
        return None
    return max(chain, key=lambda name: (groups[name]["weight"] or 0, name))


def search_users(conn, q: str, group: str | None, page: int) -> dict:
    """Players by name or UUID prefix, optionally only those holding a group directly."""
    text = (q or "").strip().lower()
    if len(text) > QUERY_MAX:
        raise SnapshotError("query_too_long")
    if "\x00" in text:
        # Postgres text cannot hold NUL, so no name or UUID can contain one.
        return {"total": 0, "page": page, "page_size": PAGE_SIZE, "rows": []}
    where, args = [], []
    if text:
        where.append("(lower(u.name) LIKE %s ESCAPE '\\' OR u.uuid LIKE %s ESCAPE '\\')")
        escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        args += [f"%{escaped}%", f"{escaped}%"]
    if group:
        where.append("u.uuid IN (SELECT uuid FROM lp_user_nodes WHERE key = %s)")
        args.append(f"group.{group.lower()}")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS n FROM lp_users u {clause}", args).fetchone()["n"]
    rows = conn.execute(
        f"""
        SELECT u.uuid, u.name FROM lp_users u {clause}
        ORDER BY CASE WHEN lower(u.name) = %s THEN 0 WHEN lower(u.name) LIKE %s ESCAPE '\\' THEN 1 ELSE 2 END,
                 u.name IS NULL, lower(u.name), u.uuid
        LIMIT %s OFFSET %s
        """,
        [*args, text, (text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"),
         PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ).fetchall()
    return {"total": total, "page": page, "page_size": PAGE_SIZE, "rows": [dict(r) for r in rows]}


def group_counts(conn) -> dict[str, int]:
    """Players holding each group directly, in any context."""
    out: dict[str, int] = {}
    for row in conn.execute(
            "SELECT key, COUNT(DISTINCT uuid) AS n FROM lp_user_nodes WHERE key LIKE 'group.%' GROUP BY key"):
        name = nodes.group_of(row["key"])
        if name:
            out[name] = out.get(name, 0) + row["n"]
    return out
