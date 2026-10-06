"""Opaque page cursors, bound to one server and one listing."""
from __future__ import annotations

import base64
import binascii
import json


class BadCursor(ValueError):
    pass


def encode(server: str, listing: str, *values: int) -> str:
    raw = json.dumps({"s": server, "l": listing, "v": list(values)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode(server: str, listing: str, token: str | None, size: int) -> tuple[int, ...] | None:
    if not token:
        return None
    if len(token) > 200:
        raise BadCursor("bad_cursor")
    try:
        data = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
        values = tuple(data["v"])
        ok = data["s"] == server and data["l"] == listing
    except (ValueError, TypeError, KeyError, binascii.Error):
        raise BadCursor("bad_cursor") from None
    # SQLite integers are 64-bit; a larger one could not even be bound.
    if not ok or len(values) != size or not all(type(v) is int and -(2 ** 63) <= v < 2 ** 63 for v in values):
        raise BadCursor("bad_cursor")
    return values
