"""The pool, transactions and locking helpers against a real Postgres."""

import threading
from datetime import datetime, timezone

import pytest
from psycopg.rows import tuple_row

from src import database
from src.database import connection

pytestmark = pytest.mark.usefixtures("postgres")


def _warn(conn, player="p", reason="r"):
    conn.execute(
        "INSERT INTO player_warnings (player_uuid, reason, created_at) VALUES (%s, %s, now())", (player, reason))


def _warnings(player="p") -> int:
    with database.connect() as conn:
        return conn.execute("SELECT count(*) AS n FROM player_warnings WHERE player_uuid = %s", (player,)).fetchone()["n"]


def test_block_commits_and_rows_are_dicts():
    with database.connect() as conn:
        row = conn.execute(
            "INSERT INTO player_warnings (player_uuid, reason, created_at) VALUES ('p', 'r', %s) "
            "RETURNING id, reason, created_at",
            ("2026-10-16T10:00:00Z",),
        ).fetchone()
    assert row == {"id": 1, "reason": "r", "created_at": datetime(2026, 10, 16, 10, tzinfo=timezone.utc)}
    assert _warnings() == 1


def test_exception_rolls_back_and_the_connection_is_reusable():
    with pytest.raises(RuntimeError):
        with database.connect() as conn:
            _warn(conn)
            raise RuntimeError
    assert _warnings() == 0
    with database.connect() as conn:
        assert conn.info.transaction_status.name == "IDLE"


def test_savepoint_survives_a_unique_violation():
    with database.connect() as conn:
        conn.execute("INSERT INTO patreon_leases (name, owner, expires_at) VALUES ('sync', 'a', now())")
        with pytest.raises(database.UniqueViolation):
            with conn.transaction():
                conn.execute("INSERT INTO patreon_leases (name, owner, expires_at) VALUES ('sync', 'b', now())")
        owner = conn.execute("SELECT owner FROM patreon_leases WHERE name = 'sync'").fetchone()["owner"]
    assert owner == "a"


def test_session_settings():
    with database.connect() as conn:
        settings = {name: next(iter(conn.execute(f"SHOW {name}").fetchone().values()))
                    for name in ("TimeZone", "lock_timeout", "statement_timeout",
                                 "idle_in_transaction_session_timeout")}
        assert conn.execute("SHOW application_name").fetchone()["application_name"] == "provincesystem"
        search_path = conn.execute("SHOW search_path").fetchone()["search_path"]
    assert settings == {"TimeZone": "UTC", "lock_timeout": "5s", "statement_timeout": "30s",
                        "idle_in_transaction_session_timeout": "1min"}
    assert search_path == "public"


@pytest.mark.parametrize(("isolation", "expected"), [
    (None, "read committed"),
    ("repeatable read", "repeatable read"),
    ("SERIALIZABLE", "serializable"),
])
def test_transaction_isolation(isolation, expected):
    with database.transaction(isolation=isolation) as conn:
        assert conn.execute("SHOW transaction_isolation").fetchone()["transaction_isolation"] == expected
    # The level applied to that transaction only, not to the pooled connection.
    with database.connect() as conn:
        assert conn.execute("SHOW transaction_isolation").fetchone()["transaction_isolation"] == "read committed"


def test_transaction_read_only_refuses_writes():
    with pytest.raises(database.DatabaseError, match="read-only"):
        with database.transaction(read_only=True) as conn:
            _warn(conn)


def test_transaction_rejects_an_unknown_isolation_level():
    with pytest.raises(ValueError):
        with database.transaction(isolation="chaos"):
            pass


def test_transaction_lock_serialises_holders():
    holding, release = threading.Event(), threading.Event()
    order = []

    def first():
        with database.transaction(lock="test:lock") as conn:
            holding.set()
            release.wait(5)
            _warn(conn, reason="first")
            order.append("first")

    thread = threading.Thread(target=first)
    thread.start()
    assert holding.wait(5)
    waiter = threading.Thread(target=lambda: _second(order))
    waiter.start()
    waiter.join(0.3)
    assert waiter.is_alive(), "the second holder must wait for the first to commit"
    release.set()
    thread.join(5)
    waiter.join(5)
    assert order == ["first", "second saw 1"]


def _second(order):
    with database.transaction(lock="test:lock") as conn:
        n = conn.execute("SELECT count(*) AS n FROM player_warnings").fetchone()["n"]
        order.append(f"second saw {n}")


def test_advisory_lock_without_waiting():
    holding, release = threading.Event(), threading.Event()

    def hold():
        with database.connect() as conn:
            assert database.advisory_lock(conn, "test:try")
            holding.set()
            release.wait(5)

    thread = threading.Thread(target=hold)
    thread.start()
    assert holding.wait(5)
    try:
        with database.connect() as conn:
            assert database.advisory_lock(conn, "test:try", wait=False) is False
            assert database.advisory_lock(conn, "test:other", wait=False) is True
    finally:
        release.set()
        thread.join(5)
    with database.connect() as conn:
        assert database.advisory_lock(conn, "test:try", wait=False) is True


def test_advisory_lock_refuses_autocommit():
    with database.connect() as conn:
        conn.autocommit = True
        try:
            with pytest.raises(RuntimeError, match="autocommit"):
                database.advisory_lock(conn, "test:auto")
        finally:
            conn.autocommit = False


def test_serializable_retries_write_skew():
    # Both transactions read "no warning yet" before either inserts; SERIALIZABLE
    # aborts one, and its retry sees the other's row.
    barrier = threading.Barrier(2, timeout=5)
    attempts = []

    def work(conn):
        attempts.append(1)
        n = conn.execute("SELECT count(*) AS n FROM player_warnings WHERE player_uuid = 'p'").fetchone()["n"]
        if len(attempts) <= 2:
            barrier.wait()
        if n == 0:
            _warn(conn)
            return "inserted"
        return "present"

    results = []
    threads = [threading.Thread(target=lambda: results.append(database.serializable(work))) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert sorted(results) == ["inserted", "present"]
    assert len(attempts) == 3
    assert _warnings() == 1


def test_serializable_gives_up_after_its_attempts():
    calls = []

    def work(conn):
        calls.append(1)
        raise database.SerializationFailure("simulated")

    with pytest.raises(database.SerializationFailure):
        database.serializable(work, attempts=3)
    assert len(calls) == 3


def test_pool_opens_from_database_url_on_first_use(postgres, monkeypatch):
    connection.close_pool()
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(database.NotConfiguredError):
        database.connect().__enter__()
    monkeypatch.setenv("DATABASE_URL", postgres)
    with database.connect() as conn:
        assert conn.execute("SELECT current_database() AS db").fetchone()["db"].startswith("ps_test_")
    assert database.get_pool() is database.get_pool()


def test_pool_sizes_come_from_the_environment(postgres, monkeypatch):
    monkeypatch.setenv("DATABASE_POOL_MIN_SIZE", "0")
    monkeypatch.setenv("DATABASE_POOL_MAX_SIZE", "3")
    pool = database.open_pool(postgres)
    assert (pool.min_size, pool.max_size) == (0, 3)
    assert database.get_pool() is pool


def test_a_returned_connection_leaks_nothing(postgres):
    database.open_pool(postgres, min_size=1, max_size=1)
    pids = set()
    for _ in range(2):  # the same connection, reset twice
        with database.connect() as conn:
            pids.add(conn.info.backend_pid)
            conn.execute("SET TimeZone = 'Europe/London'")
            conn.execute("SET statement_timeout = '1s'")
            conn.execute("SET search_path = pg_catalog")
            conn.execute("CREATE TEMP TABLE leak (x int)")
            conn.execute("LISTEN leak")
            conn.execute("SELECT pg_advisory_lock(42)")
            for _ in range(6):  # past psycopg's prepare threshold
                conn.execute("SELECT 1 AS one WHERE %s", (True,))
            conn.commit()
            conn.autocommit = True
            conn.read_only = True
            conn.row_factory = tuple_row
        with database.connect() as conn:
            assert (conn.autocommit, conn.read_only, conn.isolation_level) == (False, None, None)
            settings = {name: next(iter(conn.execute(f"SHOW {name}").fetchone().values()))
                        for name in ("TimeZone", "statement_timeout", "search_path")}
            assert settings == {"TimeZone": "UTC", "statement_timeout": "30s", "search_path": "public"}
            assert conn.execute("SELECT to_regclass('pg_temp.leak') AS t").fetchone() == {"t": None}
            assert conn.execute("SELECT count(*) AS n FROM pg_listening_channels()").fetchone()["n"] == 0
            assert conn.execute("SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' "
                                "AND pid = pg_backend_pid()").fetchone()["n"] == 0
            assert conn.execute("SELECT 1 AS one WHERE %s", (True,)).fetchone() == {"one": 1}
    assert len(pids) == 1


def test_a_leaked_autocommit_cannot_commit_a_failed_block(postgres):
    database.open_pool(postgres, min_size=1, max_size=1)
    with database.connect() as conn:
        conn.autocommit = True
    with pytest.raises(RuntimeError):
        with database.connect() as conn:
            _warn(conn)
            raise RuntimeError
    assert _warnings() == 0


def _hold(name, holding, release):
    with database.connect() as conn:
        database.advisory_lock(conn, name)
        holding.set()
        release.wait(5)


def test_advisory_lock_waits_past_lock_timeout():
    holding, release = threading.Event(), threading.Event()
    thread = threading.Thread(target=_hold, args=("test:slow", holding, release))
    thread.start()
    assert holding.wait(5)
    threading.Timer(1.0, release.set).start()
    try:
        with database.connect() as conn:
            conn.execute("SET LOCAL lock_timeout = '300ms'")
            assert database.advisory_lock(conn, "test:slow")
            assert conn.execute("SHOW lock_timeout").fetchone()["lock_timeout"] == "300ms"
    finally:
        release.set()
        thread.join(5)


def test_advisory_lock_gives_up_after_its_own_timeout(monkeypatch):
    monkeypatch.setattr(connection, "ADVISORY_LOCK_TIMEOUT", "300ms")
    holding, release = threading.Event(), threading.Event()
    thread = threading.Thread(target=_hold, args=("test:stuck", holding, release))
    thread.start()
    assert holding.wait(5)
    try:
        with pytest.raises(database.LockNotAvailable):
            with database.transaction(lock="test:stuck"):
                pass
    finally:
        release.set()
        thread.join(5)
