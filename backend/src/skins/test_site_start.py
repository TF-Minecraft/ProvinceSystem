"""Starting skins and drinks from Profile without an in-game code."""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import pytest
from PIL import Image

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src import database  # noqa: E402
from src.auth import testing  # noqa: E402

pytestmark = pytest.mark.usefixtures("postgres")

PLAYER = "11111111-2222-4333-8444-555555555555"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entitlements(days: int, synced: bool = True) -> dict:
    return {
        "name_colour_stops": 1,
        "max_3d_pair_bytes": 30720,
        "skin_token_cooldown_days": days,
        "skin_kinds": ["handheld"],
        "allow_armor_3d_helmet": False,
        "allow_drink_texture": False,
        "allow_drink_message": False,
        "meta_synced": synced,
    }


class _CodesDb(unittest.TestCase):
    """Empty code tables, with the start rules mocked."""

    def setUp(self) -> None:
        import src.skins.codes as codes_mod

        self.codes = codes_mod

        self.rules(days=21)

    def tearDown(self) -> None:
        mock.patch.stopall()

    def rules(self, days: int, synced: bool = True, eligible: bool = True) -> None:
        mock.patch.stopall()
        mock.patch(
            "src.skins.discord_link.get_identity_status",
            return_value={"eligible": eligible},
        ).start()
        mock.patch(
            "src.characters.rpc_player_meta.resolve_web_entitlements",
            return_value=_entitlements(days, synced),
        ).start()

    def add_code(self, scope: str, created: datetime, *, via: str | None = None,
                 expires: datetime | None = None, realm: str = "main") -> int:
        with database.connect() as conn:
            return conn.execute(
                """
                INSERT INTO codes (code_hash, code_plaintext, player_uuid, scope, realm_id,
                                   created_at, expires_at, revoked, minted_via)
                VALUES (%s, 'ABCD-EFGH-IJKL', %s, %s, %s, %s, %s, false, %s)
                RETURNING id
                """,
                (f"hash-{created.timestamp()}-{scope}-{via}", PLAYER, scope, realm,
                 _iso(created), _iso(expires or created + timedelta(hours=48)), via),
            ).fetchone()["id"]

    def consume(self, code_id: int) -> None:
        testing.execute(
            """
            INSERT INTO submissions (id, player_uuid, code_id, kind, slug, display_name,
                                     status, dir_path, created_at)
            VALUES (%s, %s, %s, 'handheld', 'x', 'X', 'pending', 'x', '2026-01-01T00:00:00Z')
            """,
            (f"sub-{code_id}", PLAYER, code_id),
        )


class SiteStartTest(_CodesDb):
    def test_first_start_records_a_site_code_and_opens_a_skin_session(self) -> None:
        out = self.codes.start_site_session(PLAYER, "main", "skin")
        self.assertEqual(out["scope"], "skin")
        self.assertEqual(out["skin_kinds"], ["handheld"])
        session = self.codes.get_session(out["session_token"])
        assert session is not None
        self.assertEqual(session["scope"], "skin")
        [row] = testing.rows("SELECT * FROM codes WHERE id = %s", (out["code_id"],))
        self.assertEqual(row["minted_via"], "site")
        self.assertIsNone(row["code_plaintext"])

    def test_starting_again_reuses_the_unused_code(self) -> None:
        first = self.codes.start_site_session(PLAYER, "main", "skin")
        second = self.codes.start_site_session(PLAYER, "main", "skin")
        self.assertEqual(first["code_id"], second["code_id"])
        self.assertIsNone(self.codes.get_session(first["session_token"]))

    def test_an_open_skin_code_holds_the_drink_clock(self) -> None:
        self.codes.start_site_session(PLAYER, "main", "skin")
        allowance = self.codes.site_start_allowance(PLAYER, "main")
        self.assertTrue(allowance["skin"]["can_start"])
        self.assertFalse(allowance["drink"]["can_start"])
        self.assertEqual(allowance["drink"]["reason"], "cooldown")
        with self.assertRaises(self.codes.SiteStartRefused) as caught:
            self.codes.start_site_session(PLAYER, "main", "drink")
        self.assertEqual(caught.exception.reason, "cooldown")
        self.assertEqual(caught.exception.next_at, allowance["drink"]["next_at"])

    def test_a_recent_token_create_mint_starts_the_cooldown(self) -> None:
        minted = datetime.now(timezone.utc) - timedelta(days=5)
        code_id = self.add_code("drink", minted)
        self.consume(code_id)
        with self.assertRaises(self.codes.SiteStartRefused) as caught:
            self.codes.start_site_session(PLAYER, "main", "skin")
        self.assertEqual(caught.exception.reason, "cooldown")
        self.assertEqual(caught.exception.next_at, _iso(minted + timedelta(days=21)))

    def test_an_unused_in_game_code_is_reused_instead_of_refused(self) -> None:
        code_id = self.add_code("skin", datetime.now(timezone.utc) - timedelta(hours=1))
        out = self.codes.start_site_session(PLAYER, "main", "skin")
        self.assertEqual(out["code_id"], code_id)

    def test_codes_from_another_realm_are_not_reused(self) -> None:
        self.add_code("skin", datetime.now(timezone.utc) - timedelta(hours=1), realm="dev")
        with self.assertRaises(self.codes.SiteStartRefused):
            self.codes.start_site_session(PLAYER, "main", "skin")

    def test_a_site_code_that_lapsed_unused_frees_the_clock(self) -> None:
        created = datetime.now(timezone.utc) - timedelta(days=3)
        self.add_code("skin", created, via="site", expires=created + timedelta(hours=48))
        self.assertIsNone(self.codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"])
        self.assertTrue(self.codes.site_start_allowance(PLAYER, "main")["skin"]["can_start"])

    def test_a_lapsed_site_code_counts_while_its_session_can_still_submit(self) -> None:
        created = datetime.now(timezone.utc) - timedelta(hours=49)
        code_id = self.add_code("drink", created, via="site", expires=created + timedelta(hours=48))
        testing.execute(
            "INSERT INTO sessions (token_hash, code_id, player_uuid, expires_at, created_at) "
            "VALUES ('h', %s, %s, %s, %s)",
            (code_id, PLAYER, _iso(datetime.now(timezone.utc) + timedelta(hours=6)), _iso(created)),
        )
        self.assertEqual(self.codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"], _iso(created))
        with self.assertRaises(self.codes.SiteStartRefused):
            self.codes.start_site_session(PLAYER, "main", "skin")

    def test_a_used_site_code_still_counts_after_it_expires(self) -> None:
        created = datetime.now(timezone.utc) - timedelta(days=3)
        code_id = self.add_code("skin", created, via="site", expires=created + timedelta(hours=48))
        self.consume(code_id)
        self.assertEqual(self.codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"], _iso(created))

    def test_expired_in_game_codes_still_count(self) -> None:
        created = datetime.now(timezone.utc) - timedelta(days=3)
        self.add_code("skin", created, expires=created + timedelta(hours=48))
        self.assertEqual(self.codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"], _iso(created))

    def test_a_staff_reset_clears_the_clock(self) -> None:
        self.add_code("skin", datetime.now(timezone.utc) - timedelta(days=2))
        self.codes.reset_cosmetic_mint_cooldowns(PLAYER, "staff")
        self.codes.start_site_session(PLAYER, "main", "drink")

    def test_no_wait_ranks_can_always_start(self) -> None:
        self.rules(days=0)
        code_id = self.add_code("skin", datetime.now(timezone.utc) - timedelta(hours=1))
        self.consume(code_id)
        self.codes.start_site_session(PLAYER, "main", "skin")

    def test_rules_that_refuse_a_start(self) -> None:
        for kwargs, reason in (
            ({"days": 21, "eligible": False}, "discord"),
            ({"days": 21, "synced": False}, "join_server"),
            ({"days": -1}, "rank"),
        ):
            with self.subTest(reason=reason):
                self.rules(**kwargs)
                allowance = self.codes.site_start_allowance(PLAYER, "main")
                self.assertEqual(allowance["skin"], {"can_start": False, "reason": reason, "next_at": None})
                with self.assertRaises(self.codes.SiteStartRefused) as caught:
                    self.codes.start_site_session(PLAYER, "main", "skin")
                self.assertEqual(caught.exception.reason, reason)
        self.assertEqual(testing.value("SELECT COUNT(*) FROM codes"), 0)

    def test_only_skins_and_drinks_can_be_started(self) -> None:
        with self.assertRaises(self.codes.CodeError):
            self.codes.start_site_session(PLAYER, "main", "profile")


class SignInCodeTest(_CodesDb):
    """Profile sign-in takes profile, skin and drink codes, each by its own rules."""

    def mint(self, scope: str, plaintext: str) -> int:
        now = datetime.now(timezone.utc)
        with database.connect() as conn:
            return conn.execute(
                """
                INSERT INTO codes (code_hash, code_plaintext, player_uuid, scope, realm_id,
                                   created_at, expires_at, revoked)
                VALUES (%s, %s, %s, %s, 'main', %s, %s, false)
                RETURNING id
                """,
                (self.codes.hash_secret(plaintext), plaintext, PLAYER, scope,
                 _iso(now), _iso(now + timedelta(hours=48))),
            ).fetchone()["id"]

    def test_each_scope_redeems_by_its_own_rules(self) -> None:
        for scope, plaintext in (("profile", "PROF-0001"), ("skin", "SKIN-0001"),
                                 ("skin_staff", "STAF-0001"), ("drink", "DRNK-0001")):
            with self.subTest(scope=scope):
                self.mint(scope, plaintext)
                out = self.codes.redeem_sign_in_code(f" {plaintext} ")
                self.assertEqual(out["scope"], scope)
                session = self.codes.get_session(out["session_token"])
                assert session is not None
                self.assertEqual(session["scope"], scope)
        self.assertIn("skin_kinds", self.codes.redeem_sign_in_code("SKIN-0001"))
        self.assertIn("allow_drink_texture", self.codes.redeem_sign_in_code("DRNK-0001"))

    def test_a_profile_code_still_redeems_once(self) -> None:
        self.mint("profile", "PROF-0002")
        self.codes.redeem_sign_in_code("PROF-0002", remember_me=True)
        with self.assertRaises(self.codes.CodeError):
            self.codes.redeem_sign_in_code("PROF-0002")

    def test_unknown_codes_are_refused(self) -> None:
        for plaintext in ("", "NOPE-0000"):
            with self.subTest(code=plaintext), self.assertRaises(self.codes.CodeError):
                self.codes.redeem_sign_in_code(plaintext)

    def test_redeeming_neither_mints_nor_moves_the_cooldown(self) -> None:
        self.mint("skin", "SKIN-0003")
        before = self.codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"]
        self.codes.redeem_sign_in_code("SKIN-0003")
        self.assertEqual(self.codes.get_cosmetic_mint_status(PLAYER)["last_mint_at"], before)
        self.assertEqual(testing.value("SELECT COUNT(*) FROM codes"), 1)

    def test_a_code_session_closes_once_its_code_is_used_or_revoked(self) -> None:
        code_id = self.mint("skin", "SKIN-0004")
        session = self.codes.get_session(self.codes.redeem_sign_in_code("SKIN-0004")["session_token"])
        assert session is not None
        self.assertTrue(self.codes.code_session_open(session))
        self.consume(code_id)
        self.assertFalse(self.codes.code_session_open(session))

        drink_id = self.mint("drink", "DRNK-0004")
        drink = self.codes.get_session(self.codes.redeem_sign_in_code("DRNK-0004")["session_token"])
        assert drink is not None
        self.assertTrue(self.codes.code_session_open(drink))
        testing.execute("UPDATE codes SET revoked = true WHERE id = %s", (drink_id,))
        self.assertFalse(self.codes.code_session_open(drink))


class SkinThumbnailTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        import src.skins.thumbnail as thumb_mod

        self.thumb = thumb_mod
        self._orig = thumb_mod.SKINS_DIR
        thumb_mod.SKINS_DIR = Path(self.tmp.name)
        self.dir = thumb_mod.SKINS_DIR / "sub1"
        self.dir.mkdir()

    def tearDown(self) -> None:
        self.thumb.SKINS_DIR = self._orig
        self.tmp.cleanup()

    def test_rendered_preview_loses_its_backdrop(self) -> None:
        im = Image.new("RGBA", (4, 4), (0x20, 0x20, 0x24, 255))
        im.putpixel((1, 1), (200, 10, 10, 255))
        im.save(self.dir / "preview_model.png")
        Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(self.dir / "blade.png")
        import io

        out = Image.open(io.BytesIO(self.thumb.skin_thumbnail("sub1", "blade")))
        self.assertEqual(out.size, (4, 4))
        self.assertEqual(out.getpixel((0, 0))[3], 0)
        self.assertEqual(out.getpixel((1, 1)), (200, 10, 10, 255))

    def test_falls_back_to_the_flat_texture(self) -> None:
        Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(self.dir / "blade_unsigned.png")
        self.assertEqual(
            self.thumb.skin_thumbnail("sub1", "blade"),
            (self.dir / "blade_unsigned.png").read_bytes(),
        )

    def test_nothing_to_show(self) -> None:
        self.assertIsNone(self.thumb.skin_thumbnail("sub1", "blade"))


if __name__ == "__main__":
    unittest.main()
