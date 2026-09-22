"""Unit tests for src.text_validation (and create/submission wiring)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src.text_validation import (  # noqa: E402
    TextValidationError,
    assert_display_name,
    assert_optional_display_name,
    assert_prose,
)


class DisplayNameTests(unittest.TestCase):
    def test_ok_cases(self) -> None:
        cases = [
            ("José O'Brien", "José O'Brien"),
            ("Anne-Marie", "Anne-Marie"),
            ("  Iron   Sword  ", "Iron Sword"),
            ("skin_name.1", "skin_name.1"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(
                    assert_display_name(raw, min_len=1, max_len=80), expected
                )

    def test_bad_cases(self) -> None:
        for raw in (
            "Bob<script>",
            "evil§cName",
            "hi😀",
            "a/b",
            "x,y",
            "name{bad}",
            "a\\b",
            "",
            "   ",
        ):
            with self.subTest(raw=raw):
                with self.assertRaises(TextValidationError):
                    assert_display_name(raw, min_len=1, max_len=80)

    def test_length(self) -> None:
        with self.assertRaises(TextValidationError):
            assert_display_name("ab", min_len=3, max_len=24)
        with self.assertRaises(TextValidationError):
            assert_display_name("a" * 25, min_len=3, max_len=24)

    def test_optional(self) -> None:
        self.assertIsNone(assert_optional_display_name("", max_len=24))
        self.assertIsNone(assert_optional_display_name("  ", max_len=24))
        self.assertEqual(
            assert_optional_display_name("Other", max_len=24), "Other"
        )


class ProseTests(unittest.TestCase):
    def test_ok(self) -> None:
        text = assert_prose(
            "Golden hair by the harbour.",
            min_len=12,
            max_len=48,
            field="clue",
        )
        self.assertIn("Golden hair", text)

    def test_rejects_colour_and_emoji(self) -> None:
        with self.assertRaises(TextValidationError):
            assert_prose("hello §cworld enough!!", min_len=3, max_len=48)
        with self.assertRaises(TextValidationError):
            assert_prose("emoji 😀 pad pad pad", min_len=3, max_len=48)
        with self.assertRaises(TextValidationError):
            assert_prose("uses #FF00AA colour tok", min_len=3, max_len=48)

    def test_newlines(self) -> None:
        with self.assertRaises(TextValidationError):
            assert_prose("line1\nline2 enough text", min_len=3, max_len=80)
        out = assert_prose(
            "line1\nline2 enough text",
            min_len=3,
            max_len=80,
            allow_newlines=True,
        )
        self.assertIn("\n", out)


def _minimal_catalog() -> dict:
    return {
        "validation": {
            "name": {"min_length": 3, "max_length": 32},
            "age": {"minimum": 16},
            "description": {"min_length": 10, "max_length": 2000},
            "clues": {
                "min_length": 12,
                "max_length": 48,
                "max_clues": 5,
                "default_required": 0,
            },
        },
        "attribute_point_buy": {
            "attributes": ["str"],
            "cost_for_rank": [1, 2, 4, 8],
            "pool": 0,
            "max_rank": 4,
            "trait_id_pattern": "{abbr}{rank}",
        },
        "slot_limits": {"max_alive": 5},
        "races": [{"id": "human"}],
        "classes": [{"id": "warrior"}],
        "traits": [],
        "stages": [],
    }


class CreateValidationWireTests(unittest.TestCase):
    def setUp(self) -> None:
        from src.skins import db

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        paths = patch.multiple(
            db,
            DATA_DIR=root,
            DB_PATH=root / "province.db",
            SKINS_DIR=root / "skins",
            DRINKS_DIR=root / "drinks",
            WARDROBE_DIR=root / "wardrobe",
        )
        paths.start()
        self.addCleanup(paths.stop)
        db.migrate()

    def test_rejects_script_name(self) -> None:
        from src.characters.creates import CreateError, _validate_and_normalize

        body = {
            "name": "A<a>",
            "age": 20,
            "description": "A valid description here.",
            "gender": "",
            "race_id": "human",
            "class_id": "warrior",
            "traits": [],
            "clues": [],
            "attributes": {"str": 0},
        }
        with patch(
            "src.characters.creates.require_synced_creation_catalog",
            return_value=_minimal_catalog(),
        ), patch(
            "src.characters.creates.get_player_meta",
            return_value={"real_age_set": True, "eighteen": True},
        ), patch(
            "src.characters.creates.count_alive",
            return_value=0,
        ), patch(
            "src.characters.creates.get_max_alive",
            return_value=5,
        ):
            with self.assertRaises(CreateError) as ctx:
                _validate_and_normalize("player-uuid", body)
            self.assertIn("letters", str(ctx.exception).lower())

    def test_accepts_accented_name(self) -> None:
        from src.characters.creates import _validate_and_normalize

        body = {
            "name": "José O'Brien",
            "age": 20,
            "description": "A valid description here.",
            "gender": "Male",
            "race_id": "human",
            "class_id": "warrior",
            "traits": [],
            "clues": ["Golden hair by the harbour"],
            "attributes": {"str": 0},
        }
        with patch(
            "src.characters.creates.require_synced_creation_catalog",
            return_value=_minimal_catalog(),
        ), patch(
            "src.characters.creates.get_player_meta",
            return_value={"real_age_set": True, "eighteen": True},
        ), patch(
            "src.characters.creates.count_alive",
            return_value=0,
        ), patch(
            "src.characters.creates.get_max_alive",
            return_value=5,
        ):
            out = _validate_and_normalize("player-uuid", body)
            self.assertEqual(out["name"], "José O'Brien")

    def test_rejects_prosthetic_point_overspend(self) -> None:
        from src.characters.creates import CreateError, _validate_and_normalize

        catalog = _minimal_catalog()
        catalog["traits"] = [
            {"id": "arcane_prosthetic_arm", "key": "prosthetic", "cost": 1},
            {"id": "basic_prosthetic_arm", "key": "prosthetic", "cost": 1},
        ]
        catalog["stages"] = [
            {
                "id": "prosthetic_selection_stage",
                "type": "selection",
                "target": "trait",
                "key": "prosthetic",
                "min_select": 0,
                "max_select": 2,
                "points": 1,
            }
        ]
        body = {
            "name": "Test Hero",
            "age": 20,
            "description": "A valid description here.",
            "gender": "",
            "race_id": "human",
            "class_id": "warrior",
            "traits": ["arcane_prosthetic_arm", "basic_prosthetic_arm"],
            "clues": [],
            "attributes": {"str": 0},
        }
        with patch(
            "src.characters.creates.require_synced_creation_catalog",
            return_value=catalog,
        ), patch(
            "src.characters.creates.get_player_meta",
            return_value={"real_age_set": True, "eighteen": True},
        ), patch(
            "src.characters.creates.count_alive",
            return_value=0,
        ), patch(
            "src.characters.creates.get_max_alive",
            return_value=5,
        ):
            with self.assertRaises(CreateError) as ctx:
                _validate_and_normalize("player-uuid", body)
            self.assertIn("point budget", str(ctx.exception).lower())

    def test_strips_injury_replaced_by_prosthetic(self) -> None:
        from src.characters.creates import _validate_and_normalize

        catalog = _minimal_catalog()
        catalog["traits"] = [
            {"id": "one_handed", "key": "injury", "cost": 0},
            {
                "id": "wooden_claw_arm",
                "key": "prosthetic",
                "cost": 1,
                "replaces_injury": "one_handed",
            },
        ]
        catalog["stages"] = [
            {
                "id": "permanent_injury_selection_stage",
                "type": "selection",
                "target": "trait",
                "key": "injury",
                "min_select": 0,
                "max_select": 99,
            },
            {
                "id": "prosthetic_selection_stage",
                "type": "selection",
                "target": "trait",
                "key": "prosthetic",
                "min_select": 0,
                "max_select": 1,
                "points": 1,
            },
        ]
        body = {
            "name": "Test Hero",
            "age": 20,
            "description": "A valid description here.",
            "gender": "",
            "race_id": "human",
            "class_id": "warrior",
            "traits": ["one_handed", "wooden_claw_arm"],
            "clues": [],
            "attributes": {"str": 0},
        }
        with patch(
            "src.characters.creates.require_synced_creation_catalog",
            return_value=catalog,
        ), patch(
            "src.characters.creates.get_player_meta",
            return_value={"real_age_set": True, "eighteen": True},
        ), patch(
            "src.characters.creates.count_alive",
            return_value=0,
        ), patch(
            "src.characters.creates.get_max_alive",
            return_value=5,
        ):
            out = _validate_and_normalize("player-uuid", body)
            self.assertEqual(out["traits"], ["wooden_claw_arm"])
            self.assertEqual(out["all_traits"], ["wooden_claw_arm"])

    def test_strips_injury_replaced_by_prosthetic_mixed_case(self) -> None:
        from src.characters.creates import _strip_injuries_replaced_by_prosthetics

        traits_by_id = {
            "one_handed": {"id": "one_handed", "key": "injury", "cost": 0},
            "wooden_claw_arm": {
                "id": "wooden_claw_arm",
                "key": "prosthetic",
                "cost": 1,
                "replaces_injury": "One_Handed",
            },
        }
        kept = _strip_injuries_replaced_by_prosthetics(
            ["One_Handed", "wooden_claw_arm", "blind"],
            traits_by_id,
        )
        self.assertEqual(kept, ["wooden_claw_arm", "blind"])


class SubmissionDisplayNameWireTests(unittest.TestCase):
    def test_rejects_script_before_slugify(self) -> None:
        from src.skins.submissions import SubmissionError, create_submission

        session = type("S", (), {"player_uuid": "p", "code_id": None})()
        with self.assertRaises(SubmissionError) as ctx:
            create_submission(
                session,
                "handheld",
                "Bob<script>",
                {"texture": b"x", "model": b"y"},
                base_set="iron_sword",
            )
        msg = str(ctx.exception).lower()
        self.assertTrue(
            "letter" in msg or "contain" in msg or "name" in msg,
            msg=msg,
        )

    def test_rejects_name_over_24_characters(self) -> None:
        from src.skins.submissions import SubmissionError, create_submission

        session = type("S", (), {"player_uuid": "p", "code_id": None})()
        with self.assertRaises(SubmissionError) as ctx:
            create_submission(
                session,
                "handheld",
                "a" * 25,
                {"texture": b"x", "model": b"y"},
                base_set="iron_sword",
            )
        msg = str(ctx.exception).lower()
        self.assertIn("at most 24", msg)


if __name__ == "__main__":
    unittest.main()
