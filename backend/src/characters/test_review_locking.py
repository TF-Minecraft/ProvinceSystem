"""Real-Postgres regressions for the first independent Characters review."""
import time

import psycopg
import pytest

from src import database
from src.auth import testing
from src.auth.test_locking import Gate, ROW, Run, race
from src.characters import creates, realm_wipe, wardrobe, wills
from src.characters.creation_catalog import replace_catalog
from src.characters.roster import replace_roster, set_real_age

pytestmark = pytest.mark.usefixtures("postgres")


@pytest.fixture(autouse=True)
def asset_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(wardrobe, "DATA_DIR", tmp_path)
    monkeypatch.setattr(wardrobe, "WARDROBE_DIR", tmp_path / "wardrobe")


def valid_create():
    replace_catalog({
        "stages": [{"id": "intro", "type": "info"}],
        "races": [{"id": "human"}], "classes": [{"id": "warrior"}],
        "traits": [{"id": "str1"}],
        "attribute_point_buy": {"attributes": ["strength"], "abbreviations": {"strength": "str"},
                                "pool": 1, "max_rank": 1, "cost_for_rank": [1]},
    })
    return {"name": "Aldric", "age": 30, "description": "A traveller.", "race_id": "human",
            "class_id": "warrior", "attributes": {"strength": 1}, "eighteen": True}


def test_validated_create_with_attestation_uses_a_single_connection(postgres, monkeypatch):
    body = valid_create()
    monkeypatch.setattr(database.connection, "POOL_TIMEOUT_SECONDS", .25)
    database.open_pool(postgres, min_size=0, max_size=1)
    made = creates.create_character("owner", body)
    assert made["payload"]["eighteen"] is True
    assert testing.rows("SELECT eighteen, real_age_set FROM character_player_meta") == [
        {"eighteen": True, "real_age_set": True}]


def test_failed_create_rolls_back_its_attestation(postgres, monkeypatch):
    body = valid_create()
    set_real_age("owner", False)
    testing.execute("INSERT INTO character_creates (id, player_uuid, payload, status, created_at) "
                    "VALUES ('collision', 'other', '{\"name\":\"Other\"}', 'pending', now())")
    monkeypatch.setattr(creates.uuid_lib, "uuid4", lambda: "collision")
    monkeypatch.setattr(database.connection, "POOL_TIMEOUT_SECONDS", .25)
    database.open_pool(postgres, min_size=0, max_size=1)
    with pytest.raises(psycopg.errors.UniqueViolation):
        creates.create_character("owner", body)
    assert testing.value("SELECT eighteen FROM character_player_meta") is False
    assert testing.value("SELECT count(*) FROM character_creates") == 1


def requests_for_two_owners():
    ids = []
    # Physical insertion order is the opposite of the common roster lock order.
    for owner, cid in (("owner-b", "brena"), ("owner-a", "aldric")):
        replace_roster(owner, [{"id": cid, "name": cid, "status": "ALIVE", "will_revision": 0}])
        ids.append(wills.create_will_request(owner, "main", cid, None, 0)["id"])
    return ids


def wait_event(conn, kind):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if conn.execute("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() "
                        "AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' "
                        "AND wait_event = ANY(%s)", (list(kind),)).fetchone():
            return
        time.sleep(.01)
    pytest.fail(f"no {kind} lock wait observed")


@pytest.mark.parametrize("full_realm", [False, True], ids=["tagged", "full-realm"])
def test_realm_deletion_and_ack_batch_share_roster_lock_order(postgres, monkeypatch, full_realm):
    ids = requests_for_two_owners()
    monkeypatch.setattr(realm_wipe, "_ID_CHUNK", 1)
    testing.execute("CREATE OR REPLACE FUNCTION pause_character_delete() RETURNS trigger LANGUAGE plpgsql AS $$ "
                    "BEGIN IF OLD.character_id = 'brena' THEN PERFORM pg_advisory_xact_lock(81231); "
                    "END IF; RETURN OLD; END $$")
    testing.execute("CREATE TRIGGER pause_character_delete BEFORE DELETE ON character_roster "
                    "FOR EACH ROW EXECUTE FUNCTION pause_character_delete()")
    one = two = None
    try:
        with psycopg.connect(postgres, autocommit=True) as hold:
            hold.execute("SELECT pg_advisory_lock(81231)")
            try:
                delete = (lambda: realm_wipe.wipe_realm_character_data("main")) if full_realm else (
                    lambda: realm_wipe.delete_characters_for_realm("main", ["brena", "aldric"]))
                one = Run(delete)
                wait_event(hold, {"advisory"})
                two = Run(lambda: wills.ack_will_results(
                    "main", [{"id": rid, "result": "applied", "will_revision": 1} for rid in ids]))
                wait_event(hold, ROW)
            finally:
                hold.execute("SELECT pg_advisory_unlock(81231)")
        one.join()
        two.join()
        assert one.error is None and two.error is None
        assert two.value["acked"] == ids
        assert testing.value("SELECT count(*) FROM character_roster") == 0
    finally:
        if one is not None:
            one.join()
        if two is not None:
            two.join()
        testing.execute("DROP TRIGGER pause_character_delete ON character_roster")
        testing.execute("DROP FUNCTION pause_character_delete()")


def test_reversed_ack_batches_without_roster_rows_lock_requests_in_order(monkeypatch):
    ids = sorted(requests_for_two_owners())
    testing.execute("DELETE FROM character_roster")
    gate = Gate(monkeypatch, "UPDATE will_requests SET status = 'acked'")
    ack = lambda order: wills.ack_will_results("main", [{"id": rid, "result": "stale"} for rid in order])
    one, two = race(gate, lambda: ack(ids), lambda: ack(ids[::-1]), ROW)
    assert one.error is None and two.error is None
    assert one.value["acked"] == ids
    assert two.value["already"] == ids[::-1]
    assert testing.value("SELECT count(*) FROM will_requests WHERE status = 'acked'") == 2
