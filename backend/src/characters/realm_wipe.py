"""Staff wipe of one realm's website character data (plugin-key route)."""

from __future__ import annotations

import logging
from typing import Any

from src import database
from src.characters.wardrobe_assets import guarded
from src.characters.lore_locking import LOCKED_KEYS, key_params, lock_rows

logger = logging.getLogger("characters.realm_wipe")

# Order matters: character_wardrobe_slots and character_create_wardrobe carry no
# realm_id, so they are scoped through roster/creates and must go first.
WIPE_TABLES = (
    "character_wardrobe_slots",
    "character_create_wardrobe",
    "lore_item_customisations",
    "character_roster",
    "character_creates",
)

# Tagged cleanup keeps character_creates: those are donor submissions, not the
# in-game characters the plugin just deleted.
DELETE_TABLES = (
    "character_wardrobe_slots",
    "lore_item_customisations",
    "character_roster",
)

_ID_CHUNK = 200

_SLOTS_IN_REALM = """
    EXISTS (
        SELECT 1 FROM character_roster cr
        WHERE cr.player_uuid = character_wardrobe_slots.player_uuid
          AND cr.character_id = character_wardrobe_slots.character_id
          AND cr.realm_id = %s
    )
    OR EXISTS (
        SELECT 1 FROM character_creates cc
        WHERE cc.player_uuid = character_wardrobe_slots.player_uuid
          AND cc.character_id = character_wardrobe_slots.character_id
          AND cc.realm_id = %s
    )
"""


@guarded
def wipe_realm_character_data(realm_id: str | None = None) -> dict[str, Any]:
    """Delete this realm's character tables. Player rank/age meta is untouched."""
    from src.skins.codes import normalize_realm_id

    realm = normalize_realm_id(realm_id)
    deleted: dict[str, int] = {}
    relpaths: list[str] = []

    with database.connect() as conn:
        conn.execute(
            "SELECT 1 FROM character_roster WHERE realm_id = %s "
            "ORDER BY character_id, player_uuid FOR UPDATE",
            (realm,),
        )
        locked_lore = key_params(lock_rows(conn, "realm_id = %s", (realm,)))
        for row in conn.execute(
            f"SELECT png_relpath FROM character_wardrobe_slots WHERE {_SLOTS_IN_REALM}",
            (realm, realm),
        ).fetchall():
            if row["png_relpath"]:
                relpaths.append(str(row["png_relpath"]))
        for row in conn.execute(
            """
            SELECT png_relpath FROM character_create_wardrobe
            WHERE create_id IN (SELECT id FROM character_creates WHERE realm_id = %s)
            """,
            (realm,),
        ).fetchall():
            if row["png_relpath"]:
                relpaths.append(str(row["png_relpath"]))

        deleted["character_wardrobe_slots"] = conn.execute(
            f"DELETE FROM character_wardrobe_slots WHERE {_SLOTS_IN_REALM}",
            (realm, realm),
        ).rowcount
        deleted["character_create_wardrobe"] = conn.execute(
            """
            DELETE FROM character_create_wardrobe
            WHERE create_id IN (SELECT id FROM character_creates WHERE realm_id = %s)
            """,
            (realm,),
        ).rowcount
        deleted["lore_item_customisations"] = conn.execute(
            f"DELETE FROM lore_item_customisations WHERE realm_id = %s AND {LOCKED_KEYS}",
            (realm, *locked_lore),
        ).rowcount
        deleted["character_roster"] = conn.execute(
            "DELETE FROM character_roster WHERE realm_id = %s",
            (realm,),
        ).rowcount
        deleted["character_creates"] = conn.execute(
            "DELETE FROM character_creates WHERE realm_id = %s",
            (realm,),
        ).rowcount

    pngs_deleted = _delete_pngs(relpaths)
    total = sum(max(count, 0) for count in deleted.values())
    logger.warning(
        "Wiped realm %s character data: %s row(s), %s png(s)",
        realm,
        total,
        pngs_deleted,
    )
    return {
        "realm_id": realm,
        "deleted": {table: max(deleted.get(table, 0), 0) for table in WIPE_TABLES},
        "total": total,
        "pngs_deleted": pngs_deleted,
    }


@guarded
def delete_characters_for_realm(
    realm_id: str | None,
    character_ids: list[str] | None,
) -> dict[str, Any]:
    """Drop site rows for characters deleted in-game. Pending creates are kept."""
    from src.skins.codes import normalize_realm_id

    realm = normalize_realm_id(realm_id)
    ids = _clean_ids(character_ids)
    deleted = {table: 0 for table in DELETE_TABLES}
    if not ids:
        return {
            "realm_id": realm,
            "requested": 0,
            "deleted": deleted,
            "total": 0,
            "pngs_deleted": 0,
        }

    relpaths: list[str] = []
    with database.connect() as conn:
        # Lock the whole selection before chunking, in the ack batch's row order.
        conn.execute(
            "SELECT 1 FROM character_roster WHERE realm_id = %s AND character_id = ANY(%s) "
            "ORDER BY character_id, player_uuid FOR UPDATE",
            (realm, ids),
        )
        locked_lore = key_params(lock_rows(
            conn, "realm_id = %s AND character_id = ANY(%s)", (realm, ids),
        ))
        for chunk in _chunks(ids, _ID_CHUNK):
            # Slots go before the roster rows that scope them to this realm.
            slots_where = f"character_id = ANY(%s) AND ({_SLOTS_IN_REALM})"
            slot_params = (chunk, realm, realm)
            for row in conn.execute(
                f"SELECT png_relpath FROM character_wardrobe_slots "
                f"WHERE {slots_where}",
                slot_params,
            ).fetchall():
                if row["png_relpath"]:
                    relpaths.append(str(row["png_relpath"]))
            deleted["character_wardrobe_slots"] += _rows(
                conn.execute(
                    f"DELETE FROM character_wardrobe_slots WHERE {slots_where}",
                    slot_params,
                )
            )
            deleted["lore_item_customisations"] += _rows(
                conn.execute(
                    "DELETE FROM lore_item_customisations "
                    f"WHERE realm_id = %s AND character_id = ANY(%s) AND {LOCKED_KEYS}",
                    (realm, chunk, *locked_lore),
                )
            )
            deleted["character_roster"] += _rows(
                conn.execute(
                    "DELETE FROM character_roster "
                    "WHERE realm_id = %s AND character_id = ANY(%s)",
                    (realm, chunk),
                )
            )

    pngs_deleted = _delete_pngs(relpaths)
    total = sum(deleted.values())
    logger.warning(
        "Deleted %s row(s) for %s character id(s) on realm %s, %s png(s)",
        total,
        len(ids),
        realm,
        pngs_deleted,
    )
    return {
        "realm_id": realm,
        "requested": len(ids),
        "deleted": deleted,
        "total": total,
        "pngs_deleted": pngs_deleted,
    }


def _clean_ids(character_ids: list[str] | None) -> list[str]:
    seen: list[str] = []
    for raw in character_ids or []:
        value = str(raw or "").strip()
        if value and value not in seen:
            seen.append(value)
    return seen


def _chunks(ids: list[str], size: int) -> list[list[str]]:
    return [ids[i:i + size] for i in range(0, len(ids), size)]


def _rows(cursor: Any) -> int:
    return max(cursor.rowcount, 0)


def _delete_pngs(relpaths: list[str]) -> int:
    from src.characters.wardrobe import delete_png_relpath

    done = 0
    for relpath in relpaths:
        try:
            if delete_png_relpath(relpath):
                done += 1
        except OSError as e:
            logger.warning("Realm wipe could not delete %s: %s", relpath, e)
    return done
