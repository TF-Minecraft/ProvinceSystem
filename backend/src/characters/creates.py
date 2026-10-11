"""Web character create requests + validation against creation catalog."""

from __future__ import annotations

import json
import re
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Any

from src.characters.creation_catalog import (
    CreationCatalogError,
    require_synced_creation_catalog,
)
from src.characters.roster import (
    count_alive,
    get_max_alive,
    get_player_meta,
    set_real_age,
)
from src.name_colours import (
    NameColourError,
    effective_colour_cap,
    validate_name_colours,
)
from src.text_validation import (
    TextValidationError,
    assert_display_name,
    assert_optional_display_name,
    assert_prose,
)


class CreateError(ValueError):
    """Invalid create payload or business rule failure."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# character_creates.held_until keeps a create from RPCharacters while its skins
# upload. Long enough to sign and upload every wardrobe skin; a hold the browser
# never releases (closed tab, lost connection) lapses on its own.
HOLD_FOR_UPLOADS = timedelta(minutes=10)


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_now() -> str:
    return _iso(datetime.now(timezone.utc))


def _as_dict(raw: Any, field: str) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise CreateError(f"{field} must be an object")
    return raw


def _as_list(raw: Any, field: str) -> list:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise CreateError(f"{field} must be a list")
    return raw


def _nested_int(section: dict, *keys: str, default: int | None = None) -> int | None:
    cur: Any = section
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    try:
        return int(cur)
    except (TypeError, ValueError):
        return default


def _trait_id_for_rank(abbr: str, rank: int, pattern: str) -> str:
    """Build attribute trait id; default pattern {abbr}{rank} → str1."""
    text = (pattern or "{abbr}{rank}").strip()
    return (
        text.replace("{abbr}", abbr)
        .replace("{rank}", str(rank))
        .replace("{ABBR}", abbr.upper())
    )


def attribute_spend(ranks: dict[str, int], cost_for_rank: list[int]) -> int:
    total = 0
    for rank in ranks.values():
        for i in range(int(rank)):
            if i >= len(cost_for_rank):
                raise CreateError("attribute rank exceeds cost_for_rank length")
            total += int(cost_for_rank[i])
    return total


def _strip_injuries_replaced_by_prosthetics(
    trait_ids: list[str], traits_by_id: dict[str, dict]
) -> list[str]:
    traits_by_id_lower = {
        str(k).strip().lower(): v for k, v in traits_by_id.items() if k is not None
    }
    injuries_to_remove: set[str] = set()
    for tid in trait_ids:
        key = str(tid).strip().lower()
        trait = traits_by_id.get(tid) or traits_by_id_lower.get(key)
        if not isinstance(trait, dict):
            continue
        if str(trait.get("key") or "").strip().lower() != "prosthetic":
            continue
        replaces = str(trait.get("replaces_injury") or "").strip().lower()
        if replaces:
            injuries_to_remove.add(replaces)
    if not injuries_to_remove:
        return trait_ids
    return [
        tid for tid in trait_ids if str(tid).strip().lower() not in injuries_to_remove
    ]


def expand_attribute_traits(
    ranks: dict[str, int],
    abbreviations: dict[str, str],
    pattern: str,
) -> list[str]:
    out: list[str] = []
    for attr, rank in ranks.items():
        abbr = abbreviations.get(attr) or abbreviations.get(attr.lower())
        if not abbr:
            # fallback: first 3 letters
            abbr = attr[:3].lower()
        for r in range(1, int(rank) + 1):
            out.append(_trait_id_for_rank(str(abbr).lower(), r, pattern))
    return out


def _validate_and_normalize(
    player_uuid: str,
    body: dict[str, Any],
    *,
    realm_id: str | None = None,
) -> dict[str, Any]:
    catalog = require_synced_creation_catalog()
    validation = _as_dict(catalog.get("validation"), "validation")
    apb = _as_dict(catalog.get("attribute_point_buy"), "attribute_point_buy")
    slot_limits = _as_dict(catalog.get("slot_limits"), "slot_limits")

    name_min = _nested_int(validation, "name", "min_length", default=1) or 1
    name_max = _nested_int(validation, "name", "max_length", default=32) or 32
    try:
        name = assert_display_name(
            body.get("name"),
            min_len=name_min,
            max_len=name_max,
            field="name",
        )
    except TextValidationError as e:
        raise CreateError(str(e)) from e

    from src.skins.codes import CodeError, normalize_realm_id
    from src.skins.db import connect

    try:
        realm = normalize_realm_id(realm_id)
    except CodeError as e:
        raise CreateError(str(e)) from e

    with connect() as conn:
        roster_clash = conn.execute(
            """
            SELECT 1 FROM character_roster
            WHERE realm_id = ? AND LOWER(name) = LOWER(?)
            LIMIT 1
            """,
            (realm, name),
        ).fetchone()
        if roster_clash is not None:
            raise CreateError("name already in use on this realm")
        pending_rows = conn.execute(
            """
            SELECT payload FROM character_creates
            WHERE realm_id = ? AND status = 'pending'
            """,
            (realm,),
        ).fetchall()
    for prow in pending_rows:
        try:
            pending_payload = json.loads(prow["payload"] or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        pending_name = str(pending_payload.get("name") or "").strip()
        if pending_name and pending_name.lower() == name.lower():
            raise CreateError("name already in use on this realm")

    try:
        age = int(body.get("age"))
    except (TypeError, ValueError) as e:
        raise CreateError("age must be an integer") from e
    age_min = _nested_int(validation, "age", "minimum", default=1) or 1
    if (age < age_min):
        raise CreateError(f"age must be at least {age_min}")

    birthday = None
    if body.get("birthday") is not None:
        birthday = str(body.get("birthday") or "").strip() or None
        if birthday is not None:
            if not re.fullmatch(r"\d{1,6}-\d{2}-\d{2}", birthday):
                raise CreateError("birthday must be YYYY-MM-DD")

    has_real_age_stage = any(
        isinstance(s, dict)
        and str(s.get("type") or "").lower() == "setter"
        and str(s.get("target") or "").lower() == "real_age"
        for s in (catalog.get("stages") or [])
    )
    meta = get_player_meta(player_uuid)
    already_set = bool(meta.get("real_age_set"))
    eighteen: bool | None = None
    if "eighteen" in body and body.get("eighteen") is not None:
        if not isinstance(body.get("eighteen"), bool):
            raise CreateError("eighteen must be a boolean")
        eighteen = bool(body.get("eighteen"))
    elif has_real_age_stage and not already_set:
        raise CreateError("eighteen (18+ attestation) is required")
    elif already_set and meta.get("eighteen") is not None:
        # Carry prior attestation into the create payload for ingest.
        eighteen = bool(meta.get("eighteen"))

    desc_min = _nested_int(validation, "description", "min_length", default=1) or 1
    desc_max = _nested_int(validation, "description", "max_length", default=2000) or 2000
    try:
        description = assert_prose(
            body.get("description"),
            min_len=desc_min,
            max_len=desc_max,
            field="description",
        )
    except TextValidationError as e:
        raise CreateError(str(e)) from e

    try:
        gender_opt = assert_optional_display_name(
            body.get("gender"), max_len=24, field="gender"
        )
    except TextValidationError as e:
        raise CreateError(str(e)) from e
    gender = gender_opt or ""

    race_id = str(body.get("race_id") or "").strip()
    class_id = str(body.get("class_id") or "").strip()
    race_ids = {
        str(r.get("id") or "").strip()
        for r in (catalog.get("races") or [])
        if isinstance(r, dict)
    }
    class_ids = {
        str(c.get("id") or "").strip()
        for c in (catalog.get("classes") or [])
        if isinstance(c, dict)
    }
    if not race_id or race_id not in race_ids:
        raise CreateError("race_id is invalid")
    if not class_id or class_id not in class_ids:
        raise CreateError("class_id is invalid")

    traits_by_id: dict[str, dict] = {}
    for t in catalog.get("traits") or []:
        if isinstance(t, dict):
            tid = str(t.get("id") or "").strip()
            if tid:
                traits_by_id[tid] = t

    selected_traits = [
        str(t).strip() for t in _as_list(body.get("traits"), "traits") if str(t).strip()
    ]
    for tid in selected_traits:
        if tid not in traits_by_id:
            raise CreateError(f"unknown trait: {tid}")

    # Selection stages: enforce min/max per trait key
    for stage in catalog.get("stages") or []:
        if not isinstance(stage, dict):
            continue
        if str(stage.get("type") or "").lower() != "selection":
            continue
        target = str(stage.get("target") or "").lower()
        key = str(stage.get("key") or "").strip().lower()
        if target != "trait" or not key:
            continue
        min_select = int(stage.get("min_select") or 0)
        max_select = int(stage.get("max_select") or 99)
        count = 0
        for tid in selected_traits:
            tkey = str(traits_by_id[tid].get("key") or "").strip().lower()
            if tkey == key:
                count += 1
        if count < min_select or count > max_select:
            raise CreateError(
                f"traits for key '{key}' must be between {min_select} and {max_select}"
            )
        try:
            budget = int(stage.get("points") or 0)
        except (TypeError, ValueError):
            budget = 0
        if budget > 0:
            spent = 0
            for tid in selected_traits:
                tkey = str(traits_by_id[tid].get("key") or "").strip().lower()
                if tkey != key:
                    continue
                try:
                    spent += int(traits_by_id[tid].get("cost") or 0)
                except (TypeError, ValueError):
                    pass
            if spent > budget:
                raise CreateError(
                    f"traits for key '{key}' exceed point budget ({spent} > {budget})"
                )

    clues_raw = _as_list(body.get("clues"), "clues")
    clue_cfg = _as_dict(validation.get("clues"), "validation.clues")
    clue_min_len = int(clue_cfg.get("min_length") or 1)
    clue_max_len = int(clue_cfg.get("max_length") or 500)
    max_clues = int(clue_cfg.get("max_clues") or 20)
    required = int(clue_cfg.get("default_required") or 0)
    has_evil = any(
        str(traits_by_id[tid].get("key") or "").strip().lower() == "evil"
        for tid in selected_traits
        if tid in traits_by_id
    )
    if has_evil:
        required = max(required, int(clue_cfg.get("evil_required") or 0))
    required = min(required, max_clues)
    clues: list[str] = []
    for raw_clue in clues_raw:
        text = str(raw_clue or "").strip()
        if not text:
            continue
        try:
            clues.append(
                assert_prose(
                    text,
                    min_len=clue_min_len,
                    max_len=clue_max_len,
                    field=f"clues[{len(clues)}]",
                )
            )
        except TextValidationError as e:
            raise CreateError(str(e)) from e
    if len(clues) > max_clues:
        raise CreateError(f"at most {max_clues} clues allowed")
    if len(clues) < required:
        raise CreateError(f"at least {required} clues required")

    attrs_cfg = [str(a).strip().lower() for a in (apb.get("attributes") or [])]
    if not attrs_cfg:
        raise CreateError("catalog attribute_point_buy.attributes is empty")
    cost_for_rank = [int(c) for c in (apb.get("cost_for_rank") or [])]
    pool = int(apb.get("pool"))
    max_rank = int(apb.get("max_rank"))
    abbreviations = {
        str(k).strip().lower(): str(v).strip().lower()
        for k, v in _as_dict(apb.get("abbreviations"), "abbreviations").items()
    }
    pattern = str(apb.get("trait_id_pattern") or "{abbr}{rank}").strip()

    raw_attrs = _as_dict(body.get("attributes"), "attributes")
    ranks: dict[str, int] = {}
    for attr in attrs_cfg:
        if attr not in raw_attrs:
            raise CreateError(f"attributes.{attr} is required")
        try:
            rank = int(raw_attrs[attr])
        except (TypeError, ValueError) as e:
            raise CreateError(f"attributes.{attr} must be an integer") from e
        if rank < 0 or rank > max_rank:
            raise CreateError(f"attributes.{attr} must be between 0 and {max_rank}")
        ranks[attr] = rank
    for extra in raw_attrs:
        if str(extra).strip().lower() not in attrs_cfg:
            raise CreateError(f"unknown attribute: {extra}")

    spent = attribute_spend(ranks, cost_for_rank)
    if spent != pool:
        raise CreateError(f"attribute spend must equal {pool} (got {spent})")

    attr_traits = expand_attribute_traits(ranks, abbreviations, pattern)
    for tid in attr_traits:
        if tid not in traits_by_id:
            raise CreateError(f"attribute trait missing from catalog: {tid}")

    # Soft slot check (per-player entitlement if synced, else catalog default)
    from src.characters.rpc_player_meta import resolve_web_entitlements

    entitlements = resolve_web_entitlements(player_uuid, realm_id=realm)
    if entitlements.get("max_alive_characters") is not None:
        try:
            max_alive = max(1, int(entitlements["max_alive_characters"]))
        except (TypeError, ValueError):
            max_alive = get_max_alive(player_uuid, slot_limits)
    else:
        max_alive = get_max_alive(player_uuid, slot_limits)
    alive = count_alive(player_uuid, realm)
    if alive >= max_alive:
        raise CreateError("no free character slot")

    selected_traits = _strip_injuries_replaced_by_prosthetics(selected_traits, traits_by_id)

    merged_traits = list(dict.fromkeys([*selected_traits, *attr_traits]))

    client_request_id = body.get("client_request_id")
    if client_request_id is not None:
        client_request_id = str(client_request_id).strip() or None

    raw_colours = body.get("name_colours")
    name_colours: list[str] = []
    if raw_colours is not None and raw_colours != []:
        stops = effective_colour_cap(
            int(
                resolve_web_entitlements(player_uuid, realm_id=realm)[
                    "name_colour_stops"
                ]
                or 0
            )
        )
        if stops <= 0:
            raise CreateError("name colours are only available to donators")
        try:
            name_colours = validate_name_colours(raw_colours, max_colours=stops)
        except NameColourError as e:
            raise CreateError(str(e)) from e

    out: dict[str, Any] = {
        "client_request_id": client_request_id,
        "name": name,
        "age": age,
        "birthday": birthday,
        "eighteen": eighteen,
        "description": description,
        "gender": gender,
        "race_id": race_id,
        "class_id": class_id,
        "attributes": ranks,
        "traits": selected_traits,
        "attribute_traits": attr_traits,
        "all_traits": merged_traits,
        "clues": clues,
    }
    if name_colours:
        out["name_colours"] = name_colours
    return out


def _row_to_dict(row) -> dict[str, Any]:
    payload = {}
    try:
        payload = json.loads(row["payload"] or "{}")
    except json.JSONDecodeError:
        payload = {}
    realm = "main"
    try:
        raw_realm = row["realm_id"]
        if raw_realm is not None and str(raw_realm).strip():
            realm = str(raw_realm).strip().lower()
    except (KeyError, IndexError, TypeError):
        pass
    return {
        "id": row["id"],
        "player_uuid": row["player_uuid"],
        "client_request_id": row["client_request_id"],
        "status": row["status"],
        "character_id": row["character_id"],
        "error": row["error"],
        "created_at": row["created_at"],
        "applied_at": row["applied_at"],
        "realm_id": realm,
        "payload": payload,
    }


def create_character(
    player_uuid: str,
    body: dict[str, Any],
    *,
    realm_id: str | None = None,
) -> dict[str, Any]:
    from src.skins.codes import CodeError, normalize_realm_id
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        raise CreateError("player_uuid is required")
    if not isinstance(body, dict):
        raise CreateError("body must be a JSON object")

    try:
        realm = normalize_realm_id(realm_id)
    except CodeError as e:
        raise CreateError(str(e)) from e

    try:
        normalized = _validate_and_normalize(uuid, body, realm_id=realm)
    except CreationCatalogError as e:
        raise CreateError(str(e)) from e

    client_request_id = normalized.get("client_request_id")
    with connect() as conn:
        if client_request_id:
            existing = conn.execute(
                """
                SELECT * FROM character_creates
                WHERE player_uuid = ? AND client_request_id = ?
                """,
                (uuid, client_request_id),
            ).fetchone()
            if existing is not None:
                return _row_to_dict(existing)

        if "eighteen" in body and isinstance(body.get("eighteen"), bool):
            set_real_age(uuid, bool(body.get("eighteen")))

        create_id = str(uuid_lib.uuid4())
        moment = datetime.now(timezone.utc)
        held_until = _iso(moment + HOLD_FOR_UPLOADS) if body.get("hold") is True else None
        payload = json.dumps(normalized, separators=(",", ":"))
        conn.execute(
            """
            INSERT INTO character_creates (
                id, player_uuid, client_request_id, payload, status,
                character_id, error, created_at, applied_at, realm_id, held_until
            )
            VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL, ?, ?)
            """,
            (create_id, uuid, client_request_id, payload, _iso(moment), realm, held_until),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM character_creates WHERE id = ?",
            (create_id,),
        ).fetchone()
    return _row_to_dict(row)


def list_pending(realm_id: str | None = None) -> list[dict[str, Any]]:
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    realm = normalize_realm_id(realm_id)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM character_creates
            WHERE status = 'pending' AND realm_id = ?
              AND (held_until IS NULL OR held_until <= ?)
            ORDER BY created_at ASC
            """,
            (realm, _iso_now()),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def _pending_character_list_item(
    data: dict[str, Any], realm: str, catalog: dict[str, Any]
) -> dict[str, Any]:
    from src.characters.pending_sheet import enrich_pending_list_item

    payload = data.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    item: dict[str, Any] = {
        "id": data["id"],
        "name": payload.get("name") or "(pending)",
        "status": "pending",
        "race": payload.get("race_id"),
        "class": payload.get("class_id"),
        "created_at": data["created_at"],
        "source": "create",
        "create_id": data["id"],
        "realm_id": realm,
    }
    for key in ("age", "birthday", "gender", "description", "clues"):
        if key in payload and payload[key] is not None:
            item[key] = payload[key]
    item.update(enrich_pending_list_item(payload, catalog))
    return item


def list_for_player(
    player_uuid: str,
    realm_id: str | None = None,
) -> dict[str, Any]:
    from src.characters.creation_catalog import get_catalog
    from src.characters.roster import (
        count_alive,
        get_max_alive,
        get_player_meta,
        list_roster,
    )
    from src.characters.rpc_player_meta import resolve_web_entitlements
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    realm = normalize_realm_id(realm_id)
    roster = list_roster(uuid, realm)
    meta = get_player_meta(uuid)
    entitlements = resolve_web_entitlements(uuid, realm_id=realm)
    with connect() as conn:
        pending_rows = conn.execute(
            """
            SELECT * FROM character_creates
            WHERE player_uuid = ? AND status = 'pending' AND realm_id = ?
            ORDER BY created_at ASC
            """,
            (uuid, realm),
        ).fetchall()
        # Recent rejects (slot full, etc.) so the website can show why a create failed.
        rejected_rows = conn.execute(
            """
            SELECT * FROM character_creates
            WHERE player_uuid = ?
              AND status = 'rejected'
              AND realm_id = ?
            ORDER BY COALESCE(applied_at, created_at) DESC
            LIMIT 20
            """,
            (uuid, realm),
        ).fetchall()

    catalog = get_catalog()
    characters: list[dict[str, Any]] = list(roster)
    for row in pending_rows:
        data = _row_to_dict(row)
        characters.append(_pending_character_list_item(data, realm, catalog))
    for row in rejected_rows:
        data = _row_to_dict(row)
        payload = data.get("payload") or {}
        err = data.get("error")
        characters.append(
            {
                "id": data["id"],
                "name": payload.get("name") or "(rejected)",
                "status": "rejected",
                "race": payload.get("race_id"),
                "class": payload.get("class_id"),
                "created_at": data.get("applied_at") or data.get("created_at"),
                "source": "create",
                "create_id": data["id"],
                "error": err if err else "rejected",
                "realm_id": realm,
            }
        )

    raw_limits = catalog.get("slot_limits")
    slot_limits = raw_limits if isinstance(raw_limits, dict) else {}

    if entitlements.get("max_alive_characters") is not None:
        try:
            max_alive = max(1, int(entitlements["max_alive_characters"]))
        except (TypeError, ValueError):
            max_alive = get_max_alive(uuid, slot_limits)
    else:
        max_alive = get_max_alive(uuid, slot_limits)
    alive_count = count_alive(uuid, realm)

    account_age_seconds = 0
    epoch = meta.get("account_created_at_epoch")
    if epoch is not None:
        try:
            created = int(epoch)
            if created > 0:
                now_epoch = int(datetime.now(timezone.utc).timestamp())
                account_age_seconds = max(0, now_epoch - created)
        except (TypeError, ValueError):
            account_age_seconds = 0

    hours = 24
    validation = catalog.get("validation") if isinstance(catalog, dict) else {}
    clues = (
        validation.get("clues")
        if isinstance(validation, dict) and isinstance(validation.get("clues"), dict)
        else {}
    )
    try:
        hours = max(0, int(clues.get("evil_min_account_age_hours", hours)))
    except (TypeError, ValueError):
        hours = 24
    evil_unlocked = account_age_seconds >= hours * 3600

    out: dict[str, Any] = {
        "characters": characters,
        "player_uuid": uuid,
        "realm_id": realm,
        "max_alive_characters": max_alive,
        "alive_count": alive_count,
        "real_age_set": bool(meta.get("real_age_set")),
        "account_age_seconds": account_age_seconds,
        "evil_unlocked": evil_unlocked,
        "name_colour_stops": int(entitlements.get("name_colour_stops") or 0),
        "wardrobe_skin_slots": int(entitlements.get("wardrobe_skin_slots") or 1),
        "meta_synced": bool(entitlements.get("meta_synced")),
        "permission_flags": dict(entitlements.get("permission_flags") or {}),
        "kit_cooldown_seconds_remaining": int(
            meta.get("kit_cooldown_seconds_remaining") or 0
        ),
    }
    if meta.get("kit_cooldown_hours") is not None:
        out["kit_cooldown_hours"] = int(meta.get("kit_cooldown_hours") or 0)
    kit_cooldowns = meta.get("kit_cooldowns")
    if isinstance(kit_cooldowns, dict) and kit_cooldowns:
        out["kit_cooldowns"] = kit_cooldowns
    if meta.get("eighteen") is not None:
        out["eighteen"] = bool(meta.get("eighteen"))
    return out


def mark_applied_results(results: list) -> dict[str, Any]:
    from src.skins.db import connect
    from src.characters.lore_items import remount_character_id
    from src.characters.wardrobe import flush_pending_wardrobe

    if not isinstance(results, list):
        raise CreateError("results must be a list")

    now = _iso_now()
    applied: list[str] = []
    rejected: list[str] = []
    remounts: list[tuple[str, str, str]] = []

    with connect() as conn:
        for i, raw in enumerate(results):
            if not isinstance(raw, dict):
                raise CreateError(f"results[{i}] must be an object")
            cid = str(raw.get("id") or "").strip()
            if not cid:
                continue
            ok = bool(raw.get("ok"))
            if ok:
                character_id = str(raw.get("character_id") or cid).strip()
                owner = conn.execute(
                    """
                    SELECT player_uuid FROM character_creates
                    WHERE id = ? AND status = 'pending'
                    """,
                    (cid,),
                ).fetchone()
                cur = conn.execute(
                    """
                    UPDATE character_creates
                    SET status = 'applied',
                        character_id = ?,
                        error = NULL,
                        applied_at = ?
                    WHERE id = ? AND status = 'pending'
                    """,
                    (character_id, now, cid),
                )
                if cur.rowcount:
                    applied.append(cid)
                    if owner is not None:
                        remounts.append(
                            (
                                str(owner["player_uuid"] or "").strip(),
                                cid,
                                character_id,
                            )
                        )
            else:
                error = str(raw.get("error") or "rejected").strip()
                cur = conn.execute(
                    """
                    UPDATE character_creates
                    SET status = 'rejected',
                        error = ?,
                        applied_at = ?
                    WHERE id = ? AND status = 'pending'
                    """,
                    (error, now, cid),
                )
                if cur.rowcount:
                    rejected.append(cid)
        conn.commit()

    for player_uuid, create_id, character_id in remounts:
        remount_character_id(player_uuid, create_id, character_id)
        flush_pending_wardrobe(player_uuid, create_id, character_id)

    return {"ok": True, "applied": applied, "rejected": rejected}


def release_create(player_uuid: str, create_id: str) -> dict[str, Any]:
    """Let RPCharacters apply a held create now that its skins are uploaded."""
    from src.skins.db import connect

    with connect() as conn:
        released = conn.execute(
            """
            UPDATE character_creates SET held_until = NULL
            WHERE id = ? AND player_uuid = ? AND status = 'pending'
            """,
            ((create_id or "").strip(), (player_uuid or "").strip()),
        ).rowcount
        conn.commit()
    if not released:
        raise CreateError("Create not found", status_code=404)
    return {"ok": True, "id": create_id}


def delete_pending_create(player_uuid: str, create_id: str) -> dict[str, Any]:
    """Cancel a pending web create: wardrobe, kit drafts, and create row."""
    from src.characters.pending_create import fetch_owned_pending_create
    from src.characters.wardrobe import delete_all_pending_create_wardrobe
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    cid = (create_id or "").strip()
    if not uuid or not cid:
        raise CreateError("Create not found", status_code=404)

    if fetch_owned_pending_create(uuid, cid) is None:
        with connect() as conn:
            row = conn.execute(
                """
                SELECT player_uuid, status FROM character_creates WHERE id = ?
                """,
                (cid,),
            ).fetchone()
        if row is None or str(row["player_uuid"]) != uuid:
            raise CreateError("Create not found", status_code=404)
        raise CreateError(
            "Only pending creates can be cancelled",
            status_code=409,
        )

    delete_all_pending_create_wardrobe(cid)

    with connect() as conn:
        pending_sub_rows = conn.execute(
            """
            SELECT DISTINCT submission_id
            FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ?
              AND submission_id IS NOT NULL
              AND TRIM(submission_id) != ''
              AND LOWER(COALESCE(state, '')) = 'pending_skin'
            """,
            (uuid, cid),
        ).fetchall()
        pending_submission_ids = [
            str(row["submission_id"]).strip()
            for row in pending_sub_rows
            if row["submission_id"] is not None and str(row["submission_id"]).strip()
        ]
        conn.execute(
            """
            DELETE FROM lore_item_customisations
            WHERE player_uuid = ? AND character_id = ?
            """,
            (uuid, cid),
        )
        cur = conn.execute(
            """
            DELETE FROM character_creates
            WHERE id = ? AND player_uuid = ? AND status = 'pending'
            """,
            (cid, uuid),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise CreateError("Create not found", status_code=404)

    if pending_submission_ids:
        from src.skins.submissions import rollback_pending_submissions_if_unreferenced

        rollback_pending_submissions_if_unreferenced(
            pending_submission_ids,
            player_uuid=uuid,
        )

    return {"ok": True, "deleted": cid}
