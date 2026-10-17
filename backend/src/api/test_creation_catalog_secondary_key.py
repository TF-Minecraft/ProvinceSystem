"""Secondary plugin keys may call plugin routes but must not replace site-wide creation data."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pytest

pytestmark = pytest.mark.usefixtures("postgres")

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PRIMARY = "primary-key"
DEV = "dev-key"
TUTORIAL = "tutorial-key"


def _catalog(race_amount: int) -> dict:
    return {
        "stages": [{"id": "info", "type": "info", "order": 0}],
        "attribute_point_buy": {
            "pool": 12,
            "max_rank": 2,
            "cost_for_rank": [1, 2],
            "attributes": ["strength"],
            "abbreviations": {"strength": "str"},
        },
        "races": [
            {
                "id": "human",
                "name": "Human",
                "attribute_modifiers": [{"type": "strength", "amount": race_amount}],
            }
        ],
        "traits": [],
        "classes": [],
        "validation": {},
        "slot_limits": {},
    }


class SecondaryPluginKeyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)

        import src.skins.db  # noqa: F401  (make sure at least one copy is loaded)

        # Other test files load the db module as both "skins.db" and "src.skins.db" and leave
        # either one in sys.modules, so point every loaded copy at the temp database.
        paths = {
            "DATA_DIR": root,
            "SKINS_DIR": root / "skins",
            "DRINKS_DIR": root / "drinks",
            "WARDROBE_DIR": root / "wardrobe",
        }
        self._orig = []
        seen: set[int] = set()
        for mod_name in ("src.skins.db", "skins.db"):
            mod = sys.modules.get(mod_name)
            if mod is None or id(mod) in seen:
                continue
            seen.add(id(mod))
            self._orig.append((mod, {name: getattr(mod, name) for name in paths}))
            for name, value in paths.items():
                setattr(mod, name, value)
        self._orig[0][0].ensure_directories()

        self._env = mock.patch.dict(
            "os.environ",
            {"PLUGIN_KEY": PRIMARY, "PLUGIN_KEYS_SECONDARY": f"{DEV}, {TUTORIAL}"},
        )
        self._env.start()

        from src.api.characters_routes import characters_router

        app = FastAPI()
        app.include_router(characters_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self._env.stop()
        for mod, values in self._orig:
            for name, value in values.items():
                setattr(mod, name, value)
        self.tmp.cleanup()

    def _put(self, key: str | None, race_amount: int):
        headers = {"X-Plugin-Key": key} if key else {}
        return self.client.put(
            "/characters/plugin/creation-catalog",
            json=_catalog(race_amount),
            headers=headers,
        )

    def _stored_amount(self) -> int:
        from src.characters.creation_catalog import get_catalog

        return get_catalog()["races"][0]["attribute_modifiers"][0]["amount"]

    def test_primary_push_is_stored(self) -> None:
        res = self._put(PRIMARY, 4)
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("ignored", res.json())
        self.assertEqual(self._stored_amount(), 4)

    def test_secondary_push_does_not_replace_primary_copy(self) -> None:
        first = self._put(PRIMARY, 4).json()
        for key in (DEV, TUTORIAL):
            res = self._put(key, 3)
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertTrue(body["ignored"])
            # Same shape the plugin parses, describing the copy that is still stored.
            self.assertEqual(body["races"], 1)
            self.assertEqual(body["updated_at"], first["updated_at"])
        self.assertEqual(self._stored_amount(), 4)

    def test_secondary_push_before_any_primary_push_stores_nothing(self) -> None:
        res = self._put(DEV, 3)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ignored"])
        from src.characters.creation_catalog import get_catalog

        self.assertEqual(get_catalog()["races"], [])

    def test_unknown_or_missing_key_is_rejected(self) -> None:
        self._put(PRIMARY, 4)
        self.assertEqual(self._put("wrong-key", 3).status_code, 401)
        self.assertEqual(self._put(None, 3).status_code, 401)
        self.assertEqual(self._stored_amount(), 4)

    def test_secondary_key_still_works_on_other_plugin_routes(self) -> None:
        from src.skins.auth import require_plugin_key

        require_plugin_key(DEV)  # does not raise

    def test_secondary_asset_uploads_are_ignored(self) -> None:
        for path in (
            "/characters/plugin/kit-skins/journal_skin",
            "/characters/plugin/wardrobe-templates/masked",
        ):
            res = self.client.put(path, content=b"not-a-png", headers={"X-Plugin-Key": DEV})
            self.assertEqual(res.status_code, 200, path)
            self.assertTrue(res.json()["ignored"], path)

    # The drinks catalogue lives in Postgres.
    @pytest.mark.usefixtures("postgres")
    def test_secondary_skins_and_drinks_catalog_pushes_are_ignored(self) -> None:
        from src.api.drinks_routes import drinks_router
        from src.api.skins_routes import skins_router
        from src.skins.catalog import get_catalog as get_skins_catalog
        from src.skins.drinks import get_drink_catalog

        app = FastAPI()
        app.include_router(skins_router)
        app.include_router(drinks_router)
        client = TestClient(app)

        before_skins = get_skins_catalog()
        before_drinks = get_drink_catalog()

        res = client.put(
            "/skins/plugin/catalog",
            json={"categories": [], "scrolls": []},
            headers={"X-Plugin-Key": DEV},
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ignored"])
        self.assertEqual(get_skins_catalog(), before_skins)

        res = client.put(
            "/drinks/plugin/catalog",
            json={"categories": {}, "ingredients": []},
            headers={"X-Plugin-Key": DEV},
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ignored"])
        self.assertEqual(get_drink_catalog(), before_drinks)

        res = client.put(
            "/drinks/plugin/assets/glass_bottle.png",
            content=b"not-a-png",
            headers={"X-Plugin-Key": DEV},
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ignored"])

    def test_no_secondary_keys_configured_keeps_single_key_behaviour(self) -> None:
        with mock.patch.dict("os.environ", {"PLUGIN_KEYS_SECONDARY": ""}):
            self.assertEqual(self._put(DEV, 3).status_code, 401)
            self.assertEqual(self._put(PRIMARY, 4).status_code, 200)
        self.assertEqual(self._stored_amount(), 4)


if __name__ == "__main__":
    unittest.main()
