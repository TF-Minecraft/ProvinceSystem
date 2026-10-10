"""Route tests for the precedent API (DB/embedding/synthesis calls fully mocked)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

import os

os.environ.setdefault("SKINS_DEV", "1")

from fastapi.testclient import TestClient  # noqa: E402

from server import app  # noqa: E402
import src.api.precedent_routes as routes  # noqa: E402

_HEADERS = {"X-Staff-Key": "dev-staff-key"}


class PrecedentRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        routes._SEARCH_RATE_BUCKETS.clear()
        patcher = mock.patch("src.api.precedent_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()
        routes._SEARCH_RATE_BUCKETS.clear()

    # --- auth ---

    def test_ping_no_auth(self) -> None:
        res = self.client.get("/precedent/staff/ping")
        self.assertEqual(res.status_code, 401)

    def test_bad_staff_key_does_not_fall_through_to_session(self) -> None:
        """A wrong key must fail, not silently retry as an unauthenticated session."""
        res = self.client.get(
            "/precedent/staff/cases", headers={"X-Staff-Key": "wrong-key"}
        )
        self.assertEqual(res.status_code, 401)

    # Staff panel (website account) auth is covered in src/auth/test_staff_tools.py.

    @mock.patch("src.api.precedent_routes.insert_case", return_value="new-id")
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.1])
    def test_bot_log_case_keeps_caller_supplied_logged_by(
        self, mock_embed, mock_insert
    ) -> None:
        res = self.client.post(
            "/precedent/staff/log",
            json={"logged_by": "WrenPlays", "summary": "s"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        _, kwargs = mock_insert.call_args
        self.assertEqual(kwargs.get("logged_by"), "WrenPlays")

    # --- list cases ---

    @mock.patch("src.api.precedent_routes.count_cases", return_value=42)
    @mock.patch(
        "src.api.precedent_routes.list_cases",
        return_value=[
            {
                "id": "1",
                "logged_by": "x",
                "players": [],
                "summary": "s",
                "rule": "",
                "ruling": "",
                "punishment": "",
                "created_at": None,
            }
        ],
    )
    def test_list_cases_returns_envelope_with_total(self, mock_list, mock_count) -> None:
        res = self.client.get("/precedent/staff/cases", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["total"], 42)
        self.assertEqual(body["cases"][0]["id"], "1")

    @mock.patch("src.api.precedent_routes.count_cases", return_value=0)
    @mock.patch("src.api.precedent_routes.list_cases", return_value=[])
    def test_list_cases_clamps_limit(self, mock_list, mock_count) -> None:
        res = self.client.get(
            "/precedent/staff/cases?limit=99999&offset=-5", headers=_HEADERS
        )
        self.assertEqual(res.status_code, 200)
        _, kwargs = mock_list.call_args
        self.assertEqual(kwargs.get("limit"), 1000)
        self.assertEqual(kwargs.get("offset"), 0)

    # --- update case ---

    @mock.patch("src.api.precedent_routes.update_case", return_value=True)
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.9])
    def test_update_case_reembeds_before_saving(self, mock_embed, mock_update) -> None:
        res = self.client.put(
            "/precedent/staff/case/1",
            json={"logged_by": "Staffer", "summary": "Edited summary"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"updated": True, "id": "1"})
        # The embedded text must be the NEW text, or the row rots out of search.
        self.assertIn("Edited summary", mock_embed.call_args.args[0])
        _, kwargs = mock_update.call_args
        self.assertEqual(kwargs.get("embedding"), [0.9])

    @mock.patch("src.api.precedent_routes.update_case", return_value=False)
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.9])
    def test_update_case_not_found(self, mock_embed, mock_update) -> None:
        res = self.client.put(
            "/precedent/staff/case/missing",
            json={"logged_by": "Staffer", "summary": "s"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 404)

    def test_update_case_rejects_oversized_summary(self) -> None:
        res = self.client.put(
            "/precedent/staff/case/1",
            json={"logged_by": "Staffer", "summary": "x" * 1001},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 422)

    # --- log case ---

    @mock.patch("src.api.precedent_routes.insert_case", return_value="new-id")
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.1])
    def test_log_case_success(self, mock_embed, mock_insert) -> None:
        res = self.client.post(
            "/precedent/staff/log",
            json={"logged_by": "Staffer", "summary": "s"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"id": "new-id"})

    @mock.patch("src.api.precedent_routes.insert_case", return_value="new-id")
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.1])
    def test_log_case_embeds_summary_only(self, mock_embed, mock_insert) -> None:
        """Queries are incident descriptions, so only the summary is indexed.

        Embedding the rule/ruling/punishment too filled the stored vector with
        text no query can contain, holding even exact matches away from the
        top of the similarity scale.
        """
        res = self.client.post(
            "/precedent/staff/log",
            json={
                "logged_by": "Staffer",
                "summary": "Used xray to find diamonds",
                "rule": "4.1",
                "ruling": "Upheld",
                "punishment": "10y",
            },
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        embedded = mock_embed.call_args.args[0]
        self.assertEqual(embedded, "Used xray to find diamonds")
        for leaked in ("4.1", "Upheld", "10y", "Rule:", "Punishment:"):
            self.assertNotIn(leaked, embedded)

    def test_log_case_rejects_oversized_summary(self) -> None:
        res = self.client.post(
            "/precedent/staff/log",
            json={"logged_by": "Staffer", "summary": "x" * 1001},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 422)

    def test_log_case_rejects_oversized_player(self) -> None:
        res = self.client.post(
            "/precedent/staff/log",
            json={"logged_by": "Staffer", "summary": "s", "players": ["x" * 201]},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 422)

    # --- search ---

    @mock.patch("src.api.precedent_routes.synthesize", return_value="synthesis text")
    @mock.patch("src.api.precedent_routes.search_similar", return_value=[])
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.1])
    def test_search_returns_max_distance(self, mock_embed, mock_search, mock_synth) -> None:
        res = self.client.post(
            "/precedent/staff/search", json={"query": "q"}, headers=_HEADERS
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["max_distance"], routes.MAX_RELEVANT_DISTANCE)

    @mock.patch("src.api.precedent_routes.synthesize", return_value="synthesis text")
    @mock.patch("src.api.precedent_routes.search_similar", return_value=[])
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.1])
    def test_search_forwards_players(self, mock_embed, mock_search, mock_synth) -> None:
        res = self.client.post(
            "/precedent/staff/search",
            json={"query": "q", "players": ["Alice"]},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        _, kwargs = mock_search.call_args
        self.assertEqual(kwargs.get("players"), ["Alice"])
        self.assertEqual(kwargs.get("query_text"), "q")

    @mock.patch("src.api.precedent_routes.synthesize", return_value="synthesis text")
    @mock.patch("src.api.precedent_routes.search_similar", return_value=[])
    @mock.patch("src.api.precedent_routes.embed", return_value=[0.1])
    def test_search_rate_limited(self, mock_embed, mock_search, mock_synth) -> None:
        for _ in range(routes._SEARCH_RATE_LIMIT):
            res = self.client.post(
                "/precedent/staff/search", json={"query": "q"}, headers=_HEADERS
            )
            self.assertEqual(res.status_code, 200)
        res = self.client.post(
            "/precedent/staff/search", json={"query": "q"}, headers=_HEADERS
        )
        self.assertEqual(res.status_code, 429)

    # --- get case ---

    @mock.patch("src.api.precedent_routes.get_case", return_value=None)
    def test_get_case_not_found(self, mock_get) -> None:
        res = self.client.get("/precedent/staff/case/missing", headers=_HEADERS)
        self.assertEqual(res.status_code, 404)

    @mock.patch(
        "src.api.precedent_routes.get_case",
        return_value={
            "id": "1",
            "logged_by": "x",
            "players": [],
            "summary": "s",
            "rule": "",
            "ruling": "",
            "punishment": "",
            "created_at": None,
        },
    )
    def test_get_case_success(self, mock_get) -> None:
        res = self.client.get("/precedent/staff/case/1", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], "1")

    # --- delete case ---

    @mock.patch("src.api.precedent_routes.delete_case", return_value=False)
    def test_delete_case_not_found(self, mock_delete) -> None:
        res = self.client.delete("/precedent/staff/case/missing", headers=_HEADERS)
        self.assertEqual(res.status_code, 404)

    @mock.patch("src.api.precedent_routes.delete_case", return_value=True)
    def test_delete_case_success(self, mock_delete) -> None:
        res = self.client.delete("/precedent/staff/case/1", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"deleted": True, "id": "1"})

    # --- ping ---

    @mock.patch("src.api.precedent_routes.ping_db")
    def test_ping_success(self, mock_ping) -> None:
        res = self.client.get("/precedent/staff/ping", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"ok": True})

    # --- database errors ---

    @mock.patch.dict("os.environ", {"SUPABASE_DB_URL": ""})
    def test_list_cases_without_database_says_not_set_up(self) -> None:
        res = self.client.get("/precedent/staff/cases", headers=_HEADERS)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["detail"], "Precedent isn't set up on this site.")

    @mock.patch(
        "src.api.precedent_routes.get_case",
        side_effect=routes.PrecedentDBError("could not connect: secret host"),
    )
    def test_database_down_is_503_without_details(self, mock_get) -> None:
        res = self.client.get("/precedent/staff/case/1", headers=_HEADERS)
        self.assertEqual(res.status_code, 503)
        self.assertNotIn("secret", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
