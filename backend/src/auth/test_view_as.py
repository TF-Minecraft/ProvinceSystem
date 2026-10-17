import re
import sqlite3
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import admin_routes, auth_routes
from src.api.view_as_guard import ViewAsGuard
from src.auth import roles, testing, users, view_as
from src.skins.testing import link

SITE = "https://www.tfminecraft.net"
ORIGIN = {"Origin": SITE}
SESSION = "__Host-tfmc_session"
STAFF = "__Host-tfmc_staff_session"
DOMAIN = "testserver.local"
UUID = "0f6c5a52-3b7e-4c39-9d1d-2a8f0e7b9c11"


@pytest.fixture
def env(database, postgres, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", SITE)
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    monkeypatch.delenv("PATREON_ENABLED", raising=False)
    return database


@pytest.fixture
def app(env):
    app = FastAPI()
    app.include_router(auth_routes.auth_router)
    admin_routes.install(app)

    @app.post("/characters/anything")
    def write():
        return {"ok": True}

    app.add_middleware(ViewAsGuard)
    return app


def account(db, name, role="player", minecraft=None):
    """Create a signed-in account; return (user_id, session token)."""
    discord_id = str(100000000000000000 + abs(hash(name)) % 10**15)
    token = users.sign_in(
        {"discord_user_id": discord_id, "discord_username": name, "discord_global_name": name.title(),
         "discord_avatar": None},
        guild_member=True,
    )
    user_id = testing.set_role(discord_id, role)
    if minecraft:
        link(UUID, discord_id, minecraft, name, linked_at="2026-10-01T00:00:00Z")
    return user_id, token


def client(app, token=None):
    c = TestClient(app, base_url="https://testserver")
    if token:
        c.cookies.set(SESSION, token, domain=DOMAIN)
    return c


def cookie(c, name):
    return c.cookies.get(name, domain=DOMAIN)


def audit_rows(db):
    return testing.audit_rows()


def linked_uuid(db, user_id):
    """The Minecraft UUID linked to this account, linking one first if it has none."""
    discord_id = testing.value("SELECT discord_user_id FROM users WHERE id = %s", (user_id,))
    linked = testing.value("SELECT player_uuid FROM discord_links WHERE discord_user_id = %s", (discord_id,))
    if linked:
        return linked
    player_uuid = str(uuid.uuid5(uuid.NAMESPACE_OID, discord_id))
    link(player_uuid, discord_id, linked_at="2026-10-01T00:00:00Z")
    return player_uuid


def start(app, db, admin_token, player_id):
    c = client(app, admin_token)
    res = c.post(f"/admin/players/{linked_uuid(db, player_id)}/view-as", headers=ORIGIN)
    return c, res


def link_only(db, name, player_uuid=UUID):
    """A player linked through the Discord bot who has never signed in to the site."""
    discord_id = str(200000000000000000 + abs(hash(name)) % 10**15)
    link(player_uuid, discord_id, name.title(), name, linked_at="2026-10-01T00:00:00Z")
    return discord_id


def placeholders(db):
    return testing.value("SELECT COUNT(*) FROM users WHERE placeholder")


def test_only_admins_may_view_as():
    assert roles.can("admin", "view_as_player") and roles.can("root", "view_as_player")
    assert not roles.can("mod", "view_as_player") and not roles.can("player", "view_as_player")


def test_admin_views_the_site_as_a_player(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve", minecraft="Steve")
    c, res = start(app, env, admin_token, player_id)
    assert res.status_code == 200
    assert res.json()["return_to"] == "/profile"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", res.json()["expires_at"])
    view_cookie = next(h for h in res.headers.get_list("set-cookie") if h.startswith(SESSION + "="))
    assert re.search(r"Max-Age=(17\d\d|1800);", view_cookie)
    assert cookie(c, STAFF) == admin_token
    view_token = cookie(c, SESSION)
    assert view_token and view_token != admin_token

    me = c.get("/account").json()
    assert me["user"]["discord_username"] == "steve"
    assert me["user"]["role"] == "player"
    assert me["viewing_as"]["staff_name"] == "boss"
    assert c.get("/admin/me").status_code == 403

    started = audit_rows(env)[-1]
    assert (started["action"], started["outcome"], started["actor_name"], started["target_name"]) == (
        "account.view_as.start", "ok", "boss", "steve")


@pytest.mark.parametrize(("actor_role", "target_role", "status", "code"), [
    ("mod", "player", 403, "forbidden"),
    ("admin", "mod", 403, "target_is_staff"),
    ("root", "admin", 403, "target_is_staff"),
])
def test_refusals_are_audited(app, env, actor_role, target_role, status, code):
    _, actor_token = account(env, "actor", actor_role)
    target_id, _ = account(env, "target", target_role)
    c, res = start(app, env, actor_token, target_id)
    assert (res.status_code, res.json()["detail"]) == (status, code)
    assert cookie(c, STAFF) is None
    row = audit_rows(env)[-1]
    assert row["action"] == "account.view_as.start" and row["outcome"] == "denied"


def test_cannot_view_as_self_or_nobody(app, env):
    admin_id, admin_token = account(env, "boss", "admin")
    assert start(app, env, admin_token, admin_id)[1].json()["detail"] == "cannot_act_on_self"
    res = client(app, admin_token).post(f"/admin/players/{UUID}/view-as", headers=ORIGIN)
    assert (res.status_code, res.json()["detail"]) == (404, "not_linked")
    res = client(app, admin_token).post("/admin/players/not-a-uuid/view-as", headers=ORIGIN)
    assert (res.status_code, res.json()["detail"]) == (400, "bad_uuid")


def test_start_needs_the_sites_origin(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    res = client(app, admin_token).post(f"/admin/players/{linked_uuid(env, player_id)}/view-as",
                                        headers={"Origin": "https://evil.example"})
    assert res.status_code == 403


def test_a_view_cannot_write(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve", minecraft="Steve")
    c, _ = start(app, env, admin_token, player_id)
    for path in ("/account/minecraft/unlink", "/account/patreon/start", "/characters/anything",
                 f"/admin/players/{UUID}/view-as"):
        res = c.post(path, headers=ORIGIN)
        assert (res.status_code, res.json()["detail"]) == (403, "viewing_as_player"), path


def test_profile_opened_during_a_view_is_view_only(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, player_token = account(env, "steve", minecraft="Steve")
    c, _ = start(app, env, admin_token, player_id)
    profile = c.post("/account/profile-session", headers=ORIGIN).json()
    assert profile["player_uuid"] == UUID
    assert profile["expires_at"] == c.get("/account").json()["viewing_as"]["expires_at"]

    bare = TestClient(app, base_url="https://testserver")
    auth = {"Authorization": f"Bearer {profile['session_token']}"}
    assert bare.post("/characters/anything", headers=auth).json()["detail"] == "viewing_as_player"
    assert bare.get("/ping-free-route", headers=auth).status_code == 404  # reads pass the guard

    # The player's own Profile session still writes.
    own = client(app, player_token).post("/account/profile-session", headers=ORIGIN).json()
    assert bare.post("/characters/anything", headers={"Authorization": f"Bearer {own['session_token']}"}).json() == {
        "ok": True}

    # Leaving the view ends its Profile session too.
    c.post("/auth/view-as/stop", headers=ORIGIN)
    assert _view_profiles(env) == 0


def test_stop_puts_the_admin_back(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve", minecraft="Steve")
    c, _ = start(app, env, admin_token, player_id)
    view_token = cookie(c, SESSION)
    res = c.post("/auth/view-as/stop", headers=ORIGIN)
    assert res.json() == {"restored": True, "return_to": f"/admin/players/{UUID}"}
    assert cookie(c, SESSION) == admin_token
    assert cookie(c, STAFF) is None
    assert users.session_user(view_token) is None
    assert c.get("/admin/me").json()["discord_username"] == "boss"
    stopped = audit_rows(env)[-1]
    assert (stopped["action"], stopped["actor_name"], stopped["target_name"]) == ("account.view_as.stop", "boss", "steve")


def test_stop_when_not_viewing_changes_nothing(app, env):
    _, token = account(env, "steve")
    c = client(app, token)
    c.cookies.set(STAFF, "leftover", domain=DOMAIN)
    res = c.post("/auth/view-as/stop", headers=ORIGIN)
    assert (res.status_code, res.json()["detail"]) == (409, "not_viewing")
    assert cookie(c, SESSION) == token
    assert cookie(c, STAFF) is None


def test_stop_never_restores_someone_elses_session(app, env):
    _, admin_token = account(env, "boss", "admin")
    _, other_token = account(env, "other", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    c.cookies.set(STAFF, other_token, domain=DOMAIN)
    res = c.post("/auth/view-as/stop", headers=ORIGIN)
    assert res.json()["restored"] is False
    assert cookie(c, SESSION) is None


def test_a_view_that_ran_out_hands_back_on_the_next_account_load(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    testing.expire_views()
    me = c.get("/account")
    assert me.status_code == 200
    assert me.json()["user"]["discord_username"] == "boss" and me.json()["viewing_as"] is None
    assert cookie(c, SESSION) == admin_token and cookie(c, STAFF) is None
    assert audit_rows(env)[-1]["action"] == "account.view_as.stop"


def test_signed_out_without_a_view_is_still_401(app, env):
    assert client(app).get("/account").status_code == 401
    c = client(app)
    c.cookies.set(STAFF, "not-a-session", domain=DOMAIN)
    assert c.get("/account").status_code == 401
    assert cookie(c, STAFF) is None


def test_signing_out_during_a_view_signs_the_admin_out(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    view_token = cookie(c, SESSION)
    assert c.post("/auth/logout", headers=ORIGIN).status_code == 200
    assert users.session_user(view_token) is None and users.session_user(admin_token) is None


def test_demoting_the_admin_ends_their_views(app, env):
    _, root_token = account(env, "owner", "root")
    admin_id, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    view_token = cookie(c, SESSION)
    res = client(app, root_token).post(f"/admin/accounts/{admin_id}/role", headers=ORIGIN,
                                       json={"role": "player", "reason": "stepping down"})
    assert res.status_code == 200
    assert users.session_user(view_token) is None


def test_a_view_has_no_staff_rights_even_if_the_target_is_promoted(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    testing.execute("UPDATE users SET role = 'mod' WHERE id = %s", (player_id,))
    assert c.get("/admin/me").status_code == 403


def test_preview_sign_in_refuses_a_view(app, env, monkeypatch):
    monkeypatch.setenv("PREVIEW_SIGN_IN_DOMAIN", "tfminecraft.net")
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    res = c.get("/auth/preview/start", params={"site": "https://branch.tfminecraft.net", "state": "s" * 43},
                follow_redirects=False)
    assert (res.status_code, res.json()["detail"]) == (403, "viewing_as_player")


def test_migration_adds_acting_user_id(tmp_path, monkeypatch):
    from src.skins import db
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL, guild_member INTEGER NOT NULL DEFAULT 0,
            guild_checked_at TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    """)
    old.commit()
    old.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for name in ("SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    db.migrate()
    db.migrate()
    with db.connect() as conn:
        assert "acting_user_id" in {r["name"] for r in conn.execute("PRAGMA table_info(user_sessions)")}


def test_profile_tag_only_inside_a_view():
    assert view_as.profile_minted_via({"acting_user_id": None, "session_id": 4}) is None
    assert view_as.profile_minted_via({"acting_user_id": 2, "session_id": 4}) == "staff_view:4"


def _expire_views(db):
    testing.expire_views()


def _view_profiles(db):
    return testing.value("SELECT COUNT(*) FROM sessions s JOIN codes c ON c.id = s.code_id "
                         "WHERE c.minted_via LIKE %s", ("staff_view:%",))


def test_a_view_whose_cookie_the_browser_dropped_is_still_ended_and_audited(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve", minecraft="Steve")
    c, _ = start(app, env, admin_token, player_id)
    c.post("/account/profile-session", headers=ORIGIN)
    _expire_views(env)
    c.cookies.delete(SESSION, domain=DOMAIN)
    res = c.post("/auth/view-as/stop", headers=ORIGIN)
    assert res.json() == {"restored": True, "return_to": f"/admin/players/{UUID}"}
    assert cookie(c, SESSION) == admin_token
    stopped = audit_rows(env)[-1]
    assert stopped["action"] == "account.view_as.stop" and stopped["detail_json"]["expired"] is True
    assert _view_profiles(env) == 0
    assert testing.value("SELECT COUNT(*) FROM user_sessions WHERE acting_user_id IS NOT NULL") == 0


def test_leaving_twice_is_harmless(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    assert c.post("/auth/view-as/stop", headers=ORIGIN).status_code == 200
    res = c.post("/auth/view-as/stop", headers=ORIGIN)
    assert (res.status_code, res.json()["detail"]) == (409, "not_viewing")
    assert cookie(c, SESSION) == admin_token


def test_revoking_the_admin_also_ends_profiles_opened_in_their_views(app, env):
    _, root_token = account(env, "owner", "root")
    admin_id, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve", minecraft="Steve")
    c, _ = start(app, env, admin_token, player_id)
    c.post("/account/profile-session", headers=ORIGIN)
    assert _view_profiles(env) == 1
    res = client(app, root_token).post(f"/admin/accounts/{admin_id}/sessions/revoke", headers=ORIGIN,
                                       json={"reason": "lost laptop"})
    assert res.status_code == 200
    assert _view_profiles(env) == 0


def test_signing_in_with_discord_during_a_view_ends_it(app, env, monkeypatch):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    view_token = cookie(c, SESSION)
    state, _url = users.start_sign_in(auth_routes._config(), "/account")
    c.cookies.set("__Host-tfmc_discord_state", state, domain=DOMAIN)
    monkeypatch.setattr(auth_routes, "_finish_sign_in", lambda config, code: users.sign_in(
        {"discord_user_id": "123456789012345678", "discord_username": "boss2", "discord_global_name": None,
         "discord_avatar": None}, guild_member=True))
    res = c.get("/auth/discord/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert res.status_code == 302
    assert users.session_user(view_token) is None
    assert users.session_user(admin_token) is None
    assert cookie(c, STAFF) is None
    assert audit_rows(env)[-1]["action"] == "account.view_as.stop"


def test_profile_is_not_opened_for_a_view_that_ended_mid_request(app, env):
    from src.skins import codes
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve", minecraft="Steve")
    c, _ = start(app, env, admin_token, player_id)
    view = users.session_user(cookie(c, SESSION))
    testing.execute("DELETE FROM user_sessions WHERE id = %s", (view["session_id"],))
    with pytest.raises(codes.CodeError, match="session_ended"):
        codes.start_linked_profile_session(UUID, minted_via=view_as.profile_minted_via(view),
                                           expires_at=view["expires_at"],
                                           still_allowed=view_as.view_still_open(view["session_id"]))
    assert testing.value("SELECT COUNT(*) FROM codes WHERE minted_via LIKE %s", ("staff_view:%",)) == 0


def test_signing_out_after_the_view_cookie_lapsed_still_ends_the_view(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    c, _ = start(app, env, admin_token, player_id)
    _expire_views(env)
    c.cookies.delete(SESSION, domain=DOMAIN)
    assert c.post("/auth/logout", headers=ORIGIN).status_code == 200
    assert users.session_user(admin_token) is None
    assert testing.value("SELECT COUNT(*) FROM user_sessions WHERE acting_user_id IS NOT NULL") == 0
    assert audit_rows(env)[-1]["action"] == "account.view_as.stop"


def test_starting_a_view_from_inside_one_is_refused_and_audited(app, env):
    _, admin_token = account(env, "boss", "admin")
    player_id, _ = account(env, "steve")
    other_id, _ = account(env, "alex")
    c, _ = start(app, env, admin_token, player_id)
    other_uuid = linked_uuid(env, other_id)
    res = c.post(f"/admin/players/{other_uuid}/view-as", headers=ORIGIN)
    assert (res.status_code, res.json()["detail"]) == (403, "viewing_as_player")
    row = audit_rows(env)[-1]
    assert (row["action"], row["outcome"], row["actor_name"]) == ("account.view_as.start", "conflict", "boss")
    assert row["detail_json"]["player_uuid"] == other_uuid


def test_a_player_who_never_signed_in_is_viewed_through_a_placeholder(app, env):
    from src.auth import admin, players
    _, admin_token = account(env, "boss", "admin")
    discord_id = link_only(env, "steve")
    c = client(app, admin_token)
    res = c.post(f"/admin/players/{UUID}/view-as", headers=ORIGIN)
    assert res.status_code == 200
    me = c.get("/account").json()
    assert me["user"]["discord_username"] == "steve" and me["viewing_as"]["staff_name"] == "boss"
    assert c.post("/characters/anything", headers=ORIGIN).json()["detail"] == "viewing_as_player"
    started = audit_rows(env)[-1]
    assert (started["action"], started["target_name"]) == ("account.view_as.start", "steve")
    assert started["detail_json"]["placeholder"] is True

    # Staff still see them as having no site account.
    assert placeholders(env) == 1
    assert players._site_rows(UUID)[0][0]["user_id"] is None
    assert admin.lookup(discord_id) == [] and admin.lookup("steve") == []

    assert c.post("/auth/view-as/stop", headers=ORIGIN).json()["restored"] is True
    assert placeholders(env) == 0
    assert testing.value("SELECT COUNT(*) FROM users WHERE discord_user_id = %s", (discord_id,)) == 0


def test_a_placeholder_whose_view_ran_out_goes_with_it(app, env):
    _, admin_token = account(env, "boss", "admin")
    link_only(env, "steve")
    c = client(app, admin_token)
    c.post(f"/admin/players/{UUID}/view-as", headers=ORIGIN)
    _expire_views(env)
    assert c.get("/account").json()["user"]["discord_username"] == "boss"
    assert placeholders(env) == 0


def test_signing_in_during_a_view_turns_the_placeholder_into_their_account(app, env):
    _, admin_token = account(env, "boss", "admin")
    discord_id = link_only(env, "steve")
    c = client(app, admin_token)
    c.post(f"/admin/players/{UUID}/view-as", headers=ORIGIN)
    users.sign_in({"discord_user_id": discord_id, "discord_username": "steve", "discord_global_name": "Steve",
                   "discord_avatar": None}, guild_member=True)
    assert placeholders(env) == 0
    c.post("/auth/view-as/stop", headers=ORIGIN)
    [row] = testing.rows("SELECT placeholder, discord_global_name FROM users WHERE discord_user_id = %s",
                         (discord_id,))
    assert row == {"placeholder": False, "discord_global_name": "Steve"}
