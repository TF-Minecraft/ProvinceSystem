"""Pending notes from TFMCMain MMOItems item files.

The dev server is never read. The first scan only remembers the files.
Later scans turn a player-facing change into one pending line. Lore text,
commands, permissions, and stat numbers stay out of that line.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from .summarize import player_text

_COLOR = re.compile(
    r"[&§][0-9a-fk-or]|&#[0-9a-fA-F]{6}|<[^>\n]{1,48}>",
    re.IGNORECASE,
)
_STAT_LABELS = {
    "attack-damage": "attack damage",
    "attack-speed": "attack speed",
    "armor": "armor",
    "armor-toughness": "armor toughness",
    "blunt-power": "blunt power",
    "blunt-rating": "blunt rating",
    "critical-strike-chance": "critical chance",
    "pve-damage": "damage against creatures",
    "pvp-damage": "damage against players",
    "damage-reduction": "damage reduction",
    "max-health": "health",
    "movement-speed": "movement speed",
    "crafting": "recipe",
    "required-class": "class requirement",
    "restore-health": "healing",
    "restore-food": "food restored",
    "max-stack-size": "stack size",
    "two-handed": "grip",
    "mana-cost": "mana cost",
    "cooldown-reduction": "cooldown",
}
_MAX_BODY = 240


@dataclass(frozen=True)
class ItemDraft:
    section: str
    body: str
    source_key: str


@dataclass(frozen=True)
class CatalogSync:
    state: dict
    drafts: list[ItemDraft]
    withheld: int
    baselined: bool


def assert_main_item_dir(path: Path) -> Path:
    """The item directory on TFMCMain. Any dev path is refused."""
    resolved = path.resolve()
    parts = resolved.parts
    if any(part.lower().startswith("tfmcdev") for part in parts):
        raise ValueError("The dev server is not watched")
    if "TFMCMain01" not in parts:
        raise ValueError("Only TFMCMain is watched")
    if resolved.name != "item" or resolved.parent.name != "MMOItems":
        raise ValueError("Path must be the MMOItems item directory")
    return resolved


def sync_catalog(previous: dict | None, files: dict[str, str]) -> CatalogSync:
    """Diff item YAML against the last snapshot.

    `previous` None is the first scan: remember everything and draft nothing.
    A file that fails to parse, or that suddenly loses most of its items, is
    left untouched so a half-written save cannot wipe the notes.
    """
    if previous is None:
        return CatalogSync(
            state=_baseline(files),
            drafts=[],
            withheld=0,
            baselined=True,
        )
    state = {name: dict(items) for name, items in previous.items() if isinstance(items, dict)}
    drafts: list[ItemDraft] = []
    withheld = 0
    for name in sorted(set(state) | set(files)):
        if name not in files:
            if _looks_truncated(state.get(name, {}), {}):
                continue
            file_drafts, file_withheld, items = _sync_file(name, state.get(name, {}), {})
        else:
            parsed = _parse_file(files[name])
            if parsed is None or _looks_truncated(state.get(name, {}), parsed):
                continue
            file_drafts, file_withheld, items = _sync_file(name, state.get(name, {}), parsed)
        state[name] = items
        drafts.extend(file_drafts)
        withheld += file_withheld
    return CatalogSync(state=state, drafts=drafts, withheld=withheld, baselined=False)


def _baseline(files: dict[str, str]) -> dict:
    state: dict = {}
    for name, text in files.items():
        parsed = _parse_file(text)
        if parsed is None:
            continue
        state[name] = parsed
    return state


def _parse_file(text: str) -> dict[str, dict] | None:
    if not text.strip():
        return {}
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        return None
    if data is None:
        return {}
    if not isinstance(data, dict):
        return None
    items: dict[str, dict] = {}
    for item_id, raw in data.items():
        if not isinstance(item_id, str) or not item_id.strip():
            continue
        if not isinstance(raw, dict):
            continue
        base = raw.get("base") if isinstance(raw.get("base"), dict) else raw
        if not isinstance(base, dict):
            continue
        items[item_id.strip()] = _snapshot(base)
    return items


def _snapshot(base: dict) -> dict:
    stats = {
        key: _digest(base.get(key))
        for key in _STAT_LABELS
        if key in base
    }
    return {
        "name": _plain_name(base.get("name")),
        "displayed_type": _plain_name(base.get("displayed-type")),
        "stats": stats,
    }


def _plain_name(value: object) -> str:
    text = _COLOR.sub("", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _digest(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, default=str, ensure_ascii=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _looks_truncated(previous: dict, parsed: dict) -> bool:
    before = len(previous)
    after = len(parsed)
    return before >= 5 and after * 2 < before


def _sync_file(
    filename: str,
    previous: dict,
    parsed: dict,
) -> tuple[list[ItemDraft], int, dict]:
    drafts: list[ItemDraft] = []
    withheld = 0
    for item_id in sorted(set(previous) | set(parsed)):
        old = previous.get(item_id)
        new = parsed.get(item_id)
        draft, hidden = _draft_change(filename, item_id, old, new)
        if hidden:
            withheld += 1
        elif draft is not None:
            drafts.append(draft)
    return drafts, withheld, parsed


def _draft_change(
    filename: str,
    item_id: str,
    old: dict | None,
    new: dict | None,
) -> tuple[ItemDraft | None, bool]:
    if old == new:
        return None, False
    shown = _shown_name(new or old or {})
    if not shown or _hidden(shown):
        return None, True
    if new is None:
        sentence = f"Removed {shown}"
        section = "adjusted"
    elif old is None:
        kind = str(new.get("displayed_type") or "").strip()
        sentence = f"Added {kind} {shown}".replace("  ", " ").strip()
        section = "new"
    else:
        sentence, section = _edit_sentence(old, new, shown)
        if sentence is None:
            return None, False
    body = player_text(sentence)
    if body is None:
        return None, True
    if len(body) > _MAX_BODY:
        body = body[: _MAX_BODY - 1].rstrip() + "…"
    fingerprint = _digest({"old": old, "new": new})
    source = f"mmoitems:{filename}:{item_id}:{fingerprint}"
    if len(source) > 200:
        source = "mmoitems:" + _digest(source)
    return ItemDraft(section=section, body=body, source_key=source), False


def _hidden(text: str) -> bool:
    """True when the name itself must not be written into a note."""
    return player_text(f"Noted {text}") is None


def _shown_name(snap: dict) -> str:
    name = str(snap.get("name") or "").strip()
    if name:
        return name
    return str(snap.get("displayed_type") or "").strip()


def _edit_sentence(old: dict, new: dict, shown: str) -> tuple[str | None, str]:
    old_stats = old.get("stats") if isinstance(old.get("stats"), dict) else {}
    new_stats = new.get("stats") if isinstance(new.get("stats"), dict) else {}
    changed = sorted(
        key for key in set(old_stats) | set(new_stats) if old_stats.get(key) != new_stats.get(key)
    )
    renamed = str(old.get("name") or "") != str(new.get("name") or "")
    if not changed and not renamed and old.get("displayed_type") == new.get("displayed_type"):
        return None, "adjusted"
    if changed == ["crafting"]:
        return f"Changed the recipe for {shown}", "adjusted"
    if len(changed) == 1 and not renamed:
        label = _STAT_LABELS.get(changed[0], "stats")
        return f"Adjusted the {label} of {shown}", "adjusted"
    if renamed and not changed:
        previous = str(old.get("name") or "").strip()
        if previous and not _hidden(previous):
            return f"Renamed {previous} to {shown}", "adjusted"
        return f"Renamed an item to {shown}", "adjusted"
    return f"Adjusted {shown}", "adjusted"
