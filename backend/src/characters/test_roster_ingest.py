"""Roster pushes write only server-owned fields and keep the worn wardrobe slot."""

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

PLAYER = "roster-ingest-player"

pytestmark = pytest.mark.usefixtures("postgres")


class RosterIngestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)

        import skins.db as db_mod

        self._db_mod = db_mod
        sys.modules["src.skins.db"] = db_mod
        self._orig = {
            k: getattr(db_mod, k)
            for k in ("DATA_DIR", "DRINKS_DIR", "SKINS_DIR", "WARDROBE_DIR")
        }
        db_mod.DATA_DIR = root
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.ensure_directories()

    def tearDown(self) -> None:
        for k, v in self._orig.items():
            setattr(self._db_mod, k, v)
        self.tmp.cleanup()

    def _rows(self) -> dict[str, dict]:
        from src.auth import testing

        rows = testing.rows("SELECT * FROM character_roster WHERE player_uuid = %s", (PLAYER,))
        return {r["character_id"]: r for r in rows}

    def test_push_keeps_worn_slot_and_updates_server_fields(self) -> None:
        from characters.roster import replace_roster

        replace_roster(
            PLAYER,
            [
                {"id": "kept", "name": "Aldric", "status": "ALIVE", "race": "human"},
                {"id": "gone", "name": "Brena", "status": "ALIVE"},
            ],
        )
        from src.auth import testing

        testing.execute(
            "UPDATE character_roster SET wardrobe_active_slot = 'extra_1' WHERE character_id = 'kept'"
        )

        replace_roster(
            PLAYER,
            [
                {"id": "kept", "name": "Aldric the Bold", "status": "DEAD"},
                {"id": "new", "name": "Cael", "status": "ALIVE"},
            ],
        )

        rows = self._rows()
        self.assertEqual(sorted(rows), ["kept", "new"])
        self.assertEqual(rows["kept"]["wardrobe_active_slot"], "extra_1")
        self.assertEqual(rows["kept"]["name"], "Aldric the Bold")
        self.assertEqual(rows["kept"]["status"], "DEAD")
        self.assertIsNone(rows["kept"]["race"])
        self.assertIsNone(rows["new"]["wardrobe_active_slot"])

    def test_empty_push_clears_the_roster(self) -> None:
        from characters.roster import replace_roster

        replace_roster(PLAYER, [{"id": "a", "name": "A", "status": "ALIVE"}])
        replace_roster(PLAYER, [])

        self.assertEqual(self._rows(), {})


if __name__ == "__main__":
    unittest.main()
