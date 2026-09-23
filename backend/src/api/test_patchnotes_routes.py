"""Route tests for the patch notes API (database fully mocked)."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

os.environ.setdefault("SKINS_DEV", "1")

import psycopg2  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server import app  # noqa: E402
from src.patchnotes.db import BulletNotFound, BulletNotPending, PatchnotesDBError  # noqa: E402

_HEADERS = {"X-Staff-Key": "dev-staff-key"}
_CREATED = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)
_BULLET_ID = "11111111-1111-1111-1111-111111111111"


def _row(**overrides):
    row = {
        "id": _BULLET_ID,
        "week": "2026-W39",
        "section": "new",
        "body": "Added a station",
        "status": "pending",
        "deny_reason": None,
        "created_at": _CREATED,
        "reviewed_at": None,
    }
    row.update(overrides)
    return row


class PatchnotesRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    def test_staff_routes_require_auth(self) -> None:
        self.assertEqual(self.client.post("/patchnotes/staff/bullets", json={}).status_code, 401)
        self.assertEqual(self.client.get("/patchnotes/staff/queue").status_code, 401)
        self.assertEqual(
            self.client.post(f"/patchnotes/staff/bullets/{_BULLET_ID}/approve").status_code, 401
        )
        self.assertEqual(
            self.client.post(
                f"/patchnotes/staff/bullets/{_BULLET_ID}/deny", json={"reason": "no"}
            ).status_code,
            401,
        )

    def test_bad_staff_key_does_not_fall_through_to_session(self) -> None:
        res = self.client.get(
            "/patchnotes/staff/queue", headers={"X-Staff-Key": "wrong-key"}
        )
        self.assertEqual(res.status_code, 401)

    @mock.patch("src.api.patchnotes_routes.insert_bullet", return_value=_row())
    def test_create_pending_bullet(self, mock_insert) -> None:
        res = self.client.post(
            "/patchnotes/staff/bullets",
            json={"section": "new", "body": "Added a station", "week": "2026-W39"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "pending")
        self.assertIsNone(body["deny_reason"])
        mock_insert.assert_called_once_with(
            section="new", body="Added a station", week="2026-W39"
        )

    def test_create_rejects_unknown_section(self) -> None:
        res = self.client.post(
            "/patchnotes/staff/bullets",
            json={"section": "secret", "body": "nope"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 422)

    def test_create_rejects_a_bad_week(self) -> None:
        res = self.client.post(
            "/patchnotes/staff/bullets",
            json={"section": "fixed", "body": "Fixed a crash", "week": "this-week"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 422)

    @mock.patch("src.api.patchnotes_routes.list_pending", return_value=[_row()])
    def test_queue_returns_pending_bullets(self, mock_list) -> None:
        res = self.client.get("/patchnotes/staff/queue?week=2026-W39", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["bullets"][0]["id"], _BULLET_ID)
        self.assertNotIn("warning", res.json()["bullets"][0])
        mock_list.assert_called_once_with("2026-W39")

    @mock.patch(
        "src.api.patchnotes_routes.list_pending",
        return_value=[_row(body="Moved a lore item")],
    )
    def test_queue_warns_when_a_line_names_a_lore_item(self, _mock_list) -> None:
        res = self.client.get("/patchnotes/staff/queue", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        warning = res.json()["bullets"][0]["warning"]
        self.assertIn("hidden knowledge", warning)

    def test_queue_rejects_a_bad_week(self) -> None:
        res = self.client.get("/patchnotes/staff/queue?week=nope", headers=_HEADERS)
        self.assertEqual(res.status_code, 400)

    @mock.patch(
        "src.api.patchnotes_routes.require_site_staff",
        return_value={"player_uuid": "staff-uuid"},
    )
    @mock.patch("src.api.patchnotes_routes.list_pending", return_value=[])
    def test_queue_accepts_a_site_staff_session(self, _mock_list, mock_staff) -> None:
        res = self.client.get(
            "/patchnotes/staff/queue", headers={"Authorization": "Bearer sess-token"}
        )
        self.assertEqual(res.status_code, 200)
        mock_staff.assert_called_once_with("Bearer sess-token")

    @mock.patch(
        "src.api.patchnotes_routes.approve_bullet",
        return_value=_row(status="approved", reviewed_at=_CREATED),
    )
    def test_approve(self, mock_approve) -> None:
        res = self.client.post(f"/patchnotes/staff/bullets/{_BULLET_ID}/approve", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "approved")
        mock_approve.assert_called_once_with(_BULLET_ID)

    @mock.patch(
        "src.api.patchnotes_routes.deny_bullet",
        return_value=_row(status="denied", deny_reason="Internal only", reviewed_at=_CREATED),
    )
    def test_deny_stores_the_reason(self, mock_deny) -> None:
        res = self.client.post(
            f"/patchnotes/staff/bullets/{_BULLET_ID}/deny",
            json={"reason": "Internal only"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["deny_reason"], "Internal only")
        mock_deny.assert_called_once_with(_BULLET_ID, "Internal only")

    def test_deny_requires_a_reason(self) -> None:
        res = self.client.post(
            f"/patchnotes/staff/bullets/{_BULLET_ID}/deny",
            json={"reason": "   "},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 422)

    @mock.patch(
        "src.api.patchnotes_routes.approve_bullet",
        side_effect=BulletNotFound(_BULLET_ID),
    )
    def test_approve_missing_bullet(self, mock_approve) -> None:
        res = self.client.post(f"/patchnotes/staff/bullets/{_BULLET_ID}/approve", headers=_HEADERS)
        self.assertEqual(res.status_code, 404)
        mock_approve.assert_called_once_with(_BULLET_ID)

    @mock.patch(
        "src.api.patchnotes_routes.approve_bullet",
        side_effect=psycopg2.OperationalError("connection lost"),
    )
    def test_database_error_during_review_is_unavailable(self, _mock_approve) -> None:
        res = self.client.post(f"/patchnotes/staff/bullets/{_BULLET_ID}/approve", headers=_HEADERS)
        self.assertEqual(res.status_code, 502)
        self.assertNotIn("connection lost", res.json()["detail"])

    @mock.patch("src.api.patchnotes_routes.approve_bullet")
    def test_malformed_bullet_id_is_not_found(self, mock_approve) -> None:
        res = self.client.post("/patchnotes/staff/bullets/bullet-1/approve", headers=_HEADERS)
        self.assertEqual(res.status_code, 404)
        mock_approve.assert_not_called()

    @mock.patch(
        "src.api.patchnotes_routes.deny_bullet",
        side_effect=BulletNotPending("approved"),
    )
    def test_deny_already_reviewed(self, _mock_deny) -> None:
        res = self.client.post(
            f"/patchnotes/staff/bullets/{_BULLET_ID}/deny",
            json={"reason": "too late"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 409)

    @mock.patch(
        "src.api.patchnotes_routes.list_pending",
        side_effect=PatchnotesDBError("down"),
    )
    def test_database_failure(self, _mock_list) -> None:
        res = self.client.get("/patchnotes/staff/queue", headers=_HEADERS)
        self.assertEqual(res.status_code, 502)
        self.assertNotIn("down", res.json()["detail"])

    @mock.patch(
        "src.api.patchnotes_routes.list_published_notes",
        return_value=(
            [
                {
                    "week": "2026-W39",
                    "bullets": [
                        _row(status="approved", deny_reason="should not leak", reviewed_at=_CREATED)
                    ],
                }
            ],
            True,
        ),
    )
    def test_published_notes_are_one_public_payload(self, mock_notes) -> None:
        res = self.client.get("/patchnotes?limit=1&before=2026-W40")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        bullet = body["weeks"][0]["bullets"][0]
        self.assertEqual(bullet["body"], "Added a station")
        self.assertNotIn("deny_reason", bullet)
        self.assertNotIn("status", bullet)
        self.assertTrue(body["has_more"])
        mock_notes.assert_called_once_with(limit=1, before="2026-W40")

    def test_published_notes_reject_an_unbounded_limit(self) -> None:
        res = self.client.get("/patchnotes?limit=1000", headers=_HEADERS)
        self.assertEqual(res.status_code, 400)

    @mock.patch("src.api.patchnotes_routes.list_published_weeks", return_value=["2026-W39"])
    def test_published_weeks_need_no_auth(self, _mock_weeks) -> None:
        res = self.client.get("/patchnotes/weeks")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["weeks"], ["2026-W39"])

    @mock.patch(
        "src.api.patchnotes_routes.list_approved",
        return_value=[
            _row(
                status="approved",
                deny_reason="should not leak",
                reviewed_at=_CREATED,
            )
        ],
    )
    def test_published_week_hides_review_fields(self, mock_list) -> None:
        res = self.client.get("/patchnotes/weeks/2026-W39")
        self.assertEqual(res.status_code, 200)
        bullet = res.json()["bullets"][0]
        self.assertEqual(bullet["body"], "Added a station")
        self.assertNotIn("deny_reason", bullet)
        self.assertNotIn("status", bullet)
        self.assertNotIn("reviewed_at", bullet)
        self.assertNotIn("warning", bullet)
        mock_list.assert_called_once_with("2026-W39")

    def test_published_week_rejects_a_bad_week(self) -> None:
        res = self.client.get("/patchnotes/weeks/nope")
        self.assertEqual(res.status_code, 400)


def _signed_push(message: str, secret: str = "hook-secret") -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(
        {
            "ref": "refs/heads/main",
            "repository": {
                "name": "Gathering",
                "full_name": "TF-Minecraft/Gathering",
                "default_branch": "main",
            },
            "commits": [{"id": "a" * 40, "message": message, "distinct": True}],
        }
    ).encode()
    digest = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {
        "X-Hub-Signature-256": f"sha256={digest}",
        "X-GitHub-Event": "push",
        "Content-Type": "application/json",
    }


class GithubWebhookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    def test_missing_secret_is_unavailable(self) -> None:
        with mock.patch.dict("os.environ", {"GITHUB_WEBHOOK_SECRET": ""}, clear=False):
            res = self.client.post("/patchnotes/github", content=b"{}")
        self.assertEqual(res.status_code, 503)

    @mock.patch.dict("os.environ", {"GITHUB_WEBHOOK_SECRET": "hook-secret"})
    def test_bad_signature_is_rejected(self) -> None:
        res = self.client.post(
            "/patchnotes/github",
            content=b"{}",
            headers={"X-Hub-Signature-256": "sha256=" + ("0" * 64), "X-GitHub-Event": "push"},
        )
        self.assertEqual(res.status_code, 401)

    @mock.patch.dict("os.environ", {"GITHUB_WEBHOOK_SECRET": "hook-secret"})
    @mock.patch("src.api.patchnotes_routes.insert_sourced_bullet", return_value=_row())
    def test_push_creates_a_pending_bullet_without_a_staff_key(self, mock_insert) -> None:
        raw, headers = _signed_push("feat: Added a grove")
        res = self.client.post("/patchnotes/github", content=raw, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["created"], 1)
        mock_insert.assert_called_once_with(
            section="new",
            body="Gathering: Added a grove",
            source_key="TF-Minecraft/Gathering@" + ("a" * 40),
        )

    @mock.patch.dict("os.environ", {"GITHUB_WEBHOOK_SECRET": "hook-secret"})
    @mock.patch("src.api.patchnotes_routes.insert_sourced_bullet")
    def test_lore_and_other_branches_are_not_stored(self, mock_insert) -> None:
        raw, headers = _signed_push("feat: Moved a lore item")
        res = self.client.post("/patchnotes/github", content=raw, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["created"], 0)
        self.assertEqual(res.json()["withheld"], 1)
        mock_insert.assert_not_called()

        payload = json.loads(raw)
        payload["ref"] = "refs/heads/dev"
        raw = json.dumps(payload).encode()
        digest = hmac.new(b"hook-secret", raw, hashlib.sha256).hexdigest()
        headers["X-Hub-Signature-256"] = f"sha256={digest}"
        res = self.client.post("/patchnotes/github", content=raw, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ignored"])
        mock_insert.assert_not_called()
