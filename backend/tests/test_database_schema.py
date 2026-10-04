"""Current-schema initialisation preserves records and realm isolation."""

import sqlite3

import pytest

from src.skins import db


def test_initialisation_preserves_records_and_constraints(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    for name in ("SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    db.migrate()
    with db.connect() as conn:
        for realm in ("main", "dev"):
            conn.execute(
                "INSERT INTO character_roster "
                "(player_uuid, realm_id, character_id, name, status, updated_at) "
                "VALUES ('player', ?, 'character', 'Name', 'ALIVE', 'now')",
                (realm,),
            )
        conn.execute(
            "INSERT INTO character_player_meta "
            "(player_uuid, real_age_set, eighteen, updated_at) "
            "VALUES ('player', 1, 1, 'now')"
        )
        conn.execute(
            "INSERT INTO character_creates "
            "(id, player_uuid, client_request_id, payload, status, created_at) "
            "VALUES ('create', 'player', 'request', '{}', 'pending', 'now')"
        )
        before = list(conn.iterdump())
    db.migrate()
    db.migrate()
    with db.connect() as conn:
        assert list(conn.iterdump()) == before
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO character_creates "
                "(id, player_uuid, client_request_id, payload, status, created_at) "
                "VALUES ('duplicate', 'player', 'request', '{}', 'pending', 'now')"
            )
