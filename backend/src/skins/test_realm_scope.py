"""Unit tests for realm-scoped creates, roster, and apply queues."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pytest

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src import database  # noqa: E402

pytestmark = pytest.mark.usefixtures("postgres")


class RealmScopeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.db_path = root / "province.db"

        import src.skins.db as db_mod

        self._db_mod = db_mod

        self._orig_drinks = db_mod.DRINKS_DIR
        self._orig_data = db_mod.DATA_DIR
        self._orig_skins = db_mod.SKINS_DIR
        self._orig_wardrobe = db_mod.WARDROBE_DIR
        db_mod.DATA_DIR = root
        db_mod.DRINKS_DIR = root / "drinks"
        db_mod.SKINS_DIR = root / "skins"
        db_mod.WARDROBE_DIR = root / "wardrobe"
        db_mod.ensure_directories()

    def tearDown(self) -> None:
        db_mod = self._db_mod
        db_mod.DRINKS_DIR = self._orig_drinks
        db_mod.DATA_DIR = self._orig_data
        db_mod.SKINS_DIR = self._orig_skins
        db_mod.WARDROBE_DIR = self._orig_wardrobe
        self.tmp.cleanup()

    def test_list_pending_filters_by_realm(self) -> None:
        from src.characters import creates as creates_mod

        with mock.patch.object(
            creates_mod,
            "require_synced_creation_catalog",
            return_value={},
        ), mock.patch.object(
            creates_mod,
            "_validate_and_normalize",
            return_value={"client_request_id": None, "name": "DevChar"},
        ):
            creates_mod.create_character(
                "player-scope-1",
                {"name": "DevChar"},
                realm_id="dev",
            )
        with mock.patch.object(
            creates_mod,
            "require_synced_creation_catalog",
            return_value={},
        ), mock.patch.object(
            creates_mod,
            "_validate_and_normalize",
            return_value={"client_request_id": None, "name": "MainChar"},
        ):
            creates_mod.create_character(
                "player-scope-1",
                {"name": "MainChar"},
                realm_id="main",
            )

        main_pending = creates_mod.list_pending("main")
        self.assertEqual(len(main_pending), 1)
        payload = main_pending[0]["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        self.assertEqual(payload.get("name"), "MainChar")

        dev_pending = creates_mod.list_pending("dev")
        self.assertEqual(len(dev_pending), 1)
        payload = dev_pending[0]["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        self.assertEqual(payload.get("name"), "DevChar")

    def test_replace_roster_does_not_wipe_other_realm(self) -> None:
        from src.characters.roster import list_roster, replace_roster

        uuid = "player-scope-2"
        replace_roster(
            uuid,
            [{"id": "main-char", "name": "MainHero", "status": "ALIVE"}],
            realm_id="main",
        )
        replace_roster(
            uuid,
            [{"id": "tut-char", "name": "TutHero", "status": "ALIVE"}],
            realm_id="tutorial",
        )
        replace_roster(
            uuid,
            [{"id": "tut-char-2", "name": "TutHero2", "status": "ALIVE"}],
            realm_id="tutorial",
        )

        main = list_roster(uuid, "main")
        tut = list_roster(uuid, "tutorial")
        self.assertEqual([c["id"] for c in main], ["main-char"])
        self.assertEqual([c["id"] for c in tut], ["tut-char-2"])

    def test_list_for_player_scopes_pending_and_roster(self) -> None:
        from src.characters import creates as creates_mod
        from src.characters.roster import replace_roster

        uuid = "player-scope-3"
        replace_roster(
            uuid,
            [{"id": "main-r", "name": "MainR", "status": "ALIVE"}],
            realm_id="main",
        )
        replace_roster(
            uuid,
            [{"id": "dev-r", "name": "DevR", "status": "ALIVE"}],
            realm_id="dev",
        )
        with mock.patch.object(
            creates_mod,
            "require_synced_creation_catalog",
            return_value={},
        ), mock.patch.object(
            creates_mod,
            "_validate_and_normalize",
            return_value={"client_request_id": None, "name": "DevPending"},
        ):
            creates_mod.create_character(
                uuid,
                {"name": "DevPending"},
                realm_id="dev",
            )
        with mock.patch.object(
            creates_mod,
            "require_synced_creation_catalog",
            return_value={},
        ), mock.patch.object(
            creates_mod,
            "_validate_and_normalize",
            return_value={"client_request_id": None, "name": "MainPending"},
        ):
            creates_mod.create_character(
                uuid,
                {"name": "MainPending"},
                realm_id="main",
            )

        with mock.patch(
            "src.characters.rpc_player_meta.resolve_web_entitlements",
            return_value={
                "name_colour_stops": 0,
                "wardrobe_skin_slots": 1,
                "meta_synced": False,
                "permission_flags": {},
                "kit_cooldown_seconds_remaining": 0,
                "kit_cooldown_hours": 0,
                "kit_cooldowns": {},
            },
        ), mock.patch(
            "src.characters.creation_catalog.get_catalog",
            return_value={"slot_limits": {}, "validation": {}},
        ):
            listed = creates_mod.list_for_player(uuid, "dev")

        self.assertEqual(listed["realm_id"], "dev")
        ids = {c["id"] for c in listed["characters"]}
        self.assertIn("dev-r", ids)
        self.assertNotIn("main-r", ids)
        names = {c.get("name") for c in listed["characters"]}
        self.assertIn("DevPending", names)
        self.assertNotIn("MainPending", names)

    def test_skin_pending_apply_filtered_by_realm(self) -> None:
        from src.skins.submissions import list_approved_pending_apply

        with database.connect() as conn:
            code_id = conn.execute(
                """
                INSERT INTO codes (
                    code_hash, player_uuid, scope, realm_id,
                    created_at, expires_at
                )
                VALUES ('hash-skin-1', 'p-skin', 'skin', 'dev',
                        '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z')
                RETURNING id
                """
            ).fetchone()["id"]
            for sid, realm in (("sub-main", "main"), ("sub-dev", "dev")):
                conn.execute(
                    """
                    INSERT INTO submissions (
                        id, player_uuid, code_id, kind, slug, display_name,
                        status, dir_path, created_at, reviewed_at, applied_at,
                        realm_id
                    )
                    VALUES (%s, 'p-skin', %s, 'weapon', %s, %s,
                            'approved', %s, '2020-01-01T00:00:00Z',
                            '2020-01-02T00:00:00Z', NULL, %s)
                    """,
                    (
                        sid,
                        code_id,
                        f"slug-{sid}",
                        f"Name {sid}",
                        f"/tmp/{sid}",
                        realm,
                    ),
                )

        main = list_approved_pending_apply(realm_id="main")
        dev = list_approved_pending_apply(realm_id="dev")
        self.assertEqual([r["id"] for r in main], ["sub-main"])
        self.assertEqual([r["id"] for r in dev], ["sub-dev"])

    def test_drink_pending_apply_filtered_by_realm(self) -> None:
        from src.skins.drinks import list_drinks_pending_apply

        with database.connect() as conn:
            code_id = conn.execute(
                """
                INSERT INTO codes (
                    code_hash, player_uuid, scope, realm_id,
                    created_at, expires_at
                )
                VALUES ('hash-drink-1', 'p-drink', 'drink', 'tutorial',
                        '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z')
                RETURNING id
                """
            ).fetchone()["id"]
            for did, realm in (("drink-main", "main"), ("drink-tut", "tutorial")):
                conn.execute(
                    """
                    INSERT INTO drink_submissions (
                        id, player_uuid, code_id, slug, display_name,
                        recipe_json, status, dir_path, created_at,
                        reviewed_at, applied_at, realm_id
                    )
                    VALUES (%s, 'p-drink', %s, %s, %s, '{}',
                            'approved', %s, '2020-01-01T00:00:00Z',
                            '2020-01-02T00:00:00Z', NULL, %s)
                    """,
                    (
                        did,
                        code_id,
                        f"slug-{did}",
                        f"Name {did}",
                        f"/tmp/{did}",
                        realm,
                    ),
                )

        main = list_drinks_pending_apply("main")
        tut = list_drinks_pending_apply("tutorial")
        self.assertEqual([r["id"] for r in main], ["drink-main"])
        self.assertEqual([r["id"] for r in tut], ["drink-tut"])

    def test_rpc_player_meta_isolated_by_realm(self) -> None:
        from src.characters.rpc_player_meta import (
            get_rpc_player_meta,
            resolve_web_entitlements,
            upsert_rpc_player_meta,
        )

        upsert_rpc_player_meta(
            {
                "player_uuid": "meta-player",
                "realm_id": "main",
                "name_colour_stops": 2,
            }
        )
        upsert_rpc_player_meta(
            {
                "player_uuid": "meta-player",
                "realm_id": "dev",
                "name_colour_stops": 8,
            }
        )
        main = get_rpc_player_meta("meta-player", "main")
        dev = get_rpc_player_meta("meta-player", "dev")
        assert main is not None and dev is not None
        self.assertEqual(main["name_colour_stops"], 2)
        self.assertEqual(dev["name_colour_stops"], 8)
        self.assertEqual(
            resolve_web_entitlements("meta-player", realm_id="dev")[
                "name_colour_stops"
            ],
            8,
        )

    def test_slug_taken_allows_same_slug_across_realms(self) -> None:
        from src.skins.submissions import slug_taken

        with database.connect() as conn:
            code_id = conn.execute(
                """
                INSERT INTO codes (
                    code_hash, player_uuid, scope, realm_id,
                    created_at, expires_at
                )
                VALUES ('hash-slug-x', 'p-slug', 'skin', 'main',
                        '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z')
                RETURNING id
                """
            ).fetchone()["id"]
            conn.execute(
                """
                INSERT INTO submissions (
                    id, player_uuid, code_id, kind, slug, display_name,
                    status, dir_path, created_at, realm_id
                )
                VALUES (
                    'shared_slug', 'p-slug', %s, 'weapon', 'shared_slug', 'Shared',
                    'approved', '/tmp/shared', '2020-01-01T00:00:00Z', 'main'
                )
                """,
                (code_id,),
            )

        self.assertTrue(slug_taken("shared_slug", "main"))
        self.assertFalse(slug_taken("shared_slug", "dev"))

    def test_lore_pending_filtered_by_realm(self) -> None:
        from src.characters.lore_items import list_pending_for_plugin

        with database.connect() as conn:
            for cid, realm in (("char-main", "main"), ("char-dev", "dev")):
                conn.execute(
                    """
                    INSERT INTO lore_item_customisations (
                        player_uuid, character_id, kit_key, display_name,
                        lore_json, state, ready_at, updated_at, realm_id
                    )
                    VALUES (
                        'p-lore', %s, 'starter', 'Sword', '[]',
                        'ready', '2020-01-02T00:00:00Z', '2020-01-02T00:00:00Z', %s
                    )
                    """,
                    (cid, realm),
                )

        main = list_pending_for_plugin("main")
        dev = list_pending_for_plugin("dev")
        self.assertEqual([r["character_id"] for r in main], ["char-main"])
        self.assertEqual([r["character_id"] for r in dev], ["char-dev"])

    def test_character_name_clash_only_within_realm(self) -> None:
        from src.characters.roster import replace_roster

        replace_roster(
            "p-name",
            [{"id": "c1", "name": "SharedName", "status": "ALIVE"}],
            realm_id="main",
        )
        with database.connect() as conn:
            main_clash = conn.execute(
                """
                SELECT 1 FROM character_roster
                WHERE realm_id = %s AND LOWER(name) = LOWER(%s)
                LIMIT 1
                """,
                ("main", "SharedName"),
            ).fetchone()
            tut_clash = conn.execute(
                """
                SELECT 1 FROM character_roster
                WHERE realm_id = %s AND LOWER(name) = LOWER(%s)
                LIMIT 1
                """,
                ("tutorial", "SharedName"),
            ).fetchone()
        self.assertIsNotNone(main_clash)
        self.assertIsNone(tut_clash)


if __name__ == "__main__":
    unittest.main()
