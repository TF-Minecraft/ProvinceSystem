"""Base-set allowlists for skin kinds."""

from __future__ import annotations

import unittest

from skins.submissions import _validate_base_set


class LuteBaseSetTest(unittest.TestCase):
    def test_lutes_allowed_for_handheld_and_item_3d(self) -> None:
        self.assertEqual(_validate_base_set("handheld", "lutes"), "lutes")
        self.assertEqual(_validate_base_set("item_3d", "lutes"), "lutes")

    def test_lutes_rejected_for_large_handheld(self) -> None:
        # skins.submissions and src.skins.submissions are both on the path, so
        # the raised class is not always the imported one.
        with self.assertRaises(Exception) as ctx:
            _validate_base_set("large_handheld", "lutes")
        self.assertIn("not valid for kind 'large_handheld'", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
