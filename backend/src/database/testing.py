"""Pytest fixtures for tests that run against a real Postgres.

Set TEST_DATABASE_URL to a server where the role may create databases and is a
superuser (the reset skips the admin_audit TRUNCATE trigger). The session
creates its own database, applies the migrations once and points the pool at
it. A test opts in by taking the `postgres` fixture, or a whole module with
`pytestmark = pytest.mark.usefixtures("postgres")`; each such test starts with
every table empty apart from the rows the migrations seed, and identities reset.

Without TEST_DATABASE_URL these tests skip, except under CI, where they fail.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import tuple_row

from . import connection
from .migrate import migrate


def server_url() -> str | None:
    return os.environ.get("TEST_DATABASE_URL", "").strip() or None


def _require_server() -> str:
    url = server_url()
    if url is None:
        if os.environ.get("CI"):
            pytest.fail("TEST_DATABASE_URL is not set; CI must run the Postgres tests")
        pytest.skip("TEST_DATABASE_URL is not set")
    return url


def _database_name(suffix: str = "") -> str:
    worker = os.environ.get("PYTEST_XDIST_WORKER", "main")
    return f"ps_test_{worker}_{os.getpid()}{suffix}"


def create_database(name: str) -> str:
    """Create an empty database `name` on the test server (dropping any old one) and return its URL."""
    base = _require_server()
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))
        conn.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0 ENCODING 'UTF8'").format(sql.Identifier(name)))
    return make_conninfo(base, dbname=name)


def drop_database(name: str) -> None:
    with psycopg.connect(_require_server(), autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))


def tables(conn: psycopg.Connection) -> list[str]:
    """The tables the migrations made, without schema_migrations."""
    cursor = conn.cursor(row_factory=tuple_row).execute(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' "
        "ORDER BY tablename"
    )
    return [row[0] for row in cursor]


def _copy_out(conn: psycopg.Connection, table: str) -> bytes:
    with conn.cursor().copy(sql.SQL("COPY {} TO STDOUT").format(sql.Identifier(table))) as copy:
        return b"".join(bytes(block) for block in copy)


class Reset:
    """Empties every table and puts back the rows the migrations seeded."""

    def __init__(self, url: str):
        self.url = url
        with psycopg.connect(url, autocommit=True) as conn:
            self.tables = tables(conn)
            self.seeds = {t: data for t in self.tables if (data := _copy_out(conn, t))}

    def __call__(self) -> None:
        with psycopg.connect(self.url) as conn:
            # replica skips the admin_audit TRUNCATE trigger; a test that kept a connection
            # busy fails here instead of hanging.
            conn.execute("SET LOCAL session_replication_role = replica")
            conn.execute("SET LOCAL lock_timeout = '10s'")
            conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(
                sql.SQL(", ").join(sql.Identifier(t) for t in self.tables)))
            for table, data in self.seeds.items():
                with conn.cursor().copy(sql.SQL("COPY {} FROM STDIN").format(sql.Identifier(table))) as copy:
                    copy.write(data)


@pytest.fixture(scope="session")
def postgres_session() -> Iterator[Reset]:
    """The session's migrated test database; the pool points at it."""
    name = _database_name()
    url = create_database(name)
    try:
        migrate(url)
        reset = Reset(url)
        connection.open_pool(url, min_size=0, max_size=4)
        yield reset
    finally:
        connection.close_pool()
        drop_database(name)


@pytest.fixture
def postgres(postgres_session: Reset, monkeypatch) -> str:
    """A freshly emptied test database; DATABASE_URL and the pool point at it. Returns its URL."""
    monkeypatch.setenv("DATABASE_URL", postgres_session.url)
    postgres_session()
    return postgres_session.url


@pytest.fixture
def scratch_database() -> Iterator[str]:
    """An empty database with no migrations, dropped after the test. Returns its URL."""
    name = _database_name("_scratch")
    url = create_database(name)
    try:
        yield url
    finally:
        drop_database(name)
