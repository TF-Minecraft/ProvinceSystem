import json
import unittest
from unittest.mock import mock_open, patch

from src.api import data_routes


class CompiledInfrastructureTests(unittest.TestCase):
    def test_copies_only_finite_infrastructure_values(self) -> None:
        province_data = [
            {
                "id": 1,
                "terrain_value": 0.4,
                "infrastructure": 12,
                "infrastructure_fill": 0.6,
                "effective_terrain": 0.61,
            },
            {
                "id": 2,
                "terrain_value": "0.4",
                "infrastructure": float("nan"),
                "infrastructure_fill": None,
                "effective_terrain": True,
            },
        ]
        with (
            patch.object(data_routes, "load_province_metadata", return_value={1: {"terrain": "bog"}, 2: {"terrain": "plains"}}),
            patch.object(data_routes, "load_infestation_by_id", return_value={}),
            patch.object(data_routes, "input_file", return_value="province_data.json"),
            patch("builtins.open", mock_open(read_data=json.dumps(province_data))),
        ):
            result = data_routes.build_compiled_provinces("main")

        self.assertEqual(
            {key: result[1][key] for key in ("terrain_value", "infrastructure", "infrastructure_fill", "effective_terrain")},
            {"terrain_value": 0.4, "infrastructure": 12, "infrastructure_fill": 0.6, "effective_terrain": 0.61},
        )
        for field in ("terrain_value", "infrastructure", "infrastructure_fill", "effective_terrain"):
            self.assertNotIn(field, result[2])


if __name__ == "__main__":
    unittest.main()
