"""The characters locking recipes, each raced on two connections against the real Postgres.

As in the accounts tests, one transaction holds a lock, by hand on its own
connection or through a Gate that pauses a path just after a chosen statement,
and the competing path runs on another thread. The test sees it wait in
pg_stat_activity, on an advisory or a row lock, then lets the holder commit and
checks that the waiter acted on the holder's result.
"""
from __future__ import annotations

import pytest

from src import database
from src.auth import testing
from src.auth.test_locking import ADVISORY, ROW, Gate, held, race
from src.characters import creates, wills
from src.characters.estates import parse_estate, store_estate, store_will
from src.characters.roster import get_player_meta, replace_roster

pytestmark = pytest.mark.usefixtures("postgres")

OWNER = "acc-owner"
DIED_MS = 1_760_356_800_000


def char(cid: str, name: str, status: str = "ALIVE", **extra) -> dict:
    return {"id": cid, "name": name, "status": status, **extra}


def roster_ids(realm: str = "main") -> list[str]:
    return [r["character_id"] for r in testing.rows(
        "SELECT character_id FROM character_roster WHERE player_uuid = %s AND realm_id = %s "
        "ORDER BY character_id", (OWNER, realm))]


# --------------------
# A: row locks
# --------------------

def test_two_will_requests_for_one_character_run_one_after_the_other(monkeypatch):
    """create_will_request locks the character's roster row first: the second request waits for the
    first to commit and then sees it pending, instead of tripping the unique index."""
    replace_roster(OWNER, [char("aldric", "Aldric", will_revision=0), char("brena", "Brena")])
    gate = Gate(monkeypatch, "INSERT INTO will_requests")
    ask = lambda: wills.create_will_request(OWNER, "main", "aldric", "brena", 0)  # noqa: E731
    one, two = race(gate, ask, ask, ROW)
    assert one.error is None and one.value["status"] == "pending"
    assert isinstance(two.error, wills.WillError) and str(two.error) == "request_pending"
    assert testing.value("SELECT COUNT(*) FROM will_requests") == 1


def test_a_will_request_waits_for_a_roster_push_changing_the_will():
    """A push holding the roster row bumps the will; the request then sees the new revision."""
    replace_roster(OWNER, [char("aldric", "Aldric", will_revision=0)])
    run = held(
        lambda conn: conn.execute(
            "UPDATE character_roster SET will_revision = 1 WHERE character_id = 'aldric'"),
        lambda: wills.create_will_request(OWNER, "main", "aldric", None, 0),
        ROW,
    )
    assert isinstance(run.error, wills.WillError) and str(run.error) == "will_changed"
    assert testing.value("SELECT COUNT(*) FROM will_requests") == 0


# --------------------
# B: compare-and-set
# --------------------

def test_an_answer_being_recorded_is_not_recorded_twice():
    """ack_will_results moves pending to acked only in its UPDATE's WHERE: an answer recorded by
    another transaction while this one read the request counts as already answered."""
    replace_roster(OWNER, [char("aldric", "Aldric", will_revision=0), char("brena", "Brena")])
    rid = wills.create_will_request(OWNER, "main", "aldric", "brena", 0)["id"]
    run = held(
        lambda conn: conn.execute(
            "UPDATE will_requests SET status = 'acked', result = 'stale', acked_at = now() WHERE id = %s",
            (rid,)),
        lambda: wills.ack_will_results("main", [{"id": rid, "result": "applied", "will_revision": 1}]),
        ROW,
    )
    assert run.error is None
    assert run.value == {"ok": True, "acked": [], "already": [rid], "refused": []}
    assert testing.rows("SELECT status, result FROM will_requests") == [{"status": "acked", "result": "stale"}]
    assert testing.value("SELECT will_revision FROM character_roster WHERE character_id = 'aldric'") == 0


def test_two_acks_of_one_request_apply_it_once(monkeypatch):
    replace_roster(OWNER, [char("aldric", "Aldric", will_revision=0), char("brena", "Brena")])
    rid = wills.create_will_request(OWNER, "main", "aldric", "brena", 0)["id"]
    gate = Gate(monkeypatch, "UPDATE will_requests SET status = 'acked'")
    ack = lambda: wills.ack_will_results(  # noqa: E731
        "main", [{"id": rid, "result": "applied", "will_revision": 1, "heir_name": "Brena"}])
    one, two = race(gate, ack, ack, ROW)
    assert (one.value["acked"], two.value["already"]) == ([rid], [rid])
    assert testing.rows(
        "SELECT will_heir_id, will_revision FROM character_roster WHERE character_id = 'aldric'"
    ) == [{"will_heir_id": "brena", "will_revision": 1}]


def test_an_older_will_never_lands_over_a_newer_one():
    """store_will checks the revision in its UPDATE's WHERE, which Postgres checks again on the
    row the holder changed."""
    replace_roster(OWNER, [char("aldric", "Aldric", will_revision=0)])

    def older():
        with database.connect() as conn:
            return store_will(conn, OWNER, "main", "aldric", ("brena", "Brena", 3))

    run = held(
        lambda conn: conn.execute(
            "UPDATE character_roster SET will_revision = 5, will_heir_id = NULL "
            "WHERE character_id = 'aldric'"),
        older,
        ROW,
    )
    assert run.error is None and run.value is False
    assert testing.rows(
        "SELECT will_heir_id, will_revision FROM character_roster WHERE character_id = 'aldric'"
    ) == [{"will_heir_id": None, "will_revision": 5}]


# --------------------
# C: constraints
# --------------------

def _estate(revision: int) -> dict:
    return parse_estate({"death_id": "death-1", "status": "OPEN", "revision": revision,
                         "updated_at": DIED_MS + revision}, "death-1")


def test_an_older_estate_never_replaces_one_being_stored():
    """store_estate's upsert waits on the uncommitted newer estate, then its WHERE keeps that one."""
    replace_roster(OWNER, [char("aldric", "Aldric", "DEAD", died_at=DIED_MS, death_id="death-1")])

    def older():
        with database.connect() as conn:
            return store_estate(conn, OWNER, "main", "aldric", _estate(1))

    run = held(lambda conn: store_estate(conn, OWNER, "main", "aldric", _estate(2)), older, ROW)
    assert run.error is None and run.value is False
    assert testing.value("SELECT revision FROM character_estates WHERE death_id = 'death-1'") == 2


def test_a_retried_create_returns_the_create_being_made(monkeypatch):
    """Two creates with one client request id: the second waits on the unique index and returns the first."""
    monkeypatch.setattr(creates, "_validate_and_normalize",
                        lambda uuid, body, realm_id: {"name": "Aldric", "client_request_id": "req-1"})
    gate = Gate(monkeypatch, "INSERT INTO character_creates")
    make = lambda: creates.create_character(OWNER, {"name": "Aldric"})  # noqa: E731
    one, two = race(gate, make, make, ROW)
    assert one.error is None and two.error is None
    assert one.value["id"] == two.value["id"]
    assert testing.value("SELECT COUNT(*) FROM character_creates") == 1


def test_a_roster_push_keeps_player_meta_another_push_is_writing():
    """The player meta merge is one upsert: a push for another realm waits on the row and keeps the
    value the holder wrote, where a read-then-write would put back what it read."""
    replace_roster(OWNER, [], max_alive_characters=2)
    run = held(
        lambda conn: conn.execute(
            "UPDATE character_player_meta SET max_alive_characters = 5 WHERE player_uuid = %s", (OWNER,)),
        lambda: replace_roster(OWNER, [], realm_id="dev", eighteen=True),
        ROW,
    )
    assert run.error is None
    meta = get_player_meta(OWNER)
    assert (meta["max_alive_characters"], meta["eighteen"], meta["real_age_set"]) == (5, True, True)


# --------------------
# D: advisory lock
# --------------------

def test_two_roster_pushes_for_one_player_run_one_after_the_other(monkeypatch):
    """The later push wins whole: it never keeps a character the earlier push added and it dropped."""
    gate = Gate(monkeypatch, "DELETE FROM character_roster WHERE player_uuid")
    first = lambda: replace_roster(OWNER, [char("aldric", "Aldric"), char("brena", "Brena")])  # noqa: E731
    second = lambda: replace_roster(OWNER, [char("aldric", "Aldric")])  # noqa: E731
    one, two = race(gate, first, second, ADVISORY)
    assert one.error is None and two.error is None
    assert roster_ids() == ["aldric"]


def test_roster_pushes_for_other_players_or_realms_do_not_wait():
    with database.connect() as conn:
        database.advisory_lock(conn, f"characters:roster:main:{OWNER}")
        replace_roster(OWNER, [char("aldric", "Aldric")], realm_id="dev")
        replace_roster("acc-other", [char("cael", "Cael")])
    assert roster_ids("dev") == ["aldric"]
