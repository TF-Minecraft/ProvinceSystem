"""Unit tests for the plugin-key realm character wipe."""

from __future__ import annotations

import gc
import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

NOW = "2026-01-01T00:00:00Z"
PNG = b"\x89PNG\r\n\x1a\n-not-a-real-png"


class _CharacterDbFixture:
    """Temp-dir sqlite plus wardrobe files, shared by the wipe test cases."""

    def setUp(self) -> None:
        # connect() leaves connections for the GC, which keeps the db file open on
        # Windows until it runs.
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        self.root = root

        db_mod = importlib.import_module("src.skins.db")
        self._db_mod = db_mod
        # Character modules import src.skins.db - keep one module identity for tests.
        sys.modules["src.skins.db"] = db_mod
        self._orig_db = db_mod.DB_PATH
        self._orig_data = db_mod.DATA_DIR
        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DB_PATH = root / "province.db"
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.migrate()
        # Other fixtures reload codes; refresh the route's exception imports.
        importlib.reload(importlib.import_module("src.api.characters_routes"))

        # wardrobe.py binds DATA_DIR / WARDROBE_DIR at import, so png deletes need
        # the same override.
        wardrobe_mod = importlib.import_module("src.characters.wardrobe")
        self._wardrobe_mod = wardrobe_mod
        self._orig_w_data = wardrobe_mod.DATA_DIR
        self._orig_w_dir = wardrobe_mod.WARDROBE_DIR
        wardrobe_mod.DATA_DIR = root
        wardrobe_mod.WARDROBE_DIR = root / "wardrobe"

        self._seed()

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DB_PATH = self._orig_db
        db_mod.DATA_DIR = self._orig_data
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self._wardrobe_mod.DATA_DIR = self._orig_w_data
        self._wardrobe_mod.WARDROBE_DIR = self._orig_w_dir
        gc.collect()
        self.tmp.cleanup()

    # -- fixtures ---------------------------------------------------------

    def _write_png(self, relpath: str) -> Path:
        path = self.root / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(PNG)
        return path

    def _seed_character(self, conn, realm: str, uuid: str, cid: str) -> None:
        """Roster row plus one lore customisation and a wardrobe slot with a png."""
        conn.execute(
            """
            INSERT INTO character_roster (
                player_uuid, realm_id, character_id, name, status, updated_at
            ) VALUES (?, ?, ?, ?, 'ALIVE', ?)
            """,
            (uuid, realm, cid, f"Char {cid}", NOW),
        )
        conn.execute(
            """
            INSERT INTO lore_item_customisations (
                player_uuid, character_id, kit_key, updated_at, realm_id
            ) VALUES (?, ?, 'kit_a', ?, ?)
            """,
            (uuid, cid, NOW, realm),
        )
        slot_rel = f"wardrobe/{uuid}/{cid}/base.png"
        conn.execute(
            """
            INSERT INTO character_wardrobe_slots (
                player_uuid, character_id, slot, png_relpath, updated_at
            ) VALUES (?, ?, 'base', ?, ?)
            """,
            (uuid, cid, slot_rel, NOW),
        )
        self._write_png(slot_rel)

    def _seed_realm(self, conn, realm: str) -> None:
        """One character with wardrobe + lore, plus one pending create."""
        uuid = f"player-{realm}"
        create_id = f"create-{realm}"
        self._seed_character(conn, realm, uuid, f"char-{realm}")
        conn.execute(
            """
            INSERT INTO character_creates (
                id, player_uuid, payload, status, created_at, realm_id
            ) VALUES (?, ?, '{}', 'pending', ?, ?)
            """,
            (create_id, uuid, NOW, realm),
        )
        pending_rel = f"wardrobe/pending/{create_id}/base.png"
        conn.execute(
            """
            INSERT INTO character_create_wardrobe (
                create_id, slot, png_relpath, updated_at
            ) VALUES (?, 'base', ?, ?)
            """,
            (create_id, pending_rel, NOW),
        )
        self._write_png(pending_rel)
        conn.execute(
            """
            INSERT INTO rpc_player_meta (player_uuid, realm_id, updated_at)
            VALUES (?, ?, ?)
            """,
            (uuid, realm, NOW),
        )
        conn.execute(
            """
            INSERT INTO character_player_meta (
                player_uuid, max_alive_characters, updated_at
            ) VALUES (?, 3, ?)
            """,
            (uuid, NOW),
        )

    def _seed(self) -> None:
        from src.skins.db import connect

        with connect() as conn:
            self._seed_realm(conn, "main")
            self._seed_realm(conn, "dev")
            conn.commit()

    def _count(self, table: str, realm: str) -> int:
        from src.skins.db import connect

        if table in ("character_wardrobe_slots", "character_create_wardrobe"):
            raise AssertionError("table has no realm_id; count by key instead")
        with connect() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS n FROM {table} WHERE realm_id = ?",
                (realm,),
            ).fetchone()
        return int(row["n"])

    def _slot_rows(self, realm: str) -> int:
        from src.skins.db import connect

        with connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM character_wardrobe_slots "
                "WHERE player_uuid = ?",
                (f"player-{realm}",),
            ).fetchone()
        return int(row["n"])

    def _create_wardrobe_rows(self, realm: str) -> int:
        from src.skins.db import connect

        with connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM character_create_wardrobe "
                "WHERE create_id = ?",
                (f"create-{realm}",),
            ).fetchone()
        return int(row["n"])

    def _rows_for_character(self, table: str, character_id: str) -> int:
        from src.skins.db import connect

        with connect() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS n FROM {table} WHERE character_id = ?",
                (character_id,),
            ).fetchone()
        return int(row["n"])


class RealmWipeTest(_CharacterDbFixture, unittest.TestCase):
    def test_wipe_scopes_to_realm(self) -> None:
        from src.characters.realm_wipe import wipe_realm_character_data

        out = wipe_realm_character_data("main")

        self.assertEqual("main", out["realm_id"])
        self.assertEqual(
            {
                "character_wardrobe_slots": 1,
                "character_create_wardrobe": 1,
                "lore_item_customisations": 1,
                "character_roster": 1,
                "character_creates": 1,
            },
            out["deleted"],
        )
        self.assertEqual(5, out["total"])

        for table in ("character_roster", "character_creates",
                      "lore_item_customisations"):
            self.assertEqual(0, self._count(table, "main"), table)
            self.assertEqual(1, self._count(table, "dev"), table)
        self.assertEqual(0, self._slot_rows("main"))
        self.assertEqual(1, self._slot_rows("dev"))
        self.assertEqual(0, self._create_wardrobe_rows("main"))
        self.assertEqual(1, self._create_wardrobe_rows("dev"))

    def test_wipe_keeps_player_meta(self) -> None:
        from src.characters.realm_wipe import wipe_realm_character_data
        from src.skins.db import connect

        wipe_realm_character_data("main")

        self.assertEqual(1, self._count("rpc_player_meta", "main"))
        with connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM character_player_meta"
            ).fetchone()
        self.assertEqual(2, int(row["n"]))

    def test_wipe_deletes_wardrobe_pngs(self) -> None:
        from src.characters.realm_wipe import wipe_realm_character_data

        main_slot = self.root / "wardrobe/player-main/char-main/base.png"
        main_pending = self.root / "wardrobe/pending/create-main/base.png"
        dev_slot = self.root / "wardrobe/player-dev/char-dev/base.png"
        self.assertTrue(main_slot.is_file())

        out = wipe_realm_character_data("main")

        self.assertEqual(2, out["pngs_deleted"])
        self.assertFalse(main_slot.exists())
        self.assertFalse(main_pending.exists())
        self.assertTrue(dev_slot.is_file())

    def test_wipe_defaults_to_main(self) -> None:
        from src.characters.realm_wipe import wipe_realm_character_data

        out = wipe_realm_character_data(None)

        self.assertEqual("main", out["realm_id"])
        self.assertEqual(0, self._count("character_roster", "main"))
        self.assertEqual(1, self._count("character_roster", "dev"))

    def test_wipe_catches_slots_without_roster_row(self) -> None:
        """Applied create whose roster push never landed still gets wiped."""
        from src.characters.realm_wipe import wipe_realm_character_data
        from src.skins.db import connect

        with connect() as conn:
            conn.execute(
                "UPDATE character_creates SET character_id = ?, status = 'applied' "
                "WHERE id = ?",
                ("orphan-main", "create-main"),
            )
            conn.execute(
                """
                INSERT INTO character_wardrobe_slots (
                    player_uuid, character_id, slot, png_relpath, updated_at
                ) VALUES ('player-main', 'orphan-main', 'base', ?, ?)
                """,
                ("wardrobe/player-main/orphan-main/base.png", NOW),
            )
            conn.commit()

        out = wipe_realm_character_data("main")

        self.assertEqual(2, out["deleted"]["character_wardrobe_slots"])
        self.assertEqual(0, self._slot_rows("main"))

    def test_route_requires_plugin_key(self) -> None:
        from fastapi import HTTPException

        routes = importlib.import_module("src.api.characters_routes")

        with mock.patch.dict(os.environ, {"PLUGIN_KEY": "test-key"}):
            with self.assertRaises(HTTPException) as ctx:
                routes.plugin_wipe_realm_data(realm_id="main", x_plugin_key=None)
            self.assertEqual(401, ctx.exception.status_code)
            self.assertEqual(1, self._count("character_roster", "main"))

            out = routes.plugin_wipe_realm_data(
                realm_id="main", x_plugin_key="test-key"
            )
        self.assertEqual(5, out["total"])
        self.assertEqual(0, self._count("character_roster", "main"))

    def test_route_rejects_invalid_realm(self) -> None:
        from fastapi import HTTPException

        routes = importlib.import_module("src.api.characters_routes")

        with mock.patch.dict(os.environ, {"PLUGIN_KEY": "test-key"}):
            with self.assertRaises(HTTPException) as ctx:
                routes.plugin_wipe_realm_data(
                    realm_id="not a realm!", x_plugin_key="test-key"
                )
        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual(1, self._count("character_roster", "main"))


class DeleteCharactersTest(_CharacterDbFixture, unittest.TestCase):
    def _seed(self) -> None:
        from src.skins.db import connect

        super()._seed()
        # Second character on the same player: the keeper in a tagged wipe.
        with connect() as conn:
            self._seed_character(conn, "main", "player-main", "char-main-2")
            conn.commit()

    def _body(self, ids: list[str], realm: str | None = "main"):
        routes = importlib.import_module("src.api.characters_routes")
        return routes.PluginCharacterDeleteBody(character_ids=ids, realm_id=realm)

    def test_deletes_only_requested_ids(self) -> None:
        from src.characters.realm_wipe import delete_characters_for_realm

        gone_png = self.root / "wardrobe/player-main/char-main/base.png"
        keeper_png = self.root / "wardrobe/player-main/char-main-2/base.png"

        out = delete_characters_for_realm("main", ["char-main"])

        self.assertEqual("main", out["realm_id"])
        self.assertEqual(1, out["requested"])
        self.assertEqual(
            {
                "character_wardrobe_slots": 1,
                "lore_item_customisations": 1,
                "character_roster": 1,
            },
            out["deleted"],
        )
        self.assertEqual(3, out["total"])
        self.assertEqual(1, out["pngs_deleted"])

        for table in ("character_roster", "lore_item_customisations",
                      "character_wardrobe_slots"):
            self.assertEqual(0, self._rows_for_character(table, "char-main"), table)
            self.assertEqual(1, self._rows_for_character(table, "char-main-2"), table)
        self.assertFalse(gone_png.exists())
        self.assertTrue(keeper_png.is_file())

    def test_keeps_character_creates(self) -> None:
        from src.characters.realm_wipe import delete_characters_for_realm

        delete_characters_for_realm("main", ["char-main", "char-main-2"])

        self.assertEqual(1, self._count("character_creates", "main"))
        self.assertEqual(1, self._create_wardrobe_rows("main"))
        self.assertTrue(
            (self.root / "wardrobe/pending/create-main/base.png").is_file()
        )

    def test_scoped_to_realm(self) -> None:
        from src.characters.realm_wipe import delete_characters_for_realm

        out = delete_characters_for_realm("main", ["char-dev"])

        self.assertEqual(0, out["total"])
        for table in ("character_roster", "lore_item_customisations",
                      "character_wardrobe_slots"):
            self.assertEqual(1, self._rows_for_character(table, "char-dev"), table)
        self.assertTrue(
            (self.root / "wardrobe/player-dev/char-dev/base.png").is_file()
        )

    def test_unknown_and_blank_ids_are_noops(self) -> None:
        from src.characters.realm_wipe import delete_characters_for_realm

        out = delete_characters_for_realm("main", ["", "  ", "does-not-exist"])

        self.assertEqual(1, out["requested"])
        self.assertEqual(0, out["total"])
        self.assertEqual(0, out["pngs_deleted"])
        self.assertEqual(2, self._count("character_roster", "main"))

        empty = delete_characters_for_realm("main", [])
        self.assertEqual(0, empty["requested"])
        self.assertEqual(
            {
                "character_wardrobe_slots": 0,
                "lore_item_customisations": 0,
                "character_roster": 0,
            },
            empty["deleted"],
        )

    def test_route_requires_plugin_key(self) -> None:
        from fastapi import HTTPException

        routes = importlib.import_module("src.api.characters_routes")
        body = self._body(["char-main"])

        with mock.patch.dict(os.environ, {"PLUGIN_KEY": "test-key"}):
            with self.assertRaises(HTTPException) as ctx:
                routes.plugin_delete_characters(body=body, x_plugin_key=None)
            self.assertEqual(401, ctx.exception.status_code)
            self.assertEqual(2, self._count("character_roster", "main"))

            out = routes.plugin_delete_characters(
                body=body, x_plugin_key="test-key"
            )
        self.assertEqual(3, out["total"])
        self.assertEqual(1, self._count("character_roster", "main"))

    def test_route_rejects_invalid_realm(self) -> None:
        from fastapi import HTTPException

        routes = importlib.import_module("src.api.characters_routes")
        body = self._body(["char-main"], realm="not a realm!")

        with mock.patch.dict(os.environ, {"PLUGIN_KEY": "test-key"}):
            with self.assertRaises(HTTPException) as ctx:
                routes.plugin_delete_characters(body=body, x_plugin_key="test-key")
        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual(2, self._count("character_roster", "main"))


if __name__ == "__main__":
    unittest.main()
