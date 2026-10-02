"""Unit tests for production startup guard."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from src.api.prod_guard import assert_production_safe


class ProdGuardTest(unittest.TestCase):
    def test_non_prod_allows_skins_dev(self) -> None:
        with patch.dict(os.environ, {"SKINS_DEV": "1"}, clear=True):
            assert_production_safe()

    def test_prod_rejects_skins_dev(self) -> None:
        env = {
            "PS_PRODUCTION": "1",
            "SKINS_DEV": "1",
            "PLUGIN_KEY": "real-plugin",
            "STAFF_KEY": "real-staff",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                assert_production_safe()
        self.assertIn("SKINS_DEV", str(ctx.exception))

    def test_prod_rejects_character_ui_dev(self) -> None:
        env = {
            "PS_PRODUCTION": "1",
            "CHARACTER_UI_DEV": "1",
            "PLUGIN_KEY": "real-plugin",
            "STAFF_KEY": "real-staff",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                assert_production_safe()
        self.assertIn("CHARACTER_UI_DEV", str(ctx.exception))

    def test_prod_rejects_missing_plugin_key(self) -> None:
        env = {
            "PS_PRODUCTION": "1",
            "STAFF_KEY": "real-staff",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                assert_production_safe()
        self.assertIn("PLUGIN_KEY", str(ctx.exception))

    def test_prod_rejects_missing_staff_key(self) -> None:
        env = {
            "PS_PRODUCTION": "1",
            "PLUGIN_KEY": "real-plugin",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                assert_production_safe()
        self.assertIn("STAFF_KEY", str(ctx.exception))

    def test_prod_accepts_valid_env(self) -> None:
        env = {
            "PS_PRODUCTION": "1",
            "PLUGIN_KEY": "real-plugin",
            "STAFF_KEY": "real-staff",
        }
        with patch.dict(os.environ, env, clear=True):
            assert_production_safe()

    def test_prod_rejects_published_dev_keys_without_dev_flag(self) -> None:
        for name in ("PLUGIN_KEY", "STAFF_KEY"):
            for key in ("dev-plugin-key", "dev-staff-key"):
                with self.subTest(name=name, key=key):
                    env = {
                        "PS_PRODUCTION": "1",
                        "PLUGIN_KEY": "real-plugin",
                        "STAFF_KEY": "real-staff",
                        name: key,
                    }
                    with patch.dict(os.environ, env, clear=True):
                        with self.assertRaises(RuntimeError) as ctx:
                            assert_production_safe()
                    self.assertIn(name, str(ctx.exception))
                    self.assertNotIn(key, str(ctx.exception))

    def test_prod_rejects_published_dev_key_as_secondary_plugin_key(self) -> None:
        for key in ("dev-plugin-key", "dev-staff-key"):
            with self.subTest(key=key):
                env = {
                    "PS_PRODUCTION": "1",
                    "PLUGIN_KEY": "real-plugin",
                    "STAFF_KEY": "real-staff",
                    "PLUGIN_KEYS_SECONDARY": f"real-secondary, {key}, another-secondary",
                }
                with patch.dict(os.environ, env, clear=True):
                    with self.assertRaises(RuntimeError) as ctx:
                        assert_production_safe()
                self.assertIn("PLUGIN_KEYS_SECONDARY", str(ctx.exception))
                self.assertNotIn(key, str(ctx.exception))

    def test_non_prod_allows_published_dev_keys(self) -> None:
        env = {
            "SKINS_DEV": "1",
            "PLUGIN_KEY": "dev-plugin-key",
            "STAFF_KEY": "dev-staff-key",
            "PLUGIN_KEYS_SECONDARY": "dev-plugin-key",
        }
        with patch.dict(os.environ, env, clear=True):
            assert_production_safe()

    def test_prod_accepts_real_secondary_keys(self) -> None:
        env = {
            "PS_PRODUCTION": "1",
            "PLUGIN_KEY": "real-plugin",
            "STAFF_KEY": "real-staff",
            "PLUGIN_KEYS_SECONDARY": "real-secondary, another-secondary",
        }
        with patch.dict(os.environ, env, clear=True):
            assert_production_safe()


if __name__ == "__main__":
    unittest.main()
