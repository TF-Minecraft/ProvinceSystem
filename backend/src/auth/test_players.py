import json

import pytest
from fastapi import FastAPI

from src.api import admin_routes, auth_routes
from src.auth import players
from src.auth.test_admin import account, client

HAZEL = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8"
LINKED_ONLY = "11111111-1111-1111-1111-111111111111"
ROSTER_ONLY = "22222222-2222-2222-2222-222222222222"
NOW_ISH = 2_000_000_000


@pytest.fixture
def app(env, coreprotect):
    players.clear_cache()
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)
    yield app
    players.clear_cache()


@pytest.fixture
def env(database, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    return database


def link(db, player_uuid, discord_id, mc_name, discord_name):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO discord_links (player_uuid, discord_user_id, minecraft_name, discord_username, linked_at) "
            "VALUES (?, ?, ?, ?, '2026-09-20T10:00:00Z')", (player_uuid, discord_id, mc_name, discord_name))
        conn.commit()


def character(db, player_uuid, name, realm="main"):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO character_roster (player_uuid, realm_id, character_id, name, status, race, class, "
            "updated_at) VALUES (?, ?, ?, ?, 'alive', 'human', 'smith', '2026-09-21T10:00:00Z')",
            (player_uuid, realm, f"c-{name}", name))
        conn.commit()


@pytest.fixture
def world(env, coreprotect):
    hazel = coreprotect.user("MrEnzo99", HAZEL)
    coreprotect.execute("INSERT INTO co_username_log (time, uuid, user) VALUES (1, ?, 'OldEnzo')", (HAZEL,))
    coreprotect.execute("INSERT INTO co_username_log (time, uuid, user) VALUES (2, ?, 'MrEnzo99')", (HAZEL,))
    coreprotect.user("#fire", None)
    quiet = coreprotect.user("Quiet", "33333333-3333-3333-3333-333333333333")
    coreprotect.session(hazel, 100, 1)
    coreprotect.session(hazel, 200, 0)
    coreprotect.session(quiet, 50, 1)
    coreprotect.block(hazel, 150, 0)
    coreprotect.command(hazel, 160, "/msg Bob a private thing")
    link(env, HAZEL, "422545450919526411", "MrEnzo99", "hazelstone")
    link(env, LINKED_ONLY, "500000000000000001", "LinkedOnly", "linky")
    character(env, HAZEL, "Hazel Stonebrook")
    character(env, ROSTER_ONLY, "Aldric")
    return {"hazel": hazel}


def staff(env, role="mod"):
    _, token = account(env, f"staff-{role}", role)
    return token


def test_requires_a_staff_role(app, env, world):
    assert client(app).get("/admin/players").status_code == 401
    assert client(app, staff(env, "player")).get("/admin/players").status_code == 403
    assert client(app, staff(env, "player")).get(f"/admin/players/{HAZEL}/activity").status_code == 403
    assert client(app, staff(env, "mod")).get("/admin/players").status_code == 200


def test_directory_merges_every_source(app, env, world):
    body = client(app, staff(env)).get("/admin/players").json()
    assert body["coreprotect"] == {"status": "available", "server_label": "Vardera"}
    by_uuid = {p["uuid"]: p for p in body["players"]}
    assert set(by_uuid) == {HAZEL, LINKED_ONLY, ROSTER_ONLY, "33333333-3333-3333-3333-333333333333"}
    assert by_uuid[HAZEL]["minecraft_name"] == "MrEnzo99"
    assert by_uuid[HAZEL]["discord_username"] == "hazelstone"
    assert by_uuid[HAZEL]["characters"] == ["Hazel Stonebrook"]
    assert by_uuid[HAZEL]["last_seen"] == 200
    assert by_uuid[LINKED_ONLY]["minecraft_name"] == "LinkedOnly"
    assert by_uuid[ROSTER_ONLY]["minecraft_name"] is None
    # Last seen first, never-seen last.
    assert [p["uuid"] for p in body["players"]][:2] == [HAZEL, "33333333-3333-3333-3333-333333333333"]


@pytest.mark.parametrize("query", ["oldenzo", "HAZELSTONE", "@hazelstone", "stonebrook", HAZEL,
                                   HAZEL.replace("-", ""), "422545450919526411"])
def test_directory_search(app, env, world, query):
    body = client(app, staff(env)).get("/admin/players", params={"q": query}).json()
    assert [p["uuid"] for p in body["players"]] == [HAZEL]


def test_directory_sorts(app, env, world):
    c = client(app, staff(env))
    by_mc = [p["minecraft_name"] for p in c.get("/admin/players", params={"sort": "minecraft"}).json()["players"]]
    assert by_mc == ["LinkedOnly", "MrEnzo99", "Quiet", None]
    by_discord = [p["discord_username"] for p in c.get("/admin/players", params={"sort": "discord"}).json()["players"]]
    assert by_discord[:2] == ["hazelstone", "linky"]
    assert c.get("/admin/players", params={"sort": "bogus"}).status_code == 400
    assert c.get("/admin/players", params={"q": "x" * 65}).status_code == 400


def test_directory_without_coreprotect(app, env, world, monkeypatch):
    monkeypatch.setenv("COREPROTECT_DB", str(env.DATA_DIR / "nowhere.db"))
    body = client(app, staff(env)).get("/admin/players").json()
    assert body["coreprotect"]["status"] == "unavailable"
    assert body["coreprotect"]["reason"] == "missing"
    assert {p["uuid"] for p in body["players"]} == {HAZEL, LINKED_ONLY, ROSTER_ONLY}


def test_profile(app, env, world):
    body = client(app, staff(env)).get(f"/admin/players/{HAZEL.upper()}").json()
    assert body["uuid"] == HAZEL
    assert body["minecraft_name"] == "MrEnzo99"
    assert body["past_names"] == [{"name": "OldEnzo", "time": 1}]
    assert body["first_seen"] == 100
    assert body["last_seen"] == 200
    assert body["online"] is False
    assert body["discord"]["discord_username"] == "hazelstone"
    assert body["account"] is None
    assert body["characters"][0]["name"] == "Hazel Stonebrook"
    assert body["coreprotect"]["status"] == "available"


def test_profile_shows_the_website_account(app, env, world):
    token = staff(env, "admin")
    with env.connect() as conn:
        conn.execute("UPDATE discord_links SET discord_user_id = (SELECT discord_user_id FROM users LIMIT 1) "
                     "WHERE player_uuid = ?", (HAZEL,))
        conn.commit()
    body = client(app, token).get(f"/admin/players/{HAZEL}").json()
    assert body["account"]["role"] == "admin"


def test_profile_errors(app, env, world, monkeypatch):
    c = client(app, staff(env))
    assert c.get("/admin/players/not-a-uuid").status_code == 400
    assert c.get("/admin/players/44444444-4444-4444-4444-444444444444").status_code == 404
    monkeypatch.setenv("COREPROTECT_DB", "")
    body = c.get("/admin/players/44444444-4444-4444-4444-444444444444").json()
    assert body["coreprotect"] == {"status": "unavailable", "reason": "not_configured", "server_label": "Vardera",
                                   "ping_seconds": 60}
    assert c.get(f"/admin/players/{ROSTER_ONLY}").json()["characters"][0]["name"] == "Aldric"


def test_sessions_and_activity(app, env, world):
    c = client(app, staff(env))
    sessions = c.get(f"/admin/players/{HAZEL}/sessions").json()
    assert [(s["start"]["time"], s["end"]["time"], s["end_kind"]) for s in sessions["sessions"]] == [(100, 200, "logout")]
    assert sessions["next"] is None
    feed = c.get(f"/admin/players/{HAZEL}/activity").json()
    assert [e["kind"] for e in feed["entries"]] == ["session", "command", "block", "session"]
    assert "private" not in str(feed)
    assert "chat" not in feed["kinds"]
    only_blocks = c.get(f"/admin/players/{HAZEL}/activity", params={"kinds": "block"}).json()
    assert [e["kind"] for e in only_blocks["entries"]] == ["block"]


def test_paging_and_bad_input(app, env, world):
    c = client(app, staff(env))
    first = c.get(f"/admin/players/{HAZEL}/activity", params={"limit": 1}).json()
    assert first["next"]
    second = c.get(f"/admin/players/{HAZEL}/activity", params={"limit": 1, "before": first["next"]}).json()
    assert second["entries"][0]["id"] != first["entries"][0]["id"]
    # A cursor for one player is refused for another.
    other = "33333333-3333-3333-3333-333333333333"
    assert c.get(f"/admin/players/{other}/activity", params={"before": first["next"]}).status_code == 400
    assert c.get(f"/admin/players/{HAZEL}/activity", params={"kinds": "chat"}).status_code == 400
    assert c.get(f"/admin/players/{HAZEL}/activity", params={"limit": 101}).status_code == 422
    assert c.get(f"/admin/players/{HAZEL}/sessions", params={"before": "junk"}).status_code == 400


def test_unknown_player_sections_are_empty(app, env, world, monkeypatch):
    c = client(app, staff(env))
    body = c.get(f"/admin/players/{ROSTER_ONLY}/sessions").json()
    assert body == {"sessions": [], "next": None, "coreprotect": {"status": "available"}}
    monkeypatch.setenv("COREPROTECT_DB", str(env.DATA_DIR / "nowhere.db"))
    body = c.get(f"/admin/players/{HAZEL}/activity").json()
    assert body["coreprotect"] == {"status": "unavailable", "reason": "missing"}


def message_audits(db):
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM admin_audit WHERE action = 'player.messages.view' ORDER BY id")]


def test_mods_never_see_messages(app, env, world, coreprotect):
    coreprotect.chat(world["hazel"], 170, "a private chat line")
    c = client(app, staff(env, "mod"))
    feed = c.get(f"/admin/players/{HAZEL}/activity").json()
    assert feed["shows_messages"] is False
    assert "chat" not in feed["kinds"]
    assert "private" not in str(feed)
    assert [e["target"] for e in feed["entries"] if e["kind"] == "command"] == ["/msg"]
    assert c.get(f"/admin/players/{HAZEL}/activity", params={"kinds": "chat"}).status_code == 400
    assert message_audits(env) == []


@pytest.mark.parametrize("role", ["admin", "root"])
def test_admins_see_chat_and_whole_commands_and_it_is_audited(app, env, world, coreprotect, role):
    coreprotect.chat(world["hazel"], 170, "meet at the docks")
    coreprotect.chat(world["hazel"], 180, "x" * 600)
    _, token = account(env, f"boss-{role}", role)
    feed = client(app, token).get(f"/admin/players/{HAZEL}/activity").json()
    assert feed["shows_messages"] is True
    assert "chat" in feed["kinds"]
    chats = [e for e in feed["entries"] if e["kind"] == "chat"]
    assert [(c["verb"], c["message"][:17], c["truncated"]) for c in chats] == [
        ("said", "x" * 17, True), ("said", "meet at the docks", False)]
    assert len(chats[0]["message"]) == 512
    assert [e["target"] for e in feed["entries"] if e["kind"] == "command"] == ["/msg Bob a private thing"]

    rows = message_audits(env)
    assert len(rows) == 1
    assert rows[0]["actor_role"] == role
    assert rows[0]["outcome"] == "ok"
    assert rows[0]["reason"] is None
    detail = json.loads(rows[0]["detail_json"])
    assert detail["player_uuid"] == HAZEL and detail["rows"] == 3 and detail["paged"] is False
    assert detail["newest"]["time"] == 180 and detail["oldest"]["time"] == 160
    # The audit records which rows were shown, never what they said.
    assert "docks" not in rows[0]["detail_json"] and "private" not in rows[0]["detail_json"]


def test_pages_without_messages_are_not_audited(app, env, world):
    _, token = account(env, "boss", "admin")
    feed = client(app, token).get(f"/admin/players/{HAZEL}/activity", params={"kinds": "block,session"}).json()
    assert feed["entries"]
    assert message_audits(env) == []


def test_no_audit_no_messages(app, env, world, monkeypatch):
    _, token = account(env, "boss", "admin")

    def broken(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(players.audit, "record", broken)
    response = client(app, token).get(f"/admin/players/{HAZEL}/activity")
    assert response.status_code == 503
    assert response.json()["detail"] == "audit_unavailable"
    assert "private" not in response.text
