"""Characters reads and orphan rollback after the merged Skins/Linking cutover."""
import pytest
from psycopg.errors import RaiseException

from src import database
from src.auth import players, testing
from src.characters import lore_items
from src.characters.roster import replace_roster
from src.skins import db, submissions

pytestmark = pytest.mark.usefixtures("postgres")
OWNER = "11111111-1111-4111-8111-111111111111"
NOW = "2026-01-01T00:00:00Z"


@pytest.fixture(autouse=True)
def native_only(tmp_path, monkeypatch, postgres):
    assert not hasattr(db, "connect")
    monkeypatch.setattr(db, "SKINS_DIR", tmp_path)
    monkeypatch.setattr(submissions, "SKINS_DIR", tmp_path)
    monkeypatch.setattr(database.connection, "POOL_TIMEOUT_SECONDS", .25)
    database.open_pool(postgres, min_size=0, max_size=1)


def skin(sid="skin", *, status="pending", owner=OWNER, staff=False, category=None, name="Sword"):
    with database.connect() as conn:
        code = conn.execute(
            "INSERT INTO codes (code_hash, player_uuid, created_at, expires_at, redeemed_at) "
            "VALUES (%s, %s, %s, '2099-01-01', %s) RETURNING id",
            (sid, owner, NOW, NOW),
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO submissions (id, player_uuid, code_id, kind, slug, display_name, status, "
            "dir_path, created_at, staff, category, base_set) "
            "VALUES (%s, %s, %s, 'handheld', %s, %s, %s, %s, %s, %s, %s, 'knife_skin')",
            (sid, owner, code, sid, name, status, sid, NOW, staff, category),
        )
    folder = submissions.SKINS_DIR / sid
    folder.mkdir()
    path = folder / f"{sid}.png"
    path.write_bytes(b"original-png")
    return path, code


def lore(cid="a"):
    testing.execute(
        "INSERT INTO lore_item_customisations (player_uuid, character_id, kit_key, display_name, lore_json, "
        "submission_id, state, ready_at, updated_at, name_colours, name_styles, deny_reason) "
        "VALUES (%s, %s, 'sword', 'Sword', '[\"A blade.\"]', 'skin', 'pending_skin', %s, %s, "
        "'[\"#123456\"]', '[\"bold\"]', 'old reason')", (OWNER, cid, NOW, NOW),
    )


@pytest.mark.parametrize("status", ["pending", "approved", "applied", "denied", None], ids=["pending", "approved", "applied", "denied", "missing"])
def test_native_lore_status_and_draft_keep_api_values_with_pool_size_one(status):
    if status is not None:
        skin(status=status)
        if status == "denied":
            testing.execute("UPDATE submissions SET deny_reason = 'new reason'")
    lore()
    assert lore_items.claim_status(OWNER, "a") == {
        "pending_skin": status in ("pending", None), "pending_pack": status in ("approved", "denied"),
        "ready": False, "kit_id": "starter"}
    draft = lore_items._load_draft(OWNER, "a", "sword")
    assert draft["submission_status"] == status
    assert draft["deny_reason"] == ("new reason" if status == "denied" else "old reason")
    assert draft["lore"] == ["A blade."]
    assert draft["name_colours"] == ["#123456"] and draft["name_styles"] == ["bold"]
    assert draft["ready_at"] == NOW and draft["applied_at"] is None


def test_native_pickable_skins_keep_boolean_acl_and_display_order():
    skin("player", status="applied", name="apple")
    skin("staff", status="applied", owner="staff-owner", staff=True, category="i_tools", name="Banana")
    skin("foreign", status="applied", owner="other", name="aardvark")
    skin("wrong-category", status="applied", owner="staff-owner", staff=True, category="other")
    assert [r["id"] for r in lore_items._list_pickable_skins(OWNER, "knife_skin")] == ["player", "staff"]
    assert lore_items._assert_pickable_skin_access(OWNER, "player", "knife_skin") == "player"
    assert lore_items._validate_existing_skin("staff", "knife_skin", OWNER) == (
        "staff", lore_items._namespace_for_staff(True))
    with pytest.raises(lore_items.LoreItemError):
        lore_items._assert_pickable_skin_access(OWNER, "foreign", "knife_skin")


def test_native_player_directory_reads_links_accounts_and_roster_together():
    testing.execute("INSERT INTO users (discord_user_id, discord_username, created_at, updated_at, last_login_at) "
                    "VALUES ('discord', 'handle', %s, %s, %s)", (NOW, NOW, NOW))
    testing.execute("INSERT INTO discord_links (player_uuid, discord_user_id, minecraft_name, linked_at) "
                    "VALUES (%s, 'discord', 'Steve', %s)", (OWNER, NOW))
    replace_roster(OWNER, [{"id": "a", "name": "Aldric", "status": "ALIVE"}])
    links, roster = players._site_rows(OWNER)
    assert len(links) == len(roster) == 1
    assert links[0]["account_username"] == "handle" and links[0]["minecraft_name"] == "Steve"
    assert links[0]["linked_at"] == links[0]["account_created_at"] == NOW
    assert roster[0]["name"] == "Aldric" and isinstance(roster[0]["updated_at"], str)
    assert roster[0]["updated_at"].endswith("Z")


@pytest.mark.parametrize("failure", [None, "statement", "commit"], ids=["success", "statement-rollback", "commit-rollback"])
def test_native_orphan_rollback_releases_code_atomically_with_pool_size_one(failure):
    png, code = skin()
    if failure:
        testing.execute("CREATE FUNCTION fail_orphan_code_release() RETURNS trigger LANGUAGE plpgsql AS $$ "
                        "BEGIN RAISE EXCEPTION 'code release failed'; END $$")
        trigger = ("CREATE CONSTRAINT TRIGGER fail_orphan_code_release AFTER UPDATE ON codes "
                   "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW") if failure == "commit" else (
                   "CREATE TRIGGER fail_orphan_code_release BEFORE UPDATE ON codes FOR EACH ROW")
        testing.execute(trigger + " EXECUTE FUNCTION fail_orphan_code_release()")
    try:
        if failure:
            with pytest.raises(RaiseException, match="code release failed"):
                submissions.rollback_pending_submission_if_unreferenced("skin", player_uuid=OWNER)
            assert testing.value("SELECT count(*) FROM submissions") == 1
            assert testing.value("SELECT redeemed_at IS NOT NULL FROM codes WHERE id = %s", (code,)) is True
            assert png.read_bytes() == b"original-png"
        else:
            assert submissions.rollback_pending_submission_if_unreferenced("skin", player_uuid=OWNER) is True
            assert testing.value("SELECT count(*) FROM submissions") == 0
            assert testing.value("SELECT redeemed_at FROM codes WHERE id = %s", (code,)) is None
            assert not png.exists()
    finally:
        if failure:
            testing.execute("DROP TRIGGER fail_orphan_code_release ON codes")
            testing.execute("DROP FUNCTION fail_orphan_code_release()")


def test_native_orphan_rollback_retains_every_remaining_lore_reference():
    png, code = skin()
    lore("a")
    lore("b")
    testing.execute("DELETE FROM lore_item_customisations WHERE character_id = 'a'")
    assert submissions.rollback_pending_submission_if_unreferenced("skin", player_uuid=OWNER) is False
    assert png.is_file() and testing.value("SELECT redeemed_at IS NOT NULL FROM codes WHERE id = %s", (code,))
    testing.execute("DELETE FROM lore_item_customisations")
    assert submissions.rollback_pending_submission_if_unreferenced("skin", player_uuid=OWNER) is True
