import httpx
import pytest

from src import database
from src.auth import discord_names
from src.auth import testing as auth_testing
from src.auth.discord_names import BotConfig, BotTokenRejected, NameLookup
from src.skins import testing as skins_testing

CONFIG = BotConfig(token="bot-token", guild_id="999", api_base="https://discord.test/api")


def lookup(handler):
    return NameLookup(CONFIG, http=httpx.Client(transport=httpx.MockTransport(handler)))


def link(discord_id, username=None, nickname=None):
    skins_testing.link(f"uuid-{discord_id}", discord_id, "mc", username, linked_at="2026-09-20T10:00:00Z",
                       discord_nickname=nickname)


def names(discord_id):
    [row] = auth_testing.rows("SELECT discord_username, discord_nickname FROM discord_links WHERE discord_user_id = %s",
                              (discord_id,))
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


def test_member_gives_handle_and_nickname_user_gives_handle_only(postgres):
    link("1", None, "Justin")
    link("2", None, "Old nick")
    link("3", "stale_name", None)
    found = lookup(discord(
        members={"1": {"user": {"id": "1", "username": "justin_x"}, "nick": "Justin the Bold"},
                 "3": {"user": {"id": "3", "username": "fresh_name"}, "nick": None}},
        users={"2": {"id": "2", "username": "left_server"}},
    ))
    assert discord_names.refresh_all(found) == 3
    assert names("1") == ("justin_x", "Justin the Bold")
    # Not in the server: the handle, and the last nickname we knew.
    assert names("2") == ("left_server", "Old nick")
    # A member with no nickname now has none.
    assert names("3") == ("fresh_name", None)


def test_waits_out_rate_limits_and_stops_on_a_bad_token():
    calls = []

    def limited(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, json={"retry_after": 0.01})
        return httpx.Response(200, json={"user": {"username": "after_wait"}, "nick": "N"})
    assert lookup(limited).lookup("1") == {"username": "after_wait", "nickname": "N", "in_server": True}

    with pytest.raises(BotTokenRejected):
        lookup(lambda request: httpx.Response(401, json={})).lookup("1")
    assert lookup(lambda request: httpx.Response(200, json={})).lookup("not-a-snowflake") is None


def test_profile_looks_up_an_unknown_handle_once(postgres, monkeypatch):
    discord_names.clear_recent()
    link("42")
    seen = []
    handler = discord({"42": {"user": {"username": "found_it"}, "nick": "Fi"}}, {}, seen)
    monkeypatch.setattr(discord_names, "NameLookup",
                        lambda config, timeout, max_retry_wait: NameLookup(
                            CONFIG, http=httpx.Client(transport=httpx.MockTransport(handler))))
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")
    assert discord_names.refresh_one("42") is True
    assert names("42") == ("found_it", "Fi")
    # Asked again within the retry window: not looked up again.
    assert discord_names.refresh_one("42") is False
    assert len(seen) == 1

    monkeypatch.delenv("DISCORD_BOT_TOKEN")
    discord_names.clear_recent()
    assert discord_names.refresh_one("42") is False


def test_profile_lookups_do_not_wait_out_rate_limits():
    calls = []

    def limited(request):
        calls.append(1)
        return httpx.Response(429, json={"retry_after": 0.01})
    quick = NameLookup(CONFIG, http=httpx.Client(transport=httpx.MockTransport(limited)), max_retry_wait=0)
    assert quick.lookup("1") is None
    # One try at the member record and one at the user record, no retries.
    assert len(calls) == 2


def test_halting_stops_a_refresh_and_cuts_waits_short(postgres):
    import threading
    import time

    link("1")
    link("2")
    halt = threading.Event()
    calls = []

    def limited(request):
        calls.append(1)
        halt.set()
        return httpx.Response(429, json={"retry_after": 25})
    stopping = NameLookup(CONFIG, http=httpx.Client(transport=httpx.MockTransport(limited)), halt=halt)
    started = time.monotonic()
    assert discord_names.refresh_all(stopping) == 0
    assert time.monotonic() - started < 2
    assert len(calls) == 1


def test_a_database_error_leaves_the_profile_working(postgres, monkeypatch):
    discord_names.clear_recent()
    link("7")
    handler = discord({"7": {"user": {"username": "seven"}, "nick": None}}, {})
    monkeypatch.setattr(discord_names, "NameLookup",
                        lambda config, timeout, max_retry_wait: NameLookup(
                            CONFIG, http=httpx.Client(transport=httpx.MockTransport(handler))))
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token")

    def broken(*args, **kwargs):
        raise database.OperationalError("could not obtain lock")
    monkeypatch.setattr(discord_names, "store", broken)
    assert discord_names.refresh_one("7") is False


def test_a_global_rate_limit_stops_the_whole_refresh(postgres):
    link("1")
    link("2")
    calls = []

    def limited(request):
        calls.append(request.url.path)
        return httpx.Response(429, json={"retry_after": 600, "global": True})
    with pytest.raises(discord_names.GloballyRateLimited):
        discord_names.refresh_all(lookup(limited))
    # No fallback to the user record and no further players.
    assert len(calls) == 1
    # A limit on one route only skips that request.
    calls.clear()

    def route_limited(request):
        calls.append(request.url.path)
        return httpx.Response(429, json={"retry_after": 600, "global": False})
    assert discord_names.refresh_all(lookup(route_limited)) == 0
    assert len(calls) == 4


def test_short_global_limits_that_never_lift_stop_the_refresh(postgres):
    link("1")
    calls = []

    def limited(request):
        calls.append(1)
        return httpx.Response(429, json={"retry_after": 0.01, "global": True})
    with pytest.raises(discord_names.GloballyRateLimited):
        discord_names.refresh_all(lookup(limited))
    assert len(calls) == 3
