"""Wardrobe upload failure logging."""

from __future__ import annotations

import gc
import logging
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
PLAYER = "wardrobe-log-player"
CREATE_ID = "create-wardrobe-log"


class WardrobeUploadLoggingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)

        import skins.db as db_mod

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
        from src.characters import wardrobe

        paths = patch.multiple(wardrobe, DATA_DIR=root, WARDROBE_DIR=root / "wardrobe")
        paths.start()
        self.addCleanup(paths.stop)

        from src.characters.rpc_player_meta import upsert_rpc_player_meta

        upsert_rpc_player_meta(
            {
                "player_uuid": PLAYER,
                "name_colour_stops": 0,
                "allow_drink_texture": False,
                "max_alive_characters": 3,
                "wardrobe_skin_slots": 1,
                "max_3d_pair_bytes": 30720,
                "skin_token_cooldown_days": -1,
                "skin_kinds": [],
                "allow_armor_3d_helmet": False,
            }
        )

        with database.connect() as conn:
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
        db_mod.DATA_DIR = self._orig_data
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        gc.collect()
        self.tmp.cleanup()

    def test_png_upload_diag_invalid_bytes(self) -> None:
        from src.characters.wardrobe import _png_upload_diag

        diag = _png_upload_diag(b"not-a-png")
        self.assertIn("magic_ok=False", diag)
        self.assertIn("len=9", diag)

    def test_pending_upload_logs_invalid_png(self) -> None:
        from src.characters.wardrobe import WardrobeError, upload_pending_create_wardrobe

        with self.assertLogs("characters.wardrobe", level="WARNING") as caplog:
            with self.assertRaises(WardrobeError) as ctx:
                upload_pending_create_wardrobe(
                    PLAYER,
                    CREATE_ID,
                    "base",
                    b"not-a-png",
                    model_override="classic",
                )
        self.assertIn("File is not a valid PNG", str(ctx.exception))
        joined = "\n".join(caplog.output)
        self.assertIn("[wardrobe] upload failed", joined)
        self.assertIn("kind=pending_create", joined)
        self.assertIn(f"target_id={CREATE_ID}", joined)
        self.assertIn("slot=base", joined)
        self.assertIn("detail=File is not a valid PNG", joined)
        self.assertIn("magic_ok=False", joined)


if __name__ == "__main__":
    unittest.main()
