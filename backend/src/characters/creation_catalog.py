"""RPCharacters creation catalog snapshot for the website wizard."""

from __future__ import annotations

from typing import Any

from src import database
from src.characters.times import api_time, utcnow


class CreationCatalogError(ValueError):
    """Invalid creation catalog payload."""


def _as_list(raw: Any, field: str) -> list:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise CreationCatalogError(f"{field} must be a list")
    return raw


def _as_dict(raw: Any, field: str) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise CreationCatalogError(f"{field} must be an object")
    return raw


def _normalize_stages(raw: list) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise CreationCatalogError(f"stages[{i}] must be an object")
        sid = str(row.get("id") or "").strip()
        stype = str(row.get("type") or "").strip().lower()
        if not sid:
            raise CreationCatalogError(f"stages[{i}].id is required")
        if not stype:
            raise CreationCatalogError(f"stages[{i}].type is required")
        entry: dict[str, Any] = {
            "id": sid,
            "type": stype,
            "order": int(row.get("order", i)),
        }
        for key in (
            "target",
            "key",
            "filter",
            "lock_time",
            "repeat",
            "auto_next",
            "min_select",
            "max_select",
            "points",
            "max_rank",
            "messages",
            "web_messages",
            "message",
            "dependency",
            "entries",
            "interval",
            "require_account_age_hours_min",
            "require_account_age_hours_max",
            "platform",
            "lock_time_ms",
        ):
            if key in row and row[key] is not None:
                entry[key] = row[key]
        out.append(entry)
    return out


def _normalize_attribute_point_buy(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw, "attribute_point_buy")
    if not data:
        raise CreationCatalogError("attribute_point_buy is required")
    attrs = data.get("attributes")
    if not isinstance(attrs, list) or not attrs:
        raise CreationCatalogError("attribute_point_buy.attributes must be a non-empty list")
    cost = data.get("cost_for_rank")
    if not isinstance(cost, list) or not cost:
        raise CreationCatalogError(
            "attribute_point_buy.cost_for_rank must be a non-empty list"
        )
    try:
        pool = int(data.get("pool"))
        max_rank = int(data.get("max_rank"))
    except (TypeError, ValueError) as e:
        raise CreationCatalogError(
            "attribute_point_buy.pool and max_rank must be integers"
        ) from e
    attributes = [str(a).strip().lower() for a in attrs if str(a or "").strip()]
    cost_for_rank = []
    for c in cost:
        try:
            cost_for_rank.append(int(c))
        except (TypeError, ValueError) as e:
            raise CreationCatalogError(
                "attribute_point_buy.cost_for_rank must be integers"
            ) from e
    abbreviations = data.get("abbreviations")
    if abbreviations is None:
        abbreviations = {}
    if not isinstance(abbreviations, dict):
        raise CreationCatalogError("attribute_point_buy.abbreviations must be an object")
    abbr_out = {
        str(k).strip().lower(): str(v).strip().lower()
        for k, v in abbreviations.items()
        if str(k or "").strip() and str(v or "").strip()
    }
    return {
        "pool": pool,
        "max_rank": max_rank,
        "cost_for_rank": cost_for_rank,
        "attributes": attributes,
        "abbreviations": abbr_out,
        "trait_id_pattern": str(
            data.get("trait_id_pattern") or "{abbr}{rank}"
        ).strip(),
    }


def _normalize_id_rows(raw: list, field: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise CreationCatalogError(f"{field}[{i}] must be an object")
        rid = str(row.get("id") or "").strip()
        if not rid:
            raise CreationCatalogError(f"{field}[{i}].id is required")
        entry = dict(row)
        entry["id"] = rid
        out.append(entry)
    return out


def _normalize_editable_kit(raw: list) -> list[dict[str, Any]]:
    """Allow-list editable kit rows from RPCharacters kit.yml + ItemStack preview."""
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise CreationCatalogError(f"editable_kit[{i}] must be an object")
        kit_key = str(row.get("kit_key") or "").strip()
        path = str(row.get("path") or "").strip()
        if not kit_key:
            raise CreationCatalogError(f"editable_kit[{i}].kit_key is required")
        if not path:
            raise CreationCatalogError(f"editable_kit[{i}].path is required")
        try:
            amount = int(row.get("amount", 1))
        except (TypeError, ValueError) as e:
            raise CreationCatalogError(
                f"editable_kit[{i}].amount must be an integer"
            ) from e
        entry: dict[str, Any] = {
            "kit_key": kit_key,
            "path": path,
            "amount": max(1, amount),
            "skin_png": str(row.get("skin_png") or "").strip(),
            "base_set": str(row.get("base_set") or "").strip(),
        }
        signed = str(row.get("skin_png_signed") or "").strip()
        if signed:
            entry["skin_png_signed"] = signed
        two_d = str(row.get("2d_template") or "").strip()
        if two_d:
            entry["2d_template"] = two_d
        three_d = str(row.get("3d_template") or "").strip()
        if three_d:
            entry["3d_template"] = three_d
        kit_id = str(row.get("kit_id") or "").strip().lower()
        if kit_id:
            entry["kit_id"] = kit_id
        preview_raw = row.get("preview")
        if preview_raw is not None:
            if not isinstance(preview_raw, dict):
                raise CreationCatalogError(
                    f"editable_kit[{i}].preview must be an object"
                )
            lore_raw = preview_raw.get("lore")
            lore: list[str] = []
            if lore_raw is None:
                lore = []
            elif isinstance(lore_raw, list):
                lore = [str(line) for line in lore_raw if line is not None]
            else:
                raise CreationCatalogError(
                    f"editable_kit[{i}].preview.lore must be a list"
                )
            preview: dict[str, Any] = {
                "display_name": str(preview_raw.get("display_name") or "").strip(),
                "lore": lore,
                "material": str(preview_raw.get("material") or "").strip(),
            }
            cmd = preview_raw.get("custom_model_data")
            if cmd is not None:
                try:
                    preview["custom_model_data"] = int(cmd)
                except (TypeError, ValueError) as e:
                    raise CreationCatalogError(
                        f"editable_kit[{i}].preview.custom_model_data must be an integer"
                    ) from e
            entry["preview"] = preview
        out.append(entry)
    return out


def _normalize_kits(raw: list) -> list[dict[str, Any]]:
    """Allow-list kits[] from RPCharacters kits.yml sync."""
    out: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise CreationCatalogError(f"kits[{i}] must be an object")
        kid = str(row.get("id") or "").strip().lower()
        if not kid:
            raise CreationCatalogError(f"kits[{i}].id is required")
        try:
            cooldown_hours = int(row.get("cooldown_hours", 48))
        except (TypeError, ValueError) as e:
            raise CreationCatalogError(
                f"kits[{i}].cooldown_hours must be an integer"
            ) from e
        once = row.get("once_per_character", True)
        if not isinstance(once, bool):
            raise CreationCatalogError(
                f"kits[{i}].once_per_character must be a boolean"
            )
        items_raw = row.get("items")
        if items_raw is None:
            items_raw = []
        if not isinstance(items_raw, list):
            raise CreationCatalogError(f"kits[{i}].items must be a list")
        items: list[dict[str, Any]] = []
        for j, item in enumerate(items_raw):
            if not isinstance(item, dict):
                raise CreationCatalogError(f"kits[{i}].items[{j}] must be an object")
            path = str(item.get("path") or "").strip()
            if not path:
                raise CreationCatalogError(
                    f"kits[{i}].items[{j}].path is required"
                )
            try:
                amount = int(item.get("amount", 1))
            except (TypeError, ValueError) as e:
                raise CreationCatalogError(
                    f"kits[{i}].items[{j}].amount must be an integer"
                ) from e
            entry: dict[str, Any] = {
                "path": path,
                "amount": max(1, amount),
            }
            if item.get("editable"):
                entry["editable"] = True
            display_name = str(item.get("display_name") or "").strip()
            if display_name:
                entry["display_name"] = display_name
            items.append(entry)
        out.append(
            {
                "id": kid,
                "display_name": str(row.get("display_name") or kid).strip() or kid,
                "cooldown_hours": max(0, cooldown_hours),
                "once_per_character": once,
                "items": items,
            }
        )
    return out


def _normalize_payload(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise CreationCatalogError("body must be a JSON object")

    stages = _normalize_stages(_as_list(raw.get("stages"), "stages"))
    attribute_point_buy = _normalize_attribute_point_buy(raw.get("attribute_point_buy"))
    races = _normalize_id_rows(_as_list(raw.get("races"), "races"), "races")
    traits = _normalize_id_rows(_as_list(raw.get("traits"), "traits"), "traits")
    classes = _normalize_id_rows(_as_list(raw.get("classes"), "classes"), "classes")
    validation = _as_dict(raw.get("validation"), "validation")
    slot_limits = _as_dict(raw.get("slot_limits"), "slot_limits")
    editable_kit = _normalize_editable_kit(
        _as_list(raw.get("editable_kit"), "editable_kit")
    )
    kits = _normalize_kits(_as_list(raw.get("kits"), "kits")) if "kits" in raw else []

    out: dict[str, Any] = {
        "stages": stages,
        "attribute_point_buy": attribute_point_buy,
        "races": races,
        "traits": traits,
        "classes": classes,
        "validation": validation,
        "slot_limits": slot_limits,
        "editable_kit": editable_kit,
        "kits": kits,
    }
    return out


def replace_catalog(raw: dict[str, Any]) -> dict[str, Any]:
    """Full-replace creation catalog snapshot."""
    payload = _normalize_payload(raw)
    updated_at = utcnow()

    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO creation_catalog (id, payload, updated_at)
            VALUES (1, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            (database.Jsonb(payload), updated_at),
        )

    return {
        **payload,
        "updated_at": api_time(updated_at),
        "stages_count": len(payload["stages"]),
        "races_count": len(payload["races"]),
        "traits_count": len(payload["traits"]),
        "classes_count": len(payload["classes"]),
    }


def _empty_catalog() -> dict[str, Any]:
    return {
        "stages": [],
        "attribute_point_buy": None,
        "races": [],
        "traits": [],
        "classes": [],
        "validation": {},
        "slot_limits": {},
        "editable_kit": [],
        "kits": [],
        "updated_at": None,
    }


def get_catalog() -> dict[str, Any]:
    """Return stored snapshot or empty catalog."""
    with database.connect() as conn:
        row = conn.execute(
            "SELECT payload, updated_at FROM creation_catalog WHERE id = 1"
        ).fetchone()

    if row is None:
        return _empty_catalog()

    data = row["payload"]
    if not isinstance(data, dict):
        data = {}

    out = _empty_catalog()
    out["updated_at"] = api_time(row["updated_at"])
    for key in (
        "stages",
        "races",
        "traits",
        "classes",
        "validation",
        "slot_limits",
        "attribute_point_buy",
        "editable_kit",
        "kits",
    ):
        if key in data:
            out[key] = data[key]
    if not isinstance(out.get("editable_kit"), list):
        out["editable_kit"] = []
    if not isinstance(out.get("kits"), list):
        out["kits"] = []
    return out


def require_synced_creation_catalog() -> dict[str, Any]:
    """Return catalog or raise if RPCharacters has not pushed yet."""
    catalog = get_catalog()
    stages = catalog.get("stages") or []
    if not stages or catalog.get("updated_at") is None:
        raise CreationCatalogError("creation catalog not synced")
    if not catalog.get("attribute_point_buy"):
        raise CreationCatalogError("creation catalog missing attribute_point_buy")
    return catalog
