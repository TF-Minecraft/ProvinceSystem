"""Database contexts release their connection after commit or rollback."""

import sqlite3

import pytest

from src.skins import db


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    with db.connect() as conn:
        conn.execute("CREATE TABLE example (value TEXT)")
    return db.DB_PATH


def test_context_commits_and_closes_connection(database):
    with db.connect() as conn:
        conn.execute("INSERT INTO example VALUES ('committed')")

    with pytest.raises(sqlite3.ProgrammingError, match="closed database"):
        conn.execute("SELECT value FROM example")
    with db.connect() as reader:
        assert reader.execute("SELECT value FROM example").fetchone()[0] == "committed"

    # An open connection prevents replacement of this file on Windows.
    moved = database.with_suffix(".bak")
    database.replace(moved)
    assert moved.is_file()


def test_context_rolls_back_and_closes_after_error(database):
    with pytest.raises(ValueError, match="abort"):
        with db.connect() as conn:
            conn.execute("INSERT INTO example VALUES ('discarded')")
            raise ValueError("abort")

    with pytest.raises(sqlite3.ProgrammingError, match="closed database"):
        conn.execute("SELECT value FROM example")
    with db.connect() as reader:
        assert reader.execute("SELECT COUNT(*) FROM example").fetchone()[0] == 0


def test_direct_connection_can_still_be_explicitly_closed(database):
    conn = db.connect()
    try:
        assert conn.execute("SELECT COUNT(*) FROM example").fetchone()[0] == 0
    finally:
        conn.close()
