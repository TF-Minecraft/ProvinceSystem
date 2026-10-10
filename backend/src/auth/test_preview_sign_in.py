from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import auth_routes as routes
from src.auth import guild_check, preview_sign_in, users
from src.auth.config import AuthConfig
from src.skins.db import connect

DEV = "https://dev.tfminecraft.net"
PREVIEW = "https://my-branch.tfminecraft.net"
DISCORD_ID = "123456789012345678"
SESSION = "__Host-tfmc_session"
STATE = "__Host-tfmc_discord_state"
IDENTITY = {"discord_user_id": DISCORD_ID, "discord_username": "steve_tfmc",
            "discord_global_name": "Steve", "discord_avatar": "a_1234abcd"}


def _app(base_url):
    app = FastAPI()
    app.include_router(routes.auth_router)
    return TestClient(app, base_url=base_url)


@pytest.fixture
def dev(database, monkeypatch):
    """Dev: Discord sign-in, and tickets for previews under tfminecraft.net."""
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", DEV)
    monkeypatch.setenv("PREVIEW_SIGN_IN_DOMAIN", "tfminecraft.net")
    monkeypatch.setenv("PATREON_ENABLED", "0")
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("SIGN_IN_SITE", raising=False)
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    guild_check.clear()
    return _app(DEV)


@pytest.fixture
def preview(database, monkeypatch):
    """A preview: no Discord settings, signs in through dev."""
    for name in ("DISCORD_AUTH_ENABLED", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID",
                 "DISCORD_REDIRECT_URI", "PREVIEW_SIGN_IN_DOMAIN", "DISCORD_BOT_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SITE_PUBLIC_URL", PREVIEW)
    monkeypatch.setenv("SIGN_IN_SITE", DEV)
    monkeypatch.setenv("PATREON_ENABLED", "0")
    guild_check.clear()
    return _app(PREVIEW)


def _dev_session(dev, guild_member=True):
    token = users.sign_in(IDENTITY, guild_member=guild_member)
    dev.cookies.set(SESSION, token, domain="dev.tfminecraft.net")
    return token


def _query(response):
    return {k: v[0] for k, v in parse_qs(urlsplit(response.headers["location"]).query).items()}


def _player(**overrides):
    return {**IDENTITY, "role": "admin", "guild_member": True,
            "guild_checked_at": "2026-10-10T12:00:00Z", **overrides}


# --------------------
# Which sites may receive a ticket
# --------------------

@pytest.mark.parametrize("site", [
    "https://my-branch.tfminecraft.net",
    "https://a.tfminecraft.net",
    "https://codex-new-map.tfminecraft.net",
])
def test_preview_sites(site, monkeypatch):
    monkeypatch.setenv("PREVIEW_SIGN_IN_DOMAIN", "tfminecraft.net")
    assert preview_sign_in.preview_site(site) == site


@pytest.mark.parametrize("site", [
    None, "",
    "https://www.tfminecraft.net", "https://dev.tfminecraft.net", "https://api.tfminecraft.net",
    "https://tfminecraft.net", "https://a.b.tfminecraft.net", "https://evil.com",
    "https://my-branch.tfminecraft.net.evil.com", "http://my-branch.tfminecraft.net",
    "https://my-branch.tfminecraft.net:8443", "https://my-branch.tfminecraft.net/x",
    "https://my-branch.tfminecraft.net?x=1", "https://user@my-branch.tfminecraft.net",
    "https://-branch.tfminecraft.net", "https://MY-BRANCH.tfminecraft.net",
    "https://" + "a" * 41 + ".tfminecraft.net", "https://my-branch.tfminecraft.net.",
    "https://[", "https://a\uff03b.tfminecraft.net", "https://my-br\u0430nch.tfminecraft.net",
])
def test_other_sites_are_refused(site, monkeypatch):
    monkeypatch.setenv("PREVIEW_SIGN_IN_DOMAIN", "tfminecraft.net")
    assert preview_sign_in.preview_site(site) is None


def test_no_preview_sites_without_the_setting(monkeypatch):
    monkeypatch.delenv("PREVIEW_SIGN_IN_DOMAIN", raising=False)
    assert preview_sign_in.preview_site(PREVIEW) is None


# --------------------
# Settings
# --------------------

def test_preview_config_needs_no_discord_settings(preview):
    config = AuthConfig.from_env()
    assert config.via_site and config.problems() == []


@pytest.mark.parametrize("value", ["dev.tfminecraft.net", "https://dev.tfminecraft.net/api", PREVIEW])
def test_preview_config_refuses_a_bad_sign_in_site(preview, monkeypatch, value):
    monkeypatch.setenv("SIGN_IN_SITE", value)
    assert AuthConfig.from_env().problems() == ["SIGN_IN_SITE"]


# --------------------
# Preview: start and callback
# --------------------

def test_preview_start_sends_the_browser_to_dev(preview):
    response = preview.get("/auth/discord/start?return_to=/account?tab=x", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith(DEV + "/api/auth/preview/start?")
    query = _query(response)
    assert query["site"] == PREVIEW and query["return_to"] == "/account?tab=x"
    assert response.cookies[STATE] == query["state"]


def test_preview_start_asks_for_a_recheck_when_signed_in(preview):
    assert "recheck" not in _query(preview.get("/auth/discord/start", follow_redirects=False))
    token = preview_sign_in.sign_in(_player())
    preview.cookies.set(SESSION, token, domain="my-branch.tfminecraft.net")
    assert _query(preview.get("/auth/discord/start", follow_redirects=False))["recheck"] == "1"


def test_preview_start_drops_an_offsite_return(preview):
    response = preview.get("/auth/discord/start?return_to=//evil.com", follow_redirects=False)
    assert _query(response)["return_to"] == users.RETURN_DEFAULT


def test_preview_callback_signs_in_with_dev_role_and_check(preview, monkeypatch):
    seen = []

    def fetch(config, ticket):
        seen.append((config.site_origin, ticket))
        return _player()

    monkeypatch.setattr(preview_sign_in, "fetch_player", fetch)
    state = "s" * 43
    preview.cookies.set(STATE, state, domain="my-branch.tfminecraft.net")
    response = preview.get(
        f"/auth/preview/callback?ticket={'t' * 43}&state={state}&return_to=/admin", follow_redirects=False
    )
    assert response.status_code == 302
    assert response.headers["location"] == PREVIEW + "/admin"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert seen == [(PREVIEW, "t" * 43)]
    user = users.session_user(response.cookies[SESSION])
    assert user["role"] == "admin" and user["guild_member"] == 1
    assert user["guild_checked_at"] == "2026-10-10T12:00:00Z"

    preview.cookies.set(SESSION, response.cookies[SESSION], domain="my-branch.tfminecraft.net")
    account = preview.get("/account")
    assert account.status_code == 200
    assert account.json()["user"]["role"] == "admin"


@pytest.mark.parametrize("cookie", [None, "x" * 43])
def test_preview_callback_needs_the_browser_that_started(preview, monkeypatch, cookie):
    monkeypatch.setattr(preview_sign_in, "fetch_player", lambda *a: pytest.fail("ticket redeemed"))
    if cookie:
        preview.cookies.set(STATE, cookie, domain="my-branch.tfminecraft.net")
    response = preview.get(f"/auth/preview/callback?ticket={'t' * 43}&state={'s' * 43}", follow_redirects=False)
    assert response.headers["location"] == PREVIEW + "/account?signin=expired"
    assert SESSION not in response.cookies


def test_preview_callback_reports_a_refused_ticket(preview, monkeypatch):
    monkeypatch.setattr(preview_sign_in, "fetch_player", lambda *a: None)
    preview.cookies.set(STATE, "s" * 43, domain="my-branch.tfminecraft.net")
    response = preview.get(f"/auth/preview/callback?ticket={'t' * 43}&state={'s' * 43}", follow_redirects=False)
    assert response.headers["location"] == PREVIEW + "/account?signin=error"
    assert SESSION not in response.cookies


def test_preview_has_no_discord_callback(preview):
    assert preview.get("/auth/discord/callback?code=x&state=y").status_code == 404


def test_dev_has_no_preview_callback(dev):
    assert dev.get(f"/auth/preview/callback?ticket={'t' * 43}&state={'s' * 43}").status_code == 404


# --------------------
# Dev: start and redeem
# --------------------

def test_dev_start_signs_in_first_then_returns_here(dev):
    state = "s" * 43
    response = dev.get(
        "/auth/preview/start", params={"site": PREVIEW, "state": state, "return_to": "/admin"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://discord.com/oauth2/authorize?")
    discord_state = _query(response)["state"]
    saved = users.consume_state(discord_state)
    assert saved == routes.PREVIEW_START_PATH + f"?site=https%3A%2F%2Fmy-branch.tfminecraft.net&state={state}&return_to=%2Fadmin"


def test_dev_start_drops_a_return_too_long_to_save(dev):
    response = dev.get(
        "/auth/preview/start", params={"site": PREVIEW, "state": "s" * 43, "return_to": "/" + "a" * 480},
        follow_redirects=False,
    )
    saved = users.consume_state(_query(response)["state"])
    assert saved.startswith(routes.PREVIEW_START_PATH) and "return_to" not in saved


def test_dev_start_hands_a_signed_in_player_to_the_preview(dev):
    _dev_session(dev)
    state = "s" * 43
    response = dev.get(
        "/auth/preview/start", params={"site": PREVIEW, "state": state, "return_to": "/admin"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"].startswith(PREVIEW + "/api/auth/preview/callback?")
    assert response.headers["referrer-policy"] == "no-referrer"
    query = _query(response)
    assert query["state"] == state and query["return_to"] == "/admin"

    redeemed = dev.post("/auth/preview/redeem", json={"ticket": query["ticket"], "site": PREVIEW})
    assert redeemed.status_code == 200
    body = redeemed.json()
    assert body["discord_user_id"] == DISCORD_ID and body["role"] == "player" and body["guild_member"] is True
    assert dev.post("/auth/preview/redeem", json={"ticket": query["ticket"], "site": PREVIEW}).status_code == 410


@pytest.mark.parametrize("params", [
    {"site": "https://www.tfminecraft.net", "state": "s" * 43},
    {"site": "https://evil.com", "state": "s" * 43},
    {"site": PREVIEW, "state": "short"},
    {"site": PREVIEW},
])
def test_dev_start_refuses_other_sites_and_bad_states(dev, params):
    _dev_session(dev)
    assert dev.get("/auth/preview/start", params=params, follow_redirects=False).status_code == 404


def test_dev_start_refuses_a_malformed_site_without_failing(dev):
    response = dev.get("/auth/preview/start", params={"site": "https://[", "state": "s" * 43}, follow_redirects=False)
    assert response.status_code == 404
    assert dev.post("/auth/preview/redeem", json={"ticket": "t" * 43, "site": "https://["}).status_code == 404


def _age_check(minutes):
    stamp = users._iso(users._utcnow() - timedelta(minutes=minutes))
    with connect() as conn:
        conn.execute("UPDATE user_sessions SET guild_checked_at = ?", (stamp,))
        conn.commit()
    return stamp


def _start(dev):
    return dev.get("/auth/preview/start", params={"site": PREVIEW, "state": "s" * 43}, follow_redirects=False)


def test_dev_start_signs_in_again_when_a_stale_check_cannot_be_refreshed(dev):
    _dev_session(dev)
    _age_check(60)
    response = _start(dev)
    assert response.headers["location"].startswith("https://discord.com/oauth2/authorize?")
    assert users.consume_state(_query(response)["state"]).startswith(routes.PREVIEW_START_PATH)


def test_dev_start_refreshes_a_stale_check_with_the_bot(dev, monkeypatch):
    monkeypatch.setattr(guild_check, "_ask", lambda discord_id, http: (True, 0.0))
    _dev_session(dev)
    old = _age_check(60)
    response = _start(dev)
    assert response.headers["location"].startswith(PREVIEW + "/api/auth/preview/callback?")
    player = preview_sign_in.redeem(_query(response)["ticket"], PREVIEW)
    assert player["guild_member"] is True and player["guild_checked_at"] > old


def test_dev_start_rechecks_a_recent_non_member_once(dev):
    _dev_session(dev, guild_member=False)
    params = {"site": PREVIEW, "state": "s" * 43, "recheck": "1"}
    response = dev.get("/auth/preview/start", params=params, follow_redirects=False)
    assert response.headers["location"].startswith("https://discord.com/oauth2/authorize?")
    saved = users.consume_state(_query(response)["state"])
    assert saved.startswith(routes.PREVIEW_START_PATH) and "recheck" not in saved


def test_dev_start_trusts_the_bot_on_a_recheck(dev, monkeypatch):
    monkeypatch.setattr(guild_check, "_ask", lambda discord_id, http: (True, 0.0))
    _dev_session(dev, guild_member=False)
    params = {"site": PREVIEW, "state": "s" * 43, "recheck": "1"}
    response = dev.get("/auth/preview/start", params=params, follow_redirects=False)
    assert preview_sign_in.redeem(_query(response)["ticket"], PREVIEW)["guild_member"] is True


def test_dev_start_hands_over_a_recent_non_member_without_looping(dev):
    _dev_session(dev, guild_member=False)
    response = _start(dev)
    assert response.headers["location"].startswith(PREVIEW + "/api/auth/preview/callback?")
    assert preview_sign_in.redeem(_query(response)["ticket"], PREVIEW)["guild_member"] is False


def test_dev_start_is_off_without_the_setting(dev, monkeypatch):
    monkeypatch.delenv("PREVIEW_SIGN_IN_DOMAIN")
    _dev_session(dev)
    response = dev.get("/auth/preview/start", params={"site": PREVIEW, "state": "s" * 43}, follow_redirects=False)
    assert response.status_code == 404


def test_tickets_are_for_one_site_and_expire(dev, monkeypatch):
    _dev_session(dev)
    user = users.session_user(dev.cookies.get(SESSION))
    other = "https://other.tfminecraft.net"
    assert preview_sign_in.redeem(preview_sign_in.issue(PREVIEW, user), other) is None

    ticket = preview_sign_in.issue(PREVIEW, user)
    later = users._utcnow() + preview_sign_in.TICKET_TTL + timedelta(seconds=1)
    monkeypatch.setattr(users, "_utcnow", lambda: later)
    assert preview_sign_in.redeem(ticket, PREVIEW) is None


def test_tickets_are_stored_hashed(dev):
    _dev_session(dev)
    ticket = preview_sign_in.issue(PREVIEW, users.session_user(dev.cookies.get(SESSION)))
    with connect() as conn:
        stored = [row[0] for row in conn.execute("SELECT ticket_hash FROM preview_sign_in_tickets")]
    assert stored and ticket not in stored


def test_redeem_refuses_other_sites(dev):
    assert dev.post("/auth/preview/redeem", json={"ticket": "t" * 43, "site": DEV}).status_code == 404


# --------------------
# Preview asks dev
# --------------------

def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_player_posts_the_ticket_and_site(preview):
    seen = []

    def handler(request):
        seen.append((str(request.url), request.read()))
        return httpx.Response(200, json=_player())

    player = preview_sign_in.fetch_player(AuthConfig.from_env(), "t" * 43, _client(handler))
    assert player == _player()
    assert seen[0][0] == DEV + "/api/auth/preview/redeem"
    assert b'"site":"https://my-branch.tfminecraft.net"' in seen[0][1].replace(b" ", b"")


@pytest.mark.parametrize("answer", [
    httpx.Response(410, json={"detail": "ticket_invalid"}),
    httpx.Response(200, text="not json"),
    httpx.Response(200, json=[]),
    httpx.Response(200, json=_player(discord_user_id="12ab")),
    httpx.Response(200, json=_player(role="owner")),
    httpx.Response(200, json=_player(guild_member="yes")),
    httpx.Response(200, json=_player(guild_checked_at=None)),
    httpx.Response(200, json=_player(guild_checked_at="yesterday")),
])
def test_fetch_player_refuses_odd_answers(preview, answer):
    assert preview_sign_in.fetch_player(AuthConfig.from_env(), "t" * 43, _client(lambda r: answer)) is None


def test_fetch_player_survives_dev_being_down(preview):
    def handler(request):
        raise httpx.ConnectError("down")

    assert preview_sign_in.fetch_player(AuthConfig.from_env(), "t" * 43, _client(handler)) is None
