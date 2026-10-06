from src.coreprotect import maps, sessions
from src.coreprotect.reader import CoreProtectConfig, Reader

LOGOUT, LOGIN, PING = 0, 1, 2
NOW = 1_000_000


def read(db, ids, before=None, limit=20, ping=60, now=NOW):
    config = CoreProtectConfig(path=str(db.path), server="main", label="", ping_seconds=ping)
    with Reader(config) as r:
        raw = sessions.fetch(r, ids, before, limit)
        names = maps.get(r)
    return sessions.build(raw, names, now, ping), raw


def test_recorded_and_crashed_sessions(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    coreprotect.session(me, 100, LOGIN)
    coreprotect.session(me, 160, PING)
    coreprotect.session(me, 200, LOGOUT, x=7)
    # Crash: pings, then no logout before the next login.
    coreprotect.session(me, 300, LOGIN)
    coreprotect.session(me, 360, PING, x=3)
    coreprotect.session(me, 420, PING, x=4)
    # Crash before any ping.
    coreprotect.session(me, 500, LOGIN)
    coreprotect.session(me, 600, LOGIN)
    coreprotect.session(me, 700, LOGOUT)

    built, _ = read(coreprotect, [me])
    rows = [(s["start"]["time"], s["end_kind"], s["end"] and s["end"]["time"], s["duration_seconds"])
            for s in built["sessions"]]
    assert rows == [
        (600, "logout", 700, 100),
        (500, "last_observed", None, None),
        (300, "last_observed", 420, 120),
        (100, "logout", 200, 100),
    ]
    assert built["sessions"][3]["end"]["x"] == 7
    assert built["sessions"][2]["end"]["x"] == 4
    assert built["sessions"][0]["start"]["world"] == "TFMC_Map"
    assert built["first_seen"] == 100
    assert built["history_start"] == 100


def test_newest_session_open_or_stale(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    coreprotect.session(me, NOW - 600, LOGIN)
    coreprotect.session(me, NOW - 60, PING)
    built, _ = read(coreprotect, [me])
    assert built["sessions"][0]["end_kind"] == "open"
    assert built["sessions"][0]["duration_seconds"] == 600

    built, _ = read(coreprotect, [me], now=NOW + 3600)
    assert built["sessions"][0]["end_kind"] == "last_observed"
    assert built["sessions"][0]["end"]["time"] == NOW - 60

    built, _ = read(coreprotect, [me], ping=0)
    assert built["sessions"][0]["end_kind"] == "unknown"
    assert built["sessions"][0]["end"] is None


def test_just_joined_counts_as_open(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    coreprotect.session(me, NOW - 20, LOGIN)
    built, _ = read(coreprotect, [me])
    assert built["sessions"][0]["end_kind"] == "open"


def test_same_second_ordering_uses_rowid(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    coreprotect.session(me, 100, LOGIN)
    coreprotect.session(me, 100, LOGOUT)
    coreprotect.session(me, 100, LOGIN)
    coreprotect.session(me, 150, LOGOUT)
    built, _ = read(coreprotect, [me])
    assert [(s["start"]["time"], s["end"]["time"]) for s in built["sessions"]] == [(100, 150), (100, 100)]


def test_pages_keep_windows_bounded(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    for start in (100, 300, 500, 700, 900):
        coreprotect.session(me, start, LOGIN)
        if start != 500:
            coreprotect.session(me, start + 50, LOGOUT)
    first, raw = read(coreprotect, [me], limit=2)
    assert [s["start"]["time"] for s in first["sessions"]] == [900, 700]
    second, raw = read(coreprotect, [me], before=raw["next"], limit=2)
    # 500 crashed: the 750 logout belongs to the newer session, so it is not borrowed.
    assert [(s["start"]["time"], s["end_kind"]) for s in second["sessions"]] == [(500, "last_observed"), (300, "logout")]
    third, raw = read(coreprotect, [me], before=raw["next"], limit=2)
    assert [s["start"]["time"] for s in third["sessions"]] == [100]
    assert raw["next"] is None


def test_orphans_before_first_login_are_ignored(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    coreprotect.session(me, 50, PING)
    coreprotect.session(me, 60, LOGOUT)
    coreprotect.session(me, 100, LOGIN)
    coreprotect.session(me, 200, LOGOUT)
    built, _ = read(coreprotect, [me])
    assert len(built["sessions"]) == 1
    assert built["first_seen"] == 50


def test_other_players_rows_never_leak(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    other = coreprotect.user("B", "00000000-0000-0000-0000-000000000002")
    coreprotect.session(me, 100, LOGIN)
    coreprotect.session(other, 150, LOGOUT)
    coreprotect.session(other, 160, PING)
    coreprotect.session(me, 300, LOGIN)
    coreprotect.session(me, 400, LOGOUT)
    built, _ = read(coreprotect, [me])
    assert [(s["start"]["time"], s["end_kind"], s["end"]) for s in built["sessions"]][1] == (100, "last_observed", None)


def test_last_event_and_freshness(coreprotect):
    me = coreprotect.user("A", "00000000-0000-0000-0000-000000000001")
    config = CoreProtectConfig(path=str(coreprotect.path), server="main", label="", ping_seconds=60)
    with Reader(config) as r:
        assert sessions.last_event(r, [me]) is None
    coreprotect.session(me, NOW - 30, LOGIN)
    with Reader(config) as r:
        event = sessions.last_event(r, [me])
    assert sessions.is_fresh(event, NOW, 60)
    assert not sessions.is_fresh(event, NOW + 1000, 60)
    assert not sessions.is_fresh(event, NOW, 0)
    coreprotect.session(me, NOW - 10, LOGOUT)
    with Reader(config) as r:
        assert not sessions.is_fresh(sessions.last_event(r, [me]), NOW, 60)
