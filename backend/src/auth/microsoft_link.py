"""Microsoft link attempts: single-use states tied to the site session that started them."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from src.skins.codes import hash_secret
from src.skins.db import connect

from .microsoft import MicrosoftConfig, authorize_url, new_verifier

STATE_TTL = timedelta(minutes=10)
_STATE_MAX = 128


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def valid_state(value: str | None) -> bool:
    return bool(value) and len(value) <= _STATE_MAX and value.isascii() and value.isprintable()


def start(config: MicrosoftConfig, user: dict) -> tuple[str, str]:
    """Return (state, Microsoft authorise URL). A new attempt replaces the user's older ones."""
    state = secrets.token_urlsafe(32)
    verifier = new_verifier()
    now = _utcnow()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM microsoft_link_states WHERE expires_at <= ?", (_iso(now),))
        conn.execute("DELETE FROM microsoft_link_states WHERE user_id = ?", (user["user_id"],))
        conn.execute(
            """
            INSERT INTO microsoft_link_states (state_hash, session_id, user_id, code_verifier, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (hash_secret(state), user["session_id"], user["user_id"], verifier, _iso(now + STATE_TTL)),
        )
        conn.commit()
    return state, authorize_url(config, state, verifier)


def consume(state: str | None) -> dict | None:
    """Spend a state once; return its session, user and verifier, or None if unknown or expired."""
    if not valid_state(state):
        return None
    digest = hash_secret(state)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT session_id, user_id, code_verifier, expires_at FROM microsoft_link_states WHERE state_hash = ?",
            (digest,),
        ).fetchone()
        conn.execute("DELETE FROM microsoft_link_states WHERE state_hash = ?", (digest,))
        conn.commit()
    if row is None or _parse_iso(row["expires_at"]) <= _utcnow():
        return None
    return {"session_id": row["session_id"], "user_id": row["user_id"], "code_verifier": row["code_verifier"]}


def session_still_valid(conn, session_id: int) -> bool:
    """Checked inside the link write, so signing out mid-attempt stops the link."""
    row = conn.execute("SELECT expires_at FROM user_sessions WHERE id = ?", (session_id,)).fetchone()
    return row is not None and _parse_iso(row["expires_at"]) > _utcnow()
