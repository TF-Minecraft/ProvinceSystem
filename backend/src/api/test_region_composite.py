"""Flattened region overlays for tiling."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from src.api import region_composite, tile_cache  # noqa: E402
from src.api.map_registry import clear_map_registry_cache  # noqa: E402
from src.api.tile_routes import tile_router  # noqa: E402
from src.scripts.util import dirs  # noqa: E402

TEST_REGISTRY = """
maps:
  - id: main
    public: true
    display_name: Adavaar
    realm_id: main
"""

RED = (200, 0, 0, 255)
BLUE = (0, 0, 200, 255)
GREEN = (0, 200, 0, 255)


class RegionCompositeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)

        registry = root / "maps.yml"
        registry.write_text(TEST_REGISTRY, encoding="utf-8")
        self._orig_registry = os.environ.get("MAP_REGISTRY_PATH")
        os.environ["MAP_REGISTRY_PATH"] = str(registry)
        clear_map_registry_cache()
        self.addCleanup(self._restore_registry)

        originals = {
            name: getattr(dirs, name) for name in ("INPUT_DIR", "DEFINES_DIR", "OUTPUT_DIR")
        }
        self.addCleanup(lambda: [setattr(dirs, k, v) for k, v in originals.items()])
        dirs.INPUT_DIR = str(root / "input")
        dirs.DEFINES_DIR = str(root / "defines")
        dirs.OUTPUT_DIR = str(root / "output")
        patch_tiles = patch.object(tile_cache, "_CACHE_DIR", root / "tiles")
        patch_comp = patch.object(region_composite, "_COMPOSITE_DIR", root / "composite")
        for patcher in (patch_tiles, patch_comp):
            patcher.start()
            self.addCleanup(patcher.stop)

        (root / "input" / "main").mkdir(parents=True)
        Image.new("RGB", (100, 100), (0, 0, 0)).save(root / "input" / "main" / "map.png")
        self.defines = root / "defines" / "main"
        self.defines.mkdir(parents=True)
        self.regions_dir = root / "output" / "main" / "regions" / "nation"
        self.regions_dir.mkdir(parents=True)

        # Three realms: two independent, one a subject of the first.
        for rgb, colour in (("1,1,1", RED), ("2,2,2", BLUE), ("3,3,3", GREEN)):
            Image.new("RGBA", (20, 20), colour).save(
                self.regions_dir / f"{rgb.replace(',', '_')}.png"
            )
        (self.regions_dir / "overlays.json").write_text(
            json.dumps(
                # The real sidecar shape: the box sits under "overlay".
                {
                    "1,1,1": {"overlay": {"x": 0, "y": 0, "w": 20, "h": 20}},
                    "2,2,2": {"overlay": {"x": 50, "y": 50, "w": 20, "h": 20}},
                    "3,3,3": {"overlay": {"x": 10, "y": 60, "w": 20, "h": 20}},
                }
            ),
            encoding="utf-8",
        )
        self._write_nations(balance=1)

    def _restore_registry(self) -> None:
        if self._orig_registry is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_registry
        clear_map_registry_cache()

    def _write_nations(self, balance: int, subject_free: bool = False) -> None:
        nations = {
            "A": {"rgb": "1,1,1", "provinces": [1], "balance": balance},
            "B": {"rgb": "2,2,2", "provinces": [2]},
            "C": {
                "rgb": "3,3,3",
                "provinces": [3],
                "overlord": None if subject_free else "A",
            },
            "Landless": {"rgb": "9,9,9", "provinces": []},
        }
        (self.defines / "nation.json").write_text(json.dumps(nations), encoding="utf-8")

    def test_only_default_visible_regions(self) -> None:
        visible = region_composite.default_visible_regions(
            "nation", json.loads((self.defines / "nation.json").read_text())
        )
        self.assertEqual(sorted(visible), ["1,1,1", "2,2,2"])

        # Off the realm map, a region needs no provinces to be drawn.
        self.assertIn(
            "9,9,9",
            region_composite.default_visible_regions(
                "county", {"x": {"rgb": "9,9,9", "provinces": []}}
            ),
        )

    def test_composite_places_overlays_and_skips_subjects(self) -> None:
        path = region_composite.build_composite("main", "nation")
        assert path is not None
        with Image.open(path) as image:
            self.assertEqual(image.size, (100, 100))
            self.assertEqual(image.getpixel((5, 5)), RED)
            self.assertEqual(image.getpixel((55, 55)), BLUE)
            # The subject's square is not drawn: transparent.
            self.assertEqual(image.getpixel((15, 65))[3], 0)

    def test_version_ignores_figures_but_not_visibility(self) -> None:
        first = region_composite.composite_version("main", "nation")
        self._write_nations(balance=999)
        self.assertEqual(region_composite.composite_version("main", "nation"), first)

        self._write_nations(balance=1, subject_free=True)
        self.assertNotEqual(region_composite.composite_version("main", "nation"), first)

    def test_rebuilds_only_when_version_changes(self) -> None:
        path = region_composite.ready_composite("main", "nation", background=False)
        assert path is not None
        mtime = path.stat().st_mtime_ns
        self._write_nations(balance=5)
        self.assertEqual(region_composite.ready_composite("main", "nation"), path)
        self.assertEqual(path.stat().st_mtime_ns, mtime)

    def test_no_inputs(self) -> None:
        self.assertFalse(region_composite.has_inputs("main", "duchy"))
        self.assertIsNone(region_composite.ready_composite("main", "duchy"))

    def test_routes(self) -> None:
        app = FastAPI()
        app.include_router(tile_router)
        client = TestClient(app)
        self.addCleanup(client.close)

        with patch.object(region_composite, "_build_in_background") as background:
            pending = client.get("/main/tiles/regions-nation/manifest")
        self.assertEqual(pending.status_code, 202)
        background.assert_called_once()

        region_composite.ready_composite("main", "nation", background=False)
        ready = client.get("/main/tiles/regions-nation/manifest")
        self.assertEqual(ready.status_code, 200)
        manifest = ready.json()
        tile = client.get(f"/main/tiles/regions-nation/{manifest['version']}/0/0/0.webp")
        self.assertEqual(tile.status_code, 200)

        self.assertEqual(client.get("/main/tiles/regions-duchy/manifest").status_code, 404)
        self.assertEqual(client.get("/main/tiles/regions-bogus/manifest").status_code, 404)

    def test_overlay_off_the_left_edge_is_clipped_not_shifted(self) -> None:
        # B's 20 px box now starts 5 px beyond the left edge, at y 40.
        boxes = json.loads((self.regions_dir / "overlays.json").read_text(encoding="utf-8"))
        boxes["2,2,2"]["overlay"] = {"x": -5, "y": 40, "w": 20, "h": 20}
        (self.regions_dir / "overlays.json").write_text(json.dumps(boxes), encoding="utf-8")
        composite = region_composite.build_composite("main", "nation")
        assert composite is not None
        with Image.open(composite) as image:
            self.assertEqual(image.getpixel((14, 45)), BLUE)  # B's right edge stays at x 14
            self.assertEqual(image.getpixel((15, 45))[3], 0)  # not shifted 5 px right

    def test_route_serves_the_last_composite_while_the_next_builds(self) -> None:
        app = FastAPI()
        app.include_router(tile_router)
        client = TestClient(app)
        self.addCleanup(client.close)

        region_composite.ready_composite("main", "nation", background=False)
        first = client.get("/main/tiles/regions-nation/manifest").json()

        # C gains its independence: a new picture to build.
        self._write_nations(balance=1, subject_free=True)
        with patch.object(region_composite, "_build_in_background") as background:
            stale = client.get("/main/tiles/regions-nation/manifest")
        self.assertEqual(stale.status_code, 200)
        self.assertEqual(stale.json()["version"], first["version"])
        background.assert_called_once()
        tile = client.get(f"/main/tiles/regions-nation/{first['version']}/0/0/0.webp")
        self.assertEqual(tile.status_code, 200)

    def test_regeneration_warm_up_queues_out_of_date_layers(self) -> None:
        from src.api import tile_warm

        maps = Path(dirs.OUTPUT_DIR) / "main" / "maps"
        maps.mkdir(parents=True)
        Image.new("RGB", (100, 100), (9, 9, 9)).save(maps / "prosperity_map.png")

        with patch.object(tile_cache, "_build_in_background") as rasters, patch.object(
            region_composite, "_build_in_background"
        ) as composites:
            tile_warm.warm_map_tiles("main")
        self.assertEqual(
            [call.args[0].name for call in rasters.call_args_list], ["map.png", "prosperity_map.png"]
        )
        composites.assert_called_once_with("main", "nation")
        self.assertEqual(rasters.call_args_list[0].kwargs, {})
        self.assertEqual(rasters.call_args_list[1].kwargs, {"warm_pick": True, "tiles": True})


if __name__ == "__main__":
    unittest.main()
