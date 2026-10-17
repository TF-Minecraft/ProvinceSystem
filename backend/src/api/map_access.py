"""Map viewer access control (public vs staff-only maps)."""

from __future__ import annotations

import os

from fastapi import HTTPException

from src.api.map_registry import MapEntry, get_map_entry, list_map_entries
from src.characters.web_entitlements import has_map_staff_access
from src.skins.codes import REDEEMABLE_SKIN_SCOPES, get_session

STAFF_MAP_FORBIDDEN_DETAIL = "Staff map access required"
STAFF_MAP_PERMISSION_DETAIL = "Staff map permission required"
EDITOR_STAFF_PERMISSION = "tfmc.map.staff"
UI_DEV_SESSION_TOKEN = "ui-dev-session"


def is_character_ui_dev() -> bool:
    return os.environ.get("CHARACTER_UI_DEV", "").strip() == "1"


def _is_ui_dev_session_token(token: str | None) -> bool:
    return bool(token) and token == UI_DEV_SESSION_TOKEN


def _ui_dev_staff_bypass(authorization: str | None) -> bool:
    if not is_character_ui_dev():
        return False
    return _is_ui_dev_session_token(parse_bearer(authorization))


def _ui_dev_profile_session() -> dict:
    return {
        "scope": "profile",
        "player_uuid": "ui-dev-player",
        "realm_id": "main",
    }


def parse_bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    return token or None


def get_skin_session(header_value: str | None) -> dict | None:
    """Bearer skin or skin_staff session from X-Skin-Session (or Authorization-shaped value)."""
    token = parse_bearer(header_value)
    if not token:
        return None
    row = get_session(token)
    if row is None:
        return None
    scope = str(row.get("scope") or "").strip().lower()
    if scope not in REDEEMABLE_SKIN_SCOPES:
        return None
    return row


def get_profile_session(authorization: str | None) -> dict | None:
    token = parse_bearer(authorization)
    if not token:
        return None

    if is_character_ui_dev() and _is_ui_dev_session_token(token):
        return _ui_dev_profile_session()

    row = get_session(token)
    if row is None:
        return None

    scope = str(row.get("scope") or "").strip().lower()
    if scope != "profile":
        return None

    return row


def get_character_session(authorization: str | None) -> dict | None:
    """Back-compat alias for profile session checks."""
    return get_profile_session(authorization)


def get_feature_session(authorization: str | None) -> dict | None:
    """Any valid skins/drinks/profile Bearer session."""
    token = parse_bearer(authorization)
    if not token:
        return None
    if is_character_ui_dev() and _is_ui_dev_session_token(token):
        return _ui_dev_profile_session()
    return get_session(token)


def require_site_staff(authorization: str | None) -> dict:
    if _ui_dev_staff_bypass(authorization):
        return _ui_dev_profile_session()
    session = get_feature_session(authorization)
    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization Bearer token",
        )
    if not has_map_staff_access(
        str(session.get("player_uuid") or ""),
        _session_realm_id(session),
        EDITOR_STAFF_PERMISSION,
    ):
        raise HTTPException(status_code=403, detail=STAFF_MAP_PERMISSION_DETAIL)
    return session


def _session_realm_id(session: dict) -> str:
    return str(session.get("realm_id") or "main").strip().lower() or "main"


def _map_staff_allowed(session: dict, map_entry: MapEntry) -> bool:
    permission = (map_entry.staff_permission or "").strip()
    if not permission:
        return False
    return has_map_staff_access(
        str(session.get("player_uuid") or ""),
        _session_realm_id(session),
        permission,
    )


def ensure_map_access(map_id: str, authorization: str | None) -> MapEntry:
    entry = get_map_entry(map_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Map not found")

    if entry.public:
        return entry

    if _ui_dev_staff_bypass(authorization):
        return entry

    session = get_character_session(authorization)
    if session is None:
        raise HTTPException(status_code=403, detail=STAFF_MAP_FORBIDDEN_DETAIL)

    if not _map_staff_allowed(session, entry):
        raise HTTPException(status_code=403, detail=STAFF_MAP_PERMISSION_DETAIL)

    return entry


def ensure_map_staff_write(map_id: str, authorization: str | None) -> MapEntry:
    """Gate for destructive per-map staff writes (title editor, chronicle wipe).

    Two things this deliberately does *not* do, unlike the read gate:

    * it honours the map's own `staff_permission` and `realm_id` rather than
      only the global `EDITOR_STAFF_PERMISSION` against the session's realm, so
      a map that is guarded by a narrower node for reads cannot be wiped by
      someone who only holds the broad one; and
    * it does not accept the `CHARACTER_UI_DEV` bearer bypass. That bypass
      exists so the UI can be developed against staff-only *reads* without a
      real session. The token it looks for (`ui-dev-session`) is a literal
      constant in this repo, not a secret, so honouring it here would put
      chronicle wipe/restore behind an env var and stamp the audit row with a
      literal "ui-dev" actor rather than a person. To exercise the staff UI
      locally, temporarily drop the rejection below rather than widening it in
      a way that could ship.
    """
    entry = get_map_entry(map_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Map not found")

    if _is_ui_dev_session_token(parse_bearer(authorization)):
        raise HTTPException(status_code=403, detail=STAFF_MAP_FORBIDDEN_DETAIL)

    session = get_character_session(authorization)
    if session is None:
        raise HTTPException(status_code=403, detail=STAFF_MAP_FORBIDDEN_DETAIL)

    permission = (entry.staff_permission or "").strip() or EDITOR_STAFF_PERMISSION
    if not has_map_staff_access(
        str(session.get("player_uuid") or ""),
        entry.realm_id,
        permission,
    ):
        raise HTTPException(status_code=403, detail=STAFF_MAP_PERMISSION_DETAIL)

    return entry


def list_accessible_maps(authorization: str | None) -> list[MapEntry]:
    session = get_character_session(authorization)
    out: list[MapEntry] = []
    for entry in list_map_entries():
        if entry.public:
            out.append(entry)
            continue
        if _ui_dev_staff_bypass(authorization):
            out.append(entry)
            continue
        if session is not None and _map_staff_allowed(session, entry):
            out.append(entry)
    return out
