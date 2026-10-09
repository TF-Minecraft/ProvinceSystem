"""Route tests for the weekly Discord post (database fully mocked)."""

from __future__ import annotations

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

from fastapi.testclient import TestClient  # noqa: E402

from server import app  # noqa: E402
from src.patchnotes.db import JobActive  # noqa: E402

_HEADERS = {"X-Staff-Key": "dev-staff-key"}
_ROUTES = "src.api.patchnotes_routes"
_FACTS = {
    "files": [
        {
            "path": "MMOCore/classes/juggernaut.yml",
            "plugin": "MMOCore",
            "kind": "changed",
            "entries": [{"name": "Juggernaut", "kind": "changed", "details": ["max_health.base: 30 --> 28"]}],
        }
    ],
    "plugins": [],
    "hidden": {},
}
_UPDATED = datetime(2026, 10, 9, 10, 5, tzinfo=timezone.utc)


def _job(**overrides):
    row = {
        "id": "22222222-2222-2222-2222-222222222222",
        "week": "2026-W41",
        "kind": "compose",
        "feedback": None,
        "status": "queued",
        "error": None,
        "changed": None,
        "created_at": _UPDATED,
        "finished_at": None,
    }
    row.update(overrides)
    return row


def _post(**overrides):
    row = {
        "week": "2026-W41",
        "messages": ["# Update 5.3\nHello"],
        "source": "writer",
        "status": "draft",
        "updated_at": _UPDATED,
    }
    row.update(overrides)
    return row


class PostRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        for name, value in (("migrate", None), ("patch_label", "5.3"), ("get_act", None)):
            patcher = mock.patch(f"{_ROUTES}.{name}", return_value=value)
            self.addCleanup(patcher.stop)
            patcher.start()

    def tearDown(self) -> None:
        self.client.close()

    def test_routes_require_staff(self) -> None:
        self.assertEqual(self.client.get("/patchnotes/staff/weeks/2026-W41/post").status_code, 401)
        self.assertEqual(
            self.client.post("/patchnotes/staff/weeks/2026-W41/facts", json={"facts": {}}).status_code, 401
        )
        self.assertEqual(self.client.put("/patchnotes/staff/weeks/2026-W41/meta", json={}).status_code, 401)

    def test_facts_are_stored_and_start_the_writer(self) -> None:
        with mock.patch(f"{_ROUTES}.save_facts") as save, mock.patch(
            f"{_ROUTES}.create_job", return_value=_job()
        ) as create:
            response = self.client.post(
                "/patchnotes/staff/weeks/2026-W41/facts", json={"facts": _FACTS}, headers=_HEADERS
            )
        self.assertEqual(response.status_code, 200)
        save.assert_called_once_with("2026-W41", _FACTS)
        create.assert_called_once_with("2026-W41", "compose")
        self.assertEqual(response.json()["job"]["kind"], "compose")

    def test_facts_while_the_writer_runs_only_replace_the_facts(self) -> None:
        with mock.patch(f"{_ROUTES}.save_facts"), mock.patch(
            f"{_ROUTES}.create_job", side_effect=JobActive("2026-W41")
        ):
            response = self.client.post(
                "/patchnotes/staff/weeks/2026-W41/facts", json={"facts": _FACTS}, headers=_HEADERS
            )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["job"])

    def test_missing_facts_are_404(self) -> None:
        with mock.patch(f"{_ROUTES}.get_facts", return_value=None):
            response = self.client.get("/patchnotes/staff/weeks/2026-W41/facts", headers=_HEADERS)
        self.assertEqual(response.status_code, 404)

    def test_post_while_the_first_version_is_written(self) -> None:
        with mock.patch(f"{_ROUTES}.get_post", return_value=None), mock.patch(
            f"{_ROUTES}.latest_job", return_value=_job(status="running")
        ) as latest:
            response = self.client.get("/patchnotes/staff/weeks/2026-W41/post", headers=_HEADERS)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "composing")
        self.assertEqual(body["messages"], [])
        self.assertEqual(body["label"], "5.3")
        self.assertEqual(latest.call_args.args[1], ("compose",))

    def test_post_falls_back_to_the_facts_when_the_writer_failed(self) -> None:
        with mock.patch(f"{_ROUTES}.get_post", return_value=None), mock.patch(
            f"{_ROUTES}.latest_job", return_value=_job(status="failed", error="usage limit")
        ), mock.patch(f"{_ROUTES}.get_facts", return_value={"facts": _FACTS}), mock.patch(
            f"{_ROUTES}.save_post", side_effect=lambda week, messages, source: _post(messages=messages, source=source)
        ):
            response = self.client.get("/patchnotes/staff/weeks/2026-W41/post", headers=_HEADERS)
        body = response.json()
        self.assertEqual(body["source"], "fallback")
        self.assertTrue(body["messages"][0].startswith("# Update 5.3"))
        self.assertEqual(body["job"]["error"], "usage limit")

    def test_post_without_facts_is_404(self) -> None:
        with mock.patch(f"{_ROUTES}.get_post", return_value=None), mock.patch(
            f"{_ROUTES}.latest_job", return_value=None
        ), mock.patch(f"{_ROUTES}.get_facts", return_value=None):
            response = self.client.get("/patchnotes/staff/weeks/2026-W41/post", headers=_HEADERS)
        self.assertEqual(response.status_code, 404)

    def test_feedback_needs_a_post_and_a_free_writer(self) -> None:
        url = "/patchnotes/staff/weeks/2026-W41/post/feedback"
        with mock.patch(f"{_ROUTES}.get_post", return_value=None):
            self.assertEqual(self.client.post(url, json={"feedback": "Shorter"}, headers=_HEADERS).status_code, 409)
        with mock.patch(f"{_ROUTES}.get_post", return_value=_post()), mock.patch(
            f"{_ROUTES}.create_job", side_effect=JobActive("2026-W41")
        ):
            self.assertEqual(self.client.post(url, json={"feedback": "Shorter"}, headers=_HEADERS).status_code, 409)
        with mock.patch(f"{_ROUTES}.get_post", return_value=_post()), mock.patch(
            f"{_ROUTES}.create_job", return_value=_job(feedback="Shorter")
        ) as create:
            response = self.client.post(url, json={"feedback": "Shorter"}, headers=_HEADERS)
        self.assertEqual(response.status_code, 202)
        create.assert_called_once_with("2026-W41", "compose", "Shorter")

    def test_approve_and_act(self) -> None:
        with mock.patch(f"{_ROUTES}.approve_post", return_value=True):
            response = self.client.post("/patchnotes/staff/weeks/2026-W41/post/approve", headers=_HEADERS)
        self.assertEqual(response.json(), {"week": "2026-W41", "approved": True})
        with mock.patch(f"{_ROUTES}.set_act") as set_act:
            response = self.client.put(
                "/patchnotes/staff/weeks/2026-W41/meta", json={"act": "Act 1"}, headers=_HEADERS
            )
        self.assertEqual(response.status_code, 200)
        set_act.assert_called_once_with("2026-W41", "Act 1")

    def test_claim_gives_the_writer_the_facts(self) -> None:
        with mock.patch(f"{_ROUTES}.claim_job", return_value=_job(status="running")), mock.patch(
            f"{_ROUTES}.get_facts", return_value={"facts": _FACTS}
        ):
            response = self.client.post("/patchnotes/staff/jobs/claim", headers=_HEADERS)
        body = response.json()
        self.assertIn("Start with `# Update 5.3`.", body["prompt"])
        self.assertIn("Juggernaut (changed): max_health.base: 30 --> 28", body["prompt"])
        self.assertEqual(body["schema"]["required"], ["messages"])

    def test_writer_result_is_stored_as_a_draft(self) -> None:
        output = json.dumps({"messages": ["# Update 5.3\nHi @here", "# 🔧 Fixes\n- Fixed knockouts"]})
        with mock.patch(f"{_ROUTES}.get_job", return_value=_job(status="running")), mock.patch(
            f"{_ROUTES}.save_post"
        ) as save, mock.patch(f"{_ROUTES}.finish_job", return_value=_job(status="done", changed=2)) as finish:
            response = self.client.post(
                "/patchnotes/staff/jobs/22222222-2222-2222-2222-222222222222/result",
                json={"output": output},
                headers=_HEADERS,
            )
        self.assertEqual(response.status_code, 200)
        save.assert_called_once_with("2026-W41", ["# Update 5.3\nHi", "# 🔧 Fixes\n- Fixed knockouts"], "writer")
        finish.assert_called_once_with("22222222-2222-2222-2222-222222222222", changed=2)

    def test_writer_failure_keeps_a_plain_post(self) -> None:
        with mock.patch(f"{_ROUTES}.get_job", return_value=_job(status="running")), mock.patch(
            f"{_ROUTES}.get_post", return_value=None
        ), mock.patch(f"{_ROUTES}.get_facts", return_value={"facts": _FACTS}), mock.patch(
            f"{_ROUTES}.save_post"
        ) as save, mock.patch(f"{_ROUTES}.finish_job", return_value=_job(status="failed")) as finish:
            self.client.post(
                "/patchnotes/staff/jobs/22222222-2222-2222-2222-222222222222/result",
                json={"error": "The rewrite agent hit its usage limit."},
                headers=_HEADERS,
            )
        finish.assert_called_once_with(
            "22222222-2222-2222-2222-222222222222", error="The rewrite agent hit its usage limit."
        )
        self.assertEqual(save.call_args.args[2], "fallback")


if __name__ == "__main__":
    unittest.main()
