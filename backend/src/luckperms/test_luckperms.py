import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import admin_routes, auth_routes
from src.auth import users
from src.luckperms import changes, mirror, nodes, policy

SITE = "https://www.tfminecraft.net"
ORIGIN = {"Origin": SITE}
SESSION = "__Host-tfmc_session"
PLUGIN = {"X-Plugin-Key": "primary-key"}
SECONDARY = {"X-Plugin-Key": "tutorial-key"}

ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"
ADMIN_MC = "33333333-3333-3333-3333-333333333333"
ROOT_MC = "44444444-4444-4444-4444-444444444444"


def node(key, value=True, contexts=None, expiry=0):
    return {"key": key, "value": value, "contexts": contexts or {}, "expiry": expiry}


def group(name, weight, *keys, prefix=None):
    group_nodes = [node(k) for k in keys]
    if weight is not None:
        group_nodes.append(node(f"weight.{weight}"))
    if prefix:
        group_nodes.append(node(f"prefix.{weight}.{prefix}"))
    return {"name": name, "display_name": None, "weight": weight, "nodes": group_nodes}


def snapshot(**overrides):
    payload = {
        "server": "main",
        "generated_at": 1791321779,
        "revision": 1000,
        "hash": "h1",
        "groups": [
            group("default", None),
            group("commoner", 10, "group.default", prefix="&7Commoner"),
            group("noble", 20, "group.commoner", prefix="&6Noble"),
            group("helper_player", 120, "group.commoner"),
            group("helper_inactive", 130, "group.helper_player"),
            group("helper", 140, "group.helper_inactive", "essentials.kick", prefix="&dHelper"),
            group("staff_player", 180, "group.commoner"),
            group("staff_inactive", 190, "group.staff_player"),
            group("staff", 200, "group.staff_inactive", "*", prefix="&cStaff"),
        ],
        "tracks": [
            {"name": "helper", "groups": ["helper_player", "helper_inactive", "helper"]},
            {"name": "staff", "groups": ["staff_player", "staff_inactive", "staff"]},
        ],
        "users": [
            {"uuid": ALICE, "name": "Alice", "nodes": [node("group.commoner"), node("professions.chef_1"),
                                                       node("tips.off", contexts={"server": ["main"]})]},
            {"uuid": BOB, "name": "Bob", "nodes": [node("group.helper_player")]},
            {"uuid": ADMIN_MC, "name": "AdminMC", "nodes": [node("group.staff")]},
            {"uuid": ROOT_MC, "name": "RootMC", "nodes": [node("group.staff")]},
        ],
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def env(database, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", SITE)
    monkeypatch.setenv("PLUGIN_KEY", "primary-key")
    monkeypatch.setenv("PLUGIN_KEYS_SECONDARY", "tutorial-key")
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    monkeypatch.delenv("LUCKPERMS_READ_ONLY", raising=False)
    return database


@pytest.fixture
def app(env):
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)
    return app


def account(db, name, role="player", minecraft=None):
    discord_id = str(100000000000000000 + abs(hash(name)) % 10**15)
    token = users.sign_in(
        {"discord_user_id": discord_id, "discord_username": name, "discord_global_name": name.title(),
         "discord_avatar": None},
        guild_member=True,
    )
    with db.connect() as conn:
        conn.execute("UPDATE users SET role = ? WHERE discord_user_id = ?", (role, discord_id))
        if minecraft:
            conn.execute(
                "INSERT INTO discord_links (player_uuid, discord_user_id, discord_username, minecraft_name, linked_at) "
                "VALUES (?, ?, ?, ?, ?)", (minecraft, discord_id, name, name, "2026-10-01T00:00:00Z"))
        conn.commit()
    return token


def client(app, token=None):
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set(SESSION, token, domain="testserver.local")
    return c


@pytest.fixture
def bridge(app):
    plugin = client(app)
    assert plugin.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot()).json()["users"] == 4
    assert plugin.get("/luckperms/plugin/changes", headers=PLUGIN).json() == {"changes": []}
    return plugin


@pytest.fixture
def staff(env):
    return {
        "mod": account(env, "mona", "mod"),
        "admin": account(env, "adam", "admin", ADMIN_MC),
        "root": account(env, "rory", "root", ROOT_MC),
    }


def submit(app, token, target_type, target, ops, reason="Event reward"):
    return client(app, token).post("/admin/luckperms/changes", headers=ORIGIN,
                                   json={"target_type": target_type, "target": target, "ops": ops, "reason": reason})


def audit_rows(db):
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM admin_audit ORDER BY id")]


# --------------------
# Nodes and policy
# --------------------


def test_new_nodes_are_normalised_and_checked():
    assert nodes.from_request({"key": " Essentials.Fly ", "contexts": {"Server": "MAIN"}}, new=True) == node(
        "essentials.fly", contexts={"server": ["main"]})
    assert nodes.from_request({"key": "group.Helper"}, new=True)["key"] == "group.helper"
    for bad in ({"key": ""}, {"key": "a b"}, {"key": "x", "value": "yes"}, {"key": "group.no spaces"},
                {"key": "x", "contexts": {"server": []}}, {"key": "x\x07y"}):
        with pytest.raises(nodes.NodeError):
            nodes.from_request(bad, new=True)
    now = int(time.time())
    with pytest.raises(nodes.NodeError, match="bad_expiry"):
        nodes.from_request({"key": "x", "expiry": now - 5}, new=True, now=now)
    assert nodes.from_request({"key": "x", "expiry": now + 60}, new=True, now=now)["expiry"] == now + 60
    assert nodes.describe(node("group.staff", contexts={"server": ["main"]})) == "parent add staff server=main"
    assert nodes.describe(node("tips.off", value=False, expiry=5)) == "permission settemp tips.off false"
    assert nodes.describe_removal(node("group.staff")) == "parent remove staff"


def test_policy_puts_staff_power_out_of_admin_reach():
    rules = policy.load()
    groups = {g["name"]: g for g in snapshot()["groups"]}
    assert policy.node_role(rules, groups, node("group.helper")) == "admin"
    assert policy.node_role(rules, groups, node("group.helper+")) == "root"
    assert policy.node_role(rules, groups, node("group.staff")) == "root"
    assert policy.node_role(rules, groups, node("professions.chef_1")) == "admin"
    assert policy.node_role(rules, groups, node("professions.chef_1", value=False)) == "admin"
    assert policy.node_role(rules, groups, node("armourshop.ravoukar")) == "admin"
    for key in ("*", "professions.*", "essentials.kick", "armourshop.admin", "professions.admin", "mural.bypass.x", "tfmc.staff", "luckperms.user.parent.add",
                "minecraft.command.op", "r=professions.*", "prefix.300.&cOwner", "weight.999", "meta.x.y"):
        assert policy.node_role(rules, groups, node(key)) == "root", key
    # A listed group that inherits a staff group, in any context, is no longer an admin group.
    groups["commoner"]["nodes"].append(node("group.staff_player", contexts={"server": ["dev"]}))
    assert policy.node_role(rules, groups, node("group.noble")) == "root"


# --------------------
# Plugin routes
# --------------------


def test_plugin_routes_need_the_primary_key(app):
    plugin = client(app)
    assert plugin.put("/luckperms/plugin/snapshot", json=snapshot()).status_code == 401
    assert plugin.put("/luckperms/plugin/snapshot", headers=SECONDARY, json=snapshot()).status_code == 403
    assert plugin.get("/luckperms/plugin/changes", headers=SECONDARY).status_code == 403


def test_snapshot_replaces_mirror_and_unchanged_checks_hash(bridge, env):
    assert bridge.put("/luckperms/plugin/snapshot", headers=PLUGIN, json={"groups": "x"}).status_code == 400
    assert bridge.put("/luckperms/plugin/snapshot", headers=PLUGIN,
                      json=snapshot(revision=None)).json()["detail"] == "bad_revision"
    assert bridge.post("/luckperms/plugin/snapshot/unchanged", headers=PLUGIN,
                       json={"hash": "other", "revision": 1001}).json() == {"ok": False, "need_full": True}
    assert bridge.post("/luckperms/plugin/snapshot/unchanged", headers=PLUGIN,
                       json={"hash": "h1", "revision": 1001}).json() == {"ok": True}
    smaller = snapshot(hash="h2", revision=1002, users=[{"uuid": BOB.upper(), "name": "Bob", "nodes": []}])
    assert bridge.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=smaller).json()["users"] == 1
    # A delayed older snapshot cannot undo a newer one.
    late = bridge.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot(hash="old", revision=1001))
    assert late.json() == {"ok": True, "stale": True}
    with env.connect() as conn:
        assert [r["uuid"] for r in conn.execute("SELECT uuid FROM lp_users")] == [BOB]
        assert mirror.status(conn)["applying"] is True


# --------------------
# Staff reads
# --------------------


def test_mods_see_everything_but_change_nothing(app, bridge, staff, env):
    mod = client(app, staff["mod"])
    overview = mod.get("/admin/luckperms").json()
    assert [g["name"] for g in overview["groups"]][:3] == ["staff", "staff_inactive", "staff_player"]
    staff_group = overview["groups"][0]
    assert staff_group["prefix"] == "&cStaff" and staff_group["members"] == 2 and staff_group["min_role"] == "root"
    assert overview["rights"] == {"read_only": False, "change_players": False, "edit_definitions": False}
    player = mod.get(f"/admin/luckperms/players/{ALICE}").json()["player"]
    assert player["rank"] == "commoner" and player["rank_prefix"] == "&7Commoner"
    assert player["inherits"] == ["commoner", "default"]
    assert not any(n["editable"] for n in player["nodes"])
    listing = mod.get("/admin/luckperms/players", params={"q": "ali"}).json()
    assert [r["name"] for r in listing["rows"]] == ["Alice"] and listing["rows"][0]["rank"] == "commoner"
    members = mod.get("/admin/luckperms/players", params={"group": "staff"}).json()
    assert {r["name"] for r in members["rows"]} == {"AdminMC", "RootMC"}
    detail = mod.get("/admin/luckperms/groups/helper").json()["group"]
    assert detail["inherits"] == ["helper_inactive", "helper_player", "commoner", "default"]
    assert detail["tracks"] == ["helper"] and detail["children"] == []
    assert submit(app, staff["mod"], "user", ALICE, [{"op": "add_node", "node": node("tips.off")}]).status_code == 403


def test_views_mark_what_an_admin_may_change(app, bridge, staff):
    admin = client(app, staff["admin"])
    bob = admin.get(f"/admin/luckperms/players/{BOB}").json()
    helper = next(t for t in bob["player"]["tracks"] if t["name"] == "helper")
    assert helper["position"] == 0 and helper["can_promote"] and helper["can_demote"]
    assert not next(t for t in bob["player"]["tracks"] if t["name"] == "staff")["can_promote"]
    addable = {g["name"] for g in bob["groups"] if g["addable"]}
    assert "helper" in addable and "staff" not in addable
    own = admin.get(f"/admin/luckperms/players/{ADMIN_MC}").json()
    assert own["rights"]["change_this_player"] is False
    assert admin.get(f"/admin/luckperms/players/{ROOT_MC}").json()["rights"]["change_this_player"] is False


# --------------------
# Changes
# --------------------


def test_admin_change_round_trip(app, bridge, staff, env):
    response = submit(app, staff["admin"], "user", ALICE, [
        {"op": "add_node", "node": {"key": "group.Noble"}},
        {"op": "remove_node", "node": node("professions.chef_1")},
    ])
    assert response.status_code == 200, response.text
    change = response.json()
    assert change["status"] == "pending"
    assert change["description"] == "parent add noble; permission unset professions.chef_1"
    again = submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": node("tips.on")}])
    assert again.json()["detail"] == "change_pending"

    sent = bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"]
    assert len(sent) == 1 and sent[0]["actor_name"] == "web:adam" and sent[0]["actor_uuid"] == ADMIN_MC
    assert sent[0]["ops"] == [{"op": "add_node", "node": node("group.noble")},
                              {"op": "remove_node", "node": node("professions.chef_1")}]
    assert bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json() == {"changes": []}

    state = {"uuid": ALICE, "name": "Alice", "nodes": [node("group.commoner"), node("group.noble")]}
    result = bridge.post("/luckperms/plugin/changes/results", headers=PLUGIN,
                         json={"results": [{"id": change["id"], "ok": True, "revision": 2000, "state": state}]})
    assert result.json() == {"ok": True, "recorded": 1}
    admin = client(app, staff["admin"])
    assert admin.get(f"/admin/luckperms/changes/{change['id']}").json()["status"] == "applied"
    player = admin.get(f"/admin/luckperms/players/{ALICE}").json()["player"]
    assert player["rank"] == "noble" and [n["key"] for n in player["nodes"]] == ["group.commoner", "group.noble"]
    # The mirror changed under the stored hash, so the bridge is asked for a full snapshot.
    assert bridge.post("/luckperms/plugin/snapshot/unchanged", headers=PLUGIN,
                       json={"hash": "h1", "revision": 2001}).json()["ok"] is False
    # And a snapshot built before the change cannot hide it again.
    assert bridge.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot(revision=1500)).json()["stale"]
    rows = [r for r in audit_rows(env) if r["action"] == "luckperms.change"]
    assert [(r["outcome"], json.loads(r["detail_json"]).get("error")) for r in rows] == [("ok", None), ("conflict", "change_pending")]


@pytest.mark.parametrize("role,target,ops,status,code", [
    ("admin", ALICE, [{"op": "add_node", "node": {"key": "group.staff"}}], 403, "root_only"),
    ("admin", ALICE, [{"op": "add_node", "node": {"key": "essentials.*"}}], 403, "root_only"),
    ("admin", ALICE, [{"op": "add_node", "node": {"key": "essentials.fly"}}], 403, "root_only"),
    ("admin", ALICE, [{"op": "add_node", "node": {"key": "professions.chef_2", "value": False}}], 200, None),
    ("admin", ALICE, [{"op": "add_node", "node": {"key": "prefix.500.&cKing"}}], 403, "root_only"),
    ("admin", ADMIN_MC, [{"op": "add_node", "node": {"key": "tips.off"}}], 403, "cannot_act_on_self"),
    ("admin", ROOT_MC, [{"op": "add_node", "node": {"key": "tips.off"}}], 403, "target_outranks_you"),
    ("admin", ALICE, [{"op": "add_node", "node": node("group.commoner")}], 409, "node_exists"),
    ("admin", ALICE, [{"op": "remove_node", "node": node("tips.off")}], 409, "node_missing"),
    ("admin", ALICE, [{"op": "add_node", "node": {"key": "group.ghost"}}], 409, "group_missing"),
    ("admin", ALICE, [{"op": "demote", "track": "helper"}], 409, "not_on_track"),
    ("admin", BOB, [{"op": "promote", "track": "staff"}], 403, "root_only"),
    ("admin", "nope", [{"op": "add_node", "node": {"key": "x"}}], 400, "bad_uuid"),
    ("admin", ALICE, [{"op": "create_group"}], 400, "bad_ops"),
    ("admin", "staff", [{"op": "add_node", "node": {"key": "x"}}], 400, "bad_uuid"),
    ("root", ALICE, [{"op": "add_node", "node": {"key": "group.staff"}}], 200, None),
    ("root", ROOT_MC, [{"op": "add_node", "node": {"key": "essentials.*"}}], 200, None),
])
def test_user_change_rules(app, bridge, staff, role, target, ops, status, code):
    response = submit(app, staff[role], "user", target, ops)
    assert response.status_code == status, response.text
    if code:
        assert response.json()["detail"] == code


def test_promote_and_demote_become_explicit_ops(app, bridge, staff):
    change = submit(app, staff["admin"], "user", BOB, [{"op": "promote", "track": "helper"}]).json()
    assert change["description"] == "promote helper"
    ops = bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"][0]["ops"]
    assert ops == [{"op": "remove_node", "node": node("group.helper_player")},
                   {"op": "add_node", "node": node("group.helper_inactive")}]
    bridge.post("/luckperms/plugin/changes/results", headers=PLUGIN,
                json={"results": [{"id": change["id"], "ok": False, "error": "node_missing"}]})
    assert client(app, staff["admin"]).get(f"/admin/luckperms/changes/{change['id']}").json()["error"] == "node_missing"
    demote = submit(app, staff["admin"], "user", BOB, [{"op": "demote", "track": "helper"}])
    assert demote.status_code == 200
    ops = bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"][0]["ops"]
    assert ops == [{"op": "remove_node", "node": node("group.helper_player")}]


def test_group_and_track_definitions_are_root_only(app, bridge, staff):
    ops = [{"op": "create_group"}, {"op": "add_node", "node": {"key": "group.commoner"}},
           {"op": "add_node", "node": {"key": "weight.60"}}]
    assert submit(app, staff["admin"], "group", "knight", ops).json()["detail"] == "root_only"
    created = submit(app, staff["root"], "group", "knight", ops)
    assert created.status_code == 200 and created.json()["description"] == (
        "create; parent add commoner; permission set weight.60 true")
    cycle = submit(app, staff["root"], "group", "commoner", [{"op": "add_node", "node": {"key": "group.staff"}}])
    assert cycle.json()["detail"] == "inheritance_cycle"
    assert submit(app, staff["root"], "group", "default", [{"op": "delete_group"}]).json()["detail"] == "cannot_delete_default"
    track = submit(app, staff["root"], "track", "helper", [{"op": "set_groups", "groups": ["helper_player", "helper"]}])
    assert track.status_code == 200
    assert submit(app, staff["root"], "track", "staff", [{"op": "set_groups", "groups": ["ghost"]}]).json()[
        "detail"] == "group_missing"


def test_changes_need_a_connected_bridge_and_expire(app, staff, env, monkeypatch):
    monkeypatch.delenv("LUCKPERMS_READ_ONLY", raising=False)
    plugin = client(app)
    plugin.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot())
    response = submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}])
    assert response.status_code == 503 and response.json()["detail"] == "bridge_offline"
    plugin.get("/luckperms/plugin/changes", headers=PLUGIN)
    change = submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}]).json()
    later = time.time() + changes.PENDING_TTL_SECONDS + 5
    monkeypatch.setattr(changes.time, "time", lambda: later)
    assert changes.fetch_for_bridge() == []
    assert changes.get_change(change["id"])["status"] == "expired"


def test_changes_are_sent_once_and_unanswered_ones_become_unknown(app, bridge, staff, monkeypatch):
    change = submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}]).json()
    clock = [time.time()]
    monkeypatch.setattr(changes.time, "time", lambda: clock[0])
    assert len(changes.fetch_for_bridge()) == 1
    clock[0] += changes.RESULT_WAIT_SECONDS + 1
    assert changes.fetch_for_bridge() == []
    assert changes.get_change(change["id"])["status"] == "unknown"
    # A late result still settles it.
    changes.record_results([{"id": change["id"], "ok": True, "revision": 5000, "state": None}])
    assert changes.get_change(change["id"])["status"] == "applied"


def test_admins_cannot_touch_in_game_staff_even_unlinked(app, bridge, staff):
    plugin = client(app)
    users_now = snapshot()["users"] + [{"uuid": "55555555-5555-5555-5555-555555555555", "name": "Mod",
                                        "nodes": [node("group.staff_player", contexts={"server": ["main"]})]}]
    plugin.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot(revision=1100, users=users_now))
    response = submit(app, staff["admin"], "user", "55555555-5555-5555-5555-555555555555",
                      [{"op": "add_node", "node": {"key": "tips.off"}}])
    assert response.json()["detail"] == "target_is_staff"


def test_demotion_after_queueing_cancels_the_change(app, bridge, staff, env):
    change = submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}]).json()
    with env.connect() as conn:
        conn.execute("UPDATE users SET role = 'mod' WHERE discord_username = 'adam'")
        conn.commit()
    assert changes.fetch_for_bridge() == []
    assert changes.get_change(change["id"])["error"] == "no_longer_allowed"


def test_read_only_site_shows_but_never_changes(app, bridge, staff, monkeypatch):
    monkeypatch.setenv("LUCKPERMS_READ_ONLY", "1")
    root = client(app, staff["root"])
    assert root.get("/admin/luckperms").json()["rights"] == {
        "read_only": True, "change_players": False, "edit_definitions": False}
    response = submit(app, staff["root"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}])
    assert response.json()["detail"] == "bridge_offline"


def test_malformed_change_is_audited(app, bridge, staff, env):
    response = client(app, staff["admin"]).post("/admin/luckperms/changes", headers=ORIGIN, json={"target": ALICE})
    assert response.status_code == 422
    row = audit_rows(env)[-1]
    assert (row["action"], row["outcome"]) == ("luckperms.change", "invalid")


def test_meta_keys_keep_their_spaces():
    assert nodes.from_request({"key": "prefix.100.&6[Noble] "}, new=True)["key"] == "prefix.100.&6[Noble] "
    assert nodes.from_request({"key": "prefix.100.&6[Noble] "}, new=False)["key"] == "prefix.100.&6[Noble] "
    assert nodes.from_request({"key": " tips.off "}, new=True)["key"] == "tips.off"


def test_bridge_rechecks_admin_changes_against_live_groups(app, bridge, staff):
    submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}])
    submit(app, staff["root"], "user", BOB, [{"op": "add_node", "node": {"key": "tips.off"}}])
    sent = {c["target"]: c for c in bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"]}
    assert set(sent[ALICE]["guard"]["admin_groups"]) == {
        "default", "commoner", "noble", "helper_player", "helper_inactive", "helper"}
    assert "guard" not in sent[BOB]


def test_definition_changes_go_alone_and_hold_later_changes(app, bridge, staff):
    group_change = submit(app, staff["root"], "group", "helper",
                          [{"op": "add_node", "node": {"key": "group.staff_player"}}]).json()
    submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "group.helper"}}])
    first = bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"]
    assert [c["id"] for c in first] == [group_change["id"]]
    assert bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"] == []
    helper = group("helper", 140, "group.helper_inactive", "group.staff_player", prefix="&dHelper")
    bridge.post("/luckperms/plugin/changes/results", headers=PLUGIN,
                json={"results": [{"id": group_change["id"], "ok": True, "revision": 3000, "state": helper}]})
    # helper now inherits a staff group, so the admin's queued grant is cancelled.
    assert bridge.get("/luckperms/plugin/changes", headers=PLUGIN).json()["changes"] == []
    alice = client(app, staff["admin"]).get(f"/admin/luckperms/players/{ALICE}").json()
    assert alice["changes"][0]["error"] == "no_longer_allowed"


def test_timeouts_settle_without_the_bridge(app, bridge, staff, monkeypatch):
    change = submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.off"}}]).json()
    changes.fetch_for_bridge()
    later = time.time() + changes.RESULT_WAIT_SECONDS + 5
    monkeypatch.setattr(changes.time, "time", lambda: later)
    assert client(app, staff["mod"]).get(f"/admin/luckperms/changes/{change['id']}").json()["status"] == "unknown"
