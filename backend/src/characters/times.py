"""Times in the characters area.

Columns are timestamptz and read back as aware datetimes. Every time the area
sends to the website or a plugin keeps the `YYYY-MM-DDTHH:MM:SSZ` form the site
has always sent. `character_roster.created_at` is RPCharacters' own text and
never passes through here.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def api_time(value: datetime | str | None) -> str | None:
    """A stored time in the API form; None stays None. A string is already in that form."""
    if value is None or isinstance(value, str):
        return value
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
