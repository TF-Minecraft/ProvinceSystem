"""Scheduled file/SQL races and rollback on a real Postgres; MineSkin is mocked."""
from contextlib import contextmanager
import hashlib
import io
import threading

from PIL import Image
import psycopg
import pytest

from src import database
from src.auth import testing
from src.auth.test_locking import Run
from src.characters import creates, realm_wipe, wardrobe
from src.characters import wardrobe_assets as assets
from src.characters.roster import replace_roster
from src.scripts.util.maplock import MapLockBusy, map_lock
from src.skins import db as sqlite_db

OWNER, LIVE, PENDING = "wardrobe-owner", "live-char", "pending-char"


def png(colour):
    buf = io.BytesIO()
    Image.new("RGBA", (64, 64), colour).save(buf, format="PNG")
    return buf.getvalue()


OLD, A, B = [png(colour) for colour in ("red", "green", "blue")]


def signed(data, model):
    return hashlib.sha256(data).hexdigest(), "signature"


@pytest.fixture(autouse=True)
def setup(tmp_path, monkeypatch, postgres):
    for name, sub in (("DATA_DIR", ""), ("DB_PATH", "province.db"), ("SKINS_DIR", "skins"),
                      ("DRINKS_DIR", "drinks"), ("WARDROBE_DIR", "wardrobe")):
        monkeypatch.setattr(sqlite_db, name, tmp_path / sub if sub else tmp_path)
    monkeypatch.setattr(wardrobe, "DATA_DIR", tmp_path)
    monkeypatch.setattr(wardrobe, "WARDROBE_DIR", tmp_path / "wardrobe")
    monkeypatch.setattr(wardrobe, "sign_wardrobe_skin", signed)
    sqlite_db.migrate()
    replace_roster(OWNER, [{"id": LIVE, "name": "Ana", "status": "ALIVE"}])
    testing.execute("INSERT INTO character_creates (id, player_uuid, payload, status, created_at) "
                    "VALUES (%s, %s, '{}', 'pending', now())", (PENDING, OWNER))


def rows_match_files():
    rows = testing.rows("SELECT png_relpath, texture_value FROM character_wardrobe_slots "
                        "UNION ALL SELECT png_relpath, texture_value FROM character_create_wardrobe")
    for row in rows:
        path = wardrobe.DATA_DIR / row["png_relpath"]
        assert path.is_file(), row
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["texture_value"], row


@pytest.mark.parametrize("pending,other", [
    (False, "upload"), (False, "clear"), (False, "rename"), (False, "ack"),
    (False, "tagged-delete"), (False, "full-wipe"), (False, "compact"),
    (True, "upload"), (True, "clear"), (True, "rename"), (True, "pending-clear"),
    (True, "cancel"), (True, "flush"), (True, "compact"),
])
def test_paused_png_write_serialises_every_competing_slot_mutation(monkeypatch, pending, other):
    cid = PENDING if pending else LIVE
    if other == "compact":
        monkeypatch.setattr(wardrobe, "swappable_slot_count", lambda *a, **kw: 3)
    wardrobe.upload_slot(OWNER, cid, "base", OLD)
    if other == "compact":
        wardrobe.upload_slot(OWNER, cid, "extra_1", B)
    reached, release, competing = threading.Event(), threading.Event(), threading.Event()
    real_write, real_lock = assets.write_png, assets.map_lock
    armed = True

    def write(path, data):
        nonlocal armed
        real_write(path, data)
        if data == A and armed:
            armed = False
            reached.set()
            assert release.wait(15), "paused PNG write was never released"

    @contextmanager
    def lock(*args, **kwargs):
        if getattr(threading.current_thread(), "competing_wardrobe_mutation", False):
            competing.set()
        with real_lock(*args, **kwargs):
            yield

    monkeypatch.setattr(assets, "write_png", write)
    monkeypatch.setattr(assets, "map_lock", lock)

    def mutate():
        threading.current_thread().competing_wardrobe_mutation = True
        if other == "upload":
            return wardrobe.upload_slot(OWNER, cid, "base", B)
        if other in {"clear", "compact"}:
            return wardrobe.clear_slot(OWNER, cid, "base")
        if other == "rename":
            return wardrobe.set_slot_display_name(OWNER, cid, "base", "Renamed")
        if other == "ack":
            return wardrobe.ack_wardrobe_slots(OWNER, cid, ["base"])
        if other == "pending-clear":
            return wardrobe.clear_pending_create_wardrobe(OWNER, cid, "base")
        if other == "cancel":
            return creates.delete_pending_create(OWNER, cid)
        if other == "flush":
            return wardrobe.flush_pending_wardrobe(OWNER, cid, LIVE)
        if other == "tagged-delete":
            return realm_wipe.delete_characters_for_realm("main", [cid])
        return realm_wipe.wipe_realm_character_data("main")

    one = Run(lambda: wardrobe.upload_slot(OWNER, cid, "base", A))
    two = None
    try:
        assert reached.wait(10), one.error
        two = Run(mutate)
        assert competing.wait(10), two.error
        # If the guard is mutated away, force B to finish before A resumes:
        # the original race leaves B's bytes with A's signed texture.
        try:
            with map_lock(str(wardrobe.WARDROBE_DIR / ".mutations.lock"), blocking=False):
                unguarded = True
        except MapLockBusy:
            unguarded = False
        if unguarded:
            two.join()
    finally:
        release.set()
        one.join()
        if two is not None:
            two.join()
    assert one.error is None and two.error is None
    rows_match_files()
    table = "character_create_wardrobe" if pending else "character_wardrobe_slots"
    if other == "rename":
        assert testing.value(f"SELECT display_name FROM {table}") == "Renamed"
    elif other == "ack":
        assert testing.value("SELECT apply_pending FROM character_wardrobe_slots") is False
    elif other in {"clear", "pending-clear", "cancel", "tagged-delete", "full-wipe"}:
        assert testing.value(f"SELECT count(*) FROM {table}") == 0
    elif other == "upload":
        assert testing.value(f"SELECT texture_value FROM {table}") == signed(B, "classic")[0]
    elif other == "compact":
        assert testing.rows(f"SELECT slot, texture_value FROM {table}") == [
            {"slot": "base", "texture_value": signed(B, "classic")[0]}]
    else:
        assert testing.value("SELECT count(*) FROM character_create_wardrobe") == 0


@contextmanager
def reject(table, event, *, extra_only=False, deferred=False):
    condition = "IF NEW.slot = 'extra_1' THEN " if extra_only else ""
    end = "END IF; " if extra_only else ""
    testing.execute("CREATE OR REPLACE FUNCTION fail_wardrobe_write() RETURNS trigger LANGUAGE plpgsql AS $$ "
                    f"BEGIN {condition}RAISE EXCEPTION 'test write rejected' USING ERRCODE = '23514'; "
                    f"{end}RETURN NEW; END $$")
    trigger = "CREATE CONSTRAINT TRIGGER" if deferred else "CREATE TRIGGER"
    timing = "AFTER" if deferred else "BEFORE"
    defer = "DEFERRABLE INITIALLY DEFERRED" if deferred else ""
    testing.execute(f"{trigger} fail_wardrobe_write {timing} {event} ON {table} {defer} "
                    "FOR EACH ROW EXECUTE FUNCTION fail_wardrobe_write()")
    try:
        yield
    finally:
        testing.execute(f"DROP TRIGGER fail_wardrobe_write ON {table}")
        testing.execute("DROP FUNCTION fail_wardrobe_write()")


@pytest.mark.parametrize("pending", [False, True])
@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("deferred", [False, True], ids=["statement", "commit"])
def test_failed_slot_write_restores_old_png_or_removes_new_file(pending, existing, deferred):
    cid = PENDING if pending else LIVE
    table = "character_create_wardrobe" if pending else "character_wardrobe_slots"
    if existing:
        wardrobe.upload_slot(OWNER, cid, "base", OLD)
    with reject(table, "INSERT OR UPDATE", deferred=deferred):
        with pytest.raises(psycopg.errors.CheckViolation):
            wardrobe.upload_slot(OWNER, cid, "base", A)
    rows_match_files()
    assert testing.value(f"SELECT count(*) FROM {table}") == int(existing)
    rel = wardrobe._pending_relpath(cid, "base") if pending else wardrobe._slot_relpath(OWNER, cid, "base")
    path = wardrobe.DATA_DIR / rel
    assert path.read_bytes() == OLD if existing else not path.exists()
    assert not list(wardrobe.WARDROBE_DIR.rglob("*.part"))


@pytest.mark.parametrize("pending", [False, True])
def test_failed_slot_deletion_restores_png_and_row(pending):
    cid = PENDING if pending else LIVE
    table = "character_create_wardrobe" if pending else "character_wardrobe_slots"
    wardrobe.upload_slot(OWNER, cid, "base", OLD)
    with reject(table, "DELETE"):
        with pytest.raises(psycopg.errors.CheckViolation):
            wardrobe.clear_slot(OWNER, cid, "base")
    rows_match_files()
    assert testing.value(f"SELECT count(*) FROM {table}") == 1


def test_flush_failure_restores_both_trees_and_database_rows():
    wardrobe.upload_slot(OWNER, LIVE, "base", OLD)
    for slot in ("base", "extra_1"):
        wardrobe._upsert_pending_slot(PENDING, slot, A, texture_value=signed(A, "classic")[0],
                                     texture_signature="signature", model="classic", display_name=None)
    with reject("character_wardrobe_slots", "INSERT OR UPDATE", extra_only=True):
        with pytest.raises(psycopg.errors.CheckViolation):
            wardrobe.flush_pending_wardrobe(OWNER, PENDING, LIVE)
    rows_match_files()
    assert testing.value("SELECT count(*) FROM character_create_wardrobe") == 2
    assert testing.value("SELECT texture_value FROM character_wardrobe_slots") == signed(OLD, "classic")[0]


def test_signing_holds_neither_a_pool_borrow_nor_the_asset_guard(postgres, monkeypatch):
    monkeypatch.setattr(database.connection, "POOL_TIMEOUT_SECONDS", .25)
    database.open_pool(postgres, min_size=0, max_size=1)

    def sign(data, model):
        assert testing.value("SELECT 1") == 1
        def other_thread():
            with map_lock(str(wardrobe.WARDROBE_DIR / ".mutations.lock"), blocking=False):
                return True
        run = Run(other_thread).join()
        assert run.error is None and run.value is True
        return signed(data, model)

    monkeypatch.setattr(wardrobe, "sign_wardrobe_skin", sign)
    wardrobe.upload_slot(OWNER, LIVE, "base", A)
    wardrobe.upload_pending_create_wardrobe(OWNER, PENDING, "base", B)
    rows_match_files()


def test_failed_masked_signing_leaves_the_existing_base_intact(monkeypatch):
    wardrobe.upload_slot(OWNER, LIVE, "base", OLD)
    monkeypatch.setattr(wardrobe, "load_masked_template", lambda: B)
    calls = 0
    def sign(data, model):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise wardrobe.WardrobeError("signing failed", status_code=502)
        return signed(data, model)
    monkeypatch.setattr(wardrobe, "sign_wardrobe_skin", sign)
    with pytest.raises(wardrobe.WardrobeError, match="signing failed"):
        wardrobe.upload_slot(OWNER, LIVE, "base", A, create_masked=True)
    rows_match_files()
    assert testing.value("SELECT texture_value FROM character_wardrobe_slots") == signed(OLD, "classic")[0]
