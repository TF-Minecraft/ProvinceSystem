"""Postgres storage for precedent cases (pgvector similarity search)."""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from psycopg import Cursor
from psycopg.types.string import TextLoader

from src import database
from src.database import Jsonb

logger = logging.getLogger("precedent.db")

_MIGRATED = False


class PrecedentDBError(RuntimeError):
    """Raised when the precedent database is not reachable or not configured."""


class PrecedentNotConfiguredError(PrecedentDBError):
    """Raised when this site has no precedent database (DATABASE_URL unset)."""


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
            Jsonb(before) if before is not None else None,
            Jsonb(after) if after is not None else None,
        ),
    )


@contextmanager
def _connect() -> Iterator[database.Connection]:
    """One transaction on a pooled site connection.

    Embeddings go in as pgvector text (see `vector_literal`); nothing reads a
    vector back, so no vector adapter is needed.
    """
    try:
        # Checked on every call, as before the pool: the pool keeps its first URL.
        database.database_url()
    except database.NotConfiguredError as e:
        raise PrecedentNotConfiguredError("DATABASE_URL is not set") from e
    connected = False
    try:
        with database.connect() as conn:
            connected = True
            yield conn
    except database.OperationalError as e:
        if connected:
            raise
        raise PrecedentDBError(f"Could not connect to precedent DB: {e}") from e


def vector_literal(embedding: list[float]) -> str:
    """`[0.1,0.2,...]`, the text form of a pgvector `vector`.

    psycopg cannot send a list that mixes ints and floats, which a JSON
    embedding can (`0` for a zero component), so vectors travel as text.
    """
    return "[" + ",".join(str(float(value)) for value in embedding) + "]"


def _cursor(conn: database.Connection) -> Cursor:
    """A dict-row cursor that reads uuid columns as str, as callers and audit snapshots expect."""
    cur = conn.cursor()
    cur.adapters.register_loader("uuid", TextLoader)
    return cur


def migrate() -> None:
    """Create the pgvector extension + precedent_cases table if missing. No-op once done."""
    global _MIGRATED
    if _MIGRATED:
        return
    if not os.environ.get("DATABASE_URL", "").strip():
        logger.warning("DATABASE_URL unset; precedent DB migration skipped")
        return
    with _connect() as conn, _cursor(conn) as cur:
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
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO precedent_cases
                (logged_by, players, summary, rule, ruling, punishment, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (logged_by, players, summary, rule, ruling, punishment, vector_literal(embedding)),
        )
        row = cur.fetchone()
        case_id = str(row["id"])
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
    with _connect() as conn, _cursor(conn) as cur:
        lowered = [p.strip().lower() for p in (players or []) if p.strip()]
        words = [w for w in re.findall(r"\w+", query_text or "") if len(w) > 2]
        vector = vector_literal(embedding)
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
                vector,
                vector,
                MAX_RELEVANT_DISTANCE,
                lowered,
                words,
                vector,
                limit,
            ),
        )
        return [dict(row) for row in cur.fetchall()]


# Every field a staff member might filter on, as one string. Players are
# space-joined so a name matches wherever it sits in the list.
_CASE_HAYSTACK = (
    "concat_ws(' ', summary, rule, ruling, punishment, logged_by, array_to_string(players, ' '))"
)


def _like_term(term: str) -> str:
    """`%term%` for ILIKE, with the pattern characters in `term` matched literally."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def list_cases(limit: int = 500, offset: int = 0, query: str = "") -> tuple[list[dict[str, Any]], int]:
    """Newest-first page of the corpus and how many cases match in all.

    `query` narrows the whole corpus, not just this page: every word in it must
    appear somewhere in the case's text, rule, ruling, punishment, logger or
    players, ignoring case. Plain SELECTs on one connection: no embedding, no
    Voyage cost.

    Deliberately not built on search_similar, which caps at MAX_RELEVANT_DISTANCE
    and only ever returns a handful of rows.
    """
    terms = [_like_term(t) for t in query.split()]
    where = " AND ".join([f"{_CASE_HAYSTACK} ILIKE %s"] * len(terms)) or "TRUE"
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute(
            f"""
            SELECT id, logged_by, players, summary, rule, ruling, punishment, created_at
            FROM precedent_cases
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (*terms, limit, offset),
        )
        rows = [dict(row) for row in cur.fetchall()]
        cur.execute(f"SELECT count(*) AS total FROM precedent_cases WHERE {where}", terms)
        row = cur.fetchone()
        return rows, int(row["total"]) if row else 0


def known_players() -> list[str]:
    """Every player name in the corpus, once each ignoring case, in its newest spelling."""
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (lower(name)) name
            FROM (
                SELECT btrim(p) AS name, created_at
                FROM precedent_cases, unnest(players) AS p
            ) named
            WHERE name <> ''
            ORDER BY lower(name), created_at DESC
            """
        )
        return [row["name"] for row in cur.fetchall()]


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
    with _connect() as conn, _cursor(conn) as cur:
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
            (logged_by, players, summary, rule, ruling, punishment, vector_literal(embedding), case_id),
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


def delete_case(case_id: str, actor: AuditActor | None = None) -> bool:
    """Delete a case by id. Returns True if a row was deleted, False if not found.

    RETURNING gives the deleted content back in the same statement, so the audit
    entry keeps a full copy of what was destroyed -- the only remaining record
    of it once the case row is gone.
    """
    with _connect() as conn, _cursor(conn) as cur:
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


def list_deleted_cases(since: str | None = None) -> list[dict[str, Any]]:
    """Deleted cases that are not currently present, newest deletion first.

    Reads the audit trail, which keeps a full snapshot of every deleted case.
    Rows whose id has since been re-created are skipped so a restore cannot
    clobber a live case.
    """
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute(
            """
            SELECT a.id AS audit_id, a.case_id, a.actor, a.source,
                   a.created_at AS deleted_at, a.before
            FROM precedent_audit a
            WHERE a.action = 'delete'
              AND (%s::timestamptz IS NULL OR a.created_at >= %s::timestamptz)
              AND NOT EXISTS (
                  SELECT 1 FROM precedent_cases c WHERE c.id = a.case_id
              )
            ORDER BY a.id DESC
            """,
            (since, since),
        )
        return [dict(r) for r in cur.fetchall()]


def list_audit_entries(
    case_id: str | None = None,
    action: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Recent audit entries, newest first. Backend/tooling only, never exposed."""
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute(
            """
            SELECT id, case_id, action, source, actor, actor_uuid,
                   before, after, created_at
            FROM precedent_audit
            WHERE (%s::uuid IS NULL OR case_id = %s::uuid)
              AND (%s::text IS NULL OR action = %s)
            ORDER BY id DESC
            LIMIT %s
            """,
            (case_id, case_id, action, action, limit),
        )
        return [dict(r) for r in cur.fetchall()]


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
    with _connect() as conn, _cursor(conn) as cur:
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
                vector_literal(embedding),
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


def _snapshot_from_dict(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        k: (list(snapshot.get(k) or []) if k == "players" else snapshot.get(k, ""))
        for k in _AUDIT_FIELDS
    }


def get_case(case_id: str) -> dict[str, Any] | None:
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute(
            """
            SELECT id, logged_by, players, summary, rule, ruling, punishment, created_at
            FROM precedent_cases WHERE id = %s
            """,
            (case_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def ping_db() -> None:
    """Cheap reachability check: connect and run SELECT 1. No embedding/Claude cost."""
    with _connect() as conn, _cursor(conn) as cur:
        cur.execute("SELECT 1")
