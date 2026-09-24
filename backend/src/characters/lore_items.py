"""Character lore-item customise API (kit editable parts + skin bridge)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.skins.submissions import (
    MAX_DISPLAY_NAME,
    SubmissionError,
    create_submission,
    _validate_name_styles,
)
from src.skins.storage import StorageError
from src.text_validation import TextValidationError, assert_display_name, assert_prose

LORE_MAX_LINES = 6
LORE_LINE_MAX_LEN = 48

STATE_DRAFT = "draft"
STATE_PENDING_SKIN = "pending_skin"
STATE_READY = "ready"
STATE_APPLIED = "applied"
STATE_DENIED = "denied"

# Sentinel: omit existing_skin_id → leave skin refs unchanged.
_UNSET = object()


class LoreItemError(ValueError):
    """Business-rule failure for lore-item routes."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_character_id(character_id: str | None) -> str:
    cid = (character_id or "").strip()
    if not cid:
        raise LoreItemError("character_id is required", status_code=400)
    return cid


_CLAIMABLE_KIT = frozenset({"eligible", "ineligible"})


def _kit_statuses_for_character(
    player_uuid: str, character_id: str
) -> dict[str, str] | None:
    """Return kit_id → status for a roster character, or None if not on roster."""
    from src.characters.pending_create import fetch_owned_pending_create
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    if not uuid or not cid:
        return None
    if fetch_owned_pending_create(uuid, cid) is not None:
        return {}
    with connect() as conn:
        row = conn.execute(
            """
            SELECT kit_status, kit_statuses_json
            FROM character_roster
            WHERE player_uuid = ? AND character_id = ?
            """,
            (uuid, cid),
        ).fetchone()
    if row is None:
        return None
    statuses: dict[str, str] = {}
    try:
        raw = row["kit_statuses_json"]
    except (KeyError, IndexError):
        raw = None
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    if k is None or v is None:
                        continue
                    kid = str(k).strip().lower()
                    if kid:
                        statuses[kid] = str(v).strip().lower()
        except (TypeError, json.JSONDecodeError):
            pass
    if not statuses:
        kit_status = row["kit_status"]
        if kit_status is not None and str(kit_status).strip():
            statuses["starter"] = str(kit_status).strip().lower()
    return statuses


def _catalog_kit(kit_id: str) -> dict[str, Any] | None:
    from src.characters.creation_catalog import get_catalog

    kit = (kit_id or "starter").strip().lower() or "starter"
    kits = get_catalog().get("kits") or []
    if not isinstance(kits, list):
        return None
    for row in kits:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "").strip().lower() == kit:
            return row
    return None


def _is_kit_claimable(kit_def: dict[str, Any] | None, status: str | None) -> bool:
    """Customise allowed when the character can still claim that kit."""
    st = (status or "eligible").strip().lower() or "eligible"
    once = True
    if kit_def is not None:
        once = bool(kit_def.get("once_per_character", True))
    if not once:
        return True
    return st in _CLAIMABLE_KIT or st == ""


def _require_customise_allowed(
    player_uuid: str,
    character_id: str,
    kit_id: str | None = None,
) -> None:
    """Allow customise for roster (claimable kit) or pending web create."""
    from src.characters.pending_create import (
        PendingCreateError,
        resolve_player_character,
    )

    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    kit = (kit_id or "starter").strip().lower() or "starter"
    try:
        access = resolve_player_character(uuid, cid)
    except PendingCreateError as e:
        raise LoreItemError(str(e), status_code=e.status_code) from e
    if access["kind"] == "pending":
        return
    statuses = _kit_statuses_for_character(uuid, cid)
    if statuses is None:
        raise LoreItemError(
            "Character not found on roster",
            status_code=403,
        )
    kit_def = _catalog_kit(kit)
    status = statuses.get(kit)
    if status is None and kit == "starter":
        status = statuses.get("starter")
    if not _is_kit_claimable(kit_def, status):
        raise LoreItemError(
            "Kit already claimed; customise is only before claim",
            status_code=403,
        )


def remount_character_id(
    player_uuid: str, create_id: str, character_id: str
) -> int:
    """Move lore_item_customisations from create UUID onto real character_id.

    Create-scoped rows replace any existing rows for the same kit_key on the
    real character. Returns number of rows remounted.
    """
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    from_id = (create_id or "").strip()
    to_id = (character_id or "").strip()
    if not uuid or not from_id or not to_id or from_id == to_id:
        return 0

    remounted = 0
    now = _iso_now()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT kit_key FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ?
            """,
            (uuid, from_id),
        ).fetchall()
        for row in rows:
            kit_key = str(row["kit_key"] or "").strip()
            if not kit_key:
                continue
            conn.execute(
                """
                DELETE FROM lore_item_customisations
                WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
                """,
                (uuid, to_id, kit_key),
            )
            cur = conn.execute(
                """
                UPDATE lore_item_customisations
                SET character_id = ?, updated_at = ?
                WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
                """,
                (to_id, now, uuid, from_id, kit_key),
            )
            remounted += int(cur.rowcount or 0)
        conn.commit()
    return remounted


def claim_status(
    player_uuid: str,
    character_id: str,
    kit_id: str | None = None,
) -> dict[str, Any]:
    """Plugin helper: claim gates for pending approval / pending pack / ready rows.

    ``pending_skin`` — linked skin still staff-``pending`` (awaiting approval).
    ``pending_pack`` — skin approved but not pack-applied yet (customise still
    ``pending_skin`` with submission ``approved``). Claim must wait; skins are
    not on ArmourShop yet.

    When ``kit_id`` is set, only customisations whose ``kit_key`` belongs to that
    kit (from catalog ``editable_kit`` / ``kits``) are considered. Fallback when
    kits payload is missing: for ``starter`` (default), any row for the character.
    """
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    kit = (kit_id or "starter").strip().lower() or "starter"
    pending_skin = False
    pending_pack = False
    ready = False
    if not uuid or not cid:
        return {
            "pending_skin": False,
            "pending_pack": False,
            "ready": False,
            "kit_id": kit,
        }

    allowed_keys = _kit_editable_keys(kit)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT LOWER(COALESCE(state, '')) AS state,
                   LOWER(COALESCE(kit_key, '')) AS kit_key,
                   submission_id
            FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ?
            """,
            (uuid, cid),
        ).fetchall()
        sub_ids = [
            str(r["submission_id"]).strip()
            for r in rows
            if r["submission_id"] is not None and str(r["submission_id"]).strip()
        ]
        sub_status: dict[str, str] = {}
        if sub_ids:
            placeholders = ",".join("?" * len(sub_ids))
            for sub in conn.execute(
                f"SELECT id, LOWER(COALESCE(status, '')) AS status "
                f"FROM submissions WHERE id IN ({placeholders})",
                sub_ids,
            ).fetchall():
                sid = str(sub["id"] or "").strip()
                if sid:
                    sub_status[sid] = str(sub["status"] or "").strip().lower()

    for row in rows:
        key = str(row["kit_key"] or "").strip().lower()
        if allowed_keys is not None and key not in allowed_keys:
            continue
        state = str(row["state"] or "").strip().lower()
        if state == STATE_PENDING_SKIN:
            sid = (
                str(row["submission_id"]).strip()
                if row["submission_id"] is not None
                else ""
            )
            st = sub_status.get(sid, "pending" if sid else "")
            if st == "approved":
                pending_pack = True
            elif not sid or st == "pending":
                pending_skin = True
            elif st != "applied":
                # Unknown / odd status while customise still pending_skin — block claim.
                pending_pack = True
        elif state == STATE_READY:
            ready = True
    return {
        "pending_skin": pending_skin,
        "pending_pack": pending_pack,
        "ready": ready,
        "kit_id": kit,
    }


def _kit_editable_keys(kit_id: str) -> set[str] | None:
    """Return kit_key set for ``kit_id``, or None to mean 'any key' (fallback)."""
    from src.characters.creation_catalog import get_catalog

    kit = (kit_id or "starter").strip().lower() or "starter"
    catalog = get_catalog()
    keys: set[str] = set()

    kits = catalog.get("kits")
    if isinstance(kits, list) and kits:
        for row in kits:
            if not isinstance(row, dict):
                continue
            if str(row.get("id") or "").strip().lower() != kit:
                continue
            items = row.get("items")
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                if not item.get("editable"):
                    continue
                path = str(item.get("path") or "").strip()
                if not path:
                    continue
                keys.add(_kit_key_from_path(path))
            return keys

    editable = catalog.get("editable_kit") or []
    if isinstance(editable, list) and editable:
        tagged = False
        for row in editable:
            if not isinstance(row, dict):
                continue
            row_kit = str(row.get("kit_id") or "").strip().lower()
            if row_kit:
                tagged = True
            if row_kit == kit:
                key = str(row.get("kit_key") or "").strip().lower()
                if key:
                    keys.add(key)
        if tagged:
            return keys
        # Untagged flat editable_kit: only filter for starter (character-wide).
        if kit == "starter":
            return None
        return set()

    # No kits / editable payload yet.
    if kit == "starter":
        return None
    return set()


def _kit_key_from_path(path: str) -> str:
    segment = path.rsplit(".", 1)[-1] if path else ""
    return segment.strip().lower()


def _editable_rows() -> list[dict[str, Any]]:
    from src.characters.creation_catalog import get_catalog

    catalog = get_catalog()
    raw = catalog.get("editable_kit") or []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if isinstance(row, dict) and str(row.get("kit_key") or "").strip():
            out.append(row)
    return out


def _editable_by_key(kit_key: str) -> dict[str, Any]:
    key = (kit_key or "").strip().lower()
    for row in _editable_rows():
        if str(row.get("kit_key") or "").strip().lower() == key:
            return row
    raise LoreItemError(f"Unknown editable kit key '{kit_key}'", status_code=404)


def _path_for_kit_key(kit_key: str) -> str:
    try:
        return str(_editable_by_key(kit_key).get("path") or "").strip()
    except LoreItemError:
        return ""


def _parse_lore_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [str(line) for line in data if line is not None]


def _lore_line_has_leading_colour(line: str) -> bool:
    """True when the line already starts with a colour (§0-9a-f, &…, or #RRGGBB).

    Format codes alone (§l bold, §o italic, …) are not colours — those lines
    still need a leading §7 so bold/italic do not inherit client defaults
    (purple italic).
    """
    s = (line or "").lstrip()
    if not s:
        return False
    if s[0] in ("§", "&") and len(s) >= 2:
        code = s[1].lower()
        return code in "0123456789abcdef"
    if s[0] == "#" and len(s) >= 7 and all(
        c in "0123456789abcdefABCDEF" for c in s[1:7]
    ):
        return True
    return False


def _normalize_lore_line(line: str) -> str:
    """Prepend §7 when the line has no leading colour token."""
    s = (line or "").strip()
    if not s:
        return s
    if _lore_line_has_leading_colour(s):
        return s
    return "§7" + s


def _validate_lore(lore: list[str] | None) -> list[str]:
    if lore is None:
        return []
    if not isinstance(lore, list):
        raise LoreItemError("lore must be a list")
    if len(lore) > LORE_MAX_LINES:
        raise LoreItemError(f"lore must have at most {LORE_MAX_LINES} lines")
    out: list[str] = []
    for i, line in enumerate(lore):
        try:
            validated = assert_prose(
                line,
                min_len=1,
                max_len=LORE_LINE_MAX_LEN,
                field=f"lore[{i}]",
                allow_colour_codes=True,
            )
        except TextValidationError as e:
            raise LoreItemError(str(e)) from e
        out.append(_normalize_lore_line(validated))
    return out


def _validate_name_colours(raw: list | None) -> list[str]:
    from src.name_colours import NameColourError, validate_name_colours

    if not raw:
        return []
    try:
        return validate_name_colours(raw)
    except NameColourError as e:
        raise LoreItemError(str(e)) from e


def _validate_lore_name_styles(raw: list | None) -> list[str]:
    if not raw:
        return []
    try:
        return _validate_name_styles(raw)
    except SubmissionError as e:
        raise LoreItemError(str(e)) from e


def _validate_display_name(raw: str | None) -> str:
    try:
        return assert_display_name(
            raw,
            min_len=1,
            max_len=MAX_DISPLAY_NAME,
            field="display name",
        )
    except TextValidationError as e:
        raise LoreItemError(str(e)) from e


def _base_preview(editable: dict[str, Any]) -> dict[str, Any]:
    preview = editable.get("preview")
    if not isinstance(preview, dict):
        return {
            "display_name": "",
            "lore": [],
            "material": "",
        }
    lore_raw = preview.get("lore")
    lore = (
        [str(line) for line in lore_raw if line is not None]
        if isinstance(lore_raw, list)
        else []
    )
    out: dict[str, Any] = {
        "display_name": str(preview.get("display_name") or ""),
        "lore": lore,
        "material": str(preview.get("material") or ""),
    }
    cmd = preview.get("custom_model_data")
    if cmd is not None:
        try:
            out["custom_model_data"] = int(cmd)
        except (TypeError, ValueError):
            pass
    return out


def _merge_preview(
    base: dict[str, Any],
    draft_name: str,
    draft_lore: list[str],
) -> dict[str, Any]:
    name = draft_name.strip() if draft_name and draft_name.strip() else base.get(
        "display_name", ""
    )
    base_lore = list(base.get("lore") or [])
    draft = [str(x) for x in (draft_lore or []) if x is not None]
    if base_lore and draft:
        merged_lore = base_lore + [" "] + draft
    else:
        merged_lore = base_lore + draft
    out: dict[str, Any] = {
        "display_name": name,
        "lore": merged_lore,
        "material": base.get("material") or "",
    }
    if "custom_model_data" in base:
        out["custom_model_data"] = base["custom_model_data"]
    return out


def _row_keys(row: Any) -> set[str]:
    try:
        return set(row.keys())
    except Exception:
        return set()


def _load_row(
    player_uuid: str, character_id: str, kit_key: str
) -> dict[str, Any] | None:
    from src.skins.db import connect

    with connect() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
            """,
            (player_uuid, character_id, kit_key),
        ).fetchone()
    if row is None:
        return None
    keys = _row_keys(row)
    submission_id = row["submission_id"]
    state = str(row["state"] if "state" in keys else STATE_DRAFT) or STATE_DRAFT
    submission_status = None
    deny_reason = None
    if "deny_reason" in keys:
        raw_reason = row["deny_reason"]
        if raw_reason is not None and str(raw_reason).strip():
            deny_reason = str(raw_reason).strip()
    if submission_id:
        with connect() as conn:
            sub = conn.execute(
                "SELECT status, deny_reason FROM submissions WHERE id = ?",
                (submission_id,),
            ).fetchone()
        if sub is not None:
            submission_status = str(sub["status"] or "")
            reason = sub["deny_reason"] if "deny_reason" in sub.keys() else None
            if reason is not None and str(reason).strip():
                deny_reason = str(reason).strip()
        elif state == STATE_DENIED:
            submission_status = STATE_DENIED
    elif state == STATE_DENIED:
        submission_status = STATE_DENIED
    return {
        "display_name": str(row["display_name"] or ""),
        "lore": _parse_lore_json(row["lore_json"]),
        "existing_skin_id": row["existing_skin_id"],
        "submission_id": submission_id,
        "submission_status": submission_status,
        "deny_reason": deny_reason,
        "state": state,
        "skin_slug": row["skin_slug"] if "skin_slug" in keys else None,
        "ready_at": row["ready_at"] if "ready_at" in keys else None,
        "applied_at": row["applied_at"] if "applied_at" in keys else None,
        "name_colours": _parse_name_colours(
            row["name_colours"] if "name_colours" in keys else None
        ),
        "name_styles": _parse_name_styles(
            row["name_styles"] if "name_styles" in keys else None
        ),
    }


def _parse_name_colours(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw if x is not None and str(x).strip()]
    try:
        data = json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if x is not None and str(x).strip()]


def _parse_name_styles(raw: Any) -> list[str]:
    return _parse_name_colours(raw)


def _load_draft(
    player_uuid: str, character_id: str, kit_key: str
) -> dict[str, Any]:
    row = _load_row(player_uuid, character_id, kit_key)
    if row is None:
        return {
            "display_name": "",
            "lore": [],
            "existing_skin_id": None,
            "submission_id": None,
            "submission_status": None,
            "deny_reason": None,
            "state": STATE_DRAFT,
            "skin_slug": None,
            "ready_at": None,
            "applied_at": None,
            "ia_namespace": None,
            "name_colours": [],
            "name_styles": [],
        }
    slug = row.get("skin_slug") or row.get("existing_skin_id") or row.get("submission_id")
    row["ia_namespace"] = _namespace_for_skin_id(str(slug) if slug else None)
    return row


def _submission_texture_path(submission_id: str, variant: str | None = None):
    """Return Path to texture PNG if present on website disk."""
    from src.skins.db import SKINS_DIR

    sid = (submission_id or "").strip()
    if not sid or "/" in sid or "\\" in sid or ".." in sid:
        return None
    want_signed = (variant or "").strip().lower() == "signed"
    if want_signed:
        signed = SKINS_DIR / sid / f"{sid}_signed.png"
        if signed.is_file():
            return signed
        return None
    path = SKINS_DIR / sid / f"{sid}.png"
    if path.is_file():
        return path
    unsigned = SKINS_DIR / sid / f"{sid}_unsigned.png"
    if unsigned.is_file():
        return unsigned
    return None


def _submission_model_path(submission_id: str):
    """Return Path to primary Java model JSON if present on website disk."""
    from src.skins.db import SKINS_DIR

    sid = (submission_id or "").strip()
    if not sid or "/" in sid or "\\" in sid or ".." in sid:
        return None
    path = SKINS_DIR / sid / f"{sid}.json"
    if path.is_file():
        return path
    return None


def _assert_pickable_skin_access(
    player_uuid: str,
    submission_id: str,
    base_set: str | None = None,
) -> str:
    """Verify pickable skin ACL. Returns submission id. Raises LoreItemError."""
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    sid = (submission_id or "").strip()
    if not uuid or not sid:
        raise LoreItemError("not found", status_code=404)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, base_set, status, staff, category, player_uuid
            FROM submissions
            WHERE id = ?
            """,
            (sid,),
        ).fetchone()
    if row is None:
        raise LoreItemError("not found", status_code=404)
    if str(row["status"] or "").strip().lower() != "applied":
        raise LoreItemError("not found", status_code=404)
    staff = bool(row["staff"]) if "staff" in row.keys() else False
    cat = str(row["category"] or "").strip().lower()
    owner = str(row["player_uuid"] or "").strip()
    if staff:
        if cat != "i_tools":
            raise LoreItemError("not found", status_code=404)
    elif owner.lower() != uuid.lower():
        raise LoreItemError("not found", status_code=404)
    if base_set:
        row_base = str(row["base_set"] or "").strip().lower()
        if row_base != base_set.strip().lower():
            raise LoreItemError("not found", status_code=404)
    return sid


def _namespace_for_staff(staff: bool) -> str:
    from src.skins.catalog import IA_NAMESPACE_ARMOURSHOP

    return IA_NAMESPACE_ARMOURSHOP if staff else "tfmc_submissions"


def _namespace_for_skin_id(skin_id: str | None) -> str | None:
    from src.skins.db import connect

    sid = (skin_id or "").strip()
    if not sid:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT staff FROM submissions WHERE id = ?",
            (sid,),
        ).fetchone()
    if row is None:
        return "tfmc_submissions"
    staff = bool(row["staff"]) if "staff" in row.keys() else False
    return _namespace_for_staff(staff)


def _list_pickable_skins(
    player_uuid: str, base_set: str
) -> list[dict[str, Any]]:
    from src.skins.db import connect

    base = (base_set or "").strip().lower()
    uuid = (player_uuid or "").strip()
    if not base or not uuid:
        return []
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, display_name, kind, staff, category, player_uuid
            FROM submissions
            WHERE LOWER(COALESCE(base_set, '')) = ?
              AND LOWER(status) = 'applied'
              AND (
                (COALESCE(staff, 0) = 0 AND LOWER(player_uuid) = LOWER(?))
                OR (
                  COALESCE(staff, 0) = 1
                  AND LOWER(COALESCE(category, '')) = 'i_tools'
                )
              )
            ORDER BY display_name COLLATE NOCASE ASC, id ASC
            """,
            (base, uuid),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        sid = str(row["id"] or "").strip()
        if not sid or _submission_texture_path(sid) is None:
            continue
        staff = bool(row["staff"]) if "staff" in row.keys() else False
        out.append(
            {
                "id": sid,
                "display_name": row["display_name"],
                "kind": row["kind"],
                "ia_namespace": _namespace_for_staff(staff),
                "staff": staff,
            }
        )
    return out


def _validate_existing_skin(
    skin_id: str, base_set: str, player_uuid: str
) -> tuple[str, str]:
    """Return (skin_id, ia_namespace) if pickable for this player."""
    from src.skins.db import connect

    sid = (skin_id or "").strip()
    if not sid:
        raise LoreItemError("existing_skin_id is required when provided")
    base = (base_set or "").strip().lower()
    uuid = (player_uuid or "").strip()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, base_set, status, staff, category, player_uuid
            FROM submissions
            WHERE id = ?
            """,
            (sid,),
        ).fetchone()
    if row is None:
        raise LoreItemError("existing_skin_id not found", status_code=400)
    if str(row["status"] or "").strip().lower() != "applied":
        raise LoreItemError(
            "existing_skin_id must be an applied skin",
            status_code=400,
        )
    row_base = str(row["base_set"] or "").strip().lower()
    if row_base != base:
        raise LoreItemError(
            f"existing_skin_id base_set must be '{base}'",
            status_code=400,
        )
    staff = bool(row["staff"]) if "staff" in row.keys() else False
    cat = str(row["category"] or "").strip().lower()
    owner = str(row["player_uuid"] or "").strip()
    if staff:
        if cat != "i_tools":
            raise LoreItemError(
                "staff existing_skin_id must be category i_tools",
                status_code=400,
            )
    else:
        if owner.lower() != uuid.lower():
            raise LoreItemError(
                "existing_skin_id must belong to this player",
                status_code=400,
            )
    if _submission_texture_path(sid) is None:
        raise LoreItemError(
            "existing_skin_id texture file is missing",
            status_code=400,
        )
    return sid, _namespace_for_staff(staff)


def _ia_path(skin_slug: str | None, ia_namespace: str | None = None) -> str | None:
    slug = (skin_slug or "").strip()
    if not slug:
        return None
    ns = (ia_namespace or "").strip() or "tfmc_submissions"
    return f"ia.{ns}:{slug}"


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_KIT_SKIN_BYTES = 2 * 1024 * 1024


def _backend_root():
    from pathlib import Path

    return Path(__file__).resolve().parents[2]


def _kit_skins_dir():
    return _backend_root() / "assets" / "kit_skins"


def _kit_skins_search_dirs() -> list:
    """Directories that may contain default kit PNGs named {skin_png}.png."""
    import os
    from pathlib import Path

    dirs: list = []
    env = (os.environ.get("KIT_SKINS_DIR") or "").strip()
    if env:
        dirs.append(Path(env))
    # ProvinceSystem/backend/assets/kit_skins (plugin sync target)
    dirs.append(_kit_skins_dir())
    # Workspace fallback: sibling RPCharacters checkout's bundled assets (local only)
    tfmc_root = _backend_root().parent.parent
    dirs.append(
        tfmc_root
        / "rpcharacters"
        / "src"
        / "main"
        / "resources"
        / "assets"
    )
    return dirs


def sanitize_kit_skin_stem(name: str | None) -> str:
    """Stem only: no path separators or '..'. Raises LoreItemError."""
    raw = (name or "").strip()
    if raw.lower().endswith(".png"):
        raw = raw[:-4].strip()
    if not raw:
        raise LoreItemError("kit skin name is required", status_code=400)
    if "/" in raw or "\\" in raw or ".." in raw:
        raise LoreItemError("invalid kit skin name", status_code=400)
    # Keep stems filesystem-safe and URL-path-safe
    for ch in raw:
        if ch.isalnum() or ch in ("_", "-", "."):
            continue
        raise LoreItemError("invalid kit skin name", status_code=400)
    if raw.startswith(".") or raw.endswith("."):
        raise LoreItemError("invalid kit skin name", status_code=400)
    return raw


def store_plugin_kit_skin(name: str, data: bytes) -> dict[str, Any]:
    """Write plugin-synced default kit PNG under assets/kit_skins/."""
    import os

    stem = sanitize_kit_skin_stem(name)
    if not data:
        raise LoreItemError("empty body", status_code=400)
    if len(data) > MAX_KIT_SKIN_BYTES:
        raise LoreItemError(
            f"PNG exceeds max size ({MAX_KIT_SKIN_BYTES} bytes)", status_code=400
        )
    if not data.startswith(PNG_MAGIC):
        raise LoreItemError("body must be a PNG", status_code=400)

    out_dir = _kit_skins_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{stem}.png"
    tmp = out_dir / f".{stem}.png.tmp"
    try:
        tmp.write_bytes(data)
        os.replace(tmp, target)
    except OSError as e:
        try:
            if tmp.is_file():
                tmp.unlink()
        except OSError:
            pass
        raise LoreItemError(f"could not write kit skin: {e}", status_code=500) from e
    return {"ok": True, "name": stem, "path": f"assets/kit_skins/{stem}.png"}


def resolve_default_kit_texture(kit_key: str, variant: str | None = None):
    """Path to catalog default skin PNG for an editable kit_key. Raises LoreItemError."""
    from pathlib import Path

    key = (kit_key or "").strip()
    if not key:
        raise LoreItemError("kit_key is required", status_code=400)
    editable = _editable_by_key(key)
    want_signed = (variant or "").strip().lower() == "signed"
    field = "skin_png_signed" if want_signed else "skin_png"
    skin_png = str(editable.get(field) or "").strip()
    if not skin_png:
        raise LoreItemError("no default texture for this item", status_code=404)
    stem = skin_png[:-4] if skin_png.lower().endswith(".png") else skin_png
    if not stem or "/" in stem or "\\" in stem or ".." in stem:
        raise LoreItemError("no default texture for this item", status_code=404)
    filename = f"{stem}.png"
    for folder in _kit_skins_search_dirs():
        path = Path(folder) / filename
        if path.is_file():
            return path
    raise LoreItemError("default texture file missing", status_code=404)


def resolve_pickable_texture(
    player_uuid: str,
    submission_id: str,
    base_set: str | None = None,
    variant: str | None = None,
):
    """ACL + path for character-session texture preview. Raises LoreItemError."""
    sid = _assert_pickable_skin_access(player_uuid, submission_id, base_set)
    path = _submission_texture_path(sid, variant)
    if path is None:
        raise LoreItemError("not found", status_code=404)
    return path


def resolve_pickable_model(
    player_uuid: str,
    submission_id: str,
    base_set: str | None = None,
):
    """ACL + path for character-session model preview. Raises LoreItemError."""
    sid = _assert_pickable_skin_access(player_uuid, submission_id, base_set)
    path = _submission_model_path(sid)
    if path is None:
        raise LoreItemError("not found", status_code=404)
    return path


def _build_item(
    player_uuid: str,
    character_id: str,
    editable: dict[str, Any],
) -> dict[str, Any]:
    kit_key = str(editable.get("kit_key") or "").strip()
    base_set = str(editable.get("base_set") or "").strip()
    base_preview = _base_preview(editable)
    draft = _load_draft(player_uuid, character_id, kit_key)
    preview = _merge_preview(
        base_preview, draft["display_name"], draft["lore"]
    )
    return {
        "kit_key": kit_key,
        "path": str(editable.get("path") or ""),
        "skin_png": str(editable.get("skin_png") or ""),
        "skin_png_signed": str(editable.get("skin_png_signed") or ""),
        "base_set": base_set,
        "2d_template": str(editable.get("2d_template") or "").strip()
        or "handheld",
        "3d_template": (
            str(editable.get("3d_template") or "").strip() or None
        ),
        "eligible": True,
        "base_preview": base_preview,
        "preview": preview,
        "draft": draft,
        "state": draft.get("state") or STATE_DRAFT,
        "skin_slug": draft.get("skin_slug"),
        "pickable_skins": _list_pickable_skins(player_uuid, base_set),
    }


def list_lore_items(
    player_uuid: str,
    character_id: str | None,
    kit_id: str | None = None,
) -> dict[str, Any]:
    """List editable kit parts + drafts for a claimable kit on a roster character."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise LoreItemError("player_uuid is required", status_code=401)
    cid = _require_character_id(character_id)
    kit = (kit_id or "starter").strip().lower() or "starter"
    _require_customise_allowed(uuid, cid, kit)
    allowed = _kit_editable_keys(kit)
    items: list[dict[str, Any]] = []
    for editable in _editable_rows():
        row_kit = str(editable.get("kit_id") or "").strip().lower()
        key = str(editable.get("kit_key") or "").strip().lower()
        if row_kit and row_kit != kit:
            continue
        if allowed is not None:
            if key not in allowed:
                continue
        elif kit != "starter":
            continue
        item = _build_item(uuid, cid, editable)
        item["kit_id"] = row_kit or kit
        items.append(item)
    return {"character_id": cid, "kit_id": kit, "items": items}


def list_character_kits(player_uuid: str, character_id: str | None) -> dict[str, Any]:
    """Full kits list for a roster or pending-create character."""
    from src.characters.creation_catalog import get_catalog
    from src.characters.pending_create import (
        PendingCreateError,
        resolve_player_character,
    )
    from src.characters.roster import get_player_meta

    uuid = (player_uuid or "").strip()
    if not uuid:
        raise LoreItemError("player_uuid is required", status_code=401)
    cid = _require_character_id(character_id)
    try:
        access = resolve_player_character(uuid, cid)
    except PendingCreateError as e:
        raise LoreItemError(str(e), status_code=e.status_code) from e
    is_pending = access["kind"] == "pending"
    statuses = _kit_statuses_for_character(uuid, cid)
    if statuses is None:
        raise LoreItemError(
            "Character not found on roster",
            status_code=403,
        )
    catalog = get_catalog()
    kits_raw = catalog.get("kits") or []
    if not isinstance(kits_raw, list):
        kits_raw = []
    editable_by_key: dict[str, dict[str, Any]] = {}
    for row in _editable_rows():
        key = str(row.get("kit_key") or "").strip().lower()
        if key:
            editable_by_key[key] = row
    meta = get_player_meta(uuid)
    cooldowns = (
        meta.get("kit_cooldowns")
        if isinstance(meta.get("kit_cooldowns"), dict)
        else {}
    )

    out_kits: list[dict[str, Any]] = []
    for kit_row in kits_raw:
        if not isinstance(kit_row, dict):
            continue
        kid = str(kit_row.get("id") or "").strip().lower()
        if not kid:
            continue
        status = statuses.get(kid) or "eligible"
        if is_pending:
            status = "eligible"
        claimable = _is_kit_claimable(kit_row, status)
        cd_raw = cooldowns.get(kid) if isinstance(cooldowns, dict) else None
        cooldown = None
        if isinstance(cd_raw, dict):
            try:
                cooldown = {
                    "seconds_remaining": max(
                        0, int(cd_raw.get("seconds_remaining") or 0)
                    ),
                    "hours": max(
                        0,
                        int(
                            cd_raw.get("hours")
                            or kit_row.get("cooldown_hours")
                            or 0
                        ),
                    ),
                }
            except (TypeError, ValueError):
                cooldown = None
        elif kid == "starter":
            try:
                secs = int(meta.get("kit_cooldown_seconds_remaining") or 0)
                hours = meta.get("kit_cooldown_hours")
                if hours is None:
                    hours = kit_row.get("cooldown_hours") or 0
                cooldown = {
                    "seconds_remaining": max(0, secs),
                    "hours": max(0, int(hours or 0)),
                }
            except (TypeError, ValueError):
                cooldown = None

        items_out: list[dict[str, Any]] = []
        items_raw = (
            kit_row.get("items") if isinstance(kit_row.get("items"), list) else []
        )
        for item in items_raw:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path") or "").strip()
            if not path:
                continue
            try:
                amount = max(1, int(item.get("amount", 1)))
            except (TypeError, ValueError):
                amount = 1
            editable = bool(item.get("editable"))
            entry: dict[str, Any] = {
                "path": path,
                "amount": amount,
                "editable": editable,
            }
            display_name = str(item.get("display_name") or "").strip()
            if display_name:
                entry["display_name"] = display_name
            if editable:
                kit_key = _kit_key_from_path(path)
                entry["kit_key"] = kit_key
                ed = editable_by_key.get(kit_key)
                if ed:
                    if ed.get("preview"):
                        entry["preview"] = _base_preview(ed)
                    entry["skin_png"] = str(ed.get("skin_png") or "")
                    signed = str(ed.get("skin_png_signed") or "")
                    if signed:
                        entry["skin_png_signed"] = signed
                    entry["base_set"] = str(ed.get("base_set") or "")
                entry["customise"] = _load_draft(uuid, cid, kit_key)
            items_out.append(entry)

        out_kits.append(
            {
                "id": kid,
                "display_name": str(kit_row.get("display_name") or kid),
                "cooldown_hours": int(kit_row.get("cooldown_hours") or 0),
                "once_per_character": bool(
                    kit_row.get("once_per_character", True)
                ),
                "status": status,
                "claimable": claimable,
                "cooldown": cooldown,
                "items": items_out,
            }
        )

    return {"character_id": cid, "kits": out_kits}


def customise_lore_item(
    session_row: dict,
    character_id: str | None,
    kit_key: str,
    *,
    display_name: str | None,
    lore: list[str] | None,
    existing_skin_id: Any = _UNSET,
    texture_bytes: bytes | None = None,
    unsigned_bytes: bytes | None = None,
    signed_bytes: bytes | None = None,
    model_bytes: bytes | None = None,
    use_3d: bool = False,
    name_colours: list[str] | None = None,
    name_styles: list[str] | None = None,
    kit_id: str | None = None,
) -> dict[str, Any]:
    """Validate and store customise draft; optionally bridge a new skin upload."""
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    player_uuid = str(session_row.get("player_uuid") or "").strip()
    if not player_uuid:
        raise LoreItemError("Invalid session", status_code=401)
    try:
        lore_realm = normalize_realm_id(session_row.get("realm_id"))
    except Exception:
        lore_realm = "main"
    cid = _require_character_id(character_id)
    kit = (kit_id or "starter").strip().lower() or "starter"
    _require_customise_allowed(player_uuid, cid, kit)

    key = (kit_key or "").strip()
    if not key:
        raise LoreItemError("kit_key is required", status_code=400)
    editable = _editable_by_key(key)
    row_kit = str(editable.get("kit_id") or "").strip().lower()
    if row_kit and row_kit != kit:
        raise LoreItemError(
            f"kit_key '{key}' does not belong to kit '{kit}'",
            status_code=400,
        )
    allowed = _kit_editable_keys(kit)
    kit_key_norm = str(editable.get("kit_key") or "").strip()
    if allowed is not None and kit_key_norm.lower() not in allowed:
        raise LoreItemError(
            f"kit_key '{key}' does not belong to kit '{kit}'",
            status_code=400,
        )
    base_set = str(editable.get("base_set") or "").strip()

    has_upload = (
        texture_bytes is not None
        or unsigned_bytes is not None
        or signed_bytes is not None
    )
    if has_upload:
        from src.skins.codes import ensure_lore_upload_code

        lore_code_id = ensure_lore_upload_code(player_uuid, lore_realm)
        submission_session = {**session_row, "code_id": lore_code_id, "staff": False}
    else:
        submission_session = session_row

    if has_upload and existing_skin_id is not _UNSET and existing_skin_id:
        raise LoreItemError(
            "Provide either texture upload or existing_skin_id, not both"
        )

    name = _validate_display_name(display_name)
    lore_lines = _validate_lore(lore)
    colours = _validate_name_colours(name_colours)
    colours_json = json.dumps(colours, separators=(",", ":")) if colours else None
    styles = _validate_lore_name_styles(name_styles)
    styles_json = json.dumps(styles, separators=(",", ":")) if styles else None

    flat_kind = str(editable.get("2d_template") or "").strip() or "handheld"
    three_d_kind = str(editable.get("3d_template") or "").strip() or None

    prev = _load_draft(player_uuid, cid, kit_key_norm)
    prev_state = str(prev.get("state") or STATE_DRAFT).strip().lower()
    next_existing = prev.get("existing_skin_id")
    next_submission = prev.get("submission_id")
    next_slug = prev.get("skin_slug")
    next_state = prev.get("state") or STATE_DRAFT
    next_ready_at = prev.get("ready_at")
    next_applied_at = prev.get("applied_at")
    now = _iso_now()

    if prev_state == STATE_DENIED:
        has_new_upload = has_upload
        has_new_pick = (
            existing_skin_id is not _UNSET
            and existing_skin_id is not None
            and str(existing_skin_id).strip()
        )
        if not has_new_upload and not has_new_pick:
            raise LoreItemError(
                "Skin was denied. Choose a different skin (upload or pick) and submit again.",
                status_code=400,
            )

    if flat_kind == "book" and (
        unsigned_bytes is not None
        or signed_bytes is not None
        or texture_bytes is not None
    ):
        if use_3d or model_bytes:
            raise LoreItemError("3D not allowed for book items", status_code=400)
        if texture_bytes is not None and (
            unsigned_bytes is None or signed_bytes is None
        ):
            raise LoreItemError(
                "Book customise requires unsigned and signed PNG uploads"
            )
        if not unsigned_bytes or not signed_bytes:
            raise LoreItemError(
                "Book customise requires unsigned and signed PNG uploads"
            )
        files: dict[str, bytes] = {
            "unsigned": unsigned_bytes,
            "signed": signed_bytes,
        }
        try:
            created = create_submission(
                submission_session,
                kind="book",
                display_name=name,
                files_bytes=files,
                base_set=base_set or None,
                add_name=True,
                name_colours=colours or None,
                name_styles=styles or None,
                source="lore",
            )
        except (SubmissionError, StorageError) as e:
            raise LoreItemError(str(e)) from e
        next_submission = created.get("id")
        next_existing = None
        next_slug = None
        next_state = STATE_PENDING_SKIN
        next_ready_at = None
    elif texture_bytes is not None:
        if not texture_bytes:
            raise LoreItemError("texture file is empty")
        want_3d = bool(use_3d) or bool(model_bytes)
        if want_3d:
            if not three_d_kind:
                raise LoreItemError(
                    "3D not allowed for this item",
                    status_code=400,
                )
            if not model_bytes:
                raise LoreItemError("3D upload requires a model JSON file")
        files = {"texture": texture_bytes}
        kind = flat_kind
        if want_3d:
            kind = three_d_kind
            files["model"] = model_bytes  # type: ignore[assignment]
        try:
            created = create_submission(
                submission_session,
                kind=kind,
                display_name=name,
                files_bytes=files,
                base_set=base_set or None,
                add_name=True,
                name_colours=colours or None,
                name_styles=styles or None,
                source="lore",
            )
        except (SubmissionError, StorageError) as e:
            raise LoreItemError(str(e)) from e
        next_submission = created.get("id")
        next_existing = None
        next_slug = None
        next_state = STATE_PENDING_SKIN
        next_ready_at = None
    elif existing_skin_id is not _UNSET and existing_skin_id is not None:
        sid = str(existing_skin_id).strip()
        if sid:
            next_existing, _ns = _validate_existing_skin(
                sid, base_set, str(session_row.get("player_uuid") or "")
            )
            next_submission = None
            next_slug = next_existing
            next_state = STATE_READY
            next_ready_at = now
        else:
            next_existing = None
            next_slug = None
    else:
        if next_submission and (prev.get("state") or "") == STATE_PENDING_SKIN:
            next_state = STATE_PENDING_SKIN
            next_ready_at = prev.get("ready_at")
        else:
            next_state = STATE_READY
            next_ready_at = now

    lore_json = json.dumps(lore_lines, separators=(",", ":"))
    with connect() as conn:
        cols = {
            r["name"]
            for r in conn.execute(
                "PRAGMA table_info(lore_item_customisations)"
            ).fetchall()
        }
        if "kit_id" in cols:
            if "name_colours" in cols and "name_styles" in cols:
                conn.execute(
                    """
                    INSERT INTO lore_item_customisations (
                        player_uuid, character_id, kit_key,
                        display_name, lore_json,
                        existing_skin_id, submission_id,
                        state, skin_slug, ready_at, applied_at, kit_id,
                        name_colours, name_styles, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(player_uuid, character_id, kit_key) DO UPDATE SET
                        display_name = excluded.display_name,
                        lore_json = excluded.lore_json,
                        existing_skin_id = excluded.existing_skin_id,
                        submission_id = excluded.submission_id,
                        state = excluded.state,
                        skin_slug = excluded.skin_slug,
                        ready_at = excluded.ready_at,
                        applied_at = excluded.applied_at,
                        kit_id = excluded.kit_id,
                        name_colours = excluded.name_colours,
                        name_styles = excluded.name_styles,
                        updated_at = excluded.updated_at
                    """,
                    (
                        player_uuid,
                        cid,
                        kit_key_norm,
                        name,
                        lore_json,
                        next_existing,
                        next_submission,
                        next_state,
                        next_slug,
                        next_ready_at,
                        next_applied_at,
                        kit,
                        colours_json,
                        styles_json,
                        now,
                    ),
                )
            elif "name_colours" in cols:
                conn.execute(
                    """
                    INSERT INTO lore_item_customisations (
                        player_uuid, character_id, kit_key,
                        display_name, lore_json,
                        existing_skin_id, submission_id,
                        state, skin_slug, ready_at, applied_at, kit_id,
                        name_colours, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(player_uuid, character_id, kit_key) DO UPDATE SET
                        display_name = excluded.display_name,
                        lore_json = excluded.lore_json,
                        existing_skin_id = excluded.existing_skin_id,
                        submission_id = excluded.submission_id,
                        state = excluded.state,
                        skin_slug = excluded.skin_slug,
                        ready_at = excluded.ready_at,
                        applied_at = excluded.applied_at,
                        kit_id = excluded.kit_id,
                        name_colours = excluded.name_colours,
                        updated_at = excluded.updated_at
                    """,
                    (
                        player_uuid,
                        cid,
                        kit_key_norm,
                        name,
                        lore_json,
                        next_existing,
                        next_submission,
                        next_state,
                        next_slug,
                        next_ready_at,
                        next_applied_at,
                        kit,
                        colours_json,
                        now,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO lore_item_customisations (
                        player_uuid, character_id, kit_key,
                        display_name, lore_json,
                        existing_skin_id, submission_id,
                        state, skin_slug, ready_at, applied_at, kit_id, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(player_uuid, character_id, kit_key) DO UPDATE SET
                        display_name = excluded.display_name,
                        lore_json = excluded.lore_json,
                        existing_skin_id = excluded.existing_skin_id,
                        submission_id = excluded.submission_id,
                        state = excluded.state,
                        skin_slug = excluded.skin_slug,
                        ready_at = excluded.ready_at,
                        applied_at = excluded.applied_at,
                        kit_id = excluded.kit_id,
                        updated_at = excluded.updated_at
                    """,
                    (
                        player_uuid,
                        cid,
                        kit_key_norm,
                        name,
                        lore_json,
                        next_existing,
                        next_submission,
                        next_state,
                        next_slug,
                        next_ready_at,
                        next_applied_at,
                        kit,
                        now,
                    ),
                )
        else:
            conn.execute(
                """
                INSERT INTO lore_item_customisations (
                    player_uuid, character_id, kit_key,
                    display_name, lore_json,
                    existing_skin_id, submission_id,
                    state, skin_slug, ready_at, applied_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(player_uuid, character_id, kit_key) DO UPDATE SET
                    display_name = excluded.display_name,
                    lore_json = excluded.lore_json,
                    existing_skin_id = excluded.existing_skin_id,
                    submission_id = excluded.submission_id,
                    state = excluded.state,
                    skin_slug = excluded.skin_slug,
                    ready_at = excluded.ready_at,
                    applied_at = excluded.applied_at,
                    updated_at = excluded.updated_at
                """,
                (
                    player_uuid,
                    cid,
                    kit_key_norm,
                    name,
                    lore_json,
                    next_existing,
                    next_submission,
                    next_state,
                    next_slug,
                    next_ready_at,
                    next_applied_at,
                    now,
                ),
            )
        if "deny_reason" in cols:
            conn.execute(
                """
                UPDATE lore_item_customisations
                SET deny_reason = NULL
                WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
                """,
                (player_uuid, cid, kit_key_norm),
            )
        if "realm_id" in cols:
            conn.execute(
                """
                UPDATE lore_item_customisations
                SET realm_id = ?
                WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
                """,
                (lore_realm, player_uuid, cid, kit_key_norm),
            )
        conn.commit()

    item = _build_item(player_uuid, cid, editable)
    item["kit_id"] = kit
    return {"ok": True, **item}


def delete_lore_item_customise(
    player_uuid: str,
    character_id: str | None,
    kit_key: str,
    kit_id: str | None = None,
) -> dict[str, Any]:
    """Wipe one kit-item customise row (player).

    Releases orphaned pending skin uploads; does not delete applied player skins.
    """
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        raise LoreItemError("Invalid session", status_code=401)
    cid = _require_character_id(character_id)
    kit = (kit_id or "starter").strip().lower() or "starter"
    _require_customise_allowed(uuid, cid, kit)

    key = (kit_key or "").strip()
    if not key:
        raise LoreItemError("kit_key is required", status_code=400)
    editable = _editable_by_key(key)
    row_kit = str(editable.get("kit_id") or "").strip().lower()
    if row_kit and row_kit != kit:
        raise LoreItemError(
            f"kit_key '{key}' does not belong to kit '{kit}'",
            status_code=400,
        )
    allowed = _kit_editable_keys(kit)
    kit_key_norm = str(editable.get("kit_key") or "").strip()
    if allowed is not None and kit_key_norm.lower() not in allowed:
        raise LoreItemError(
            f"kit_key '{key}' does not belong to kit '{kit}'",
            status_code=400,
        )

    pending_submission_id: str | None = None
    with connect() as conn:
        lore_row = conn.execute(
            """
            SELECT submission_id, LOWER(COALESCE(state, '')) AS state
            FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
            """,
            (uuid, cid, kit_key_norm),
        ).fetchone()
        if lore_row is not None:
            state = str(lore_row["state"] or "").strip().lower()
            raw_sid = lore_row["submission_id"]
            if (
                state == STATE_PENDING_SKIN
                and raw_sid is not None
                and str(raw_sid).strip()
            ):
                pending_submission_id = str(raw_sid).strip()
        cur = conn.execute(
            """
            DELETE FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ? AND kit_key = ?
            """,
            (uuid, cid, kit_key_norm),
        )
        deleted = int(cur.rowcount or 0)
        conn.commit()

    if pending_submission_id:
        from src.skins.submissions import rollback_pending_submission_if_unreferenced

        rollback_pending_submission_if_unreferenced(
            pending_submission_id,
            player_uuid=uuid,
        )

    return {
        "ok": True,
        "character_id": cid,
        "kit_id": kit,
        "kit_key": kit_key_norm,
        "deleted": deleted,
    }


def clear_customisations_for_kit(
    player_uuid: str,
    character_id: str,
    kit_id: str | None = None,
) -> dict[str, Any]:
    """Delete lore_item_customisations for one player/character/kit (staff resetkit)."""
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    kit = (kit_id or "starter").strip().lower() or "starter"
    if not uuid or not cid:
        raise LoreItemError(
            "player_uuid and character_id are required",
            status_code=400,
        )

    keys = _kit_editable_keys(kit)
    deleted = 0
    with connect() as conn:
        cols = {
            r["name"]
            for r in conn.execute(
                "PRAGMA table_info(lore_item_customisations)"
            ).fetchall()
        }
        if "kit_id" in cols:
            cur = conn.execute(
                """
                DELETE FROM lore_item_customisations
                WHERE player_uuid = ? AND character_id = ?
                  AND LOWER(COALESCE(kit_id, '')) = ?
                """,
                (uuid, cid, kit),
            )
            deleted += int(cur.rowcount or 0)

        if keys is not None and keys:
            placeholders = ",".join("?" for _ in keys)
            key_list = sorted(keys)
            cur = conn.execute(
                f"""
                DELETE FROM lore_item_customisations
                WHERE player_uuid = ? AND character_id = ?
                  AND LOWER(COALESCE(kit_key, '')) IN ({placeholders})
                """,
                (uuid, cid, *key_list),
            )
            deleted += int(cur.rowcount or 0)
        elif keys is None and "kit_id" not in cols:
            # Untagged starter fallback: wipe all rows for this character
            if kit == "starter":
                cur = conn.execute(
                    """
                    DELETE FROM lore_item_customisations
                    WHERE player_uuid = ? AND character_id = ?
                    """,
                    (uuid, cid),
                )
                deleted += int(cur.rowcount or 0)
        conn.commit()

    return {
        "ok": True,
        "player_uuid": uuid,
        "character_id": cid,
        "kit_id": kit,
        "deleted": deleted,
    }


def promote_ready_for_submissions(submission_ids: list[str]) -> int:
    """When skins reach applied, promote matching pending_skin customise rows."""
    from src.skins.db import connect

    ids = [str(s).strip() for s in submission_ids if str(s or "").strip()]
    if not ids:
        return 0
    now = _iso_now()
    promoted = 0
    with connect() as conn:
        for sid in ids:
            cur = conn.execute(
                """
                UPDATE lore_item_customisations
                SET skin_slug = ?,
                    state = CASE
                        WHEN LOWER(COALESCE(state, '')) = 'applied' THEN 'applied'
                        ELSE ?
                    END,
                    ready_at = COALESCE(ready_at, ?),
                    updated_at = ?
                WHERE submission_id = ?
                """,
                (sid, STATE_READY, now, now, sid),
            )
            promoted += int(cur.rowcount or 0)
        conn.commit()
    return promoted


def clear_pending_submission(
    submission_id: str, reason: str | None = None
) -> int:
    """On deny: mark matching customise rows denied; keep name/lore and submission_id.

    Stores deny_reason on the lore row (submission is purged after deny).
    """
    from src.skins.db import connect

    sid = (submission_id or "").strip()
    if not sid:
        return 0
    now = _iso_now()
    reason_s = (reason or "").strip() or None
    with connect() as conn:
        cols = {
            r["name"]
            for r in conn.execute(
                "PRAGMA table_info(lore_item_customisations)"
            ).fetchall()
        }
        if "deny_reason" in cols:
            cur = conn.execute(
                """
                UPDATE lore_item_customisations
                SET state = ?,
                    deny_reason = ?,
                    ready_at = NULL,
                    existing_skin_id = NULL,
                    skin_slug = NULL,
                    updated_at = ?
                WHERE submission_id = ?
                  AND LOWER(COALESCE(state, '')) = ?
                """,
                (STATE_DENIED, reason_s, now, sid, STATE_PENDING_SKIN),
            )
        else:
            cur = conn.execute(
                """
                UPDATE lore_item_customisations
                SET state = ?,
                    ready_at = NULL,
                    existing_skin_id = NULL,
                    skin_slug = NULL,
                    updated_at = ?
                WHERE submission_id = ?
                  AND LOWER(COALESCE(state, '')) = ?
                """,
                (STATE_DENIED, now, sid, STATE_PENDING_SKIN),
            )
        cleared = int(cur.rowcount or 0)
        conn.commit()
    return cleared


def list_pending_for_plugin(realm_id: str | None = None) -> list[dict[str, Any]]:
    """Rows with state=ready for RPCharacters pull (filtered by realm)."""
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    realm = normalize_realm_id(realm_id)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM lore_item_customisations
            WHERE LOWER(COALESCE(state, '')) = ?
              AND realm_id = ?
              AND character_id NOT IN (
                  SELECT id FROM character_creates
                  WHERE LOWER(COALESCE(status, '')) = 'pending'
              )
            ORDER BY ready_at ASC, updated_at ASC
            """,
            (STATE_READY, realm),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        kit_key = str(row["kit_key"] or "").strip()
        slug = row["skin_slug"]
        ns = _namespace_for_skin_id(str(slug) if slug else None)
        keys = _row_keys(row)
        colours = _parse_name_colours(
            row["name_colours"] if "name_colours" in keys else None
        )
        styles = _parse_name_styles(
            row["name_styles"] if "name_styles" in keys else None
        )
        entry: dict[str, Any] = {
            "player_uuid": row["player_uuid"],
            "character_id": row["character_id"],
            "kit_key": kit_key,
            "path": _path_for_kit_key(kit_key),
            "display_name": str(row["display_name"] or ""),
            "lore": _parse_lore_json(row["lore_json"]),
            "skin_slug": slug,
            "ia_namespace": ns or "tfmc_submissions",
            "ia_path": _ia_path(slug, ns),
            "ready_at": row["ready_at"],
            "updated_at": row["updated_at"],
            "realm_id": realm,
        }
        if colours:
            entry["name_colours"] = colours
        if styles:
            entry["name_styles"] = styles
        out.append(entry)
    return out


def mark_lore_items_applied(results: list) -> dict[str, Any]:
    """Ack plugin apply results → state=applied."""
    from src.skins.db import connect

    if not isinstance(results, list):
        raise LoreItemError("results must be a list")
    now = _iso_now()
    ok_n = 0
    fail_n = 0
    with connect() as conn:
        for i, raw in enumerate(results):
            if not isinstance(raw, dict):
                raise LoreItemError(f"results[{i}] must be an object")
            cid = str(raw.get("character_id") or "").strip()
            kit_key = str(raw.get("kit_key") or "").strip()
            player_uuid = str(raw.get("player_uuid") or "").strip()
            ok = bool(raw.get("ok"))
            if not cid or not kit_key:
                raise LoreItemError(
                    f"results[{i}] requires character_id and kit_key"
                )
            if not ok:
                fail_n += 1
                continue
            if player_uuid:
                cur = conn.execute(
                    """
                    UPDATE lore_item_customisations
                    SET state = ?, applied_at = ?, updated_at = ?
                    WHERE player_uuid = ?
                      AND character_id = ?
                      AND kit_key = ?
                      AND LOWER(COALESCE(state, '')) = ?
                    """,
                    (
                        STATE_APPLIED,
                        now,
                        now,
                        player_uuid,
                        cid,
                        kit_key,
                        STATE_READY,
                    ),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE lore_item_customisations
                    SET state = ?, applied_at = ?, updated_at = ?
                    WHERE character_id = ?
                      AND kit_key = ?
                      AND LOWER(COALESCE(state, '')) = ?
                    """,
                    (STATE_APPLIED, now, now, cid, kit_key, STATE_READY),
                )
            if cur.rowcount:
                ok_n += 1
            else:
                fail_n += 1
        conn.commit()
    return {"ok": True, "applied": ok_n, "failed": fail_n}


def list_player_custom_items(
    player_uuid: str,
    realm_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Compact customise rows for profile dashboard (all characters)."""
    from src.characters.roster import list_roster
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        return []
    realm = normalize_realm_id(realm_id)
    cap = max(1, min(int(limit or 100), 200))
    roster = list_roster(uuid, realm)
    name_by_id = {
        str(c.get("id") or ""): str(c.get("name") or "").strip()
        for c in roster
        if c.get("id")
    }
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM lore_item_customisations
            WHERE LOWER(player_uuid) = LOWER(?)
              AND realm_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (uuid, realm, cap),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        keys = _row_keys(row)
        state = str(row["state"] if "state" in keys else STATE_DRAFT) or STATE_DRAFT
        if state == STATE_DRAFT and not str(row["display_name"] or "").strip():
            continue
        cid = str(row["character_id"] or "")
        kit_key = str(row["kit_key"] or "")
        draft = _load_row(uuid, cid, kit_key) or {}
        out.append(
            {
                "character_id": cid,
                "character_name": name_by_id.get(cid) or cid,
                "kit_key": kit_key,
                "display_name": str(row["display_name"] or kit_key),
                "state": state,
                "submission_id": row["submission_id"],
                "submission_status": draft.get("submission_status"),
                "deny_reason": draft.get("deny_reason"),
                "skin_slug": draft.get("skin_slug"),
                "updated_at": row["updated_at"] if "updated_at" in keys else None,
                "ready_at": draft.get("ready_at"),
                "applied_at": draft.get("applied_at"),
            }
        )
    return out
