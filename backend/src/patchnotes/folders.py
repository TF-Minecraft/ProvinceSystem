"""Which plugin files on TFMCMain are worth a patch note.

Rules name kinds of files (`vehicles/*.yml`), not the files that existed when
watching started. A later file that matches is tracked. Player saves, databases,
logs, and lore files never match, even if a rule would otherwise include them.

MythicDungeons is dangerous: a change can be noted, but the note must not say
which dungeon changed or what it does.
"""

from __future__ import annotations

import fnmatch
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from .summarize import player_text

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,60}$")
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_LORE_PART = re.compile(r"lore", re.IGNORECASE)
_SECRET_NAME = re.compile(r"(password|secret|token|apikey|api_key|keystore)", re.IGNORECASE)

# Directory names that are runtime data at any depth.
HARD_DIRS = frozenset(
    {
        "userdata",
        "playerdata",
        "player-data",
        "globalplayerdata",
        "players",
        "logs",
        "log",
        "cache",
        "backups",
        "backup",
        "libs",
        "plugindata",
        "region",
        "data",
        ".codex-backups",
        "tmp",
        "temp",
    }
)
HARD_SUFFIXES = (
    ".db",
    ".db-wal",
    ".db-shm",
    ".jar",
    ".log",
    ".mca",
    ".dat",
    ".zip",
    ".lock",
)
SKIP_FILE_NAMES = frozenset(
    {
        "permissions.yml",
        "plugin.yml",
        "session.lock",
        "players.yml",
        "playerdata.yml",
        "usercache.yml",
    }
)

# Plugin folder on TFMCMain -> GitHub repo name. Aliases cover folders whose
# names are not the repository name.
REPO_FOLDERS: dict[str, str] = {
    "AACommandsFiller": "AACommandsFiller",
    "AdvancedCrafting": "AdvancedCrafting",
    "Archaeo": "Archaeo",
    "ArmourShop": "ArmourShop",
    "BarterShops": "BarterShops",
    "BirdMessenger": "BirdMessenger",
    "Cooking": "Cooking",
    "CoreProtect": "CoreProtect",
    "DenarEconomy": "DenarEconomy",
    "Dowsing": "Dowsing",
    "DrinkBuilder": "DrinkBuilder",
    "Games": "Games",
    "Gathering": "Gathering",
    "GemInfusion": "GemInfusion",
    "GunsAndGadgets": "GunsAndGadgets",
    "Infestations": "Infestations",
    "InteractibleFurniture": "InteractibleFurniture",
    "Magic": "Magic",
    "MarketBlock": "MarketBlock",
    "MusicalInstruments": "MusicalInstruments",
    "RPCharacters": "RPCharacters",
    "Recycler": "Recycler",
    "Research": "Research",
    "SimpleFactions": "SimpleFactions",
    "TFMCCore": "TFMCCore",
    "TFMCWeb": "TFMCWeb",
    "TLibs": "TLibs",
    "Thievery": "Thievery",
    "TrialRooms": "TrialRooms",
    "VFBuilders": "VFBuilders",
    "VehicleFramework": "VehicleFramework",
    "Woodworking": "Woodworking",
    "WorldBorder": "WorldBorder",
    "activity": "ActivityTF",
    "geiger_counter": "GeigerCounters",
    "surgery": "Surgery",
}

# Content packs are not GitHub repos. Rules are kinds of files, so a new
# items.yml or vehicle file is included. Dungeons stay opaque.
CONTENT_FOLDERS: dict[str, dict] = {
    "MMOItems": {
        "dangerous": False,
        "rules": ["*.yml", "item/*.yml", "crafting-stations/*.yml", "modifiers/**/*.yml"],
    },
    "MMOCore": {
        "dangerous": False,
        "rules": [
            "*.yml",
            "attributes/**/*.yml",
            "classes/**/*.yml",
            "drop-tables/**/*.yml",
            "exp-curves/**/*.yml",
            "exp-tables/**/*.yml",
            "gui/**/*.yml",
            "professions/**/*.yml",
            "quests/**/*.yml",
            "skill-trees/**/*.yml",
            "waypoints/**/*.yml",
            "loot-chests/**/*.yml",
        ],
    },
    "MythicMobs": {
        "dangerous": False,
        "rules": [
            "*.yml",
            "config/**/*.yml",
            "items/**/*.yml",
            "droptables/**/*.yml",
            "mobs/**/*.yml",
            "skills/**/*.yml",
            "spawners/**/*.yml",
            "randomspawns/**/*.yml",
            "menus/**/*.yml",
            "dialogs/**/*.yml",
            "cutscenes/**/*.yml",
            "packs/**/*.yml",
        ],
    },
    "MythicDungeons": {
        "dangerous": True,
        "rules": ["*.yml", "maps/*/config.yml", "maps/*/functions.yml"],
    },
}


@dataclass(frozen=True)
class FolderChange:
    added: tuple[str, ...] = ()
    edited: tuple[str, ...] = ()
    removed: tuple[str, ...] = ()

    @property
    def any(self) -> bool:
        return bool(self.added or self.edited or self.removed)


@dataclass
class Classified:
    rules: list[str] = field(default_factory=list)
    unclassified: list[str] = field(default_factory=list)


def clean_folder_name(name: str) -> str:
    """A plugin directory name. Slashes and parent traversal are rejected."""
    text = name.strip()
    if not _NAME.fullmatch(text) or text.startswith("."):
        raise ValueError("Folder name is not a plugin directory")
    return text


def assert_main_plugins_dir(path: Path) -> Path:
    """The plugins directory on TFMCMain. The dev server is refused."""
    resolved = path.resolve()
    parts = resolved.parts
    if any(part.lower().startswith("tfmcdev") for part in parts):
        raise ValueError("The dev server is not watched")
    if "TFMCMain01" not in parts or resolved.name != "plugins":
        raise ValueError("Only TFMCMain plugin folders are watched")
    if not resolved.is_dir():
        raise ValueError("Plugins directory is not available")
    return resolved


def plugin_folder(plugins: Path, name: str) -> Path | None:
    """The plugin directory, or None when that folder is not on TFMCMain."""
    folder_name = clean_folder_name(name)
    root = assert_main_plugins_dir(plugins)
    folder = (root / folder_name).resolve()
    if folder.parent != root or not folder.is_dir():
        return None
    return folder


def rule_matches(pattern: str, relative: str) -> bool:
    """True when a relative path matches a rule. `*` does not cross `/`."""
    return _match_parts(pattern.split("/"), relative.split("/"))


def _match_parts(pattern: list[str], parts: list[str]) -> bool:
    if not pattern:
        return not parts
    head, rest = pattern[0], pattern[1:]
    if head == "**":
        if not rest:
            return True
        return any(_match_parts(rest, parts[index:]) for index in range(len(parts) + 1))
    if not parts:
        return False
    if head != "*" and not fnmatch.fnmatchcase(parts[0], head):
        return False
    return _match_parts(rest, parts[1:])


def skip_directory(name: str) -> bool:
    """Runtime directories the walker does not open."""
    return name in HARD_DIRS or name.startswith(".") or bool(_LORE_PART.search(name))


def excluded_relative(relative: str) -> bool:
    """Player data, databases, logs, lore, and secrets are never tracked."""
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        return True
    if any(part in HARD_DIRS or part.startswith(".") for part in path.parts):
        return True
    if any(_LORE_PART.search(part) for part in path.parts):
        return True
    name = path.name
    if name in SKIP_FILE_NAMES or name.lower().endswith(HARD_SUFFIXES):
        return True
    if _UUID.fullmatch(path.stem) or _SECRET_NAME.search(name):
        return True
    return False


def safe_rule(pattern: str) -> str:
    """A tracking rule staff can add. Hard-excluded pieces are rejected."""
    text = pattern.strip().replace("\\", "/").lstrip("/")
    if not text or text.startswith("/") or ".." in text.split("/"):
        raise ValueError("That rule is not inside the plugin folder")
    if not text.endswith((".yml", ".yaml")):
        raise ValueError("Only yaml files can be tracked")
    sample = text.replace("**", "sample").replace("*", "sample")
    if excluded_relative(sample):
        raise ValueError("That rule would include data that is not tracked")
    return text


def covered(relative: str, rules: list[str]) -> bool:
    if excluded_relative(relative):
        return False
    return any(rule_matches(rule, relative) for rule in rules)


def classify_tree(files: dict[str, bytes]) -> Classified:
    """Rules for yaml worth tracking, plus top-level dirs that were left out."""
    rules: list[str] = []
    root_yaml = False
    tops: set[str] = set()
    seen_tops: set[str] = set()
    unclassified: set[str] = set()
    for relative in sorted(files):
        path = Path(relative)
        if not path.parts or path.parts[0].startswith("."):
            continue
        top = path.parts[0] if len(path.parts) > 1 else ""
        if top:
            seen_tops.add(top)
        if excluded_relative(relative):
            continue
        if path.suffix.lower() not in {".yml", ".yaml"}:
            if top and top not in HARD_DIRS:
                unclassified.add(top)
            continue
        if len(path.parts) == 1:
            root_yaml = True
        else:
            tops.add(path.parts[0])
    if root_yaml:
        rules.append("*.yml")
    for top in sorted(tops):
        rules.append(f"{top}/**/*.yml")
    left = sorted(name for name in unclassified if name not in tops and name not in HARD_DIRS)
    return Classified(rules=rules, unclassified=left[:20])


def tracked_files(files: dict[str, bytes], rules: list[str]) -> dict[str, str]:
    """Hash of each file a rule includes. Excluded paths are omitted."""
    found: dict[str, str] = {}
    for relative, payload in files.items():
        if covered(relative, rules):
            found[relative] = hashlib.sha256(payload).hexdigest()[:16]
    return found


def look_truncated(previous: dict[str, str], current: dict[str, str]) -> bool:
    """A partial write should not look like every file was deleted."""
    before = len(previous)
    return before >= 5 and len(current) * 2 < before


def diff_tracked(
    previous: dict[str, str] | None,
    current: dict[str, str],
    *,
    rules_changed: bool,
) -> tuple[dict[str, str], FolderChange | None, bool]:
    """Return the snapshot to store, a note-worthy change, and whether this baselines.

    The first sight of a folder stores hashes and drafts nothing. A new rule
    adopts files that are already there without calling them new.
    """
    if previous is None:
        return current, None, True
    if look_truncated(previous, current):
        return previous, None, False
    added = tuple(sorted(path for path in current if path not in previous))
    removed = tuple(sorted(path for path in previous if path not in current))
    edited = tuple(
        sorted(path for path in current if path in previous and current[path] != previous[path])
    )
    if rules_changed:
        # Files already on disk are adopted by the new rule. They are not news.
        added = ()
        removed = ()
    change = FolderChange(added=added, edited=edited, removed=removed)
    if not change.any:
        return current, None, False
    return current, change, False


def note_text(
    folder: str,
    change: FolderChange,
    *,
    dangerous: bool,
    summary: tuple[str, str] | None = None,
) -> tuple[str, str] | None:
    """A pending line, or None when the diff has nothing safe to say.

    Dangerous folders stay vague. Every other line has to name what changed.
    """
    if not change.any or summary is None:
        return None
    if dangerous:
        body = "A dungeon was adjusted on the main server."
        section = "adjusted"
    else:
        section, body = summary
        if section not in {"new", "fixed", "adjusted", "technical"}:
            return None
    cleaned = player_text(body)
    if cleaned is None:
        return None
    for secret in (*change.added, *change.edited, *change.removed):
        if secret and secret in cleaned:
            return None
    return section, cleaned


def catalog_entries() -> list[dict]:
    """Repo plugins and the four content packs the watcher always keeps."""
    entries = [
        {
            "name": name,
            "origin": "repo",
            "repo": repo,
            "dangerous": False,
            "rules": [],
        }
        for name, repo in sorted(REPO_FOLDERS.items())
    ]
    for name, spec in CONTENT_FOLDERS.items():
        entries.append(
            {
                "name": name,
                "origin": "content",
                "repo": None,
                "dangerous": bool(spec["dangerous"]),
                "rules": list(spec["rules"]),
            }
        )
    return entries


def preset_rules(name: str) -> list[str] | None:
    spec = CONTENT_FOLDERS.get(name)
    if spec is None:
        return None
    return list(spec["rules"])


def is_dangerous(name: str) -> bool:
    spec = CONTENT_FOLDERS.get(name)
    return bool(spec and spec["dangerous"])
