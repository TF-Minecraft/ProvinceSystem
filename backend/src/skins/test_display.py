"""Unit tests for Java Block/Item model validation."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from src.skins.display import (  # noqa: E402
    BOUNDS_ERROR,
    ITEM_WRAPPER_ERROR,
    NO_ELEMENTS_ERROR,
    PROJECT_FILE_ERROR,
    ROTATION_ERROR,
    DisplayError,
    parse_and_merge_model,
    validate_java_block_model,
)


def _cube(
    from_v: list | None = None,
    to_v: list | None = None,
    rotation: dict | list | None = None,
) -> dict:
    el: dict = {
        "from": from_v if from_v is not None else [7.0, 0.0, 7.0],
        "to": to_v if to_v is not None else [9.0, 16.0, 9.0],
        "faces": {"north": {"uv": [0, 0, 2, 16], "texture": "#0"}},
    }
    if rotation is not None:
        el["rotation"] = rotation
    return el


def _valid_classic() -> dict:
    return {
        "format_version": "1.9.0",
        "credit": "Made with Blockbench",
        "textures": {"0": "tfmc_submissions:item/knife", "particle": "x"},
        "elements": [
            _cube(
                rotation={
                    "angle": 0,
                    "axis": "y",
                    "origin": [7, 8.5, 7],
                }
            )
        ],
    }


def _valid_modern() -> dict:
    return {
        "format_version": "1.21.11",
        "gui_light": "front",
        "groups": [{"name": "doctorscane", "origin": [8, 8, 8], "children": [0]}],
        "textures": {"0": "tfmc_submissions:item/staff"},
        "elements": [
            _cube(
                rotation={
                    "angle": 22.5,
                    "axis": "x",
                    "origin": [8, 8, 8],
                }
            )
        ],
        "display": {"gui": {"rotation": [30, 225, 0]}},
    }


def _dumps(model: dict) -> bytes:
    return (json.dumps(model) + "\n").encode("utf-8")


class ValidateJavaBlockModelTests(unittest.TestCase):
    def test_classic_knife_ok(self) -> None:
        validate_java_block_model(_valid_classic())

    def test_modern_with_groups_ok(self) -> None:
        validate_java_block_model(_valid_modern())

    def test_xyz_euler_rotation_rejected(self) -> None:
        model = _valid_modern()
        model["elements"].append(
            _cube(
                rotation={
                    "x": -75,
                    "y": -20,
                    "z": 15,
                    "origin": [7.6, 25.3, 2.1],
                }
            )
        )
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model(model)
        self.assertEqual(ROTATION_ERROR, str(ctx.exception))

    def test_rotation_array_rejected(self) -> None:
        model = _valid_classic()
        model["elements"][0]["rotation"] = [0, 45, 0]
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model(model)
        self.assertEqual(ROTATION_ERROR, str(ctx.exception))

    def test_empty_elements_rejected(self) -> None:
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model({"elements": []})
        self.assertEqual(NO_ELEMENTS_ERROR, str(ctx.exception))

    def test_missing_elements_rejected(self) -> None:
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model({"textures": {"0": "x"}})
        self.assertEqual(NO_ELEMENTS_ERROR, str(ctx.exception))

    def test_item_wrapper_rejected(self) -> None:
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model(
                {
                    "model": {
                        "type": "minecraft:model",
                        "model": "tfmc_submissions:item/staff",
                    }
                }
            )
        self.assertEqual(ITEM_WRAPPER_ERROR, str(ctx.exception))

    def test_bbmodel_meta_rejected(self) -> None:
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model(
                {"meta": {"format_version": "4.10"}, "elements": [_cube()]}
            )
        self.assertEqual(PROJECT_FILE_ERROR, str(ctx.exception))

    def test_bbmodel_textures_array_rejected(self) -> None:
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model(
                {
                    "textures": [{"name": "0", "source": "data:image/png"}],
                    "elements": [_cube()],
                }
            )
        self.assertEqual(PROJECT_FILE_ERROR, str(ctx.exception))

    def test_out_of_bounds_cube_rejected(self) -> None:
        model = _valid_classic()
        model["elements"][0]["from"] = [7, 40, 7]
        model["elements"][0]["to"] = [8, 41, 8]
        with self.assertRaises(DisplayError) as ctx:
            validate_java_block_model(model)
        self.assertEqual(BOUNDS_ERROR, str(ctx.exception))


class ParseAndMergeModelTests(unittest.TestCase):
    def test_valid_merges_display(self) -> None:
        out = parse_and_merge_model(_dumps(_valid_classic()), "item_3d")
        self.assertIn("thirdperson_righthand", out["display"])
        self.assertEqual(1, len(out["elements"]))

    def test_xyz_rotation_fails_before_write(self) -> None:
        model = _valid_classic()
        model["elements"][0]["rotation"] = {
            "x": -75,
            "y": -20,
            "z": 15,
            "origin": [8, 8, 8],
        }
        with self.assertRaises(DisplayError) as ctx:
            parse_and_merge_model(_dumps(model), "item_3d")
        self.assertEqual(ROTATION_ERROR, str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
