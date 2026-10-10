"""Supabase Postgres storage for precedent cases (pgvector similarity search)."""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any

import psycopg2
import psycopg2.extras
from pgvector.psycopg2 import register_vector
from psycopg2.extras import Json

logger = logging.getLogger("precedent.db")

_MIGRATED = False


class PrecedentDBError(RuntimeError):
    """Raised when the precedent database is not reachable or not configured."""


@dataclass(frozen=True)
class AuditActor:
    """Who performed a write, for the precedent_audit trail.

    `source` is "web" for a staff panel account and "bot" for the shared
    STAFF_KEY. Only the web path carries a verified identity: the bot's key is
    shared, so `actor` there is whatever the caller supplied and must not be
    treated as proof of who acted.
    """

    source: str
    actor: str = ""
    actor_uuid: str = ""


_AUDIT_FIELDS = ("logged_by", "players", "summary", "rule", "ruling", "punishment")


def _snapshot(row: Any) -> dict[str, Any] | None:
    """Case content as plain JSON-able data. Embedding is excluded (huge, derived)."""
    if row is None:
        return None
    return {k: (list(row[k]) if k == "players" else row[k]) for k in _AUDIT_FIELDS}


def _write_audit(
    cur,
    *,
    case_id: str | None,
    action: str,
    actor: AuditActor | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """Append to the audit trail. Must run inside the caller's transaction.

    Sharing the transaction is the point: a case change and the record of it
    either both commit or both roll back, so there is no way to mutate a case
    without leaving a trace.
    """
    if actor is None:
        actor = AuditActor(source="unknown")
    cur.execute(
        """
        INSERT INTO precedent_audit
            (case_id, action, source, actor, actor_uuid, before, after)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            case_id,
            action,
            actor.source,
            actor.actor,
            actor.actor_uuid,
            Json(before) if before is not None else None,
            Json(after) if after is not None else None,
        ),
    )


def _dsn() -> str:
    dsn = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not dsn:
        raise PrecedentDBError("SUPABASE_DB_URL is not set")
    return dsn


def _connect():
    try:
        conn = psycopg2.connect(_dsn())
    except psycopg2.OperationalError as e:
        raise PrecedentDBError(f"Could not connect to precedent DB: {e}") from e
    register_vector(conn)
    return conn


def migrate() -> None:
    """Create the pgvector extension + precedent_cases table if missing. No-op once done."""
    global _MIGRATED
    if _MIGRATED:
        return
    if not os.environ.get("SUPABASE_DB_URL", "").strip():
        logger.warning("SUPABASE_DB_URL unset; precedent DB migration skipped")
        return
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS precedent_cases (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    logged_by TEXT NOT NULL,
                    players TEXT[] NOT NULL DEFAULT '{}',
                    summary TEXT NOT NULL,
                    rule TEXT NOT NULL DEFAULT '',
                    ruling TEXT NOT NULL DEFAULT '',
                    punishment TEXT NOT NULL DEFAULT '',
                    embedding VECTOR(1024) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            # No foreign key to precedent_cases on purpose: deleting a case must
            # never remove the record that it was deleted, which is the entry
            # this table exists to keep.
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS precedent_audit (
                    id BIGSERIAL PRIMARY KEY,
                    case_id UUID,
                    action TEXT NOT NULL,
                    source TEXT NOT NULL,
                    actor TEXT NOT NULL DEFAULT '',
                    actor_uuid TEXT NOT NULL DEFAULT '',
                    before JSONB,
                    after JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS precedent_audit_created_idx "
                "ON precedent_audit (created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS precedent_audit_case_idx "
                "ON precedent_audit (case_id)"
            )
    finally:
        conn.close()
    _MIGRATED = True
    logger.info("Precedent DB migrated")


def insert_case(
    *,
    logged_by: str,
    players: list[str],
    summary: str,
    rule: str,
    ruling: str,
    punishment: str,
    embedding: list[float],
    actor: AuditActor | None = None,
) -> str:
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO precedent_cases
                    (logged_by, players, summary, rule, ruling, punishment, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (logged_by, players, summary, rule, ruling, punishment, embedding),
            )
            row = cur.fetchone()
            case_id = str(row[0])
            _write_audit(
                cur,
                case_id=case_id,
                action="create",
                actor=actor,
                after={
                    "logged_by": logged_by,
                    "players": list(players),
                    "summary": summary,
                    "rule": rule,
                    "ruling": ruling,
                    "punishment": punishment,
                },
            )
            return case_id
    finally:
        conn.close()


# Nearest-K search always returns rows, however far away they are, so an
# off-topic query would otherwise come back with three confident-looking
# "matches" and a synthesis built on them. This cuts those off instead.
#
# Empirical, measured against the live corpus with the current indexing
# (summary-only text, symmetric embeddings): realistic moderation queries peak
# at 0.505 for their nearest match, while off-topic queries bottom out at
# 0.602. 0.55 sits between the two.
#
# Both halves of that measurement depend on how cases are embedded -- re-measure
# after changing `_case_text` or the embedding call in embeddings.py.
#
# Public (imported by precedent_routes.py and returned to callers as
# `max_distance`) so consumers like the Discord bot can read the live cutoff
# instead of hardcoding a copy of it.
MAX_RELEVANT_DISTANCE = 0.55


def search_similar(
    embedding: list[float],
    limit: int = 3,
    players: list[str] | None = None,
    query_text: str = "",
) -> list[dict[str, Any]]:
    """Nearest-K search under the relevance cutoff, applying two soft boosts that
    only reorder rows already inside the cutoff (never exclude or bypass it):

    - `players`: rows whose `players` array overlaps (case-insensitively).
    - `query_text`: rows whose summary/rule/ruling/punishment lexically contain
      any word from the query (Postgres full-text search, OR'd word-by-word).
      This exists because embedding distance alone can rank a short,
      exact-wording case (e.g. a one-line "Xray" summary) below a longer,
      only-thematically-related one for a query like "player xraying" -- the
      literal word match rescues it into the top-`limit` slots it would
      otherwise lose on distance alone. Words are OR'd (any one word matching
      is enough), not AND'd, so a short summary matching only "xray" out of
      "player xraying" still gets boosted.

    An empty/typo'd `players` or `query_text` degrades to pure distance order.
    """
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            lowered = [p.strip().lower() for p in (players or []) if p.strip()]
            words = [w for w in re.findall(r"\w+", query_text or "") if len(w) > 2]
            cur.execute(
                """
                SELECT id, logged_by, players, summary, rule, ruling, punishment,
                       created_at, embedding <=> %s::vector AS distance
                FROM precedent_cases
                WHERE embedding <=> %s::vector < %s
                ORDER BY
                    (EXISTS (
                        SELECT 1 FROM unnest(players) AS p WHERE lower(p) = ANY(%s::text[])
                    )) DESC,
                    (EXISTS (
                        SELECT 1 FROM unnest(%s::text[]) AS w
                        WHERE to_tsvector(
                                  'english',
                                  summary || ' ' || rule || ' ' || ruling || ' ' || punishment
                              ) @@ plainto_tsquery('english', w)
                    )) DESC,
                    embedding <=> %s::vector
                LIMIT %s
                """,
                (
                    embedding,
                    embedding,
                    MAX_RELEVANT_DISTANCE,
                    lowered,
                    words,
                    embedding,
                    limit,
                ),
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def list_cases(limit: int = 500, offset: int = 0) -> list[dict[str, Any]]:
    """Newest-first page of the whole corpus. Plain SELECT: no embedding, no Voyage cost.

    Deliberately not built on search_similar, which caps at MAX_RELEVANT_DISTANCE
    and only ever returns a handful of rows.
    """
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, logged_by, players, summary, rule, ruling, punishment, created_at
                FROM precedent_cases
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def count_cases() -> int:
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM precedent_cases")
            row = cur.fetchone()
            return int(row[0]) if row else 0
    finally:
        conn.close()


def update_case(
    case_id: str,
    *,
    logged_by: str,
    players: list[str],
    summary: str,
    rule: str,
    ruling: str,
    punishment: str,
    embedding: list[float],
    actor: AuditActor | None = None,
    audit_action: str = "update",
) -> bool:
    """Full-row replace. Returns False if the id is absent.

    `audit_action` lets a caller distinguish an ordinary edit from an undo; the
    revert script passes "revert" so the trail shows what happened rather than
    looking like another manual edit.

    The caller must pass a freshly computed embedding: the case text is what
    search_similar matches on, so persisting edited text against a stale vector
    would leave the row unfindable by the wording it now contains.
    """
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Lock and snapshot the row first: the audit trail needs the state
            # being replaced, and FOR UPDATE stops a concurrent edit landing
            # between the read and the write.
            cur.execute(
                """
                SELECT logged_by, players, summary, rule, ruling, punishment
                FROM precedent_cases WHERE id = %s FOR UPDATE
                """,
                (case_id,),
            )
            before = _snapshot(cur.fetchone())
            if before is None:
                return False

            after = {
                "logged_by": logged_by,
                "players": list(players),
                "summary": summary,
                "rule": rule,
                "ruling": ruling,
                "punishment": punishment,
            }
            cur.execute(
                """
                UPDATE precedent_cases
                SET logged_by = %s, players = %s, summary = %s, rule = %s,
                    ruling = %s, punishment = %s, embedding = %s
                WHERE id = %s
                RETURNING id
                """,
                (logged_by, players, summary, rule, ruling, punishment, embedding, case_id),
            )
            if cur.fetchone() is None:
                return False
            _write_audit(
                cur,
                case_id=case_id,
                action=audit_action,
                actor=actor,
                before=before,
                after=after,
            )
            return True
    finally:
        conn.close()


def delete_case(case_id: str, actor: AuditActor | None = None) -> bool:
    """Delete a case by id. Returns True if a row was deleted, False if not found.

    RETURNING gives the deleted content back in the same statement, so the audit
    entry keeps a full copy of what was destroyed -- the only remaining record
    of it once the case row is gone.
    """
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                DELETE FROM precedent_cases WHERE id = %s
                RETURNING logged_by, players, summary, rule, ruling, punishment,
                          created_at
                """,
                (case_id,),
            )
            row = cur.fetchone()
            before = _snapshot(row)
            if before is None:
                return False
            # Only deletes carry created_at: without it a restored case would be
            # stamped with the restore date, losing the original ordering. Never
            # let a missing timestamp turn a delete into an error -- restore
            # falls back to now() for that case.
            created = row.get("created_at")
            if created is not None:
                before["created_at"] = created.isoformat()
            _write_audit(
                cur,
                case_id=case_id,
                action="delete",
                actor=actor,
                before=before,
            )
            return True
    finally:
        conn.close()


def list_deleted_cases(since: str | None = None) -> list[dict[str, Any]]:
    """Deleted cases that are not currently present, newest deletion first.

    Reads the audit trail, which keeps a full snapshot of every deleted case.
    Rows whose id has since been re-created are skipped so a restore cannot
    clobber a live case.
    """
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT a.id AS audit_id, a.case_id, a.actor, a.source,
                       a.created_at AS deleted_at, a.before
                FROM precedent_audit a
                WHERE a.action = 'delete'
                  AND (%s IS NULL OR a.created_at >= %s::timestamptz)
                  AND NOT EXISTS (
                      SELECT 1 FROM precedent_cases c WHERE c.id = a.case_id
                  )
                ORDER BY a.id DESC
                """,
                (since, since),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def list_audit_entries(
    case_id: str | None = None,
    action: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Recent audit entries, newest first. Backend/tooling only, never exposed."""
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, case_id, action, source, actor, actor_uuid,
                       before, after, created_at
                FROM precedent_audit
                WHERE (%s IS NULL OR case_id = %s::uuid)
                  AND (%s IS NULL OR action = %s)
                ORDER BY id DESC
                LIMIT %s
                """,
                (case_id, case_id, action, action, limit),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def restore_case(
    case_id: str,
    *,
    snapshot: dict[str, Any],
    embedding: list[float],
    actor: AuditActor | None = None,
) -> bool:
    """Re-insert a deleted case under its original id.

    Keeps the original id and created_at so links and ordering survive. Returns
    False if a case with that id already exists, rather than overwriting it.
    """
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO precedent_cases
                    (id, logged_by, players, summary, rule, ruling, punishment,
                     embedding, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                        COALESCE(%s::timestamptz, now()))
                ON CONFLICT (id) DO NOTHING
                RETURNING id
                """,
                (
                    case_id,
                    snapshot.get("logged_by", ""),
                    list(snapshot.get("players") or []),
                    snapshot.get("summary", ""),
                    snapshot.get("rule", ""),
                    snapshot.get("ruling", ""),
                    snapshot.get("punishment", ""),
                    embedding,
                    snapshot.get("created_at"),
                ),
            )
            if cur.fetchone() is None:
                return False
            _write_audit(
                cur,
                case_id=case_id,
                action="restore",
                actor=actor,
                after=_snapshot_from_dict(snapshot),
            )
            return True
    finally:
        conn.close()


def _snapshot_from_dict(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        k: (list(snapshot.get(k) or []) if k == "players" else snapshot.get(k, ""))
        for k in _AUDIT_FIELDS
    }


def get_case(case_id: str) -> dict[str, Any] | None:
    conn = _connect()
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, logged_by, players, summary, rule, ruling, punishment, created_at
                FROM precedent_cases WHERE id = %s
                """,
                (case_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def ping_db() -> None:
    """Cheap reachability check: connect and run SELECT 1. No embedding/Claude cost."""
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
    finally:
        conn.close()
