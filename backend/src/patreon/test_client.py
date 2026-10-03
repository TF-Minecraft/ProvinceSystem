from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest

from src.patreon.client import PatreonClient, PatreonError
from src.patreon import service as s
from src.patreon.config import Config
from src.patreon.resolver import iso, utcnow

CONFIG = Config(enabled=True, apply=True, api_base="https://stub.invalid", campaign_id="13707169")
FIXTURE = Path(__file__).with_name("test_data")
DOCUMENT = json.loads((FIXTURE / "members_page_anonymised.json").read_text())


def client(handler, config=CONFIG):
    return PatreonClient(config, http=httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.fixture
def tokens(database, monkeypatch):
    for key, value in {"PATREON_CREATOR_ACCESS_TOKEN": "seed-access", "PATREON_CREATOR_REFRESH_TOKEN": "seed-refresh", "PATREON_CLIENT_ID": "client", "PATREON_CLIENT_SECRET": "secret"}.items():
        monkeypatch.setenv(key, value)


def page(index=0):
    doc = deepcopy(DOCUMENT)
    doc["data"] = [deepcopy(DOCUMENT["data"][index])]
    doc["meta"]["pagination"] = {"total": 2, "cursors": {"next": "second" if index == 0 else None}}
    return doc


@pytest.mark.parametrize("use_link", [False, True])
def test_all_pages_by_cursor_and_link(tokens, use_link):
    calls = []
    def handler(request):
        assert request.headers["User-Agent"]
        assert request.headers["Authorization"] == "Bearer seed-access"
        calls.append(request)
        index = 1 if request.url.params.get("page[cursor]") == "second" else 0
        doc = page(index)
        if use_link and not index:
            doc["links"] = {"next": "/api/oauth2/v2/campaigns/13707169/members?page[cursor]=second"}
        return httpx.Response(200, json=doc)
    members = client(handler).members()
    assert len(members) == 2 and len(calls) == 2
    assert calls[0].url.params["page[count]"] == "500"
    assert "is_gifted" in calls[0].url.params["fields[member]"]


@pytest.mark.parametrize("failure", ["http", "json", "document", "truncated", "loop", "external"])
def test_partial_sync_rolls_back_everything(tokens, database, failure):
    with database.connect() as conn:
        s._store_member(conn, {"member_id": "prior", "patreon_user_id": "old", "tiers": [{"id": "25226353"}], "patron_status": "active_patron"}, utcnow(), CONFIG)
        conn.execute("INSERT INTO patreon_applied VALUES ('discord','111','[\"ascended\"]',1,0)")
    def snapshot():
        with database.connect() as conn:
            return [list(map(tuple, conn.execute("SELECT * FROM " + t))) for t in ("patreon_members", "patreon_applied", "patreon_desired", "patreon_changes", "patreon_links")]
    before = snapshot()
    def handler(request):
        if not request.url.params.get("page[cursor]"):
            doc = page()
            if failure == "external":
                doc["links"] = {"next": "https://evil.invalid/steal"}
            return httpx.Response(200, json=doc)
        if failure == "http":
            return httpx.Response(500, text="sensitive@example.com")
        if failure == "json":
            return httpx.Response(200, text="broken secret-token")
        doc = page(1)
        if failure == "document":
            del doc["data"][0]["relationships"]["currently_entitled_tiers"]
        elif failure == "truncated":
            doc["meta"]["pagination"]["total"] = 4
        elif failure == "loop":
            doc["meta"]["pagination"]["cursors"]["next"] = "second"
        return httpx.Response(200, json=doc)
    assert not s.sync_now(config=CONFIG, client=client(handler))["ok"]
    assert snapshot() == before


def test_401_refresh_once_and_database_tokens_are_authoritative(tokens, database, monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        if request.url.path == "/api/oauth2/token":
            body = parse_qs(request.content.decode())
            assert body["grant_type"] == ["refresh_token"] and body["refresh_token"] == ["seed-refresh"]
            assert request.headers["Content-Type"].startswith("application/x-www-form-urlencoded")
            return httpx.Response(200, json={"access_token": "rotated-access", "refresh_token": "rotated-refresh", "expires_in": 3600})
        if request.headers["Authorization"] == "Bearer seed-access":
            return httpx.Response(401)
        return httpx.Response(200, json=DOCUMENT)
    c = client(handler)
    assert len(c.members()) == 154
    assert len(calls) == 3
    monkeypatch.setenv("PATREON_CREATOR_ACCESS_TOKEN", "wrong-env-access")
    monkeypatch.setenv("PATREON_CREATOR_REFRESH_TOKEN", "wrong-env-refresh")
    assert len(client(handler).members()) == 154
    assert len(calls) == 4 and calls[-1].headers["Authorization"] == "Bearer rotated-access"
    with database.connect() as conn:
        assert conn.execute("SELECT refresh_token FROM patreon_tokens").fetchone()[0] == "rotated-refresh"


def test_second_401_not_retried(tokens):
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "new", "refresh_token": "new-refresh", "expires_in": 3600})
        return httpx.Response(401)
    with pytest.raises(PatreonError, match="patreon_unauthorized"):
        client(handler).members()
    assert len(calls) == 3


def test_refresh_failure_keeps_rotating_token_and_alerts(tokens, database, caplog):
    def handler(request):
        return httpx.Response(400, json={"error": "secret-token sensitive@example.com"}) if request.method == "POST" else httpx.Response(401)
    c = client(handler)
    with pytest.raises(PatreonError):
        c.members()
    with database.connect() as conn:
        assert conn.execute("SELECT refresh_token FROM patreon_tokens").fetchone()[0] == "seed-refresh"
    assert s.alerts()["alerts"][0]["kind"] == "token_refresh_failed"
    assert "secret-token" not in caplog.text and "sensitive@example.com" not in caplog.text


def test_expiry_refresh_and_campaign_discovery(tokens, database):
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "new", "refresh_token": "new-refresh", "expires_in": 3600})
        if request.url.path.endswith("campaigns"):
            assert request.url.params["include"] == "tiers"
            return httpx.Response(200, json=json.loads((FIXTURE / "campaigns.json").read_text()))
        return httpx.Response(200, json=DOCUMENT)
    c = client(handler, replace(CONFIG, campaign_id=None))
    c._tokens()
    with database.connect() as conn:
        conn.execute("UPDATE patreon_tokens SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    assert len(c.members()) == 154 and calls[0] == "/api/oauth2/token"


def test_authorization_code_identity_and_member_read(tokens, database):
    def handler(request):
        if request.method == "POST":
            fields = parse_qs(request.content.decode())
            assert fields["grant_type"] == ["authorization_code"] and fields["code"] == ["consent-code"]
            assert fields["redirect_uri"] == ["https://site.invalid/callback"]
            return httpx.Response(200, json={"access_token": "patron-access", "refresh_token": "patron-refresh", "expires_in": 3600})
        if request.url.path.endswith("identity"):
            assert request.headers["Authorization"] == "Bearer patron-access"
            return httpx.Response(200, json={"data": {"type": "user", "id": "123", "attributes": {"full_name": "Patron"}}})
        return httpx.Response(200, json={**DOCUMENT, "data": DOCUMENT["data"][0]})
    c = client(handler)
    value = c.exchange_authorization_code("consent-code", "https://site.invalid/callback")
    assert c.identity(value["access_token"])["id"] == "123"
    assert c.member(DOCUMENT["data"][0]["id"])["patreon_user_id"] == "90000001"
    with database.connect() as conn:
        assert conn.execute("SELECT access_token FROM patreon_tokens").fetchone()[0] == "seed-access"


def test_malformed_token_response_does_not_overwrite(tokens, database):
    c = client(lambda request: httpx.Response(200, json={"access_token": "new", "refresh_token": None, "expires_in": 100}))
    c._tokens()
    with pytest.raises(PatreonError):
        c.refresh_tokens()
    with database.connect() as conn:
        assert conn.execute("SELECT access_token FROM patreon_tokens").fetchone()[0] == "seed-access"


def test_lost_token_refresh_lease_does_not_overwrite_authoritative_tokens(tokens, database):
    def handler(request):
        with database.connect() as conn:
            conn.execute("UPDATE patreon_leases SET owner='other-process' WHERE name='token_refresh'")
            conn.execute("UPDATE patreon_tokens SET access_token='authoritative',refresh_token='authoritative-refresh'")
        return httpx.Response(200, json={"access_token": "stale-access", "refresh_token": "stale-refresh", "expires_in": 1000})
    c = client(handler)
    c._tokens()
    with pytest.raises(PatreonError, match="lease_lost"):
        c.refresh_tokens()
    with database.connect() as conn:
        assert conn.execute("SELECT refresh_token FROM patreon_tokens").fetchone()[0] == "authoritative-refresh"


@pytest.mark.parametrize("field,value", [("user_id", None), ("user_id", ""), ("member_id", None), ("patron_status", "unexpected_status"), ("tier_id", None)])
def test_malformed_identity_or_status_refuses_snapshot(tokens, field, value):
    doc = deepcopy(DOCUMENT)
    row = doc["data"][0]
    if field == "user_id":
        row["relationships"]["user"]["data"]["id"] = value
    elif field == "member_id":
        row["id"] = value
    elif field == "tier_id":
        row["relationships"]["currently_entitled_tiers"]["data"][0]["id"] = value
    else:
        row["attributes"]["patron_status"] = value
    with pytest.raises(PatreonError, match="patreon_bad_document"):
        client(lambda request: httpx.Response(200, json=doc)).members()
