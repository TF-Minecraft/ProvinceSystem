"""A player's recent CoreProtect actions, merged across tables, newest first.

Each source is read with its own (user, time) index seek and the same strict
boundary, so pages never repeat or skip rows that share a second. Each scan
examines at most SCAN_LIMIT rows, so a sparse filter costs the same as any
other page. The merged
order is (time, source rank, rowid), all descending; the cursor is the last
row's key.

Only what staff need to see what happened is selected. Chat is never read.
Commands are cut to their first word inside SQL, so arguments (messages,
passwords, link codes) never leave the database. Sign text, item metadata
and NBT are not selected.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import cursors
from .maps import Maps
from .reader import Reader

DEFAULT_LIMIT = 20
MAX_LIMIT = 100

# Rows one source may examine per page. A sparse filter (say, kills by a
# player with years of building) would otherwise walk their whole history;
# instead the page stops where the scan did and "next" carries on from there.
SCAN_LIMIT = 2000

_SKILL = "substr(message, 1, 7) = '[skill]'"
_TELEPORT = "instr(message, ' teleported from ')"
# The command's first word, or a skill cast's name without teleport coordinates.
_COMMAND_TEXT = (
    f"substr(CASE WHEN {_SKILL} THEN "
    f"  CASE WHEN {_TELEPORT} > 0 THEN substr(message, 9, {_TELEPORT} - 9) ELSE substr(message, 9) END "
    "ELSE CASE WHEN instr(message, ' ') > 0 THEN substr(message, 1, instr(message, ' ') - 1) ELSE message END "
    "END, 1, 80)"
)


@dataclass(frozen=True)
class Source:
    rank: int
    name: str
    table: str
    columns: str
    kinds: dict[str, str]


SOURCES = (
    Source(1, "block", "co_block", "type, data, action, rolled_back",
           {"block": "action IN (0, 1)", "click": "action = 2", "kill": "action = 3", "spawn": "action = 13"}),
    Source(2, "container", "co_container", "type, amount, action, rolled_back",
           {"container": "action IN (0, 1)"}),
    Source(3, "entity_container", "co_entity_container", "type, amount, action, rolled_back",
           {"container": "action IN (0, 1)"}),
    Source(4, "item", "co_item", "type, amount, action, rolled_back",
           {"item": "action BETWEEN 0 AND 12"}),
    Source(5, "entity", "co_entity_interaction", "type, action, rolled_back",
           {"entity": "action BETWEEN 0 AND 3"}),
    Source(6, "sign", "co_sign", "action", {"sign": "action IN (0, 1, 2)"}),
    Source(7, "command", "co_command",
           f"{_SKILL} AS is_skill, {_TELEPORT} > 0 AS teleport, {_COMMAND_TEXT} AS text",
           {"skill": _SKILL, "command": f"NOT {_SKILL}"}),
    Source(8, "session", "co_session", "action", {"session": "action IN (0, 1)"}),
)
KINDS = tuple(dict.fromkeys(kind for source in SOURCES for kind in source.kinds))
_BY_RANK = {source.rank: source for source in SOURCES}


@dataclass(frozen=True, order=True)
class Cursor:
    time: int
    rank: int
    rowid: int


def encode_cursor(server: str, cursor: Cursor) -> str:
    return cursors.encode(server, "activity", cursor.time, cursor.rank, cursor.rowid)


def decode_cursor(server: str, token: str | None) -> Cursor | None:
    values = cursors.decode(server, "activity", token, 3)
    if values is None:
        return None
    if values[1] not in _BY_RANK:
        raise cursors.BadCursor("bad_cursor")
    return Cursor(*values)


def parse_kinds(text: str | None) -> tuple[str, ...]:
    if not text:
        return KINDS
    chosen = tuple(dict.fromkeys(part.strip() for part in text.split(",") if part.strip()))
    if not chosen or any(kind not in KINDS for kind in chosen):
        raise ValueError("bad_kinds")
    return chosen


def _boundary(source: Source, cursor: Cursor | None) -> tuple[str, tuple]:
    if cursor is None:
        return "", ()
    if source.rank < cursor.rank:
        return " AND time <= ?", (cursor.time,)
    if source.rank > cursor.rank:
        return " AND time < ?", (cursor.time,)
    return " AND time <= ? AND NOT (time = ? AND rowid >= ?)", (cursor.time, cursor.time, cursor.rowid)


def _key(source: Source, row: dict) -> Cursor:
    return Cursor(row["time"], source.rank, row["rid"])


def fetch(reader: Reader, maps: Maps, ids: list[int], kinds: tuple[str, ...], cursor: Cursor | None,
          limit: int) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    rows = []
    # The newest point a capped scan reached. Rows older than it may sit
    # beside unexamined rows of that source, so this page stops there.
    frontier: Cursor | None = None
    for source in SOURCES:
        if source.table not in maps.tables:
            continue
        conditions = [cond for kind, cond in source.kinds.items() if kind in kinds]
        if not conditions:
            continue
        bound, bound_params = _boundary(source, cursor)
        # The oldest row this page may examine, found from the index alone.
        edge_sql = (
            f"SELECT time, rowid AS rid FROM {source.table} WHERE user = ?{bound} "
            f"ORDER BY time DESC, rowid DESC LIMIT 1 OFFSET {SCAN_LIMIT - 1}"
        )
        for uid in ids:
            edge = reader.rows(edge_sql, (uid, *bound_params))
            floor, floor_params = "", ()
            if edge:
                floor = " AND time >= ? AND NOT (time = ? AND rowid < ?)"
                floor_params = (edge[0]["time"], edge[0]["time"], edge[0]["rid"])
            found = [dict(row) for row in reader.rows(
                f"SELECT rowid AS rid, time, wid, x, y, z, {source.columns} FROM {source.table} "
                f"WHERE user = ? AND ({' OR '.join(conditions)}){bound}{floor} "
                "ORDER BY time DESC, rowid DESC LIMIT ?",
                (uid, *bound_params, *floor_params, limit + 1),
            )]
            rows += [(source, row) for row in found]
            if edge and len(found) <= limit:
                reached = _key(source, dict(edge[0]))
                frontier = reached if frontier is None else max(frontier, reached)
    rows.sort(key=lambda item: _key(*item), reverse=True)
    if frontier is not None:
        rows = [item for item in rows if _key(*item) >= frontier]
    if len(rows) > limit:
        rows = rows[:limit]
        nxt = _key(*rows[-1])
    else:
        nxt = frontier
    victims = sorted({row["data"] for source, row in rows
                      if source.name == "block" and row["action"] == 3 and row["type"] == 0 and row["data"]})
    names = {}
    if victims:
        marks = ",".join("?" * len(victims))
        names = {r["id"]: {"minecraft_name": r["user"], "uuid": r["uuid"]}
                 for r in reader.rows(f"SELECT id, user, uuid FROM co_user WHERE id IN ({marks})", tuple(victims))}
    return {
        "rows": rows,
        "victims": names,
        "next": nxt,
        # Set when the page stopped at a scan limit rather than filling up.
        "searched_to": frontier.time if frontier is not None and nxt == frontier else None,
    }


_ITEM_VERBS = {
    0: "removed", 1: "added", 2: "dropped", 3: "picked up", 4: "took from an ender chest",
    5: "put in an ender chest", 6: "threw", 7: "shot", 8: "broke", 9: "destroyed", 10: "crafted",
    11: "sold", 12: "bought",
}
_ENTITY_VERBS = {0: "clicked", 1: "sheared", 2: "leashed", 3: "unleashed"}
_SIGN_VERBS = {0: "broke", 1: "placed", 2: "edited"}


def _rollback(source: Source, state: int | None) -> str | None:
    if not state:
        return None
    if source.name in {"container", "entity_container", "item"}:
        return {1: "rolled back", 2: "rolled back (player inventory)", 3: "rolled back (both)"}.get(
            state, f"rollback state {state}")
    return "rolled back" if state == 1 else f"rollback state {state}"


def _entry(source: Source, row: dict, maps: Maps, victims: dict) -> dict:
    action = row.get("action")
    entry = {
        "id": f"{source.name}:{row['rid']}",
        "time": row["time"],
        "world": maps.world(row["wid"]),
        "x": row["x"], "y": row["y"], "z": row["z"],
        "amount": None,
        "victim": None,
        "rolled_back": _rollback(source, row.get("rolled_back")),
    }
    if source.name == "block":
        if action == 3:
            if row["type"] == 0:
                victim = victims.get(row["data"])
                entry.update(kind="kill", verb="killed", victim=victim,
                             target=victim["minecraft_name"] if victim else "a player")
            else:
                entry.update(kind="kill", verb="killed", target=maps.entity(row["type"]))
        elif action == 13:
            entry.update(kind="spawn", verb="spawned", target=maps.entity(row["type"]))
        elif action == 2:
            entry.update(kind="click", verb="clicked", target=maps.material(row["type"]))
        else:
            entry.update(kind="block", verb="placed" if action == 1 else "broke", target=maps.material(row["type"]))
    elif source.name in {"container", "entity_container"}:
        entry.update(kind="container", verb="added" if action == 1 else "removed",
                     target=maps.material(row["type"]), amount=row["amount"])
    elif source.name == "item":
        entry.update(kind="item", verb=_ITEM_VERBS.get(action, "moved"),
                     target=maps.material(row["type"]), amount=row["amount"])
    elif source.name == "entity":
        entry.update(kind="entity", verb=_ENTITY_VERBS.get(action, "clicked"), target=maps.entity(row["type"]))
    elif source.name == "sign":
        entry.update(kind="sign", verb=_SIGN_VERBS.get(action, "changed"), target="sign")
    elif source.name == "command":
        if row["is_skill"]:
            entry.update(kind="skill", verb="teleported with" if row["teleport"] else "cast",
                         target=(row["text"] or "").strip() or "a skill")
        else:
            entry.update(kind="command", verb="ran", target=row["text"] or "/")
    else:
        entry.update(kind="session", verb="logged in" if action == 1 else "logged out", target=None)
    return entry


def build(raw: dict, maps: Maps, server: str) -> dict:
    return {
        "entries": [_entry(source, row, maps, raw["victims"]) for source, row in raw["rows"]],
        "next": encode_cursor(server, raw["next"]) if raw["next"] else None,
        "searched_to": raw["searched_to"],
    }
