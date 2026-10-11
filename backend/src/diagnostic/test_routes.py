"""The /diagnostic page's checks and the reports players send to staff."""
import hashlib
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import diagnostic_routes
from src.auth.test_admin import account, client
from src.diagnostic import reports
from src.diagnostic.pack import PackMirror
from src.diagnostic.server_ping import ServerStatus

ONLINE = ServerStatus(online=True, address="play.example:25565", ip="203.0.113.5", version="Velocity", players_online=3, players_max=100)


@pytest.fixture
def pack_source(tmp_path):
    source = tmp_path / "generated.zip"
    source.write_bytes(b"PK" + b"x" * 5000)
    return source


@pytest.fixture
def app(database, monkeypatch, tmp_path, pack_source):
    monkeypatch.setenv("DISCORD_AUTH_ENABLED", "1")
    monkeypatch.setenv("DISCORD_CLIENT_ID", "client-id")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("DISCORD_GUILD_ID", "999999999999999999")
    monkeypatch.setenv("SITE_PUBLIC_URL", "https://www.tfminecraft.net")
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("PS_PRODUCTION", raising=False)
    monkeypatch.setattr(diagnostic_routes, "pack_mirror", PackMirror(pack_source.as_uri(), tmp_path / "mirror"))
    monkeypatch.setattr(diagnostic_routes, "ping", mock.Mock(return_value=ONLINE))
    monkeypatch.setattr(diagnostic_routes, "_ping_cache", None)
    diagnostic_routes._RATE_BUCKETS.clear()
    app = FastAPI()
    app.include_router(diagnostic_routes.diagnostic_router)
    return app


def test_status_reports_server_pack_and_country(app, pack_source):
    res = client(app).get("/diagnostic/status", headers={"CF-IPCountry": "ph"})
    body = res.json()
    sha1 = hashlib.sha1(pack_source.read_bytes()).hexdigest()
    assert res.headers["cache-control"] == "no-store"
    assert body["client"] == {"country": "PH"}
    assert body["server"]["online"] and body["server"]["ip"] == "203.0.113.5"
    assert body["pack"]["sha1"] == sha1 and body["pack"]["size"] == 5002
    assert body["pack"]["url"] == f"diagnostic/pack/{sha1}.zip" and not body["pack"]["stale"]


def test_unknown_country_is_left_out(app):
    assert client(app).get("/diagnostic/status", headers={"CF-IPCountry": "XX"}).json()["client"] == {"country": None}


def test_server_ping_is_cached(app):
    c = client(app)
    c.get("/diagnostic/status")
    c.get("/diagnostic/status")
    assert diagnostic_routes.ping.call_count == 1


def test_server_route_skips_the_pack_and_the_ip(app, monkeypatch):
    current = mock.Mock()
    monkeypatch.setattr(diagnostic_routes.pack_mirror, "current", current)
    res = client(app).get("/diagnostic/server")
    assert res.headers["cache-control"] == "no-store"
    assert res.json() == {
        "address": "play.example:25565",
        "online": True,
        "players_online": 3,
        "players_max": 100,
        "game_version": diagnostic_routes.GAME_VERSION,
    }
    current.assert_not_called()


def test_pack_download_is_cacheable_by_hash(app, pack_source):
    c = client(app)
    url = c.get("/diagnostic/status").json()["pack"]["url"]
    res = c.get("/" + url)
    assert res.content == pack_source.read_bytes()
    assert res.headers["content-type"] == "application/zip"
    assert "immutable" in res.headers["cache-control"]
    assert 'filename="TFMC-resource-pack.zip"' in res.headers["content-disposition"]
    assert c.get("/diagnostic/pack/" + "0" * 40 + ".zip").status_code == 404
    assert c.get("/diagnostic/pack/..%2F..%2Fprovince.zip").status_code == 404


def test_mirror_keeps_last_copy_when_the_game_server_is_down(tmp_path, pack_source):
    mirror = PackMirror(pack_source.as_uri(), tmp_path / "mirror", max_age=0)
    first = mirror.current()
    pack_source.unlink()
    assert mirror.current() == first and mirror.error


def test_mirror_keeps_two_newest_packs(tmp_path, pack_source):
    mirror = PackMirror(pack_source.as_uri(), tmp_path / "mirror", max_age=0)
    hashes = []
    for i in range(3):
        pack_source.write_bytes(b"PK" + bytes([i]) * 100)
        hashes.append(mirror.current().sha1)
    assert mirror.path_for(hashes[0]) is None
    assert mirror.path_for(hashes[1]) and mirror.path_for(hashes[2])
    assert mirror.path_for("../../etc/passwd") is None


def test_speed_test_is_random_and_rate_limited(app):
    c = client(app)
    res = c.get("/diagnostic/speed")
    assert len(res.content) == diagnostic_routes.SPEED_TEST_BYTES
    assert res.headers["cache-control"] == "no-store"
    for _ in range(19):
        c.get("/diagnostic/speed")
    assert c.get("/diagnostic/speed").status_code == 429
    assert c.get("/diagnostic/speed", headers={"CF-Connecting-IP": "198.51.100.9"}).status_code == 200


REPORT = {"findings": [{"level": "info", "title": "Built-in graphics"}, {"level": "fail", "title": "The resource pack download failed"}]}


def test_player_sends_a_report_and_staff_read_it(app, database):
    res = client(app).post("/diagnostic/reports", json={"report": REPORT, "minecraft_name": "Nijika_"}, headers={"CF-IPCountry": "PH"})
    code = res.json()["code"]
    assert len(code) == reports.CODE_LENGTH
    _, token = account(database, "mod", role="mod")
    listed = client(app, token).get("/diagnostic/reports").json()["reports"]
    assert listed[0]["code"] == code and listed[0]["worst"] == "fail"
    assert listed[0]["summary"] == "The resource pack download failed"
    assert listed[0]["minecraft_name"] == "Nijika_" and listed[0]["country"] == "PH"
    one = client(app, token).get(f"/diagnostic/reports/{code.lower()}").json()
    assert one["report"] == REPORT


def test_signed_in_player_is_named_on_the_report(app, database):
    user_id, token = account(database, "player")
    with mock.patch.object(diagnostic_routes, "get_link_for_discord_id", return_value={"minecraft_name": "LinkedName"}):
        code = client(app, token).post("/diagnostic/reports", json={"report": REPORT, "minecraft_name": "Typed"}).json()["code"]
    saved = reports.get(code)
    assert saved["user_id"] == user_id and saved["minecraft_name"] == "LinkedName"


def test_reports_are_staff_only(app, database):
    assert client(app).get("/diagnostic/reports").status_code == 401
    _, player = account(database, "player")
    assert client(app, player).get("/diagnostic/reports/ABCDEF").json() == {"detail": "forbidden"}


def test_bad_reports_are_refused(app):
    c = client(app)
    assert c.post("/diagnostic/reports", json={"report": "nope"}).status_code == 400
    assert c.post("/diagnostic/reports", json={"report": REPORT, "minecraft_name": "bad name!"}).status_code == 400
    assert c.post("/diagnostic/reports", content=b"x" * (diagnostic_routes.REPORT_LIMIT + 1)).status_code == 413
    assert c.post("/diagnostic/reports", json={"report": REPORT}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_reports_are_rate_limited(app):
    c = client(app)
    for _ in range(5):
        assert c.post("/diagnostic/reports", json={"report": REPORT}).status_code == 200
    assert c.post("/diagnostic/reports", json={"report": REPORT}).status_code == 429


def test_summary_without_findings():
    assert reports.summarise({}) == ("ok", "No problems found")
    assert reports.summarise({"findings": [{"level": "info", "title": "Running on battery"}]}) == ("info", "Running on battery")
