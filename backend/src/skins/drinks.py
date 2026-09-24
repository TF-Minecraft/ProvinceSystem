"""Drink submissions, textures, catalog, and player meta (Drink Builder API)."""

from __future__ import annotations

import json
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.name_colours import (
    NameColourError,
    effective_colour_cap,
    validate_name_colours,
)
from src.text_validation import TextValidationError, assert_display_name, assert_prose

from . import db
from .db import connect
from .discord_link import get_identity_status
from .naming import SlugError, build_submission_id_for_realm, slugify_display_name

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_PNG_BYTES = 512 * 1024
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
FORBIDDEN_RECIPE_KEYS = frozenset({"servercommands", "playercommands"})


class DrinkError(ValueError):
    """Invalid drink redeem/submit/review input."""


class DrinkNotificationError(ValueError):
    """Drink notification not found."""


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _submissions_root() -> Path:
    path = db.DRINKS_DIR / "submissions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _textures_root() -> Path:
    path = db.DRINKS_DIR / "textures"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _assets_root() -> Path:
    path = db.DRINKS_DIR / "assets"
    path.mkdir(parents=True, exist_ok=True)
    return path


DRINK_ASSET_NAMES = frozenset({"glass_bottle.png", "potion_overlay.png"})


def save_drink_asset(filename: str, data: bytes) -> dict[str, Any]:
    name = (filename or "").strip().lower()
    if name not in DRINK_ASSET_NAMES:
        raise DrinkError(
            "asset must be glass_bottle.png or potion_overlay.png"
        )
    if not data:
        raise DrinkError("empty asset body")
    if len(data) > MAX_PNG_BYTES:
        raise DrinkError(f"asset must be under {MAX_PNG_BYTES} bytes")
    if not data.startswith(PNG_MAGIC):
        raise DrinkError("asset must be a PNG")
    out = _assets_root() / name
    out.write_bytes(data)
    return {"ok": True, "filename": name, "bytes": len(data)}


def resolve_drink_asset(filename: str) -> Path | None:
    name = (filename or "").strip().lower()
    if name not in DRINK_ASSET_NAMES:
        return None
    path = _assets_root() / name
    if path.is_file() and path.stat().st_size > 0:
        return path
    return None


# --- player meta ---


def get_allow_drink_texture(player_uuid: str) -> bool:
    uuid = (player_uuid or "").strip().lower()
    if not uuid:
        return False
    with connect() as conn:
        row = conn.execute(
            """
            SELECT allow_drink_texture FROM drink_player_meta
            WHERE LOWER(player_uuid) = ?
            """,
            (uuid,),
        ).fetchone()
    if row is None:
        return False
    try:
        return bool(int(row["allow_drink_texture"] or 0))
    except (TypeError, ValueError):
        return False


def get_drink_name_colour_stops(player_uuid: str) -> int:
    uuid = (player_uuid or "").strip().lower()
    if not uuid:
        return 0
    with connect() as conn:
        row = conn.execute(
            """
            SELECT name_colour_stops FROM drink_player_meta
            WHERE LOWER(player_uuid) = ?
            """,
            (uuid,),
        ).fetchone()
    if row is None:
        return 0
    try:
        return effective_colour_cap(int(row["name_colour_stops"] or 0))
    except (TypeError, ValueError, KeyError):
        return 0


def upsert_drink_player_meta(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise DrinkError("body must be a JSON object")
    uuid = str(raw.get("player_uuid") or "").strip().lower()
    if not uuid:
        raise DrinkError("player_uuid is required")
    allow = bool(raw.get("allow_drink_texture", False))
    if isinstance(raw.get("allow_drink_texture"), (int, str)):
        try:
            allow = bool(int(raw.get("allow_drink_texture")))
        except (TypeError, ValueError):
            allow = bool(raw.get("allow_drink_texture"))
    try:
        stops = effective_colour_cap(int(raw.get("name_colour_stops") or 0))
    except (TypeError, ValueError):
        stops = 0
    updated_at = _iso_now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO drink_player_meta (
                player_uuid, allow_drink_texture, name_colour_stops, updated_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                allow_drink_texture = excluded.allow_drink_texture,
                name_colour_stops = excluded.name_colour_stops,
                updated_at = excluded.updated_at
            """,
            (uuid, 1 if allow else 0, stops, updated_at),
        )
        conn.commit()
    return {
        "player_uuid": uuid,
        "allow_drink_texture": allow,
        "name_colour_stops": stops,
        "updated_at": updated_at,
    }


# --- catalog ---


def _empty_catalog() -> dict[str, Any]:
    return {
        "ingredients": [],
        "categories": {},
        "effects_blacklist": [],
        "version": 0,
    }


def _normalize_catalog(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise DrinkError("body must be a JSON object")
    ingredients_in = raw.get("ingredients")
    if ingredients_in is None:
        ingredients_in = []
    if not isinstance(ingredients_in, list):
        raise DrinkError("ingredients must be a list")
    ingredients: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, row in enumerate(ingredients_in):
        if not isinstance(row, dict):
            raise DrinkError(f"ingredients[{i}] must be an object")
        iid = str(row.get("id") or "").strip().lower()
        if not iid:
            raise DrinkError(f"ingredients[{i}].id is required")
        if iid in seen:
            raise DrinkError(f"duplicate ingredient id '{iid}'")
        seen.add(iid)
        token = str(row.get("brewery_token") or iid).strip()
        label = str(row.get("label") or iid).strip() or iid
        category = str(row.get("category") or "other").strip() or "other"
        ingredients.append(
            {
                "id": iid,
                "brewery_token": token,
                "label": label,
                "category": category,
                "type": str(row.get("type") or "").strip().lower() or None,
            }
        )
    categories_in = raw.get("categories")
    if categories_in is None:
        categories_in = {}
    if not isinstance(categories_in, dict):
        raise DrinkError("categories must be an object")
    categories: dict[str, str] = {}
    for key, label in categories_in.items():
        cid = str(key or "").strip().lower()
        if not cid:
            continue
        text = str(label or "").strip() or cid
        categories[cid] = text
    blacklist_in = raw.get("effects_blacklist")
    if blacklist_in is None:
        blacklist_in = []
    if not isinstance(blacklist_in, list):
        raise DrinkError("effects_blacklist must be a list")
    blacklist: list[str] = []
    for i, name in enumerate(blacklist_in):
        text = str(name or "").strip().lower()
        if not text:
            raise DrinkError(f"effects_blacklist[{i}] is empty")
        blacklist.append(text)
    try:
        version = int(raw.get("version") or 0)
    except (TypeError, ValueError) as e:
        raise DrinkError("version must be an integer") from e
    return {
        "ingredients": ingredients,
        "categories": categories,
        "effects_blacklist": blacklist,
        "version": version,
    }


def replace_drink_catalog(raw: dict[str, Any]) -> dict[str, Any]:
    payload = _normalize_catalog(raw)
    updated_at = _iso_now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO drink_catalog (id, payload, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            (json.dumps(payload, separators=(",", ":")), updated_at),
        )
        conn.commit()
    return {"catalog": payload, "updated_at": updated_at}


def get_drink_catalog() -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(
            "SELECT payload, updated_at FROM drink_catalog WHERE id = 1"
        ).fetchone()
    if row is None:
        return {"catalog": _empty_catalog(), "updated_at": None}
    try:
        payload = json.loads(row["payload"])
    except (json.JSONDecodeError, TypeError):
        payload = _empty_catalog()
    if not isinstance(payload, dict):
        payload = _empty_catalog()
    if not isinstance(payload.get("categories"), dict):
        payload = {**payload, "categories": {}}
    if not isinstance(payload.get("ingredients"), list):
        payload = {**payload, "ingredients": []}
    return {"catalog": payload, "updated_at": row["updated_at"]}


def _ingredient_ids() -> set[str]:
    cat = get_drink_catalog()["catalog"]
    return {
        str(row.get("id") or "").strip().lower()
        for row in (cat.get("ingredients") or [])
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }


def _effects_blacklist() -> set[str]:
    cat = get_drink_catalog()["catalog"]
    return {
        str(name).strip().lower()
        for name in (cat.get("effects_blacklist") or [])
        if str(name).strip()
    }


# --- notifications ---


def enqueue_drink_notification(
    type_: str,
    submission_id: str,
    discord_user_id: str,
    payload: dict[str, Any],
) -> int:
    created_at = _iso_now()
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO drink_notifications (
                type, submission_id, discord_user_id, payload, created_at, delivered_at
            ) VALUES (?, ?, ?, ?, ?, NULL)
            """,
            (
                type_,
                submission_id,
                discord_user_id,
                json.dumps(payload, separators=(",", ":")),
                created_at,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_undelivered_drink_notifications() -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM drink_notifications
            WHERE delivered_at IS NULL
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()
    result = []
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except (json.JSONDecodeError, TypeError):
            payload = {}
        result.append(
            {
                "id": row["id"],
                "type": row["type"],
                "submission_id": row["submission_id"],
                "discord_user_id": row["discord_user_id"],
                "payload": payload,
                "created_at": row["created_at"],
            }
        )
    return result


def ack_drink_notification(notification_id: int) -> dict:
    now = _iso_now()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM drink_notifications WHERE id = ?",
            (notification_id,),
        ).fetchone()
        if row is None:
            raise DrinkNotificationError("Notification not found")
        if row["delivered_at"] is None:
            conn.execute(
                "UPDATE drink_notifications SET delivered_at = ? WHERE id = ?",
                (now, notification_id),
            )
            conn.commit()
            delivered_at = now
        else:
            delivered_at = row["delivered_at"]
    return {"id": notification_id, "delivered_at": delivered_at}


# --- recipe validation ---

# BreweryX BarrelWoodType indexes written to recipes.yml `wood:`.
WOOD_CODES = {
    "any": 0,
    "birch": 1,
    "oak": 2,
    "jungle": 3,
    "spruce": 4,
    "acacia": 5,
    "dark_oak": 6,
    "crimson": 7,
    "warped": 8,
    "mangrove": 9,
    "cherry": 10,
    "bamboo": 11,
    "cut_copper": 12,
    "pale_oak": 13,
}


def _validate_names(raw: dict[str, Any]) -> str | None:
    """Optional bad/normal/good quality names as 'a/b/c' or a 3-item list."""
    names_raw = raw.get("names")
    if names_raw is None or names_raw == "":
        return None
    parts: list[str]
    if isinstance(names_raw, str):
        parts = [p.strip() for p in names_raw.split("/")]
    elif isinstance(names_raw, list):
        parts = [str(p or "").strip() for p in names_raw]
    else:
        raise DrinkError("names must be a string or list of 3 quality names")
    if len(parts) != 3:
        raise DrinkError("names must have exactly 3 qualities (bad/normal/good)")
    out: list[str] = []
    for i, part in enumerate(parts):
        if not part:
            raise DrinkError(f"names[{i}] is required")
        try:
            out.append(
                assert_display_name(part, min_len=1, max_len=48, field=f"names[{i}]")
            )
        except TextValidationError as e:
            raise DrinkError(str(e)) from e
    return "/".join(out)


def _validate_wood(raw: dict[str, Any]) -> int | None:
    """Return the BreweryX wood index. Names are accepted and stored as that code."""
    wood_raw = raw.get("wood", raw.get("barrel_type"))
    if wood_raw is None or wood_raw == "":
        return None
    if isinstance(wood_raw, bool):
        raise DrinkError("wood must be an integer 0-13 or wood id")
    if isinstance(wood_raw, (int, float)):
        if isinstance(wood_raw, float) and not wood_raw.is_integer():
            raise DrinkError("wood must be an integer 0-13 or wood id")
        n = int(wood_raw)
        if n < 0 or n > 13:
            raise DrinkError("wood must be 0-13")
        return n
    text = str(wood_raw).strip().lower().replace(" ", "_").replace("-", "_")
    if text.isdigit():
        n = int(text)
        if n < 0 or n > 13:
            raise DrinkError("wood must be 0-13")
        return n
    code = WOOD_CODES.get(text)
    if code is None:
        raise DrinkError(f"unknown wood '{wood_raw}'")
    return code


def _optional_prose(raw: dict[str, Any], key: str, *, max_len: int) -> str | None:
    val = raw.get(key)
    if val is None or str(val).strip() == "":
        return None
    try:
        return assert_prose(str(val), min_len=1, max_len=max_len, field=key)
    except TextValidationError as e:
        raise DrinkError(str(e)) from e


def _parse_colours(
    raw: dict[str, Any], key: str, *, colour_cap: int
) -> list[str]:
    if key not in raw or raw.get(key) is None:
        return []
    try:
        return validate_name_colours(raw.get(key), max_colours=colour_cap)
    except NameColourError as e:
        raise DrinkError(f"{key}: {e}") from e


def _validate_lore(
    raw: dict[str, Any], *, colour_cap: int
) -> list[dict[str, Any]]:
    lore_in = raw.get("lore")
    if lore_in is None:
        lore_in = []
    if not isinstance(lore_in, list):
        raise DrinkError("lore must be a list")
    if len(lore_in) > 6:
        raise DrinkError("lore must have at most 6 lines")
    lore: list[dict[str, Any]] = []
    for i, line in enumerate(lore_in):
        if isinstance(line, str):
            text = line.strip()
            colours: list[str] = []
        elif isinstance(line, dict):
            text = str(line.get("text") or "").strip()
            try:
                colours = validate_name_colours(
                    line.get("colours"), max_colours=colour_cap
                )
            except NameColourError as e:
                raise DrinkError(f"lore[{i}].colours: {e}") from e
        else:
            raise DrinkError(f"lore[{i}] must be a string or object")
        if not text:
            continue
        try:
            text = assert_prose(
                text,
                min_len=1,
                max_len=48,
                field=f"lore[{i}]",
                allow_colour_codes=True,
            )
        except TextValidationError as e:
            raise DrinkError(str(e)) from e
        if not _lore_line_has_leading_colour(text):
            text = "§7" + text
        entry: dict[str, Any] = {"text": text}
        if colours:
            entry["colours"] = colours
        lore.append(entry)
    return lore


def _lore_line_has_leading_colour(line: str) -> bool:
    """Match kit lore: §/& hex digit or #RRGGBB counts as a leading colour."""
    s = (line or "").lstrip()
    if not s:
        return False
    if s[0] in ("§", "&") and len(s) >= 2:
        return s[1].lower() in "0123456789abcdef"
    if s[0] == "#" and len(s) >= 7 and all(
        c in "0123456789abcdefABCDEF" for c in s[1:7]
    ):
        return True
    return False


def _validate_recipe(
    raw: dict[str, Any], *, colour_cap: int = 0
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise DrinkError("recipe must be a JSON object")
    for key in raw:
        if str(key).strip().lower() in FORBIDDEN_RECIPE_KEYS:
            raise DrinkError(f"recipe key '{key}' is not allowed")

    try:
        display = assert_display_name(
            raw.get("name") or raw.get("display_name") or "",
            min_len=1,
            max_len=48,
            field="drink name",
        )
    except TextValidationError as e:
        raise DrinkError(str(e)) from e

    names = _validate_names(raw)
    name_colours = _parse_colours(raw, "name_colours", colour_cap=colour_cap)
    name_bad_colours = _parse_colours(
        raw, "name_bad_colours", colour_cap=colour_cap
    )
    name_good_colours = _parse_colours(
        raw, "name_good_colours", colour_cap=colour_cap
    )
    # One colour set applies to all qualities unless legacy per-quality lists are set.
    if not name_bad_colours:
        name_bad_colours = list(name_colours)
    if not name_good_colours:
        name_good_colours = list(name_colours)

    ingredients_in = raw.get("ingredients")
    if not isinstance(ingredients_in, list) or not ingredients_in:
        raise DrinkError("recipe.ingredients must be a non-empty list")
    allowed = _ingredient_ids()
    if not allowed:
        raise DrinkError("drink ingredient catalog is empty")
    ingredients: list[dict[str, Any]] = []
    for i, row in enumerate(ingredients_in):
        if not isinstance(row, dict):
            raise DrinkError(f"ingredients[{i}] must be an object")
        iid = str(row.get("id") or "").strip().lower()
        if not iid:
            raise DrinkError(f"ingredients[{i}].id is required")
        if iid not in allowed:
            raise DrinkError(f"ingredient '{iid}' is not on the allowlist")
        try:
            amount = int(row.get("amount"))
        except (TypeError, ValueError) as e:
            raise DrinkError(f"ingredients[{i}].amount must be an integer") from e
        if amount < 1:
            raise DrinkError(f"ingredients[{i}].amount must be >= 1")
        ingredients.append({"id": iid, "amount": amount})

    effects_in = raw.get("effects")
    if effects_in is None:
        effects_in = []
    if not isinstance(effects_in, list):
        raise DrinkError("recipe.effects must be a list")
    blacklist = _effects_blacklist()
    effects: list[Any] = []
    for i, effect in enumerate(effects_in):
        if isinstance(effect, str):
            name = effect.strip().lower()
            if name in blacklist:
                raise DrinkError(f"effect '{name}' is not allowed")
            effects.append(name)
        elif isinstance(effect, dict):
            name = str(effect.get("type") or effect.get("name") or "").strip().lower()
            if not name:
                raise DrinkError(f"effects[{i}] needs a type/name")
            if name in blacklist:
                raise DrinkError(f"effect '{name}' is not allowed")
            effects.append(effect)
        else:
            raise DrinkError(f"effects[{i}] must be a string or object")

    color_raw = raw.get("color")
    color: str | None = None
    if color_raw is not None and str(color_raw).strip():
        color = str(color_raw).strip()
        if not COLOR_RE.match(color):
            raise DrinkError("color must be #RRGGBB")

    def _nonneg(key: str, default: int = 0) -> int:
        val = raw.get(key, default)
        try:
            n = int(val)
        except (TypeError, ValueError) as e:
            raise DrinkError(f"{key} must be an integer") from e
        if n < 0:
            raise DrinkError(f"{key} must be >= 0")
        return n

    def _clamped(key: str, default: int, lo: int, hi: int) -> int:
        n = _nonneg(key, default)
        if n < lo or n > hi:
            raise DrinkError(f"{key} must be {lo}-{hi}")
        return n

    lore = _validate_lore(raw, colour_cap=colour_cap)
    wood = _validate_wood(raw)
    glint_raw = raw.get("glint", False)
    if isinstance(glint_raw, str):
        glint = glint_raw.strip().lower() in ("1", "true", "yes", "on")
    else:
        glint = bool(glint_raw)

    difficulty = 1
    if raw.get("difficulty") not in (None, ""):
        difficulty = _clamped("difficulty", 1, 1, 10)

    drink_message = _optional_prose(raw, "drink_message", max_len=120)
    drink_title = _optional_prose(raw, "drink_title", max_len=48)
    drink_message_colours = _parse_colours(
        raw, "drink_message_colours", colour_cap=colour_cap
    )
    drink_title_colours = _parse_colours(
        raw, "drink_title_colours", colour_cap=colour_cap
    )

    out: dict[str, Any] = {
        "name": display,
        "names": names,
        "name_colours": name_colours,
        "name_bad_colours": name_bad_colours,
        "name_good_colours": name_good_colours,
        "ingredients": ingredients,
        "cooking_time": _nonneg("cooking_time", 0),
        "distill_runs": _nonneg("distill_runs", 0),
        "distill_time": _nonneg("distill_time", 0),
        "wood": wood,
        "barrel_type": wood if wood is not None else None,
        "age": _nonneg("age", 0),
        "difficulty": difficulty,
        "alcohol": _clamped("alcohol", 0, 0, 100) if raw.get("alcohol") not in (None, "") else 0,
        "effects": effects,
        "color": color,
        "lore": lore,
        "drink_message": drink_message,
        "drink_title": drink_title,
        "drink_message_colours": drink_message_colours,
        "drink_title_colours": drink_title_colours,
        "glint": glint,
    }
    return out


def _validate_png(data: bytes) -> None:
    if not data:
        raise DrinkError("texture PNG is empty")
    if len(data) > MAX_PNG_BYTES:
        raise DrinkError(f"texture PNG exceeds {MAX_PNG_BYTES} bytes")
    if not data.startswith(PNG_MAGIC):
        raise DrinkError("texture must be a PNG file")


# --- submissions ---


def _public_row(row) -> dict[str, Any]:
    try:
        recipe = json.loads(row["recipe_json"])
    except (json.JSONDecodeError, TypeError, KeyError):
        recipe = {}
    return {
        "id": row["id"],
        "player_uuid": row["player_uuid"],
        "code_id": row["code_id"],
        "slug": row["slug"],
        "display_name": row["display_name"],
        "recipe": recipe,
        "status": row["status"],
        "deny_reason": row["deny_reason"],
        "texture_id": row["texture_id"],
        "new_texture": bool(int(row["new_texture"] or 0)),
        "discord_user_id": row["discord_user_id"],
        "created_at": row["created_at"],
        "reviewed_at": row["reviewed_at"],
        "applied_at": row["applied_at"],
    }


def _get_row(submission_id: str):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM drink_submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()


def _link_names(player_uuid: str) -> dict[str, str | None]:
    status = get_identity_status(player_uuid)
    return {
        "minecraft_name": status.get("minecraft_name"),
        "discord_username": status.get("discord_username"),
        "discord_user_id": status.get("discord_user_id"),
    }


def create_drink_submission(
    session_row: dict[str, Any],
    recipe_raw: dict[str, Any],
    *,
    png_bytes: bytes | None = None,
    existing_texture_id: str | None = None,
) -> dict[str, Any]:
    scope = str(session_row.get("scope") or "").strip().lower()
    if scope != "drink":
        raise DrinkError("session is not a drink token")

    player_uuid = str(session_row.get("player_uuid") or "").strip()
    code_id = int(session_row["code_id"])
    from src.characters.rpc_player_meta import resolve_web_entitlements
    from src.skins.codes import normalize_realm_id

    try:
        realm = normalize_realm_id(session_row.get("realm_id"))
    except Exception:
        realm = "main"
    entitlements = resolve_web_entitlements(player_uuid, realm_id=realm)
    colour_cap = int(entitlements["name_colour_stops"])
    recipe = _validate_recipe(recipe_raw, colour_cap=colour_cap)
    display = recipe["name"]
    allow_texture = bool(entitlements["allow_drink_texture"])
    allow_message = bool(entitlements.get("allow_drink_message"))

    if (recipe.get("drink_message") or recipe.get("drink_message_colours")) and not allow_message:
        raise DrinkError("Your rank cannot use drink messages")

    has_color = recipe.get("color") is not None
    has_png = png_bytes is not None and len(png_bytes) > 0
    existing_id = (existing_texture_id or "").strip() or None
    modes = sum([has_color, has_png, bool(existing_id)])
    if modes != 1:
        raise DrinkError(
            "provide exactly one of: color, texture PNG, or existing_texture_id"
        )

    if (has_png or existing_id) and not allow_texture:
        raise DrinkError("Your rank cannot use custom drink textures")

    identity = get_identity_status(player_uuid)
    if not identity.get("eligible"):
        raise DrinkError("Link Discord in-game with /linkdiscord first")
    minecraft_name = identity.get("minecraft_name")
    discord_user_id = identity.get("discord_user_id")

    try:
        submission_id = build_submission_id_for_realm(
            minecraft_name, display, realm
        )
        slug = slugify_display_name(display)
    except SlugError as e:
        raise DrinkError(str(e)) from e

    with connect() as conn:
        clash = conn.execute(
            """
            SELECT id FROM drink_submissions
            WHERE realm_id = ?
              AND (
                id = ?
                OR (
                  LOWER(player_uuid) = LOWER(?)
                  AND LOWER(slug) = LOWER(?)
                  AND status IN ('pending', 'approved', 'pending_pack', 'applied')
                )
              )
            """,
            (realm, submission_id, player_uuid, slug),
        ).fetchone()
        if clash is not None:
            raise DrinkError(
                "You already have an active drink with this name or id"
            )

    texture_id: str | None = None
    new_texture = 0
    dir_path = str(_submissions_root() / submission_id)
    sub_dir = Path(dir_path)
    if sub_dir.exists():
        shutil.rmtree(sub_dir, ignore_errors=True)
    sub_dir.mkdir(parents=True, exist_ok=True)

    try:
        if has_png:
            assert png_bytes is not None
            _validate_png(png_bytes)
            texture_id = f"tex_{secrets.token_hex(8)}"
            png_rel = f"textures/{texture_id}.png"
            png_abs = db.DRINKS_DIR / png_rel
            png_abs.parent.mkdir(parents=True, exist_ok=True)
            png_abs.write_bytes(png_bytes)
            (sub_dir / "texture.png").write_bytes(png_bytes)
            created_at = _iso_now()
            with connect() as conn:
                conn.execute(
                    """
                    INSERT INTO drink_textures (
                        id, owner_uuid, cmd, ia_item_id, png_path, refcount, created_at
                    ) VALUES (?, ?, NULL, NULL, ?, 1, ?)
                    """,
                    (texture_id, player_uuid.lower(), png_rel, created_at),
                )
                conn.commit()
            new_texture = 1
            recipe["color"] = None
        elif existing_id:
            with connect() as conn:
                tex = conn.execute(
                    "SELECT * FROM drink_textures WHERE id = ?",
                    (existing_id,),
                ).fetchone()
                if tex is None:
                    raise DrinkError("existing_texture_id not found")
                if str(tex["owner_uuid"]).lower() != player_uuid.lower():
                    raise DrinkError("existing_texture_id is not owned by you")
                if tex["cmd"] is None:
                    raise DrinkError(
                        "existing_texture_id is not applied yet (no custom model data)"
                    )
                conn.execute(
                    """
                    UPDATE drink_textures
                    SET refcount = refcount + 1
                    WHERE id = ?
                    """,
                    (existing_id,),
                )
                conn.commit()
            texture_id = existing_id
            new_texture = 0
            recipe["color"] = None
            src = db.DRINKS_DIR / str(tex["png_path"])
            if src.is_file():
                shutil.copy2(src, sub_dir / "texture.png")

        (sub_dir / "recipe.json").write_text(
            json.dumps(recipe, indent=2),
            encoding="utf-8",
        )

        created_at = _iso_now()
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO drink_submissions (
                    id, player_uuid, code_id, slug, display_name, recipe_json,
                    status, deny_reason, texture_id, new_texture, dir_path,
                    discord_user_id, created_at, reviewed_at, applied_at, realm_id
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?, NULL, NULL, ?)
                """,
                (
                    submission_id,
                    player_uuid,
                    code_id,
                    slug,
                    display,
                    json.dumps(recipe, separators=(",", ":")),
                    texture_id,
                    new_texture,
                    dir_path,
                    discord_user_id,
                    created_at,
                    realm,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM drink_submissions WHERE id = ?",
                (submission_id,),
            ).fetchone()
    except Exception:
        if sub_dir.exists():
            shutil.rmtree(sub_dir, ignore_errors=True)
        if new_texture and texture_id:
            tex_path = db.DRINKS_DIR / "textures" / f"{texture_id}.png"
            if tex_path.exists():
                tex_path.unlink(missing_ok=True)
            with connect() as conn:
                conn.execute(
                    "DELETE FROM drink_textures WHERE id = ?", (texture_id,)
                )
                conn.commit()
        raise

    if discord_user_id:
        enqueue_drink_notification(
            "submitted",
            submission_id,
            str(discord_user_id),
            {
                "submission_id": submission_id,
                "display_name": display,
                "slug": slug,
            },
        )

    from src.skins.codes import mark_code_consumed

    mark_code_consumed(code_id)

    return _public_row(row)


def get_drink_submission_for_owner(
    submission_id: str, player_uuid: str
) -> dict[str, Any] | None:
    row = _get_row(submission_id)
    if row is None:
        return None
    if str(row["player_uuid"]).lower() != str(player_uuid).lower():
        return None
    return _public_row(row)


def list_drink_submissions_for_player(
    player_uuid: str,
    realm_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    from src.skins.codes import normalize_realm_id

    uuid = (player_uuid or "").strip()
    if not uuid:
        return []
    realm = normalize_realm_id(realm_id)
    cap = max(1, min(int(limit or 50), 100))
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM drink_submissions
            WHERE LOWER(player_uuid) = LOWER(?) AND realm_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (uuid, realm, cap),
        ).fetchall()
    return [_public_row(row) for row in rows]


def list_pending_drinks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM drink_submissions
            WHERE status = 'pending'
            ORDER BY created_at ASC
            """
        ).fetchall()
    result = []
    for row in rows:
        names = _link_names(row["player_uuid"])
        public = _public_row(row)
        public["minecraft_name"] = names.get("minecraft_name")
        public["discord_username"] = names.get("discord_username")
        public["files"] = _list_files(row["id"])
        result.append(public)
    return result


def _list_files(submission_id: str) -> list[str]:
    root = _submissions_root() / submission_id
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_file())


def resolve_drink_submission_file(
    submission_id: str, filename: str
) -> Path | None:
    name = Path(filename).name
    if name != filename or ".." in filename:
        return None
    path = _submissions_root() / submission_id / name
    if not path.is_file():
        return None
    return path


def approve_drink_submission(submission_id: str) -> dict[str, Any]:
    row = _get_row(submission_id)
    if row is None:
        raise DrinkError("Submission not found")
    if row["status"] != "pending":
        raise DrinkError("Only pending submissions can be approved")

    new_texture = bool(int(row["new_texture"] or 0))
    texture_id = row["texture_id"]
    next_status = "approved"
    if new_texture:
        next_status = "pending_pack"
    elif texture_id:
        with connect() as conn:
            tex = conn.execute(
                "SELECT cmd FROM drink_textures WHERE id = ?",
                (texture_id,),
            ).fetchone()
        if tex is None or tex["cmd"] is None:
            next_status = "pending_pack"

    reviewed_at = _iso_now()
    with connect() as conn:
        conn.execute(
            """
            UPDATE drink_submissions
            SET status = ?, reviewed_at = ?, deny_reason = NULL
            WHERE id = ?
            """,
            (next_status, reviewed_at, submission_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM drink_submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()

    result = _public_row(row)
    discord_user_id = row["discord_user_id"]
    if discord_user_id:
        enqueue_drink_notification(
            "approved",
            submission_id,
            str(discord_user_id),
            {
                "submission_id": submission_id,
                "display_name": row["display_name"],
                "slug": row["slug"],
                "status": next_status,
            },
        )
    return result


def _release_texture(texture_id: str | None, *, was_new: bool = False) -> dict[str, Any]:
    """Decrement texture refcount. Delete row+PNG when refcount hits 0.

    Returns:
      {texture_freed, texture_id, ia_item_id, cmd, refcount}
    """
    empty = {
        "texture_freed": False,
        "texture_id": None,
        "ia_item_id": None,
        "cmd": None,
        "refcount": None,
    }
    if not texture_id:
        return empty
    with connect() as conn:
        tex = conn.execute(
            "SELECT * FROM drink_textures WHERE id = ?",
            (texture_id,),
        ).fetchone()
        if tex is None:
            return empty
        ia_item_id = tex["ia_item_id"]
        cmd = tex["cmd"]
        new_count = max(0, int(tex["refcount"] or 0) - 1)
        if new_count <= 0:
            conn.execute("DELETE FROM drink_textures WHERE id = ?", (texture_id,))
            conn.commit()
            png = db.DRINKS_DIR / str(tex["png_path"])
            if png.is_file():
                png.unlink(missing_ok=True)
            return {
                "texture_freed": True,
                "texture_id": texture_id,
                "ia_item_id": ia_item_id,
                "cmd": cmd,
                "refcount": 0,
            }
        conn.execute(
            "UPDATE drink_textures SET refcount = ? WHERE id = ?",
            (new_count, texture_id),
        )
        conn.commit()
        return {
            "texture_freed": False,
            "texture_id": texture_id,
            "ia_item_id": ia_item_id,
            "cmd": cmd,
            "refcount": new_count,
        }


def deny_drink_submission(submission_id: str, reason: str) -> dict[str, Any]:
    try:
        reason = assert_prose(reason, min_len=1, max_len=200, field="deny reason")
    except TextValidationError as e:
        raise DrinkError(str(e)) from e

    row = _get_row(submission_id)
    if row is None:
        raise DrinkError("Submission not found")
    if row["status"] != "pending":
        raise DrinkError("Only pending submissions can be denied")

    reviewed_at = _iso_now()
    payload = _public_row(row)
    payload["status"] = "denied"
    payload["deny_reason"] = reason
    payload["reviewed_at"] = reviewed_at

    discord_user_id = row["discord_user_id"]
    if discord_user_id:
        enqueue_drink_notification(
            "denied",
            submission_id,
            str(discord_user_id),
            {
                "submission_id": submission_id,
                "display_name": row["display_name"],
                "slug": row["slug"],
                "deny_reason": reason,
            },
        )

    was_new = bool(int(row["new_texture"] or 0))
    texture_id = row["texture_id"]
    dir_path = row["dir_path"]
    with connect() as conn:
        conn.execute(
            "DELETE FROM drink_submissions WHERE id = ?", (submission_id,)
        )
        conn.commit()
    if dir_path:
        shutil.rmtree(dir_path, ignore_errors=True)
    _release_texture(texture_id, was_new=was_new)
    return payload


def list_player_textures(player_uuid: str) -> list[dict[str, Any]]:
    """Owned textures that already have CMD (applied / reusable)."""
    uuid = (player_uuid or "").strip().lower()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, cmd, ia_item_id, png_path, refcount, created_at
            FROM drink_textures
            WHERE LOWER(owner_uuid) = ?
              AND cmd IS NOT NULL
            ORDER BY created_at DESC
            """,
            (uuid,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "cmd": row["cmd"],
            "ia_item_id": row["ia_item_id"],
            "refcount": row["refcount"],
            "created_at": row["created_at"],
            "applied": True,
        }
        for row in rows
    ]


def list_deletable_drinks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, display_name, status, texture_id, slug
            FROM drink_submissions
            WHERE status IN ('approved', 'pending_pack', 'applied')
            ORDER BY display_name ASC, id ASC
            """
        ).fetchall()
    return [
        {
            "id": row["id"],
            "display_name": row["display_name"],
            "status": row["status"],
            "texture_id": row["texture_id"],
            "slug": row["slug"],
        }
        for row in rows
    ]


def get_drink_for_plugin(submission_id: str) -> dict[str, Any] | None:
    sid = (submission_id or "").strip()
    if not sid:
        return None
    row = _get_row(sid)
    if row is None:
        return None
    public = _public_row(row)
    names = _link_names(row["player_uuid"])
    public["minecraft_name"] = names.get("minecraft_name")
    public["discord_username"] = names.get("discord_username")
    public["files"] = _list_files(sid)
    tid = str(row["texture_id"] or "").strip()
    if tid:
        with connect() as conn:
            tex = conn.execute(
                "SELECT * FROM drink_textures WHERE id = ?",
                (tid,),
            ).fetchone()
        public["texture"] = _texture_public(tex) if tex is not None else None
    else:
        public["texture"] = None
    return public


def revoke_drink_submission(submission_id: str) -> dict[str, Any]:
    """Staff/plugin hard-delete of an active (post-pending) drink."""
    sid = (submission_id or "").strip()
    if not sid:
        raise DrinkError("submission id is required")
    row = _get_row(sid)
    if row is None:
        raise DrinkError("Submission not found")
    status = str(row["status"] or "")
    if status not in ("approved", "pending_pack", "applied"):
        raise DrinkError(
            "Only approved, pending_pack, or applied drinks can be revoked"
        )

    was_new = bool(int(row["new_texture"] or 0))
    texture_id = row["texture_id"]
    dir_path = row["dir_path"]

    # Capture texture meta before release (for plugin IA cleanup).
    tex_meta: dict[str, Any] | None = None
    if texture_id:
        with connect() as conn:
            tex = conn.execute(
                "SELECT * FROM drink_textures WHERE id = ?",
                (texture_id,),
            ).fetchone()
        if tex is not None:
            tex_meta = _texture_public(tex)

    with connect() as conn:
        conn.execute("DELETE FROM drink_submissions WHERE id = ?", (sid,))
        conn.commit()
    if dir_path:
        shutil.rmtree(dir_path, ignore_errors=True)

    released = _release_texture(texture_id, was_new=was_new)
    return {
        "id": sid,
        "deleted": True,
        "texture_freed": bool(released.get("texture_freed")),
        "texture_id": released.get("texture_id")
        or (tex_meta or {}).get("id"),
        "ia_item_id": released.get("ia_item_id")
        if released.get("texture_freed")
        else None,
        "cmd": released.get("cmd") if released.get("texture_freed") else None,
        "refcount": released.get("refcount"),
    }


def _texture_public(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "cmd": row["cmd"],
        "ia_item_id": row["ia_item_id"],
        "png_path": row["png_path"],
        "refcount": row["refcount"],
        "created_at": row["created_at"],
    }


def list_drinks_pending_apply(
    realm_id: str | None = None,
) -> list[dict[str, Any]]:
    """Approved / pending_pack drinks not yet applied by DrinkBuilder."""
    from src.skins.codes import normalize_realm_id

    realm = normalize_realm_id(realm_id)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM drink_submissions
            WHERE status IN ('approved', 'pending_pack')
              AND applied_at IS NULL
              AND realm_id = ?
            ORDER BY reviewed_at ASC, created_at ASC
            """,
            (realm,),
        ).fetchall()
        textures: dict[str, Any] = {}
        tex_ids = [
            str(r["texture_id"]).strip()
            for r in rows
            if r["texture_id"]
        ]
        if tex_ids:
            placeholders = ",".join("?" * len(tex_ids))
            for tex in conn.execute(
                f"SELECT * FROM drink_textures WHERE id IN ({placeholders})",
                tex_ids,
            ).fetchall():
                textures[str(tex["id"])] = tex

    result: list[dict[str, Any]] = []
    for row in rows:
        names = _link_names(row["player_uuid"])
        public = _public_row(row)
        public["minecraft_name"] = names.get("minecraft_name")
        public["discord_username"] = names.get("discord_username")
        public["files"] = _list_files(row["id"])
        public["realm_id"] = realm
        tid = str(row["texture_id"] or "").strip()
        if tid and tid in textures:
            public["texture"] = _texture_public(textures[tid])
        else:
            public["texture"] = None
        result.append(public)
    return result


def assign_drink_texture_cmd(
    texture_id: str, cmd: int, ia_item_id: str
) -> dict[str, Any]:
    tid = (texture_id or "").strip()
    if not tid:
        raise DrinkError("texture_id is required")
    try:
        cmd_int = int(cmd)
    except (TypeError, ValueError) as e:
        raise DrinkError("cmd must be an integer") from e
    if cmd_int < 1:
        raise DrinkError("cmd must be >= 1")
    ia_id = (ia_item_id or "").strip()
    if not ia_id:
        raise DrinkError("ia_item_id is required")

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM drink_textures WHERE id = ?",
            (tid,),
        ).fetchone()
        if row is None:
            raise DrinkError("Texture not found")
        existing = row["cmd"]
        if existing is not None and int(existing) != cmd_int:
            raise DrinkError(
                f"Texture already has cmd {existing}; cannot set {cmd_int}"
            )
        conn.execute(
            """
            UPDATE drink_textures
            SET cmd = ?, ia_item_id = ?
            WHERE id = ?
            """,
            (cmd_int, ia_id, tid),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM drink_textures WHERE id = ?",
            (tid,),
        ).fetchone()
    return _texture_public(row)


def mark_drinks_applied(submission_ids: list[str]) -> list[str]:
    applied: list[str] = []
    pending_notifications: list[tuple[str, str, dict[str, Any]]] = []
    now = _iso_now()
    with connect() as conn:
        for sid in submission_ids:
            sid = (sid or "").strip()
            if not sid:
                continue
            row = conn.execute(
                "SELECT * FROM drink_submissions WHERE id = ?",
                (sid,),
            ).fetchone()
            if row is None:
                continue
            cur = conn.execute(
                """
                UPDATE drink_submissions
                SET status = 'applied', applied_at = ?
                WHERE id = ?
                  AND status IN ('approved', 'pending_pack')
                  AND applied_at IS NULL
                """,
                (now, sid),
            )
            if cur.rowcount:
                applied.append(sid)
                discord_user_id = row["discord_user_id"]
                if discord_user_id:
                    pending_notifications.append(
                        (
                            sid,
                            str(discord_user_id),
                            {
                                "submission_id": sid,
                                "display_name": row["display_name"],
                                "slug": row["slug"],
                            },
                        )
                    )
        conn.commit()
    # Notify after commit — nested connect() inside the update transaction
    # can sqlite-lock and roll back the status change on busy hosts.
    for sid, discord_user_id, payload in pending_notifications:
        enqueue_drink_notification("applied", sid, discord_user_id, payload)
    return applied
