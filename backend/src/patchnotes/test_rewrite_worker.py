"""Host rewrite worker tests with HTTP and the Codex process mocked."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes import rewrite_worker as worker  # noqa: E402


class RewriteWorkerTest(unittest.TestCase):
    @mock.patch.dict("os.environ", {}, clear=True)
    @mock.patch("patchnotes.rewrite_worker.subprocess.run")
    @mock.patch("patchnotes.rewrite_worker.urllib.request.urlopen")
    def test_success_claims_runs_and_posts_output(self, urlopen, run) -> None:
        job = {"id": "job-1"}
        claimed = {"job": job, "prompt": "Answer from the message.", "schema": {"type": "object"}}
        urlopen.return_value.__enter__.return_value.read.side_effect = [
            json.dumps(claimed).encode(), b'{"job":{"status":"done"}}',
        ]
        directories = []

        def complete(command, **kwargs):
            directory = Path(command[command.index("-C") + 1])
            directories.append(directory)
            self.assertEqual(json.loads((directory / "schema.json").read_text()), claimed["schema"])
            self.assertEqual(kwargs["input"], claimed["prompt"])
            self.assertEqual(kwargs["timeout"], 420)
            self.assertIn("gpt-6.1-sol", command)
            self.assertIn("model_reasoning_effort=low", command)
            self.assertIn("read-only", command)
            self.assertIn("--ephemeral", command)
            self.assertEqual(command[-1], "-")
            (directory / "out.json").write_text('{"lines":[]}')
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = complete
        self.assertTrue(worker.work_once("http://api", "staff-key"))
        requests = [call.args[0] for call in urlopen.call_args_list]
        self.assertEqual(requests[0].full_url, "http://api/patchnotes/staff/jobs/claim")
        self.assertEqual(requests[0].get_header("X-staff-key"), "staff-key")
        self.assertEqual(requests[1].full_url, "http://api/patchnotes/staff/jobs/job-1/result")
        self.assertEqual(json.loads(requests[1].data), {"output": '{"lines":[]}'})
        self.assertFalse(directories[0].exists())

    @mock.patch("patchnotes.rewrite_worker._request")
    @mock.patch("patchnotes.rewrite_worker.subprocess.run")
    def test_usage_limit_posts_friendly_error(self, run, request) -> None:
        request.side_effect = [{"job": {"id": "j"}, "prompt": "Sort", "schema": {}}, {}]
        run.return_value = subprocess.CompletedProcess([], 1, "", "You've hit your usage limit.")
        worker.work_once("http://api", "key")
        self.assertEqual(request.call_args.args[-1], {"error": "The rewrite agent hit its usage limit."})

    @mock.patch("patchnotes.rewrite_worker._request")
    @mock.patch("patchnotes.rewrite_worker.subprocess.run")
    def test_timeout_posts_error(self, run, request) -> None:
        request.side_effect = [{"job": {"id": "j"}, "prompt": "Sort", "schema": {}}, {}]
        run.side_effect = subprocess.TimeoutExpired("codex", 420)
        worker.work_once("http://api", "key")
        self.assertEqual(request.call_args.args[-1], {"error": "The rewrite agent failed."})

    @mock.patch("patchnotes.rewrite_worker.subprocess.run")
    def test_empty_output_and_nonzero_exit_fail(self, run) -> None:
        for code in (0, 1):
            run.return_value = subprocess.CompletedProcess([], code, "", "")
            self.assertEqual(worker.run_job("Sort", {}), {"error": "The rewrite agent failed."})

    @mock.patch("patchnotes.rewrite_worker._request", return_value={"job": None})
    @mock.patch("patchnotes.rewrite_worker.subprocess.run")
    def test_empty_queue_does_not_run_cli(self, run, _request) -> None:
        self.assertFalse(worker.work_once("http://api", "key"))
        run.assert_not_called()

    @mock.patch.dict("os.environ", {"STAFF_KEY": "key"}, clear=True)
    @mock.patch("patchnotes.rewrite_worker.work_once", side_effect=RuntimeError("network error"))
    def test_once_does_not_crash_on_a_bad_job(self, _once) -> None:
        self.assertEqual(worker.main(["--once"]), 0)

    @mock.patch.dict("os.environ", {"STAFF_KEY": "key", "PATCHNOTES_WORKER_POLL": "0"}, clear=True)
    @mock.patch("patchnotes.rewrite_worker.time.sleep")
    @mock.patch("patchnotes.rewrite_worker.work_once")
    def test_loop_continues_after_failure(self, once, sleep) -> None:
        once.side_effect = [RuntimeError("bad job"), False]
        sleep.side_effect = [None, KeyboardInterrupt]
        with self.assertRaises(KeyboardInterrupt):
            worker.main([])
        self.assertEqual(once.call_count, 2)

    @mock.patch.dict("os.environ", {}, clear=True)
    def test_staff_key_is_required(self) -> None:
        with self.assertRaises(SystemExit):
            worker.main(["--once"])

    def test_host_import_needs_only_standard_library(self) -> None:
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([
            sys.executable, "-S", "-c",
            "import sys; sys.path.insert(0, sys.argv[1]); import patchnotes.rewrite_worker",
            str(root),
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
