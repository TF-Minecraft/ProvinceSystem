"""Write the weekly Discord post from the week's facts.

The facts are the start of the note week against its end on TFMCMain, plus
the commits behind each plugin update. The rewrite agent turns them into a
few Discord messages in the staff style: Balance, then Gameplay, then Fixes,
with old --> new numbers and a short human reason for each part. Staff
feedback rewrites the whole post. If the agent fails, a plain list built
from the facts stands in so the week is never empty.
"""

from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

from .feedback import FeedbackError
from .safety import hidden_knowledge_warning
from .summarize import (
    _COORDS,
    _DIFF,
    _EXPLOIT,
    _KIND_SECTION,
    _NOT_PLAYER_FACING,
    _PERMISSION,
    _SECRET,
    _split_conventional,
)

DISCORD_LIMIT = 2000
# The bot puts the role ping in front of the first message.
FIRST_LIMIT = 1900
MAX_MESSAGES = 10
_FACTS_BUDGET = 60_000
_MENTION = re.compile(r"@(everyone|here)|<@[!&]?\d+>")
_FENCE = re.compile(r"^```[a-z]*\n?|\n?```$")
_MONTHS = (
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
)

_GUIDE = """Answer from this message only. Do not run commands or read files.
You write the weekly update post for TFMC, a roleplay Minecraft server, in the voice of its staff.
Players read it in Discord. Write for a normal player: plain words, no file names, config keys,
plugin names, class ids or programming terms. Sound human and friendly, like staff talking to players.

Structure, in this order:
1. Title. {title_rule} Then `-# {week_line}` on its own line.
   Add a `## ` subtitle naming the biggest change only when one change clearly stands out. Most weeks need none.
   Then one or two sentences introducing the week.
2. `# ⚔️ Balance Changes`: classes, attributes, skills and spells, new skills, and number changes that
   matter in a fight (damage, health, armour, cooldowns, weapon stats).
3. `# ⚙️ Gameplay Changes`: anything that changes how an existing system works, such as a node producing
   faster, something dropping more, a new mechanic, crafting, professions, farming, animals, factions, trade.
4. `# 🔧 Fixes`: only the fixes players will notice most, as short bullets.
5. End with exactly this line: `-# Smaller and technical changes are on the website: <{page_url}>`

Rules:
- Use `## ` and `### ` subheadings inside a section to group related changes, bullets with `- `, and
  **bold** for the thing that changed. `-# ` is small text for side notes.
- Start every subheading's group with one short sentence explaining why it changed or what it means for players.
- Write numbers as `Old --> New`. Use only numbers that appear in the facts. Never invent a number or a reason.
  When you do not understand what a value means, describe the change in words without the number.
- The facts already compare the start of the week with its end, so every number is the final value.
  Mention each change once.
- Something marked added is new this week: describe it as it is now, not as a change.
- Leave out runtime data, staff-only tools, logging, performance work and anything technical.
- Never name or describe anything under hidden. You may say there are new things to discover.
- Never reveal lore items, codex or research entries, dungeon names or details, hidden magic schools,
  exact crafting recipes or hit counts, coordinates, commands, permissions or exploits.
- Never write @everyone, @here or any mention. The bot adds the role ping itself.
- Never use an em dash.
- Split the post into Discord messages in order. Each message must stay under 1900 characters.
  Start a new message at a heading, never in the middle of a list.
- Section headings are fixed. Leave a section out only when nothing belongs in it.

Return one JSON object and nothing else: {{"messages": ["first message", "second message"]}}
"""

_GLOSSARY = """Reading the facts:
- `attributes.max_health.base: 30 --> 28` is a class's starting health; `per-level` is gained per level.
- `damage-reduction`, `physical-damage`, `projectile_damage`, `critical_strike_chance` and `weapon_damage`
  are percentages. `health-regeneration` is health per second. `max-mana` and `mana-regeneration` work the same way.
- A skill's `level` in a class is the class level that unlocks it.
- `time_modifier(N)` adds N percent to production time, so lower is faster. `prestige(N)` and `upkeep(N)`
  are Dowsing node values.
- `required-class` lists the classes that may use an item.
- Plugin updates list the subjects of the code changes behind them. Use them to explain new mechanics
  and fixes in plain words.
"""

POST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"messages": {"type": "array", "items": {"type": "string"}}},
    "required": ["messages"],
}


def week_line(week: str) -> str:
    """`Week of 5 October 2026` for the Monday of an ISO week."""
    match = re.fullmatch(r"(\d{4})-W(\d{2})", week)
    if match is None:
        return week
    monday = date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
    return f"Week of {monday.day} {_MONTHS[monday.month - 1]} {monday.year}"


def title_lines(label: str, act: str | None) -> list[str]:
    if act:
        return [f"# {act}", f"## Update {label}"]
    return [f"# Update {label}"]


def _title_rule(label: str, act: str | None) -> str:
    if act:
        return (
            f"This is an act change week: start with `# {act}`, then `## Update {label}`. "
            f"Explain what the new act changes for players in its own short section before Balance Changes."
        )
    return f"Start with `# Update {label}`."


# Balance first, then systems, then skill mechanics, then looks and vehicles.
_FILE_RANKS = (
    ("MMOCore/", 0),
    ("MythicLib/", 1),
    ("MMOItems/", 1),
    ("AdvancedCrafting/", 1),
    ("Magic/", 1),
    ("MythicMobs/", 3),
    ("VehicleFramework/vehicles/", 4),
    ("ArmourShop/", 4),
    ("ItemsAdder/", 4),
)
_FILE_BUDGET = 2500
_ENTRY_DETAILS = 10


def _file_rank(path: str) -> int:
    for prefix, rank in _FILE_RANKS:
        if path.startswith(prefix):
            return rank
    return 2


def _render_file(item: dict[str, Any]) -> str:
    lines = [f"## {item.get('path')} ({item.get('kind')})"]
    for entry in item.get("entries") or []:
        if not isinstance(entry, dict):
            continue
        details = [str(detail) for detail in entry.get("details") or []]
        if len(details) > _ENTRY_DETAILS:
            details = details[:_ENTRY_DETAILS] + [f"and {len(details) - _ENTRY_DETAILS} more"]
        head = f"- {entry.get('name')} ({entry.get('kind')})"
        lines.append(head + (": " + "; ".join(details) if details else ""))
    text = "\n".join(lines)
    if len(text) > _FILE_BUDGET:
        text = text[:_FILE_BUDGET].rsplit("\n", 1)[0] + "\n- (more changes in this file)"
    return text


def render_facts(facts: dict[str, Any], budget: int = _FACTS_BUDGET) -> str:
    """The facts as plain text for the writer, trimmed to fit the prompt."""
    lines: list[str] = []
    if facts.get("partial"):
        lines.append("Note: the oldest backup is newer than the start of the week, so early changes may be missing.")
    plugins = [item for item in facts.get("plugins") or [] if isinstance(item, dict)]
    if plugins:
        lines.append("Plugin updates on the main server:")
        for item in plugins:
            old, new = item.get("old") or "none", item.get("new") or "removed"
            lines.append(f"- {item.get('plugin')}: {old} --> {new}")
            for subject in item.get("commits") or []:
                lines.append(f"  - {subject}")
    files = [item for item in facts.get("files") or [] if isinstance(item, dict)]
    if files:
        lines.append("Config changes, start of week --> end of week:")
        for item in sorted(files, key=lambda found: (_file_rank(str(found.get("path") or "")), found.get("path"))):
            lines.append(_render_file(item))
    hidden = facts.get("hidden") or {}
    if isinstance(hidden, dict) and hidden:
        lines.append("Hidden (count only, never name or describe):")
        for plugin, count in sorted(hidden.items()):
            lines.append(f"- {plugin}: {count} changed entries")
    text = "\n".join(lines)
    if len(text) > budget:
        text = text[:budget].rsplit("\n", 1)[0] + "\n(more changes were left out to fit)"
    return text or "No changes were found this week."


def compose_prompt(
    facts: dict[str, Any],
    *,
    week: str,
    label: str,
    act: str | None,
    page_url: str,
    previous: list[str] | None = None,
    feedback: str | None = None,
) -> str:
    guide = _GUIDE.format(
        title_rule=_title_rule(label, act),
        week_line=week_line(week),
        page_url=f"{page_url.rstrip('/')}/{week}",
    )
    parts = [guide, _GLOSSARY, "Facts:", render_facts(facts)]
    if previous and feedback:
        parts += [
            "Current post:",
            json.dumps(previous, ensure_ascii=False),
            "Staff feedback on the current post. It is an instruction, not new wording, unless staff clearly "
            "give a sentence to publish. Rewrite the whole post with every point of the feedback applied:",
            feedback,
        ]
    return "\n\n".join(parts)


def unsafe_line(line: str) -> bool:
    return bool(
        hidden_knowledge_warning(line)
        or _SECRET.search(line)
        or _DIFF.search(line)
        or _EXPLOIT.search(line)
        or _PERMISSION.search(line)
        or _COORDS.search(line)
    )


def clean_message(text: str) -> str:
    text = _FENCE.sub("", text.strip()).strip()
    text = _MENTION.sub("", text).replace("—", ", ").replace("–", "-")
    lines = [line.rstrip() for line in text.splitlines() if not unsafe_line(line)]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def split_message(text: str, limit: int) -> list[str]:
    """Pieces under `limit`, cut at headings first and then at line breaks."""
    if len(text) <= limit:
        return [text]
    pieces: list[str] = []
    current = ""
    for line in text.splitlines(keepends=True):
        if len(line) > limit:
            line = line[: limit - 2] + "…\n"
        heading = line.startswith("#")
        if current and (len(current) + len(line) > limit or (heading and len(current) > limit * 0.6)):
            pieces.append(current.strip())
            current = ""
        current += line
    if current.strip():
        pieces.append(current.strip())
    return pieces


def fit_messages(messages: list[str]) -> list[str]:
    fitted: list[str] = []
    for message in messages:
        limit = FIRST_LIMIT if not fitted else DISCORD_LIMIT - 50
        fitted.extend(piece for piece in split_message(message, limit) if piece)
    return fitted


def messages_from_response(payload: dict[str, Any]) -> list[str]:
    raw = payload.get("messages")
    if not isinstance(raw, list):
        raise FeedbackError("The writer did not return any messages.")
    cleaned = [clean_message(item) for item in raw if isinstance(item, str)]
    messages = fit_messages([item for item in cleaned if item])
    if not messages:
        raise FeedbackError("The writer returned an empty post.")
    if len(messages) > MAX_MESSAGES:
        raise FeedbackError("The writer returned a post that is too long for Discord.")
    return messages


def _plain_subject(subject: str) -> str:
    """A commit subject without its `fix:` prefix, or empty for technical work."""
    kind, text = _split_conventional(subject)
    if _KIND_SECTION.get(kind) == "technical" or _NOT_PLAYER_FACING.search(text) or _TEST_WORK.search(text):
        return ""
    return text[:1].upper() + text[1:]


_TEST_WORK = re.compile(r"(?i)\b(coverage|tests?|ci|refactor)\b")


_VAGUE_KEYS = frozenset({"base", "per-level", "value", "amount"})


def _readable(detail: str) -> str:
    """`attributes.max_health.base: 30 --> 28` as `max health base: 30 --> 28`."""
    path, _, change = detail.partition(": ")
    parts = path.split(".")
    keep = parts[-2:] if len(parts) > 1 and parts[-1] in _VAGUE_KEYS else parts[-1:]
    name = " ".join(keep).replace("_", " ").replace("-", " ")
    return f"{name}: {change}" if change else detail


def fallback_messages(facts: dict[str, Any], *, week: str, label: str, act: str | None, page_url: str) -> list[str]:
    """A plain post straight from the facts, for when the writer is unavailable."""
    lines = title_lines(label, act) + [f"-# {week_line(week)}", "", "Here is what changed on the server this week."]
    plugins = [item for item in facts.get("plugins") or [] if isinstance(item, dict)]
    subjects = [
        _plain_subject(str(subject))
        for item in plugins
        for subject in item.get("commits") or []
        if _plain_subject(str(subject))
    ]
    if subjects:
        lines += ["", "## Changes"]
        lines += [f"- {subject}" for subject in subjects[:25]]
    entries = []
    for item in facts.get("files") or []:
        for entry in (item or {}).get("entries") or []:
            if not isinstance(entry, dict) or entry.get("name") == "settings":
                continue
            details = [_readable(str(detail)) for detail in entry.get("details") or []][:4]
            if entry.get("kind") == "added":
                entries.append(f"- **{entry.get('name')}** is new")
            elif entry.get("kind") == "removed":
                entries.append(f"- **{entry.get('name')}** was removed")
            elif details:
                entries.append(f"- **{entry.get('name')}:** " + "; ".join(details))
    if entries:
        lines += ["", "## Adjustments"] + entries[:40]
    if facts.get("hidden"):
        lines += ["", "-# There are also new things to discover."]
    lines += ["", f"-# Smaller and technical changes are on the website: <{page_url.rstrip('/')}/{week}>"]
    text = clean_message("\n".join(lines))
    return fit_messages([text])[:MAX_MESSAGES]
