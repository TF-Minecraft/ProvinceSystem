"""The pool, transactions and locking helpers against a real Postgres."""

import threading
from datetime import datetime, timezone

import pytest

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
    assert settings == {"TimeZone": "UTC", "lock_timeout": "5s", "statement_timeout": "30s",
                        "idle_in_transaction_session_timeout": "1min"}


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
