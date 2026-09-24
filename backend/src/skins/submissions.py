"""Create and fetch skins submissions."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .db import SKINS_DIR, connect
from .codes import SCOPE_LORE_UPLOAD
from .discord_link import get_link_for_uuid
from .naming import (
    ARMOR_TIER_LABELS,
    ARMOR_TIERS,
    BOOK_FIELDS,
    BOW_FRAME_FIELDS,
    CROSSBOW_FRAME_FIELDS,
    MAX_TIER_ALIAS_LEN,
    SlugError,
    build_staff_submission_id,
    build_submission_id,
    build_submission_id_for_realm,
    sanitize_ign,
    slugify_display_name,
)
from .notifications import enqueue_submitted
from .name_preview import write_name_preview
from .storage import (
    BOOK_KIND,
    BOW_KINDS,
    CROSSBOW_KINDS,
    GUN_KIND,
    GUN_MODEL_FIELDS,
    StorageError,
    write_submission_files,
)
from src.name_colours import NameColourError, validate_name_colours
from src.characters.rpc_player_meta import resolve_web_entitlements
from src.skins.size_limits import SizeLimitError, assert_3d_pair_budgets
from src.text_validation import TextValidationError, assert_display_name, assert_prose

ACTIVE_STATUSES = ("pending", "approved", "applied")
_BLOCK_STATUSES = ("pending", "approved")
ALLOWED_STYLES = frozenset(
    {"bold", "italic", "underline", "underlined", "strikethrough", "strike"}
)
_HANDHELD_BASES = frozenset(
    {
        "swords",
        "lutes",
        "battleaxes",
        "daggers",
        "warhammers",
        "shortswords",
        "hatchets",
        "hoes",
        "knives",
    }
)
_LARGE_HANDHELD_BASES = frozenset(
    {"spears", "polearms", "greathammers", "staffs"}
)

ALLOWED_KINDS = frozenset(
    {
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
    }
)
BASE_SETS: dict[str, frozenset[str]] = {
    "armor_set": frozenset(
        {"iron", "steel", "abyssalite", "mythril", "mage", "infantry"}
    ),
    "handheld": _HANDHELD_BASES,
    "large_handheld": _LARGE_HANDHELD_BASES,
    "bow": frozenset({"shortbows"}),
    "large_bow": frozenset({"longbows"}),
    "crossbow": frozenset({"crossbows"}),
    "item_3d": _HANDHELD_BASES | _LARGE_HANDHELD_BASES,
    "shield": frozenset({"shields"}),
    "helmet_3d": frozenset({"helmets"}),
    "mask": frozenset({"masks"}),
    "gun": frozenset({"rifles", "pistols", "shotguns", "launchers"}),
    "book": frozenset({"books"}),
}
MODEL_3D_KINDS = frozenset({"item_3d", "shield", "helmet_3d", "mask"})
GUN_FIELDS = ("texture",) + GUN_MODEL_FIELDS
GRIP_Y_MIN = 0.0
GRIP_Y_MAX = 16.0
# Legacy preset ids still accepted and mapped to Y.
_GRIP_PRESET_Y = {"bottom": 2.5, "middle": 4.0, "top": 5.5}
MAX_DISPLAY_NAME = 24


class SubmissionError(ValueError):
    """Business-rule failure for submissions (not auth)."""


class SlugConflictError(SubmissionError):
    """Skin id already used by an active submission."""


def parse_grip_y(raw: str | None) -> float | None:
    """Parse grip_preset form value as thirdperson Y (2.5–5.5), or None if empty."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    legacy = _GRIP_PRESET_Y.get(text.lower())
    if legacy is not None:
        return legacy
    try:
        value = float(text)
    except ValueError as exc:
        raise SubmissionError(
            f"grip_preset must be a number between {GRIP_Y_MIN} and {GRIP_Y_MAX}"
        ) from exc
    if not (GRIP_Y_MIN <= value <= GRIP_Y_MAX):
        raise SubmissionError(
            f"grip_preset must be between {GRIP_Y_MIN} and {GRIP_Y_MAX}"
        )
    return round(value, 2)

def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row_base_set(row: sqlite3.Row) -> str | None:
    if "base_set" not in row.keys():
        return None
    return row["base_set"]


def _row_json_list(row: sqlite3.Row, key: str) -> list[str]:
    if key not in row.keys():
        return []
    raw = row[key]
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if x is not None and str(x).strip()]


def _row_json_object(row: sqlite3.Row, key: str) -> dict[str, str]:
    if key not in row.keys():
        return {}
    raw = row[key]
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items() if v is not None}
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(k): str(v)
        for k, v in data.items()
        if v is not None and str(v).strip()
    }


def _row_add_name(row: sqlite3.Row) -> bool:
    if "add_name" not in row.keys():
        return False
    return bool(row["add_name"])


def _validate_name_colours(
    raw: list[str] | None, *, max_colours: int
) -> list[str]:
    """Colours are independent of add_name (SkinSet display vs apply-name)."""
    try:
        return validate_name_colours(raw, max_colours=max_colours)
    except NameColourError as e:
        raise SubmissionError(str(e)) from e


def _validate_name_styles(raw: list[str] | None) -> list[str]:
    """Styles are independent of add_name."""
    if not raw:
        return []
    out: list[str] = []
    for item in raw:
        s = str(item).strip().lower()
        if s not in ALLOWED_STYLES:
            raise SubmissionError(f"invalid name style '{item}'")
        if s == "underlined":
            s = "underline"
        if s == "strike":
            s = "strikethrough"
        if s not in out:
            out.append(s)
    return out


def _upload_source_for_code_id(code_id: int | None) -> str:
    if code_id is None:
        return "skins"
    with connect() as conn:
        row = conn.execute(
            "SELECT scope FROM codes WHERE id = ?",
            (int(code_id),),
        ).fetchone()
    if row is None:
        return "skins"
    scope = str(row["scope"] or "").strip().lower()
    if scope == SCOPE_LORE_UPLOAD:
        return "kit"
    return "skins"


def _public_row(row: sqlite3.Row) -> dict:
    is_staff = bool(row["staff"]) if "staff" in row.keys() else False
    out = {
        "id": row["id"],
        "kind": row["kind"],
        "slug": row["slug"],
        "display_name": row["display_name"],
        "grip_preset": row["grip_preset"],
        "base_set": _row_base_set(row),
        "tiers": _row_json_list(row, "tiers"),
        "helmet_3d_tiers": _row_json_list(row, "helmet_3d_tiers"),
        "tier_aliases": _row_json_object(row, "tier_aliases"),
        "add_name": _row_add_name(row),
        "name_colours": _row_json_list(row, "name_colours"),
        "name_styles": _row_json_list(row, "name_styles"),
        "status": row["status"],
        "deny_reason": row["deny_reason"],
        "created_at": row["created_at"],
        "reviewed_at": row["reviewed_at"],
        "applied_at": row["applied_at"],
        "discord_user_id": row["discord_user_id"]
        if "discord_user_id" in row.keys()
        else None,
        "staff": is_staff,
    }
    if is_staff:
        out["category"] = row["category"] if "category" in row.keys() else None
        out["scroll"] = row["scroll"] if "scroll" in row.keys() else None
        tiers_map = _row_json_object(row, "tier_scrolls")
        out["tier_scrolls"] = tiers_map or None
    if "code_id" in row.keys():
        out["upload_source"] = _upload_source_for_code_id(row["code_id"])
    return out


def _link_names(player_uuid: str) -> dict:
    link = get_link_for_uuid(player_uuid) or {}
    return {
        "minecraft_name": link.get("minecraft_name"),
        "discord_username": link.get("discord_username"),
        "discord_user_id": link.get("discord_user_id"),
    }


def _validate_base_set(kind: str, base_set: str | None) -> str:
    raw = (base_set or "").strip()
    if not raw:
        raise SubmissionError("base_set is required")
    allowed = BASE_SETS.get(kind)
    if allowed is None or raw not in allowed:
        raise SubmissionError(
            f"base_set '{raw}' is not valid for kind '{kind}'"
        )
    return raw


def _validate_tiers(raw: list[str] | None) -> list[str]:
    if not raw:
        raise SubmissionError("armor_set requires 1–6 tiers")
    if len(raw) > 6:
        raise SubmissionError("at most 6 armor tiers")
    out: list[str] = []
    seen: set[str] = set()
    tier_names = ", ".join(sorted(ARMOR_TIERS))
    for item in raw:
        tier = (item or "").strip().lower()
        if not tier:
            raise SubmissionError("empty tier name")
        if tier not in ARMOR_TIERS:
            raise SubmissionError(
                f"tier '{tier}' is not valid (must be one of: {tier_names})"
            )
        if tier in seen:
            raise SubmissionError(f"duplicate tier '{tier}'")
        seen.add(tier)
        out.append(tier)
    return out


def _validate_tier_aliases(
    tiers: list[str], raw: dict[str, str] | None
) -> dict[str, str]:
    """Per-tier display suffix. Missing → default Iron/Steel/… labels."""
    incoming: dict[str, str] = {}
    if raw:
        for key, value in raw.items():
            tier = str(key).strip().lower()
            if tier not in tiers:
                raise SubmissionError(
                    f"tier_aliases key '{key}' is not in this submission's tiers"
                )
            alias = str(value or "").strip()
            if not alias:
                continue
            try:
                incoming[tier] = assert_display_name(
                    alias,
                    min_len=1,
                    max_len=MAX_TIER_ALIAS_LEN,
                    field=f"tier alias for '{tier}'",
                )
            except TextValidationError as e:
                raise SubmissionError(str(e)) from e
    out: dict[str, str] = {}
    for tier in tiers:
        out[tier] = incoming.get(tier) or ARMOR_TIER_LABELS.get(
            tier, tier.capitalize()
        )
    return out


def _validate_helmet_3d_tiers(
    tiers: list[str], raw: list[str] | None
) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        tier = (item or "").strip().lower()
        if not tier:
            continue
        if tier not in tiers:
            raise SubmissionError(
                f"helmet_3d_tiers entry '{tier}' is not in this submission's tiers"
            )
        if tier in seen:
            continue
        seen.add(tier)
        out.append(tier)
    return out


def _reject_duplicate_textures(files_bytes: dict[str, bytes]) -> None:
    """Every uploaded PNG in a submission must have unique bytes."""
    pngs = {
        field: data
        for field, data in files_bytes.items()
        if data.startswith(b"\x89PNG")
    }
    if len(pngs) < 2:
        return
    seen: dict[str, str] = {}
    for field, data in pngs.items():
        dig = hashlib.sha256(data).hexdigest()
        if dig in seen:
            raise SubmissionError(
                f"File '{field}' is identical to '{seen[dig]}' - "
                "each PNG in a submission must be unique"
            )
        seen[dig] = field


def texture_sha256(files_bytes: dict[str, bytes]) -> str | None:
    data = files_bytes.get("texture") or files_bytes.get("unsigned")
    if not data:
        return None
    return hashlib.sha256(data).hexdigest()


def find_duplicate_texture(
    player_uuid: str,
    base_set: str | None,
    digest: str,
) -> str | None:
    """Return existing submission id if this player already uploaded the PNG."""
    uuid = (player_uuid or "").strip()
    dig = (digest or "").strip().lower()
    base = (base_set or "").strip().lower()
    if not uuid or not dig:
        return None
    with connect() as conn:
        cols = {
            r[1] for r in conn.execute("PRAGMA table_info(submissions)").fetchall()
        }
        if "texture_hash" not in cols:
            return None
        if base:
            row = conn.execute(
                """
                SELECT id FROM submissions
                WHERE LOWER(player_uuid) = LOWER(?)
                  AND LOWER(COALESCE(texture_hash, '')) = ?
                  AND LOWER(COALESCE(base_set, '')) = ?
                  AND status IN (?, ?, ?)
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (uuid, dig, base, *ACTIVE_STATUSES),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT id FROM submissions
                WHERE LOWER(player_uuid) = LOWER(?)
                  AND LOWER(COALESCE(texture_hash, '')) = ?
                  AND status IN (?, ?, ?)
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (uuid, dig, *ACTIVE_STATUSES),
            ).fetchone()
    if row is None:
        return None
    return str(row["id"] or "") or None


def slug_taken(slug: str, realm_id: str | None = None) -> bool:
    from src.skins.codes import normalize_realm_id

    realm = normalize_realm_id(realm_id)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM submissions
            WHERE id = ? AND realm_id = ? AND status IN (?, ?, ?)
            LIMIT 1
            """,
            (slug, realm, *ACTIVE_STATUSES),
        ).fetchone()
    return row is not None


def staff_skin_set_key_taken(
    slug: str,
    kind: str,
    tiers: list[str] | None,
) -> str | None:
    """Return a colliding shop/set key among active submissions, else None.

    Covers bare submission ids and armor ``{id}_{tier}`` shop keys so staff
    collisions do not depend only on the last catalog sync.
    """
    candidate: set[str] = {(slug or "").strip()}
    if kind == "armor_set":
        for tier in tiers or []:
            t = (tier or "").strip()
            if t:
                candidate.add(f"{slug}_{t}")
    candidate.discard("")
    if not candidate:
        return None

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, kind, tiers FROM submissions
            WHERE status IN (?, ?, ?)
            """,
            ACTIVE_STATUSES,
        ).fetchall()

    for row in rows:
        existing: set[str] = {str(row["id"])}
        if row["kind"] == "armor_set":
            for tier in _row_json_list(row, "tiers"):
                t = (tier or "").strip()
                if t:
                    existing.add(f"{row['id']}_{t}")
        overlap = candidate & existing
        if overlap:
            return sorted(overlap)[0]
    return None


def check_player_conflicts(
    player_uuid: str,
    *,
    display_name: str | None = None,
    submission_id: str | None = None,
) -> dict:
    """Return conflicts for same-player active display_name and/or submission id."""
    uuid = (player_uuid or "").strip()
    display = (display_name or "").strip()
    sid = (submission_id or "").strip() or None
    conflicts: list[dict] = []
    if not uuid:
        return {"ok": True, "conflicts": conflicts}

    if sid is None and display:
        link = get_link_for_uuid(uuid) or {}
        minecraft_name = link.get("minecraft_name")
        if minecraft_name:
            try:
                sid = build_submission_id(minecraft_name, display)
            except SlugError:
                pass

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, slug, display_name, status, kind
            FROM submissions
            WHERE player_uuid = ? AND status IN (?, ?, ?)
            """,
            (uuid, *ACTIVE_STATUSES),
        ).fetchall()

    for row in rows:
        reasons: list[str] = []
        row_display = str(row["display_name"]).strip()
        if display and row_display.lower() == display.lower():
            reasons.append("display_name")
        elif display:
            try:
                new_slug = slugify_display_name(display)
                row_slug = slugify_display_name(row_display)
                if new_slug.lower() == row_slug.lower():
                    reasons.append("display_name")
            except SlugError:
                pass
        row_id = str(row["id"])
        if sid and row_id == sid:
            reasons.append("id")
        if reasons:
            conflicts.append(
                {
                    "id": row["id"],
                    "slug": row["slug"],
                    "display_name": row["display_name"],
                    "status": row["status"],
                    "kind": row["kind"],
                    "reasons": reasons,
                }
            )
    return {"ok": len(conflicts) == 0, "conflicts": conflicts}


def _assert_no_active_submission_for_code(code_id: int) -> None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM submissions
            WHERE code_id = ? AND status IN (?, ?)
            LIMIT 1
            """,
            (int(code_id), *_BLOCK_STATUSES),
        ).fetchone()
    if row is not None:
        raise SubmissionError("This code already has an active submission")


def create_submission(
    session_row,
    kind: str,
    display_name: str,
    files_bytes: dict[str, bytes],
    grip_preset: str | None = None,
    base_set: str | None = None,
    *,
    tiers: list[str] | None = None,
    tier_aliases: dict[str, str] | None = None,
    helmet_3d_tiers: list[str] | None = None,
    filenames: dict[str, str | None] | None = None,
    add_name: bool = False,
    name_colours: list[str] | None = None,
    name_styles: list[str] | None = None,
    category: str | None = None,
    scroll: str | None = None,
    tier_scrolls: dict[str, str] | None = None,
    source: str = "skins",
) -> dict:
    _ = filenames  # upload names ignored for identity

    kind = (kind or "").strip()
    if kind == "item":
        raise SubmissionError("kind 'item' is disabled")
    if kind not in ALLOWED_KINDS:
        raise SubmissionError(
            "kind must be armor_set, handheld, large_handheld, "
            "bow, large_bow, crossbow, item_3d, shield, helmet_3d, mask, gun, or book"
        )

    try:
        display = assert_display_name(
            display_name,
            min_len=1,
            max_len=MAX_DISPLAY_NAME,
            field="item name",
        )
    except TextValidationError as e:
        raise SubmissionError(str(e)) from e

    source_norm = (source or "skins").strip().lower()
    if source_norm not in ("skins", "lore"):
        raise SubmissionError("invalid submission source")
    if source_norm != "lore":
        _assert_no_active_submission_for_code(int(session_row["code_id"]))

    grip_y = parse_grip_y(grip_preset)
    if kind == "large_handheld":
        if grip_y is None:
            raise SubmissionError(
                f"large_handheld requires grip_preset between {GRIP_Y_MIN} and {GRIP_Y_MAX}"
            )
        grip = f"{grip_y:.1f}"
    elif grip_y is not None:
        raise SubmissionError("grip_preset is only allowed for large_handheld")
    else:
        grip = None

    is_staff = False
    try:
        is_staff = bool(session_row["staff"])
    except (KeyError, IndexError, TypeError):
        is_staff = False

    from src.skins.codes import normalize_realm_id

    try:
        realm = normalize_realm_id(session_row.get("realm_id"))
    except Exception:
        realm = "main"

    entitlements = resolve_web_entitlements(
        str(session_row["player_uuid"] or ""),
        staff=is_staff,
        realm_id=realm,
    )
    colour_cap = int(entitlements["name_colour_stops"])
    pair_cap = int(entitlements["max_3d_pair_bytes"])
    allowed_kinds = {
        str(k).strip().lower()
        for k in (entitlements.get("skin_kinds") or [])
        if str(k).strip()
    }
    allow_armor_3d = bool(entitlements.get("allow_armor_3d_helmet"))
    if not is_staff:
        if kind not in allowed_kinds:
            raise SubmissionError(
                f"Your rank cannot upload kind '{kind}'"
            )

    want_add_name = bool(add_name)
    colours = _validate_name_colours(name_colours, max_colours=colour_cap)
    styles = _validate_name_styles(name_styles)
    colours_json = json.dumps(colours) if colours else None
    styles_json = json.dumps(styles) if styles else None

    tier_list: list[str] | None
    aliases: dict[str, str] | None
    h3d_list: list[str]
    if kind == "armor_set":
        tier_list = _validate_tiers(tiers)
        aliases = _validate_tier_aliases(tier_list, tier_aliases)
        h3d_list = _validate_helmet_3d_tiers(tier_list, helmet_3d_tiers)
        if h3d_list and not is_staff and not allow_armor_3d:
            raise SubmissionError(
                "Your rank cannot upload 3D helmets on armor sets"
            )
        base: str | None = None
        for tier in tier_list:
            missing: list[str] = []
            for field in ("chestplate", "leggings", "boots", "layer_1", "layer_2"):
                if f"{tier}_{field}" not in files_bytes:
                    missing.append(f"{tier}_{field}")
            if tier in h3d_list:
                for field in ("helmet_model", "helmet_texture"):
                    if f"{tier}_{field}" not in files_bytes:
                        missing.append(f"{tier}_{field}")
            else:
                if f"{tier}_helmet" not in files_bytes:
                    missing.append(f"{tier}_helmet")
            if missing:
                raise SubmissionError(f"Missing files: {', '.join(missing)}")
    else:
        if tiers:
            raise SubmissionError("tiers are only allowed for armor_set")
        if tier_aliases:
            raise SubmissionError("tier_aliases are only allowed for armor_set")
        if helmet_3d_tiers:
            raise SubmissionError(
                "helmet_3d_tiers are only allowed for armor_set"
            )
        tier_list = None
        aliases = None
        h3d_list = []
        base = _validate_base_set(kind, base_set)
        if kind in BOW_KINDS:
            missing = [f for f in BOW_FRAME_FIELDS if f not in files_bytes]
            if missing:
                raise SubmissionError(f"Missing files: {', '.join(missing)}")
        elif kind in CROSSBOW_KINDS:
            missing = [
                f for f in CROSSBOW_FRAME_FIELDS if f not in files_bytes
            ]
            if missing:
                raise SubmissionError(f"Missing files: {', '.join(missing)}")
        elif kind in MODEL_3D_KINDS:
            if "texture" not in files_bytes:
                raise SubmissionError("Missing file: texture")
            if "model" not in files_bytes:
                raise SubmissionError("Missing file: model")
        elif kind == GUN_KIND:
            missing = [f for f in GUN_FIELDS if f not in files_bytes]
            if missing:
                raise SubmissionError(f"Missing files: {', '.join(missing)}")
        elif kind == BOOK_KIND:
            missing = [f for f in BOOK_FIELDS if f not in files_bytes]
            if missing:
                raise SubmissionError(f"Missing files: {', '.join(missing)}")
        elif "texture" not in files_bytes:
            raise SubmissionError("Missing file: texture")

    try:
        assert_3d_pair_budgets(
            kind,
            files_bytes,
            pair_cap,
            helmet_3d_tiers=h3d_list if kind == "armor_set" else None,
        )
    except SizeLimitError as e:
        raise SubmissionError(str(e)) from e

    _reject_duplicate_textures(files_bytes)

    player_uuid = session_row["player_uuid"]
    link = get_link_for_uuid(player_uuid)
    if not link or not link.get("discord_user_id"):
        raise SubmissionError(
            "Link Discord in-game with /linkdiscord first"
        )
    minecraft_name = link.get("minecraft_name")
    if not minecraft_name:
        raise SubmissionError(
            "Minecraft name missing - re-link Discord or wait for API migrate"
        )

    try:
        if is_staff:
            submission_id = build_staff_submission_id(display, realm)
        else:
            submission_id = build_submission_id_for_realm(
                minecraft_name, display, realm
            )
    except SlugError:
        raise

    slug = submission_id

    if not is_staff:
        conflict = check_player_conflicts(
            player_uuid, display_name=display, submission_id=submission_id
        )
        if not conflict["ok"]:
            reasons = set()
            for c in conflict["conflicts"]:
                reasons.update(c.get("reasons") or [])
            if "display_name" in reasons and "id" in reasons:
                msg = (
                    "You already have an active skin with this item name "
                    "and id. Delete it in-game or choose a different item name."
                )
            elif "display_name" in reasons:
                msg = (
                    "You already have an active skin named "
                    f"'{display}'. Choose a different item name "
                    "or ask staff to delete the old one."
                )
            else:
                msg = (
                    f"You already have an active skin with id '{submission_id}'. "
                    "Choose a different item name or ask staff to delete the old one."
                )
            raise SubmissionError(msg)

        if slug_taken(submission_id, realm):
            raise SlugConflictError(
                f"A skin with id '{submission_id}' is already in use. "
                "Choose a different item name and try again."
            )
    else:
        taken = staff_skin_set_key_taken(submission_id, kind, tier_list)
        if taken:
            raise SlugConflictError(
                f"Skin set key '{taken}' is invalid - already in use by an "
                "active submission. Choose a different item name."
            )

    category_raw = (category or "").strip() or None
    scroll_raw = (scroll or "").strip() or None
    has_staff_fields = bool(category_raw or scroll_raw or tier_scrolls)
    staff_category: str | None = None
    staff_scroll: str | None = None
    staff_tier_scrolls_json: str | None = None

    if not is_staff:
        if has_staff_fields:
            raise SubmissionError(
                "category, scroll, and tier_scrolls are only allowed for staff tokens"
            )
    else:
        from .catalog import CatalogError, validate_staff_landing

        try:
            landing = validate_staff_landing(
                category=category_raw,
                scroll=scroll_raw,
                tier_scrolls=tier_scrolls,
                kind=kind,
                tiers=tier_list,
                slug=slug,
            )
        except CatalogError as e:
            raise SubmissionError(str(e)) from e
        staff_category = landing["category"]
        staff_scroll = landing["scroll"]
        if landing["tier_scrolls"] is not None:
            staff_tier_scrolls_json = json.dumps(landing["tier_scrolls"])

    tiers_json = json.dumps(tier_list) if tier_list else None
    aliases_json = json.dumps(aliases) if aliases else None
    h3d_json = json.dumps(h3d_list) if h3d_list else None
    tex_hash = texture_sha256(files_bytes)
    if not is_staff and tex_hash:
        dup_id = find_duplicate_texture(player_uuid, base, tex_hash)
        if dup_id:
            raise SubmissionError(
                f"This texture already exists as skin '{dup_id}'. "
                "Pick the existing skin instead of uploading again."
            )
    dir_path = f"skins/{submission_id}"
    created_at = _iso_now()
    code_id = session_row["code_id"]
    discord_id = str(link["discord_user_id"])
    status = "approved" if is_staff else "pending"
    reviewed_at = created_at if is_staff else None

    with connect() as conn:
        try:
            cols = {
                r[1] for r in conn.execute("PRAGMA table_info(submissions)").fetchall()
            }
            if "texture_hash" in cols:
                conn.execute(
                    """
                    INSERT INTO submissions (
                        id, player_uuid, code_id, kind, slug, display_name,
                        grip_preset, base_set, tiers, helmet_3d_tiers, tier_aliases,
                        add_name, name_colours, name_styles,
                        status, deny_reason, dir_path,
                        created_at, reviewed_at, applied_at, discord_message_id,
                        discord_user_id, staff, category, scroll, tier_scrolls,
                        texture_hash, realm_id
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?,
                        ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?
                    )
                    """,
                    (
                        submission_id,
                        player_uuid,
                        code_id,
                        kind,
                        slug,
                        display,
                        grip,
                        base,
                        tiers_json,
                        h3d_json,
                        aliases_json,
                        1 if want_add_name else 0,
                        colours_json,
                        styles_json,
                        status,
                        dir_path,
                        created_at,
                        reviewed_at,
                        discord_id,
                        1 if is_staff else 0,
                        staff_category,
                        staff_scroll,
                        staff_tier_scrolls_json,
                        tex_hash,
                        realm,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO submissions (
                        id, player_uuid, code_id, kind, slug, display_name,
                        grip_preset, base_set, tiers, helmet_3d_tiers, tier_aliases,
                        add_name, name_colours, name_styles,
                        status, deny_reason, dir_path,
                        created_at, reviewed_at, applied_at, discord_message_id,
                        discord_user_id, staff, category, scroll, tier_scrolls,
                        realm_id
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?,
                        ?, NULL, NULL, ?, ?, ?, ?, ?, ?
                    )
                    """,
                    (
                        submission_id,
                        player_uuid,
                        code_id,
                        kind,
                        slug,
                        display,
                        grip,
                        base,
                        tiers_json,
                        h3d_json,
                        aliases_json,
                        1 if want_add_name else 0,
                        colours_json,
                        styles_json,
                        status,
                        dir_path,
                        created_at,
                        reviewed_at,
                        discord_id,
                        1 if is_staff else 0,
                        staff_category,
                        staff_scroll,
                        staff_tier_scrolls_json,
                        realm,
                    ),
                )
            conn.commit()
        except sqlite3.IntegrityError as e:
            if is_staff:
                raise SlugConflictError(
                    f"Skin set key '{submission_id}' is invalid - already in use. "
                    "Choose a different item name."
                ) from e
            raise SlugConflictError(
                f"A skin with id '{submission_id}' is already in use. "
                "Choose a different item name, or ask staff to delete the old one."
            ) from e

    try:
        write_submission_files(
            submission_id,
            slug,
            kind,
            display,
            files_bytes,
            grip_preset=grip,
            base_set=base,
            tiers=tier_list,
            helmet_3d_tiers=h3d_list,
            tier_aliases=aliases,
            add_name=want_add_name,
            name_colours=colours,
            name_styles=styles,
        )
        write_name_preview(
            submission_id,
            display,
            name_colours=colours,
            name_styles=styles,
        )
        # review_sheet.png is composed on first GET (build_review_sheet) so the
        # upload response stays fast (multi-tier armor + SSH tunnels).
    except StorageError:
        _rollback_submission(submission_id)
        raise
    except Exception:
        _rollback_submission(submission_id)
        raise

    if not is_staff:
        enqueue_submitted(
            submission_id,
            discord_id,
            display_name=display,
            kind=kind,
            slug=slug,
        )

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()

    from src.skins.codes import mark_code_consumed

    if source_norm != "lore":
        mark_code_consumed(code_id)

    return _public_row(row)


def _rollback_submission(submission_id: str) -> None:
    with connect() as conn:
        row = conn.execute(
            "SELECT code_id FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
        if row is None:
            return
        code_id = row["code_id"]
        conn.execute("DELETE FROM submissions WHERE id = ?", (submission_id,))
        conn.execute(
            "UPDATE codes SET redeemed_at = NULL WHERE id = ?",
            (code_id,),
        )
        conn.commit()
    out = SKINS_DIR / submission_id
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)


def rollback_pending_submission_if_unreferenced(
    submission_id: str,
    *,
    player_uuid: str | None = None,
) -> bool:
    """Drop a pending submission when no lore customise row still references it."""
    sid = (submission_id or "").strip()
    if not sid:
        return False
    uuid = (player_uuid or "").strip() or None
    with connect() as conn:
        row = conn.execute(
            """
            SELECT player_uuid, status
            FROM submissions
            WHERE id = ?
            """,
            (sid,),
        ).fetchone()
        if row is None:
            return False
        if str(row["status"] or "").strip().lower() != "pending":
            return False
        owner = str(row["player_uuid"] or "").strip()
        if uuid and owner.lower() != uuid.lower():
            return False
        ref = conn.execute(
            """
            SELECT 1 FROM lore_item_customisations
            WHERE submission_id = ?
            LIMIT 1
            """,
            (sid,),
        ).fetchone()
        if ref is not None:
            return False
    _rollback_submission(sid)
    return True


def rollback_pending_submissions_if_unreferenced(
    submission_ids: list[str],
    *,
    player_uuid: str | None = None,
) -> int:
    """Rollback pending submissions with no remaining lore customise references."""
    seen: set[str] = set()
    rolled_back = 0
    for raw in submission_ids:
        sid = (raw or "").strip()
        if not sid or sid in seen:
            continue
        seen.add(sid)
        if rollback_pending_submission_if_unreferenced(
            sid, player_uuid=player_uuid
        ):
            rolled_back += 1
    return rolled_back


def get_submission_for_owner(
    submission_id: str, player_uuid: str
) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
    if row is None or row["player_uuid"] != player_uuid:
        return None
    return _public_row(row)


def list_submissions_for_player(
    player_uuid: str,
    realm_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    from src.skins.codes import normalize_realm_id

    uuid = (player_uuid or "").strip()
    if not uuid:
        return []
    realm = normalize_realm_id(realm_id)
    cap = max(1, min(int(limit or 50), 100))
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM submissions
            WHERE player_uuid = ? AND realm_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (uuid, realm, cap),
        ).fetchall()
    return [_public_row(row) for row in rows]


def _get_row(submission_id: str) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()


def _list_asset_files(submission_id: str) -> list[str]:
    """PNG + model JSON for plugin download (excludes meta.json)."""
    from .pack_models.regen import ensure_pack_models

    ensure_pack_models(submission_id)
    out_dir = SKINS_DIR / submission_id
    if not out_dir.is_dir():
        return []
    names = sorted(
        p.name
        for p in out_dir.iterdir()
        if p.is_file()
        and (
            p.suffix.lower() == ".png"
            or (
                p.suffix.lower() == ".json"
                and p.name.lower() != "meta.json"
            )
        )
    )
    preferred = []
    for key in ("review_sheet.png", "name_preview.png"):
        if key in names:
            preferred.append(key)
            names = [n for n in names if n != key]
    return preferred + names


def _list_png_files(submission_id: str) -> list[str]:
    """Back-compat alias — includes JSON model files for apply."""
    return _list_asset_files(submission_id)


def approve_submission(submission_id: str) -> dict:
    row = _get_row(submission_id)
    if row is None:
        raise SubmissionError("Submission not found")
    if row["status"] != "pending":
        raise SubmissionError("Only pending submissions can be approved")

    reviewed_at = _iso_now()
    with connect() as conn:
        conn.execute(
            """
            UPDATE submissions
            SET status = 'approved', reviewed_at = ?, deny_reason = NULL
            WHERE id = ?
            """,
            (reviewed_at, submission_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (submission_id,),
        ).fetchone()
    return _public_row(row)


def deny_submission(submission_id: str, reason: str) -> dict:
    """Deny a pending submission: notify payload, lore clear, then hard purge.

    Denied rows are not retained (PK must free for resubmit). Response is
    ephemeral for Discord/API clients.
    """
    try:
        reason = assert_prose(reason, min_len=1, max_len=200, field="deny reason")
    except TextValidationError as e:
        raise SubmissionError(str(e)) from e

    row = _get_row(submission_id)
    if row is None:
        raise SubmissionError("Submission not found")
    if row["status"] != "pending":
        raise SubmissionError("Only pending submissions can be denied")

    reviewed_at = _iso_now()
    payload = _public_row(row)
    payload["status"] = "denied"
    payload["deny_reason"] = reason
    payload["reviewed_at"] = reviewed_at

    try:
        from src.characters.lore_items import clear_pending_submission

        clear_pending_submission(submission_id, reason=reason)
    except Exception:
        pass

    _rollback_submission(submission_id)
    return payload


def list_pending() -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM submissions
            WHERE status = 'pending'
            ORDER BY created_at ASC
            """
        ).fetchall()

    result = []
    for row in rows:
        names = _link_names(row["player_uuid"])
        result.append(
            {
                "id": row["id"],
                "player_uuid": row["player_uuid"],
                "slug": row["slug"],
                "kind": row["kind"],
                "display_name": row["display_name"],
                "grip_preset": row["grip_preset"],
                "base_set": _row_base_set(row),
                "tiers": _row_json_list(row, "tiers"),
                "helmet_3d_tiers": _row_json_list(row, "helmet_3d_tiers"),
                "tier_aliases": _row_json_object(row, "tier_aliases"),
                "add_name": _row_add_name(row),
                "name_colours": _row_json_list(row, "name_colours"),
                "name_styles": _row_json_list(row, "name_styles"),
                "created_at": row["created_at"],
                "discord_user_id": names.get("discord_user_id")
                or (
                    row["discord_user_id"]
                    if "discord_user_id" in row.keys()
                    else None
                ),
                "minecraft_name": names.get("minecraft_name"),
                "discord_username": names.get("discord_username"),
                "upload_source": _upload_source_for_code_id(
                    row["code_id"] if "code_id" in row.keys() else None
                ),
                "files": _list_asset_files(row["id"]),
            }
        )
    return result


def list_approved_pending_apply(
    since: str | None = None,
    realm_id: str | None = None,
) -> list[dict]:
    from src.skins.codes import normalize_realm_id

    realm = normalize_realm_id(realm_id)
    sql = """
        SELECT * FROM submissions
        WHERE status = 'approved' AND applied_at IS NULL AND realm_id = ?
    """
    params: list = [realm]
    if since:
        sql += " AND reviewed_at >= ?"
        params.append(since.strip())
    sql += " ORDER BY reviewed_at ASC"

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()

    result = []
    for row in rows:
        names = _link_names(row["player_uuid"])
        is_staff = False
        if "staff" in row.keys():
            is_staff = bool(row["staff"])
        entry = {
            "id": row["id"],
            "player_uuid": row["player_uuid"],
            "slug": row["slug"],
            "kind": row["kind"],
            "display_name": row["display_name"],
            "grip_preset": row["grip_preset"],
            "base_set": _row_base_set(row),
            "tiers": _row_json_list(row, "tiers"),
            "helmet_3d_tiers": _row_json_list(row, "helmet_3d_tiers"),
            "tier_aliases": _row_json_object(row, "tier_aliases"),
            "add_name": _row_add_name(row),
            "name_colours": _row_json_list(row, "name_colours"),
            "name_styles": _row_json_list(row, "name_styles"),
            "reviewed_at": row["reviewed_at"],
            "minecraft_name": names.get("minecraft_name"),
            "discord_username": names.get("discord_username"),
            "files": _list_asset_files(row["id"]),
            "staff": is_staff,
            "realm_id": realm,
        }
        if is_staff:
            from .catalog import IA_NAMESPACE_ARMOURSHOP

            entry["category"] = (
                row["category"] if "category" in row.keys() else None
            )
            entry["scroll"] = row["scroll"] if "scroll" in row.keys() else None
            tiers_map = _row_json_object(row, "tier_scrolls")
            entry["tier_scrolls"] = tiers_map or None
            entry["ia_namespace"] = IA_NAMESPACE_ARMOURSHOP
        result.append(entry)
    return result


def get_submission_for_plugin(submission_id: str) -> dict | None:
    sid = (submission_id or "").strip()
    if not sid:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM submissions WHERE id = ?",
            (sid,),
        ).fetchone()
    if row is None:
        return None
    names = _link_names(row["player_uuid"])
    is_staff = False
    if "staff" in row.keys():
        is_staff = bool(row["staff"])
    out = {
        "id": row["id"],
        "player_uuid": row["player_uuid"],
        "slug": row["slug"],
        "kind": row["kind"],
        "display_name": row["display_name"],
        "status": row["status"],
        "base_set": _row_base_set(row),
        "tiers": _row_json_list(row, "tiers"),
        "minecraft_name": names.get("minecraft_name"),
        "staff": is_staff,
        "category": None,
        "ia_namespace": None,
    }
    if is_staff:
        from .catalog import IA_NAMESPACE_ARMOURSHOP

        out["category"] = (
            row["category"] if "category" in row.keys() else None
        )
        out["ia_namespace"] = IA_NAMESPACE_ARMOURSHOP
    return out


def _row_is_staff(row: sqlite3.Row) -> bool:
    if "staff" not in row.keys():
        return False
    return bool(row["staff"])


def list_deletable_submissions() -> list[dict]:
    """Active player-lane submissions for /armourshop submission delete tab-complete."""
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, slug, display_name, kind, status, created_at, staff
            FROM submissions
            WHERE status IN (?, ?, ?)
            ORDER BY created_at DESC
            """,
            ACTIVE_STATUSES,
        ).fetchall()
    return [
        {
            "id": row["id"],
            "slug": row["slug"],
            "display_name": row["display_name"],
            "kind": row["kind"],
            "status": row["status"],
        }
        for row in rows
        if not _row_is_staff(row)
    ]


def list_deletable_staff_skins() -> list[dict]:
    """Active staff-lane skins for /armourshop skin delete tab-complete."""
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, slug, display_name, kind, status, created_at, staff, category
            FROM submissions
            WHERE status IN (?, ?, ?)
            ORDER BY created_at DESC
            """,
            ACTIVE_STATUSES,
        ).fetchall()
    return [
        {
            "id": row["id"],
            "slug": row["slug"],
            "display_name": row["display_name"],
            "kind": row["kind"],
            "status": row["status"],
            "category": row["category"] if "category" in row.keys() else None,
        }
        for row in rows
        if _row_is_staff(row)
    ]


def revoke_submission(submission_id: str) -> dict:
    """Hard-delete a submission row and its on-disk files (staff delete).

    Any status is allowed (pending/approved/applied/revoked). Denied is not
    stored (deny already purges). Missing id raises SubmissionError so the
    plugin can report "Submission not found".
    """
    sid = (submission_id or "").strip()
    if not sid:
        raise SubmissionError("submission id is required")
    row = _get_row(sid)
    if row is None:
        raise SubmissionError("Submission not found")

    with connect() as conn:
        conn.execute("DELETE FROM submissions WHERE id = ?", (sid,))
        conn.commit()
    out = SKINS_DIR / sid
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)

    return {"id": sid, "deleted": True}


def mark_applied(submission_ids: list[str]) -> list[str]:
    applied: list[str] = []
    now = _iso_now()
    with connect() as conn:
        for sid in submission_ids:
            sid = (sid or "").strip()
            if not sid:
                continue
            cur = conn.execute(
                """
                UPDATE submissions
                SET status = 'applied', applied_at = ?
                WHERE id = ? AND status = 'approved' AND applied_at IS NULL
                """,
                (now, sid),
            )
            if cur.rowcount:
                applied.append(sid)
        conn.commit()
    if applied:
        try:
            from src.characters.lore_items import promote_ready_for_submissions

            promote_ready_for_submissions(applied)
        except Exception:
            # Fail-soft: pack apply must not die on lore customise glue.
            pass
    return applied


def resolve_submission_file(submission_id: str, filename: str) -> Path | None:
    name = (filename or "").strip()
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        return None
    if ".." in name:
        return None

    from .pack_models.regen import ensure_pack_models

    ensure_pack_models(submission_id)

    base = (SKINS_DIR / submission_id).resolve()
    if not base.is_dir():
        return None

    candidate = (base / name).resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        return None

    if not candidate.is_file() and name == "review_sheet.png":
        # Compose on demand — create no longer always writes this file.
        try:
            from .review_sheet import ReviewSheetError, write_review_sheet

            write_review_sheet(submission_id)
        except ReviewSheetError:
            return None
        except Exception:
            return None

    if not candidate.is_file():
        return None
    return candidate
