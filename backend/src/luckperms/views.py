"""What the staff panel shows of LuckPerms, with what the viewer may change marked on it.

The marks only decide which controls appear; changes.queue_change checks
everything again when a change is made.
"""
from __future__ import annotations

import time

from src.auth import roles
from src.auth.admin import AdminError
from src.auth.players import canonical_uuid
from src.skins.db import connect

from . import changes, mirror, nodes, policy


def _can_change(viewer: dict) -> bool:
    return roles.can(viewer["role"], "change_luckperms")


def _group_summary(group: dict, groups: dict[str, dict], counts: dict[str, int], rules: policy.Policy,
                   now: int) -> dict:
    prefix = mirror.meta_value(group, "prefix", now)
    suffix = mirror.meta_value(group, "suffix", now)
    return {
        "name": group["name"],
        "display_name": group["display_name"],
        "weight": group["weight"],
        "prefix": prefix[1] if prefix else None,
        "suffix": suffix[1] if suffix else None,
        "parents": mirror.parents(group, now),
        "members": counts.get(group["name"], 0),
        "permissions": sum(1 for n in group["nodes"] if nodes.kind(n["key"]) == "permission"),
        "min_role": policy.group_role(rules, groups, group["name"]),
        "patreon": group["name"] in rules.patreon_groups,
    }


def _sorted_groups(groups: dict[str, dict]) -> list[dict]:
    return sorted(groups.values(), key=lambda g: (-(g["weight"] or 0), g["name"]))


def _rights(viewer: dict) -> dict:
    writable = not changes.read_only()
    return {
        "read_only": not writable,
        "change_players": writable and _can_change(viewer),
        "edit_definitions": writable and policy.may_edit_definitions(viewer["role"]),
    }


def overview(viewer: dict) -> dict:
    rules = policy.load()
    now = int(time.time())
    with connect() as conn:
        groups = mirror.load_groups(conn)
        counts = mirror.group_counts(conn)
        tracks = mirror.load_tracks(conn)
        status = mirror.status(conn)
        players = conn.execute("SELECT COUNT(*) FROM lp_users").fetchone()[0]
    return {
        "status": status,
        "players": players,
        "groups": [_group_summary(g, groups, counts, rules, now) for g in _sorted_groups(groups)],
        "tracks": tracks,
        "rights": _rights(viewer),
        "patreon_groups": sorted(rules.patreon_groups),
        "recent": changes.list_changes(limit=20),
    }


def _annotate(node: dict, editable: bool) -> dict:
    return {**node, "kind": nodes.kind(node["key"]), "group": nodes.group_of(node["key"]), "editable": editable}


def group_detail(viewer: dict, name: str) -> dict:
    name = (name or "").strip().lower()
    if not nodes.GROUP_NAME.match(name):
        raise AdminError(400, "bad_group_name", "invalid")
    rules = policy.load()
    now = int(time.time())
    with connect() as conn:
        groups = mirror.load_groups(conn)
        if name not in groups:
            raise AdminError(404, "group_missing", "not_found")
        counts = mirror.group_counts(conn)
        tracks = mirror.load_tracks(conn)
        members = mirror.search_users(conn, "", name, 1)
        status = mirror.status(conn)
    group = groups[name]
    editable = policy.may_edit_definitions(viewer["role"])
    children = sorted(g["name"] for g in groups.values() if name in mirror.parents(g, now))
    return {
        "status": status,
        "group": {
            **_group_summary(group, groups, counts, rules, now),
            "nodes": [_annotate(n, editable) for n in group["nodes"]],
            "inherits": mirror.inherited(groups, [name], now)[1:],
            "children": children,
            "tracks": [t["name"] for t in tracks if name in t["groups"]],
        },
        "members": members,
        "all_groups": [g["name"] for g in _sorted_groups(groups)],
        "rights": _rights(viewer),
        "changes": changes.list_changes("group", name, 20),
        "pending": _pending("group", name),
    }


def _pending(target_type: str, target: str) -> dict | None:
    for change in changes.list_changes(target_type, target, 5):
        if change["status"] in changes.UNFINISHED:
            return change
    return None


def _account(conn, uuid: str) -> dict | None:
    row = conn.execute(
        """
        SELECT dl.discord_user_id, dl.discord_username, u.id AS user_id, u.role
        FROM discord_links dl LEFT JOIN users u ON u.discord_user_id = dl.discord_user_id
        WHERE lower(dl.player_uuid) = ?
        """,
        (uuid,),
    ).fetchone()
    return dict(row) if row else None


def _track_moves(conn, uuid: str, tracks: list[dict], viewer: dict, allowed: bool, now: int) -> list[dict]:
    """Where the player stands on each track, and whether the viewer may move them."""
    held = mirror.user_nodes(conn, uuid)
    out = []
    for track in tracks:
        positions = [track["groups"].index(nodes.group_of(n["key"])) for n in held
                     if n["value"] and not n["contexts"] and nodes.group_of(n["key"]) in track["groups"]]
        moves = {}
        for op in ("promote", "demote"):
            moves[op] = False
            if not allowed:
                continue
            try:
                ops, _ = changes.build_user_ops(conn, uuid, [{"op": op, "track": track["name"]}], now)
                changes.check_ops_allowed(conn, viewer["role"], "user", ops)
                moves[op] = bool(ops)
            except AdminError:
                pass
        out.append({
            "name": track["name"],
            "groups": track["groups"],
            "position": positions[0] if len(positions) == 1 else None,
            "ambiguous": len(positions) > 1,
            "can_promote": moves["promote"],
            "can_demote": moves["demote"],
        })
    return out


def user_detail(viewer: dict, raw_uuid: str) -> dict:
    uuid = canonical_uuid(raw_uuid)
    if uuid is None:
        raise AdminError(400, "bad_uuid", "invalid")
    rules = policy.load()
    now = int(time.time())
    with connect() as conn:
        row = mirror.user_row(conn, uuid)
        if row is None:
            raise AdminError(404, "player_not_found", "not_found")
        groups = mirror.load_groups(conn)
        held = mirror.user_nodes(conn, uuid)
        tracks = mirror.load_tracks(conn)
        status = mirror.status(conn)
        account = _account(conn, uuid)
        allowed = _can_change(viewer) and not changes.read_only()
        if allowed:
            try:
                changes.check_user_target(conn, viewer, uuid)
            except AdminError:
                allowed = False
        track_moves = _track_moves(conn, uuid, tracks, viewer, allowed, now)
    direct = [nodes.group_of(n["key"]) for n in held
              if nodes.group_of(n["key"]) and n["value"] and not n["contexts"] and nodes.active(n, now)]
    rank = mirror.rank_group(groups, held, now)
    rank_group = groups.get(rank) if rank else None
    prefix = mirror.meta_value(rank_group, "prefix", now) if rank_group else None
    return {
        "status": status,
        "player": {
            "uuid": uuid,
            "name": row["name"],
            "rank": rank,
            "rank_prefix": prefix[1] if prefix else None,
            "inherits": mirror.inherited(groups, [d for d in direct if d], now),
            "nodes": [_annotate(n, allowed and policy.may_edit_node(rules, groups, viewer["role"], n)) for n in held],
            "tracks": track_moves,
            "account": account,
        },
        "groups": [{"name": g["name"], "weight": g["weight"],
                    "min_role": policy.group_role(rules, groups, g["name"]),
                    "patreon": g["name"] in rules.patreon_groups,
                    "addable": allowed and policy.may_edit_node(rules, groups, viewer["role"],
                                                                {"key": f"group.{g['name']}"})}
                   for g in _sorted_groups(groups)],
        "rights": {**_rights(viewer), "change_this_player": allowed,
                   "admin_permissions": list(rules.admin_permissions)},
        "changes": changes.list_changes("user", uuid, 20),
        "pending": _pending("user", uuid),
    }


def users(viewer: dict, q: str, group: str | None, page: int) -> dict:
    group = (group or "").strip().lower() or None
    if group is not None and not nodes.GROUP_NAME.match(group):
        raise AdminError(400, "bad_group_name", "invalid")
    now = int(time.time())
    with connect() as conn:
        try:
            listing = mirror.search_users(conn, q, group, page)
        except mirror.SnapshotError as exc:
            raise AdminError(400, exc.code, "invalid") from None
        groups = mirror.load_groups(conn)
        for row in listing["rows"]:
            held = mirror.user_nodes(conn, row["uuid"])
            row["groups"] = [
                {"name": nodes.group_of(n["key"]), "contexts": n["contexts"], "expiry": n["expiry"]}
                for n in held if nodes.group_of(n["key"]) and n["value"] and nodes.active(n, now)
            ]
            row["rank"] = mirror.rank_group(groups, held, now)
    return listing
