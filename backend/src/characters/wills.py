"""Wills changed on Profile: requests RPCharacters pulls and acknowledges, and the heir search."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid as uuid_mod
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from src.characters.estates import store_will
from src.skins.codes import CodeError, normalize_realm_id
from src.skins.db import connect

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


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None


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
    conn: sqlite3.Connection, realm: str, character_id: str, account: str | None = None
) -> sqlite3.Row | None:
    sql = """
        SELECT player_uuid, character_id, name, status, will_heir_id, will_revision
        FROM character_roster WHERE realm_id = ? AND character_id = ?
    """
    params: tuple = (realm, character_id)
    if account is not None:
        sql += " AND player_uuid = ?"
        params += (account,)
    return conn.execute(sql + " LIMIT 1", params).fetchone()


def _race_name(row: sqlite3.Row) -> str | None:
    try:
        sheet = json.loads(row["sheet_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        sheet = {}
    name = sheet.get("race_name") if isinstance(sheet, dict) else None
    return str(name) if name else row["race"]


def _request_out(row: sqlite3.Row, heir_name: str | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "heir_character_id": row["heir_character_id"],
        "heir_name": heir_name,
        "base_revision": row["base_revision"],
        "status": row["status"],
        "result": row["result"],
        "created_at": row["created_at"],
        "acked_at": row["acked_at"],
    }


def _heir_name(conn: sqlite3.Connection, realm: str, heir_id: str | None) -> str | None:
    if not heir_id:
        return None
    row = conn.execute(
        "SELECT name FROM character_roster WHERE realm_id = ? AND character_id = ? LIMIT 1",
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
    """Queue a will change for one of the player's own living characters."""
    account = (player_uuid or "").strip()
    cid = (character_id or "").strip()
    heir = (heir_character_id or "").strip() or None
    realm = _session_realm(realm_id)
    if not account or not cid:
        raise WillError("character_id is required")
    if isinstance(base_revision, bool) or not isinstance(base_revision, int) or base_revision < 0:
        raise WillError("base_revision must be a whole number")
    now = _now()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = _roster_row(conn, realm, cid, account)
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
            WHERE realm_id = ? AND character_id = ? AND status = 'pending'
            """,
            (realm, cid),
        ).fetchall()
        for old in pending:
            created = _parse_iso(old["created_at"])
            if created is not None and now - created < REPLACE_AFTER:
                raise WillError("request_pending", status_code=409)
        conn.execute(
            "UPDATE will_requests SET status = 'replaced' WHERE realm_id = ? AND character_id = ? AND status = 'pending'",
            (realm, cid),
        )
        request_id = str(uuid_mod.uuid4())
        conn.execute(
            """
            INSERT INTO will_requests (
                id, realm_id, character_id, account_uuid, heir_character_id,
                base_revision, created_at, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            (request_id, realm, cid, account, heir, base_revision, _iso(now)),
        )
        conn.commit()
        created_row = conn.execute("SELECT * FROM will_requests WHERE id = ?", (request_id,)).fetchone()
        return _request_out(created_row, _heir_name(conn, realm, heir))


def list_pending_wills(realm_id: str | None) -> list[dict[str, Any]]:
    realm = require_realm(realm_id)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM will_requests
            WHERE realm_id = ? AND status = 'pending'
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
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def ack_will_results(realm_id: str | None, results: Any) -> dict[str, Any]:
    """Record RPCharacters' answers. Only pending requests of this realm change."""
    realm = require_realm(realm_id)
    if not isinstance(results, list):
        raise WillError("results must be a list")
    acked: list[str] = []
    already: list[str] = []
    refused: list[dict[str, str]] = []
    now = _iso(_now())
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        for i, raw in enumerate(results):
            if not isinstance(raw, dict):
                raise WillError(f"results[{i}] must be an object")
            rid = str(raw.get("id") or "").strip()
            result = str(raw.get("result") or "").strip().lower()
            row = conn.execute("SELECT * FROM will_requests WHERE id = ?", (rid,)).fetchone() if rid else None
            if row is None:
                refused.append({"id": rid, "reason": "unknown"})
                continue
            if row["realm_id"] != realm:
                refused.append({"id": rid, "reason": "realm"})
                continue
            if result not in WILL_RESULTS:
                refused.append({"id": rid, "reason": "result"})
                continue
            if row["status"] != "pending":
                already.append(rid)
                continue
            conn.execute(
                "UPDATE will_requests SET status = 'acked', result = ?, acked_at = ? WHERE id = ?",
                (result, now, rid),
            )
            acked.append(rid)
            revision = raw.get("will_revision")
            if result == "applied" and isinstance(revision, int) and not isinstance(revision, bool) and revision >= 0:
                heir = row["heir_character_id"]
                name = str(raw.get("heir_name") or "").strip()[:64] or _heir_name(conn, realm, heir)
                store_will(
                    conn,
                    row["account_uuid"],
                    realm,
                    row["character_id"],
                    (heir, name if heir else None, revision),
                )
        conn.commit()
    return {"ok": True, "acked": acked, "already": already, "refused": refused}


def will_requests_for(
    conn: sqlite3.Connection, realm: str, account: str, character_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Each character's pending request, or its last answered one if recent and not applied."""
    if not character_ids:
        return {}
    marks = ", ".join("?" for _ in character_ids)
    rows = conn.execute(
        f"""
        SELECT * FROM will_requests
        WHERE realm_id = ? AND account_uuid = ? AND character_id IN ({marks})
          AND status IN ('pending', 'acked')
        ORDER BY created_at DESC, id DESC
        """,
        (realm, account, *character_ids),
    ).fetchall()
    cutoff = _now() - RESULT_SHOWN_FOR
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        cid = row["character_id"]
        if cid in out:
            continue
        if row["status"] == "acked":
            acked = _parse_iso(row["acked_at"])
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
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT character_id, name, race, sheet_json, player_uuid FROM character_roster
            WHERE realm_id = ? AND UPPER(status) = 'ALIVE'
              AND LOWER(name) LIKE ? ESCAPE '\\'
              AND character_id != ?
            ORDER BY (LOWER(name) = ?) DESC, (LOWER(name) LIKE ? ESCAPE '\\') DESC, LOWER(name), character_id
            LIMIT ?
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
