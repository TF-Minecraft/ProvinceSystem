"""Append-only staff audit log. Never store cookies, tokens or request bodies."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from src import database


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
    if isinstance(conn, sqlite3.Connection):
        # PG-MIGRATION: until the LuckPerms area converts, luckperms/changes.py passes its
        # SQLite connection. The audit log is in Postgres now, so this row commits on its
        # own, just before the caller's.
        with database.connect() as pg:
            record(pg, actor=actor, action=action, outcome=outcome, target=target, reason=reason, detail=detail)
        return
    conn.execute(
        """
        INSERT INTO admin_audit (
            created_at, actor_type, actor_user_id, actor_discord_id, actor_name, actor_role,
            action, outcome, target_user_id, target_discord_id, target_name, reason, detail_json
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            datetime.now(timezone.utc),
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
            database.Jsonb(detail or {}),
        ),
    )


def record_refusal(**kwargs) -> None:
    """Log a refused attempt in its own transaction.

    Call only after the refused action's transaction has rolled back, so the
    refusal is kept whatever that transaction did.
    """
    with database.connect() as conn:
        record(conn, **kwargs)
