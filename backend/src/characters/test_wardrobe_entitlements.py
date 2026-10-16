"""Wardrobe slot count uses rpc_player_meta, not stale character_player_meta."""

from __future__ import annotations

import gc
import sys
import tempfile
import unittest
from pathlib import Path

import pytest

from src import database

pytestmark = pytest.mark.usefixtures("postgres")

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

NOW = "2026-01-01T00:00:00Z"
PLAYER = "wardrobe-ent-player"
CHAR_ID = "char-wardrobe-ent"
CREATE_ID = "create-wardrobe-ent"


class WardrobeEntitlementsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)

        import skins.db as db_mod

        self._db_mod = db_mod
        sys.modules["src.skins.db"] = db_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_data = db_mod.DATA_DIR
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DB_PATH = root / "province.db"
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.migrate()

        from characters.rpc_player_meta import upsert_rpc_player_meta

        upsert_rpc_player_meta(
            {
                "player_uuid": PLAYER,
                "name_colour_stops": 0,
                "allow_drink_texture": False,
                "max_alive_characters": 3,
                "wardrobe_skin_slots": 3,
                "max_3d_pair_bytes": 30720,
                "skin_token_cooldown_days": -1,
                "skin_kinds": [],
                "allow_armor_3d_helmet": False,
            }
        )

        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_player_meta (
                    player_uuid, wardrobe_skin_slots, updated_at
                ) VALUES (%s, 1, %s)
                """,
                (PLAYER, NOW),
            )
            conn.execute(
                """
                INSERT INTO character_roster (
                    player_uuid, realm_id, character_id, name, status, updated_at
                ) VALUES (%s, 'main', %s, 'Test', 'ALIVE', %s)
                """,
                (PLAYER, CHAR_ID, NOW),
            )
            conn.execute(
                """
                INSERT INTO character_creates (
                    id, player_uuid, payload, status, created_at, realm_id
                ) VALUES (%s, %s, '{}', 'pending', %s, 'main')
                """,
                (CREATE_ID, PLAYER, NOW),
            )

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DATA_DIR = self._orig_data
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        gc.collect()
        self.tmp.cleanup()

    def test_live_wardrobe_uses_rpc_slots_not_roster_meta(self) -> None:
        from characters.wardrobe import get_wardrobe

        out = get_wardrobe(PLAYER, CHAR_ID)
        self.assertEqual(out["swappable_slots"], 3)
        by_slot = {s["slot"]: s for s in out["slots"]}
        self.assertTrue(by_slot["extra_1"]["unlocked"])
        self.assertTrue(by_slot["extra_2"]["unlocked"])

    def test_pending_wardrobe_uses_rpc_slots(self) -> None:
        from characters.wardrobe import enforce_pending_wardrobe_slot_limits

        swappable = enforce_pending_wardrobe_slot_limits(PLAYER, CREATE_ID)
        self.assertEqual(swappable, 3)


if __name__ == "__main__":
    unittest.main()
