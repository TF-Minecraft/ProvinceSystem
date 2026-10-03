import hashlib
import hmac
import json
import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import characters_routes
from src.api import patreon_routes as routes
from src.patreon import linking
from src.patreon.client import PatreonError
from src.patreon.resolver import iso, parse, utcnow
from src.patreon import service as s
from src.patreon.test_service import CONFIG, member as patron, player, sync, changes, ack

STAFF = {"X-Staff-Key": "staff-test"}
PLUGIN = {"X-Plugin-Key": "plugin-test"}
SECRET_CODE = "oauth-code-should-not-leak"
SECRET_TOKEN = "patron-access-secret"
SECRET_REFRESH = "patron-refresh-secret"
SECRET_NAME = "NameShouldNotLeak"
SECRET_EMAIL = "leak-me@example.com"


class Stub:
    def __init__(self, user_id="1", rows=None, fail=None):
        self.user_id, self.rows, self.fail = user_id, rows, fail
        self.exchange_calls, self.identity_calls, self.member_calls = [], [], []
        self.saw_pending = False
        self.heartbeat = None
        self.closed = False

    def exchange_authorization_code(self, code, redirect_uri=None):
        self.exchange_calls.append((code, redirect_uri))
        if self.fail == "exchange":
            raise PatreonError("patreon_http_failed")
        return {"access_token": SECRET_TOKEN, "refresh_token": SECRET_REFRESH, "expires_in": 3600}

    def identity(self, access_token):
        self.identity_calls.append(access_token)
        if self.fail == "identity":
            raise PatreonError("patreon_bad_identity")
        return {"type": "user", "id": self.user_id, "attributes": {"full_name": SECRET_NAME}}

    def members(self):
        self.member_calls.append(True)
        if self.fail == "sync":
            raise PatreonError("patreon_http_failed")
        return list(self.rows or [])

    def member(self, member_id):
        with s.db.connect() as conn:
            self.saw_pending = bool(conn.execute("SELECT 1 FROM patreon_webhook_members WHERE member_id=?", (member_id,)).fetchone())
        return patron(tier="ascended")

    def close(self):
        self.closed = True


@pytest.fixture
def api(database, monkeypatch):
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    monkeypatch.setenv("PATREON_CLIENT_ID", "client-id")
    monkeypatch.setenv("PATREON_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("PATREON_REDIRECT_URI", "https://www.tfminecraft.net/api/patreon/oauth/callback")
    monkeypatch.setenv("PATREON_PUBLIC_SITE_URL", "https://www.tfminecraft.net")
    monkeypatch.setenv("PATREON_API_BASE", "https://stub.invalid")
    monkeypatch.setenv("PATREON_WEBHOOK_SECRET", "hook-secret")
    monkeypatch.setenv("STAFF_KEY", "staff-test")
    monkeypatch.setenv("PLUGIN_KEY", "plugin-test")
    app = FastAPI()
    app.include_router(routes.patreon_router)
    return TestClient(app)


def start(api, mode, monkeypatch, body=None):
    if mode == "staff":
        response = api.post("/patreon/link/start", json=body or {"discord_user_id": "111", "discord_username": "secret-discord-name"}, headers=STAFF)
    elif mode == "plugin":
        response = api.post("/patreon/link/start", json=body or {"player_uuid": player(), "minecraft_name": "SecretSteve"}, headers=PLUGIN)
    else:
        monkeypatch.setattr(characters_routes, "get_session", lambda token: {"player_uuid": player(), "scope": "profile"} if token == "valid" else None)
        response = api.post("/patreon/link/start", json=body if body is not None else {"player_uuid": player(99), "minecraft_name": "SecretSteve"}, headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200, response.text
    return response.json()


def state_of(body):
    parts = urlsplit(body["authorize_url"])
    return parts, parse_qs(parts.query)


def callback(api, state, **params):
    return api.get("/patreon/oauth/callback", params={"state": state, **params}, follow_redirects=False)


def redirect_query(response):
    assert response.status_code == 302, response.text
    parts = urlsplit(response.headers["location"])
    assert "tier=" in parts.query
    return parts, parse_qs(parts.query, keep_blank_values=True)


def assert_clean(response, caplog, *secrets):
    ours = "\n".join(record.getMessage() for record in caplog.records if record.name == "patreon")
    blob = response.headers.get("location", "") + response.text + ours
    for secret in secrets:
        assert secret not in blob


@pytest.mark.parametrize("mode", ["staff", "plugin", "profile"])
def test_link_happy_path_each_auth_mode(api, monkeypatch, caplog, mode):
    caplog.set_level(logging.INFO)
    sync([patron(discord=None)])
    stub = Stub()
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    body = start(api, mode, monkeypatch)
    parts, query = state_of(body)
    assert parts.scheme == "https" and parts.netloc == "www.patreon.com" and parts.path == "/oauth2/authorize"
    assert query["response_type"] == ["code"] and query["client_id"] == ["client-id"]
    assert query["redirect_uri"] == ["https://www.tfminecraft.net/api/patreon/oauth/callback"]
    assert query["scope"] == ["identity"]
    token = query["state"][0]
    assert timedelta(minutes=9) < parse(body["expires_at"]) - utcnow() <= timedelta(minutes=10, seconds=2)
    with s.db.connect() as conn:
        row = conn.execute("SELECT * FROM patreon_oauth_states").fetchone()
        assert token not in "".join(str(value) for value in tuple(row))
        assert row["state_hash"] == hashlib.sha256(token.encode()).hexdigest() and row["used_at"] is None
        if mode == "staff":
            assert row["discord_user_id"] == "111" and row["player_uuid"] is None
        else:
            assert row["player_uuid"] == player() and row["discord_user_id"] is None
    assert "secret-discord-name" not in body["authorize_url"] and "SecretSteve" not in body["authorize_url"]
    response = callback(api, token, code=SECRET_CODE)
    location, redirected = redirect_query(response)
    assert location.scheme == "https" and location.netloc == "www.tfminecraft.net" and location.path == "/patreon/linked"
    assert redirected == {"status": ["ok"], "tier": ["noble"]}
    assert stub.exchange_calls == [(SECRET_CODE, None)] and stub.identity_calls == [SECRET_TOKEN] and stub.member_calls == []
    assert stub.closed
    with s.db.connect() as conn:
        link = conn.execute("SELECT * FROM patreon_links").fetchone()
        assert link["patreon_user_id"] == "1" and link["method"] == "oauth" and link["active"] == 1
        if mode == "staff":
            assert link["discord_user_id"] == "111" and link["player_uuid"] is None
        else:
            assert link["player_uuid"] == player() and link["discord_user_id"] is None
        assert conn.execute("SELECT used_at FROM patreon_oauth_states").fetchone()[0]
    assert SECRET_TOKEN.encode() not in s.db.DB_PATH.read_bytes()
    assert_clean(response, caplog, SECRET_CODE, SECRET_TOKEN, SECRET_REFRESH, SECRET_NAME, SECRET_EMAIL, "patron1@example.com", token)


def test_expired_and_reused_state(api, monkeypatch):
    sync([patron(discord=None)])
    stub = Stub()
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    token = state_of(start(api, "staff", monkeypatch))[1]["state"][0]
    with s.db.connect() as conn:
        conn.execute("UPDATE patreon_oauth_states SET expires_at=?", (iso(utcnow() - timedelta(minutes=1)),))
    expired = callback(api, token, code=SECRET_CODE)
    assert redirect_query(expired)[1]["status"] == ["expired"] and redirect_query(expired)[1]["tier"] == [""]
    assert stub.exchange_calls == []
    fresh = state_of(start(api, "staff", monkeypatch))[1]["state"][0]
    assert redirect_query(callback(api, fresh, code=SECRET_CODE))[1]["status"] == ["ok"]
    again = callback(api, fresh, code=SECRET_CODE)
    assert redirect_query(again)[1]["status"] == ["expired"]
    assert len(stub.exchange_calls) == 1


def test_denied_consumes_state_without_leaking_the_reason(api, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(linking, "build_client", lambda config=None: (_ for _ in ()).throw(AssertionError("client")))
    token = state_of(start(api, "staff", monkeypatch))[1]["state"][0]
    response = api.get("/patreon/oauth/callback", params={"error": "access_denied", "error_description": SECRET_EMAIL, "state": token}, follow_redirects=False)
    assert redirect_query(response)[1] == {"status": ["denied"], "tier": [""]}
    assert_clean(response, caplog, SECRET_EMAIL, token)
    assert redirect_query(callback(api, token, code=SECRET_CODE))[1]["status"] == ["expired"]


def test_already_linked_and_relink_cooldown(api, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    stub = Stub(user_id="incoming-user")
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    assert s.create_or_update_link("owner-user", "discord-taken", config=CONFIG) == "ok"
    token = state_of(start(api, "staff", monkeypatch, {"discord_user_id": "discord-taken"}))[1]["state"][0]
    owned = callback(api, token, code=SECRET_CODE)
    assert redirect_query(owned)[1] == {"status": ["already_linked"], "tier": [""]}
    assert stub.member_calls == []
    assert_clean(owned, caplog, "incoming-user", "owner-user", "discord-taken", SECRET_TOKEN, SECRET_CODE)
    stub.user_id = "moving-user"
    assert s.create_or_update_link("moving-user", "discord-self", config=CONFIG) == "ok"
    token = state_of(start(api, "staff", monkeypatch, {"discord_user_id": "discord-moved"}))[1]["state"][0]
    moved = callback(api, token, code=SECRET_CODE)
    assert redirect_query(moved)[1] == {"status": ["relink_cooldown"], "tier": [""]}
    assert_clean(moved, caplog, "moving-user", "discord-self", "discord-moved", SECRET_TOKEN)


@pytest.mark.parametrize("fail", ["exchange", "identity"])
def test_token_and_identity_failures_redirect_error(api, monkeypatch, caplog, fail):
    caplog.set_level(logging.INFO)
    stub = Stub(fail=fail)
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    token = state_of(start(api, "staff", monkeypatch))[1]["state"][0]
    response = callback(api, token, code=SECRET_CODE)
    assert redirect_query(response)[1] == {"status": ["error"], "tier": [""]}
    assert_clean(response, caplog, SECRET_CODE, SECRET_TOKEN, SECRET_REFRESH, SECRET_NAME)
    assert SECRET_TOKEN.encode() not in s.db.DB_PATH.read_bytes()
    assert redirect_query(callback(api, token, code=SECRET_CODE))[1]["status"] == ["expired"]
    if fail == "exchange":
        assert stub.identity_calls == []


@pytest.mark.parametrize("tier,status_name", [(None, "not_a_member"), ("noble", "ok")])
def test_unknown_member_syncs_before_ok_or_not_a_member(api, monkeypatch, tier, status_name):
    stub = Stub(rows=[patron(tier=tier, status=None if tier is None else "active_patron", discord=None)])
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    token = state_of(start(api, "staff", monkeypatch))[1]["state"][0]
    response = callback(api, token, code=SECRET_CODE)
    location = redirect_query(response)[1]
    assert stub.member_calls == [True]
    assert location["status"] == [status_name]
    assert location["tier"] == ["noble" if tier else ""]
    assert "patron1@example.com" not in response.headers["location"] and SECRET_TOKEN not in response.headers["location"]


def test_member_sync_failure_is_error(api, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    stub = Stub(rows=[], fail="sync")
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    token = state_of(start(api, "staff", monkeypatch))[1]["state"][0]
    response = callback(api, token, code=SECRET_CODE)
    assert redirect_query(response)[1]["status"] == ["error"]
    assert_clean(response, caplog, SECRET_TOKEN, SECRET_CODE, "patreon_http_failed")


def sign(raw, secret="hook-secret"):
    return hmac.new(secret.encode(), raw, hashlib.md5).hexdigest()


def test_webhook_good_signature_refreshes_after_recording(api, monkeypatch):
    sync([patron()])
    ack(changes())
    stub = Stub()
    monkeypatch.setattr(linking, "build_client", lambda config=None: stub)
    raw = json.dumps({"data": {"id": "m1", "type": "member", "attributes": {"email": SECRET_EMAIL, "full_name": SECRET_NAME}}}).encode()
    response = api.post("/patreon/webhook", content=raw, headers={"X-Patreon-Signature": sign(raw), "X-Patreon-Event": "members:pledge:update"})
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert SECRET_EMAIL not in response.text and SECRET_NAME not in response.text
    assert stub.saw_pending and stub.closed
    assert changes()[0]["add_tier"] == "ascended"
    with s.db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM patreon_webhook_members").fetchone()[0] == 0


@pytest.mark.parametrize("signature", ["0" * 32, "abcd", None])
def test_webhook_bad_signature(api, monkeypatch, caplog, signature):
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(linking, "build_client", lambda config=None: (_ for _ in ()).throw(AssertionError("client")))
    raw = json.dumps({"data": {"id": "m1", "type": "member", "attributes": {"email": SECRET_EMAIL}}}).encode()
    headers = {"X-Patreon-Event": "members:pledge:update"}
    if signature is not None:
        headers["X-Patreon-Signature"] = signature
    response = api.post("/patreon/webhook", content=raw, headers=headers)
    assert response.status_code == 401 and response.json()["detail"] == "invalid_signature"
    assert SECRET_EMAIL not in response.text and SECRET_EMAIL not in caplog.text
    with s.db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM patreon_webhook_members").fetchone()[0] == 0


def test_webhook_missing_secret(api, monkeypatch):
    monkeypatch.setenv("PATREON_WEBHOOK_SECRET", "")
    response = api.post("/patreon/webhook", content=b"{}", headers={"X-Patreon-Signature": "abc", "X-Patreon-Event": "members:pledge:update"})
    assert response.status_code == 503 and response.json()["detail"] == "patreon_webhook_unconfigured"


def test_webhook_unknown_event_is_ignored(api, monkeypatch):
    monkeypatch.setattr(linking, "build_client", lambda config=None: (_ for _ in ()).throw(AssertionError("client")))
    raw = b"not-json " + SECRET_EMAIL.encode()
    response = api.post("/patreon/webhook", content=raw, headers={"X-Patreon-Signature": sign(raw), "X-Patreon-Event": "campaigns:update"})
    assert response.status_code == 200 and response.json() == {"ok": True}
    with s.db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM patreon_webhook_members").fetchone()[0] == 0


def test_webhook_busy_refresh_is_retained_and_retried(api, monkeypatch):
    calls = {"n": 0}

    def refresh(member_id, **kwargs):
        calls["n"] += 1
        assert member_id == "m9"
        return {"ok": False, "detail": "patreon_sync_busy"} if calls["n"] == 1 else {"ok": True, "members": 1, "brake_held": False}

    monkeypatch.setattr(s, "refresh_member", refresh)
    monkeypatch.setattr(linking, "build_client", lambda config=None: Stub())
    raw = b'{"data":{"type":"member","id":"m9"}}'
    response = api.post("/patreon/webhook", content=raw, headers={"X-Patreon-Signature": sign(raw), "X-Patreon-Event": "members:pledge:create"})
    assert response.status_code == 200 and calls["n"] == 1
    with s.db.connect() as conn:
        assert conn.execute("SELECT member_id FROM patreon_webhook_members").fetchone()[0] == "m9"
    linking.retry_pending_webhooks()
    assert calls["n"] == 2
    with s.db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM patreon_webhook_members").fetchone()[0] == 0


def test_public_callbacks_disabled(api, monkeypatch):
    monkeypatch.setenv("PATREON_ENABLED", "0")
    assert api.get("/patreon/oauth/callback", follow_redirects=False).status_code == 503
    assert api.post("/patreon/webhook", content=b"{}").json()["detail"] == "patreon_disabled"
