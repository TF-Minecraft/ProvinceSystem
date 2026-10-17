"""Orphan pending skin rollback on kit customise draft delete."""

from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from pathlib import Path

import pytest
from src import database

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

NOW = "2026-01-01T00:00:00Z"
PLAYER = "11111111-1111-4111-8111-111111111111"
CREATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
REALM = "main"
KIT_KEY = "iron_hunting_knife"
SUBMISSION_ID = "player-testknife"
APPLIED_ID = "player-appliedknife"
CODE_ID = 1
APPLIED_CODE_ID = 2

MINIMAL_CATALOG = {
    "stages": [],
    "attribute_point_buy": {
        "pool": 12,
        "max_rank": 2,
        "cost_for_rank": [1, 2],
        "attributes": [
            "strength",
            "dexterity",
            "constitution",
            "intelligence",
            "wisdom",
            "charisma",
        ],
        "abbreviations": {
            "strength": "str",
            "dexterity": "dex",
            "constitution": "con",
            "intelligence": "int",
            "wisdom": "wis",
            "charisma": "cha",
        },
    },
    "races": [{"id": "human", "name": "Human", "key": "race"}],
    "traits": [{"id": "str1", "name": "Strength +1", "key": "attributes", "cost": 0}],
    "classes": [{"id": "warrior", "name": "Warrior", "display_order": 1}],
    "validation": {"name_max": 24, "age_min": 16},
    "slot_limits": {"hard_cap": 10, "default": 1},
    "editable_kit": [
        {
            "kit_key": KIT_KEY,
            "path": "m.tools.IRON_HUNTING_KNIFE",
            "amount": 1,
            "kit_id": "starter",
            "skin_png": "knife_skin",
            "base_set": "knives",
            "preview": {
                "display_name": "Iron Hunting Knife",
                "lore": ["A starter blade."],
            },
        }
    ],
    "kits": [
        {
            "id": "starter",
            "display_name": "Starter",
            "cooldown_hours": 48,
            "once_per_character": True,
            "items": [
                {
                    "path": "m.tools.IRON_HUNTING_KNIFE",
                    "amount": 1,
                    "editable": True,
                },
            ],
        }
    ],
}

pytestmark = pytest.mark.usefixtures("postgres")


class OrphanSubmissionCleanupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        self.root = root

        db_mod = importlib.import_module("src.skins.db")
        self._db_mod = db_mod
        sys.modules["src.skins.db"] = db_mod
        self._orig_data = db_mod.DATA_DIR
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.ensure_directories()

        from src.characters.creation_catalog import replace_catalog

        replace_catalog(MINIMAL_CATALOG)
        self._seed_pending_create()

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DATA_DIR = self._orig_data
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def _seed_pending_create(self) -> None:
        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_creates (
                    id, player_uuid, payload, status, created_at, realm_id
                ) VALUES (%s, %s, '{"name":"Test"}', 'pending', %s, %s)
                """,
                (CREATE_ID, PLAYER, NOW, REALM),
            )

    def _insert_code(self, code_id: int) -> None:
        from src.auth.testing import execute

        execute(
            """
            INSERT INTO codes (
                id, code_hash, player_uuid, scope, realm_id,
                created_at, expires_at, redeemed_at, revoked
            ) VALUES (%s, %s, %s, 'profile', %s, %s, %s, %s, false)
            """,
            (
                code_id,
                f"hash-{code_id}",
                PLAYER,
                REALM,
                NOW,
                "2099-01-01T00:00:00Z",
                NOW,
            ),
        )

    def _insert_submission(
        self,
        submission_id: str,
        *,
        code_id: int,
        status: str = "pending",
    ) -> None:
        from src.auth.testing import execute

        self._insert_code(code_id)
        execute(
            """
            INSERT INTO submissions (
                id, player_uuid, code_id, kind, slug, display_name,
                status, dir_path, created_at, discord_user_id, staff, realm_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                submission_id,
                PLAYER,
                code_id,
                "handheld",
                submission_id,
                "Test Knife",
                status,
                f"skins/{submission_id}",
                NOW,
                "discord-1",
                False,
                REALM,
            ),
        )

    def _insert_lore_row(
        self,
        *,
        submission_id: str | None = None,
        existing_skin_id: str | None = None,
        state: str = "pending_skin",
    ) -> None:
        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO lore_item_customisations (
                    player_uuid, character_id, kit_key,
                    display_name, lore_json,
                    submission_id, existing_skin_id, state,
                    skin_slug, updated_at, realm_id
                ) VALUES (%s, %s, %s, '', '[]', %s, %s, %s, %s, %s, %s)
                """,
                (
                    PLAYER,
                    CREATE_ID,
                    KIT_KEY,
                    submission_id,
                    existing_skin_id,
                    state,
                    existing_skin_id,
                    NOW,
                    REALM,
                ),
            )

    def _submission_exists(self, submission_id: str) -> bool:
        from src.auth.testing import rows

        return bool(rows("SELECT 1 FROM submissions WHERE id = %s", (submission_id,)))

    def test_delete_kit_draft_rolls_back_orphaned_pending_submission(self) -> None:
        from src.characters.lore_items import delete_lore_item_customise

        self._insert_submission(SUBMISSION_ID, code_id=CODE_ID)
        self._insert_lore_row(submission_id=SUBMISSION_ID, state="pending_skin")
        self.assertTrue(self._submission_exists(SUBMISSION_ID))

        result = delete_lore_item_customise(PLAYER, CREATE_ID, KIT_KEY)
        self.assertEqual(result["deleted"], 1)
        self.assertFalse(self._submission_exists(SUBMISSION_ID))

    def test_delete_kit_draft_keeps_applied_skin_reference(self) -> None:
        from src.characters.lore_items import delete_lore_item_customise

        self._insert_submission(APPLIED_ID, code_id=APPLIED_CODE_ID, status="applied")
        self._insert_lore_row(
            existing_skin_id=APPLIED_ID,
            state="ready",
        )
        self.assertTrue(self._submission_exists(APPLIED_ID))

        delete_lore_item_customise(PLAYER, CREATE_ID, KIT_KEY)
        self.assertTrue(self._submission_exists(APPLIED_ID))


if __name__ == "__main__":
    unittest.main()
