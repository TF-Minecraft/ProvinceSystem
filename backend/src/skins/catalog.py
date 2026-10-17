"""ArmourShop catalog snapshot (categories + scrolls) for website dropdowns."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


class CatalogError(ValueError):
    """Invalid catalog payload."""


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_payload(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise CatalogError("body must be a JSON object")

    categories_in = raw.get("categories")
    scrolls_in = raw.get("scrolls")
    if not isinstance(categories_in, list):
        raise CatalogError("categories must be a list")
    if not isinstance(scrolls_in, list):
        raise CatalogError("scrolls must be a list")

    categories: list[dict[str, Any]] = []
    for i, row in enumerate(categories_in):
        if not isinstance(row, dict):
            raise CatalogError(f"categories[{i}] must be an object")
        cid = str(row.get("id") or "").strip()
        if not cid:
            raise CatalogError(f"categories[{i}].id is required")
        name = str(row.get("name") or cid).strip() or cid
        is_item = bool(row.get("is_item", False))
        sets_in = row.get("skin_sets")
        if sets_in is None:
            sets_in = []
        if not isinstance(sets_in, list):
            raise CatalogError(f"categories[{i}].skin_sets must be a list")
        skin_sets: list[str] = []
        for j, sid in enumerate(sets_in):
            s = str(sid or "").strip()
            if not s:
                raise CatalogError(f"categories[{i}].skin_sets[{j}] is empty")
            skin_sets.append(s)
        categories.append(
            {
                "id": cid,
                "name": name,
                "is_item": is_item,
                "skin_sets": skin_sets,
            }
        )

    scrolls: list[dict[str, str]] = []
    for i, row in enumerate(scrolls_in):
        if not isinstance(row, dict):
            raise CatalogError(f"scrolls[{i}] must be an object")
        sid = str(row.get("id") or "").strip()
        if not sid:
            raise CatalogError(f"scrolls[{i}].id is required")
        label = str(row.get("label") or sid).strip() or sid
        scrolls.append({"id": sid, "label": label})

    entitlements = _normalize_entitlements(raw.get("entitlements"))
    return {
        "categories": categories,
        "scrolls": scrolls,
        "entitlements": entitlements,
    }


def _normalize_entitlements(raw: Any) -> dict[str, Any]:
    """Optional entitlements block from ArmourShop permission-groups sync."""
    empty = {
        "defaults": {
            "name_colour_stops": 0,
            "max_3d_pair_bytes": 0,
            "skin_token_cooldown_days": -1,
            "skin_kinds": [],
            "allow_armor_3d_helmet": False,
        },
        "groups": [],
    }
    if raw is None:
        return empty
    if not isinstance(raw, dict):
        raise CatalogError("entitlements must be an object")

    defaults_in = raw.get("defaults")
    if defaults_in is None:
        defaults_in = {}
    if not isinstance(defaults_in, dict):
        raise CatalogError("entitlements.defaults must be an object")

    def _int_field(
        obj: dict[str, Any],
        key: str,
        default: int = 0,
        *,
        min_value: int = 0,
    ) -> int:
        if key not in obj or obj[key] is None:
            return default
        try:
            value = int(obj[key])
        except (TypeError, ValueError) as e:
            raise CatalogError(f"entitlements field '{key}' must be an integer") from e
        if value < min_value:
            raise CatalogError(
                f"entitlements field '{key}' must be >= {min_value}"
            )
        return value

    def _kinds_field(obj: dict[str, Any], key: str = "skin_kinds") -> list[str]:
        raw_kinds = obj.get(key)
        if raw_kinds is None:
            return []
        if not isinstance(raw_kinds, list):
            raise CatalogError(f"entitlements field '{key}' must be a list")
        out: list[str] = []
        seen: set[str] = set()
        for item in raw_kinds:
            kind = str(item or "").strip().lower()
            if not kind or kind in seen:
                continue
            seen.add(kind)
            out.append(kind)
        return out

    def _bool_field(
        obj: dict[str, Any], key: str, default: bool = False
    ) -> bool:
        if key not in obj or obj[key] is None:
            return default
        value = obj[key]
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(int(value))
        if isinstance(value, str):
            text = value.strip().lower()
            if text in ("1", "true", "yes", "on"):
                return True
            if text in ("0", "false", "no", "off", ""):
                return False
        raise CatalogError(f"entitlements field '{key}' must be a boolean")

    defaults = {
        "name_colour_stops": _int_field(defaults_in, "name_colour_stops"),
        "max_3d_pair_bytes": _int_field(defaults_in, "max_3d_pair_bytes"),
        "skin_token_cooldown_days": _int_field(
            defaults_in,
            "skin_token_cooldown_days",
            -1,
            min_value=-1,
        ),
        "skin_kinds": _kinds_field(defaults_in),
        "allow_armor_3d_helmet": _bool_field(
            defaults_in, "allow_armor_3d_helmet", False
        ),
    }

    groups_in = raw.get("groups")
    if groups_in is None:
        groups_in = []
    if not isinstance(groups_in, list):
        raise CatalogError("entitlements.groups must be a list")

    groups: list[dict[str, Any]] = []
    for i, row in enumerate(groups_in):
        if not isinstance(row, dict):
            raise CatalogError(f"entitlements.groups[{i}] must be an object")
        gid = str(row.get("id") or "").strip()
        if not gid:
            raise CatalogError(f"entitlements.groups[{i}].id is required")
        try:
            tier = int(row.get("tier", i))
        except (TypeError, ValueError) as e:
            raise CatalogError(
                f"entitlements.groups[{i}].tier must be an integer"
            ) from e
        groups.append(
            {
                "id": gid,
                "tier": tier,
                "permission": str(row.get("permission") or "").strip(),
                "display_name": str(row.get("display_name") or gid).strip() or gid,
                "name_colour_stops": _int_field(
                    row, "name_colour_stops", defaults["name_colour_stops"]
                ),
                "max_3d_pair_bytes": _int_field(
                    row, "max_3d_pair_bytes", defaults["max_3d_pair_bytes"]
                ),
                "skin_token_cooldown_days": _int_field(
                    row,
                    "skin_token_cooldown_days",
                    defaults["skin_token_cooldown_days"],
                    min_value=-1,
                ),
                "skin_kinds": _kinds_field(row),
                "allow_armor_3d_helmet": _bool_field(
                    row,
                    "allow_armor_3d_helmet",
                    defaults["allow_armor_3d_helmet"],
                ),
            }
        )

    return {"defaults": defaults, "groups": groups}


def replace_catalog(raw: dict[str, Any]) -> dict[str, Any]:
    """Full-replace catalog snapshot. Returns payload + updated_at + counts."""
    from src import database

    from .codes import _parse_iso

    payload = _normalize_payload(raw)
    updated_at = _iso_now()

    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO armourshop_catalog (id, payload, updated_at)
            VALUES (1, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            (database.Jsonb(payload), _parse_iso(updated_at)),
        )

    skin_sets = sum(len(c["skin_sets"]) for c in payload["categories"])
    return {
        **payload,
        "updated_at": updated_at,
        "categories_count": len(payload["categories"]),
        "skin_sets_count": skin_sets,
        "scrolls_count": len(payload["scrolls"]),
    }


def get_catalog() -> dict[str, Any]:
    """Return stored snapshot or empty catalog."""
    from src import database

    from .codes import api_time

    with database.connect() as conn:
        row = conn.execute(
            "SELECT payload, updated_at FROM armourshop_catalog WHERE id = 1"
        ).fetchone()

    if row is None:
        return {
            "categories": [],
            "scrolls": [],
            "entitlements": {
                "defaults": {"name_colour_stops": 0, "max_3d_pair_bytes": 0},
                "groups": [],
            },
            "updated_at": None,
        }

    data = row["payload"]
    if not isinstance(data, dict):
        data = {}

    categories = data.get("categories")
    scrolls = data.get("scrolls")
    if not isinstance(categories, list):
        categories = []
    if not isinstance(scrolls, list):
        scrolls = []

    try:
        entitlements = _normalize_entitlements(data.get("entitlements"))
    except CatalogError:
        entitlements = {
            "defaults": {"name_colour_stops": 0, "max_3d_pair_bytes": 0},
            "groups": [],
        }

    return {
        "categories": categories,
        "scrolls": scrolls,
        "entitlements": entitlements,
        "updated_at": api_time(row["updated_at"]),
    }


IA_NAMESPACE_ARMOURSHOP = "tfmc_armorshop"


def require_synced_catalog() -> dict[str, Any]:
    """Return catalog or raise if ArmourShop has not pushed yet."""
    catalog = get_catalog()
    categories = catalog.get("categories") or []
    scrolls = catalog.get("scrolls") or []
    if not categories or not scrolls:
        raise CatalogError("catalog not synced")
    return catalog


def require_category(catalog: dict[str, Any], category_id: str) -> dict[str, Any]:
    cid = (category_id or "").strip()
    if not cid:
        raise CatalogError("category is required")
    for row in catalog.get("categories") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "").strip() == cid:
            return row
    raise CatalogError(f"unknown category '{cid}'")


def require_scroll(catalog: dict[str, Any], scroll_id: str) -> str:
    sid = (scroll_id or "").strip()
    if not sid:
        raise CatalogError("scroll is required")
    for row in catalog.get("scrolls") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "").strip() == sid:
            return sid
    raise CatalogError(f"unknown scroll '{sid}'")


def skin_set_exists(category: dict[str, Any], key: str) -> bool:
    needle = (key or "").strip()
    if not needle:
        return False
    sets = category.get("skin_sets") or []
    if not isinstance(sets, list):
        return False
    for sid in sets:
        if str(sid or "").strip() == needle:
            return True
    return False


def validate_staff_landing(
    *,
    category: str | None,
    scroll: str | None,
    tier_scrolls: dict[str, str] | None,
    kind: str,
    tiers: list[str] | None,
    slug: str,
) -> dict[str, Any]:
    """Validate staff category/scroll fields against catalog; reject collisions."""
    catalog = require_synced_catalog()
    cat = require_category(catalog, category or "")

    if kind == "armor_set":
        if scroll and str(scroll).strip():
            raise CatalogError(
                "scroll is not allowed for armor_set; use tier_scrolls"
            )
        if not tier_scrolls:
            raise CatalogError(
                "tier_scrolls is required for staff armor_set"
            )
        if not isinstance(tier_scrolls, dict):
            raise CatalogError("tier_scrolls must be a JSON object")
        tier_list = list(tiers or [])
        if not tier_list:
            raise CatalogError("armor_set requires tiers for staff scrolls")
        normalized: dict[str, str] = {}
        for tier in tier_list:
            raw = tier_scrolls.get(tier)
            if raw is None or not str(raw).strip():
                raise CatalogError(
                    f"tier_scrolls missing scroll for tier '{tier}'"
                )
            normalized[tier] = require_scroll(catalog, str(raw))
        for extra in tier_scrolls:
            if extra not in tier_list:
                raise CatalogError(
                    f"tier_scrolls has unknown tier '{extra}'"
                )
        if skin_set_exists(cat, slug):
            raise CatalogError(
                f"Skin set key '{slug}' is invalid - already exists in "
                f"category '{cat['id']}'. Choose a different item name."
            )
        for tier in tier_list:
            key = f"{slug}_{tier}"
            if skin_set_exists(cat, key):
                raise CatalogError(
                    f"Skin set key '{key}' is invalid - already exists in "
                    f"category '{cat['id']}'. Choose a different item name."
                )
        return {
            "category": str(cat["id"]),
            "scroll": None,
            "tier_scrolls": normalized,
        }

    if tier_scrolls:
        raise CatalogError("tier_scrolls is only allowed for armor_set")
    scroll_id = require_scroll(catalog, scroll or "")
    if skin_set_exists(cat, slug):
        raise CatalogError(
            f"Skin set key '{slug}' is invalid - already exists in "
            f"category '{cat['id']}'. Choose a different item name."
        )
    return {
        "category": str(cat["id"]),
        "scroll": scroll_id,
        "tier_scrolls": None,
    }
