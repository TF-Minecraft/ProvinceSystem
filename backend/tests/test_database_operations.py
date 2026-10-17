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
    monkeypatch.setattr(operations, "_write", lambda *args: (_ for _ in ()).throw(OSError("power loss")))
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
