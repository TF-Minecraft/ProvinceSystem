import sqlite3

import httpx
import pytest

from src.api import skins_routes
from src.auth import users
from src.skins import db
from src.skins.discord_link import remember_discord_nicknames


def link(conn, uuid, discord_id, username, nickname=None):
    conn.execute(
        "INSERT INTO discord_links (player_uuid, discord_user_id, minecraft_name, discord_username, linked_at, "
        "discord_nickname) VALUES (?, ?, 'mc', ?, '2026-09-20T10:00:00Z', ?)",
        (uuid, discord_id, username, nickname))


def names(discord_id):
    with db.connect() as conn:
        row = conn.execute("SELECT discord_username, discord_nickname FROM discord_links WHERE discord_user_id = ?",
                           (discord_id,)).fetchone()
    return row["discord_username"], row["discord_nickname"]


def test_upgrade_moves_old_nicknames_out_of_usernames(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for name in ("SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    # A database from before nicknames had a column of their own.
    conn = sqlite3.connect(tmp_path / "province.db")
    conn.execute("CREATE TABLE discord_links (player_uuid TEXT PRIMARY KEY, discord_user_id TEXT NOT NULL UNIQUE, "
                 "minecraft_name TEXT, discord_username TEXT, linked_at TEXT NOT NULL, left_guild_at TEXT, "
                 "grace_until TEXT)")
    for uuid, discord_id, name in [("u1", "1", "Justin"), ("u2", "2", "justin_x"), ("u3", "3", "Dread Captain - Wren"),
                                   ("u4", "4", None)]:
        conn.execute("INSERT INTO discord_links (player_uuid, discord_user_id, discord_username, linked_at) "
                     "VALUES (?, ?, ?, 'now')", (uuid, discord_id, name))
    conn.commit()
    conn.close()

    db.migrate()
    assert names("1") == (None, "Justin")
    assert names("2") == ("justin_x", None)
    assert names("3") == (None, "Dread Captain - Wren")
    assert names("4") == (None, None)
    # Only once: a second start leaves later data alone.
    remember_discord_nicknames([{"discord_user_id": "2", "discord_nickname": "Jus"}])
    db.migrate()
    assert names("2") == ("justin_x", "Jus")


def test_sign_in_stores_handle_and_server_nickname(database):
    with database.connect() as conn:
        link(conn, "u1", "422", "Justin")
        conn.commit()
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


def test_bot_can_send_nicknames(database, monkeypatch):
    monkeypatch.setattr(skins_routes, "_require_staff", lambda key: None)
    with database.connect() as conn:
        link(conn, "u1", "1", None, "Old")
        link(conn, "u2", "2", None, "Kept")
        conn.commit()
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
