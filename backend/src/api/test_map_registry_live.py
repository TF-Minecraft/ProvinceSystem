"""Which map a site's /map shows, and the per-site registry that sets it."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from src.api import map_registry  # noqa: E402

REPO = """
maps:
  - id: main
    public: true
    display_name: Vardera
  - id: dev
    public: false
    staff_permission: tfmc.map.staff
    display_name: Dev
"""

SITE = """
maps:
  - id: main
    public: true
    display_name: Vardera
  - id: dev
    public: true
    live: true
    display_name: Vardera (Dev)
"""


class LiveMapTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo = root / "config" / "maps.yml"
        self.site = root / "data" / "maps.yml"
        self.repo.parent.mkdir()
        self.site.parent.mkdir()
        self.repo.write_text(REPO, encoding="utf-8")
        for name, value in (
            ("_DEFAULT_REGISTRY_PATH", self.repo),
            ("_SITE_REGISTRY_PATH", self.site),
        ):
            patcher = patch.object(map_registry, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self._env = os.environ.pop("MAP_REGISTRY_PATH", None)
        self.addCleanup(self._restore_env)
        map_registry.clear_map_registry_cache()
        self.addCleanup(map_registry.clear_map_registry_cache)

    def _restore_env(self) -> None:
        if self._env is not None:
            os.environ["MAP_REGISTRY_PATH"] = self._env

    def _reload(self) -> dict:
        map_registry.clear_map_registry_cache()
        return map_registry.load_map_registry()

    def test_main_is_live_when_nothing_says_otherwise(self) -> None:
        entries = self._reload()
        self.assertEqual(map_registry.live_map_id(), "main")
        self.assertTrue(entries["main"].to_public_dict()["live"])
        self.assertFalse(entries["dev"].to_public_dict()["live"])

    def test_site_registry_overrides_the_repo(self) -> None:
        self.site.write_text(SITE, encoding="utf-8")
        entries = self._reload()
        self.assertEqual(map_registry.live_map_id(), "dev")
        self.assertTrue(entries["dev"].public)
        self.assertFalse(entries["main"].live)

    def test_environment_override_still_wins(self) -> None:
        self.site.write_text(SITE, encoding="utf-8")
        os.environ["MAP_REGISTRY_PATH"] = str(self.repo)
        self.addCleanup(os.environ.pop, "MAP_REGISTRY_PATH", None)
        self._reload()
        self.assertEqual(map_registry.live_map_id(), "main")

    def test_only_one_live_map(self) -> None:
        self.site.write_text(SITE.replace("display_name: Vardera\n", "display_name: Vardera\n    live: true\n", 1), encoding="utf-8")
        with self.assertRaises(map_registry.MapRegistryError):
            self._reload()

    def test_an_archived_map_cannot_be_live(self) -> None:
        self.site.write_text(
            "maps:\n  - id: old\n    public: true\n    archived: true\n    live: true\n",
            encoding="utf-8",
        )
        with self.assertRaises(map_registry.MapRegistryError):
            self._reload()

    def test_live_must_be_boolean(self) -> None:
        self.site.write_text(
            "maps:\n  - id: main\n    public: true\n    live: yes please\n",
            encoding="utf-8",
        )
        with self.assertRaises(map_registry.MapRegistryError):
            self._reload()


if __name__ == "__main__":
    unittest.main()
