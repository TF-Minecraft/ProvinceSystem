"""Skin submission access control (scope + one active submission per code)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pytest

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.auth import testing  # noqa: E402
from src.skins.testing import link  # noqa: E402

pytestmark = pytest.mark.usefixtures("postgres")

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _sync_temp_db(root: Path, db_path: Path) -> object:
    import src.skins.db as db_mod

    db_mod.DATA_DIR = root
    db_mod.DB_PATH = db_path
    db_mod.SKINS_DIR = root / "skins"
    db_mod.DRINKS_DIR = root / "drinks"
    db_mod.WARDROBE_DIR = root / "wardrobe"

    from src.skins import name_preview, review_sheet, storage, submissions, thumbnail

    for module in (name_preview, review_sheet, storage, submissions, thumbnail):
        module.SKINS_DIR = root / "skins"
    return db_mod


class SkinSubmissionAccessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"
        self.skins_dir = root / "skins"
        self.skins_dir.mkdir(parents=True, exist_ok=True)

        db_mod = _sync_temp_db(root, self.db_path)
        db_mod.SKINS_DIR = self.skins_dir
        self._db_mod = db_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.migrate()

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def _link_player(self, uuid: str = "player-1", name: str = "TestPlayer") -> None:
        testing.execute("DELETE FROM discord_links WHERE player_uuid = %s OR discord_user_id = %s", (uuid, "discord-1"))
        link(uuid, "discord-1", name, "Tester")

    def _seed_entitlements(self, uuid: str = "player-1") -> None:
        from src.characters.rpc_player_meta import upsert_rpc_player_meta

        upsert_rpc_player_meta(
            {
                "player_uuid": uuid,
                "skin_kinds": ["handheld"],
                "name_colour_stops": 2,
                "max_3d_pair_bytes": 30720,
            }
        )

    def _skin_session(self, uuid: str = "player-1"):
        from src.skins.codes import get_session, issue_code, redeem_code

        issued = issue_code(uuid, "skin")
        redeemed = redeem_code(issued["code"])
        return get_session(redeemed["session_token"])

    def _submit_handheld(self, session_row, display_name: str = "Test Sword"):
        from src.skins.submissions import create_submission

        with mock.patch("src.skins.submissions.write_submission_files"):
            return create_submission(
                session_row,
                "handheld",
                display_name,
                {"texture": TINY_PNG},
                base_set="swords",
            )

    def test_assert_no_active_submission_blocks_pending(self) -> None:
        from src.skins.submissions import SubmissionError, _assert_no_active_submission_for_code

        self._link_player()
        session = self._skin_session()
        code_id = session["code_id"]
        testing.execute(
                """
                INSERT INTO submissions (
                    id, player_uuid, code_id, kind, slug, display_name,
                    status, dir_path, created_at, discord_user_id, staff, realm_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "testplayer-testsword",
                    "player-1",
                    code_id,
                    "handheld",
                    "testplayer-testsword",
                    "Test Sword",
                    "pending",
                    "skins/test",
                    "2026-01-01T00:00:00Z",
                    "discord-1",
                    False,
                    "main",
                ),
            )

        with self.assertRaises(SubmissionError) as ctx:
            _assert_no_active_submission_for_code(code_id)
        self.assertIn("active submission", str(ctx.exception).lower())

    def test_second_upload_blocked_while_pending(self) -> None:
        from src.skins.submissions import SubmissionError

        self._link_player()
        self._seed_entitlements()
        session = self._skin_session()
        self._submit_handheld(session, "First Sword")

        with self.assertRaises(SubmissionError) as ctx:
            self._submit_handheld(session, "Second Sword")
        self.assertIn("active submission", str(ctx.exception).lower())

    def test_deny_allows_resubmit(self) -> None:
        from src.skins.submissions import deny_submission

        self._link_player()
        self._seed_entitlements()
        session = self._skin_session()
        first = self._submit_handheld(session, "Denied Sword")
        deny_submission(first["id"], "Needs changes")
        second = self._submit_handheld(session, "Fixed Sword")
        self.assertEqual("pending", second["status"])
        self.assertNotEqual(first["id"], second["id"])

    def test_rollback_clears_redeemed_at(self) -> None:
        from src.skins.submissions import deny_submission

        self._link_player()
        self._seed_entitlements()
        session = self._skin_session()
        created = self._submit_handheld(session, "Redeem Sword")
        code_id = session["code_id"]

        [row] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (code_id,))
        self.assertIsNotNone(row["redeemed_at"])

        deny_submission(created["id"], "Try again")

        [row] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (code_id,))
        self.assertIsNone(row["redeemed_at"])

    def test_lore_source_skips_mark_code_consumed(self) -> None:
        from src.skins.codes import ensure_lore_upload_code, issue_code, redeem_profile_code
        from src.skins.submissions import create_submission

        self._link_player()
        self._seed_entitlements()
        profile_issued = issue_code("player-1", "profile")
        profile_redeemed = redeem_profile_code(profile_issued["code"])
        profile_code_id = int(profile_redeemed["code_id"])
        lore_code_id = ensure_lore_upload_code("player-1", "main")

        [before] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (profile_code_id,))

        session = {
            "player_uuid": "player-1",
            "code_id": lore_code_id,
            "realm_id": "main",
            "staff": False,
        }
        with mock.patch("src.skins.submissions.write_submission_files"):
            create_submission(
                session,
                "handheld",
                "Lore Slot Sword",
                {"texture": TINY_PNG},
                base_set="swords",
                source="lore",
            )

        [lore_row] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (lore_code_id,))
        [after] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (profile_code_id,))
        self.assertIsNone(lore_row["redeemed_at"])
        self.assertEqual(before["redeemed_at"], after["redeemed_at"])

    def test_lore_source_allows_multiple_pending_on_same_slot(self) -> None:
        from src.skins.codes import ensure_lore_upload_code
        from src.skins.submissions import create_submission, deny_submission

        self._link_player()
        self._seed_entitlements()
        lore_code_id = ensure_lore_upload_code("player-1", "main")
        session = {
            "player_uuid": "player-1",
            "code_id": lore_code_id,
            "realm_id": "main",
            "staff": False,
        }
        with mock.patch("src.skins.submissions.write_submission_files"):
            first = create_submission(
                session,
                "handheld",
                "First Lore Sword",
                {"texture": TINY_PNG},
                base_set="swords",
                source="lore",
            )
            deny_submission(first["id"], "Try again")
            second = create_submission(
                session,
                "handheld",
                "Second Lore Sword",
                {"texture": TINY_PNG},
                base_set="swords",
                source="lore",
            )
        self.assertEqual("pending", second["status"])

    def test_profile_session_can_still_create_via_lore_path(self) -> None:
        """Scope is enforced on HTTP routes only, not create_submission()."""
        from src.skins.codes import get_session, issue_code, redeem_profile_code

        self._link_player()
        self._seed_entitlements()
        issued = issue_code("player-1", "profile")
        redeemed = redeem_profile_code(issued["code"])
        session = get_session(redeemed["session_token"])
        self.assertEqual(session["scope"], "profile")

        out = self._submit_handheld(session, "Lore Sword")
        self.assertEqual("pending", out["status"])

    def test_rollback_pending_if_unreferenced(self) -> None:
        from src.skins.submissions import rollback_pending_submission_if_unreferenced

        self._link_player()
        self._seed_entitlements()
        session = self._skin_session()
        created = self._submit_handheld(session, "Orphan Sword")
        sid = created["id"]
        code_id = session["code_id"]

        [row] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (code_id,))
        self.assertIsNotNone(row["redeemed_at"])

        self.assertTrue(
            rollback_pending_submission_if_unreferenced(
                sid, player_uuid="player-1"
            )
        )
        row = testing.value("SELECT 1 FROM submissions WHERE id = %s", (sid,))
        [code_row] = testing.rows("SELECT redeemed_at FROM codes WHERE id = %s", (code_id,))
        self.assertIsNone(row)
        self.assertIsNone(code_row["redeemed_at"])

    def test_rollback_skips_when_lore_row_still_references(self) -> None:
        from src.skins.db import connect
        from src.skins.submissions import rollback_pending_submission_if_unreferenced

        self._link_player()
        self._seed_entitlements()
        session = self._skin_session()
        created = self._submit_handheld(session, "Referenced Sword")
        sid = created["id"]

        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO lore_item_customisations (
                    player_uuid, character_id, kit_key, submission_id,
                    state, updated_at, realm_id
                ) VALUES (%s, %s, 'kit_a', %s, 'pending_skin', %s, 'main')
                """,
                ("player-1", "char-1", sid, "2026-01-01T00:00:00Z"),
            )

        self.assertFalse(
            rollback_pending_submission_if_unreferenced(
                sid, player_uuid="player-1"
            )
        )
        self.assertIsNotNone(testing.value("SELECT 1 FROM submissions WHERE id = %s", (sid,)))

    def test_rollback_batch_dedupes_ids(self) -> None:
        from src.skins.submissions import rollback_pending_submissions_if_unreferenced

        self._link_player()
        self._seed_entitlements()
        session = self._skin_session()
        created = self._submit_handheld(session, "Batch Orphan")
        sid = created["id"]

        count = rollback_pending_submissions_if_unreferenced(
            [sid, sid, ""],
            player_uuid="player-1",
        )
        self.assertEqual(1, count)


if __name__ == "__main__":
    unittest.main()
