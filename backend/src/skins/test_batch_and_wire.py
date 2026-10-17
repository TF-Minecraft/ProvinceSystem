"""Real HTTP batch writers and non-empty plugin objects on native Postgres."""
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from src.api.drinks_routes import drinks_router
from src.api.skins_routes import skins_router
from src.auth import testing
from src.auth.test_locking import Gate, ROW
from src.skins import db, discord_link, drinks, submissions
from src.skins.test_api_formats import body
from src.skins.test_locking import (  # noqa: F401 - shared fixture and real writer helpers
    DISCORD_ID, ENTITLEMENTS, OTHER_DISCORD_ID, OTHER_PLAYER, PLAYER,
    drink_catalog, env, race, session_for, submit_drink,
)
from src.skins.testing import link

PLUGIN = {"X-Plugin-Key": "batch-key"}
STAFF = {"X-Staff-Key": "staff-key"}


@pytest.fixture
def api(env, tmp_path, monkeypatch):
    # The Characters post-apply bridge shares the isolated test database.
    monkeypatch.setenv("PLUGIN_KEY", "batch-key")
    monkeypatch.setenv("STAFF_KEY", "staff-key")
    app = FastAPI()
    app.include_router(skins_router)
    app.include_router(drinks_router)
    return TestClient(app, raise_server_exceptions=False)


def png(colour):
    out = io.BytesIO()
    Image.new("RGBA", (16, 16), (colour, 2 * colour, 3 * colour, 255)).save(out, format="PNG")
    return out.getvalue()


def items(scope, count=3):
    if scope == "drink":
        drink_catalog()
    made = []
    for i in range(count):
        session = session_for(scope)
        if scope == "drink":
            item = submit_drink(session, f"Batch Brew {i}")()
            drinks.approve_drink_submission(item["id"])
        else:
            item = submissions.create_submission(session, "handheld", f"Batch Sword {i}",
                                                 {"texture": png(i + 1)}, base_set="swords")
            submissions.approve_submission(item["id"])
        made.append(item["id"])
    return made


@pytest.mark.parametrize("scope", ["skin", "drink"])
@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("phase", ["update", "lock"])
def test_apply_batches_wait_without_deadlocking(api, monkeypatch, scope, reverse, phase):
    ids = items(scope)
    table = "drink_submissions" if scope == "drink" else "skin_submissions"
    route = "drinks" if scope == "drink" else "skins"
    gate = Gate(monkeypatch, f"UPDATE {table}" if phase == "update" else f"SELECT id FROM {table}")
    post = lambda batch: api.post(f"/{route}/plugin/applied", json={"submission_ids": batch}, headers=PLUGIN)
    one, two = race(gate, lambda: post(ids[:2]),
                    lambda: post([ids[1], ids[0], ids[2]] if reverse else ids), ROW)
    assert one.error is None and two.error is None
    assert one.value.status_code == two.value.status_code == 200
    assert one.value.content == body({"applied": ids[:2]})
    assert two.value.content == body({"applied": [ids[2]]})
    assert testing.rows(f"SELECT status, applied_at IS NOT NULL AS dated FROM {table}") == [
        {"status": "applied", "dated": True}] * 3
    if scope == "drink":
        assert testing.value("SELECT COUNT(*) FROM drink_notifications WHERE type = 'applied'") == 3


@pytest.mark.parametrize("scope", ["skin", "drink"])
def test_apply_keeps_input_order_duplicates_blanks_and_state_guards(api, scope):
    ids = items(scope, 4)
    table = "drink_submissions" if scope == "drink" else "skin_submissions"
    testing.execute(f"UPDATE {table} SET status = 'pending' WHERE id = %s", (ids[2],))
    testing.execute(f"UPDATE {table} SET status = 'applied', applied_at = now() WHERE id = %s", (ids[3],))
    before = testing.value(f"SELECT applied_at FROM {table} WHERE id = %s", (ids[3],))
    if scope == "drink":
        testing.execute("UPDATE drink_submissions SET status = 'pending_pack' WHERE id = %s", (ids[1],))
    route = "drinks" if scope == "drink" else "skins"
    batch = [" " + ids[1] + " ", "", ids[1], ids[0], ids[2], ids[3], "missing"]
    response = api.post(f"/{route}/plugin/applied", json={"submission_ids": batch}, headers=PLUGIN)
    assert response.content == body({"applied": [ids[1], ids[0]]})
    assert testing.value(f"SELECT status FROM {table} WHERE id = %s", (ids[2],)) == "pending"
    assert testing.value(f"SELECT applied_at FROM {table} WHERE id = %s", (ids[3],)) == before
    if scope == "drink":
        assert testing.value("SELECT COUNT(*) FROM drink_notifications WHERE type = 'applied'") == 2


@pytest.mark.parametrize("field", ["discord_username", "discord_nickname"])
@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("phase", ["update", "lock"])
def test_name_batches_wait_without_deadlocking(api, monkeypatch, field, reverse, phase):
    third = "523456789012345678"
    link(OTHER_PLAYER, OTHER_DISCORD_ID, "Alex", "alex")
    link("00000000-0000-4000-8000-000000000003", third, "Pat", "pat")
    ids = [DISCORD_ID, OTHER_DISCORD_ID, third]
    gate = Gate(monkeypatch, f"SET {field} = %s" if phase == "update" else
                "SELECT discord_user_id FROM discord_links")

    def post(batch, value):
        return api.post("/skins/discord/usernames", headers=STAFF, json={"overwrite": True,
            "updates": [{"discord_user_id": did, field: value} for did in batch]})

    one, two = race(gate, lambda: post(ids[:2], "first.name"),
                    lambda: post([ids[1], ids[0], ids[2]] if reverse else ids, "last.name"), ROW)
    assert one.error is None and two.error is None
    assert one.value.status_code == two.value.status_code == 200
    count_key = "updated" if field == "discord_username" else "nicknames_updated"
    assert one.value.json()[count_key] == 2 and two.value.json()[count_key] == 3
    assert testing.rows(f"SELECT {field} FROM discord_links") == [{field: "last.name"}] * 3


@pytest.mark.parametrize("overwrite", [False, True])
def test_name_batch_duplicates_and_invalid_items_keep_original_order(api, overwrite):
    testing.execute("UPDATE discord_links SET discord_username = NULL")
    response = api.post("/skins/discord/usernames", headers=STAFF, json={"overwrite": overwrite, "updates": [
        {"discord_user_id": " ", "discord_username": "ignored"},
        {"discord_user_id": DISCORD_ID, "discord_username": "first.name", "discord_nickname": "First"},
        {"discord_user_id": DISCORD_ID, "discord_username": "invalid name!", "discord_nickname": "Bad\u0001"},
        {"discord_user_id": DISCORD_ID, "discord_username": "last.name", "discord_nickname": None},
    ]})
    assert response.content == body({"updated": 2 if overwrite else 1, "nicknames_updated": 2})
    assert testing.rows("SELECT discord_username, discord_nickname FROM discord_links") == [{
        "discord_username": "last.name" if overwrite else "first.name", "discord_nickname": None}]


@pytest.mark.parametrize("kind", ["plugin", "moderation"])
@pytest.mark.parametrize("phase", ["update", "lock"])
def test_ack_batches_keep_duplicate_order_and_first_delivery_time(api, monkeypatch, kind, phase):
    table = "plugin_notices" if kind == "plugin" else "player_notifications"
    for i in range(3):
        columns, values, params = ("", "", ()) if kind == "plugin" else (
            ", discord_user_id", ", %s", (DISCORD_ID,))
        testing.execute(f"INSERT INTO {table} (type, player_uuid, payload, created_at{columns}) "
                        f"VALUES ('test', %s, '{{}}', now(){values})", (PLAYER, *params))
    route = "/skins/plugin/notices/ack" if kind == "plugin" else "/skins/moderation/notifications/ack"
    headers = PLUGIN if kind == "plugin" else STAFF
    gate = Gate(monkeypatch, f"UPDATE {table}" if phase == "update" else f"SELECT id FROM {table}")
    post = lambda ids: api.post(route, json={"ids": ids}, headers=headers)
    one, two = race(gate, lambda: post([1, 2]), lambda: post([2, 1, 3, 2, 99]), ROW)
    assert one.error is None and two.error is None
    assert one.value.status_code == two.value.status_code == 200
    assert one.value.json()["acked"] == [1, 2]
    assert two.value.json()["acked"] == [2, 1, 3, 2]
    delivered = testing.rows(f"SELECT delivered_at FROM {table} ORDER BY id")
    assert delivered[0] == delivered[1] and delivered[0]["delivered_at"] is not None
    assert post([1, 2]).status_code == 200
    assert testing.rows(f"SELECT delivered_at FROM {table} ORDER BY id") == delivered


def test_drink_notification_follows_the_commit(api, monkeypatch):
    ids = items("drink", 1)
    real_enqueue = drinks.enqueue_drink_notification

    def enqueue(kind, sid, *args, **kwargs):
        # An independent connection must already see the applied state.
        assert testing.value("SELECT status FROM drink_submissions WHERE id = %s", (sid,)) == "applied"
        return real_enqueue(kind, sid, *args, **kwargs)

    monkeypatch.setattr(drinks, "enqueue_drink_notification", enqueue)
    assert api.post("/drinks/plugin/applied", json={"submission_ids": ids}, headers=PLUGIN).content == body({"applied": ids})


@pytest.mark.parametrize("path", ["queue", "single"])
def test_real_drink_recipe_plugin_bytes(api, path):
    drink_catalog()
    raw = {"name": "Wire Ale", "ingredients": [{"id": "grape", "amount": 1}],
           "effects": [{"type": "speed", "duration": 4, "amplifier": 1}], "color": "#AABBCC",
           "lore": [{"text": "A fine ale", "colours": ["#AABBCC"]}]}
    made = drinks.create_drink_submission(session_for("drink"), raw)
    drinks.approve_drink_submission(made["id"])
    recipe = {
        "name": "Wire Ale", "names": None, "name_colours": [], "name_bad_colours": [], "name_good_colours": [],
        "ingredients": [{"id": "grape", "amount": 1}], "cooking_time": 0, "distill_runs": 0,
        "distill_time": 0, "wood": None, "barrel_type": None, "age": 0, "difficulty": 1, "alcohol": 0,
        "effects": [{"type": "speed", "duration": 4, "amplifier": 1}], "color": "#AABBCC",
        "lore": [{"text": "§7A fine ale", "colours": ["#aabbcc"]}], "drink_message": None, "drink_title": None,
        "drink_message_colours": [], "drink_title_colours": [], "glint": False,
    }
    route = "/drinks/plugin/pending-apply" if path == "queue" else f"/drinks/plugin/drinks/{made['id']}"
    response = api.get(route, headers=PLUGIN)
    assert response.status_code == 200
    row = response.json()["submissions"][0] if path == "queue" else response.json()
    expected = {**row, "recipe": recipe}
    assert row == expected  # Pin values and types as well as bytes and non-empty object order.
    assert response.content == body({"submissions": [expected]} if path == "queue" else expected)


@pytest.mark.parametrize("staff", [False, True])
def test_real_armour_maps_plugin_bytes(api, monkeypatch, staff):
    tiers = ["light_iron", "mage_iron"]
    monkeypatch.setattr(submissions, "resolve_web_entitlements", lambda *a, **k: {
        **ENTITLEMENTS, "skin_kinds": ["armor_set"]})
    if staff:
        # Staff landing validation belongs to the catalogue; retain the real map producer order here.
        from src.skins import catalog
        catalog.replace_catalog({"categories": [{"id": "armor", "skin_sets": []}], "scrolls": [
            {"id": "light"}, {"id": "mage"}]})
    files = {f"{tier}_{part}": png(i + 1) for i, (tier, part) in enumerate(
        (tier, part) for tier in tiers for part in ("helmet", "chestplate", "leggings", "boots", "layer_1", "layer_2"))}
    session = session_for("skin")
    if staff:
        testing.execute("UPDATE login_codes SET scope = 'skin_staff' WHERE id = %s", (session["code_id"],))
        session["scope"], session["staff"] = "skin_staff", True
    made = submissions.create_submission(session, "armor_set", "Wire Armour", files, tiers=tiers,
        tier_aliases={"mage_iron": "Mage", "light_iron": "Light"},
        **({"category": "armor", "tier_scrolls": {"mage_iron": "mage", "light_iron": "light"}} if staff else {}))
    if not staff:
        submissions.approve_submission(made["id"])
    response = api.get("/skins/plugin/approved", headers=PLUGIN)
    assert response.status_code == 200
    row = response.json()["submissions"][0]
    expected = {**row, "tier_aliases": {"light_iron": "Light", "mage_iron": "Mage"},
                "tier_sets": {"light_iron": "light iron", "mage_iron": "mage iron"}}
    if staff:
        expected["tier_scrolls"] = {"light_iron": "light", "mage_iron": "mage"}
    assert row == expected
    assert response.content == body({"submissions": [expected]})
    # The single-item plugin endpoint returns the tier base sets, without aliases.
    response = api.get(f"/skins/plugin/submissions/{made['id']}", headers=PLUGIN)
    single = response.json()
    expected = {**single, "tier_sets": {"light_iron": "light iron", "mage_iron": "mage iron"}}
    assert single == expected
    assert response.content == body(expected)
