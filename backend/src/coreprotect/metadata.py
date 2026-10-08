"""Read-only, bounded subset of Java serialization/NBT used by CoreProtect.

No Java classes are loaded or instantiated. Unknown representations fail closed
and retain the vanilla label. Only identity and name fields leave this module.
"""
from __future__ import annotations

import base64
import json
import re
import struct
import zlib
from dataclasses import dataclass, field

MAX_BLOB = 65536
MAX_EXPANDED = 262144
MAX_NODES = 8192
MAX_DEPTH = 32
_ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
_COLOR = re.compile(r"[§&][0-9a-fk-orx]", re.I)


@dataclass
class _Class:
    name: str
    flags: int = 0
    fields: list = field(default_factory=list)
    parent: object = None


@dataclass
class _Object:
    name: str
    fields: dict = field(default_factory=dict)
    annotations: dict = field(default_factory=dict)


class _Bytes:
    def __init__(self, data):
        self.data, self.pos, self.nodes = data, 0, 0

    def take(self, count):
        if count < 0 or self.pos + count > len(self.data):
            raise ValueError("truncated metadata")
        value = self.data[self.pos:self.pos + count]
        self.pos += count
        return value

    def number(self, fmt):
        return struct.unpack(">" + fmt, self.take(struct.calcsize(fmt)))[0]

    def utf(self, count=None):
        raw = self.take(self.number("H") if count is None else count)
        # Java modified UTF-8 uses encoded NUL and UTF-16 surrogate pairs.
        return raw.replace(b"\xc0\x80", b"\0").decode("utf-8", "surrogatepass").encode(
            "utf-16", "surrogatepass").decode("utf-16")

    def step(self, depth):
        self.nodes += 1
        if depth > MAX_DEPTH or self.nodes > MAX_NODES:
            raise ValueError("metadata limit")


class _Java(_Bytes):
    def __init__(self, data):
        super().__init__(data)
        self.handles = []

    def handle(self, value):
        self.handles.append(value)
        return value

    def annotations(self, depth):
        out = []
        while self.data[self.pos:self.pos + 1] != b"\x78":
            out.append(self.read(depth + 1))
        self.take(1)
        return out

    def primitive(self, kind):
        return self.number({"B": "b", "C": "H", "D": "d", "F": "f", "I": "i",
                            "J": "q", "S": "h", "Z": "?"}[kind])

    def read(self, depth=0):
        self.step(depth)
        token = self.number("B")
        if token == 0x70:
            return None
        if token == 0x71:
            index = self.number("I") - 0x7e0000
            if not 0 <= index < len(self.handles):
                raise ValueError("bad reference")
            return self.handles[index]
        if token in (0x74, 0x7c):
            return self.handle(self.utf(self.number("q") if token == 0x7c else None))
        if token in (0x77, 0x7a):
            return self.take(self.number("B" if token == 0x77 else "i"))
        if token == 0x72:
            desc = _Class(self.utf())
            self.take(8)  # serialVersionUID
            self.handle(desc)
            desc.flags = self.number("B")
            for _ in range(self.number("H")):
                self.step(depth)
                kind, name = chr(self.number("B")), self.utf()
                if kind in "L[":
                    self.read(depth + 1)  # field's class descriptor string
                desc.fields.append((kind, name))
            self.annotations(depth)
            desc.parent = self.read(depth + 1)
            return desc
        if token in (0x73, 0x75, 0x7e):
            desc = self.read(depth + 1)
            if not isinstance(desc, _Class):
                raise ValueError("bad class")
            obj = self.handle(_Object(desc.name))
            if token == 0x7e:
                obj.fields["name"] = self.read(depth + 1)
            elif token == 0x75:
                size = self.number("i")
                if not 0 <= size <= MAX_NODES:
                    raise ValueError("array limit")
                obj.fields["values"] = [self.read(depth + 1) if desc.name[1] in "L["
                                        else self.primitive(desc.name[1]) for _ in range(size)]
            else:
                chain, current = [], desc
                while current is not None:
                    self.step(depth + len(chain))
                    if not isinstance(current, _Class):
                        raise ValueError("bad superclass")
                    chain.append(current)
                    current = current.parent
                for current in reversed(chain):
                    if current.flags not in (2, 3):
                        raise ValueError("unsupported serialization")
                    for kind, name in current.fields:
                        obj.fields[name] = self.read(depth + 1) if kind in "L[" else self.primitive(kind)
                    if current.flags & 1:
                        obj.annotations[current.name] = self.annotations(depth)
            return obj
        raise ValueError("unsupported token")


def _java(data):
    if not isinstance(data, bytes) or len(data) > MAX_BLOB:
        raise ValueError("blob limit")
    stream = _Java(data)
    if stream.take(4) != b"\xac\xed\0\x05":
        raise ValueError("not Java metadata")
    value = stream.read()
    if stream.pos != len(data):
        raise ValueError("trailing metadata")
    return value


def _list(value):
    if not isinstance(value, _Object):
        return []
    if value.name == "java.util.ArrayList":
        return [v for v in value.annotations.get(value.name, []) if not isinstance(v, bytes)]
    if value.name.startswith("["):
        return value.fields.get("values", [])
    return []


def _map(value):
    if not isinstance(value, _Object):
        return {}
    if value.name in ("java.util.HashMap", "java.util.LinkedHashMap"):
        pairs = [v for v in value.annotations.get("java.util.HashMap", []) if not isinstance(v, bytes)]
        if len(pairs) % 2:
            raise ValueError("bad map")
        return {pairs[i]: pairs[i + 1] for i in range(0, len(pairs), 2) if isinstance(pairs[i], str)}
    if value.name == "com.google.common.collect.ImmutableMap$SerializedForm":
        return dict(zip(_list(value.fields.get("keys")), _list(value.fields.get("values"))))
    if value.name == "org.bukkit.util.io.Wrapper":
        return _map(value.fields.get("map"))
    return {}


class _Nbt(_Bytes):
    def read(self, kind, depth=0):
        self.step(depth)
        if kind in (1, 2, 3, 4, 5, 6):
            return self.number({1: "b", 2: "h", 3: "i", 4: "q", 5: "f", 6: "d"}[kind])
        if kind == 8:
            return self.utf()
        if kind in (7, 11, 12):
            self.take(self.number("i") * {7: 1, 11: 4, 12: 8}[kind])
            return None
        if kind == 9:
            child, count = self.number("B"), self.number("i")
            if not 0 <= count <= MAX_NODES:
                raise ValueError("NBT list limit")
            for _ in range(count):
                self.read(child, depth + 1)
            return None
        if kind == 10:
            out = {}
            while (child := self.number("B")):
                name = self.utf()
                out[name] = self.read(child, depth + 1)
            return out
        raise ValueError("unsupported NBT tag")


def _custom(value):
    if not isinstance(value, str) or len(value) > MAX_BLOB:
        return {}
    compressed = base64.b64decode(value, validate=True)
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
    data = inflater.decompress(compressed, MAX_EXPANDED + 1)
    if len(data) > MAX_EXPANDED or not inflater.eof:
        raise ValueError("NBT expansion limit")
    stream = _Nbt(data)
    if stream.number("B") != 10:
        raise ValueError("not an NBT compound")
    stream.utf()
    return stream.read(10)


def _text(value, depth=0):
    if depth > MAX_DEPTH:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_text(v, depth + 1) for v in value)
    if isinstance(value, dict):
        return _text(value.get("text", ""), depth + 1) + _text(value.get("extra", []), depth + 1)
    return ""


def clean_name(value, *, component=False):
    if not isinstance(value, str) or len(value) > 8192:
        return ""
    if component and value.startswith(("{", "[", '\"')):
        try:
            value = _text(json.loads(value))
        except (ValueError, RecursionError):
            pass  # Legacy display names can start with literal brackets or quotes.
    value = _COLOR.sub("", value)
    value = re.sub(r"[<>|]", " ", value)
    return " ".join("".join(c for c in value if c.isprintable() or c.isspace()).split())[:160]


def _id(value):
    return value if isinstance(value, str) and _ID.fullmatch(value) else None


def item_identity(data):
    """(MMOItems `TYPE:ID` or None, display name or "") from an item's metadata blob."""
    try:
        # Only the first item-meta map, never nested lore, books or container items.
        groups = _list(_java(data))
        group = _list(groups[0]) if groups else []
        meta = _map(group[0]) if group else {}
        tags = _custom(meta.get("custom"))
        item_type, item_id = _id(tags.get("MMOITEMS_ITEM_TYPE")), _id(tags.get("MMOITEMS_ITEM_ID"))
        name = clean_name(meta.get("display-name") or meta.get("item-name"), component=True)
        return (f"{item_type}:{item_id}" if item_type and item_id else None), name
    except (ValueError, TypeError, KeyError, IndexError, UnicodeError, RecursionError, zlib.error):
        return None, ""


def item_label(data, vanilla):
    identity, name = item_identity(data)
    if identity:
        return f"{name or identity.partition(':')[2].replace('_', ' ').title()} [MMOItems {identity}]"
    return f"{vanilla} (renamed: {name})" if name else vanilla


def _safe_list(data):
    try:
        return _list(_java(data)) if data else []
    except (ValueError, TypeError, KeyError, IndexError, UnicodeError, RecursionError):
        return []


def mob_identity(data, metadata):
    """(MythicMobs id or None, custom name or "") from a killed mob's two blobs."""
    # Each optional blob can fail independently; retain any valid evidence.
    fields = _safe_list(metadata)
    identity = _id(fields[1]) if len(fields) == 2 and fields[0] == "coreprotect:mythic" else None
    state = _safe_list(data)
    return identity, clean_name(state[4]) if len(state) > 4 else ""


def mob_label(data, metadata, vanilla):
    identity, name = mob_identity(data, metadata)
    if identity:
        return f"{name or identity.replace('_', ' ').title()} [MythicMobs {identity}]"
    return f"{vanilla} (named: {name})" if name else vanilla
