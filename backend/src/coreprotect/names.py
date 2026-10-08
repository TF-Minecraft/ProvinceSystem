"""Vanilla block, item and entity names: `short_grass` → "Short Grass".

The names come from Mojang's `en_us.json`, trimmed into
`data/minecraft_names.json` when the backend image is built
(`scripts/build_minecraft_names.py`). Without that file, or for an id it does
not know, the id is tidied instead. Only `minecraft:` ids are looked up: a
plugin's `some_mod:wheat` is not vanilla wheat.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PATH = Path(__file__).parent / "data" / "minecraft_names.json"

# Which language section to try first for each kind of thing a row names.
# The same id can differ: the `wheat` block is "Wheat Crops", the item "Wheat".
BLOCK = ("block", "item")
ITEM = ("item", "block")
ENTITY = ("entity",)


@lru_cache(maxsize=1)
def _table() -> dict:
    try:
        return json.loads(PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def tidy(text: str) -> str:
    """`short_grass` → "Short Grass", the way the game capitalises names."""
    return " ".join(word[:1].upper() + word[1:] for word in text.replace("_", " ").split()) or text


def vanilla(raw: str | None, order: tuple[str, ...]) -> tuple[str | None, str | None]:
    """(official name, id without `minecraft:`) for a CoreProtect id, or (None, id) when not vanilla."""
    if not raw:
        return None, None
    namespace, _, path = raw.rpartition(":")
    if namespace not in ("", "minecraft"):
        return None, raw
    table = _table()
    for section in order:
        name = table.get(section, {}).get(path)
        if isinstance(name, str):
            return name, path
    return None, path


def describe(raw: str | None, order: tuple[str, ...], missing: str) -> dict:
    """A row's target: its name and where that name came from."""
    if not raw:
        return target(missing, source="unknown")
    namespace, _, path = raw.rpartition(":")
    if namespace not in ("", "minecraft"):
        # Another plugin's namespace: keep its id, never borrow a vanilla name.
        return target(tidy(path), source="unknown", id=raw)
    name, short = vanilla(raw, order)
    return target(name or tidy(path), id=short, vanilla_name=name)


def target(name: str, *, source: str = "vanilla", id: str | None = None, vanilla_name: str | None = None,
           source_id: str | None = None, custom_name: str | None = None) -> dict:
    """`id` is the recorded Minecraft id; `source_id` a plugin's own (MMOItems `TYPE:ID`, a MythicMobs mob)."""
    return {"name": name, "source": source, "id": id, "vanilla_name": vanilla_name,
            "source_id": source_id, "custom_name": custom_name}
