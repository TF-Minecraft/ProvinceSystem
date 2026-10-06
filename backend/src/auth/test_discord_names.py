import httpx
import pytest

from src.auth import discord_names
from src.auth.discord_names import BotConfig, BotTokenRejected, NameLookup

CONFIG = BotConfig(token="bot-token", guild_id="999", api_base="https://discord.test/api")


def lookup(handler):
    return NameLookup(CONFIG, http=httpx.Client(transport=httpx.MockTransport(handler)))


def link(db, discord_id, username=None, nickname=None):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO discord_links (player_uuid, discord_user_id, minecraft_name, discord_username, linked_at, "
            "discord_nickname) VALUES (?, ?, 'mc', ?, '2026-09-20T10:00:00Z', ?)",
            (f"uuid-{discord_id}", discord_id, username, nickname))
        conn.commit()


def names(db, discord_id):
    with db.connect() as conn:
        row = conn.execute("SELECT discord_username, discord_nickname FROM discord_links WHERE discord_user_id = ?",
                           (discord_id,)).fetchone()
    return row["discord_username"], row["discord_nickname"]


def discord(members: dict, users: dict, seen: list | None = None):
    def handler(request):
        assert request.headers["authorization"] == "Bot bot-token"
        if seen is not None:
            seen.append(request.url.path)
        parts = request.url.path.split("/")
        if "/guilds/999/members/" in request.url.path:
            member = members.get(parts[-1])
            return httpx.Response(200, json=member) if member else httpx.Response(404, json={"code": 10007})
        user = users.get(parts[-1])
        return httpx.Response(200, json=user) if user else httpx.Response(404, json={"code": 10013})
    return handler


def test_member_gives_handle_and_nickname_user_gives_handle_only(database):
    link(database, "1", None, "Justin")
    link(database, "2", None, "Old nick")
    link(database, "3", "stale_name", None)
    found = lookup(discord(
        members={"1": {"user": {"id": "1", "username": "justin_x"}, "nick": "Justin the Bold"},
                 "3": {"user": {"id": "3", "username": "fresh_name"}, "nick": None}},
        users={"2": {"id": "2", "username": "left_server"}},
    ))
    assert discord_names.refresh_all(found) == 3
    assert names(database, "1") == ("justin_x", "Justin the Bold")
    # Not in the server: the handle, and the last nickname we knew.
    assert names(database, "2") == ("left_server", "Old nick")
    # A member with no nickname now has none.
    assert names(database, "3") == ("fresh_name", None)


def test_waits_out_rate_limits_and_stops_on_a_bad_token(monkeypatch):
    monkeypatch.setattr(discord_names.time, "sleep", lambda s: None)
    calls = []

    def limited(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, json={"retry_after": 0.5})
        return httpx.Response(200, json={"user": {"username": "after_wait"}, "nick": "N"})
    assert lookup(limited).lookup("1") == {"username": "after_wait", "nickname": "N", "in_server": True}

    with pytest.raises(BotTokenRejected):
        lookup(lambda request: httpx.Response(401, json={})).lookup("1")
    assert lookup(lambda request: httpx.Response(200, json={})).lookup("not-a-snowflake") is None


def test_profile_looks_up_an_unknown_handle_once(database, monkeypatch):
    discord_names.clear_recent()
    link(database, "42")
    seen = []
    handler = discord({"42": {"user": {"username": "found_it"}, "nick": "Fi"}}, {}, seen)
    monkeypatch.setattr(discord_names, "NameLookup",
                        lambda config, timeout: NameLookup(CONFIG, http=httpx.Client(transport=httpx.MockTransport(handler))))
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    assert discord_names.refresh_one("42") is True
    assert names(database, "42") == ("found_it", "Fi")
    # Asked again within the retry window: not looked up again.
    assert discord_names.refresh_one("42") is False
    assert len(seen) == 1

    monkeypatch.delenv("DISCORD_BOT_TOKEN")
    discord_names.clear_recent()
    assert discord_names.refresh_one("42") is False
