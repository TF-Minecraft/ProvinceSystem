"""Cases belong to account IDs even before Minecraft is linked."""
from unittest.mock import patch

import pytest
from fastapi import FastAPI

from src import database
from src.api import admin_routes, auth_routes, precedent_routes
from src.auth import testing
from src.auth.test_admin import client
from src.auth.test_players import env, staff  # noqa: F401
from src.precedent import db
from src.skins import testing as links

PLAYER = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8"
OTHER = "11111111-1111-1111-1111-111111111111"
DISCORD = "422545450919526411"
OTHER_DISCORD = "500000000000000001"
VECTOR = [0.01] * 1024


@pytest.fixture(autouse=True)
def case_store(postgres, monkeypatch):
    monkeypatch.setattr(db, "_MIGRATED", False)
    db.migrate()
    testing.execute("TRUNCATE precedent_cases, precedent_audit RESTART IDENTITY")
    yield
    testing.execute("TRUNCATE precedent_cases, precedent_audit RESTART IDENTITY")


@pytest.fixture
def app(env, coreprotect):
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    app.include_router(precedent_routes.precedent_router)
    admin_routes.install(app)
    return app


def log(*, participants=None, players=None, summary="A case", **extra):
    return db.insert_case(logged_by="Moderator", players=players or [], participants=participants,
                          summary=summary, rule="1", ruling="Decision", punishment="Warning",
                          embedding=VECTOR, **extra)


def person(discord=DISCORD, uuid=None, name="Discord person"):
    return {"discord_user_id": discord, "player_uuid": uuid, "name": name, "discord_username": "account_handle"}


def history(app, env, path=f"/admin/discord/{DISCORD}/cases", **query):
    result = client(app, staff(env)).get(path, params=query)
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    return result.json()


def test_discord_case_needs_neither_minecraft_link_nor_website_login(app, env):
    case_id = log(participants=[person()], summary="Discord harassment")
    result = history(app, env)
    assert result["person"]["player_uuid"] is None
    assert result["person"]["discord_user_id"] == DISCORD
    assert result["total"] == 1 and result["entries"][0]["case_id"] == case_id
    assert result["entries"][0]["matched_by"] == "account"
    assert testing.rows("SELECT * FROM users WHERE discord_user_id = %s", (DISCORD,)) == []


def test_linking_later_joins_discord_cases_and_minecraft_history(app, env, coreprotect):
    log(participants=[person()], summary="Before linking")
    links.link(PLAYER, DISCORD, "NewName", "account_handle")
    coreprotect.user("NewName", PLAYER)
    testing.execute("INSERT INTO player_warnings (player_uuid, reason, created_at) VALUES (%s, 'In-game warning', now())", (PLAYER,))
    result = history(app, env, f"/admin/players/{PLAYER}/cases")
    assert {r["summary"] for r in result["entries"]} == {"Before linking", "In-game warning"}
    assert history(app, env)["total"] == 2


def test_ids_survive_rename_unlink_and_username_reuse(app, env, coreprotect):
    log(participants=[person(uuid=PLAYER, name="OldName")], players=["OldName"])
    coreprotect.user("NewName", PLAYER)
    links.link(OTHER, OTHER_DISCORD, "OldName", "different_person")
    assert history(app, env, f"/admin/players/{PLAYER}/cases")["total"] == 1
    assert history(app, env)["total"] == 1
    assert history(app, env, f"/admin/players/{OTHER}/cases")["total"] == 0
    assert history(app, env, f"/admin/discord/{OTHER_DISCORD}/cases")["total"] == 0


def test_legacy_names_are_exact_and_marked_as_unverified(app, env, coreprotect):
    coreprotect.user("NewName", PLAYER)
    coreprotect.execute("INSERT INTO co_username_log (time, uuid, user) VALUES (1, ?, 'OldName')", (PLAYER,))
    log(players=["oLdNaMe"], summary="Old case")
    log(players=["NewNameElse"], summary="A different player")
    log(players=["SomeoneElse"], summary="OldName mentioned in evidence")
    result = history(app, env, f"/admin/players/{PLAYER}/cases")
    assert result["total"] == 1
    assert result["entries"][0]["summary"] == "Old case"
    assert result["entries"][0]["matched_by"] == "name"


def test_all_involved_accounts_see_a_case_only_once(app, env):
    log(participants=[person(uuid=PLAYER), person(OTHER_DISCORD, OTHER)], players=["One", "Two"])
    links.link(PLAYER, DISCORD, "One")
    assert history(app, env, f"/admin/players/{PLAYER}/cases")["total"] == 1
    assert history(app, env, f"/admin/discord/{OTHER_DISCORD}/cases")["total"] == 1


def test_history_deduplicates_warning_mirrors_and_excludes_private_mail(app, env):
    links.link(PLAYER, DISCORD, "Player")
    testing.execute("INSERT INTO player_warnings (id, player_uuid, reason, created_at) VALUES (1, %s, 'Warning', now())", (PLAYER,))
    for kind, payload in [("warn", {"warning_id": 1, "reason": "Warning"}), ("ban", {"reason": "Banned", "duration": "7 days"}),
                          ("unban", {"reason": "Appeal accepted"}), ("bird_mail", {"contents": "private letter"})]:
        testing.execute("INSERT INTO player_notifications (type, discord_user_id, player_uuid, payload, created_at) "
                        "VALUES (%s, %s, %s, %s, now())", (kind, DISCORD, PLAYER, database.Jsonb(payload)))
    result = history(app, env)
    assert result["total"] == 3
    assert {r["kind"] for r in result["entries"]} == {"warning", "ban", "unban"}
    assert "private letter" not in str(result)


def test_pagination_is_complete_and_stable(app, env):
    for i in range(7):
        log(participants=[person()], summary=f"Case {i}")
    testing.execute("UPDATE precedent_cases SET created_at = '2026-01-01T00:00:00Z'")
    pages = [history(app, env, limit=3, offset=offset) for offset in (0, 3, 6)]
    ids = [r["id"] for page in pages for r in page["entries"]]
    assert len(ids) == len(set(ids)) == 7
    assert all(page["total"] == 7 for page in pages)


def test_discord_directory_includes_case_participants_without_accounts(app, env):
    log(participants=[person()])
    response = client(app, staff(env)).get("/admin/players", params={"view": "discord", "q": DISCORD})
    assert response.status_code == 200, response.text
    [entry] = response.json()["rows"]
    assert entry["uuid"] is None and entry["discord_user_id"] == DISCORD
    assert entry["discord_username"] == "account_handle"


def test_case_history_needs_staff_and_valid_ids(app, env):
    path = f"/admin/discord/{DISCORD}/cases"
    assert client(app).get(path).status_code == 401
    assert client(app, staff(env, "player")).get(path).status_code == 403
    assert client(app, staff(env)).get("/admin/discord/not-a-person/cases").status_code == 400
    assert client(app, staff(env)).get("/admin/players/not-a-uuid/cases").status_code == 400


def test_missing_name_history_is_explicit(app, env, monkeypatch):
    monkeypatch.delenv("COREPROTECT_DB", raising=False)
    links.link(PLAYER, DISCORD, "StoredName")
    log(participants=[person(uuid=PLAYER)])
    result = history(app, env)
    assert result["total"] == 1
    assert result["person"]["legacy_names_complete"] is False


def test_new_and_old_writers_preserve_participants_through_edit_delete_and_restore(app, env):
    identities = [person()]
    case_id = log(participants=identities)
    db.update_case(case_id, logged_by="Staff", players=["Changed label"], summary="Edited", rule="2", ruling="Ruling",
                   punishment="None", embedding=VECTOR)  # old client omits participants
    assert db.get_case(case_id)["participants"] == identities
    db.delete_case(case_id)
    snapshot = db.list_audit_entries(case_id=case_id, action="delete")[0]["before"]
    assert snapshot["participants"] == identities
    assert db.restore_case(case_id, snapshot=snapshot, embedding=VECTOR)
    assert db.get_case(case_id)["participants"] == identities
    assert history(app, env)["total"] == 1
    db._MIGRATED = False
    db.migrate()  # replaying the additive migration preserves old and new rows
    assert db.get_case(case_id)["participants"] == identities


def test_api_stores_discord_only_participants_and_validates_identity(app, env, monkeypatch):
    monkeypatch.setenv("STAFF_KEY", "test-staff")
    body = {"logged_by": "Bot staff", "players": ["Discord person"], "participants": [person()],
            "summary": "Discord case", "ruling": "a" * 500}
    with patch.object(precedent_routes, "embed", return_value=VECTOR):
        api = client(app)
        response = api.post("/precedent/staff/log", headers={"X-Staff-Key": "test-staff"}, json=body)
        assert response.status_code == 200, response.text
        assert db.get_case(response.json()["id"])["participants"][0]["discord_user_id"] == DISCORD
        body["participants"] = [{"name": "No ID"}]
        assert api.post("/precedent/staff/log", headers={"X-Staff-Key": "test-staff"}, json=body).status_code == 422
