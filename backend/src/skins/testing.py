"""Test helpers for Discord links, codes and submissions, which live in Postgres.

Tests using them take the `postgres` fixture.
"""
from __future__ import annotations

from src import database


def link(
    player_uuid: str,
    discord_user_id: str,
    minecraft_name: str | None = None,
    discord_username: str | None = None,
    *,
    linked_at: str = "2026-01-01T00:00:00Z",
    **columns,
) -> None:
    """Store a Discord link as the bot or a code would have made it."""
    values = {
        "player_uuid": player_uuid,
        "discord_user_id": discord_user_id,
        "minecraft_name": minecraft_name,
        "discord_username": discord_username,
        "linked_at": linked_at,
        **columns,
    }
    names = ", ".join(values)
    marks = ", ".join(["%s"] * len(values))
    with database.connect() as conn:
        conn.execute(f"INSERT INTO discord_links ({names}) VALUES ({marks})", tuple(values.values()))
