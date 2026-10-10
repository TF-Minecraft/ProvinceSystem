"""Website staff roles and what each may do. Unknown roles have no rights."""
from __future__ import annotations

ROLES = ("player", "mod", "admin", "root")
_RANK = {role: rank for rank, role in enumerate(ROLES)}

# Minimum role for each capability.
CAPABILITIES = {
    "view_admin": "mod",
    "view_players": "mod",
    # Chat and whole commands in a player's activity; every view is audited.
    "view_player_messages": "admin",
    # Where players went, minute by minute; every view is audited.
    "view_player_movement": "admin",
    # The rail network as VehicleFramework saved it.
    "view_rail": "admin",
    "revoke_sessions": "mod",
    "change_role": "admin",
    # In-game LuckPerms ranks: everyone on staff sees them; what an admin may
    # change, beyond viewing, is decided per node by src/luckperms/policy.py.
    "view_luckperms": "mod",
    "change_luckperms": "admin",
    # Moderation case log; the Discord bot reaches it with its own key.
    "use_precedent": "mod",
    # Read-only lookup of skin and drink codes.
    "inspect_codes": "mod",
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
    """Staff may only act on accounts below their own role; root may also act on other roots."""
    if actor_role == "root" and target_role == "root":
        return True
    return rank(actor_role) > rank(target_role) >= 0


def assignable_roles(actor_role: str | None) -> list[str]:
    """Roles below the actor's own; root may give any role, root included."""
    if not can(actor_role, "change_role"):
        return []
    if actor_role == "root":
        return list(ROLES)
    return [role for role in ROLES if rank(role) < rank(actor_role)]
