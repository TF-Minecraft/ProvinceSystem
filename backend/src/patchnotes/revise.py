"""Turn a staff deny reason into a new pending line.

The reason is an instruction. It is not copied into the public note.
Only an explicit replacement, such as "say: Added a station", becomes the
line. Feedback that covers several points is handled for the whole week,
not here. A line that should not be published is left denied.
"""

from __future__ import annotations

import re

from .summarize import player_text

_EXPLICIT = re.compile(
    r"(?is)^(?:please\s+)?(?:say|instead|change(?:\s+it)?\s+to|use|rewrite(?:\s+to)?|post)\s*:\s*(.+)$"
)
_DROP = re.compile(
    r"(?i)\b("
    r"don'?t post|do not post|leave (?:it|this) out|drop (?:it|this)|"
    r"remove (?:it|this|the line)|not player(?:\s|-)?facing|not for players|"
    r"internal only|spoilers?|lore items?|hidden knowledge"
    r")\b"
)
_STRIP = re.compile(
    r"(?i)(?:don'?t mention|do not mention|remove|without|omit|hide|leave out)\s+(.+)$"
)
_SECTION_INTENT = re.compile(
    r"(?i)\b(?:make (?:it|this)|move (?:it|this) to|this is|put (?:it|this) in)\b"
)
_QUOTED = re.compile(r"[\"“”']([^\"“”']{2,80})[\"“”']")
_SKIP_PHRASES = frozenset({"it", "this", "that", "the line", "line", "this line"})


def rewrite(section: str, body: str, reason: str) -> tuple[str, str] | None:
    """A new section and body, or None when the line should stay denied.

    The result has already passed the player-text check.
    """
    text = body.strip()
    note = reason.strip()
    if not text or not note:
        return None
    explicit = _explicit_replacement(note)
    if explicit is not None:
        return _accept(section, text, explicit, note)
    if _DROP.search(note):
        return None
    stripped = _strip_requested(text, note)
    candidate = stripped if stripped is not None else text
    return _accept(section, text, candidate, note)


def _accept(section: str, original: str, candidate: str, reason: str) -> tuple[str, str] | None:
    cleaned = player_text(candidate)
    if cleaned is None:
        return None
    new_section = _section_of(reason, section)
    if cleaned == original and new_section == section:
        return None
    return new_section, cleaned


def _explicit_replacement(reason: str) -> str | None:
    match = _EXPLICIT.match(reason.strip())
    if match is None:
        return None
    text = match.group(1).strip()
    return text or None


def _section_of(reason: str, current: str) -> str:
    if _SECTION_INTENT.search(reason) is None:
        return current
    lowered = reason.lower()
    if "technical" in lowered:
        return "technical"
    if "bugfix" in lowered or "bug fix" in lowered or re.search(r"\bfix(?:ed)?\b", lowered):
        return "fixed"
    if re.search(r"\bnew\b", lowered):
        return "new"
    if "adjust" in lowered:
        return "adjusted"
    return current


def _strip_requested(body: str, reason: str) -> str | None:
    phrases = [item.strip() for item in _QUOTED.findall(reason)]
    match = _STRIP.search(reason)
    if match is not None:
        phrase = match.group(1).strip(" .")
        phrase = phrase.split(",")[0].strip()
        phrase = re.sub(r"^(?:the|a|an)\s+", "", phrase, flags=re.IGNORECASE)
        if phrase.lower() not in _SKIP_PHRASES:
            phrases.append(phrase)
    if not phrases:
        return None
    updated = body
    for phrase in phrases:
        if len(phrase) < 2 or phrase.lower() in _SKIP_PHRASES:
            continue
        pattern = r"(?i)(?<![A-Za-z0-9])" + re.escape(phrase) + r"(?![A-Za-z0-9])"
        updated = re.sub(pattern, " ", updated)
    updated = re.sub(r"\s+", " ", updated).strip(" \t-:,")
    updated = re.sub(r"\s+([.!?])", r"\1", updated)
    if not updated or updated == body:
        return None
    return updated
