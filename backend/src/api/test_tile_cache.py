"""Tile pyramids and reduced overlay copies."""

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

from PIL import Image

from src.api import tile_cache


class MaxLevelTest(unittest.TestCase):
    def test_single_tile_image_is_level_zero(self) -> None:
        self.assertEqual(tile_cache.max_level_for(200, 100), 0)
        self.assertEqual(tile_cache.max_level_for(256, 256), 0)

    def test_doubles_per_level(self) -> None:
        self.assertEqual(tile_cache.max_level_for(257, 10), 1)
        self.assertEqual(tile_cache.max_level_for(512, 512), 1)
        # The live map: 6400 / 256 = 25 tiles across -> five halvings to one.
        self.assertEqual(tile_cache.max_level_for(6400, 6400), 5)


class PyramidTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        patcher = patch.object(tile_cache, "_CACHE_DIR", self.tmp / "tiles")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.source = self.tmp / "map.png"
        Image.new("RGB", (600, 300), (10, 120, 40)).save(self.source, "PNG")

    def test_builds_every_level_with_edge_tiles(self) -> None:
        manifest = tile_cache.build_pyramid(self.source)

        assert manifest is not None
        self.assertEqual(manifest["max_level"], 2)
        self.assertEqual(manifest["width"], 600)
        self.assertEqual(
            manifest["levels"],
            [
                {"width": 150, "height": 75},
                {"width": 300, "height": 150},
                {"width": 600, "height": 300},
            ],
        )
        version = manifest["version"]
        # Level 2 is full size: 3 x 2 tiles, the last column and row cropped.
        edge = tile_cache.tile_file(self.source, version, 2, 2, 1)
        assert edge is not None
        with Image.open(edge) as tile:
            self.assertEqual(tile.size, (600 - 512, 300 - 256))
        self.assertIsNone(tile_cache.tile_file(self.source, version, 2, 3, 0))
        self.assertIsNotNone(tile_cache.tile_file(self.source, version, 0, 0, 0))

    def test_keeps_transparency(self) -> None:
        Image.new("RGBA", (300, 300), (255, 0, 0, 0)).save(self.source, "PNG")
        manifest = tile_cache.build_pyramid(self.source)

        assert manifest is not None
        tile = tile_cache.tile_file(self.source, manifest["version"], 1, 0, 0)
        assert tile is not None
        with Image.open(tile) as image:
            self.assertIn("A", image.getbands())

    def test_not_ready_until_built_then_ready(self) -> None:
        with patch.object(tile_cache, "_build_in_background") as background:
            self.assertIsNone(tile_cache.ready_manifest(self.source))
            background.assert_called_once()

        built = tile_cache.ready_manifest(self.source, background=False)
        assert built is not None
        self.assertEqual(tile_cache.ready_manifest(self.source), built)

    def test_regenerated_source_invalidates_old_version(self) -> None:
        old = tile_cache.build_pyramid(self.source)
        assert old is not None

        Image.new("RGB", (600, 300), (200, 200, 0)).save(self.source, "PNG")
        stat = self.source.stat()
        os.utime(self.source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10_000_000))

        # The old version keeps serving its own pixels until the rebuild...
        self.assertIsNotNone(tile_cache.tile_file(self.source, old["version"], 0, 0, 0))
        self.assertIsNone(tile_cache.existing_manifest(self.source))
        new = tile_cache.build_pyramid(self.source)
        assert new is not None
        self.assertNotEqual(new["version"], old["version"])
        # ...and is gone once the new one replaces it.
        self.assertIsNone(tile_cache.tile_file(self.source, old["version"], 0, 0, 0))
        self.assertEqual(tile_cache.existing_manifest(self.source), new)
        siblings = [p.name for p in tile_cache.pyramid_dir(self.source, "x").parent.iterdir()]
        self.assertEqual(siblings, [new["version"]])

    def test_previous_version_serves_while_the_new_one_builds(self) -> None:
        old = tile_cache.build_pyramid(self.source)
        assert old is not None
        Image.new("RGB", (600, 300), (200, 200, 0)).save(self.source, "PNG")
        stat = self.source.stat()
        os.utime(self.source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10_000_000))

        with patch.object(tile_cache, "_build_in_background") as background:
            self.assertEqual(tile_cache.ready_manifest(self.source), old)
            background.assert_called_once()
        self.assertIsNotNone(tile_cache.tile_file(self.source, old["version"], 0, 0, 0))

    def test_manifest_is_written_last(self) -> None:
        manifest = tile_cache.build_pyramid(self.source)
        assert manifest is not None
        directory = tile_cache.pyramid_dir(self.source, manifest["version"])
        on_disk = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk, manifest)

    def test_missing_source(self) -> None:
        missing = self.tmp / "nope.png"
        self.assertIsNone(tile_cache.build_pyramid(missing))
        self.assertIsNone(tile_cache.ready_manifest(missing))
        self.assertIsNone(tile_cache.tile_file(missing, "1", 0, 0, 0))


class LodVariantTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        patcher = patch.object(tile_cache, "_LOD_DIR", self.tmp / "lod")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.source = self.tmp / "region.png"
        Image.new("RGBA", (400, 200), (0, 0, 255, 128)).save(self.source, "PNG")

    def test_lod_zero_is_the_original(self) -> None:
        self.assertEqual(tile_cache.lod_variant(self.source, 0), self.source)

    def test_reduces_by_powers_of_two_and_caches(self) -> None:
        first = tile_cache.lod_variant(self.source, 2)
        assert first is not None
        with Image.open(first) as image:
            self.assertEqual(image.size, (100, 50))
            self.assertIn("A", image.getbands())
        self.assertEqual(tile_cache.lod_variant(self.source, 2), first)

    def test_caps_at_max_lod(self) -> None:
        capped = tile_cache.lod_variant(self.source, 10)
        assert capped is not None
        with Image.open(capped) as image:
            self.assertEqual(image.size[0], 400 // 2**tile_cache.MAX_LOD)


if __name__ == "__main__":
    unittest.main()
