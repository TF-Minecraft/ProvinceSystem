"""Tests for 3D review-sheet tile selection (renderer mocked off)."""

from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))


def _tiny_png() -> bytes:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGBA", (16, 16), (40, 180, 80, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _item_3d_row(slug: str = "testitem") -> dict:
    return {
        "id": "sub-test-1",
        "kind": "item_3d",
        "slug": slug,
        "display_name": "Test Item",
        "grip_preset": None,
        "base_set": "handhelds",
        "name_colours": [],
        "name_styles": [],
        "add_name": False,
    }


class Preview3dJobTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        os.environ["SHEET_RENDER_DISABLE"] = "1"

    def tearDown(self) -> None:
        os.environ.pop("SHEET_RENDER_DISABLE", None)
        self.tmp.cleanup()

    def test_gun_job_lists_carry_aim_reload(self) -> None:
        from src.skins.preview_3d import _job_for_kind

        slug = "gun1"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        for stem in ("carry", "aim", "reload"):
            (self.out / f"{slug}_{stem}.json").write_text("{}", encoding="utf-8")
        job = _job_for_kind("gun", slug, self.out, [])
        self.assertIsNotNone(job)
        self.assertEqual(job["views"], ["model", "carry", "reload", "aim"])

    def test_ensure_preview_skips_when_disabled(self) -> None:
        from src.skins.preview_3d import ensure_preview_tiles

        slug = "armor1"
        tiles, err = ensure_preview_tiles("armor_set", slug, self.out, tiers=["iron"])
        self.assertEqual(tiles, [])
        self.assertIsNone(err)

    def test_item_3d_disabled_sets_error(self) -> None:
        from src.skins.preview_3d import (
            PREVIEW_RENDER_ERROR_NAME,
            ensure_preview_tiles,
        )

        slug = "item3d"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        (self.out / f"{slug}.json").write_text("{}", encoding="utf-8")
        tiles, err = ensure_preview_tiles("item_3d", slug, self.out)
        self.assertEqual(tiles, [])
        self.assertIsNotNone(err)
        self.assertIn("SHEET_RENDER_DISABLE", err or "")
        self.assertFalse((self.out / PREVIEW_RENDER_ERROR_NAME).is_file())

    def test_node_missing_error(self) -> None:
        from src.skins.preview_3d import ensure_preview_tiles

        os.environ.pop("SHEET_RENDER_DISABLE", None)
        slug = "item3d"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        (self.out / f"{slug}.json").write_text("{}", encoding="utf-8")
        with mock.patch("src.skins.preview_3d._node_bin", return_value=None):
            tiles, err = ensure_preview_tiles("item_3d", slug, self.out)
        self.assertEqual(tiles, [])
        self.assertIsNotNone(err)
        self.assertIn("node not found", err or "")

    def test_newer_bundle_rerenders_existing_tiles(self) -> None:
        import time

        from src.skins.preview_3d import ensure_preview_tiles

        os.environ.pop("SHEET_RENDER_DISABLE", None)
        slug = "item3d"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        (self.out / f"{slug}.json").write_text("{}", encoding="utf-8")
        preview = self.out / "preview_model.png"
        preview.write_bytes(_tiny_png())
        bundle = self.out / "browser.js"
        time.sleep(0.05)
        bundle.write_text("rebuilt", encoding="utf-8")
        fake_result = mock.Mock(returncode=0, stderr="", stdout="")
        cli = mock.Mock()
        cli.is_file.return_value = True
        with (
            mock.patch("src.skins.preview_3d._node_bin", return_value="node"),
            mock.patch("src.skins.preview_3d.BUNDLE", bundle),
            mock.patch("src.skins.preview_3d.CLI", cli),
            mock.patch("src.skins.preview_3d.subprocess.run", return_value=fake_result) as run,
        ):
            ensure_preview_tiles("item_3d", slug, self.out)
        run.assert_called_once()

    def test_subprocess_failure_propagates_error(self) -> None:
        from src.skins.preview_3d import ensure_preview_tiles

        os.environ.pop("SHEET_RENDER_DISABLE", None)
        slug = "item3d"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        (self.out / f"{slug}.json").write_text("{}", encoding="utf-8")
        fake_result = mock.Mock(returncode=1, stderr="bundle missing", stdout="")
        bundle = mock.Mock()
        bundle.is_file.return_value = True
        cli = mock.Mock()
        cli.is_file.return_value = True
        with (
            mock.patch("src.skins.preview_3d._node_bin", return_value="node"),
            mock.patch("src.skins.preview_3d.BUNDLE", bundle),
            mock.patch("src.skins.preview_3d.CLI", cli),
            mock.patch("src.skins.preview_3d.subprocess.run", return_value=fake_result),
        ):
            tiles, err = ensure_preview_tiles("item_3d", slug, self.out)
        self.assertEqual(tiles, [])
        self.assertEqual(err, "bundle missing")

    def test_compose_writes_render_error_file(self) -> None:
        from PIL import Image

        from src.skins.preview_3d import PREVIEW_RENDER_ERROR_NAME
        from src.skins.review_sheet import _compose_full_sheet

        slug = "item3d"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        (self.out / f"{slug}.json").write_text("{}", encoding="utf-8")
        sheet = _compose_full_sheet(_item_3d_row(slug), self.out)
        buf = io.BytesIO()
        sheet.save(buf, format="PNG")
        self.assertGreater(len(buf.getvalue()), 100)
        err_path = self.out / PREVIEW_RENDER_ERROR_NAME
        self.assertTrue(err_path.is_file())
        self.assertIn("SHEET_RENDER_DISABLE", err_path.read_text(encoding="utf-8"))

    def test_compose_clears_error_on_success(self) -> None:
        from PIL import Image

        from src.skins.preview_3d import PREVIEW_RENDER_ERROR_NAME
        from src.skins.review_sheet import _compose_full_sheet

        slug = "item3d"
        (self.out / f"{slug}.png").write_bytes(_tiny_png())
        (self.out / f"{slug}.json").write_text("{}", encoding="utf-8")
        Image.new("RGB", (64, 64), (10, 20, 30)).save(self.out / "preview_model.png")
        (self.out / PREVIEW_RENDER_ERROR_NAME).write_text(
            "stale error\n", encoding="utf-8"
        )
        sheet = _compose_full_sheet(_item_3d_row(slug), self.out)
        self.assertGreater(sheet.height, 64)
        self.assertFalse((self.out / PREVIEW_RENDER_ERROR_NAME).is_file())

    def test_editable_kit_keeps_skin_png_signed(self) -> None:
        from src.characters.creation_catalog import _normalize_editable_kit

        rows = _normalize_editable_kit(
            [
                {
                    "kit_key": "writable_book",
                    "path": "v.WRITABLE_BOOK",
                    "amount": 1,
                    "skin_png": "journal_skin",
                    "skin_png_signed": "journal_skin_signed",
                    "base_set": "books",
                    "2d_template": "book",
                }
            ]
        )
        self.assertEqual(rows[0]["skin_png_signed"], "journal_skin_signed")
        self.assertEqual(rows[0]["skin_png"], "journal_skin")

    def test_review_sheet_composites_existing_preview_tiles(self) -> None:
        from PIL import Image

        from src.skins.review_sheet import _preview_tiles_row

        path = self.out / "preview_model.png"
        Image.new("RGB", (64, 64), (10, 20, 30)).save(path)
        row = _preview_tiles_row([("model", path)])
        self.assertIsNotNone(row)
        self.assertGreaterEqual(row.width, 64)
        self.assertGreaterEqual(row.height, 64)


if __name__ == "__main__":
    unittest.main()
