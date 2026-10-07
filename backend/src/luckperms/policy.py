"""Who may change which LuckPerms nodes. The rules are in policy.yaml."""
from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from src.auth import roles

from . import nodes

POLICY_PATH = Path(__file__).with_name("policy.yaml")


@dataclass(frozen=True)
class Policy:
    admin_groups: frozenset[str]
    patreon_groups: frozenset[str]
    admin_permissions: tuple[str, ...]
    root_only_permissions: tuple[str, ...]


@lru_cache(maxsize=1)
def load() -> Policy:
    raw = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8")) or {}
    return Policy(
        admin_groups=frozenset(str(g).lower() for g in raw.get("admin_groups") or ()),
        patreon_groups=frozenset(str(g).lower() for g in raw.get("patreon_groups") or ()),
        admin_permissions=tuple(str(p).lower() for p in raw.get("admin_permissions") or ()),
        root_only_permissions=tuple(str(p).lower() for p in raw.get("root_only_permissions") or ()),
    )


def _closure(groups: dict[str, dict], name: str) -> set[str]:
    """The group and everything it inherits, in any context, expired or not."""
    seen: set[str] = set()
    queue = [name]
    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)
        for node in groups.get(current, {}).get("nodes", ()):
            parent = nodes.group_of(node["key"])
            if parent and node["value"]:
                queue.append(parent)
    return seen


def group_role(policy: Policy, groups: dict[str, dict], group: str) -> str:
    """admin when the group and everything it inherits are admin groups; else root."""
    return "admin" if _closure(groups, group.lower()) <= policy.admin_groups else "root"


def node_role(policy: Policy, groups: dict[str, dict], node: dict) -> str:
    """The lowest site role that may add or remove this node on a player, whatever its value."""
    key = node["key"].lower()
    node_kind = nodes.kind(key)
    if node_kind == "group":
        return group_role(policy, groups, nodes.group_of(key) or "")
    if node_kind == "meta" or "*" in key or key.startswith("r="):
        return "root"
    if any(fnmatch.fnmatchcase(key, pattern) for pattern in policy.root_only_permissions):
        return "root"
    if any(fnmatch.fnmatchcase(key, pattern) for pattern in policy.admin_permissions):
        return "admin"
    return "root"


def may_edit_node(policy: Policy, groups: dict[str, dict], role: str | None, node: dict) -> bool:
    return roles.rank(role) >= roles.rank(node_role(policy, groups, node))


def may_edit_definitions(role: str | None) -> bool:
    """Group definitions and tracks change what everyone in them can do."""
    return role == "root"
