import os
import unittest

import numpy as np

from ..util.dirs import input_file
from .geometry_cache import MapGeometryCache
from .map_paint_numpy import paint_from_province_id_lut, paint_from_rgb_lut


class TestGeometryCache(unittest.TestCase):
    def _main_input_available(self) -> bool:
        return os.path.isfile(input_file("main", "provinces.png"))

    def test_load_main_shapes(self):
        if not self._main_input_available():
            self.skipTest("input/main/provinces.png not available")

        cache = MapGeometryCache.load("main")

        self.assertEqual(cache.provinces_rgba.shape, (cache.height, cache.width, 4))
        self.assertEqual(cache.province_id_map.shape, (cache.height, cache.width))
        self.assertEqual(cache.packed_rgb.shape, (cache.height, cache.width))
        self.assertEqual(cache.land_mask.shape, (cache.height, cache.width))
        self.assertEqual(cache.province_id_map.dtype, np.uint16)
        self.assertGreater(len(cache.rgb_to_id), 0)

    def test_province_id_map_matches_rgb_to_id(self):
        if not self._main_input_available():
            self.skipTest("input/main/provinces.png not available")

        cache = MapGeometryCache.load("main")
        rgb, province_id = next(iter(cache.rgb_to_id.items()))

        mask = (
            (cache.provinces_rgba[:, :, 0] == rgb[0])
            & (cache.provinces_rgba[:, :, 1] == rgb[1])
            & (cache.provinces_rgba[:, :, 2] == rgb[2])
        )
        self.assertTrue(mask.any())
        self.assertTrue(np.all(cache.province_id_map[mask] == province_id))

    def test_land_mask_excludes_water_if_present(self):
        if not self._main_input_available():
            self.skipTest("input/main/provinces.png not available")

        cache = MapGeometryCache.load("main")
        if not np.any(~cache.land_mask & (cache.province_id_map > 0)):
            self.skipTest("no sea/water provinces in map")

        self.assertTrue(np.any(cache.land_mask))

    def test_province_box_bounds_each_province(self):
        ids = np.zeros((6, 8), dtype=np.uint16)
        ids[1:3, 2:5] = 1
        ids[5, 7] = 2
        ids[0, 0] = 2
        cache = MapGeometryCache(
            width=8,
            height=6,
            provinces_rgba=np.zeros((6, 8, 4), dtype=np.uint8),
            packed_rgb=np.zeros((6, 8), dtype=np.uint32),
            province_id_map=ids,
            land_mask=np.zeros((6, 8), dtype=bool),
            rgb_to_id={},
        )
        self.assertEqual(cache.province_box(1), (2, 1, 5, 3))
        self.assertEqual(cache.province_box(2), (0, 0, 8, 6))
        self.assertIsNone(cache.province_box(3))

    def test_paint_from_province_id_lut_matches_rgb_lut(self):
        provinces = np.array(
            [
                [[10, 20, 30, 255], [40, 50, 60, 255]],
                [[70, 80, 90, 255], [0, 0, 0, 0]],
            ],
            dtype=np.uint8,
        )
        rgb_to_id = {
            (10, 20, 30): 1,
            (40, 50, 60): 2,
            (70, 80, 90): 3,
        }
        rgb_to_color = {
            (10, 20, 30): (100, 110, 120),
            (40, 50, 60): (0, 0, 0),
            (70, 80, 90): (200, 210, 220, 128),
        }

        packed = (
            (provinces[:, :, 0].astype(np.int32) << 16)
            | (provinces[:, :, 1].astype(np.int32) << 8)
            | provinces[:, :, 2].astype(np.int32)
        )
        id_lut = np.zeros(1 << 24, dtype=np.uint16)
        for rgb, province_id in rgb_to_id.items():
            key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
            id_lut[key] = province_id
        province_id_map = id_lut[packed]

        fast = paint_from_province_id_lut(
            province_id_map,
            rgb_to_id,
            rgb_to_color,
            skip_black=True,
        )
        slow = paint_from_rgb_lut(provinces, rgb_to_color, skip_black=True)
        np.testing.assert_array_equal(fast, slow)


if __name__ == "__main__":
    unittest.main()
