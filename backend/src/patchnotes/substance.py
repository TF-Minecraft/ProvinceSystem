"""Turn a plugin file diff into a player-facing line, or nothing.

A hash change is not a patch note. The previous and current text are compared.
Whitespace, comments, key order, player saves, coordinates, and lore do not
count. If the remaining change cannot be named, it is dropped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import yaml

from .summarize import player_text

_COLOR = re.compile(
    r"[&§][0-9a-fk-or]|&#[0-9a-fA-F]{6}|<[^>\n]{1,48}>|#[0-9a-fA-F]{6}",
    re.IGNORECASE,
)
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_SKIP_KEYS = frozenset(
    {
        "x",
        "y",
        "z",
        "yaw",
        "pitch",
        "world",
        "config-version",
        "configversion",
        "version",
        "timestamp",
        "last-modified",
        "lastmodified",
        "generated",
        "revision",
        "date",
        "week",
        "day",
        "lore",
        "permission",
        "permissions",
        "players",
        "playerdata",
        "userdata",
    }
)
_NAME_KEYS = ("name", "display", "display-name", "displayname", "displayed-type", "title")
_LABELS = {
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
    "health": "health",
    "movement-speed": "movement speed",
    "crafting": "recipe",
    "recipe": "recipe",
    "recipes": "recipes",
    "required-class": "class requirement",
    "restore-health": "healing",
    "restore-food": "food value",
    "food": "food value",
    "nutrition": "food value",
    "saturation": "food value",
    "max-stack-size": "stack size",
    "material": "look",
    "price": "price",
    "cost": "cost",
    "cooldown": "cooldown",
    "mana-cost": "mana cost",
    "damage": "damage",
    "exp": "experience",
    "experience": "experience",
}
_PARENT_NOUN = {
    "activities": "activity",
    "mobs": "creature",
    "items": "item",
    "quests": "quest",
    "skills": "skill",
    "classes": "class",
    "recipes": "recipe",
    "stations": "station",
}
_MAX_FACTS = 3


@dataclass(frozen=True)
class FileReview:
    """`meaningful` is a real diff. `sentence` is omitted when it cannot be named."""

    meaningful: bool
    section: str = ""
    sentence: str = ""


def file_review(old_text: str | None, new_text: str | None, *, compared: bool) -> FileReview:
    """Review one file. `compared` is false when the previous text was not kept."""
    if not compared:
        return FileReview(False)
    old = _load(old_text)
    new = _load(new_text)
    if old is None or new is None:
        return FileReview(False)
    if _canon(old) == _canon(new):
        return FileReview(False)
    facts = _facts(old, new, parent="")
    if not facts:
        return FileReview(True)
    section, sentence = _join(facts)
    if not sentence:
        return FileReview(True)
    return FileReview(True, section, sentence)


def summarize_reviews(reviews: list[FileReview], *, dangerous: bool) -> tuple[str, str] | None:
    """One line for a folder, or None when the diff should not be posted."""
    if dangerous:
        if any(review.meaningful for review in reviews):
            return "adjusted", "A dungeon was adjusted on the main server."
        return None
    facts = [review for review in reviews if review.sentence]
    if not facts:
        return None
    section = "new" if facts and all(review.section == "new" for review in facts) else "adjusted"
    pieces: list[str] = []
    for review in facts:
        if review.sentence not in pieces:
            pieces.append(review.sentence)
        if len(pieces) == _MAX_FACTS:
            break
    body = player_text(". ".join(pieces))
    if body is None:
        return None
    return section, body


def _load(text: str | None):
    """Parse yaml. Missing text is an empty file. Unparseable text is None."""
    if text is None:
        return {}
    stripped = text.strip()
    if not stripped:
        return {}
    try:
        loaded = yaml.safe_load(stripped)
    except yaml.YAMLError:
        return None
    return loaded


def _plain(value: str) -> str:
    text = _COLOR.sub("", value)
    return re.sub(r"\s+", " ", text).strip()


def _skip_key(key: object) -> bool:
    text = str(key).strip()
    if not text:
        return True
    if text.lower() in _SKIP_KEYS or _UUID.fullmatch(text):
        return True
    return False


def _canon(value):
    if isinstance(value, dict):
        found = {}
        for key, item in value.items():
            if _skip_key(key):
                continue
            child = _canon(item)
            if child is None or child == {} or child == [] or child == "":
                continue
            found[str(key)] = child
        return found
    if isinstance(value, list):
        items = [_canon(item) for item in value]
        return [item for item in items if item is not None and item != "" and item != {}]
    if isinstance(value, str):
        return _plain(value)
    return value


def _title(node: object) -> str | None:
    if not isinstance(node, dict):
        return None
    for key in _NAME_KEYS:
        raw = node.get(key)
        if isinstance(raw, str):
            name = _safe_name(_plain(raw))
            if name:
                return name
    base = node.get("base")
    if isinstance(base, dict):
        return _title(base)
    return None


def _safe_name(name: str) -> str | None:
    if not name or len(name) > 60:
        return None
    if player_text(f"Noted {name}") is None:
        return None
    return name


def _facts(old, new, parent: str) -> list[tuple[str, str]]:
    if not isinstance(old, dict) or not isinstance(new, dict):
        return []
    if not _canon(old):
        return _added_tree(new, parent)
    if not _canon(new):
        return _removed_tree(old, parent)
    return _dict_facts(old, new, parent)


def _dict_facts(old: dict, new: dict, parent: str) -> list[tuple[str, str]]:
    facts: list[tuple[str, str]] = []
    keys = sorted(set(old) | set(new), key=str)
    for key in keys:
        if _skip_key(key):
            continue
        before = old.get(key)
        after = new.get(key)
        if _canon(before) == _canon(after):
            continue
        noun = _PARENT_NOUN.get(str(key), "")
        if isinstance(before, dict) and isinstance(after, dict):
            if _looks_like_entry(before) or _looks_like_entry(after):
                facts.extend(
                    _entry_facts(_title(before), _title(after), before, after, noun or parent)
                )
            else:
                facts.extend(_dict_facts(before, after, noun or parent or str(key)))
            continue
        if isinstance(after, dict) and before is None:
            facts.extend(_added_tree(after, noun or parent))
            continue
        if isinstance(before, dict) and after is None:
            facts.extend(_removed_tree(before, noun or parent))
            continue
        label = _LABELS.get(str(key))
        title = _title(new) or _title(old)
        if label and title:
            sentence = _safe_sentence(f"Adjusted the {label} of {title}")
            if sentence:
                facts.append(("adjusted", sentence))
    return _unique(facts)


def _entry_facts(old_name: str | None, new_name: str | None, old: dict, new: dict, noun: str) -> list[tuple[str, str]]:
    facts: list[tuple[str, str]] = []
    if old_name and new_name and old_name != new_name:
        sentence = _safe_sentence(f"Renamed {old_name} to {new_name}")
        if sentence:
            facts.append(("adjusted", sentence))
    title = new_name or old_name
    labels: list[str] = []
    for key in set(old) | set(new):
        if str(key) == "base" and isinstance(old.get(key), dict) and isinstance(new.get(key), dict):
            facts.extend(
                _entry_facts(
                    _title(old[key]) or title,
                    _title(new[key]) or title,
                    old[key],
                    new[key],
                    noun,
                )
            )
            continue
        if _skip_key(key) or key in _NAME_KEYS:
            continue
        if _canon(old.get(key)) == _canon(new.get(key)):
            continue
        label = _LABELS.get(str(key))
        if label and label not in labels:
            labels.append(label)
    if title and labels:
        if len(labels) == 1:
            sentence = _safe_sentence(f"Adjusted the {labels[0]} of {title}")
        elif len(labels) == 2:
            sentence = _safe_sentence(f"Adjusted the {labels[0]} and {labels[1]} of {title}")
        else:
            sentence = _safe_sentence(f"Adjusted {title}")
        if sentence:
            facts.append(("adjusted", sentence))
    elif title and _canon(old) != _canon(new) and not facts:
        sentence = _safe_sentence(_named("Adjusted", title, noun))
        if sentence:
            facts.append(("adjusted", sentence))
    return facts


def _added_tree(node: dict, noun: str) -> list[tuple[str, str]]:
    facts: list[tuple[str, str]] = []
    title = _title(node)
    if title:
        sentence = _safe_sentence(_named("Added", title, noun))
        if sentence:
            facts.append(("new", sentence))
        return facts
    for key, item in node.items():
        if _skip_key(key) or not isinstance(item, dict):
            continue
        child_noun = _PARENT_NOUN.get(str(key), noun)
        if _title(item):
            facts.extend(_added_tree(item, child_noun))
        else:
            for child in item.values():
                if isinstance(child, dict) and _title(child):
                    facts.extend(_added_tree(child, child_noun))
    return facts


def _removed_tree(node: dict, noun: str) -> list[tuple[str, str]]:
    title = _title(node)
    if title:
        sentence = _safe_sentence(_named("Removed", title, noun))
        if sentence:
            return [("adjusted", sentence)]
        return []
    facts: list[tuple[str, str]] = []
    for key, item in node.items():
        if _skip_key(key) or not isinstance(item, dict):
            continue
        child_noun = _PARENT_NOUN.get(str(key), noun)
        if _title(item):
            facts.extend(_removed_tree(item, child_noun))
        else:
            for child in item.values():
                if isinstance(child, dict) and _title(child):
                    facts.extend(_removed_tree(child, child_noun))
    return facts


def _looks_like_entry(node: dict) -> bool:
    return _title(node) is not None or isinstance(node.get("base"), dict)


def _named(verb: str, title: str, noun: str) -> str:
    if noun in {"activity", "quest", "class", "skill", "creature"} and noun not in title.lower():
        return f"{verb} the {title} {noun}"
    return f"{verb} {title}"


def _safe_sentence(text: str) -> str | None:
    cleaned = player_text(text)
    if cleaned is None:
        return None
    if cleaned[-1] not in ".!?":
        cleaned += "."
    return cleaned


def _join(facts: list[tuple[str, str]]) -> tuple[str, str]:
    unique = _unique(facts)[:_MAX_FACTS]
    if not unique:
        return "adjusted", ""
    section = "new" if all(item[0] == "new" for item in unique) else "adjusted"
    body = player_text(" ".join(sentence for _, sentence in unique))
    return section, body or ""


def _unique(facts: list[tuple[str, str]]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for section, sentence in facts:
        if sentence in seen:
            continue
        seen.add(sentence)
        found.append((section, sentence))
    return found
