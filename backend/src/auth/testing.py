"""Test helpers for accounts, which live in Postgres. Tests using them take the `postgres` fixture."""
from __future__ import annotations

from src import database


def rows(sql: str, params: tuple = ()) -> list[dict]:
    with database.connect() as conn:
        return conn.execute(sql, params).fetchall()


def value(sql: str, params: tuple = ()):
    """The first column of the first row, or None."""
    with database.connect() as conn:
        row = conn.execute(sql, params).fetchone()
    return None if row is None else next(iter(row.values()))


def execute(sql: str, params: tuple = ()) -> int:
    """Run one statement in its own transaction; the number of rows it touched."""
    with database.connect() as conn:
        return conn.execute(sql, params).rowcount


def audit_rows() -> list[dict]:
    """The audit log, oldest first; detail_json is the parsed object."""
    return rows("SELECT * FROM admin_audit ORDER BY id")


def set_role(discord_id: str, role: str) -> int:
    """Give the account a role; its id."""
    with database.connect() as conn:
        return conn.execute("UPDATE users SET role = %s WHERE discord_user_id = %s RETURNING id",
                            (role, discord_id)).fetchone()["id"]


def expire_views() -> None:
    execute("UPDATE user_sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE acting_user_id IS NOT NULL")
