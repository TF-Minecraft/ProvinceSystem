"""Turn a GitHub push into pending patch-note lines.

The bullet is the commit subject, not the diff. A line that would reveal a
secret, a coordinate, a staff permission, an exploit, or a lore item is
withheld. Staff still have to approve anything that is stored.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from dataclasses import dataclass

from .safety import hidden_knowledge_warning

_DEFAULT_ORG = "TF-Minecraft"
_MAX_COMMITS = 20
_MAX_BODY = 240

_SHA = re.compile(r"^[0-9a-f]{7,40}$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_LABEL = re.compile(r"^[A-Za-z0-9_.-]{1,60}$")
_MERGE = re.compile(r"^Merge (pull request|branch|remote-tracking)\b", re.IGNORECASE)
_VAGUE = re.compile(r"^(wip|update|updates|tweak|tweaks|changes|misc|stuff|commit|\.+)$", re.IGNORECASE)
_CONVENTIONAL = re.compile(
    r"^(?P<kind>feature|feat|hotfix|fix|bug|patch|balance|adjust|tweak|nerf|buff|"
    r"docs|test|ci|chore|refactor|build|style|perf)"
    r"(?:\([^)]+\))?!?:\s*",
    re.IGNORECASE,
)
_SKIP_KINDS = {"docs", "test", "ci", "chore", "build", "style"}
_BUMP = re.compile(r"(?i)^(bump|update)\b.+\bfrom\b.+\bto\b")
_KIND_SECTION = {
    "feat": "new",
    "feature": "new",
    "fix": "fixed",
    "bug": "fixed",
    "hotfix": "fixed",
    "patch": "fixed",
    "balance": "adjusted",
    "adjust": "adjusted",
    "tweak": "adjusted",
    "nerf": "adjusted",
    "buff": "adjusted",
    "docs": "technical",
    "test": "technical",
    "ci": "technical",
    "chore": "technical",
    "refactor": "technical",
    "build": "technical",
    "style": "technical",
    "perf": "technical",
}
_FIX_WORDS = re.compile(r"\b(fix|fixed|fixes|crash|bug)\b", re.IGNORECASE)
_ADJUST_WORDS = re.compile(
    r"\b(price|prices|recipe|recipes|cost|balance|nerf|buff)\b",
    re.IGNORECASE,
)
_NEW_WORDS = re.compile(r"\b(add|added|adds|new)\b", re.IGNORECASE)

_SECRET = re.compile(
    r"(?i)(api[_-]?key|client[_-]?secret|staff[_-]?key|password|private[_-]?key|"
    r"access[_-]?token|secret)\s*[:=]\s*\S+"
    r"|ghp_[A-Za-z0-9]{20,}"
    r"|github_pat_\w+"
    r"|AKIA[0-9A-Z]{16}"
    r"|-----BEGIN [A-Z ]+-----"
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"
    r"|hooks\.slack\.com/services/\S+"
    r"|discord(?:app)?\.com/api/webhooks/\S+"
)
_DIFF = re.compile(r"(?m)^(diff --git |@@ |--- a/|\+\+\+ b/)")
_EXPLOIT = re.compile(
    r"\b(how to (dupe|duplicate|exploit|crash)|steps to (dupe|exploit)|"
    r"permission bypass|reproduce the exploit)\b",
    re.IGNORECASE,
)
_PERMISSION = re.compile(
    r"(?i)(\bluckperms\b|\blp\s+user\b|\blp\s+group\b|(?<!\w)/op\b)"
)
_COORDS = re.compile(r"(?<![\w.])-?\d{3,6}\s*,\s*-?\d{1,4}\s*,\s*-?\d{3,6}(?![\w.])")
_XYZ = re.compile(r"(?<![A-Za-z0-9])[xyz]\s*[:=]\s*-?\d{1,6}", re.IGNORECASE)
_WORD = re.compile(r"[A-Za-z]{2,}")
_PR_NUMBER = re.compile(r"\s*\(#\d+\)")


@dataclass(frozen=True)
class Draft:
    section: str
    body: str
    source_key: str


@dataclass(frozen=True)
class PushNotes:
    """`accepted` is false when this push is not a default-branch update."""

    accepted: bool
    drafts: list[Draft]
    withheld: int


def signature_ok(body: bytes, header: str | None, secret: str) -> bool:
    """True when `header` is the GitHub sha256 HMAC of `body`."""
    if not header or not header.startswith("sha256="):
        return False
    given = header[7:].strip().lower()
    if len(given) != 64:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, given)


def github_org() -> str:
    return os.environ.get("PATCHNOTES_GITHUB_ORG", _DEFAULT_ORG).strip() or _DEFAULT_ORG


def summarize_push(payload: dict, *, org: str | None = None) -> PushNotes:
    """Drafts for one push payload. Unsafe commits increment `withheld`."""
    expected = (org if org is not None else github_org()).strip() or _DEFAULT_ORG
    if not _on_default_branch(payload, expected):
        return PushNotes(accepted=False, drafts=[], withheld=0)
    repo = payload.get("repository") if isinstance(payload.get("repository"), dict) else {}
    full_name = str(repo.get("full_name") or "")
    label = _label(str(repo.get("name") or full_name.rsplit("/", 1)[-1]))
    commits = payload.get("commits")
    if not isinstance(commits, list):
        commits = []
    drafts: list[Draft] = []
    withheld = 0
    for commit in commits[:_MAX_COMMITS]:
        draft, kept = _draft_commit(full_name, label, commit)
        if draft is not None:
            drafts.append(draft)
        elif not kept:
            withheld += 1
    return PushNotes(accepted=True, drafts=drafts, withheld=withheld)


def _on_default_branch(payload: dict, org: str) -> bool:
    if payload.get("deleted") is True:
        return False
    repo = payload.get("repository")
    if not isinstance(repo, dict):
        return False
    full_name = str(repo.get("full_name") or "")
    if not _REPO.fullmatch(full_name):
        return False
    owner = full_name.split("/", 1)[0]
    if owner.lower() != org.lower():
        return False
    default = str(repo.get("default_branch") or "main").strip()
    return str(payload.get("ref") or "") == f"refs/heads/{default}"


def _label(name: str) -> str:
    cleaned = name.strip()
    if _LABEL.fullmatch(cleaned):
        return cleaned
    return "Update"


def _draft_commit(full_name: str, label: str, commit: object) -> tuple[Draft | None, bool]:
    """Return the draft, and whether the commit was intentionally skipped."""
    if not isinstance(commit, dict) or commit.get("distinct") is False:
        return None, True
    sha = str(commit.get("id") or "").strip().lower()
    if not _SHA.fullmatch(sha):
        return None, True
    message = str(commit.get("message") or "")
    subject = message.splitlines()[0].strip() if message.strip() else ""
    if not subject or _MERGE.match(subject) or _VAGUE.fullmatch(subject):
        return None, True
    kind, text = _split_conventional(subject)
    cleaned = player_text(text)
    if cleaned is None:
        return None, False
    if kind in _SKIP_KINDS or _BUMP.match(cleaned):
        return None, True
    section = _section(kind, cleaned)
    body = f"{label}: {cleaned}"
    if len(body) > _MAX_BODY:
        body = body[: _MAX_BODY - 1].rstrip() + "…"
    if player_text(body) is None:
        return None, False
    return Draft(section=section, body=body, source_key=f"{full_name}@{sha}"), True


def _split_conventional(subject: str) -> tuple[str, str]:
    match = _CONVENTIONAL.match(subject)
    if match is None:
        return "", subject
    kind = match.group("kind").lower()
    rest = subject[match.end() :].strip()
    return kind, rest or subject


def _section(kind: str, text: str) -> str:
    if kind in _KIND_SECTION:
        return _KIND_SECTION[kind]
    if _FIX_WORDS.search(text):
        return "fixed"
    if _ADJUST_WORDS.search(text):
        return "adjusted"
    if _NEW_WORDS.search(text):
        return "new"
    return "technical"


def strip_pr_numbers(text: str) -> str:
    """Drop GitHub pull-request numbers. They are not part of the note."""
    return _PR_NUMBER.sub("", text or "")


def player_text(text: str) -> str | None:
    """A line safe to store, or None when the line must not be stored at all."""
    text = strip_pr_numbers(text)
    if (
        hidden_knowledge_warning(text)
        or _SECRET.search(text)
        or _DIFF.search(text)
        or _EXPLOIT.search(text)
        or _PERMISSION.search(text)
    ):
        return None
    cleaned = _XYZ.sub("", _COORDS.sub("", text))
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" \t-:,")
    if len(_WORD.findall(cleaned)) < 2:
        return None
    if hidden_knowledge_warning(cleaned):
        return None
    return cleaned
