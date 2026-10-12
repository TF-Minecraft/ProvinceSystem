"""GET /skins/submissions/{id}/files/{name} serves a skin's uploads to its owner only."""

from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from fastapi import HTTPException

OWNER = "owner-uuid"


class SkinOwnerFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.skins_dir = Path(self.tmp.name).resolve() / "skins"
        sub = self.skins_dir / "abc_staff"
        sub.mkdir(parents=True)
        for name in ("abc_staff.png", "abc_staff.json", "meta.json", "review_sheet.png", "notes.txt"):
            (sub / name).write_bytes(b"x")
        self.routes = importlib.import_module("src.api.skins_routes")

        def owner_row(submission_id: str, player_uuid: str):
            return {"id": submission_id} if submission_id == "abc_staff" and player_uuid == OWNER else None

        def resolver(submission_id: str, filename: str):
            path = self.skins_dir / submission_id / filename
            return path if path.is_file() else None

        for p in (
            patch.object(self.routes, "_session_from_auth", lambda auth: {"player_uuid": auth}),
            patch.object(self.routes, "get_submission_for_owner", owner_row),
            patch.object(self.routes, "skins_db", SimpleNamespace(SKINS_DIR=self.skins_dir)),
            patch.dict(self.routes.owner_file.__globals__, {"resolve_submission_file": resolver}),
        ):
            p.start()
            self.addCleanup(p.stop)

    def status(self, submission_id: str, filename: str, who: str = OWNER) -> int:
        try:
            return self.routes.owner_file(submission_id, filename, who).status_code
        except HTTPException as e:
            return e.status_code

    def test_owner_gets_textures_and_models(self) -> None:
        self.assertEqual(200, self.status("abc_staff", "abc_staff.png"))
        self.assertEqual(200, self.status("abc_staff", "abc_staff.json"))

    def test_other_players_get_nothing(self) -> None:
        self.assertEqual(404, self.status("abc_staff", "abc_staff.png", who="someone-else"))

    def test_staff_and_server_files_stay_hidden(self) -> None:
        for name in ("meta.json", "review_sheet.png", "name_preview.png", "notes.txt"):
            self.assertEqual(404, self.status("abc_staff", name), name)

    def test_traversal_is_refused(self) -> None:
        for sid, name in (("..", "abc_staff.png"), ("abc_staff", "..\\..\\x.png"), ("..\\..", "x.png")):
            self.assertEqual(404, self.status(sid, name), (sid, name))


if __name__ == "__main__":
    unittest.main()
