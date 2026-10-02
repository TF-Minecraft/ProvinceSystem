"""Malformed synced permissions cannot become staff grants."""

import json

from fastapi import HTTPException
import pytest

from src.api import map_access
from src.characters import rpc_player_meta
from src.skins import db


@pytest.fixture
def permission_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    monkeypatch.setattr(db, "SKINS_DIR", tmp_path / "skins")
    monkeypatch.setattr(db, "DRINKS_DIR", tmp_path / "drinks")
    monkeypatch.setattr(db, "WARDROBE_DIR", tmp_path / "wardrobe")
    db.migrate()
    return db


@pytest.mark.parametrize("value", ["denied", "null", [False], {"value": False}, None, 2, -1, 1.5])
def test_rejects_malformed_permission_on_sync(permission_db, value):
    with pytest.raises(rpc_player_meta.RpcPlayerMetaError, match="must be a boolean"):
        rpc_player_meta.upsert_rpc_player_meta({
            "player_uuid": "permission-player",
            "permission_flags": {"tfmc.map.staff": value},
        })
    assert rpc_player_meta.get_rpc_player_meta("permission-player") is None


@pytest.mark.parametrize("value", [True, 1, 1.0, "true", "yes", "on", "1"])
def test_accepts_supported_true_permissions(permission_db, value):
    rpc_player_meta.upsert_rpc_player_meta({
        "player_uuid": "permission-player",
        "permission_flags": {"tfmc.map.staff": value},
    })
    assert rpc_player_meta.has_map_staff_access("permission-player", "main", "tfmc.map.staff")


@pytest.mark.parametrize("value", [False, 0, 0.0, "false", "no", "off", "0", ""])
def test_supported_false_permissions_do_not_grant_staff(permission_db, value):
    rpc_player_meta.upsert_rpc_player_meta({
        "player_uuid": "permission-player",
        "permission_flags": {"tfmc.map.staff": value},
    })
    assert not rpc_player_meta.has_map_staff_access("permission-player", "main", "tfmc.map.staff")


@pytest.mark.parametrize("value", ["denied", [False], {"value": False}, 2, -1, 1.5])
def test_legacy_malformed_permission_cannot_authorize_staff(permission_db, monkeypatch, value):
    rpc_player_meta.upsert_rpc_player_meta({
        "player_uuid": "permission-player",
        "permission_flags": {"tfmc.map.staff": False},
    })
    with permission_db.connect() as conn:
        conn.execute(
            "UPDATE rpc_player_meta SET permission_flags_json = ? WHERE player_uuid = ?",
            (json.dumps({"tfmc.map.staff": value}), "permission-player"),
        )

    session = {"scope": "profile", "player_uuid": "permission-player", "realm_id": "main"}
    monkeypatch.setattr(map_access, "get_feature_session", lambda _: session)
    monkeypatch.setattr(map_access, "get_character_session", lambda _: session)

    with pytest.raises(HTTPException) as site_staff:
        map_access.require_site_staff("Bearer valid-profile-session")
    assert site_staff.value.status_code == 403

    with pytest.raises(HTTPException) as map_staff:
        map_access.ensure_map_staff_write("main", "Bearer valid-profile-session")
    assert map_staff.value.status_code == 403
