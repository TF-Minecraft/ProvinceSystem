"""Base-set allowlists for skin kinds."""

from __future__ import annotations

import unittest

from skins.submissions import SubmissionError, _validate_base_set


class LuteBaseSetTest(unittest.TestCase):
    def test_lutes_allowed_for_handheld_and_item_3d(self) -> None:
        self.assertEqual(_validate_base_set("handheld", "lutes"), "lutes")
        self.assertEqual(_validate_base_set("item_3d", "lutes"), "lutes")

    def test_lutes_rejected_for_large_handheld(self) -> None:
        with self.assertRaises(SubmissionError):
            _validate_base_set("large_handheld", "lutes")


if __name__ == "__main__":
    unittest.main()
