"""The migration runner against an empty scratch database."""

import os
import stat
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


def test_an_applied_version_needs_its_file(scratch_database, migrations):
    runner.migrate(scratch_database, directory=migrations)
    (migrations / "0002_second.sql").unlink()
    with pytest.raises(runner.MigrationError, match="no file: 0002"):
        runner.migrate(scratch_database, directory=migrations)


def test_a_new_file_must_be_numbered_above_the_applied_ones(scratch_database, migrations):
    (migrations / "0002_second.sql").rename(migrations / "0003_second.sql")
    runner.migrate(scratch_database, directory=migrations)
    _write(migrations, "0002_late.sql", "CREATE TABLE late (id bigint);")
    with pytest.raises(runner.MigrationError, match="0002_late is numbered below the newest applied one"):
        runner.migrate(scratch_database, directory=migrations)
    assert _rows(scratch_database, "SELECT to_regclass('late')") == [(None,)]


def test_seed_rows_are_inserted_once(scratch_database, migrations, tmp_path_factory, monkeypatch):
    seeds = tmp_path_factory.mktemp("seeds") / "seeds.sql"
    seeds.write_text("INSERT INTO a (id, note) VALUES (2, 'seed') ON CONFLICT (id) DO NOTHING;", encoding="utf-8")
    monkeypatch.setattr(runner, "SEEDS_PATH", seeds)
    runner.migrate(scratch_database, directory=migrations)
    assert _rows(scratch_database, "SELECT id FROM a ORDER BY id") == [(1,)]
    runner.migrate(scratch_database, directory=migrations, seed=True)
    runner.migrate(scratch_database, directory=migrations, seed=True)
    assert _rows(scratch_database, "SELECT id, note FROM a ORDER BY id") == [(1, "100%"), (2, "seed")]


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
    assert _rows(scratch_database, "SELECT count(*) FROM patreon_sync_state") == [(0,)]
    assert runner.migrate(scratch_database, seed=True) == []
    assert runner.migrate(scratch_database, seed=True) == []
    assert _rows(scratch_database, "SELECT id FROM patreon_sync_state") == [(1,)]


@pytest.fixture
def bundles(tmp_path):
    old, new, retained = [tmp_path / name for name in ("old", "new", "retained")]
    old.mkdir()
    new.mkdir()
    # Retention preserves bytes, including line endings, unlike read_text().
    first = "-- café\r\nCREATE TABLE a (id bigint PRIMARY KEY);\r\nINSERT INTO a VALUES (1);\r\n".encode("utf-8")
    (old / "0001_first.sql").write_bytes(first)
    (new / "0001_first.sql").write_bytes(first)
    _write(new, "0002_second.sql", "ALTER TABLE a ADD COLUMN note text; UPDATE a SET note = 'kept';")
    return old, new, retained


@pytest.mark.parametrize("retain_initial_bundle", [False, True])
def test_retained_applied_migrations_allow_an_older_bundle(scratch_database, bundles, retain_initial_bundle):
    old, new, retained = bundles
    assert runner.migrate(scratch_database, directory=old,
                          retained_directory=retained if retain_initial_bundle else None) == ["0001"]
    assert runner.migrate(scratch_database, directory=new, retained_directory=retained) == ["0002"]
    # Simulate reverting code after the newer release's health check fails.
    assert runner.migrate(scratch_database, directory=old, retained_directory=retained) == []
    assert runner.migrate(scratch_database, directory=old, retained_directory=retained) == []
    assert _rows(scratch_database, "SELECT id, note FROM a") == [(1, "kept")]
    assert _rows(scratch_database, "SELECT version FROM schema_migrations ORDER BY version") == [("0001",), ("0002",)]
    assert retained.stat().st_mode & 0o777 == 0o700
    assert sorted(p.name for p in retained.iterdir()) == ["0001_first.sql", "0002_second.sql"]
    for path in new.iterdir():
        saved = retained / path.name
        assert saved.read_bytes() == path.read_bytes()
        assert saved.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(("damage", "message"), [
    ("missing", "no file: 0002"),
    ("checksum", "0002_second changed after it was applied"),
    ("invalid_utf8", "cannot read retained migration 0002_second.sql"),
    ("renamed", "0002_renamed changed name"),
    ("duplicate", "two retained migration files share a number: 0002"),
    ("symlink", "retained migration must be a regular file"),
])
def test_missing_or_corrupt_retained_applied_history_is_refused(scratch_database, bundles, damage, message):
    old, new, retained = bundles
    runner.migrate(scratch_database, directory=new, retained_directory=retained)
    saved = retained / "0002_second.sql"
    if damage == "missing":
        saved.unlink()
    elif damage == "checksum":
        saved.write_text("SELECT 'changed';", encoding="utf-8")
    elif damage == "invalid_utf8":
        saved.write_bytes(b"\xff")
    elif damage == "renamed":
        saved.rename(retained / "0002_renamed.sql")
    elif damage == "duplicate":
        (retained / "0002_zduplicate.sql").write_bytes(saved.read_bytes())
    else:
        saved.unlink()
        saved.symlink_to(new / "0002_second.sql")
    with pytest.raises(runner.MigrationError, match=message):
        runner.migrate(scratch_database, directory=old, retained_directory=retained)
    assert _rows(scratch_database, "SELECT id, note FROM a") == [(1, "kept")]


def test_retained_files_do_not_relax_default_strict_history(scratch_database, bundles):
    old, new, retained = bundles
    runner.migrate(scratch_database, directory=new, retained_directory=retained)
    with pytest.raises(runner.MigrationError, match="no file: 0002"):
        runner.migrate(scratch_database, directory=old)


@pytest.mark.parametrize("corrupt_pending", [False, True])
def test_failed_pending_migration_is_retained_without_blocking_old_code(scratch_database, bundles, corrupt_pending):
    old, new, retained = bundles
    pending = new / "0002_second.sql"
    pending.write_bytes(b"CREATE TABLE pending (id bigint); SELECT 1/0;\r\n")
    with pytest.raises(psycopg.errors.DivisionByZero):
        runner.migrate(scratch_database, directory=new, retained_directory=retained)
    assert (retained / pending.name).read_bytes() == pending.read_bytes()
    if corrupt_pending:
        (retained / pending.name).write_bytes(b"\xff")
        (retained / "0002_duplicate.sql").write_bytes(b"\xff")
    assert runner.migrate(scratch_database, directory=old, retained_directory=retained) == []
    assert _rows(scratch_database, "SELECT version FROM schema_migrations") == [("0001",)]
    assert _rows(scratch_database, "SELECT id FROM a") == [(1,)]
    assert _rows(scratch_database, "SELECT to_regclass('pending')") == [(None,)]


def test_unapplied_retained_files_are_never_run_or_order_checked(scratch_database, bundles):
    old, new, retained = bundles
    runner.migrate(scratch_database, directory=old, retained_directory=retained)
    (retained / "0002_second.sql").write_bytes((new / "0002_second.sql").read_bytes())
    _write(retained, "0000_earlier.sql", "CREATE TABLE earlier (id bigint);")
    assert runner.migrate(scratch_database, directory=old, retained_directory=retained) == []
    assert _rows(scratch_database, "SELECT version FROM schema_migrations") == [("0001",)]
    assert _rows(scratch_database, "SELECT to_regclass('earlier')") == [(None,)]
    assert _rows(scratch_database, "SELECT column_name FROM information_schema.columns "
                 "WHERE table_name = 'a' ORDER BY ordinal_position") == [("id",)]


@pytest.mark.parametrize("change", ["sql", "name", "line_endings"])
def test_retained_definition_cannot_be_replaced_even_before_it_is_applied(scratch_database, bundles, change):
    old, new, retained = bundles
    pending = new / "0002_second.sql"
    pending.write_bytes(b"SELECT 1/0;\r\n")
    with pytest.raises(psycopg.errors.DivisionByZero):
        runner.migrate(scratch_database, directory=new, retained_directory=retained)
    original = (retained / pending.name).read_bytes()
    if change == "name":
        pending.rename(new / "0002_renamed.sql")
    elif change == "line_endings":
        pending.write_bytes(original.replace(b"\r\n", b"\n"))
    else:
        pending.write_bytes(b"CREATE TABLE changed (id bigint);")
    with pytest.raises(runner.MigrationError, match="retained migration 0002_second changed"):
        runner.migrate(scratch_database, directory=new, retained_directory=retained)
    assert (retained / "0002_second.sql").read_bytes() == original
    assert _rows(scratch_database, "SELECT version FROM schema_migrations") == [("0001",)]
    assert _rows(scratch_database, "SELECT to_regclass('changed')") == [(None,)]


def test_retention_failure_happens_before_any_bundled_migration(scratch_database, bundles, monkeypatch):
    old, new, retained = bundles
    original_fsync = os.fsync

    def fail_file_sync(fd):
        if stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError("simulated file sync failure")
        original_fsync(fd)

    monkeypatch.setattr(runner.os, "fsync", fail_file_sync)
    with pytest.raises(OSError, match="simulated file sync failure"):
        runner.migrate(scratch_database, directory=new, retained_directory=retained)
    assert list(retained.iterdir()) == []
    assert _rows(scratch_database, "SELECT version FROM schema_migrations") == []
    assert _rows(scratch_database, "SELECT to_regclass('a')") == [(None,)]
    monkeypatch.setattr(runner.os, "fsync", original_fsync)
    assert runner.migrate(scratch_database, directory=new, retained_directory=retained) == ["0001", "0002"]


def test_retention_directory_sync_failure_prevents_migrations_and_allows_retry(scratch_database, bundles, monkeypatch):
    old, new, retained = bundles
    original_fsync = os.fsync

    def fail_published_directory_sync(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode) and (retained / "0002_second.sql").exists():
            raise OSError("simulated directory sync failure")
        original_fsync(fd)

    monkeypatch.setattr(runner.os, "fsync", fail_published_directory_sync)
    with pytest.raises(OSError, match="simulated directory sync failure"):
        runner.migrate(scratch_database, directory=new, retained_directory=retained)
    assert _rows(scratch_database, "SELECT version FROM schema_migrations") == []
    assert _rows(scratch_database, "SELECT to_regclass('a')") == [(None,)]
    monkeypatch.setattr(runner.os, "fsync", original_fsync)
    assert runner.migrate(scratch_database, directory=new, retained_directory=retained) == ["0001", "0002"]


def test_retained_history_does_not_allow_late_bundled_migrations(scratch_database, bundles):
    old, new, retained = bundles
    (new / "0002_second.sql").rename(new / "0003_second.sql")
    runner.migrate(scratch_database, directory=new, retained_directory=retained)
    _write(old, "0002_late.sql", "CREATE TABLE late (id bigint);")
    with pytest.raises(runner.MigrationError, match="0002_late is numbered below the newest applied one"):
        runner.migrate(scratch_database, directory=old, retained_directory=retained)
    assert _rows(scratch_database, "SELECT to_regclass('late')") == [(None,)]


def test_retention_keeps_existing_definitions_private(scratch_database, bundles):
    old, new, retained = bundles
    runner.migrate(scratch_database, directory=new, retained_directory=retained)
    retained.chmod(0o755)
    for path in retained.iterdir():
        path.chmod(0o644)
    runner.migrate(scratch_database, directory=old, retained_directory=retained)
    assert retained.stat().st_mode & 0o777 == 0o700
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in retained.iterdir())


def test_retention_directory_must_not_be_a_symlink(scratch_database, bundles, tmp_path):
    old, new, retained = bundles
    destination = tmp_path / "other"
    destination.mkdir()
    retained.symlink_to(destination, target_is_directory=True)
    with pytest.raises(runner.MigrationError, match="retained migration directory must not be a symlink"):
        runner.migrate(scratch_database, directory=new, retained_directory=retained)
    assert list(destination.iterdir()) == []
    assert _rows(scratch_database, "SELECT to_regclass('a')") == [(None,)]


def test_concurrent_retaining_runners_apply_each_file_once(scratch_database, bundles):
    old, new, retained = bundles
    _write(new, "0002_second.sql", "SELECT pg_sleep(0.2); ALTER TABLE a ADD COLUMN note text;")
    results, errors = [], []

    def run():
        try:
            results.append(runner.migrate(scratch_database, directory=new, retained_directory=retained))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)
        assert not thread.is_alive()
    assert errors == []
    assert sorted(results) == [[], [], ["0001", "0002"]]
    assert sorted(p.name for p in retained.iterdir()) == ["0001_first.sql", "0002_second.sql"]
    assert runner.migrate(scratch_database, directory=old, retained_directory=retained) == []
