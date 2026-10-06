"""CoreProtect's id → name tables and table list, cached per server.

These are small whole-table reads (about 1,300 materials, a few dozen
entities and worlds on Main), the only queries here that are not seeks by
player. One refresh runs at a time; the others wait within their budget.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from .reader import Reader

TTL_SECONDS = 300

_LOCK = threading.Lock()
_CACHE: dict[tuple[str, str], tuple[float, "Maps"]] = {}


@dataclass(frozen=True)
class Maps:
    materials: dict[int, str]
    entities: dict[int, str]
    worlds: dict[int, str]
    tables: frozenset[str]

    def material(self, type_id: int | None) -> str:
        return _short(self.materials.get(type_id or 0)) or f"material #{type_id}"

    def entity(self, type_id: int | None) -> str:
        return _short(self.entities.get(type_id or 0)) or f"entity #{type_id}"

    def world(self, wid: int | None) -> str | None:
        return self.worlds.get(wid or 0)


def _short(name: str | None) -> str | None:
    if not name:
        return None
    return name.removeprefix("minecraft:")


def get(reader: Reader) -> Maps:
    key = (reader.config.server, reader.config.path or "")
    cached = _CACHE.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    # The reader holds no open statement here, so waiting cannot pin a read lock.
    reader.budget.acquire(_LOCK)
    try:
        cached = _CACHE.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        maps = Maps(
            materials={r["id"]: r["material"] for r in reader.rows("SELECT id, material FROM co_material_map")},
            entities={r["id"]: r["entity"] for r in reader.rows("SELECT id, entity FROM co_entity_map")},
            worlds={r["id"]: r["world"] for r in reader.rows("SELECT id, world FROM co_world")},
            # Older CoreProtect builds lack the fork's entity tables.
            tables=frozenset(r["name"] for r in reader.rows("SELECT name FROM sqlite_master WHERE type = 'table'")),
        )
        _CACHE[key] = (time.monotonic() + TTL_SECONDS, maps)
        return maps
    finally:
        _LOCK.release()


def clear() -> None:
    _CACHE.clear()
