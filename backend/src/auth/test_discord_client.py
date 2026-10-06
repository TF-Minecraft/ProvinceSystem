import json
import logging

import httpx
import pytest

from src.auth.config import AuthConfig
from src.auth.discord import DiscordClient, DiscordError

CONFIG = AuthConfig(
    enabled=True, client_id="cid", client_secret="csecret",
    redirect_uri="https://www.tfminecraft.net/api/auth/discord/callback",
    guild_id="999", site_url="https://www.tfminecraft.net", api_base="https://discord.test/api",
)


def client(handler):
    return DiscordClient(CONFIG, httpx.Client(transport=httpx.MockTransport(handler)))


def test_exchange_posts_code_with_basic_auth():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"access_token": "tok", "token_type": "Bearer"})

    assert client(handler).exchange_code("abc") == "tok"
    assert seen["url"] == "https://discord.test/api/oauth2/token"
    assert seen["auth"].startswith("Basic ")
    assert "grant_type=authorization_code" in seen["body"] and "code=abc" in seen["body"]
    assert "redirect_uri=https%3A%2F%2Fwww.tfminecraft.net%2Fapi%2Fauth%2Fdiscord%2Fcallback" in seen["body"]


@pytest.mark.parametrize("response", [
    httpx.Response(400, json={"error": "invalid_grant"}),
    httpx.Response(200, text="not json"),
    httpx.Response(200, json={"access_token": ""}),
    httpx.Response(200, json=["x"]),
])
def test_exchange_failures_are_stable_codes(response):
    with pytest.raises(DiscordError) as exc:
        client(lambda request: response).exchange_code("abc")
    assert str(exc.value).startswith("discord_")


def test_network_failure():
    def handler(request):
        raise httpx.ConnectError("boom")
    with pytest.raises(DiscordError, match="discord_http_failed"):
        client(handler).exchange_code("abc")
    with pytest.raises(DiscordError, match="discord_http_failed"):
        client(handler).identity("tok")


def test_identity_keeps_snowflake_as_string_and_bounds_text():
    body = json.dumps({"id": "123456789012345678", "username": "steve", "global_name": "S" * 200, "avatar": None})

    def handler(request):
        assert request.headers["authorization"] == "Bearer tok"
        assert request.url.path == "/api/users/@me"
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})

    identity = client(handler).identity("tok")
    assert identity == {"discord_user_id": "123456789012345678", "discord_username": "steve",
                        "discord_global_name": "S" * 64, "discord_avatar": None}


@pytest.mark.parametrize("payload,status", [
    ({"id": 123}, 200), ({"id": "12a"}, 200), ({"id": "1" * 21}, 200), ({}, 200), ({"id": "1"}, 401),
])
def test_identity_rejects_bad_ids(payload, status):
    with pytest.raises(DiscordError):
        client(lambda request: httpx.Response(status, json=payload)).identity("tok")


@pytest.mark.parametrize("response,member", [
    (httpx.Response(200, json={"roles": []}), True),
    (httpx.Response(200, json={"pending": False}), True),
    (httpx.Response(200, json={"pending": True}), False),
    (httpx.Response(404, json={"code": 10004}), False),
])
def test_guild_membership(response, member):
    def handler(request):
        assert request.url.path == "/api/users/@me/guilds/999/member"
        return response
    assert client(handler).is_guild_member("tok") is member


@pytest.mark.parametrize("response", [httpx.Response(500), httpx.Response(200, text="nope"), httpx.Response(200, json=[1])])
def test_guild_check_errors(response):
    with pytest.raises(DiscordError, match="discord_guild_check_failed"):
        client(lambda request: response).is_guild_member("tok")


def test_revoke_is_best_effort():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        raise httpx.ConnectError("boom")

    c = client(handler)
    c.revoke("tok")
    c.close()
    assert calls == ["/api/oauth2/token/revoke"]


def test_access_log_filter_redacts_callback_queries():
    import server

    def record(path):
        r = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("1.2.3.4:5", "GET", path, "1.1", 302), None)
        server._OAuthQueryFilter().filter(r)
        return r.getMessage()

    assert "secret" not in record("/auth/discord/callback?code=secret&state=s")
    assert "secret" not in record("/patreon/oauth/callback?code=secret")
    assert "?q=keep" in record("/maps?q=keep")
