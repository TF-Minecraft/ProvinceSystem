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


if __name__ == "__main__":
    unittest.main()
