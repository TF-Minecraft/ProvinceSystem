"""Cleanup snapshots raced against real roster, will and create writers."""
import threading
import time
from contextlib import contextmanager

import psycopg
import pytest
from psycopg.rows import dict_row

from src import database
from src.auth import testing
from src.auth.test_locking import ROW, Run
from src.characters import creates, realm_wipe, wardrobe, wills
from src.characters.roster import replace_roster
from src.characters.test_review_locking import asset_paths, valid_create  # noqa: F401

pytestmark = pytest.mark.usefixtures("postgres")


class Gate:
    def __init__(self, role, statement):
        self.role, self.statement = role, statement
        self.reached, self.release = threading.Event(), threading.Event()

    def hit(self, query):
        if threading.current_thread().name == self.role and self.statement in query and not self.reached.is_set():
            self.reached.set()
            assert self.release.wait(15), f"unreleased {self.role} gate"

    def wait(self, run):
        assert self.reached.wait(10), run.error


@contextmanager
def schedule(monkeypatch, postgres, *gates):
    real_connect = database.connect

    class Connection:
        def __init__(self, conn):
            self.conn = conn

        def __getattr__(self, name):
            return getattr(self.conn, name)

        def execute(self, query, params=None, **kwargs):
            result = self.conn.execute(query, params, **kwargs)
            for gate in gates:
                gate.hit(str(query))
            return result

    @contextmanager
    def connect(**kwargs):
        with real_connect(**kwargs) as conn:
            conn.execute("SELECT set_config('application_name', %s, true)", (threading.current_thread().name,))
            yield Connection(conn)

    monkeypatch.setattr(database, "connect", connect)
    monkeypatch.setattr(database.connection, "connect", connect)
    with psycopg.connect(postgres, autocommit=True, row_factory=dict_row) as observer:
        try:
            yield observer
        finally:
            for gate in gates:
                gate.release.set()


def run(role, fn):
    def call():
        threading.current_thread().name = role
        return fn()
    return Run(call)


def lock_wait(observer, worker, role, *, may_finish=False):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        row = observer.execute(
            "SELECT wait_event, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity "
            "WHERE datname = current_database() AND application_name = %s AND wait_event_type = 'Lock'",
            (role,),
        ).fetchone()
        if row:
            assert row["wait_event"] in ROW and row["blockers"], row
            return row
        if not worker.thread.is_alive():
            assert may_finish, worker.error
            return None
        time.sleep(.01)
    pytest.fail(f"no lock wait for {role}")


def character(cid):
    return {"id": cid, "name": f"Name {cid}", "status": "ALIVE", "will_revision": 0}


def cleanup(full):
    return realm_wipe.wipe_realm_character_data("main") if full else (
        realm_wipe.delete_characters_for_realm("main", ["b", "a"]))


@pytest.mark.parametrize("full", [False, True], ids=["tagged", "full-realm"])
def test_cleanup_never_locks_roster_rows_recreated_after_selection(monkeypatch, postgres, full):
    replace_roster("owner", [character("a"), character("b")])
    ids = [wills.create_will_request("owner", "main", cid, None, 0)["id"] for cid in ("a", "b")]
    testing.execute("UPDATE will_requests SET created_at = now() - interval '20 minutes'")
    wardrobe._upsert_live_slot("owner", "b", "base", b"original-png", texture_value="original",
                               texture_signature="sig", model="classic", display_name=None)
    [slot] = testing.rows("SELECT png_relpath FROM character_wardrobe_slots")
    png = wardrobe.DATA_DIR / slot["png_relpath"]
    replace_roster("owner", [])
    selected = Gate("cleanup", "ORDER BY character_id, player_uuid FOR UPDATE")
    asking = Gate("ask-b", "FROM character_roster WHERE")
    workers = []
    with schedule(monkeypatch, postgres, selected, asking) as observer:
        try:
            wipe = run("cleanup", lambda: cleanup(full))
            workers.append(wipe)
            selected.wait(wipe)
            # These application pushes give the heap b,a while acknowledgements
            # lock a,b. Both rows appeared after the cleanup's empty selection.
            replace_roster("owner", [character("b")])
            replace_roster("owner", [character("b"), character("a")])
            assert [r["character_id"] for r in testing.rows("SELECT character_id FROM character_roster")] == ["b", "a"]
            ask = run("ask-b", lambda: wills.create_will_request("owner", "main", "b", None, 0))
            workers.append(ask)
            asking.wait(ask)
            selected.release.set()
            # On the protection mutation the cleanup queues on b first. The
            # fixed cleanup finishes without acquiring either recreated row.
            cleanup_wait = lock_wait(observer, wipe, "cleanup", may_finish=True)
            ack = run("ack", lambda: wills.ack_will_results(
                "main", [{"id": rid, "result": "applied", "will_revision": 1} for rid in ids]))
            workers.append(ack)
            lock_wait(observer, ack, "ack")
        finally:
            selected.release.set()
            asking.release.set()
            for worker in workers:
                worker.join()
    assert all(worker.error is None for worker in workers), [w.error for w in workers]
    assert cleanup_wait is None
    assert wipe.value["total"] == 0 and wipe.value["pngs_deleted"] == 0
    assert ack.value == {"ok": True, "acked": [ids[0]], "already": [ids[1]], "refused": []}
    assert ask.value["status"] == "pending"
    assert testing.rows("SELECT character_id, will_revision FROM character_roster ORDER BY character_id") == [
        {"character_id": "a", "will_revision": 1}, {"character_id": "b", "will_revision": 0}]
    assert testing.value("SELECT count(*) FROM character_wardrobe_slots") == 1
    assert png.read_bytes() == b"original-png"


@pytest.mark.parametrize("full", [False, True], ids=["tagged", "full-realm"])
def test_cleanup_retains_late_owners_of_the_same_character_id(monkeypatch, postgres, full):
    replace_roster("captured-owner", [character("a")])
    replace_roster("dev-owner", [character("a")], realm_id="dev")
    for owner in ("captured-owner", "late-owner"):
        wardrobe._upsert_live_slot(owner, "a", "base", owner.encode(), texture_value=owner,
                                   texture_signature="sig", model="classic", display_name=None)
    selected = Gate("cleanup", "ORDER BY character_id, player_uuid FOR UPDATE")
    with schedule(monkeypatch, postgres, selected):
        wipe = run("cleanup", lambda: cleanup(full))
        try:
            selected.wait(wipe)
            replace_roster("late-owner", [character("a")])
        finally:
            selected.release.set()
            wipe.join()
    assert wipe.error is None
    assert wipe.value["deleted"]["character_roster"] == 1
    assert wipe.value["deleted"]["character_wardrobe_slots"] == 1
    assert testing.rows("SELECT player_uuid, realm_id FROM character_roster ORDER BY player_uuid") == [
        {"player_uuid": "dev-owner", "realm_id": "dev"}, {"player_uuid": "late-owner", "realm_id": "main"}]
    assert testing.rows("SELECT player_uuid FROM character_wardrobe_slots") == [{"player_uuid": "late-owner"}]


def test_full_wipe_and_create_ack_use_the_same_complete_lock_order(monkeypatch, postgres):
    body = valid_create()
    ids = iter(("b", "a"))
    monkeypatch.setattr(creates.uuid_lib, "uuid4", lambda: next(ids))
    creates.create_character("owner-b", {**body, "name": "Brena"})
    creates.create_character("owner-a", body)
    assert [r["id"] for r in testing.rows("SELECT id FROM character_creation_requests")] == ["b", "a"]
    releasing = Gate("release-b", "UPDATE character_creation_requests SET held_until")
    workers = []
    with schedule(monkeypatch, postgres, releasing) as observer:
        try:
            release = run("release-b", lambda: creates.release_create("owner-b", "b"))
            workers.append(release)
            releasing.wait(release)
            wipe = run("cleanup", lambda: cleanup(True))
            workers.append(wipe)
            lock_wait(observer, wipe, "cleanup")
            ack = run("ack", lambda: creates.mark_applied_results([{"id": cid, "ok": False} for cid in ("a", "b")]))
            workers.append(ack)
            lock_wait(observer, ack, "ack")
        finally:
            releasing.release.set()
            for worker in workers:
                worker.join()
    assert all(worker.error is None for worker in workers), [w.error for w in workers]
    assert wipe.value["deleted"]["character_creation_requests"] == 2
    assert ack.value == {"ok": True, "applied": [], "rejected": []}
    assert release.value == {"ok": True, "id": "b"}


def test_full_wipe_retains_creates_and_pending_slots_appearing_after_selection(monkeypatch, postgres):
    body = valid_create()
    wardrobe._upsert_pending_slot("late-create", "base", b"pending-png", texture_value="pending",
                                  texture_signature="sig", model="classic", display_name=None)
    [slot] = testing.rows("SELECT png_relpath FROM character_creation_wardrobe")
    png = wardrobe.DATA_DIR / slot["png_relpath"]
    monkeypatch.setattr(creates.uuid_lib, "uuid4", lambda: "late-create")
    selected = Gate("cleanup", "ORDER BY id FOR UPDATE")
    with schedule(monkeypatch, postgres, selected):
        wipe = run("cleanup", lambda: cleanup(True))
        try:
            selected.wait(wipe)
            created = creates.create_character("owner", body)
        finally:
            selected.release.set()
            wipe.join()
    assert wipe.error is None and created["id"] == "late-create"
    assert wipe.value["total"] == 0 and wipe.value["pngs_deleted"] == 0
    assert testing.value("SELECT count(*) FROM character_creation_requests") == 1
    assert testing.value("SELECT count(*) FROM character_creation_wardrobe") == 1
    assert png.read_bytes() == b"pending-png"
