"""What the characters area sends to RPCharacters and the website keeps its pre-Postgres form.

Times are timestamptz and jsonb now; these tests pin the JSON the plugin and the
frontend parse: times as `YYYY-MM-DDTHH:MM:SSZ`, the roster's `created_at` as
RPCharacters' own text, sheet fields in the order the push gave them, and the
wardrobe payload byte for byte.
"""
from __future__ import annotations

import json
import re

import pytest

from src.auth import testing
from src.characters import creates, lore_items, wardrobe
from src.characters.creation_catalog import get_catalog, replace_catalog
from src.characters.roster import list_roster, replace_roster
from src.skins import db as db_mod

OWNER = "acc-owner"
DIED_MS = 1_760_356_800_000  # 2025-10-13T12:00:00Z
API_TIME = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch, postgres):
    for name, sub in (("DATA_DIR", ""), ("DRINKS_DIR", "drinks"),
                      ("SKINS_DIR", "skins"), ("WARDROBE_DIR", "wardrobe")):
        monkeypatch.setattr(db_mod, name, tmp_path / sub if sub else tmp_path)
    monkeypatch.setattr(wardrobe, "DATA_DIR", tmp_path)
    monkeypatch.setattr(wardrobe, "WARDROBE_DIR", tmp_path / "wardrobe")
    db_mod.ensure_directories()


def test_roster_sends_created_at_as_epoch_text_and_times_in_the_api_form():
    sheet = {"race_name": "High Elf", "class_name": "Ranger", "age": "34", "gender": "Female",
             "description": "Quiet.", "background": "Woods.", "attributes": {"strength": 3, "dex": 2},
             "traits": [{"id": "patient", "name": "Patient"}], "clues": ["A red banner."]}
    replace_roster(OWNER, [
        {"id": "c-ana", "name": "Ana", "status": "ALIVE", "created_at": "1760356800", **sheet},
        {"id": "c-bram", "name": "Bram", "status": "DEAD", "created_at": "1760356801",
         "died_at": DIED_MS, "death_id": "d-1"},
    ])
    ana, bram = list_roster(OWNER)
    assert ana["created_at"] == "1760356800"
    assert testing.value("SELECT pg_typeof(created_at)::text FROM character_roster LIMIT 1") == "timestamp with time zone"
    assert bram["died_at"] == "2025-10-13T12:00:00Z"
    assert all(re.fullmatch(API_TIME, c["updated_at"]) for c in (ana, bram))
    # Sheet fields follow the roster's own keys in the order RPCharacters pushed them.
    assert [k for k in ana if k in sheet] == list(sheet)


def test_wardrobe_payload_is_byte_for_byte_the_same():
    replace_roster(OWNER, [{"id": "c-ana", "name": "Ana", "status": "ALIVE"}])
    testing.execute(
        "INSERT INTO character_wardrobe_slots (player_uuid, character_id, slot, png_relpath, texture_value, "
        "texture_signature, model, display_name, apply_pending, updated_at) "
        "VALUES (%s, 'c-ana', 'base', 'wardrobe/x/base.png', 'v', 's', 'classic', NULL, true, "
        "'2026-01-02T03:04:05.678901Z')", (OWNER,))
    slot = {"slot": "base", "unlocked": True, "filled": True, "model": "classic", "display_name": "Base",
            "custom_name": False, "apply_pending": True, "has_signature": True, "signed": True,
            "updated_at": "2026-01-02T03:04:05Z", "texture_url": "/characters/c-ana/wardrobe/base/texture"}

    def empty(name, label, unlocked):
        return {"slot": name, "unlocked": unlocked, "filled": False, "model": None, "display_name": label,
                "custom_name": False, "apply_pending": False, "has_signature": False, "signed": False,
                "updated_at": None, "texture_url": None}

    expected = {"character_id": "c-ana", "player_uuid": OWNER, "active_slot": "base", "swappable_slots": 1,
                "slots": [slot, empty("extra_1", "Skin 2", False), empty("extra_2", "Skin 3", False),
                          empty("masked", "Masked", True)]}
    assert json.dumps(wardrobe.get_wardrobe(OWNER, "c-ana")) == json.dumps(expected)
    plugin = wardrobe.get_wardrobe_for_plugin(OWNER, "c-ana")
    assert (plugin["slots"][0]["texture_value"], plugin["slots"][0]["updated_at"]) == ("v", "2026-01-02T03:04:05Z")


def test_creates_send_times_in_the_api_form(monkeypatch):
    monkeypatch.setattr(creates, "_validate_and_normalize",
                        lambda uuid, body, realm_id: {"name": "Cael", "client_request_id": "r-1"})
    made = creates.create_character(OWNER, {"name": "Cael"})
    assert re.fullmatch(API_TIME, made["created_at"])
    assert made["applied_at"] is None and made["payload"] == {"name": "Cael", "client_request_id": "r-1"}
    (pending,) = creates.list_pending("main")
    assert pending["created_at"] == made["created_at"]
    creates.mark_applied_results([{"id": made["id"], "ok": False, "error": "slot full"}])
    rejected = next(c for c in creates.list_for_player(OWNER)["characters"] if c["id"] == made["id"])
    assert re.fullmatch(API_TIME, rejected["created_at"])


def test_catalogue_round_trips_with_its_time_in_the_api_form():
    stored = replace_catalog({
        "stages": [{"id": "race", "type": "race"}],
        "attribute_point_buy": {"pool": 2, "max_rank": 1, "cost_for_rank": [1], "attributes": ["strength", "wit"]},
        "races": [{"id": "human", "name": "Human", "key": "race"}], "traits": [], "classes": [],
    })
    catalog = get_catalog()
    assert catalog["updated_at"] == stored["updated_at"]
    assert re.fullmatch(API_TIME, catalog["updated_at"])
    assert catalog["stages"] == stored["stages"]
    assert catalog["attribute_point_buy"]["attributes"] == ["strength", "wit"]


def test_lore_items_send_times_and_lists_as_before():
    testing.execute(
        "INSERT INTO lore_item_customisations (player_uuid, character_id, kit_key, display_name, lore, "
        "state, skin_slug, ready_at, updated_at, realm_id, name_colours) VALUES (%s, 'c-ana', 'sword', 'Edge', "
        "'[\"§7Old\"]', 'ready', 'my-sword', '2026-01-02T03:04:05Z', '2026-01-02T03:04:06Z', 'main', "
        "'[\"#ff0000\"]')", (OWNER,))
    (item,) = lore_items.list_pending_for_plugin("main")
    assert (item["ready_at"], item["updated_at"]) == ("2026-01-02T03:04:05Z", "2026-01-02T03:04:06Z")
    assert (item["lore"], item["name_colours"]) == (["§7Old"], ["#ff0000"])
    (mine,) = lore_items.list_player_custom_items(OWNER)
    assert (mine["updated_at"], mine["ready_at"], mine["applied_at"]) == (
        "2026-01-02T03:04:06Z", "2026-01-02T03:04:05Z", None)
