"""Admins viewing the site as a player, to see what that player sees.

A view is a short user session for the player that names the admin in
acting_user_id. It is view only: src/api/view_as_guard.py refuses its writes
and those of any Profile session opened during it. The admin's own session
waits in a second cookie and comes back when the view stops or runs out.
"""
from __future__ import annotations

import secrets
from datetime import timedelta

from src import database
from src.skins.codes import hash_secret

from . import audit, roles
from .admin import AdminError
from .players import canonical_uuid
from .users import (
    PLACEHOLDERS_LOCK,
    VIEW_PROFILE_PREFIX,
    _iso,
    _utcnow,
    api_time,
    drop_view_leftovers,
    accounts_configured,
    require_accounts,
    session_user_in,
)

VIEW_TTL = timedelta(minutes=30)
_TOKEN_MAX = 256


def start(token: str | None, player_uuid: str) -> dict:
    """Open a view of the site as a player; returns its session token and expiry.

    A player who has never signed in gets a placeholder account for the view
    (users.placeholder), deleted once its views end.
    """
    require_accounts()
    actor = target = None
    key = canonical_uuid(player_uuid)
    try:
        with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
            actor = session_user_in(conn, token, lock=True)
            if actor is None:
                raise AdminError(401, "not_signed_in", "denied")
            if actor["acting_user_id"] is not None:
                raise AdminError(409, "already_viewing", "conflict")
            if not roles.can(actor["role"], "view_as_player"):
                raise AdminError(403, "forbidden", "denied")
            if key is None:
                raise AdminError(400, "bad_uuid", "invalid")
            link = _link_for_player(conn, key)
            # The site knows a player through their Discord link; without one there is nothing to view.
            if link is None:
                raise AdminError(404, "not_linked", "not_found")
            if actor["discord_user_id"] == link["discord_user_id"]:
                raise AdminError(403, "cannot_act_on_self", "denied")
            target = _account_for(conn, link["discord_user_id"])
            made = target is None
            if made:
                target = _make_placeholder(conn, link)
            # Players only: staff accounts are never viewed.
            if target["role"] != "player":
                raise AdminError(403, "target_is_staff", "denied")
            view_token, expires_at = _open(conn, actor, target)
            audit.record(conn, actor=actor, action="account.view_as.start", outcome="ok", target=target,
                         detail={"expires_at": expires_at, "player_uuid": key, "placeholder": made})
    except AdminError as exc:
        if actor is not None:
            audit.record_refusal(actor=actor, action="account.view_as.start", outcome=exc.outcome, target=target,
                                 detail={"error": exc.code, "player_uuid": key or player_uuid[:64]})
        raise
    return {"token": view_token, "expires_at": expires_at, "staff_expires_at": actor["expires_at"]}


def _link_for_player(conn, key: str) -> dict | None:
    row = conn.execute(
        "SELECT discord_user_id, discord_username FROM discord_links WHERE lower(player_uuid) = %s", (key,)
    ).fetchone()
    return dict(row) if row else None


def _account_for(conn, discord_user_id: str) -> dict | None:
    row = conn.execute(
        "SELECT id AS user_id, discord_user_id, discord_username, discord_global_name, role "
        "FROM users WHERE discord_user_id = %s",
        (discord_user_id,),
    ).fetchone()
    return dict(row) if row else None


def _make_placeholder(conn, link) -> dict:
    now = _utcnow()
    # A sign-in may have made the account meanwhile: keep theirs.
    conn.execute(
        """
        INSERT INTO users (discord_user_id, discord_username, created_at, updated_at, last_login_at, placeholder)
        VALUES (%s, %s, %s, %s, %s, true)
        ON CONFLICT (discord_user_id) DO NOTHING
        """,
        (link["discord_user_id"], link["discord_username"], now, now, now),
    )
    return _account_for(conn, link["discord_user_id"])


def _open(conn, actor: dict, target: dict) -> tuple[str, str]:
    now = _utcnow()
    expires = now + VIEW_TTL
    # The player's own last membership check, so the Account page shows what they would see.
    last = conn.execute(
        "SELECT guild_member, guild_checked_at FROM user_sessions "
        "WHERE user_id = %s AND acting_user_id IS NULL ORDER BY id DESC LIMIT 1",
        (target["user_id"],),
    ).fetchone()
    view_token = secrets.token_urlsafe(32)
    # users.sign_in skips views that ran out; end them here so each is audited.
    _end_where(conn, "s.acting_user_id IS NOT NULL AND s.expires_at <= %s", (now,))
    conn.execute("DELETE FROM user_sessions WHERE expires_at <= %s", (now,))
    conn.execute(
        """
        INSERT INTO user_sessions (
            token_hash, user_id, guild_member, guild_checked_at, created_at, expires_at, acting_user_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            hash_secret(view_token), target["user_id"], last["guild_member"] if last else False,
            last["guild_checked_at"] if last else None, now, expires, actor["user_id"],
        ),
    )
    return view_token, _iso(expires)


def stop(view_token: str | None, staff_token: str | None) -> dict:
    """End a view, expired or not, and say whether the admin's own session can come back.

    It comes back only if it is still valid, is not itself a view, and belongs to
    the admin who opened this view. The browser drops a view's cookie once it runs
    out, so without one this ends the admin's lapsed views instead.
    """
    if not (_valid(view_token) or _valid(staff_token)):
        return {"ended": False, "restored": False, "staff_expires_at": None, "player_uuid": None}
    require_accounts()
    with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
        ended = _end_where(conn, "s.token_hash = %s", (hash_secret(view_token),)) if _valid(view_token) else []
        view = ended[0] if ended else None
        staff = session_user_in(conn, staff_token) if _valid(staff_token) else None
        if staff is not None and (
            staff["acting_user_id"] is not None
            or (view is not None and staff["user_id"] != view["acting_user_id"])
        ):
            staff = None
        if staff is not None and view is None:
            lapsed = _end_where(conn, "s.acting_user_id = %s AND s.expires_at <= %s",
                                (staff["user_id"], _utcnow()))
            view = lapsed[-1] if lapsed else None
    return {
        "ended": view is not None,
        "restored": staff is not None,
        "staff_expires_at": staff["expires_at"] if staff else None,
        "player_uuid": view["player_uuid"] if view else None,
    }


def _valid(token: str | None) -> bool:
    return bool(token) and len(token) <= _TOKEN_MAX


def _end_where(conn, where: str, params: tuple) -> list[dict]:
    """Delete the matching views and their Profile sessions, auditing each; oldest first.

    The views are locked first, so two requests ending the same view end and audit it once.
    The caller's transaction opened with the placeholders lock.
    """
    rows = conn.execute(
        f"""
        SELECT s.id, s.acting_user_id, s.expires_at, u.id AS user_id, u.discord_user_id,
               u.discord_username, u.discord_global_name, dl.player_uuid
        FROM user_sessions s JOIN users u ON u.id = s.user_id
        LEFT JOIN discord_links dl ON dl.discord_user_id = u.discord_user_id
        WHERE s.acting_user_id IS NOT NULL AND {where}
        ORDER BY s.id
        FOR UPDATE OF s
        """,
        params,
    ).fetchall()
    now = _utcnow()
    views = [dict(row) for row in rows]
    for view in views:
        conn.execute("DELETE FROM user_sessions WHERE id = %s", (view["id"],))
        actor = conn.execute(
            "SELECT id AS user_id, discord_user_id, discord_username, discord_global_name, role "
            "FROM users WHERE id = %s",
            (view["acting_user_id"],),
        ).fetchone()
        audit.record(conn, actor=dict(actor) if actor else None, action="account.view_as.stop", outcome="ok",
                     target=view, detail={"expired": view["expires_at"] <= now})
        view["expires_at"] = api_time(view["expires_at"])
    if views:
        drop_view_leftovers(conn)
    return views


def end(token: str | None) -> None:
    """End the view this session token belongs to, if it is one."""
    if not _valid(token) or not accounts_configured():
        return
    with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
        _end_where(conn, "s.token_hash = %s", (hash_secret(token),))


def end_lapsed(staff_token: str | None) -> None:
    """End the views that have run out for the admin whose own session this is.

    For when the browser has already dropped the view's cookie.
    """
    if not _valid(staff_token) or not accounts_configured():
        return
    with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
        staff = session_user_in(conn, staff_token, lock=True)
        if staff is not None and staff["acting_user_id"] is None:
            _end_where(conn, "s.acting_user_id = %s AND s.expires_at <= %s", (staff["user_id"], _utcnow()))


def audit_refused_start(cookie_tokens: list[str], player_uuid: str) -> None:
    """Log an attempt to start a view from inside one, which the guard refuses before the route."""
    for token in cookie_tokens:
        if not _valid(token):
            continue
        with database.connect() as conn:
            row = conn.execute(
                "SELECT a.id AS user_id, a.discord_user_id, a.discord_username, a.discord_global_name, a.role "
                "FROM user_sessions s JOIN users a ON a.id = s.acting_user_id WHERE s.token_hash = %s",
                (hash_secret(token),),
            ).fetchone()
        if row is not None:
            audit.record_refusal(actor=dict(row), action="account.view_as.start", outcome="conflict",
                                 detail={"error": "already_viewing", "player_uuid": player_uuid})
            return


def profile_minted_via(user: dict) -> str | None:
    """codes.minted_via for a Profile session opened by this session user; None outside a view."""
    if user.get("acting_user_id") is None:
        return None
    return f"{VIEW_PROFILE_PREFIX}{user['session_id']}"


def view_still_open(session_id: int):
    """A check, run inside a write, that this view has not ended or run out.

    The view's row is held FOR SHARE until that write commits, so ending the
    view waits for it or is seen by it.
    """
    def check(conn) -> bool:
        return conn.execute(
            "SELECT 1 FROM user_sessions WHERE id = %s AND acting_user_id IS NOT NULL AND expires_at > %s "
            "FOR SHARE",
            (session_id, _utcnow()),
        ).fetchone() is not None
    return check


def refuses_write(cookie_tokens: list[str], bearer_token: str | None) -> bool:
    """A view's session cookie, or a Profile session opened during a view, sent with a write."""
    hashes = [hash_secret(token) for token in cookie_tokens if _valid(token)]
    bearer = hash_secret(bearer_token) if _valid(bearer_token) else None
    # Without the site database no view or Profile session can exist.
    if not (hashes or bearer) or not accounts_configured():
        return False
    with database.connect() as conn:
        if hashes and conn.execute(
            "SELECT 1 FROM user_sessions WHERE token_hash = ANY(%s) AND acting_user_id IS NOT NULL", (hashes,)
        ).fetchone() is not None:
            return True
        if bearer is not None:
            row = conn.execute(
                "SELECT c.minted_via FROM sessions s JOIN codes c ON c.id = s.code_id WHERE s.token_hash = %s",
                (bearer,),
            ).fetchone()
            if row is not None and (row["minted_via"] or "").startswith(VIEW_PROFILE_PREFIX):
                return True
    return False
