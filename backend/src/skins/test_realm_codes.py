"""Unit tests for codes.realm_id + character_creates stamp."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class RealmCodesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"

        import skins.db as db_mod
        import skins.codes as codes_mod

        self._db_mod = db_mod
        sys.modules["src.skins.db"] = db_mod
        sys.modules["src.skins.codes"] = codes_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DB_PATH = self.db_path
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.migrate()

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def test_normalize_realm_id(self) -> None:
        from skins.codes import CodeError, normalize_realm_id

        self.assertEqual(normalize_realm_id(None), "main")
        self.assertEqual(normalize_realm_id(""), "main")
        self.assertEqual(normalize_realm_id("  DEV "), "dev")
        with self.assertRaises(CodeError):
            normalize_realm_id("bad realm!")
        with self.assertRaises(CodeError):
            normalize_realm_id("x" * 33)

    def test_mint_with_realm_redeem_session(self) -> None:
        from skins.codes import get_session, issue_code, redeem_profile_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ):
            issued = issue_code("player-realm-1", "profile", realm_id="dev")
        self.assertEqual(issued["realm_id"], "dev")
        session = redeem_profile_code(issued["code"])
        self.assertEqual(session["realm_id"], "dev")
        loaded = get_session(session["session_token"])
        assert loaded is not None
        self.assertEqual(loaded["realm_id"], "dev")

    def test_mint_omit_realm_defaults_main(self) -> None:
        from skins.codes import issue_code, redeem_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ):
            issued = issue_code("player-realm-2", "skin")
        self.assertEqual(issued["realm_id"], "main")
        with mock.patch(
            "src.characters.rpc_player_meta.resolve_web_entitlements",
            return_value={
                "name_colour_stops": 0,
                "max_3d_pair_bytes": 30720,
                "skin_token_cooldown_days": -1,
                "skin_kinds": [],
                "allow_armor_3d_helmet": False,
                "meta_synced": False,
            },
        ):
            session = redeem_code(issued["code"])
        self.assertEqual(session["realm_id"], "main")

    def test_invalid_realm_on_mint(self) -> None:
        from skins.codes import CodeError, issue_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ):
            with self.assertRaises(CodeError):
                issue_code("player-realm-3", "skin", realm_id="!!!")

    def test_create_character_stamps_realm(self) -> None:
        from characters import creates as creates_mod

        with mock.patch.object(
            creates_mod,
            "require_synced_creation_catalog",
            return_value={"web_creator_access": {"by_realm": {}}},
        ), mock.patch.object(
            creates_mod,
            "_validate_and_normalize",
            return_value={"client_request_id": None, "name": "Test"},
        ):
            row = creates_mod.create_character(
                "player-realm-4",
                {"name": "Test"},
                realm_id="dev",
            )
        self.assertEqual(row["realm_id"], "dev")


if __name__ == "__main__":
    unittest.main()
