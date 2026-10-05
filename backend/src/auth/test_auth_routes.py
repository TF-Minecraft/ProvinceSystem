import logging
import threading
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import auth_routes as routes
from src.auth import users
from src.auth.discord import DiscordError
from src.skins import discord_link

SITE = "https://www.tfminecraft.net"
ORIGIN = {"Origin": SITE}
DISCORD_ID = "123456789012345678"
OTHER_ID = "223456789012345678"
PLAYER = "00000000-0000-4000-8000-000000000001"
OTHER_PLAYER = "00000000-0000-4000-8000-000000000002"
ACCESS_TOKEN = "discord-access-token-should-not-leak"
OAUTH_CODE = "discord-oauth-code-should-not-leak"
SESSION = "__Host-tfmc_session"
STATE = "__Host-tfmc_discord_state"


class Stub:
    def __init__(self, discord_id=DISCORD_ID, member=True, fail=None):
        self.discord_id, self.member, self.fail = discord_id, member, fail
        self.exchanged, self.revoked, self.closed = [], [], False

    def exchange_code(self, code):
        self.exchanged.append(code)
        if self.fail == "exchange":
            raise DiscordError("discord_exchange_failed")
        return ACCESS_TOKEN

    def identity(self, token):
        assert token == ACCESS_TOKEN
        if self.fail == "identity":
            raise DiscordError("discord_bad_identity")
        return {"discord_user_id": self.discord_id, "discord_username": "steve_tfmc",
                "discord_global_name": "Steve", "discord_avatar": "a_1234abcd"}

    def is_guild_member(self, token):
        if self.fail == "guild":
            raise DiscordError("discord_guild_check_failed")
        return self.member

    def revoke(self, token):
        self.revoked.append(token)

    def close(self):
        self.closed = True


@pytest.fixture
def env(database, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", SITE + "/api/auth/discord/callback")
    monkeypatch.setenv("SITE_PUBLIC_URL", SITE)
    monkeypatch.setenv("PATREON_ENABLED", "0")
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    routes._LINK_RATE_BUCKETS.clear()
    return database


@pytest.fixture
def api(env):
    app = FastAPI()
    app.include_router(routes.auth_router)
    return TestClient(app, base_url="https://testserver")


def start(api, return_to="/account"):
    response = api.get("/auth/discord/start", params={"return_to": return_to}, follow_redirects=False)
    assert response.status_code == 302, response.text
    query = parse_qs(urlsplit(response.headers["location"]).query)
    return query, response


def sign_in(api, monkeypatch, stub=None, return_to="/account"):
    stub = stub or Stub()
    monkeypatch.setattr(routes, "build_client", lambda config: stub)
    query, _ = start(api, return_to)
    response = api.get("/auth/discord/callback", params={"code": OAUTH_CODE, "state": query["state"][0]}, follow_redirects=False)
    assert response.status_code == 302
    return response, stub


def link_code(player=PLAYER, name="SteveMC"):
    return discord_link.start_link(player, name)["code"]


def test_start_redirects_to_discord_with_state_cookie(api):
    query, response = start(api, "/account?tab=minecraft")
    assert response.headers["location"].startswith("https://discord.com/oauth2/authorize?")
    assert query["client_id"] == ["client-id"]
    assert query["scope"] == ["identify guilds.members.read"]
    assert query["redirect_uri"] == [SITE + "/api/auth/discord/callback"]
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(STATE + "=" + query["state"][0])
    assert "HttpOnly" in cookie and "Secure" in cookie and "samesite=lax" in cookie.lower()
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("missing", ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID"])
def test_unconfigured_sign_in_is_disabled(api, monkeypatch, missing):
    monkeypatch.setenv(missing, "")
    assert api.get("/auth/discord/start", follow_redirects=False).status_code == 503
    assert api.get("/account").status_code == 503


def test_disabled_flag_returns_503(api, monkeypatch):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "0")
    assert api.get("/auth/discord/start", follow_redirects=False).status_code == 503


@pytest.mark.parametrize("value,expected", [
    ("/account", "/account"),
    ("/map/main?x=1", "/map/main?x=1"),
    (None, "/account"),
    ("", "/account"),
    ("https://evil.example/", "/account"),
    ("//evil.example/", "/account"),
    ("/\\evil.example", "/account"),
    ("/acc\nount", "/account"),
    ("account", "/account"),
    ("/" + "a" * 600, "/account"),
])
def test_clean_return_to(value, expected):
    assert users.clean_return_to(value) == expected


def test_callback_signs_in_and_returns_to_saved_path(api, monkeypatch, env, caplog):
    caplog.set_level(logging.INFO)
    response, stub = sign_in(api, monkeypatch, return_to="/map/main")
    assert response.headers["location"] == SITE + "/map/main"
    assert stub.exchanged == [OAUTH_CODE] and stub.revoked == [ACCESS_TOKEN] and stub.closed
    cookies = response.headers.get_list("set-cookie")
    assert any(c.startswith(SESSION + "=") and "Secure" in c and "HttpOnly" in c for c in cookies)
    assert any(c.startswith(STATE + '=""') or c.startswith(STATE + "=;") or (c.startswith(STATE) and "Max-Age=0" in c) for c in cookies)
    with env.connect() as conn:
        user = conn.execute("SELECT * FROM users").fetchone()
        session = conn.execute("SELECT * FROM user_sessions").fetchone()
        dump = "\n".join(str(tuple(r)) for t in ("users", "user_sessions", "discord_oauth_states") for r in conn.execute(f"SELECT * FROM {t}"))
    assert user["discord_user_id"] == DISCORD_ID and user["discord_username"] == "steve_tfmc"
    assert session["guild_member"] == 1 and session["user_id"] == user["id"]
    assert ACCESS_TOKEN not in dump and OAUTH_CODE not in dump
    assert api.cookies.get(SESSION) not in dump
    logs = "\n".join(r.getMessage() for r in caplog.records if r.name == "auth")
    assert ACCESS_TOKEN not in logs and OAUTH_CODE not in logs


def test_second_sign_in_updates_user_not_duplicate(api, monkeypatch, env):
    sign_in(api, monkeypatch)
    stub = Stub()
    stub.identity = lambda token: {"discord_user_id": DISCORD_ID, "discord_username": "renamed",
                                   "discord_global_name": None, "discord_avatar": None}
    sign_in(api, monkeypatch, stub)
    with env.connect() as conn:
        rows = conn.execute("SELECT discord_username FROM users").fetchall()
        sessions = conn.execute("SELECT COUNT(*) FROM user_sessions").fetchone()[0]
    assert [r[0] for r in rows] == ["renamed"] and sessions == 2


def test_callback_without_matching_state_cookie_is_expired(api, monkeypatch, env):
    stub = Stub()
    monkeypatch.setattr(routes, "build_client", lambda config: stub)
    query, _ = start(api)
    api.cookies.clear()
    response = api.get("/auth/discord/callback", params={"code": OAUTH_CODE, "state": query["state"][0]}, follow_redirects=False)
    assert response.headers["location"] == SITE + "/account?signin=expired"
    assert stub.exchanged == []
    api.cookies.set(STATE, "something-else", domain="testserver")
    response = api.get("/auth/discord/callback", params={"code": OAUTH_CODE, "state": query["state"][0]}, follow_redirects=False)
    assert response.headers["location"].endswith("signin=expired") and stub.exchanged == []


def test_state_is_single_use(api, monkeypatch):
    stub = Stub()
    monkeypatch.setattr(routes, "build_client", lambda config: stub)
    query, _ = start(api)
    state = query["state"][0]
    api.get("/auth/discord/callback", params={"code": OAUTH_CODE, "state": state}, follow_redirects=False)
    api.cookies.set(STATE, state, domain="testserver")
    again = api.get("/auth/discord/callback", params={"code": OAUTH_CODE, "state": state}, follow_redirects=False)
    assert again.headers["location"].endswith("signin=expired") and len(stub.exchanged) == 1


def test_expired_state_is_refused(api, monkeypatch, env):
    stub = Stub()
    monkeypatch.setattr(routes, "build_client", lambda config: stub)
    query, _ = start(api)
    with env.connect() as conn:
        conn.execute("UPDATE discord_oauth_states SET expires_at='2000-01-01T00:00:00Z'")
        conn.commit()
    response = api.get("/auth/discord/callback", params={"code": OAUTH_CODE, "state": query["state"][0]}, follow_redirects=False)
    assert response.headers["location"].endswith("signin=expired") and stub.exchanged == []


def test_denied_consent_creates_nothing(api, monkeypatch, env):
    stub = Stub()
    monkeypatch.setattr(routes, "build_client", lambda config: stub)
    query, _ = start(api)
    response = api.get("/auth/discord/callback", params={"error": "access_denied", "state": query["state"][0]}, follow_redirects=False)
    assert response.headers["location"].endswith("signin=denied") and stub.exchanged == []
    with env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0


@pytest.mark.parametrize("fail", ["exchange", "identity"])
def test_discord_failures_redirect_with_error(api, monkeypatch, env, fail):
    response, stub = sign_in(api, monkeypatch, Stub(fail=fail))
    assert response.headers["location"] == SITE + "/account?signin=error"
    assert stub.closed
    with env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM user_sessions").fetchone()[0] == 0


def test_guild_check_failure_still_signs_in_without_membership(api, monkeypatch, env):
    response, _ = sign_in(api, monkeypatch, Stub(fail="guild"))
    assert response.headers["location"] == SITE + "/account"
    account = api.get("/account").json()
    assert account["guild"] == {"member": False, "checked_at": account["guild"]["checked_at"], "fresh": False}


def test_account_requires_session(api):
    assert api.get("/account").status_code == 401
    api.cookies.set(SESSION, "not-a-session", domain="testserver")
    assert api.get("/account").status_code == 401


def test_expired_session_is_refused(api, monkeypatch, env):
    sign_in(api, monkeypatch)
    with env.connect() as conn:
        conn.execute("UPDATE user_sessions SET expires_at='2000-01-01T00:00:00Z'")
        conn.commit()
    assert api.get("/account").status_code == 401


def test_existing_bot_link_appears_on_first_sign_in(api, monkeypatch):
    discord_link.complete_link(link_code(), DISCORD_ID, "steve_tfmc")
    sign_in(api, monkeypatch)
    response = api.get("/account")
    assert response.headers["cache-control"] == "no-store"
    account = response.json()
    assert account["user"]["discord_user_id"] == DISCORD_ID
    assert account["user"]["avatar_url"] == f"https://cdn.discordapp.com/avatars/{DISCORD_ID}/a_1234abcd.png?size=128"
    assert account["minecraft"]["player_uuid"] == PLAYER and account["minecraft"]["minecraft_name"] == "SteveMC"
    assert account["patreon"] is None


def test_sign_in_refreshes_link_username(api, monkeypatch, env):
    discord_link.complete_link(link_code(), DISCORD_ID, "old_name")
    sign_in(api, monkeypatch)
    with env.connect() as conn:
        assert conn.execute("SELECT discord_username FROM discord_links").fetchone()[0] == "steve_tfmc"


def test_default_avatar_when_none():
    url = users.avatar_url({"discord_user_id": DISCORD_ID, "discord_avatar": None})
    assert url == f"https://cdn.discordapp.com/embed/avatars/{(int(DISCORD_ID) >> 22) % 6}.png"


def test_link_with_in_game_code(api, monkeypatch, env):
    sign_in(api, monkeypatch)
    code = link_code()
    pasted = code.replace("-", "").lower()
    preview = api.post("/account/minecraft/preview", json={"code": pasted}, headers=ORIGIN)
    assert preview.status_code == 200, preview.text
    assert preview.json()["minecraft_name"] == "SteveMC" and preview.json()["player_uuid"] == PLAYER
    with env.connect() as conn:
        assert conn.execute("SELECT used_at FROM discord_link_codes").fetchone()[0] is None
    linked = api.post("/account/minecraft/link", json={"code": " " + code + " "}, headers=ORIGIN)
    assert linked.status_code == 200, linked.text
    assert linked.json()["minecraft"]["player_uuid"] == PLAYER
    assert discord_link.get_discord_id_for_uuid(PLAYER) == DISCORD_ID
    with env.connect() as conn:
        notice = conn.execute("SELECT type FROM plugin_notices WHERE player_uuid=?", (PLAYER,)).fetchone()
        username = conn.execute("SELECT discord_username FROM discord_links").fetchone()[0]
    assert notice[0] == "link_success" and username == "steve_tfmc"


def test_link_requires_guild_membership(api, monkeypatch):
    sign_in(api, monkeypatch, Stub(member=False))
    response = api.post("/account/minecraft/link", json={"code": link_code()}, headers=ORIGIN)
    assert response.status_code == 403 and response.json()["detail"] == "not_guild_member"
    assert discord_link.get_discord_id_for_uuid(PLAYER) is None


def test_link_requires_recent_guild_check(api, monkeypatch, env):
    sign_in(api, monkeypatch)
    old = users._iso(users._utcnow() - users.GUILD_CHECK_MAX_AGE - timedelta(minutes=1))
    with env.connect() as conn:
        conn.execute("UPDATE user_sessions SET guild_checked_at=?", (old,))
        conn.commit()
    response = api.post("/account/minecraft/link", json={"code": link_code()}, headers=ORIGIN)
    assert response.status_code == 403 and response.json()["detail"] == "guild_check_stale"
    assert api.get("/account").json()["guild"]["fresh"] is False


def test_bad_codes(api, monkeypatch):
    sign_in(api, monkeypatch)
    assert api.post("/account/minecraft/preview", json={"code": "AAAA-BBBB-CCCC"}, headers=ORIGIN).json()["detail"] == "Invalid link code"
    assert api.post("/account/minecraft/link", json={"code": "x" * 40}, headers=ORIGIN).status_code == 400


def test_preview_refuses_already_linked_player(api, monkeypatch):
    sign_in(api, monkeypatch)
    stale = link_code()
    discord_link.complete_link(link_code(), OTHER_ID)
    response = api.post("/account/minecraft/preview", json={"code": stale}, headers=ORIGIN)
    assert response.status_code == 400


def test_link_rate_limit(api, monkeypatch):
    sign_in(api, monkeypatch)
    for _ in range(routes._LINK_RATE_LIMIT):
        assert api.post("/account/minecraft/preview", json={"code": "AAAA-BBBB-CCCC"}, headers=ORIGIN).status_code == 400
    assert api.post("/account/minecraft/preview", json={"code": "AAAA-BBBB-CCCC"}, headers=ORIGIN).status_code == 429


def test_unlink(api, monkeypatch):
    sign_in(api, monkeypatch)
    discord_link.complete_link(link_code(), DISCORD_ID)
    response = api.post("/account/minecraft/unlink", headers=ORIGIN)
    assert response.status_code == 200 and response.json() == {"minecraft": None}
    assert api.get("/account").json()["minecraft"] is None
    assert api.post("/account/minecraft/unlink", headers=ORIGIN).status_code == 400


@pytest.mark.parametrize("headers,detail", [
    ({}, "bad_origin"),
    ({"Origin": "https://dev.tfminecraft.net", "Sec-Fetch-Site": "same-site"}, "bad_origin"),
    ({"Origin": "https://evil.example"}, "bad_origin"),
    ({"Origin": "https://tfminecraft.net.evil.example"}, "bad_origin"),
    ({"Origin": SITE, "Sec-Fetch-Site": "cross-site"}, "cross_site_request"),
])
def test_writes_require_site_origin(api, monkeypatch, headers, detail):
    sign_in(api, monkeypatch)
    for path in ("/account/minecraft/preview", "/account/minecraft/unlink", "/auth/logout"):
        response = api.post(path, json={"code": "AAAA-BBBB-CCCC"}, headers=headers)
        assert response.status_code == 403 and response.json()["detail"] == detail


def test_localhost_origin_only_outside_production(api, monkeypatch):
    sign_in(api, monkeypatch)
    local = {"Origin": "http://localhost:3000"}
    assert api.post("/account/minecraft/preview", json={"code": "AAAA-BBBB-CCCC"}, headers=local).status_code == 400
    monkeypatch.setenv("PS_PRODUCTION", "1")
    assert api.post("/account/minecraft/preview", json={"code": "AAAA-BBBB-CCCC"}, headers=local).status_code == 403


def test_logout_revokes_session(api, monkeypatch, env):
    sign_in(api, monkeypatch)
    token = api.cookies.get(SESSION)
    response = api.post("/auth/logout", headers=ORIGIN)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert any(c.startswith(SESSION) for c in response.headers.get_list("set-cookie"))
    api.cookies.set(SESSION, token, domain="testserver")
    assert api.get("/account").status_code == 401


def test_plain_http_site_uses_unprefixed_insecure_cookies(env, monkeypatch):
    monkeypatch.setenv("SITE_PUBLIC_URL", "http://localhost:3000")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/discord/callback")
    app = FastAPI()
    app.include_router(routes.auth_router)
    client = TestClient(app)
    response = client.get("/auth/discord/start", follow_redirects=False)
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("tfmc_discord_state=") and "Secure" not in cookie


def test_patreon_start_uses_signed_in_discord_account(api, monkeypatch):
    sign_in(api, monkeypatch)
    assert api.post("/account/patreon/start", headers=ORIGIN).status_code == 503
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_CLIENT_ID", "patreon-client")
    seen = {}
    monkeypatch.setattr(routes.patreon_linking, "start_link", lambda **kw: seen.update(kw) or {"authorize_url": "https://www.patreon.com/oauth2/authorize?x", "expires_at": "z"})
    response = api.post("/account/patreon/start", headers=ORIGIN)
    assert response.status_code == 200 and response.json()["authorize_url"].startswith("https://www.patreon.com/")
    assert seen == {"discord_user_id": DISCORD_ID, "discord_username": "steve_tfmc"}


def test_patreon_status_on_account_when_enabled(api, monkeypatch):
    sign_in(api, monkeypatch)
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setattr(routes.patreon_service, "status", lambda **kw: {"linked": False, "subject": kw})
    assert api.get("/account").json()["patreon"] == {"linked": False, "subject": {"discord_user_id": DISCORD_ID}}


# --------------------
# complete_link hardening (shared with the Discord bot route)
# --------------------

def test_older_code_cannot_replace_a_newer_link(env):
    older = link_code()
    discord_link.complete_link(link_code(), DISCORD_ID)
    with pytest.raises(discord_link.LinkError):
        discord_link.complete_link(older, OTHER_ID)
    assert discord_link.get_discord_id_for_uuid(PLAYER) == DISCORD_ID


def test_linking_spends_sibling_codes(env):
    sibling = link_code()
    discord_link.complete_link(link_code(), DISCORD_ID)
    with pytest.raises(discord_link.LinkError, match="already been used"):
        discord_link.complete_link(sibling, DISCORD_ID)


def test_minecraft_already_linked_elsewhere_is_refused(env):
    stale = link_code()
    with env.connect() as conn:
        conn.execute("INSERT INTO discord_links (player_uuid, discord_user_id, linked_at) VALUES (?, ?, '2026-01-01T00:00:00Z')", (PLAYER, OTHER_ID))
        conn.commit()
    with pytest.raises(discord_link.LinkError, match="different Discord account"):
        discord_link.complete_link(stale, DISCORD_ID)
    assert discord_link.get_discord_id_for_uuid(PLAYER) == OTHER_ID


def test_same_pair_again_keeps_link_and_grace(env):
    stale = link_code()
    discord_link.complete_link(link_code(), DISCORD_ID, "first_name")
    discord_link.record_guild_left(DISCORD_ID)
    with env.connect() as conn:
        conn.execute("UPDATE discord_link_codes SET used_at=NULL WHERE code_hash=?", (discord_link.hash_secret(stale),))
        conn.commit()
    before = discord_link.get_link_for_uuid(PLAYER)
    result = discord_link.complete_link(stale, DISCORD_ID, "second_name")
    after = discord_link.get_link_for_uuid(PLAYER)
    assert result["linked_at"] == before["linked_at"] == after["linked_at"]
    assert after["grace_until"] == before["grace_until"] is not None
    assert after["discord_username"] == "second_name"


def test_discord_already_linked_to_other_player_is_refused(env):
    discord_link.complete_link(link_code(OTHER_PLAYER), DISCORD_ID)
    with pytest.raises(discord_link.LinkError, match="different Minecraft player"):
        discord_link.complete_link(link_code(), DISCORD_ID)


def test_concurrent_redemption_links_once(env):
    code = link_code()
    results, barrier = [], threading.Barrier(4)

    def redeem(discord_id):
        barrier.wait()
        try:
            discord_link.complete_link(code, discord_id)
            results.append(discord_id)
        except discord_link.LinkError:
            pass

    threads = [threading.Thread(target=redeem, args=(f"30000000000000000{i}",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 1
    assert discord_link.get_discord_id_for_uuid(PLAYER) == results[0]
    with env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM plugin_notices WHERE type='link_success'").fetchone()[0] == 1


def test_get_link_for_discord_id_expires_due_graces(env):
    discord_link.complete_link(link_code(), DISCORD_ID)
    discord_link.record_guild_left(DISCORD_ID)
    with env.connect() as conn:
        conn.execute("UPDATE discord_links SET grace_until='2000-01-01T00:00:00Z'")
        conn.commit()
    assert discord_link.get_link_for_discord_id(DISCORD_ID) is None
    assert discord_link.get_link_for_discord_id("") is None


@pytest.mark.parametrize("site,redirect,bad", [
    ("https://www.tfminecraft.net", None, []),
    ("https://dev.tfminecraft.net", None, []),
    ("https://dev.tfminecraft.net", "https://www.tfminecraft.net/api/auth/discord/callback", ["DISCORD_REDIRECT_URI"]),
    ("not a url", None, ["SITE_PUBLIC_URL", "DISCORD_REDIRECT_URI"]),
    ("https://www.tfminecraft.net/sub", None, ["SITE_PUBLIC_URL"]),
    ("http://localhost:3000", "http://localhost:8000/auth/discord/callback", []),
    ("http://localhost:3000", "http://127.0.0.1:8000/auth/discord/callback", ["DISCORD_REDIRECT_URI"]),
    ("https://www.tfminecraft.net", "https://evil.example/api/auth/discord/callback", ["DISCORD_REDIRECT_URI"]),
])
def test_config_validates_site_and_callback(monkeypatch, site, redirect, bad):
    from src.auth.config import AuthConfig
    monkeypatch.setenv("DISCORD_CLIENT_ID", "cid")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999")
    monkeypatch.setenv("SITE_PUBLIC_URL", site)
    if redirect is None:
        monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    else:
        monkeypatch.setenv("DISCORD_REDIRECT_URI", redirect)
    config = AuthConfig.from_env()
    assert config.problems() == bad
    if redirect is None and not bad:
        assert config.redirect_uri == site + "/api/auth/discord/callback"


def test_failed_link_notice_rolls_back_link_and_code(env, monkeypatch):
    code = link_code()

    def boom(*args, **kwargs):
        raise RuntimeError("notice failed")

    with monkeypatch.context() as patch:
        patch.setattr(discord_link, "enqueue_link_success", boom)
        with pytest.raises(RuntimeError):
            discord_link.complete_link(code, DISCORD_ID)
    assert discord_link.get_discord_id_for_uuid(PLAYER) is None
    assert discord_link.complete_link(code, DISCORD_ID)["player_uuid"] == PLAYER
