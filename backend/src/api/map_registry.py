"""Map registry for public vs staff-only viewer access."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import yaml

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
_DEFAULT_REGISTRY_PATH = _CONFIG_DIR / "maps.yml"
# A site's own registry, in its data volume. Lets one deployment differ from
# the repo's (the dev site shows the Dev server's map at /map) without an
# environment variable, which the compose files on the host do not allow.
_SITE_REGISTRY_PATH = Path(__file__).resolve().parent.parent / "data" / "maps.yml"

# The map `/map` shows when no entry says `live: true`.
DEFAULT_LIVE_MAP_ID = "main"

_registry_cache: dict[str, MapEntry] | None = None


@dataclass(frozen=True)
class MapEntry:
    id: str
    public: bool
    display_name: str
    realm_id: str
    staff_permission: str | None = None
    archived: bool = False
    #: The map this site's `/map` shows. See `live_map_id`.
    live: bool = False

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "display_name": self.display_name,
            "public": self.public,
            "archived": self.archived,
            "live": self.live,
        }


class MapRegistryError(ValueError):
    """Invalid map registry configuration."""


def _registry_path() -> Path:
    override = os.environ.get("MAP_REGISTRY_PATH", "").strip()
    if override:
        return Path(override)
    if _SITE_REGISTRY_PATH.is_file():
        return _SITE_REGISTRY_PATH
    return _DEFAULT_REGISTRY_PATH


def _normalize_map_id(map_id: str) -> str | None:
    raw = (map_id or "").strip().lower()
    if not raw or not raw.isalnum():
        return None
    return raw


def _parse_entry(raw: dict[str, Any]) -> MapEntry:
    if not isinstance(raw, dict):
        raise MapRegistryError("Each map entry must be an object")

    map_id = _normalize_map_id(str(raw.get("id") or ""))
    if not map_id:
        raise MapRegistryError("Map entry requires a valid alphanumeric id")

    public = raw.get("public")
    if not isinstance(public, bool):
        raise MapRegistryError(f"Map '{map_id}' requires boolean public")

    display_name = str(raw.get("display_name") or map_id).strip()
    if not display_name:
        display_name = map_id

    realm_raw = raw.get("realm_id")
    realm_id = _normalize_map_id(str(realm_raw)) if realm_raw is not None else map_id
    if not realm_id:
        raise MapRegistryError(f"Map '{map_id}' has invalid realm_id")

    staff_permission = raw.get("staff_permission")
    if staff_permission is not None:
        staff_permission = str(staff_permission).strip() or None

    if not public and not staff_permission:
        raise MapRegistryError(
            f"Map '{map_id}' is not public and requires staff_permission"
        )

    if "archived" not in raw:
        archived = False
    else:
        archived = raw.get("archived")
        if not isinstance(archived, bool):
            raise MapRegistryError(f"Map '{map_id}' requires boolean archived")

    live = raw.get("live", False)
    if not isinstance(live, bool):
        raise MapRegistryError(f"Map '{map_id}' requires boolean live")
    if live and archived:
        raise MapRegistryError(f"Map '{map_id}' cannot be both live and archived")

    return MapEntry(
        id=map_id,
        public=public,
        display_name=display_name,
        realm_id=realm_id,
        staff_permission=staff_permission,
        archived=archived,
        live=live,
    )


def load_map_registry(*, force: bool = False) -> dict[str, MapEntry]:
    global _registry_cache

    if _registry_cache is not None and not force:
        return _registry_cache

    path = _registry_path()
    if not path.is_file():
        raise MapRegistryError(f"Map registry not found: {path}")

    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)

    if not isinstance(data, dict):
        raise MapRegistryError("Map registry root must be an object")

    raw_maps = data.get("maps")
    if not isinstance(raw_maps, list) or not raw_maps:
        raise MapRegistryError("Map registry requires a non-empty maps list")

    entries: dict[str, MapEntry] = {}
    for item in raw_maps:
        entry = _parse_entry(item)
        if entry.id in entries:
            raise MapRegistryError(f"Duplicate map id '{entry.id}'")
        entries[entry.id] = entry

    live = [entry.id for entry in entries.values() if entry.live]
    if len(live) > 1:
        raise MapRegistryError(f"Only one map can be live, found: {', '.join(live)}")
    if not live and DEFAULT_LIVE_MAP_ID in entries:
        # Registries written before `live` existed: `main` is the live map.
        default = entries[DEFAULT_LIVE_MAP_ID]
        if not default.archived:
            entries[DEFAULT_LIVE_MAP_ID] = replace(default, live=True)

    _registry_cache = entries
    return entries


def live_map_id() -> str:
    """The map this site's `/map` shows."""
    for entry in load_map_registry().values():
        if entry.live:
            return entry.id
    return DEFAULT_LIVE_MAP_ID


def get_map_entry(map_id: str) -> MapEntry | None:
    normalized = _normalize_map_id(map_id)
    if not normalized:
        return None
    return load_map_registry().get(normalized)


def list_map_entries() -> list[MapEntry]:
    return list(load_map_registry().values())


def clear_map_registry_cache() -> None:
    global _registry_cache
    _registry_cache = None
