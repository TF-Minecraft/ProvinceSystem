"""Wills changed on Profile: requests RPCharacters pulls and acknowledges, and the heir search."""

from __future__ import annotations

import time
import uuid as uuid_mod
from collections import defaultdict
from datetime import timedelta
from typing import Any

from src import database
from src.characters.estates import store_will
from src.characters.times import api_time, utcnow
from src.skins.codes import CodeError, normalize_realm_id

WILL_RESULTS = frozenset({"applied", "stale", "invalid heir", "invalid", "character dead"})
# A pending request this old no longer blocks a new one (an old plugin never pulls it).
REPLACE_AFTER = timedelta(minutes=10)
# Profile shows a refused request this long after RPCharacters answered.
RESULT_SHOWN_FOR = timedelta(days=7)

HEIR_SEARCH_MIN = 3
HEIR_SEARCH_MAX_RESULTS = 10
_HEIR_RATE_LIMIT = 20
_HEIR_RATE_WINDOW_SEC = 60.0
_heir_rate: dict[str, list[float]] = defaultdict(list)


class WillError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def require_realm(realm_id: str | None) -> str:
    """Plugin will routes name their realm; there is no default."""
    if not (realm_id or "").strip():
        raise WillError("realm_id is required")
    try:
        return normalize_realm_id(realm_id)
    except CodeError as e:
        raise WillError(str(e)) from e


def _session_realm(realm_id: str | None) -> str:
    try:
        return normalize_realm_id(realm_id)
    except CodeError as e:
        raise WillError(str(e)) from e


def _roster_row(
    conn: database.Connection,
    realm: str,
    character_id: str,
    account: str | None = None,
    *,
    lock: bool = False,
) -> dict[str, Any] | None:
    sql = """
        SELECT player_uuid, character_id, name, status, will_heir_id, will_revision
        FROM character_roster WHERE realm_id = %s AND character_id = %s
    """
    params: tuple = (realm, character_id)
    if account is not None:
        sql += " AND player_uuid = %s"
        params += (account,)
    return conn.execute(sql + " LIMIT 1" + (" FOR UPDATE" if lock else ""), params).fetchone()


def _race_name(row: dict[str, Any]) -> str | None:
    sheet = row["sheet"]
    name = sheet.get("race_name") if isinstance(sheet, dict) else None
    return str(name) if name else row["race"]


def _request_out(row: dict[str, Any], heir_name: str | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "heir_character_id": row["heir_character_id"],
        "heir_name": heir_name,
        "base_revision": row["base_revision"],
        "status": row["status"],
        "result": row["result"],
        "created_at": api_time(row["created_at"]),
        "acked_at": api_time(row["acked_at"]),
    }


def _heir_name(conn: database.Connection, realm: str, heir_id: str | None) -> str | None:
    if not heir_id:
        return None
    row = conn.execute(
        "SELECT name FROM character_roster WHERE realm_id = %s AND character_id = %s LIMIT 1",
        (realm, heir_id),
    ).fetchone()
    return row["name"] if row else None


def create_will_request(
    player_uuid: str,
    realm_id: str | None,
    character_id: str,
    heir_character_id: str | None,
    base_revision: int,
) -> dict[str, Any]:
    """Queue a will change for one of the player's own living characters.

    The character's roster row is locked first, so two requests for one character run
    one after the other and a roster push waits; the partial unique index on pending
    requests backs that up.
    """
    account = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    heir = (heir_character_id or "").strip() or None
    realm = _session_realm(realm_id)
    if not account or not cid:
        raise WillError("character_id is required")
    if isinstance(base_revision, bool) or not isinstance(base_revision, int) or base_revision < 0:
        raise WillError("base_revision must be a whole number")
    now = utcnow()
    with database.connect() as conn:
        row = _roster_row(conn, realm, cid, account, lock=True)
        if row is None:
            raise WillError("Character not found", status_code=403)
        if str(row["status"] or "").upper() != "ALIVE":
            raise WillError("character_not_alive", status_code=409)
        if base_revision != int(row["will_revision"] or 0):
            raise WillError("will_changed", status_code=409)
        if heir is not None:
            heir_row = _roster_row(conn, realm, heir)
            if heir == cid or heir_row is None or str(heir_row["status"] or "").upper() != "ALIVE":
                raise WillError("invalid_heir")
        pending = conn.execute(
            """
            SELECT id, created_at FROM will_requests
            WHERE realm_id = %s AND character_id = %s AND status = 'pending'
            """,
            (realm, cid),
        ).fetchall()
        for old in pending:
            if now - old["created_at"] < REPLACE_AFTER:
                raise WillError("request_pending", status_code=409)
        conn.execute(
            "UPDATE will_requests SET status = 'replaced' WHERE realm_id = %s AND character_id = %s AND status = 'pending'",
            (realm, cid),
        )
        request_id = str(uuid_mod.uuid4())
        created_row = conn.execute(
            """
            INSERT INTO will_requests (
                id, realm_id, character_id, account_uuid, heir_character_id,
                base_revision, created_at, status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
            RETURNING *
            """,
            (request_id, realm, cid, account, heir, base_revision, now),
        ).fetchone()
        return _request_out(created_row, _heir_name(conn, realm, heir))


def list_pending_wills(realm_id: str | None) -> list[dict[str, Any]]:
    realm = require_realm(realm_id)
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM will_requests
            WHERE realm_id = %s AND status = 'pending'
            ORDER BY created_at ASC, id ASC
            """,
            (realm,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "realm_id": r["realm_id"],
            "character_id": r["character_id"],
            "account_uuid": r["account_uuid"],
            "heir_character_id": r["heir_character_id"],
            "base_revision": r["base_revision"],
            "created_at": api_time(r["created_at"]),
        }
        for r in rows
    ]


def ack_will_results(realm_id: str | None, results: Any) -> dict[str, Any]:
    """Record RPCharacters' answers. Only pending requests of this realm change.

    Each request moves from pending to acked with a compare-and-set, so an answer sent
    twice, or two acks racing, apply once. The characters' roster rows are locked
    first, in id order, as create_will_request locks them before its requests.
    """
    realm = require_realm(realm_id)
    if not isinstance(results, list):
        raise WillError("results must be a list")
    for i, raw in enumerate(results):
        if not isinstance(raw, dict):
            raise WillError(f"results[{i}] must be an object")
    acked: list[str] = []
    already: list[str] = []
    refused: list[dict[str, str]] = []
    now = utcnow()
    with database.connect() as conn:
        ids = [rid for raw in results if (rid := str(raw.get("id") or "").strip())]
        rows = {
            r["id"]: r
            for r in conn.execute("SELECT * FROM will_requests WHERE id = ANY(%s)", (ids,))
        }
        locked_roster = {(r["player_uuid"], r["character_id"]) for r in conn.execute(
            """
            SELECT player_uuid, character_id FROM character_roster
            WHERE realm_id = %s AND character_id = ANY(%s)
            ORDER BY character_id, player_uuid
            FOR UPDATE
            """,
            (realm, sorted({r["character_id"] for r in rows.values() if r["realm_id"] == realm})),
        )}
        # Requests outlive roster rows. Lock them too, before following caller order.
        conn.execute(
            "SELECT 1 FROM will_requests WHERE realm_id = %s AND id = ANY(%s) "
            "ORDER BY id FOR UPDATE",
            (realm, ids),
        )
        for raw in results:
            rid = str(raw.get("id") or "").strip()
            result = str(raw.get("result") or "").strip().lower()
            row = rows.get(rid) if rid else None
            if row is None:
                refused.append({"id": rid, "reason": "unknown"})
                continue
            if row["realm_id"] != realm:
                refused.append({"id": rid, "reason": "realm"})
                continue
            if result not in WILL_RESULTS:
                refused.append({"id": rid, "reason": "result"})
                continue
            row = conn.execute(
                """
                UPDATE will_requests SET status = 'acked', result = %s, acked_at = %s
                WHERE id = %s AND realm_id = %s AND status = 'pending'
                RETURNING *
                """,
                (result, now, rid, realm),
            ).fetchone()
            if row is None:
                already.append(rid)
                continue
            acked.append(rid)
            # Applying bumps the will by one; any other revision waits for the roster push, so a bad
            # ack cannot pin the stored will at a revision the game never reaches.
            revision = raw.get("will_revision")
            if (
                result == "applied"
                and isinstance(revision, int)
                and not isinstance(revision, bool)
                and revision == row["base_revision"] + 1
                # Retained requests may have no roster row. Never reach back
                # from a request lock into a roster row recreated after selection.
                and (row["account_uuid"], row["character_id"]) in locked_roster
            ):
                heir = row["heir_character_id"]
                name = str(raw.get("heir_name") or "").strip()[:64] or _heir_name(conn, realm, heir)
                store_will(
                    conn,
                    row["account_uuid"],
                    realm,
                    row["character_id"],
                    (heir, name if heir else None, revision),
                )
    return {"ok": True, "acked": acked, "already": already, "refused": refused}


def will_requests_for(
    conn: database.Connection, realm: str, account: str, character_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Each character's pending request, or its last answered one if recent and not applied."""
    if not character_ids:
        return {}
    rows = conn.execute(
        """
        SELECT * FROM will_requests
        WHERE realm_id = %s AND account_uuid = %s AND character_id = ANY(%s)
          AND status IN ('pending', 'acked')
        ORDER BY created_at DESC, id DESC
        """,
        (realm, account, list(character_ids)),
    ).fetchall()
    cutoff = utcnow() - RESULT_SHOWN_FOR
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        cid = row["character_id"]
        if cid in out:
            continue
        if row["status"] == "acked":
            acked = row["acked_at"]
            if acked is None or acked < cutoff:
                out[cid] = {}
                continue
        out[cid] = _request_out(row, _heir_name(conn, realm, row["heir_character_id"]))
    return {cid: req for cid, req in out.items() if req}


def check_heir_search_rate(key: str) -> None:
    now = time.monotonic()
    bucket = _heir_rate[key or "unknown"]
    bucket[:] = [t for t in bucket if t > now - _HEIR_RATE_WINDOW_SEC]
    if len(bucket) >= _HEIR_RATE_LIMIT:
        raise WillError("Too many searches; try again in a minute", status_code=429)
    bucket.append(now)


def search_heirs(
    player_uuid: str,
    realm_id: str | None,
    query: str | None,
    exclude_character_id: str | None = None,
) -> list[dict[str, Any]]:
    """Living characters of the realm whose name contains the query. Never says who plays them."""
    account = (player_uuid or "").strip()
    text = " ".join((query or "").split())
    if len(text) < HEIR_SEARCH_MIN:
        raise WillError(f"Type at least {HEIR_SEARCH_MIN} letters")
    text = text[:64]
    realm = _session_realm(realm_id)
    like = "%" + text.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    exclude = (exclude_character_id or "").strip()
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT character_id, name, race, sheet, player_uuid FROM character_roster
            WHERE realm_id = %s AND UPPER(status) = 'ALIVE'
              AND LOWER(name) LIKE %s ESCAPE '\\'
              AND character_id != %s
            ORDER BY (LOWER(name) = %s) DESC, (LOWER(name) LIKE %s ESCAPE '\\') DESC, LOWER(name), character_id
            LIMIT %s
            """,
            (realm, like, exclude, text.lower(), like[1:], HEIR_SEARCH_MAX_RESULTS),
        ).fetchall()
    out = []
    for row in rows:
        out.append(
            {
                "id": row["character_id"],
                "short_id": str(row["character_id"])[:8],
                "name": row["name"],
                "race": _race_name(row),
                "own": row["player_uuid"] == account,
            }
        )
    return out
