"""Tests for review-sheet cache invalidation (Batch 2)."""

from __future__ import annotations

import io
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

# Codes and submissions live in Postgres.
pytestmark = pytest.mark.usefixtures("postgres")

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _tiny_png() -> bytes:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGBA", (16, 16), (40, 180, 80, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _sync_temp_db(root: Path, db_path: Path) -> object:
    import src.skins.db as db_mod

    db_mod.DATA_DIR = root
    db_mod.DB_PATH = db_path
    db_mod.SKINS_DIR = root / "skins"
    db_mod.DRINKS_DIR = root / "drinks"
    db_mod.WARDROBE_DIR = root / "wardrobe"

    from src.skins import submissions

    submissions.SKINS_DIR = root / "skins"
    return db_mod


def _item_3d_row(submission_id: str = "testplayer-testitem", slug: str = "testitem") -> dict:
    return {
        "id": submission_id,
        "kind": "item_3d",
        "slug": slug,
        "display_name": "Test Item",
        "grip_preset": None,
        "base_set": "handhelds",
        "name_colours": [],
        "name_styles": [],
        "add_name": False,
    }


def _handheld_row(submission_id: str = "testplayer-testsword", slug: str = "testsword") -> dict:
    return {
        "id": submission_id,
        "kind": "handheld",
        "slug": slug,
        "display_name": "Test Sword",
        "grip_preset": None,
        "base_set": "swords",
        "name_colours": [],
        "name_styles": [],
        "add_name": False,
    }


def _armor_row(submission_id: str = "testplayer-testarmor", slug: str = "testarmor") -> dict:
    return {
        "id": submission_id,
        "kind": "armor_set",
        "slug": slug,
        "display_name": "Test Armor",
        "grip_preset": None,
        "base_set": "iron",
        "tiers": '["iron"]',
        "name_colours": [],
        "name_styles": [],
        "add_name": False,
    }


class ReviewSheetCacheTest(unittest.TestCase):
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
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.migrate()
        os.environ["SHEET_RENDER_DISABLE"] = "1"

    def tearDown(self) -> None:
        os.environ.pop("SHEET_RENDER_DISABLE", None)
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def _submission_out_dir(self, submission_id: str) -> Path:
        out_dir = self.skins_dir / submission_id
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir

    def _insert_submission(
        self,
        submission_id: str,
        kind: str,
        slug: str,
        *,
        base_set: str | None = None,
        tiers: str | None = None,
    ) -> Path:
        from src import database

        out_dir = self._submission_out_dir(submission_id)
        if base_set is None:
            base_set = "handhelds" if kind == "item_3d" else "swords"
        with database.connect() as conn:
            code_id = conn.execute(
                """
                INSERT INTO codes (
                    code_hash, player_uuid, scope, realm_id, created_at, expires_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    f"hash-{submission_id}",
                    "player-1",
                    "skin",
                    "main",
                    "2026-01-01T00:00:00Z",
                    "2099-01-01T00:00:00Z",
                ),
            ).fetchone()["id"]
            conn.execute(
                """
                INSERT INTO submissions (
                    id, player_uuid, code_id, kind, slug, display_name,
                    status, dir_path, created_at, discord_user_id, staff, realm_id,
                    base_set, tiers
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    submission_id,
                    "player-1",
                    code_id,
                    kind,
                    slug,
                    "Test",
                    "pending",
                    str(out_dir),
                    "2026-01-01T00:00:00Z",
                    "discord-1",
                    False,
                    "main",
                    base_set,
                    tiers,
                ),
            )
        return out_dir

    def test_cache_stale_false_when_no_3d_job(self) -> None:
        from src.skins.preview_3d import PREVIEW_RENDER_ERROR_NAME
        from src.skins.review_sheet import REVIEW_SHEET_NAME, _review_sheet_cache_stale

        submission_id = "testplayer-testarmor"
        slug = "testarmor"
        out_dir = self._submission_out_dir(submission_id)
        (out_dir / REVIEW_SHEET_NAME).write_bytes(TINY_PNG)
        self.assertFalse(_review_sheet_cache_stale(_armor_row(submission_id, slug), out_dir))
        self.assertFalse((out_dir / PREVIEW_RENDER_ERROR_NAME).is_file())

    def test_cache_stale_when_preview_render_error_exists(self) -> None:
        from src.skins.preview_3d import PREVIEW_RENDER_ERROR_NAME
        from src.skins.review_sheet import REVIEW_SHEET_NAME, _review_sheet_cache_stale

        submission_id = "testplayer-testitem"
        slug = "testitem"
        out_dir = self._submission_out_dir(submission_id)
        (out_dir / f"{slug}.png").write_bytes(_tiny_png())
        (out_dir / f"{slug}.json").write_text("{}", encoding="utf-8")
        (out_dir / REVIEW_SHEET_NAME).write_bytes(TINY_PNG)
        (out_dir / PREVIEW_RENDER_ERROR_NAME).write_text("broken\n", encoding="utf-8")
        self.assertTrue(_review_sheet_cache_stale(_item_3d_row(submission_id, slug), out_dir))

    def test_cache_stale_when_preview_newer_than_sheet(self) -> None:
        from src.skins.review_sheet import REVIEW_SHEET_NAME, _review_sheet_cache_stale

        submission_id = "testplayer-testitem"
        slug = "testitem"
        out_dir = self._submission_out_dir(submission_id)
        (out_dir / f"{slug}.png").write_bytes(_tiny_png())
        (out_dir / f"{slug}.json").write_text("{}", encoding="utf-8")
        (out_dir / REVIEW_SHEET_NAME).write_bytes(TINY_PNG)
        preview = out_dir / "preview_model.png"
        preview.write_bytes(_tiny_png())
        time.sleep(0.05)
        preview.touch()
        self.assertTrue(_review_sheet_cache_stale(_item_3d_row(submission_id, slug), out_dir))

    def test_cache_stale_when_bundle_newer_than_tiles(self) -> None:
        from src.skins.review_sheet import REVIEW_SHEET_NAME, _review_sheet_cache_stale

        submission_id = "testplayer-testitem"
        slug = "testitem"
        out_dir = self._submission_out_dir(submission_id)
        (out_dir / f"{slug}.png").write_bytes(_tiny_png())
        (out_dir / f"{slug}.json").write_text("{}", encoding="utf-8")
        (out_dir / "preview_model.png").write_bytes(_tiny_png())
        (out_dir / REVIEW_SHEET_NAME).write_bytes(TINY_PNG)
        bundle = out_dir / "browser.js"
        time.sleep(0.05)
        bundle.write_text("rebuilt", encoding="utf-8")
        time.sleep(0.05)
        (out_dir / REVIEW_SHEET_NAME).touch()
        with mock.patch("src.skins.preview_3d.BUNDLE", bundle):
            self.assertTrue(
                _review_sheet_cache_stale(_item_3d_row(submission_id, slug), out_dir)
            )

    def test_cache_stale_when_preview_missing(self) -> None:
        from src.skins.review_sheet import REVIEW_SHEET_NAME, _review_sheet_cache_stale

        submission_id = "testplayer-testitem"
        slug = "testitem"
        out_dir = self._submission_out_dir(submission_id)
        (out_dir / f"{slug}.png").write_bytes(_tiny_png())
        (out_dir / f"{slug}.json").write_text("{}", encoding="utf-8")
        (out_dir / REVIEW_SHEET_NAME).write_bytes(TINY_PNG)
        self.assertTrue(_review_sheet_cache_stale(_item_3d_row(submission_id, slug), out_dir))

    def test_build_review_sheet_uses_cache_when_valid(self) -> None:
        from src.skins.review_sheet import REVIEW_SHEET_NAME, build_review_sheet

        submission_id = "testplayer-testarmor"
        slug = "testarmor"
        out_dir = self._insert_submission(
            submission_id,
            "armor_set",
            slug,
            base_set="iron",
            tiers='["iron"]',
        )
        cached_bytes = TINY_PNG + b"cached"
        (out_dir / REVIEW_SHEET_NAME).write_bytes(cached_bytes)

        with mock.patch("src.skins.review_sheet._compose_full_sheet") as compose:
            data = build_review_sheet(submission_id)
        compose.assert_not_called()
        self.assertEqual(data, cached_bytes)

    def test_build_review_sheet_recomposes_when_error_file_exists(self) -> None:
        from src.skins.preview_3d import PREVIEW_RENDER_ERROR_NAME
        from src.skins.review_sheet import REVIEW_SHEET_NAME, build_review_sheet

        submission_id = "testplayer-testitem"
        slug = "testitem"
        out_dir = self._insert_submission(submission_id, "item_3d", slug)
        (out_dir / f"{slug}.png").write_bytes(_tiny_png())
        (out_dir / f"{slug}.json").write_text("{}", encoding="utf-8")
        (out_dir / REVIEW_SHEET_NAME).write_bytes(TINY_PNG)
        (out_dir / PREVIEW_RENDER_ERROR_NAME).write_text("stale\n", encoding="utf-8")

        with mock.patch("src.skins.review_sheet._compose_full_sheet") as compose:
            from PIL import Image

            compose.return_value = Image.new("RGB", (32, 32), (1, 2, 3))
            data = build_review_sheet(submission_id)
        compose.assert_called_once()
        self.assertGreater(len(data), 0)


if __name__ == "__main__":
    unittest.main()
