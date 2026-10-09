"""Compare two TFMCMain plugin snapshots for the weekly Discord post.

A snapshot is the plugin config files and jar names of one AMP backup or a
live plugins folder. The week is its first backup against its last, so a
value changed several times this week only shows its final version, and a
change that was made and undone does not show at all.

Runtime state and player submissions are ignored. Lore and discoveries are
counted per plugin and never named. This module runs on the host, so it only
needs the standard library and PyYAML.
"""

from __future__ import annotations

import os
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .folders import REPO_FOLDERS, excluded_relative, rule_matches, skip_directory
from .substance import _canon, _plain, _skip_key, _title

MAX_FILE_BYTES = 1_000_000
MAX_DETAILS = 30
MAX_ENTRIES = 40
_ZIP_ROOTS = ("plugins/", "Minecraft/plugins/")

# Runtime state, player submissions and staff tools. Their edits are not news.
IGNORED = (
    "ItemsAdder/contents/tfmc_submissions/**",
    "ItemsAdder/storage/**",
    "ItemsAdder/contents/tfmc_drinks/**",
    "ArmourShop/Categories/ps_items.yml",
    "BreweryX/recipes.yml",
    "DrinkBuilder/**",
    "BirdMessenger/**",
    "CoreProtect/**",
    "Essentials/**",
    "LuckPerms/**",
    "TFMCWeb/**",
    "VotingPlugin/**",
    "WorldGuard/**",
    "**/*cooldown*.yml",
    "**/*pending*.yml",
    "**/*in_flight*.yml",
    "**/ServerData.yml",
    "**/reward-lock.yml",
    "**/cmd-state.yml",
    "**/drop-limits.yml",
    "**/messages*.yml",
    "**/help.yml",
    "**/lang/**",
    "**/language/**",
    "**/locale/**",
)
# Discoveries and lore. A change is counted for its plugin and never named.
HIDDEN = (
    "Codex/**",
    "Research/**",
    "MythicDungeons/**",
    "MythicMobs/dialogs/**",
    "MythicMobs/cutscenes/**",
    "ConditionalEvents/events/codex.yml",
    "MMOItems/item/research.yml",
    "Magic/elements/**",
)

_JAR = re.compile(
    r"^(?P<name>[A-Za-z][A-Za-z0-9_.+-]*?)[-_ ]v?(?P<version>\d+(?:\.\d+)+(?:[-+.][A-Za-z0-9]+)*)\.jar$"
)
_ID = re.compile(r"^[A-Z0-9_]{3,}$")


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


_REPO_BY_KEY = {_key(folder): repo for folder, repo in REPO_FOLDERS.items()}
_REPO_BY_KEY.update({_key(repo): repo for repo in REPO_FOLDERS.values()})


@dataclass
class Snapshot:
    """Config text by `Plugin/path.yml`, and jar versions by plugin key."""

    files: dict[str, str] = field(default_factory=dict)
    jars: dict[str, tuple[str, str]] = field(default_factory=dict)


def _matches(relative: str, patterns: tuple[str, ...]) -> bool:
    return any(rule_matches(pattern, relative) for pattern in patterns)


def tracked_config(relative: str) -> bool:
    """A plugin config file the weekly post compares."""
    if "/" not in relative or not relative.lower().endswith((".yml", ".yaml")):
        return False
    if excluded_relative(relative):
        return False
    return not _matches(relative, IGNORED)


def hidden_config(relative: str) -> bool:
    return _matches(relative, HIDDEN)


def jar_entry(filename: str) -> tuple[str, str, str] | None:
    """Plugin key, display name and version from a jar file name."""
    if not filename.lower().endswith(".jar") or "/" in filename:
        return None
    match = _JAR.match(filename)
    if match is None:
        stem = filename[:-4]
        return _key(stem), stem, ""
    name = match.group("name")
    return _key(name), name, match.group("version")


def _add_jar(snapshot: Snapshot, filename: str) -> None:
    entry = jar_entry(filename)
    if entry is None or not entry[0]:
        return
    key, name, version = entry
    snapshot.jars[key] = (name, version)


def _plugin_relative(name: str) -> str | None:
    for root in _ZIP_ROOTS:
        if name.startswith(root):
            return name[len(root):]
    return None


def snapshot_from_zip(path: Path) -> Snapshot:
    """Read config files and jar names from an AMP backup without unpacking it."""
    snapshot = Snapshot()
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            relative = _plugin_relative(info.filename.replace("\\", "/"))
            if relative is None:
                continue
            if "/" not in relative:
                _add_jar(snapshot, relative)
                continue
            if info.file_size > MAX_FILE_BYTES or not tracked_config(relative):
                continue
            snapshot.files[relative] = archive.read(info).decode("utf-8", errors="replace")
    return snapshot


def snapshot_from_dir(plugins: Path) -> Snapshot:
    """The same snapshot from a live plugins folder."""
    snapshot = Snapshot()
    root = plugins.resolve()
    for entry in root.iterdir():
        if entry.is_file():
            _add_jar(snapshot, entry.name)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if not skip_directory(name)]
        for filename in filenames:
            path = Path(dirpath) / filename
            relative = path.relative_to(root).as_posix()
            if not tracked_config(relative):
                continue
            try:
                if path.stat().st_size > MAX_FILE_BYTES:
                    continue
                snapshot.files[relative] = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
    return snapshot


def _load(text: str | None) -> Any:
    if text is None or not text.strip():
        return {}
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError:
        return None


def _skill_names(snapshot: Snapshot) -> dict[str, str]:
    """MythicLib skill ids to the names players see, for class skill lists."""
    names: dict[str, str] = {}
    for relative, text in snapshot.files.items():
        if not relative.startswith("MythicLib/skill/"):
            continue
        loaded = _load(text)
        if not isinstance(loaded, dict):
            continue
        for skill_id, node in loaded.items():
            if isinstance(node, dict) and isinstance(node.get("name"), str):
                name = _plain(node["name"])
                if name:
                    names[str(skill_id).upper()] = name
    return names


def _segment(key: object, names: dict[str, str]) -> str:
    text = str(key)
    if _ID.fullmatch(text) and text in names:
        return names[text]
    return text


def _fmt(value: Any, limit: int = 120) -> str:
    if value is None:
        return "none"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        text = _plain(value)
    elif isinstance(value, (int, float)):
        text = str(value)
    elif isinstance(value, list):
        if all(not isinstance(item, (dict, list)) for item in value):
            text = "[" + ", ".join(_fmt(item, 40) for item in value) + "]"
        else:
            text = f"{len(value)} entries"
    elif isinstance(value, dict):
        text = _brief(value)
    else:
        text = str(value)
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _long_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 3 and all(
        not isinstance(item, (dict, list)) for item in value
    )


def _list_change(before: list, after: list) -> str:
    """Lines added to and removed from a long list, such as a skill's mechanics."""
    old = [_fmt(item, 100) for item in before]
    new = [_fmt(item, 100) for item in after]
    removed = [item for item in old if item not in new]
    added = [item for item in new if item not in old]
    parts = []
    if removed:
        parts.append("removed " + " | ".join(removed[:6]))
    if added:
        parts.append("added " + " | ".join(added[:6]))
    return "; ".join(parts) or "reordered"


def _brief(node: dict) -> str:
    parts = []
    for key, value in node.items():
        if _skip_key(key) or isinstance(value, (dict, list)):
            continue
        parts.append(f"{key}={_fmt(value, 40)}")
    return ", ".join(parts) or f"{len(node)} keys"


def _leaf_changes(old: Any, new: Any, names: dict[str, str], prefix: str = "") -> list[str]:
    """`path: old --> new` for every value that differs, final values only."""
    out: list[str] = []

    def walk(before: Any, after: Any, path: str) -> None:
        if len(out) > MAX_DETAILS:
            return
        if isinstance(before, dict) and isinstance(after, dict):
            for key in sorted(set(before) | set(after), key=str):
                if _skip_key(key):
                    continue
                b, a = before.get(key), after.get(key)
                if _canon(b) == _canon(a):
                    continue
                label = _segment(key, names)
                child = f"{path}.{label}" if path else label
                if b is None and isinstance(a, dict):
                    out.append(f"{child}: added ({_brief(a)})")
                elif a is None and isinstance(b, dict):
                    out.append(f"{child}: removed")
                else:
                    walk(b, a, child)
            return
        if _long_list(before) and _long_list(after):
            out.append(f"{path or 'value'}: {_list_change(before, after)}")
            return
        out.append(f"{path or 'value'}: {_fmt(before)} --> {_fmt(after)}")

    walk(old, new, prefix)
    if len(out) > MAX_DETAILS:
        hidden = len(out) - MAX_DETAILS
        out = out[:MAX_DETAILS] + [f"and {hidden} more changed values"]
    return out


def _summary(node: Any, names: dict[str, str]) -> list[str]:
    """The values of something new, flattened to a few lines."""
    out: list[str] = []

    def walk(value: Any, path: str, depth: int) -> None:
        if len(out) >= MAX_DETAILS:
            return
        if isinstance(value, dict) and depth < 4:
            for key, item in value.items():
                if _skip_key(key):
                    continue
                label = _segment(key, names)
                walk(item, f"{path}.{label}" if path else label, depth + 1)
            return
        out.append(f"{path or 'value'}: {_fmt(value)}")

    walk(node, "", 0)
    return out


def _root_name(node: Any) -> str | None:
    """A file that is one thing as a whole, such as an MMOCore class."""
    if not isinstance(node, dict):
        return None
    display = node.get("display")
    if isinstance(display, dict) and isinstance(display.get("name"), str):
        name = _plain(display["name"])
        return name or None
    return None


@dataclass
class EntryChange:
    name: str
    kind: str
    details: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "kind": self.kind, "details": list(self.details)}


def file_entries(old: Any, new: Any, names: dict[str, str]) -> list[EntryChange]:
    """Changes in one file, grouped by the thing a player would recognise."""
    kind = "added" if not _canon(old) else "removed" if not _canon(new) else "changed"
    root = _root_name(new) or _root_name(old)
    if root:
        if kind == "added":
            return [EntryChange(root, kind, _summary(new, names))]
        if kind == "removed":
            return [EntryChange(root, kind)]
        return [EntryChange(root, kind, _leaf_changes(old, new, names))]
    if not isinstance(old, dict) or not isinstance(new, dict):
        return [EntryChange("file", "changed", [f"value: {_fmt(old)} --> {_fmt(new)}"])]
    entries: list[EntryChange] = []
    settings: list[str] = []
    for key in sorted(set(old) | set(new), key=str):
        if _skip_key(key):
            continue
        before, after = old.get(key), new.get(key)
        if _canon(before) == _canon(after):
            continue
        if isinstance(before, dict) or isinstance(after, dict):
            name = _title(after, str(key)) or _title(before, str(key)) or _segment(key, names)
            if before is None:
                entries.append(EntryChange(name, "added", _summary(after, names)))
            elif after is None:
                entries.append(EntryChange(name, "removed"))
            else:
                entries.append(EntryChange(name, "changed", _leaf_changes(before, after, names)))
        else:
            settings.append(f"{_segment(key, names)}: {_fmt(before)} --> {_fmt(after)}")
    if settings:
        entries.insert(0, EntryChange("settings", "changed", settings[:MAX_DETAILS]))
    if len(entries) > MAX_ENTRIES:
        extra = len(entries) - MAX_ENTRIES
        entries = entries[:MAX_ENTRIES] + [EntryChange(f"{extra} more entries", "changed")]
    return entries


def _hidden_count(old: Any, new: Any) -> int:
    if isinstance(old, dict) and isinstance(new, dict):
        count = sum(
            1
            for key in set(old) | set(new)
            if not _skip_key(key) and _canon(old.get(key)) != _canon(new.get(key))
        )
        return max(count, 1)
    return 1


def compare(base: Snapshot, current: Snapshot) -> dict[str, Any]:
    """Config and plugin changes between two snapshots, as JSON-ready facts."""
    names = _skill_names(current)
    names.update({k: v for k, v in _skill_names(base).items() if k not in names})
    files: list[dict[str, Any]] = []
    hidden: dict[str, int] = {}
    for relative in sorted(set(base.files) | set(current.files)):
        before_text = base.files.get(relative)
        after_text = current.files.get(relative)
        if before_text == after_text:
            continue
        old, new = _load(before_text), _load(after_text)
        if old is None or new is None or _canon(old) == _canon(new):
            continue
        plugin = relative.split("/", 1)[0]
        if hidden_config(relative):
            hidden[plugin] = hidden.get(plugin, 0) + _hidden_count(old, new)
            continue
        entries = file_entries(old, new, names)
        if not entries:
            continue
        kind = "added" if before_text is None else "removed" if after_text is None else "changed"
        files.append(
            {
                "path": relative,
                "plugin": plugin,
                "kind": kind,
                "entries": [entry.as_dict() for entry in entries],
            }
        )
    return {"files": files, "hidden": hidden, "plugins": plugin_updates(base, current)}


def plugin_updates(base: Snapshot, current: Snapshot) -> list[dict[str, Any]]:
    """Plugins whose jar changed. Our own plugins carry their GitHub repo."""
    updates: list[dict[str, Any]] = []
    for key in sorted(set(base.jars) | set(current.jars)):
        before = base.jars.get(key)
        after = current.jars.get(key)
        old_version = before[1] if before else None
        new_version = after[1] if after else None
        if before and after and old_version == new_version:
            continue
        name = (after or before)[0]
        updates.append(
            {
                "plugin": name,
                "repo": _REPO_BY_KEY.get(key),
                "old": old_version,
                "new": new_version,
            }
        )
    return updates
