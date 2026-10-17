"""Tests for cancelling pending web character creates."""

from __future__ import annotations

import gc
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
PNG = b"\x89PNG\r\n\x1a\n-not-a-real-png"
PLAYER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
CREATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_CREATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
REALM = "main"
SUBMISSION_ID = "player-testknife"
CODE_ID = 1

pytestmark = pytest.mark.usefixtures("postgres")


class DeletePendingCreateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        self.root = root

        db_mod = importlib.import_module("src.skins.db")
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

        wardrobe_mod = importlib.import_module("src.characters.wardrobe")
        self._wardrobe_mod = wardrobe_mod
        self._orig_w_data = wardrobe_mod.DATA_DIR
        self._orig_w_dir = wardrobe_mod.WARDROBE_DIR
        wardrobe_mod.DATA_DIR = root
        wardrobe_mod.WARDROBE_DIR = root / "wardrobe"

        self._seed_pending()

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DATA_DIR = self._orig_data
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self._wardrobe_mod.DATA_DIR = self._orig_w_data
        self._wardrobe_mod.WARDROBE_DIR = self._orig_w_dir
        gc.collect()
        self.tmp.cleanup()

    def _write_png(self, relpath: str) -> Path:
        path = self.root / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(PNG)
        return path

    def _seed_pending(self, *, status: str = "pending", player_uuid: str = PLAYER) -> None:
        png_rel = f"wardrobe/pending/{CREATE_ID}/base.png"
        self._write_png(png_rel)
        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_creates (
                    id, player_uuid, payload, status, created_at, realm_id
                ) VALUES (%s, %s, '{"name":"Test"}', %s, %s, %s)
                """,
                (CREATE_ID, player_uuid, status, NOW, REALM),
            )
            conn.execute(
                """
                INSERT INTO character_create_wardrobe (
                    create_id, slot, png_relpath, updated_at
                ) VALUES (%s, 'base', %s, %s)
                """,
                (CREATE_ID, png_rel, NOW),
            )
            conn.execute(
                """
                INSERT INTO lore_item_customisations (
                    player_uuid, character_id, kit_key, updated_at, realm_id
                ) VALUES (%s, %s, 'kit_a', %s, %s)
                """,
                (player_uuid, CREATE_ID, NOW, REALM),
            )

    def _count(self, table: str, **where: str) -> int:
        clauses = " AND ".join(f"{k} = %s" for k in where)
        sql = f"SELECT COUNT(*) AS n FROM {table}"
        if clauses:
            sql += f" WHERE {clauses}"
        with database.connect() as conn:
            row = conn.execute(sql, tuple(where.values())).fetchone()
        return int(row["n"])

    def _insert_code(self, code_id: int = CODE_ID, player_uuid: str = PLAYER) -> None:
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
                player_uuid,
                REALM,
                NOW,
                "2099-01-01T00:00:00Z",
                NOW,
            ),
        )

    def _insert_submission(
        self,
        submission_id: str = SUBMISSION_ID,
        *,
        code_id: int = CODE_ID,
        status: str = "pending",
        player_uuid: str = PLAYER,
    ) -> None:
        from src.auth.testing import execute

        self._insert_code(code_id, player_uuid)
        execute(
            """
            INSERT INTO submissions (
                id, player_uuid, code_id, kind, slug, display_name,
                status, dir_path, created_at, discord_user_id, staff, realm_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                submission_id,
                player_uuid,
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

    def _set_lore_pending_skin(
        self,
        submission_id: str,
        *,
        character_id: str = CREATE_ID,
        player_uuid: str = PLAYER,
        kit_key: str = "kit_a",
    ) -> None:
        with database.connect() as conn:
            conn.execute(
                """
                UPDATE lore_item_customisations
                SET submission_id = %s,
                    state = 'pending_skin',
                    updated_at = %s
                WHERE player_uuid = %s AND character_id = %s AND kit_key = %s
                """,
                (submission_id, NOW, player_uuid, character_id, kit_key),
            )

    def _submission_exists(self, submission_id: str) -> bool:
        from src.auth.testing import rows

        return bool(rows("SELECT 1 FROM submissions WHERE id = %s", (submission_id,)))

    def _code_redeemed_at(self, code_id: int = CODE_ID):
        from src.auth.testing import value

        return value("SELECT redeemed_at FROM codes WHERE id = %s", (code_id,))

    def test_cancel_rolls_back_orphaned_pending_submission(self) -> None:
        from src.characters.creates import delete_pending_create

        self._insert_submission()
        self._set_lore_pending_skin(SUBMISSION_ID)
        self.assertTrue(self._submission_exists(SUBMISSION_ID))
        self.assertIsNotNone(self._code_redeemed_at())

        result = delete_pending_create(PLAYER, CREATE_ID)
        self.assertEqual(result, {"ok": True, "deleted": CREATE_ID})
        self.assertFalse(self._submission_exists(SUBMISSION_ID))
        self.assertIsNone(self._code_redeemed_at())

    def test_cancel_keeps_approved_submission(self) -> None:
        from src.characters.creates import delete_pending_create

        self._insert_submission(status="approved")
        self._set_lore_pending_skin(SUBMISSION_ID)

        delete_pending_create(PLAYER, CREATE_ID)
        self.assertTrue(self._submission_exists(SUBMISSION_ID))

    def test_cancel_keeps_submission_referenced_by_other_character(self) -> None:
        from src.characters.creates import delete_pending_create

        self._insert_submission()
        self._set_lore_pending_skin(SUBMISSION_ID)
        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_creates (
                    id, player_uuid, payload, status, created_at, realm_id
                ) VALUES (%s, %s, '{"name":"Other"}', 'pending', %s, %s)
                """,
                (OTHER_CREATE_ID, PLAYER, NOW, REALM),
            )
            conn.execute(
                """
                INSERT INTO lore_item_customisations (
                    player_uuid, character_id, kit_key, submission_id,
                    state, updated_at, realm_id
                ) VALUES (%s, %s, 'kit_b', %s, 'pending_skin', %s, %s)
                """,
                (PLAYER, OTHER_CREATE_ID, SUBMISSION_ID, NOW, REALM),
            )

        delete_pending_create(PLAYER, CREATE_ID)
        self.assertTrue(self._submission_exists(SUBMISSION_ID))

    def test_delete_pending_create_cleans_all(self) -> None:
        from src.characters.creates import delete_pending_create

        png_rel = f"wardrobe/pending/{CREATE_ID}/base.png"
        self.assertTrue((self.root / png_rel).is_file())
        result = delete_pending_create(PLAYER, CREATE_ID)
        self.assertEqual(result, {"ok": True, "deleted": CREATE_ID})
        self.assertEqual(self._count("character_creates", id=CREATE_ID), 0)
        self.assertEqual(
            self._count("character_create_wardrobe", create_id=CREATE_ID), 0
        )
        self.assertEqual(
            self._count(
                "lore_item_customisations",
                player_uuid=PLAYER,
                character_id=CREATE_ID,
            ),
            0,
        )
        self.assertFalse((self.root / png_rel).is_file())

    def test_wrong_player_not_found(self) -> None:
        from src.characters.creates import CreateError, delete_pending_create

        with self.assertRaises(CreateError) as ctx:
            delete_pending_create(OTHER, CREATE_ID)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_applied_create_conflict(self) -> None:
        with database.connect() as conn:
            conn.execute(
                "UPDATE character_creates SET status = 'applied' WHERE id = %s",
                (CREATE_ID,),
            )

        from src.characters.creates import CreateError, delete_pending_create

        with self.assertRaises(CreateError) as ctx:
            delete_pending_create(PLAYER, CREATE_ID)
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
