"""Unit tests for account creation epoch sync via roster push."""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

pytestmark = pytest.mark.usefixtures("postgres")

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class AccountAgeMetaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)

        import src.skins.db as db_mod

        self._db_mod = db_mod

        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.ensure_directories()

    def tearDown(self) -> None:
        self._db_mod.DRINKS_DIR = self._orig_drinks
        self._db_mod.DATA_DIR = self._orig_data
        self._db_mod.SKINS_DIR = self._orig_skins
        self._db_mod.WARDROBE_DIR = self._orig_wardrobe
        try:
            self.tmp.cleanup()
        except PermissionError:
            pass

    def test_roster_epoch_drives_list_account_age_and_evil_unlocked(self) -> None:
        from src.characters import creates as creates_mod
        from src.characters.roster import get_player_meta, replace_roster

        uuid = "player-account-age-1"
        now_epoch = int(datetime.now(timezone.utc).timestamp())
        created_epoch = now_epoch - (48 * 3600)

        replace_roster(
            uuid,
            [{"id": "char-1", "name": "Hero", "status": "ALIVE"}],
            account_created_at_epoch=created_epoch,
            realm_id="main",
        )

        meta = get_player_meta(uuid)
        self.assertEqual(meta.get("account_created_at_epoch"), created_epoch)

        with mock.patch(
            "src.characters.rpc_player_meta.resolve_web_entitlements",
            return_value={
                "name_colour_stops": 0,
                "wardrobe_skin_slots": 1,
                "meta_synced": True,
                "permission_flags": {},
                "kit_cooldown_seconds_remaining": 0,
                "kit_cooldown_hours": 0,
                "kit_cooldowns": {},
            },
        ), mock.patch(
            "src.characters.creation_catalog.get_catalog",
            return_value={
                "slot_limits": {},
                "validation": {"clues": {"evil_min_account_age_hours": 24}},
            },
        ):
            listed = creates_mod.list_for_player(uuid, "main")

        self.assertGreaterEqual(listed["account_age_seconds"], 47 * 3600)
        self.assertTrue(listed["evil_unlocked"])


if __name__ == "__main__":
    unittest.main()
