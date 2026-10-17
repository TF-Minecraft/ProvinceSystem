"""Bot lookups reuse verified links and follow UUIDs across name changes."""
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.skins_routes import skins_router
from src.auth import testing
from src.coreprotect.reader import Unavailable
from src.skins.testing import link

PLAYER = "0f6c5a52-3b7e-4c39-9d1d-2a8f0e7b9c11"
DISCORD = "323456789012345678"
PATH = f"/skins/discord/identity/{DISCORD}"
STAFF = {"X-Staff-Key": "staff-key"}


@pytest.fixture
def api(postgres, monkeypatch):
    monkeypatch.setenv("STAFF_KEY", "staff-key")
    monkeypatch.setenv("PLUGIN_KEY", "plugin-key")
    monkeypatch.delenv("COREPROTECT_DB", raising=False)
    app = FastAPI()
    app.include_router(skins_router)
    return TestClient(app)


@pytest.mark.parametrize("headers", [{}, {"X-Staff-Key": "wrong"}, {"X-Plugin-Key": "plugin-key"}])
def test_identity_requires_staff_key(api, headers):
    link(PLAYER, DISCORD, "SecretSteve")
    response = api.get(PATH, headers=headers)
    assert response.status_code == 401
    assert "SecretSteve" not in response.text and PLAYER not in response.text


def test_identity_uses_link_not_matching_discord_display_name(api):
    link(PLAYER, DISCORD, "Steve", "someone_else")
    response = api.get(PATH, headers=STAFF)
    assert response.status_code == 200
    assert response.json() == {"linked": True, "discord_user_id": DISCORD, "player_uuid": PLAYER,
                               "minecraft_name": "Steve", "name_source": "link"}


def test_identity_follows_uuid_after_rename(api, coreprotect):
    link(PLAYER, DISCORD, "OldName")
    coreprotect.user("NotThisPlayer", "00000000-0000-0000-0000-000000000002", time=10000)
    coreprotect.user("OldName", PLAYER, time=1000)
    coreprotect.user("NewName", PLAYER.upper(), time=2000)
    data = api.get(PATH, headers=STAFF).json()
    assert data == {"linked": True, "discord_user_id": DISCORD, "player_uuid": PLAYER,
                    "minecraft_name": "NewName", "name_source": "coreprotect"}
    assert testing.rows("SELECT minecraft_name FROM discord_links") == [{"minecraft_name": "OldName"}]


@pytest.mark.parametrize("reason", ["not_configured", "missing", "busy", "timeout", "error"])
def test_coreprotect_failure_preserves_verified_identity(api, reason):
    link(PLAYER, DISCORD, "Steve")
    with patch("src.skins.discord_link.Reader", side_effect=Unavailable(reason)):
        data = api.get(PATH, headers=STAFF).json()
    assert data["linked"] and data["player_uuid"] == PLAYER
    assert data["minecraft_name"] == "Steve" and data["name_source"] == "link"


def test_identity_without_name_keeps_uuid(api):
    link(PLAYER, DISCORD)
    data = api.get(PATH, headers=STAFF).json()
    assert data["linked"] and data["player_uuid"] == PLAYER
    assert data["minecraft_name"] is None and data["name_source"] is None


def test_unlinked_and_expired_accounts_do_not_leak_previous_identity(api):
    unlinked = {"linked": False, "discord_user_id": DISCORD, "player_uuid": None,
                "minecraft_name": None, "name_source": None}
    assert api.get(PATH, headers=STAFF).json() == unlinked
    link(PLAYER, DISCORD, "Steve", left_guild_at="2020-01-01T00:00:00Z", grace_until="2020-01-01T01:00:00Z")
    assert api.get(PATH, headers=STAFF).json() == unlinked
    assert testing.rows("SELECT player_uuid FROM discord_links") == []


def test_link_changes_are_visible_immediately(api):
    link(PLAYER, DISCORD, "Steve")
    assert api.get(PATH, headers=STAFF).json()["player_uuid"] == PLAYER
    testing.execute("DELETE FROM discord_links")
    other = "00000000-0000-0000-0000-000000000002"
    link(other, DISCORD, "Alex")
    assert api.get(PATH, headers=STAFF).json()["player_uuid"] == other


@pytest.mark.parametrize("value", ["nickname", "<@323456789012345678>", "123", "1" * 21])
def test_lookup_accepts_only_snowflakes(api, value):
    assert api.get(f"/skins/discord/identity/{value}", headers=STAFF).status_code == 422
