import hashlib
import base64
import json
import logging
import threading
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from src.api import auth_routes as routes
from src.auth import microsoft, microsoft_link, users
from src.auth.microsoft import MicrosoftClient, MicrosoftConfig, MicrosoftError
from src.auth.test_auth_routes import (  # noqa: F401 - fixtures
    DISCORD_ID,
    ORIGIN,
    OTHER_PLAYER,
    PLAYER,
    SITE,
    Stub,
    api,
    env,
    link_code,
    sign_in,
)
from src.skins import discord_link

CLIENT_ID = "1291f0d7-5a44-4e70-8d3d-19ad268d8d32"
MS_STATE = "__Host-tfmc_microsoft_state"
MS_CODE = "M.C123_microsoft-code-should-not-leak"
MS_TOKEN = "microsoft-access-token-should-not-leak"
MC_TOKEN = "minecraft-token-should-not-leak"
PROFILE_ID = PLAYER.replace("-", "")

CONFIG = MicrosoftConfig(
    enabled=True, client_id=CLIENT_ID, client_secret="ms-secret",
    redirect_uri=SITE + "/api/auth/microsoft/callback", site_url=SITE,
)


# --------------------
# Xbox and Minecraft services chain
# --------------------

def chain(overrides=None):
    """A MockTransport that plays the whole chain; overrides replace one step by URL."""
    overrides = overrides or {}
    seen = []

    def handler(request):
        url = str(request.url).split("?")[0]
        seen.append((url, request))
        if url in overrides:
            return overrides[url](request)
        if url == microsoft.LOGIN_BASE + "/token":
            return httpx.Response(200, json={"access_token": MS_TOKEN, "token_type": "Bearer"})
        if url == microsoft.XBL_URL:
            return httpx.Response(200, json={"Token": "xbl-token", "DisplayClaims": {"xui": [{"uhs": "uhs1"}]}})
        if url == microsoft.XSTS_URL:
            return httpx.Response(200, json={"Token": "xsts-token", "DisplayClaims": {"xui": [{"uhs": "uhs1"}]}})
        if url == microsoft.MC_LOGIN_URL:
            return httpx.Response(200, json={"access_token": MC_TOKEN})
        if url == microsoft.MC_PROFILE_URL:
            return httpx.Response(200, json={"id": PROFILE_ID, "name": "SteveMC", "skins": []})
        return httpx.Response(500)

    return httpx.MockTransport(handler), seen


def ms_client(overrides=None):
    transport, seen = chain(overrides)
    return MicrosoftClient(CONFIG, httpx.Client(transport=transport)), seen


def test_chain_returns_dashed_profile_and_sends_each_step():
    client, seen = ms_client()
    assert client.java_profile(MS_CODE, "verifier") == {"player_uuid": PLAYER, "minecraft_name": "SteveMC"}
    urls = [u for u, _ in seen]
    assert urls == [microsoft.LOGIN_BASE + "/token", microsoft.XBL_URL, microsoft.XSTS_URL,
                    microsoft.MC_LOGIN_URL, microsoft.MC_PROFILE_URL]
    token = parse_qs(seen[0][1].content.decode())
    assert token["code"] == [MS_CODE] and token["code_verifier"] == ["verifier"]
    assert token["client_secret"] == ["ms-secret"] and token["redirect_uri"] == [CONFIG.redirect_uri]
    xbl = json.loads(seen[1][1].content)
    assert xbl["Properties"]["RpsTicket"] == "d=" + MS_TOKEN and xbl["RelyingParty"] == "http://auth.xboxlive.com"
    assert seen[1][1].headers["x-xbl-contract-version"] == "1"
    xsts = json.loads(seen[2][1].content)
    assert xsts["Properties"] == {"SandboxId": "RETAIL", "UserTokens": ["xbl-token"]}
    assert xsts["RelyingParty"] == "rp://api.minecraftservices.com/"
    assert json.loads(seen[3][1].content) == {"identityToken": "XBL3.0 x=uhs1;xsts-token"}
    assert seen[4][1].headers["authorization"] == "Bearer " + MC_TOKEN


@pytest.mark.parametrize("xerr,expected", [
    (2148916233, "no_xbox_profile"),
    (2148916238, "xbox_child_account"),
    (2148916235, "xbox_region_blocked"),
    (2148916236, "xbox_adult_verification"),
    (1, "xsts_failed"),
    (None, "xsts_failed"),
])
def test_xsts_refusals_map_to_codes(xerr, expected):
    client, _ = ms_client({microsoft.XSTS_URL: lambda r: httpx.Response(401, json={"XErr": xerr, "Message": "secret"})})
    with pytest.raises(MicrosoftError, match=f"^{expected}$"):
        client.java_profile(MS_CODE, "v")


@pytest.mark.parametrize("url,response,expected", [
    (microsoft.LOGIN_BASE + "/token", httpx.Response(400, json={"error": "invalid_grant"}), "microsoft_exchange_failed"),
    (microsoft.LOGIN_BASE + "/token", httpx.Response(200, text="nope"), "microsoft_exchange_failed"),
    (microsoft.XBL_URL, httpx.Response(400), "xbox_auth_failed"),
    (microsoft.XBL_URL, httpx.Response(200, json={"Token": "t", "DisplayClaims": {"xui": []}}), "xbox_auth_failed"),
    (microsoft.XSTS_URL, httpx.Response(200, json={"Token": "t", "DisplayClaims": {"xui": [{"uhs": "other"}]}}), "xsts_failed"),
    (microsoft.MC_LOGIN_URL, httpx.Response(403, json={"errorMessage": "Invalid app registration"}), "minecraft_login_failed"),
    (microsoft.MC_LOGIN_URL, httpx.Response(429), "minecraft_login_failed"),
    (microsoft.MC_PROFILE_URL, httpx.Response(404, json={"error": "NOT_FOUND"}), "no_java_profile"),
    (microsoft.MC_PROFILE_URL, httpx.Response(500), "minecraft_profile_failed"),
    (microsoft.MC_PROFILE_URL, httpx.Response(200, json={"id": "not-a-uuid", "name": "SteveMC"}), "minecraft_bad_profile"),
    (microsoft.MC_PROFILE_URL, httpx.Response(200, json={"id": PROFILE_ID, "name": "bad name!"}), "minecraft_bad_profile"),
    (microsoft.MC_PROFILE_URL, httpx.Response(200, json=["list"]), "minecraft_bad_profile"),
])
def test_chain_failures_are_stable_codes(url, response, expected):
    client, _ = ms_client({url: lambda r: response})
    with pytest.raises(MicrosoftError, match=f"^{expected}$"):
        client.java_profile(MS_CODE, "v")


def test_network_failure_is_a_code():
    def boom(request):
        raise httpx.ConnectError("down")

    client, _ = ms_client({microsoft.XBL_URL: boom})
    with pytest.raises(MicrosoftError, match="^xbox_http_failed$"):
        client.java_profile(MS_CODE, "v")


def test_authorize_url_uses_pkce_and_account_picker():
    query = parse_qs(urlsplit(microsoft.authorize_url(CONFIG, "state1", "verifier1")).query)
    expected = base64.urlsafe_b64encode(hashlib.sha256(b"verifier1").digest()).rstrip(b"=").decode()
    assert query["code_challenge"] == [expected] and query["code_challenge_method"] == ["S256"]
    assert query["scope"] == ["XboxLive.signin"] and query["prompt"] == ["select_account"]
    assert query["client_id"] == [CLIENT_ID] and query["state"] == ["state1"]


@pytest.mark.parametrize("client_id,secret,redirect,bad", [
    (CLIENT_ID, "s", SITE + "/api/auth/microsoft/callback", []),
    ("", "s", SITE + "/api/auth/microsoft/callback", ["MICROSOFT_CLIENT_ID"]),
    ("not-a-guid", "s", SITE + "/api/auth/microsoft/callback", ["MICROSOFT_CLIENT_ID"]),
    (CLIENT_ID, "", SITE + "/api/auth/microsoft/callback", ["MICROSOFT_CLIENT_SECRET"]),
    (CLIENT_ID, "s", "https://evil.example/api/auth/microsoft/callback", ["MICROSOFT_REDIRECT_URI"]),
    (CLIENT_ID, "s", SITE + "/api/auth/discord/callback", ["MICROSOFT_REDIRECT_URI"]),
])
def test_config_problems(client_id, secret, redirect, bad):
    config = MicrosoftConfig(enabled=True, client_id=client_id, client_secret=secret, redirect_uri=redirect, site_url=SITE)
    assert config.problems() == bad


# --------------------
# Routes
# --------------------

@pytest.fixture
def ms_env(env, monkeypatch):
    monkeypatch.setenv("MICROSOFT_LINK_ENABLED", "1")
    monkeypatch.setenv("MICROSOFT_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "ms-secret")
    monkeypatch.delenv("MICROSOFT_REDIRECT_URI", raising=False)
    return env


def use_chain(monkeypatch, overrides=None):
    transport, seen = chain(overrides)
    monkeypatch.setattr(routes, "build_microsoft_client",
                        lambda config: MicrosoftClient(config, httpx.Client(transport=transport)))
    return seen


def ms_start(api):
    response = api.post("/account/minecraft/microsoft/start", headers=ORIGIN)
    assert response.status_code == 200, response.text
    query = parse_qs(urlsplit(response.json()["authorize_url"]).query)
    return query["state"][0], response


def ms_callback(api, state, **params):
    params = {"code": MS_CODE, "state": state, **params}
    response = api.get("/auth/microsoft/callback", params=params, follow_redirects=False)
    assert response.status_code == 302
    return response


def outcome(response):
    return parse_qs(urlsplit(response.headers["location"]).query)["minecraft"][0]


def test_account_reports_whether_microsoft_link_is_available(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    assert api.get("/account").json()["microsoft_link"] is True
    monkeypatch.setenv("MICROSOFT_CLIENT_SECRET", "")
    assert api.get("/account").json()["microsoft_link"] is False


def test_microsoft_link_end_to_end(api, monkeypatch, ms_env, caplog):
    caplog.set_level(logging.INFO)
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    state, start = ms_start(api)
    assert start.headers["cache-control"] == "no-store"
    cookie = next(c for c in start.headers.get_list("set-cookie") if c.startswith(MS_STATE + "="))
    assert "HttpOnly" in cookie and "Secure" in cookie and "samesite=lax" in cookie.lower()
    query = parse_qs(urlsplit(start.json()["authorize_url"]).query)
    assert query["redirect_uri"] == [SITE + "/api/auth/microsoft/callback"]

    response = ms_callback(api, state)
    assert response.headers["location"] == SITE + "/account?minecraft=linked"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert discord_link.get_discord_id_for_uuid(PLAYER) == DISCORD_ID
    account = api.get("/account").json()
    assert account["minecraft"]["minecraft_name"] == "SteveMC"
    assert len(seen) == 5
    with ms_env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM microsoft_link_states").fetchone()[0] == 0
        notice = conn.execute("SELECT type FROM plugin_notices WHERE player_uuid=?", (PLAYER,)).fetchone()
        dump = "\n".join(str(tuple(r)) for t in ("users", "user_sessions", "discord_links") for r in conn.execute(f"SELECT * FROM {t}"))
    assert notice[0] == "link_success"
    logs = "\n".join(r.getMessage() for r in caplog.records if r.name == "auth")
    for secret in (MS_CODE, MS_TOKEN, MC_TOKEN, "xsts-token", "xbl-token"):
        assert secret not in dump and secret not in logs


def test_microsoft_link_spends_outstanding_codes(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    link_code()
    use_chain(monkeypatch)
    state, _ = ms_start(api)
    ms_callback(api, state)
    with ms_env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM discord_link_codes WHERE used_at IS NULL").fetchone()[0] == 0


def test_start_needs_configuration(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    monkeypatch.setenv("MICROSOFT_LINK_ENABLED", "0")
    response = api.post("/account/minecraft/microsoft/start", headers=ORIGIN)
    assert response.status_code == 503 and response.json()["detail"] == "microsoft_link_disabled"


def test_start_needs_same_origin_and_session(api, monkeypatch, ms_env):
    assert api.post("/account/minecraft/microsoft/start", headers=ORIGIN).status_code == 401
    sign_in(api, monkeypatch)
    assert api.post("/account/minecraft/microsoft/start", headers={"Origin": "https://evil.example"}).status_code == 403


def test_start_needs_guild_membership(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch, Stub(member=False))
    response = api.post("/account/minecraft/microsoft/start", headers=ORIGIN)
    assert response.status_code == 403 and response.json()["detail"] == "not_guild_member"


def test_start_needs_recent_guild_check(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    age_guild_check(ms_env)
    response = api.post("/account/minecraft/microsoft/start", headers=ORIGIN)
    assert response.status_code == 403 and response.json()["detail"] == "guild_check_stale"


def test_start_refuses_when_already_linked(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    discord_link.complete_link(link_code(), DISCORD_ID)
    response = api.post("/account/minecraft/microsoft/start", headers=ORIGIN)
    assert response.status_code == 409 and response.json()["detail"] == "already_linked"


def test_new_attempt_replaces_older_one(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    first, _ = ms_start(api)
    second, _ = ms_start(api)
    api.cookies.set(MS_STATE, first, domain="testserver.local")
    assert outcome(ms_callback(api, first)) == "expired"
    assert seen == []
    with ms_env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM microsoft_link_states").fetchone()[0] == 1


def age_guild_check(database):
    old = users._iso(users._utcnow() - users.GUILD_CHECK_MAX_AGE - timedelta(minutes=1))
    with database.connect() as conn:
        conn.execute("UPDATE user_sessions SET guild_checked_at=?", (old,))
        conn.commit()


def test_callback_without_state_cookie_is_expired(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    state, _ = ms_start(api)
    api.cookies.delete(MS_STATE)
    assert outcome(ms_callback(api, state)) == "expired"
    assert seen == []


def test_state_is_single_use(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch, {microsoft.MC_PROFILE_URL: lambda r: httpx.Response(404)})
    state, _ = ms_start(api)
    assert outcome(ms_callback(api, state)) == "no_java_profile"
    api.cookies.set(MS_STATE, state, domain="testserver.local")
    assert outcome(ms_callback(api, state)) == "expired"
    assert len(seen) == 5


def test_expired_state_is_refused(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    state, _ = ms_start(api)
    with ms_env.connect() as conn:
        conn.execute("UPDATE microsoft_link_states SET expires_at='2000-01-01T00:00:00Z'")
        conn.commit()
    assert outcome(ms_callback(api, state)) == "expired" and seen == []


def test_callback_in_another_session_is_refused(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    state, _ = ms_start(api)
    # Signing in again replaces the session cookie the attempt was tied to.
    sign_in(api, monkeypatch)
    api.cookies.set(MS_STATE, state, domain="testserver.local")
    assert outcome(ms_callback(api, state)) == "expired" and seen == []
    assert discord_link.get_discord_id_for_uuid(PLAYER) is None


def test_denied_consent_links_nothing(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    state, _ = ms_start(api)
    response = api.get("/auth/microsoft/callback", params={"state": state, "error": "access_denied"}, follow_redirects=False)
    assert outcome(response) == "denied" and seen == []
    with ms_env.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM microsoft_link_states").fetchone()[0] == 0


def test_callback_rechecks_guild_freshness(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    seen = use_chain(monkeypatch)
    state, _ = ms_start(api)
    age_guild_check(ms_env)
    assert outcome(ms_callback(api, state)) == "guild_check_stale" and seen == []


@pytest.mark.parametrize("xerr,expected", [(2148916233, "no_xbox_profile"), (2148916238, "xbox_child_account")])
def test_callback_explains_xbox_refusals(api, monkeypatch, ms_env, xerr, expected):
    sign_in(api, monkeypatch)
    use_chain(monkeypatch, {microsoft.XSTS_URL: lambda r: httpx.Response(401, json={"XErr": xerr})})
    state, _ = ms_start(api)
    assert outcome(ms_callback(api, state)) == expected


def test_callback_hides_internal_failures(api, monkeypatch, ms_env, caplog):
    sign_in(api, monkeypatch)
    use_chain(monkeypatch, {microsoft.MC_LOGIN_URL: lambda r: httpx.Response(403, json={"errorMessage": "Invalid app registration"})})
    state, _ = ms_start(api)
    assert outcome(ms_callback(api, state)) == "error"
    assert "Invalid app registration" not in caplog.text


def test_minecraft_account_linked_elsewhere(api, monkeypatch, ms_env):
    discord_link.complete_link(link_code(), "323456789012345678")
    sign_in(api, monkeypatch)
    use_chain(monkeypatch)
    state, _ = ms_start(api)
    assert outcome(ms_callback(api, state)) == "minecraft_taken"
    assert discord_link.get_discord_id_for_uuid(PLAYER) == "323456789012345678"


def test_discord_linked_during_attempt(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)
    use_chain(monkeypatch)
    state, _ = ms_start(api)
    discord_link.complete_link(link_code(OTHER_PLAYER), DISCORD_ID)
    assert outcome(ms_callback(api, state)) == "discord_taken"
    assert discord_link.get_discord_id_for_uuid(PLAYER) is None


def test_sign_out_during_the_chain_stops_the_link(api, monkeypatch, ms_env):
    sign_in(api, monkeypatch)

    def profile_after_logout(request):
        with ms_env.connect() as conn:
            conn.execute("DELETE FROM user_sessions")
            conn.commit()
        return httpx.Response(200, json={"id": PROFILE_ID, "name": "SteveMC"})

    use_chain(monkeypatch, {microsoft.MC_PROFILE_URL: profile_after_logout})
    state, _ = ms_start(api)
    assert outcome(ms_callback(api, state)) == "expired"
    assert discord_link.get_discord_id_for_uuid(PLAYER) is None


def test_link_verified_profile_rejects_conflicts(ms_env):
    discord_link.link_verified_profile(PLAYER, "SteveMC", DISCORD_ID)
    with pytest.raises(discord_link.LinkError, match="different Minecraft player"):
        discord_link.link_verified_profile(OTHER_PLAYER, "Alex", DISCORD_ID)
    with pytest.raises(discord_link.LinkError, match="different Discord account"):
        discord_link.link_verified_profile(PLAYER, "SteveMC", "423456789012345678")
    # The same pair again keeps the original link.
    before = discord_link.get_link_for_discord_id(DISCORD_ID)["linked_at"]
    discord_link.link_verified_profile(PLAYER, "SteveRenamed", DISCORD_ID)
    link = discord_link.get_link_for_discord_id(DISCORD_ID)
    assert link["linked_at"] == before and link["minecraft_name"] == "SteveRenamed"


def test_concurrent_verified_links_link_once(ms_env):
    results, barrier = [], threading.Barrier(4)

    def link(discord_id):
        barrier.wait()
        try:
            discord_link.link_verified_profile(PLAYER, "SteveMC", discord_id)
            results.append(discord_id)
        except discord_link.LinkError:
            pass

    threads = [threading.Thread(target=link, args=(f"40000000000000000{i}",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 1
    assert discord_link.get_discord_id_for_uuid(PLAYER) == results[0]


def test_state_validation():
    assert microsoft_link.valid_state("abc_-123")
    assert not microsoft_link.valid_state("")
    assert not microsoft_link.valid_state(None)
    assert not microsoft_link.valid_state("a" * 200)
    assert not microsoft_link.valid_state("é")
