"""A person's moderation history, joined by Discord ID and Minecraft UUID."""
from __future__ import annotations

import re
from uuid import UUID

from src import database
from src.coreprotect.reader import CoreProtectConfig, Reader, Unavailable
from src.precedent import db as precedent
from src.skins.codes import api_time
from src.skins.discord_link import get_link_for_discord_id, get_identity_status
from .players import PlayerError


def discord_id(value: str) -> str:
    if not re.fullmatch(r"[0-9]{15,20}", value):
        raise PlayerError(400, "bad_discord_id")
    return value


def discord_people() -> list[dict]:
    """Known website accounts and case participants, including those never linked."""
    with database.connect() as conn:
        ready = conn.execute("SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                             "WHERE table_schema = 'public' AND table_name = 'precedent_cases' "
                             "AND column_name = 'participants') AS ready").fetchone()["ready"]
        if not ready:
            return [dict(r) for r in conn.execute(
                "SELECT discord_user_id, discord_username, discord_global_name AS name, role "
                "FROM users WHERE NOT placeholder AND discord_user_id ~ '^[0-9]{15,20}$'").fetchall()]
        rows = conn.execute("""
            SELECT DISTINCT ON (discord_user_id) discord_user_id, discord_username, name, role
            FROM (
                SELECT discord_user_id, discord_username, discord_global_name AS name, role,
                       0 AS priority, last_login_at AS seen
                FROM users WHERE NOT placeholder AND discord_user_id ~ '^[0-9]{15,20}$'
                UNION ALL
                SELECT p->>'discord_user_id', p->>'discord_username', p->>'name', NULL,
                       1, created_at
                FROM precedent_cases CROSS JOIN LATERAL jsonb_array_elements(participants) p
                WHERE p->>'discord_user_id' ~ '^[0-9]{15,20}$'
            ) people ORDER BY discord_user_id, priority, seen DESC
        """).fetchall()
    return [dict(row) for row in rows]


def person(config: CoreProtectConfig, *, player_uuid: str | None = None,
           discord_user_id: str | None = None) -> dict:
    precedent.migrate()
    if discord_user_id is not None:
        discord_user_id = discord_id(discord_user_id)
        link = get_link_for_discord_id(discord_user_id)
        player_uuid = link["player_uuid"] if link else None
    else:
        try:
            player_uuid = str(UUID(player_uuid or ""))
        except ValueError:
            raise PlayerError(400, "bad_uuid") from None
        status = get_identity_status(player_uuid)
        link = status if status["linked"] else None
        discord_user_id = link["discord_user_id"] if link else None

    names = {link["minecraft_name"]} if link and link["minecraft_name"] else set()
    current = link["minecraft_name"] if link else None
    complete = True
    if player_uuid:
        try:
            with Reader(config) as reader:
                known = reader.rows("SELECT user FROM co_user WHERE lower(uuid) = ? ORDER BY time, id",
                                    (player_uuid.lower(),))
                history = reader.rows("SELECT user FROM co_username_log WHERE lower(uuid) = ?",
                                      (player_uuid.lower(),))
            names.update(r["user"] for r in [*known, *history] if r["user"])
            if known:
                current = known[-1]["user"]
        except Unavailable:
            complete = False
    with database.connect() as conn:
        user = conn.execute("SELECT discord_username, discord_global_name FROM users "
                            "WHERE discord_user_id = %s AND NOT placeholder", (discord_user_id,)).fetchone()
        recorded = conn.execute("""
            SELECT p->>'name' AS name, p->>'discord_username' AS discord_username
            FROM precedent_cases CROSS JOIN LATERAL jsonb_array_elements(participants) p
            WHERE p->>'discord_user_id' = %s ORDER BY created_at DESC, id DESC LIMIT 1
        """, (discord_user_id,)).fetchone()
    username = ((user or {}).get("discord_username") or (link or {}).get("discord_username")
                or (recorded or {}).get("discord_username"))
    return {"player_uuid": player_uuid, "discord_user_id": discord_user_id,
            "minecraft_name": current, "discord_username": username,
            "name": current or username or (user or {}).get("discord_global_name")
                    or (recorded or {}).get("name") or discord_user_id or player_uuid,
            "names": sorted(n.casefold() for n in names), "legacy_names_complete": complete}


_RECORDS = """
    WITH records AS (
        SELECT 'case:' || id::text AS id, id::text AS case_id, 'case' AS kind,
               summary, rule, ruling, punishment, logged_by, players, participants, created_at,
               CASE WHEN participants = '[]'::jsonb THEN 'name' ELSE 'account' END AS matched_by
        FROM precedent_cases
        WHERE (%(uuid)s::text IS NOT NULL AND participants @> %(uuid_match)s)
           OR (%(discord)s::text IS NOT NULL AND participants @> %(discord_match)s)
           OR (participants = '[]'::jsonb AND EXISTS (
               SELECT 1 FROM unnest(players) name WHERE lower(name) = ANY(%(names)s::text[])))
        UNION ALL
        SELECT 'warning:' || id::text, NULL, 'warning', reason, '', '', 'Warning', staff_name,
               '{}'::text[], '[]'::jsonb, created_at, 'account'
        FROM player_warnings WHERE lower(player_uuid) = %(uuid)s
        UNION ALL
        SELECT 'notification:' || n.id::text, NULL, n.type,
               COALESCE(n.payload->>'reason', CASE WHEN n.type = 'unban' THEN 'Ban lifted' ELSE 'Ban recorded' END),
               '', '', COALESCE(n.payload->>'duration', ''), n.payload->>'staff_name',
               '{}'::text[], '[]'::jsonb, n.created_at, 'account'
        FROM player_notifications n
        WHERE n.type IN ('ban', 'unban', 'warn')
          AND (lower(n.player_uuid) = %(uuid)s OR n.discord_user_id = %(discord)s)
          AND NOT (n.type = 'warn' AND EXISTS (
              SELECT 1 FROM player_warnings w WHERE w.id::text = n.payload->>'warning_id'))
    )
"""


def history(config: CoreProtectConfig, *, player_uuid: str | None = None,
            discord_user_id: str | None = None, limit: int = 25, offset: int = 0) -> dict:
    who = person(config, player_uuid=player_uuid, discord_user_id=discord_user_id)
    params = {"uuid": who["player_uuid"], "discord": who["discord_user_id"], "names": who["names"],
              "uuid_match": database.Jsonb([{"player_uuid": who["player_uuid"]}]),
              "discord_match": database.Jsonb([{"discord_user_id": who["discord_user_id"]}]),
              "limit": limit, "offset": offset}
    with database.connect() as conn:
        rows = conn.execute(_RECORDS + "SELECT * FROM records ORDER BY created_at DESC, id DESC "
                            "LIMIT %(limit)s OFFSET %(offset)s", params).fetchall()
        total = conn.execute(_RECORDS + "SELECT count(*) AS total FROM records", params).fetchone()["total"]
    entries = [{**row, "created_at": api_time(row["created_at"])} for row in rows]
    return {"person": {k: v for k, v in who.items() if k != "names"},
            "entries": entries, "total": total, "limit": limit, "offset": offset}
