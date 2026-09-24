"""Deny reasons become a new line, or the line stays denied."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.revise import rewrite  # noqa: E402


class RewriteTest(unittest.TestCase):
    def test_explicit_wording_replaces_the_line(self) -> None:
        section, body = rewrite("new", "Added a station near the vault", "say: Added a station")
        self.assertEqual(section, "new")
        self.assertEqual(body, "Added a station")

    def test_staff_sentence_is_the_new_line(self) -> None:
        section, body = rewrite("adjusted", "Changed a price", "Lowered the station price")
        self.assertEqual((section, body), ("adjusted", "Lowered the station price"))

    def test_drop_leaves_the_line_denied(self) -> None:
        self.assertIsNone(rewrite("new", "Added a station", "Don't post this"))
        self.assertIsNone(rewrite("new", "Named a lore item", "This names a lore item"))

    def test_strips_a_named_detail(self) -> None:
        section, body = rewrite(
            "new",
            "Opened the north wing dungeon",
            "Don't mention the dungeon",
        )
        self.assertEqual(section, "new")
        self.assertNotIn("dungeon", body.lower())
        self.assertIn("north wing", body)

    def test_does_not_cut_through_a_longer_word(self) -> None:
        self.assertIsNone(
            rewrite("adjusted", "Updated workshop recipes", "Don't mention the shop")
        )

    def test_section_move_keeps_a_safe_line(self) -> None:
        section, body = rewrite("new", "Rebuilt a plugin", "Make it technical")
        self.assertEqual(section, "technical")
        self.assertEqual(body, "Rebuilt a plugin")

    def test_same_line_is_not_posted_again(self) -> None:
        self.assertIsNone(rewrite("fixed", "Fixed a door", "Fixed a door"))

    def test_secret_replacement_is_refused(self) -> None:
        self.assertIsNone(rewrite("technical", "Rebuilt a plugin", "say: staff_key=abc"))

    def test_a_question_is_not_the_new_line(self) -> None:
        self.assertIsNone(
            rewrite(
                "adjusted",
                "Adjusted the filet recipe",
                "This has no use to the player, can you describe it better?",
            )
        )
