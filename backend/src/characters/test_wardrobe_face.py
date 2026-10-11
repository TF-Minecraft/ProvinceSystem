"""Profile's character faces come from the worn skin and never change the wardrobe."""

from __future__ import annotations

import gc
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

NOW = "2026-01-01T00:00:00Z"
PLAYER = "wardrobe-face-player"
CHAR_ID = "char-wardrobe-face"


def skin(face: tuple[int, int, int, int], hat: tuple[int, int, int, int] | None = None, height: int = 64) -> bytes:
    im = Image.new("RGBA", (64, height), (0, 0, 0, 0))
    im.paste(face, (8, 8, 16, 16))
    if hat:
        im.paste(hat, (40, 8, 42, 10))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def pixels(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


class SkinFaceTest(unittest.TestCase):
    def test_crops_the_face_under_the_hat_layer(self) -> None:
        from characters.wardrobe import skin_face_png

        face = pixels(skin_face_png(skin((200, 150, 100, 255), hat=(10, 20, 30, 255))))
        self.assertEqual(face.size, (8, 8))
        self.assertEqual(face.getpixel((0, 0)), (10, 20, 30, 255))
        self.assertEqual(face.getpixel((5, 5)), (200, 150, 100, 255))

    def test_reads_legacy_64x32_skins(self) -> None:
        from characters.wardrobe import skin_face_png

        face = pixels(skin_face_png(skin((1, 2, 3, 255), height=32)))
        self.assertEqual(face.getpixel((4, 4)), (1, 2, 3, 255))

    def test_blank_or_odd_skins_have_no_face(self) -> None:
        from characters.wardrobe import skin_face_png

        self.assertIsNone(skin_face_png(skin((0, 0, 0, 0))))
        self.assertIsNone(skin_face_png(b"not a png"))
        buf = io.BytesIO()
        Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(buf, format="PNG")
        self.assertIsNone(skin_face_png(buf.getvalue()))


HEAD = (200, 150, 100, 255)
BODY = (1, 2, 3, 255)
ARM = (4, 5, 6, 255)
LEG = (7, 8, 9, 255)


def body(slim_arms: bool = False) -> bytes:
    """A skin with each part's front filled; classic arms also fill the right arm's back."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    aw = 3 if slim_arms else 4
    im.paste(HEAD, (8, 8, 16, 16))
    im.paste(BODY, (20, 20, 28, 32))
    im.paste(ARM, (44, 20, 44 + aw, 32))
    if not slim_arms:
        im.paste(ARM, (52, 20, 56, 32))
    im.paste(ARM, (36, 52, 36 + aw, 64))
    im.paste(LEG, (4, 20, 8, 32))
    im.paste(LEG, (20, 52, 24, 64))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


class SkinFigureTest(unittest.TestCase):
    def test_lays_out_the_front_with_the_outer_layer_on_top(self) -> None:
        from characters.wardrobe import skin_figure_png

        png = body()
        im = Image.open(io.BytesIO(png))
        im.paste((10, 20, 30, 255), (40, 8, 42, 10))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        figure = pixels(skin_figure_png(buf.getvalue()))
        self.assertEqual(figure.size, (16, 32))
        self.assertEqual(figure.getpixel((4, 0)), (10, 20, 30, 255))
        self.assertEqual(figure.getpixel((8, 4)), HEAD)
        self.assertEqual(figure.getpixel((0, 8)), ARM)
        self.assertEqual(figure.getpixel((15, 19)), ARM)
        self.assertEqual(figure.getpixel((8, 12)), BODY)
        self.assertEqual(figure.getpixel((4, 31)), LEG)
        self.assertEqual(figure.getpixel((11, 20)), LEG)
        self.assertEqual(figure.getpixel((0, 0))[3], 0)

    def test_slim_arms_sit_against_the_body(self) -> None:
        from characters.wardrobe import skin_figure_png

        figure = pixels(skin_figure_png(body(slim_arms=True)))
        self.assertEqual(figure.getpixel((0, 8))[3], 0)
        self.assertEqual(figure.getpixel((1, 8)), ARM)
        self.assertEqual(figure.getpixel((14, 8)), ARM)
        self.assertEqual(figure.getpixel((15, 8))[3], 0)

    def test_the_saved_model_wins_over_detection(self) -> None:
        from characters.wardrobe import skin_figure_png

        figure = pixels(skin_figure_png(body(), "slim"))
        self.assertEqual(figure.getpixel((0, 8))[3], 0)
        figure = pixels(skin_figure_png(body(slim_arms=True), "classic"))
        self.assertEqual(figure.getpixel((15, 8))[3], 0)  # the empty fourth column shows
        self.assertEqual(figure.getpixel((12, 8)), ARM)

    def test_blank_heads_and_odd_sizes_have_no_figure(self) -> None:
        from characters.wardrobe import skin_figure_png

        self.assertIsNone(skin_figure_png(skin((0, 0, 0, 0))))
        self.assertIsNone(skin_figure_png(skin((1, 2, 3, 255), height=32)))
        self.assertIsNone(skin_figure_png(b"not a png"))


class ActiveFaceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.tmp.name)

        import skins.db as db_mod

        self._db_mod = db_mod
        sys.modules["src.skins.db"] = db_mod
        self._orig = {k: getattr(db_mod, k) for k in ("DB_PATH", "DATA_DIR", "DRINKS_DIR", "SKINS_DIR", "WARDROBE_DIR")}
        db_mod.DATA_DIR = self.root
        db_mod.DB_PATH = self.root / "province.db"
        db_mod.DRINKS_DIR = self.root / "drinks"
        db_mod.SKINS_DIR = self.root / "skins"
        db_mod.WARDROBE_DIR = self.root / "wardrobe"
        db_mod.migrate()

        import characters.wardrobe as wardrobe

        self.wardrobe = wardrobe
        self._patches = [
            mock.patch.object(wardrobe, "DATA_DIR", self.root),
            mock.patch.object(wardrobe, "WARDROBE_DIR", self.root / "wardrobe"),
            # One swappable slot: extra_1 is locked, as after a rank downgrade.
            mock.patch.object(wardrobe, "swappable_slot_count", return_value=1),
        ]
        for p in self._patches:
            p.start()

        with db_mod.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_roster (
                    player_uuid, realm_id, character_id, name, status, updated_at, wardrobe_active_slot
                ) VALUES (?, 'main', ?, 'Test', 'ALIVE', ?, 'extra_1')
                """,
                (PLAYER, CHAR_ID, NOW),
            )
            conn.commit()

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        for k, v in self._orig.items():
            setattr(self._db_mod, k, v)
        gc.collect()
        self.tmp.cleanup()

    def put_slot(self, slot: str, png: bytes) -> str:
        rel = f"wardrobe/{PLAYER}/{CHAR_ID}/{slot}.png"
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)
        with self._db_mod.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_wardrobe_slots (player_uuid, character_id, slot, png_relpath, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (PLAYER, CHAR_ID, slot, rel, NOW),
            )
            conn.commit()
        return rel

    def test_locked_active_slot_shows_base_and_keeps_the_wardrobe(self) -> None:
        self.put_slot("base", skin((1, 1, 1, 255)))
        extra = self.put_slot("extra_1", skin((2, 2, 2, 255)))

        face = self.wardrobe.active_face_png(PLAYER, CHAR_ID)

        self.assertEqual(pixels(face).getpixel((4, 4)), (1, 1, 1, 255))
        # Unlike get_wardrobe, nothing is enforced or saved.
        self.assertTrue((self.root / extra).is_file())
        with self._db_mod.connect() as conn:
            active = conn.execute(
                "SELECT wardrobe_active_slot FROM character_roster WHERE character_id = ?", (CHAR_ID,)
            ).fetchone()[0]
            slots = conn.execute(
                "SELECT COUNT(*) FROM character_wardrobe_slots WHERE character_id = ?", (CHAR_ID,)
            ).fetchone()[0]
        self.assertEqual(active, "extra_1")
        self.assertEqual(slots, 2)

    def test_unlocked_active_slot_is_the_face(self) -> None:
        self.put_slot("base", skin((1, 1, 1, 255)))
        self.put_slot("extra_1", skin((2, 2, 2, 255)))
        with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
            face = self.wardrobe.active_face_png(PLAYER, CHAR_ID)
        self.assertEqual(pixels(face).getpixel((4, 4)), (2, 2, 2, 255))

    def test_figure_is_the_worn_slot_with_its_saved_model(self) -> None:
        self.put_slot("base", body())
        self.put_slot("extra_1", skin((2, 2, 2, 255)))
        with self._db_mod.connect() as conn:
            conn.execute("UPDATE character_wardrobe_slots SET model = 'slim' WHERE slot = 'base'")
            conn.commit()
        # extra_1 is locked, so base is worn, with the slim arms it was saved with.
        figure = pixels(self.wardrobe.active_figure_png(PLAYER, CHAR_ID))
        self.assertEqual(figure.getpixel((6, 4)), HEAD)
        self.assertEqual(figure.getpixel((0, 8))[3], 0)
        self.assertEqual(figure.getpixel((1, 8)), ARM)

    def test_worn_skin_name_reads_without_enforcing(self) -> None:
        self.put_slot("base", skin((1, 1, 1, 255)))
        extra = self.put_slot("extra_1", skin((2, 2, 2, 255)))
        with self._db_mod.connect() as conn:
            conn.execute("UPDATE character_wardrobe_slots SET display_name = 'Ranger' WHERE slot = 'extra_1'")
            conn.commit()

        # extra_1 is locked: base is worn, and the locked skin is kept.
        self.assertEqual(self.wardrobe.worn_skin_name(PLAYER, CHAR_ID), "Base")
        self.assertTrue((self.root / extra).is_file())
        with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
            self.assertEqual(self.wardrobe.worn_skin_name(PLAYER, CHAR_ID), "Ranger")

    def test_no_skin_no_name(self) -> None:
        self.assertIsNone(self.wardrobe.worn_skin_name(PLAYER, CHAR_ID))

    def test_no_skin_no_face(self) -> None:
        self.assertIsNone(self.wardrobe.active_figure_png(PLAYER, CHAR_ID))
        self.assertIsNone(self.wardrobe.active_face_png(PLAYER, CHAR_ID))

    def test_other_players_characters_are_refused(self) -> None:
        with self.assertRaises(self.wardrobe.WardrobeError):
            self.wardrobe.active_face_png("someone-else", CHAR_ID)
        with self.assertRaises(self.wardrobe.WardrobeError):
            self.wardrobe.active_figure_png("someone-else", CHAR_ID)
        with self.assertRaises(self.wardrobe.WardrobeError):
            self.wardrobe.worn_skin_name("someone-else", CHAR_ID)


if __name__ == "__main__":
    unittest.main()
