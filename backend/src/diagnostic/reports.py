"""Diagnostic reports players send to staff, looked up by a short code."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone

from src.skins.db import connect

KEEP_DAYS = 30
# No 0/O, 1/I/L: the code is read out of a ticket and typed.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
_LEVELS = ("fail", "warn", "info")


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


def save(report: dict, *, minecraft_name: str | None, country: str | None, user: dict | None) -> str:
    worst, summary = summarise(report)
    now = _now()
    with connect() as conn:
        conn.execute("DELETE FROM diagnostic_reports WHERE created_at < ?", ((now - timedelta(days=KEEP_DAYS)).isoformat(),))
        for _ in range(10):
            code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO diagnostic_reports
                    (code, created_at, user_id, discord_name, minecraft_name, country, worst, summary, report_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    code,
                    now.isoformat(),
                    user["user_id"] if user else None,
                    (user.get("discord_username") or user.get("discord_global_name")) if user else None,
                    minecraft_name,
                    country,
                    worst,
                    summary,
                    json.dumps(report, separators=(",", ":")),
                ),
            )
            if cur.rowcount:
                conn.commit()
                return code
    raise RuntimeError("no free diagnostic code")


_LIST_COLUMNS = "code, created_at, user_id, discord_name, minecraft_name, country, worst, summary"


def recent(limit: int = 50) -> list[dict]:
    cutoff = (_now() - timedelta(days=KEEP_DAYS)).isoformat()
    with connect() as conn:
        rows = conn.execute(
            f"SELECT {_LIST_COLUMNS} FROM diagnostic_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?",
            (cutoff, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get(code: str) -> dict | None:
    cutoff = (_now() - timedelta(days=KEEP_DAYS)).isoformat()
    with connect() as conn:
        row = conn.execute(
            f"SELECT {_LIST_COLUMNS}, report_json FROM diagnostic_reports WHERE code = ? AND created_at >= ?",
            (normalise_code(code), cutoff),
        ).fetchone()
    if row is None:
        return None
    out = dict(row)
    out["report"] = json.loads(out.pop("report_json"))
    return out
