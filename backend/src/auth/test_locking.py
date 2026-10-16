"""The accounts locking recipes, each raced on two connections against the real Postgres.

A Gate pauses one thread's transaction just after a chosen statement, holding
whatever that statement locked. The second thread then runs the competing path:
it must wait (shown by it still running) and, once the first commits, see the
first's result instead of acting on what it read before.
"""
import threading
from contextlib import contextmanager

import pytest

from src import database
from src.auth import admin, admin_cli, preview_sign_in, testing, users, view_as
from src.auth.test_admin import ORIGIN, account, app, client, discord_id_of, env  # noqa: F401
from src.auth.test_view_as import UUID, link_only
from src.skins.codes import hash_secret

WAIT = 0.5


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
    """fn(*args) on its own thread; .value or .error once joined."""

    def __init__(self, fn, *args):
        self.value = self.error = None
        self.thread = threading.Thread(target=self._run, args=(fn, args), daemon=True)
        self.thread.start()

    def _run(self, fn, args):
        try:
            self.value = fn(*args)
        except BaseException as exc:  # noqa: BLE001 - reported by the test
            self.error = exc

    def waiting(self) -> bool:
        self.thread.join(WAIT)
        return self.thread.is_alive()

    def join(self):
        self.thread.join(20)
        assert not self.thread.is_alive()
        return self


def race(gate, first, second):
    """Run `first` up to the gate, start `second`, check it waits, then let both finish."""
    one = Run(*first)
    assert gate.reached.wait(10), one.error
    two = Run(*second)
    assert two.waiting(), "the second transaction did not wait"
    gate.release.set()
    return one.join(), two.join()


# --------------------
# B: compare-and-set
# --------------------

def test_a_discord_state_is_spent_once(env, monkeypatch):
    state, _ = users.start_sign_in(auth_config(), "/map")
    gate = Gate(monkeypatch, "DELETE FROM discord_oauth_states")
    one, two = race(gate, (users.consume_state, state), (users.consume_state, state))
    assert (one.value, two.value) == ("/map", None)


def test_a_preview_ticket_is_redeemed_once(env, monkeypatch):
    account(env, "steve")
    token = users.sign_in({"discord_user_id": discord_id_of("steve"), "discord_username": "steve",
                           "discord_global_name": None, "discord_avatar": None}, guild_member=True)
    site = "https://branch.tfminecraft.net"
    ticket = preview_sign_in.issue(site, users.session_user(token))
    gate = Gate(monkeypatch, "DELETE FROM preview_sign_in_tickets t")
    one, two = race(gate, (preview_sign_in.redeem, ticket, site), (preview_sign_in.redeem, ticket, site))
    assert one.value["discord_username"] == "steve" and two.value is None


# --------------------
# C: constraints
# --------------------

def test_two_first_sign_ins_make_one_account_with_two_sessions(env, monkeypatch):
    identity = {"discord_user_id": "123456789012345678", "discord_username": "new", "discord_global_name": None,
                "discord_avatar": None}
    gate = Gate(monkeypatch, "INSERT INTO users")
    sign_in = (lambda: users.sign_in(identity, guild_member=True),)
    one, two = race(gate, sign_in, sign_in)
    assert one.error is None and two.error is None and one.value != two.value
    assert testing.value("SELECT COUNT(*) FROM users") == 1
    assert testing.value("SELECT COUNT(*) FROM user_sessions") == 2


def test_a_placeholder_never_collides_with_a_new_account(env):
    """C on its own: a placeholder insert waits for a sign-in's insert of the same id and keeps it."""
    discord_id = link_only(env, "steve")
    with database.connect() as first:
        first.execute("INSERT INTO users (discord_user_id, discord_username, created_at, updated_at, last_login_at) "
                      "VALUES (%s, 'steve', now(), now(), now())", (discord_id,))

        def make():
            with database.connect() as conn:
                return view_as._make_placeholder(conn, {"discord_user_id": discord_id, "discord_username": "steve"})

        second = Run(make)
        assert second.waiting()
    second.join()
    assert second.error is None and second.value["discord_user_id"] == discord_id
    assert testing.value("SELECT placeholder FROM users WHERE discord_user_id = %s", (discord_id,)) is False


# --------------------
# A: row locks
# --------------------

def test_two_roots_demoting_each_other_cannot_both_win(env, monkeypatch):
    one_id, one = account(env, "rory", "root")
    two_id, two = account(env, "rhea", "root")
    gate = Gate(monkeypatch, "FOR UPDATE")
    first, second = race(gate, (admin.change_role, one, two_id, "admin", "Stepping down"),
                         (admin.change_role, two, one_id, "admin", "Stepping down"))
    assert first.error is None and first.value["after"] == "admin"
    # The first revoked the second's sessions: the second finds its actor gone.
    assert isinstance(second.error, admin.AdminError) and second.error.code == "not_signed_in"
    assert testing.value("SELECT role FROM users WHERE id = %s", (one_id,)) == "root"


def test_the_last_root_cannot_be_removed_twice(env, monkeypatch):
    one_id, _ = account(env, "rory", "root")
    two_id, _ = account(env, "rhea", "root")
    gate = Gate(monkeypatch, "FOR UPDATE")
    revoke = admin_cli._set_root
    first, second = race(
        gate,
        (lambda: revoke(discord_id_of("rory"), "Stepping down", grant=False),),
        (lambda: revoke(discord_id_of("rhea"), "Stepping down", grant=False),),
    )
    assert first.error is None
    assert isinstance(second.error, SystemExit) and "last root" in str(second.error)
    assert testing.value("SELECT COUNT(*) FROM users WHERE role = 'root'") == 1


def test_root_locks_wait_for_a_panel_demotion(env):
    """A without the advisory lock: the root count waits for a demotion that holds a root's row."""
    one_id, _ = account(env, "rory", "root")
    account(env, "rhea", "root")
    with database.connect() as first:
        first.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (one_id,))
        first.execute("UPDATE users SET role = 'admin' WHERE id = %s", (one_id,))
        second = Run(lambda: admin_cli._set_root(discord_id_of("rhea"), "Stepping down", grant=False))
        assert second.waiting()
    second.join()
    assert isinstance(second.error, SystemExit) and "last root" in str(second.error)


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
        other = Run(testing.execute, change, (admin_id,))
        assert other.waiting(), "the change did not wait for the staff action"
    other.join()
    assert other.error is None and other.value == 1


def test_an_ordinary_session_read_takes_no_lock(env):
    admin_id, token = account(env, "adam", "admin")
    with database.connect() as conn:
        assert users.session_user_in(conn, token)["role"] == "admin"
        assert testing.execute("UPDATE users SET role = 'mod' WHERE id = %s", (admin_id,)) == 1


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
        (lambda: client(app, adam).post("/admin/servers/dev/cancel", json=body, headers=ORIGIN),),
        (admin.change_role, root, adam_id, "mod", "Stepping down"),
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


def test_two_requests_ending_one_view_end_and_audit_it_once(env, monkeypatch):
    view_token = _view(env)
    gate = Gate(monkeypatch, "FOR UPDATE OF s")
    one, two = race(gate, (view_as.end, view_token), (view_as.end, view_token))
    assert one.error is None and two.error is None
    assert [r["action"] for r in testing.audit_rows()].count("account.view_as.stop") == 1


def test_ending_a_view_locks_its_session_row(env):
    """X2 on its own, without the placeholders lock: the second end finds nothing left to end."""
    view_token = _view(env)
    where = ("s.token_hash = %s", (hash_secret(view_token),))

    def end():
        with database.connect() as conn:
            return view_as._end_where(conn, *where)

    with database.connect() as first:
        assert len(view_as._end_where(first, *where)) == 1
        second = Run(end)
        assert second.waiting()
    second.join()
    assert second.error is None and second.value == []
    assert [r["action"] for r in testing.audit_rows()].count("account.view_as.stop") == 1


# --------------------
# X3: placeholders and the views being committed
# --------------------

def test_a_view_being_opened_keeps_its_placeholder(env, monkeypatch):
    """Ending one admin's view while another admin opens a view of the same placeholder."""
    _, boss = account(env, "boss", "admin")
    _, other = account(env, "other", "admin")
    link_only(env, "steve")
    first_view = view_as.start(boss, UUID)["token"]
    gate = Gate(monkeypatch, "INSERT INTO user_sessions")
    opening, ending = race(gate, (view_as.start, other, UUID), (view_as.end, first_view))
    assert opening.error is None and ending.error is None
    assert users.session_user(first_view) is None
    second = users.session_user(opening.value["token"])
    assert second is not None and second["discord_username"] == "steve"
    assert testing.value("SELECT COUNT(*) FROM users WHERE placeholder") == 1


def under_placeholders_lock(fn):
    """fn() must wait while another transaction holds the placeholders lock."""
    with database.transaction(lock=users.PLACEHOLDERS_LOCK):
        run = Run(fn)
        assert run.waiting(), "it did not wait for the placeholders lock"
    run.join()
    assert run.error is None, run.error
    return run.value


def test_every_leftover_sweep_takes_the_placeholders_lock_first(env):
    _, boss = account(env, "boss", "admin")
    pat_id, _ = account(env, "pat")
    _, root = account(env, "rory", "root")
    link_only(env, "steve")
    identity = {"discord_user_id": "123456789012345678", "discord_username": "new", "discord_global_name": None,
                "discord_avatar": None}
    under_placeholders_lock(lambda: users.sign_in(identity, guild_member=True))
    first = under_placeholders_lock(lambda: view_as.start(boss, UUID))["token"]
    under_placeholders_lock(lambda: view_as.end(first))
    second = view_as.start(boss, UUID)["token"]
    assert under_placeholders_lock(lambda: view_as.stop(second, boss))["ended"] is True
    under_placeholders_lock(lambda: view_as.end_lapsed(boss))
    under_placeholders_lock(lambda: admin.change_role(root, pat_id, "mod", "Helping out"))
    under_placeholders_lock(lambda: admin.revoke_sessions(root, pat_id, "Shared login"))
    under_placeholders_lock(lambda: admin_cli._set_root(discord_id_of("pat"), "Second owner", grant=True))


def auth_config():
    from src.api import auth_routes

    return auth_routes._config()
