"""Turn staff feedback into edits for a whole week's note.

The feedback is an instruction. It is not copied into the public note.
A line changes only when the rewrite is a different player-safe sentence.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .summarize import forced_technical, player_text

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
_SYSTEM = """Answer from this message only. Do not run commands or read files.
You rewrite a Minecraft server's weekly patch notes after staff feedback.
The feedback is an instruction about the note. It is not the new wording, except when staff clearly give a sentence they want published for one part of the note.
Return one JSON object and nothing else:
{"lines":[{"n":1,"action":"rewrite","section":"adjusted","body":"...","topic":null,"highlight":false}],"add":[{"section":"fixed","body":"...","topic":null,"highlight":false}]}
Rules:
- Return only lines you rewrite or drop. Leave every other line out. An omitted line stays unchanged.
- action is rewrite or drop. Omit unchanged lines.
- Change every line the feedback is about. Several lines may change.
- drop a line when staff do not want it posted. A drop needs no body.
- When staff only move a line to another section, or only drop it, keep the existing body. Change the body only when they give new wording or ask for a rewrite.
- add a line only when staff asked for something that is not already there. At most 3.
- The note is structured in four sections. Choose the section from what players care about. Staff win when they name one.
  - new: a new thing players care about. It is player facing.
  - fixed: a bug players will care about that was fixed.
  - adjusted: an existing feature that was adjusted.
  - technical: something players will not care about. Backend work about the code, and nothing player facing.
- A player-facing bug fix is fixed. A bug fix or a new change that players will not care about is technical, not fixed or new.
- For new, fixed, and adjusted, each body is one short player-facing sentence. A technical line may keep its existing wording.
- topic is one of classes, combat, magic, crafting, professions, animals, world, town, dungeons, chat.
- highlight is true only for the few lines that belong in the short summary. At most 6.
- A line you rewrite keeps its topic and highlight unless staff ask to change them. Repeat them in your answer.
- Do not copy the feedback into a body.
- Do not include stat numbers, coordinates, file paths, commands, permissions, secrets, dungeon names, or lore-item names.
- Never use an em dash.
"""


class FeedbackError(RuntimeError):
    """The note could not be rewritten from this feedback."""


def edits_from_response(
    bullets: list[dict[str, Any]],
    feedback: str,
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    """Keep only rewrites that are safe and are not the feedback itself."""
    by_id = {str(bullet.get("id") or ""): bullet for bullet in bullets if bullet.get("id")}
    lines = payload.get("lines")
    if not isinstance(lines, list):
        raise FeedbackError("Could not rewrite the note from that feedback.")
    seen: set[str] = set()
    edits: list[dict[str, Any]] = []
    for item in lines:
        if not isinstance(item, dict):
            continue
        bullet_id = _line_id(bullets, item)
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
    raw_body = str(item.get("body") or "").strip() or str(original.get("body") or "")
    body = _safe_body(raw_body, feedback)
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
    same_placement = (
        edit.get("topic", original.get("topic")) == original.get("topic")
        and edit.get("highlight", bool(original.get("highlight"))) == bool(original.get("highlight"))
    )
    if same_line and same_placement:
        return None
    return edit


def _with_placement(edit: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    topic = str(item.get("topic") or "").strip().lower()
    if "topic" in item:
        edit["topic"] = topic if topic in _TOPICS else None
    if "highlight" in item:
        edit["highlight"] = item["highlight"] is True
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


def _numbered_lines(bullets: list[dict[str, Any]], *, placement: bool = False) -> str:
    lines = []
    for n, bullet in enumerate(bullets, 1):
        line: dict[str, Any] = {
            "n": n,
            "section": str(bullet.get("section") or ""),
            "body": str(bullet.get("body") or ""),
        }
        if placement and bullet.get("topic"):
            line["topic"] = str(bullet["topic"])
        if placement and bullet.get("highlight"):
            line["highlight"] = True
        lines.append(line)
    return json.dumps(lines, ensure_ascii=False)


def feedback_prompt(bullets: list[dict[str, Any]], feedback: str) -> str:
    return (
        _SYSTEM
        + "\nCurrent note:\n"
        + _numbered_lines(bullets, placement=True)
        + "\nStaff feedback:\n"
        + feedback
    )


def sort_prompt(bullets: list[dict[str, Any]]) -> str:
    return """Answer from this message only. Do not run commands or read files.
Sort a Minecraft server's weekly patch notes. Never change wording.
Return {"lines":[{"n":1,"section":"new","topic":null,"highlight":false}]}.
Return every line whose section should change or that needs a topic or highlight.
Sections:
- new: a new thing players care about.
- fixed: a bug players care about that was fixed.
- adjusted: an existing feature that was adjusted.
- technical: work players will not care about, including staff or admin work,
  logging, console, APIs, hooks, tests, docs, and the ServerAssets, CoreProtect,
  Docs and TLibs repositories.
Topic is only for new and adjusted. Choose classes, combat, magic, crafting,
professions, animals, world, town, dungeons, chat, or null when none fits.
Highlight at most 6 lines, the biggest player-facing news. Never highlight technical.
Current note:
""" + _numbered_lines(bullets)


def _object_schema(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False,
            "properties": properties, "required": list(properties)}


_SECTION_SCHEMA = {"type": "string", "enum": sorted(_SECTIONS)}
_TOPIC_SCHEMA = {"type": ["string", "null"], "enum": sorted(_TOPICS) + [None]}
FEEDBACK_SCHEMA = _object_schema({
    "lines": {"type": "array", "items": _object_schema({
        "n": {"type": "integer"},
        "action": {"type": "string", "enum": ["rewrite", "drop"]},
        "section": {"type": ["string", "null"], "enum": sorted(_SECTIONS) + [None]},
        "body": {"type": ["string", "null"]},
        "topic": _TOPIC_SCHEMA, "highlight": {"type": "boolean"},
    })},
    "add": {"type": "array", "items": _object_schema({
        "section": _SECTION_SCHEMA, "body": {"type": "string"},
        "topic": _TOPIC_SCHEMA, "highlight": {"type": "boolean"},
    })},
})
SORT_SCHEMA = _object_schema({
    "lines": {"type": "array", "items": _object_schema({
        "n": {"type": "integer"}, "section": _SECTION_SCHEMA,
        "topic": _TOPIC_SCHEMA, "highlight": {"type": "boolean"},
    })},
})


def _line_id(bullets: list[dict[str, Any]], item: dict[str, Any]) -> str:
    if "n" in item:
        n = item["n"]
        if type(n) is int and 1 <= n <= len(bullets):
            return str(bullets[n - 1].get("id") or "")
        return ""
    return str(item.get("id") or "").strip()


def sort_edits_from_response(
    bullets: list[dict[str, Any]], payload: dict[str, Any],
) -> list[dict[str, Any]]:
    lines = payload.get("lines")
    if not isinstance(lines, list):
        raise FeedbackError("Could not sort the note.")
    by_id = {str(bullet["id"]): bullet for bullet in bullets}
    placements = {}
    for item in lines:
        if not isinstance(item, dict) or not isinstance(item.get("section"), str):
            continue
        if item["section"] not in _SECTIONS:
            continue
        bullet_id = _line_id(bullets, item)
        if bullet_id in by_id and bullet_id not in placements:
            placements[bullet_id] = item
    edits = []
    highlights = 0
    for bullet_id, bullet in by_id.items():
        item = placements.get(bullet_id, {})
        section = item.get("section", bullet["section"])
        if forced_technical(str(bullet.get("body") or "")):
            section = "technical"
        topic = item.get("topic", bullet.get("topic"))
        if section not in {"new", "adjusted"} or not isinstance(topic, str) or topic not in _TOPICS:
            topic = None
        highlight = item.get("highlight") is True
        highlight = highlight and section != "technical" and highlights < 6
        highlights += int(highlight)
        if (section, topic, highlight) == (
            bullet["section"], bullet.get("topic"), bool(bullet.get("highlight")),
        ):
            continue
        edits.append({"id": bullet_id, "section": section, "topic": topic, "highlight": highlight})
    return edits


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
