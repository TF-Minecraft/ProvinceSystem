from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from scripts.loader.markers import (  # noqa: E402
    build_campaign_line_points,
    build_markers_response,
    build_markers_response_from,
    build_province_name_index,
    enrich_war_capital,
    enrich_war_schedule_slots,
    enrich_settlements,
    enrich_wars,
    clear_province_centroid_cache,
    load_province_centroids,
    load_raw_markers,
    normalize_raw_markers,
    resolve_settlement_map_xy,
    world_coords_to_map_xy,
)


class MarkersLoaderTest(unittest.TestCase):
    def test_world_coords_to_map_xy_maps_block_xz_to_pixels(self) -> None:
        self.assertEqual(world_coords_to_map_xy(1748, 2739), (1748, 2739))
        self.assertIsNone(world_coords_to_map_xy(None, 1))
        self.assertIsNone(world_coords_to_map_xy("bad", 1))

    def test_enrich_prefers_world_coords_over_centroids(self) -> None:
        settlements = [
            {
                "id": "rivendell",
                "name": "Rivendell",
                "faction_id": "elves",
                "province_id": 42,
                "center_x": 1200,
                "center_z": -3400,
                "kind": "settlement",
                "provinces": [42, 43],
            }
        ]
        centroids = {
            "42": {"x": 3233.45, "y": 1961.12, "pixel_count": 100},
        }

        out = enrich_settlements(settlements, centroids)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["map_x"], 1200)
        self.assertEqual(out[0]["map_y"], -3400)
        self.assertEqual(out[0]["center_x"], 1200)
        self.assertEqual(out[0]["provinces"], [42, 43])

    def test_enrich_falls_back_to_centroid_without_world_coords(self) -> None:
        settlements = [{"id": "ghost", "province_id": 42, "kind": "settlement"}]
        centroids = {"42": {"x": 3233.45, "y": 1961.12}}
        out = enrich_settlements(settlements, centroids)
        self.assertEqual(out[0]["map_x"], 3233)
        self.assertEqual(out[0]["map_y"], 1961)

    def test_enrich_missing_centroid_omits_map_coords(self) -> None:
        settlements = [{"id": "ghost", "province_id": 99, "kind": "settlement"}]
        out = enrich_settlements(settlements, {})
        self.assertNotIn("map_x", out[0])
        self.assertNotIn("map_y", out[0])

    def test_enrich_skips_invalid_entries(self) -> None:
        out = enrich_settlements(["bad", {"province_id": 1}], {"1": {"x": 1, "y": 2}})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["map_x"], 1)

    def test_resolve_settlement_map_xy_prefers_world_coords(self) -> None:
        row = {"center_x": 5, "center_z": 6, "province_id": 1}
        centroids = {"1": {"x": 100, "y": 200}}
        self.assertEqual(resolve_settlement_map_xy(row, centroids), (5, 6))

    def test_load_raw_markers_missing_file_returns_empty_settlements(self) -> None:
        with mock.patch(
            "scripts.loader.markers.input_file",
            return_value=os.path.join(tempfile.gettempdir(), "missing_map_markers.json"),
        ):
            payload = load_raw_markers("main")

        self.assertEqual(payload["map_id"], "main")
        self.assertEqual(payload["settlements"], [])
        self.assertEqual(payload["installations"], [])
        self.assertEqual(payload["forts"], [])
        self.assertEqual(payload["wars"], [])
        self.assertIsNone(payload["exported_at"])

    def test_build_markers_response_enriches_from_fixture_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","exported_at":"2026-08-15T20:00:00Z",'
                    '"settlements":[{"id":"a","province_id":1,"kind":"settlement"}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"1":{"x":10.4,"y":20.6}}')

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        self.assertEqual(payload["map_id"], "main")
        self.assertEqual(len(payload["settlements"]), 1)
        self.assertEqual(payload["settlements"][0]["map_x"], 10)
        self.assertEqual(payload["settlements"][0]["map_y"], 21)

    def test_load_raw_markers_passes_through_population_and_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","settlement_large_population_threshold":8,'
                    '"settlements":[{"id":"a","population":12,"marker_size":"large"}]}'
                )
            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ):
                payload = load_raw_markers("main")

        self.assertEqual(payload["settlement_large_population_threshold"], 8)
        self.assertEqual(payload["settlements"][0]["population"], 12)
        self.assertEqual(payload["settlements"][0]["marker_size"], "large")

    def test_build_markers_response_preserves_marker_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","settlement_large_population_threshold":8,'
                    '"settlements":[{"id":"a","province_id":1,"population":9,'
                    '"marker_size":"large","kind":"faction_capital"}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"1":{"x":10,"y":20}}')

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        self.assertEqual(payload["settlement_large_population_threshold"], 8)
        settlement = payload["settlements"][0]
        self.assertEqual(settlement["population"], 9)
        self.assertEqual(settlement["marker_size"], "large")
        self.assertEqual(settlement["kind"], "faction_capital")
        self.assertEqual(settlement["map_x"], 10)
        self.assertEqual(settlement["map_y"], 20)

    def test_load_raw_markers_passes_through_installations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","installations":['
                    '{"id":"lanhold","name":"Lanhold","kind":"train_station","province_id":705,'
                    '"faction_id":"Lantan","center_x":1748,"center_z":2739}]}'
                )
            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ):
                payload = load_raw_markers("main")

        self.assertEqual(len(payload["installations"]), 1)
        self.assertEqual(payload["installations"][0]["kind"], "train_station")

    def test_retired_marker_keys_are_ignored(self) -> None:
        # Older exports still carry supply-hub links and trade routes. They
        # must load, and they must not come back out.
        retired = {
            "hub_links": [{"from": {"province_id": 1}, "to": {"province_id": 2}}],
            "trade_networks": {"name": "nope"},
            "trade_edges": "sea",
        }
        normalized = normalize_raw_markers(
            {"installations": [], **retired},
            "main",
        )
        for key in retired:
            self.assertNotIn(key, normalized)

        payload = build_markers_response_from(
            {
                "map_id": "main",
                "exported_at": None,
                "settlements": [],
                "installations": [
                    {
                        "id": "lanhold",
                        "name": "Lanhold",
                        "kind": "port",
                        "province_id": 1,
                    }
                ],
                "forts": [],
                "wars": [],
                **retired,
            },
            {"1": {"x": 10, "y": 20}},
            {},
            "main",
        )
        for key in retired:
            self.assertNotIn(key, payload)
        self.assertEqual(payload["installations"][0]["kind"], "port")
        self.assertEqual(payload["installations"][0]["map_x"], 10)

    def test_installation_hub_fields_are_ignored(self) -> None:
        raw = {
            "map_id": "main",
            "exported_at": None,
            "settlements": [],
            "installations": [
                {
                    "id": "lanhold",
                    "name": "Lanhold",
                    "kind": "port",
                    "province_id": 1,
                    "hub_slots": 2,
                    "hubs": 1,
                }
            ],
            "forts": [],
            "wars": [],
        }
        normalized = normalize_raw_markers(raw, "main")
        self.assertEqual(normalized["installations"][0]["name"], "Lanhold")
        self.assertNotIn("hub_slots", normalized["installations"][0])
        self.assertNotIn("hubs", normalized["installations"][0])

        payload = build_markers_response_from(
            raw,
            {"1": {"x": 10.4, "y": 20.6}},
            {},
            "main",
        )
        row = payload["installations"][0]
        self.assertEqual(row["kind"], "port")
        self.assertEqual((row["map_x"], row["map_y"]), (10, 21))
        self.assertNotIn("hub_slots", row)
        self.assertNotIn("hubs", row)

    def test_build_markers_response_enriches_installations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","settlements":[],"installations":['
                    '{"id":"lanhold","name":"Lanhold","kind":"fort","province_id":705,'
                    '"faction_id":"Lantan","center_x":1748,"center_z":2739}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"705":{"x":100,"y":200}}')

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        installation = payload["installations"][0]
        self.assertEqual(installation["map_x"], 1748)
        self.assertEqual(installation["map_y"], 2739)

    def test_build_markers_response_installation_centroid_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","installations":['
                    '{"id":"harbor","name":"Harbor","kind":"port","province_id":42}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"42":{"x":50.4,"y":60.6}}')

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        installation = payload["installations"][0]
        self.assertEqual(installation["map_x"], 50)
        self.assertEqual(installation["map_y"], 61)

    def test_build_markers_response_installation_missing_centroid_omits_map_coords(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","installations":['
                    '{"id":"ghost","name":"Ghost","kind":"airport","province_id":99}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write("{}")

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        installation = payload["installations"][0]
        self.assertNotIn("map_x", installation)
        self.assertNotIn("map_y", installation)

    def test_load_raw_markers_passes_through_forts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","forts":['
                    '{"id":"lanhold","name":"Lanhold","province_id":705,'
                    '"faction_id":"Lantan","center_x":1748,"center_z":2739,'
                    '"zoc_provinces":[705,706]}]}'
                )
            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ):
                payload = load_raw_markers("main")

        self.assertEqual(len(payload["forts"]), 1)
        self.assertEqual(payload["forts"][0]["zoc_provinces"], [705, 706])

    def test_build_markers_response_enriches_forts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            overlays_path = os.path.join(tmp, "zoc_overlays.json")
            zoc_png = os.path.join(tmp, "lanhold.png")
            Image.new("RGBA", (4, 4), (0, 0, 0, 0)).save(zoc_png)

            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","forts":['
                    '{"id":"lanhold","province_id":705,"center_x":1748,"center_z":2739,'
                    '"zoc_provinces":[705]}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"705":{"x":100,"y":200}}')
            with open(overlays_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"lanhold":{"overlay":{"x":10,"y":20,"w":30,"h":40}}}'
                )

            def fake_defines_file(map_name: str, filename: str) -> str:
                if filename == "province_centroids.json":
                    return centroids_path
                raise FileNotFoundError(filename)

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                side_effect=fake_defines_file,
            ), mock.patch(
                "scripts.loader.markers.zoc_overlays_file",
                return_value=overlays_path,
            ), mock.patch(
                "scripts.loader.markers.zoc_image",
                return_value=zoc_png,
            ):
                payload = build_markers_response("main")

        fort = payload["forts"][0]
        self.assertEqual(fort["map_x"], 1748)
        self.assertEqual(fort["map_y"], 2739)
        self.assertEqual(fort["overlay"], {"x": 10, "y": 20, "w": 30, "h": 40})
        self.assertEqual(fort["zoc_url"], "/main/zoc/lanhold.png")

    def test_build_markers_response_fort_centroid_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","forts":['
                    '{"id":"keep","province_id":42,"zoc_provinces":[42]}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"42":{"x":50.4,"y":60.6}}')

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        fort = payload["forts"][0]
        self.assertEqual(fort["map_x"], 50)
        self.assertEqual(fort["map_y"], 61)
        self.assertNotIn("zoc_url", fort)

    def test_load_raw_markers_passes_through_wars(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","wars":[{"id":"1","campaign_provinces":[5,10]}]}'
                )
            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ):
                payload = load_raw_markers("main")

        self.assertEqual(len(payload["wars"]), 1)
        self.assertEqual(payload["wars"][0]["id"], "1")

    def test_enrich_war_schedule_adds_map_coords_and_province_name(self) -> None:
        centroids = {"20": {"x": 300.4, "y": 400.6}}
        name_index = build_province_name_index(
            [{"province_id": 20, "name": "Border Hold"}],
            [],
        )
        slots = [
            {
                "schedule_index": 0,
                "leg": "invasion",
                "province_id": 20,
                "kind": "field",
                "kind_label": "Field Battle",
                "status": "next",
            }
        ]

        out = enrich_war_schedule_slots(slots, centroids, name_index)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["map_x"], 300)
        self.assertEqual(out[0]["map_y"], 401)
        self.assertEqual(out[0]["province_name"], "Border Hold")

    def test_enrich_war_schedule_omits_slot_without_centroid(self) -> None:
        slots = [{"province_id": 99, "kind": "field", "status": "next"}]
        out = enrich_war_schedule_slots(slots, {}, {})
        self.assertEqual(out, [])

    def test_enrich_war_schedule_siege_uses_fort_installation_coords(self) -> None:
        centroids = {
            "705": {"x": 100.0, "y": 200.0},
            "713": {"x": 1.0, "y": 2.0},
        }
        installations = [
            {
                "id": "Greenfort",
                "name": "Greenfort",
                "kind": "fort",
                "province_id": 713,
                "center_x": 1565,
                "center_z": 2466,
            }
        ]
        slots = [
            {
                "schedule_index": 1,
                "leg": "invasion",
                "province_id": 705,
                "kind": "siege",
                "kind_label": "Siege",
                "status": "upcoming",
                "fort_installation_id": "Greenfort",
            }
        ]

        out = enrich_war_schedule_slots(slots, centroids, {}, installations)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["map_x"], 1565)
        self.assertEqual(out[0]["map_y"], 2466)

    def test_enrich_war_schedule_passes_through_display_name(self) -> None:
        centroids = {"20": {"x": 300.4, "y": 400.6}}
        slots = [
            {
                "schedule_index": 0,
                "leg": "invasion",
                "province_id": 20,
                "kind": "siege",
                "kind_label": "Siege",
                "status": "next",
                "display_name": "Siege of Greenfort",
            }
        ]

        out = enrich_war_schedule_slots(slots, centroids, {}, [])

        self.assertEqual(out[0]["display_name"], "Siege of Greenfort")

    def test_enrich_war_capital_prefers_world_coords(self) -> None:
        capital = enrich_war_capital(
            {"province_id": 5, "center_x": 100, "center_z": 200},
            {"5": {"x": 1, "y": 2}},
        )
        assert capital is not None
        self.assertEqual(capital["map_x"], 100)
        self.assertEqual(capital["map_y"], 200)

    def test_build_campaign_line_points_uses_capital_coords(self) -> None:
        war = {
            "campaign_provinces": [5, 10],
            "attacker_capital": {
                "province_id": 5,
                "center_x": 100,
                "center_z": 200,
            },
        }
        centroids = {
            "5": {"x": 1, "y": 2},
            "10": {"x": 50.4, "y": 60.6},
        }

        points = build_campaign_line_points(war, centroids)

        self.assertEqual(len(points), 2)
        self.assertEqual(points[0]["province_id"], 5)
        self.assertEqual(points[0]["map_x"], 100)
        self.assertEqual(points[0]["map_y"], 200)
        self.assertEqual(points[1]["map_x"], 50)
        self.assertEqual(points[1]["map_y"], 61)

    def test_enrich_war_schedule_field_uses_settlement_coords(self) -> None:
        centroids = {"20": {"x": 300.4, "y": 400.6}}
        settlements = [
            {
                "province_id": 20,
                "name": "Rivendell",
                "center_x": 1200,
                "center_z": 3400,
            }
        ]
        slots = [
            {
                "schedule_index": 0,
                "leg": "invasion",
                "province_id": 20,
                "kind": "field",
                "kind_label": "Field Battle",
                "status": "next",
            }
        ]

        out = enrich_war_schedule_slots(slots, centroids, {}, None, settlements)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["map_x"], 1200)
        self.assertEqual(out[0]["map_y"], 3400)

    def test_build_campaign_line_points_uses_slot_coords(self) -> None:
        war = {
            "campaign_provinces": [5, 20],
            "campaign_battle_schedule": [
                {
                    "province_id": 20,
                    "status": "next",
                    "map_x": 210,
                    "map_y": 160,
                }
            ],
        }
        centroids = {
            "5": {"x": 1, "y": 2},
            "20": {"x": 300.4, "y": 400.6},
        }

        points = build_campaign_line_points(war, centroids)

        self.assertEqual(len(points), 2)
        self.assertEqual(points[0]["map_x"], 1)
        self.assertEqual(points[1]["map_x"], 210)
        self.assertEqual(points[1]["map_y"], 160)

    def test_build_markers_response_includes_enriched_wars(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            markers_path = os.path.join(tmp, "map_markers.json")
            centroids_path = os.path.join(tmp, "province_centroids.json")
            with open(markers_path, "w", encoding="utf-8") as f:
                f.write(
                    '{"map_id":"main","settlements":[{"province_id":20,"name":"Border Hold"}],'
                    '"wars":[{"id":"1","campaign_provinces":[5,20],'
                    '"campaign_battle_schedule":[{"schedule_index":0,"leg":"invasion",'
                    '"province_id":20,"kind":"field","kind_label":"Field Battle","status":"next"}],'
                    '"attacker_capital":{"province_id":5,"center_x":100,"center_z":200}}]}'
                )
            with open(centroids_path, "w", encoding="utf-8") as f:
                f.write('{"5":{"x":1,"y":2},"20":{"x":300.4,"y":400.6}}')

            with mock.patch(
                "scripts.loader.markers.input_file",
                return_value=markers_path,
            ), mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=centroids_path,
            ):
                payload = build_markers_response("main")

        self.assertIn("wars", payload)
        self.assertEqual(len(payload["wars"]), 1)
        war = payload["wars"][0]
        slot = war["campaign_battle_schedule"][0]
        self.assertEqual(slot["map_x"], 300)
        self.assertEqual(slot["province_name"], "Border Hold")
        self.assertEqual(war["attacker_capital"]["map_x"], 100)
        self.assertEqual(len(war["campaign_line_points"]), 2)
        self.assertEqual(war["campaign_line_points"][0]["map_x"], 100)

    def test_enrich_wars_skips_invalid_entries(self) -> None:
        centroids = {"1": {"x": 10, "y": 20}}
        out = enrich_wars(["bad", {"id": "1", "campaign_provinces": [1]}], centroids, {})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], "1")

    def test_non_finite_coords_are_dropped_not_raised(self) -> None:
        """round(float('inf')) raises OverflowError, which is not a ValueError.

        Python's json parses the bare Infinity/NaN literals, so a bad coordinate
        from the game plugin reaches _finite_int as a real float."""
        self.assertIsNone(world_coords_to_map_xy(float("inf"), 1))
        self.assertIsNone(world_coords_to_map_xy(1, float("-inf")))
        self.assertIsNone(world_coords_to_map_xy(float("nan"), 1))
        self.assertIsNone(world_coords_to_map_xy("Infinity", 1))
        # An int too large to become a float overflows in float() itself.
        self.assertIsNone(world_coords_to_map_xy(10**400, 1))
        self.assertEqual(world_coords_to_map_xy(1.6, -2.4), (2, -2))

    def test_enrich_settlements_drops_non_finite_coords(self) -> None:
        out = enrich_settlements(
            [{"id": "s1", "center_x": float("inf"), "center_z": 5}], {}
        )
        self.assertNotIn("map_x", out[0])

    def test_build_markers_response_from_validates_the_map_name(self) -> None:
        """The only guard used to sit in load_raw_markers; the extracted builder
        still turns map_name into a filesystem path and a response URL."""
        raw = {
            "map_id": "main",
            "exported_at": None,
            "settlements": [],
            "installations": [],
            "forts": [],
            "wars": [],
        }
        with self.assertRaises(ValueError):
            build_markers_response_from(raw, {}, {}, "../etc")


class ProvinceCentroidCacheTest(unittest.TestCase):
    """province_centroids.json is ~80 KB of static geometry.

    Every markers build re-read and re-parsed it, so a timelapse paid for one
    parse per day of identical bytes. The cache is only correct if a regenerated
    file is still picked up, hence the invalidation half of each test.
    """

    def setUp(self) -> None:
        clear_province_centroid_cache()
        self.addCleanup(clear_province_centroid_cache)

    def test_second_load_reuses_the_parse(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "province_centroids.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write('{"705":{"x":100,"y":200}}')

            with mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=path,
            ):
                first = load_province_centroids("main")
                with mock.patch(
                    "scripts.loader.markers.json.load",
                    side_effect=AssertionError("centroids re-parsed"),
                ):
                    second = load_province_centroids("main")

        self.assertEqual(first, {"705": {"x": 100, "y": 200}})
        self.assertIs(second, first)

    def test_a_regenerated_file_invalidates_the_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "province_centroids.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write('{"705":{"x":100,"y":200}}')

            with mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=path,
            ):
                first = load_province_centroids("main")
                # A rebuild changes the size, which the mtime+size check sees
                # even where the clock granularity would hide the write.
                with open(path, "w", encoding="utf-8") as f:
                    f.write('{"705":{"x":1,"y":2},"706":{"x":3,"y":4}}')
                second = load_province_centroids("main")

        self.assertEqual(first, {"705": {"x": 100, "y": 200}})
        self.assertEqual(
            second, {"705": {"x": 1, "y": 2}, "706": {"x": 3, "y": 4}}
        )

    def test_a_missing_file_is_empty_and_caches_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "province_centroids.json")

            with mock.patch(
                "scripts.loader.markers.defines_file",
                return_value=path,
            ):
                self.assertEqual(load_province_centroids("main"), {})
                # The first build after this must be picked up, not pinned to {}.
                with open(path, "w", encoding="utf-8") as f:
                    f.write('{"705":{"x":100,"y":200}}')
                self.assertEqual(
                    load_province_centroids("main"), {"705": {"x": 100, "y": 200}}
                )


if __name__ == "__main__":
    unittest.main()
