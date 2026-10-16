"""Character skin wardrobe CRUD (player skins per slot)."""

from __future__ import annotations

import io
import logging
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from src import database
from src.characters import wardrobe_assets as assets
from src.characters.wardrobe_sign import sign_wardrobe_skin
from src.characters.pending_create import (
    PendingCreateError,
    require_living,
    resolve_player_character,
)
from src.characters.times import api_time
from src.skins.db import DATA_DIR, WARDROBE_DIR
from src.skins.storage import StorageError, validate_png
from src.text_validation import TextValidationError, assert_optional_display_name

SLOTS = ("base", "extra_1", "extra_2", "masked")
SWAPPABLE_SLOTS = frozenset({"base", "extra_1", "extra_2"})
SWAPPABLE_ORDER = ("base", "extra_1", "extra_2")
WARDROBE_PNG_SIZE = (64, 64)
DEFAULT_SLOT_NAMES = {
    "base": "Base",
    "extra_1": "Skin 2",
    "extra_2": "Skin 3",
    "masked": "Masked",
}
DISPLAY_NAME_MAX = 24
MAX_TEMPLATE_BYTES = 2 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

logger = logging.getLogger("characters.wardrobe")


class WardrobeError(ValueError):
    """Business-rule failure for wardrobe routes."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _png_upload_diag(data: bytes) -> str:
    if not data:
        return "len=0 magic_ok=False ihdr=?"
    magic_ok = data.startswith(PNG_MAGIC)
    ihdr = "?"
    if magic_ok and len(data) >= 24 and data[12:16] == b"IHDR":
        try:
            w, h = struct.unpack(">II", data[16:24])
            ihdr = f"{w}x{h}"
        except struct.error:
            pass
    return f"len={len(data)} magic_ok={magic_ok} ihdr={ihdr}"


def _mask_player_uuid_for_log(player_uuid: str) -> str:
    u = (player_uuid or "").strip()
    if len(u) <= 4:
        return "****"
    return f"…{u[-4:]}"


def _log_wardrobe_upload_failure(
    exc: WardrobeError,
    *,
    kind: str,
    target_id: str,
    slot: str,
    player_uuid: str,
    png_bytes: bytes,
    create_masked: bool = False,
    model_override: str | None = None,
) -> None:
    logger.warning(
        "[wardrobe] upload failed kind=%s target_id=%s slot=%s player=%s "
        "create_masked=%s model=%s status=%s detail=%s diag=%s",
        kind,
        (target_id or "").strip() or "?",
        (slot or "").strip() or "?",
        _mask_player_uuid_for_log(player_uuid),
        create_masked,
        (model_override or "").strip() or "-",
        exc.status_code,
        str(exc),
        _png_upload_diag(png_bytes),
    )


def swappable_slot_count(
    player_uuid: str,
    *,
    realm_id: str | None = None,
) -> int:
    """Number of swappable skins (base + extras). From TFMCWeb rpc_player_meta."""
    from src.characters.rpc_player_meta import resolve_web_entitlements

    uuid = (player_uuid or "").strip()
    ent = resolve_web_entitlements(uuid, realm_id=realm_id)
    try:
        return max(1, min(3, int(ent.get("wardrobe_skin_slots") or 1)))
    except (TypeError, ValueError):
        return 1


def _swappable_for_roster(player_uuid: str, character_id: str) -> int:
    row = _require_owned_character(player_uuid, character_id)
    return swappable_slot_count(
        str(row["player_uuid"]),
        realm_id=row.get("realm_id"),
    )


def _swappable_for_pending(player_uuid: str, create_id: str) -> int:
    row = _require_pending_create(player_uuid, create_id)
    return swappable_slot_count(
        str(row["player_uuid"]),
        realm_id=row.get("realm_id"),
    )


def _slot_unlocked(slot: str, swappable: int) -> bool:
    if slot == "base" or slot == "masked":
        return True
    if slot == "extra_1":
        return swappable >= 2
    if slot == "extra_2":
        return swappable >= 3
    return False


def _normalize_slot(slot: str | None) -> str:
    s = (slot or "").strip().lower()
    if s not in SLOTS:
        raise WardrobeError(
            f"Invalid slot (expected one of: {', '.join(SLOTS)})",
            status_code=400,
        )
    return s


def _require_character_id(character_id: str | None) -> str:
    cid = (character_id or "").strip()
    if not cid:
        raise WardrobeError("character_id is required", status_code=400)
    return cid


def _require_owned_character(
    player_uuid: str, character_id: str, *, realm_id: str | None = None,
) -> dict[str, Any]:
    uuid = (player_uuid or "").strip()
    cid = _require_character_id(character_id)
    if not uuid:
        raise WardrobeError("player_uuid is required", status_code=400)
    with database.connect() as conn:
        row = conn.execute(
            """
            SELECT player_uuid, character_id, wardrobe_active_slot, realm_id
            FROM character_roster
            WHERE player_uuid = %s AND character_id = %s
            """ + (" AND realm_id = %s" if realm_id is not None else ""),
            (uuid, cid, realm_id) if realm_id is not None else (uuid, cid),
        ).fetchone()
    if row is None:
        raise WardrobeError("Character not found on roster", status_code=403)
    return dict(row)


def detect_skin_model(png_bytes: bytes) -> str:
    """Return classic or slim from a 64x64 skin PNG (arm column alpha heuristic)."""
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    except Exception as e:
        raise WardrobeError(f"Invalid PNG: {e}", status_code=400) from e
    if img.size != WARDROBE_PNG_SIZE:
        raise WardrobeError(
            f"PNG must be 64x64, got {img.size[0]}x{img.size[1]}",
            status_code=400,
        )
    # Right arm outer column on classic occupies x=54–55; slim leaves it empty.
    # Sample (54, 20) on the right-arm region of the base layer.
    alpha = img.getpixel((54, 20))[3]
    return "slim" if alpha == 0 else "classic"


def resolve_skin_model(png_bytes: bytes, override: str | None) -> str:
    """Use client override when valid, else auto-detect from PNG."""
    m = (override or "").strip().lower()
    if m == "slim":
        return "slim"
    if m in ("classic", "wide", "default"):
        return "classic"
    return detect_skin_model(png_bytes)


def _backend_root() -> Path:
    # .../ProvinceSystem/backend/src/characters/wardrobe.py → backend/
    return Path(__file__).resolve().parents[2]


def _wardrobe_assets_dir() -> Path:
    """Templates baked into the image."""
    return _backend_root() / "assets" / "wardrobe"


def _wardrobe_synced_dir() -> Path:
    """Plugin-synced templates, in the data mount so they outlive image rebuilds."""
    return DATA_DIR / "plugin-assets" / "wardrobe"


def _masked_template_path() -> Path | None:
    for folder in (_wardrobe_synced_dir(), _wardrobe_assets_dir()):
        path = folder / "masked.png"
        if path.is_file():
            return path
    return None


def store_masked_template(data: bytes) -> dict[str, Any]:
    """Plugin-synced masked body template (64x64 PNG)."""
    import os

    if not data:
        raise WardrobeError("empty body", status_code=400)
    if len(data) > MAX_TEMPLATE_BYTES:
        raise WardrobeError(
            f"PNG exceeds max size ({MAX_TEMPLATE_BYTES} bytes)",
            status_code=400,
        )
    if not data.startswith(PNG_MAGIC):
        raise WardrobeError("body must be a PNG", status_code=400)
    try:
        validate_png(data, WARDROBE_PNG_SIZE)
    except StorageError as e:
        raise WardrobeError(str(e), status_code=400) from e

    out_dir = _wardrobe_synced_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "masked.png"
    tmp = out_dir / ".masked.png.tmp"
    try:
        tmp.write_bytes(data)
        os.replace(tmp, target)
    except OSError as e:
        try:
            if tmp.is_file():
                tmp.unlink()
        except OSError:
            pass
        raise WardrobeError(
            f"could not write masked template: {e}", status_code=500
        ) from e
    return {
        "ok": True,
        "name": "masked",
        "path": "data/plugin-assets/wardrobe/masked.png",
    }


def load_masked_template() -> bytes:
    path = _masked_template_path()
    if path is None:
        raise WardrobeError(
            "Masked template not synced - reload RPCharacters on the game server",
            status_code=400,
        )
    return path.read_bytes()


def resolve_masked_template_path() -> Path:
    path = _masked_template_path()
    if path is None:
        raise WardrobeError("Masked template missing", status_code=404)
    return path


def compose_masked_skin(base_png: bytes, template_png: bytes) -> bytes:
    """Paste base head+hat (y 0–16) onto the masked body template."""
    try:
        base = Image.open(io.BytesIO(base_png)).convert("RGBA")
        templ = Image.open(io.BytesIO(template_png)).convert("RGBA")
    except Exception as e:
        raise WardrobeError(f"Invalid PNG: {e}", status_code=400) from e
    if base.size != WARDROBE_PNG_SIZE or templ.size != WARDROBE_PNG_SIZE:
        raise WardrobeError("Skin and template must be 64x64", status_code=400)
    out = templ.copy()
    out.paste(base.crop((0, 0, 64, 16)), (0, 0))
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def _slot_filled(slots: dict[str, dict[str, Any]], slot: str) -> bool:
    row = slots.get(slot)
    return bool(row and row.get("png_relpath"))


def _require_sequential_fill(
    slot_key: str, slots: dict[str, dict[str, Any]]
) -> None:
    if slot_key == "extra_1" and not _slot_filled(slots, "base"):
        raise WardrobeError("Upload Base before Skin 2", status_code=400)
    if slot_key == "extra_2" and not _slot_filled(slots, "extra_1"):
        raise WardrobeError("Upload Skin 2 before Skin 3", status_code=400)


@assets.guarded
def _upsert_live_slot(
    uuid: str,
    cid: str,
    slot_key: str,
    png_bytes: bytes,
    *,
    texture_value: str,
    texture_signature: str,
    model: str,
    display_name: str | None,
) -> None:
    now = _iso_now()
    with assets.asset_transaction() as conn:
        rel = _write_png(uuid, cid, slot_key, png_bytes)
        conn.execute(
            """
            INSERT INTO character_wardrobe_slots (
                player_uuid, character_id, slot, png_relpath,
                texture_value, texture_signature, model,
                display_name, apply_pending, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true, %s)
            ON CONFLICT(player_uuid, character_id, slot) DO UPDATE SET
                png_relpath = excluded.png_relpath,
                texture_value = excluded.texture_value,
                texture_signature = excluded.texture_signature,
                model = excluded.model,
                display_name = excluded.display_name,
                apply_pending = true,
                updated_at = excluded.updated_at
            """,
            (
                uuid,
                cid,
                slot_key,
                rel,
                texture_value,
                texture_signature,
                model,
                display_name,
                now,
            ),
        )


def _maybe_create_masked_from_base(
    uuid: str,
    cid: str,
    base_png: bytes,
    *,
    pending_create_id: str | None = None,
    prepared: tuple[bytes, str, str, str],
) -> None:
    composed, model, texture_value, texture_signature = prepared
    if pending_create_id:
        _upsert_pending_slot(
            pending_create_id,
            "masked",
            composed,
            texture_value=texture_value,
            texture_signature=texture_signature,
            model=model,
            display_name=None,
            keep_existing_name=True,
        )
    else:
        existing = _load_slots(uuid, cid).get("masked")
        keep_name = (
            str(existing.get("display_name") or "").strip() or None
            if existing
            else None
        )
        _upsert_live_slot(
            uuid,
            cid,
            "masked",
            composed,
            texture_value=texture_value,
            texture_signature=texture_signature,
            model=model,
            display_name=keep_name,
        )


def _load_pending_slots(create_id: str) -> dict[str, dict[str, Any]]:
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT slot, png_relpath, texture_value, texture_signature,
                   model, display_name, updated_at
            FROM character_create_wardrobe
            WHERE create_id = %s
            """,
            (create_id,),
        ).fetchall()
    return {str(row["slot"]): {**row, "updated_at": api_time(row["updated_at"])} for row in rows}


@assets.guarded
def _upsert_pending_slot(
    create_id: str,
    slot_key: str,
    png_bytes: bytes,
    *,
    texture_value: str,
    texture_signature: str,
    model: str,
    display_name: str | None,
    keep_existing_name: bool = False,
) -> str | None:
    with database.connect() as conn:
        existing = conn.execute(
            """
            SELECT png_relpath, display_name FROM character_create_wardrobe
            WHERE create_id = %s AND slot = %s
            """,
            (create_id, slot_key),
        ).fetchone()
    keep_name = display_name
    if keep_existing_name and display_name is None and existing:
        keep_name = str(existing["display_name"] or "").strip() or None
    rel = _pending_relpath(create_id, slot_key)
    out = DATA_DIR / rel
    now = _iso_now()
    with assets.asset_transaction() as conn:
        assets.write_png(out, png_bytes)
        conn.execute(
            """
            INSERT INTO character_create_wardrobe (
                create_id, slot, png_relpath,
                texture_value, texture_signature, model,
                display_name, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(create_id, slot) DO UPDATE SET
                png_relpath = excluded.png_relpath,
                texture_value = excluded.texture_value,
                texture_signature = excluded.texture_signature,
                model = excluded.model,
                display_name = excluded.display_name,
                updated_at = excluded.updated_at
            """,
            (
                create_id,
                slot_key,
                rel,
                texture_value,
                texture_signature,
                model,
                keep_name,
                now,
            ),
        )
    return keep_name


@assets.guarded
def _compact_swappable_slots(
    uuid: str,
    cid: str,
    *,
    previous_active: str | None,
) -> None:
    """Pack filled swappable skins into base → extra_1 → extra_2 without gaps."""
    slots = _load_slots(uuid, cid)
    packed: list[dict[str, Any]] = []
    for key in SWAPPABLE_ORDER:
        row = slots.get(key)
        if not row or not row.get("png_relpath"):
            continue
        path = _png_abspath(row.get("png_relpath"))
        if path is None or not path.is_file():
            continue
        entry = dict(row)
        entry["_png_bytes"] = path.read_bytes()
        entry["_old_slot"] = key
        packed.append(entry)

    # Already contiguous from the start?
    expected = list(SWAPPABLE_ORDER[: len(packed)])
    actual = [e["_old_slot"] for e in packed]
    if actual == expected:
        # Still may need active normalize after a clear
        swappable = _swappable_for_roster(uuid, cid)
        _normalize_active(uuid, cid, previous_active, slots, swappable)
        return

    # Delete all swappable rows/files then rewrite packed
    for key in SWAPPABLE_ORDER:
        row = slots.get(key)
        if row:
            with assets.asset_transaction() as conn:
                _delete_png(row.get("png_relpath"))
                conn.execute(
                    """
                    DELETE FROM character_wardrobe_slots
                    WHERE player_uuid = %s AND character_id = %s AND slot = %s
                    """,
                    (uuid, cid, key),
                )

    active_new: str | None = None
    for i, entry in enumerate(packed):
        new_slot = SWAPPABLE_ORDER[i]
        if previous_active and entry["_old_slot"] == previous_active:
            active_new = new_slot
        _upsert_live_slot(
            uuid,
            cid,
            new_slot,
            entry["_png_bytes"],
            texture_value=str(entry.get("texture_value") or ""),
            texture_signature=str(entry.get("texture_signature") or ""),
            model=str(entry.get("model") or "classic"),
            display_name=(
                str(entry.get("display_name") or "").strip() or None
            ),
        )

    if active_new:
        _set_active(uuid, cid, active_new)
    else:
        slots_after = _load_slots(uuid, cid)
        swappable = _swappable_for_roster(uuid, cid)
        _normalize_active(uuid, cid, previous_active, slots_after, swappable)


@assets.guarded
def _compact_pending_swappable(create_id: str) -> None:
    slots = _load_pending_slots(create_id)
    packed: list[dict[str, Any]] = []
    for key in SWAPPABLE_ORDER:
        row = slots.get(key)
        if not row or not row.get("png_relpath"):
            continue
        path = _png_abspath(row.get("png_relpath"))
        if path is None or not path.is_file():
            continue
        entry = dict(row)
        entry["_png_bytes"] = path.read_bytes()
        packed.append(entry)

    expected = list(SWAPPABLE_ORDER[: len(packed)])
    actual = [
        k for k in SWAPPABLE_ORDER if _slot_filled(slots, k)
    ]
    if actual == expected:
        return

    for key in SWAPPABLE_ORDER:
        row = slots.get(key)
        if row:
            with assets.asset_transaction() as conn:
                _delete_png(row.get("png_relpath"))
                conn.execute(
                    """
                    DELETE FROM character_create_wardrobe
                    WHERE create_id = %s AND slot = %s
                    """,
                    (create_id, key),
                )

    for i, entry in enumerate(packed):
        new_slot = SWAPPABLE_ORDER[i]
        _upsert_pending_slot(
            create_id,
            new_slot,
            entry["_png_bytes"],
            texture_value=str(entry.get("texture_value") or ""),
            texture_signature=str(entry.get("texture_signature") or ""),
            model=str(entry.get("model") or "classic"),
            display_name=(
                str(entry.get("display_name") or "").strip() or None
            ),
        )


def _png_abspath(relpath: str | None) -> Path | None:
    if not relpath:
        return None
    path = DATA_DIR / relpath
    try:
        path.resolve().relative_to(WARDROBE_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def _slot_relpath(player_uuid: str, character_id: str, slot: str) -> str:
    return f"wardrobe/{player_uuid}/{character_id}/{slot}.png"


def _write_png(player_uuid: str, character_id: str, slot: str, data: bytes) -> str:
    rel = _slot_relpath(player_uuid, character_id, slot)
    out = DATA_DIR / rel
    assets.write_png(out, data)
    return rel


def _delete_png(relpath: str | None) -> None:
    path = _png_abspath(relpath)
    if path is not None and path.is_file():
        assets.delete_png(path)


@assets.guarded
def delete_png_relpath(relpath: str | None) -> bool:
    """Realm wipe entry point: safe unlink under WARDROBE_DIR. True when a file went."""
    path = _png_abspath(relpath)
    if path is None:
        return False
    assets.delete_png(path)
    return True


def _normalize_display_name(raw: str | None) -> str | None:
    try:
        return assert_optional_display_name(
            raw, max_len=DISPLAY_NAME_MAX, field="display_name"
        )
    except TextValidationError as e:
        raise WardrobeError(str(e), status_code=400) from e


def default_slot_label(slot: str) -> str:
    return DEFAULT_SLOT_NAMES.get(slot, slot)


def _effective_display_name(slot: str, row: dict[str, Any] | None) -> str:
    if row:
        custom = str(row.get("display_name") or "").strip()
        if custom:
            return custom
    return default_slot_label(slot)


def _load_slots(
    player_uuid: str, character_id: str
) -> dict[str, dict[str, Any]]:
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT slot, png_relpath, texture_value, texture_signature,
                   model, display_name, apply_pending, updated_at
            FROM character_wardrobe_slots
            WHERE player_uuid = %s AND character_id = %s
            """,
            (player_uuid, character_id),
        ).fetchall()
    return {str(row["slot"]): {**row, "updated_at": api_time(row["updated_at"])} for row in rows}


def _set_active(
    player_uuid: str, character_id: str, active: str | None
) -> None:
    with database.connect() as conn:
        conn.execute(
            """
            UPDATE character_roster
            SET wardrobe_active_slot = %s
            WHERE player_uuid = %s AND character_id = %s
            """,
            (active, player_uuid, character_id),
        )


def _normalize_active(
    player_uuid: str,
    character_id: str,
    active: str | None,
    slots: dict[str, dict[str, Any]],
    swappable: int,
) -> str | None:
    """Ensure active points at an unlocked filled swappable slot, else fix."""
    if active:
        active = active.strip().lower()
    if active in SWAPPABLE_SLOTS and _slot_unlocked(active, swappable):
        row = slots.get(active)
        if row and row.get("png_relpath"):
            return active
    base = slots.get("base")
    if base and base.get("png_relpath") and _slot_unlocked("base", swappable):
        if active != "base":
            _set_active(player_uuid, character_id, "base")
        return "base"
    if active is not None:
        _set_active(player_uuid, character_id, None)
    return None


@assets.guarded
def enforce_wardrobe_slot_limits(player_uuid: str, character_id: str) -> int:
    """Delete locked extra slots (and PNGs); fix active. Returns swappable count."""
    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    swappable = _swappable_for_roster(uuid, cid)
    slots = _load_slots(uuid, cid)
    wiped = False
    for slot in ("extra_1", "extra_2"):
        if _slot_unlocked(slot, swappable):
            continue
        row = slots.get(slot)
        if not row:
            continue
        with assets.asset_transaction() as conn:
            _delete_png(row.get("png_relpath"))
            conn.execute(
                """
                DELETE FROM character_wardrobe_slots
                WHERE player_uuid = %s AND character_id = %s AND slot = %s
                """,
                (uuid, cid, slot),
            )
        wiped = True
    if wiped:
        slots = _load_slots(uuid, cid)
    with database.connect() as conn:
        row = conn.execute(
            """
            SELECT wardrobe_active_slot
            FROM character_roster
            WHERE player_uuid = %s AND character_id = %s
            """,
            (uuid, cid),
        ).fetchone()
    active = row["wardrobe_active_slot"] if row else None
    _normalize_active(uuid, cid, active, slots, swappable)
    return swappable


@assets.guarded
def _build_wardrobe_payload(
    player_uuid: str, character_id: str, *, include_textures: bool
) -> dict[str, Any]:
    roster = _require_owned_character(player_uuid, character_id)
    uuid = str(roster["player_uuid"])
    cid = str(roster["character_id"])
    swappable = enforce_wardrobe_slot_limits(uuid, cid)
    slots_db = _load_slots(uuid, cid)
    # Re-read active after enforce may have rewritten it
    roster = _require_owned_character(uuid, cid)
    active = _normalize_active(
        uuid,
        cid,
        roster.get("wardrobe_active_slot"),
        slots_db,
        swappable,
    )
    slot_list: list[dict[str, Any]] = []
    for slot in SLOTS:
        unlocked = _slot_unlocked(slot, swappable)
        row = slots_db.get(slot)
        filled = bool(row and row.get("png_relpath"))
        value = (row.get("texture_value") if row else None) or None
        signature = (row.get("texture_signature") if row else None) or None
        has_sig = bool(value and signature)
        entry: dict[str, Any] = {
            "slot": slot,
            "unlocked": unlocked,
            "filled": filled,
            "model": (row.get("model") if row else None),
            "display_name": _effective_display_name(slot, row),
            "custom_name": bool(
                row and str(row.get("display_name") or "").strip()
            ),
            "apply_pending": bool(row and row.get("apply_pending")),
            "has_signature": has_sig,
            "signed": has_sig,
            "updated_at": (row.get("updated_at") if row else None),
            "texture_url": (
                f"/characters/{cid}/wardrobe/{slot}/texture" if filled else None
            ),
        }
        if include_textures:
            entry["texture_value"] = value if has_sig else None
            entry["texture_signature"] = signature if has_sig else None
        slot_list.append(entry)
    return {
        "character_id": cid,
        "player_uuid": uuid,
        "active_slot": active,
        "swappable_slots": swappable,
        "slots": slot_list,
    }


def _get_pending_active(create_id: str) -> str | None:
    with database.connect() as conn:
        row = conn.execute(
            """
            SELECT wardrobe_active_slot FROM character_creates WHERE id = %s
            """,
            (create_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        raw = row["wardrobe_active_slot"]
    except (KeyError, IndexError):
        raw = None
    if raw is None or not str(raw).strip():
        return None
    return str(raw).strip().lower()


def _set_pending_active(create_id: str, active: str | None) -> None:
    with database.connect() as conn:
        conn.execute(
            """
            UPDATE character_creates
            SET wardrobe_active_slot = %s
            WHERE id = %s
            """,
            (active, create_id),
        )


def _normalize_pending_active(
    create_id: str,
    active: str | None,
    slots: dict[str, dict[str, Any]],
    swappable: int,
) -> str | None:
    if active:
        active = active.strip().lower()
    if active in SWAPPABLE_SLOTS and _slot_unlocked(active, swappable):
        row = slots.get(active)
        if row and row.get("png_relpath"):
            return active
    base = slots.get("base")
    if base and base.get("png_relpath") and _slot_unlocked("base", swappable):
        if active != "base":
            _set_pending_active(create_id, "base")
        return "base"
    if active is not None:
        _set_pending_active(create_id, None)
    return None


@assets.guarded
def enforce_pending_wardrobe_slot_limits(
    player_uuid: str, create_id: str
) -> int:
    """Delete locked extra pending slots; fix active. Returns swappable count."""
    uuid = (player_uuid or "").strip()
    cid = (create_id or "").strip()
    swappable = _swappable_for_pending(uuid, cid)
    slots = _load_pending_slots(cid)
    wiped = False
    for slot in ("extra_1", "extra_2"):
        if _slot_unlocked(slot, swappable):
            continue
        row = slots.get(slot)
        if not row:
            continue
        with assets.asset_transaction() as conn:
            _delete_png(row.get("png_relpath"))
            conn.execute(
                """
                DELETE FROM character_create_wardrobe
                WHERE create_id = %s AND slot = %s
                """,
                (cid, slot),
            )
        wiped = True
    if wiped:
        slots = _load_pending_slots(cid)
    active = _get_pending_active(cid)
    _normalize_pending_active(cid, active, slots, swappable)
    return swappable


@assets.guarded
def _build_pending_wardrobe_payload(
    player_uuid: str,
    create_id: str,
    *,
    include_textures: bool,
) -> dict[str, Any]:
    uuid = (player_uuid or "").strip()
    cid = (create_id or "").strip()
    swappable = enforce_pending_wardrobe_slot_limits(uuid, cid)
    slots_db = _load_pending_slots(cid)
    active = _normalize_pending_active(
        cid,
        _get_pending_active(cid),
        slots_db,
        swappable,
    )
    slot_list: list[dict[str, Any]] = []
    for slot in SLOTS:
        unlocked = _slot_unlocked(slot, swappable)
        row = slots_db.get(slot)
        filled = bool(row and row.get("png_relpath"))
        value = (row.get("texture_value") if row else None) or None
        signature = (row.get("texture_signature") if row else None) or None
        has_sig = bool(value and signature)
        entry: dict[str, Any] = {
            "slot": slot,
            "unlocked": unlocked,
            "filled": filled,
            "model": (row.get("model") if row else None),
            "display_name": _effective_display_name(slot, row),
            "custom_name": bool(
                row and str(row.get("display_name") or "").strip()
            ),
            "apply_pending": False,
            "has_signature": has_sig,
            "signed": has_sig,
            "updated_at": (row.get("updated_at") if row else None),
            "texture_url": (
                f"/characters/{cid}/wardrobe/{slot}/texture" if filled else None
            ),
        }
        if include_textures:
            entry["texture_value"] = value if has_sig else None
            entry["texture_signature"] = signature if has_sig else None
        slot_list.append(entry)
    return {
        "character_id": cid,
        "player_uuid": uuid,
        "active_slot": active,
        "swappable_slots": swappable,
        "slots": slot_list,
        "pending_create": True,
    }


def _resolve_player_wardrobe_access(
    player_uuid: str, character_id: str, *, living: bool = False
) -> dict[str, Any]:
    """Owned roster or pending character; ``living`` refuses dead and missing ones (edits)."""
    try:
        access = resolve_player_character(player_uuid, character_id)
        if living:
            require_living(access)
        return access
    except PendingCreateError as e:
        raise WardrobeError(str(e), status_code=e.status_code) from e


def get_wardrobe(player_uuid: str, character_id: str) -> dict[str, Any]:
    """Session-safe wardrobe list (no Mojang texture value/signature)."""
    access = _resolve_player_wardrobe_access(player_uuid, character_id, living=True)
    if access["kind"] == "pending":
        return _build_pending_wardrobe_payload(
            access["player_uuid"],
            access["character_id"],
            include_textures=False,
        )
    return _build_wardrobe_payload(
        player_uuid, character_id, include_textures=False
    )


def get_wardrobe_for_plugin(
    player_uuid: str, character_id: str
) -> dict[str, Any]:
    """Plugin wardrobe list including signed texture value/signature."""
    return _build_wardrobe_payload(
        player_uuid, character_id, include_textures=True
    )


def _prepare_upload(
    player_uuid: str, character_id: str, slot: str, png_bytes: bytes,
    *, model_override: str | None, create_masked: bool, pending_only: bool = False,
) -> tuple[tuple[str, str, str], tuple[bytes, str, str, str] | None]:
    """Validate and sign without an asset lock or an outstanding pool borrow.

    The mutation repeats the ownership, entitlement and slot checks under the
    guard: another upload, deletion or wipe may finish while MineSkin works.
    """
    if pending_only:
        row = _require_pending_create(player_uuid, character_id)
        access = {**row, "kind": "pending", "character_id": row["id"]}
    else:
        access = _resolve_player_wardrobe_access(player_uuid, character_id, living=True)
    uuid, cid = access["player_uuid"], access["character_id"]
    slot_key = _normalize_slot(slot)
    swappable = swappable_slot_count(uuid, realm_id=access.get("realm_id"))
    if not _slot_unlocked(slot_key, swappable):
        raise WardrobeError("Slot locked for your rank", status_code=403)
    slots = _load_pending_slots(cid) if access["kind"] == "pending" else _load_slots(uuid, cid)
    _require_sequential_fill(slot_key, slots)
    try:
        validate_png(png_bytes, WARDROBE_PNG_SIZE)
    except StorageError as e:
        raise WardrobeError(str(e), status_code=400) from e
    model = resolve_skin_model(png_bytes, model_override)
    value, signature = sign_wardrobe_skin(png_bytes, model)
    masked = None
    if slot_key == "base" and create_masked:
        composed = compose_masked_skin(png_bytes, load_masked_template())
        masked_model = detect_skin_model(composed)
        masked_value, masked_signature = sign_wardrobe_skin(composed, masked_model)
        masked = composed, masked_model, masked_value, masked_signature
    return (model, value, signature), masked


def upload_slot(
    player_uuid: str,
    character_id: str,
    slot: str,
    png_bytes: bytes,
    *,
    display_name: str | None = None,
    create_masked: bool = False,
    model_override: str | None = None,
) -> dict[str, Any]:
    try:
        signed, masked = _prepare_upload(
            player_uuid, character_id, slot, png_bytes,
            model_override=model_override, create_masked=create_masked,
        )
        return _upload_slot_impl(
            player_uuid,
            character_id,
            slot,
            png_bytes,
            display_name=display_name,
            create_masked=create_masked,
            model_override=model_override,
            _signed=signed, _masked=masked,
        )
    except WardrobeError as exc:
        _log_wardrobe_upload_failure(
            exc,
            kind="upload_slot",
            target_id=character_id,
            slot=slot,
            player_uuid=player_uuid,
            png_bytes=png_bytes,
            create_masked=create_masked,
            model_override=model_override,
        )
        raise


@assets.guarded
def _upload_slot_impl(
    player_uuid: str,
    character_id: str,
    slot: str,
    png_bytes: bytes,
    *,
    display_name: str | None = None,
    create_masked: bool = False,
    model_override: str | None = None,
    _signed: tuple[str, str, str],
    _masked: tuple[bytes, str, str, str] | None,
) -> dict[str, Any]:
    access = _resolve_player_wardrobe_access(player_uuid, character_id, living=True)
    if access["kind"] == "pending":
        uuid = access["player_uuid"]
        cid = access["character_id"]
        slot_key = _normalize_slot(slot)
        swappable = swappable_slot_count(uuid, realm_id=access.get("realm_id"))
        if not _slot_unlocked(slot_key, swappable):
            raise WardrobeError(
                "Slot locked for your rank",
                status_code=403,
            )
        slots_before = _load_pending_slots(cid)
        _require_sequential_fill(slot_key, slots_before)
        try:
            validate_png(png_bytes, WARDROBE_PNG_SIZE)
        except StorageError as e:
            raise WardrobeError(str(e), status_code=400) from e
        model, texture_value, texture_signature = _signed
        name = _normalize_display_name(display_name)
        existing = slots_before.get(slot_key)
        keep_name = (
            name
            if display_name is not None
            else (
                str(existing.get("display_name") or "").strip() or None
                if existing
                else None
            )
        )
        _upsert_pending_slot(
            cid,
            slot_key,
            png_bytes,
            texture_value=texture_value,
            texture_signature=texture_signature,
            model=model,
            display_name=keep_name,
        )
        if slot_key == "base" and create_masked:
            _maybe_create_masked_from_base(
                uuid, cid, png_bytes, pending_create_id=cid, prepared=_masked
            )
        if slot_key in SWAPPABLE_SLOTS:
            slots_after = _load_pending_slots(cid)
            current = _get_pending_active(cid)
            normalized = _normalize_pending_active(
                cid, current, slots_after, swappable
            )
            if normalized is None and slot_key == "base":
                _set_pending_active(cid, "base")
        wardrobe = get_wardrobe(uuid, cid)
        wardrobe["uploaded_slot"] = slot_key
        wardrobe["signed"] = True
        if slot_key == "base" and create_masked:
            wardrobe["masked_created"] = True
        return wardrobe

    roster = _require_owned_character(player_uuid, character_id)
    uuid = str(roster["player_uuid"])
    cid = str(roster["character_id"])
    slot_key = _normalize_slot(slot)
    swappable = enforce_wardrobe_slot_limits(uuid, cid)
    if not _slot_unlocked(slot_key, swappable):
        raise WardrobeError(
            "Slot locked for your rank",
            status_code=403,
        )
    slots_before = _load_slots(uuid, cid)
    _require_sequential_fill(slot_key, slots_before)
    try:
        validate_png(png_bytes, WARDROBE_PNG_SIZE)
    except StorageError as e:
        raise WardrobeError(str(e), status_code=400) from e
    model, texture_value, texture_signature = _signed

    name = _normalize_display_name(display_name)
    existing = slots_before.get(slot_key)
    keep_name = (
        name
        if display_name is not None
        else (
            str(existing.get("display_name") or "").strip() or None
            if existing
            else None
        )
    )
    _upsert_live_slot(
        uuid,
        cid,
        slot_key,
        png_bytes,
        texture_value=texture_value,
        texture_signature=texture_signature,
        model=model,
        display_name=keep_name,
    )

    if slot_key == "base" and create_masked:
        _maybe_create_masked_from_base(uuid, cid, png_bytes, prepared=_masked)

    # Auto-equip base on first fill if nothing active
    if slot_key in SWAPPABLE_SLOTS:
        current = roster.get("wardrobe_active_slot")
        slots_after = _load_slots(uuid, cid)
        normalized = _normalize_active(
            uuid, cid, current, slots_after, swappable
        )
        if normalized is None and slot_key == "base":
            _set_active(uuid, cid, "base")

    wardrobe = get_wardrobe(uuid, cid)
    wardrobe["uploaded_slot"] = slot_key
    wardrobe["signed"] = True
    if slot_key == "base" and create_masked:
        wardrobe["masked_created"] = True
    return wardrobe


@assets.guarded
def set_slot_display_name(
    player_uuid: str,
    character_id: str,
    slot: str,
    display_name: str | None,
) -> dict[str, Any]:
    """Rename a filled slot. Does not re-sign or set apply_pending."""
    access = _resolve_player_wardrobe_access(player_uuid, character_id, living=True)
    uuid = access["player_uuid"]
    cid = access["character_id"]
    slot_key = _normalize_slot(slot)
    swappable = swappable_slot_count(uuid, realm_id=access.get("realm_id"))
    if not _slot_unlocked(slot_key, swappable):
        raise WardrobeError(
            "Slot locked for your rank",
            status_code=403,
        )
    if access["kind"] == "pending":
        slots = _load_pending_slots(cid)
        row = slots.get(slot_key)
        if not row or not row.get("png_relpath"):
            raise WardrobeError("Wardrobe slot is empty", status_code=404)
        name = _normalize_display_name(display_name)
        with database.connect() as conn:
            conn.execute(
                """
                UPDATE character_create_wardrobe
                SET display_name = %s, updated_at = %s
                WHERE create_id = %s AND slot = %s
                """,
                (name, _iso_now(), cid, slot_key),
            )
        return get_wardrobe(uuid, cid)

    roster = _require_owned_character(player_uuid, character_id)
    uuid = str(roster["player_uuid"])
    cid = str(roster["character_id"])
    slot_key = _normalize_slot(slot)
    swappable = enforce_wardrobe_slot_limits(uuid, cid)
    if not _slot_unlocked(slot_key, swappable):
        raise WardrobeError(
            "Slot locked for your rank",
            status_code=403,
        )
    slots = _load_slots(uuid, cid)
    row = slots.get(slot_key)
    if not row or not row.get("png_relpath"):
        raise WardrobeError("Wardrobe slot is empty", status_code=404)
    name = _normalize_display_name(display_name)
    with database.connect() as conn:
        conn.execute(
            """
            UPDATE character_wardrobe_slots
            SET display_name = %s, updated_at = %s
            WHERE player_uuid = %s AND character_id = %s AND slot = %s
            """,
            (name, _iso_now(), uuid, cid, slot_key),
        )
    return get_wardrobe(uuid, cid)


@assets.guarded
def ack_wardrobe_slots(
    player_uuid: str, character_id: str, slots: list[str]
) -> dict[str, Any]:
    """Clear apply_pending for slots the plugin has pulled and applied."""
    roster = _require_owned_character(player_uuid, character_id)
    uuid = str(roster["player_uuid"])
    cid = str(roster["character_id"])
    clean: list[str] = []
    for raw in slots:
        try:
            clean.append(_normalize_slot(raw))
        except WardrobeError:
            continue
    if not clean:
        return get_wardrobe_for_plugin(uuid, cid)
    with database.connect() as conn:
        conn.execute(
            """
            UPDATE character_wardrobe_slots
            SET apply_pending = false
            WHERE player_uuid = %s AND character_id = %s
              AND slot = ANY(%s)
            """,
            (uuid, cid, clean),
        )
    return get_wardrobe_for_plugin(uuid, cid)


@assets.guarded
def clear_slot(
    player_uuid: str, character_id: str, slot: str
) -> dict[str, Any]:
    access = _resolve_player_wardrobe_access(player_uuid, character_id, living=True)
    if access["kind"] == "pending":
        uuid = access["player_uuid"]
        cid = access["character_id"]
        slot_key = _normalize_slot(slot)
        previous_active = _get_pending_active(cid)
        slots = _load_pending_slots(cid)
        row = slots.get(slot_key)
        if row:
            with assets.asset_transaction() as conn:
                _delete_png(row.get("png_relpath"))
                conn.execute(
                    """
                    DELETE FROM character_create_wardrobe
                    WHERE create_id = %s AND slot = %s
                    """,
                    (cid, slot_key),
                )
        if slot_key in SWAPPABLE_SLOTS:
            _compact_pending_swappable(cid)
        elif previous_active and previous_active == slot_key:
            remaining = _load_pending_slots(cid)
            swappable = swappable_slot_count(uuid, realm_id=access.get("realm_id"))
            _normalize_pending_active(
                cid, slot_key, remaining, swappable
            )
        return get_wardrobe(uuid, cid)

    roster = _require_owned_character(player_uuid, character_id)
    uuid = str(roster["player_uuid"])
    cid = str(roster["character_id"])
    slot_key = _normalize_slot(slot)
    previous_active = roster.get("wardrobe_active_slot")
    if previous_active:
        previous_active = str(previous_active).strip().lower()
    slots = _load_slots(uuid, cid)
    row = slots.get(slot_key)
    if row:
        with assets.asset_transaction() as conn:
            _delete_png(row.get("png_relpath"))
            conn.execute(
                """
                DELETE FROM character_wardrobe_slots
                WHERE player_uuid = %s AND character_id = %s AND slot = %s
                """,
                (uuid, cid, slot_key),
            )
    if slot_key in SWAPPABLE_SLOTS:
        _compact_swappable_slots(
            uuid, cid, previous_active=previous_active
        )
    elif previous_active and previous_active == slot_key:
        remaining = _load_slots(uuid, cid)
        swappable = _swappable_for_roster(uuid, cid)
        _normalize_active(uuid, cid, slot_key, remaining, swappable)
    return get_wardrobe(uuid, cid)


def set_active_slot(
    player_uuid: str, character_id: str, slot: str | None
) -> dict[str, Any]:
    return _set_active_slot(
        player_uuid,
        character_id,
        slot,
        include_textures=False,
        roster_only=False,
    )


def set_active_slot_for_plugin(
    player_uuid: str, character_id: str, slot: str | None
) -> dict[str, Any]:
    return _set_active_slot(
        player_uuid,
        character_id,
        slot,
        include_textures=True,
        roster_only=True,
    )


@assets.guarded
def _set_active_slot(
    player_uuid: str,
    character_id: str,
    slot: str | None,
    *,
    include_textures: bool,
    roster_only: bool = False,
) -> dict[str, Any]:
    if roster_only:
        access = {
            "kind": "roster",
            **_require_owned_character(player_uuid, character_id),
        }
    else:
        access = _resolve_player_wardrobe_access(player_uuid, character_id, living=True)

    uuid = str(access["player_uuid"])
    cid = str(access["character_id"])
    swappable = swappable_slot_count(uuid, realm_id=access.get("realm_id"))

    if access["kind"] == "pending":
        slots = _load_pending_slots(cid)
        if slot is None or (isinstance(slot, str) and not slot.strip()):
            _set_pending_active(cid, None)
            return _build_pending_wardrobe_payload(
                uuid, cid, include_textures=include_textures
            )
        slot_key = (slot or "").strip().lower()
        if slot_key == "masked":
            raise WardrobeError(
                "Masked slot cannot be set as active",
                status_code=400,
            )
        if slot_key not in SWAPPABLE_SLOTS:
            raise WardrobeError(
                f"Invalid active slot (expected one of: {', '.join(sorted(SWAPPABLE_SLOTS))})",
                status_code=400,
            )
        if not _slot_unlocked(slot_key, swappable):
            raise WardrobeError("Slot locked for your rank", status_code=403)
        row = slots.get(slot_key)
        if not row or not row.get("png_relpath"):
            raise WardrobeError("Slot is empty", status_code=400)
        _set_pending_active(cid, slot_key)
        return _build_pending_wardrobe_payload(
            uuid, cid, include_textures=include_textures
        )

    slots = _load_slots(uuid, cid)

    if slot is None or (isinstance(slot, str) and not slot.strip()):
        _set_active(uuid, cid, None)
        return _build_wardrobe_payload(
            uuid, cid, include_textures=include_textures
        )

    slot_key = (slot or "").strip().lower()
    if slot_key == "masked":
        raise WardrobeError(
            "Masked slot cannot be set as active",
            status_code=400,
        )
    if slot_key not in SWAPPABLE_SLOTS:
        raise WardrobeError(
            f"Invalid active slot (expected one of: {', '.join(sorted(SWAPPABLE_SLOTS))})",
            status_code=400,
        )
    if not _slot_unlocked(slot_key, swappable):
        raise WardrobeError("Slot locked for your rank", status_code=403)
    row = slots.get(slot_key)
    if not row or not row.get("png_relpath"):
        raise WardrobeError("Slot is empty", status_code=400)
    _set_active(uuid, cid, slot_key)
    return _build_wardrobe_payload(
        uuid, cid, include_textures=include_textures
    )


def skin_face_png(skin_png: bytes) -> bytes | None:
    """The 8x8 face (head and hat layer) of a skin; None for a blank face."""
    try:
        skin = Image.open(io.BytesIO(skin_png)).convert("RGBA")
    except Exception:
        return None
    if skin.width != 64 or skin.height not in (32, 64):
        return None
    face = skin.crop((8, 8, 16, 16))
    # A blank face (such as the masked template) is no portrait.
    if face.getchannel("A").getbbox() is None:
        return None
    face.alpha_composite(skin.crop((40, 8, 48, 16)))
    buf = io.BytesIO()
    face.save(buf, format="PNG")
    return buf.getvalue()


# Each part's front face on a 64x64 skin and where it sits in the 16x32 figure:
# (x, y, width, height, figure x, figure y). Arms take the model's width.
def _figure_parts(arm: int) -> tuple[list[tuple[int, ...]], list[tuple[int, ...]]]:
    inner = 4 - arm
    base = [
        (8, 8, 8, 8, 4, 0),
        (20, 20, 8, 12, 4, 8),
        (44, 20, arm, 12, inner, 8),
        (36, 52, arm, 12, 12, 8),
        (4, 20, 4, 12, 4, 20),
        (20, 52, 4, 12, 8, 20),
    ]
    outer = [
        (40, 8, 8, 8, 4, 0),
        (20, 36, 8, 12, 4, 8),
        (44, 36, arm, 12, inner, 8),
        (52, 52, arm, 12, 12, 8),
        (4, 36, 4, 12, 4, 20),
        (4, 52, 4, 12, 8, 20),
    ]
    return base, outer


def skin_figure_png(skin_png: bytes, model: str | None = None) -> bytes | None:
    """The 16x32 front of a 64x64 skin with its outer layer, arms as wide as the
    saved model (else detected); None for a blank face or any other size."""
    try:
        skin = Image.open(io.BytesIO(skin_png)).convert("RGBA")
    except Exception:
        return None
    if skin.size != WARDROBE_PNG_SIZE:
        return None
    if skin.crop((8, 8, 16, 16)).getchannel("A").getbbox() is None:
        return None
    arm = 3 if resolve_skin_model(skin_png, model) == "slim" else 4
    figure = Image.new("RGBA", (16, 32), (0, 0, 0, 0))
    base, outer = _figure_parts(arm)
    for x, y, w, h, fx, fy in base + outer:
        figure.alpha_composite(skin.crop((x, y, x + w, y + h)), (fx, fy))
    buf = io.BytesIO()
    figure.save(buf, format="PNG")
    return buf.getvalue()


def _worn_slot(active: str | None, slots: dict[str, dict[str, Any]], swappable: int) -> str:
    """The saved slot while it's unlocked and filled, else base, as _normalize_active picks it."""
    active = (active or "").strip().lower()
    if active in SWAPPABLE_SLOTS and _slot_unlocked(active, swappable) and _slot_filled(slots, active):
        return active
    return "base"


def _worn_roster_row(
    player_uuid: str, character_id: str, *, realm_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """The character id and slot row a roster character wears ({} if empty). Read-only:
    picks the slot like _normalize_active but never enforces limits or saves it."""
    roster = _require_owned_character(player_uuid, character_id, realm_id=realm_id)
    uuid = str(roster["player_uuid"])
    cid = str(roster["character_id"])
    slots = _load_slots(uuid, cid)
    swappable = swappable_slot_count(uuid, realm_id=roster.get("realm_id"))
    active = _worn_slot(roster.get("wardrobe_active_slot"), slots, swappable)
    return cid, slots.get(active) or {}


def _active_slot(
    player_uuid: str, character_id: str, *, realm_id: str | None = None,
) -> tuple[bytes, str | None] | None:
    """The PNG and saved model of the slot a roster character wears."""
    _, slot = _worn_roster_row(player_uuid, character_id, realm_id=realm_id)
    path = _png_abspath(slot.get("png_relpath"))
    if path is None:
        return None
    return path.read_bytes(), slot.get("model")


def worn_skin_name(player_uuid: str, character_id: str) -> str | None:
    """The name of the skin a roster or pending character wears, for Profile. Read-only like
    _active_slot: get_wardrobe would delete skins in slots the player's rank no longer unlocks."""
    access = _resolve_player_wardrobe_access(player_uuid, character_id)
    uuid = access["player_uuid"]
    cid = access["character_id"]
    slots = _load_pending_slots(cid) if access["kind"] == "pending" else _load_slots(uuid, cid)
    swappable = swappable_slot_count(uuid, realm_id=access.get("realm_id"))
    worn = _worn_slot(access.get("wardrobe_active_slot"), slots, swappable)
    return _effective_display_name(worn, slots.get(worn)) if _slot_filled(slots, worn) else None


def worn_skin_texture(player_uuid: str, character_id: str) -> dict[str, Any]:
    """The signed texture a roster character wears, for the in-game character selector.
    Read-only like _active_slot; value and signature are None unless the worn skin is signed."""
    cid, slot = _worn_roster_row(player_uuid, character_id)
    value = slot.get("texture_value") or None
    signature = slot.get("texture_signature") or None
    if not (slot.get("png_relpath") and value and signature):
        value = signature = None
    return {"character_id": cid, "value": value, "signature": signature}


def active_face_png(player_uuid: str, character_id: str, *, realm_id: str | None = None) -> bytes | None:
    """The face of the skin a roster character wears."""
    worn = _active_slot(player_uuid, character_id, realm_id=realm_id)
    return skin_face_png(worn[0]) if worn else None


def active_figure_png(player_uuid: str, character_id: str, *, realm_id: str | None = None) -> bytes | None:
    """The front of the skin a roster character wears, for Profile's character view."""
    worn = _active_slot(player_uuid, character_id, realm_id=realm_id)
    return skin_figure_png(*worn) if worn else None


def resolve_slot_texture_path(
    player_uuid: str, character_id: str, slot: str
) -> Path:
    access = _resolve_player_wardrobe_access(player_uuid, character_id)
    uuid = access["player_uuid"]
    cid = access["character_id"]
    slot_key = _normalize_slot(slot)
    if access["kind"] == "pending":
        row = _load_pending_slots(cid).get(slot_key)
    else:
        row = _load_slots(uuid, cid).get(slot_key)
    if not row:
        raise WardrobeError("Slot is empty", status_code=404)
    path = _png_abspath(row.get("png_relpath"))
    if path is None:
        raise WardrobeError("Slot texture missing", status_code=404)
    return path


def _pending_relpath(create_id: str, slot: str) -> str:
    return f"wardrobe/pending/{create_id}/{slot}.png"


def _require_pending_create(player_uuid: str, create_id: str) -> dict[str, Any]:
    uuid = (player_uuid or "").strip()
    cid = (create_id or "").strip()
    if not uuid or not cid:
        raise WardrobeError("player_uuid and create_id are required", status_code=400)
    with database.connect() as conn:
        row = conn.execute(
            """
            SELECT id, player_uuid, status, character_id, realm_id
            FROM character_creates
            WHERE id = %s AND player_uuid = %s
            """,
            (cid, uuid),
        ).fetchone()
    if row is None:
        raise WardrobeError("Create not found", status_code=404)
    if str(row["status"] or "").strip().lower() != "pending":
        raise WardrobeError(
            "Create is not pending; wardrobe uploads locked",
            status_code=409,
        )
    return dict(row)


def upload_pending_create_wardrobe(
    player_uuid: str,
    create_id: str,
    slot: str,
    png_bytes: bytes,
    *,
    display_name: str | None = None,
    create_masked: bool = False,
    model_override: str | None = None,
) -> dict[str, Any]:
    """Sign + store a wardrobe slot against a pending create (pre-roster)."""
    try:
        signed, masked = _prepare_upload(
            player_uuid, create_id, slot, png_bytes, pending_only=True,
            model_override=model_override, create_masked=create_masked,
        )
        return _upload_pending_create_wardrobe_impl(
            player_uuid,
            create_id,
            slot,
            png_bytes,
            display_name=display_name,
            create_masked=create_masked,
            model_override=model_override,
            _signed=signed, _masked=masked,
        )
    except WardrobeError as exc:
        _log_wardrobe_upload_failure(
            exc,
            kind="pending_create",
            target_id=create_id,
            slot=slot,
            player_uuid=player_uuid,
            png_bytes=png_bytes,
            create_masked=create_masked,
            model_override=model_override,
        )
        raise


@assets.guarded
def _upload_pending_create_wardrobe_impl(
    player_uuid: str,
    create_id: str,
    slot: str,
    png_bytes: bytes,
    *,
    display_name: str | None = None,
    create_masked: bool = False,
    model_override: str | None = None,
    _signed: tuple[str, str, str],
    _masked: tuple[bytes, str, str, str] | None,
) -> dict[str, Any]:
    create = _require_pending_create(player_uuid, create_id)
    uuid = str(create["player_uuid"])
    cid = str(create["id"])
    slot_key = _normalize_slot(slot)
    swappable = swappable_slot_count(uuid, realm_id=create.get("realm_id"))
    if not _slot_unlocked(slot_key, swappable):
        raise WardrobeError("Slot locked for your rank", status_code=403)
    slots_before = _load_pending_slots(cid)
    _require_sequential_fill(slot_key, slots_before)
    try:
        validate_png(png_bytes, WARDROBE_PNG_SIZE)
    except StorageError as e:
        raise WardrobeError(str(e), status_code=400) from e
    model, texture_value, texture_signature = _signed
    name = _normalize_display_name(display_name)

    existing = slots_before.get(slot_key)
    keep_name = (
        name
        if display_name is not None
        else (
            str(existing.get("display_name") or "").strip() or None
            if existing
            else None
        )
    )
    _upsert_pending_slot(
        cid,
        slot_key,
        png_bytes,
        texture_value=texture_value,
        texture_signature=texture_signature,
        model=model,
        display_name=keep_name,
    )

    if slot_key == "base" and create_masked:
        _maybe_create_masked_from_base(
            uuid, cid, png_bytes, pending_create_id=cid, prepared=_masked
        )

    return {
        "ok": True,
        "create_id": cid,
        "slot": slot_key,
        "model": model,
        "display_name": _effective_display_name(
            slot_key, {"display_name": keep_name}
        ),
        "signed": True,
        **({"masked_created": True} if slot_key == "base" and create_masked else {}),
    }


@assets.guarded
def clear_pending_create_wardrobe(
    player_uuid: str, create_id: str, slot: str
) -> dict[str, Any]:
    create = _require_pending_create(player_uuid, create_id)
    cid = str(create["id"])
    slot_key = _normalize_slot(slot)
    with assets.asset_transaction() as conn:
        row = conn.execute(
            """
            SELECT png_relpath FROM character_create_wardrobe
            WHERE create_id = %s AND slot = %s
            """,
            (cid, slot_key),
        ).fetchone()
        if row:
            _delete_png(row["png_relpath"])
            conn.execute(
                """
                DELETE FROM character_create_wardrobe
                WHERE create_id = %s AND slot = %s
                """,
                (cid, slot_key),
            )
    if slot_key in SWAPPABLE_SLOTS:
        _compact_pending_swappable(cid)
    return {"ok": True, "create_id": cid, "slot": slot_key, "cleared": True}


@assets.guarded
def delete_all_pending_create_wardrobe(create_id: str) -> int:
    """Delete all wardrobe slots and PNGs for a pending create. Returns count."""
    cid = (create_id or "").strip()
    if not cid:
        return 0
    deleted = 0
    with assets.asset_transaction() as conn:
        rows = conn.execute(
            """
            SELECT png_relpath FROM character_create_wardrobe
            WHERE create_id = %s
            """,
            (cid,),
        ).fetchall()
        for row in rows:
            _delete_png(row["png_relpath"])
            deleted += 1
        conn.execute(
            "DELETE FROM character_create_wardrobe WHERE create_id = %s",
            (cid,),
        )
    return deleted


@assets.guarded
def flush_pending_wardrobe(
    player_uuid: str, create_id: str, character_id: str
) -> int:
    """Move pending create wardrobe slots onto the live character. Returns count."""
    uuid = (player_uuid or "").strip()
    create_key = (create_id or "").strip()
    char_id = (character_id or "").strip()
    if not uuid or not create_key or not char_id:
        return 0
    pending_active: str | None = None
    with assets.asset_transaction() as conn:
        create_row = conn.execute(
            """
            SELECT wardrobe_active_slot FROM character_creates WHERE id = %s
            """,
            (create_key,),
        ).fetchone()
        if create_row is not None:
            try:
                raw_active = create_row["wardrobe_active_slot"]
            except (KeyError, IndexError):
                raw_active = None
            if raw_active is not None and str(raw_active).strip():
                pending_active = str(raw_active).strip().lower()
        rows = conn.execute(
            """
            SELECT slot, png_relpath, texture_value, texture_signature,
                   model, display_name
            FROM character_create_wardrobe
            WHERE create_id = %s
            """,
            (create_key,),
        ).fetchall()
        if not rows:
            return 0
        flushed = 0
        now = _iso_now()
        for row in rows:
            slot_key = str(row["slot"])
            src = _png_abspath(row["png_relpath"])
            if src is None or not src.is_file():
                continue
            png_bytes = src.read_bytes()
            rel = _write_png(uuid, char_id, slot_key, png_bytes)
            custom_name = str(row["display_name"] or "").strip() or None
            conn.execute(
                """
                INSERT INTO character_wardrobe_slots (
                    player_uuid, character_id, slot, png_relpath,
                    texture_value, texture_signature, model,
                    display_name, apply_pending, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true, %s)
                ON CONFLICT(player_uuid, character_id, slot) DO UPDATE SET
                    png_relpath = excluded.png_relpath,
                    texture_value = excluded.texture_value,
                    texture_signature = excluded.texture_signature,
                    model = excluded.model,
                    display_name = excluded.display_name,
                    apply_pending = true,
                    updated_at = excluded.updated_at
                """,
                (
                    uuid,
                    char_id,
                    slot_key,
                    rel,
                    row["texture_value"],
                    row["texture_signature"],
                    row["model"],
                    custom_name,
                    now,
                ),
            )
            _delete_png(row["png_relpath"])
            flushed += 1
        conn.execute(
            "DELETE FROM character_create_wardrobe WHERE create_id = %s",
            (create_key,),
        )
        active_to_set: str | None = None
        if pending_active in SWAPPABLE_SLOTS:
            has_active = conn.execute(
                """
                SELECT 1 FROM character_wardrobe_slots
                WHERE player_uuid = %s AND character_id = %s AND slot = %s
                  AND png_relpath IS NOT NULL
                """,
                (uuid, char_id, pending_active),
            ).fetchone()
            if has_active is not None:
                active_to_set = pending_active
        if active_to_set is None:
            base = conn.execute(
                """
                SELECT 1 FROM character_wardrobe_slots
                WHERE player_uuid = %s AND character_id = %s AND slot = 'base'
                  AND png_relpath IS NOT NULL
                """,
                (uuid, char_id),
            ).fetchone()
            if base is not None:
                active_to_set = "base"
        if active_to_set is not None:
            roster = conn.execute(
                """
                SELECT 1 FROM character_roster
                WHERE player_uuid = %s AND character_id = %s
                """,
                (uuid, char_id),
            ).fetchone()
            if roster is not None:
                conn.execute(
                    """
                    UPDATE character_roster
                    SET wardrobe_active_slot = %s
                    WHERE player_uuid = %s AND character_id = %s
                      AND (
                        wardrobe_active_slot IS NULL
                        OR TRIM(wardrobe_active_slot) = ''
                      )
                    """,
                    (active_to_set, uuid, char_id),
                )
    return flushed
