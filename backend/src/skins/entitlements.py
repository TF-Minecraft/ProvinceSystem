"""ArmourShop skin-upload entitlements (colour, 3D budget, kinds, token cooldown)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.name_colours import MAX_NAME_COLOURS, effective_colour_cap

# Emergency BE fallback when catalog defaults were never synced (ops misconfig).
EMERGENCY_MAX_3D_PAIR_BYTES = 30720
DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS = -1


class PlayerMetaError(ValueError):
    """Invalid player-meta payload."""


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _nonneg_int(raw: Any, field: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as e:
        raise PlayerMetaError(f"{field} must be an integer") from e
    if value < 0:
        raise PlayerMetaError(f"{field} must be >= 0")
    return value


def _cooldown_days(raw: Any, field: str = "skin_token_cooldown_days") -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as e:
        raise PlayerMetaError(f"{field} must be an integer") from e
    if value < -1:
        raise PlayerMetaError(f"{field} must be >= -1")
    return value


def _normalize_skin_kinds(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as e:
            raise PlayerMetaError("skin_kinds must be a JSON array") from e
    if not isinstance(raw, list):
        raise PlayerMetaError("skin_kinds must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        kind = str(item or "").strip().lower()
        if not kind or kind in seen:
            continue
        seen.add(kind)
        out.append(kind)
    return out


def _as_bool(raw: Any, field: str) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(int(raw))
    if isinstance(raw, str):
        text = raw.strip().lower()
        if text in ("1", "true", "yes", "on"):
            return True
        if text in ("0", "false", "no", "off", ""):
            return False
    raise PlayerMetaError(f"{field} must be a boolean")


def catalog_entitlement_defaults(catalog: dict[str, Any] | None) -> dict[str, Any]:
    """Read defaults from catalog.entitlements; safe empty when missing."""
    empty = {
        "name_colour_stops": 0,
        "max_3d_pair_bytes": 0,
        "skin_token_cooldown_days": DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS,
        "skin_kinds": [],
        "allow_armor_3d_helmet": False,
    }
    entitlements = (catalog or {}).get("entitlements")
    if not isinstance(entitlements, dict):
        return empty
    defaults = entitlements.get("defaults")
    if not isinstance(defaults, dict):
        return empty
    stops = defaults.get("name_colour_stops")
    pair = defaults.get("max_3d_pair_bytes")
    try:
        stops_i = max(0, int(stops))
    except (TypeError, ValueError):
        stops_i = 0
    try:
        pair_i = max(0, int(pair))
    except (TypeError, ValueError):
        pair_i = 0
    try:
        cooldown = int(defaults.get("skin_token_cooldown_days"))
        if cooldown < -1:
            cooldown = DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS
    except (TypeError, ValueError):
        cooldown = DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS
    try:
        kinds = _normalize_skin_kinds(defaults.get("skin_kinds"))
    except PlayerMetaError:
        kinds = []
    allow = bool(defaults.get("allow_armor_3d_helmet"))
    return {
        "name_colour_stops": stops_i,
        "max_3d_pair_bytes": pair_i,
        "skin_token_cooldown_days": cooldown,
        "skin_kinds": kinds,
        "allow_armor_3d_helmet": allow,
    }


def get_player_meta(player_uuid: str) -> dict[str, Any] | None:
    from .db import connect

    uuid = (player_uuid or "").strip().lower()
    if not uuid:
        return None
    with connect() as conn:
        row = conn.execute(
            """
            SELECT name_colour_stops, max_3d_pair_bytes,
                   skin_token_cooldown_days, skin_kinds_json, allow_armor_3d_helmet
            FROM armourshop_player_meta
            WHERE LOWER(player_uuid) = ?
            """,
            (uuid,),
        ).fetchone()
    if row is None:
        return None
    stops = 0
    pair = 0
    if row["name_colour_stops"] is not None:
        try:
            stops = max(0, int(row["name_colour_stops"]))
        except (TypeError, ValueError):
            stops = 0
    if row["max_3d_pair_bytes"] is not None:
        try:
            pair = max(0, int(row["max_3d_pair_bytes"]))
        except (TypeError, ValueError):
            pair = 0
    try:
        cooldown = int(row["skin_token_cooldown_days"])
        if cooldown < -1:
            cooldown = DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS
    except (TypeError, ValueError, KeyError):
        cooldown = DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS
    try:
        kinds = _normalize_skin_kinds(row["skin_kinds_json"])
    except (PlayerMetaError, KeyError, TypeError):
        kinds = []
    try:
        allow = bool(int(row["allow_armor_3d_helmet"] or 0))
    except (TypeError, ValueError, KeyError):
        allow = False
    return {
        "name_colour_stops": stops,
        "max_3d_pair_bytes": pair,
        "skin_token_cooldown_days": cooldown,
        "skin_kinds": kinds,
        "allow_armor_3d_helmet": allow,
    }


def upsert_player_meta(raw: dict[str, Any]) -> dict[str, Any]:
    """Upsert ArmourShop player entitlements from plugin push."""
    from .db import connect

    if not isinstance(raw, dict):
        raise PlayerMetaError("body must be a JSON object")
    uuid = str(raw.get("player_uuid") or "").strip().lower()
    if not uuid:
        raise PlayerMetaError("player_uuid is required")
    stops = _nonneg_int(raw.get("name_colour_stops"), "name_colour_stops")
    pair = _nonneg_int(raw.get("max_3d_pair_bytes"), "max_3d_pair_bytes")
    cooldown = _cooldown_days(
        raw.get("skin_token_cooldown_days", DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS)
    )
    kinds = _normalize_skin_kinds(raw.get("skin_kinds"))
    allow = _as_bool(
        raw.get("allow_armor_3d_helmet", False), "allow_armor_3d_helmet"
    )
    kinds_json = json.dumps(kinds, separators=(",", ":"))
    updated_at = _iso_now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO armourshop_player_meta (
                player_uuid, name_colour_stops, max_3d_pair_bytes,
                skin_token_cooldown_days, skin_kinds_json, allow_armor_3d_helmet,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                name_colour_stops = excluded.name_colour_stops,
                max_3d_pair_bytes = excluded.max_3d_pair_bytes,
                skin_token_cooldown_days = excluded.skin_token_cooldown_days,
                skin_kinds_json = excluded.skin_kinds_json,
                allow_armor_3d_helmet = excluded.allow_armor_3d_helmet,
                updated_at = excluded.updated_at
            """,
            (
                uuid,
                stops,
                pair,
                cooldown,
                kinds_json,
                1 if allow else 0,
                updated_at,
            ),
        )
        conn.commit()
    return {
        "ok": True,
        "player_uuid": uuid,
        "name_colour_stops": stops,
        "max_3d_pair_bytes": pair,
        "skin_token_cooldown_days": cooldown,
        "skin_kinds": kinds,
        "allow_armor_3d_helmet": allow,
        "updated_at": updated_at,
    }


# Mirrors submissions.ALLOWED_KINDS (keep in sync for staff redeem UI).
_STAFF_SKIN_KINDS = (
    "armor_set",
    "handheld",
    "large_handheld",
    "bow",
    "large_bow",
    "crossbow",
    "item_3d",
    "shield",
    "helmet_3d",
    "mask",
    "gun",
    "book",
)


def resolve_skin_entitlements(
    player_uuid: str,
    *,
    staff: bool = False,
) -> dict[str, Any]:
    """
    Prefer armourshop_player_meta; else catalog defaults; else emergency pair bytes.
    Staff colour cap is MAX_NAME_COLOURS (8); 3D still uses meta/defaults.
    Staff redeem gets all kinds + armor 3D helmet; submit also bypasses gates.
    """
    from .catalog import get_catalog

    meta = get_player_meta(player_uuid)
    defaults = catalog_entitlement_defaults(get_catalog())

    if meta is not None:
        stops = meta["name_colour_stops"]
        pair = meta["max_3d_pair_bytes"]
        cooldown = meta["skin_token_cooldown_days"]
        kinds = list(meta["skin_kinds"])
        allow_helmet = bool(meta["allow_armor_3d_helmet"])
    else:
        stops = defaults["name_colour_stops"]
        pair = defaults["max_3d_pair_bytes"]
        cooldown = defaults["skin_token_cooldown_days"]
        kinds = list(defaults["skin_kinds"])
        allow_helmet = bool(defaults["allow_armor_3d_helmet"])

    if pair <= 0:
        pair = EMERGENCY_MAX_3D_PAIR_BYTES

    if staff:
        colour_cap = MAX_NAME_COLOURS
        kinds = list(_STAFF_SKIN_KINDS)
        allow_helmet = True
    else:
        colour_cap = effective_colour_cap(stops)

    return {
        "name_colour_stops": colour_cap,
        "max_3d_pair_bytes": pair,
        "skin_token_cooldown_days": int(cooldown),
        "skin_kinds": kinds,
        "allow_armor_3d_helmet": allow_helmet,
    }


def can_mint_skin_token(entitlements: dict[str, Any]) -> bool:
    try:
        return int(entitlements.get("skin_token_cooldown_days", -1)) >= 0
    except (TypeError, ValueError):
        return False
