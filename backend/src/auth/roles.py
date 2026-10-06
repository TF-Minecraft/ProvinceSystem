"""Website staff roles and what each may do. Unknown roles have no rights."""
from __future__ import annotations

ROLES = ("player", "mod", "admin", "root")
_RANK = {role: rank for rank, role in enumerate(ROLES)}

# Minimum role for each capability.
CAPABILITIES = {
    "view_admin": "mod",
    "view_players": "mod",
    "revoke_sessions": "mod",
    "change_role": "admin",
}


def rank(role: str | None) -> int:
    return _RANK.get(role or "", -1)


def is_staff(role: str | None) -> bool:
    return rank(role) >= rank("mod")


def can(role: str | None, capability: str) -> bool:
    return rank(role) >= rank(CAPABILITIES[capability])


def capabilities(role: str | None) -> list[str]:
    return [name for name in CAPABILITIES if can(role, name)]


def outranks(actor_role: str | None, target_role: str | None) -> bool:
    """Staff may only act on accounts strictly below their own role."""
    return rank(actor_role) > rank(target_role) >= 0


def assignable_roles(actor_role: str | None) -> list[str]:
    """Roles below the actor's own. Root is granted only by an operator."""
    if not can(actor_role, "change_role"):
        return []
    return [role for role in ROLES if role != "root" and rank(role) < rank(actor_role)]
