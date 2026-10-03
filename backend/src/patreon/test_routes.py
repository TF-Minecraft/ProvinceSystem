from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.api import patreon_routes as routes
from src.api import characters_routes
from src.api.prod_guard import assert_production_safe
from src.patreon import service as s
from src.patreon.test_service import CONFIG, member, player, sync, changes, ack

STAFF = {"X-Staff-Key": "staff-test"}
PLUGIN = {"X-Plugin-Key": "plugin-test"}


@pytest.fixture
def api(database, monkeypatch):
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    monkeypatch.setenv("STAFF_KEY", "staff-test")
    monkeypatch.setenv("PLUGIN_KEY", "plugin-test")
    monkeypatch.setenv("PLUGIN_KEYS_SECONDARY", "secondary-test")
    app = FastAPI()
    app.include_router(routes.patreon_router)
    return TestClient(app)


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/status?discord_user_id=111", None), ("POST", "/link/start", {}), ("POST", "/link/unlink", {}),
    ("GET", "/staff/role-changes", None), ("POST", "/staff/role-changes/ack", {"ids": []}),
    ("GET", "/staff/roster", None), ("GET", "/staff/lookup?email=fake@example.com", None),
    ("POST", "/staff/link", {}), ("POST", "/staff/unlink", {}), ("POST", "/staff/resync", None),
    ("GET", "/staff/unlinked", None), ("GET", "/staff/health", None), ("POST", "/staff/brake/release", None),
    ("GET", "/staff/alerts", None), ("POST", "/staff/alerts/ack", {"ids": []}),
    ("POST", "/staff/import", {}), ("GET", "/plugin/rank-changes", None),
    ("POST", "/plugin/rank-changes/ack", {"ids": []}), ("GET", "/plugin/roster", None),
])
def test_all_routes_disabled_and_authenticated(api, monkeypatch, method, path, body):
    response = api.request(method, "/patreon" + path, json=body)
    assert response.status_code == 401
    monkeypatch.setenv("PATREON_ENABLED", "0")
    response = api.request(method, "/patreon" + path, json=body, headers=STAFF)
    assert response.status_code == 503 and response.json()["detail"] == "patreon_disabled"


def test_profile_scope_and_cannot_choose_another_player(api, monkeypatch):
    sync([member(discord=None)])
    s.create_or_update_link("1", player_uuid=player(), config=CONFIG)
    s.recompute_link("1", config=CONFIG)
    monkeypatch.setattr(characters_routes, "get_session", lambda token: {"player_uuid": player(), "scope": "profile"} if token == "valid" else {"player_uuid": player(), "scope": "skin"} if token == "skin" else None)
    path = "/patreon/status?player_uuid=" + player(99)
    assert api.get(path, headers={"Authorization": "Bearer valid"}).json()["linked"]
    assert api.get(path, headers={"Authorization": "Bearer skin"}).status_code == 401
    assert api.get(path, headers={"Authorization": "Bearer expired"}).status_code == 401
    response = api.post("/patreon/link/unlink", json={"player_uuid": player(99)}, headers={"Authorization": "Bearer valid"})
    assert response.json() == {"unlinked": True}


def test_wire_shapes_and_privacy(api):
    sync([member(discord=None)])
    response = api.post("/patreon/staff/link", headers=STAFF, json={"patreon_email": "patron1@example.com", "discord_user_id": "111", "player_uuid": player()})
    assert response.status_code == 200 and "example.com" not in response.text
    status = api.get("/patreon/status?discord_user_id=111", headers=STAFF)
    assert status.json() == {"linked": True, "method": "staff", "patreon_name": "Patron 1", "tier_key": "noble", "tier_name": "Noble", "patron_status": "active_patron", "is_gifted": False, "grace_until": None, "has_discord": True, "has_minecraft": True}
    roles = api.get("/patreon/staff/role-changes", headers=STAFF).json()["changes"]
    assert set(roles[0]) == {"id", "discord_user_id", "add_tier", "remove_tiers", "dm", "tier_name"} and roles[0]["dm"] == "link_success"
    ranks = api.get("/patreon/plugin/rank-changes", headers=PLUGIN).json()["changes"]
    assert set(ranks[0]) == {"id", "player_uuid", "add_tier", "remove_tiers"}
    assert api.post("/patreon/staff/role-changes/ack", headers=STAFF, json={"ids": [r["id"] for r in roles]}).status_code == 200
    assert api.post("/patreon/plugin/rank-changes/ack", headers=PLUGIN, json={"ids": [r["id"] for r in ranks]}).status_code == 200
    for path, headers in [("/staff/health", STAFF), ("/staff/alerts", STAFF), ("/staff/roster", STAFF), ("/plugin/roster", PLUGIN), ("/staff/role-changes", STAFF), ("/plugin/rank-changes", PLUGIN), ("/status?player_uuid="+player(), PLUGIN)]:
        response = api.get("/patreon" + path, headers=headers)
        assert response.status_code == 200 and "example.com" not in response.text
    lookup = api.get("/patreon/staff/lookup?email=patron1@example.com", headers=STAFF)
    assert lookup.json()["member"]["email"] == "patron1@example.com"
    assert api.get("/patreon/status?discord_user_id=unknown", headers=STAFF).json() == {"linked": False, "method": None, "patreon_name": None, "tier_key": None, "tier_name": None, "patron_status": None, "is_gifted": False, "grace_until": None, "has_discord": False, "has_minecraft": False}


def test_keys_cannot_cross_auth_surfaces_and_secondary_cannot_write(api):
    assert api.get("/patreon/staff/health", headers=PLUGIN).status_code == 401
    assert api.get("/patreon/plugin/roster", headers=STAFF).status_code == 401
    assert api.get("/patreon/plugin/roster", headers={"X-Plugin-Key": "secondary-test"}).status_code == 403
    assert api.get("/patreon/status?player_uuid=" + player(), headers={"X-Plugin-Key": "secondary-test"}).status_code == 200
    assert api.get("/patreon/status", headers=STAFF).json()["detail"] == "discord_user_id_required"
    assert api.get("/patreon/status", headers=PLUGIN).json()["detail"] == "player_uuid_required"


def test_staff_import_unlinked_and_unlink(api):
    sync([member(discord=None)])
    assert api.get("/patreon/staff/unlinked", headers=STAFF).json()["members"][0]["email"] == "patron1@example.com"
    body = {"links": [{"player_uuid": player(), "patreon_email": "patron1@example.com"}], "grants": [{"player_uuid": player(), "tier_key": "ascended"}], "dry_run": True}
    response = api.post("/patreon/staff/import", headers=STAFF, json=body)
    assert response.status_code == 200 and response.json()["grants_seeded"] == 1
    assert not s.status(player_uuid=player(), config=CONFIG)["linked"]
    body["dry_run"] = False
    assert api.post("/patreon/staff/import", headers=STAFF, json=body).status_code == 200
    assert api.post("/patreon/staff/unlink", headers=STAFF, json={"patreon_user_id": "1"}).json() == {"unlinked": True}


@pytest.mark.parametrize("missing", ["PATREON_CLIENT_ID", "PATREON_CLIENT_SECRET", "PATREON_CREATOR_ACCESS_TOKEN", "PATREON_CREATOR_REFRESH_TOKEN"])
def test_production_guard_requires_all_credentials(monkeypatch, missing):
    monkeypatch.setenv("PS_PRODUCTION", "1")
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PLUGIN_KEY", "test")
    monkeypatch.setenv("STAFF_KEY", "test")
    monkeypatch.delenv("SKINS_DEV", raising=False)
    monkeypatch.delenv("CHARACTER_UI_DEV", raising=False)
    for name in ("PATREON_CLIENT_ID", "PATREON_CLIENT_SECRET", "PATREON_CREATOR_ACCESS_TOKEN", "PATREON_CREATOR_REFRESH_TOKEN"):
        monkeypatch.setenv(name, "secret")
    assert_production_safe()
    monkeypatch.delenv(missing)
    with pytest.raises(RuntimeError, match=missing):
        assert_production_safe()
    monkeypatch.setenv("PATREON_ENABLED", "0")
    assert_production_safe()
