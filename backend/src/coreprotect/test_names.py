import json

import pytest

from src.coreprotect import names

TABLE = {
    "version": "test",
    "block": {"stone": "Stone", "wheat": "Wheat Crops", "oak_door": "Oak Door", "short_grass": "Short Grass"},
    "item": {"wheat": "Wheat", "iron_ingot": "Iron Ingot"},
    "entity": {"cow": "Cow", "sheep": "Sheep", "zombie": "Zombie"},
}


@pytest.fixture
def vanilla(tmp_path, monkeypatch):
    path = tmp_path / "minecraft_names.json"
    path.write_text(json.dumps(TABLE))
    monkeypatch.setattr(names, "PATH", path)
    names._table.cache_clear()
    yield
    names._table.cache_clear()


def test_blocks_and_items_use_their_own_names(vanilla):
    assert names.describe("minecraft:wheat", names.BLOCK, "?")["name"] == "Wheat Crops"
    assert names.describe("minecraft:wheat", names.ITEM, "?")["name"] == "Wheat"
    # Most block-items only have a block name.
    assert names.describe("minecraft:stone", names.ITEM, "?") == names.target("Stone", id="stone", vanilla_name="Stone")


def test_unknown_ids_are_tidied(vanilla):
    assert names.describe("minecraft:mossy_thing", names.BLOCK, "?") == names.target("Mossy Thing", id="mossy_thing")
    assert names.describe(None, names.BLOCK, "Unknown material #9") == names.target("Unknown material #9", source="unknown")


def test_other_namespaces_never_borrow_vanilla_names(vanilla):
    assert names.describe("some_mod:wheat", names.BLOCK, "?") == names.target("Wheat", source="unknown", id="some_mod:wheat")


def test_without_the_file_names_are_tidied(tmp_path, monkeypatch):
    monkeypatch.setattr(names, "PATH", tmp_path / "missing.json")
    names._table.cache_clear()
    try:
        assert names.describe("minecraft:short_grass", names.BLOCK, "?")["name"] == "Short Grass"
        assert names.describe("minecraft:short_grass", names.BLOCK, "?")["vanilla_name"] is None
    finally:
        names._table.cache_clear()
