"""Drink API unit tests (redeem / submit / approve)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# 1x1 transparent PNG
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)


class DrinkApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"
        self.drinks_dir = root / "drinks"
        self.drinks_dir.mkdir(parents=True, exist_ok=True)

        import skins.db as db_mod

        self._db_mod = db_mod
        sys.modules["src.skins.db"] = db_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DB_PATH = self.db_path
        db_mod.DRINKS_DIR = self.drinks_dir
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

    def _seed_catalog(self) -> None:
        from skins.drinks import replace_drink_catalog

        replace_drink_catalog(
            {
                "ingredients": [
                    {
                        "id": "grape",
                        "brewery_token": "itemsadder:tfmc_cooking:grape",
                        "label": "Grape",
                        "category": "produce",
                    },
                    {
                        "id": "yeast",
                        "brewery_token": "MMOItems:YEAST",
                        "label": "Yeast",
                        "category": "grain",
                    },
                ],
                "effects_blacklist": ["command"],
                "version": 1,
            }
        )

    def _link_player(self, uuid: str = "player-1", name: str = "TestPlayer") -> None:
        from skins.db import connect

        with connect() as conn:
            conn.execute("DELETE FROM discord_links WHERE player_uuid = ? OR discord_user_id = ?", (uuid, "discord-1"))
            conn.execute(
                """
                INSERT INTO discord_links (
                    player_uuid, discord_user_id, minecraft_name,
                    discord_username, linked_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (uuid, "discord-1", name, "Tester", "2026-01-01T00:00:00Z"),
            )
            conn.commit()

    def _issue_and_redeem(self, scope: str = "drink", uuid: str = "player-1"):
        from skins.codes import issue_code, redeem_drink_code, redeem_code

        issued = issue_code(uuid, scope)
        if scope == "drink":
            return redeem_drink_code(issued["code"])
        return redeem_code(issued["code"])

    def test_redeem_drink_vs_skin(self) -> None:
        from skins.codes import CodeError, issue_code, redeem_drink_code, redeem_code

        self._link_player()
        drink = issue_code("player-1", "drink")
        skin = issue_code("player-1", "skin")

        session = redeem_drink_code(drink["code"])
        self.assertEqual(session["scope"], "drink")
        self.assertFalse(session["allow_drink_texture"])

        with self.assertRaises(CodeError) as ctx:
            redeem_drink_code(skin["code"])
        self.assertIn("skins", str(ctx.exception).lower())

        with self.assertRaises(CodeError) as ctx2:
            redeem_code(issue_code("player-1", "drink")["code"])
        self.assertIn("drinks", str(ctx2.exception).lower())

    def test_redeem_drink_again_before_submit(self) -> None:
        from datetime import timedelta

        from skins.codes import issue_code, redeem_drink_code

        self._link_player()
        issued = issue_code("player-1", "drink")
        first = redeem_drink_code(issued["code"])
        second = redeem_drink_code(issued["code"])
        self.assertNotEqual(first["session_token"], second["session_token"])
        exp = datetime.fromisoformat(second["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        self.assertGreater(exp - now, timedelta(hours=7))

    def test_redeem_drink_blocked_after_submit(self) -> None:
        from skins.codes import CodeError, issue_code, redeem_drink_code
        from skins.drinks import create_drink_submission

        self._link_player()
        self._seed_catalog()
        issued = issue_code("player-1", "drink")
        session = redeem_drink_code(issued["code"])
        create_drink_submission(
            session,
            {
                "name": "Reuse Test Brew",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
                "color": "#AABBCC",
            },
        )
        with self.assertRaises(CodeError) as ctx:
            redeem_drink_code(issued["code"])
        self.assertIn("already been used", str(ctx.exception).lower())

    def test_noble_texture_rejected(self) -> None:
        from skins.drinks import DrinkError, create_drink_submission

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()

        with self.assertRaises(DrinkError) as ctx:
            create_drink_submission(
                session,
                {
                    "name": "Noble Wine",
                    "ingredients": [{"id": "grape", "amount": 2}],
                    "effects": [],
                },
                png_bytes=TINY_PNG,
            )
        self.assertIn("cannot use custom drink textures", str(ctx.exception))

    def test_drink_message_rejected_without_entitlement(self) -> None:
        from characters.rpc_player_meta import upsert_rpc_player_meta
        from skins.drinks import DrinkError, create_drink_submission

        self._link_player()
        self._seed_catalog()
        upsert_rpc_player_meta(
            {
                "player_uuid": "player-1",
                "allow_drink_message": False,
            }
        )
        session = self._issue_and_redeem()
        with self.assertRaises(DrinkError) as ctx:
            create_drink_submission(
                session,
                {
                    "name": "Chatter Wine",
                    "ingredients": [{"id": "grape", "amount": 1}],
                    "color": "#AA0000",
                    "drink_message": "Cheers!",
                    "effects": [],
                },
            )
        self.assertIn("cannot use drink messages", str(ctx.exception))

    def test_drink_message_allowed_with_entitlement(self) -> None:
        from characters.rpc_player_meta import upsert_rpc_player_meta
        from skins.drinks import create_drink_submission

        self._link_player()
        self._seed_catalog()
        upsert_rpc_player_meta(
            {
                "player_uuid": "player-1",
                "allow_drink_message": True,
            }
        )
        session = self._issue_and_redeem()
        out = create_drink_submission(
            session,
            {
                "name": "Ascended Ale",
                "ingredients": [{"id": "grape", "amount": 1}],
                "color": "#AA0000",
                "drink_message": "To the stars!",
                "effects": [],
            },
        )
        self.assertEqual(out["status"], "pending")
        recipe = out.get("recipe") or {}
        self.assertEqual(recipe.get("drink_message"), "To the stars!")

    def test_name_colours_respect_cap(self) -> None:
        from skins.drinks import (
            DrinkError,
            create_drink_submission,
            upsert_drink_player_meta,
        )

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {
                "player_uuid": "player-1",
                "allow_drink_texture": False,
                "name_colour_stops": 1,
            }
        )
        session = self._issue_and_redeem()
        self.assertEqual(session.get("name_colour_stops"), 1)
        with self.assertRaises(DrinkError) as ctx:
            create_drink_submission(
                session,
                {
                    "name": "Too Many Colours",
                    "name_colours": ["#ff0000", "#00ff00"],
                    "ingredients": [{"id": "grape", "amount": 1}],
                    "color": "#AABBCC",
                },
            )
        self.assertIn("name_colours", str(ctx.exception).lower())

    def test_gilded_png_pending(self) -> None:
        from skins.drinks import create_drink_submission, upsert_drink_player_meta

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session = self._issue_and_redeem()
        self.assertTrue(
            __import__("skins.drinks", fromlist=["get_allow_drink_texture"]).get_allow_drink_texture(
                "player-1"
            )
        )

        out = create_drink_submission(
            session,
            {
                "name": "Gilded Wine",
                "ingredients": [{"id": "grape", "amount": 3}, {"id": "yeast", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        self.assertEqual(out["status"], "pending")
        self.assertTrue(out["new_texture"])
        self.assertIsNotNone(out["texture_id"])

    def test_color_only_approve(self) -> None:
        from skins.drinks import (
            approve_drink_submission,
            create_drink_submission,
        )

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()
        out = create_drink_submission(
            session,
            {
                "name": "Red Ale",
                "ingredients": [{"id": "grape", "amount": 1}],
                "color": "#AA0000",
                "effects": [],
            },
        )
        approved = approve_drink_submission(out["id"])
        self.assertEqual(approved["status"], "approved")

    def test_reuse_applied_texture_approves(self) -> None:
        from skins.db import connect
        from skins.drinks import (
            approve_drink_submission,
            create_drink_submission,
            upsert_drink_player_meta,
        )

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session = self._issue_and_redeem()
        first = create_drink_submission(
            session,
            {
                "name": "First Brew",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        tex_id = first["texture_id"]
        # Simulate pack applied CMD on texture
        with connect() as conn:
            conn.execute(
                "UPDATE drink_textures SET cmd = 20001 WHERE id = ?",
                (tex_id,),
            )
            conn.commit()

        session2 = self._issue_and_redeem()
        second = create_drink_submission(
            session2,
            {
                "name": "Second Brew",
                "ingredients": [{"id": "yeast", "amount": 1}],
                "effects": [],
            },
            existing_texture_id=tex_id,
        )
        self.assertFalse(second["new_texture"])
        approved = approve_drink_submission(second["id"])
        self.assertEqual(approved["status"], "approved")

    def test_new_texture_approve_pending_pack(self) -> None:
        from skins.drinks import (
            approve_drink_submission,
            create_drink_submission,
            upsert_drink_player_meta,
        )

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session = self._issue_and_redeem()
        out = create_drink_submission(
            session,
            {
                "name": "Pack Me",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        approved = approve_drink_submission(out["id"])
        self.assertEqual(approved["status"], "pending_pack")

    def test_unknown_ingredient_rejected(self) -> None:
        from skins.drinks import DrinkError, create_drink_submission

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()
        with self.assertRaises(DrinkError) as ctx:
            create_drink_submission(
                session,
                {
                    "name": "Mystery",
                    "ingredients": [{"id": "not_real", "amount": 1}],
                    "color": "#112233",
                    "effects": [],
                },
            )
        self.assertIn("allowlist", str(ctx.exception).lower())

    def test_blacklisted_effect_rejected(self) -> None:
        from skins.drinks import DrinkError, create_drink_submission

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()
        with self.assertRaises(DrinkError) as ctx:
            create_drink_submission(
                session,
                {
                    "name": "Bad Effect",
                    "ingredients": [{"id": "grape", "amount": 1}],
                    "color": "#112233",
                    "effects": ["command"],
                },
            )
        self.assertIn("not allowed", str(ctx.exception).lower())

    def test_full_recipe_round_trip(self) -> None:
        from skins.drinks import _validate_recipe

        self._seed_catalog()
        out = _validate_recipe(
            {
                "name": "Sunset Cider",
                "names": ["Sour Cider", "Sunset Cider", "Golden Cider"],
                "ingredients": [{"id": "grape", "amount": 4}, {"id": "yeast", "amount": 1}],
                "cooking_time": 8,
                "distill_runs": 2,
                "distill_time": 40,
                "wood": "oak",
                "age": 3,
                "difficulty": 5,
                "alcohol": 12,
                "effects": [{"type": "nausea", "level": 1, "duration": 10}],
                "color": "#C45A12",
                "lore": ["A warm orchard brew."],
                "drink_message": "You feel tipsy.",
                "drink_title": "Cider!",
                "glint": True,
            }
        )
        self.assertEqual(out["name"], "Sunset Cider")
        self.assertEqual(out["names"], "Sour Cider/Sunset Cider/Golden Cider")
        self.assertEqual(out["cooking_time"], 8)
        self.assertEqual(out["distill_time"], 40)
        self.assertEqual(out["wood"], 2)
        self.assertEqual(out["barrel_type"], 2)
        self.assertEqual(out["difficulty"], 5)
        self.assertEqual(out["alcohol"], 12)
        self.assertTrue(out["glint"])
        self.assertEqual(out["drink_message"], "You feel tipsy.")
        self.assertEqual(out["color"], "#C45A12")

    def test_wood_names_become_brewery_codes(self) -> None:
        from skins.drinks import DrinkError, _validate_recipe

        self._seed_catalog()
        expected = {
            "any": 0,
            "birch": 1,
            "oak": 2,
            "jungle": 3,
            "spruce": 4,
            "acacia": 5,
            "dark_oak": 6,
            "dark oak": 6,
            "crimson": 7,
            "warped": 8,
            "mangrove": 9,
            "cherry": 10,
            "bamboo": 11,
            "cut_copper": 12,
            "pale_oak": 13,
            "Pale Oak": 13,
            "0": 0,
            "13": 13,
            0: 0,
            13: 13,
        }
        for raw, code in expected.items():
            out = _validate_recipe(
                {
                    "name": "Wood Test",
                    "ingredients": [{"id": "grape", "amount": 1}],
                    "color": "#112233",
                    "wood": raw,
                }
            )
            self.assertEqual(out["wood"], code, raw)
            self.assertEqual(out["barrel_type"], code, raw)
        with self.assertRaises(DrinkError):
            _validate_recipe(
                {
                    "name": "Wood Test",
                    "ingredients": [{"id": "grape", "amount": 1}],
                    "color": "#112233",
                    "wood": "mahogany",
                }
            )

    def test_color_review_sheet(self) -> None:
        from skins.drink_review_sheet import build_drink_review_sheet
        from skins.drinks import create_drink_submission

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()
        out = create_drink_submission(
            session,
            {
                "name": "Sheet Ale",
                "ingredients": [{"id": "grape", "amount": 1}],
                "color": "#AA3344",
                "effects": [],
            },
        )
        data = build_drink_review_sheet(out["id"])
        self.assertIsNotNone(data)
        assert data is not None
        self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertGreater(len(data), 50)

    def test_texture_review_sheet(self) -> None:
        from skins.drink_review_sheet import build_drink_review_sheet
        from skins.drinks import create_drink_submission, upsert_drink_player_meta

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session = self._issue_and_redeem()
        out = create_drink_submission(
            session,
            {
                "name": "Tex Brew",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        data = build_drink_review_sheet(out["id"])
        self.assertIsNotNone(data)
        assert data is not None
        self.assertTrue(data.startswith(b"\x89PNG"))

    def test_review_sheet_missing_appearance(self) -> None:
        from skins.db import connect
        from skins.drink_review_sheet import (
            DrinkReviewSheetError,
            build_drink_review_sheet,
        )
        from skins.drinks import create_drink_submission

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()
        out = create_drink_submission(
            session,
            {
                "name": "Broken Look",
                "ingredients": [{"id": "grape", "amount": 1}],
                "color": "#112233",
                "effects": [],
            },
        )
        # Strip color from stored recipe and leave no texture.png
        with connect() as conn:
            row = conn.execute(
                "SELECT recipe_json, dir_path FROM drink_submissions WHERE id = ?",
                (out["id"],),
            ).fetchone()
            recipe = json.loads(row["recipe_json"])
            recipe.pop("color", None)
            conn.execute(
                "UPDATE drink_submissions SET recipe_json = ? WHERE id = ?",
                (json.dumps(recipe), out["id"]),
            )
            conn.commit()
        tex = Path(row["dir_path"]) / "texture.png"
        if tex.is_file():
            tex.unlink()
        sheet = Path(row["dir_path"]) / "review_sheet.png"
        if sheet.is_file():
            sheet.unlink()
        with self.assertRaises(DrinkReviewSheetError):
            build_drink_review_sheet(out["id"])

    def test_pending_apply_and_mark_applied(self) -> None:
        from skins.drinks import (
            approve_drink_submission,
            assign_drink_texture_cmd,
            create_drink_submission,
            list_drinks_pending_apply,
            mark_drinks_applied,
            upsert_drink_player_meta,
        )

        self._link_player()
        self._seed_catalog()
        session = self._issue_and_redeem()
        color = create_drink_submission(
            session,
            {
                "name": "Apply Ale",
                "ingredients": [{"id": "grape", "amount": 1}],
                "color": "#112233",
                "effects": [],
            },
        )
        approved = approve_drink_submission(color["id"])
        self.assertEqual(approved["status"], "approved")

        pending = list_drinks_pending_apply()
        ids = {row["id"] for row in pending}
        self.assertIn(color["id"], ids)
        color_row = next(r for r in pending if r["id"] == color["id"])
        self.assertIsNone(color_row.get("texture"))

        applied = mark_drinks_applied([color["id"]])
        self.assertEqual(applied, [color["id"]])
        self.assertEqual(list_drinks_pending_apply(), [])

        # Textured drink: pending_pack until CMD assigned + applied
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session2 = self._issue_and_redeem()
        tex = create_drink_submission(
            session2,
            {
                "name": "Pack Wine",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        pack = approve_drink_submission(tex["id"])
        self.assertEqual(pack["status"], "pending_pack")
        pending2 = list_drinks_pending_apply()
        self.assertTrue(any(r["id"] == tex["id"] for r in pending2))
        tex_row = next(r for r in pending2 if r["id"] == tex["id"])
        self.assertIsNotNone(tex_row.get("texture"))
        self.assertIsNone(tex_row["texture"]["cmd"])

        assigned = assign_drink_texture_cmd(
            tex["texture_id"], 20001, f"tfmc_drinks:{tex['id']}"
        )
        self.assertEqual(assigned["cmd"], 20001)
        # Idempotent same cmd
        again = assign_drink_texture_cmd(
            tex["texture_id"], 20001, f"tfmc_drinks:{tex['id']}"
        )
        self.assertEqual(again["cmd"], 20001)

        with self.assertRaises(Exception) as ctx:
            assign_drink_texture_cmd(
                tex["texture_id"], 20002, f"tfmc_drinks:{tex['id']}"
            )
        self.assertIn("already has cmd", str(ctx.exception).lower())

        applied2 = mark_drinks_applied([tex["id"]])
        self.assertEqual(applied2, [tex["id"]])

    def test_reuse_requires_applied_cmd(self) -> None:
        from skins.drinks import (
            DrinkError,
            create_drink_submission,
            list_player_textures,
            upsert_drink_player_meta,
        )

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session = self._issue_and_redeem()
        first = create_drink_submission(
            session,
            {
                "name": "Pending Tex",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        # Unapplied textures must not appear in list
        self.assertEqual(list_player_textures("player-1"), [])

        session2 = self._issue_and_redeem()
        with self.assertRaises(DrinkError) as ctx:
            create_drink_submission(
                session2,
                {
                    "name": "Reuse Too Soon",
                    "ingredients": [{"id": "yeast", "amount": 1}],
                    "effects": [],
                },
                existing_texture_id=first["texture_id"],
            )
        self.assertIn("not applied", str(ctx.exception).lower())

    def test_revoke_shared_texture_refcount(self) -> None:
        from skins.db import connect
        from skins.drinks import (
            approve_drink_submission,
            assign_drink_texture_cmd,
            create_drink_submission,
            list_deletable_drinks,
            list_player_textures,
            mark_drinks_applied,
            revoke_drink_submission,
            upsert_drink_player_meta,
        )

        self._link_player()
        self._seed_catalog()
        upsert_drink_player_meta(
            {"player_uuid": "player-1", "allow_drink_texture": True}
        )
        session = self._issue_and_redeem()
        first = create_drink_submission(
            session,
            {
                "name": "Share A",
                "ingredients": [{"id": "grape", "amount": 1}],
                "effects": [],
            },
            png_bytes=TINY_PNG,
        )
        tex_id = first["texture_id"]
        approve_drink_submission(first["id"])
        assign_drink_texture_cmd(tex_id, 20100, f"tfmc_drinks:{first['id']}")
        mark_drinks_applied([first["id"]])

        owned = list_player_textures("player-1")
        self.assertEqual(len(owned), 1)
        self.assertEqual(owned[0]["id"], tex_id)

        session2 = self._issue_and_redeem()
        second = create_drink_submission(
            session2,
            {
                "name": "Share B",
                "ingredients": [{"id": "yeast", "amount": 1}],
                "effects": [],
            },
            existing_texture_id=tex_id,
        )
        approve_drink_submission(second["id"])
        mark_drinks_applied([second["id"]])

        deletable_ids = {d["id"] for d in list_deletable_drinks()}
        self.assertIn(first["id"], deletable_ids)
        self.assertIn(second["id"], deletable_ids)

        r1 = revoke_drink_submission(first["id"])
        self.assertTrue(r1["deleted"])
        self.assertFalse(r1["texture_freed"])
        with connect() as conn:
            tex = conn.execute(
                "SELECT refcount, cmd FROM drink_textures WHERE id = ?",
                (tex_id,),
            ).fetchone()
        self.assertIsNotNone(tex)
        self.assertEqual(int(tex["refcount"]), 1)
        self.assertEqual(int(tex["cmd"]), 20100)

        r2 = revoke_drink_submission(second["id"])
        self.assertTrue(r2["deleted"])
        self.assertTrue(r2["texture_freed"])
        self.assertEqual(r2["cmd"], 20100)
        self.assertEqual(r2["ia_item_id"], f"tfmc_drinks:{first['id']}")
        with connect() as conn:
            gone = conn.execute(
                "SELECT id FROM drink_textures WHERE id = ?",
                (tex_id,),
            ).fetchone()
        self.assertIsNone(gone)
        self.assertEqual(list_player_textures("player-1"), [])


if __name__ == "__main__":
    unittest.main()
