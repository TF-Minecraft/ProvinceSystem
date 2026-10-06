"""Play sessions rebuilt from CoreProtect's co_session rows.

Rows are 1 login, 0 logout and 2 ping (our fork logs each online player's
position once a minute, per world, unless player-pings is off). A session
runs from a login to the next newer login. Inside that window, strictly
after the login and before the next one by (time, rowid):

- the first logout is the recorded end;
- otherwise the last ping is the last time we saw them ("last_observed"):
  a crash or unclean stop logs no logout, so this is not a proven end;
- the newest session with no logout is "open" while its last sighting is
  within two ping intervals (a heuristic), else "last_observed";
- with pings off or unknown, an unended newest session is "unknown".

Rows before a player's first login (history began on 19 September 2026 on
Main) are ignored; the response says where the retained history begins.
"""
from __future__ import annotations

from dataclasses import dataclass

from .maps import Maps
from .reader import Reader

ACTION_LOGOUT = 0
ACTION_LOGIN = 1
ACTION_PING = 2
FRESH_GRACE_SECONDS = 30
MAX_LIMIT = 100

_COLUMNS = "rowid AS rid, time, wid, x, y, z"


@dataclass(frozen=True)
class Key:
    time: int
    rowid: int


def _after(key: Key) -> tuple[str, tuple]:
    return "time >= ? AND NOT (time = ? AND rowid <= ?)", (key.time, key.time, key.rowid)


def _before(key: Key) -> tuple[str, tuple]:
    return "time <= ? AND NOT (time = ? AND rowid >= ?)", (key.time, key.time, key.rowid)


def _key(row) -> Key:
    return Key(row["time"], row["rid"])


def _seek(reader: Reader, ids: list[int], action: int, bounds: list[tuple[str, tuple]], newest: bool):
    """The first row after the bounds in time order (or the last, if newest), across a player's ids."""
    order = "DESC" if newest else "ASC"
    where = " AND ".join(["user = ?", "action = ?", *(b[0] for b in bounds)])
    found = []
    for uid in ids:
        params = (uid, action, *(p for b in bounds for p in b[1]))
        found += reader.rows(
            f"SELECT {_COLUMNS} FROM co_session WHERE {where} ORDER BY time {order}, rowid {order} LIMIT 1",
            params,
        )
    if not found:
        return None
    pick = max if newest else min
    return pick(found, key=lambda r: (r["time"], r["rid"]))


def fetch(reader: Reader, ids: list[int], before: Key | None, limit: int) -> dict:
    """Read one page of sessions, newest first. Plain rows only; build() shapes them."""
    limit = max(1, min(limit, MAX_LIMIT))
    logins = []
    for uid in ids:
        where, params = "user = ? AND action = ?", (uid, ACTION_LOGIN)
        if before is not None:
            cond, extra = _before(before)
            where, params = f"{where} AND {cond}", params + extra
        logins += reader.rows(
            f"SELECT {_COLUMNS} FROM co_session WHERE {where} ORDER BY time DESC, rowid DESC LIMIT ?",
            params + (limit + 1,),
        )
    logins.sort(key=lambda r: (r["time"], r["rid"]), reverse=True)
    has_more = len(logins) > limit
    page = logins[:limit]

    windows = []
    for index, login in enumerate(page):
        upper = _key(page[index - 1]) if index else before
        bounds = [_after(_key(login))] + ([_before(upper)] if upper else [])
        logout = _seek(reader, ids, ACTION_LOGOUT, bounds, newest=False)
        ping = None if logout else _seek(reader, ids, ACTION_PING, bounds, newest=True)
        windows.append({"login": login, "logout": logout, "ping": ping, "newest": upper is None})

    first_seen = [r["first"] for uid in ids
                  for r in reader.rows("SELECT MIN(time) AS first FROM co_session WHERE user = ?", (uid,))
                  if r["first"] is not None]
    history = reader.rows("SELECT MIN(time) AS start FROM co_session")
    return {
        "windows": windows,
        "next": _key(page[-1]) if has_more and page else None,
        "first_seen": min(first_seen) if first_seen else None,
        "history_start": history[0]["start"] if history else None,
    }


def window(reader: Reader, ids: list[int], login: Key) -> dict | None:
    """One session's window, found by its login row, in the shape fetch() gives; None if that login is not theirs."""
    found = []
    for uid in ids:
        found += reader.rows(
            f"SELECT {_COLUMNS} FROM co_session WHERE user = ? AND action = ? AND time = ? AND rowid = ?",
            (uid, ACTION_LOGIN, login.time, login.rowid),
        )
    if not found:
        return None
    following = _seek(reader, ids, ACTION_LOGIN, [_after(login)], newest=False)
    bounds = [_after(login)] + ([_before(_key(following))] if following else [])
    logout = _seek(reader, ids, ACTION_LOGOUT, bounds, newest=False)
    ping = None if logout else _seek(reader, ids, ACTION_PING, bounds, newest=True)
    return {"login": found[0], "logout": logout, "ping": ping, "newest": following is None,
            "next_login": following}


def last_event(reader: Reader, ids: list[int]):
    """The newest session row of any kind across a player's ids, or None."""
    rows = []
    for uid in ids:
        rows += reader.rows(
            "SELECT rowid AS rid, time, action FROM co_session WHERE user = ? ORDER BY time DESC, rowid DESC LIMIT 1",
            (uid,),
        )
    return max(rows, key=lambda r: (r["time"], r["rid"])) if rows else None


def is_fresh(event, now: int, ping_seconds: int) -> bool:
    """Whether a player was seen recently enough to call them online. A heuristic."""
    if event is None or ping_seconds <= 0 or event["action"] == ACTION_LOGOUT:
        return False
    return now - event["time"] <= 2 * ping_seconds + FRESH_GRACE_SECONDS


def _point(row, maps: Maps) -> dict:
    return {"time": row["time"], "world": maps.world(row["wid"]), "x": row["x"], "y": row["y"], "z": row["z"]}


def build(raw: dict, maps: Maps, now: int, ping_seconds: int) -> dict:
    sessions = []
    for window in raw["windows"]:
        login, logout, ping = window["login"], window["logout"], window["ping"]
        end = None
        if logout is not None:
            end_kind, end = "logout", _point(logout, maps)
        elif window["newest"] and ping_seconds <= 0:
            end_kind = "unknown"
        elif window["newest"] and is_fresh({**(ping or login), "action": ACTION_PING}, now, ping_seconds):
            end_kind = "open"
        else:
            end_kind = "last_observed"
            end = _point(ping, maps) if ping is not None else None
        if end is not None:
            duration = end["time"] - login["time"]
        elif end_kind == "open":
            duration = max(0, now - login["time"])
        else:
            duration = None
        # The newest row seen in the session, whatever its end: for an open one, its last sighting.
        seen = logout or ping or login
        sessions.append({"start": _point(login, maps), "end": end, "end_kind": end_kind,
                         "duration_seconds": duration, "last_observed": _point(seen, maps), "key": _key(login)})
    return {"sessions": sessions, "first_seen": raw["first_seen"], "history_start": raw["history_start"]}
