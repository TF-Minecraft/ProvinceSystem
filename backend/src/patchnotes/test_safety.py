"""Staff warning for hidden knowledge. No database."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.safety import hidden_knowledge_warning  # noqa: E402


class HiddenKnowledgeTest(unittest.TestCase):
    def test_lore_items_are_flagged(self) -> None:
        warning = hidden_knowledge_warning("Moved the lore item behind the inn")
        self.assertIsNotNone(warning)
        assert warning is not None
        self.assertIn("hidden knowledge", warning)
        self.assertIsNotNone(hidden_knowledge_warning("A lore-item recipe changed"))

    def test_ordinary_notes_are_not_flagged(self) -> None:
        self.assertIsNone(hidden_knowledge_warning("Added a crafting station"))
