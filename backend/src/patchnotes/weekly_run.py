"""Build a closed week's comparison on the host and send it to the API.

patchnotes-watch.sh runs this every ten minutes. Nothing happens until a note
week has closed (Friday 12:00 in PATCHNOTES_TZ) and the API has no facts for
it yet. The week is the last AMP backup before that cutoff against the last
backup before the previous Friday's cutoff. Plugin updates bring the subjects
of the commits between the two released versions.

    python -m patchnotes.weekly_run \\
        --backups-dir /home/amp/.ampdata/instances/TFMCMain01/Backups
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .summarize import _SKIP_KINDS, _split_conventional, github_org, player_text
from .weekly import compare, snapshot_from_zip

_BACKUP = re.compile(r"^(\d{8})-(\d{6})-[0-9a-f]+\.zip$")
_CUTOFF_HOUR = 12
_LATE_LIMIT = timedelta(days=3)
_MAX_COMMITS = 25
_MERGE = re.compile(r"^Merge (pull request|branch|remote-tracking)\b", re.IGNORECASE)


def zone() -> ZoneInfo:
    return ZoneInfo(os.environ.get("PATCHNOTES_TZ", "").strip() or "Europe/Berlin")


def week_cutoff(week: str, tz: ZoneInfo) -> datetime:
    """Friday 12:00 of an ISO week, in UTC."""
    match = re.fullmatch(r"(\d{4})-W(\d{2})", week)
    if match is None:
        raise ValueError("week must look like 2026-W41")
    day = datetime.fromisocalendar(int(match.group(1)), int(match.group(2)), 5)
    local = datetime(day.year, day.month, day.day, _CUTOFF_HOUR, tzinfo=tz)
    return local.astimezone(timezone.utc)


def closed_week(now: datetime, tz: ZoneInfo) -> str:
    """The most recent note week whose Friday cutoff has passed."""
    local = now.astimezone(tz)
    iso = local.isocalendar()
    week = f"{iso[0]}-W{iso[1]:02d}"
    if now < week_cutoff(week, tz):
        iso = (local - timedelta(days=7)).isocalendar()
        week = f"{iso[0]}-W{iso[1]:02d}"
    return week


def backups(directory: Path) -> list[tuple[datetime, Path]]:
    """AMP backups with their UTC timestamp, oldest first."""
    found = []
    for path in directory.glob("*.zip"):
        match = _BACKUP.match(path.name)
        if match is None:
            continue
        taken = datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S")
        found.append((taken.replace(tzinfo=timezone.utc), path))
    return sorted(found)


def latest_before(found: list[tuple[datetime, Path]], moment: datetime) -> tuple[datetime, Path] | None:
    eligible = [item for item in found if item[0] <= moment]
    return eligible[-1] if eligible else None


def _github(path: str) -> Any:
    headers = {"User-Agent": "TFMC-PatchNotes/1.0", "Accept": "application/vnd.github+json"}
    token = os.environ.get("PATCHNOTES_GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"https://api.github.com{path}", headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode() or "null")


def commit_subjects(
    repo: str, old: str, new: str, fetch: Callable[[str], Any] | None = None
) -> list[str]:
    """Player-safe subjects of the commits between two released versions."""
    fetch = fetch or _github
    org = urllib.parse.quote(github_org())
    name = urllib.parse.quote(repo)
    for base, head in ((f"v{old}", f"v{new}"), (old, new)):
        try:
            data = fetch(f"/repos/{org}/{name}/compare/{urllib.parse.quote(base)}...{urllib.parse.quote(head)}")
        except (urllib.error.URLError, ValueError, OSError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("commits"), list):
            continue
        subjects: list[str] = []
        for commit in data["commits"]:
            message = str(((commit or {}).get("commit") or {}).get("message") or "")
            subject = message.strip().splitlines()[0].strip() if message.strip() else ""
            if not subject or _MERGE.match(subject):
                continue
            kind, _ = _split_conventional(subject)
            if kind in _SKIP_KINDS:
                continue
            cleaned = player_text(subject)
            if cleaned and cleaned not in subjects:
                subjects.append(cleaned)
        return subjects[-_MAX_COMMITS:]
    return []


def build_facts(
    week: str,
    base: tuple[datetime, Path],
    current: tuple[datetime, Path],
    *,
    partial: bool,
    fetch: Callable[[str], Any] | None = None,
) -> dict[str, Any]:
    facts = compare(snapshot_from_zip(base[1]), snapshot_from_zip(current[1]))
    for update in facts["plugins"]:
        if update.get("repo") and update.get("old") and update.get("new"):
            update["commits"] = commit_subjects(update["repo"], update["old"], update["new"], fetch)
    facts.update(
        {
            "week": week,
            "since": base[0].isoformat(),
            "until": current[0].isoformat(),
            "partial": partial,
        }
    )
    return facts


def _api(api_base: str, staff_key: str, method: str, path: str, payload: dict | None = None) -> tuple[int, Any]:
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"User-Agent": "TFMC-PatchNotes/1.0", "X-Staff-Key": staff_key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(f"{api_base.rstrip('/')}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        return exc.code, None


def run(args: argparse.Namespace, now: datetime | None = None) -> str:
    """Return what happened, as one line for the cron log."""
    tz = zone()
    moment = now or datetime.now(timezone.utc)
    week = args.week or closed_week(moment, tz)
    cutoff = week_cutoff(week, tz)
    if not args.week and moment - cutoff > _LATE_LIMIT:
        return f"{week}: closed too long ago"
    if not args.dry_run and not args.force:
        status, _ = _api(args.api_base, args.staff_key, "GET", f"/patchnotes/staff/weeks/{week}/facts")
        if status == 200:
            return f"{week}: facts already sent"
        if status != 404:
            return f"{week}: API returned HTTP {status}"
    found = backups(Path(args.backups_dir))
    current = latest_before(found, cutoff)
    base = latest_before(found, cutoff - timedelta(days=7))
    partial = False
    if base is None and found:
        base, partial = found[0], True
    if current is None or base is None or current[1] == base[1]:
        return f"{week}: not enough backups"
    facts = build_facts(week, base, current, partial=partial)
    if args.dry_run:
        json.dump(facts, sys.stdout, indent=1, ensure_ascii=False)
        sys.stdout.write("\n")
        return f"{week}: dry run"
    status, body = _api(
        args.api_base, args.staff_key, "POST", f"/patchnotes/staff/weeks/{week}/facts", {"facts": facts}
    )
    if status != 200:
        return f"{week}: API returned HTTP {status} for the facts"
    return f"{week}: sent {len(facts['files'])} changed files and {len(facts['plugins'])} plugin updates"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Send a closed week's TFMCMain changes to the patch note API")
    parser.add_argument("--backups-dir", default=os.environ.get("PATCHNOTES_BACKUPS_DIR", ""))
    parser.add_argument("--api-base", default=os.environ.get("API_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--staff-key", default=os.environ.get("STAFF_KEY", ""))
    parser.add_argument("--week", default="", help="ISO week such as 2026-W41; defaults to the week that just closed")
    parser.add_argument("--force", action="store_true", help="send even when the API already has facts")
    parser.add_argument("--dry-run", action="store_true", help="print the facts instead of sending them")
    args = parser.parse_args(argv)
    if not args.backups_dir:
        parser.error("--backups-dir is required")
    if not args.dry_run and not args.staff_key:
        parser.error("--staff-key is required unless --dry-run")
    print(json.dumps({"weekly": run(args)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
