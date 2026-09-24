"""Rules for TFMCMain plugin folders."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.folders import (  # noqa: E402
    classify_tree,
    diff_tracked,
    note_text,
    plugin_folder,
    rule_matches,
    safe_rule,
    tracked_files,
)


class RuleMatchTest(unittest.TestCase):
    def test_a_new_file_in_a_tracked_directory_matches(self) -> None:
        self.assertTrue(rule_matches("vehicles/*.yml", "vehicles/airship.yml"))
        self.assertTrue(rule_matches("item/*.yml", "item/sword.yml"))
        self.assertTrue(rule_matches("maps/*/functions.yml", "maps/newdungeon/functions.yml"))
        self.assertFalse(rule_matches("maps/*/functions.yml", "maps/newdungeon/players/save.yml"))
        self.assertFalse(rule_matches("maps/*/config.yml", "maps/newdungeon/paper-world.yml"))
        self.assertFalse(rule_matches("*.yml", "item/sword.yml"))

    def test_userdata_and_lore_are_never_tracked(self) -> None:
        rules = ["**/*.yml", "userdata/**/*.yml", "*.yml"]
        files = {
            "config.yml": b"spawn: 1",
            "userdata/player.yml": b"home: 1",
            "players.yml": b"points: 1",
            "item/sword.yml": b"name: sword",
            "language/lore-formats/item.yml": b"lore",
            "maps/dungeon1/players/11111111-1111-1111-1111-111111111111.yml": b"x",
            "data/vehicles.db": b"db",
        }
        tracked = tracked_files(files, rules)
        self.assertEqual(set(tracked), {"config.yml", "item/sword.yml"})

    def test_safe_rule_rejects_player_data(self) -> None:
        with self.assertRaises(ValueError):
            safe_rule("userdata/**/*.yml")
        with self.assertRaises(ValueError):
            safe_rule("../config.yml")
        self.assertEqual(safe_rule("vehicles/*.yml"), "vehicles/*.yml")


class ClassifyTest(unittest.TestCase):
    def test_yaml_directories_are_rules_and_json_dumps_are_unclassified(self) -> None:
        classified = classify_tree(
            {
                "config.yml": b"a",
                "vehicles/sloop.yml": b"b",
                "templates/notes.json": b"{}",
                "userdata/player.yml": b"c",
                "data/vehicles.db": b"d",
            }
        )
        self.assertIn("*.yml", classified.rules)
        self.assertIn("vehicles/**/*.yml", classified.rules)
        self.assertNotIn("userdata/**/*.yml", classified.rules)
        self.assertIn("templates", classified.unclassified)
        self.assertNotIn("userdata", classified.unclassified)
        self.assertNotIn("data", classified.unclassified)


class DiffTest(unittest.TestCase):
    def test_first_scan_baselines(self) -> None:
        current = {"vehicles/sloop.yml": "aaa"}
        snapshot, change, baselined = diff_tracked(None, current, rules_changed=False)
        self.assertTrue(baselined)
        self.assertIsNone(change)
        self.assertEqual(snapshot, current)

    def test_a_new_matching_file_is_a_change(self) -> None:
        previous = {"vehicles/sloop.yml": "aaa"}
        current = {"vehicles/sloop.yml": "aaa", "vehicles/airship.yml": "bbb"}
        _snapshot, change, baselined = diff_tracked(previous, current, rules_changed=False)
        self.assertFalse(baselined)
        self.assertIsNotNone(change)
        assert change is not None
        self.assertEqual(change.added, ("vehicles/airship.yml",))

    def test_a_partial_directory_is_not_a_wipe(self) -> None:
        previous = {f"item/{index}.yml": "a" for index in range(6)}
        current = {"item/0.yml": "a"}
        snapshot, change, _baselined = diff_tracked(previous, current, rules_changed=False)
        self.assertIsNone(change)
        self.assertEqual(snapshot, previous)

    def test_dungeon_notes_do_not_name_the_dungeon(self) -> None:
        from patchnotes.folders import FolderChange

        change = FolderChange(
            edited=("maps/secretmaze/functions.yml", "maps/secretmaze/config.yml"),
        )
        drafted = note_text(
            "MythicDungeons",
            change,
            dangerous=True,
            summary=("adjusted", "Adjusted a named room"),
        )
        self.assertIsNotNone(drafted)
        assert drafted is not None
        _section, body = drafted
        self.assertEqual(body, "A dungeon was adjusted on the main server.")
        self.assertNotIn("secretmaze", body)
        self.assertNotIn("functions", body)
        self.assertNotIn("MythicDungeons", body)

    def test_an_ordinary_edit_keeps_the_summary_and_drops_a_vague_line(self) -> None:
        from patchnotes.folders import FolderChange

        change = FolderChange(edited=("item/sword.yml",))
        self.assertIsNone(note_text("MMOItems", change, dangerous=False, summary=None))
        drafted = note_text(
            "MMOItems",
            change,
            dangerous=False,
            summary=("adjusted", "Adjusted the attack damage of Stone Sword."),
        )
        assert drafted is not None
        self.assertEqual(drafted[1], "Adjusted the attack damage of Stone Sword.")
        self.assertNotIn("sword.yml", drafted[1])

    def test_a_dungeon_without_a_real_diff_is_dropped(self) -> None:
        from patchnotes.folders import FolderChange

        self.assertIsNone(
            note_text(
                "MythicDungeons",
                FolderChange(edited=("maps/secretmaze/config.yml",)),
                dangerous=True,
                summary=None,
            )
        )


class PathTest(unittest.TestCase):
    def test_only_a_tfmcmain_plugin_folder_is_accepted(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "TFMCMain01" / "Minecraft" / "plugins"
            (root / "Cooking").mkdir(parents=True)
            found = plugin_folder(root, "Cooking")
            self.assertIsNotNone(found)
            self.assertIsNone(plugin_folder(root, "Missing"))
            dev = Path(tmp) / "TFMCDev01" / "Minecraft" / "plugins"
            (dev / "Cooking").mkdir(parents=True)
            with self.assertRaises(ValueError):
                plugin_folder(dev, "Cooking")


if __name__ == "__main__":
    unittest.main()
