"""Unit tests for one-time war declare codes."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src import database  # noqa: E402

pytestmark = pytest.mark.usefixtures("postgres")

ATTACKER = "faction-attacker"
DEFENDER = "faction-defender"


class WarDeclareCodesTest(unittest.TestCase):
    def _mint(self, **kwargs) -> dict:
        from wars.declare_codes import mint

        args = {
            "attacker_faction_id": ATTACKER,
            "defender_faction_id": DEFENDER,
            "goal": "subjugate",
        }
        args.update(kwargs)
        return mint(**args)

    def _expire(self, code_id: int) -> None:
        """Backdate expiry, since the TTL floor is one hour."""
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        with database.connect() as conn:
            conn.execute(
                "UPDATE war_declare_codes SET expires_at = %s WHERE id = %s",
                (past, code_id),
            )

    def test_mint_then_validate_then_redeem(self) -> None:
        from wars.declare_codes import redeem, validate

        minted = self._mint()
        self.assertTrue(minted["code"])
        self.assertEqual(minted["goal"], "subjugate")
        self.assertEqual(minted["realm_id"], "main")

        checked = validate(minted["code"], ATTACKER, DEFENDER)
        self.assertTrue(checked["valid"])
        self.assertEqual(checked["goal"], "subjugate")

        spent = redeem(minted["code"], ATTACKER, DEFENDER, war_id="7")
        self.assertTrue(spent["ok"])
        self.assertEqual(spent["war_id"], "7")

    def test_mint_never_stores_plaintext(self) -> None:
        minted = self._mint()
        with database.connect() as conn:
            row = conn.execute(
                "SELECT * FROM war_declare_codes WHERE id = %s",
                (minted["id"],),
            ).fetchone()
        # A lost code is revoked and reminted; there is nowhere to read it back from.
        self.assertNotIn("code_plaintext", row.keys())
        self.assertNotIn(minted["code"], str(tuple(row.values())))

    def test_validate_does_not_consume(self) -> None:
        from wars.declare_codes import validate

        minted = self._mint()
        for _ in range(3):
            self.assertTrue(validate(minted["code"], ATTACKER, DEFENDER)["valid"])
        # A navy-gate or goal-validator rejection inside declareWar must leave the
        # ticket spendable, which is the whole reason validate and redeem are split.
        self.assertEqual(len(self._outstanding()), 1)

    def test_second_redeem_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, redeem

        minted = self._mint()
        redeem(minted["code"], ATTACKER, DEFENDER, war_id="7")
        with self.assertRaises(WarDeclareCodeError) as caught:
            redeem(minted["code"], ATTACKER, DEFENDER, war_id="8")
        self.assertIn("already been used", str(caught.exception))

    def test_validate_after_redeem_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, redeem, validate

        minted = self._mint()
        redeem(minted["code"], ATTACKER, DEFENDER, war_id="7")
        with self.assertRaises(WarDeclareCodeError):
            validate(minted["code"], ATTACKER, DEFENDER)

    def test_expired_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, redeem, validate

        minted = self._mint()
        self._expire(minted["id"])
        with self.assertRaises(WarDeclareCodeError) as caught:
            validate(minted["code"], ATTACKER, DEFENDER)
        self.assertIn("expired", str(caught.exception))
        with self.assertRaises(WarDeclareCodeError):
            redeem(minted["code"], ATTACKER, DEFENDER)

    def test_revoked_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, revoke, validate

        minted = self._mint()
        revoked = revoke(minted["id"])
        self.assertTrue(revoked["ok"])
        with self.assertRaises(WarDeclareCodeError) as caught:
            validate(minted["code"], ATTACKER, DEFENDER)
        self.assertIn("revoked", str(caught.exception))

    def test_revoke_is_not_repeatable_and_not_cross_realm(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, revoke

        minted = self._mint()
        revoke(minted["id"])
        with self.assertRaises(WarDeclareCodeError):
            revoke(minted["id"])

        other = self._mint(realm_id="dev")
        with self.assertRaises(WarDeclareCodeError) as caught:
            revoke(other["id"])
        self.assertIn("No such war code", str(caught.exception))

    def test_revoke_after_redeem_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, redeem, revoke

        minted = self._mint()
        redeem(minted["code"], ATTACKER, DEFENDER, war_id="7")
        with self.assertRaises(WarDeclareCodeError):
            revoke(minted["id"])

    def test_wrong_attacker_or_defender_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, redeem, validate

        minted = self._mint()
        with self.assertRaises(WarDeclareCodeError) as caught:
            validate(minted["code"], "faction-bystander", DEFENDER)
        self.assertIn("not minted for your faction", str(caught.exception))
        with self.assertRaises(WarDeclareCodeError) as caught:
            validate(minted["code"], ATTACKER, "faction-bystander")
        self.assertIn("not minted against that faction", str(caught.exception))
        # A rejected pairing must not have spent the code either.
        with self.assertRaises(WarDeclareCodeError):
            redeem(minted["code"], DEFENDER, ATTACKER)
        self.assertTrue(validate(minted["code"], ATTACKER, DEFENDER)["valid"])

    def test_cross_realm_rejected(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, validate

        minted = self._mint(realm_id="dev")
        self.assertEqual(minted["realm_id"], "dev")
        self.assertTrue(validate(minted["code"], ATTACKER, DEFENDER, realm_id="dev")["valid"])
        # An omitted realm means main, so a dev code cannot be spent on the live realm.
        with self.assertRaises(WarDeclareCodeError):
            validate(minted["code"], ATTACKER, DEFENDER)
        with self.assertRaises(WarDeclareCodeError):
            validate(minted["code"], ATTACKER, DEFENDER, realm_id="main")

    def test_movement_origin_goal_refused_at_mint(self) -> None:
        from wars.declare_codes import WarDeclareCodeError

        for goal in ("overthrow", "change_law", "change_tax", "force_peace"):
            with self.assertRaises(WarDeclareCodeError) as caught:
                self._mint(goal=goal)
            self.assertIn("political movement", str(caught.exception))

    def test_every_declarable_goal_mints(self) -> None:
        from wars.declare_codes import DECLARABLE_GOALS

        self.assertEqual(len(DECLARABLE_GOALS), 9)
        for goal in DECLARABLE_GOALS:
            minted = self._mint(goal=goal)
            self.assertEqual(minted["goal"], goal)

    def test_unknown_goal_refused(self) -> None:
        from wars.declare_codes import WarDeclareCodeError

        with self.assertRaises(WarDeclareCodeError):
            self._mint(goal="conquer_everything")
        with self.assertRaises(WarDeclareCodeError):
            self._mint(goal="")

    def test_goal_is_case_insensitive_on_mint(self) -> None:
        self.assertEqual(self._mint(goal="  De_Jure_Annex ")["goal"], "de_jure_annex")

    def test_self_declaration_refused(self) -> None:
        from wars.declare_codes import WarDeclareCodeError

        with self.assertRaises(WarDeclareCodeError) as caught:
            self._mint(defender_faction_id=ATTACKER)
        self.assertIn("itself", str(caught.exception))

    def test_unknown_code_is_indistinguishable_from_a_foreign_one(self) -> None:
        from wars.declare_codes import WarDeclareCodeError, validate

        self._mint(realm_id="dev")
        with self.assertRaises(WarDeclareCodeError) as unknown:
            validate("AAAA-BBBB-CCCC", ATTACKER, DEFENDER)
        self.assertEqual(str(unknown.exception), "Invalid war code")

    def test_outstanding_list_is_realm_scoped_and_hides_the_code(self) -> None:
        from wars.declare_codes import redeem, revoke

        live = self._mint(goal="war", created_by_discord_id="staff-1")
        self._mint(realm_id="dev")
        spent = self._mint(goal="pillage")
        killed = self._mint(goal="tributary")
        stale = self._mint(goal="usurp")
        redeem(spent["code"], ATTACKER, DEFENDER, war_id="7")
        revoke(killed["id"])
        self._expire(stale["id"])

        rows = self._outstanding()
        self.assertEqual([row["id"] for row in rows], [live["id"]])
        self.assertEqual(rows[0]["goal"], "war")
        self.assertEqual(rows[0]["created_by_discord_id"], "staff-1")
        self.assertNotIn("code", rows[0])
        self.assertNotIn("code_hash", rows[0])

        self.assertEqual(len(self._outstanding(realm_id="dev")), 1)

    def test_outstanding_limit_is_capped(self) -> None:
        for _ in range(3):
            self._mint()
        self.assertEqual(len(self._outstanding(limit=2)), 2)
        self.assertEqual(len(self._outstanding(limit=9999)), 3)
        self.assertEqual(len(self._outstanding(limit=0)), 1)

    def test_ttl_bounds(self) -> None:
        from wars.declare_codes import WarDeclareCodeError

        with self.assertRaises(WarDeclareCodeError):
            self._mint(ttl_hours=0)
        with self.assertRaises(WarDeclareCodeError):
            self._mint(ttl_hours=721)
        self.assertTrue(self._mint(ttl_hours=1)["expires_at"])

    def test_invalid_realm_refused(self) -> None:
        from src.skins.codes import CodeError

        with self.assertRaises(CodeError):
            self._mint(realm_id="not a realm!")

    def _outstanding(self, **kwargs) -> list[dict]:
        from wars.declare_codes import list_outstanding

        return list_outstanding(**kwargs)


if __name__ == "__main__":
    unittest.main()
