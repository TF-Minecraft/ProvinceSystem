"""Armour submissions are one metal line; the plugin gets each set's base set."""

import json

import pytest

from src.skins import db
from src.skins.naming import armor_tier_base_set, armor_tier_label


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    for name in ("SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    db.migrate()
    return db


def _insert_armor(conn, sid, tiers, *, tier_sets=None):
    conn.execute(
        "INSERT OR IGNORE INTO codes (id, code_hash, player_uuid, created_at, expires_at) "
        "VALUES (1, 'hash', 'player', 'now', 'later')"
    )
    conn.execute(
        """
        INSERT INTO submissions (
            id, player_uuid, code_id, kind, slug, display_name, tiers,
            tier_sets, status, dir_path, created_at, reviewed_at
        )
        VALUES (?, 'player', 1, 'armor_set', ?, 'Name', ?, ?, 'approved',
                '/tmp/x', 'now', 'now')
        """,
        (sid, sid, json.dumps(tiers), tier_sets),
    )


def test_tier_names_and_labels():
    assert armor_tier_base_set("light_iron") == "light iron"
    assert armor_tier_base_set("mage_mythril") == "mage mythril"
    assert armor_tier_base_set("iron") == "iron"
    assert armor_tier_base_set("mage") == "mage"
    assert armor_tier_label("heavy_abyssalite") == "Heavy Abyssalite"
    assert armor_tier_label("infantry") == "Infantry"


def test_validate_tiers_accepts_one_metal_line():
    from src.skins.submissions import _validate_tiers

    tiers = ["light_bronze", "medium_bronze", "heavy_bronze", "infantry_bronze", "mage_bronze"]
    assert _validate_tiers([t.upper() for t in tiers]) == tiers


@pytest.mark.parametrize(
    ("tiers", "message"),
    [
        (["light_iron", "heavy_steel"], "same metal"),
        (["iron"], "not valid"),
        (["light_gold"], "not valid"),
        (["light_iron", "light_iron"], "duplicate"),
        ([], "requires"),
        (["light_iron"] * 6, "at most 5"),
    ],
)
def test_validate_tiers_rejects(tiers, message):
    from src.skins.submissions import _validate_tiers

    with pytest.raises(ValueError, match=message):
        _validate_tiers(tiers)


def test_default_set_names():
    from src.skins.submissions import _validate_tier_aliases

    assert _validate_tier_aliases(["light_iron", "mage_iron"], {"mage_iron": "Robes"}) == {
        "light_iron": "Light Iron",
        "mage_iron": "Robes",
    }


def test_plugin_gets_base_set_per_tier(database):
    from src.skins.submissions import get_submission_for_plugin, list_approved_pending_apply

    with database.connect() as conn:
        _insert_armor(conn, "p_line", ["light_steel", "mage_steel"])
        _insert_armor(conn, "p_old", ["iron"])
        _insert_armor(conn, "p_set", ["iron"], tier_sets='{"iron": "heavy iron"}')
        conn.commit()

    sets = {row["id"]: row["tier_sets"] for row in list_approved_pending_apply()}
    assert sets == {
        "p_line": {"light_steel": "light steel", "mage_steel": "mage steel"},
        "p_old": {"iron": "iron"},
        "p_set": {"iron": "heavy iron"},
    }
    assert get_submission_for_plugin("p_set")["tier_sets"] == {"iron": "heavy iron"}


def test_thalendorian_metal_sets_are_light(database):
    from src.skins.submissions import get_submission_for_plugin

    with database.connect() as conn:
        _insert_armor(
            conn,
            "geofflive_thalendorian_armor",
            ["iron", "steel", "abyssalite", "mythril", "mage"],
        )
        conn.commit()
    database.migrate()
    assert get_submission_for_plugin("geofflive_thalendorian_armor")["tier_sets"] == {
        "iron": "light iron",
        "steel": "light steel",
        "abyssalite": "light abyssalite",
        "mythril": "light mythril",
        "mage": "mage",
    }

    # Staff edits made after the upgrade are kept on later starts.
    with database.connect() as conn:
        conn.execute(
            "UPDATE submissions SET tier_sets = '{\"iron\": \"medium iron\"}' "
            "WHERE id = 'geofflive_thalendorian_armor'"
        )
        conn.commit()
    database.migrate()
    assert get_submission_for_plugin("geofflive_thalendorian_armor")["tier_sets"]["iron"] == "medium iron"
