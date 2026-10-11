"""Profile routes that start skins and drinks."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from fastapi import HTTPException

from src.api import profile_routes

SESSION = {"player_uuid": "p-1", "realm_id": "dev", "scope": "profile"}


class StartRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.object(
            profile_routes, "_profile_session_from_auth", return_value=SESSION
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_starts_in_the_profile_realm(self) -> None:
        with mock.patch.object(
            profile_routes, "start_site_session", return_value={"session_token": "t"}
        ) as start:
            self.assertEqual(profile_routes.post_start_drink("Bearer x"), {"session_token": "t"})
        start.assert_called_once_with("p-1", "dev", "drink")

    def test_refusals_say_why_and_until_when(self) -> None:
        refused = profile_routes.SiteStartRefused("cooldown", "2026-11-01T00:00:00Z")
        with mock.patch.object(profile_routes, "start_site_session", side_effect=refused):
            with self.assertRaises(HTTPException) as caught:
                profile_routes.post_start_skin("Bearer x")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(
            caught.exception.detail,
            {"reason": "cooldown", "next_at": "2026-11-01T00:00:00Z"},
        )


class CodeWardrobeTest(unittest.TestCase):
    def wardrobe(self, scope: str, open_: bool = True) -> dict:
        session = {**SESSION, "scope": scope, "code_id": 7}
        with mock.patch.object(profile_routes, "get_session", return_value=session), \
                mock.patch.object(profile_routes, "code_session_open", return_value=open_), \
                mock.patch.object(profile_routes, "list_submissions_for_player", return_value=["s"]) as skins, \
                mock.patch.object(profile_routes, "list_drink_submissions_for_player", return_value=["d"]) as drinks:
            out = profile_routes.get_code_wardrobe("Bearer x")
        if out["kind"] == "skin":
            skins.assert_called_once_with("p-1", "dev")
            drinks.assert_not_called()
        else:
            drinks.assert_called_once_with("p-1", "dev")
            skins.assert_not_called()
        return out

    def test_a_code_shows_only_its_own_wardrobe(self) -> None:
        self.assertEqual(self.wardrobe("skin")["items"], ["s"])
        self.assertEqual(self.wardrobe("skin_staff")["kind"], "skin")
        self.assertEqual(self.wardrobe("drink")["items"], ["d"])

    def test_a_used_code_cannot_start_another(self) -> None:
        self.assertEqual(
            self.wardrobe("skin", open_=False)["can_start"],
            {"can_start": False, "reason": "used", "next_at": None},
        )
        self.assertTrue(self.wardrobe("drink")["can_start"]["can_start"])

    def test_profile_sessions_and_strangers_are_refused(self) -> None:
        with mock.patch.object(profile_routes, "get_session", return_value=SESSION):
            with self.assertRaises(HTTPException) as caught:
                profile_routes.get_code_wardrobe("Bearer x")
        self.assertEqual(caught.exception.status_code, 403)
        with mock.patch.object(profile_routes, "get_session", return_value=None):
            with self.assertRaises(HTTPException) as caught:
                profile_routes.get_code_wardrobe("Bearer x")
        self.assertEqual(caught.exception.status_code, 401)


class SignInRedeemTest(unittest.TestCase):
    def test_bad_codes_are_a_400(self) -> None:
        with mock.patch.object(
            profile_routes, "redeem_sign_in_code", side_effect=profile_routes.CodeError("Invalid code")
        ):
            with self.assertRaises(HTTPException) as caught:
                profile_routes.post_redeem(profile_routes.SignInCodeBody(code="x"))
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(caught.exception.detail, "Invalid code")


if __name__ == "__main__":
    unittest.main()
