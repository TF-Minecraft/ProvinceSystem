import unittest

import numpy as np

from .regiongen import RegionBuffer, _finalize_buffer_layer, _stage_on_window


class TestRegiongenNumpy(unittest.TestCase):
    def test_region_buffer_bbox_expansion(self):
        buf = RegionBuffer(with_nested=False)
        mask = np.zeros((8, 8), dtype=bool)
        mask[2:4, 1:3] = True
        buf.paint_flat(mask, (10, 20, 30), (40, 50, 60))

        self.assertEqual(buf.x0, 1)
        self.assertEqual(buf.y0, 2)
        self.assertEqual(buf.x1, 3)
        self.assertEqual(buf.y1, 4)
        self.assertEqual(tuple(buf.base[0, 0, :3]), (10, 20, 30))
        self.assertEqual(tuple(buf.hover[1, 1, :3]), (40, 50, 60))

        mask2 = np.zeros((8, 8), dtype=bool)
        mask2[5, 6] = True
        buf.paint_flat(mask2, (1, 2, 3), (4, 5, 6))

        self.assertEqual(buf.x0, 1)
        self.assertEqual(buf.y0, 2)
        self.assertEqual(buf.x1, 7)
        self.assertEqual(buf.y1, 6)
        self.assertEqual(tuple(buf.base[3, 5, :3]), (1, 2, 3))

    def test_region_buffer_nested_layers(self):
        buf = RegionBuffer(with_nested=True)
        mask = np.zeros((4, 4), dtype=bool)
        mask[1, 1] = True
        buf.paint_flat(mask, (100, 110, 120), (200, 210, 220), nested=True)

        self.assertIsNotNone(buf.nested)
        self.assertEqual(tuple(buf.nested[0, 0, :3]), (100, 110, 120))
        self.assertEqual(tuple(buf.nested_hover[0, 0, :3]), (200, 210, 220))

    def test_reference_paint_matches_region_buffer(self):
        height, width = 8, 8
        province_id_map = np.zeros((height, width), dtype=np.uint16)
        province_id_map[1:3, 2:5] = 1
        province_id_map[5, 6] = 2

        province_to_color = {
            (1, 0, 0): (10, 20, 30),
            (0, 1, 0): (40, 50, 60),
        }
        rgb_to_id = {
            (1, 0, 0): 1,
            (0, 1, 0): 2,
        }

        reference = np.zeros((height, width, 4), dtype=np.uint8)
        for prov_rgb, owner in province_to_color.items():
            pid = rgb_to_id[prov_rgb]
            mask = province_id_map == pid
            reference[mask] = (*owner, 255)

        buf = RegionBuffer(with_nested=False)
        for prov_rgb, owner in province_to_color.items():
            pid = rgb_to_id[prov_rgb]
            mask = province_id_map == pid
            buf.paint_flat(mask, owner, owner)

        canvas = np.zeros((height, width, 4), dtype=np.uint8)
        canvas[buf.y0 : buf.y1, buf.x0 : buf.x1] = buf.base

        np.testing.assert_array_equal(reference, canvas)

    def test_occupation_fill_paints_occupier_buffer(self):
        from ..util.display_colour import hover_rgb, occupation_display_rgb

        occupier = (200, 10, 10)
        fill = occupation_display_rgb(occupier)
        hover = hover_rgb(occupier)
        buf = RegionBuffer(with_nested=False)
        mask = np.zeros((4, 4), dtype=bool)
        mask[1, 1] = True
        buf.paint_flat(mask, fill, hover)
        self.assertEqual(tuple(buf.base[0, 0, :3]), fill)
        self.assertEqual(tuple(buf.hover[0, 0, :3]), hover)

    def test_finalize_buffer_layer_preserves_map_overlay(self):
        height, width = 100, 120
        buf = RegionBuffer(with_nested=False)
        mask = np.zeros((height, width), dtype=bool)
        mask[40:60, 30:50] = True
        buf.paint_flat(mask, (10, 20, 30), (40, 50, 60))

        window, origin = _stage_on_window(
            buf, (buf.x0, buf.y0, buf.x1, buf.y1), 3, height, width, "base"
        )
        _finalize_buffer_layer(
            buf,
            "base",
            window,
            origin=origin,
            store_overlay_meta=True,
        )

        self.assertIsNotNone(buf.overlay_meta)
        assert buf.overlay_meta is not None
        self.assertEqual(buf.overlay_meta["x"], 28)
        self.assertEqual(buf.overlay_meta["y"], 38)
        self.assertEqual(buf.overlay_meta["w"], 24)
        self.assertEqual(buf.overlay_meta["h"], 24)


if __name__ == "__main__":
    unittest.main()
