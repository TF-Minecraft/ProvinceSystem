"""Exercise the deployment authority boundary on real PG17 and SQLite files."""
from contextlib import closing
import json
import sqlite3

import psycopg
import pytest

from src.database import operations
from src.scripts.tools import copy_province_db as copy


@pytest.fixture
def data(tmp_path):
    with closing(sqlite3.connect(tmp_path / "province.db")) as conn:
        conn.executescript(copy.LEGACY_SCHEMA.read_text())
        conn.execute("INSERT INTO codes(code_hash,player_uuid,created_at,expires_at) "
                     "VALUES ('original','player','2026-10-17T00:00:00Z','2026-10-18T00:00:00Z')")
        conn.commit()
    return tmp_path


def test_cutover_retry_and_downgrade_keep_new_writes(data, scratch_database, monkeypatch):
    url = scratch_database
    original = (data / "province.db").read_bytes()
    with psycopg.connect(url) as conn:
        conn.execute("CREATE TABLE precedent_keep (body text)")
        conn.execute("INSERT INTO precedent_keep VALUES ('preserved')")
    write = operations._write
    def power_loss(path, value):
        if path.name == ".postgres-authority.json":
            raise OSError("power loss")
        write(path, value)
    monkeypatch.setattr(operations, "_write", power_loss)
    with pytest.raises(OSError):
        operations.prepare(data, url)
    assert not (data / ".postgres-authority.json").exists()
    monkeypatch.setattr(operations, "_write", write)
    operations.prepare(data, url)  # Adopt only the fully matching committed copy.
    marker = json.loads((data / ".postgres-authority.json").read_text())
    assert len(marker["checks"]) == 61
    assert (data / "province.db").read_bytes() == original
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO codes(code_hash,player_uuid,created_at,expires_at) "
                     "VALUES ('new','new',now(),now())")
    operations.prepare(data, url)  # Does not re-copy the stale SQLite source.
    operations.rollback(data, url)
    assert not (data / ".postgres-authority.json").exists()
    with closing(sqlite3.connect(data / "province.db")) as conn:
        assert conn.execute("SELECT code_hash FROM codes ORDER BY id").fetchall() == [("original",), ("new",)]
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT * FROM precedent_keep").fetchone() == ("preserved",)
    # Re-entry after a downgrade can adopt an identical target without erasing it.
    operations.prepare(data, url)
    assert all(p.stat().st_mode & 0o077 == 0 for p in (data / "migration-rollback").glob("*.db"))


def test_marker_refuses_another_database(data, scratch_database):
    operations.prepare(data, scratch_database)
    path = data / ".postgres-authority.json"
    saved = json.loads(path.read_text())
    saved["database"]["name"] = "different"
    path.write_text(json.dumps(saved))
    with pytest.raises(copy.CopyError, match="differs"):
        operations.prepare(data, scratch_database)
    before = (data / "province.db").read_bytes()
    with pytest.raises(copy.CopyError, match="differs"):
        operations.rollback(data, scratch_database)
    assert (data / "province.db").read_bytes() == before


def test_invalid_source_does_not_initialize_target(data, scratch_database):
    with closing(sqlite3.connect(data / "province.db")) as conn:
        conn.execute("UPDATE codes SET revoked=2")
        conn.commit()
    with pytest.raises(copy.CopyError):
        operations.prepare(data, scratch_database)
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT to_regclass('public.schema_migrations')").fetchone() == (None,)


def test_partial_target_is_never_erased(data, scratch_database):
    copy.to_postgres(data / "province.db", scratch_database)
    with psycopg.connect(scratch_database) as conn:
        conn.execute("UPDATE codes SET player_uuid='other'")
    with pytest.raises(copy.CopyError):
        operations.prepare(data, scratch_database)
    assert not (data / ".postgres-authority.json").exists()
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT player_uuid FROM codes").fetchone() == ("other",)


def legacy_write(data, value="legacy", high=900):
    with closing(sqlite3.connect(data / "province.db")) as conn, conn:
        conn.execute("INSERT INTO codes(code_hash,player_uuid,created_at,expires_at) "
                     "VALUES (?,?,'2026-10-17T00:00:00Z','2026-10-18T00:00:00Z')", (value, value))
        conn.execute("UPDATE sqlite_sequence SET seq=? WHERE name='codes'", (high,))
        conn.execute("INSERT INTO admin_audit(created_at,actor_type,action,outcome) "
                     "VALUES ('2026-10-17T00:00:00Z','system',?,'ok')", (value,))


def test_failed_legacy_release_restores_all_accepted_writes(data, scratch_database):
    url = scratch_database
    operations.prepare(data, url)
    with psycopg.connect(url) as conn:
        conn.execute("CREATE TABLE precedent_keep (body text)")
        conn.execute("INSERT INTO precedent_keep VALUES ('untouched')")
        conn.execute("INSERT INTO admin_audit(created_at,actor_type,action,outcome) "
                     "VALUES (now(),'system','native','ok')")
    operations.rollback(data, url)
    legacy_write(data)
    operations.prepare(data, url)
    assert not (data / ".postgres-rollback-transition.json").exists()
    assert (data / ".postgres-authority.json").exists()
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT code_hash FROM codes ORDER BY id").fetchall() == [("original",), ("legacy",)]
        assert conn.execute("SELECT action FROM admin_audit ORDER BY id").fetchall() == [("native",), ("legacy",)]
        assert conn.execute("SELECT * FROM precedent_keep").fetchone() == ("untouched",)
        assert conn.execute("INSERT INTO codes(code_hash,player_uuid,created_at,expires_at) "
                            "VALUES ('next','next',now(),now()) RETURNING id").fetchone() == (901,)
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            conn.execute("TRUNCATE admin_audit")


def test_recovery_refuses_untracked_postgres_writes(data, scratch_database):
    url = scratch_database
    operations.prepare(data, url)
    operations.rollback(data, url)
    legacy_write(data)
    with psycopg.connect(url) as conn:
        conn.execute("UPDATE codes SET player_uuid='independent'")
    with pytest.raises(copy.CopyError, match="outside the tracked"):
        operations.prepare(data, url)
    assert not (data / ".postgres-authority.json").exists()
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT player_uuid FROM codes").fetchall() == [("independent",)]
    with closing(sqlite3.connect(data / "province.db")) as conn:
        assert conn.execute("SELECT code_hash FROM codes ORDER BY id").fetchall() == [("original",), ("legacy",)]


@pytest.mark.parametrize("more_writes", [False, True])
def test_recovery_retries_after_copy_commit_before_marker(data, scratch_database, monkeypatch, more_writes):
    url = scratch_database
    operations.prepare(data, url)
    operations.rollback(data, url)
    legacy_write(data)
    write = operations._write
    def power_loss(path, value):
        if path.name == ".postgres-authority.json":
            raise OSError("power loss after copy")
        write(path, value)
    monkeypatch.setattr(operations, "_write", power_loss)
    with pytest.raises(OSError, match="power loss"):
        operations.prepare(data, url)
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT count(*) FROM codes").fetchone() == (2,)
    if more_writes:
        legacy_write(data, "later", 1000)
    monkeypatch.setattr(operations, "_write", write)
    operations.prepare(data, url)
    copy.to_postgres(data / "province.db", url, verify_only=True)
    assert not (data / ".postgres-rollback-transition.json").exists()


def test_failed_replacement_restores_rows_audit_and_sequences(data, scratch_database, monkeypatch):
    url = scratch_database
    operations.prepare(data, url)
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO admin_audit(created_at,actor_type,action,outcome) "
                     "VALUES (now(),'system','native','ok')")
    operations.rollback(data, url)
    legacy_write(data)
    original = copy._sequences
    def interrupted(conn, source, tables, *, write, transactional=False):
        original(conn, source, tables, write=write, transactional=transactional)
        if transactional:
            raise RuntimeError("lost before transaction commit")
    monkeypatch.setattr(copy, "_sequences", interrupted)
    with pytest.raises(RuntimeError, match="lost before"):
        operations.prepare(data, url)
    monkeypatch.setattr(copy, "_sequences", original)
    transition = json.loads((data / ".postgres-rollback-transition.json").read_text())
    baseline = data / "migration-rollback" / transition["targets"][0]["snapshot"]
    copy.to_postgres(baseline, url, verify_only=True)  # includes every identity counter
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT action FROM admin_audit").fetchall() == [("native",)]
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            conn.execute("TRUNCATE admin_audit")
    operations.prepare(data, url)
    copy.to_postgres(data / "province.db", url, verify_only=True)


def test_replacement_never_cascades_into_other_app_tables(data, scratch_database):
    url = scratch_database
    operations.prepare(data, url)
    operations.rollback(data, url)
    legacy_write(data)
    with psycopg.connect(url) as conn:
        conn.execute("CREATE TABLE precedent_reference (code_id bigint REFERENCES codes(id))")
        conn.execute("INSERT INTO precedent_reference VALUES (1)")
    with pytest.raises(copy.CopyError, match="outside the tracked"):
        # The extra FK also changes native trigger definitions, so schema
        # verification refuses before reaching the non-CASCADE truncate.
        operations.prepare(data, url)
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT * FROM precedent_reference").fetchall() == [(1,)]
        assert conn.execute("SELECT code_hash FROM codes").fetchall() == [("original",)]
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            conn.execute("TRUNCATE admin_audit")


def test_replacement_rechecks_baseline_inside_transaction(data, scratch_database, monkeypatch):
    url = scratch_database
    operations.prepare(data, url)
    operations.rollback(data, url)
    legacy_write(data)
    original = operations.to_postgres
    changed = False
    def raced(path, target, **kwargs):
        nonlocal changed
        report = original(path, target, **kwargs)
        if kwargs.get("verify_only") and path.name.startswith("province.rollback-") and not changed:
            with psycopg.connect(url) as conn:
                conn.execute("UPDATE codes SET player_uuid='concurrent'")
            changed = True
        return report
    monkeypatch.setattr(operations, "to_postgres", raced)
    with pytest.raises(copy.CopyError, match="mismatch"):
        operations.prepare(data, url)
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT player_uuid FROM codes").fetchall() == [("concurrent",)]
    assert not (data / ".postgres-authority.json").exists()


def test_reverse_export_keeps_old_wal_away_from_new_sqlite(data, scratch_database):
    import subprocess
    import sys
    operations.prepare(data, scratch_database)
    # Emulate a killed historical worker: committed WAL, no clean close.
    script = """import os, sqlite3, sys
conn=sqlite3.connect(sys.argv[1]); conn.execute('PRAGMA journal_mode=WAL')
conn.execute("UPDATE codes SET player_uuid='stale-wal'"); conn.commit(); os._exit(0)
"""
    subprocess.run([sys.executable, "-c", script, str(data / "province.db")], check=True)
    assert (data / "province.db-wal").exists()
    operations.rollback(data, scratch_database)
    with closing(sqlite3.connect(data / "province.db")) as conn:
        assert conn.execute("SELECT player_uuid FROM codes").fetchall() == [("player",)]
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert list((data / "migration-rollback").glob("province.replaced-*.db-wal"))


@pytest.mark.parametrize("committed", [False, True])
def test_first_copy_failure_then_legacy_writes_can_be_migrated(data, scratch_database, monkeypatch, committed):
    url = scratch_database
    if committed:
        original = operations._publish
        monkeypatch.setattr(operations, "_publish", lambda *args: (_ for _ in ()).throw(OSError("power loss")))
    else:
        original = operations.to_postgres
        monkeypatch.setattr(operations, "to_postgres", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("power loss")))
    with pytest.raises(OSError):
        operations.prepare(data, url)
    assert not (data / ".postgres-authority.json").exists()
    legacy_write(data)
    monkeypatch.setattr(operations, "_publish" if committed else "to_postgres", original)
    operations.prepare(data, url)
    copy.to_postgres(data / "province.db", url, verify_only=True)
    assert (data / ".postgres-authority.json").exists()
    assert not (data / ".postgres-rollback-transition.json").exists()
