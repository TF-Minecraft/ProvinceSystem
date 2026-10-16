"""Database migration runs once when the API starts serving requests."""

from unittest.mock import Mock

from fastapi.testclient import TestClient


def _start(monkeypatch, database_url: str):
    from server import app
    from src.database import migrate as postgres
    from src.skins import db

    monkeypatch.setenv("DATABASE_URL", database_url)
    migrate, migrate_postgres = Mock(), Mock()
    monkeypatch.setattr(db, "migrate", migrate)
    monkeypatch.setattr(postgres, "migrate", migrate_postgres)
    return app, migrate, migrate_postgres


def test_startup_migrates_once_and_serves_ping(monkeypatch):
    app, migrate, migrate_postgres = _start(monkeypatch, "postgresql://db/site")

    with TestClient(app) as client:
        migrate.assert_called_once_with()
        migrate_postgres.assert_called_once_with()
        response = client.get("/ping")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        migrate.assert_called_once_with()

    migrate.assert_called_once_with()
    migrate_postgres.assert_called_once_with()


def test_startup_without_database_url_skips_postgres(monkeypatch):
    app, migrate, migrate_postgres = _start(monkeypatch, "")

    with TestClient(app) as client:
        assert client.get("/ping").status_code == 200

    migrate.assert_called_once_with()
    migrate_postgres.assert_not_called()
