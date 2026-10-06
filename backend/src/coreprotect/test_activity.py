import json
import sqlite3

import pytest

from src.coreprotect import activity, cursors, maps
from src.coreprotect.reader import CoreProtectConfig, Reader

SCOPE = "main:0615a817-8cb4-4aef-95f7-f6c9bf7611b8"


def read(db, ids, kinds=activity.KINDS, before=None, limit=20):
    config = CoreProtectConfig(path=str(db.path), server="main", label="", ping_seconds=60)
    with Reader(config) as r:
        names = maps.get(r)
        raw = activity.fetch(r, names, ids, kinds, activity.decode_cursor(SCOPE, before), limit)
    return activity.build(raw, names, SCOPE)


def test_decodes_each_source(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    victim = coreprotect.user("Bob", "00000000-0000-0000-0000-000000000002")
    coreprotect.block(me, 1, 0)
    coreprotect.block(me, 2, 1)
    coreprotect.block(me, 3, 2, type_id=2)
    coreprotect.block(me, 4, 3, type_id=1)
    coreprotect.block(me, 5, 3, type_id=0, data=victim)
    coreprotect.block(me, 6, 13, type_id=2)
    coreprotect.container(me, 7, 1, amount=3, rolled_back=2)
    coreprotect.item(me, 8, 3, amount=2)
    coreprotect.interaction(me, 9, 1)
    coreprotect.sign(me, 10, 2, "my secret sign")
    coreprotect.command(me, 11, "/msg Bob meet me at the secret base")
    coreprotect.command(me, 12, "[skill] Fireball (fireball)")
    coreprotect.command(me, 13, "[skill] Blink (blink) teleported from 1 2 3 to 4 5 6")
    coreprotect.chat(me, 14, "chat is never shown")
    coreprotect.session(me, 15, 1)
    coreprotect.session(me, 16, 2)

    entries = read(coreprotect, [me])["entries"]
    seen = [(e["kind"], e["verb"], e["target"]) for e in entries]
    assert seen == [
        ("session", "logged in", None),
        ("skill", "teleported with", "Blink (blink)"),
        ("skill", "cast", "Fireball (fireball)"),
        ("command", "ran", "/msg"),
        ("sign", "edited", "sign"),
        ("entity", "sheared", "sheep"),
        ("item", "picked up", "iron_ingot"),
        ("container", "added", "iron_ingot"),
        ("spawn", "spawned", "sheep"),
        ("kill", "killed", "Bob"),
        ("kill", "killed", "cow"),
        ("click", "clicked", "oak_door"),
        ("block", "placed", "stone"),
        ("block", "broke", "stone"),
    ]
    by_kind = {e["kind"]: e for e in entries}
    assert by_kind["container"]["amount"] == 3
    assert by_kind["container"]["rolled_back"] == "rolled back (player inventory)"
    assert entries[9]["victim"] == {"minecraft_name": "Bob", "uuid": "00000000-0000-0000-0000-000000000002"}
    assert by_kind["block"]["world"] == "TFMC_Map"
    text = json.dumps(entries)
    for secret in ("meet me", "secret base", "secret sign", "chat is never", "4 5 6"):
        assert secret not in text


def test_pages_through_same_second_rows_across_tables(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    expected = []
    for _ in range(3):
        expected.append(f"block:{coreprotect.block(me, 100, 0)}")
        expected.append(f"container:{coreprotect.container(me, 100, 1)}")
        expected.append(f"command:{coreprotect.command(me, 100, '/home')}")
    coreprotect.block(me, 50, 1)
    got, before = [], None
    while True:
        page = read(coreprotect, [me], before=before, limit=2)
        got += [e["id"] for e in page["entries"]]
        before = page["next"]
        if not before:
            break
    assert len(got) == len(set(got)) == 10
    assert set(expected) <= set(got)
    assert got[-1].startswith("block:")


def test_kind_filters_apply_before_the_limit(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    coreprotect.command(me, 1, "/spawn")
    for t in range(2, 40):
        coreprotect.block(me, t, 0)
    page = read(coreprotect, [me], kinds=("command",), limit=5)
    assert [e["target"] for e in page["entries"]] == ["/spawn"]
    assert page["next"] is None


def test_missing_fork_tables_are_skipped(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    coreprotect.block(me, 1, 0)
    conn = sqlite3.connect(coreprotect.path)
    conn.execute("DROP TABLE co_entity_interaction")
    conn.execute("DROP TABLE co_entity_container")
    conn.commit()
    conn.close()
    assert [e["kind"] for e in read(coreprotect, [me])["entries"]] == ["block"]


def test_other_players_and_unknown_maps(coreprotect):
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    other = coreprotect.user("Bob", "00000000-0000-0000-0000-000000000002")
    coreprotect.block(other, 5, 0)
    coreprotect.block(me, 4, 0, type_id=999)
    entries = read(coreprotect, [me])["entries"]
    assert [e["target"] for e in entries] == ["material #999"]


def test_cursors_are_scoped_and_validated():
    token = activity.encode_cursor(SCOPE, activity.Cursor(10, 1, 5))
    assert activity.decode_cursor(SCOPE, token) == activity.Cursor(10, 1, 5)
    for bad in ("nonsense", activity.encode_cursor("main:someone-else", activity.Cursor(10, 1, 5)),
                cursors.encode(SCOPE, "activity", 10, 99, 5), cursors.encode(SCOPE, "sessions", 10, 1, 5), "x" * 300):
        with pytest.raises(cursors.BadCursor):
            activity.decode_cursor(SCOPE, bad)


def test_parse_kinds():
    assert activity.parse_kinds(None) == activity.KINDS
    assert activity.parse_kinds("block, command,block") == ("block", "command")
    for bad in ("chat", ",", "block,nope"):
        with pytest.raises(ValueError):
            activity.parse_kinds(bad)


def test_sparse_filters_scan_a_bounded_window(coreprotect, monkeypatch):
    monkeypatch.setattr(activity, "SCAN_LIMIT", 5)
    me = coreprotect.user("Hazel", "0615a817-8cb4-4aef-95f7-f6c9bf7611b8")
    kills = []
    for t in range(1, 41):
        if t % 13 == 0:
            kills.append(f"block:{coreprotect.block(me, t, 3, type_id=1)}")
        else:
            coreprotect.block(me, t, 0)
    coreprotect.command(me, 41, "/home")
    got, before, pages = [], None, 0
    while True:
        page = read(coreprotect, [me], kinds=("kill", "command"), before=before, limit=2)
        pages += 1
        got += [e["id"] for e in page["entries"] if e["kind"] == "kill"]
        if page["entries"] == [] or len(page["entries"]) < 2:
            assert page["searched_to"] is not None or page["next"] is None
        before = page["next"]
        if not before:
            break
    assert sorted(got) == sorted(kills)
    assert len(got) == len(set(got))
    assert pages > 3
