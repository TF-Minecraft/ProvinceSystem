import unittest

import numpy as np
from PIL import Image

from .border_paint import (
    INK_DARK,
    OCCUPATION_DASH_COLOR,
    OPAQUE_UNION_OWNER,
    apply_occupation_seam_dashes,
    apply_occupation_seam_dashes_array,
    apply_opaque_union_borders,
    apply_region_borders,
    border_color_for_fill,
    compute_border_owners,
    compute_occupation_seam_pixels,
    compute_opaque_union_borders,
    dilate_square,
    stroke_opaque_union_array,
)


class BorderPaintTests(unittest.TestCase):
    def test_border_color_dark_fill_returns_dark_ink(self):
        self.assertEqual(border_color_for_fill((30, 25, 20)), INK_DARK)

    def test_border_color_light_fill_returns_dark_ink(self):
        self.assertEqual(border_color_for_fill((220, 210, 190)), INK_DARK)

    def test_border_color_uniform_for_washed_fills(self):
        dark_rgb = (100, 100, 100)
        light_rgb = (160, 160, 160)
        self.assertEqual(border_color_for_fill(dark_rgb), INK_DARK)
        self.assertEqual(border_color_for_fill(light_rgb), INK_DARK)

    def test_apply_region_borders_no_soften(self):
        width, height = 8, 8
        region_color = (200, 100, 100)
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        pixels = img.load()
        for x in range(2, 6):
            for y in range(2, 6):
                pixels[x, y] = (*region_color, 255)

        border_owners = compute_border_owners(pixels, width, height, include_outer=True)
        before = {
            (x, y): pixels[x, y]
            for x in range(width)
            for y in range(height)
            if pixels[x, y][3] != 0
        }

        apply_region_borders(
            pixels,
            region_color,
            border_owners,
            width,
            height,
            INK_DARK,
            thickness=1,
            soften=False,
        )

        soften_pixels = [
            (x, y)
            for x in range(width)
            for y in range(height)
            if pixels[x, y] == (0, 0, 0, 128)
        ]
        self.assertEqual(soften_pixels, [])
        after = {(x, y): pixels[x, y] for x, y in before}
        self.assertNotEqual(before, after)

    def test_opaque_union_outlines_single_fill_vs_transparent(self):
        width, height = 8, 8
        fill = (200, 100, 100)
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        pixels = img.load()
        for x in range(2, 6):
            for y in range(2, 6):
                pixels[x, y] = (*fill, 255)

        owners = compute_opaque_union_borders(pixels, width, height)
        edge = (2, 2)
        interior = (3, 3)
        self.assertIn(OPAQUE_UNION_OWNER, owners.get(edge, set()))
        self.assertNotIn(interior, owners)

        apply_region_borders(
            pixels,
            OPAQUE_UNION_OWNER,
            owners,
            width,
            height,
            INK_DARK,
            thickness=0,
        )
        self.assertEqual(pixels[2, 2], INK_DARK)
        self.assertEqual(pixels[3, 3][:3], fill)

    def test_opaque_union_ignores_two_tone_seam(self):
        width, height = 8, 8
        wash = (180, 80, 80)
        grey = (120, 70, 70)
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        pixels = img.load()
        for x in range(2, 4):
            for y in range(2, 6):
                pixels[x, y] = (*wash, 255)
        for x in range(4, 6):
            for y in range(2, 6):
                pixels[x, y] = (*grey, 255)

        owners = compute_opaque_union_borders(pixels, width, height)
        seam_left = (3, 3)
        seam_right = (4, 3)
        self.assertNotIn(seam_left, owners)
        self.assertNotIn(seam_right, owners)
        self.assertIn(OPAQUE_UNION_OWNER, owners.get((2, 3), set()))
        self.assertIn(OPAQUE_UNION_OWNER, owners.get((5, 3), set()))

        apply_region_borders(
            pixels,
            OPAQUE_UNION_OWNER,
            owners,
            width,
            height,
            INK_DARK,
            thickness=0,
        )
        self.assertEqual(pixels[3, 3][:3], wash)
        self.assertEqual(pixels[4, 3][:3], grey)
        self.assertEqual(pixels[2, 3], INK_DARK)
        self.assertEqual(pixels[5, 3], INK_DARK)

    def _two_tone_strip(self, width, height, wash, grey):
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        pixels = img.load()
        mid = width // 2
        for y in range(height):
            for x in range(mid):
                pixels[x, y] = (*wash, 255)
            for x in range(mid, width):
                pixels[x, y] = (*grey, 255)
        return img, pixels, mid

    def test_occupation_seam_is_occ_side_only(self):
        wash = (180, 80, 80)
        grey = (120, 70, 70)
        _img, pixels, mid = self._two_tone_strip(8, 8, wash, grey)
        seam = compute_occupation_seam_pixels(pixels, 8, 8, wash, grey)
        self.assertTrue(seam)
        self.assertTrue(all(x == mid for x, _y in seam))
        self.assertNotIn((mid - 1, 3), seam)

    def test_occupation_seam_is_a_connected_line(self):
        wash = (180, 80, 80)
        grey = (120, 70, 70)
        width, height = 6, 40
        _img, pixels, mid = self._two_tone_strip(width, height, wash, grey)
        apply_occupation_seam_dashes(
            pixels,
            [pixels],
            width,
            height,
            wash,
            grey,
            thickness=0,
        )
        seam_red = [
            y for y in range(height) if pixels[mid, y] == OCCUPATION_DASH_COLOR
        ]
        self.assertEqual(len(seam_red), height)
        self.assertEqual(pixels[1, height // 2][:3], wash)
        self.assertEqual(pixels[width - 1, height // 2][:3], grey)

    def test_occupation_dash_skips_outer_vs_transparent(self):
        grey = (120, 70, 70)
        wash = (180, 80, 80)
        width, height = 8, 8
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        pixels = img.load()
        for x in range(2, 6):
            for y in range(2, 6):
                pixels[x, y] = (*grey, 255)
        apply_occupation_seam_dashes(
            pixels, [pixels], width, height, wash, grey, thickness=0
        )
        red = [
            (x, y)
            for x in range(width)
            for y in range(height)
            if pixels[x, y] == OCCUPATION_DASH_COLOR
        ]
        self.assertEqual(red, [])



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
                apply_opaque_union_borders(
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
                apply_occupation_seam_dashes(
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
