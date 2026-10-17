"""The deployment `prepare` step on real PG17: it migrates only the database the cutover marker names."""
import json

import psycopg
import pytest

from src.database import migrate, operations


def _mark(data, url):
    (data / ".postgres-authority.json").write_text(json.dumps(
        {"authority": "postgres", "database": operations._identity(url)}))


def test_prepare_applies_pending_migrations(tmp_path, scratch_database, monkeypatch):
    url = scratch_database
    files = migrate.discover()
    monkeypatch.setattr(migrate, "discover", lambda directory=None: files[:1])
    migrate.migrate(url)
    _mark(tmp_path, url)
    monkeypatch.undo()
    operations.prepare(tmp_path, url)
    with psycopg.connect(url) as conn:
        applied = [row[0] for row in conn.execute("SELECT version FROM schema_migrations ORDER BY version")]
    assert applied == [m.version for m in files]
    assert (tmp_path / "postgres-migrations").is_dir()


def test_prepare_refuses_a_site_without_the_cutover_marker(tmp_path, scratch_database):
    with pytest.raises(operations.OperationError, match="never moved off SQLite"):
        operations.prepare(tmp_path, scratch_database)
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT to_regclass('public.schema_migrations')").fetchone() == (None,)


@pytest.mark.parametrize("change", ["name", "history", "authority"])
def test_prepare_refuses_another_database(tmp_path, scratch_database, change):
    migrate.migrate(scratch_database)
    _mark(tmp_path, scratch_database)
    path = tmp_path / ".postgres-authority.json"
    saved = json.loads(path.read_text())
    if change == "name":
        saved["database"]["name"] = "different"
    elif change == "history":
        saved["database"]["history"]["0001"][0] = "0" * 64
    else:
        saved["authority"] = "sqlite"
    path.write_text(json.dumps(saved))
    with pytest.raises(operations.OperationError):
        operations.prepare(tmp_path, scratch_database)


def test_studio_requires_a_separate_login_on_the_same_database(monkeypatch):
    url = "postgresql://owner:secret@db:5432/provincesystem"
    monkeypatch.delenv("DATABASE_STUDIO_URL", raising=False)
    with pytest.raises(operations.OperationError, match="required"):
        operations.studio(url)
    monkeypatch.setenv("DATABASE_STUDIO_URL", "postgresql://studio:x@db:5432/other")
    with pytest.raises(operations.OperationError, match="same database"):
        operations.studio(url)
    monkeypatch.setenv("DATABASE_STUDIO_URL", "postgresql://owner:x@db:5432/provincesystem")
    with pytest.raises(operations.OperationError, match="separate"):
        operations.studio(url)
