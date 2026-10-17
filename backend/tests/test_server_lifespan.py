"""Database migration runs once when the API starts serving requests."""

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient


def _start(monkeypatch, tmp_path, database_url: str):
    from server import app
    from src.database import migrate as postgres
    from src.skins import db

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    directories, migrate_postgres = Mock(), Mock()
    monkeypatch.setattr(db, "ensure_directories", directories)
    monkeypatch.setattr(postgres, "migrate", migrate_postgres)
    return app, directories, migrate_postgres


def test_startup_migrates_once_and_serves_ping(monkeypatch, tmp_path):
    app, migrate, migrate_postgres = _start(monkeypatch, tmp_path, "postgresql://db/site")

    with TestClient(app) as client:
        migrate.assert_called_once_with()
        migrate_postgres.assert_called_once_with(seed=True, retained_directory=tmp_path / "postgres-migrations")
        response = client.get("/ping")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        migrate.assert_called_once_with()

    migrate.assert_called_once_with()
    migrate_postgres.assert_called_once_with(seed=True, retained_directory=tmp_path / "postgres-migrations")


def test_startup_without_database_url_refuses_to_serve(monkeypatch, tmp_path):
    from src.database.connection import NotConfiguredError
    from src.database.migrate import migrate as real_migrate

    app, directories, migrate_postgres = _start(monkeypatch, tmp_path, "")
    migrate_postgres.side_effect = real_migrate

    with pytest.raises(NotConfiguredError, match="DATABASE_URL is not set"):
        with TestClient(app):
            pytest.fail("Startup accepted a missing database")

    directories.assert_called_once_with()
    migrate_postgres.assert_called_once_with(seed=True, retained_directory=tmp_path / "postgres-migrations")
