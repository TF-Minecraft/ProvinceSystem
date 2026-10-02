"""Claim patch note rewrites on the host and run the Codex CLI."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger("patchnotes.rewrite_worker")
_USAGE_LIMIT = re.compile(r"usage[\s_-]*limit|hit.{0,30}limit|quota.{0,30}exceed", re.IGNORECASE)


def _request(api_base: str, staff_key: str, path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}{path}",
        data=json.dumps(payload).encode(),
        headers={"User-Agent": "TFMC-PatchNotes/1.0", "X-Staff-Key": staff_key,
                 "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Patch note API returned HTTP {exc.code}") from exc
    if not isinstance(body, dict):
        raise RuntimeError("Patch note API returned an unexpected body")
    return body


def _failure(output: str) -> dict:
    if _USAGE_LIMIT.search(output):
        return {"error": "The rewrite agent hit its usage limit."}
    return {"error": "The rewrite agent failed."}


def _text(value) -> str:
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return str(value or "")


def run_job(prompt: str, schema: dict) -> dict:
    """Run in an empty directory and return an output or a short failure."""
    with tempfile.TemporaryDirectory(prefix="patchnotes-rewrite-") as directory:
        root = Path(directory)
        schema_path = root / "schema.json"
        output_path = root / "out.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")
        command = [
            os.environ.get("PATCHNOTES_CODEX_BIN", "codex"), "exec",
            "-m", os.environ.get("PATCHNOTES_REWRITE_MODEL", "gpt-6.1-sol"),
            "-c", "model_reasoning_effort=" + os.environ.get("PATCHNOTES_REWRITE_EFFORT", "low"),
            "-s", "read-only", "--skip-git-repo-check", "--ephemeral",
            "-C", directory, "--output-schema", str(schema_path), "-o", str(output_path), "-",
        ]
        try:
            result = subprocess.run(
                command, input=prompt, capture_output=True, text=True,
                timeout=float(os.environ.get("PATCHNOTES_REWRITE_TIMEOUT", "420")),
            )
            diagnostics = _text(result.stdout) + "\n" + _text(result.stderr)
            if result.returncode:
                logger.warning("Rewrite CLI exited with status %s", result.returncode)
                return _failure(diagnostics)
            output = output_path.read_text(encoding="utf-8") if output_path.is_file() else ""
            if not output.strip():
                logger.warning("Rewrite CLI returned no output")
                return _failure(diagnostics)
            return {"output": output}
        except subprocess.TimeoutExpired as exc:
            logger.warning("Rewrite CLI timed out")
            return _failure(_text(exc.stdout) + "\n" + _text(exc.stderr))
        except (OSError, ValueError):
            logger.exception("Rewrite CLI failed")
            return _failure("")


def work_once(api_base: str, staff_key: str) -> bool:
    claimed = _request(api_base, staff_key, "/patchnotes/staff/jobs/claim", {})
    job = claimed.get("job")
    if job is None:
        return False
    try:
        result = run_job(claimed["prompt"], claimed["schema"])
    except Exception:
        logger.exception("Could not process rewrite job")
        result = _failure("")
    _request(api_base, staff_key, f"/patchnotes/staff/jobs/{job['id']}/result", result)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    staff_key = os.environ.get("STAFF_KEY", "").strip()
    if not staff_key:
        parser.error("STAFF_KEY is required")
    api_base = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000")
    poll = float(os.environ.get("PATCHNOTES_WORKER_POLL", "3"))
    while True:
        try:
            work_once(api_base, staff_key)
        except Exception:
            logger.exception("Patch note rewrite worker failed")
        if args.once:
            return 0
        time.sleep(poll)


if __name__ == "__main__":
    raise SystemExit(main())
