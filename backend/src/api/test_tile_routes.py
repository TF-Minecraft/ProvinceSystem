"""Tile manifest and tile routes, and reduced realm overlays."""

from __future__ import annotations

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

from src.api import file_routes, tile_cache  # noqa: E402
from src.api.file_routes import file_router  # noqa: E402
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


class TileRoutesTest(unittest.TestCase):
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

        self.input_dir = root / "input"
        (self.input_dir / "main").mkdir(parents=True)
        self.output_dir = root / "output"
        (self.output_dir / "main" / "maps").mkdir(parents=True)
        (self.output_dir / "main" / "regions" / "nation").mkdir(parents=True)

        self._orig_input = dirs.INPUT_DIR
        self._orig_output_base = file_routes.OUTPUT_BASE
        dirs.INPUT_DIR = str(self.input_dir)
        file_routes.OUTPUT_BASE = self.output_dir
        self.addCleanup(self._restore_dirs)

        for name, value in (("_CACHE_DIR", root / "tiles"), ("_LOD_DIR", root / "lod")):
            patcher = patch.object(tile_cache, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        Image.new("RGB", (600, 600), (30, 90, 30)).save(
            self.input_dir / "main" / "map.png", "PNG"
        )
        Image.new("RGBA", (300, 300), (200, 0, 0, 255)).save(
            self.output_dir / "main" / "maps" / "terrain_map.png", "PNG"
        )

        app = FastAPI()
        app.include_router(file_router)
        app.include_router(tile_router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def _restore_registry(self) -> None:
        if self._orig_registry is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_registry
        clear_map_registry_cache()

    def _restore_dirs(self) -> None:
        dirs.INPUT_DIR = self._orig_input
        file_routes.OUTPUT_BASE = self._orig_output_base

    def _manifest(self, layer: str) -> dict:
        with patch.object(tile_cache, "_build_in_background") as background:
            pending = self.client.get(f"/main/tiles/{layer}/manifest")
        self.assertEqual(pending.status_code, 202)
        self.assertEqual(pending.json(), {"ready": False})
        background.assert_called_once()

        source = (
            self.input_dir / "main" / "map.png"
            if layer == "base"
            else self.output_dir / "main" / "maps" / f"{layer[8:]}_map.png"
        )
        tile_cache.build_pyramid(source)
        ready = self.client.get(f"/main/tiles/{layer}/manifest")
        self.assertEqual(ready.status_code, 200)
        body = ready.json()
        self.assertTrue(body["ready"])
        return body

    def test_base_map_manifest_then_tiles(self) -> None:
        manifest = self._manifest("base")
        self.assertEqual(manifest["max_level"], 2)

        tile = self.client.get(f"/main/tiles/base/{manifest['version']}/2/1/1.webp")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.headers["content-type"], "image/webp")
        self.assertIn("immutable", tile.headers["cache-control"])
        self.assertTrue(tile.headers["cache-control"].startswith("public"))

    def test_mode_raster_tiles(self) -> None:
        manifest = self._manifest("mapdata-terrain")
        tile = self.client.get(
            f"/main/tiles/mapdata-terrain/{manifest['version']}/0/0/0.webp"
        )
        self.assertEqual(tile.status_code, 200)

    def test_stale_or_bad_tile_requests_are_404(self) -> None:
        manifest = self._manifest("base")
        version = manifest["version"]
        for path in (
            f"/main/tiles/base/1/0/0/0.webp",
            f"/main/tiles/base/{version}/9/0/0.webp",
            f"/main/tiles/base/{version}/0/5/5.webp",
            f"/main/tiles/nonsense/{version}/0/0/0.webp",
            f"/main/tiles/base/abc/0/0/0.webp",
        ):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_unknown_layer_manifest_is_404(self) -> None:
        self.assertEqual(self.client.get("/main/tiles/nonsense/manifest").status_code, 404)
        self.assertEqual(
            self.client.get("/main/tiles/mapdata-..%2Fx/manifest").status_code, 404
        )

    def test_region_overlay_lod(self) -> None:
        Image.new("RGBA", (400, 200), (0, 0, 255, 200)).save(
            self.output_dir / "main" / "regions" / "nation" / "1_2_3.png", "PNG"
        )
        full = self.client.get("/main/regions/nation/1_2_3")
        self.assertEqual(full.status_code, 200)

        reduced = self.client.get("/main/regions/nation/1_2_3?lod=2")
        self.assertEqual(reduced.status_code, 200)
        self.assertEqual(reduced.headers["content-type"], "image/webp")
        out = Path(self.tmp.name) / "reduced.webp"
        out.write_bytes(reduced.content)
        with Image.open(out) as image:
            self.assertEqual(image.size, (100, 50))

        self.assertEqual(self.client.get("/main/regions/nation/1_2_3?lod=9").status_code, 422)


if __name__ == "__main__":
    unittest.main()
