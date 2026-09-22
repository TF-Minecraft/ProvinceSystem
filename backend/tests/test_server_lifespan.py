"""Database migration runs once when the API starts serving requests."""

from unittest.mock import Mock

from fastapi.testclient import TestClient


def test_startup_migrates_once_and_serves_ping(monkeypatch):
    from server import app
    from src.skins import db

    migrate = Mock()
    monkeypatch.setattr(db, "migrate", migrate)

    with TestClient(app) as client:
        migrate.assert_called_once_with()
        response = client.get("/ping")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        migrate.assert_called_once_with()

    migrate.assert_called_once_with()
