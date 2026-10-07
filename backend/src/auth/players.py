"""Staff view of Minecraft players: a directory, profiles, sessions, activity and movement.

A player is a Minecraft account, keyed by its UUID; names are never merged
on. The directory is the union of everyone CoreProtect has seen join, every
Discord link and every character, so it still lists linked players and
characters when CoreProtect cannot be read. Each section reports whether its
source was available, so "unavailable" never looks like "no history".

Discord links can change, so nothing here grants account actions; those stay
with the account routes, which check the target afresh.
"""
from __future__ import annotations

import threading
import time
import uuid as uuidlib

from src.coreprotect import activity, maps as co_maps, movement, sessions
from src.coreprotect.cursors import BadCursor, decode as decode_cursor, encode as encode_cursor
from src.coreprotect.reader import REQUEST_BUDGET_SECONDS, Budget, CoreProtectConfig, Reader, Unavailable
from src.skins.db import connect

from . import audit, discord_names, roles, users

DIRECTORY_TTL_SECONDS = 60
PAGE_SIZE = 50
QUERY_MAX = 64
VIEWS = ("activity", "discord", "minecraft", "character")

_DIRECTORY_LOCK = threading.Lock()
_DIRECTORY: dict[tuple[str, str], tuple[float, list[dict], dict]] = {}


class PlayerError(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


def canonical_uuid(text: str | None) -> str | None:
    try:
        return str(uuidlib.UUID(str(text or "").strip()))
    except ValueError:
        return None


def _status(error: Unavailable | None) -> dict:
    return {"status": "unavailable", "reason": error.code} if error else {"status": "available"}


# --------------------
# province.db
# --------------------

_LINKS = """
    SELECT dl.player_uuid, dl.discord_user_id, dl.discord_username, dl.discord_nickname, dl.minecraft_name,
           dl.linked_at, dl.left_guild_at, dl.grace_until,
           u.id AS user_id, u.role, u.discord_username AS account_username,
           u.discord_global_name, u.discord_avatar, u.created_at AS account_created_at, u.last_login_at
    FROM discord_links dl LEFT JOIN users u ON u.discord_user_id = dl.discord_user_id
"""
_ROSTER = """
    SELECT player_uuid, realm_id, character_id, name, status, race, class, updated_at
    FROM character_roster
"""


def _site_rows(key: str | None = None) -> tuple[list[dict], list[dict]]:
    """Discord links (with any website account) and characters, for one player or everyone."""
    with connect() as conn:
        if key is None:
            links = conn.execute(_LINKS).fetchall()
            roster = conn.execute(f"{_ROSTER} ORDER BY realm_id, lower(name)").fetchall()
        else:
            links = conn.execute(f"{_LINKS} WHERE lower(dl.player_uuid) = ?", (key,)).fetchall()
            roster = conn.execute(f"{_ROSTER} WHERE lower(player_uuid) = ? ORDER BY realm_id, lower(name)",
                                  (key,)).fetchall()
    return [dict(r) for r in links], [dict(r) for r in roster]


def _discord(link: dict | None) -> dict | None:
    if not link:
        return None
    return {
        "discord_user_id": link["discord_user_id"],
        # The account handle (from their sign-in, else the link) and their server nickname.
        "discord_username": link["account_username"] or link["discord_username"],
        "discord_nickname": link["discord_nickname"],
        "linked_at": link["linked_at"],
        "left_guild_at": link["left_guild_at"],
        "grace_until": link["grace_until"],
    }


def _account(link: dict | None) -> dict | None:
    if not link or link.get("user_id") is None:
        return None
    return {
        "user_id": link["user_id"],
        "role": link["role"],
        "discord_global_name": link["discord_global_name"],
        "avatar_url": users.avatar_url(link),
        "created_at": link["account_created_at"],
        "last_login_at": link["last_login_at"],
    }


# --------------------
# Directory
# --------------------

def _read_directory(config: CoreProtectConfig) -> tuple[dict[str, dict], Unavailable | None]:
    """CoreProtect's players, keyed by UUID. A whole-table read of co_user and co_username_log
    (a few hundred rows each), then one indexed seek per player for the last session row."""
    now = int(time.time())
    try:
        with Reader(config, Budget()) as reader:
            accounts = reader.rows("SELECT id, user, uuid, time FROM co_user WHERE uuid IS NOT NULL")
            history = reader.rows("SELECT uuid, user FROM co_username_log")
            found: dict[str, dict] = {}
            for row in accounts:
                key = canonical_uuid(row["uuid"])
                if key is None:
                    continue
                entry = found.setdefault(key, {"ids": [], "minecraft_name": row["user"], "names": set()})
                entry["ids"].append(row["id"])
                entry["names"].add(row["user"])
            for row in history:
                key = canonical_uuid(row["uuid"])
                if key in found and row["user"]:
                    found[key]["names"].add(row["user"])
            for entry in found.values():
                event = sessions.last_event(reader, entry["ids"])
                entry["last_seen"] = event["time"] if event else None
                entry["online"] = sessions.is_fresh(event, now, config.ping_seconds)
        return found, None
    except Unavailable as exc:
        return {}, exc


def _build_directory(config: CoreProtectConfig) -> tuple[list[dict], dict]:
    played, error = _read_directory(config)
    links, roster = _site_rows()
    people: dict[str, dict] = {}

    def person(key: str) -> dict:
        return people.setdefault(key, {
            "uuid": key, "minecraft_name": None, "names": set(), "discord_user_id": None,
            "discord_username": None, "discord_nickname": None, "discord_global_name": None, "site_role": None,
            "characters": [], "last_seen": None, "online": False,
        })

    for key, seen in played.items():
        entry = person(key)
        entry.update(minecraft_name=seen["minecraft_name"], last_seen=seen["last_seen"], online=seen["online"])
        entry["names"] |= seen["names"]
    for link in links:
        key = canonical_uuid(link["player_uuid"])
        if key is None:
            continue
        entry = person(key)
        entry["minecraft_name"] = entry["minecraft_name"] or link["minecraft_name"]
        if link["minecraft_name"]:
            entry["names"].add(link["minecraft_name"])
        entry.update(
            discord_user_id=link["discord_user_id"],
            discord_username=link["account_username"] or link["discord_username"],
            discord_nickname=link["discord_nickname"],
            discord_global_name=link["discord_global_name"],
            site_role=link["role"],
        )
    for character in roster:
        key = canonical_uuid(character["player_uuid"])
        # Only this server's characters: the site's CoreProtect server name is also its realm id,
        # and other realms' characters (the tutorial server's) would sit beside activity from here.
        if key is None or not character["name"] or character["realm_id"] != config.server:
            continue
        person(key)["characters"].append({
            "character_id": character["character_id"],
            "name": character["name"],
            "status": (character["status"] or "").lower() or None,
            "race": character["race"],
            "class": character["class"],
        })
    return list(people.values()), _status(error)


def _directory(config: CoreProtectConfig) -> tuple[list[dict], dict]:
    key = (config.server, config.path or "")
    cached = _DIRECTORY.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1], cached[2]
    # One build at a time; it holds no CoreProtect connection while others wait.
    if not _DIRECTORY_LOCK.acquire(timeout=REQUEST_BUDGET_SECONDS * 2):
        raise PlayerError(503, "directory_busy")
    try:
        cached = _DIRECTORY.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1], cached[2]
        entries, status = _build_directory(config)
        # A degraded build is not cached, so the next request tries CoreProtect again.
        if status["status"] == "available" or not config.path:
            _DIRECTORY[key] = (time.monotonic() + DIRECTORY_TTL_SECONDS, entries, status)
        return entries, status
    finally:
        _DIRECTORY_LOCK.release()


def _player_matches(entry: dict, needle: str) -> bool:
    """The player themselves: UUID, Discord ID, any Minecraft name they have used, their Discord names."""
    if needle in {entry["uuid"], entry["uuid"].replace("-", ""), (entry["discord_user_id"] or "")}:
        return True
    haystack = [*entry["names"], entry["discord_username"], entry["discord_nickname"], entry["discord_global_name"]]
    return any(needle in value.casefold() for value in haystack if value)


def _character_matches(character: dict, needle: str) -> bool:
    return needle in character["name"].casefold()


def _last_seen_key(e: dict):
    return (e["last_seen"] is None, -(e["last_seen"] or 0), (e["minecraft_name"] or "").casefold(), e["uuid"])


def _minecraft_key(e: dict):
    return (e["minecraft_name"] is None, (e["minecraft_name"] or "").casefold(), e["uuid"])


def _discord_key(e: dict):
    # By handle, else server nickname (links older than handles may have only the nickname).
    name = e["discord_username"] or e["discord_nickname"]
    return (not name, (name or "").casefold(), e["uuid"])


def _player_json(entry: dict) -> dict:
    current = (entry["minecraft_name"] or "").casefold()
    return {
        "uuid": entry["uuid"],
        "minecraft_name": entry["minecraft_name"],
        # Other names this account has gone by; CoreProtect's log gives no reliable order.
        "aliases": sorted((n for n in entry["names"] if n.casefold() != current), key=str.casefold),
        "discord_user_id": entry["discord_user_id"],
        "discord_username": entry["discord_username"],
        "discord_nickname": entry["discord_nickname"],
        "site_role": entry["site_role"],
        "characters": [c["name"] for c in entry["characters"]],
        "last_seen": entry["last_seen"],
        "online": entry["online"],
    }


def _rows(view: str, entries: list[dict], needle: str) -> tuple[list[tuple[dict, dict | None]], int]:
    """The view's rows, as (player, character) pairs in order, and how many matching players it leaves out."""
    if view == "character":
        # One row per character. A search for a character finds that character, not their siblings;
        # a search for the player finds all of theirs.
        rows = []
        omitted = 0
        for entry in entries:
            whole = not needle or _player_matches(entry, needle)
            if not entry["characters"]:
                omitted += whole
                continue
            rows += [(entry, c) for c in entry["characters"] if whole or _character_matches(c, needle)]
        rows.sort(key=lambda r: (r[1]["name"].casefold(), r[1]["name"], r[0]["uuid"], r[1]["character_id"]))
        return rows, omitted
    chosen = [e for e in entries if not needle or _player_matches(e, needle)
              or any(_character_matches(c, needle) for c in e["characters"])]
    if view == "discord":
        linked = [e for e in chosen if e["discord_user_id"]]
        return [(e, None) for e in sorted(linked, key=_discord_key)], len(chosen) - len(linked)
    key = _minecraft_key if view == "minecraft" else _last_seen_key
    return [(e, None) for e in sorted(chosen, key=key)], 0


def _row_json(player: dict, character: dict | None) -> dict:
    if character is None:
        return _player_json(player)
    return {"character": dict(character), "player": _player_json(player)}


def directory(config: CoreProtectConfig, query: str = "", view: str = "activity", page: int = 1) -> dict:
    if view not in VIEWS:
        raise PlayerError(400, "bad_view")
    text = " ".join((query or "").split()).lstrip("@")
    if len(text) > QUERY_MAX:
        raise PlayerError(400, "query_too_long")
    entries, status = _directory(config)
    rows, omitted = _rows(view, entries, text.casefold())
    page = max(1, page)
    start = (page - 1) * PAGE_SIZE
    return {
        "view": view,
        "rows": [_row_json(*row) for row in rows[start:start + PAGE_SIZE]],
        "total": len(rows),
        # Matching players with no row here: unlinked ones in the Discord view, those without
        # a character in the Character view.
        "omitted": omitted,
        "page": page,
        "page_size": PAGE_SIZE,
        "coreprotect": {**status, "server_label": config.label or None},
    }


def clear_cache() -> None:
    _DIRECTORY.clear()


# --------------------
# Profile, sessions, activity
# --------------------

def _ids(reader: Reader, key: str) -> list[dict]:
    """A player's co_user rows, oldest first. CoreProtect keeps one per UUID, but nothing enforces it.

    Matched without regard to letter case, as `key` is canonical (lower case) and the stored UUID
    need not be. That scans co_user, one of the small name tables.
    """
    return [dict(r) for r in reader.rows(
        "SELECT id, user, time FROM co_user WHERE lower(uuid) = ? ORDER BY time, id", (key,))]


def _require(text: str) -> str:
    key = canonical_uuid(text)
    if key is None:
        raise PlayerError(400, "bad_uuid")
    return key


def profile(config: CoreProtectConfig, text: str) -> dict:
    key = _require(text)
    now = int(time.time())
    error = None
    accounts: list[dict] = []
    names: list[dict] = []
    event = first_seen = None
    try:
        with Reader(config, Budget()) as reader:
            accounts = _ids(reader, key)
            if accounts:
                ids = [a["id"] for a in accounts]
                names = [dict(r) for r in reader.rows(
                    "SELECT user, time FROM co_username_log WHERE uuid = ? ORDER BY time, id", (key,))]
                event = sessions.last_event(reader, ids)
                first = [r["first"] for uid in ids for r in reader.rows(
                    "SELECT MIN(time) AS first FROM co_session WHERE user = ?", (uid,)) if r["first"] is not None]
                first_seen = min(first) if first else None
    except Unavailable as exc:
        error = exc
    links, roster = _site_rows(key)
    # A link whose handle is unknown: ask Discord now (with a bot token), so the profile shows it.
    if links and not (links[0]["account_username"] or links[0]["discord_username"]):
        if discord_names.refresh_one(links[0]["discord_user_id"]):
            links, roster = _site_rows(key)
    if not accounts and not links and not roster and error is None:
        raise PlayerError(404, "player_not_found")
    link = links[0] if links else None
    current = accounts[-1]["user"] if accounts else (link["minecraft_name"] if link else None)
    return {
        "uuid": key,
        "minecraft_name": current,
        "past_names": [{"name": n["user"], "time": n["time"]} for n in names if n["user"] != current],
        "first_seen": first_seen,
        "last_seen": event["time"] if event else None,
        "online": sessions.is_fresh(event, now, config.ping_seconds),
        "discord": _discord(link),
        "account": _account(link),
        "characters": [
            {k: c[k] for k in ("realm_id", "character_id", "name", "status", "race", "class", "updated_at")}
            for c in roster
        ],
        "coreprotect": {**_status(error), "server_label": config.label or None,
                        "ping_seconds": config.ping_seconds or None},
    }


def player_sessions(config: CoreProtectConfig, text: str, before: str | None, limit: int) -> dict:
    key = _require(text)
    try:
        values = decode_cursor(config.server, f"sessions:{key}", before, 2)
    except BadCursor:
        raise PlayerError(400, "bad_cursor") from None
    try:
        with Reader(config, Budget()) as reader:
            ids = [a["id"] for a in _ids(reader, key)]
            maps = co_maps.get(reader)
            raw = sessions.fetch(reader, ids, sessions.Key(*values) if values else None, limit) if ids else None
    except Unavailable as exc:
        return {"sessions": [], "next": None, "coreprotect": _status(exc)}
    if raw is None:
        return {"sessions": [], "next": None, "coreprotect": _status(None)}
    built = sessions.build(raw, maps, int(time.time()), config.ping_seconds)
    built["sessions"] = [_session_json(config, key, s) for s in built["sessions"]]
    nxt = raw["next"]
    return {
        **built,
        "next": encode_cursor(config.server, f"sessions:{key}", nxt.time, nxt.rowid) if nxt else None,
        "coreprotect": _status(None),
    }


def _session_json(config: CoreProtectConfig, key: str, session: dict) -> dict:
    """A built session with an opaque id (its login row) in place of the raw key."""
    login = session.pop("key")
    return {"id": encode_cursor(config.server, f"session:{key}", login.time, login.rowid), **session}


def _audit_messages(viewer: dict, config: CoreProtectConfig, key: str, kinds: tuple[str, ...],
                    before: str | None, entries: list[dict]) -> None:
    """Record that a viewer was shown a player's chat or whole commands, before they see it.

    Never stores the text itself: only which rows were returned.
    """
    shown = [e for e in entries if e["kind"] in activity.MESSAGE_KINDS]
    if not shown:
        return
    detail = {
        "player_uuid": key,
        "server": config.server,
        "kinds": sorted(kinds),
        "paged": before is not None,
        "rows": len(shown),
        "newest": {"id": shown[0]["id"], "time": shown[0]["time"]},
        "oldest": {"id": shown[-1]["id"], "time": shown[-1]["time"]},
    }
    try:
        with connect() as conn:
            audit.record(conn, actor=viewer, action="player.messages.view", outcome="ok", detail=detail)
            conn.commit()
    except Exception:
        raise PlayerError(503, "audit_unavailable") from None


def player_activity(config: CoreProtectConfig, text: str, before: str | None, limit: int,
                    kinds: str | None, viewer: dict | None = None) -> dict:
    key = _require(text)
    full = bool(viewer) and roles.can(viewer["role"], "view_player_messages")
    allowed = activity.FULL_KINDS if full else activity.KINDS
    try:
        chosen = activity.parse_kinds(kinds, allowed)
    except ValueError:
        raise PlayerError(400, "bad_kinds") from None
    try:
        cursor = activity.decode_cursor(f"{config.server}:{key}", before)
    except BadCursor:
        raise PlayerError(400, "bad_cursor") from None
    try:
        with Reader(config, Budget()) as reader:
            ids = [a["id"] for a in _ids(reader, key)]
            maps = co_maps.get(reader)
            raw = activity.fetch(reader, maps, ids, chosen, cursor, limit, full_text=full) if ids else None
    except Unavailable as exc:
        return {"entries": [], "next": None, "searched_to": None, "kinds": list(allowed),
                "shows_messages": full, "coreprotect": _status(exc)}
    if raw is None:
        return {"entries": [], "next": None, "searched_to": None, "kinds": list(allowed),
                "shows_messages": full, "coreprotect": _status(None)}
    built = activity.build(raw, maps, f"{config.server}:{key}")
    # CoreProtect is closed by now; the view is on record before the response leaves.
    if full:
        _audit_messages(viewer, config, key, chosen, before, built["entries"])
    return {**built, "kinds": list(allowed), "shows_messages": full, "coreprotect": _status(None)}



def _window(since: int | None, until: int | None, longest: int) -> tuple[int, int]:
    try:
        return movement.window(since, until, int(time.time()), longest)
    except movement.BadWindow:
        raise PlayerError(400, "bad_window") from None


def _movement_status(config: CoreProtectConfig, error: Unavailable | None) -> dict:
    return {**_status(error), "server_label": config.label or None, "ping_seconds": config.ping_seconds or None,
            "map_world": config.map_world}


def _audit_movement(viewer: dict, config: CoreProtectConfig, subject: str, since: int, until: int,
                    body: dict, rows: int, session: str | None = None) -> None:
    """Record that a viewer was shown where players went, before they see it. Never stores positions."""
    detail = {
        "server": config.server,
        "player_uuid": subject,
        "since": since,
        "until": until,
        "complete_from": body["complete_from"],
        "rows": rows,
    }
    if session is not None:
        detail["session"] = session
    try:
        with connect() as conn:
            audit.record(conn, actor=viewer, action="player.movement.view", outcome="ok", detail=detail)
            conn.commit()
    except Exception:
        raise PlayerError(503, "audit_unavailable") from None


def player_movement(config: CoreProtectConfig, text: str, since: int | None, until: int | None,
                    viewer: dict) -> dict:
    """One player's logins, logouts and pings between since and until (epoch seconds). Audited."""
    key = _require(text)
    since, until = _window(since, until, movement.PLAYER_WINDOW_SECONDS)
    empty = {"since": since, "until": until, "worlds": [], "points": [], "complete_from": since,
             "pings_since": None}
    try:
        with Reader(config, Budget()) as reader:
            ids = [a["id"] for a in _ids(reader, key)]
            maps = co_maps.get(reader)
            raw = (movement.fetch_player(reader, ids, since, until, movement.lead_seconds(config.ping_seconds))
                   if ids else None)
    except Unavailable as exc:
        return {**empty, "coreprotect": _movement_status(config, exc)}
    body = {**empty, **movement.build_player(raw, maps)} if raw else empty
    _audit_movement(viewer, config, key, since, until, body, len(body["points"]))
    return {**body, "as_of": int(time.time()), "coreprotect": _movement_status(config, None)}


def session_movement(config: CoreProtectConfig, text: str, session_id: str, viewer: dict) -> dict:
    """One session's movement: the session as /sessions describes it, and its rows from login to end. Audited."""
    key = _require(text)
    try:
        values = decode_cursor(config.server, f"session:{key}", session_id, 2)
    except BadCursor:
        raise PlayerError(400, "bad_session") from None
    if values is None:
        raise PlayerError(400, "bad_session")
    now = int(time.time())
    try:
        with Reader(config, Budget()) as reader:
            ids = [a["id"] for a in _ids(reader, key)]
            maps = co_maps.get(reader)
            win = sessions.window(reader, ids, sessions.Key(*values)) if ids else None
            raw = movement.fetch_session(reader, ids, win) if win else None
    except Unavailable as exc:
        return {"session": None, "worlds": [], "points": [], "complete_from": None, "pings_since": None,
                "as_of": now, "coreprotect": _movement_status(config, exc)}
    if win is None:
        # Never theirs, or no longer there (a purge, or a rebuilt database renumbering rows).
        raise PlayerError(404, "session_gone")
    built = sessions.build({"windows": [win], "first_seen": None, "history_start": None}, maps, now,
                           config.ping_seconds)
    session = _session_json(config, key, built["sessions"][0])
    # The span shown: from the login (or, if the session held too many rows, from where the kept rows
    # are complete) to its logout, its last sighting, or now while it is open. An open session has no end.
    since = session["start"]["time"]
    if session["end_kind"] == "open":
        until = now
    else:
        until = (session["end"] or session["last_observed"])["time"]
    body = {"session": session, "since": since, "until": max(since, until), **movement.build_player(raw, maps)}
    _audit_movement(viewer, config, key, since, body["until"], body, len(body["points"]), session=session_id)
    return {**body, "as_of": now, "coreprotect": _movement_status(config, None)}


def everyone_movement(config: CoreProtectConfig, since: int | None, until: int | None, viewer: dict) -> dict:
    """Every player's logins, logouts and pings between since and until (epoch seconds). Audited."""
    since, until = _window(since, until, movement.EVERYONE_WINDOW_SECONDS)
    try:
        with Reader(config, Budget()) as reader:
            maps = co_maps.get(reader)
            raw = movement.fetch_everyone(reader, since, until, movement.lead_seconds(config.ping_seconds))
    except Unavailable as exc:
        return {"since": since, "until": until, "worlds": [], "players": [], "complete_from": since,
                "pings_since": None, "coreprotect": _movement_status(config, exc)}
    body = {"since": since, "until": until, "as_of": int(time.time()), **movement.build_everyone(raw, maps)}
    _audit_movement(viewer, config, "everyone", since, until, body, sum(len(p["points"]) for p in body["players"]))
    return {**body, "coreprotect": _movement_status(config, None)}
