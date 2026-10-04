"""Unit tests for rpc_player_meta + resolve_web_entitlements."""

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


class RpcPlayerMetaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"

        import skins.db as db_mod

        self._db_mod = db_mod
        # Character modules import src.skins.db — keep one module identity for tests.
        sys.modules["src.skins.db"] = db_mod
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
        self._sync_db_dependents(db_mod)

    def _sync_db_dependents(self, db_mod) -> None:
        import skins.drinks as drinks_mod

        drinks_mod.db = db_mod
        drinks_mod.connect = db_mod.connect
        sys.modules["src.skins.drinks"] = drinks_mod

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def test_upsert_get_round_trip(self) -> None:
        from characters.rpc_player_meta import (
            get_rpc_player_meta,
            upsert_rpc_player_meta,
        )

        out = upsert_rpc_player_meta(
            {
                "player_uuid": "Player-1",
                "name_colour_stops": 20,
                "allow_drink_texture": True,
                "allow_drink_message": True,
                "max_alive_characters": 5,
                "wardrobe_skin_slots": 3,
                "max_3d_pair_bytes": 40960,
                "skin_token_cooldown_days": 14,
                "skin_kinds": ["armor_set", "handheld"],
                "allow_armor_3d_helmet": True,
                "permission_flags": {"rulequiz.completed": True},
            }
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["realm_id"], "main")
        self.assertEqual(out["name_colour_stops"], 8)
        self.assertTrue(out["allow_drink_texture"])
        self.assertTrue(out["allow_drink_message"])
        self.assertEqual(out["permission_flags"]["rulequiz.completed"], True)

        row = get_rpc_player_meta("player-1")
        assert row is not None
        self.assertEqual(row["realm_id"], "main")
        self.assertEqual(row["name_colour_stops"], 8)
        self.assertEqual(row["skin_kinds"], ["armor_set", "handheld"])
        self.assertTrue(row["allow_drink_message"])
        self.assertTrue(row["meta_synced"])

    def test_donator_tier_round_trip(self) -> None:
        from characters.rpc_player_meta import (
            get_rpc_player_meta,
            resolve_web_entitlements,
            upsert_rpc_player_meta,
        )

        out = upsert_rpc_player_meta(
            {
                "player_uuid": "tier-player",
                "donator_tier": 2,
                "name_colour_stops": 0,
            }
        )
        self.assertEqual(2, out["donator_tier"])

        row = get_rpc_player_meta("tier-player")
        assert row is not None
        self.assertEqual(2, row["donator_tier"])

        ent = resolve_web_entitlements("tier-player")
        self.assertEqual(2, ent["donator_tier"])

    def test_rpc_player_meta_body_passes_donator_tier(self) -> None:
        from characters.rpc_player_meta import get_rpc_player_meta, upsert_rpc_player_meta
        from src.api.characters_routes import RpcPlayerMetaBody

        body = RpcPlayerMetaBody(player_uuid="route-tier-1", donator_tier=1)
        upsert_rpc_player_meta(body.model_dump())
        row = get_rpc_player_meta("route-tier-1")
        assert row is not None
        self.assertEqual(1, row["donator_tier"])

    def test_realm_scoped_get_upsert(self) -> None:
        from characters.rpc_player_meta import (
            get_rpc_player_meta,
            upsert_rpc_player_meta,
        )

        upsert_rpc_player_meta(
            {
                "player_uuid": "p1",
                "realm_id": "main",
                "name_colour_stops": 2,
                "skin_kinds": ["handheld"],
            }
        )
        upsert_rpc_player_meta(
            {
                "player_uuid": "p1",
                "realm_id": "dev",
                "name_colour_stops": 4,
                "skin_kinds": ["gun"],
            }
        )
        main = get_rpc_player_meta("p1", "main")
        dev = get_rpc_player_meta("p1", "dev")
        assert main is not None and dev is not None
        self.assertEqual(main["name_colour_stops"], 2)
        self.assertEqual(main["skin_kinds"], ["handheld"])
        self.assertEqual(dev["name_colour_stops"], 4)
        self.assertEqual(dev["skin_kinds"], ["gun"])
        self.assertIsNone(get_rpc_player_meta("p1", "tutorial"))

    def test_has_map_staff_access_true(self) -> None:
        from characters.rpc_player_meta import (
            has_map_staff_access,
            upsert_rpc_player_meta,
        )

        upsert_rpc_player_meta(
            {
                "player_uuid": "staff-map-1",
                "realm_id": "main",
                "permission_flags": {"tfmc.map.staff": True},
            }
        )
        self.assertTrue(
            has_map_staff_access("staff-map-1", "main", "tfmc.map.staff")
        )

    def test_has_map_staff_access_false_when_flag_missing(self) -> None:
        from characters.rpc_player_meta import (
            has_map_staff_access,
            upsert_rpc_player_meta,
        )

        upsert_rpc_player_meta(
            {
                "player_uuid": "staff-map-2",
                "realm_id": "main",
                "permission_flags": {"rulequiz.completed": True},
            }
        )
        self.assertFalse(
            has_map_staff_access("staff-map-2", "main", "tfmc.map.staff")
        )

    def test_has_map_staff_access_false_when_row_missing(self) -> None:
        from characters.rpc_player_meta import has_map_staff_access

        self.assertFalse(
            has_map_staff_access(
                "00000000-0000-4000-8000-000000000001",
                "main",
                "tfmc.map.staff",
            )
        )

    def test_resolve_uses_synced_entitlements(self) -> None:
        from characters.rpc_player_meta import (
            resolve_web_entitlements,
            upsert_rpc_player_meta,
        )
        upsert_rpc_player_meta(
            {
                "player_uuid": "abc",
                "name_colour_stops": 2,
                "allow_drink_texture": True,
                "skin_kinds": ["gun"],
            }
        )
        ent = resolve_web_entitlements("abc")
        self.assertEqual(ent["name_colour_stops"], 2)
        self.assertTrue(ent["allow_drink_texture"])
        self.assertEqual(ent["skin_kinds"], ["gun"])
        self.assertTrue(ent["meta_synced"])
        self.assertEqual(ent["realm_id"], "main")

    def test_unsynced_entitlements_have_no_grants_in_any_realm(self) -> None:
        from characters.rpc_player_meta import resolve_web_entitlements

        for realm in ("main", "dev"):
            with self.subTest(realm=realm):
                ent = resolve_web_entitlements("unsynced-player", realm_id=realm)
                self.assertFalse(ent["meta_synced"])
                self.assertEqual(ent["name_colour_stops"], 0)
                self.assertFalse(ent["allow_drink_texture"])
                self.assertFalse(ent["allow_drink_message"])
                self.assertEqual(ent["skin_kinds"], [])
                self.assertEqual(ent["permission_flags"], {})
                self.assertEqual(ent["realm_id"], realm)

    def test_resolve_realm_row(self) -> None:
        from characters.rpc_player_meta import (
            resolve_web_entitlements,
            upsert_rpc_player_meta,
        )

        upsert_rpc_player_meta(
            {
                "player_uuid": "r1",
                "realm_id": "dev",
                "name_colour_stops": 3,
                "allow_drink_texture": True,
                "skin_kinds": ["bow"],
            }
        )
        ent = resolve_web_entitlements("r1", realm_id="dev")
        self.assertEqual(ent["name_colour_stops"], 3)
        self.assertTrue(ent["allow_drink_texture"])
        self.assertEqual(ent["skin_kinds"], ["bow"])
        self.assertTrue(ent["meta_synced"])

    def test_staff_override(self) -> None:
        from characters.rpc_player_meta import (
            resolve_web_entitlements,
            upsert_rpc_player_meta,
        )

        upsert_rpc_player_meta(
            {
                "player_uuid": "staff-1",
                "name_colour_stops": 0,
                "skin_kinds": [],
                "allow_armor_3d_helmet": False,
            }
        )
        ent = resolve_web_entitlements("staff-1", staff=True)
        self.assertEqual(ent["name_colour_stops"], 8)
        self.assertIn("armor_set", ent["skin_kinds"])
        self.assertTrue(ent["allow_armor_3d_helmet"])

    def test_redeem_drink_uses_rpc_meta(self) -> None:
        from characters.rpc_player_meta import upsert_rpc_player_meta
        from skins.codes import issue_code, redeem_drink_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ):
            upsert_rpc_player_meta(
                {
                    "player_uuid": "synced-player",
                    "name_colour_stops": 2,
                    "allow_drink_texture": True,
                    "allow_drink_message": True,
                }
            )
            issued = issue_code("synced-player", "drink")
            session = redeem_drink_code(issued["code"])
        self.assertEqual(session["name_colour_stops"], 2)
        self.assertTrue(session["allow_drink_texture"])
        self.assertTrue(session["allow_drink_message"])


if __name__ == "__main__":
    unittest.main()
