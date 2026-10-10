"""Precedent and code lookup in the staff panel: website role, not in-game permission."""
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import auth_routes, precedent_routes, skins_routes
from src.api.staff_access import staff_name
from src.auth import roles
from src.auth.test_admin import ORIGIN, account, client


@pytest.fixture
def app(database, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    monkeypatch.setenv("STAFF_KEY", "bot-key")
    monkeypatch.setattr(precedent_routes, "migrate", lambda: None)
    precedent_routes._SEARCH_RATE_BUCKETS.clear()
    skins_routes._INSPECT_RATE_BUCKETS.clear()
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    app.include_router(precedent_routes.precedent_router)
    app.include_router(skins_routes.skins_router)
    return app


def link(db, discord_user_id, uuid="player-1", name="StaffMC"):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO discord_links (player_uuid, discord_user_id, minecraft_name, discord_username, linked_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (uuid, discord_user_id, name, "staffer", "2026-01-01T00:00:00Z"),
        )
        conn.commit()


def discord_id(db, user_id):
    with db.connect() as conn:
        return conn.execute("SELECT discord_user_id FROM users WHERE id = ?", (user_id,)).fetchone()[0]


def test_moderators_have_both_tools():
    for capability in ("use_precedent", "inspect_codes"):
        assert roles.can("mod", capability)
        assert not roles.can("player", capability)


def test_precedent_needs_a_staff_account(app, database):
    assert client(app).get("/precedent/staff/cases").status_code == 401
    _, player = account(database, "player")
    assert client(app, player).get("/precedent/staff/cases").json() == {"detail": "forbidden"}


def test_moderator_lists_cases(app, database):
    _, token = account(database, "mod", role="mod")
    with mock.patch.object(precedent_routes, "list_cases", return_value=[]), \
            mock.patch.object(precedent_routes, "count_cases", return_value=0):
        res = client(app, token).get("/precedent/staff/cases")
    assert res.status_code == 200 and res.json() == {"cases": [], "total": 0}


def test_precedent_writes_need_the_site_origin(app, database):
    _, token = account(database, "mod", role="mod")
    with mock.patch.object(precedent_routes, "delete_case") as delete:
        res = client(app, token).delete("/precedent/staff/case/abc")
    assert res.json() == {"detail": "bad_origin"}
    delete.assert_not_called()


def test_logged_case_names_the_staff_member(app, database):
    user_id, token = account(database, "mod", role="mod")
    link(database, discord_id(database, user_id))
    with mock.patch.object(precedent_routes, "embed", return_value=[0.1]), \
            mock.patch.object(precedent_routes, "insert_case", return_value="new-id") as insert:
        res = client(app, token).post(
            "/precedent/staff/log", json={"logged_by": "SomeoneElse", "summary": "s"}, headers=ORIGIN
        )
    assert res.json() == {"id": "new-id"}
    kwargs = insert.call_args.kwargs
    assert kwargs["logged_by"] == "StaffMC"
    assert (kwargs["actor"].source, kwargs["actor"].actor, kwargs["actor"].actor_uuid) == ("web", "StaffMC", "player-1")


def test_unlinked_staff_are_named_by_discord(database):
    user_id, _ = account(database, "mod", role="mod")
    assert staff_name({"user_id": user_id, "discord_user_id": discord_id(database, user_id),
                       "discord_username": "mod"}) == ("mod", "")


def test_bot_key_still_reaches_precedent(app):
    with mock.patch.object(precedent_routes, "list_cases", return_value=[]), \
            mock.patch.object(precedent_routes, "count_cases", return_value=0):
        res = client(app).get("/precedent/staff/cases", headers={"X-Staff-Key": "bot-key"})
    assert res.status_code == 200


def test_code_lookup_needs_a_staff_account(app, database):
    body = {"code": "AAAA-BBBB-CCCC"}
    assert client(app).post("/skins/codes/inspect", json=body, headers=ORIGIN).status_code == 401
    _, player = account(database, "player")
    res = client(app, player).post("/skins/codes/inspect", json=body, headers=ORIGIN)
    assert res.json() == {"detail": "forbidden"}


def test_moderator_looks_up_a_code(app, database):
    from src.skins.codes import issue_code

    user_id, token = account(database, "mod", role="mod")
    link(database, discord_id(database, user_id))
    code = issue_code("player-1", "skin")["code"]
    res = client(app, token).post("/skins/codes/inspect", json={"code": code}, headers=ORIGIN)
    assert res.status_code == 200 and res.json()["valid"] is True
