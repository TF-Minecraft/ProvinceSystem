import pytest

from src.auth import testing
from src.luckperms import commands
from src.luckperms.test_luckperms import PLUGIN, SECONDARY, app, bridge, client, env, staff  # noqa: F401


def command(name, plugin="Essentials", permission=None, access=None, **extra):
    return {"plugin": plugin, "name": name, "aliases": extra.get("aliases", []),
            "description": extra.get("description"), "usage": extra.get("usage"), "permission": permission,
            "shadowed": extra.get("shadowed", False), "access": access}


def catalogue(**overrides):
    # Groups in the plugin's (alphabetical) order; access follows it.
    payload = {
        "server": "main",
        "generated_at": 1792076432,
        "hash": "c1",
        "groups": ["commoner", "default", "helper", "helper_inactive", "helper_player", "noble", "staff"],
        "plugins": [{"name": "Essentials", "version": "2.22.0"}, {"name": "LibsDisguises", "version": None},
                    {"name": "Unused", "version": "1"}],
        "commands": [
            command("me", permission="essentials.me", access="yyyyyyy", aliases=["eme"],
                    description="Describes an action."),
            command("kick", permission="essentials.kick", access="nnynnny"),
            command("disguise", plugin="LibsDisguises", permission="libsdisguises.seecmd.disguise",
                    access="yyyyyyy", usage="/disguise <type>"),
            command("me", plugin="LibsDisguises", shadowed=True),
        ],
    }
    payload.update(overrides)
    return payload


def test_plugin_route_needs_the_primary_key(app):
    plugin = client(app)
    assert plugin.put("/luckperms/plugin/commands", json=catalogue()).status_code == 401
    assert plugin.put("/luckperms/plugin/commands", headers=SECONDARY, json=catalogue()).status_code == 403


@pytest.mark.parametrize("change", [
    {"groups": "x"},
    {"groups": [""]},
    {"plugins": ["x"]},
    {"commands": [command("me", plugin="Nobody")]},
    {"commands": [command("me", permission="essentials.me", access="yy")]},
    {"commands": [command("me", permission="essentials.me", access="yyyyyyx")]},
    {"commands": [command("me", access="yyyyyyy")]},
    {"commands": [{**command("me"), "shadowed": "no"}]},
    {"commands": [{**command("me"), "aliases": "eme"}]},
    {"commands": [command("x" * 65)]},
    {"commands": ["me"]},
    {"generated_at": True},
    {"server": None},
])
def test_malformed_lists_are_refused(app, change):
    response = client(app).put("/luckperms/plugin/commands", headers=PLUGIN, json=catalogue(**change))
    assert response.status_code == 400 and response.json()["detail"] == "bad_commands"
    assert client(app).put("/luckperms/plugin/commands", headers=PLUGIN, json=[1]).status_code == 400


def test_staff_see_commands_with_groups_in_rank_order(app, bridge, staff):
    mod = client(app, staff["mod"])
    assert mod.get("/admin/luckperms/commands").json() == {"status": None, "groups": [], "plugins": []}
    assert bridge.put("/luckperms/plugin/commands", headers=PLUGIN, json=catalogue()).json() == {
        "ok": True, "commands": 4}

    data = mod.get("/admin/luckperms/commands").json()

    assert data["status"]["server"] == "main" and data["status"]["generated_at"] == 1792076432
    assert data["status"]["fresh"] is True
    assert [(g["name"], g["kind"], g["track"]) for g in data["groups"]] == [
        ("default", "rank", None), ("commoner", "rank", None), ("noble", "rank", None),
        ("helper", "staff", "helper"), ("staff", "staff", "staff"),
        ("helper_player", "step", "helper"), ("helper_inactive", "step", "helper"),
    ]
    helper = data["groups"][3]
    assert helper["parents"] == ["helper_inactive"] and helper["members"] == 0
    assert [n["key"] for n in helper["nodes"]] == ["essentials.kick"]
    staff_group = data["groups"][4]
    assert staff_group["members"] == 2 and staff_group["weight"] == 200
    assert [p["name"] for p in data["plugins"]] == ["Essentials", "LibsDisguises"]
    essentials = data["plugins"][0]
    assert essentials["version"] == "2.22.0"
    assert [c["name"] for c in essentials["commands"]] == ["kick", "me"]
    # default, commoner, noble, helper, staff, helper_player, helper_inactive
    assert essentials["commands"][0]["access"] == "nnnyynn"
    assert essentials["commands"][1] == {"name": "me", "aliases": ["eme"], "description": "Describes an action.",
                                         "usage": None, "permission": "essentials.me", "shadowed": False,
                                         "access": "yyyyyyy"}
    shadowed = data["plugins"][1]["commands"][1]
    assert shadowed["shadowed"] is True and shadowed["access"] is None


def test_groups_missing_from_the_mirror_still_show(app, staff, env):
    plugin = client(app)
    payload = catalogue(groups=["ghost"], commands=[command("me", permission="essentials.me", access="y")])
    assert plugin.put("/luckperms/plugin/commands", headers=PLUGIN, json=payload).status_code == 200
    data = client(app, staff["mod"]).get("/admin/luckperms/commands").json()
    assert data["groups"] == [{"name": "ghost", "display_name": None, "weight": None, "members": 0, "kind": "rank",
                               "track": None, "parents": [], "nodes": []}]


def test_old_lists_are_marked_stale(app, staff, env):
    assert client(app).put("/luckperms/plugin/commands", headers=PLUGIN, json=catalogue()).status_code == 200
    testing.execute("UPDATE lp_commands SET received_at = '2026-01-01T00:00:00Z'")
    assert client(app, staff["mod"]).get("/admin/luckperms/commands").json()["status"]["fresh"] is False


def test_players_cannot_read_commands(app, env):
    from src.luckperms.test_luckperms import account
    player = account(env, "pat")
    assert client(app, player).get("/admin/luckperms/commands").status_code == 403
    assert client(app).get("/admin/luckperms/commands").status_code == 401


def test_empty_tracks_are_ignored():
    assert commands._kinds([{"name": "empty", "groups": []}, {"name": "t", "groups": ["a", "b"]}]) == {
        "b": ("staff", "t"), "a": ("step", "t")}
