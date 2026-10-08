"""A player's recent CoreProtect actions, merged across tables, newest first.

Each source is read with its own (user, time) index seek and the same strict
boundary, so pages never repeat or skip rows that share a second. Each scan
examines at most SCAN_LIMIT rows, so a sparse filter costs the same as any
other page. The merged
order is (time, source rank, rowid), all descending; the cursor is the last
row's key.

Only what staff need to see what happened is selected. Unless the caller
may read messages (full_text), chat is never read and commands are cut to
their first word inside SQL, so arguments (messages, passwords, link codes)
never leave the database. Sign text is never selected. Bounded item/entity metadata is fetched only
for the final page; build() extracts labels after the database reader closes.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import cursors, metadata, names
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
MESSAGE_MAX = 512
_CAST = f"CASE WHEN {_TELEPORT} > 0 THEN substr(message, 9, {_TELEPORT} - 9) ELSE substr(message, 9) END"
# The command's first word, or a skill cast's name without teleport coordinates.
_COMMAND_TEXT = (
    f"substr(CASE WHEN {_SKILL} THEN {_CAST} "
    "ELSE CASE WHEN instr(message, ' ') > 0 THEN substr(message, 1, instr(message, ' ') - 1) ELSE message END "
    "END, 1, 80)"
)
_FULL_COMMAND_TEXT = f"CASE WHEN {_SKILL} THEN substr({_CAST}, 1, 80) ELSE substr(message, 1, {MESSAGE_MAX}) END"


@dataclass(frozen=True)
class Source:
    rank: int
    name: str
    table: str
    columns: str
    kinds: dict[str, str]
    # Columns used instead when the caller may read messages.
    full_columns: str | None = None
    # Read only when the caller may read messages.
    sensitive: bool = False


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
           f"{_SKILL} AS is_skill, {_TELEPORT} > 0 AS teleport, {_COMMAND_TEXT} AS text, 0 AS truncated",
           {"skill": _SKILL, "command": f"NOT {_SKILL}"},
           full_columns=(f"{_SKILL} AS is_skill, {_TELEPORT} > 0 AS teleport, {_FULL_COMMAND_TEXT} AS text, "
                         f"NOT {_SKILL} AND length(message) > {MESSAGE_MAX} AS truncated")),
    Source(8, "session", "co_session", "action", {"session": "action IN (0, 1)"}),
    Source(9, "chat", "co_chat", f"substr(message, 1, {MESSAGE_MAX}) AS text, length(message) > {MESSAGE_MAX} AS truncated",
           {"chat": "1"}, sensitive=True),
)
# Kinds anyone with view_players may ask for, and the extra ones for view_player_messages.
KINDS = tuple(dict.fromkeys(kind for source in SOURCES if not source.sensitive for kind in source.kinds))
FULL_KINDS = tuple(dict.fromkeys(kind for source in SOURCES for kind in source.kinds))
# Kinds whose rows carry message text when read with full_text.
MESSAGE_KINDS = frozenset({"chat", "command"})
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


def parse_kinds(text: str | None, allowed: tuple[str, ...] = KINDS) -> tuple[str, ...]:
    if not text:
        return allowed
    chosen = tuple(dict.fromkeys(part.strip() for part in text.split(",") if part.strip()))
    if not chosen or any(kind not in allowed for kind in chosen):
        raise ValueError("bad_kinds")
    return chosen


def _upper(source: Source, cursor: Cursor | None) -> tuple | None:
    """This source's bound below the cursor: ("le", t), ("lt", t) or ("before", t, rowid)."""
    if cursor is None:
        return None
    if source.rank < cursor.rank:
        return ("le", cursor.time)
    if source.rank > cursor.rank:
        return ("lt", cursor.time)
    return ("before", cursor.time, cursor.rowid)


def _segments(upper: tuple | None, lower: tuple[int, int] | None) -> list[tuple[str, tuple]]:
    """Disjoint WHERE fragments covering lower <= (time, rowid) < upper, newest first.

    A rowid bound only ever appears with the second pinned by equality, which
    the (user, time) index seeks. Written as "time <= t AND NOT (time = t AND
    rowid >= id)", SQLite would walk every row in that second first, and one
    WorldEdit paste can put hundreds of thousands of rows in one second.
    """
    # Each top segment: (fragment, params, pinned second, does a second fall inside it).
    if upper is None:
        tops = [("", (), None, lambda t: True)]
    elif upper[0] == "le":
        tops = [(" AND time <= ?", (upper[1],), None, lambda t: t <= upper[1])]
    elif upper[0] == "lt":
        tops = [(" AND time < ?", (upper[1],), None, lambda t: t < upper[1])]
    else:
        tops = [(" AND time = ? AND rowid < ?", (upper[1], upper[2]), upper[1], None),
                (" AND time < ?", (upper[1],), None, lambda t: t < upper[1])]
    if lower is None:
        return [(sql, params) for sql, params, _, _ in tops]
    low_time, low_rowid = lower
    out = []
    for sql, params, pinned, contains in tops:
        if pinned is None:
            out.append((f"{sql} AND time > ?", params + (low_time,)))
            # On its own: next to a time range, SQLite would use the range and sort.
            if contains(low_time):
                out.append((" AND time = ? AND rowid >= ?", (low_time, low_rowid)))
        elif pinned == low_time:
            out.append((f"{sql} AND rowid >= ?", params + (low_rowid,)))
        elif pinned > low_time:
            out.append((sql, params))
    return out


def _edge(reader: Reader, table: str, uid: int, upper: tuple | None):
    """The SCAN_LIMIT-th row below the bound, read from the index alone, or None if there are fewer."""
    skip = SCAN_LIMIT - 1
    segments = _segments(upper, None)
    for index, (sql, params) in enumerate(segments):
        found = reader.rows(
            f"SELECT time, rowid AS rid FROM {table} WHERE user = ?{sql} "
            "ORDER BY time DESC, rowid DESC LIMIT 1 OFFSET ?", (uid, *params, skip))
        if found:
            return dict(found[0])
        if index + 1 < len(segments):
            skip -= reader.rows(
                f"SELECT COUNT(*) AS n FROM (SELECT 1 FROM {table} WHERE user = ?{sql} LIMIT ?)",
                (uid, *params, skip))[0]["n"]
    return None


def _key(source: Source, row: dict) -> Cursor:
    return Cursor(row["time"], source.rank, row["rid"])


def fetch(reader: Reader, maps: Maps, ids: list[int], kinds: tuple[str, ...], cursor: Cursor | None,
          limit: int, full_text: bool = False) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    rows = []
    # The newest point a capped scan reached. Rows older than it may sit
    # beside unexamined rows of that source, so this page stops there.
    frontier: Cursor | None = None
    for source in SOURCES:
        if source.table not in maps.tables or (source.sensitive and not full_text):
            continue
        conditions = [cond for kind, cond in source.kinds.items() if kind in kinds]
        if not conditions:
            continue
        upper = _upper(source, cursor)
        select = (
            f"SELECT rowid AS rid, time, wid, x, y, z, "
            f"{(source.full_columns if full_text else None) or source.columns} FROM {source.table} "
            f"WHERE user = ? AND ({' OR '.join(conditions)})"
        )
        for uid in ids:
            edge = _edge(reader, source.table, uid, upper)
            found: list[dict] = []
            for sql, params in _segments(upper, (edge["time"], edge["rid"]) if edge else None):
                if len(found) > limit:
                    break
                found += [dict(row) for row in reader.rows(
                    f"{select}{sql} ORDER BY time DESC, rowid DESC LIMIT ?",
                    (uid, *params, limit + 1 - len(found)))]
            rows += [(source, row) for row in found]
            if edge and len(found) <= limit:
                reached = _key(source, edge)
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
    _fetch_metadata(reader, maps, rows)
    return {
        "rows": rows,
        "victims": names,
        "next": nxt,
        # Set when the page stopped at a scan limit rather than filling up.
        "searched_to": frontier.time if frontier is not None and nxt == frontier else None,
    }


def _fetch_metadata(reader: Reader, maps: Maps, rows: list) -> None:
    """Point reads after pagination; never pull blobs into candidate scans."""
    for source in SOURCES:
        selected = [row for origin, row in rows if origin == source]
        if not selected:
            continue
        if source.name in {"item", "container", "entity_container"}:
            column = "data" if source.name == "item" else "metadata"
            marks = ",".join("?" for _ in selected)
            blobs = {r["rid"]: r["blob"] for r in reader.rows(
                f"SELECT rowid AS rid, CASE WHEN length({column}) <= ? THEN {column} END AS blob "
                f"FROM {source.table} WHERE rowid IN ({marks})",
                (metadata.MAX_BLOB, *(r["rid"] for r in selected)))}
            for row in selected:
                row["identity_blob"] = blobs.get(row["rid"])
        elif source.name == "block":
            kills = [r for r in selected if r["action"] == 3 and r["type"] != 0]
            if not kills:
                continue
            marks = ",".join("?" for _ in kills)
            blobs = {r["rid"]: r["blob"] for r in reader.rows(
                "SELECT rowid AS rid, CASE WHEN length(meta) <= ? THEN meta END AS blob "
                f"FROM co_block WHERE rowid IN ({marks})",
                (metadata.MAX_BLOB, *(r["rid"] for r in kills)))}
            entities = {}
            if "co_entity" in maps.tables:
                entities = {r["id"]: r["blob"] for r in reader.rows(
                    "SELECT id, CASE WHEN length(data) <= ? THEN data END AS blob "
                    f"FROM co_entity WHERE id IN ({marks})",
                    (metadata.MAX_BLOB, *(r["data"] for r in kills)))}
            for row in kills:
                row["identity_blob"] = blobs.get(row["rid"])
                row["entity_blob"] = entities.get(row["data"])


_ITEM_VERBS = {
    0: "removed", 1: "added", 2: "dropped", 3: "picked up", 4: "took from an ender chest",
    5: "put in an ender chest", 6: "threw", 7: "shot", 8: "broke", 9: "destroyed", 10: "crafted",
    11: "sold", 12: "bought",
}
_ENTITY_VERBS = {0: "clicked", 1: "sheared", 2: "leashed", 3: "unleashed"}
_SIGN_VERBS = {0: "broke", 1: "placed", 2: "edited"}


# CoreProtect's rolled_back is two flags: 1 the world side, 2 the player's inventory.
_ROLLBACK = {1: "rolled back", 2: "rolled back (player inventory)", 3: "rolled back (world and inventory)"}


def _rollback(state: int | None) -> str | None:
    if not state:
        return None
    return _ROLLBACK.get(state, f"rollback state {state}")


def _material(maps: Maps, type_id: int | None, order: tuple[str, ...]) -> dict:
    return names.describe(maps.materials.get(type_id or 0), order, f"Unknown material #{type_id}")


def _mob(maps: Maps, type_id: int | None) -> dict:
    return names.describe(maps.entities.get(type_id or 0), names.ENTITY, f"Unknown entity #{type_id}")


def _item_target(row: dict, maps: Maps) -> dict:
    base = _material(maps, row["type"], names.ITEM)
    identity, name = metadata.item_identity(row.get("identity_blob"))
    if identity:
        title = identity.partition(":")[2].replace("_", " ").title()
        return {**base, "name": name or title, "source": "mmoitems", "source_id": identity,
                "vanilla_name": base["name"]}
    return {**base, "custom_name": name or None}


def _mob_target(row: dict, maps: Maps) -> dict:
    base = _mob(maps, row["type"])
    identity, name = metadata.mob_identity(row.get("entity_blob"), row.get("identity_blob"))
    if identity:
        return {**base, "name": name or identity.replace("_", " ").title(), "source": "mythicmobs",
                "source_id": identity, "vanilla_name": base["name"]}
    return {**base, "custom_name": name or None}


def _entry(source: Source, row: dict, maps: Maps, victims: dict) -> dict:
    """One row. `target` is the plain label; `target_info` the structured name the panel shows."""
    action = row.get("action")
    entry = {
        "id": f"{source.name}:{row['rid']}",
        "time": row["time"],
        "world": maps.world(row["wid"]),
        "x": row["x"], "y": row["y"], "z": row["z"],
        "amount": None,
        "victim": None,
        "message": None,
        "truncated": False,
        "rolled_back": _rollback(row.get("rolled_back")),
        "target_info": None,
    }
    if source.name == "block":
        if action == 3:
            if row["type"] == 0:
                victim = victims.get(row["data"])
                name = victim["minecraft_name"] if victim else "a player"
                entry.update(kind="kill", verb="killed", victim=victim, target=name,
                             target_info=names.target(name, source="player"))
            else:
                entry.update(kind="kill", verb="killed", target=metadata.mob_label(
                    row.get("entity_blob"), row.get("identity_blob"), maps.entity(row["type"])),
                    target_info=_mob_target(row, maps))
        elif action == 13:
            entry.update(kind="spawn", verb="spawned", target=maps.entity(row["type"]),
                         target_info=_mob(maps, row["type"]))
        elif action == 2:
            entry.update(kind="click", verb="clicked", target=maps.material(row["type"]),
                         target_info=_material(maps, row["type"], names.BLOCK))
        else:
            entry.update(kind="block", verb="placed" if action == 1 else "broke", target=maps.material(row["type"]),
                         target_info=_material(maps, row["type"], names.BLOCK))
    elif source.name in {"container", "entity_container"}:
        entry.update(kind="container", verb="added" if action == 1 else "removed",
                     target=metadata.item_label(row.get("identity_blob"), maps.material(row["type"])), amount=row["amount"],
                     target_info=_item_target(row, maps))
    elif source.name == "item":
        entry.update(kind="item", verb=_ITEM_VERBS.get(action, "moved"),
                     target=metadata.item_label(row.get("identity_blob"), maps.material(row["type"])), amount=row["amount"],
                     target_info=_item_target(row, maps))
    elif source.name == "entity":
        entry.update(kind="entity", verb=_ENTITY_VERBS.get(action, "clicked"), target=maps.entity(row["type"]),
                     target_info=_mob(maps, row["type"]))
    elif source.name == "sign":
        entry.update(kind="sign", verb=_SIGN_VERBS.get(action, "changed"), target="sign",
                     target_info=names.target("Sign"))
    elif source.name == "command":
        if row["is_skill"]:
            entry.update(kind="skill", verb="teleported with" if row["teleport"] else "cast",
                         target=(row["text"] or "").strip() or "a skill")
        else:
            entry.update(kind="command", verb="ran", target=row["text"] or "/", truncated=bool(row["truncated"]))
    elif source.name == "chat":
        entry.update(kind="chat", verb="said", target=None, message=row["text"] or "",
                     truncated=bool(row["truncated"]))
    else:
        entry.update(kind="session", verb="logged in" if action == 1 else "logged out", target=None)
    return entry


def build(raw: dict, maps: Maps, server: str) -> dict:
    return {
        "entries": [_entry(source, row, maps, raw["victims"]) for source, row in raw["rows"]],
        "next": encode_cursor(server, raw["next"]) if raw["next"] else None,
        "searched_to": raw["searched_to"],
    }
