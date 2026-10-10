"""Staff checks for staff panel tools served outside /admin.

Same rule as the staff panel: the caller's website role, from the Discord
session cookie. Writes also need the site's own origin.
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from src.api.auth_routes import _config, current_user, require_same_origin
from src.auth import roles
from src.skins.discord_link import get_link_for_discord_id


def require_staff_account(request: Request, capability: str, *, write: bool = False) -> dict:
    config = _config()
    if write:
        require_same_origin(request, config)
    user = current_user(request, config)
    if not roles.can(user["role"], capability):
        raise HTTPException(403, detail="forbidden")
    return user


def staff_name(user: dict) -> tuple[str, str]:
    """(name, player UUID) to record for a staff member: their linked Minecraft
    player when they have one, otherwise their Discord username."""
    link = get_link_for_discord_id(str(user.get("discord_user_id") or ""))
    uuid = str((link or {}).get("player_uuid") or "").strip()
    name = str((link or {}).get("minecraft_name") or "").strip()
    discord = str(user.get("discord_username") or user.get("discord_global_name") or "").strip()
    return name or discord or f"account {user.get('user_id')}", uuid
