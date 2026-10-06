"""Where players were: their co_session rows in a time window.

Our fork logs each online player's position once a minute as a ping (action
2), besides the login (1) and logout (0) rows, so a player's rows in a window
trace where they went at one-minute resolution. Nothing in between is
recorded: a straight line between two pings is a guess, and a long jump may
be a teleport or just fast travel.

Every read is an indexed seek: by player on session_user_index (user, time),
or for everyone on session_time_index (time). Rows are read newest first in
batches of BATCH, each its own statement, so no single statement holds the
read lock for long however wide the window. When a window holds more rows
than its limit, the newest are kept and `complete_from` says from when the
answer is complete; rows in that boundary second are dropped, as some of
them may have been.

The row just before the window (if it is recent and not a logout) comes
along too, so a path starts where the player already was.
"""
from __future__ import annotations

import uuid as uuidlib

from .maps import Maps
from .reader import Reader
from .sessions import ACTION_LOGOUT, ACTION_PING, Key, _before

# A week of one player's pings is about 10,000 rows.
PLAYER_WINDOW_SECONDS = 7 * 86_400
PLAYER_POINT_LIMIT = 12_000
# Main's busiest day so far (6 October 2026) held about 27,000 rows.
EVERYONE_WINDOW_SECONDS = 86_400
EVERYONE_POINT_LIMIT = 50_000
BATCH = 5_000
# How far ahead of the server's clock a window may end (a viewer's clock may run fast).
FUTURE_SLACK_SECONDS = 300
# Without a known ping interval, how far back the row before the window may be.
DEFAULT_LEAD_SECONDS = 150

_COLUMNS = "rowid AS rid, time, user, action, wid, x, y, z"


class BadWindow(ValueError):
    pass


def window(since: int | None, until: int | None, now: int, longest: int) -> tuple[int, int]:
    """The [since, until] window asked for: the last hour by default, at most `longest` seconds, not in the future."""
    until = now if until is None else until
    since = until - 3_600 if since is None else since
    if since < 0 or since >= until or until - since > longest or until > now + FUTURE_SLACK_SECONDS:
        raise BadWindow("bad_window")
    return since, until


def lead_seconds(ping_seconds: int) -> int:
    """How old the row before the window may be and still say where the player was at its start."""
    return 2 * ping_seconds + 30 if ping_seconds > 0 else DEFAULT_LEAD_SECONDS


def _newest(reader: Reader, where: str, params: tuple, limit: int) -> list:
    """Up to limit + 1 rows matching `where`, newest first, read in batches."""
    rows: list = []
    while len(rows) <= limit:
        want = min(BATCH, limit + 1 - len(rows))
        cond, extra = where, params
        if rows:
            older, args = _before(Key(rows[-1]["time"], rows[-1]["rid"]))
            cond, extra = f"{where} AND {older}", params + args
        batch = reader.rows(
            f"SELECT {_COLUMNS} FROM co_session WHERE {cond} ORDER BY time DESC, rowid DESC LIMIT ?",
            extra + (want,),
        )
        rows += batch
        if len(batch) < want:
            break
    return rows


def _cap(rows: list, since: int, limit: int) -> tuple[list, int]:
    """Newest first, at most limit rows, and the time from which they are complete."""
    rows = sorted(rows, key=lambda r: (r["time"], r["rid"]), reverse=True)
    if len(rows) <= limit:
        return rows, since
    boundary = rows[limit]["time"]
    return [r for r in rows[:limit] if r["time"] > boundary], boundary + 1


def fetch_player(reader: Reader, ids: list[int], since: int, until: int, lead: int) -> dict:
    rows = []
    for uid in ids:
        rows += _newest(reader, "user = ? AND time >= ? AND time <= ?", (uid, since, until), PLAYER_POINT_LIMIT)
    rows, complete_from = _cap(rows, since, PLAYER_POINT_LIMIT)
    before = []
    if complete_from == since:
        for uid in ids:
            before += reader.rows(
                f"SELECT {_COLUMNS} FROM co_session WHERE user = ? AND time < ? AND time >= ? "
                "ORDER BY time DESC, rowid DESC LIMIT 1",
                (uid, since, since - lead),
            )
    newest_before = max(before, key=lambda r: (r["time"], r["rid"])) if before else None
    if newest_before is not None and newest_before["action"] != ACTION_LOGOUT:
        rows.append(newest_before)
    return {"rows": rows, "complete_from": complete_from, "pings_since": _pings_since(reader)}


def fetch_everyone(reader: Reader, since: int, until: int, lead: int) -> dict:
    rows = _newest(reader, "time >= ? AND time <= ?", (since, until), EVERYONE_POINT_LIMIT)
    rows, complete_from = _cap(rows, since, EVERYONE_POINT_LIMIT)
    # A couple of ping intervals of everyone's rows before the window: a few dozen on a busy evening.
    before = (_newest(reader, "time < ? AND time >= ?", (since, since - lead), EVERYONE_POINT_LIMIT)
              if complete_from == since else [])
    users = sorted({r["user"] for r in rows + before})
    names = {}
    # Chunked to stay under SQLite's bound-parameter limit.
    for start in range(0, len(users), 500):
        chunk = users[start:start + 500]
        names.update({r["id"]: dict(r) for r in reader.rows(
            f"SELECT id, user, uuid FROM co_user WHERE id IN ({','.join('?' * len(chunk))})", tuple(chunk))})
    # The newest row per player, across all of their co_user ids, unless it is a logout.
    latest: dict[str, object] = {}
    for row in before:
        user = names.get(row["user"])
        key = _canonical(user["uuid"]) if user else None
        if key is not None:
            latest.setdefault(key, row)
    rows += [r for r in latest.values() if r["action"] != ACTION_LOGOUT]
    return {"rows": rows, "complete_from": complete_from, "users": names, "pings_since": _pings_since(reader)}


def _pings_since(reader: Reader) -> int | None:
    found = reader.rows("SELECT time FROM co_session WHERE action = ? ORDER BY time LIMIT 1", (ACTION_PING,))
    return found[0]["time"] if found else None


def _world_name(maps: Maps, wid: int | None) -> str:
    return maps.world(wid) or f"world #{wid}"


def _points(rows, maps: Maps, worlds: list[str]) -> list[list[int]]:
    """Oldest first, each [time, world index, x, y, z, action]."""
    index = {name: i for i, name in enumerate(worlds)}
    points = []
    for row in sorted(rows, key=lambda r: (r["time"], r["rid"])):
        name = _world_name(maps, row["wid"])
        if name not in index:
            index[name] = len(worlds)
            worlds.append(name)
        points.append([row["time"], index[name], row["x"], row["y"], row["z"], row["action"]])
    return points


def build_player(raw: dict, maps: Maps) -> dict:
    worlds: list[str] = []
    points = _points(raw["rows"], maps, worlds)
    return {"worlds": worlds, "points": points, "complete_from": raw["complete_from"],
            "pings_since": raw["pings_since"]}


def _canonical(text: str | None) -> str | None:
    try:
        return str(uuidlib.UUID(str(text or "").strip()))
    except ValueError:
        return None


def build_everyone(raw: dict, maps: Maps) -> dict:
    """Players with any row in the window, by UUID; rows under several co_user ids for one UUID merge."""
    worlds: list[str] = []
    groups: dict[str, list] = {}
    names: dict[str, tuple[tuple[int, int], str]] = {}
    for row in raw["rows"]:
        user = raw["users"].get(row["user"])
        key = _canonical(user["uuid"]) if user else None
        if key is None:
            continue
        groups.setdefault(key, []).append(row)
        order = (row["time"], row["rid"])
        if key not in names or order > names[key][0]:
            names[key] = (order, user["user"])
    players = [
        {"uuid": key, "minecraft_name": names[key][1], "points": _points(groups[key], maps, worlds)}
        for key in sorted(groups, key=lambda k: (names[k][1].lower(), k))
    ]
    return {"worlds": worlds, "players": players, "complete_from": raw["complete_from"],
            "pings_since": raw["pings_since"]}
