"""Microsoft link attempts: single-use states tied to the site session that started them."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from src import database
from src.skins.codes import hash_secret

from .microsoft import MicrosoftConfig, authorize_url, new_verifier

STATE_TTL = timedelta(minutes=10)
_STATE_MAX = 128


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def valid_state(value: str | None) -> bool:
    return bool(value) and len(value) <= _STATE_MAX and value.isascii() and value.isprintable()


def start(config: MicrosoftConfig, user: dict) -> tuple[str, str]:
    """Return (state, Microsoft authorise URL). A new attempt replaces the user's older one."""
    state = secrets.token_urlsafe(32)
    verifier = new_verifier()
    now = _utcnow()
    with database.connect() as conn:
        conn.execute("DELETE FROM microsoft_link_states WHERE expires_at <= %s", (now,))
        # One attempt per user: two starts at once leave the later one, never two rows.
        conn.execute(
            """
            INSERT INTO microsoft_link_states (state_hash, session_id, user_id, code_verifier, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE
            SET state_hash = excluded.state_hash, session_id = excluded.session_id,
                code_verifier = excluded.code_verifier, expires_at = excluded.expires_at, used_at = NULL
            """,
            (hash_secret(state), user["session_id"], user["user_id"], verifier, now + STATE_TTL),
        )
    return state, authorize_url(config, state, verifier)


def consume(state: str | None) -> dict | None:
    """Spend a state once; return its session, user and verifier, or None if unknown, used or expired.

    The update itself checks and spends it, so of two callbacks only one gets it back.
    The row stays, marked used, until finish(): unlinking deletes it meanwhile.
    """
    if not valid_state(state):
        return None
    digest = hash_secret(state)
    now = _utcnow()
    with database.connect() as conn:
        row = conn.execute(
            """
            UPDATE microsoft_link_states SET used_at = %s
            WHERE state_hash = %s AND used_at IS NULL AND expires_at > %s
            RETURNING session_id, user_id, code_verifier
            """,
            (now, digest, now),
        ).fetchone()
    if row is None:
        return None
    return {
        "state_hash": digest,
        "session_id": row["session_id"],
        "user_id": row["user_id"],
        "code_verifier": row["code_verifier"],
    }


def finish(saved: dict) -> None:
    with database.connect() as conn:
        conn.execute("DELETE FROM microsoft_link_states WHERE state_hash = %s", (saved["state_hash"],))


def still_valid(conn, saved: dict) -> bool:
    """Checked inside the link write: signing out or unlinking mid-attempt stops the link.

    The state and the session that started it are held FOR SHARE until the link
    commits, so signing out or unlinking waits for it, or lands first and is seen here.
    """
    return conn.execute(
        """
        SELECT 1 FROM microsoft_link_states m JOIN user_sessions s ON s.id = m.session_id
        WHERE m.state_hash = %s AND s.id = %s AND s.expires_at > %s
        FOR SHARE OF m, s
        """,
        (saved["state_hash"], saved["session_id"], _utcnow()),
    ).fetchone() is not None
