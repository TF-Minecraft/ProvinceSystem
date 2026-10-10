"""Users, their cookie sessions and Discord OAuth states. Tokens are stored only as hashes."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from src.skins.codes import hash_secret
from src.skins.db import connect
from src.skins.discord_link import remember_discord_nicknames, remember_discord_usernames

from .config import AuthConfig
from .discord import SCOPES

STATE_TTL = timedelta(minutes=10)
SESSION_TTL = timedelta(days=30)
# Linking trusts a guild check this recent; older ones are checked again with the bot.
GUILD_CHECK_MAX_AGE = timedelta(minutes=15)
RETURN_DEFAULT = "/account"
_RETURN_MAX = 512
_TOKEN_MAX = 256


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def clean_return_to(value: str | None) -> str:
    """Only same-site paths: no scheme, host, protocol-relative or backslash forms."""
    path = (value or "").strip()
    if (
        not path.startswith("/")
        or path.startswith("//")
        or "\\" in path
        or len(path) > _RETURN_MAX
        or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path)
    ):
        return RETURN_DEFAULT
    return path


def start_sign_in(config: AuthConfig, return_to: str | None) -> tuple[str, str]:
    """Return (state, Discord authorise URL). The caller stores state in a cookie."""
    state = secrets.token_urlsafe(32)
    now = _utcnow()
    with connect() as conn:
        conn.execute("DELETE FROM discord_oauth_states WHERE expires_at <= ?", (_iso(now),))
        conn.execute(
            "INSERT INTO discord_oauth_states (state_hash, return_to, expires_at) VALUES (?, ?, ?)",
            (hash_secret(state), clean_return_to(return_to), _iso(now + STATE_TTL)),
        )
        conn.commit()
    query = urlencode([
        ("response_type", "code"),
        ("client_id", config.client_id),
        ("redirect_uri", config.redirect_uri),
        ("scope", SCOPES),
        ("state", state),
        ("prompt", "none"),
    ])
    return state, "https://discord.com/oauth2/authorize?" + query


def consume_state(state: str | None) -> str | None:
    """Spend a state once; return its saved path, or None if unknown or expired."""
    if not state or len(state) > _TOKEN_MAX:
        return None
    digest = hash_secret(state)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT return_to, expires_at FROM discord_oauth_states WHERE state_hash = ?",
            (digest,),
        ).fetchone()
        conn.execute("DELETE FROM discord_oauth_states WHERE state_hash = ?", (digest,))
        conn.commit()
    if row is None or _parse_iso(row["expires_at"]) <= _utcnow():
        return None
    return row["return_to"]


def sign_in(
    identity: dict,
    *,
    guild_member: bool,
    member: dict | None = None,
    guild_checked_at: str | None = None,
    role: str | None = None,
) -> str:
    """Upsert the user, open a session and return its plaintext token.

    A preview passes the membership check and role dev already holds for the user.
    """
    token = secrets.token_urlsafe(32)
    now = _utcnow()
    stamp = _iso(now)
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO users (
                discord_user_id, discord_username, discord_global_name, discord_avatar,
                created_at, updated_at, last_login_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(discord_user_id) DO UPDATE SET
                discord_username = excluded.discord_username,
                discord_global_name = excluded.discord_global_name,
                discord_avatar = excluded.discord_avatar,
                updated_at = excluded.updated_at,
                last_login_at = excluded.last_login_at
            """,
            (
                identity["discord_user_id"], identity["discord_username"], identity["discord_global_name"],
                identity["discord_avatar"], stamp, stamp, stamp,
            ),
        )
        user_id = conn.execute(
            "SELECT id FROM users WHERE discord_user_id = ?", (identity["discord_user_id"],)
        ).fetchone()["id"]
        if role is not None:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        conn.execute("DELETE FROM user_sessions WHERE expires_at <= ?", (stamp,))
        conn.execute(
            """
            INSERT INTO user_sessions (token_hash, user_id, guild_member, guild_checked_at, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                hash_secret(token), user_id, 1 if guild_member else 0, guild_checked_at or stamp, stamp,
                _iso(now + SESSION_TTL),
            ),
        )
        conn.commit()
    if identity["discord_username"]:
        # Keep the staff-facing name on an existing link current.
        remember_discord_usernames(
            [{"discord_user_id": identity["discord_user_id"], "discord_username": identity["discord_username"]}],
            overwrite=True,
        )
    if member is not None:
        # And their server nickname, now that Discord has just said what it is.
        remember_discord_nicknames(
            [{"discord_user_id": identity["discord_user_id"], "discord_nickname": member.get("nick")}]
        )
    return token


def session_user(token: str | None) -> dict | None:
    with connect() as conn:
        return session_user_in(conn, token)


def session_user_in(conn, token: str | None) -> dict | None:
    """Session user on the caller's connection, so staff checks can run inside a write."""
    if not token or len(token) > _TOKEN_MAX:
        return None
    row = conn.execute(
        """
        SELECT s.id AS session_id, s.expires_at, s.guild_member, s.guild_checked_at,
               u.id AS user_id, u.discord_user_id, u.discord_username,
               u.discord_global_name, u.discord_avatar, u.created_at, u.role
        FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
        """,
        (hash_secret(token),),
    ).fetchone()
    if row is None or _parse_iso(row["expires_at"]) <= _utcnow():
        return None
    return dict(row)


def guild_state(session_id: int) -> dict | None:
    """The session's stored membership check, as another request may have just updated it."""
    with connect() as conn:
        row = conn.execute(
            "SELECT guild_member, guild_checked_at FROM user_sessions WHERE id = ?", (session_id,)
        ).fetchone()
    return dict(row) if row else None


def record_guild_check(session_id: int, member: bool) -> str:
    """Store a membership check made after sign-in; returns its time."""
    stamp = _iso(_utcnow())
    with connect() as conn:
        conn.execute(
            "UPDATE user_sessions SET guild_member = ?, guild_checked_at = ? WHERE id = ?",
            (1 if member else 0, stamp, session_id),
        )
        conn.commit()
    return stamp


def guild_check_recent(user: dict) -> bool:
    """The session's membership check, member or not, is recent enough to act on."""
    checked = user.get("guild_checked_at")
    return bool(checked) and _utcnow() - _parse_iso(checked) <= GUILD_CHECK_MAX_AGE


def guild_check_fresh(user: dict) -> bool:
    return bool(user.get("guild_member")) and guild_check_recent(user)


def revoke_session(token: str | None) -> None:
    if not token or len(token) > _TOKEN_MAX:
        return
    with connect() as conn:
        conn.execute("DELETE FROM user_sessions WHERE token_hash = ?", (hash_secret(token),))
        conn.commit()


def avatar_url(user: dict) -> str:
    discord_id = user["discord_user_id"]
    avatar = user.get("discord_avatar")
    if avatar and avatar.replace("_", "").isalnum():
        return f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar}.png?size=128"
    return f"https://cdn.discordapp.com/embed/avatars/{(int(discord_id) >> 22) % 6}.png"
