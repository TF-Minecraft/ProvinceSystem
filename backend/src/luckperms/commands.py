"""The server's commands and which LuckPerms groups may use them, for the Commands tab.

TFMCWeb publishes the whole list; it replaces the stored one. Access is
decided on the server from each command's own permission, so plugins may
still refuse a command when it runs.
"""
from __future__ import annotations

import time

import psycopg

from src import database

from . import mirror, nodes

GROUPS_MAX = 200
PLUGINS_MAX = 500
COMMANDS_MAX = 10_000
ALIASES_MAX = 64
NAME_MAX = 64
TEXT_MAX = 300
PERMISSION_MAX = 2048
# TFMCWeb resends at least every ten minutes.
FRESH_SECONDS = 30 * 60
KIND_ORDER = {"rank": 0, "staff": 1, "step": 2}
# The order store() writes a command's fields in; jsonb keeps its own order.
COMMAND_FIELDS = ("plugin", "name", "aliases", "description", "usage", "permission", "shadowed", "access")


class CommandsError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _text(raw, limit: int, *, required: bool = False) -> str | None:
    if raw is None and not required:
        return None
    if not isinstance(raw, str) or not raw or len(raw) > limit:
        raise CommandsError("bad_commands")
    return raw


def _command(raw, plugins: set[str], groups: int) -> dict:
    if not isinstance(raw, dict):
        raise CommandsError("bad_commands")
    aliases = raw.get("aliases")
    if not isinstance(aliases, list) or len(aliases) > ALIASES_MAX:
        raise CommandsError("bad_commands")
    plugin = _text(raw.get("plugin"), NAME_MAX, required=True)
    if plugin not in plugins or not isinstance(raw.get("shadowed"), bool):
        raise CommandsError("bad_commands")
    permission = _text(raw.get("permission"), PERMISSION_MAX)
    access = raw.get("access")
    if permission is None:
        if access is not None:
            raise CommandsError("bad_commands")
    elif not isinstance(access, str) or len(access) != groups or access.strip("yn"):
        raise CommandsError("bad_commands")
    return {
        "plugin": plugin,
        "name": _text(raw.get("name"), NAME_MAX, required=True),
        "aliases": [_text(a, NAME_MAX, required=True) for a in aliases],
        "description": _text(raw.get("description"), TEXT_MAX),
        "usage": _text(raw.get("usage"), TEXT_MAX),
        "permission": permission,
        "shadowed": raw["shadowed"],
        "access": access,
    }


def store(payload) -> dict:
    if not isinstance(payload, dict):
        raise CommandsError("bad_commands")
    groups, plugins, commands = payload.get("groups"), payload.get("plugins"), payload.get("commands")
    if (not isinstance(groups, list) or not isinstance(plugins, list) or not isinstance(commands, list)
            or len(groups) > GROUPS_MAX or len(plugins) > PLUGINS_MAX or len(commands) > COMMANDS_MAX):
        raise CommandsError("bad_commands")
    group_names = [_text(g, NAME_MAX * 2, required=True).lower() for g in groups]
    plugin_rows = []
    for raw in plugins:
        if not isinstance(raw, dict):
            raise CommandsError("bad_commands")
        plugin_rows.append({"name": _text(raw.get("name"), NAME_MAX, required=True),
                            "version": _text(raw.get("version"), NAME_MAX)})
    names = {p["name"] for p in plugin_rows}
    command_rows = [_command(raw, names, len(group_names)) for raw in commands]
    generated_at = payload.get("generated_at")
    if not isinstance(generated_at, int) or isinstance(generated_at, bool) or generated_at <= 0:
        raise CommandsError("bad_commands")
    server = _text(payload.get("server"), 32, required=True)
    snapshot_hash = _text(payload.get("hash"), 128)
    body = {"groups": group_names, "plugins": plugin_rows, "commands": command_rows}
    try:
        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO lp_commands (id, server, hash, generated_at, received_at, payload)
                VALUES (1, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET server = excluded.server, hash = excluded.hash,
                    generated_at = excluded.generated_at, received_at = excluded.received_at,
                    payload = excluded.payload
                """,
                (server, snapshot_hash, generated_at, mirror._stamp(), database.Jsonb(body)),
            )
    except psycopg.DataError:
        # What Postgres cannot store: a NUL in a text, a time past bigint.
        raise CommandsError("bad_commands") from None
    return {"ok": True, "commands": len(command_rows)}


def _kinds(tracks: list[dict]) -> dict[str, tuple[str, str]]:
    """A track's last group is a staff rank; the groups before it are its steps."""
    out: dict[str, tuple[str, str]] = {}
    for track in tracks:
        if not track["groups"]:
            continue
        *steps, last = track["groups"]
        out[last] = ("staff", track["name"])
        for step in steps:
            out.setdefault(step, ("step", track["name"]))
    return out


def view(viewer: dict) -> dict:
    now = int(time.time())
    with database.transaction(isolation="repeatable read", read_only=True) as conn:
        row = conn.execute(
            "SELECT server, generated_at, received_at, payload FROM lp_commands WHERE id = 1").fetchone()
        if row is None:
            return {"status": None, "groups": [], "plugins": []}
        groups = mirror.load_groups(conn)
        counts = mirror.group_counts(conn)
        tracks = mirror.load_tracks(conn)
    data = row["payload"]
    kinds = _kinds(tracks)
    listed = []
    for index, name in enumerate(data["groups"]):
        group = groups.get(name, {"name": name, "display_name": None, "weight": None, "nodes": []})
        kind, track = kinds.get(name, ("rank", None))
        listed.append((index, {
            "name": name,
            "display_name": group["display_name"],
            "weight": group["weight"],
            "members": counts.get(name, 0),
            "kind": kind,
            "track": track,
            "parents": mirror.parents(group, now),
            "nodes": [n for n in group["nodes"] if nodes.kind(n["key"]) == "permission"],
        }))
    listed.sort(key=lambda item: (KIND_ORDER[item[1]["kind"]], item[1]["weight"] or 0, item[1]["name"]))
    order = [index for index, _ in listed]
    plugins: dict[str, dict] = {p["name"]: {**p, "commands": []} for p in data["plugins"]}
    for command in data["commands"]:
        access = command["access"]
        plugins[command["plugin"]]["commands"].append({
            **{k: command[k] for k in COMMAND_FIELDS if k != "plugin"},
            "access": None if access is None else "".join(access[i] for i in order),
        })
    for plugin in plugins.values():
        plugin["commands"].sort(key=lambda c: (c["name"], c["shadowed"]))
    received = mirror._age(row["received_at"], time.time())
    return {
        "status": {
            "server": row["server"],
            "generated_at": row["generated_at"],
            "received_at": mirror._iso(row["received_at"]),
            "fresh": received is not None and received <= FRESH_SECONDS,
        },
        "groups": [group for _, group in listed],
        "plugins": sorted((p for p in plugins.values() if p["commands"]), key=lambda p: p["name"].lower()),
    }
