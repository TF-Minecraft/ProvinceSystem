"""Creation rules shared with RPCharacters, and how web creates apply them."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pytest

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.characters.creation_rules import (  # noqa: E402
    dependency_met,
    is_character_name,
    passes_account_age_gate,
    traits_error,
)

DAY = 24 * 3600
EVIL_GATE = {"type": "trait", "mode": "one-or-more", "depends_on": ["greedy", "callous"]}


def _catalog() -> dict:
    return {
        "stages": [
            {"id": "info", "type": "info"},
            {"id": "race", "type": "selection", "target": "race", "key": "race"},
            {
                "id": "physical",
                "type": "selection",
                "target": "trait",
                "key": "physical",
                "min_select": 1,
                "max_select": 2,
                "points": 1,
            },
            {
                "id": "personality",
                "type": "selection",
                "target": "trait",
                "key": "personality",
                "max_select": 5,
            },
            {
                "id": "evil",
                "type": "selection",
                "target": "trait",
                "key": "evil",
                "max_select": 2,
                "dependency": EVIL_GATE,
                "require_account_age_hours_min": 24,
            },
            {
                "id": "injury",
                "type": "selection",
                "target": "trait",
                "key": "injury",
                "max_select": 99,
                "filter": "permanent-only",
            },
            {
                "id": "secret",
                "type": "selection",
                "target": "trait",
                "key": "secret",
                "platform": "game",
            },
        ],
        "traits": [
            {"id": "strong", "key": "physical", "cost": 1, "mutually_exclusive": ["weak"]},
            {"id": "weak", "key": "physical", "cost": -1},
            {"id": "agile", "key": "physical", "cost": 1},
            {"id": "greedy", "key": "personality"},
            {"id": "callous", "key": "personality"},
            {"id": "honest", "key": "personality", "mutually_exclusive": ["deceitful"]},
            {"id": "deceitful", "key": "personality"},
            {
                "id": "mercenary",
                "key": "evil",
                "dependency": {"type": "trait", "mode": "one-or-more", "depends_on": ["greedy", "cynical"]},
                "required_account_playtime_hours": 24,
            },
            {"id": "blind", "key": "injury"},
            {"id": "broken_arm", "key": "injury", "has_duration": True},
            {"id": "hidden", "key": "secret"},
            {"id": "str1", "key": "attributes"},
            {"id": "elf_sight", "key": "personality", "dependency": {"type": "race", "depends_on": ["elf"]}},
        ],
    }


def _error(picked: list[str], *, age: int = 2 * DAY, race: str = "human", attributes=()) -> str | None:
    return traits_error(_catalog(), picked, list(attributes), race, age)


class NameTests(unittest.TestCase):
    def test_names_players_already_use_pass(self) -> None:
        for name in ("Dr. Dai", "Saul Go'Dar", "Sweyn Wolf-Fang", "Nøkk", "Zoë"):
            self.assertTrue(is_character_name(name), name)

    def test_digits_underscores_and_leading_punctuation_fail(self) -> None:
        for name in ("Ar1a", "Ar_ia", "-Aria", "'Aria", "", "Aria!"):
            self.assertFalse(is_character_name(name), name)


class DependencyTests(unittest.TestCase):
    def test_trait_modes_race_and_unknown_types(self) -> None:
        self.assertTrue(dependency_met(None, [], "human"))
        self.assertTrue(dependency_met(EVIL_GATE, ["Callous"], "human"))
        self.assertFalse(dependency_met(EVIL_GATE, ["honest"], "human"))
        both = {"type": "trait", "mode": "all", "depends_on": ["greedy", "callous"]}
        self.assertFalse(dependency_met(both, ["greedy"], "human"))
        self.assertTrue(dependency_met(both, ["greedy", "callous"], "human"))
        self.assertFalse(dependency_met(both, ["greedy", "callous"], "human", ignore_id="callous"))
        self.assertFalse(dependency_met({"type": "trait", "mode": "odd", "depends_on": ["greedy"]}, ["greedy"], ""))
        self.assertTrue(dependency_met({"type": "race", "depends_on": ["Elf"]}, [], "elf"))
        self.assertFalse(dependency_met({"type": "race", "depends_on": ["elf"]}, [], "human"))
        self.assertFalse(dependency_met({"type": "faction", "depends_on": ["x"]}, [], "human"))

    def test_account_age_gate_has_inclusive_min_and_exclusive_max(self) -> None:
        self.assertTrue(passes_account_age_gate({}, 0))
        self.assertFalse(passes_account_age_gate({"require_account_age_hours_min": 24}, DAY - 1))
        self.assertTrue(passes_account_age_gate({"require_account_age_hours_min": 24}, DAY))
        self.assertTrue(passes_account_age_gate({"require_account_age_hours_max": 24}, DAY - 1))
        self.assertFalse(passes_account_age_gate({"require_account_age_hours_max": 24}, DAY))


class TraitRuleTests(unittest.TestCase):
    def test_a_valid_sheet_passes(self) -> None:
        self.assertIsNone(_error(["strong", "greedy", "mercenary", "blind"], attributes=["str1"]))

    def test_stage_counts_points_and_filters(self) -> None:
        self.assertEqual(_error([]), "pick 1 to 2 physical traits")
        self.assertEqual(_error(["strong", "agile"]), "your physical traits cost more than 1 points")
        self.assertEqual(_error(["strong", "agile", "weak"]), "pick 1 to 2 physical traits")
        self.assertEqual(_error(["strong", "broken_arm"]), "broken_arm cannot be picked at creation")

    def test_traits_without_a_web_stage_are_refused(self) -> None:
        self.assertEqual(_error(["strong", "hidden"]), "hidden cannot be picked at creation")
        self.assertEqual(_error(["strong", "str1"]), "str1 cannot be picked at creation")

    def test_gated_stage_must_be_empty_when_it_would_not_open(self) -> None:
        self.assertEqual(_error(["strong", "honest", "mercenary"]), "mercenary is not available to this character")
        self.assertEqual(
            _error(["strong", "greedy", "mercenary"], age=DAY - 1),
            "mercenary is not available to this character",
        )

    def test_conflicts_requirements_and_account_age(self) -> None:
        self.assertEqual(_error(["strong", "honest", "deceitful"]), "honest cannot be combined with deceitful")
        self.assertEqual(_error(["strong", "callous", "mercenary"]), "mercenary needs greedy or cynical")
        self.assertEqual(_error(["strong", "elf_sight"]), "elf_sight needs elf")
        self.assertIsNone(_error(["strong", "elf_sight"], race="elf"))
        catalog = _catalog()
        catalog["stages"][4].pop("require_account_age_hours_min")
        self.assertEqual(
            traits_error(catalog, ["strong", "greedy", "mercenary"], [], "human", DAY - 1),
            "mercenary needs an account at least 24 hours old",
        )
        catalog["traits"][7]["dependency"]["mode"] = "all"
        self.assertEqual(
            traits_error(catalog, ["strong", "greedy", "mercenary"], [], "human", DAY),
            "mercenary needs greedy and cynical",
        )


@pytest.mark.usefixtures("postgres")
class CreateCheckTests(unittest.TestCase):
    """The create endpoint's validation runs the shared rules."""

    def setUp(self) -> None:
        from src.skins import db

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        paths = patch.multiple(
            db,
            DATA_DIR=root,
            SKINS_DIR=root / "skins",
            DRINKS_DIR=root / "drinks",
            WARDROBE_DIR=root / "wardrobe",
        )
        paths.start()
        self.addCleanup(paths.stop)
        db.ensure_directories()
        catalog = _catalog()
        catalog.update(
            {
                "validation": {
                    "name": {"min_length": 3, "max_length": 24},
                    "age": {"minimum": 18},
                    "description": {"min_length": 10, "max_length": 256},
                    "clues": {"min_length": 5, "max_length": 48, "max_clues": 5},
                },
                "attribute_point_buy": {
                    "attributes": ["strength"],
                    "abbreviations": {"strength": "str"},
                    "cost_for_rank": [1, 2, 4, 8],
                    "pool": 1,
                    "max_rank": 4,
                },
                "races": [{"id": "human", "age_max": 110}],
                "classes": [{"id": "WARRIOR"}],
            }
        )
        for target, value in (
            ("require_synced_creation_catalog", catalog),
            ("get_player_meta", {"real_age_set": True, "eighteen": True, "account_created_at_epoch": 1}),
            ("get_max_alive", 2),
        ):
            patcher = patch(f"src.characters.creates.{target}", return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _body(self, **changes) -> dict:
        body = {
            "client_request_id": "request-1",
            "name": "Aria",
            "age": 30,
            "description": "A traveller from the coast.",
            "race_id": "human",
            "class_id": "WARRIOR",
            "traits": ["strong"],
            "clues": ["Blue coat"],
            "attributes": {"strength": 1},
        }
        body.update(changes)
        return body

    def _rejection(self, **changes) -> str:
        from src.characters.creates import CreateError, _validate_and_normalize

        with self.assertRaises(CreateError) as ctx:
            _validate_and_normalize("player-uuid", self._body(**changes), realm_id="main")
        return str(ctx.exception)

    def test_valid_body_passes(self) -> None:
        from src.characters.creates import _validate_and_normalize

        out = _validate_and_normalize("player-uuid", self._body(), realm_id="main")
        self.assertEqual(out["all_traits"], ["strong", "str1"])

    def test_rejections_match_the_plugin_rules(self) -> None:
        self.assertIn("letters, spaces, apostrophes", self._rejection(name="Ar1a"))
        self.assertEqual(self._rejection(age=111), "age must be between 18 and 110 for this race")
        self.assertEqual(self._rejection(clues=["Blue coat", "blue coat"]), "duplicate clue: blue coat")
        self.assertEqual(self._rejection(traits=["strong", "str1"]), "str1 cannot be picked at creation")
        self.assertEqual(
            self._rejection(traits=["strong", "honest", "mercenary"]),
            "mercenary is not available to this character",
        )

    def test_pending_creates_hold_slots(self) -> None:
        from src.characters.creates import create_character

        create_character("player-uuid", self._body(), realm_id="main")
        create_character("player-uuid", self._body(client_request_id="request-2", name="Bria"), realm_id="main")
        self.assertEqual(
            self._rejection(client_request_id="request-3", name="Cria"),
            "no free character slot",
        )


if __name__ == "__main__":
    unittest.main()
