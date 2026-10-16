"""The migration runner against an empty scratch database."""

import threading

import psycopg
import pytest

from src.database import migrate as runner


def _write(directory, name, sql):
    (directory / name).write_text(sql, encoding="utf-8")


def _rows(url, sql):
    with psycopg.connect(url) as conn:
        return conn.execute(sql).fetchall()


@pytest.fixture
def migrations(tmp_path):
    _write(tmp_path, "0001_first.sql", "CREATE TABLE a (id bigint PRIMARY KEY);")
    _write(tmp_path, "0002_second.sql", "ALTER TABLE a ADD COLUMN note text; INSERT INTO a VALUES (1, '100%');")
    return tmp_path


def test_applies_in_order_once(scratch_database, migrations):
    assert runner.migrate(scratch_database, directory=migrations) == ["0001", "0002"]
    assert runner.migrate(scratch_database, directory=migrations) == []
    assert _rows(scratch_database, "SELECT id, note FROM a") == [(1, "100%")]
    assert _rows(scratch_database, "SELECT version, name FROM schema_migrations ORDER BY version") == [
        ("0001", "first"), ("0002", "second")]


def test_a_failing_file_leaves_nothing_behind(scratch_database, migrations):
    _write(migrations, "0003_broken.sql", "CREATE TABLE b (id bigint); SELECT 1/0;")
    with pytest.raises(psycopg.errors.DivisionByZero):
        runner.migrate(scratch_database, directory=migrations)
    assert _rows(scratch_database, "SELECT version FROM schema_migrations ORDER BY version") == [
        ("0001",), ("0002",)]
    assert _rows(scratch_database, "SELECT to_regclass('b')") == [(None,)]


def test_an_applied_file_must_not_change(scratch_database, migrations):
    runner.migrate(scratch_database, directory=migrations)
    _write(migrations, "0001_first.sql", "CREATE TABLE a (id bigint PRIMARY KEY, extra text);")
    with pytest.raises(runner.MigrationError, match="0001_first changed"):
        runner.migrate(scratch_database, directory=migrations)


@pytest.mark.parametrize("names", [["1_bad.sql"], ["0001_Upper.sql"], ["0001_a.sql", "0001_b.sql"]])
def test_file_names_are_checked(tmp_path, names):
    for name in names:
        _write(tmp_path, name, "SELECT 1;")
    with pytest.raises(runner.MigrationError):
        runner.discover(tmp_path)


def test_concurrent_runners_apply_each_file_once(scratch_database, tmp_path):
    _write(tmp_path, "0001_slow.sql", "SELECT pg_sleep(0.5); CREATE TABLE a (id bigint);")
    results, errors = [], []

    def run():
        try:
            results.append(runner.migrate(scratch_database, directory=tmp_path))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
    assert errors == []
    assert sorted(results) == [[], [], ["0001"]]


def test_status_and_cli(scratch_database, migrations, monkeypatch, capsys):
    assert [(v, n, at) for v, n, at in runner.status(scratch_database, directory=migrations)] == [
        ("0001", "first", None), ("0002", "second", None)]
    monkeypatch.setattr(runner, "MIGRATIONS_DIR", migrations)
    monkeypatch.setenv("DATABASE_URL", scratch_database)
    assert runner.main([]) == 0
    assert runner.main(["--status"]) == 0
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "applied 0001, 0002"
    assert out[1].startswith("0001_first\t2") and out[2].startswith("0002_second\t2")


def test_real_migrations_apply_twice_cleanly(scratch_database):
    assert runner.migrate(scratch_database) == [m.version for m in runner.discover()]
    assert runner.migrate(scratch_database) == []
