"""Staff operations on website accounts.

Every write reloads the actor's session and both roles inside one immediate
transaction, so a demotion or revocation that lands first always wins. The
change, the target's session revocation and the audit row commit together;
a refused attempt rolls back and is then logged on its own.
"""
from __future__ import annotations

from src.skins.db import connect

from . import audit, roles
from .users import session_user_in

REASON_MIN = 3
REASON_MAX = 500
_LOOKUP_MAX = 64
_LOOKUP_LIMIT = 5

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


def _account(conn, user_id: int) -> dict | None:
    row = conn.execute(f"SELECT {_ACCOUNT_COLUMNS} FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def _staff_write(token: str, action: str, target_id: int, reason: str | None, apply) -> dict:
    """Run apply(conn, actor, target, reason) under the shared staff checks."""
    actor = target = None
    clean = None
    try:
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                actor = session_user_in(conn, token)
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
                conn.commit()
            except BaseException:
                conn.rollback()
                raise
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
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, target["user_id"]))
        # Live role checks already apply; signing out also stops open tabs
        # from carrying on with the old role's view.
        revoked = conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (target["user_id"],)).rowcount
        return {"before": target["role"], "after": new_role, "sessions_revoked": revoked}

    return _staff_write(token, "account.role.change", target_id, reason, apply)


def revoke_sessions(token: str, target_id: int, reason: str | None) -> dict:
    def apply(conn, actor, target, _reason):
        if not roles.can(actor["role"], "revoke_sessions"):
            raise AdminError(403, "forbidden", "denied")
        revoked = conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (target["user_id"],)).rowcount
        return {"sessions_revoked": revoked}

    return _staff_write(token, "account.sessions.revoke", target_id, reason, apply)


# Read-only view of the Discord link: listing never expires graces or queues notices.
_WITH_MINECRAFT = (
    "SELECT u.id AS user_id, u.discord_user_id, u.discord_username, u.discord_global_name, "
    "u.discord_avatar, u.role, u.created_at, u.last_login_at, dl.minecraft_name "
    "FROM users u LEFT JOIN discord_links dl ON dl.discord_user_id = u.discord_user_id"
)


def list_staff() -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            f"{_WITH_MINECRAFT} WHERE u.role IN ('mod', 'admin', 'root') "
            "ORDER BY CASE u.role WHEN 'root' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, "
            "lower(COALESCE(u.discord_username, u.discord_global_name, '')), u.id"
        ).fetchall()
    return [dict(row) for row in rows]


def lookup(query: str) -> list[dict]:
    """Exact matches only: a Discord id, or a username or display name in any case."""
    text = (query or "").strip().lstrip("@")
    if not text or len(text) > _LOOKUP_MAX:
        return []
    with connect() as conn:
        rows = conn.execute(
            f"""
            {_WITH_MINECRAFT}
            WHERE u.discord_user_id = ? OR lower(u.discord_username) = lower(?)
               OR lower(u.discord_global_name) = lower(?)
            ORDER BY u.id LIMIT ?
            """,
            (text, text, text, _LOOKUP_LIMIT),
        ).fetchall()
    return [dict(row) for row in rows]
