import unittest

import numpy as np
from PIL import Image

from .border_paint import (
    INK_DARK,
    apply_occupation_seam_dashes_array,
    occupation_seam_polylines,
    stamp_dashed_polylines,
    dilate_square,
    stroke_opaque_union_array,
)


def _reference_stroke(pixels, width, height, colour, thickness):
    edges = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] and any(
                not (0 <= nx < width and 0 <= ny < height) or not pixels[nx, ny][3]
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            ):
                edges.append((x, y))
    for x, y in edges:
        for ny in range(max(0, y - thickness), min(height, y + thickness + 1)):
            for nx in range(max(0, x - thickness), min(width, x + thickness + 1)):
                pixels[nx, ny] = colour


def _reference_dashes(source, targets, width, height, wash, grey, thickness, dash_off):
    seam = set()
    for y in range(height):
        for x in range(width):
            if source[x, y][3] and source[x, y][:3] == grey and any(
                0 <= nx < width and 0 <= ny < height
                and source[nx, ny][3] and source[nx, ny][:3] == wash
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            ):
                seam.add((x, y))
    paths = occupation_seam_polylines(seam)
    for target in targets:
        stamp_dashed_polylines(target, width, height, paths, thickness=thickness, dash_off=dash_off)


def _blobs(seed: int, width: int = 40, height: int = 30) -> np.ndarray:
    """Ragged two-tone shapes, some touching the edge, on transparency."""
    rng = np.random.default_rng(seed)
    img = np.zeros((height, width, 4), dtype=np.uint8)
    for _ in range(6):
        x, y = int(rng.integers(-3, width)), int(rng.integers(-3, height))
        w, h = int(rng.integers(1, 12)), int(rng.integers(1, 12))
        tone = (180, 80, 80) if rng.random() < 0.5 else (120, 70, 70)
        img[max(0, y) : y + h, max(0, x) : x + w] = (*tone, 255)
    img[rng.random((height, width)) < 0.05] = 0
    return img


class ArrayBorderTests(unittest.TestCase):
    """The array versions must give the per-pixel versions' exact pixels."""

    def test_stroke_matches_per_pixel(self):
        for seed in range(12):
            for thickness in (0, 1, 5):
                expected = Image.fromarray(_blobs(seed), mode="RGBA").copy()
                _reference_stroke(
                    expected.load(), *expected.size, INK_DARK, thickness
                )
                actual = _blobs(seed)
                stroke_opaque_union_array(actual, INK_DARK, thickness)
                np.testing.assert_array_equal(actual, np.array(expected))

    def test_seam_dashes_match_per_pixel(self):
        wash, grey = (180, 80, 80), (120, 70, 70)
        # Only some seeds put the two tones side by side; 40 gives several seams.
        for seed in range(40):
            for thickness, dash_off in ((0, 0), (1, 0), (1, 2)):
                expected = Image.fromarray(_blobs(seed), mode="RGBA").copy()
                hover = Image.fromarray(_blobs(seed), mode="RGBA").copy()
                _reference_dashes(
                    expected.load(),
                    [expected.load(), hover.load()],
                    *expected.size,
                    wash,
                    grey,
                    thickness=thickness,
                    dash_off=dash_off,
                )
                actual, actual_hover = _blobs(seed), _blobs(seed)
                apply_occupation_seam_dashes_array(
                    actual,
                    [actual, actual_hover],
                    wash,
                    grey,
                    thickness=thickness,
                    dash_off=dash_off,
                )
                np.testing.assert_array_equal(actual, np.array(expected))
                np.testing.assert_array_equal(actual_hover, np.array(hover))

    def test_dilate_square_clips_at_the_edge(self):
        mask = np.zeros((5, 6), dtype=bool)
        mask[0, 0] = True
        grown = dilate_square(mask, 2)
        self.assertTrue(grown[:3, :3].all())
        self.assertEqual(int(grown.sum()), 9)


if __name__ == "__main__":
    unittest.main()
