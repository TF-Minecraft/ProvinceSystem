"""Append-only staff audit log. Never store cookies, tokens or request bodies."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from src.skins.db import connect


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def display_name(user: dict | None) -> str | None:
    if not user:
        return None
    return user.get("discord_username") or user.get("discord_global_name") or user.get("discord_user_id")


def record(
    conn,
    *,
    actor: dict | None,
    action: str,
    outcome: str,
    target: dict | None = None,
    reason: str | None = None,
    detail: dict | None = None,
) -> None:
    """Write one row on the caller's connection, inside its transaction.

    actor is a signed-in user row (with role), or None for operator commands.
    """
    conn.execute(
        """
        INSERT INTO admin_audit (
            created_at, actor_type, actor_user_id, actor_discord_id, actor_name, actor_role,
            action, outcome, target_user_id, target_discord_id, target_name, reason, detail_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            _now(),
            "user" if actor else "system",
            actor.get("user_id") if actor else None,
            actor.get("discord_user_id") if actor else None,
            display_name(actor) if actor else "operator",
            actor.get("role") if actor else None,
            action,
            outcome,
            target.get("user_id") if target else None,
            target.get("discord_user_id") if target else None,
            display_name(target),
            reason,
            json.dumps(detail or {}, sort_keys=True),
        ),
    )


def record_refusal(**kwargs) -> None:
    """Log a refused attempt in its own transaction.

    Call only after the refused action's transaction has rolled back:
    SQLite allows one writer, so this would otherwise wait on that lock.
    """
    with connect() as conn:
        record(conn, **kwargs)
        conn.commit()
