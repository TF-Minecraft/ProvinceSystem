"""RPCharacters' roster push still sends fields the site no longer stores; the route must accept them."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.api import characters_routes
from src.auth import testing

pytestmark = pytest.mark.usefixtures("postgres")


def test_roster_push_ignores_the_entitlement_fields_rpcharacters_sends(monkeypatch):
    monkeypatch.setenv("PLUGIN_KEY", "plugin-test")
    app = FastAPI()
    app.include_router(characters_routes.characters_router)
    response = TestClient(app).put("/characters/plugin/roster", headers={"X-Plugin-Key": "plugin-test"}, json={
        "player_uuid": "player", "characters": [], "realm_id": "main",
        "max_alive_characters": 5, "name_colour_stops": 20, "wardrobe_skin_slots": 3,
        "eighteen": True, "account_created_at_epoch": 1789844555,
    })
    assert response.status_code == 200, response.text
    assert "max_alive_characters" not in response.json()
    assert testing.rows("SELECT is_adult, extract(epoch FROM account_created_at)::bigint AS created "
                        "FROM character_account_meta") == [{"is_adult": True, "created": 1789844555}]
