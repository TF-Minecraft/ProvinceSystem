"""Unit tests for bird_mail moderation outbox enqueue."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import pytest

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# Moderation notifications live in Postgres.
pytestmark = pytest.mark.usefixtures("postgres")


class BirdMailModerationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)

        import src.skins.db as db_mod

        self._db_mod = db_mod

        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.ensure_directories()

    def tearDown(self) -> None:
        self._db_mod.DRINKS_DIR = self._orig_drinks
        self._db_mod.DATA_DIR = self._orig_data
        self._db_mod.SKINS_DIR = self._orig_skins
        self._db_mod.WARDROBE_DIR = self._orig_wardrobe

        try:
            self.tmp.cleanup()
        except PermissionError:
            pass

    def test_enqueue_bird_mail_linked_and_unlinked(self) -> None:
        from src.skins.moderation import (
            ack_moderation,
            enqueue_bird_mail,
            list_undelivered_moderation,
        )

        uuid = "00000000-0000-4000-8000-000000000108"
        discord_id = "111222333444555666"

        unlinked = enqueue_bird_mail(
            player_uuid=uuid,
            addressee_character="Aria",
        )
        self.assertTrue(unlinked["ok"])
        self.assertFalse(unlinked["mirrored"])
        self.assertIsNone(unlinked["notification_id"])

        linked = enqueue_bird_mail(
            player_uuid=uuid,
            discord_user_id=discord_id,
            addressee_character="Aria",
            sender_minecraft_name="Sender",
            contents_preview="A short letter preview.",
        )
        self.assertTrue(linked["mirrored"])
        self.assertIsNotNone(linked["notification_id"])

        notices = list_undelivered_moderation()
        bird = [
            n
            for n in notices
            if n.get("type") == "bird_mail" and n.get("player_uuid") == uuid
        ]
        self.assertEqual(len(bird), 1)
        payload = bird[0]["payload"]
        self.assertEqual(payload.get("addressee_character"), "Aria")
        self.assertEqual(payload.get("sender_minecraft_name"), "Sender")
        self.assertIn("letter preview", payload.get("contents_preview", ""))

        ack = ack_moderation([bird[0]["id"]])
        self.assertIn(bird[0]["id"], ack["acked"])


if __name__ == "__main__":
    unittest.main()
