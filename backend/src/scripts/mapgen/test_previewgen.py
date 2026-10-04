import os
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from . import previewgen
from .previewgen import PREVIEW_FILENAME, PREVIEW_MAX_SIZE, create_map_preview, map_preview_path


class MapPreviewTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = self._tmp.name

        def input_file(map_name, filename):
            path = os.path.join(self.root, "input", map_name, filename)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            return path

        def map_image(map_name, mode):
            path = os.path.join(self.root, "output", map_name, "maps", f"{mode}_map.png")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            return path

        for name, value in (
            ("input_file", input_file),
            ("map_image", map_image),
        ):
            patcher = patch.object(previewgen, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.input_file = input_file
        self.map_image = map_image

    def test_preview_sits_next_to_the_generated_map_images(self):
        path = map_preview_path("testmap")
        self.assertEqual(os.path.basename(path), PREVIEW_FILENAME)
        self.assertEqual(
            os.path.dirname(path), os.path.dirname(self.map_image("testmap", "nation"))
        )

    def test_creates_downscaled_webp(self):
        source = self.input_file("testmap", "map.png")
        Image.new("RGB", (3200, 3200), (90, 120, 60)).save(source)

        out = create_map_preview("testmap")
        self.assertTrue(os.path.exists(out))

        with Image.open(out) as preview:
            self.assertEqual(preview.format, "WEBP")
            self.assertEqual(max(preview.size), PREVIEW_MAX_SIZE)
        self.assertLess(os.path.getsize(out), os.path.getsize(source))

    def test_non_square_map_keeps_aspect_ratio(self):
        Image.new("RGB", (1600, 800), (10, 20, 30)).save(
            self.input_file("testmap", "map.png")
        )
        with Image.open(create_map_preview("testmap")) as preview:
            self.assertEqual(preview.size, (PREVIEW_MAX_SIZE, PREVIEW_MAX_SIZE // 2))

    def test_missing_map_png_returns_none(self):
        self.assertIsNone(create_map_preview("testmap"))


if __name__ == "__main__":
    unittest.main()
