
import httpx
import pytest

from src.api import skins_routes
from src.auth import testing, users
from src.skins.discord_link import remember_discord_nicknames
from src.skins.testing import link as store_link


def link(uuid, discord_id, username, nickname=None):
    store_link(uuid, discord_id, "mc", username, linked_at="2026-09-20T10:00:00Z", discord_nickname=nickname)


def names(discord_id):
    [row] = testing.rows("SELECT discord_username, discord_nickname FROM discord_links WHERE discord_user_id = %s",
                         (discord_id,))
    return row["discord_username"], row["discord_nickname"]






def test_sign_in_stores_handle_and_server_nickname(postgres):
    link("u1", "422", "Justin")
    identity = {"discord_user_id": "422", "discord_username": "justin_x", "discord_global_name": "Justin",
                "discord_avatar": None}
    users.sign_in(identity, guild_member=True, member={"nick": "Justin the Bold"})
    assert names("422") == ("justin_x", "Justin the Bold")
    # A member with no nickname set clears it; a failed membership check leaves it alone.
    users.sign_in(identity, guild_member=True, member={"nick": None})
    assert names("422") == ("justin_x", None)
    remember_discord_nicknames([{"discord_user_id": "422", "discord_nickname": "Justin"}])
    users.sign_in(identity, guild_member=False, member=None)
    assert names("422") == ("justin_x", "Justin")


def test_bot_can_send_nicknames(postgres, monkeypatch):
    monkeypatch.setattr(skins_routes, "_require_staff", lambda key: None)
    link("u1", "1", None, "Old")
    link("u2", "2", None, "Kept")
    body = skins_routes.DiscordUsernamesBody.model_validate({"updates": [
        {"discord_user_id": "1", "discord_username": "one_handle", "discord_nickname": "  Lady   One "},
        {"discord_user_id": "2", "discord_username": "two_handle"},
    ]})
    result = skins_routes.post_discord_usernames(body, x_staff_key="k")
    assert result == {"updated": 2, "nicknames_updated": 1}
    assert names("1") == ("one_handle", "Lady One")
    # Not sent: kept. Not a valid nickname: skipped, so the stored one is kept too.
    assert names("2") == ("two_handle", "Kept")
    remember_discord_nicknames([{"discord_user_id": "2", "discord_nickname": "bad\x07name"},
                                {"discord_user_id": "2", "discord_nickname": "x" * 33}])
    assert names("2") == ("two_handle", "Kept")
    # Blank or null: they have no nickname now.
    remember_discord_nicknames([{"discord_user_id": "2", "discord_nickname": "  "}])
    assert names("2") == ("two_handle", None)


@pytest.mark.parametrize("payload,expected", [
    ({"roles": [], "nick": "Justin"}, {"nick": "Justin"}),
    ({"roles": [], "nick": None}, {"nick": None}),
    ({"pending": True, "nick": "x"}, None),
])
def test_guild_member_reads_the_nickname(payload, expected):
    from src.auth.test_discord_client import client
    assert client(lambda request: httpx.Response(200, json=payload)).guild_member("tok") == expected
