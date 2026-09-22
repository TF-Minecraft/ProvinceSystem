"""Unit and API tests for map registry + viewer access control."""

from __future__ import annotations

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

from fastapi.testclient import TestClient

from api.map_access import (
    ensure_map_access,
    ensure_map_staff_write,
    get_character_session,
    list_accessible_maps,
    STAFF_MAP_FORBIDDEN_DETAIL,
    STAFF_MAP_PERMISSION_DETAIL,
)
from api.map_registry import (
    MapRegistryError,
    clear_map_registry_cache,
    get_map_entry,
    load_map_registry,
)
from src.api import map_registry as src_map_registry
from fastapi import HTTPException
from server import app


def _clear_registry_caches() -> None:
    """`api.*` and `src.api.*` are both importable; map_access uses the latter."""
    clear_map_registry_cache()
    src_map_registry.clear_map_registry_cache()


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

REGISTRY_WITH_CALAVORN = """
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
  - id: calavorn
    public: true
    archived: true
    display_name: Calavorn
    realm_id: calavorn
"""


class MapRegistryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.registry_path = Path(self.tmp.name) / "maps.yml"
        self.registry_path.write_text(TEST_REGISTRY, encoding="utf-8")
        self._orig_path = os.environ.get("MAP_REGISTRY_PATH")
        os.environ["MAP_REGISTRY_PATH"] = str(self.registry_path)
        _clear_registry_caches()

    def tearDown(self) -> None:
        if self._orig_path is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_path
        _clear_registry_caches()
        self.tmp.cleanup()

    def test_loads_main_and_dev(self) -> None:
        entries = load_map_registry()
        self.assertEqual(set(entries.keys()), {"main", "dev"})
        self.assertTrue(entries["main"].public)
        self.assertFalse(entries["dev"].public)
        self.assertEqual(entries["dev"].staff_permission, "tfmc.map.staff")
        self.assertFalse(entries["main"].archived)
        self.assertFalse(entries["dev"].archived)

    def test_unknown_map_returns_none(self) -> None:
        self.assertIsNone(get_map_entry("notamap"))

    def test_archived_true_is_parsed(self) -> None:
        self.registry_path.write_text(REGISTRY_WITH_CALAVORN, encoding="utf-8")
        _clear_registry_caches()
        entries = load_map_registry()
        self.assertTrue(entries["calavorn"].archived)
        self.assertTrue(entries["calavorn"].public)
        self.assertFalse(entries["main"].archived)

    def test_archived_non_bool_is_rejected(self) -> None:
        self.registry_path.write_text(
            """
maps:
  - id: main
    public: true
    display_name: Adavaar
    archived: "yes"
""",
            encoding="utf-8",
        )
        _clear_registry_caches()
        with self.assertRaises(MapRegistryError) as ctx:
            load_map_registry()
        self.assertIn("boolean archived", str(ctx.exception))

    def test_committed_registry_includes_calavorn(self) -> None:
        os.environ.pop("MAP_REGISTRY_PATH", None)
        _clear_registry_caches()
        entries = load_map_registry(force=True)
        self.assertEqual(set(entries.keys()), {"main", "dev", "calavorn"})
        calavorn = entries["calavorn"]
        self.assertTrue(calavorn.public)
        self.assertTrue(calavorn.archived)
        self.assertEqual(calavorn.display_name, "Calavorn")
        self.assertEqual(calavorn.realm_id, "calavorn")
        self.assertIsNone(calavorn.staff_permission)
        self.assertFalse(entries["main"].archived)
        self.assertFalse(entries["dev"].archived)


class MapAccessUnitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.registry_path = root / "maps.yml"
        self.registry_path.write_text(TEST_REGISTRY, encoding="utf-8")
        self._orig_path = os.environ.get("MAP_REGISTRY_PATH")
        os.environ["MAP_REGISTRY_PATH"] = str(self.registry_path)
        _clear_registry_caches()

    def tearDown(self) -> None:
        if self._orig_path is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_path
        _clear_registry_caches()
        self.tmp.cleanup()

    def test_public_map_allows_anonymous(self) -> None:
        entry = ensure_map_access("main", None)
        self.assertEqual(entry.id, "main")

    def test_staff_map_denies_anonymous(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            ensure_map_access("dev", None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, STAFF_MAP_FORBIDDEN_DETAIL)

    def test_unknown_map_is_404(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            ensure_map_access("notamap", None)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_character_session_requires_scope(self) -> None:
        with mock.patch(
            "api.map_access.get_session",
            return_value={"scope": "skin", "player_uuid": "abc"},
        ):
            self.assertIsNone(get_character_session("Bearer token"))

    def test_main_realm_flag_grants_dev_map(self) -> None:
        player = "00000000-0000-4000-8000-000000000099"
        session = {
            "scope": "profile",
            "player_uuid": player,
            "realm_id": "main",
        }
        with mock.patch(
            "api.map_access.get_character_session",
            return_value=session,
        ), mock.patch(
            "api.map_access.has_map_staff_access",
            return_value=True,
        ) as check:
            entry = ensure_map_access("dev", "Bearer token")
            self.assertEqual(entry.id, "dev")
        check.assert_called_once_with(player, "main", "tfmc.map.staff")

    def test_list_accessible_maps_anonymous(self) -> None:
        ids = [entry.id for entry in list_accessible_maps(None)]
        self.assertEqual(ids, ["main"])

    def test_list_accessible_maps_anonymous_includes_archived_public(self) -> None:
        self.registry_path.write_text(REGISTRY_WITH_CALAVORN, encoding="utf-8")
        _clear_registry_caches()
        maps = list_accessible_maps(None)
        by_id = {entry.id: entry for entry in maps}
        self.assertEqual(set(by_id), {"main", "calavorn"})
        self.assertFalse(by_id["main"].archived)
        self.assertTrue(by_id["calavorn"].archived)

    def test_list_accessible_maps_staff(self) -> None:
        player = "00000000-0000-4000-8000-000000000088"
        auth = "Bearer staff-token"
        with mock.patch(
            "api.map_access.get_character_session",
            return_value={
                "scope": "profile",
                "player_uuid": player,
                "realm_id": "main",
            },
        ), mock.patch(
            "api.map_access.has_map_staff_access",
            return_value=True,
        ):
            ids = [item.id for item in list_accessible_maps(auth)]
        self.assertEqual(ids, ["main", "dev"])

    def test_ui_dev_session_grants_staff_maps(self) -> None:
        from api import map_access

        auth = f"Bearer {map_access.UI_DEV_SESSION_TOKEN}"
        with mock.patch(
            "api.map_access.is_character_ui_dev",
            return_value=True,
        ):
            self.assertTrue(map_access.is_character_ui_dev())
            ids = [item.id for item in list_accessible_maps(auth)]
            entry = ensure_map_access("dev", auth)
            self.assertEqual(entry.id, "dev")
            # The bypass covers reads and map listing only. It deliberately
            # stops at the destructive write gate — see
            # `ensure_map_staff_write`'s docstring — because the bearer it
            # checks for is a literal constant in this repo, not a secret.
            with self.assertRaises(HTTPException) as ctx:
                ensure_map_staff_write("dev", auth)
            self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ids, ["main", "dev"])

    def test_ui_dev_session_ignored_when_flag_off(self) -> None:
        from api.map_access import UI_DEV_SESSION_TOKEN

        auth = f"Bearer {UI_DEV_SESSION_TOKEN}"
        with mock.patch(
            "api.map_access.is_character_ui_dev",
            return_value=False,
        ), mock.patch("api.map_access.get_session", return_value=None) as get_session:
            ids = [item.id for item in list_accessible_maps(auth)]
        get_session.assert_called_once_with(UI_DEV_SESSION_TOKEN)
        self.assertEqual(ids, ["main"])


class MapAccessApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.registry_path = root / "maps.yml"
        self.registry_path.write_text(TEST_REGISTRY, encoding="utf-8")
        self._orig_path = os.environ.get("MAP_REGISTRY_PATH")
        os.environ["MAP_REGISTRY_PATH"] = str(self.registry_path)
        _clear_registry_caches()
        self.client = TestClient(app)
        self.player = f"00000000-0000-4000-8000-{uuid.uuid4().hex[:12]}"

    def tearDown(self) -> None:
        self.client.close()
        if self._orig_path is None:
            os.environ.pop("MAP_REGISTRY_PATH", None)
        else:
            os.environ["MAP_REGISTRY_PATH"] = self._orig_path
        _clear_registry_caches()
        self.tmp.cleanup()

    def test_unknown_map_data_route_404(self) -> None:
        r = self.client.get("/notamap/data/nation")
        self.assertEqual(r.status_code, 404)

    def test_anonymous_dev_data_403(self) -> None:
        r = self.client.get("/dev/data/nation")
        self.assertEqual(r.status_code, 403)

    def test_anonymous_main_data_not_403(self) -> None:
        r = self.client.get("/main/data/nation")
        self.assertNotEqual(r.status_code, 403)

    def test_character_without_flag_dev_403(self) -> None:
        session = {
            "scope": "profile",
            "player_uuid": self.player,
            "realm_id": "main",
        }
        with mock.patch(
            "src.api.map_access.get_character_session",
            return_value=session,
        ), mock.patch(
            "src.api.map_access.has_map_staff_access",
            return_value=False,
        ):
            r = self.client.get(
                "/dev/data/nation",
                headers={"Authorization": "Bearer test-token"},
            )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["detail"], STAFF_MAP_PERMISSION_DETAIL)

    def test_character_with_flag_dev_ok(self) -> None:
        session = {
            "scope": "profile",
            "player_uuid": self.player,
            "realm_id": "main",
        }
        with mock.patch(
            "src.api.map_access.get_character_session",
            return_value=session,
        ), mock.patch(
            "src.api.map_access.has_map_staff_access",
            return_value=True,
        ):
            r = self.client.get(
                "/dev/data/nation",
                headers={"Authorization": "Bearer test-token"},
            )
        self.assertNotEqual(r.status_code, 403)

    def test_accessible_maps_anonymous(self) -> None:
        r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        ids = [item["id"] for item in r.json()["maps"]]
        self.assertEqual(ids, ["main"])
        self.assertFalse(r.json()["maps"][0]["archived"])
        self.assertNotIn("has_chronicle_days", r.json()["maps"][0])

    def test_accessible_maps_anonymous_includes_archived_public(self) -> None:
        self.registry_path.write_text(REGISTRY_WITH_CALAVORN, encoding="utf-8")
        _clear_registry_caches()
        with mock.patch("src.api.maps_routes.list_days", return_value=[]):
            r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        by_id = {item["id"]: item for item in r.json()["maps"]}
        self.assertEqual(set(by_id), {"main", "calavorn"})
        self.assertFalse(by_id["main"]["archived"])
        self.assertTrue(by_id["calavorn"]["archived"])
        self.assertEqual(by_id["calavorn"]["display_name"], "Calavorn")
        self.assertNotIn("dev", by_id)
        self.assertNotIn("has_chronicle_days", by_id["main"])
        self.assertFalse(by_id["calavorn"]["has_chronicle_days"])

    def test_accessible_maps_staff(self) -> None:
        session = {
            "scope": "profile",
            "player_uuid": self.player,
            "realm_id": "main",
        }
        with mock.patch(
            "src.api.map_access.get_character_session",
            return_value=session,
        ), mock.patch(
            "src.api.map_access.has_map_staff_access",
            return_value=True,
        ):
            r = self.client.get(
                "/maps/accessible",
                headers={"Authorization": "Bearer test-token"},
            )
        self.assertEqual(r.status_code, 200)
        ids = [item["id"] for item in r.json()["maps"]]
        self.assertEqual(ids, ["main", "dev"])

    def test_accessible_live_chapter_label_from_stamp(self) -> None:
        from src.scripts.chronicle import chapter_identity as ident
        from src.scripts.util import dirs

        input_dir = Path(self.tmp.name) / "input"
        with mock.patch.object(dirs, "INPUT_DIR", str(input_dir)):
            ident.write_chapter_identity(
                "main", {"chapter_id": "vardera", "chapter_name": "Vardera"}
            )
            r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        main = r.json()["maps"][0]
        self.assertEqual(main["id"], "main")
        self.assertEqual(main["display_name"], "Vardera")
        self.assertEqual(main["chapter_id"], "vardera")
        self.assertEqual(main["chapter_name"], "Vardera")

    def test_accessible_live_without_stamp_keeps_yaml_name(self) -> None:
        from src.scripts.util import dirs

        with mock.patch.object(dirs, "INPUT_DIR", str(Path(self.tmp.name) / "empty")):
            r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        main = r.json()["maps"][0]
        self.assertEqual(main["display_name"], "Adavaar")
        self.assertEqual(main["chapter_id"], "unknown")
        self.assertEqual(main["chapter_name"], "Unknown")

    def test_accessible_archived_keeps_yaml_name_despite_stamp(self) -> None:
        from src.scripts.chronicle import chapter_identity as ident
        from src.scripts.util import dirs

        self.registry_path.write_text(REGISTRY_WITH_CALAVORN, encoding="utf-8")
        _clear_registry_caches()
        input_dir = Path(self.tmp.name) / "input"
        with mock.patch.object(dirs, "INPUT_DIR", str(input_dir)):
            ident.write_chapter_identity(
                "calavorn", {"chapter_id": "vardera", "chapter_name": "Vardera"}
            )
            ident.write_chapter_identity(
                "main", {"chapter_id": "vardera", "chapter_name": "Vardera"}
            )
            r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        by_id = {item["id"]: item for item in r.json()["maps"]}
        self.assertEqual(by_id["calavorn"]["display_name"], "Calavorn")
        self.assertNotIn("chapter_id", by_id["calavorn"])
        self.assertNotIn("chapter_name", by_id["calavorn"])
        self.assertEqual(by_id["main"]["display_name"], "Vardera")

    def test_accessible_archived_without_days_flag_false(self) -> None:
        self.registry_path.write_text(REGISTRY_WITH_CALAVORN, encoding="utf-8")
        _clear_registry_caches()
        with mock.patch("src.api.maps_routes.list_days", return_value=[]):
            r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        by_id = {item["id"]: item for item in r.json()["maps"]}
        self.assertNotIn("has_chronicle_days", by_id["main"])
        self.assertFalse(by_id["calavorn"]["has_chronicle_days"])

    def test_accessible_archived_with_days_flag_true(self) -> None:
        self.registry_path.write_text(REGISTRY_WITH_CALAVORN, encoding="utf-8")
        _clear_registry_caches()

        def days_for(map_id: str):
            return ["2026-09-01"] if map_id == "calavorn" else []

        with mock.patch("src.api.maps_routes.list_days", side_effect=days_for):
            r = self.client.get("/maps/accessible")
        self.assertEqual(r.status_code, 200)
        by_id = {item["id"]: item for item in r.json()["maps"]}
        self.assertTrue(by_id["calavorn"]["has_chronicle_days"])
        self.assertNotIn("has_chronicle_days", by_id["main"])

    def test_anonymous_main_markers_not_403(self) -> None:
        with mock.patch(
            "src.api.data_routes.build_markers_response",
            return_value={"map_id": "main", "exported_at": None, "settlements": []},
        ):
            r = self.client.get("/main/data/markers")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["settlements"], [])

    def test_anonymous_dev_markers_403(self) -> None:
        r = self.client.get("/dev/data/markers")
        self.assertEqual(r.status_code, 403)

    def test_upload_map_markers_accepted(self) -> None:
        payload = {
            "map_id": "main",
            "exported_at": "2026-08-15T20:00:00Z",
            "settlements": [],
        }
        with mock.patch("src.api.data_routes.require_localhost"), mock.patch(
            "src.api.data_routes.generate_zoc_overlays"
        ) as zocgen:
            r = self.client.post("/main/data/upload/map_markers", json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertIn("map_markers", r.json()["message"])
        zocgen.assert_called_once_with("main")

    def test_get_zoc_overlay_missing_returns_404(self) -> None:
        r = self.client.get("/main/zoc/nonexistent-fort")
        self.assertEqual(r.status_code, 404)

    def test_get_zoc_overlay_accepts_png_suffix_in_url(self) -> None:
        zoc_path = (
            Path(__file__).resolve().parents[1] / "output" / "dev" / "zoc" / "Greenfold.png"
        )
        if not zoc_path.is_file():
            self.skipTest("dev Greenfold ZOC fixture missing")

        session = {
            "scope": "profile",
            "player_uuid": self.player,
            "realm_id": "main",
        }
        with mock.patch(
            "src.api.map_access.get_character_session",
            return_value=session,
        ), mock.patch(
            "src.api.map_access.has_map_staff_access",
            return_value=True,
        ):
            r = self.client.get(
                "/dev/zoc/Greenfold.png",
                headers={"Authorization": "Bearer test-token"},
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("content-type"), "image/png")


if __name__ == "__main__":
    unittest.main()
