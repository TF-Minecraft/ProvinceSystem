"""Unified web entitlements (TFMCWeb join sync → rpc_player_meta)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.name_colours import MAX_NAME_COLOURS, effective_colour_cap

# Mirrors skins.entitlements._STAFF_SKIN_KINDS / submissions.ALLOWED_KINDS.
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

EMERGENCY_MAX_3D_PAIR_BYTES = 30720
DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS = -1


class RpcPlayerMetaError(ValueError):
    """Invalid rpc_player_meta payload."""


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_realm(realm_id: str | None) -> str:
    from src.skins.codes import CodeError, normalize_realm_id

    try:
        return normalize_realm_id(realm_id)
    except CodeError as e:
        raise RpcPlayerMetaError(str(e)) from e


def _nonneg_int(raw: Any, field: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as e:
        raise RpcPlayerMetaError(f"{field} must be an integer") from e
    if value < 0:
        raise RpcPlayerMetaError(f"{field} must be >= 0")
    return value


def _cooldown_days(raw: Any, field: str = "skin_token_cooldown_days") -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as e:
        raise RpcPlayerMetaError(f"{field} must be an integer") from e
    if value < -1:
        raise RpcPlayerMetaError(f"{field} must be >= -1")
    return value


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
    raise RpcPlayerMetaError(f"{field} must be a boolean")


def _normalize_skin_kinds(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as e:
            raise RpcPlayerMetaError("skin_kinds must be a JSON array") from e
    if not isinstance(raw, list):
        raise RpcPlayerMetaError("skin_kinds must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        kind = str(item or "").strip().lower()
        if not kind or kind in seen:
            continue
        seen.add(kind)
        out.append(kind)
    return out


def _normalize_permission_flags(raw: Any) -> dict[str, bool]:
    if raw is None:
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as e:
            raise RpcPlayerMetaError(
                "permission_flags must be a JSON object"
            ) from e
    if not isinstance(raw, dict):
        raise RpcPlayerMetaError("permission_flags must be an object")
    out: dict[str, bool] = {}
    for key, value in raw.items():
        node = str(key or "").strip()
        if not node:
            continue
        try:
            out[node] = _as_bool(value, f"permission_flags[{node}]")
        except RpcPlayerMetaError:
            out[node] = bool(value)
    return out


def _empty_entitlements(*, realm_id: str = "main") -> dict[str, Any]:
    return {
        "name_colour_stops": 0,
        "allow_drink_texture": False,
        "allow_drink_message": False,
        "max_alive_characters": None,
        "wardrobe_skin_slots": 1,
        "max_3d_pair_bytes": EMERGENCY_MAX_3D_PAIR_BYTES,
        "skin_token_cooldown_days": DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS,
        "skin_kinds": [],
        "allow_armor_3d_helmet": False,
        "permission_flags": {},
        "meta_synced": False,
        "donator_tier": 0,
        "realm_id": realm_id,
    }


def get_rpc_player_meta(
    player_uuid: str,
    realm_id: str | None = None,
) -> dict[str, Any] | None:
    from src.skins.db import connect

    uuid = (player_uuid or "").strip().lower()
    if not uuid:
        return None
    realm = _normalize_realm(realm_id)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT player_uuid, realm_id, name_colour_stops, allow_drink_texture,
                   allow_drink_message, max_alive_characters, wardrobe_skin_slots, max_3d_pair_bytes,
                   skin_token_cooldown_days, skin_kinds_json,
                   allow_armor_3d_helmet, permission_flags_json, donator_tier, updated_at
            FROM rpc_player_meta
            WHERE LOWER(player_uuid) = ? AND realm_id = ?
            """,
            (uuid, realm),
        ).fetchone()
    if row is None:
        return None
    return _row_to_dict(row)


def has_map_staff_access(
    player_uuid: str,
    realm_id: str | None,
    permission_node: str,
) -> bool:
    """True when synced rpc_player_meta has permission_node in permission_flags."""
    node = (permission_node or "").strip()
    if not node:
        return False

    uuid = (player_uuid or "").strip().lower()
    if not uuid:
        return False

    meta = get_rpc_player_meta(uuid, realm_id)
    if meta is None:
        return False

    flags = meta.get("permission_flags") or {}
    if not isinstance(flags, dict):
        return False

    return bool(flags.get(node))


def _row_to_dict(row: Any) -> dict[str, Any]:
    stops = 0
    if row["name_colour_stops"] is not None:
        try:
            stops = max(0, int(row["name_colour_stops"]))
        except (TypeError, ValueError):
            stops = 0
    allow_texture = False
    try:
        allow_texture = bool(int(row["allow_drink_texture"] or 0))
    except (TypeError, ValueError):
        allow_texture = False
    allow_message = False
    try:
        allow_message = bool(int(row["allow_drink_message"] or 0))
    except (TypeError, ValueError, KeyError):
        allow_message = False
    max_alive = None
    if row["max_alive_characters"] is not None:
        try:
            max_alive = max(1, int(row["max_alive_characters"]))
        except (TypeError, ValueError):
            max_alive = None
    wardrobe_slots = 1
    try:
        wardrobe_slots = max(1, min(3, int(row["wardrobe_skin_slots"] or 1)))
    except (TypeError, ValueError):
        wardrobe_slots = 1
    pair = EMERGENCY_MAX_3D_PAIR_BYTES
    try:
        pair = max(0, int(row["max_3d_pair_bytes"] or 0))
    except (TypeError, ValueError):
        pair = EMERGENCY_MAX_3D_PAIR_BYTES
    if pair <= 0:
        pair = EMERGENCY_MAX_3D_PAIR_BYTES
    try:
        cooldown = int(row["skin_token_cooldown_days"])
        if cooldown < -1:
            cooldown = DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS
    except (TypeError, ValueError, KeyError):
        cooldown = DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS
    try:
        kinds = _normalize_skin_kinds(row["skin_kinds_json"])
    except (RpcPlayerMetaError, KeyError, TypeError):
        kinds = []
    try:
        allow_helmet = bool(int(row["allow_armor_3d_helmet"] or 0))
    except (TypeError, ValueError, KeyError):
        allow_helmet = False
    try:
        flags = _normalize_permission_flags(row["permission_flags_json"])
    except (RpcPlayerMetaError, KeyError, TypeError):
        flags = {}
    donator_tier = 0
    try:
        if row["donator_tier"] is not None:
            donator_tier = max(0, int(row["donator_tier"]))
    except (TypeError, ValueError, KeyError):
        donator_tier = 0
    realm = "main"
    try:
        raw_realm = row["realm_id"]
        if raw_realm is not None and str(raw_realm).strip():
            realm = str(raw_realm).strip().lower()
    except (KeyError, IndexError, TypeError):
        pass
    return {
        "player_uuid": str(row["player_uuid"]),
        "realm_id": realm,
        "name_colour_stops": effective_colour_cap(stops),
        "allow_drink_texture": allow_texture,
        "allow_drink_message": allow_message,
        "max_alive_characters": max_alive,
        "wardrobe_skin_slots": wardrobe_slots,
        "max_3d_pair_bytes": pair,
        "skin_token_cooldown_days": cooldown,
        "skin_kinds": kinds,
        "allow_armor_3d_helmet": allow_helmet,
        "permission_flags": flags,
        "donator_tier": donator_tier,
        "updated_at": str(row["updated_at"] or ""),
        "meta_synced": True,
    }


def upsert_rpc_player_meta(raw: dict[str, Any]) -> dict[str, Any]:
    """Upsert TFMCWeb-resolved web entitlements for a player."""
    from src.skins.db import connect

    if not isinstance(raw, dict):
        raise RpcPlayerMetaError("body must be a JSON object")
    uuid = str(raw.get("player_uuid") or "").strip().lower()
    if not uuid:
        raise RpcPlayerMetaError("player_uuid is required")
    realm = _normalize_realm(raw.get("realm_id"))

    stops = effective_colour_cap(
        _nonneg_int(raw.get("name_colour_stops", 0), "name_colour_stops")
    )
    allow_texture = _as_bool(
        raw.get("allow_drink_texture", False), "allow_drink_texture"
    )
    allow_message = _as_bool(
        raw.get("allow_drink_message", False), "allow_drink_message"
    )
    max_alive_raw = raw.get("max_alive_characters")
    max_alive: int | None
    if max_alive_raw is None:
        max_alive = None
    else:
        max_alive = max(1, _nonneg_int(max_alive_raw, "max_alive_characters"))
    wardrobe_slots = max(
        1,
        min(3, _nonneg_int(raw.get("wardrobe_skin_slots", 1), "wardrobe_skin_slots")),
    )
    pair = _nonneg_int(raw.get("max_3d_pair_bytes", 0), "max_3d_pair_bytes")
    cooldown = _cooldown_days(
        raw.get("skin_token_cooldown_days", DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS)
    )
    kinds = _normalize_skin_kinds(raw.get("skin_kinds"))
    allow_helmet = _as_bool(
        raw.get("allow_armor_3d_helmet", False), "allow_armor_3d_helmet"
    )
    flags = _normalize_permission_flags(raw.get("permission_flags"))
    donator_tier = 0
    if raw.get("donator_tier") is not None:
        donator_tier = _nonneg_int(raw.get("donator_tier"), "donator_tier")
    kinds_json = json.dumps(kinds, separators=(",", ":"))
    flags_json = json.dumps(flags, separators=(",", ":"), sort_keys=True)
    updated_at = _iso_now()

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO rpc_player_meta (
                player_uuid, realm_id, name_colour_stops, allow_drink_texture,
                allow_drink_message, max_alive_characters, wardrobe_skin_slots,
                max_3d_pair_bytes, skin_token_cooldown_days, skin_kinds_json,
                allow_armor_3d_helmet, permission_flags_json, donator_tier, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_uuid, realm_id) DO UPDATE SET
                name_colour_stops = excluded.name_colour_stops,
                allow_drink_texture = excluded.allow_drink_texture,
                allow_drink_message = excluded.allow_drink_message,
                max_alive_characters = excluded.max_alive_characters,
                wardrobe_skin_slots = excluded.wardrobe_skin_slots,
                max_3d_pair_bytes = excluded.max_3d_pair_bytes,
                skin_token_cooldown_days = excluded.skin_token_cooldown_days,
                skin_kinds_json = excluded.skin_kinds_json,
                allow_armor_3d_helmet = excluded.allow_armor_3d_helmet,
                permission_flags_json = excluded.permission_flags_json,
                donator_tier = excluded.donator_tier,
                updated_at = excluded.updated_at
            """,
            (
                uuid,
                realm,
                stops,
                1 if allow_texture else 0,
                1 if allow_message else 0,
                max_alive,
                wardrobe_slots,
                pair,
                cooldown,
                kinds_json,
                1 if allow_helmet else 0,
                flags_json,
                donator_tier,
                updated_at,
            ),
        )
        conn.commit()

    return {
        "ok": True,
        "player_uuid": uuid,
        "realm_id": realm,
        "name_colour_stops": stops,
        "allow_drink_texture": allow_texture,
        "allow_drink_message": allow_message,
        "max_alive_characters": max_alive,
        "wardrobe_skin_slots": wardrobe_slots,
        "max_3d_pair_bytes": pair,
        "skin_token_cooldown_days": cooldown,
        "skin_kinds": kinds,
        "allow_armor_3d_helmet": allow_helmet,
        "permission_flags": flags,
        "donator_tier": donator_tier,
        "updated_at": updated_at,
        "meta_synced": True,
    }


def _legacy_fallback(player_uuid: str, *, realm_id: str = "main") -> dict[str, Any]:
    """Merge drink / armourshop / character meta when rpc_player_meta is empty."""
    from src.characters.roster import get_player_meta as get_character_meta
    from src.skins.drinks import get_allow_drink_texture, get_drink_name_colour_stops
    from src.skins.entitlements import get_player_meta as get_armourshop_meta

    out = _empty_entitlements(realm_id=realm_id)
    stops = 0

    try:
        stops = max(stops, int(get_drink_name_colour_stops(player_uuid) or 0))
    except Exception:
        pass
    try:
        out["allow_drink_texture"] = bool(get_allow_drink_texture(player_uuid))
    except Exception:
        pass

    as_meta = None
    try:
        as_meta = get_armourshop_meta(player_uuid)
    except Exception:
        as_meta = None
    if as_meta:
        stops = max(stops, int(as_meta.get("name_colour_stops") or 0))
        out["max_3d_pair_bytes"] = max(
            0, int(as_meta.get("max_3d_pair_bytes") or 0)
        ) or EMERGENCY_MAX_3D_PAIR_BYTES
        out["skin_token_cooldown_days"] = int(
            as_meta.get("skin_token_cooldown_days", DEFAULT_SKIN_TOKEN_COOLDOWN_DAYS)
        )
        out["skin_kinds"] = list(as_meta.get("skin_kinds") or [])
        out["allow_armor_3d_helmet"] = bool(as_meta.get("allow_armor_3d_helmet"))

    char_meta = get_character_meta(player_uuid)
    stops = max(stops, int(char_meta.get("name_colour_stops") or 0))
    if char_meta.get("max_alive_characters") is not None:
        try:
            out["max_alive_characters"] = max(
                1, int(char_meta["max_alive_characters"])
            )
        except (TypeError, ValueError):
            pass
    try:
        out["wardrobe_skin_slots"] = max(
            1, min(3, int(char_meta.get("wardrobe_skin_slots") or 1))
        )
    except (TypeError, ValueError):
        out["wardrobe_skin_slots"] = 1

    out["name_colour_stops"] = effective_colour_cap(stops)
    if out["max_3d_pair_bytes"] <= 0:
        out["max_3d_pair_bytes"] = EMERGENCY_MAX_3D_PAIR_BYTES
    out["meta_synced"] = False
    return out


def resolve_web_entitlements(
    player_uuid: str,
    *,
    staff: bool = False,
    realm_id: str | None = None,
) -> dict[str, Any]:
    """
    Primary reader for website gates.
    Prefer rpc_player_meta for (uuid, realm); legacy merge only for main when
    the row is missing. Staff overrides skin caps/kinds.
    """
    uuid = (player_uuid or "").strip().lower()
    try:
        realm = _normalize_realm(realm_id)
    except RpcPlayerMetaError:
        realm = "main"
    if not uuid:
        out = _empty_entitlements(realm_id=realm)
    else:
        row = get_rpc_player_meta(uuid, realm)
        if row is not None:
            out = {
                "name_colour_stops": int(row["name_colour_stops"]),
                "allow_drink_texture": bool(row["allow_drink_texture"]),
                "allow_drink_message": bool(row.get("allow_drink_message", False)),
                "max_alive_characters": row["max_alive_characters"],
                "wardrobe_skin_slots": int(row["wardrobe_skin_slots"]),
                "max_3d_pair_bytes": int(row["max_3d_pair_bytes"]),
                "skin_token_cooldown_days": int(row["skin_token_cooldown_days"]),
                "skin_kinds": list(row["skin_kinds"]),
                "allow_armor_3d_helmet": bool(row["allow_armor_3d_helmet"]),
                "permission_flags": dict(row["permission_flags"]),
                "meta_synced": True,
                "donator_tier": int(row.get("donator_tier") or 0),
                "realm_id": realm,
            }
        elif realm == "main":
            out = _legacy_fallback(uuid, realm_id=realm)
        else:
            out = _empty_entitlements(realm_id=realm)

    if out["max_3d_pair_bytes"] <= 0:
        out["max_3d_pair_bytes"] = EMERGENCY_MAX_3D_PAIR_BYTES

    if staff:
        out["name_colour_stops"] = MAX_NAME_COLOURS
        out["skin_kinds"] = list(_STAFF_SKIN_KINDS)
        out["allow_armor_3d_helmet"] = True
    else:
        out["name_colour_stops"] = effective_colour_cap(
            int(out.get("name_colour_stops") or 0)
        )

    out["realm_id"] = realm
    if "donator_tier" not in out:
        out["donator_tier"] = 0
    return out
