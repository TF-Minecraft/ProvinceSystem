"""Character roster mirror pushed by RPCharacters."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


class RosterError(ValueError):
    """Invalid roster payload."""


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def count_alive(player_uuid: str, realm_id: str | None = None) -> int:
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        return 0
    realm = normalize_realm_id(realm_id)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM character_roster
            WHERE player_uuid = ?
              AND realm_id = ?
              AND LOWER(status) = 'alive'
            """,
            (uuid, realm),
        ).fetchone()
    return int(row["n"] if row else 0)


def catalog_default_max_alive(slot_limits: dict[str, Any] | None = None) -> int:
    """Fallback max from creation catalog defaults ∩ hard_cap."""
    limits = slot_limits if isinstance(slot_limits, dict) else {}
    defaults = limits.get("defaults") if isinstance(limits.get("defaults"), dict) else {}
    try:
        default_max = int(defaults.get("max_alive_characters") or 3)
    except (TypeError, ValueError):
        default_max = 3
    try:
        hard_cap = int(limits.get("hard_cap") or 10)
    except (TypeError, ValueError):
        hard_cap = 10
    return max(1, min(default_max, hard_cap))


def get_player_meta(player_uuid: str) -> dict[str, Any]:
    """Return stored meta flags for a player (defaults if no row)."""
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    empty = {
        "max_alive_characters": None,
        "eighteen": None,
        "real_age_set": False,
        "account_created_at_epoch": None,
        "name_colour_stops": 0,
        "wardrobe_skin_slots": 1,
        "kit_cooldown_seconds_remaining": 0,
        "kit_cooldown_hours": None,
        "kit_cooldowns": {},
    }
    if not uuid:
        return empty
    with connect() as conn:
        row = conn.execute(
            """
            SELECT max_alive_characters, eighteen, real_age_set,
                   account_created_at_epoch, name_colour_stops,
                   wardrobe_skin_slots,
                   kit_cooldown_seconds_remaining, kit_cooldown_hours,
                   kit_cooldowns_json
            FROM character_player_meta
            WHERE player_uuid = ?
            """,
            (uuid,),
        ).fetchone()
    if row is None:
        return empty
    max_alive = None
    if row["max_alive_characters"] is not None:
        try:
            max_alive = max(1, int(row["max_alive_characters"]))
        except (TypeError, ValueError):
            max_alive = None
    eighteen = None
    if row["eighteen"] is not None:
        eighteen = bool(int(row["eighteen"]))
    real_age_set = bool(int(row["real_age_set"] or 0))
    account_created_at_epoch = None
    if row["account_created_at_epoch"] is not None:
        try:
            account_created_at_epoch = int(row["account_created_at_epoch"])
        except (TypeError, ValueError):
            account_created_at_epoch = None
        if account_created_at_epoch is not None and account_created_at_epoch <= 0:
            account_created_at_epoch = None
    name_colour_stops = 0
    if row["name_colour_stops"] is not None:
        try:
            name_colour_stops = max(0, int(row["name_colour_stops"]))
        except (TypeError, ValueError):
            name_colour_stops = 0
    wardrobe_skin_slots = 1
    try:
        raw_slots = row["wardrobe_skin_slots"]
    except (KeyError, IndexError):
        raw_slots = None
    if raw_slots is not None:
        try:
            wardrobe_skin_slots = max(1, min(3, int(raw_slots)))
        except (TypeError, ValueError):
            wardrobe_skin_slots = 1
    kit_cooldown_seconds_remaining = 0
    if row["kit_cooldown_seconds_remaining"] is not None:
        try:
            kit_cooldown_seconds_remaining = max(
                0, int(row["kit_cooldown_seconds_remaining"])
            )
        except (TypeError, ValueError):
            kit_cooldown_seconds_remaining = 0
    kit_cooldown_hours = None
    if row["kit_cooldown_hours"] is not None:
        try:
            kit_cooldown_hours = max(0, int(row["kit_cooldown_hours"]))
        except (TypeError, ValueError):
            kit_cooldown_hours = None
    kit_cooldowns: dict[str, Any] = {}
    try:
        raw_cd = row["kit_cooldowns_json"]
    except (KeyError, IndexError):
        raw_cd = None
    if raw_cd:
        try:
            parsed = json.loads(raw_cd)
            if isinstance(parsed, dict):
                kit_cooldowns = parsed
        except (TypeError, json.JSONDecodeError):
            kit_cooldowns = {}
    return {
        "max_alive_characters": max_alive,
        "eighteen": eighteen,
        "real_age_set": real_age_set,
        "account_created_at_epoch": account_created_at_epoch,
        "name_colour_stops": name_colour_stops,
        "wardrobe_skin_slots": wardrobe_skin_slots,
        "kit_cooldown_seconds_remaining": kit_cooldown_seconds_remaining,
        "kit_cooldown_hours": kit_cooldown_hours,
        "kit_cooldowns": kit_cooldowns,
    }


def get_stored_max_alive(player_uuid: str) -> int | None:
    return get_player_meta(player_uuid)["max_alive_characters"]


def get_max_alive(
    player_uuid: str,
    slot_limits: dict[str, Any] | None = None,
) -> int:
    """Player entitlement if synced, else catalog default ∩ hard_cap."""
    stored = get_stored_max_alive(player_uuid)
    if stored is not None:
        return stored
    return catalog_default_max_alive(slot_limits)


def set_real_age(player_uuid: str, eighteen: bool) -> dict[str, Any]:
    """Persist 18+ attestation (player-level, once)."""
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        raise RosterError("player_uuid is required")
    now = _iso_now()
    eighteen_int = 1 if eighteen else 0
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO character_player_meta (
                player_uuid, max_alive_characters, eighteen, real_age_set, updated_at
            )
            VALUES (?, NULL, ?, 1, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                eighteen = excluded.eighteen,
                real_age_set = 1,
                updated_at = excluded.updated_at
            """,
            (uuid, eighteen_int, now),
        )
        conn.commit()
    return {
        "player_uuid": uuid,
        "eighteen": eighteen,
        "real_age_set": True,
    }


def _sheet_from_character(raw: dict) -> dict[str, Any] | None:
    """Pull optional identity-sheet fields from a roster character object."""
    sheet: dict[str, Any] = {}
    for key in (
        "race_name",
        "class_name",
        "age",
        "birthday",
        "gender",
        "description",
        "background",
    ):
        if key not in raw:
            continue
        val = raw.get(key)
        if val is None:
            continue
        text = str(val).strip()
        if text:
            sheet[key] = text
    attrs = raw.get("attributes")
    if isinstance(attrs, dict) and attrs:
        cleaned_attrs: dict[str, int] = {}
        for k, v in attrs.items():
            if k is None:
                continue
            ak = str(k).strip().lower()
            if not ak:
                continue
            try:
                cleaned_attrs[ak] = int(v)
            except (TypeError, ValueError):
                continue
        if cleaned_attrs:
            sheet["attributes"] = cleaned_attrs
    traits = raw.get("traits")
    if isinstance(traits, list) and traits:
        cleaned_traits: list[dict[str, Any]] = []
        for t in traits:
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or "").strip()
            if not tid:
                continue
            entry: dict[str, Any] = {
                "id": tid,
                "name": str(t.get("name") or tid).strip() or tid,
            }
            tkey = str(t.get("key") or "").strip().lower()
            if tkey:
                entry["key"] = tkey
            duration_ms = t.get("duration_remaining_ms")
            if duration_ms is not None:
                try:
                    entry["duration_remaining_ms"] = int(duration_ms)
                except (TypeError, ValueError):
                    pass
            fuel_percent = t.get("fuel_percent")
            if fuel_percent is not None:
                try:
                    entry["fuel_percent"] = int(fuel_percent)
                except (TypeError, ValueError):
                    pass
            cleaned_traits.append(entry)
        if cleaned_traits:
            sheet["traits"] = cleaned_traits
    xp_mods = raw.get("experience_modifiers")
    if isinstance(xp_mods, list) and xp_mods:
        cleaned_xp: list[dict[str, Any]] = []
        for m in xp_mods:
            if not isinstance(m, dict):
                continue
            profession = str(m.get("profession") or "").strip().lower()
            if not profession:
                continue
            alias = str(m.get("alias") or profession).strip() or profession
            try:
                amount = int(m.get("amount"))
            except (TypeError, ValueError):
                continue
            cleaned_xp.append(
                {
                    "profession": profession,
                    "alias": alias,
                    "amount": amount,
                }
            )
        if cleaned_xp:
            sheet["experience_modifiers"] = cleaned_xp
    clues = raw.get("clues")
    if isinstance(clues, list) and clues:
        cleaned_clues = [
            str(c).strip() for c in clues if c is not None and str(c).strip()
        ]
        if cleaned_clues:
            sheet["clues"] = cleaned_clues
    return sheet if sheet else None


def list_roster(
    player_uuid: str,
    realm_id: str | None = None,
) -> list[dict[str, Any]]:
    from src.skins.codes import normalize_realm_id
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        return []
    realm = normalize_realm_id(realm_id)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT character_id, name, status, race, class, created_at, updated_at,
                   kit_status, kit_statuses_json, sheet_json, realm_id
            FROM character_roster
            WHERE player_uuid = ? AND realm_id = ?
            ORDER BY created_at ASC, character_id ASC
            """,
            (uuid, realm),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        item: dict[str, Any] = {
            "id": row["character_id"],
            "name": row["name"],
            "status": row["status"],
            "race": row["race"],
            "class": row["class"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "realm_id": realm,
            "source": "roster",
        }
        kit_status = row["kit_status"]
        if kit_status is not None and str(kit_status).strip():
            item["kit_status"] = str(kit_status).strip().lower()
        try:
            raw_statuses = row["kit_statuses_json"]
        except (KeyError, IndexError):
            raw_statuses = None
        if raw_statuses:
            try:
                parsed = json.loads(raw_statuses)
                if isinstance(parsed, dict) and parsed:
                    item["kit_statuses"] = {
                        str(k).strip().lower(): str(v).strip().lower()
                        for k, v in parsed.items()
                        if k is not None and str(k).strip()
                    }
            except (TypeError, json.JSONDecodeError):
                pass
        try:
            raw_sheet = row["sheet_json"]
        except (KeyError, IndexError):
            raw_sheet = None
        if raw_sheet:
            try:
                parsed_sheet = json.loads(raw_sheet)
                if isinstance(parsed_sheet, dict) and parsed_sheet:
                    for k, v in parsed_sheet.items():
                        if k and v is not None and k not in item:
                            item[str(k)] = v
            except (TypeError, json.JSONDecodeError):
                pass
        out.append(item)
    return out


def replace_roster(
    player_uuid: str,
    characters: list,
    max_alive_characters: int | None = None,
    eighteen: bool | None = None,
    real_age_set: bool | None = None,
    account_created_at_epoch: int | None = None,
    name_colour_stops: int | None = None,
    wardrobe_skin_slots: int | None = None,
    kit_cooldown_seconds_remaining: int | None = None,
    kit_cooldown_hours: int | None = None,
    kit_cooldowns: dict | None = None,
    realm_id: str | None = None,
) -> dict[str, Any]:
    from src.skins.codes import CodeError, normalize_realm_id
    from src.skins.db import connect

    uuid = (player_uuid or "").strip()
    if not uuid:
        raise RosterError("player_uuid is required")
    if not isinstance(characters, list):
        raise RosterError("characters must be a list")
    try:
        realm = normalize_realm_id(realm_id)
    except CodeError as e:
        raise RosterError(str(e)) from e

    max_alive: int | None = None
    if max_alive_characters is not None:
        try:
            max_alive = int(max_alive_characters)
        except (TypeError, ValueError) as e:
            raise RosterError("max_alive_characters must be an integer") from e
        if max_alive < 1:
            raise RosterError("max_alive_characters must be >= 1")

    if real_age_set is not None and not isinstance(real_age_set, bool):
        raise RosterError("real_age_set must be a boolean")
    if eighteen is not None and not isinstance(eighteen, bool):
        raise RosterError("eighteen must be a boolean")
    # Answering eighteen implies attestation completed.
    if eighteen is not None and real_age_set is None:
        real_age_set = True

    next_account_epoch: int | None = None
    if account_created_at_epoch is not None:
        try:
            next_account_epoch = int(account_created_at_epoch)
        except (TypeError, ValueError) as e:
            raise RosterError(
                "account_created_at_epoch must be an integer"
            ) from e
        if next_account_epoch <= 0:
            raise RosterError("account_created_at_epoch must be > 0")

    next_colour_stops: int | None = None
    if name_colour_stops is not None:
        try:
            next_colour_stops = int(name_colour_stops)
        except (TypeError, ValueError) as e:
            raise RosterError("name_colour_stops must be an integer") from e
        if next_colour_stops < 0:
            raise RosterError("name_colour_stops must be >= 0")

    next_wardrobe_slots: int | None = None
    if wardrobe_skin_slots is not None:
        try:
            next_wardrobe_slots = int(wardrobe_skin_slots)
        except (TypeError, ValueError) as e:
            raise RosterError("wardrobe_skin_slots must be an integer") from e
        if next_wardrobe_slots < 1:
            raise RosterError("wardrobe_skin_slots must be >= 1")
        next_wardrobe_slots = min(3, next_wardrobe_slots)

    next_kit_seconds: int | None = None
    if kit_cooldown_seconds_remaining is not None:
        try:
            next_kit_seconds = int(kit_cooldown_seconds_remaining)
        except (TypeError, ValueError) as e:
            raise RosterError(
                "kit_cooldown_seconds_remaining must be an integer"
            ) from e
        if next_kit_seconds < 0:
            raise RosterError("kit_cooldown_seconds_remaining must be >= 0")

    next_kit_hours: int | None = None
    if kit_cooldown_hours is not None:
        try:
            next_kit_hours = int(kit_cooldown_hours)
        except (TypeError, ValueError) as e:
            raise RosterError("kit_cooldown_hours must be an integer") from e
        if next_kit_hours < 0:
            raise RosterError("kit_cooldown_hours must be >= 0")

    next_kit_cooldowns_json: str | None = None
    if kit_cooldowns is not None:
        if not isinstance(kit_cooldowns, dict):
            raise RosterError("kit_cooldowns must be an object")
        next_kit_cooldowns_json = json.dumps(kit_cooldowns, separators=(",", ":"))

    now = _iso_now()
    normalized: list[tuple] = []
    seen: set[str] = set()
    for i, raw in enumerate(characters):
        if not isinstance(raw, dict):
            raise RosterError(f"characters[{i}] must be an object")
        cid = str(raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()
        status = str(raw.get("status") or "").strip().upper()
        if not cid:
            raise RosterError(f"characters[{i}].id is required")
        if not name:
            raise RosterError(f"characters[{i}].name is required")
        if not status:
            raise RosterError(f"characters[{i}].status is required")
        if cid in seen:
            raise RosterError(f"duplicate character id: {cid}")
        seen.add(cid)
        race = raw.get("race")
        klass = raw.get("class")
        created_at = raw.get("created_at")
        kit_raw = raw.get("kit_status")
        kit_status = None
        if kit_raw is not None and str(kit_raw).strip():
            kit_status = str(kit_raw).strip().lower()
        kit_statuses_json = None
        statuses_raw = raw.get("kit_statuses")
        if isinstance(statuses_raw, dict) and statuses_raw:
            cleaned = {
                str(k).strip().lower(): str(v).strip().lower()
                for k, v in statuses_raw.items()
                if k is not None and str(k).strip() and v is not None
            }
            if cleaned:
                kit_statuses_json = json.dumps(cleaned, separators=(",", ":"))
                if kit_status is None and "starter" in cleaned:
                    kit_status = cleaned["starter"]
        sheet = _sheet_from_character(raw)
        sheet_json = (
            json.dumps(sheet, separators=(",", ":")) if sheet is not None else None
        )
        normalized.append(
            (
                uuid,
                realm,
                cid,
                name,
                status,
                str(race).strip() if race is not None else None,
                str(klass).strip() if klass is not None else None,
                str(created_at).strip() if created_at is not None else None,
                kit_status,
                kit_statuses_json,
                sheet_json,
                now,
            )
        )

    with connect() as conn:
        conn.execute(
            "DELETE FROM character_roster WHERE player_uuid = ? AND realm_id = ?",
            (uuid, realm),
        )
        conn.executemany(
            """
            INSERT INTO character_roster (
                player_uuid, realm_id, character_id, name, status, race, class,
                created_at, kit_status, kit_statuses_json, sheet_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            normalized,
        )
        if (
            max_alive is not None
            or eighteen is not None
            or real_age_set is not None
            or next_account_epoch is not None
            or next_colour_stops is not None
            or next_wardrobe_slots is not None
            or next_kit_seconds is not None
            or next_kit_hours is not None
            or next_kit_cooldowns_json is not None
        ):
            existing = conn.execute(
                "SELECT * FROM character_player_meta WHERE player_uuid = ?",
                (uuid,),
            ).fetchone()
            next_max = max_alive
            next_eighteen = None if eighteen is None else (1 if eighteen else 0)
            next_real = None if real_age_set is None else (1 if real_age_set else 0)
            stored_epoch = next_account_epoch
            stored_stops = next_colour_stops
            stored_wardrobe = next_wardrobe_slots
            stored_kit_seconds = next_kit_seconds
            stored_kit_hours = next_kit_hours
            stored_kit_cooldowns = next_kit_cooldowns_json
            if existing is not None:
                if next_max is None:
                    next_max = existing["max_alive_characters"]
                if next_eighteen is None:
                    next_eighteen = existing["eighteen"]
                if next_real is None:
                    next_real = int(existing["real_age_set"] or 0)
                if stored_epoch is None:
                    stored_epoch = existing["account_created_at_epoch"]
                if stored_stops is None:
                    try:
                        stored_stops = existing["name_colour_stops"]
                    except (KeyError, IndexError):
                        stored_stops = None
                if stored_wardrobe is None:
                    try:
                        stored_wardrobe = existing["wardrobe_skin_slots"]
                    except (KeyError, IndexError):
                        stored_wardrobe = None
                if stored_kit_seconds is None:
                    try:
                        stored_kit_seconds = existing[
                            "kit_cooldown_seconds_remaining"
                        ]
                    except (KeyError, IndexError):
                        stored_kit_seconds = None
                if stored_kit_hours is None:
                    try:
                        stored_kit_hours = existing["kit_cooldown_hours"]
                    except (KeyError, IndexError):
                        stored_kit_hours = None
                if stored_kit_cooldowns is None:
                    try:
                        stored_kit_cooldowns = existing["kit_cooldowns_json"]
                    except (KeyError, IndexError):
                        stored_kit_cooldowns = None
            else:
                if next_real is None:
                    next_real = 0
            conn.execute(
                """
                INSERT INTO character_player_meta (
                    player_uuid, max_alive_characters, eighteen, real_age_set,
                    account_created_at_epoch, name_colour_stops,
                    wardrobe_skin_slots,
                    kit_cooldown_seconds_remaining, kit_cooldown_hours,
                    kit_cooldowns_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(player_uuid) DO UPDATE SET
                    max_alive_characters = excluded.max_alive_characters,
                    eighteen = excluded.eighteen,
                    real_age_set = excluded.real_age_set,
                    account_created_at_epoch = excluded.account_created_at_epoch,
                    name_colour_stops = excluded.name_colour_stops,
                    wardrobe_skin_slots = excluded.wardrobe_skin_slots,
                    kit_cooldown_seconds_remaining =
                        excluded.kit_cooldown_seconds_remaining,
                    kit_cooldown_hours = excluded.kit_cooldown_hours,
                    kit_cooldowns_json = excluded.kit_cooldowns_json,
                    updated_at = excluded.updated_at
                """,
                (
                    uuid,
                    next_max,
                    next_eighteen,
                    next_real,
                    stored_epoch,
                    stored_stops,
                    stored_wardrobe,
                    stored_kit_seconds,
                    stored_kit_hours,
                    stored_kit_cooldowns,
                    now,
                ),
            )
        conn.commit()

    out: dict[str, Any] = {
        "ok": True,
        "player_uuid": uuid,
        "realm_id": realm,
        "count": len(normalized),
    }
    if max_alive is not None:
        out["max_alive_characters"] = max_alive
    if eighteen is not None:
        out["eighteen"] = eighteen
    if real_age_set is not None:
        out["real_age_set"] = real_age_set
    if next_account_epoch is not None:
        out["account_created_at_epoch"] = next_account_epoch
    if next_colour_stops is not None:
        out["name_colour_stops"] = next_colour_stops
    if next_wardrobe_slots is not None:
        out["wardrobe_skin_slots"] = next_wardrobe_slots
    if next_kit_seconds is not None:
        out["kit_cooldown_seconds_remaining"] = next_kit_seconds
    if next_kit_hours is not None:
        out["kit_cooldown_hours"] = next_kit_hours
    if kit_cooldowns is not None:
        out["kit_cooldowns"] = kit_cooldowns
    return out
