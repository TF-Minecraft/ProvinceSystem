"""Tests for the start-of-week against end-of-week plugin comparison."""

from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes import weekly  # noqa: E402

_JUGGERNAUT_OLD = """
display:
  name: '&6Juggernaut'
max-level: 6
attributes:
  max_health:
    base: 30
    per-level: 0.45
  damage-reduction:
    base: 15
skills:
  BULWARK:
    level: 2
"""
_JUGGERNAUT_NEW = _JUGGERNAUT_OLD.replace("base: 30", "base: 28").replace("0.45", "0.4").replace(
    "base: 15", "base: 12"
)
_SKILLS = """
BULWARK:
  name: Bulwark
UNBROKEN:
  name: Unbroken
"""


def _snapshot(files: dict[str, str], jars: dict[str, tuple[str, str]] | None = None) -> weekly.Snapshot:
    return weekly.Snapshot(files=dict(files), jars=dict(jars or {}))


class TrackedFilesTest(unittest.TestCase):
    def test_runtime_state_and_submissions_are_ignored(self) -> None:
        self.assertTrue(weekly.tracked_config("MMOCore/classes/juggernaut.yml"))
        self.assertFalse(weekly.tracked_config("TFMCCore/tfmc-cooldowns.yml"))
        self.assertFalse(weekly.tracked_config("activity/reward-lock.yml"))
        self.assertFalse(weekly.tracked_config("ItemsAdder/contents/tfmc_submissions/configs/hat.yml"))
        self.assertFalse(weekly.tracked_config("Archaeo/sites/345f77c2-c1e1-4931-b183-9410ab7ef362.yml"))
        self.assertFalse(weekly.tracked_config("Cooking/data/animals.yml"))
        self.assertFalse(weekly.tracked_config("config.yml"))

    def test_discoveries_are_hidden(self) -> None:
        self.assertTrue(weekly.hidden_config("Codex/categories/poi.yml"))
        self.assertTrue(weekly.hidden_config("MMOItems/item/research.yml"))
        self.assertFalse(weekly.hidden_config("MMOItems/item/sword.yml"))


class JarEntryTest(unittest.TestCase):
    def test_versioned_jar_names(self) -> None:
        self.assertEqual(weekly.jar_entry("rpcharacters-2.12.6.jar"), ("rpcharacters", "rpcharacters", "2.12.6"))
        self.assertEqual(weekly.jar_entry("MCPets-4.1.11.jar"), ("mcpets", "MCPets", "4.1.11"))
        self.assertEqual(weekly.jar_entry("MMOCore-1.13.1-SNAPSHOT.jar")[2], "1.13.1-SNAPSHOT")

    def test_unversioned_and_non_jars(self) -> None:
        self.assertEqual(weekly.jar_entry("ProtocolLib.jar"), ("protocollib", "ProtocolLib", ""))
        self.assertIsNone(weekly.jar_entry("notes.txt"))


class CompareTest(unittest.TestCase):
    def test_class_file_reports_final_numbers_under_its_name(self) -> None:
        base = _snapshot({"MMOCore/classes/juggernaut.yml": _JUGGERNAUT_OLD, "MythicLib/skill/tfmc.yml": _SKILLS})
        current = _snapshot({"MMOCore/classes/juggernaut.yml": _JUGGERNAUT_NEW, "MythicLib/skill/tfmc.yml": _SKILLS})
        facts = weekly.compare(base, current)
        self.assertEqual(len(facts["files"]), 1)
        entry = facts["files"][0]["entries"][0]
        self.assertEqual(entry["name"], "Juggernaut")
        self.assertIn("attributes.max_health.base: 30 --> 28", entry["details"])
        self.assertIn("attributes.max_health.per-level: 0.45 --> 0.4", entry["details"])
        self.assertIn("attributes.damage-reduction.base: 15 --> 12", entry["details"])

    def test_new_skills_use_their_player_names(self) -> None:
        new = _JUGGERNAUT_OLD + "  UNBROKEN:\n    level: 2\n"
        base = _snapshot({"MMOCore/classes/juggernaut.yml": _JUGGERNAUT_OLD, "MythicLib/skill/tfmc.yml": _SKILLS})
        current = _snapshot({"MMOCore/classes/juggernaut.yml": new, "MythicLib/skill/tfmc.yml": _SKILLS})
        details = weekly.compare(base, current)["files"][0]["entries"][0]["details"]
        self.assertEqual(details, ["skills.Unbroken: added (level=2)"])

    def test_reformatting_alone_is_not_a_change(self) -> None:
        base = _snapshot({"Cooking/config.yml": "a: 1\nb: 2\n"})
        current = _snapshot({"Cooking/config.yml": "# comment\nb: 2\na: 1\n"})
        self.assertEqual(weekly.compare(base, current)["files"], [])

    def test_entries_are_grouped_by_item_name(self) -> None:
        old = "HORSE:\n  name: Horse\n  max-health: 20\nDONKEY:\n  name: Donkey\n  max-health: 20\n"
        new = old.replace("max-health: 20\nDONKEY", "max-health: 27\nDONKEY")
        facts = weekly.compare(_snapshot({"Cooking/husbandry.yml": old}), _snapshot({"Cooking/husbandry.yml": new}))
        entries = facts["files"][0]["entries"]
        self.assertEqual([entry["name"] for entry in entries], ["Horse"])
        self.assertEqual(entries[0]["details"], ["max-health: 20 --> 27"])

    def test_added_and_removed_entries(self) -> None:
        old = "iron:\n  name: Iron Sword\n  damage: 5\n"
        new = "steel:\n  name: Steel Sword\n  damage: 7\n"
        entries = weekly.compare(_snapshot({"MMOItems/item/sword.yml": old}), _snapshot({"MMOItems/item/sword.yml": new}))[
            "files"
        ][0]["entries"]
        kinds = {entry["name"]: entry["kind"] for entry in entries}
        self.assertEqual(kinds, {"Iron Sword": "removed", "Steel Sword": "added"})

    def test_top_level_settings_are_listed_together(self) -> None:
        old = "corridor-share: 0.5\nrail: 0.8\n"
        new = "corridor-share: 0.5\nrail: 0.4\n"
        entries = weekly.compare(_snapshot({"SimpleFactions/config.yml": old}), _snapshot({"SimpleFactions/config.yml": new}))[
            "files"
        ][0]["entries"]
        self.assertEqual(entries, [{"name": "settings", "kind": "changed", "details": ["rail: 0.8 --> 0.4"]}])

    def test_hidden_files_are_counted_not_listed(self) -> None:
        old = "a:\n  name: A\nb:\n  name: B\n"
        new = "a:\n  name: A2\nb:\n  name: B\nc:\n  name: C\n"
        facts = weekly.compare(_snapshot({"Codex/categories/poi.yml": old}), _snapshot({"Codex/categories/poi.yml": new}))
        self.assertEqual(facts["files"], [])
        self.assertEqual(facts["hidden"], {"Codex": 2})

    def test_plugin_updates_carry_their_repo(self) -> None:
        base = _snapshot({}, {"rpcharacters": ("rpcharacters", "2.11.0"), "mcpets": ("MCPets", "4.1.11")})
        current = _snapshot(
            {},
            {
                "rpcharacters": ("rpcharacters", "2.12.6"),
                "mcpets": ("MCPets", "4.1.11"),
                "activity": ("activity", "1.2.10"),
            },
        )
        updates = weekly.compare(base, current)["plugins"]
        self.assertEqual(
            updates,
            [
                {"plugin": "activity", "repo": "ActivityTF", "old": None, "new": "1.2.10"},
                {"plugin": "rpcharacters", "repo": "RPCharacters", "old": "2.11.0", "new": "2.12.6"},
            ],
        )


class SnapshotFromZipTest(unittest.TestCase):
    def test_reads_configs_and_jars_without_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "20261009-060200-abc.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("plugins/simplefactions-3.14.0.jar", b"jar")
                archive.writestr("plugins/MMOCore/classes/juggernaut.yml", _JUGGERNAUT_NEW)
                archive.writestr("plugins/MMOCore/userdata/x.yml", "a: 1")
                archive.writestr("plugins/TFMCCore/tfmc-cooldowns.yml", "a: 1")
                archive.writestr("world/region/r.0.0.mca", b"x")
            snapshot = weekly.snapshot_from_zip(path)
        self.assertEqual(set(snapshot.files), {"MMOCore/classes/juggernaut.yml"})
        self.assertEqual(snapshot.jars, {"simplefactions": ("simplefactions", "3.14.0")})


if __name__ == "__main__":
    unittest.main()
