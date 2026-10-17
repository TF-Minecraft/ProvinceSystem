import json
import re

import pytest
from fastapi import FastAPI

from src import database
from src.api import admin_routes, auth_routes
from src.auth import players, testing
from src.skins import testing as skins_testing
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
def env(database, postgres, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    return database


def link(db, player_uuid, discord_id, mc_name, discord_name):
    skins_testing.link(player_uuid, discord_id, mc_name, discord_name, linked_at="2026-09-20T10:00:00Z")


def character(db, player_uuid, name, realm="main", status="alive", character_id=None):
    testing.execute(
        "INSERT INTO character_roster (player_uuid, realm_id, character_id, name, status, race, class, "
        "updated_at) VALUES (%s, %s, %s, %s, %s, 'human', 'smith', '2026-09-21T10:00:00Z')",
        (player_uuid, realm, character_id or f"c-{name}", name, status))


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
    assert client(app).get(f"/admin/players/{HAZEL}").status_code == 401
    assert client(app, staff(env, "player")).get("/admin/players").status_code == 403
    assert client(app, staff(env, "player")).get(f"/admin/players/{HAZEL}").status_code == 403
    assert client(app, staff(env, "player")).get(f"/admin/players/{HAZEL}/activity").status_code == 403
    assert client(app, staff(env, "mod")).get("/admin/players").status_code == 200


def rows(c, **params):
    return c.get("/admin/players", params=params).json()["rows"]


def test_directory_merges_every_source(app, env, world):
    body = client(app, staff(env)).get("/admin/players").json()
    assert (body["view"], body["sort"], body["order"]) == ("minecraft", "name", "asc")
    assert body["coreprotect"] == {"status": "available", "server_label": "Vardera"}
    assert body["omitted"] == 0
    by_uuid = {p["uuid"]: p for p in body["rows"]}
    assert set(by_uuid) == {HAZEL, LINKED_ONLY, ROSTER_ONLY, "33333333-3333-3333-3333-333333333333"}
    assert by_uuid[HAZEL]["minecraft_name"] == "MrEnzo99"
    assert by_uuid[HAZEL]["aliases"] == ["OldEnzo"]
    assert by_uuid[HAZEL]["discord_username"] == "hazelstone"
    assert by_uuid[HAZEL]["characters"] == ["Hazel Stonebrook"]
    assert by_uuid[HAZEL]["last_seen"] == 200
    assert by_uuid[LINKED_ONLY]["minecraft_name"] == "LinkedOnly"
    assert by_uuid[ROSTER_ONLY]["minecraft_name"] is None


def test_directory_lists_only_this_servers_characters(app, env, world):
    character(env, HAZEL, "Tutorial Hazel", realm="tutorial")
    character(env, "44444444-4444-4444-4444-444444444444", "Only On Tutorial", realm="tutorial")
    c = client(app, staff(env))
    by_uuid = {p["uuid"]: p for p in rows(c)}
    assert by_uuid[HAZEL]["characters"] == ["Hazel Stonebrook"]
    assert "44444444-4444-4444-4444-444444444444" not in by_uuid
    assert [r["character"]["name"] for r in rows(c, view="character")] == ["Aldric", "Hazel Stonebrook"]
    assert rows(c, q="tutorial") == []


@pytest.mark.parametrize("query", ["oldenzo", "HAZELSTONE", "@hazelstone", "stonebrook", HAZEL,
                                   HAZEL.replace("-", ""), "422545450919526411"])
def test_directory_search(app, env, world, query):
    for view in ("minecraft", "discord"):
        body = client(app, staff(env)).get("/admin/players", params={"q": query, "view": view}).json()
        assert [p["uuid"] for p in body["rows"]] == [HAZEL]


def test_directory_views(app, env, world):
    c = client(app, staff(env))
    assert [p["minecraft_name"] for p in rows(c, view="minecraft")] == ["LinkedOnly", "MrEnzo99", "Quiet", None]
    # Linked players only; the rest are counted.
    body = c.get("/admin/players", params={"view": "discord"}).json()
    assert [p["discord_username"] for p in body["rows"]] == ["hazelstone", "linky"]
    assert (body["total"], body["omitted"]) == (2, 2)
    body = c.get("/admin/players", params={"view": "character"}).json()
    assert [(r["character"]["name"], r["player"]["uuid"]) for r in body["rows"]] == [
        ("Aldric", ROSTER_ONLY), ("Hazel Stonebrook", HAZEL)]
    assert body["rows"][0]["character"] == {
        "character_id": "c-Aldric", "name": "Aldric", "status": "alive", "race": "human", "class": "smith"}
    assert (body["total"], body["omitted"]) == (2, 2)
    assert c.get("/admin/players", params={"view": "bogus"}).status_code == 400
    assert c.get("/admin/players", params={"view": "activity"}).status_code == 400
    assert c.get("/admin/players", params={"sort": "bogus"}).status_code == 400
    assert c.get("/admin/players", params={"order": "bogus"}).status_code == 400
    assert c.get("/admin/players", params={"q": "x" * 65}).status_code == 400


def test_character_view_has_a_row_per_character(app, env, world):
    character(env, HAZEL, "Bramble", status="DEAD")
    character(env, HAZEL, "Aldric", character_id="c-other-aldric")
    c = client(app, staff(env))
    found = rows(c, view="character")
    # Same-named characters stay apart, in a stable order.
    assert [(r["character"]["name"], r["player"]["uuid"]) for r in found] == [
        ("Aldric", HAZEL), ("Aldric", ROSTER_ONLY), ("Bramble", HAZEL), ("Hazel Stonebrook", HAZEL)]
    assert found[2]["character"]["status"] == "dead"
    # Searching a character finds that character, not their siblings; searching the player finds all of theirs.
    assert [r["character"]["name"] for r in rows(c, view="character", q="bramble")] == ["Bramble"]
    assert len(rows(c, view="character", q="hazelstone")) == 3
    body = c.get("/admin/players", params={"view": "character", "q": "quiet"}).json()
    assert (body["rows"], body["omitted"]) == ([], 1)


@pytest.mark.parametrize(("view", "sort", "order", "expected"), [
    ("minecraft", "name", "desc", ["Quiet", "MrEnzo99", "LinkedOnly", None]),
    # Most recent first; never seen last, by name.
    ("minecraft", "last_seen", "desc", ["MrEnzo99", "Quiet", "LinkedOnly", None]),
    ("minecraft", "last_seen", "asc", ["Quiet", "MrEnzo99", "LinkedOnly", None]),
    ("discord", "name", "desc", ["LinkedOnly", "MrEnzo99"]),
    ("discord", "last_seen", "desc", ["MrEnzo99", "LinkedOnly"]),
])
def test_directory_sorts(app, env, world, view, sort, order, expected):
    c = client(app, staff(env))
    assert [p["minecraft_name"] for p in rows(c, view=view, sort=sort, order=order)] == expected


def test_character_view_sorts_by_player_last_seen(app, env, world):
    character(env, "33333333-3333-3333-3333-333333333333", "Zed")
    c = client(app, staff(env))
    found = rows(c, view="character", sort="last_seen", order="desc")
    assert [r["character"]["name"] for r in found] == ["Hazel Stonebrook", "Zed", "Aldric"]
    found = rows(c, view="character", sort="name", order="desc")
    assert [r["character"]["name"] for r in found] == ["Zed", "Hazel Stonebrook", "Aldric"]


def test_directory_sorts_across_pages(app, env, world, monkeypatch):
    monkeypatch.setattr(players, "PAGE_SIZE", 1)
    c = client(app, staff(env))
    seen = [rows(c, sort="last_seen", order="desc", page=page)[0]["minecraft_name"] for page in (1, 2, 3, 4)]
    assert seen == ["MrEnzo99", "Quiet", "LinkedOnly", None]


def test_directory_pages_each_view(app, env, world, monkeypatch):
    monkeypatch.setattr(players, "PAGE_SIZE", 1)
    c = client(app, staff(env))
    second = c.get("/admin/players", params={"view": "character", "page": 2}).json()
    assert [r["character"]["name"] for r in second["rows"]] == ["Hazel Stonebrook"]
    assert (second["total"], second["page"]) == (2, 2)
    assert c.get("/admin/players", params={"view": "character", "page": 3}).json()["rows"] == []


def test_directory_without_coreprotect(app, env, world, monkeypatch):
    monkeypatch.setenv("COREPROTECT_DB", str(env.DATA_DIR / "nowhere.db"))
    body = client(app, staff(env)).get("/admin/players").json()
    assert body["coreprotect"]["status"] == "unavailable"
    assert body["coreprotect"]["reason"] == "missing"
    assert {p["uuid"] for p in body["rows"]} == {HAZEL, LINKED_ONLY, ROSTER_ONLY}


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
    assert body["characters"][0]["updated_at"] == "2026-09-21T10:00:00Z"
    assert body["coreprotect"]["status"] == "available"


def test_profile_includes_the_shared_character_sheet_in_each_realm(app, env, world):
    from src.characters.roster import replace_roster

    replace_roster(HAZEL, [{
        "id": "same-id", "name": "Hazel Stonebrook", "status": "ALIVE", "race": "human", "class": "smith",
        "race_name": "Human", "class_name": "Smith", "age": "34", "description": "A traveller in green.",
        "background": "Raised in the woods.", "attributes": {"strength": 4},
        "experience_modifiers": [{"profession": "smith", "alias": "Smith Experience", "amount": 10}],
        "traits": [{"id": "patient", "name": "Patient", "key": "personality"}],
        "clues": ["Carries a red banner."], "kit_status": "granted",
    }], realm_id="main")
    replace_roster(HAZEL, [{"id": "same-id", "name": "Tutorial Hazel", "status": "ALIVE"}], realm_id="tutorial")
    body = client(app, staff(env)).get(f"/admin/players/{HAZEL}").json()
    main, tutorial = body["characters"]
    assert main["id"] == main["character_id"] == tutorial["id"] == "same-id"
    assert (main["realm_id"], tutorial["realm_id"]) == ("main", "tutorial")
    assert main["race_name"] == "Human"
    assert main["class_name"] == "Smith"
    assert main["description"] == "A traveller in green."
    assert main["attributes"] == {"strength": 4}
    assert main["experience_modifiers"][0]["amount"] == 10
    assert main["traits"][0]["name"] == "Patient"
    assert main["clues"] == ["Carries a red banner."]
    assert main["kit_status"] == "granted"
    assert "description" not in tutorial


@pytest.mark.parametrize("kind,size", [("face", (8, 8)), ("figure", (16, 32))])
@pytest.mark.parametrize("status", ["ALIVE", "DEAD", "MISSING"])
def test_character_pictures_require_staff_and_read_the_requested_realm(app, env, world, monkeypatch, kind, size, status):
    import io
    from PIL import Image
    from src.characters import wardrobe

    monkeypatch.setattr(wardrobe, "DATA_DIR", env.DATA_DIR)
    monkeypatch.setattr(wardrobe, "WARDROBE_DIR", env.DATA_DIR / "wardrobe")
    monkeypatch.setattr(wardrobe, "swappable_slot_count", lambda *args, **kwargs: 2)
    cid = "c-Hazel Stonebrook"
    character(env, HAZEL, "Tutorial Hazel", realm="tutorial", character_id=cid)
    with database.connect() as conn:
        conn.execute("UPDATE character_roster SET status = %s WHERE player_uuid = %s AND character_id = %s",
                     (status, HAZEL, cid))
        conn.execute("UPDATE character_roster SET wardrobe_active_slot = CASE realm_id "
                     "WHEN 'tutorial' THEN 'extra_1' ELSE 'base' END WHERE player_uuid = %s", (HAZEL,))
        for slot, colour in [("base", (10, 20, 30, 255)), ("extra_1", (40, 50, 60, 255))]:
            rel = f"wardrobe/{HAZEL}/{cid}/{slot}.png"
            path = env.DATA_DIR / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGBA", (64, 64), colour).save(path)
            conn.execute("INSERT INTO character_wardrobe_slots "
                         "(player_uuid, character_id, slot, png_relpath, updated_at) VALUES (%s, %s, %s, %s, now())",
                         (HAZEL, cid, slot, rel))
    before = testing.rows("SELECT * FROM character_wardrobe_slots ORDER BY slot")
    path = f"/admin/players/{HAZEL}/characters/{cid}/{kind}"
    assert client(app).get(path).status_code == 401
    assert client(app, staff(env, "player")).get(path).status_code == 403
    c = client(app, staff(env))
    for realm, expected in [("main", (10, 20, 30, 255)), ("tutorial", (40, 50, 60, 255))]:
        res = c.get(path, params={"realm_id": realm})
        assert res.status_code == 200, res.text
        assert res.headers["content-type"] == "image/png"
        assert "no-store" in res.headers["cache-control"]
        png = Image.open(io.BytesIO(res.content))
        assert png.size == size
        assert png.getpixel((4, 4)) == expected
    assert c.get(path, params={"realm_id": "missing"}).status_code == 404
    assert c.get(path.replace(HAZEL, LINKED_ONLY)).status_code == 404
    assert c.get(path.replace(HAZEL, "not-a-uuid")).status_code == 400
    assert c.get(path.replace(cid, "missing")).status_code == 404
    assert testing.rows("SELECT * FROM character_wardrobe_slots ORDER BY slot") == before
    assert testing.value("SELECT wardrobe_active_slot FROM character_roster "
                         "WHERE realm_id = 'tutorial' AND character_id = %s", (cid,)) == "extra_1"
    if status != "ALIVE":
        with pytest.raises(wardrobe.WardrobeError, match="Character is not alive") as error:
            wardrobe.get_wardrobe(HAZEL, cid)
        assert error.value.status_code == 403


@pytest.mark.parametrize("kind", ["face", "figure"])
def test_character_picture_accepts_slashes_in_ids(app, env, world, monkeypatch, kind):
    from unittest.mock import Mock

    cid = "realm/character"
    character(env, HAZEL, "Slash Character", character_id=cid)
    render = Mock(return_value=b"png")
    monkeypatch.setattr(players, f"active_{kind}_png", render)
    path = f"/admin/players/{HAZEL}/characters/realm%2Fcharacter/{kind}"
    res = client(app, staff(env)).get(path)
    assert res.status_code == 200
    assert res.content == b"png"
    render.assert_called_once_with(HAZEL, cid, realm_id="main")


def test_character_picture_without_a_skin_and_staff_catalog(app, env, world):
    path = f"/admin/players/{HAZEL}/characters/c-Hazel Stonebrook"
    c = client(app, staff(env))
    for kind in ("face", "figure"):
        assert c.get(f"{path}/{kind}").status_code == 404
        assert c.get(f"{path}/{kind}").json()["detail"] == f"no_{kind}"
    assert c.get(f"{path}/wardrobe").status_code == 404
    catalog_path = "/admin/characters/creation-catalog"
    assert client(app).get(catalog_path).status_code == 401
    assert client(app, staff(env, "player")).get(catalog_path).status_code == 403
    res = c.get(catalog_path)
    assert res.status_code == 200
    assert "no-store" in res.headers["cache-control"]
    assert "validation" in res.json()


def test_profile_shows_the_website_account(app, env, world):
    token = staff(env, "admin")
    staff_discord_id = testing.value("SELECT discord_user_id FROM users LIMIT 1")
    testing.execute("UPDATE discord_links SET discord_user_id = %s WHERE player_uuid = %s", (staff_discord_id, HAZEL))
    body = client(app, token).get(f"/admin/players/{HAZEL}").json()
    assert body["account"]["role"] == "admin"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["account"]["created_at"])
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["account"]["last_login_at"])


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
    assert body["coreprotect"] == {"status": "unavailable", "reason": "missing",
                                   "server_label": "Vardera", "map_world": "TFMC_Map"}


def message_audits(db):
    return testing.rows("SELECT * FROM admin_audit WHERE action = 'player.messages.view' ORDER BY id")


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
    detail = rows[0]["detail"]
    assert detail["player_uuid"] == HAZEL and detail["rows"] == 3 and detail["paged"] is False
    assert detail["newest"]["time"] == 180 and detail["oldest"]["time"] == 160
    # The audit records which rows were shown, never what they said.
    assert "docks" not in json.dumps(rows[0]["detail"]) and "private" not in json.dumps(rows[0]["detail"])


def test_channel_commands_are_chat_for_admins_and_a_channel_name_for_mods(app, env, world, coreprotect):
    hazel = world["hazel"]
    coreprotect.command(hazel, 171, "/looc where is the beagle")
    coreprotect.command(hazel, 172, "/RPCharacters:FOOC raid at dusk")
    coreprotect.command(hazel, 173, "/me waves")
    coreprotect.command(hazel, 174, "/home")
    _, token = account(env, "boss", "admin")
    feed = client(app, token).get(f"/admin/players/{HAZEL}/activity").json()
    said = [(e["kind"], e["channel"], e["message"]) for e in feed["entries"] if e["kind"] == "chat"]
    assert said == [("chat", "Emote", "waves"), ("chat", "FOOC", "raid at dusk"), ("chat", "LOOC", "where is the beagle")]
    assert [e["target"] for e in feed["entries"] if e["kind"] == "command"] == ["/home", "/msg Bob a private thing"]
    only_chat = client(app, token).get(f"/admin/players/{HAZEL}/activity", params={"kinds": "chat"}).json()
    assert [e["channel"] for e in only_chat["entries"]] == ["Emote", "FOOC", "LOOC"]
    assert message_audits(env)[0]["detail"]["rows"] == 5

    mod = client(app, staff(env, "mod")).get(f"/admin/players/{HAZEL}/activity").json()
    commands = [(e["target"], e["channel"]) for e in mod["entries"] if e["kind"] == "command"]
    assert commands == [("/home", None), ("/me", "Emote"), ("/RPCharacters:FOOC", "FOOC"), ("/looc", "LOOC"), ("/msg", None)]
    assert "beagle" not in str(mod) and "dusk" not in str(mod) and "waves" not in str(mod)


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


def test_oversized_cursor_values_are_refused(app, env, world):
    from src.coreprotect import cursors

    c = client(app, staff(env))
    huge = cursors.encode("main", f"sessions:{HAZEL}", 10 ** 30, 1)
    assert c.get(f"/admin/players/{HAZEL}/sessions", params={"before": huge}).status_code == 400



def movement_audits(db):
    return testing.rows("SELECT * FROM admin_audit WHERE action = 'player.movement.view' ORDER BY id")


@pytest.mark.parametrize("role", ["admin", "root"])
def test_movement_routes_are_audited(app, env, world, coreprotect, role):
    coreprotect.session(world["hazel"], 160, 2, x=42)
    _, token = account(env, f"boss-{role}", role)
    c = client(app, token)
    body = c.get(f"/admin/players/{HAZEL}/movement", params={"since": 50, "until": 300}).json()
    assert [p[0] for p in body["points"]] == [100, 160, 200]
    assert body["points"][1][2] == 42
    assert body["worlds"] == ["TFMC_Map"]
    assert body["complete_from"] == 50
    assert body["coreprotect"]["status"] == "available"
    assert body["coreprotect"]["map_world"] == "TFMC_Map"
    assert (body["since"], body["until"]) == (50, 300)

    body = c.get("/admin/movement", params={"since": 0, "until": 300}).json()
    assert {p["minecraft_name"] for p in body["players"]} == {"MrEnzo99", "Quiet"}

    rows = movement_audits(env)
    assert [r["detail"]["player_uuid"] for r in rows] == [HAZEL, "everyone"]
    detail = rows[0]["detail"]
    assert (detail["since"], detail["until"], detail["rows"]) == (50, 300, 3)
    # Which window and how much, never where.
    assert set(detail) == {"server", "player_uuid", "since", "until", "complete_from", "rows"}
    assert rows[0]["actor_role"] == role


def test_movement_matches_uuids_in_any_case(app, env, world, coreprotect):
    upper = "44444444-AAAA-4BBB-8CCC-DDDDDDDDDDDD"
    shouty = coreprotect.user("Shouty", upper)
    coreprotect.session(shouty, 120, 2, x=9)
    _, token = account(env, "boss", "admin")
    body = client(app, token).get(f"/admin/players/{upper.lower()}/movement", params={"since": 50, "until": 300}).json()
    assert [p[0] for p in body["points"]] == [120]


def test_session_movement(app, env, world, coreprotect):
    coreprotect.session(world["hazel"], 160, 2, x=42)
    _, token = account(env, "boss", "admin")
    c = client(app, token)
    listed = c.get(f"/admin/players/{HAZEL}/sessions").json()["sessions"]
    assert len(listed) == 1 and listed[0]["id"] and "key" not in listed[0]
    sid = listed[0]["id"]
    body = c.get(f"/admin/players/{HAZEL}/sessions/{sid}/movement").json()
    assert body["session"]["id"] == sid
    assert body["session"]["end_kind"] == "logout"
    assert body["session"]["last_observed"]["time"] == 200
    assert (body["since"], body["until"]) == (100, 200)
    assert [p[0] for p in body["points"]] == [100, 160, 200]
    assert body["as_of"] > 0
    detail = movement_audits(env)[-1]["detail"]
    assert detail["session"] == sid and detail["rows"] == 3

    # Another player's session id, a forged one, and a mod are all refused.
    other = "33333333-3333-3333-3333-333333333333"
    assert c.get(f"/admin/players/{other}/sessions/{sid}/movement").status_code == 400
    assert c.get(f"/admin/players/{HAZEL}/sessions/nonsense/movement").status_code == 400
    from src.coreprotect import cursors
    forged = cursors.encode("main", f"session:{HAZEL}", 160, 1)
    gone = c.get(f"/admin/players/{HAZEL}/sessions/{forged}/movement")
    assert gone.status_code == 404 and gone.json()["detail"] == "session_gone"
    assert client(app, staff(env, "mod")).get(f"/admin/players/{HAZEL}/sessions/{sid}/movement").status_code == 403


def test_movement_is_for_admins(app, env, world):
    c = client(app, staff(env, "mod"))
    assert c.get(f"/admin/players/{HAZEL}/movement").status_code == 403
    assert c.get("/admin/movement").status_code == 403
    assert movement_audits(env) == []


def test_movement_bad_windows(app, env, world):
    _, token = account(env, "boss", "admin")
    c = client(app, token)
    for path, params in [
        (f"/admin/players/{HAZEL}/movement", {"since": 300, "until": 50}),
        (f"/admin/players/{HAZEL}/movement", {"since": 0, "until": 8 * 86_400}),
        ("/admin/movement", {"since": 0, "until": 2 * 86_400}),
        # In the future, and beyond SQLite's integers.
        ("/admin/movement", {"until": 2 ** 39}),
        ("/admin/movement", {"since": 10 ** 30, "until": 10 ** 30 + 3600}),
    ]:
        assert c.get(path, params=params).status_code in (400, 422), (path, params)
    assert c.get("/admin/players/not-a-uuid/movement").status_code == 400
    assert movement_audits(env) == []


def test_no_audit_no_movement(app, env, world, monkeypatch):
    _, token = account(env, "boss", "admin")

    def broken(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(players.audit, "record", broken)
    response = client(app, token).get(f"/admin/players/{HAZEL}/movement", params={"since": 50, "until": 300})
    assert response.status_code == 503
    assert response.json()["detail"] == "audit_unavailable"


def test_movement_without_coreprotect(app, env, world, monkeypatch):
    monkeypatch.setenv("COREPROTECT_DB", str(env.DATA_DIR / "nowhere.db"))
    _, token = account(env, "boss", "admin")
    c = client(app, token)
    body = c.get(f"/admin/players/{HAZEL}/movement").json()
    assert body["points"] == [] and body["coreprotect"]["reason"] == "missing"
    body = c.get("/admin/movement").json()
    assert body["players"] == [] and body["coreprotect"]["reason"] == "missing"


def test_profile_asks_discord_for_an_unknown_handle(app, env, world, monkeypatch):
    from src.auth import discord_names

    asked = []

    def refresh_one(discord_id):
        asked.append(discord_id)
        testing.execute("UPDATE discord_links SET discord_username = 'linky_handle', discord_nickname = 'Linky' "
                        "WHERE discord_user_id = %s", (discord_id,))
        return True

    monkeypatch.setattr(discord_names, "refresh_one", refresh_one)
    testing.execute("UPDATE discord_links SET discord_username = NULL WHERE player_uuid = %s", (LINKED_ONLY,))
    body = client(app, staff(env)).get(f"/admin/players/{LINKED_ONLY}").json()
    assert asked == ["500000000000000001"]
    assert body["discord"]["discord_username"] == "linky_handle"
    assert body["discord"]["discord_nickname"] == "Linky"
    # A known handle is not looked up.
    client(app, staff(env)).get(f"/admin/players/{HAZEL}")
    assert asked == ["500000000000000001"]
