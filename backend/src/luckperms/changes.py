"""LuckPerms changes staff queue for the TFMCWeb bridge.

A change is checked against the mirror and the actor's rights inside one
immediate transaction, which also reloads the actor's session, so a demotion
that lands first always wins. The change row and its audit row commit
together; a refused attempt rolls back and is then logged on its own.

Only one unfinished change per target is allowed, so every change is checked
against the state it will actually meet. The bridge checks the same
preconditions again against live LuckPerms before it saves anything.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

from src.auth import audit, roles
from src.auth.admin import AdminError, clean_reason
from src.auth.players import canonical_uuid
from src.auth.users import session_user_in
from src.skins.db import connect

from . import mirror, nodes, policy

OPS_MAX = 20
TRACK_GROUPS_MAX = 32
DESCRIPTION_MAX = 300
FETCH_LIMIT = 20
# Unfetched changes are dropped after this; staff queued them against an old view.
PENDING_TTL_SECONDS = 600
# A sent change is never offered again; with no result by then its outcome is unknown.
RESULT_WAIT_SECONDS = 300
HISTORY_LIMIT = 50

USER_OPS = {"add_node", "remove_node", "promote", "demote"}
GROUP_OPS = {"add_node", "remove_node", "create_group", "delete_group"}
TRACK_OPS = {"create_track", "delete_track", "set_groups"}
UNFINISHED = ("pending", "sent")


def read_only() -> bool:
    """dev.tfminecraft.net shows LuckPerms but must not change it: Dev shares Main's storage."""
    return os.environ.get("LUCKPERMS_READ_ONLY", "").strip().lower() in {"1", "true", "yes"}


def _now() -> int:
    return int(time.time())


def _iso(ts: float | None = None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(stamp: str) -> float:
    return datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def _bad(code: str) -> AdminError:
    return AdminError(400, code, "invalid")


def _conflict(code: str) -> AdminError:
    return AdminError(409, code, "conflict")


def _forbidden(code: str = "forbidden") -> AdminError:
    return AdminError(403, code, "denied")


def _node(raw, *, new: bool) -> dict:
    try:
        return nodes.from_request(raw, new=new)
    except nodes.NodeError as exc:
        raise _bad(exc.code) from None


def _find(holder: list[dict], node: dict) -> int | None:
    for index, held in enumerate(holder):
        if nodes.same(held, node):
            return index
    return None


def _inherits(groups: dict[str, dict], start: str, wanted: str, now: int) -> bool:
    return wanted in mirror.inherited(groups, [start], now)


# --------------------
# Building ops
# --------------------


def _node_ops(holder: list[dict], raw_op: dict, groups: dict[str, dict], now: int, *, self_group: str | None = None):
    """Check one add/remove against the holder's simulated nodes and apply it there."""
    op = raw_op["op"]
    node = _node(raw_op.get("node"), new=op == "add_node")
    group = nodes.group_of(node["key"])
    if op == "add_node":
        if _find(holder, node) is not None:
            raise _conflict("node_exists")
        if group is not None:
            if group not in groups:
                raise _conflict("group_missing")
            if self_group is not None and node["value"] and (
                    group == self_group or _inherits(groups, group, self_group, now)):
                raise _conflict("inheritance_cycle")
        holder.append(node)
        return {"op": "add_node", "node": node}, nodes.describe(node)
    index = _find(holder, node)
    if index is None:
        raise _conflict("node_missing")
    holder.pop(index)
    return {"op": "remove_node", "node": node}, nodes.describe_removal(node)


def _track_step(holder: list[dict], track: dict, direction: int):
    """Promote (+1) or demote (-1) along a track in the global context, as explicit node ops."""
    positions = [
        (index, held) for held in holder
        if held["value"] and not held["contexts"] and nodes.group_of(held["key"]) in track["groups"]
        for index in [track["groups"].index(nodes.group_of(held["key"]))]
    ]
    if len(positions) > 1:
        raise _conflict("ambiguous_track")
    steps = []
    if not positions:
        if direction < 0:
            raise _conflict("not_on_track")
        if not track["groups"]:
            raise _conflict("track_empty")
        target = track["groups"][0]
    else:
        index, held = positions[0]
        holder.remove(held)
        steps.append({"op": "remove_node", "node": held})
        target_index = index + direction
        if target_index >= len(track["groups"]):
            raise _conflict("track_end")
        target = track["groups"][target_index] if target_index >= 0 else None
    if target is not None:
        added = {"key": f"group.{target}", "value": True, "contexts": {}, "expiry": 0}
        if _find(holder, added) is None:
            holder.append(added)
            steps.append({"op": "add_node", "node": added})
    return steps


def build_user_ops(conn, uuid: str, raw_ops: list, now: int) -> tuple[list[dict], list[str]]:
    groups = mirror.load_groups(conn)
    tracks = {t["name"]: t for t in mirror.load_tracks(conn)}
    holder = mirror.user_nodes(conn, uuid)
    ops, words = [], []
    for raw in raw_ops:
        if raw["op"] in ("promote", "demote"):
            track = tracks.get(str(raw.get("track") or "").lower())
            if track is None:
                raise _conflict("track_missing")
            steps = _track_step(holder, track, 1 if raw["op"] == "promote" else -1)
            ops.extend(steps)
            words.append(f"{raw['op']} {track['name']}")
        else:
            op, word = _node_ops(holder, raw, groups, now)
            ops.append(op)
            words.append(word)
    return ops, words


def build_group_ops(conn, name: str, raw_ops: list, now: int) -> tuple[list[dict], list[str]]:
    groups = mirror.load_groups(conn)
    exists = name in groups
    holder = list(groups[name]["nodes"]) if exists else []
    ops, words = [], []
    for raw in raw_ops:
        op = raw["op"]
        if op == "create_group":
            if exists:
                raise _conflict("group_exists")
            exists = True
            groups[name] = {"name": name, "display_name": None, "weight": None, "nodes": holder}
            ops.append({"op": "create_group"})
            words.append("create")
            continue
        if not exists:
            raise _conflict("group_missing")
        if op == "delete_group":
            if name == "default":
                raise _forbidden("cannot_delete_default")
            exists = False
            ops.append({"op": "delete_group"})
            words.append("delete")
            continue
        op_json, word = _node_ops(holder, raw, groups, now, self_group=name)
        groups[name]["nodes"] = holder
        ops.append(op_json)
        words.append(word)
    return ops, words


def build_track_ops(conn, name: str, raw_ops: list) -> tuple[list[dict], list[str]]:
    groups = mirror.load_groups(conn)
    exists = any(t["name"] == name for t in mirror.load_tracks(conn))
    ops, words = [], []
    for raw in raw_ops:
        op = raw["op"]
        if op == "create_track":
            if exists:
                raise _conflict("track_exists")
            exists = True
            ops.append({"op": "create_track"})
            words.append("create")
            continue
        if not exists:
            raise _conflict("track_missing")
        if op == "delete_track":
            exists = False
            ops.append({"op": "delete_track"})
            words.append("delete")
            continue
        listed = raw.get("groups")
        if not isinstance(listed, list) or len(listed) > TRACK_GROUPS_MAX:
            raise _bad("bad_track_groups")
        clean = [str(g).strip().lower() for g in listed if isinstance(g, str)]
        if len(clean) != len(listed) or len(set(clean)) != len(clean):
            raise _bad("bad_track_groups")
        if any(g not in groups for g in clean):
            raise _conflict("group_missing")
        ops.append({"op": "set_groups", "groups": clean})
        words.append("set " + " ".join(clean) if clean else "clear")
    return ops, words


# --------------------
# Rights
# --------------------


def _linked_uuid(conn, discord_user_id: str | None) -> str | None:
    if not discord_user_id:
        return None
    row = conn.execute("SELECT player_uuid FROM discord_links WHERE discord_user_id = ?", (discord_user_id,)).fetchone()
    return canonical_uuid(row["player_uuid"]) if row else None


def _target_account_role(conn, uuid: str) -> str | None:
    row = conn.execute(
        "SELECT u.role FROM discord_links dl JOIN users u ON u.discord_user_id = dl.discord_user_id "
        "WHERE lower(dl.player_uuid) = ?",
        (uuid,),
    ).fetchone()
    return row["role"] if row else None


def _holds_root_only_group(conn, uuid: str, groups: dict[str, dict]) -> bool:
    """Whether the player holds, in any context, a group only root may manage: in-game staff."""
    rules = policy.load()
    for node in mirror.user_nodes(conn, uuid):
        group = nodes.group_of(node["key"])
        if group and node["value"] and policy.group_role(rules, groups, group) == "root":
            return True
    return False


def check_user_target(conn, actor: dict, uuid: str) -> None:
    """Admins may not change their own account, fellow admins and roots, or in-game staff."""
    if actor["role"] == "root":
        return
    if _linked_uuid(conn, actor["discord_user_id"]) == uuid:
        raise _forbidden("cannot_act_on_self")
    target_role = _target_account_role(conn, uuid)
    if target_role is not None and roles.rank(target_role) >= roles.rank(actor["role"]):
        raise _forbidden("target_outranks_you")
    if _holds_root_only_group(conn, uuid, mirror.load_groups(conn)):
        raise _forbidden("target_is_staff")


def check_ops_allowed(conn, actor_role: str, target_type: str, ops: list[dict]) -> None:
    if target_type != "user":
        if not policy.may_edit_definitions(actor_role):
            raise _forbidden("root_only")
        return
    rules = policy.load()
    groups = mirror.load_groups(conn)
    for op in ops:
        if not policy.may_edit_node(rules, groups, actor_role, op["node"]):
            raise _forbidden("root_only")


# --------------------
# Queueing
# --------------------


def _shape(target_type, target, raw_ops) -> tuple[str, str, list[dict]]:
    if target_type not in ("user", "group", "track"):
        raise _bad("bad_target")
    if not isinstance(target, str) or not target.strip():
        raise _bad("bad_target")
    if target_type == "user":
        target = canonical_uuid(target)
        if target is None:
            raise _bad("bad_uuid")
    else:
        target = target.strip().lower()
        if not nodes.GROUP_NAME.match(target):
            raise _bad("bad_group_name" if target_type == "group" else "bad_track_name")
    if not isinstance(raw_ops, list) or not raw_ops or len(raw_ops) > OPS_MAX:
        raise _bad("bad_ops")
    allowed = {"user": USER_OPS, "group": GROUP_OPS, "track": TRACK_OPS}[target_type]
    for raw in raw_ops:
        if not isinstance(raw, dict) or raw.get("op") not in allowed:
            raise _bad("bad_ops")
    return target_type, target, raw_ops


def queue_change(token: str, target_type, target, raw_ops, reason: str | None) -> dict:
    action = "luckperms.change"
    actor = None
    clean = None
    detail_target = {"target_type": target_type if isinstance(target_type, str) else None,
                     "target": target[:64] if isinstance(target, str) else None}
    try:
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                actor = session_user_in(conn, token)
                if actor is None:
                    raise AdminError(401, "not_signed_in", "denied")
                if not roles.can(actor["role"], "change_luckperms"):
                    raise _forbidden()
                clean = clean_reason(reason)
                target_type, target, raw_ops = _shape(target_type, target, raw_ops)
                detail_target = {"target_type": target_type, "target": target}
                state = mirror.status(conn)
                settle_timeouts(conn)
                if read_only() or not state["applying"]:
                    raise AdminError(503, "bridge_offline", "unavailable")
                if conn.execute(
                        "SELECT 1 FROM lp_changes WHERE target_type = ? AND target = ? AND status IN ('pending', 'sent')",
                        (target_type, target)).fetchone():
                    raise _conflict("change_pending")
                now = _now()
                target_name = target
                if target_type == "user":
                    row = mirror.user_row(conn, target)
                    if row is None:
                        raise AdminError(404, "player_not_found", "not_found")
                    target_name = row["name"] or target
                    check_user_target(conn, actor, target)
                    ops, words = build_user_ops(conn, target, raw_ops, now)
                elif target_type == "group":
                    ops, words = build_group_ops(conn, target, raw_ops, now)
                else:
                    ops, words = build_track_ops(conn, target, raw_ops)
                check_ops_allowed(conn, actor["role"], target_type, ops)
                if not ops:
                    raise _conflict("nothing_to_change")
                description = "; ".join(words)[:DESCRIPTION_MAX]
                change_id = conn.execute(
                    """
                    INSERT INTO lp_changes (
                        created_at, actor_user_id, actor_name, actor_role, actor_minecraft_uuid,
                        target_type, target, target_name, description, ops_json, reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (_iso(), actor["user_id"], audit.display_name(actor), actor["role"],
                     _linked_uuid(conn, actor["discord_user_id"]), target_type, target, target_name,
                     description, json.dumps(ops, sort_keys=True), clean),
                ).lastrowid
                audit.record(conn, actor=actor, action=action, outcome="ok", reason=clean,
                             detail={**detail_target, "target_name": target_name, "change_id": change_id,
                                     "description": description})
                conn.commit()
            except BaseException:
                conn.rollback()
                raise
    except AdminError as exc:
        if actor is not None:
            audit.record_refusal(actor=actor, action=action, outcome=exc.outcome, reason=clean,
                                 detail={**detail_target, "error": exc.code})
        raise
    return get_change(change_id)


# --------------------
# Reading changes
# --------------------


def _change_json(row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "actor_name": row["actor_name"],
        "actor_role": row["actor_role"],
        "target_type": row["target_type"],
        "target": row["target"],
        "target_name": row["target_name"],
        "description": row["description"],
        "reason": row["reason"],
        "status": row["status"],
        "finished_at": row["finished_at"],
        "error": row["error"],
    }


def _settled_reads(conn) -> None:
    settle_timeouts(conn)
    conn.commit()


def get_change(change_id: int) -> dict:
    with connect() as conn:
        _settled_reads(conn)
        row = conn.execute("SELECT * FROM lp_changes WHERE id = ?", (change_id,)).fetchone()
    if row is None:
        raise AdminError(404, "change_not_found", "not_found")
    return _change_json(row)


def list_changes(target_type: str | None = None, target: str | None = None, limit: int = HISTORY_LIMIT) -> list[dict]:
    where, args = [], []
    if target_type and target:
        where.append("target_type = ? AND target = ?")
        args += [target_type, target]
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with connect() as conn:
        _settled_reads(conn)
        rows = conn.execute(f"SELECT * FROM lp_changes {clause} ORDER BY id DESC LIMIT ?",
                            [*args, max(1, min(limit, HISTORY_LIMIT))]).fetchall()
    return [_change_json(row) for row in rows]


# --------------------
# Bridge side
# --------------------


def _actor_name(row) -> str:
    return f"web:{row['actor_name'] or row['actor_user_id']}"[:100]


def _current_actor(conn, row) -> dict | None:
    """The actor's rights again at collection time: a demotion since queueing cancels the change."""
    actor = conn.execute("SELECT id AS user_id, discord_user_id, role FROM users WHERE id = ?",
                         (row["actor_user_id"],)).fetchone()
    if actor is None or not roles.can(actor["role"], "change_luckperms"):
        return None
    actor = dict(actor)
    try:
        if row["target_type"] == "user":
            check_user_target(conn, actor, row["target"])
        check_ops_allowed(conn, actor["role"], row["target_type"], json.loads(row["ops_json"]))
    except AdminError:
        return None
    return actor


def settle_timeouts(conn, now: float | None = None) -> None:
    """Expire unfetched changes and mark unanswered ones unknown, whether or not the bridge polls."""
    now = time.time() if now is None else now
    for row in conn.execute("SELECT id, status, created_at, sent_at FROM lp_changes WHERE status IN ('pending', 'sent')"):
        if row["status"] == "sent" and now - _parse(row["sent_at"]) > RESULT_WAIT_SECONDS:
            conn.execute("UPDATE lp_changes SET status = 'unknown', finished_at = ?, error = 'no_result' WHERE id = ?",
                         (_iso(now), row["id"]))
        elif row["status"] == "pending" and now - _parse(row["created_at"]) > PENDING_TTL_SECONDS:
            conn.execute("UPDATE lp_changes SET status = 'expired', finished_at = ?, error = 'expired' WHERE id = ?",
                         (_iso(now), row["id"]))


def _guard(conn, row, actor: dict) -> dict | None:
    """What the bridge must recheck against live LuckPerms for an admin's change.

    The mirror can lag in-game edits, so the bridge refuses the change if the
    player now holds a group outside the admin groups, or a group being added
    now inherits one.
    """
    if row["target_type"] != "user" or actor["role"] == "root":
        return None
    rules = policy.load()
    groups = mirror.load_groups(conn)
    allowed = sorted(name for name in groups if policy.group_role(rules, groups, name) == "admin")
    return {"admin_groups": allowed}


def fetch_for_bridge() -> list[dict]:
    """Changes for the bridge, oldest first. Each is handed out once; records the poll.

    A group or track change is handed out on its own, and nothing more until
    its result arrives: later changes are checked against the definitions it
    leaves behind.
    """
    now = time.time()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            mirror.record_poll(conn)
            settle_timeouts(conn, now)
            out = []
            # Until a definition change's result arrives, or a snapshot taken after it was
            # sent shows LuckPerms as it now is, nothing else is checked against old groups.
            definition_sent = conn.execute(
                """
                SELECT 1 FROM lp_changes c
                WHERE c.target_type != 'user'
                  AND (c.status = 'sent' OR (c.status = 'unknown' AND NOT EXISTS (
                      SELECT 1 FROM lp_state s WHERE s.id = 1 AND s.checked_at > c.sent_at)))
                """).fetchone()
            rows = [] if read_only() or definition_sent else conn.execute(
                "SELECT * FROM lp_changes WHERE status = 'pending' ORDER BY id").fetchall()
            for row in rows:
                if len(out) >= FETCH_LIMIT:
                    break
                definition = row["target_type"] != "user"
                if definition and out:
                    break
                actor = _current_actor(conn, row)
                if actor is None:
                    conn.execute("UPDATE lp_changes SET status = 'failed', finished_at = ?, error = 'no_longer_allowed' "
                                 "WHERE id = ?", (_iso(now), row["id"]))
                    continue
                conn.execute("UPDATE lp_changes SET status = 'sent', sent_at = ?, attempts = attempts + 1 "
                             "WHERE id = ?", (_iso(now), row["id"]))
                change = {
                    "id": row["id"],
                    "target_type": row["target_type"],
                    "target": row["target"],
                    "target_name": row["target_name"],
                    "actor_name": _actor_name(row),
                    "actor_uuid": row["actor_minecraft_uuid"],
                    "description": row["description"],
                    "ops": json.loads(row["ops_json"]),
                }
                guard = _guard(conn, row, actor)
                if guard is not None:
                    change["guard"] = guard
                out.append(change)
                if definition:
                    break
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    return out


def record_results(results) -> dict:
    if not isinstance(results, list):
        raise _bad("bad_results")
    recorded = 0
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for result in results:
                if not isinstance(result, dict) or not isinstance(result.get("id"), int):
                    continue
                row = conn.execute("SELECT * FROM lp_changes WHERE id = ?", (result["id"],)).fetchone()
                # A late result still settles a change whose outcome was unknown.
                if row is None or row["status"] not in ("sent", "unknown"):
                    continue
                ok = result.get("ok") is True
                error = None if ok else str(result.get("error") or "failed")[:64]
                conn.execute("UPDATE lp_changes SET status = ?, finished_at = ?, error = ? WHERE id = ?",
                             ("applied" if ok else "failed", _iso(), error, row["id"]))
                if ok and "state" in result:
                    try:
                        mirror.apply_state(conn, row["target_type"], row["target"], result["state"],
                                           result.get("revision"))
                    except mirror.SnapshotError:
                        conn.execute("UPDATE lp_state SET hash = NULL WHERE id = 1")
                recorded += 1
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    return {"ok": True, "recorded": recorded}
