"""The process-wide connection pool and the transaction and locking helpers.

Every block borrows a pooled connection and is one transaction: it commits when
the block ends normally and rolls back on an exception. Rows are dicts.
"""

from __future__ import annotations

import os
import random
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, TypeVar

import psycopg
from psycopg import errors
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

Connection = psycopg.Connection[dict[str, Any]]
T = TypeVar("T")

# Set at connection start-up, so a reset (RESET ALL) returns to them. The
# database is shared with Precedent and patch notes: names resolve in public only.
# Timestamps come back as aware UTC datetimes; a stuck lock or query fails
# instead of holding a worker.
SESSION_SETTINGS = {
    "search_path": "public",
    "TimeZone": "UTC",
    "lock_timeout": "5s",
    "statement_timeout": "30s",
    "idle_in_transaction_session_timeout": "60s",
}
# How long advisory_lock() waits: longer than the 5 s row-lock bound, because an
# advisory holder may run a whole recompute (Patreon, a LuckPerms snapshot), and
# shorter than statement_timeout, so a waiter fails with LockNotAvailable rather
# than a cancelled statement.
ADVISORY_LOCK_TIMEOUT = "20s"
POOL_TIMEOUT_SECONDS = 10.0
SERIALIZABLE_ATTEMPTS = 5
_ISOLATION = {"read committed", "repeatable read", "serializable"}

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


class NotConfiguredError(RuntimeError):
    """DATABASE_URL is not set."""


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise NotConfiguredError("DATABASE_URL is not set")
    return url


def session_options() -> str:
    return " ".join(f"-c {name}={value}" for name, value in SESSION_SETTINGS.items())


def _size(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


# DISCARD ALL without DEALLOCATE ALL. psycopg notices a DISCARD ALL only the first
# time a connection runs it, then keeps naming prepared statements the server has
# dropped; psycopg's own prepared statements are safe to keep.
_DISCARD = (
    "CLOSE ALL; SET SESSION AUTHORIZATION DEFAULT; RESET ALL; UNLISTEN *; "
    "SELECT pg_advisory_unlock_all(); DISCARD PLANS; DISCARD SEQUENCES; DISCARD TEMP"
)


def _reset(conn: Connection) -> None:
    """Return a connection to the pool as it started.

    The pool has already rolled back any open transaction. Settings go back to
    their start-up values; cursors, temp tables, LISTENs and session advisory
    locks go; the connection attributes go back to their defaults.
    """
    conn.autocommit = True
    conn.execute(_DISCARD)
    conn.autocommit = False
    conn.isolation_level = None
    conn.read_only = None
    conn.deferrable = None
    conn.row_factory = dict_row


def _new_pool(url: str, min_size: int | None, max_size: int | None) -> ConnectionPool:
    return ConnectionPool(
        url,
        min_size=_size("DATABASE_POOL_MIN_SIZE", 1) if min_size is None else min_size,
        max_size=_size("DATABASE_POOL_MAX_SIZE", 10) if max_size is None else max_size,
        timeout=POOL_TIMEOUT_SECONDS,
        kwargs={"row_factory": dict_row, "options": session_options(), "application_name": "provincesystem"},
        # One round trip per borrow, so a restarted Postgres costs nobody a failed request.
        check=ConnectionPool.check_connection,
        reset=_reset,
        name="province",
        open=True,
    )


def open_pool(url: str | None = None, *, min_size: int | None = None, max_size: int | None = None) -> ConnectionPool:
    """Open the pool for `url` (default DATABASE_URL), closing any pool already open.

    Sizes default to DATABASE_POOL_MIN_SIZE (1) and DATABASE_POOL_MAX_SIZE (10).
    """
    global _pool
    pool = _new_pool(url or database_url(), min_size, max_size)
    with _pool_lock:
        old, _pool = _pool, pool
    if old is not None:
        old.close()
    return pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.close()


def get_pool() -> ConnectionPool:
    """The open pool, opened from DATABASE_URL on first use."""
    global _pool
    pool = _pool
    if pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = _new_pool(database_url(), None, None)
            pool = _pool
    return pool


@contextmanager
def connect(*, timeout: float | None = None) -> Iterator[Connection]:
    """Borrow a pooled connection for one transaction.

    The first statement begins the transaction. The block commits when it ends
    normally and rolls back on an exception, then the connection goes back to
    the pool. Use `conn.transaction()` inside for a savepoint that can fail on
    its own (for example an INSERT that may hit a unique constraint).
    """
    with get_pool().connection(timeout=timeout) as conn:
        yield conn


@contextmanager
def transaction(
    *, isolation: str | None = None, read_only: bool = False, lock: str | None = None
) -> Iterator[Connection]:
    """`connect()` with the transaction's settings applied before any other statement.

    `isolation` is "read committed" (the default), "repeatable read" or
    "serializable". `lock` names an advisory lock taken first (see `advisory_lock`).
    """
    modes = []
    if isolation is not None:
        level = isolation.lower()
        if level not in _ISOLATION:
            raise ValueError(f"unknown isolation level: {isolation}")
        modes.append(f"ISOLATION LEVEL {level.upper()}")
    if read_only:
        modes.append("READ ONLY")
    with connect() as conn:
        if modes:
            conn.execute(f"SET TRANSACTION {', '.join(modes)}")
        if lock is not None:
            advisory_lock(conn, lock)
        yield conn


def advisory_lock(conn: Connection, name: str, *, wait: bool = True) -> bool:
    """Take the transaction-scoped advisory lock `name`; commit or rollback releases it.

    For checks with no row to lock: a cooldown over several rows, or "no row
    exists yet". Name it `<area>:<what>[:<key>]`, for example
    `codes:mint:<player uuid>`. Every path that changes what the check reads
    must take the same lock. Returns False instead of waiting when `wait` is
    False and another transaction holds it.

    Waits up to ADVISORY_LOCK_TIMEOUT, then raises LockNotAvailable; the
    transaction's own lock_timeout applies again once the lock is held.
    """
    if conn.autocommit:
        raise RuntimeError("advisory_lock needs a transaction; this connection is in autocommit")
    if wait:
        # The CTE reads the old value before set_config changes it.
        previous = conn.execute(
            "WITH old AS MATERIALIZED (SELECT current_setting('lock_timeout') AS value) "
            "SELECT old.value, set_config('lock_timeout', %s, true) FROM old",
            (ADVISORY_LOCK_TIMEOUT,),
        ).fetchone()["value"]
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (name,))
        conn.execute("SELECT set_config('lock_timeout', %s, true)", (previous,))
        return True
    row = conn.execute("SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS locked", (name,)).fetchone()
    return bool(row["locked"])


def serializable(work: Callable[[Connection], T], *, attempts: int = SERIALIZABLE_ATTEMPTS) -> T:
    """Run `work(conn)` in a SERIALIZABLE transaction and return its result.

    Retries the whole transaction when Postgres reports a serialization failure
    or a deadlock, with a short random backoff, up to `attempts` times. `work`
    may run more than once, so it must not do anything outside the database.
    """
    for attempt in range(1, attempts + 1):
        try:
            with transaction(isolation="serializable") as conn:
                return work(conn)
        except (errors.SerializationFailure, errors.DeadlockDetected):
            if attempt == attempts:
                raise
            time.sleep(random.uniform(0, 0.01 * 2**attempt))
    raise AssertionError("unreachable")
