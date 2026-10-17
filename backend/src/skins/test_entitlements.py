"""Unit tests for 3D pair budgets and entitlement resolution."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

import pytest

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from src.skins.size_limits import SizeLimitError, assert_3d_pair_budgets  # noqa: E402
from src.skins.catalog import _normalize_entitlements  # noqa: E402
from src.auth import testing  # noqa: E402
from src.skins import codes  # noqa: E402


class SizeLimitsTest(unittest.TestCase):
    def test_item_3d_ok(self) -> None:
        assert_3d_pair_budgets(
            "item_3d",
            {"texture": b"x" * 100, "model": b"y" * 100},
            30720,
        )

    def test_item_3d_over(self) -> None:
        with self.assertRaises(SizeLimitError) as ctx:
            assert_3d_pair_budgets(
                "item_3d",
                {"texture": b"x" * 20000, "model": b"y" * 20000},
                30720,
            )
        self.assertIn("40000", str(ctx.exception))
        self.assertIn("30720", str(ctx.exception))

    def test_gun_checks_each_model(self) -> None:
        tex = b"t" * 10000
        ok = b"m" * 1000
        over = b"m" * 25000
        with self.assertRaises(SizeLimitError) as ctx:
            assert_3d_pair_budgets(
                "gun",
                {
                    "texture": tex,
                    "carry_model": ok,
                    "reload_model": over,
                    "aim_model": ok,
                },
                30720,
            )
        self.assertIn("gun/reload_model", str(ctx.exception))

    def test_armor_helmet_tiers(self) -> None:
        with self.assertRaises(SizeLimitError):
            assert_3d_pair_budgets(
                "armor_set",
                {
                    "iron_helmet_texture": b"x" * 20000,
                    "iron_helmet_model": b"y" * 20000,
                },
                30720,
                helmet_3d_tiers=["iron"],
            )

    def test_handheld_noop(self) -> None:
        assert_3d_pair_budgets("handheld", {"texture": b"x" * 99999}, 1)


class EntitlementsTest(unittest.TestCase):
    def test_normalize_allows_negative_cooldown(self) -> None:
        out = _normalize_entitlements(
            {
                "defaults": {
                    "name_colour_stops": 0,
                    "max_3d_pair_bytes": 30720,
                    "skin_token_cooldown_days": -1,
                    "skin_kinds": ["handheld"],
                    "allow_armor_3d_helmet": False,
                },
                "groups": [
                    {
                        "id": "noble",
                        "tier": 1,
                        "skin_token_cooldown_days": 28,
                        "skin_kinds": ["book", "bow"],
                    }
                ],
            }
        )
        self.assertEqual(out["defaults"]["skin_token_cooldown_days"], -1)
        self.assertEqual(out["groups"][0]["skin_kinds"], ["book", "bow"])



@pytest.mark.usefixtures("postgres")
class MintCooldownTest(unittest.TestCase):
    """TFMCWeb owns the shared cosmetic mint cooldown."""

    def setUp(self) -> None:
        patch = mock.patch("src.skins.discord_link.get_identity_status", return_value={"eligible": True})
        patch.start()
        self.addCleanup(patch.stop)

    def mint(self, scope: str, created_at: str) -> None:
        testing.execute(
            "INSERT INTO login_codes (code_hash, player_uuid, scope, created_at, expires_at) "
            "VALUES (%s, 'player-1', %s, %s, '2099-01-01T00:00:00Z')",
            (f"hash-{scope}-{created_at}", scope, created_at),
        )

    def test_issue_skin_ignores_rank_disallow_meta(self) -> None:
        result = codes.issue_code("player-1", "skin")
        self.assertEqual(result["scope"], "skin")
        self.assertIn("code", result)
        self.assertEqual(testing.value("SELECT scope FROM login_codes WHERE code_plaintext = %s", (result["code"],)), "skin")

    def test_staff_scope_still_issues(self) -> None:
        result = codes.issue_code("player-1", "skin_staff")
        self.assertEqual(result["scope"], "skin_staff")
        self.assertIn("code", result)

    def test_issue_skin_ignores_days_gate(self) -> None:
        self.mint("skin", "2026-01-15T12:00:00Z")
        result = codes.issue_code("player-1", "skin")
        self.assertEqual(result["scope"], "skin")
        self.assertEqual(testing.value("SELECT COUNT(*) FROM login_codes"), 2)

    def test_issue_drink_scope(self) -> None:
        result = codes.issue_code("player-1", "drink")
        self.assertEqual(result["scope"], "drink")
        self.assertIn("code", result)

    def test_cosmetic_mint_status_none(self) -> None:
        out = codes.get_cosmetic_mint_status("player-1")
        self.assertIsNone(out["last_mint_at"])
        self.assertEqual(out["player_uuid"], "player-1")

    def test_cosmetic_mint_status_shared_max(self) -> None:
        self.mint("skin", "2026-01-10T08:00:00Z")
        self.mint("drink", "2026-01-15T12:00:00Z")
        self.mint("profile", "2026-01-20T12:00:00Z")
        out = codes.get_cosmetic_mint_status("player-1")
        self.assertEqual(out["last_mint_at"], "2026-01-15T12:00:00Z")

    def test_cosmetic_mint_status_respects_reset(self) -> None:
        self.mint("skin", "2026-01-15T12:00:00Z")
        testing.execute("INSERT INTO cosmetic_mint_resets (player_uuid, reset_at) VALUES ('player-1', %s)",
                        ("2026-02-01T00:00:00Z",))
        self.assertIsNone(codes.get_cosmetic_mint_status("player-1")["last_mint_at"])
        self.mint("drink", "2026-02-03T00:00:00Z")
        self.assertEqual(codes.get_cosmetic_mint_status("PLAYER-1")["last_mint_at"], "2026-02-03T00:00:00Z")

    def test_reset_cosmetic_mint_cooldowns(self) -> None:
        self.mint("skin", "2026-01-15T12:00:00Z")
        out = codes.reset_cosmetic_mint_cooldowns("player-1", "staff-9")
        self.assertTrue(out["ok"])
        self.assertEqual(out["player_uuid"], "player-1")
        self.assertRegex(out["reset_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(testing.rows("SELECT player_uuid, staff_uuid FROM cosmetic_mint_resets"),
                         [{"player_uuid": "player-1", "staff_uuid": "staff-9"}])
        self.assertIsNone(codes.get_cosmetic_mint_status("player-1")["last_mint_at"])


if __name__ == "__main__":
    unittest.main()
