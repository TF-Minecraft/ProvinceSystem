"""Unit tests for 3D pair budgets and entitlement resolution."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from skins.size_limits import SizeLimitError, assert_3d_pair_budgets  # noqa: E402
from skins.catalog import _normalize_entitlements  # noqa: E402


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



class MintCooldownTest(unittest.TestCase):
    """TFMCWeb owns the shared cosmetic mint cooldown."""

    def test_issue_skin_ignores_rank_disallow_meta(self) -> None:
        from skins.codes import issue_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ), mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            result = issue_code("player-1", "skin")
        self.assertEqual(result["scope"], "skin")
        self.assertIn("code", result)

    def test_staff_scope_still_issues(self) -> None:
        from skins.codes import issue_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ), mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            result = issue_code("player-1", "skin_staff")
        self.assertEqual(result["scope"], "skin_staff")
        self.assertIn("code", result)

    def test_issue_skin_ignores_days_gate(self) -> None:
        from skins.codes import issue_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ), mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            result = issue_code("player-1", "skin")
        self.assertEqual(result["scope"], "skin")
        self.assertIn("code", result)

    def test_issue_drink_scope(self) -> None:
        from skins.codes import issue_code

        with mock.patch(
            "skins.discord_link.get_identity_status",
            return_value={"eligible": True},
        ), mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            result = issue_code("player-1", "drink")
        self.assertEqual(result["scope"], "drink")
        self.assertIn("code", result)

    def test_cosmetic_mint_status_none(self) -> None:
        from skins.codes import get_cosmetic_mint_status

        with mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            conn.execute.return_value.fetchone.side_effect = [
                {"reset_at": None},
                {"last_at": None},
            ]
            out = get_cosmetic_mint_status("player-1")
        self.assertIsNone(out["last_mint_at"])
        self.assertEqual(out["player_uuid"], "player-1")

    def test_cosmetic_mint_status_shared_max(self) -> None:
        from skins.codes import get_cosmetic_mint_status

        with mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            conn.execute.return_value.fetchone.side_effect = [
                {"reset_at": None},
                {"last_at": "2026-01-15T12:00:00Z"},
            ]
            out = get_cosmetic_mint_status("player-1")
        self.assertEqual(out["last_mint_at"], "2026-01-15T12:00:00Z")
        sql = conn.execute.call_args_list[1][0][0]
        self.assertIn("skin", sql.lower())
        self.assertIn("drink", sql.lower())

    def test_cosmetic_mint_status_respects_reset(self) -> None:
        from skins.codes import get_cosmetic_mint_status

        with mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            conn.execute.return_value.fetchone.side_effect = [
                {"reset_at": "2026-02-01T00:00:00Z"},
                {"last_at": None},
            ]
            out = get_cosmetic_mint_status("player-1")
        self.assertIsNone(out["last_mint_at"])
        sql = conn.execute.call_args_list[1][0][0]
        self.assertIn("created_at >", sql.lower())

    def test_reset_cosmetic_mint_cooldowns(self) -> None:
        from skins.codes import reset_cosmetic_mint_cooldowns

        with mock.patch("skins.codes.connect") as connect_mock:
            conn = mock.MagicMock()
            connect_mock.return_value.__enter__.return_value = conn
            out = reset_cosmetic_mint_cooldowns("player-1", "staff-9")
        self.assertTrue(out["ok"])
        self.assertEqual(out["player_uuid"], "player-1")
        self.assertIn("reset_at", out)
        args = conn.execute.call_args[0]
        self.assertIn("cosmetic_mint_resets", args[0])
        self.assertEqual(args[1][0], "player-1")
        self.assertEqual(args[1][2], "staff-9")
        conn.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
