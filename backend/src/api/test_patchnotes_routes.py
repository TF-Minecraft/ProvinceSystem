"""Route tests for the patch notes API (database fully mocked)."""

from __future__ import annotations

import asyncio
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
from src.patchnotes.db import (  # noqa: E402
    BulletNotFound,
    BulletNotPending,
    PatchnotesDBError,
    WeekNotPostponed,
    WeekPostponed,
)

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


def _test_loop():
    """Keep TestClient responsive when the sandbox blocks socket wakeups."""
    loop = asyncio.new_event_loop()
    try:
        loop._csock.send(b"\0")
    except PermissionError:
        def tick():
            loop.call_later(0.01, tick)
        loop.call_soon(tick)
    return loop


class PatchnotesRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app, backend_options={"loop_factory": _test_loop})
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    def test_staff_routes_require_auth(self) -> None:
        self.assertEqual(self.client.post("/patchnotes/staff/bullets", json={}).status_code, 401)
        self.assertEqual(self.client.get("/patchnotes/staff/queue").status_code, 401)
        self.assertEqual(self.client.get("/patchnotes/staff/preview").status_code, 401)
        self.assertEqual(self.client.post("/patchnotes/staff/preview", json={}).status_code, 401)
        self.assertEqual(self.client.get("/patchnotes/staff/folders").status_code, 401)
        self.assertEqual(
            self.client.post("/patchnotes/staff/folders", json={"name": "Essentials"}).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(f"/patchnotes/staff/bullets/{_BULLET_ID}/approve").status_code, 401
        )
        self.assertEqual(
            self.client.post(
                f"/patchnotes/staff/bullets/{_BULLET_ID}/deny", json={"reason": "no"}
            ).status_code,
            401,
        )
        self.assertEqual(self.client.get(f"/patchnotes/staff/bullets/{_BULLET_ID}").status_code, 401)
        self.assertEqual(self.client.get("/patchnotes/staff/weeks/2026-W39").status_code, 401)
        self.assertEqual(self.client.post("/patchnotes/staff/weeks/2026-W39/postpone").status_code, 401)
        self.assertEqual(
            self.client.post("/patchnotes/staff/weeks/2026-W39/undo-postpone").status_code, 401
        )
        self.assertEqual(self.client.post("/patchnotes/staff/weeks/2026-W39/defer").status_code, 401)
        self.assertEqual(
            self.client.post("/patchnotes/staff/weeks/2026-W39/auto-approve").status_code, 401
        )
        self.assertEqual(
            self.client.post(
                "/patchnotes/staff/weeks/2026-W39/feedback",
                json={"feedback": "Make the soup line shorter."},
            ).status_code,
            401,
        )
        self.assertEqual(self.client.post("/patchnotes/staff/weeks/2026-W39/reset").status_code, 401)

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

    @mock.patch("src.api.patchnotes_routes.insert_sourced_bullet", return_value=None)
    def test_create_with_source_key_reports_a_duplicate(self, mock_insert) -> None:
        res = self.client.post(
            "/patchnotes/staff/bullets",
            json={
                "section": "adjusted",
                "body": "Adjusted the attack damage of Steel Sword",
                "source_key": "mmoitems:swords.yml:STEEL_SWORD:abc",
            },
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["duplicate"])
        mock_insert.assert_called_once_with(
            section="adjusted",
            body="Adjusted the attack damage of Steel Sword",
            source_key="mmoitems:swords.yml:STEEL_SWORD:abc",
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

    @mock.patch("src.api.patchnotes_routes.revise_denied_bullet", return_value=None)
    @mock.patch(
        "src.api.patchnotes_routes.deny_bullet",
        return_value=_row(status="denied", deny_reason="Internal only", reviewed_at=_CREATED),
    )
    def test_deny_stores_the_reason(self, mock_deny, _mock_revise) -> None:
        res = self.client.post(
            f"/patchnotes/staff/bullets/{_BULLET_ID}/deny",
            json={"reason": "Internal only"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["deny_reason"], "Internal only")
        self.assertIsNone(body["revision"])
        mock_deny.assert_called_once_with(_BULLET_ID, "Internal only")

    @mock.patch(
        "src.api.patchnotes_routes.revise_denied_bullet",
        return_value=_row(
            id="22222222-2222-2222-2222-222222222222",
            body="Added a station",
            revision_note="Don't mention the vault",
        ),
    )
    @mock.patch(
        "src.api.patchnotes_routes.deny_bullet",
        return_value=_row(status="denied", deny_reason="Don't mention the vault", reviewed_at=_CREATED),
    )
    def test_deny_returns_the_rewrite_without_putting_the_reason_in_the_body(
        self, _mock_deny, _mock_revise
    ) -> None:
        res = self.client.post(
            f"/patchnotes/staff/bullets/{_BULLET_ID}/deny",
            json={"reason": "Don't mention the vault"},
            headers=_HEADERS,
        )
        self.assertEqual(res.status_code, 200)
        revision = res.json()["revision"]
        self.assertEqual(revision["body"], "Added a station")
        self.assertEqual(revision["revision_note"], "Don't mention the vault")
        self.assertNotIn("vault", revision["body"])

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
        return_value=[_row(status="approved", body="Added evil RP sessions (#33)")],
    )
    def test_published_week_hides_pull_request_numbers(self, _mock_list) -> None:
        res = self.client.get("/patchnotes/weeks/2026-W39")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["bullets"][0]["body"], "Added evil RP sessions")

    @mock.patch(
        "src.api.patchnotes_routes.list_approved",
        return_value=[
            _row(
                status="approved",
                deny_reason="should not leak",
                reviewed_at=_CREATED,
                revision_note="staff only",
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
        self.assertNotIn("revision_note", bullet)
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
        self.client = TestClient(app, backend_options={"loop_factory": _test_loop})
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


class PreviewRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app, backend_options={"loop_factory": _test_loop})
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    @mock.patch("src.api.patchnotes_routes.list_pending", return_value=[])
    @mock.patch(
        "src.api.patchnotes_routes.list_approved",
        return_value=[_row(status="approved", body="Added a station")],
    )
    @mock.patch("src.api.patchnotes_routes.replace_preview")
    def test_preview_stores_the_week_without_review_fields(
        self, mock_replace, _approved, _pending
    ) -> None:
        mock_replace.return_value = {
            "week": "2026-W39",
            "expires_at": _CREATED,
            "bullets": [{"id": _BULLET_ID, "section": "new", "body": "Added a station"}],
        }
        res = self.client.post(
            "/patchnotes/staff/preview",
            headers=_HEADERS,
            json={"week": "2026-W39"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["week"], "2026-W39")
        self.assertNotIn("deny_reason", body)
        self.assertNotIn("status", body["bullets"][0])
        mock_replace.assert_called_once_with(
            week="2026-W39",
            bullets=[{"id": _BULLET_ID, "section": "new", "body": "Added a station"}],
        )

    @mock.patch("src.api.patchnotes_routes.load_preview", return_value=None)
    def test_missing_preview_is_not_found(self, _load) -> None:
        res = self.client.get("/patchnotes/staff/preview", headers=_HEADERS)
        self.assertEqual(res.status_code, 404)

    @mock.patch("src.api.patchnotes_routes.list_published_notes", return_value=([], False))
    def test_public_notes_do_not_read_the_preview(self, _notes) -> None:
        res = self.client.get("/patchnotes")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["weeks"], [])


class FolderRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app, backend_options={"loop_factory": _test_loop})
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    def test_a_path_is_not_a_folder_name(self) -> None:
        res = self.client.post(
            "/patchnotes/staff/folders",
            headers=_HEADERS,
            json={"name": "../TFMCDev01"},
        )
        self.assertEqual(res.status_code, 422)

    @mock.patch("src.api.patchnotes_routes.request_added_folder")
    def test_add_folder_is_pending_until_the_watcher_checks_it(self, mock_add) -> None:
        mock_add.return_value = {
            "name": "Essentials",
            "origin": "added",
            "repo": None,
            "status": "pending",
            "dangerous": False,
            "reject_reason": None,
            "rules": [],
            "unclassified": [],
        }
        res = self.client.post(
            "/patchnotes/staff/folders",
            headers=_HEADERS,
            json={"name": "Essentials"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "pending")
        self.assertEqual(res.json()["origin"], "added")

    @mock.patch("src.api.patchnotes_routes.current_week", return_value="2026-W39")
    @mock.patch("src.api.patchnotes_routes.insert_sourced_bullet", return_value=_row())
    def test_a_watch_note_is_once_per_plugin_per_week(self, mock_insert, _week) -> None:
        res = self.client.post(
            "/patchnotes/staff/bullets",
            headers=_HEADERS,
            json={
                "section": "adjusted",
                "body": "A dungeon was adjusted on the main server.",
                "source_key": "watch:MythicDungeons",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("MythicDungeons", res.json()["body"])
        mock_insert.assert_called_once()
        self.assertEqual(
            mock_insert.call_args.kwargs["source_key"],
            "watch:MythicDungeons:2026-W39",
        )


class WeekActionRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app, backend_options={"loop_factory": _test_loop})
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    @mock.patch(
        "src.api.patchnotes_routes.postpone_week",
        return_value={"week": "2026-W39", "postponed": True, "deferred_to": None},
    )
    def test_postpone(self, mock_postpone) -> None:
        res = self.client.post("/patchnotes/staff/weeks/2026-W39/postpone", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["postponed"])
        mock_postpone.assert_called_once_with("2026-W39")

    @mock.patch(
        "src.api.patchnotes_routes.defer_postponed_week",
        side_effect=WeekNotPostponed("2026-W39"),
    )
    def test_defer_requires_a_hold(self, _mock_defer) -> None:
        res = self.client.post("/patchnotes/staff/weeks/2026-W39/defer", headers=_HEADERS)
        self.assertEqual(res.status_code, 409)

    @mock.patch("src.api.patchnotes_routes.approve_pending_week", side_effect=WeekPostponed("2026-W39"))
    def test_auto_approve_refuses_a_postponed_week(self, _mock_approve) -> None:
        res = self.client.post("/patchnotes/staff/weeks/2026-W39/auto-approve", headers=_HEADERS)
        self.assertEqual(res.status_code, 409)

    @mock.patch("src.api.patchnotes_routes.approve_pending_week", return_value=3)
    def test_auto_approve_counts_lines(self, mock_approve) -> None:
        res = self.client.post("/patchnotes/staff/weeks/2026-W39/auto-approve", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["approved"], 3)
        mock_approve.assert_called_once_with("2026-W39")

    @mock.patch(
        "src.api.patchnotes_routes.reset_week",
        return_value={"week": "2026-W39", "removed": 1, "restored": 1},
    )
    def test_reset_restores_original_notes(self, mock_reset) -> None:
        res = self.client.post("/patchnotes/staff/weeks/2026-W39/reset", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["removed"], 1)
        self.assertEqual(res.json()["restored"], 1)
        mock_reset.assert_called_once_with("2026-W39")



_JOB_ID = "22222222-2222-2222-2222-222222222222"


def _job(**overrides):
    row = {
        "id": _JOB_ID, "week": "2026-W39", "kind": "feedback", "status": "queued",
        "feedback": "Shorten it.", "error": None, "changed": None,
        "created_at": _CREATED, "finished_at": None, "line_ids": [_BULLET_ID],
    }
    row.update(overrides)
    return row


class ReviewRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app, backend_options={"loop_factory": _test_loop})
        patcher = mock.patch("src.api.patchnotes_routes.migrate")
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    def test_new_routes_require_staff(self) -> None:
        routes = [
            ("get", "/staff/weeks"), ("get", "/staff/weeks/2026-W39/review"),
            ("post", "/staff/weeks/2026-W39/sort"), ("get", f"/staff/jobs/{_JOB_ID}"),
            ("post", "/staff/jobs/claim"), ("post", f"/staff/jobs/{_JOB_ID}/result"),
            ("patch", f"/staff/bullets/{_BULLET_ID}"),
            ("post", f"/staff/bullets/{_BULLET_ID}/drop"),
            ("post", f"/staff/bullets/{_BULLET_ID}/restore"),
        ]
        for method, path in routes:
            with self.subTest(path=path):
                self.assertEqual(getattr(self.client, method)("/patchnotes" + path).status_code, 401)

    @mock.patch("src.api.patchnotes_routes.current_week", return_value="2026-W40")
    @mock.patch("src.api.patchnotes_routes.list_review_weeks", return_value=[{
        "week": "2026-W39", "pending": 2, "approved": 1, "denied": 1, "postponed": True,
    }])
    def test_weeks_counts_and_current(self, _weeks, _current) -> None:
        res = self.client.get("/patchnotes/staff/weeks", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["current"], "2026-W40")
        self.assertEqual(res.json()["weeks"][0]["pending"], 2)

    @mock.patch("src.api.patchnotes_routes.get_week_status", return_value={
        "week": "2026-W39", "postponed": True, "deferred_to": "2026-W40",
    })
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row(status="approved")])
    @mock.patch("src.api.patchnotes_routes.list_denied", return_value=[_row(status="denied", deny_reason="Removed in review.")])
    @mock.patch("src.api.patchnotes_routes.latest_job", return_value=_job())
    def test_review_includes_open_removed_and_job(self, _job_mock, _denied, _open, _state) -> None:
        res = self.client.get("/patchnotes/staff/weeks/2026-W39/review", headers=_HEADERS)
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        self.assertEqual(payload["deferred_to"], "2026-W40")
        self.assertEqual(payload["bullets"][0]["status"], "approved")
        self.assertEqual(payload["removed"][0]["deny_reason"], "Removed in review.")
        self.assertEqual(payload["job"]["created_at"], _CREATED.isoformat())
        self.assertNotIn("line_ids", payload["job"])

    @mock.patch("src.api.patchnotes_routes.latest_job", return_value=None)
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row()])
    @mock.patch("src.api.patchnotes_routes.create_job")
    def test_feedback_and_sort_queue_jobs(self, create, _lines, _latest) -> None:
        for kind in ("feedback", "sort"):
            create.return_value = _job(kind=kind)
            args = {"json": {"feedback": "  Shorten it.  "}} if kind == "feedback" else {}
            res = self.client.post(f"/patchnotes/staff/weeks/2026-W39/{kind}", headers=_HEADERS, **args)
            self.assertEqual(res.status_code, 202)
            self.assertEqual(res.json()["job"]["status"], "queued")
            create.assert_called_with("2026-W39", kind, "Shorten it." if kind == "feedback" else None)

    @mock.patch("src.api.patchnotes_routes.latest_job")
    @mock.patch("src.api.patchnotes_routes.create_job")
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[])
    def test_queue_conflicts_and_empty_weeks(self, _lines, create, latest) -> None:
        for kind in ("feedback", "sort"):
            args = {"json": {"feedback": "Shorten it."}} if kind == "feedback" else {}
            for status in ("queued", "running"):
                latest.return_value = _job(status=status)
                res = self.client.post(f"/patchnotes/staff/weeks/2026-W39/{kind}", headers=_HEADERS, **args)
                self.assertEqual(res.status_code, 409)
                self.assertEqual(res.json()["detail"], "A rewrite is already running for this week.")
            latest.return_value = None
            res = self.client.post(f"/patchnotes/staff/weeks/2026-W39/{kind}", headers=_HEADERS, **args)
            self.assertEqual(res.status_code, 422)
            self.assertEqual(res.json()["detail"], "Nothing to rewrite for this week.")
        create.assert_not_called()

    @mock.patch("src.api.patchnotes_routes.latest_job", return_value=None)
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row()])
    @mock.patch("src.api.patchnotes_routes.create_job")
    def test_atomic_queue_conflict(self, create, _lines, _latest) -> None:
        from src.patchnotes.db import JobActive
        create.side_effect = JobActive("2026-W39")
        self.assertEqual(self.client.post("/patchnotes/staff/weeks/2026-W39/sort", headers=_HEADERS).status_code, 409)

    def test_feedback_validation_and_bad_week(self) -> None:
        for text in (" ", "x" * 1001):
            res = self.client.post("/patchnotes/staff/weeks/2026-W39/feedback", headers=_HEADERS, json={"feedback": text})
            self.assertEqual(res.status_code, 422)
        self.assertEqual(self.client.get("/patchnotes/staff/weeks/nope/review", headers=_HEADERS).status_code, 400)
        self.assertEqual(self.client.post("/patchnotes/staff/weeks/nope/sort", headers=_HEADERS).status_code, 400)

    @mock.patch("src.api.patchnotes_routes.get_job")
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row()])
    def test_job_read_only_includes_bullets_when_done(self, lines, get) -> None:
        for status in ("queued", "running", "done", "failed"):
            get.return_value = _job(status=status)
            res = self.client.get(f"/patchnotes/staff/jobs/{_JOB_ID}", headers=_HEADERS)
            self.assertEqual(res.status_code, 200)
            self.assertEqual("bullets" in res.json(), status == "done")
        lines.assert_called_once_with("2026-W39")
        get.return_value = None
        self.assertEqual(self.client.get(f"/patchnotes/staff/jobs/{_JOB_ID}", headers=_HEADERS).status_code, 404)
        self.assertEqual(self.client.get("/patchnotes/staff/jobs/bad", headers=_HEADERS).status_code, 404)

    @mock.patch("src.api.patchnotes_routes.claim_job")
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[
        _row(id="33333333-3333-3333-3333-333333333333", body="Bowls are returned."),
        _row(body="Soup keeps its food value."),
    ])
    def test_claim_prompt_uses_stored_order_and_schema(self, _lines, claim) -> None:
        for kind in ("feedback", "sort"):
            claim.return_value = _job(kind=kind, status="running", line_ids=[_BULLET_ID, "33333333-3333-3333-3333-333333333333"])
            res = self.client.post("/patchnotes/staff/jobs/claim", headers=_HEADERS)
            self.assertEqual(res.status_code, 200)
            prompt = res.json()["prompt"]
            self.assertLess(prompt.index("Soup keeps"), prompt.index("Bowls are"))
            self.assertIn('"n": 1', prompt)
            self.assertFalse(res.json()["schema"]["additionalProperties"])
        claim.return_value = None
        self.assertEqual(self.client.post("/patchnotes/staff/jobs/claim", headers=_HEADERS).json(), {"job": None})

    @mock.patch("src.api.patchnotes_routes.get_job", return_value=_job(status="running"))
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row()])
    @mock.patch("src.api.patchnotes_routes.apply_feedback", return_value={"changed": 1, "bullets": []})
    @mock.patch("src.api.patchnotes_routes.finish_job", return_value=_job(status="done", changed=1))
    def test_result_maps_number_and_applies_feedback(self, finish, apply, _lines, _get) -> None:
        res = self.client.post(f"/patchnotes/staff/jobs/{_JOB_ID}/result", headers=_HEADERS, json={
            "output": json.dumps({"lines": [{"n": 1, "action": "rewrite", "section": "adjusted", "body": "Added another station."}], "add": []}),
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["job"]["changed"], 1)
        self.assertEqual(apply.call_args.args[2][0]["id"], _BULLET_ID)
        finish.assert_called_once_with(_JOB_ID, changed=1)

    @mock.patch("src.api.patchnotes_routes.get_job", return_value=_job(status="running", kind="sort"))
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row(body="ServerAssets: Added pet toys.")])
    @mock.patch("src.api.patchnotes_routes.apply_sort", return_value={"changed": 1, "bullets": []})
    @mock.patch("src.api.patchnotes_routes.finish_job", return_value=_job(status="done", kind="sort", changed=1))
    def test_result_sort_forces_technical_when_model_omits_it(self, finish, apply, _lines, _get) -> None:
        res = self.client.post(f"/patchnotes/staff/jobs/{_JOB_ID}/result", headers=_HEADERS, json={"output": '{"lines":[]}'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(apply.call_args.args[1], [{"id": _BULLET_ID, "section": "technical", "topic": None, "highlight": False}])
        finish.assert_called_once_with(_JOB_ID, changed=1)

    @mock.patch("src.api.patchnotes_routes.get_job", return_value=_job(status="running"))
    @mock.patch("src.api.patchnotes_routes.list_open_bullets", return_value=[_row()])
    @mock.patch("src.api.patchnotes_routes.apply_feedback")
    @mock.patch("src.api.patchnotes_routes.finish_job", return_value=_job(status="failed"))
    def test_bad_results_finish_failed_without_changing_lines(self, finish, apply, _lines, _get) -> None:
        for body in ({"output": "not json"}, {"output": '{"lines":null}'}, {"error": "x" * 500}, {}):
            res = self.client.post(f"/patchnotes/staff/jobs/{_JOB_ID}/result", headers=_HEADERS, json=body)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["job"]["status"], "failed")
            self.assertLessEqual(len(finish.call_args.kwargs["error"]), 300)
        apply.assert_not_called()

    @mock.patch("src.api.patchnotes_routes.get_job")
    @mock.patch("src.api.patchnotes_routes.apply_feedback")
    def test_result_missing_and_nonrunning_jobs(self, apply, get) -> None:
        for status in ("queued", "done", "failed"):
            get.return_value = _job(status=status)
            res = self.client.post(f"/patchnotes/staff/jobs/{_JOB_ID}/result", headers=_HEADERS, json={"output": '{"lines":[]}'})
            self.assertEqual(res.status_code, 409)
        get.return_value = None
        self.assertEqual(self.client.post(f"/patchnotes/staff/jobs/{_JOB_ID}/result", headers=_HEADERS, json={}).status_code, 404)
        self.assertEqual(self.client.post("/patchnotes/staff/jobs/bad/result", headers=_HEADERS, json={}).status_code, 404)
        apply.assert_not_called()

    @mock.patch("src.api.patchnotes_routes.update_bullet", return_value=_row(topic=None))
    def test_patch_only_changes_present_fields_and_cleans_text(self, update) -> None:
        url = f"/patchnotes/staff/bullets/{_BULLET_ID}"
        res = self.client.patch(url, headers=_HEADERS, json={"topic": None, "highlight": False})
        self.assertEqual(res.status_code, 200)
        update.assert_called_with(_BULLET_ID, {"topic": None, "highlight": False})
        res = self.client.patch(url, headers=_HEADERS, json={"body": "  Added a station (#34)  "})
        self.assertEqual(res.status_code, 200)
        update.assert_called_with(_BULLET_ID, {"body": "Added a station"})

    @mock.patch("src.api.patchnotes_routes.update_bullet")
    def test_patch_invalid_and_unsafe_text(self, update) -> None:
        url = f"/patchnotes/staff/bullets/{_BULLET_ID}"
        for fields in ({"section": "invalid"}, {"topic": "invalid"}, {"body": " "}, {"status": "approved"},
                       {"body": None}, {"section": None}, {"highlight": None}, {"highlight": "yes"},
                       {"body": "The api_key=secretvalue is stored here."}):
            self.assertEqual(self.client.patch(url, headers=_HEADERS, json=fields).status_code, 422)
        res = self.client.patch(url, headers=_HEADERS, json={"body": "Added lore items."})
        self.assertEqual(res.json()["detail"], "That line cannot be published as written.")
        update.assert_not_called()

    def test_patch_drop_restore_missing_conflicts_and_success(self) -> None:
        from src.patchnotes.db import BulletNotOpen
        for action, function, status in (("", "update_bullet", "pending"),
                                         ("/drop", "drop_bullet", "denied"),
                                         ("/restore", "restore_bullet", "pending")):
            method = self.client.patch if not action else self.client.post
            args = {"json": {"section": "new"}} if not action else {}
            url = f"/patchnotes/staff/bullets/{_BULLET_ID}{action}"
            with mock.patch("src.api.patchnotes_routes." + function, return_value=_row(status=status)) as change:
                res = method(url, headers=_HEADERS, **args)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json()["status"], status)
                change.side_effect = BulletNotFound(_BULLET_ID)
                self.assertEqual(method(url, headers=_HEADERS, **args).status_code, 404)
                change.side_effect = BulletNotOpen("Bullet is not open")
                res = method(url, headers=_HEADERS, **args)
                self.assertEqual(res.status_code, 409)
                self.assertEqual(res.json()["detail"], "Bullet is not open")
                self.assertEqual(method("/patchnotes/staff/bullets/bad" + action, headers=_HEADERS, **args).status_code, 404)

    @mock.patch("src.api.patchnotes_routes.list_review_weeks", side_effect=PatchnotesDBError("private details"))
    def test_database_errors_remain_private(self, _weeks) -> None:
        res = self.client.get("/patchnotes/staff/weeks", headers=_HEADERS)
        self.assertEqual(res.status_code, 502)
        self.assertNotIn("private details", res.json()["detail"])
