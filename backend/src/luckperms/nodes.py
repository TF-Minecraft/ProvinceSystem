"""LuckPerms nodes as the site stores and checks them.

A node is {"key", "value", "contexts", "expiry"}: contexts map each context
key to a sorted list of values ({} when global) and expiry is unix seconds,
0 when permanent. Two nodes are the same node only when all four match, as in
LuckPerms' exact equality.
"""
from __future__ import annotations

import json
import re
import time

KEY_MAX = 200
CONTEXT_KEYS_MAX = 8
CONTEXT_VALUE_MAX = 64
# Ten years: anything later is a mistake rather than a temporary grant.
EXPIRY_MAX_SECONDS = 10 * 365 * 24 * 3600
GROUP_NAME = re.compile(r"^[a-z0-9_+\-]{1,36}$")
_CONTEXT_KEY = re.compile(r"^[a-z0-9_.:\-]{1,64}$")
META_PREFIXES = ("prefix.", "suffix.", "meta.", "weight.", "displayname.")


class NodeError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _printable(text: str) -> bool:
    return all(ord(ch) >= 0x20 and ord(ch) != 0x7F for ch in text)


def kind(key: str) -> str:
    """group, meta or permission."""
    lowered = key.lower()
    if lowered.startswith("group."):
        return "group"
    if lowered.startswith(META_PREFIXES):
        return "meta"
    return "permission"


def group_of(key: str) -> str | None:
    return key[len("group."):].lower() if kind(key) == "group" else None


def clean_contexts(raw) -> dict[str, list[str]]:
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > CONTEXT_KEYS_MAX:
        raise NodeError("bad_contexts")
    out: dict[str, list[str]] = {}
    for key, values in raw.items():
        if not isinstance(key, str) or not _CONTEXT_KEY.match(key.lower()):
            raise NodeError("bad_contexts")
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list) or not values or len(values) > CONTEXT_KEYS_MAX:
            raise NodeError("bad_contexts")
        clean = set()
        for value in values:
            if (not isinstance(value, str) or not value.strip() or len(value) > CONTEXT_VALUE_MAX
                    or not _printable(value)):
                raise NodeError("bad_contexts")
            clean.add(value.strip().lower())
        out[key.lower()] = sorted(clean)
    return dict(sorted(out.items()))


def contexts_json(contexts: dict[str, list[str]]) -> str:
    return json.dumps(contexts, sort_keys=True, separators=(",", ":"))


def from_snapshot(raw) -> dict:
    """A node as the bridge reported it. Trusted, but still shaped."""
    if not isinstance(raw, dict) or not isinstance(raw.get("key"), str) or not raw["key"]:
        raise NodeError("bad_node")
    expiry = raw.get("expiry") or 0
    if not isinstance(expiry, int) or expiry < 0:
        raise NodeError("bad_node")
    return {
        "key": raw["key"][:KEY_MAX * 2],
        "value": bool(raw.get("value", True)),
        "contexts": clean_contexts(raw.get("contexts")),
        "expiry": expiry,
    }


def from_request(raw, *, now: int | None = None, new: bool) -> dict:
    """A node staff sent. New nodes are normalised the way LuckPerms would
    store them; nodes being removed must name an existing node exactly."""
    if not isinstance(raw, dict):
        raise NodeError("bad_node")
    key = raw.get("key")
    if not isinstance(key, str):
        raise NodeError("bad_node")
    key = key.strip()
    if not key or len(key) > KEY_MAX or not _printable(key):
        raise NodeError("bad_node")
    value = raw.get("value", True)
    if not isinstance(value, bool):
        raise NodeError("bad_node")
    expiry = raw.get("expiry") or 0
    if not isinstance(expiry, int) or isinstance(expiry, bool) or expiry < 0:
        raise NodeError("bad_expiry")
    if new:
        node_kind = kind(key)
        if node_kind == "group":
            group = group_of(key)
            if not GROUP_NAME.match(group or ""):
                raise NodeError("bad_group_name")
            key = f"group.{group}"
        elif node_kind == "permission":
            if " " in key:
                raise NodeError("bad_node")
            key = key.lower()
        if expiry:
            current = int(time.time()) if now is None else now
            if expiry <= current or expiry > current + EXPIRY_MAX_SECONDS:
                raise NodeError("bad_expiry")
    return {"key": key, "value": value, "contexts": clean_contexts(raw.get("contexts")), "expiry": expiry}


def same(a: dict, b: dict) -> bool:
    return (a["key"] == b["key"] and a["value"] == b["value"] and a["contexts"] == b["contexts"]
            and a["expiry"] == b["expiry"])


def active(node: dict, now: int) -> bool:
    return not node["expiry"] or node["expiry"] > now


def describe(node: dict) -> str:
    """LuckPerms command wording for the action log: "parent add staff server=main"."""
    tail = "".join(f" {key}={value}" for key, values in node["contexts"].items() for value in values)
    temp = node["expiry"] > 0
    group = group_of(node["key"])
    if group is not None and node["value"]:
        verb = "parent addtemp" if temp else "parent add"
        return f"{verb} {group}{tail}"
    verb = "permission settemp" if temp else "permission set"
    return f"{verb} {node['key']} {str(node['value']).lower()}{tail}"


def describe_removal(node: dict) -> str:
    tail = "".join(f" {key}={value}" for key, values in node["contexts"].items() for value in values)
    temp = node["expiry"] > 0
    group = group_of(node["key"])
    if group is not None and node["value"]:
        return f"{'parent removetemp' if temp else 'parent remove'} {group}{tail}"
    return f"{'permission unsettemp' if temp else 'permission unset'} {node['key']}{tail}"
