"""MMOItems deltas become pending notes. Dev files are refused."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.mmoitems import assert_main_item_dir, sync_catalog  # noqa: E402

_SWORD = """
STEEL_SWORD:
  base:
    name: '&fSteel Sword'
    displayed-type: Sword
    attack-damage: 8
    lore:
      - A secret line that must not be copied
    revision-id: 3
    commands:
      - say hello
"""

_SWORD_STRONGER = """
STEEL_SWORD:
  base:
    name: '&fSteel Sword'
    displayed-type: Sword
    attack-damage: 11
    lore:
      - A different secret
    revision-id: 4
"""

_LORE_ITEM = """
RELIC:
  base:
    name: Ancient lore item
    displayed-type: Relic
    attack-damage: 1
"""


class MainPathTest(unittest.TestCase):
    def test_paths(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            main = base / "TFMCMain01" / "Minecraft" / "plugins" / "MMOItems" / "item"
            dev = base / "TFMCDev01" / "Minecraft" / "plugins" / "MMOItems" / "item"
            main.mkdir(parents=True)
            dev.mkdir(parents=True)
            self.assertEqual(assert_main_item_dir(main), main.resolve())
            with self.assertRaises(ValueError):
                assert_main_item_dir(dev)
            with self.assertRaises(ValueError):
                assert_main_item_dir(main.parent)


class SyncCatalogTest(unittest.TestCase):
    def test_first_scan_stores_items_and_drafts_nothing(self) -> None:
        result = sync_catalog(None, {"swords.yml": _SWORD})
        self.assertTrue(result.baselined)
        self.assertEqual(result.drafts, [])
        self.assertIn("STEEL_SWORD", result.state["swords.yml"])
        self.assertNotIn("lore", json_blob(result.state))
        self.assertNotIn("secret", json_blob(result.state))

    def test_stat_change_is_adjusted_without_the_number_or_lore(self) -> None:
        first = sync_catalog(None, {"swords.yml": _SWORD})
        second = sync_catalog(first.state, {"swords.yml": _SWORD_STRONGER})
        self.assertEqual(len(second.drafts), 1)
        draft = second.drafts[0]
        self.assertEqual(draft.section, "adjusted")
        self.assertEqual(draft.body, "Adjusted the attack damage of Steel Sword")
        self.assertNotIn("11", draft.body)
        self.assertNotIn("secret", draft.body)

    def test_lore_text_alone_is_not_a_note(self) -> None:
        first = sync_catalog(None, {"swords.yml": _SWORD})
        changed = _SWORD.replace("A secret line", "Another secret line")
        second = sync_catalog(first.state, {"swords.yml": changed})
        self.assertEqual(second.drafts, [])
        self.assertEqual(second.withheld, 0)

    def test_a_lore_item_is_withheld(self) -> None:
        first = sync_catalog(None, {"relics.yml": ""})
        second = sync_catalog(first.state, {"relics.yml": _LORE_ITEM})
        self.assertEqual(second.drafts, [])
        self.assertEqual(second.withheld, 1)

    def test_a_new_item_is_a_feature(self) -> None:
        first = sync_catalog(None, {"swords.yml": ""})
        second = sync_catalog(first.state, {"swords.yml": _SWORD})
        self.assertEqual(second.drafts[0].section, "new")
        self.assertIn("Steel Sword", second.drafts[0].body)
        self.assertNotIn("secret", second.drafts[0].body)

    def test_a_partial_file_is_left_unchanged(self) -> None:
        items = "\n".join(
            f"ITEM_{i}:\n  base:\n    name: Item {i}\n    displayed-type: Tool\n    attack-damage: 1\n"
            for i in range(6)
        )
        first = sync_catalog(None, {"tools.yml": items})
        partial = "ITEM_0:\n  base:\n    name: Item 0\n    displayed-type: Tool\n    attack-damage: 1\n"
        second = sync_catalog(first.state, {"tools.yml": partial})
        self.assertEqual(second.drafts, [])
        self.assertEqual(len(second.state["tools.yml"]), 6)

    def test_a_missing_large_file_is_not_a_wipe(self) -> None:
        items = "\n".join(
            f"ITEM_{i}:\n  base:\n    name: Item {i}\n    displayed-type: Tool\n    attack-damage: 1\n"
            for i in range(6)
        )
        first = sync_catalog(None, {"tools.yml": items})
        second = sync_catalog(first.state, {})
        self.assertEqual(second.drafts, [])
        self.assertEqual(len(second.state["tools.yml"]), 6)

    def test_broken_yaml_does_not_remove_items(self) -> None:
        first = sync_catalog(None, {"swords.yml": _SWORD})
        second = sync_catalog(first.state, {"swords.yml": "STEEL_SWORD: [\n"})
        self.assertEqual(second.drafts, [])
        self.assertIn("STEEL_SWORD", second.state["swords.yml"])


def json_blob(value: object) -> str:
    import json

    return json.dumps(value)
