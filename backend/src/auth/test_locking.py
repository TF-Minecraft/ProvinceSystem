"""The accounts locking recipes, each raced on two connections against the real Postgres.

One transaction holds a lock: either by hand on its own connection, or through a
Gate that pauses a path's transaction just after a chosen statement. The competing
path then runs on another thread. The test checks in pg_stat_activity that it is
waiting on a lock, and on which kind (`advisory` for the placeholders lock X3, a row
lock otherwise), then lets the holder commit and checks the waiter acted on the
holder's result instead of what it read before.

Where a path takes the X3 advisory lock first, races between two whole calls of it
are serialised by X3, so tests that isolate a row-lock or constraint recipe hold
the competing row by hand instead.
"""
import sqlite3
import threading
import time
from contextlib import contextmanager

import pytest

from src import database
from src.auth import admin, admin_cli, preview_sign_in, testing, users, view_as
from src.auth.test_admin import ORIGIN, account, app, client, discord_id_of, env  # noqa: F401
from src.auth.test_view_as import UUID, link_only
from src.skins.codes import hash_secret

ADVISORY = {"advisory"}
ROW = {"transactionid", "tuple"}


class _Gated:
    def __init__(self, conn, gate):
        self._conn = conn
        self._gate = gate

    def execute(self, query, params=None, **kwargs):
        cursor = self._conn.execute(query, params, **kwargs)
        self._gate.hit(str(query))
        return cursor

    def __getattr__(self, name):
        return getattr(self._conn, name)


class Gate:
    """Pauses the first transaction that runs a statement containing `pattern`, until released."""

    def __init__(self, monkeypatch, pattern):
        self.pattern = pattern
        self.reached = threading.Event()
        self.release = threading.Event()
        self._armed = True
        self._lock = threading.Lock()
        real_connect, real_transaction = database.connect, database.transaction

        @contextmanager
        def connect(**kwargs):
            with real_connect(**kwargs) as conn:
                yield _Gated(conn, self)

        @contextmanager
        def transaction(**kwargs):
            with real_transaction(**kwargs) as conn:
                yield _Gated(conn, self)

        monkeypatch.setattr(database, "connect", connect)
        monkeypatch.setattr(database, "transaction", transaction)

    def hit(self, query):
        with self._lock:
            if not self._armed or self.pattern not in query:
                return
            self._armed = False
        self.reached.set()
        assert self.release.wait(15), "gate never released"


class Run:
    """fn() on its own thread; .value or .error once joined."""

    def __init__(self, fn):
        self.value = self.error = None
        self.thread = threading.Thread(target=self._run, args=(fn,), daemon=True)
        self.thread.start()

    def _run(self, fn):
        try:
            self.value = fn()
        except BaseException as exc:  # noqa: BLE001 - reported by the test
            self.error = exc

    def join(self):
        self.thread.join(25)
        assert not self.thread.is_alive()
        return self


def lock_wait(run: Run, kinds: set[str]) -> str:
    """Wait until another backend of this database waits on a lock of one of `kinds`; return the kind.

    Fails if `run` finishes first: then it never waited.
    """
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        rows = testing.rows(
            "SELECT wait_event FROM pg_stat_activity WHERE datname = current_database() "
            "AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()"
        )
        if rows:
            [row] = rows
            assert row["wait_event"] in kinds, f"waiting on {row['wait_event']}, expected one of {kinds}"
            return row["wait_event"]
        if not run.thread.is_alive():
            pytest.fail(f"it finished without waiting on a lock ({run.error!r})")
        time.sleep(0.02)
    pytest.fail("no lock wait seen")


def race(gate, first, second, kinds):
    """Run `first` up to the gate, start `second`, see it wait on `kinds`, then let both finish."""
    one = Run(first)
    assert gate.reached.wait(10), one.error
    two = Run(second)
    lock_wait(two, kinds)
    gate.release.set()
    return one.join(), two.join()


def held(hold, fn, kinds):
    """fn() while `hold(conn)` keeps its locks on another connection; it must wait on `kinds`."""
    with database.connect() as conn:
        hold(conn)
        run = Run(fn)
        lock_wait(run, kinds)
    return run.join()


def auth_config():
    from src.api import auth_routes

    return auth_routes._config()


# --------------------
# B: compare-and-set
# --------------------

def test_a_discord_state_is_spent_once(env, monkeypatch):
    state, _ = users.start_sign_in(auth_config(), "/map")
    gate = Gate(monkeypatch, "DELETE FROM discord_oauth_states")
    spend = lambda: users.consume_state(state)  # noqa: E731
    one, two = race(gate, spend, spend, ROW)
    assert (one.value, two.value) == ("/map", None)


def test_a_preview_ticket_is_redeemed_once(env, monkeypatch):
    account(env, "steve")
    token = users.sign_in({"discord_user_id": discord_id_of("steve"), "discord_username": "steve",
                           "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    site = "https://branch.tfminecraft.net"
    ticket = preview_sign_in.issue(site, users.session_user(token))
    gate = Gate(monkeypatch, "DELETE FROM preview_sign_in_tickets t")
    redeem = lambda: preview_sign_in.redeem(ticket, site)  # noqa: E731
    one, two = race(gate, redeem, redeem, ROW)
    assert one.value["discord_username"] == "steve" and two.value is None


# --------------------
# C: constraints
# --------------------

def test_a_first_sign_in_joins_an_account_being_made(env):
    """C on its own: the upsert waits on the uncommitted row with the same Discord id, then updates it."""
    discord_id = "123456789012345678"
    identity = {"discord_user_id": discord_id, "discord_username": "new", "discord_global_name": None,
                "discord_avatar": None}
    run = held(
        lambda conn: conn.execute(
            "INSERT INTO users (discord_user_id, discord_username, created_at, updated_at, last_login_at) "
            "VALUES (%s, 'other', now(), now(), now())", (discord_id,)),
        lambda: users.sign_in(identity, guild_member=True),
        ROW,
    )
    assert run.error is None
    assert testing.rows("SELECT discord_username FROM users") == [{"discord_username": "new"}]
    assert testing.value("SELECT COUNT(*) FROM user_sessions") == 1


def test_a_placeholder_never_collides_with_a_new_account(env):
    """C on its own: a placeholder insert waits for a sign-in's insert of the same id and keeps it."""
    discord_id = link_only(env, "steve")

    def make():
        with database.connect() as conn:
            return view_as._make_placeholder(conn, {"discord_user_id": discord_id, "discord_username": "steve"})

    run = held(
        lambda conn: conn.execute(
            "INSERT INTO users (discord_user_id, discord_username, created_at, updated_at, last_login_at) "
            "VALUES (%s, 'steve', now(), now(), now())", (discord_id,)),
        make,
        ROW,
    )
    assert run.error is None and run.value["discord_user_id"] == discord_id
    assert testing.value("SELECT placeholder FROM users WHERE discord_user_id = %s", (discord_id,)) is False


# --------------------
# A: row locks
# --------------------

def test_a_role_change_waits_for_a_change_to_its_target(env):
    """A in _staff_write: the target's row is locked before it is read, so a change landing
    meanwhile is seen (here: the role is already what was asked) rather than overwritten."""
    _, rory = account(env, "rory", "root")
    rhea_id, _ = account(env, "rhea", "root")
    run = held(
        lambda conn: conn.execute("UPDATE users SET role = 'admin' WHERE id = %s", (rhea_id,)),
        lambda: admin.change_role(rory, rhea_id, "admin", "Stepping down"),
        ROW,
    )
    assert isinstance(run.error, admin.AdminError) and run.error.code == "role_unchanged"


def test_root_locks_wait_for_a_panel_demotion(env):
    """A in _set_root: the root count waits for a demotion that holds a root's row."""
    rory_id, _ = account(env, "rory", "root")
    account(env, "rhea", "root")
    run = held(
        lambda conn: conn.execute("UPDATE users SET role = 'admin' WHERE id = %s", (rory_id,)),
        lambda: admin_cli._set_root(discord_id_of("rhea"), "Stepping down", grant=False),
        ROW,
    )
    assert isinstance(run.error, SystemExit) and "last root" in str(run.error)
    assert testing.value("SELECT COUNT(*) FROM users WHERE role = 'root'") == 1


# --------------------
# X1: staff re-checks hold the session and user rows
# --------------------

@pytest.mark.parametrize("change", [
    "UPDATE users SET role = 'mod' WHERE id = %s",
    "DELETE FROM user_sessions WHERE user_id = %s",
])
def test_a_staff_recheck_holds_off_demotion_and_revocation(env, change):
    admin_id, token = account(env, "adam", "admin")
    with database.connect() as conn:
        assert users.session_user_in(conn, token, lock=True)["role"] == "admin"
        other = Run(lambda: testing.execute(change, (admin_id,)))
        lock_wait(other, ROW)
    other.join()
    assert other.error is None and other.value == 1


def test_an_ordinary_session_read_takes_no_lock(env):
    admin_id, token = account(env, "adam", "admin")
    with database.connect() as conn:
        assert users.session_user_in(conn, token)["role"] == "admin"
        assert testing.execute("UPDATE users SET role = 'mod' WHERE id = %s", (admin_id,)) == 1


def test_a_lock_cannot_be_asked_of_the_sqlite_bridge(env):
    _, token = account(env, "adam", "admin")
    with pytest.raises(TypeError, match="Postgres"):
        users.session_user_in(sqlite3.connect(":memory:"), token, lock=True)


def test_a_server_action_and_a_demotion_never_cross(app, env, monkeypatch):  # noqa: F811
    from src.servers import control

    monkeypatch.setattr(control, "request", lambda op, **body: {"id": body["job_id"]})
    _, root = account(env, "rory", "root")
    adam_id, adam = account(env, "adam", "admin")
    # Paused once the action's audit row is written, still inside its transaction.
    gate = Gate(monkeypatch, "INSERT INTO admin_audit")
    body = {"id": "c" * 32, "reason": "scheduled restart"}
    first, second = race(
        gate,
        lambda: client(app, adam).post("/admin/servers/dev/cancel", json=body, headers=ORIGIN),
        lambda: admin.change_role(root, adam_id, "mod", "Stepping down"),
        ROW,
    )
    assert first.value.status_code == 200 and second.error is None
    rows = [(r["action"], r["actor_role"], r["outcome"]) for r in testing.audit_rows()]
    # The action was on record as the admin's before the demotion could commit.
    assert rows[0] == ("server.cancel", "admin", "requested")
    assert rows.index(("account.role.change", "root", "ok")) > 0


# --------------------
# X2: ending a view once
# --------------------

def _view(env):
    _, admin_token = account(env, "boss", "admin")
    link_only(env, "steve")
    return view_as.start(admin_token, UUID)["token"]


def test_ending_a_view_locks_its_session_row(env):
    """X2 on its own, without the placeholders lock: the second end finds nothing left to end."""
    view_token = _view(env)
    where = ("s.token_hash = %s", (hash_secret(view_token),))

    def end():
        with database.connect() as conn:
            return view_as._end_where(conn, *where)

    run = held(lambda conn: view_as._end_where(conn, *where), end, ROW)
    assert run.error is None and run.value == []
    assert [r["action"] for r in testing.audit_rows()].count("account.view_as.stop") == 1


def test_a_view_still_open_check_holds_the_view_until_its_write_commits(env):
    """view_still_open on a Postgres connection: ending the view waits for the check's transaction."""
    view_token = _view(env)
    view = users.session_user(view_token)
    with database.connect() as conn:
        assert view_as.view_still_open(view["session_id"])(conn) is True
        ending = Run(lambda: view_as.end(view_token))
        lock_wait(ending, ROW)
    assert ending.join().error is None
    assert users.session_user(view_token) is None


# --------------------
# X3: placeholders and the views being committed
# --------------------

def test_two_requests_ending_one_view_wait_for_each_other(env, monkeypatch):
    """Two whole end() calls: the placeholders lock serialises them, and the view is ended once."""
    view_token = _view(env)
    gate = Gate(monkeypatch, "FOR UPDATE OF s")
    end = lambda: view_as.end(view_token)  # noqa: E731
    one, two = race(gate, end, end, ADVISORY)
    assert one.error is None and two.error is None
    assert [r["action"] for r in testing.audit_rows()].count("account.view_as.stop") == 1


def test_a_view_being_opened_keeps_its_placeholder(env, monkeypatch):
    """Ending one admin's view while another admin opens a view of the same placeholder."""
    _, boss = account(env, "boss", "admin")
    _, other = account(env, "other", "admin")
    link_only(env, "steve")
    first_view = view_as.start(boss, UUID)["token"]
    gate = Gate(monkeypatch, "INSERT INTO user_sessions")
    opening, ending = race(gate, lambda: view_as.start(other, UUID), lambda: view_as.end(first_view), ADVISORY)
    assert opening.error is None and ending.error is None
    assert users.session_user(first_view) is None
    second = users.session_user(opening.value["token"])
    assert second is not None and second["discord_username"] == "steve"
    assert testing.value("SELECT COUNT(*) FROM users WHERE placeholder") == 1


def test_two_roots_demoting_each_other_run_one_after_the_other(env, monkeypatch):
    """Two whole role changes: the placeholders lock serialises them; the second's actor is gone."""
    one_id, one = account(env, "rory", "root")
    two_id, two = account(env, "rhea", "root")
    gate = Gate(monkeypatch, "FOR UPDATE")
    first, second = race(gate, lambda: admin.change_role(one, two_id, "admin", "Stepping down"),
                         lambda: admin.change_role(two, one_id, "admin", "Stepping down"), ADVISORY)
    assert first.error is None and first.value["after"] == "admin"
    assert isinstance(second.error, admin.AdminError) and second.error.code == "not_signed_in"
    assert testing.value("SELECT role FROM users WHERE id = %s", (one_id,)) == "root"


def test_two_cli_removals_cannot_leave_no_root(env, monkeypatch):
    """Two whole revoke-root runs: the placeholders lock serialises them; the second sees one root."""
    account(env, "rory", "root")
    account(env, "rhea", "root")
    gate = Gate(monkeypatch, "FOR UPDATE")
    first, second = race(
        gate,
        lambda: admin_cli._set_root(discord_id_of("rory"), "Stepping down", grant=False),
        lambda: admin_cli._set_root(discord_id_of("rhea"), "Stepping down", grant=False),
        ADVISORY,
    )
    assert first.error is None
    assert isinstance(second.error, SystemExit) and "last root" in str(second.error)
    assert testing.value("SELECT COUNT(*) FROM users WHERE role = 'root'") == 1


def test_every_leftover_sweep_takes_the_placeholders_lock_first(env):
    _, boss = account(env, "boss", "admin")
    pat_id, _ = account(env, "pat")
    _, root = account(env, "rory", "root")
    link_only(env, "steve")
    identity = {"discord_user_id": "123456789012345678", "discord_username": "new", "discord_global_name": None,
                "discord_avatar": None}

    def under_lock(fn):
        run = held(lambda conn: database.advisory_lock(conn, users.PLACEHOLDERS_LOCK), fn, ADVISORY)
        assert run.error is None, run.error
        return run.value

    under_lock(lambda: users.sign_in(identity, guild_member=True))
    first = under_lock(lambda: view_as.start(boss, UUID))["token"]
    under_lock(lambda: view_as.end(first))
    second = view_as.start(boss, UUID)["token"]
    assert under_lock(lambda: view_as.stop(second, boss))["ended"] is True
    under_lock(lambda: view_as.end_lapsed(boss))
    under_lock(lambda: admin.change_role(root, pat_id, "mod", "Helping out"))
    under_lock(lambda: admin.revoke_sessions(root, pat_id, "Shared login"))
    under_lock(lambda: admin_cli._set_root(discord_id_of("pat"), "Second owner", grant=True))
