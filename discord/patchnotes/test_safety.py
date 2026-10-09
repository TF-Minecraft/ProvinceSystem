"""Hidden-knowledge warning. No Discord install required."""

from __future__ import annotations

import unittest

import safety


class SafetyTest(unittest.TestCase):
    def test_lore_items_are_flagged(self) -> None:
        warning = safety.hidden_knowledge_warning("Moved the lore item behind the inn")
        self.assertIsNotNone(warning)
        self.assertIsNotNone(safety.hidden_knowledge_warning("A lore-item recipe changed"))

    def test_ordinary_notes_are_not_flagged(self) -> None:
        self.assertIsNone(safety.hidden_knowledge_warning("Added a crafting station"))


if __name__ == "__main__":
    unittest.main()
