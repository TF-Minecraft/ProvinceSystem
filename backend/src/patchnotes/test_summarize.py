"""Pure checks for turning a GitHub push into pending patch notes."""

from __future__ import annotations

import hashlib
import hmac
import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.summarize import signature_ok, summarize_push  # noqa: E402

_SHA = "a" * 40


def _push(message: str, *, ref: str = "refs/heads/main", org: str = "TF-Minecraft", sha: str = _SHA) -> dict:
    return {
        "ref": ref,
        "repository": {
            "name": "Gathering",
            "full_name": f"{org}/Gathering",
            "default_branch": "main",
        },
        "commits": [{"id": sha, "message": message, "distinct": True}],
    }


class SignatureTest(unittest.TestCase):
    def test_accepts_the_github_header(self) -> None:
        body = b'{"zen":"ok"}'
        digest = hmac.new(b"secret", body, hashlib.sha256).hexdigest()
        self.assertTrue(signature_ok(body, f"sha256={digest}", "secret"))
        self.assertFalse(signature_ok(body, "sha256=nope", "secret"))
        self.assertFalse(signature_ok(body, None, "secret"))


class SummarizePushTest(unittest.TestCase):
    def test_sorts_a_main_push_into_sections(self) -> None:
        notes = summarize_push(
            {
                "ref": "refs/heads/main",
                "repository": {
                    "name": "Gathering",
                    "full_name": "TF-Minecraft/Gathering",
                    "default_branch": "main",
                },
                "commits": [
                    {"id": "1" * 40, "message": "feat: Added a hidden grove", "distinct": True},
                    {"id": "2" * 40, "message": "fix: Fixed a node crash", "distinct": True},
                    {"id": "3" * 40, "message": "balance: Lowered the resin price", "distinct": True},
                    {"id": "4" * 40, "message": "refactor: Split the storage layer", "distinct": True},
                ],
            }
        )
        self.assertTrue(notes.accepted)
        self.assertEqual(
            [(draft.section, draft.body) for draft in notes.drafts],
            [
                ("new", "Gathering: Added a hidden grove"),
                ("fixed", "Gathering: Fixed a node crash"),
                ("adjusted", "Gathering: Lowered the resin price"),
                ("technical", "Gathering: Split the storage layer"),
            ],
        )
        self.assertEqual(notes.withheld, 0)

    def test_ignores_other_branches_and_other_orgs(self) -> None:
        self.assertFalse(summarize_push(_push("feat: Added a grove", ref="refs/heads/dev")).accepted)
        self.assertFalse(summarize_push(_push("feat: Added a grove", org="SomeoneElse")).accepted)

    def test_skips_merges_and_vague_subjects(self) -> None:
        notes = summarize_push(_push("Merge pull request #4 from TF-Minecraft/dev"))
        self.assertTrue(notes.accepted)
        self.assertEqual(notes.drafts, [])
        self.assertEqual(notes.withheld, 0)
        notes = summarize_push(_push("update"))
        self.assertEqual(notes.drafts, [])
        self.assertEqual(notes.withheld, 0)
        notes = summarize_push(_push("chore: Bump pytest from 8.0 to 8.1"))
        self.assertEqual(notes.drafts, [])
        self.assertEqual(notes.withheld, 0)

    def test_withholds_lore_secrets_exploits_and_permissions(self) -> None:
        for message in (
            "feat: Moved a lore item behind the inn",
            "fix: Set api_key=supersecretvalue",
            "docs: how to dupe the station",
            "chore: lp user Steve permission set *",
            "fix: diff --git a/secret b/secret",
        ):
            notes = summarize_push(_push(message))
            self.assertEqual(notes.drafts, [], message)
            self.assertEqual(notes.withheld, 1, message)

    def test_leaves_out_pull_request_numbers(self) -> None:
        notes = summarize_push(
            _push("fry eggs using chicken genetics for quality (#38)")
        )
        self.assertEqual(len(notes.drafts), 1)
        self.assertEqual(
            notes.drafts[0].body,
            "Gathering: fry eggs using chicken genetics for quality",
        )
        self.assertNotIn("#38", notes.drafts[0].body)

    def test_backend_work_stays_technical_even_when_written_as_a_fix(self) -> None:
        notes = summarize_push(
            {
                "ref": "refs/heads/main",
                "repository": {
                    "name": "TLibs",
                    "full_name": "TF-Minecraft/TLibs",
                    "default_branch": "main",
                },
                "commits": [
                    {
                        "id": "1" * 40,
                        "message": "fix: use the plugin logger for console messages",
                        "distinct": True,
                    },
                    {
                        "id": "2" * 40,
                        "message": "feat: migrate deprecated level-up listeners",
                        "distinct": True,
                    },
                    {
                        "id": "3" * 40,
                        "message": "Show the company icon under the banner for every guild",
                        "distinct": True,
                    },
                ],
            }
        )
        self.assertEqual(
            [(draft.section, draft.body) for draft in notes.drafts],
            [
                ("technical", "TLibs: use the plugin logger for console messages"),
                ("technical", "TLibs: migrate deprecated level-up listeners"),
                ("adjusted", "TLibs: Show the company icon under the banner for every guild"),
            ],
        )

    def test_strips_coordinates_and_keeps_the_fix(self) -> None:
        notes = summarize_push(_push("fix: Fixed a chest at 1204, 64, -880"))
        self.assertEqual(len(notes.drafts), 1)
        self.assertEqual(notes.drafts[0].section, "fixed")
        self.assertNotIn("1204", notes.drafts[0].body)
        self.assertNotIn("-880", notes.drafts[0].body)
        self.assertIn("Fixed a chest", notes.drafts[0].body)

    def test_does_not_repeat_a_commit_already_on_the_branch(self) -> None:
        payload = _push("feat: Added a grove")
        payload["commits"][0]["distinct"] = False
        notes = summarize_push(payload)
        self.assertEqual(notes.drafts, [])
        self.assertEqual(notes.withheld, 0)
