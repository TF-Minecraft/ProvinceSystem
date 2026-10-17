"""Real-Postgres schedules for the second independent Characters review."""
import threading
from contextlib import contextmanager

import pytest
from psycopg.errors import RaiseException

from src import database
from src.auth import testing
from src.auth.test_locking import ADVISORY, Gate, ROW, Run, lock_wait
from src.characters import creates, lore_items, realm_wipe, wills
from src.characters.roster import replace_roster, set_real_age
from src.characters.test_review_locking import asset_paths, valid_create  # noqa: F401

pytestmark = pytest.mark.usefixtures("postgres")


def race(gate, first, second, kinds):
    """Release paused workers even when a protection mutation removes the wait."""
    one, two = Run(first), None
    try:
        assert gate.reached.wait(10), one.error
        two = Run(second)
        lock_wait(two, kinds)
    finally:
        gate.release.set()
        one.join()
        if two is not None:
            two.join()
    return one, two


def seed_creates():
    for cid in ("b", "a"):
        testing.execute("INSERT INTO character_creation_requests (id, player_uuid, payload, status, created_at) "
                        "VALUES (%s, 'owner', '{}', 'pending', now())", (cid,))


@pytest.mark.parametrize("ok", [False, True])
def test_reversed_create_ack_batches_lock_all_ids_before_processing(monkeypatch, ok):
    seed_creates()
    batch = [{"id": cid, "ok": ok, "character_id": cid, "error": "refused"} for cid in ("b", "a", "b")]
    gate = Gate(monkeypatch, "UPDATE character_creation_requests")
    one, two = race(gate, lambda: creates.mark_applied_results(batch),
                    lambda: creates.mark_applied_results(batch[:2][::-1] + batch[2:]), ROW)
    assert one.error is None and two.error is None
    key, other = ("applied", "rejected") if ok else ("rejected", "applied")
    assert one.value == {"ok": True, key: ["b", "a"], other: []}
    assert two.value == {"ok": True, "applied": [], "rejected": []}
    assert creates.mark_applied_results(batch) == two.value


def test_create_ack_does_not_reach_an_id_inserted_after_lock_selection(monkeypatch):
    gate = Gate(monkeypatch, "SELECT id FROM character_creation_requests WHERE id = ANY")
    run = Run(lambda: creates.mark_applied_results([{"id": "a", "ok": False}]))
    try:
        assert gate.reached.wait(10), run.error
        seed_creates()
    finally:
        gate.release.set()
        run.join()
    assert run.error is None
    assert run.value == {"ok": True, "applied": [], "rejected": []}
    assert testing.value("SELECT status FROM character_creation_requests WHERE id = 'a'") == "pending"


def seed_lore(owner, cid, key, *, submission=None, state="ready"):
    testing.execute(
        "INSERT INTO lore_item_customisations "
        "(player_uuid, character_id, kit_key, display_name, lore, state, submission_id, kit_id, updated_at) "
        "VALUES (%s, %s, %s, 'Sword', '[]', %s, %s, 'starter', now())",
        (owner, cid, key, state, submission),
    )


@pytest.mark.parametrize("scope", ["owner", "all-owners", "mixed"])
def test_reversed_lore_ack_batches_lock_the_union_in_full_key_order(monkeypatch, scope):
    keys = [("owner-b", "a", "axe"), ("owner-a", "b", "axe"),
            ("owner-a", "a", "sword"), ("owner-a", "a", "axe")]
    for key in keys:
        seed_lore(*key)
    if scope == "owner":
        selectors = keys
    elif scope == "all-owners":
        selectors = [("", "b", "axe"), ("", "a", "sword"), ("", "a", "axe")]
    else:
        selectors = [("owner-a", "b", "axe"), ("", "a", "sword"), ("", "a", "axe")]
    batch = [{"player_uuid": owner, "character_id": cid, "kit_key": key, "ok": True}
             for owner, cid, key in selectors]
    gate = Gate(monkeypatch, "UPDATE lore_item_customisations")
    one, two = race(gate, lambda: lore_items.mark_lore_items_applied(batch),
                    lambda: lore_items.mark_lore_items_applied(batch[::-1]), ROW)
    assert one.error is None and two.error is None
    assert one.value == {"ok": True, "applied": len(batch), "failed": 0}
    assert two.value == {"ok": True, "applied": 0, "failed": len(batch)}
    assert testing.value("SELECT count(*) FROM lore_item_customisations WHERE state = 'applied'") == 4


def test_lore_ack_does_not_apply_to_a_new_owner_after_lock_selection(monkeypatch):
    seed_lore("old-owner", "a", "sword")
    gate = Gate(monkeypatch, "ORDER BY player_uuid, character_id, kit_key FOR UPDATE")
    run = Run(lambda: lore_items.mark_lore_items_applied([
        {"character_id": "a", "kit_key": "sword", "ok": True}]))
    try:
        assert gate.reached.wait(10), run.error
        seed_lore("new-owner", "a", "sword")
    finally:
        gate.release.set()
        run.join()
    assert run.error is None and run.value == {"ok": True, "applied": 1, "failed": 0}
    assert testing.rows("SELECT player_uuid, state FROM lore_item_customisations ORDER BY player_uuid") == [
        {"player_uuid": "new-owner", "state": "ready"}, {"player_uuid": "old-owner", "state": "applied"}]


def test_retained_will_ack_never_locks_a_roster_row_recreated_after_selection(monkeypatch):
    character = {"id": "a", "name": "Aldric", "status": "ALIVE", "will_revision": 0}
    replace_roster("owner", [character])
    rid = wills.create_will_request("owner", "main", "a", None, 0)["id"]
    testing.execute("UPDATE will_requests SET created_at = now() - interval '20 minutes'")
    replace_roster("owner", [])
    roster_selected = Gate(monkeypatch, "SELECT player_uuid, character_id FROM character_roster")
    requests_locked = Gate(monkeypatch, "SELECT 1 FROM will_requests WHERE realm_id")
    ack = Run(lambda: wills.ack_will_results("main", [{"id": rid, "result": "applied", "will_revision": 1}]))
    replacement = None
    request_roster = None
    try:
        assert roster_selected.reached.wait(10), ack.error
        replace_roster("owner", [character])
        request_roster = Gate(monkeypatch, "FROM character_roster WHERE realm_id")
        replacement = Run(lambda: wills.create_will_request("owner", "main", "a", None, 0))
        assert request_roster.reached.wait(10), replacement.error
        roster_selected.release.set()
        assert requests_locked.reached.wait(10), ack.error
        request_roster.release.set()
        # The replacement holds the recreated roster row, waiting on the old
        # request. The ack must finish without reaching back into that roster.
        lock_wait(replacement, ROW)
    finally:
        roster_selected.release.set()
        requests_locked.release.set()
        if request_roster is not None:
            request_roster.release.set()
        ack.join()
        if replacement is not None:
            replacement.join()
    assert ack.error is None and replacement.error is None
    assert ack.value == {"ok": True, "acked": [rid], "already": [], "refused": []}
    assert replacement.value["status"] == "pending"
    assert replacement.value["id"] != rid
    assert testing.rows("SELECT will_revision, will_heir_id FROM character_roster") == [
        {"will_revision": 0, "will_heir_id": None}]


@pytest.mark.parametrize("status", ["pending", "applied", "rejected"])
def test_real_create_retry_precedes_state_dependent_validation(postgres, monkeypatch, status):
    body = {**valid_create(), "client_request_id": "real-retry"}
    monkeypatch.setattr(database.connection, "POOL_TIMEOUT_SECONDS", .25)
    database.open_pool(postgres, min_size=0, max_size=1)
    creates.create_character("owner", body)
    testing.execute("UPDATE character_creation_requests SET status = %s", (status,))
    original = testing.rows("SELECT * FROM character_creation_requests")[0]
    set_real_age("owner", False)
    # Changing catalogue/roster state must not alter the stored response.
    replace_roster("owner", [{"id": "live", "name": "Aldric", "status": "ALIVE"}])
    retried = creates.create_character("owner", body)
    assert retried == creates._row_to_dict(original)
    assert testing.value("SELECT count(*) FROM character_creation_requests") == 1
    assert testing.value("SELECT is_adult FROM character_account_meta") is False


def test_create_retry_catches_a_first_request_committing_during_validation(monkeypatch):
    body = {**valid_create(), "client_request_id": "racing-retry"}
    validate = creates._validate_and_normalize
    reached, release = threading.Event(), threading.Event()
    main_thread = threading.current_thread()

    def delayed_validate(*args, **kwargs):
        if threading.current_thread() is not main_thread:
            reached.set()
            assert release.wait(10)
        return validate(*args, **kwargs)

    monkeypatch.setattr(creates, "_validate_and_normalize", delayed_validate)
    retry = Run(lambda: creates.create_character("owner", body))
    try:
        assert reached.wait(10), retry.error
        first = creates.create_character("owner", body)
    finally:
        release.set()
        retry.join()
    assert retry.error is None and retry.value == first
    assert testing.value("SELECT count(*) FROM character_creation_requests") == 1


def test_create_request_lookup_keeps_owner_and_input_guards():
    body = {**valid_create(), "client_request_id": "shared-id"}
    made = creates.create_character("owner", body)
    other = creates.create_character("other", {**body, "name": "Brena"})
    assert other["id"] != made["id"] and other["player_uuid"] == "other"
    with pytest.raises(creates.CreateError, match="player_uuid"):
        creates.create_character("", body)
    with pytest.raises(creates.CreateError, match="JSON object"):
        creates.create_character("owner", [])
    with pytest.raises(creates.CreateError):
        creates.create_character("owner", body, realm_id="bad realm!")


def test_stored_create_retry_does_not_run_validation_again(monkeypatch):
    body = {**valid_create(), "client_request_id": "completed-retry"}
    original = creates.create_character("owner", body)

    def no_revalidation(*args, **kwargs):
        pytest.fail("a stored retry must be returned before validation")

    monkeypatch.setattr(creates, "_validate_and_normalize", no_revalidation)
    assert creates.create_character("owner", body) == original


def test_reversed_submission_promotions_prelock_all_lore_rows(monkeypatch):
    seed_lore("owner", "b", "sword", submission="second", state="pending_skin")
    seed_lore("owner", "a", "sword", submission="first", state="pending_skin")
    gate = Gate(monkeypatch, "UPDATE lore_item_customisations")
    one, two = race(gate, lambda: lore_items.promote_ready_for_submissions(["second", "first"]),
                    lambda: lore_items.promote_ready_for_submissions(["first", "second"]), ROW)
    assert one.error is None and two.error is None
    assert one.value == two.value == 2


@pytest.mark.parametrize("mutation", ["promote", "deny", "reset-kit", "remount", "cancel", "tagged", "full-realm"])
def test_lore_bulk_mutators_share_the_ack_full_key_order(monkeypatch, mutation):
    seed_creates()
    for key in ("sword", "axe"):
        seed_lore("owner", "a", key, submission="skin")
    batch = [{"player_uuid": "owner", "character_id": "a", "kit_key": key, "ok": True}
             for key in ("sword", "axe")]
    monkeypatch.setattr(lore_items, "_kit_editable_keys", lambda kit: {"sword", "axe"})
    operations = {
        "promote": lambda: lore_items.promote_ready_for_submissions(["skin"]),
        "deny": lambda: lore_items.clear_pending_submission("skin", "refused"),
        "reset-kit": lambda: lore_items.clear_customisations_for_kit("owner", "a"),
        "remount": lambda: lore_items.remount_character_id("owner", "a", "live"),
        "cancel": lambda: creates.delete_pending_create("owner", "a"),
        "tagged": lambda: realm_wipe.delete_characters_for_realm("main", ["a"]),
        "full-realm": lambda: realm_wipe.wipe_realm_character_data("main"),
    }
    gate = Gate(monkeypatch, "UPDATE lore_item_customisations")
    one, two = race(gate, lambda: lore_items.mark_lore_items_applied(batch), operations[mutation], ROW)
    assert one.error is None and two.error is None
    assert one.value == {"ok": True, "applied": 2, "failed": 0}


def test_lore_remount_guards_an_absent_destination_against_new_customisation(monkeypatch):
    seed_lore("owner", "pending", "sword")
    monkeypatch.setattr(lore_items, "_require_customise_allowed", lambda *args: None)
    monkeypatch.setattr(lore_items, "_kit_editable_keys", lambda kit: None)
    monkeypatch.setattr(lore_items, "_editable_by_key", lambda key: {"kit_key": key})
    gate = Gate(monkeypatch, "ORDER BY player_uuid, character_id, kit_key FOR UPDATE")
    remount, insert = race(
        gate,
        lambda: lore_items.remount_character_id("owner", "pending", "live"),
        lambda: lore_items.customise_lore_item({"player_uuid": "owner"}, "live", "sword",
                                              display_name="New sword", lore=[]),
        ADVISORY,
    )
    assert remount.error is None and insert.error is None
    assert remount.value == 1
    assert testing.rows("SELECT character_id, display_name FROM lore_item_customisations") == [
        {"character_id": "live", "display_name": "New sword"}]


def test_lore_remount_cannot_reorder_keys_under_a_waiting_promotion(monkeypatch):
    seed_lore("owner", "a", "sword", submission="skin")
    seed_lore("owner", "b", "sword", submission="skin")
    moving = Gate(monkeypatch, "ORDER BY player_uuid, character_id, kit_key FOR UPDATE")
    first_locked, finish_selection = threading.Event(), threading.Event()
    real_connect = database.connect

    class Connection:
        def __init__(self, conn):
            self.conn = conn

        def __getattr__(self, name):
            return getattr(self.conn, name)

        def execute(self, sql, params=None):
            if threading.current_thread().name == "waiting-lore-ack" and "ORDER BY player_uuid" in str(sql):
                # Fetch one row at a time to place a scheduling gate between
                # Postgres row locks, after any wait on the moving source row.
                cursor = self.conn.cursor(name="lore_lock_selection")
                cursor.execute(sql, params)

                class Selection:
                    def fetchall(self):
                        rows = []
                        with cursor:
                            while (row := cursor.fetchone()) is not None:
                                rows.append(row)
                                if len(rows) == 1:
                                    first_locked.set()
                                    assert finish_selection.wait(10)
                        return rows

                return Selection()
            return self.conn.execute(sql, params)

    @contextmanager
    def connect(**kwargs):
        with real_connect(**kwargs) as conn:
            yield Connection(conn)

    monkeypatch.setattr(database, "connect", connect)

    def promote():
        threading.current_thread().name = "waiting-lore-ack"
        return lore_items.promote_ready_for_submissions(["skin"])

    def ack(ids):
        return lore_items.mark_lore_items_applied([
            {"player_uuid": "owner", "character_id": cid, "kit_key": "sword", "ok": True} for cid in ids])

    remount = Run(lambda: lore_items.remount_character_id("owner", "a", "z"))
    one = two = None
    try:
        assert moving.reached.wait(10), remount.error
        one = Run(promote)
        lock_wait(one, ROW)
        moving.release.set()
        remount.join()
        assert first_locked.wait(10), one.error
        two = Run(lambda: ack(["b", "z"]))
        lock_wait(two, ROW)
    finally:
        moving.release.set()
        finish_selection.set()
        remount.join()
        if one is not None:
            one.join()
        if two is not None:
            two.join()
    assert remount.error is None and one.error is None and two.error is None
    assert one.value == 1
    assert two.value == {"ok": True, "applied": 2, "failed": 0}


def test_roster_batches_order_even_ownership_refused_estate_upserts(monkeypatch):
    def characters(owner, order):
        return [{"id": f"{owner}-{death}", "name": death, "status": "DEAD", "death_id": death,
                 "estate": {"death_id": death, "status": "OPEN", "revision": 1}}
                for death in order]

    replace_roster("owner", characters("owner", ["a", "b"]))
    gate = Gate(monkeypatch, "INSERT INTO character_estates")
    one, two = race(gate, lambda: replace_roster("owner", characters("owner", ["b", "a"])),
                    lambda: replace_roster("other", characters("other", ["a", "b"])), ROW)
    assert one.error is None and two.error is None
    assert testing.rows("SELECT death_id, player_uuid FROM character_estates ORDER BY death_id") == [
        {"death_id": "a", "player_uuid": "owner"}, {"death_id": "b", "player_uuid": "owner"}]


@pytest.mark.parametrize("fail", [False, True], ids=["all-fields", "rollback"])
def test_lore_remount_preserves_source_fields_and_transaction(fail):
    seed_lore("owner", "pending", "sword", submission="skin", state="denied")
    seed_lore("owner", "live", "sword")
    testing.execute("UPDATE lore_item_customisations SET realm_id = 'dev', kit_id = 'custom', "
                    "name_colours = '[\"#123456\"]', name_styles = '[\"bold\"]', "
                    "lore = '[\"A blade.\"]', existing_skin_id = 'old', skin_slug = 'skin', "
                    "deny_reason = 'refused', ready_at = now(), applied_at = now() "
                    "WHERE character_id = 'pending'")
    before = testing.rows("SELECT * FROM lore_item_customisations ORDER BY character_id")
    if fail:
        testing.execute("CREATE FUNCTION fail_lore_move() RETURNS trigger LANGUAGE plpgsql AS $$ "
                        "BEGIN IF OLD.character_id = 'pending' THEN RAISE EXCEPTION 'move failed'; "
                        "END IF; RETURN OLD; END $$")
        testing.execute("CREATE TRIGGER fail_lore_move BEFORE DELETE ON lore_item_customisations "
                        "FOR EACH ROW EXECUTE FUNCTION fail_lore_move()")
    try:
        if fail:
            with pytest.raises(RaiseException, match="move failed"):
                lore_items.remount_character_id("owner", "pending", "live")
            assert testing.rows("SELECT * FROM lore_item_customisations ORDER BY character_id") == before
        else:
            assert lore_items.remount_character_id("owner", "pending", "live") == 1
            [after] = testing.rows("SELECT * FROM lore_item_customisations")
            source = before[1]
            assert {**after, "updated_at": source["updated_at"]} == {**source, "character_id": "live"}
    finally:
        if fail:
            testing.execute("DROP TRIGGER fail_lore_move ON lore_item_customisations")
            testing.execute("DROP FUNCTION fail_lore_move()")
