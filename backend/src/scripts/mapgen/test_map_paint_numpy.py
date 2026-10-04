import unittest

import numpy as np

from .map_paint_numpy import (
    pack_rgb,
    paint_from_rgb_lut,
)


def _paint_slow(
    provinces_rgba: np.ndarray,
    rgb_to_color: dict[tuple[int, int, int], tuple[int, ...]],
    *,
    skip_black: bool = True,
) -> np.ndarray:
    height, width = provinces_rgba.shape[:2]
    out = np.zeros((height, width, 4), dtype=np.uint8)

    for y in range(height):
        for x in range(width):
            rgb = tuple(int(v) for v in provinces_rgba[y, x, :3])
            color = rgb_to_color.get(rgb)
            if color is None:
                continue

            if len(color) == 4:
                rgba = tuple(int(v) for v in color)
            else:
                rgba = (int(color[0]), int(color[1]), int(color[2]), 255)

            if skip_black and rgba[:3] == (0, 0, 0):
                continue

            out[y, x] = rgba

    return out


class TestMapPaintNumpy(unittest.TestCase):
    def setUp(self):
        self.provinces = np.array(
            [
                [[10, 20, 30, 255], [40, 50, 60, 255], [0, 0, 0, 0], [70, 80, 90, 255]],
                [[10, 20, 30, 255], [40, 50, 60, 255], [0, 0, 0, 0], [70, 80, 90, 255]],
                [[10, 20, 30, 255], [40, 50, 60, 255], [0, 0, 0, 0], [70, 80, 90, 255]],
                [[10, 20, 30, 255], [40, 50, 60, 255], [0, 0, 0, 0], [70, 80, 90, 255]],
            ],
            dtype=np.uint8,
        )
        self.rgb_lut = {
            (10, 20, 30): (100, 110, 120),
            (40, 50, 60): (0, 0, 0),
            (70, 80, 90): (200, 210, 220, 128),
        }

    def test_pack_rgb_channel_positions(self):
        packed = pack_rgb(self.provinces[:, :, :3])
        self.assertEqual(int(packed[0, 0]), 0x0A141E)
        self.assertEqual(int(packed[0, 1]), 0x28323C)

    def test_paint_matches_slow_reference(self):
        fast = paint_from_rgb_lut(self.provinces, self.rgb_lut, skip_black=True)
        slow = _paint_slow(self.provinces, self.rgb_lut, skip_black=True)
        np.testing.assert_array_equal(fast, slow)

    def test_skip_black_sentinel(self):
        result = paint_from_rgb_lut(self.provinces, self.rgb_lut, skip_black=True)
        self.assertEqual(tuple(result[0, 1]), (0, 0, 0, 0))

    def test_rgba_values_keep_alpha(self):
        result = paint_from_rgb_lut(self.provinces, self.rgb_lut, skip_black=True)
        self.assertEqual(tuple(result[0, 3]), (200, 210, 220, 128))


if __name__ == "__main__":
    unittest.main()
