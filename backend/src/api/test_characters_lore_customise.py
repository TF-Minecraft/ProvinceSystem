"""Tests for kit customise and skin-session parser (layered, no full server import)."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

import pytest

from src.api.map_access import get_skin_session
from src.auth.testing import execute, rows
from src.skins.testing import link

# Discord links, codes, sessions and submissions live in Postgres; rosters and kit drafts in SQLite.
pytestmark = pytest.mark.usefixtures("postgres")

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10"
    b"\x08\x02\x00\x00\x00\x55\x27\x61\xe0\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f"
    b"\x00\x00\x01\x01\x00\x05\x18\xd8\x4e\x00\x00\x00\x00IEND\xaeB`\x82"
)

CATALOG = {
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
            "kit_key": "iron_hunting_knife",
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


def _sync_temp_db(root: Path, db_path: Path) -> object:
    import src.skins.db as db_mod

    db_mod.DATA_DIR = root
    db_mod.DB_PATH = db_path
    db_mod.SKINS_DIR = root / "skins"
    db_mod.DRINKS_DIR = root / "drinks"
    db_mod.WARDROBE_DIR = root / "wardrobe"
    from src.api import skins_routes
    from src.skins import name_preview, review_sheet, storage, submissions, thumbnail

    for module in (skins_routes, name_preview, review_sheet, storage, submissions, thumbnail):
        module.SKINS_DIR = root / "skins"
    return db_mod


class CharactersLoreCustomiseTest(unittest.TestCase):
    CHAR_ID = "char-lore-test-1"
    PLAYER = "11111111-1111-4111-8111-111111111111"
    OTHER = "22222222-2222-4222-8222-222222222222"

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"
        db_mod = _sync_temp_db(root, self.db_path)
        self._db_mod = db_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.migrate()

        from src.characters.creation_catalog import replace_catalog

        replace_catalog(CATALOG)
        self._link_player(self.PLAYER)
        self._seed_entitlements(self.PLAYER)
        self._put_roster()

        from src.skins.codes import issue_code, redeem_code, redeem_profile_code

        profile = redeem_profile_code(issue_code(self.PLAYER, "profile")["code"])
        skin = redeem_code(issue_code(self.PLAYER, "skin")["code"])
        self.profile_session = profile
        self.skin_session = skin
        self._link_player(self.OTHER)
        self.other_skin_session = redeem_code(issue_code(self.OTHER, "skin")["code"])

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def _link_player(self, uuid: str) -> None:
        link(uuid, f"discord-{uuid[:8]}", "TestPlayer", "Tester")

    def _seed_entitlements(self, uuid: str) -> None:
        from characters.rpc_player_meta import upsert_rpc_player_meta

        upsert_rpc_player_meta(
            {
                "player_uuid": uuid,
                "skin_kinds": ["handheld"],
                "name_colour_stops": 2,
                "max_3d_pair_bytes": 30720,
            }
        )

    def _put_roster(self) -> None:
        from src.characters.roster import replace_roster

        replace_roster(
            self.PLAYER,
            [
                {
                    "id": self.CHAR_ID,
                    "name": "Lore Test",
                    "status": "ALIVE",
                    "kit_status": "eligible",
                }
            ],
        )

    def test_get_skin_session_accepts_skin_scope(self) -> None:
        row = get_skin_session(f"Bearer {self.skin_session['session_token']}")
        self.assertIsNotNone(row)
        self.assertEqual("skin", row["scope"])

    def test_get_skin_session_rejects_profile(self) -> None:
        row = get_skin_session(f"Bearer {self.profile_session['session_token']}")
        self.assertIsNone(row)

    def test_customise_name_lore_profile_only(self) -> None:
        from src.characters.lore_items import customise_lore_item

        out = customise_lore_item(
            self.profile_session,
            self.CHAR_ID,
            "iron_hunting_knife",
            display_name="Trailblade",
            lore=["Line one."],
        )
        self.assertTrue(out.get("ok"))

    def test_customise_upload_profile_only_uses_lore_slot(self) -> None:
        from src.skins.codes import ensure_lore_upload_code
        from src.characters.lore_items import customise_lore_item

        lore_code_id = ensure_lore_upload_code(self.PLAYER, "main")
        out = customise_lore_item(
            self.profile_session,
            self.CHAR_ID,
            "iron_hunting_knife",
            display_name="Trail Knife",
            lore=["Forged."],
            texture_bytes=TINY_PNG,
        )
        sub_id = (out.get("draft") or {}).get("submission_id")
        self.assertTrue(sub_id)
        [row] = rows("SELECT code_id FROM submissions WHERE id = %s", (sub_id,))
        [profile_code] = rows(
            "SELECT redeemed_at FROM codes WHERE id = %s",
            (int(self.profile_session["code_id"]),),
        )
        self.assertIsNotNone(row)
        self.assertEqual(lore_code_id, int(row["code_id"]))
        self.assertNotEqual(int(row["code_id"]), int(self.profile_session["code_id"]))
        self.assertNotEqual(int(row["code_id"]), int(self.skin_session["code_id"]))
        self.assertIsNotNone(profile_code["redeemed_at"])

    def test_customise_upload_ignores_optional_skin_header(self) -> None:
        from src.skins.codes import ensure_lore_upload_code
        from src.skins.db import connect
        from src.characters.lore_items import customise_lore_item

        lore_code_id = ensure_lore_upload_code(self.PLAYER, "main")
        with connect() as conn:
            conn.execute(
                "DELETE FROM lore_item_customisations WHERE character_id = ?",
                (self.CHAR_ID,),
            )
            conn.commit()
        execute("DELETE FROM submissions WHERE player_uuid = %s", (self.PLAYER,))

        out = customise_lore_item(
            self.profile_session,
            self.CHAR_ID,
            "iron_hunting_knife",
            display_name="Trail Knife Two",
            lore=["Forged again."],
            texture_bytes=TINY_PNG,
        )
        sub_id = (out.get("draft") or {}).get("submission_id")
        self.assertTrue(sub_id)
        [row] = rows("SELECT code_id FROM submissions WHERE id = %s", (sub_id,))
        self.assertEqual(lore_code_id, int(row["code_id"]))

    def test_denied_resubmit_profile_only(self) -> None:
        from src.skins.submissions import deny_submission
        from src.characters.lore_items import customise_lore_item

        first = customise_lore_item(
            self.profile_session,
            self.CHAR_ID,
            "iron_hunting_knife",
            display_name="Trail Knife",
            lore=["Forged."],
            texture_bytes=TINY_PNG,
        )
        sub_id = (first.get("draft") or {}).get("submission_id")
        self.assertTrue(sub_id)
        deny_submission(str(sub_id), "Needs changes")

        second = customise_lore_item(
            self.profile_session,
            self.CHAR_ID,
            "iron_hunting_knife",
            display_name="Fixed Trail Knife",
            lore=["Forged again."],
            texture_bytes=TINY_PNG,
        )
        new_sub = (second.get("draft") or {}).get("submission_id")
        self.assertTrue(new_sub)
        self.assertNotEqual(sub_id, new_sub)
        [row] = rows("SELECT status FROM submissions WHERE id = %s", (new_sub,))
        self.assertEqual("pending", row["status"])

    def test_pick_applied_skin_profile_only(self) -> None:
        from src.characters.lore_items import customise_lore_item

        applied_id = "testplayer-appliedknife"
        self._seed_applied_skin(applied_id, player_uuid=self.PLAYER)

        out = customise_lore_item(
            self.profile_session,
            self.CHAR_ID,
            "iron_hunting_knife",
            display_name="Trailblade",
            lore=["Line one."],
            existing_skin_id=applied_id,
        )
        draft = out.get("draft") or {}
        self.assertEqual(applied_id, draft.get("existing_skin_id"))

    def _seed_applied_skin(
        self,
        submission_id: str,
        *,
        player_uuid: str,
        kind: str = "handheld",
        base_set: str = "knives",
        with_model: bool = False,
        code_id: int = 99,
    ) -> None:
        from src.skins.db import SKINS_DIR

        tex_dir = SKINS_DIR / submission_id
        tex_dir.mkdir(parents=True, exist_ok=True)
        (tex_dir / f"{submission_id}.png").write_bytes(TINY_PNG)
        if with_model:
            (tex_dir / f"{submission_id}.json").write_text(
                '{"textures":{}}',
                encoding="utf-8",
            )

        execute(
            """
            INSERT INTO codes (
                id, code_hash, player_uuid, scope, realm_id,
                created_at, expires_at, redeemed_at, revoked
            ) VALUES (%s, %s, %s, 'skin', 'main', %s, %s, %s, false)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                code_id,
                f"hash-{code_id}",
                player_uuid,
                "2026-01-01T00:00:00Z",
                "2099-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            ),
        )
        execute(
            """
            INSERT INTO submissions (
                id, player_uuid, code_id, kind, slug, display_name,
                status, dir_path, created_at, discord_user_id, staff, realm_id,
                base_set
            ) VALUES (%s, %s, %s, %s, %s, %s, 'applied',
                'skins/applied', %s, 'discord-1', false, 'main', %s)
            """,
            (
                submission_id,
                player_uuid,
                code_id,
                kind,
                submission_id,
                f"Skin {submission_id}",
                "2026-01-01T00:00:00Z",
                base_set,
            ),
        )

    def test_resolve_pickable_model_owner_with_json(self) -> None:
        from src.characters.lore_items import (
            LoreItemError,
            resolve_pickable_model,
            resolve_pickable_texture,
        )

        applied_id = "testplayer-applied3d"
        self._seed_applied_skin(
            applied_id,
            player_uuid=self.PLAYER,
            kind="item_3d",
            with_model=True,
            code_id=100,
        )

        tex = resolve_pickable_texture(self.PLAYER, applied_id, "knives")
        self.assertTrue(tex.is_file())
        model = resolve_pickable_model(self.PLAYER, applied_id, "knives")
        self.assertTrue(model.is_file())
        self.assertEqual(f"{applied_id}.json", model.name)

    def test_resolve_pickable_model_wrong_owner(self) -> None:
        from src.characters.lore_items import LoreItemError, resolve_pickable_model

        applied_id = "testplayer-applied3d-deny"
        self._seed_applied_skin(
            applied_id,
            player_uuid=self.PLAYER,
            kind="item_3d",
            with_model=True,
            code_id=101,
        )

        with self.assertRaises(LoreItemError) as ctx:
            resolve_pickable_model(self.OTHER, applied_id, "knives")
        self.assertEqual(404, ctx.exception.status_code)

    def test_resolve_pickable_model_missing_json(self) -> None:
        from src.characters.lore_items import LoreItemError, resolve_pickable_model

        applied_id = "testplayer-applied3d-nomodel"
        self._seed_applied_skin(
            applied_id,
            player_uuid=self.PLAYER,
            kind="item_3d",
            with_model=False,
            code_id=102,
        )

        with self.assertRaises(LoreItemError) as ctx:
            resolve_pickable_model(self.PLAYER, applied_id, "knives")
        self.assertEqual(404, ctx.exception.status_code)


if __name__ == "__main__":
    unittest.main()
