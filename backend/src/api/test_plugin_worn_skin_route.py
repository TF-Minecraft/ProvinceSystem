"""GET /characters/plugin/wardrobe/{uuid}/{id}/worn gives the selector the worn skin and changes nothing."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pytest
from PIL import Image

from src import database

pytestmark = pytest.mark.usefixtures("postgres")

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

        # Point every loaded copy of the db module at the temporary asset directories.
        paths = {
            "DATA_DIR": self.root,
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
        self.db.ensure_directories()

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

        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_roster (
                    player_uuid, realm_id, character_id, name, status, updated_at, wardrobe_active_slot
                ) VALUES (%s, 'main', %s, 'Test', 'ALIVE', %s, 'extra_1')
                """,
                (PLAYER, CHAR_ID, NOW),
            )

        app = FastAPI()
        app.include_router(characters_router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for p in reversed(self._patches):
            p.stop()
        for mod, values in self._orig:
            for name, value in values.items():
                setattr(mod, name, value)
        self.tmp.cleanup()

    def put_slot(self, slot: str, value: str | None, signature: str | None) -> Path:
        rel = f"wardrobe/{PLAYER}/{CHAR_ID}/{slot}.png"
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"png")
        with database.connect() as conn:
            conn.execute(
                """
                INSERT INTO character_wardrobe_slots (
                    player_uuid, character_id, slot, png_relpath, texture_value, texture_signature,
                    apply_pending, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, true, %s)
                """,
                (PLAYER, CHAR_ID, slot, rel, value, signature, NOW),
            )
        return path

    def state(self) -> tuple:
        with database.connect() as conn:
            roster = [tuple(r.values()) for r in conn.execute("SELECT * FROM character_roster ORDER BY character_id")]
            slots = [tuple(r.values()) for r in conn.execute("SELECT * FROM character_wardrobe_slots ORDER BY slot")]
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
        with database.connect() as conn:
            return conn.execute(
                "SELECT wardrobe_active_slot FROM character_roster WHERE character_id = %s", (CHAR_ID,)
            ).fetchone()["wardrobe_active_slot"]

    def slot_url(self, slot: str) -> str:
        return URL.removesuffix("worn") + "slots/" + slot

    def plushie_png(self, slot="base", colour=(100, 110, 120, 255)):
        path = self.put_slot(slot, "v-" + slot, "s-" + slot)
        image = Image.new("RGBA", (64, 64), colour)
        data = io.BytesIO()
        image.save(data, format="PNG")
        path.write_bytes(data.getvalue())
        return path

    def plushie(self, slot="base", source=None, key=KEY):
        return self.client.post(self.slot_url(slot) + "/plushie",
                                json={"source": source},
                                headers={"X-Plugin-Key": key} if key else {})

    def test_plushie_starts_then_reuses_cached_texture_without_wardrobe_changes(self):
        from src.characters import wardrobe_plushie as plushie

        self.plushie_png()
        self.plushie_png("extra_1")
        before = self.state()
        with mock.patch.object(plushie, "sign_wardrobe_skin", return_value=("mini", "signed")) as signer:
            first = self.plushie()
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["status"], "pending")
            self.assertIsNone(first.json()["value"])
            source = first.json()["source"]
            ready = self.plushie(source=source)
            self.assertEqual(ready.json(), {
                "character_id": CHAR_ID, "slot": "base", "status": "ready",
                "source": source, "value": "mini", "signature": "signed",
            })
            with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
                self.assertEqual(self.plushie("extra_1").json()["value"], "mini")
            signer.assert_called_once()
        self.assertEqual(self.state(), before)

    def test_plushie_needs_auth_ownership_unlocked_and_signed_selected_outfit(self):
        from src.characters import wardrobe_plushie as plushie

        self.plushie_png()
        self.plushie_png("extra_1")
        with mock.patch.object(plushie, "sign_wardrobe_skin") as signer:
            self.assertEqual(self.plushie(key=None).status_code, 401)
            self.assertEqual(self.plushie(key="wrong").status_code, 401)
            other = self.slot_url("base").replace(PLAYER, "other") + "/plushie"
            self.assertEqual(self.client.post(other, headers={"X-Plugin-Key": KEY}).status_code, 403)
            self.assertEqual(self.plushie("masked").status_code, 400)
            self.assertEqual(self.plushie("extra_1").status_code, 403)
            with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=3):
                self.assertEqual(self.plushie("extra_2").status_code, 409)
                with database.connect() as conn:
                    conn.execute("UPDATE character_wardrobe_slots SET texture_signature = NULL WHERE slot = 'extra_1'")
                self.assertEqual(self.plushie("extra_1").status_code, 409)
            signer.assert_not_called()

    def test_plushie_rejects_changed_source_and_rechecks_slot_access_when_ready(self):
        from src.characters import wardrobe_plushie as plushie

        path = self.plushie_png("extra_1")
        with mock.patch.object(plushie, "sign_wardrobe_skin", return_value=("mini", "signed")):
            with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
                first = self.plushie("extra_1").json()
                self.assertEqual(first["status"], "pending")
            self.assertEqual(self.plushie("extra_1", first["source"]).status_code, 403)
            # Change pixels in the saved PNG after the generation snapshot.
            image = Image.open(path).convert("RGBA")
            image.putpixel((8, 9), (1, 2, 3, 255))
            image.save(path)
            with mock.patch.object(self.wardrobe, "swappable_slot_count", return_value=2):
                self.assertEqual(self.plushie("extra_1", first["source"]).status_code, 409)

    def test_plushie_signing_failure_is_reported_and_retry_is_bounded(self):
        from src.characters import wardrobe_plushie as plushie

        self.plushie_png()
        with mock.patch.object(plushie, "sign_wardrobe_skin", side_effect=self.wardrobe.WardrobeError("Too many skin requests", status_code=429)) as signer:
            pending = self.plushie().json()
            self.assertEqual(pending["status"], "pending")
            self.assertEqual(self.plushie(source=pending["source"]).status_code, 429)
            self.assertEqual(self.plushie().status_code, 429)
            signer.assert_called_once()
        failed = plushie._cached(plushie._cache_path(pending["source"]))
        with mock.patch.object(plushie.time, "time", return_value=failed["retry_at"] + 1):
            with mock.patch.object(plushie, "sign_wardrobe_skin", return_value=("mini", "signed")):
                self.assertEqual(self.plushie().json()["status"], "pending")
                self.assertEqual(self.plushie().json()["status"], "ready")

    def test_plushie_missing_or_invalid_png_never_borrows_another_skin(self):
        path = self.plushie_png()
        self.assertEqual(self.plushie(source="bad").status_code, 422)
        path.write_bytes(b"invalid")
        self.assertEqual(self.plushie().status_code, 409)
        path.unlink()
        self.assertEqual(self.plushie().status_code, 404)

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
