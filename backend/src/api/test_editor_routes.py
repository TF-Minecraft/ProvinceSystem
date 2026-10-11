"""Tests for map title editor API and validation."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

from api.editor_validation import TitleValidationError, validate_title_tier
from api.map_access import (
    EDITOR_STAFF_PERMISSION,
    STAFF_MAP_FORBIDDEN_DETAIL,
    ensure_map_staff_write,
)
from api.map_registry import clear_map_registry_cache
from fastapi import HTTPException
from fastapi.testclient import TestClient
from server import app

TEST_REGISTRY = """
maps:
  - id: main
    public: true
    display_name: Adavaar
    realm_id: main
  - id: dev
    public: false
    display_name: Adavaar
    realm_id: dev
    staff_permission: tfmc.map.staff
"""


def _staff_session(player: str) -> dict:
    return {
        "scope": "profile",
        "player_uuid": player,
        "realm_id": "main",
    }


class TitleValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.defines_root = Path(self.tmp.name) / "defines"
        self.map_dir = self.defines_root / "main"
        self.map_dir.mkdir(parents=True)
        self._orig_defines = os.environ.get("DEFINES_DIR_OVERRIDE")
        # Patch defines_file via DEFINES_DIR on dirs module
        from src.scripts.util import dirs as dirs_module

        self._orig_defines_dir = dirs_module.DEFINES_DIR
        dirs_module.DEFINES_DIR = str(self.defines_root)

    def tearDown(self) -> None:
        from src.scripts.util import dirs as dirs_module

        dirs_module.DEFINES_DIR = self._orig_defines_dir
        self.tmp.cleanup()

    def test_valid_county(self) -> None:
        body = {
            "COUNTY_1": {
                "name": "Elvaris",
                "provinces": [1, 2, 3],
                "rgb": "180,80,80",
                "overlay": {"x": 0, "y": 0, "w": 10, "h": 10},
            }
        }
        clean = validate_title_tier("county", body, "main")
        self.assertNotIn("overlay", clean["COUNTY_1"])
        self.assertEqual(clean["COUNTY_1"]["provinces"], [1, 2, 3])

    def test_duplicate_province_rejected(self) -> None:
        body = {
            "COUNTY_1": {"name": "A", "provinces": [1], "rgb": "10,20,30"},
            "COUNTY_2": {"name": "B", "provinces": [1], "rgb": "40,50,60"},
        }
        with self.assertRaises(TitleValidationError) as ctx:
            validate_title_tier("county", body, "main")
        self.assertIn("Province 1", str(ctx.exception))

    def test_invalid_rgb_rejected(self) -> None:
        body = {"COUNTY_1": {"name": "A", "provinces": [1], "rgb": "bad"}}
        with self.assertRaises(TitleValidationError):
            validate_title_tier("county", body, "main")

    def test_duchy_requires_existing_county(self) -> None:
        (self.map_dir / "county.json").write_text(
            json.dumps({"COUNTY_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"}}),
            encoding="utf-8",
        )
        body = {
            "DUCHY_1": {
                "name": "Valoris",
                "titles": ["COUNTY_MISSING"],
                "rgb": "100,100,100",
            }
        }
        with self.assertRaises(TitleValidationError) as ctx:
            validate_title_tier("duchy", body, "main")
        self.assertIn("COUNTY_MISSING", str(ctx.exception))

    def test_duchy_valid_with_child(self) -> None:
        (self.map_dir / "county.json").write_text(
            json.dumps(
                {
                    "COUNTY_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"},
                    "COUNTY_2": {"name": "B", "provinces": [2], "rgb": "4,5,6"},
                }
            ),
            encoding="utf-8",
        )
        body = {
            "DUCHY_1": {
                "name": "Valoris",
                "titles": ["COUNTY_1", "COUNTY_2"],
                "rgb": "100,100,100",
            }
        }
        clean = validate_title_tier("duchy", body, "main")
        self.assertEqual(clean["DUCHY_1"]["titles"], ["COUNTY_1", "COUNTY_2"])


class MapStaffWriteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.registry_path = Path(self.tmp.name) / "maps.yml"
        self.registry_path.write_text(TEST_REGISTRY, encoding="utf-8")
        self._orig_path = os.environ.get("MAP_REGISTRY_PATH")
        os.environ["MAP_REGISTRY_PATH"] = str(self.registry_path)
        clear_map_registry_cache()

    def tearDown(self) -> None:
        if self._orig_path is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_path
        clear_map_registry_cache()
        self.tmp.cleanup()

    def test_public_map_requires_staff_session(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            ensure_map_staff_write("main", None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, STAFF_MAP_FORBIDDEN_DETAIL)

    def test_public_map_allows_staff(self) -> None:
        player = "00000000-0000-4000-8000-000000000099"
        with mock.patch(
            "api.map_access.get_character_session",
            return_value=_staff_session(player),
        ), mock.patch(
            "api.map_access.has_map_staff_access",
            return_value=True,
        ) as check:
            entry = ensure_map_staff_write("main", "Bearer token")
        self.assertEqual(entry.id, "main")
        check.assert_called_once_with(player, "main", EDITOR_STAFF_PERMISSION)

    def test_staff_write_uses_the_maps_own_permission_and_realm(self) -> None:
        """The destructive gate must not be broader than the read gate it guards.

        `dev` is guarded by `tfmc.map.staff` in realm `dev`. Checking the
        hardcoded global node against the *session's* realm instead would let a
        holder of the broad node in another realm wipe or edit this map.
        """
        player = "00000000-0000-4000-8000-000000000098"
        with mock.patch(
            "api.map_access.get_character_session",
            return_value=_staff_session(player),  # session realm is "main"
        ), mock.patch(
            "api.map_access.has_map_staff_access",
            return_value=True,
        ) as check:
            entry = ensure_map_staff_write("dev", "Bearer token")
        self.assertEqual(entry.id, "dev")
        check.assert_called_once_with(player, "dev", "tfmc.map.staff")

    def test_ui_dev_bypass_does_not_reach_staff_writes(self) -> None:
        """The ui-dev bearer is refused by the write gate even with the flag on.

        `ensure_map_access` honours `_ui_dev_staff_bypass` so staff-only reads
        can be developed without a real session. `ensure_map_staff_write` must
        not: the token is a literal constant in this repo, so honouring it
        would put the title editor and chronicle wipe/restore behind an env
        var. The `has_map_staff_access` mock returns True here on purpose — if
        the bypass were ever restored, this test would pass for the wrong
        reason without it, so the refusal has to come from the token check.
        """
        import api.map_access as map_access_module

        prior = os.environ.get("CHARACTER_UI_DEV")
        os.environ["CHARACTER_UI_DEV"] = "1"
        try:
            with mock.patch(
                "api.map_access.has_map_staff_access", return_value=True
            ):
                with self.assertRaises(HTTPException) as flagged:
                    ensure_map_staff_write(
                        "main",
                        f"Bearer {map_access_module.UI_DEV_SESSION_TOKEN}",
                    )
            self.assertEqual(flagged.exception.status_code, 403)
        finally:
            if prior is None:
                os.environ.pop("CHARACTER_UI_DEV", None)
            else:
                os.environ["CHARACTER_UI_DEV"] = prior

        # With the env var unset, the same bearer is not a valid session.
        os.environ.pop("CHARACTER_UI_DEV", None)
        with self.assertRaises(HTTPException) as ctx:
            ensure_map_staff_write(
                "main",
                f"Bearer {map_access_module.UI_DEV_SESSION_TOKEN}",
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, STAFF_MAP_FORBIDDEN_DETAIL)


class EditorRoutesApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.registry_path = root / "maps.yml"
        self.registry_path.write_text(TEST_REGISTRY, encoding="utf-8")
        self.defines_root = root / "defines"
        self.input_root = root / "input"
        self.map_dir = self.defines_root / "main"
        self.input_map_dir = self.input_root / "main"
        self.map_dir.mkdir(parents=True)
        self.input_map_dir.mkdir(parents=True)

        (self.map_dir / "provinces.txt").write_text(
            "1 = 58,132,60;plains;78\n2 = 40,123,42;plains;85\n",
            encoding="utf-8",
        )

        self._orig_registry = os.environ.get("MAP_REGISTRY_PATH")
        os.environ["MAP_REGISTRY_PATH"] = str(self.registry_path)
        clear_map_registry_cache()

        from src.scripts.util import dirs as dirs_module

        self._orig_defines_dir = dirs_module.DEFINES_DIR
        self._orig_input_dir = dirs_module.INPUT_DIR
        dirs_module.DEFINES_DIR = str(self.defines_root)
        dirs_module.INPUT_DIR = str(self.input_root)

        self._write_test_provinces_png()
        from src.scripts.province_id_grid import write_province_id_grid_file

        write_province_id_grid_file("main")

        self.player = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"
        self.auth = "Bearer staff-token"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        from src.scripts.util import dirs as dirs_module

        dirs_module.DEFINES_DIR = self._orig_defines_dir
        dirs_module.INPUT_DIR = self._orig_input_dir
        if self._orig_registry is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_registry
        clear_map_registry_cache()
        self.tmp.cleanup()

    def _write_test_provinces_png(self) -> None:
        from PIL import Image

        png_path = self.input_map_dir / "provinces.png"
        img = Image.new("RGBA", (2, 2))
        pixels = [
            (58, 132, 60, 255),
            (40, 123, 42, 255),
            (58, 132, 60, 255),
            (40, 123, 42, 255),
        ]
        for i, rgba in enumerate(pixels):
            img.putpixel((i % 2, i // 2), rgba)
        img.save(png_path)

    def _staff_patches(self):
        return (
            mock.patch(
                "src.api.map_access.get_character_session",
                return_value=_staff_session(self.player),
            ),
            mock.patch(
                "src.api.map_access.has_map_staff_access",
                return_value=True,
            ),
        )

    def test_upload_county_no_auth_403(self) -> None:
        r = self.client.post(
            "/main/data/upload/county",
            json={"COUNTY_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"}},
        )
        self.assertEqual(r.status_code, 403)

    def test_upload_county_internal_peer_no_auth_200(self) -> None:
        payload = {
            "COUNTY_1": {"name": "A", "provinces": [1], "rgb": "1,2,3"},
        }
        with mock.patch("src.api.data_routes.require_localhost"):
            r = self.client.post("/main/data/upload/county", json=payload)
        self.assertEqual(r.status_code, 200)
        written = json.loads((self.map_dir / "county.json").read_text(encoding="utf-8"))
        self.assertEqual(written["COUNTY_1"]["name"], "A")

    def test_upload_regions_no_auth_403(self) -> None:
        r = self.client.post(
            "/main/data/upload/regions",
            json={"REGION_1": {"name": "A", "provinces": [1]}},
        )
        self.assertEqual(r.status_code, 403)

    def test_upload_regions_internal_peer_writes_file(self) -> None:
        payload = {
            "REGION_1": {"name": "Highlands", "provinces": [1, 2], "rgb": "1,2,3"},
        }
        with mock.patch("src.api.data_routes.require_localhost"):
            r = self.client.post("/main/data/upload/regions", json=payload)
        self.assertEqual(r.status_code, 200)
        written = json.loads((self.map_dir / "regions.json").read_text(encoding="utf-8"))
        self.assertEqual(written["REGION_1"]["name"], "Highlands")
        self.assertEqual(written["REGION_1"]["provinces"], [1, 2])

    def test_upload_empty_regions_overwrites_file(self) -> None:
        (self.map_dir / "regions.json").write_text(
            '{"REGION_1": {"name": "keep", "provinces": [1]}}',
            encoding="utf-8",
        )
        with mock.patch("src.api.data_routes.require_localhost"):
            r = self.client.post("/main/data/upload/regions", json={})
        self.assertEqual(r.status_code, 200)
        written = json.loads((self.map_dir / "regions.json").read_text(encoding="utf-8"))
        self.assertEqual(written, {})

    def test_get_editor_provinces_staff(self) -> None:
        staff_session_patch, staff_access_patch = self._staff_patches()
        with staff_session_patch, staff_access_patch:
            r = self.client.get(
                "/main/editor/provinces",
                headers={"Authorization": self.auth},
            )
        self.assertEqual(r.status_code, 200)
        provinces = r.json()["provinces"]
        self.assertEqual(len(provinces), 2)
        self.assertEqual(provinces[0]["id"], 1)
        self.assertEqual(provinces[0]["rgb"], "58,132,60")
        self.assertEqual(provinces[0]["terrain"], "plains")
        self.assertEqual(provinces[0]["fertility"], 78)

    def test_get_editor_province_index_no_auth_403(self) -> None:
        r = self.client.get("/main/editor/province-index")
        self.assertEqual(r.status_code, 403)

    def test_get_editor_province_index_staff(self) -> None:
        staff_session_patch, staff_access_patch = self._staff_patches()
        with staff_session_patch, staff_access_patch:
            r = self.client.get(
                "/main/editor/province-index",
                headers={"Authorization": self.auth},
            )
        self.assertEqual(r.status_code, 200)
        # The route now streams the .gz file itself instead of rebuilding it.
        self.assertEqual(r.headers.get("content-type"), "application/gzip")
        self.assertTrue(len(r.content) > 8)
        import gzip
        import struct

        payload = gzip.decompress(r.content)
        width, height = struct.unpack("<ii", payload[:8])
        self.assertEqual(width, 2)
        self.assertEqual(height, 2)
        self.assertEqual(len(payload), 8 + width * height * 2)

    def test_get_editor_province_index_revalidates_with_304(self) -> None:
        staff_session_patch, staff_access_patch = self._staff_patches()
        with staff_session_patch, staff_access_patch:
            first = self.client.get(
                "/main/editor/province-index",
                headers={"Authorization": self.auth},
            )
            self.assertEqual(first.status_code, 200)
            etag = first.headers["etag"]
            self.assertNotIn("no-store", first.headers["Cache-Control"])

            second = self.client.get(
                "/main/editor/province-index",
                headers={"Authorization": self.auth, "If-None-Match": etag},
            )
        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.content, b"")

    def test_get_editor_province_index_missing_grid_404(self) -> None:
        from src.scripts.province_id_grid import GRID_FILENAME
        from src.scripts.util.dirs import defines_file

        grid_path = defines_file("main", GRID_FILENAME)
        if os.path.isfile(grid_path):
            os.remove(grid_path)

        staff_session_patch, staff_access_patch = self._staff_patches()
        with staff_session_patch, staff_access_patch:
            r = self.client.get(
                "/main/editor/province-index",
                headers={"Authorization": self.auth},
            )
        self.assertEqual(r.status_code, 404)
        detail = r.json().get("detail", "")
        self.assertIn("build_province_id_grid", detail)

    def test_editor_regen_staff_starts_background(self) -> None:
        staff_session_patch, staff_access_patch = self._staff_patches()
        with staff_session_patch, staff_access_patch, mock.patch(
            "src.api.editor_routes.run_regeneration",
            new_callable=mock.AsyncMock,
        ):
            r = self.client.post(
                "/main/editor/regen/fullregen:county",
                headers={"Authorization": self.auth},
            )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])


if __name__ == "__main__":
    unittest.main()
