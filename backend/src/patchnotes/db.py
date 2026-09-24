"""Postgres storage for weekly patch note bullets.

A bullet is one player-facing line in a week's note. Staff create it as
pending, then approve it or deny it with a reason. A denial that can be
rewritten becomes a new pending line. Approved bullets are the only rows a
public reader is allowed to see. A postponed week stays off the public page.
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

from .revise import rewrite

logger = logging.getLogger("patchnotes.db")

SECTIONS = ("new", "fixed", "adjusted", "technical")
MAX_BODY_LEN = 1000
MAX_REASON_LEN = 500

_MIGRATED = False
_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")

_BULLET_COLUMNS = (
    "id, week, section, body, status, deny_reason, created_at, reviewed_at, revision_note, topic, highlight"
)
TOPICS = (
    "classes",
    "combat",
    "magic",
    "crafting",
    "professions",
    "animals",
    "world",
    "town",
    "dungeons",
    "chat",
)
_NOT_POSTPONED = """
  AND NOT EXISTS (
      SELECT 1 FROM patchnote_week_status
      WHERE patchnote_week_status.week = patchnote_bullets.week
        AND patchnote_week_status.postponed
  )
"""
_MAX_REVISIONS = 3
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
{_NOT_POSTPONED}
ORDER BY {_SECTION_ORDER},
created_at ASC,
id ASC
"""
_LIST_PUBLISHED_FOR_WEEKS = f"""
SELECT {_BULLET_COLUMNS}
FROM patchnote_bullets
WHERE status = 'approved' AND week = ANY(%s)
{_NOT_POSTPONED}
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


class WeekNotPostponed(ValueError):
    """Defer was asked for a week that is not postponed."""


class WeekPostponed(ValueError):
    """Approve was asked for a week that is held."""


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


def next_week(week: str) -> str:
    """The ISO week after `week`."""
    week_key = parse_week(week)
    match = _WEEK_RE.match(week_key)
    if match is None:
        raise ValueError("week must look like 2026-W39")
    year, number = int(match.group(1)), int(match.group(2))
    monday = datetime.fromisocalendar(year, number, 1)
    iso = (monday + timedelta(days=7)).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


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


def _topic_or_none(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    if text in TOPICS:
        return text
    return None


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
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS patchnote_folders (
                    name TEXT PRIMARY KEY,
                    origin TEXT NOT NULL,
                    repo TEXT,
                    status TEXT NOT NULL,
                    dangerous BOOLEAN NOT NULL DEFAULT FALSE,
                    reject_reason TEXT,
                    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
                    unclassified JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    verified_at TIMESTAMPTZ,
                    CONSTRAINT patchnote_folders_origin_chk
                        CHECK (origin IN ('repo', 'content', 'added')),
                    CONSTRAINT patchnote_folders_status_chk
                        CHECK (status IN ('pending', 'active', 'rejected'))
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE patchnote_bullets
                    ADD COLUMN IF NOT EXISTS supersedes UUID,
                    ADD COLUMN IF NOT EXISTS revision_note TEXT,
                    ADD COLUMN IF NOT EXISTS carried_from TEXT,
                    ADD COLUMN IF NOT EXISTS carried_status TEXT,
                    ADD COLUMN IF NOT EXISTS topic TEXT,
                    ADD COLUMN IF NOT EXISTS highlight BOOLEAN NOT NULL DEFAULT FALSE
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS patchnote_week_status (
                    week TEXT PRIMARY KEY,
                    postponed BOOLEAN NOT NULL DEFAULT FALSE,
                    deferred_to TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS patchnote_sync_tasks (
                    folder_name TEXT NOT NULL,
                    week TEXT NOT NULL,
                    repo TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (folder_name, week)
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
                  AND NOT EXISTS (
                      SELECT 1 FROM patchnote_week_status
                      WHERE patchnote_week_status.week = patchnote_bullets.week
                        AND patchnote_week_status.postponed
                  )
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
                  AND NOT EXISTS (
                      SELECT 1 FROM patchnote_week_status
                      WHERE patchnote_week_status.week = patchnote_bullets.week
                        AND patchnote_week_status.postponed
                  )
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
    stored: list[dict[str, Any]] = []
    for bullet in bullets:
        section = str(bullet.get("section") or "")
        if section not in SECTIONS:
            raise ValueError("section must be new, fixed, adjusted, or technical")
        item: dict[str, Any] = {
            "id": str(bullet.get("id") or ""),
            "section": section,
            "body": _clean_body(str(bullet.get("body") or "")),
        }
        topic = str(bullet.get("topic") or "").strip().lower()
        if topic in TOPICS:
            item["topic"] = topic
        if bullet.get("highlight") is True:
            item["highlight"] = True
        stored.append(item)
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


_FOLDER_COLUMNS = (
    "name, origin, repo, status, dangerous, reject_reason, rules, unclassified, created_at, verified_at"
)


def list_folders() -> list[dict[str, Any]]:
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {_FOLDER_COLUMNS}
                FROM patchnote_folders
                ORDER BY origin, name
                """
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def get_folder(name: str) -> dict[str, Any] | None:
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_FOLDER_COLUMNS} FROM patchnote_folders WHERE name = %s",
                (name,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def ensure_folder(
    *,
    name: str,
    origin: str,
    repo: str | None,
    dangerous: bool,
    rules: list[str] | None = None,
) -> dict[str, Any]:
    """Insert a watched folder if it is missing. An existing row is left as staff set it."""
    if origin not in {"repo", "content", "added"}:
        raise ValueError("origin is invalid")
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                INSERT INTO patchnote_folders
                    (name, origin, repo, status, dangerous, rules)
                VALUES (%s, %s, %s, 'pending', %s, %s)
                ON CONFLICT (name) DO NOTHING
                RETURNING {_FOLDER_COLUMNS}
                """,
                (name, origin, repo, dangerous, psycopg2.extras.Json(rules or [])),
            )
            row = cur.fetchone()
            if row is not None:
                return dict(row)
            cur.execute(
                f"SELECT {_FOLDER_COLUMNS} FROM patchnote_folders WHERE name = %s",
                (name,),
            )
            return dict(cur.fetchone())
    finally:
        conn.close()


def request_added_folder(name: str) -> dict[str, Any]:
    """Staff asked to watch a plugin folder. The host watcher accepts or rejects it."""
    existing = get_folder(name)
    if existing is not None:
        raise ValueError("That folder is already on the list")
    return ensure_folder(name=name, origin="added", repo=None, dangerous=False, rules=[])


def remove_added_folder(name: str) -> None:
    row = get_folder(name)
    if row is None:
        raise BulletNotFound(name)
    if row["origin"] != "added":
        raise ValueError("GitHub plugins and content packs stay on the list")
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("DELETE FROM patchnote_folders WHERE name = %s AND origin = 'added'", (name,))
    finally:
        conn.close()


def observe_folder(
    *,
    name: str,
    status: str,
    rules: list[str] | None,
    unclassified: list[str],
    reject_reason: str | None,
    dangerous: bool | None = None,
) -> dict[str, Any]:
    """Record what the host watcher found. Rules already stored are kept when omitted."""
    if status not in {"pending", "active", "rejected"}:
        raise ValueError("status is invalid")
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                UPDATE patchnote_folders
                SET status = %s,
                    reject_reason = %s,
                    unclassified = %s,
                    rules = COALESCE(%s, rules),
                    dangerous = COALESCE(%s, dangerous),
                    verified_at = now()
                WHERE name = %s
                RETURNING {_FOLDER_COLUMNS}
                """,
                (
                    status,
                    reject_reason,
                    psycopg2.extras.Json(unclassified),
                    psycopg2.extras.Json(rules) if rules is not None else None,
                    dangerous,
                    name,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise BulletNotFound(name)
            return dict(row)
    finally:
        conn.close()


def add_folder_rule(name: str, pattern: str) -> dict[str, Any]:
    row = get_folder(name)
    if row is None:
        raise BulletNotFound(name)
    if row["status"] != "active":
        raise ValueError("That folder is not being watched yet")
    rules = list(row["rules"] or [])
    if pattern not in rules:
        rules.append(pattern)
    return observe_folder(
        name=name,
        status="active",
        rules=rules,
        unclassified=list(row["unclassified"] or []),
        reject_reason=None,
    )


def queue_sync_task(*, folder_name: str, repo: str, week: str) -> bool:
    """One GitHub update task per repo plugin per week. True when this call created it."""
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO patchnote_sync_tasks (folder_name, week, repo)
                VALUES (%s, %s, %s)
                ON CONFLICT (folder_name, week) DO NOTHING
                RETURNING folder_name
                """,
                (folder_name, week_key, repo),
            )
            return cur.fetchone() is not None
    finally:
        conn.close()


def list_sync_tasks(week: str) -> list[str]:
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT folder_name
                FROM patchnote_sync_tasks
                WHERE week = %s
                ORDER BY folder_name
                """,
                (week_key,),
            )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def _week_status_row(week: str, row: dict[str, Any] | None) -> dict[str, Any]:
    if row is None:
        return {"week": week, "postponed": False, "deferred_to": None}
    deferred = row.get("deferred_to")
    return {
        "week": week,
        "postponed": bool(row.get("postponed")),
        "deferred_to": str(deferred) if deferred else None,
    }


def get_bullet(bullet_id: str) -> dict[str, Any]:
    """One bullet, including a denied or approved row."""
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"SELECT {_BULLET_COLUMNS} FROM patchnote_bullets WHERE id = %s",
                (bullet_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise BulletNotFound(bullet_id)
            return dict(row)
    finally:
        conn.close()


def _revision_depth(cur, bullet_id: str) -> int:
    depth = 0
    current = bullet_id
    seen: set[str] = set()
    while current and current not in seen and depth < _MAX_REVISIONS:
        seen.add(current)
        cur.execute(
            "SELECT supersedes FROM patchnote_bullets WHERE id = %s",
            (current,),
        )
        row = cur.fetchone()
        parent = None if row is None else row.get("supersedes")
        if not parent:
            break
        current = str(parent)
        depth += 1
    return depth


def revise_denied_bullet(denied: dict[str, Any], reason: str) -> dict[str, Any] | None:
    """Store a rewritten pending line for one denial, or None when it stays denied."""
    proposal = rewrite(str(denied.get("section") or ""), str(denied.get("body") or ""), reason)
    if proposal is None:
        return None
    section, text = proposal
    note = _clean_reason(reason)
    week_key = parse_week(str(denied.get("week") or ""))
    bullet_id = str(denied["id"])
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if _revision_depth(cur, bullet_id) >= _MAX_REVISIONS:
                return None
            cur.execute(
                f"""
                INSERT INTO patchnote_bullets
                    (week, section, body, status, supersedes, revision_note)
                VALUES (%s, %s, %s, 'pending', %s, %s)
                RETURNING {_BULLET_COLUMNS}
                """,
                (week_key, section, text, bullet_id, note),
            )
            return dict(cur.fetchone())
    finally:
        conn.close()


def list_open_bullets(week: str) -> list[dict[str, Any]]:
    """Pending and approved lines that make up the current note."""
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {_BULLET_COLUMNS}
                FROM patchnote_bullets
                WHERE week = %s AND status IN ('pending', 'approved')
                ORDER BY created_at ASC, id ASC
                """,
                (week_key,),
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def apply_feedback(week: str, feedback: str, edits: list[dict[str, Any]]) -> dict[str, Any]:
    """Apply interpreted edits. The feedback is stored on the review, not as the line.

    Rewrites stay on the same row, so staff can deny again and Friday can still
    publish a line that was waiting.
    """
    week_key = parse_week(week)
    note = feedback.strip()
    if not note:
        raise ValueError("reason is required")
    if len(note) > MAX_REASON_LEN:
        note = note[: MAX_REASON_LEN - 1].rstrip() + "…"
    changed = 0
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for edit in edits:
                action = str(edit.get("action") or "")
                if action == "add":
                    cur.execute(
                        f"""
                        INSERT INTO patchnote_bullets
                            (week, section, body, status, revision_note, topic, highlight)
                        VALUES (%s, %s, %s, 'pending', %s, %s, %s)
                        """,
                        (
                            week_key,
                            edit["section"],
                            edit["body"],
                            note,
                            _topic_or_none(edit.get("topic")),
                            bool(edit.get("highlight")),
                        ),
                    )
                    changed += 1
                    continue
                bullet_id = str(edit.get("id") or "")
                if action == "rewrite" and bullet_id:
                    cur.execute(
                        """
                        UPDATE patchnote_bullets
                        SET section = %s,
                            body = %s,
                            revision_note = %s,
                            topic = %s,
                            highlight = %s
                        WHERE id = %s AND week = %s AND status IN ('pending', 'approved')
                        """,
                        (
                            edit["section"],
                            edit["body"],
                            note,
                            _topic_or_none(edit.get("topic")),
                            bool(edit.get("highlight")),
                            bullet_id,
                            week_key,
                        ),
                    )
                    changed += int(cur.rowcount)
                    continue
                if action != "drop" or not bullet_id:
                    continue
                cur.execute(
                    """
                    UPDATE patchnote_bullets
                    SET status = 'denied',
                        deny_reason = %s,
                        reviewed_at = now()
                    WHERE id = %s AND week = %s AND status IN ('pending', 'approved')
                    """,
                    (note, bullet_id, week_key),
                )
                changed += int(cur.rowcount)
            cur.execute(
                f"""
                SELECT {_BULLET_COLUMNS}
                FROM patchnote_bullets
                WHERE week = %s AND status IN ('pending', 'approved')
                ORDER BY created_at ASC, id ASC
                """,
                (week_key,),
            )
            bullets = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return {"changed": changed, "bullets": bullets}


def get_week_status(week: str) -> dict[str, Any]:
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT postponed, deferred_to
                FROM patchnote_week_status
                WHERE week = %s
                """,
                (week_key,),
            )
            return _week_status_row(week_key, cur.fetchone())
    finally:
        conn.close()


def postpone_week(week: str) -> dict[str, Any]:
    """Hold a week. The public page hides it until the hold is undone or deferred."""
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO patchnote_week_status (week, postponed)
                VALUES (%s, TRUE)
                ON CONFLICT (week) DO UPDATE
                    SET postponed = TRUE, updated_at = now()
                RETURNING postponed, deferred_to
                """,
                (week_key,),
            )
            return _week_status_row(week_key, cur.fetchone())
    finally:
        conn.close()


def undo_postpone(week: str) -> dict[str, Any]:
    """Clear a hold and bring deferred lines back onto this week."""
    week_key = parse_week(week)
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT deferred_to FROM patchnote_week_status WHERE week = %s",
                (week_key,),
            )
            row = cur.fetchone()
            if row is not None and row.get("deferred_to"):
                cur.execute(
                    """
                    UPDATE patchnote_bullets
                    SET week = %s,
                        status = COALESCE(carried_status, 'pending'),
                        reviewed_at = CASE
                            WHEN carried_status = 'approved' THEN now()
                            ELSE NULL
                        END,
                        carried_from = NULL,
                        carried_status = NULL
                    WHERE carried_from = %s
                    """,
                    (week_key, week_key),
                )
            cur.execute(
                """
                INSERT INTO patchnote_week_status (week, postponed, deferred_to)
                VALUES (%s, FALSE, NULL)
                ON CONFLICT (week) DO UPDATE
                    SET postponed = FALSE, deferred_to = NULL, updated_at = now()
                RETURNING postponed, deferred_to
                """,
                (week_key,),
            )
            return _week_status_row(week_key, cur.fetchone())
    finally:
        conn.close()


def defer_postponed_week(week: str) -> dict[str, Any]:
    """Move this week's notes onto the next week and keep them unpublished."""
    week_key = parse_week(week)
    status = get_week_status(week_key)
    if not status["postponed"]:
        raise WeekNotPostponed(week_key)
    if status["deferred_to"]:
        return status
    destination = next_week(week_key)
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE patchnote_bullets
                SET week = %s,
                    carried_from = week,
                    carried_status = status,
                    status = 'pending',
                    deny_reason = NULL,
                    reviewed_at = NULL
                WHERE week = %s AND status IN ('pending', 'approved')
                """,
                (destination, week_key),
            )
            cur.execute(
                """
                UPDATE patchnote_week_status
                SET deferred_to = %s, updated_at = now()
                WHERE week = %s
                RETURNING postponed, deferred_to
                """,
                (destination, week_key),
            )
            return _week_status_row(week_key, cur.fetchone())
    finally:
        conn.close()


def approve_pending_week(week: str) -> int:
    """Approve lines nobody reviewed. Rewrites still need a staff click."""
    week_key = parse_week(week)
    if get_week_status(week_key)["postponed"]:
        raise WeekPostponed(week_key)
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE patchnote_bullets
                SET status = 'approved', deny_reason = NULL, reviewed_at = now()
                WHERE week = %s AND status = 'pending' AND supersedes IS NULL
                """,
                (week_key,),
            )
            return int(cur.rowcount)
    finally:
        conn.close()
