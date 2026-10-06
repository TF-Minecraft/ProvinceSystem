import sqlite3
import threading
import time

import pytest

from src.coreprotect import reader as reader_mod
from src.coreprotect.reader import Budget, CoreProtectConfig, Reader, Unavailable


def config(path, ping=60):
    return CoreProtectConfig(path=str(path) if path else None, server="main", label="", ping_seconds=ping)


def test_config_from_env(monkeypatch):
    monkeypatch.setenv("COREPROTECT_DB", " /coreprotect/main/database.db ")
    monkeypatch.setenv("COREPROTECT_PING_SECONDS", "nonsense")
    monkeypatch.delenv("COREPROTECT_SERVER", raising=False)
    loaded = CoreProtectConfig.from_env()
    assert loaded.path == "/coreprotect/main/database.db"
    assert loaded.server == "main"
    assert loaded.ping_seconds == 0


def test_unconfigured_and_missing(tmp_path):
    with pytest.raises(Unavailable) as exc:
        Reader(config(None)).__enter__()
    assert exc.value.code == "not_configured"
    with pytest.raises(Unavailable) as exc:
        Reader(config(tmp_path / "nope.db")).__enter__()
    assert exc.value.code == "missing"


def test_reads_are_read_only(coreprotect):
    with Reader(config(coreprotect.path)) as r:
        assert r.rows("SELECT world FROM co_world ORDER BY id")[0]["world"] == "TFMC_Map"
        with pytest.raises(Unavailable):
            r.rows("INSERT INTO co_world (id, world) VALUES (9, 'x')")


def test_slot_is_released_after_errors(coreprotect):
    for _ in range(3):
        with pytest.raises(Unavailable):
            with Reader(config(coreprotect.path)) as r:
                r.rows("SELECT * FROM no_such_table")
    with Reader(config(coreprotect.path), Budget(0.2)) as r:
        assert r.rows("SELECT 1 AS one")[0]["one"] == 1


def test_one_reader_at_a_time(coreprotect):
    entered, release = threading.Event(), threading.Event()

    def hold():
        with Reader(config(coreprotect.path), Budget(5)):
            entered.set()
            release.wait(5)

    worker = threading.Thread(target=hold)
    worker.start()
    try:
        assert entered.wait(5)
        started = time.monotonic()
        with pytest.raises(Unavailable) as exc:
            Reader(config(coreprotect.path), Budget(0.1)).__enter__()
        assert exc.value.code == "busy"
        assert time.monotonic() - started < 0.5
    finally:
        release.set()
        worker.join()


def test_writer_lock_is_bounded_by_budget(coreprotect):
    writer = sqlite3.connect(coreprotect.path, isolation_level=None)
    writer.execute("BEGIN EXCLUSIVE")
    try:
        started = time.monotonic()
        with pytest.raises(Unavailable) as exc:
            with Reader(config(coreprotect.path), Budget(0.5)) as r:
                r.rows("SELECT COUNT(*) FROM co_user")
        assert exc.value.code in {"busy", "timeout"}
        assert time.monotonic() - started < 1.0
    finally:
        writer.execute("ROLLBACK")
        writer.close()


def test_long_statement_is_interrupted(coreprotect):
    started = time.monotonic()
    with pytest.raises(Unavailable) as exc:
        with Reader(config(coreprotect.path), Budget(0.2)) as r:
            r.rows("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT MAX(i) FROM n")
    assert exc.value.code == "timeout"
    assert time.monotonic() - started < 1.0


def test_no_lock_survives_a_reader(coreprotect):
    with Reader(config(coreprotect.path)) as r:
        r.rows("SELECT * FROM co_world")
    writer = sqlite3.connect(coreprotect.path, timeout=0, isolation_level=None)
    try:
        writer.execute("BEGIN EXCLUSIVE")
        writer.execute("ROLLBACK")
    finally:
        writer.close()


def test_spent_budget_stops_before_the_next_statement(coreprotect):
    budget = Budget(0.05)
    with Reader(config(coreprotect.path), budget) as r:
        time.sleep(0.06)
        with pytest.raises(Unavailable) as exc:
            r.rows("SELECT 1")
    assert exc.value.code == "timeout"
    assert reader_mod._GATE.acquire(timeout=0.1)
    reader_mod._GATE.release()
