"""Route-level tests for skins session scope enforcement."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from fastapi import HTTPException

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _sync_temp_db(root: Path, db_path: Path) -> object:
    import skins.db as db_mod

    db_mod.DATA_DIR = root
    db_mod.DB_PATH = db_path
    db_mod.SKINS_DIR = root / "skins"
    db_mod.DRINKS_DIR = root / "drinks"
    db_mod.WARDROBE_DIR = root / "wardrobe"
    sys.modules["src.skins.db"] = db_mod
    for name in ("skins.db", "src.skins.db"):
        mod = sys.modules.get(name)
        if mod is not None:
            mod.DATA_DIR = root
            mod.DB_PATH = db_path
            mod.SKINS_DIR = root / "skins"
            mod.DRINKS_DIR = root / "drinks"
            mod.WARDROBE_DIR = root / "wardrobe"
    for name in (
        "skins.codes",
        "src.skins.codes",
        "skins.submissions",
        "src.skins.submissions",
        "api.skins_routes",
        "src.api.skins_routes",
        "src.api.map_access",
    ):
        if name in sys.modules:
            importlib.reload(sys.modules[name])
    return db_mod


class SkinsRoutesScopeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"

        db_mod = _sync_temp_db(root, self.db_path)
        self._db_mod = db_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.migrate()

        from src.api.skins_routes import _skin_session_from_auth

        self._skin_session_from_auth = _skin_session_from_auth

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def _link_player(self, uuid: str = "player-1") -> None:
        from skins.db import connect

        with connect() as conn:
            conn.execute(
                "DELETE FROM discord_links WHERE player_uuid = ?",
                (uuid,),
            )
            conn.execute(
                """
                INSERT INTO discord_links (
                    player_uuid, discord_user_id, minecraft_name,
                    discord_username, linked_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (uuid, "discord-1", "TestPlayer", "Tester", "2026-01-01T00:00:00Z"),
            )
            conn.commit()

    def _seed_entitlements(self, uuid: str = "player-1") -> None:
        from characters.rpc_player_meta import upsert_rpc_player_meta

        upsert_rpc_player_meta(
            {
                "player_uuid": uuid,
                "skin_kinds": ["handheld"],
                "name_colour_stops": 2,
                "max_3d_pair_bytes": 30720,
            }
        )

    def test_skin_session_rejects_profile(self) -> None:
        from src.skins.codes import issue_code, redeem_profile_code

        self._link_player()
        issued = issue_code("player-1", "profile")
        session = redeem_profile_code(issued["code"])

        with self.assertRaises(HTTPException) as ctx:
            self._skin_session_from_auth(f"Bearer {session['session_token']}")
        self.assertEqual(403, ctx.exception.status_code)
        self.assertIn("skin session", ctx.exception.detail.lower())

    def test_skin_session_rejects_drink(self) -> None:
        from src.skins.codes import issue_code, redeem_drink_code

        self._link_player()
        issued = issue_code("player-1", "drink")
        session = redeem_drink_code(issued["code"])

        with self.assertRaises(HTTPException) as ctx:
            self._skin_session_from_auth(f"Bearer {session['session_token']}")
        self.assertEqual(403, ctx.exception.status_code)

    def test_skin_session_accepts_skin(self) -> None:
        from src.skins.codes import issue_code, redeem_code

        self._link_player()
        issued = issue_code("player-1", "skin")
        session = redeem_code(issued["code"])

        row = self._skin_session_from_auth(f"Bearer {session['session_token']}")
        self.assertEqual("skin", row["scope"])

    def test_submissions_check_rejects_profile_bearer(self) -> None:
        from fastapi.testclient import TestClient
        from src.skins.codes import issue_code, redeem_profile_code

        self._link_player()
        issued = issue_code("player-1", "profile")
        session = redeem_profile_code(issued["code"])

        from server import app

        with TestClient(app) as client:
            res = client.get(
                "/skins/submissions/check",
                headers={"Authorization": f"Bearer {session['session_token']}"},
            )
        self.assertEqual(403, res.status_code)
        self.assertIn("skin session", res.json()["detail"].lower())

    def test_submissions_post_rejects_profile_bearer(self) -> None:
        from fastapi.testclient import TestClient
        from src.skins.codes import issue_code, redeem_profile_code

        self._link_player()
        issued = issue_code("player-1", "profile")
        session = redeem_profile_code(issued["code"])

        from server import app

        with TestClient(app) as client:
            res = client.post(
                "/skins/submissions",
                data={
                    "kind": "handheld",
                    "display_name": "Blocked Sword",
                    "base_set": "swords",
                },
                files={"texture": ("t.png", TINY_PNG, "image/png")},
                headers={"Authorization": f"Bearer {session['session_token']}"},
            )
        self.assertEqual(403, res.status_code)
        self.assertIn("skin session", res.json()["detail"].lower())

    def test_submissions_rejects_staff_form_fields(self) -> None:
        from fastapi.testclient import TestClient
        from src.skins.codes import issue_code, redeem_code

        self._link_player()
        self._seed_entitlements()
        issued = issue_code("player-1", "skin")
        session = redeem_code(issued["code"])

        from server import app

        with TestClient(app) as client:
            res = client.post(
                "/skins/submissions",
                data={
                    "kind": "handheld",
                    "display_name": "Player No Staff Fields",
                    "base_set": "swords",
                    "category": "i_weapons",
                    "scroll": "m.loot.rare_item_skin_scroll",
                },
                files={"texture": ("t.png", TINY_PNG, "image/png")},
                headers={"Authorization": f"Bearer {session['session_token']}"},
            )
        self.assertEqual(400, res.status_code)
        self.assertIn("staff", res.json()["detail"].lower())

    def test_legacy_unprefixed_armor_bare_metal_becomes_light_set(self) -> None:
        from unittest import mock

        from fastapi.testclient import TestClient
        from src.skins.codes import issue_code, redeem_code

        self._link_player()
        issued = issue_code("player-1", "skin")
        session = redeem_code(issued["code"])

        import server
        import src.api.skins_routes as routes

        fields = ("helmet", "chestplate", "leggings", "boots", "layer_1", "layer_2")
        with mock.patch.object(routes, "create_submission", return_value={"id": "x"}) as create,                 TestClient(server.app) as client:
            res = client.post(
                "/skins/submissions",
                data={"kind": "armor_set", "display_name": "Old Client", "base_set": "Iron"},
                files={field: ("f.png", TINY_PNG, "image/png") for field in fields},
                headers={"Authorization": f"Bearer {session['session_token']}"},
            )
        self.assertEqual(200, res.status_code, res.text)
        kwargs = create.call_args.kwargs
        self.assertEqual(["light_iron"], kwargs["tiers"])
        self.assertEqual({f"light_iron_{field}" for field in fields}, set(create.call_args.args[3]))

    def test_review_sheet_staff_header_and_player_omits(self) -> None:
        import importlib

        from src.api.skins_routes import SHEET_RENDER_ERROR_HEADER, get_review_sheet
        from src.skins.auth import get_staff_key
        from src.skins.codes import issue_code, redeem_code

        root = Path(self.tmp.name)
        skins_dir = root / "skins"
        db_mod = self._db_mod
        db_mod.SKINS_DIR = skins_dir
        skins_dir.mkdir(parents=True, exist_ok=True)

        for name in ("skins.review_sheet", "src.skins.review_sheet", "src.api.skins_routes"):
            if name in sys.modules:
                importlib.reload(sys.modules[name])

        self._link_player()
        issued = issue_code("player-1", "skin")
        session = redeem_code(issued["code"])

        submission_id = "testplayer-test3d"
        slug = "test3d"
        out_dir = skins_dir / submission_id
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{slug}.png").write_bytes(TINY_PNG)
        (out_dir / f"{slug}.json").write_text("{}", encoding="utf-8")

        from skins.db import connect

        with connect() as conn:
            conn.execute(
                """
                INSERT INTO submissions (
                    id, player_uuid, code_id, kind, slug, display_name,
                    status, dir_path, created_at, discord_user_id, staff, realm_id,
                    base_set
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    submission_id,
                    "player-1",
                    session["code_id"],
                    "item_3d",
                    slug,
                    "Test 3D",
                    "pending",
                    str(out_dir),
                    "2026-01-01T00:00:00Z",
                    "discord-1",
                    0,
                    "main",
                    "handhelds",
                ),
            )
            conn.commit()

        os.environ["SHEET_RENDER_DISABLE"] = "1"
        try:
            staff_resp = get_review_sheet(
                submission_id,
                authorization=None,
                x_staff_key=get_staff_key(),
            )
            self.assertEqual(200, staff_resp.status_code)
            self.assertIn(SHEET_RENDER_ERROR_HEADER, staff_resp.headers)
            self.assertIn(
                "SHEET_RENDER_DISABLE",
                staff_resp.headers[SHEET_RENDER_ERROR_HEADER],
            )

            player_resp = get_review_sheet(
                submission_id,
                authorization=f"Bearer {session['session_token']}",
                x_staff_key=None,
            )
            self.assertEqual(200, player_resp.status_code)
            self.assertNotIn(SHEET_RENDER_ERROR_HEADER, player_resp.headers)
        finally:
            os.environ.pop("SHEET_RENDER_DISABLE", None)


if __name__ == "__main__":
    unittest.main()
