import pytest

from src.coreprotect import maps, movement
from src.coreprotect.reader import CoreProtectConfig, Reader

LOGOUT, LOGIN, PING = 0, 1, 2
LEAD = 150


def at(db, user, time, action, x, z, wid=1):
    db.execute("INSERT INTO co_session (time, user, wid, x, y, z, action) VALUES (?, ?, ?, ?, 64, ?, ?)",
               (time, user, wid, x, z, action))


def config(db):
    return CoreProtectConfig(path=str(db.path), server="main", label="", ping_seconds=60)


def player(db, ids, since, until):
    with Reader(config(db)) as r:
        return movement.build_player(movement.fetch_player(r, ids, since, until, LEAD), maps.get(r))


def everyone(db, since, until):
    with Reader(config(db)) as r:
        return movement.build_everyone(movement.fetch_everyone(r, since, until, LEAD), maps.get(r))


def test_window_defaults_and_limits():
    assert movement.window(None, None, 10_000, 86_400) == (6_400, 10_000)
    assert movement.window(100, 200, 10_000, 86_400) == (100, 200)
    assert movement.window(None, 5_000, 10_000, 86_400) == (1_400, 5_000)
    assert movement.window(None, 10_300, 10_000, 86_400) == (6_700, 10_300)
    for since, until in [(200, 200), (300, 200), (0, 86_401), (-5, 100), (None, 10_301)]:
        with pytest.raises(movement.BadWindow):
            movement.window(since, until, 10_000, 86_400)


def test_lead_seconds():
    assert movement.lead_seconds(60) == 150
    assert movement.lead_seconds(0) == movement.DEFAULT_LEAD_SECONDS


def test_player_points_in_window_oldest_first(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    other = coreprotect.user("Bob", "00000000-0000-0000-0000-000000000002")
    at(coreprotect, me, 10, PING, 1, 1)
    at(coreprotect, me, 100, LOGIN, 10, 20)
    at(coreprotect, me, 160, PING, 30, 40)
    at(coreprotect, me, 220, PING, 50, 60, wid=2)
    at(coreprotect, me, 250, LOGOUT, 70, 80, wid=2)
    at(coreprotect, me, 400, LOGIN, 0, 0, wid=9)
    at(coreprotect, other, 160, PING, 999, 999)

    built = player(coreprotect, [me], 100, 250)
    assert built["worlds"] == ["TFMC_Map", "TFMC_Map_the_end"]
    assert built["points"] == [
        # The row just before the window, within a couple of ping intervals.
        [10, 0, 1, 64, 1, PING],
        [100, 0, 10, 64, 20, LOGIN],
        [160, 0, 30, 64, 40, PING],
        [220, 1, 50, 64, 60, PING],
        [250, 1, 70, 64, 80, LOGOUT],
    ]
    assert built["complete_from"] == 100
    assert built["pings_since"] == 10
    # An unknown world keeps its own name rather than merging with others.
    assert player(coreprotect, [me], 300, 500)["worlds"] == ["world #9"]


def test_player_path_starts_from_the_row_before_the_window(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    at(coreprotect, me, 1_000, PING, 5, 5)
    at(coreprotect, me, 1_060, PING, 6, 6)
    assert [p[0] for p in player(coreprotect, [me], 1_050, 1_100)["points"]] == [1_000, 1_060]
    # Too old to say where they were when the window opened.
    assert [p[0] for p in player(coreprotect, [me], 1_061 + LEAD, 2_000)["points"]] == []
    # A logout just before the window means they were offline at its start.
    at(coreprotect, me, 1_070, LOGOUT, 6, 6)
    assert [p[0] for p in player(coreprotect, [me], 1_080, 1_100)["points"]] == []


def test_player_rows_merge_across_ids_and_keep_the_newest(coreprotect, monkeypatch):
    first = coreprotect.user("Old", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    second = coreprotect.user("New", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    for t in (100, 300, 500, 500):
        at(coreprotect, first, t, PING, t, 0)
    for t in (200, 400, 600):
        at(coreprotect, second, t, PING, t, 0)
    # Batches smaller than the answer still read every row once.
    monkeypatch.setattr(movement, "BATCH", 2)
    assert [p[0] for p in player(coreprotect, [first, second], 0, 1_000)["points"]] == [100, 200, 300, 400, 500,
                                                                                        500, 600]

    monkeypatch.setattr(movement, "PLAYER_POINT_LIMIT", 2)
    built = player(coreprotect, [first, second], 0, 1_000)
    # The cut fell inside second 500, so that whole second is left out.
    assert [p[0] for p in built["points"]] == [600]
    assert built["complete_from"] == 501


def test_everyone_groups_by_canonical_uuid(coreprotect, monkeypatch):
    a1 = coreprotect.user("Zed", "00000000-0000-0000-0000-00000000000a")
    a2 = coreprotect.user("Zed2", "00000000-0000-0000-0000-00000000000A")
    b = coreprotect.user("alice", "00000000-0000-0000-0000-00000000000b")
    console = coreprotect.user("#console", None)
    junk = coreprotect.user("junk", "not-a-uuid")
    at(coreprotect, a1, 100, LOGIN, 1, 1)
    at(coreprotect, a2, 200, PING, 2, 2)
    at(coreprotect, b, 150, PING, 5, 5, wid=2)
    at(coreprotect, console, 150, PING, 9, 9)
    at(coreprotect, junk, 150, PING, 9, 9)
    at(coreprotect, b, 900, PING, 6, 6)

    built = everyone(coreprotect, 0, 500)
    assert [(p["uuid"][-1], p["minecraft_name"]) for p in built["players"]] == [("b", "alice"), ("a", "Zed2")]
    assert built["players"][0]["points"] == [[150, 0, 5, 64, 5, PING]]
    assert [p[0] for p in built["players"][1]["points"]] == [100, 200]
    assert built["complete_from"] == 0

    # Rows of the console and malformed UUIDs count towards the limit, though they are dropped later.
    monkeypatch.setattr(movement, "EVERYONE_POINT_LIMIT", 2)
    built = everyone(coreprotect, 0, 500)
    assert built["complete_from"] == 151
    assert [p[0] for pl in built["players"] for p in pl["points"]] == [200]


def test_everyone_starts_from_the_rows_before_the_window(coreprotect):
    a = coreprotect.user("a", "00000000-0000-0000-0000-00000000000a")
    b = coreprotect.user("b", "00000000-0000-0000-0000-00000000000b")
    c = coreprotect.user("c", "00000000-0000-0000-0000-00000000000c")
    at(coreprotect, a, 900, PING, 1, 1)
    at(coreprotect, a, 950, PING, 2, 2)
    at(coreprotect, b, 960, LOGOUT, 3, 3)
    at(coreprotect, c, 500, PING, 4, 4)
    at(coreprotect, a, 1_010, PING, 3, 3)
    built = everyone(coreprotect, 1_000, 1_100)
    assert [(p["minecraft_name"], [x[0] for x in p["points"]]) for p in built["players"]] == [("a", [950, 1_010])]
