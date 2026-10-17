"""Diagnostic reports players send to staff, looked up by a short code.

`created_at` is timestamptz; it leaves here as the `isoformat()` string it was
stored as before (`2026-10-16T10:00:00.123456+00:00`). The report is jsonb, so
its keys come back in jsonb's order rather than the order the page sent them.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone

from src import database

KEEP_DAYS = 30
# No 0/O, 1/I/L: the code is read out of a ticket and typed.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
_LEVELS = ("fail", "warn", "info")


class BadReport(ValueError):
    """A report Postgres cannot store: NaN or Infinity, or a NUL character."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalise_code(code: str) -> str:
    return code.strip().upper().replace("-", "")


def summarise(report: dict) -> tuple[str, str]:
    """(worst level, short summary) from the report's findings."""
    found = [f for f in report.get("findings") or [] if isinstance(f, dict) and f.get("level") in _LEVELS]
    if not found:
        return "ok", "No problems found"
    worst = min((f["level"] for f in found), key=_LEVELS.index)
    titles = [str(f.get("title") or "")[:120] for f in found if f["level"] != "info"] or [str(found[0].get("title") or "")[:120]]
    return worst, "; ".join(titles)[:300]


def _storable(report: dict) -> None:
    try:
        json.dumps(report, allow_nan=False, ensure_ascii=False).encode("utf-8")
    except (ValueError, UnicodeEncodeError):
        raise BadReport("bad_report") from None
    pending = [report]
    while pending:
        value = pending.pop()
        if isinstance(value, str) and "\x00" in value:
            raise BadReport("bad_report")
        if isinstance(value, dict):
            pending.extend(value)
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)


def save(report: dict, *, minecraft_name: str | None, country: str | None, user: dict | None) -> str:
    _storable(report)
    worst, summary = summarise(report)
    now = _now()
    with database.connect() as conn:
        conn.execute("DELETE FROM diagnostic_reports WHERE created_at < %s", (now - timedelta(days=KEEP_DAYS),))
        for _ in range(10):
            code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
            saved = conn.execute(
                """
                INSERT INTO diagnostic_reports
                    (code, created_at, user_id, discord_name, minecraft_name, country, worst, summary, report)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (code) DO NOTHING
                """,
                (
                    code,
                    now,
                    user["user_id"] if user else None,
                    (user.get("discord_username") or user.get("discord_global_name")) if user else None,
                    minecraft_name,
                    country,
                    worst,
                    summary,
                    database.Jsonb(report),
                ),
            ).rowcount
            if saved:
                return code
    raise RuntimeError("no free diagnostic code")


_LIST_COLUMNS = "code, created_at, user_id, discord_name, minecraft_name, country, worst, summary"


def _listed(row) -> dict:
    out = dict(row)
    out["created_at"] = out["created_at"].astimezone(timezone.utc).isoformat()
    return out


def recent(limit: int = 50) -> list[dict]:
    cutoff = _now() - timedelta(days=KEEP_DAYS)
    with database.connect() as conn:
        rows = conn.execute(
            f"SELECT {_LIST_COLUMNS} FROM diagnostic_reports WHERE created_at >= %s ORDER BY created_at DESC LIMIT %s",
            (cutoff, limit),
        ).fetchall()
    return [_listed(r) for r in rows]


def get(code: str) -> dict | None:
    code = normalise_code(code)
    if "\x00" in code:  # no stored code holds one, and Postgres text cannot
        return None
    cutoff = _now() - timedelta(days=KEEP_DAYS)
    with database.connect() as conn:
        row = conn.execute(
            f"SELECT {_LIST_COLUMNS}, report FROM diagnostic_reports WHERE code = %s AND created_at >= %s",
            (code, cutoff),
        ).fetchone()
    if row is None:
        return None
    return _listed(row)
