"""When a note week is reviewed and when it is posted.

Friday at 12:00 in PATCHNOTES_TZ (Europe/Berlin by default) the week closes.
Staff are asked to approve it then. The player post goes out at 18:00.
A bullet created at or after Friday noon belongs to the next week; the API
assigns that week, and these deadlines follow the week key on the bullet.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TZ = "Europe/Berlin"
REVIEW_HOUR = 12
PUBLISH_HOUR = 18
_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")


def resolve_zone(name: str | None = None) -> ZoneInfo:
    raw = (name if name is not None else os.environ.get("PATCHNOTES_TZ", "")).strip()
    raw = raw or DEFAULT_TZ
    try:
        return ZoneInfo(raw)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"PATCHNOTES_TZ is not a known timezone: {raw}") from exc


def _local(now: datetime, tz: ZoneInfo) -> datetime:
    moment = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz)


def friday_at(week: str, hour: int, tz: ZoneInfo) -> datetime:
    """Friday of an ISO week at `hour`:00 in `tz`. Raises ValueError on a bad key."""
    match = _WEEK_RE.match(week.strip())
    if match is None:
        raise ValueError(f"week must look like 2026-W39, got {week!r}")
    year, number = int(match.group(1)), int(match.group(2))
    try:
        day = datetime.fromisocalendar(year, number, 5)
    except ValueError as exc:
        raise ValueError(f"week must look like 2026-W39, got {week!r}") from exc
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=tz)


def note_week(now: datetime, tz: ZoneInfo) -> str:
    """The note week still open at `now`. Friday 12:00 closes it."""
    local = _local(now, tz)
    iso = local.isocalendar()
    key = f"{iso.year}-W{iso.week:02d}"
    if local >= friday_at(key, REVIEW_HOUR, tz):
        iso = (local + timedelta(days=7)).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def previous_week(week: str) -> str:
    """The ISO week before `week`."""
    match = _WEEK_RE.match(week.strip())
    if match is None:
        raise ValueError(f"week must look like 2026-W39, got {week!r}")
    year, number = int(match.group(1)), int(match.group(2))
    try:
        monday = datetime.fromisocalendar(year, number, 1)
    except ValueError as exc:
        raise ValueError(f"week must look like 2026-W39, got {week!r}") from exc
    iso = (monday - timedelta(days=7)).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def held_review_week(
    now: datetime,
    tz: ZoneInfo,
    *,
    released: bool,
    postponed: bool,
    has_notes: bool,
) -> str:
    """The week `/patchnotes test` and `/patchnotes reset` should edit.

    New notes move to the next week at Friday noon. These commands stay on
    the week that still has notes and has not been posted or postponed.
    """
    filing = note_week(now, tz)
    if released or postponed or not has_notes:
        return filing
    return previous_week(filing)


def review_due(week: str, now: datetime, tz: ZoneInfo) -> bool:
    """True once Friday 12:00 of that week has passed."""
    return _local(now, tz) >= friday_at(week, REVIEW_HOUR, tz)


def publish_due(week: str, now: datetime, tz: ZoneInfo) -> bool:
    """True once Friday 18:00 of that week has passed."""
    return _local(now, tz) >= friday_at(week, PUBLISH_HOUR, tz)
