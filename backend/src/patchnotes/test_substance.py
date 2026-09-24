"""File diffs become a named line, or they are dropped."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.substance import file_review, summarize_reviews  # noqa: E402


_SWORD_OLD = """
STONE_SWORD:
  base:
    name: Stone Sword
    attack-damage: 6
    lore:
      - A hidden tale
"""

_SWORD_DAMAGE = """
STONE_SWORD:
  base:
    name: Stone Sword
    attack-damage: 8
    lore:
      - A hidden tale
"""

_SWORD_LORE = """
STONE_SWORD:
  base:
    name: Stone Sword
    attack-damage: 6
    lore:
      - A different tale
"""


class FileReviewTest(unittest.TestCase):
    def test_a_named_stat_is_described_without_the_number(self) -> None:
        review = file_review(_SWORD_OLD, _SWORD_DAMAGE, compared=True)
        self.assertTrue(review.meaningful)
        self.assertIn("Stone Sword", review.sentence)
        self.assertIn("attack damage", review.sentence)
        self.assertNotIn("8", review.sentence)
        self.assertNotIn("lore", review.sentence.lower())

    def test_lore_only_is_dropped(self) -> None:
        review = file_review(_SWORD_OLD, _SWORD_LORE, compared=True)
        self.assertFalse(review.meaningful)
        self.assertEqual(review.sentence, "")

    def test_whitespace_and_key_order_are_dropped(self) -> None:
        old = "name: Stone Sword\nattack-damage: 6\n"
        new = "attack-damage: 6\n\nname: Stone Sword\n"
        review = file_review(old, new, compared=True)
        self.assertFalse(review.meaningful)

    def test_coordinates_are_dropped(self) -> None:
        old = "source:\n  world: map\n  x: 1\n  z: 2\n"
        new = "source:\n  world: map\n  x: 9\n  z: 8\n"
        review = file_review(old, new, compared=True)
        self.assertFalse(review.meaningful)

    def test_player_saves_are_dropped(self) -> None:
        old = "players:\n  11111111-1111-1111-1111-111111111111:\n    points: 1\n"
        new = "players:\n  11111111-1111-1111-1111-111111111111:\n    points: 5\n"
        review = file_review(old, new, compared=True)
        self.assertFalse(review.meaningful)

    def test_a_new_named_activity_is_added(self) -> None:
        old = "activities:\n  vote:\n    display: Voting\n"
        new = "activities:\n  vote:\n    display: Voting\n  fishing:\n    display: Fishing\n"
        review = file_review(old, new, compared=True)
        self.assertEqual(review.section, "new")
        self.assertIn("Fishing", review.sentence)
        self.assertNotIn("fishing:", review.sentence)

    def test_a_new_named_file_is_an_addition(self) -> None:
        review = file_review(None, "name: Camp Stew\nrestore-food: 4\n", compared=True)
        self.assertEqual(review.section, "new")
        self.assertIn("Camp Stew", review.sentence)
        self.assertNotIn("4", review.sentence)

    def test_missing_previous_text_is_not_a_note(self) -> None:
        review = file_review(None, _SWORD_DAMAGE, compared=False)
        self.assertFalse(review.meaningful)

    def test_a_dungeon_diff_stays_vague(self) -> None:
        review = file_review(_SWORD_OLD, _SWORD_DAMAGE, compared=True)
        drafted = summarize_reviews([review], dangerous=True)
        self.assertEqual(drafted, ("adjusted", "A dungeon was adjusted on the main server."))
        assert drafted is not None
        self.assertNotIn("Stone", drafted[1])

    def test_an_unnamed_change_is_not_posted(self) -> None:
        review = file_review("enabled: true\n", "enabled: false\n", compared=True)
        self.assertTrue(review.meaningful)
        self.assertEqual(review.sentence, "")
        self.assertIsNone(summarize_reviews([review], dangerous=False))

    def test_color_codes_alone_are_dropped(self) -> None:
        old = "display: '&aVoting'\n"
        new = "display: '&cVoting'\n"
        review = file_review(old, new, compared=True)
        self.assertFalse(review.meaningful)
