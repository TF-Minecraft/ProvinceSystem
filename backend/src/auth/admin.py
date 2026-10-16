"""Staff operations on website accounts.

Every write locks the actor's and the target's account rows, then reloads the
actor's session and both roles inside that transaction, so a demotion or
revocation that lands first always wins. The change, the target's session
revocation and the audit row commit together; a refused attempt rolls back and
is then logged on its own.
"""
from __future__ import annotations

import json

from src import database
from src.skins import db as sqlite_db
from src.skins.codes import hash_secret

from . import audit, roles
from .users import _TOKEN_MAX, PLACEHOLDERS_LOCK, api_time, drop_view_leftovers, require_accounts, session_user_in

# A user's own sessions and the views they have open as players.
_REVOKE = "DELETE FROM user_sessions WHERE user_id = %s OR acting_user_id = %s"
REASON_MIN = 3
REASON_MAX = 500
_LOOKUP_MAX = 64
_LOOKUP_LIMIT = 5
# Ids are bigint; a larger one from the URL names no account.
_ID_MAX = 2**63 - 1

_ACCOUNT_COLUMNS = (
    "id AS user_id, discord_user_id, discord_username, discord_global_name, "
    "discord_avatar, role, created_at, last_login_at"
)


class AdminError(Exception):
    """A refused staff action: an HTTP status, a stable code and the audit outcome."""

    def __init__(self, status: int, code: str, outcome: str):
        super().__init__(code)
        self.status = status
        self.code = code
        self.outcome = outcome


def clean_reason(reason: str | None) -> str:
    text = " ".join((reason or "").split())
    if not REASON_MIN <= len(text) <= REASON_MAX:
        raise AdminError(400, "reason_required", "invalid")
    return text


def _account_json(row) -> dict:
    """An account row with its times in the API form."""
    account = dict(row)
    for key in ("created_at", "last_login_at"):
        account[key] = api_time(account[key])
    return account


def _account(conn, user_id: int) -> dict | None:
    if not 0 < user_id <= _ID_MAX:
        return None
    row = conn.execute(f"SELECT {_ACCOUNT_COLUMNS} FROM users WHERE id = %s AND NOT placeholder",
                       (user_id,)).fetchone()
    return _account_json(row) if row else None


def _lock_accounts(conn, token: str | None, target_id: int) -> None:
    """Lock the actor's and the target's users rows, in id order, before anything reads them.

    Two staff acting on each other then run one after the other, and the second
    sees the first's change.
    """
    ids = {target_id} if 0 < target_id <= _ID_MAX else set()
    if token and len(token) <= _TOKEN_MAX:
        session = conn.execute("SELECT user_id FROM user_sessions WHERE token_hash = %s",
                               (hash_secret(token),)).fetchone()
        if session is not None:
            ids.add(session["user_id"])
    if ids:
        conn.execute("SELECT id FROM users WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (sorted(ids),))


def _staff_write(token: str, action: str, target_id: int, reason: str | None, apply) -> dict:
    """Run apply(conn, actor, target, reason) under the shared staff checks."""
    require_accounts()
    actor = target = None
    clean = None
    try:
        with database.transaction(lock=PLACEHOLDERS_LOCK) as conn:
            _lock_accounts(conn, token, target_id)
            actor = session_user_in(conn, token, lock=True)
            if actor is None:
                raise AdminError(401, "not_signed_in", "denied")
            if not roles.is_staff(actor["role"]):
                raise AdminError(403, "forbidden", "denied")
            clean = clean_reason(reason)
            target = _account(conn, target_id)
            if target is None:
                raise AdminError(404, "account_not_found", "not_found")
            if actor["user_id"] == target["user_id"]:
                raise AdminError(403, "cannot_act_on_self", "denied")
            if not roles.outranks(actor["role"], target["role"]):
                raise AdminError(403, "target_outranks_you", "denied")
            detail = apply(conn, actor, target, clean)
            audit.record(conn, actor=actor, action=action, outcome="ok", target=target,
                         reason=clean, detail=detail)
    except AdminError as exc:
        if actor is not None:
            audit.record_refusal(actor=actor, action=action, outcome=exc.outcome, target=target,
                                 reason=clean, detail={"error": exc.code, "target_user_id": target_id})
        raise
    return {"ok": True, **detail}


def change_role(token: str, target_id: int, new_role: str, reason: str | None) -> dict:
    def apply(conn, actor, target, _reason):
        if not roles.can(actor["role"], "change_role"):
            raise AdminError(403, "forbidden", "denied")
        if new_role not in roles.assignable_roles(actor["role"]):
            raise AdminError(403, "role_not_assignable", "denied")
        if new_role == target["role"]:
            raise AdminError(409, "role_unchanged", "conflict")
        conn.execute("UPDATE users SET role = %s WHERE id = %s", (new_role, target["user_id"]))
        # Live role checks already apply; signing out also stops open tabs
        # from carrying on with the old role's view.
        revoked = conn.execute(_REVOKE, (target["user_id"], target["user_id"])).rowcount
        drop_view_leftovers(conn)
        return {"before": target["role"], "after": new_role, "sessions_revoked": revoked}

    return _staff_write(token, "account.role.change", target_id, reason, apply)


def revoke_sessions(token: str, target_id: int, reason: str | None) -> dict:
    def apply(conn, actor, target, _reason):
        if not roles.can(actor["role"], "revoke_sessions"):
            raise AdminError(403, "forbidden", "denied")
        revoked = conn.execute(_REVOKE, (target["user_id"], target["user_id"])).rowcount
        drop_view_leftovers(conn)
        return {"sessions_revoked": revoked}

    return _staff_write(token, "account.sessions.revoke", target_id, reason, apply)


_ACCOUNTS = (
    "SELECT id AS user_id, discord_user_id, discord_username, discord_global_name, "
    "discord_avatar, role, created_at, last_login_at FROM users"
)


def _with_minecraft(rows) -> list[dict]:
    """Accounts with the Minecraft name of their Discord link, if any.

    Read-only view of the link: listing never expires graces or queues notices.
    """
    accounts = [_account_json(row) for row in rows]
    # PG-MIGRATION: until the Linking area converts, discord_links is in SQLite. Its PR
    # puts back the join: LEFT JOIN discord_links dl ON dl.discord_user_id = u.discord_user_id.
    names = {}
    ids = [a["discord_user_id"] for a in accounts]
    if ids:
        with sqlite_db.connect() as lite:
            names = {
                row["discord_user_id"]: row["minecraft_name"]
                for row in lite.execute(
                    "SELECT discord_user_id, minecraft_name FROM discord_links "
                    "WHERE discord_user_id IN (SELECT value FROM json_each(?))",
                    (json.dumps(ids),),
                )
            }
    return [{**a, "minecraft_name": names.get(a["discord_user_id"])} for a in accounts]


def list_staff() -> list[dict]:
    with database.connect() as conn:
        rows = conn.execute(
            f"{_ACCOUNTS} WHERE role IN ('mod', 'admin', 'root') "
            "ORDER BY CASE role WHEN 'root' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, "
            "lower(COALESCE(discord_username, discord_global_name, '')), id"
        ).fetchall()
    return _with_minecraft(rows)


def lookup(query: str) -> list[dict]:
    """Exact matches only: a Discord id, or a username or display name in any case."""
    text = (query or "").strip().lstrip("@")
    if not text or len(text) > _LOOKUP_MAX:
        return []
    with database.connect() as conn:
        rows = conn.execute(
            f"""
            {_ACCOUNTS}
            WHERE NOT placeholder AND (discord_user_id = %s OR lower(discord_username) = lower(%s)
               OR lower(discord_global_name) = lower(%s))
            ORDER BY id LIMIT %s
            """,
            (text, text, text, _LOOKUP_LIMIT),
        ).fetchall()
    return _with_minecraft(rows)
