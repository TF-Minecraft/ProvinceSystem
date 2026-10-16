"""The TFMCWeb bridge's responses, byte for byte as the SQLite code sent them.

EXPECTED was recorded from the SQLite version (origin/postgres at 7d2a1ee7) with
the same requests. The commands view's received time is the wall clock, so only
its form is compared.
"""
import re

from src.luckperms.test_luckperms import (  # noqa: F401
    ALICE, BOB, PLUGIN, app, bridge, client, env, node, snapshot, staff, submit,
)

EXPECTED = {
    'snapshot': (200, '{"ok":true,"groups":9,"tracks":2,"users":4}'),
    'snapshot_stale': (200, '{"ok":true,"stale":true}'),
    'unchanged_ok': (200, '{"ok":true}'),
    'unchanged_full': (200, '{"ok":false,"need_full":true}'),
    'changes': (200, '{"changes":[{"id":1,"target_type":"user","target":"11111111-1111-1111-1111-111111111111","target_name":"Alice","actor_name":"web:adam","actor_uuid":"33333333-3333-3333-3333-333333333333","description":"parent add noble server=dev server=main world=w; permission unset tips.off server=main","ops":[{"node":{"contexts":{"server":["dev","main"],"world":["w"]},"expiry":0,"key":"group.noble","value":true},"op":"add_node"},{"node":{"contexts":{"server":["main"]},"expiry":0,"key":"tips.off","value":true},"op":"remove_node"}],"guard":{"admin_groups":["commoner","default","helper","helper_inactive","helper_player","noble"]}},{"id":2,"target_type":"user","target":"22222222-2222-2222-2222-222222222222","target_name":"Bob","actor_name":"web:rory","actor_uuid":"44444444-4444-4444-4444-444444444444","description":"promote helper","ops":[{"node":{"contexts":{},"expiry":0,"key":"group.helper_player","value":true},"op":"remove_node"},{"node":{"contexts":{},"expiry":0,"key":"group.helper_inactive","value":true},"op":"add_node"}]}]}'),
    'changes_again': (200, '{"changes":[]}'),
    'results': (200, '{"ok":true,"recorded":2}'),
    'definition_change': (200, '{"changes":[{"id":3,"target_type":"group","target":"noble","target_name":"noble","actor_name":"web:rory","actor_uuid":"44444444-4444-4444-4444-444444444444","description":"permission set essentials.fly true server=main","ops":[{"node":{"contexts":{"server":["main"]},"expiry":0,"key":"essentials.fly","value":true},"op":"add_node"}]}]}'),
    'commands': (200, '{"ok":true,"commands":1}'),
}

COMMANDS_VIEW = '{"status":{"server":"main","generated_at":1792076432,"received_at":"2026-10-16T21:43:19Z","fresh":true},"groups":[{"name":"default","display_name":null,"weight":null,"members":0,"kind":"rank","track":null,"parents":[],"nodes":[]}],"plugins":[{"name":"Essentials","version":"2.22.0","commands":[{"name":"me","aliases":[],"description":null,"usage":null,"permission":"essentials.me","shadowed":false,"access":"y"}]}]}'


def test_the_bridge_sees_the_same_bytes(app, bridge, staff):
    plugin = client(app)
    seen = {}

    def keep(name, response):
        seen[name] = (response.status_code, response.content.decode())

    keep("snapshot", plugin.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot(revision=1001)))
    keep("snapshot_stale", plugin.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=snapshot(revision=900)))
    keep("unchanged_ok", plugin.post("/luckperms/plugin/snapshot/unchanged", headers=PLUGIN,
                                     json={"hash": "h1", "revision": 1002}))
    keep("unchanged_full", plugin.post("/luckperms/plugin/snapshot/unchanged", headers=PLUGIN,
                                       json={"hash": "x", "revision": 1003}))
    submit(app, staff["admin"], "user", ALICE, [
        {"op": "add_node", "node": {"key": "group.Noble", "contexts": {"world": "w", "server": ["main", "dev"]}}},
        {"op": "remove_node", "node": node("tips.off", contexts={"server": ["main"]})},
    ])
    submit(app, staff["root"], "user", BOB, [{"op": "promote", "track": "helper"}])
    keep("changes", plugin.get("/luckperms/plugin/changes", headers=PLUGIN))
    keep("changes_again", plugin.get("/luckperms/plugin/changes", headers=PLUGIN))
    state = {"uuid": ALICE, "name": "Alice",
              "nodes": [node("group.noble", contexts={"server": ["dev", "main"], "world": ["w"]})]}
    keep("results", plugin.post("/luckperms/plugin/changes/results", headers=PLUGIN, json={"results": [
        {"id": 1, "ok": True, "revision": 2000, "state": state}, {"id": 2, "ok": False, "error": "node_missing"},
        {"id": 2, "ok": True}, {"id": 99, "ok": True}, {"id": "x"}]}))
    submit(app, staff["root"], "group", "noble", [
        {"op": "add_node", "node": {"key": "essentials.fly", "contexts": {"server": "main"}}}])
    keep("definition_change", plugin.get("/luckperms/plugin/changes", headers=PLUGIN))
    keep("commands", plugin.put("/luckperms/plugin/commands", headers=PLUGIN, json={
        "server": "main", "generated_at": 1792076432, "hash": "c1", "groups": ["default"],
        "plugins": [{"name": "Essentials", "version": "2.22.0"}],
        "commands": [{"plugin": "Essentials", "name": "me", "aliases": [], "description": None, "usage": None,
                      "permission": "essentials.me", "shadowed": False, "access": "y"}]}))
    assert seen == EXPECTED
    view = client(app, staff["mod"]).get("/admin/luckperms/commands").content.decode()
    stamp = re.search(r'"received_at":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)"', view)
    assert stamp and view.replace(stamp.group(1), "TIME") == re.sub(r'(?<="received_at":")[^"]+', "TIME", COMMANDS_VIEW)
