"""Character roster mirror pushed by RPCharacters."""

from __future__ import annotations

from typing import Any

from src import database
from src.characters.estates import (
    death_fields,
    parse_estate,
    store_estate,
    store_will,
    will_fields,
)
from src.characters.times import api_time, utcnow


class RosterError(ValueError):
    """Invalid roster payload."""


def count_alive(player_uuid: str, realm_id: str | None = None) -> int:
    from src.skins.codes import normalize_realm_id

    uuid = (player_uuid or "").strip()
    if not uuid:
        return 0
    realm = normalize_realm_id(realm_id)
    with database.connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM character_roster
            WHERE player_uuid = %s
              AND realm_id = %s
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
    with database.connect() as conn:
        row = conn.execute(
            """
            SELECT max_alive_characters, eighteen, real_age_set,
                   account_created_at_epoch, name_colour_stops,
                   wardrobe_skin_slots,
                   kit_cooldown_seconds_remaining, kit_cooldown_hours,
                   kit_cooldowns_json
            FROM character_player_meta
            WHERE player_uuid = %s
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
    raw_cd = row["kit_cooldowns_json"]
    kit_cooldowns: dict[str, Any] = raw_cd if isinstance(raw_cd, dict) else {}
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


def set_real_age(
    player_uuid: str, eighteen: bool, *, conn: database.Connection | None = None,
) -> dict[str, Any]:
    """Persist 18+ attestation (player-level, once)."""
    uuid = (player_uuid or "").strip()
    if not uuid:
        raise RosterError("player_uuid is required")
    if conn is None:
        with database.connect() as own:
            return set_real_age(uuid, eighteen, conn=own)
    else:
        conn.execute(
            """
            INSERT INTO character_player_meta (
                player_uuid, max_alive_characters, eighteen, real_age_set, updated_at
            )
            VALUES (%s, NULL, %s, true, %s)
            ON CONFLICT (player_uuid) DO UPDATE SET
                eighteen = excluded.eighteen,
                real_age_set = true,
                updated_at = excluded.updated_at
            """,
            (uuid, bool(eighteen), utcnow()),
        )
    return {
        "player_uuid": uuid,
        "eighteen": eighteen,
        "real_age_set": True,
    }


_SHEET_TEXT_KEYS = (
    "race_name",
    "class_name",
    "age",
    "birthday",
    "gender",
    "description",
    "background",
)
# The order _sheet_from_character builds a sheet in. jsonb keeps object keys in its
# own order, so list_roster puts them back in this one.
_SHEET_KEYS = (*_SHEET_TEXT_KEYS, "attributes", "traits", "experience_modifiers", "clues")


def _sheet_from_character(raw: dict) -> dict[str, Any] | None:
    """Pull optional identity-sheet fields from a roster character object."""
    sheet: dict[str, Any] = {}
    for key in _SHEET_TEXT_KEYS:
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

    uuid = (player_uuid or "").strip()
    if not uuid:
        return []
    realm = normalize_realm_id(realm_id)
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT character_id, name, status, race, class, created_at, updated_at,
                   kit_status, kit_statuses_json, sheet_json, realm_id,
                   died_at, death_id, will_heir_id, will_heir_name, will_revision
            FROM character_roster
            WHERE player_uuid = %s AND realm_id = %s
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
            "updated_at": api_time(row["updated_at"]),
            "realm_id": realm,
            "source": "roster",
            "died_at": api_time(row["died_at"]),
            "death_id": row["death_id"],
        }
        if str(row["status"] or "").upper() == "ALIVE":
            item["will"] = {
                "heir_id": row["will_heir_id"],
                "heir_name": row["will_heir_name"] if row["will_heir_id"] else None,
                "revision": int(row["will_revision"] or 0),
            }
        kit_status = row["kit_status"]
        if kit_status is not None and str(kit_status).strip():
            item["kit_status"] = str(kit_status).strip().lower()
        statuses = row["kit_statuses_json"]
        if isinstance(statuses, dict) and statuses:
            item["kit_statuses"] = {
                str(k).strip().lower(): str(v).strip().lower()
                for k, v in statuses.items()
                if k is not None and str(k).strip()
            }
        sheet = row["sheet_json"]
        if isinstance(sheet, dict):
            ordered = [k for k in _SHEET_KEYS if k in sheet] + [k for k in sheet if k not in _SHEET_KEYS]
            for k in ordered:
                v = sheet[k]
                if k and v is not None and k not in item:
                    item[str(k)] = v
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
    """Replace one player's roster in one realm with RPCharacters' push.

    Pushes for one player and realm run one after the other (an advisory lock), so a
    push never keeps a character that the push committed after it dropped.
    """
    from src.skins.codes import CodeError, normalize_realm_id

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

    if kit_cooldowns is not None and not isinstance(kit_cooldowns, dict):
        raise RosterError("kit_cooldowns must be an object")

    now = utcnow()
    normalized: list[tuple] = []
    seen: set[str] = set()
    deaths: list[tuple] = []
    wills: list[tuple] = []
    estates: list[tuple] = []
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
                kit_statuses_json = database.Jsonb(cleaned)
                if kit_status is None and "starter" in cleaned:
                    kit_status = cleaned["starter"]
        if "died_at" in raw or "death_id" in raw:
            died_at, death_id = death_fields(raw)
            deaths.append((died_at, death_id, uuid, realm, cid))
        else:
            death_id = None
        will = will_fields(raw)
        if will is not None:
            wills.append((cid, will))
        if "estate" in raw:
            estate = parse_estate(raw.get("estate"), death_id)
            if estate is not None:
                estates.append((cid, estate))
        sheet = _sheet_from_character(raw)
        sheet_json = database.Jsonb(sheet) if sheet is not None else None
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

    # Rows in character id order, as ack_will_results locks them.
    normalized.sort(key=lambda row: row[2])
    with database.transaction(lock=f"characters:roster:{realm}:{uuid}") as conn:
        # Deletions must take the same row order as will acknowledgements too.
        conn.execute(
            "SELECT 1 FROM character_roster WHERE player_uuid = %s AND realm_id = %s "
            "ORDER BY character_id FOR UPDATE",
            (uuid, realm),
        )
        # Upsert so website-owned columns (wardrobe_active_slot) survive a push.
        conn.execute(
            "DELETE FROM character_roster WHERE player_uuid = %s AND realm_id = %s"
            " AND NOT (character_id = ANY(%s))",
            (uuid, realm, sorted(seen)),
        )
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO character_roster (
                    player_uuid, realm_id, character_id, name, status, race, class,
                    created_at, kit_status, kit_statuses_json, sheet_json, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (player_uuid, realm_id, character_id) DO UPDATE SET
                    name = excluded.name,
                    status = excluded.status,
                    race = excluded.race,
                    class = excluded.class,
                    created_at = excluded.created_at,
                    kit_status = excluded.kit_status,
                    kit_statuses_json = excluded.kit_statuses_json,
                    sheet_json = excluded.sheet_json,
                    updated_at = excluded.updated_at
                """,
                normalized,
            )
            cur.executemany(
                """
                UPDATE character_roster SET died_at = %s, death_id = %s
                WHERE player_uuid = %s AND realm_id = %s AND character_id = %s
                """,
                deaths,
            )
        for cid, will in wills:
            store_will(conn, uuid, realm, cid, will)
        for cid, estate in estates:
            store_estate(conn, uuid, realm, cid, estate)
        if (
            max_alive is not None
            or eighteen is not None
            or real_age_set is not None
            or next_account_epoch is not None
            or next_colour_stops is not None
            or next_wardrobe_slots is not None
            or next_kit_seconds is not None
            or next_kit_hours is not None
            or kit_cooldowns is not None
        ):
            # One upsert: a value the push leaves out keeps the stored one.
            conn.execute(
                """
                INSERT INTO character_player_meta (
                    player_uuid, max_alive_characters, eighteen, real_age_set,
                    account_created_at_epoch, name_colour_stops,
                    wardrobe_skin_slots,
                    kit_cooldown_seconds_remaining, kit_cooldown_hours,
                    kit_cooldowns_json, updated_at
                )
                VALUES (
                    %(uuid)s, %(max_alive)s, %(eighteen)s, COALESCE(%(real)s, false),
                    %(epoch)s, %(stops)s, %(wardrobe)s, %(kit_seconds)s, %(kit_hours)s,
                    %(kit_cooldowns)s, %(now)s
                )
                ON CONFLICT (player_uuid) DO UPDATE SET
                    max_alive_characters = COALESCE(
                        %(max_alive)s, character_player_meta.max_alive_characters),
                    eighteen = COALESCE(%(eighteen)s, character_player_meta.eighteen),
                    real_age_set = COALESCE(%(real)s, character_player_meta.real_age_set),
                    account_created_at_epoch = COALESCE(
                        %(epoch)s, character_player_meta.account_created_at_epoch),
                    name_colour_stops = COALESCE(
                        %(stops)s, character_player_meta.name_colour_stops),
                    wardrobe_skin_slots = COALESCE(
                        %(wardrobe)s, character_player_meta.wardrobe_skin_slots),
                    kit_cooldown_seconds_remaining = COALESCE(
                        %(kit_seconds)s, character_player_meta.kit_cooldown_seconds_remaining),
                    kit_cooldown_hours = COALESCE(
                        %(kit_hours)s, character_player_meta.kit_cooldown_hours),
                    kit_cooldowns_json = COALESCE(
                        %(kit_cooldowns)s, character_player_meta.kit_cooldowns_json),
                    updated_at = excluded.updated_at
                """,
                {
                    "uuid": uuid,
                    "max_alive": max_alive,
                    "eighteen": eighteen,
                    "real": real_age_set,
                    "epoch": next_account_epoch,
                    "stops": next_colour_stops,
                    "wardrobe": next_wardrobe_slots,
                    "kit_seconds": next_kit_seconds,
                    "kit_hours": next_kit_hours,
                    "kit_cooldowns": None if kit_cooldowns is None else database.Jsonb(kit_cooldowns),
                    "now": now,
                },
            )

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
