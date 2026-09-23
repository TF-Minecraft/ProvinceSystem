"""Postgres storage for weekly patch note bullets.

A bullet is one player-facing line in a week's note. Staff create it as
pending, then approve it or deny it with a reason. Approved bullets are the
only rows a public reader is allowed to see. Pending and denied rows stay on
the staff queue.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg2
import psycopg2.extras

logger = logging.getLogger("patchnotes.db")

SECTIONS = ("new", "fixed", "adjusted", "technical")
MAX_BODY_LEN = 1000
MAX_REASON_LEN = 500

_MIGRATED = False
_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")

_BULLET_COLUMNS = (
    "id, week, section, body, status, deny_reason, created_at, reviewed_at"
)
_INSERT_BULLET = f"""
INSERT INTO patchnote_bullets (week, section, body, status)
VALUES (%s, %s, %s, 'pending')
RETURNING {_BULLET_COLUMNS}
"""
_LIST_PENDING = f"""
SELECT {_BULLET_COLUMNS}
FROM patchnote_bullets
WHERE status = 'pending'
  AND (%s::text IS NULL OR week = %s)
ORDER BY created_at ASC, id ASC
"""
_SECTION_ORDER = """
CASE section
    WHEN 'new' THEN 1
    WHEN 'fixed' THEN 2
    WHEN 'adjusted' THEN 3
    WHEN 'technical' THEN 4
    ELSE 5
END
"""
_LIST_APPROVED = f"""
SELECT {_BULLET_COLUMNS}
FROM patchnote_bullets
WHERE week = %s AND status = 'approved'
ORDER BY {_SECTION_ORDER},
created_at ASC,
id ASC
"""
_LIST_PUBLISHED_FOR_WEEKS = f"""
SELECT {_BULLET_COLUMNS}
FROM patchnote_bullets
WHERE status = 'approved' AND week = ANY(%s)
ORDER BY week DESC,
{_SECTION_ORDER},
created_at ASC,
id ASC
"""
_REVIEW_BULLET = f"""
UPDATE patchnote_bullets
SET status = %s,
    deny_reason = %s,
    reviewed_at = now()
WHERE id = %s AND status = 'pending'
RETURNING {_BULLET_COLUMNS}
"""


class PatchnotesDBError(RuntimeError):
    """Raised when the patch notes database is not reachable or not configured."""


class PatchnotesConfigError(RuntimeError):
    """Raised when patch note configuration cannot be interpreted."""


class BulletNotFound(LookupError):
    """No bullet exists with this id."""


class BulletNotPending(RuntimeError):
    """The bullet exists but is no longer waiting for review."""

    def __init__(self, status: str) -> None:
        self.status = status
        super().__init__(f"Bullet is {status}")


def _dsn() -> str:
    dsn = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not dsn:
        raise PatchnotesDBError("SUPABASE_DB_URL is not set")
    return dsn


def _connect():
    try:
        return psycopg2.connect(_dsn())
    except psycopg2.OperationalError as e:
        raise PatchnotesDBError(f"Could not connect to patch notes DB: {e}") from e


def parse_week(value: str) -> str:
    """Return a canonical ISO week key (`2026-W39`), or raise ValueError."""
    match = _WEEK_RE.match(value.strip())
    if match is None:
        raise ValueError("week must look like 2026-W39")
    year, week = int(match.group(1)), int(match.group(2))
    # fromisocalendar rejects week numbers that year does not have.
    datetime.fromisocalendar(year, week, 1)
    return f"{year}-W{week:02d}"


_DEFAULT_TZ = "Europe/Berlin"
# The note week closes Friday at noon. Later changes belong to the next week.
_FRIDAY_CUTOFF_HOUR = 12


def _zone() -> ZoneInfo:
    name = os.environ.get("PATCHNOTES_TZ", _DEFAULT_TZ).strip() or _DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as e:
        raise PatchnotesConfigError(f"PATCHNOTES_TZ is not a known timezone: {name}") from e


def _local_now(now: datetime | None = None) -> datetime:
    moment = now if now is not None else datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(_zone())


def current_week(now: datetime | None = None) -> str:
    """ISO week a new bullet belongs to.

    The week closes Friday at 12:00 in PATCHNOTES_TZ (Europe/Berlin when unset).
    A change at or after that cutoff, through the weekend, is filed under the next week.
    """
    local = _local_now(now)
    iso = local.isocalendar()
    friday_noon = datetime.fromisocalendar(iso.year, iso.week, 5).replace(
        hour=_FRIDAY_CUTOFF_HOUR,
        minute=0,
        second=0,
        microsecond=0,
        tzinfo=local.tzinfo,
    )
    if local >= friday_noon:
        iso = (local + timedelta(days=7)).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _clean_body(body: str) -> str:
    text = body.strip()
    if not text:
        raise ValueError("body is required")
    if len(text) > MAX_BODY_LEN:
        raise ValueError(f"body is too long (max {MAX_BODY_LEN} chars)")
    return text


def _clean_reason(reason: str) -> str:
    text = reason.strip()
    if not text:
        raise ValueError("reason is required")
    if len(text) > MAX_REASON_LEN:
        raise ValueError(f"reason is too long (max {MAX_REASON_LEN} chars)")
    return text


def migrate() -> None:
    """Create the patch note table if it is missing. No-op once done."""
    global _MIGRATED
    if _MIGRATED:
        return
    if not os.environ.get("SUPABASE_DB_URL", "").strip():
        logger.warning("SUPABASE_DB_URL unset; patch notes DB migration skipped")
        return
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS patchnote_bullets (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    week TEXT NOT NULL,
                    section TEXT NOT NULL,
                    body TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    deny_reason TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    reviewed_at TIMESTAMPTZ,
                    CONSTRAINT patchnote_bullets_section_chk
                        CHECK (section IN ('new', 'fixed', 'adjusted', 'technical')),
                    CONSTRAINT patchnote_bullets_status_chk
                        CHECK (status IN ('pending', 'approved', 'denied')),
                    CONSTRAINT patchnote_bullets_deny_reason_chk
                        CHECK (
                            (
                                status = 'denied'
                                AND deny_reason IS NOT NULL
                                AND length(btrim(deny_reason)) > 0
                            )
                            OR (status <> 'denied' AND deny_reason IS NULL)
                        )
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS patchnote_bullets_pending_idx
                    ON patchnote_bullets (created_at, id)
                    WHERE status = 'pending'
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS patchnote_bullets_week_status_idx
                    ON patchnote_bullets (week, status, created_at, id)
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS patchnote_sources (
                    source_key TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS patchnote_previews (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    week TEXT NOT NULL,
                    bullets JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    expires_at TIMESTAMPTZ NOT NULL
                )
                """
            )
    finally:
        conn.close()
    _MIGRATED = True
    logger.info("Patch notes DB migrated")


def insert_sourced_bullet(*, section: str, body: str, source_key: str) -> dict[str, Any] | None:
    """Insert a pending bullet once per source key.

    A repeated delivery of the same commit returns None and does not add a
    second bullet. The week is the note week that is still open.
    """
    key = source_key.strip()
    if not key or len(key) > 200:
        raise ValueError("source_key is invalid")
    if section not in SECTIONS:
        raise ValueError("section must be new, fixed, adjusted, or technical")
    text = _clean_body(body)
    week_key = current_week()
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO patchnote_sources (source_key)
                VALUES (%s)
                ON CONFLICT (source_key) DO NOTHING
                RETURNING source_key
                """,
                (key,),
            )
            if cur.fetchone() is None:
                return None
            cur.execute(_INSERT_BULLET, (week_key, section, text))
            return dict(cur.fetchone())
    finally:
        conn.close()


def insert_bullet(*, section: str, body: str, week: str | None = None) -> dict[str, Any]:
    """Insert a pending bullet. `week` defaults to the note week that is still open."""
    if section not in SECTIONS:
        raise ValueError("section must be new, fixed, adjusted, or technical")
    text = _clean_body(body)
    week_key = parse_week(week) if week else current_week()
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_INSERT_BULLET, (week_key, section, text))
            return dict(cur.fetchone())
    finally:
        conn.close()


def list_pending(week: str | None = None) -> list[dict[str, Any]]:
    """Pending bullets, oldest first. Optional week narrows the queue."""
    week_key = parse_week(week) if week else None
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_LIST_PENDING, (week_key, week_key))
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def list_approved(week: str) -> list[dict[str, Any]]:
    """Approved bullets for one week, in section order then creation order."""
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_LIST_APPROVED, (week_key,))
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def list_published_notes(
    *,
    limit: int,
    before: str | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Approved weeks, newest first, at most `limit` weeks.

    Returns the page and whether an older week exists beyond it. `before` is an
    exclusive ISO week cursor.
    """
    if limit < 1:
        raise ValueError("limit must be at least 1")
    before_key = parse_week(before) if before else None
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT week
                FROM patchnote_bullets
                WHERE status = 'approved'
                  AND (%s::text IS NULL OR week < %s)
                GROUP BY week
                ORDER BY week DESC
                LIMIT %s
                """,
                (before_key, before_key, limit + 1),
            )
            keys = [row[0] for row in cur.fetchall()]
        has_more = len(keys) > limit
        keys = keys[:limit]
        if not keys:
            return [], False
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_LIST_PUBLISHED_FOR_WEEKS, (keys,))
            rows = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    grouped: list[dict[str, Any]] = []
    for row in rows:
        if not grouped or grouped[-1]["week"] != row["week"]:
            grouped.append({"week": row["week"], "bullets": []})
        grouped[-1]["bullets"].append(row)
    return grouped, has_more


def list_published_weeks() -> list[str]:
    """ISO week keys that have at least one approved bullet, newest first."""
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT week
                FROM patchnote_bullets
                WHERE status = 'approved'
                GROUP BY week
                ORDER BY week DESC
                """
            )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def _review(bullet_id: str, *, status: str, deny_reason: str | None) -> dict[str, Any]:
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_REVIEW_BULLET, (status, deny_reason, bullet_id))
            row = cur.fetchone()
            if row is not None:
                return dict(row)
            cur.execute(
                "SELECT status FROM patchnote_bullets WHERE id = %s",
                (bullet_id,),
            )
            existing = cur.fetchone()
            if existing is None:
                raise BulletNotFound(bullet_id)
            raise BulletNotPending(str(existing["status"]))
    finally:
        conn.close()


def approve_bullet(bullet_id: str) -> dict[str, Any]:
    """Mark a pending bullet approved. Raises when it is missing or already reviewed."""
    return _review(bullet_id, status="approved", deny_reason=None)


def deny_bullet(bullet_id: str, reason: str) -> dict[str, Any]:
    """Mark a pending bullet denied and store the reason."""
    return _review(bullet_id, status="denied", deny_reason=_clean_reason(reason))


def replace_preview(*, week: str, bullets: list[dict[str, Any]]) -> dict[str, Any]:
    """Store one staff-only test note and drop any previous one.

    The row expires one hour after it is written. Public readers never see it.
    """
    week_key = parse_week(week)
    stored: list[dict[str, str]] = []
    for bullet in bullets:
        section = str(bullet.get("section") or "")
        if section not in SECTIONS:
            raise ValueError("section must be new, fixed, adjusted, or technical")
        stored.append(
            {
                "id": str(bullet.get("id") or ""),
                "section": section,
                "body": _clean_body(str(bullet.get("body") or "")),
            }
        )
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("DELETE FROM patchnote_previews")
            cur.execute(
                """
                INSERT INTO patchnote_previews (week, bullets, expires_at)
                VALUES (%s, %s, now() + interval '1 hour')
                RETURNING id, week, bullets, created_at, expires_at
                """,
                (week_key, psycopg2.extras.Json(stored)),
            )
            return dict(cur.fetchone())
    finally:
        conn.close()


def load_preview() -> dict[str, Any] | None:
    """The current test note, after deleting any that have expired."""
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("DELETE FROM patchnote_previews WHERE expires_at <= now()")
            cur.execute(
                """
                SELECT id, week, bullets, created_at, expires_at
                FROM patchnote_previews
                ORDER BY expires_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()
