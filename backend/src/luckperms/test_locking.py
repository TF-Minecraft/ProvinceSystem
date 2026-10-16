"""The LuckPerms locking recipes, each raced on two connections against the real Postgres.

Lock order in every LuckPerms transaction: `lp_state` first, then users and
sessions, then `lp_changes` rows. Each test holds a lock, either by hand on its
own connection or through a Gate that pauses a path just after a chosen
statement, runs the competing path on another thread, sees it wait in
pg_stat_activity, then lets the holder commit and checks the waiter acted on the
holder's result. The helpers are the accounts ones (src/auth/test_locking.py).
"""
from datetime import timedelta

from src import database
from src.auth import testing
from src.auth.test_locking import ROW, Gate, Run, held, lock_wait, race
from src.luckperms import changes, mirror
from src.luckperms.test_luckperms import (  # noqa: F401
    ALICE, BOB, PLUGIN, app, bridge, client, env, group, node, snapshot, staff, submit,
)

TIPS = [{"op": "add_node", "node": {"key": "tips.off"}}]


def user_id(name: str) -> int:
    return testing.value("SELECT id FROM users WHERE discord_username = %s", (name,))


def status(change_id: int) -> str:
    return testing.value("SELECT status FROM lp_changes WHERE id = %s", (change_id,))


def sent_change(app, staff) -> int:
    """A change to Alice the bridge has collected."""
    change = submit(app, staff["admin"], "user", ALICE, TIPS).json()
    assert len(changes.fetch_for_bridge()) == 1
    return change["id"]


# --------------------
# X5: lp_state FOR UPDATE first in every mirror write
# --------------------

def test_two_snapshots_apply_one_after_the_other(bridge, monkeypatch):
    """A delayed older snapshot waits for the newer one, then sees its revision and is stale."""
    newer = snapshot(revision=2000, hash="new", users=[{"uuid": BOB, "name": "Bob", "nodes": []}])
    older = snapshot(revision=1500, hash="old")
    gate = Gate(monkeypatch, "DELETE FROM lp_users")
    one, two = race(gate, lambda: mirror.replace_snapshot(newer), lambda: mirror.replace_snapshot(older), ROW)
    assert one.error is None and one.value["users"] == 1
    assert two.error is None and two.value == {"ok": True, "stale": True}
    assert [r["uuid"] for r in testing.rows("SELECT uuid FROM lp_users")] == [BOB]
    assert testing.value("SELECT hash FROM lp_state") == "new"


# --------------------
# queue_change: lp_state FOR SHARE, X1, then C on idx_lp_changes_one_open
# --------------------

def test_a_change_is_checked_against_one_mirror(app, bridge, staff, monkeypatch):
    """A snapshot dropping the group being granted waits until the change is queued."""
    without_noble = snapshot(revision=2000, groups=[g for g in snapshot()["groups"] if g["name"] != "noble"])
    # Paused after the actor and mirror locks, before the ops are built from the mirror.
    gate = Gate(monkeypatch, "FROM lp_changes WHERE target_type")
    one, two = race(
        gate,
        lambda: submit(app, staff["admin"], "user", ALICE, [{"op": "add_node", "node": {"key": "group.noble"}}]),
        lambda: mirror.replace_snapshot(without_noble),
        ROW,
    )
    assert one.value.status_code == 200, one.value.text
    assert two.error is None and two.value["groups"] == 8


def test_two_changes_to_one_target_queue_once(app, bridge, staff, monkeypatch):
    """C: the second insert waits on the first's open change, then is refused as change_pending."""
    gate = Gate(monkeypatch, "INSERT INTO lp_changes")
    one, two = race(
        gate,
        lambda: submit(app, staff["admin"], "user", ALICE, TIPS),
        lambda: submit(app, staff["root"], "user", ALICE, [{"op": "add_node", "node": {"key": "tips.on"}}]),
        ROW,
    )
    assert one.value.status_code == 200
    assert two.value.status_code == 409 and two.value.json()["detail"] == "change_pending"
    assert testing.value("SELECT count(*) FROM lp_changes") == 1
    rows = [(r["actor_name"], r["outcome"]) for r in testing.audit_rows() if r["action"] == "luckperms.change"]
    assert sorted(rows) == [("adam", "ok"), ("rory", "conflict")]


def test_a_demotion_waits_for_a_change_and_its_audit_row(app, bridge, staff, monkeypatch):
    """X1: the actor's rows are held FOR SHARE; the change and its audit row commit together."""
    adam = user_id("adam")
    gate = Gate(monkeypatch, "INSERT INTO admin_audit")
    queued = Run(lambda: submit(app, staff["admin"], "user", ALICE, TIPS))
    assert gate.reached.wait(10), queued.error
    # Both rows are written, neither is visible: one transaction.
    assert testing.value("SELECT count(*) FROM lp_changes") == 0
    assert testing.value("SELECT count(*) FROM admin_audit") == 0
    demotion = Run(lambda: testing.execute("UPDATE users SET role = 'mod' WHERE id = %s", (adam,)))
    lock_wait(demotion, ROW)
    gate.release.set()
    assert queued.join().value.status_code == 200 and demotion.join().value == 1
    [row] = [r for r in testing.audit_rows() if r["action"] == "luckperms.change"]
    assert (row["actor_role"], row["outcome"]) == ("admin", "ok")
    assert row["detail_json"]["change_id"] == testing.value("SELECT id FROM lp_changes")


# --------------------
# fetch_for_bridge: record_poll first, actors FOR SHARE, then B per row
# --------------------

def test_a_demotion_landing_first_cancels_the_change(app, bridge, staff):
    """_current_actor reads the actor FOR SHARE: it waits for the demotion and sees it."""
    change = submit(app, staff["admin"], "user", ALICE, TIPS).json()
    adam = user_id("adam")
    run = held(lambda conn: conn.execute("UPDATE users SET role = 'mod' WHERE id = %s", (adam,)),
               changes.fetch_for_bridge, ROW)
    assert run.error is None and run.value == []
    assert status(change["id"]) == "failed"


def test_a_demotion_waits_for_a_change_being_handed_out(app, bridge, staff, monkeypatch):
    submit(app, staff["admin"], "user", ALICE, TIPS)
    adam = user_id("adam")
    gate = Gate(monkeypatch, "SET status = 'sent'")
    one, two = race(gate, changes.fetch_for_bridge,
                    lambda: testing.execute("UPDATE users SET role = 'mod' WHERE id = %s", (adam,)), ROW)
    assert one.error is None and len(one.value) == 1
    assert two.error is None and two.value == 1


def test_a_change_is_handed_out_once(app, bridge, staff):
    """B: a change settled while being collected is not sent."""
    change = submit(app, staff["admin"], "user", ALICE, TIPS).json()
    run = held(lambda conn: conn.execute(
        "UPDATE lp_changes SET status = 'expired', error = 'expired', finished_at = now() WHERE id = %s",
        (change["id"],)), changes.fetch_for_bridge, ROW)
    assert run.error is None and run.value == []
    assert status(change["id"]) == "expired"


def test_two_polls_hand_a_change_out_once(app, bridge, staff, monkeypatch):
    submit(app, staff["admin"], "user", ALICE, TIPS)
    gate = Gate(monkeypatch, "SET status = 'sent'")
    one, two = race(gate, changes.fetch_for_bridge, changes.fetch_for_bridge, ROW)
    assert len(one.value) == 1 and two.value == []


# --------------------
# record_results: X5 first, then B per change
# --------------------

def _overdue(change_id: int) -> None:
    testing.execute("UPDATE lp_changes SET sent_at = %s WHERE id = %s",
                    (mirror._stamp() - timedelta(seconds=changes.RESULT_WAIT_SECONDS + 60), change_id))


def test_a_result_and_a_poll_never_deadlock(app, bridge, staff, monkeypatch):
    """The result holds lp_state before its change row, as the poll does, so the poll waits for it.

    In the old order (change rows, then lp_state in apply_state) the poll would take lp_state,
    wait to time the overdue change out, and the result would wait for lp_state: a deadlock.
    """
    change_id = sent_change(app, staff)
    _overdue(change_id)
    state = {"uuid": ALICE, "name": "Alice", "nodes": [node("group.commoner"), node("tips.off")]}
    gate = Gate(monkeypatch, "RETURNING target_type, target")
    one, two = race(
        gate,
        lambda: changes.record_results([{"id": change_id, "ok": True, "revision": 5000, "state": state}]),
        changes.fetch_for_bridge,
        ROW,
    )
    assert one.error is None and one.value == {"ok": True, "recorded": 1}
    assert two.error is None and two.value == []
    assert status(change_id) == "applied"
    assert "tips.off" in {r["key"] for r in testing.rows("SELECT key FROM lp_user_nodes WHERE uuid = %s", (ALICE,))}


def test_a_poll_and_a_result_never_deadlock(app, bridge, staff, monkeypatch):
    first = sent_change(app, staff)
    submit(app, staff["admin"], "user", BOB, TIPS)
    state = {"uuid": ALICE, "name": "Alice", "nodes": [node("group.commoner")]}
    gate = Gate(monkeypatch, "SET status = 'sent'")
    one, two = race(
        gate,
        changes.fetch_for_bridge,
        lambda: changes.record_results([{"id": first, "ok": True, "revision": 5000, "state": state}]),
        ROW,
    )
    assert one.error is None and [c["target"] for c in one.value] == [BOB]
    assert two.error is None and two.value == {"ok": True, "recorded": 1}
    assert status(first) == "applied"


def test_a_result_settles_a_change_once(app, bridge, staff):
    """B: a result racing a result already landing for the same change is ignored."""
    change_id = sent_change(app, staff)
    run = held(lambda conn: conn.execute("UPDATE lp_changes SET status = 'applied' WHERE id = %s", (change_id,)),
               lambda: changes.record_results([{"id": change_id, "ok": False, "error": "late"}]), ROW)
    assert run.error is None and run.value == {"ok": True, "recorded": 0}
    assert testing.rows("SELECT status, error FROM lp_changes") == [{"status": "applied", "error": None}]


# --------------------
# settle_timeouts: B
# --------------------

def test_a_timeout_never_overwrites_a_result_landing(app, bridge, staff):
    change_id = sent_change(app, staff)
    _overdue(change_id)
    run = held(lambda conn: conn.execute("UPDATE lp_changes SET status = 'applied' WHERE id = %s", (change_id,)),
               lambda: changes.get_change(change_id), ROW)
    assert run.error is None and run.value["status"] == "applied"


# --------------------
# Bulk apply
# --------------------

def big_snapshot(players: int, revision: int = 2000) -> dict:
    """`players` players with a rank, a track step, a few permissions and a server-only node each."""
    users = [
        {"uuid": f"{i:08x}-0000-4000-8000-{i:012x}", "name": f"Player{i}", "nodes": [
            node("group.commoner" if i % 3 else "group.noble"),
            node("group.helper_player") if i % 50 == 0 else node(f"professions.chef_{i % 5}"),
            node(f"jobs.level.{i % 40}"),
            node("tips.off", contexts={"server": ["main"]}),
            node(f"kits.daily.{i % 7}", expiry=4_000_000_000),
        ]}
        for i in range(players)
    ]
    return snapshot(revision=revision, hash=f"bulk{revision}", users=users)


def test_a_2000_player_snapshot_replaces_the_mirror(bridge):
    assert mirror.replace_snapshot(big_snapshot(2000)) == {"ok": True, "groups": 9, "tracks": 2, "users": 2000}
    assert testing.value("SELECT count(*) FROM lp_users") == 2000
    assert testing.value("SELECT count(*) FROM lp_user_nodes") == 10000
    with database.connect() as conn:
        nodes_of = mirror.user_nodes(conn, "00000032-0000-4000-8000-000000000032")
    assert nodes_of[-1] == node("tips.off", contexts={"server": ["main"]})
    # Applied again on top of itself, it replaces rather than adds.
    mirror.replace_snapshot(big_snapshot(2000, revision=2001))
    assert testing.value("SELECT count(*) FROM lp_user_nodes") == 10000


def test_what_postgres_cannot_store_refuses_the_snapshot(bridge):
    bad = snapshot(revision=2000, users=[{"uuid": ALICE, "name": "Alice", "nodes": [node("tips\x00off")]}])
    response = client_put(bridge, bad)
    assert response.status_code == 400 and response.json()["detail"] == "bad_snapshot"
    assert testing.value("SELECT revision FROM lp_state") == 1000


def client_put(bridge, payload):
    return bridge.put("/luckperms/plugin/snapshot", headers=PLUGIN, json=payload)


def test_two_snapshot_rows_for_one_player_keep_the_last_name(bridge):
    """INSERT OR REPLACE kept the last row per key; COPY is given the same rows."""
    twice = snapshot(revision=2000, users=[{"uuid": ALICE, "name": "Old", "nodes": [node("a.b")]},
                                           {"uuid": ALICE.upper(), "name": "New", "nodes": [node("c.d")]}],
                     groups=[group("default", None), group("default", 5, "x.y")],
                     tracks=[{"name": "t", "groups": ["default"]}, {"name": "t", "groups": []}])
    assert client_put(bridge, twice).json() == {"ok": True, "groups": 2, "tracks": 2, "users": 2}
    assert testing.rows("SELECT uuid, name FROM lp_users") == [{"uuid": ALICE, "name": "New"}]
    assert sorted(r["key"] for r in testing.rows("SELECT key FROM lp_user_nodes")) == ["a.b", "c.d"]
    assert testing.rows("SELECT weight FROM lp_groups") == [{"weight": 5}]
    assert testing.rows("SELECT groups_json FROM lp_tracks") == [{"groups_json": []}]
