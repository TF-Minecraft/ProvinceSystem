"""Common full-key row order for transactions changing multiple lore items."""

from src import database


LOCKED_KEYS = """(player_uuid, character_id, kit_key) IN (
    SELECT * FROM unnest(%s::text[], %s::text[], %s::text[])
)"""


def lock_rows(conn: database.Connection, where: str, params: tuple) -> list[dict]:
    # Callers supply internal SQL predicates, never request text. Capture the keys
    # too: a later statement must not acquire newly matching rows out of order.
    return conn.execute(
        "SELECT player_uuid, character_id, kit_key FROM lore_item_customisations "
        f"WHERE {where} ORDER BY player_uuid, character_id, kit_key FOR UPDATE",
        params,
    ).fetchall()


def key_params(rows: list[dict]) -> tuple[list, list, list]:
    return tuple([r[key] for r in rows] for key in ("player_uuid", "character_id", "kit_key"))
