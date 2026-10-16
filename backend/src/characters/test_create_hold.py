"""Creates held back from RPCharacters while their wardrobe skins upload."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.usefixtures("postgres")

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

PLAYER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"


class CreateHoldTests(unittest.TestCase):
    def setUp(self) -> None:
        from src.skins import db

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.db_path = root / "province.db"
        paths = patch.multiple(
            db,
            DATA_DIR=root,
            DB_PATH=self.db_path,
            SKINS_DIR=root / "skins",
            DRINKS_DIR=root / "drinks",
            WARDROBE_DIR=root / "wardrobe",
        )
        paths.start()
        self.addCleanup(paths.stop)
        db.migrate()
        validated = patch(
            "src.characters.creates._validate_and_normalize",
            side_effect=lambda uuid, body, realm_id=None: {"name": body["name"]},
        )
        validated.start()
        self.addCleanup(validated.stop)

    def _create(self, name: str, **extra) -> str:
        from src.characters.creates import create_character

        return create_character(PLAYER, {"name": name, **extra}, realm_id="main")["id"]

    def _pending_names(self) -> list[str]:
        from src.characters.creates import list_pending

        return [row["payload"]["name"] for row in list_pending("main")]

    def test_held_create_waits_until_released(self) -> None:
        from src.characters.creates import CreateError, release_create

        self._create("Plain")
        held = self._create("Held", hold=True)
        self._create("Truthy", hold="yes")
        self.assertEqual(self._pending_names(), ["Plain", "Truthy"])

        with self.assertRaises(CreateError) as ctx:
            release_create(OTHER, held)
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(release_create(PLAYER, held), {"ok": True, "id": held})
        self.assertEqual(self._pending_names(), ["Plain", "Held", "Truthy"])

    def test_a_hold_nobody_releases_lapses(self) -> None:
        from src.database import connect

        held = self._create("Abandoned", hold=True)
        self.assertEqual(self._pending_names(), [])
        with connect() as conn:
            conn.execute(
                "UPDATE character_creates SET held_until = '2020-01-01T00:00:00Z' WHERE id = %s",
                (held,),
            )
        self.assertEqual(self._pending_names(), ["Abandoned"])

    def test_only_pending_creates_can_be_released(self) -> None:
        from src.characters.creates import CreateError, release_create
        from src.database import connect

        held = self._create("Applied", hold=True)
        with connect() as conn:
            conn.execute("UPDATE character_creates SET status = 'applied' WHERE id = %s", (held,))
        with self.assertRaises(CreateError):
            release_create(PLAYER, held)

    def test_existing_databases_gain_the_hold_column(self) -> None:
        from src.skins import db

        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(
                """
                DROP TABLE character_creates;
                CREATE TABLE character_creates (
                    id TEXT PRIMARY KEY, player_uuid TEXT NOT NULL, client_request_id TEXT,
                    payload TEXT NOT NULL, status TEXT NOT NULL, character_id TEXT, error TEXT,
                    created_at TEXT NOT NULL, applied_at TEXT,
                    realm_id TEXT NOT NULL DEFAULT 'main', wardrobe_active_slot TEXT
                );
                """
            )
        db.migrate()
        with sqlite3.connect(self.db_path) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(character_creates)")}
        self.assertIn("held_until", columns)


if __name__ == "__main__":
    unittest.main()
