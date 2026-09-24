"""Turn staff feedback into edits for a whole week's note.

The feedback is an instruction. It is not copied into the public note.
A line changes only when the rewrite is a different player-safe sentence.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable

import anthropic

from .summarize import player_text

logger = logging.getLogger("patchnotes.feedback")

_MODEL = "claude-sonnet-5"
_SECTIONS = frozenset({"new", "fixed", "adjusted", "technical"})
_TOPICS = frozenset(
    {
        "classes",
        "combat",
        "magic",
        "crafting",
        "professions",
        "animals",
        "world",
        "town",
        "dungeons",
        "chat",
    }
)
_MAX_ADDS = 3

_SYSTEM = """You rewrite a Minecraft server's weekly patch notes after staff feedback.
The feedback is an instruction about the note. It is not the new wording, except when staff clearly give a sentence they want published for one part of the note.
Return one JSON object and nothing else:
{"lines":[{"id":"...","action":"keep","section":"adjusted","body":"..."}],"add":[{"section":"fixed","body":"..."}]}
Rules:
- Every input id appears once.
- action is keep, rewrite, or drop.
- keep leaves that line unchanged.
- Change every line the feedback is about. Several lines may change.
- drop a line when staff do not want it posted.
- add a line only when staff asked for something that is not already there. At most 3.
- Each body is one short player-facing sentence.
- topic is one of classes, combat, magic, crafting, professions, animals, world, town, dungeons, chat.
- highlight is true only for the few lines that belong in the short summary. At most 6.
- A bug fix uses section fixed. A plugin or internal change uses section technical.
- Do not copy the feedback into a body.
- Do not include stat numbers, coordinates, file paths, commands, permissions, secrets, dungeon names, or lore-item names.
- Never use an em dash.
"""


class FeedbackError(RuntimeError):
    """The note could not be rewritten from this feedback."""


def interpret_feedback(
    bullets: list[dict[str, Any]],
    feedback: str,
    *,
    complete: Callable[[str, str], str] | None = None,
) -> list[dict[str, str]]:
    """Edits for the current note. Unchanged lines are omitted."""
    note = feedback.strip()
    if not note:
        raise FeedbackError("Feedback is required.")
    if not bullets:
        return []
    raw = (complete or _complete)(_SYSTEM, _user_prompt(bullets, note))
    return edits_from_response(bullets, note, _json_object(raw))


def edits_from_response(
    bullets: list[dict[str, Any]],
    feedback: str,
    payload: dict[str, Any],
) -> list[dict[str, str]]:
    """Keep only rewrites that are safe and are not the feedback itself."""
    by_id = {str(bullet.get("id") or ""): bullet for bullet in bullets if bullet.get("id")}
    lines = payload.get("lines")
    if not isinstance(lines, list):
        raise FeedbackError("Could not rewrite the note from that feedback.")
    seen: set[str] = set()
    edits: list[dict[str, str]] = []
    for item in lines:
        if not isinstance(item, dict):
            continue
        bullet_id = str(item.get("id") or "").strip()
        if bullet_id not in by_id or bullet_id in seen:
            continue
        seen.add(bullet_id)
        action = str(item.get("action") or "").strip().lower()
        original = by_id[bullet_id]
        if action == "drop":
            edits.append({"id": bullet_id, "action": "drop"})
            continue
        if action != "rewrite":
            continue
        rewrite = _rewrite(original, item, feedback)
        if rewrite is not None:
            edits.append(rewrite)
    adds = payload.get("add")
    if isinstance(adds, list):
        added = 0
        for item in adds:
            if added >= _MAX_ADDS or not isinstance(item, dict):
                continue
            section = str(item.get("section") or "")
            if section not in _SECTIONS:
                continue
            body = _safe_body(str(item.get("body") or ""), feedback)
            if body is None:
                continue
            edits.append(_with_placement({"action": "add", "section": section, "body": body}, item))
            added += 1
    return edits


def _rewrite(original: dict[str, Any], item: dict[str, Any], feedback: str) -> dict[str, Any] | None:
    section = str(item.get("section") or original.get("section") or "")
    if section not in _SECTIONS:
        return None
    body = _safe_body(str(item.get("body") or ""), feedback)
    if body is None:
        return None
    edit = _with_placement(
        {
            "id": str(original.get("id") or ""),
            "action": "rewrite",
            "section": section,
            "body": body,
        },
        item,
    )
    same_line = body == str(original.get("body") or "").strip() and section == original.get("section")
    if same_line and not edit.get("topic") and not edit.get("highlight"):
        return None
    return edit


def _with_placement(edit: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    topic = str(item.get("topic") or "").strip().lower()
    if topic in _TOPICS:
        edit["topic"] = topic
    if item.get("highlight") is True:
        edit["highlight"] = True
    return edit


def _safe_body(text: str, feedback: str) -> str | None:
    cleaned = player_text(text.replace("—", ", ").replace("–", "-"))
    if cleaned is None or cleaned.endswith("?") or _copies_feedback(cleaned, feedback):
        return None
    return cleaned


def _copies_feedback(body: str, feedback: str) -> bool:
    """True when the proposed line is the feedback pasted in as the note."""
    left = _flat(body)
    right = _flat(feedback)
    if not left or not right:
        return False
    if left == right:
        return True
    return len(right) >= 40 and right in left


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _user_prompt(bullets: list[dict[str, Any]], feedback: str) -> str:
    lines = [
        {
            "id": str(bullet.get("id") or ""),
            "section": str(bullet.get("section") or ""),
            "body": str(bullet.get("body") or ""),
        }
        for bullet in bullets
        if bullet.get("id")
    ]
    return (
        "Current note:\n"
        + json.dumps(lines, ensure_ascii=False)
        + "\n\nStaff feedback:\n"
        + feedback
    )


def _json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end < start:
        raise FeedbackError("Could not rewrite the note from that feedback.")
    try:
        payload = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise FeedbackError("Could not rewrite the note from that feedback.") from exc
    if not isinstance(payload, dict):
        raise FeedbackError("Could not rewrite the note from that feedback.")
    return payload


def _complete(system: str, user: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise FeedbackError("The rewrite agent is not configured.")
    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=_MODEL,
            max_tokens=1500,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": "low"},
        )
    except anthropic.APIError as exc:
        logger.exception("Patch note feedback rewrite failed")
        raise FeedbackError("Could not rewrite the note from that feedback.") from exc
    parts = [
        block.text for block in response.content if getattr(block, "type", None) == "text"
    ]
    text = "\n".join(parts).strip()
    if not text:
        raise FeedbackError("Could not rewrite the note from that feedback.")
    return text
