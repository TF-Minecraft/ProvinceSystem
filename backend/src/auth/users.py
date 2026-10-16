"""Users, their cookie sessions and Discord OAuth states. Tokens are stored only as hashes.

Times are timestamptz in Postgres. The session user dict carries them as the
`YYYY-MM-DDTHH:MM:SSZ` strings the site has always sent: cookie lifetimes,
/account, the preview hand-off and other areas parse that form.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import HTTPException

from src import database
from src.skins import db as sqlite_db
from src.skins.codes import hash_secret
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


# codes.minted_via for a Profile session opened during a view: this prefix and the view's session id.
VIEW_PROFILE_PREFIX = "staff_view:"
# Every transaction that calls drop_view_leftovers takes this lock as its first
# statement, so it never deletes a placeholder whose view is being committed.
PLACEHOLDERS_LOCK = "auth:placeholders"


class AccountsUnavailable(HTTPException):
    """No accounts database: DATABASE_URL is unset (a local run without Postgres, or a preview
    before previews get their own database). Signed-out pages still work; sign-in answers 503."""

    def __init__(self):
        super().__init__(503, detail="accounts_unavailable")


def accounts_configured() -> bool:
    try:
        database.get_pool()
    except database.NotConfiguredError:
        return False
    return True


def require_accounts() -> None:
    if not accounts_configured():
        raise AccountsUnavailable()


def drop_view_leftovers(conn) -> None:
    """Delete what views that no longer exist leave behind, however they ended: Profile
    sessions opened during them, and placeholder accounts made for them.

    The caller's transaction must have opened with `database.transaction(lock=PLACEHOLDERS_LOCK)`.
    """
    # PG-MIGRATION: until the Skins area converts, Profile sessions and their codes are in
    # SQLite. This commits its SQLite delete in the middle of the Postgres transaction (it stays
    # if that transaction rolls back) and takes SQLite's write lock while holding Postgres locks.
    # Accepted until then; the Skins PR runs this on `conn` instead:
    #   DELETE FROM sessions WHERE code_id IN (SELECT id FROM codes WHERE minted_via LIKE 'staff_view:%'
    #     AND CAST(substr(minted_via, length('staff_view:') + 1) AS bigint) NOT IN (SELECT id FROM user_sessions))
    views = [row["id"] for row in conn.execute("SELECT id FROM user_sessions WHERE acting_user_id IS NOT NULL")]
    with sqlite_db.connect() as lite:
        lite.execute(
            """
            DELETE FROM sessions WHERE code_id IN (
                SELECT id FROM codes
                WHERE minted_via LIKE 'staff_view:%'
                  AND CAST(substr(minted_via, length('staff_view:') + 1) AS INTEGER)
                      NOT IN (SELECT value FROM json_each(?))
            )
            """,
            (json.dumps(views),),
        )
        lite.commit()
    conn.execute("DELETE FROM users WHERE placeholder AND id NOT IN (SELECT user_id FROM user_sessions)")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def api_time(value: datetime | None) -> str | None:
    """A stored time as the site's API form, `YYYY-MM-DDTHH:MM:SSZ`; None stays None."""
    return None if value is None else _iso(value)


def _as_time(value: datetime | str | None) -> datetime | None:
    """A time to store: a datetime, or the API form a preview hands over."""
    return _parse_iso(value) if isinstance(value, str) else value


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
    require_accounts()
    state = secrets.token_urlsafe(32)
    now = _utcnow()
    with database.connect() as conn:
        conn.execute("DELETE FROM discord_oauth_states WHERE expires_at <= %s", (now,))
        conn.execute(
            "INSERT INTO discord_oauth_states (state_hash, return_to, expires_at) VALUES (%s, %s, %s)",
            (hash_secret(state), clean_return_to(return_to), now + STATE_TTL),
        )
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
    require_accounts()
    # One DELETE both reads and spends the state, so two callbacks cannot both get it.
    with database.connect() as conn:
        row = conn.execute(
            "DELETE FROM discord_oauth_states WHERE state_hash = %s RETURNING return_to, expires_at",
            (hash_secret(state),),
        ).fetchone()
    if row is None or row["expires_at"] <= _utcnow():
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
    require_accounts()
    token = secrets.token_urlsafe(32)
    now = _utcnow()
    with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
        user_id = conn.execute(
            """
            INSERT INTO users (
                discord_user_id, discord_username, discord_global_name, discord_avatar,
                created_at, updated_at, last_login_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (discord_user_id) DO UPDATE SET
                -- A placeholder made for a staff view becomes their account from now.
                created_at = CASE WHEN users.placeholder THEN excluded.created_at ELSE users.created_at END,
                placeholder = false,
                discord_username = excluded.discord_username,
                discord_global_name = excluded.discord_global_name,
                discord_avatar = excluded.discord_avatar,
                updated_at = excluded.updated_at,
                last_login_at = excluded.last_login_at
            RETURNING id
            """,
            (
                identity["discord_user_id"], identity["discord_username"], identity["discord_global_name"],
                identity["discord_avatar"], now, now, now,
            ),
        ).fetchone()["id"]
        if role is not None:
            conn.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))
        # Views that ran out are left for src/auth/view_as.py to end and audit.
        conn.execute("DELETE FROM user_sessions WHERE expires_at <= %s AND acting_user_id IS NULL", (now,))
        drop_view_leftovers(conn)
        conn.execute(
            """
            INSERT INTO user_sessions (token_hash, user_id, guild_member, guild_checked_at, created_at, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                hash_secret(token), user_id, bool(guild_member), _as_time(guild_checked_at) or now, now,
                now + SESSION_TTL,
            ),
        )
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
    """The signed-in user for a session token, or None. Without a token this never touches the
    database, so signed-out pages work with no accounts database; with one it needs it (503)."""
    if not token or len(token) > _TOKEN_MAX:
        return None
    require_accounts()
    with database.connect() as conn:
        return session_user_in(conn, token)


def session_user_in(conn, token: str | None, *, lock: bool = False) -> dict | None:
    """Session user on the caller's connection, so staff checks can run inside a write.

    Staff writes pass `lock=True`: the session and user rows are held FOR SHARE until
    the caller commits, so a demotion or revocation either waits for the write or
    lands first and is seen by it. Ordinary reads take no lock.
    """
    if not token or len(token) > _TOKEN_MAX:
        return None
    if isinstance(conn, sqlite3.Connection):
        # PG-MIGRATION: until the LuckPerms area converts, luckperms/changes.py passes its
        # SQLite connection. Sessions are in Postgres now, so read them there; nothing holds
        # them for the caller's write meanwhile, so a lock cannot be honoured.
        if lock:
            raise TypeError("session_user_in(lock=True) needs a Postgres connection")
        return session_user(token)
    row = conn.execute(
        f"""
        SELECT s.id AS session_id, s.expires_at, s.guild_member, s.guild_checked_at,
               s.acting_user_id, COALESCE(a.discord_username, a.discord_global_name) AS acting_name,
               u.id AS user_id, u.discord_user_id, u.discord_username,
               u.discord_global_name, u.discord_avatar, u.created_at, u.role
        FROM user_sessions s JOIN users u ON u.id = s.user_id
        LEFT JOIN users a ON a.id = s.acting_user_id
        WHERE s.token_hash = %s
        {"FOR SHARE OF s, u" if lock else ""}
        """,
        (hash_secret(token),),
    ).fetchone()
    if row is None or row["expires_at"] <= _utcnow():
        return None
    user = dict(row)
    for key in ("expires_at", "guild_checked_at", "created_at"):
        user[key] = api_time(user[key])
    if user["acting_user_id"] is not None:
        # Someone viewing the site as this user holds no staff rights, whatever their role.
        user["role"] = "player"
    return user


def guild_state(session_id: int) -> dict | None:
    """The session's stored membership check, as another request may have just updated it."""
    require_accounts()
    with database.connect() as conn:
        row = conn.execute(
            "SELECT guild_member, guild_checked_at FROM user_sessions WHERE id = %s", (session_id,)
        ).fetchone()
    return {"guild_member": row["guild_member"], "guild_checked_at": api_time(row["guild_checked_at"])} if row else None


def record_guild_check(session_id: int, member: bool) -> str:
    """Store a membership check made after sign-in; returns its time."""
    require_accounts()
    now = _utcnow()
    with database.connect() as conn:
        conn.execute(
            "UPDATE user_sessions SET guild_member = %s, guild_checked_at = %s WHERE id = %s",
            (bool(member), now, session_id),
        )
    return _iso(now)


def guild_check_recent(user: dict) -> bool:
    """The session's membership check, member or not, is recent enough to act on."""
    checked = user.get("guild_checked_at")
    return bool(checked) and _utcnow() - _parse_iso(checked) <= GUILD_CHECK_MAX_AGE


def guild_check_fresh(user: dict) -> bool:
    return bool(user.get("guild_member")) and guild_check_recent(user)


def revoke_session(token: str | None) -> None:
    if not token or len(token) > _TOKEN_MAX or not accounts_configured():
        # Without an accounts database there is no session to revoke; signing out still clears cookies.
        return
    with database.connect() as conn:
        conn.execute("DELETE FROM user_sessions WHERE token_hash = %s", (hash_secret(token),))


def avatar_url(user: dict) -> str:
    discord_id = user["discord_user_id"]
    avatar = user.get("discord_avatar")
    if avatar and avatar.replace("_", "").isalnum():
        return f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar}.png?size=128"
    return f"https://cdn.discordapp.com/embed/avatars/{(int(discord_id) >> 22) % 6}.png"
