"""GET /characters/plugin/wardrobe/{uuid}/{id}/worn gives the selector the worn skin and changes nothing."""

from __future__ import annotations

import gc
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from fastapi import FastAPI
from fastapi.testclient import TestClient

KEY = "plugin-key"
NOW = "2026-01-01T00:00:00Z"
PLAYER = "worn-player"
CHAR_ID = "char-worn"
URL = f"/characters/plugin/wardrobe/{PLAYER}/{CHAR_ID}/worn"


class PluginWornSkinTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.tmp.name)

        import src.skins.db  # noqa: F401  (make sure at least one copy is loaded)

        # Point every loaded copy of the db module at the temp database.
        paths = {
            "DATA_DIR": self.root,
            "DB_PATH": self.root / "province.db",
            "SKINS_DIR": self.root / "skins",
            "DRINKS_DIR": self.root / "drinks",
            "WARDROBE_DIR": self.root / "wardrobe",
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
        self.db = self._orig[0][0]
        self.db.migrate()

        import src.characters.wardrobe as wardrobe
        from src.api.characters_routes import characters_router

        self.wardrobe = wardrobe
        # One swappable slot: extra_1 is locked, as after a rank downgrade.
        self.swappable = mock.patch.object(wardrobe, "swappable_slot_count", return_value=1)
        self._patches = [
            mock.patch.object(wardrobe, "DATA_DIR", self.root),
            mock.patch.object(wardrobe, "WARDROBE_DIR", self.root / "wardrobe"),
            mock.patch.dict("os.environ", {"PLUGIN_KEY": KEY, "PLUGIN_KEYS_SECONDARY": ""}),
            self.swappable,
        ]
        for p in self._patches:
            p.start()

        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_roster (
                    player_uuid, realm_id, character_id, name, status, updated_at, wardrobe_active_slot
                ) VALUES (?, 'main', ?, 'Test', 'ALIVE', ?, 'extra_1')
                """,
                (PLAYER, CHAR_ID, NOW),
            )
            conn.commit()

        app = FastAPI()
        app.include_router(characters_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for p in reversed(self._patches):
            p.stop()
        for mod, values in self._orig:
            for name, value in values.items():
                setattr(mod, name, value)
        gc.collect()
        self.tmp.cleanup()

    def put_slot(self, slot: str, value: str | None, signature: str | None) -> Path:
        rel = f"wardrobe/{PLAYER}/{CHAR_ID}/{slot}.png"
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"png")
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_wardrobe_slots (
                    player_uuid, character_id, slot, png_relpath, texture_value, texture_signature,
                    apply_pending, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (PLAYER, CHAR_ID, slot, rel, value, signature, NOW),
            )
            conn.commit()
        return path

    def state(self) -> tuple:
        with self.db.connect() as conn:
            roster = [tuple(r) for r in conn.execute("SELECT * FROM character_roster ORDER BY character_id")]
            slots = [tuple(r) for r in conn.execute("SELECT * FROM character_wardrobe_slots ORDER BY slot")]
        files = sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*.png"))
        return roster, slots, files

    def get(self, url: str = URL, key: str | None = KEY):
        return self.client.get(url, headers={"X-Plugin-Key": key} if key else {})

    def test_needs_the_plugin_key(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        self.assertEqual(self.get(key=None).status_code, 401)
        self.assertEqual(self.get(key="wrong").status_code, 401)

    def test_other_players_and_unknown_characters_are_refused(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        self.assertEqual(self.get(f"/characters/plugin/wardrobe/someone-else/{CHAR_ID}/worn").status_code, 403)
        self.assertEqual(self.get(f"/characters/plugin/wardrobe/{PLAYER}/no-such-char/worn").status_code, 403)

    def test_empty_wardrobe_has_no_texture(self) -> None:
        res = self.get()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"character_id": CHAR_ID, "value": None, "signature": None})

    def test_unlocked_active_slot_is_worn(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        self.put_slot("extra_1", "v-extra", "s-extra")
        with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
            res = self.get()
        self.assertEqual(res.json(), {"character_id": CHAR_ID, "value": "v-extra", "signature": "s-extra"})

    def test_locked_active_slot_falls_back_to_base_and_keeps_the_wardrobe(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        extra = self.put_slot("extra_1", "v-extra", "s-extra")
        self.put_slot("masked", "v-masked", "s-masked")
        before = self.state()

        res = self.get()

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"character_id": CHAR_ID, "value": "v-base", "signature": "s-base"})
        # Unlike the wardrobe pull, nothing is enforced, saved, acked or deleted.
        self.assertEqual(self.state(), before)
        self.assertTrue(extra.is_file())
        self.assertEqual(self._active(), "extra_1")

    def test_unsigned_worn_skin_has_no_texture(self) -> None:
        self.put_slot("base", "v-base", None)
        res = self.get()
        self.assertEqual(res.json(), {"character_id": CHAR_ID, "value": None, "signature": None})

    def test_unsigned_active_slot_does_not_borrow_base(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        self.put_slot("extra_1", "v-extra", None)
        with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
            res = self.get()
        self.assertEqual(res.json(), {"character_id": CHAR_ID, "value": None, "signature": None})

    def _active(self) -> str | None:
        with self.db.connect() as conn:
            return conn.execute(
                "SELECT wardrobe_active_slot FROM character_roster WHERE character_id = ?", (CHAR_ID,)
            ).fetchone()[0]

    def slot_url(self, slot: str) -> str:
        return URL.removesuffix("worn") + "slots/" + slot

    def test_selected_outfit_is_read_without_equipping_or_acknowledging(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        self.put_slot("extra_1", "v-extra", "s-extra")
        self.put_slot("masked", "v-masked", "s-masked")
        before = self.state()
        with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=3):
            res = self.get(self.slot_url("extra_1"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {
            "character_id": CHAR_ID, "slot": "extra_1", "value": "v-extra", "signature": "s-extra",
        })
        self.assertEqual(self.state(), before)

    def test_locked_or_masked_slots_are_refused_without_changing_data(self) -> None:
        self.put_slot("extra_1", "v-extra", "s-extra")
        before = self.state()
        self.assertEqual(self.get(self.slot_url("extra_1")).status_code, 403)
        for slot in ("masked", "unknown"):
            self.assertEqual(self.get(self.slot_url(slot)).status_code, 400)
        self.assertEqual(self.state(), before)

    def test_missing_and_unsigned_outfits_do_not_borrow_another_skin(self) -> None:
        self.put_slot("base", "v-base", "s-base")
        self.put_slot("extra_1", "v-extra", None)
        with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=3):
            for slot in ("extra_1", "extra_2"):
                res = self.get(self.slot_url(slot))
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json(), {
                    "character_id": CHAR_ID, "slot": slot, "value": None, "signature": None,
                })

    def test_selected_slot_requires_plugin_auth_and_matching_owner(self) -> None:
        self.assertEqual(self.get(self.slot_url("base"), key=None).status_code, 401)
        self.assertEqual(self.get(self.slot_url("base"), key="wrong").status_code, 401)
        self.assertEqual(self.get(self.slot_url("base").replace(PLAYER, "other")).status_code, 403)
        self.assertEqual(self.get(self.slot_url("base").replace(CHAR_ID, "unknown")).status_code, 403)


if __name__ == "__main__":
    unittest.main()
