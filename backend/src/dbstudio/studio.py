"""Root's database studio: list, browse and query the site's databases.

Three sources, each shown only when this site has it:

- site: province.db (accounts, characters, wardrobes, chronicle and ledger
  indexes, the staff audit log). Root may write it, except the audit log.
- coreprotect: this site's CoreProtect SQLite, read through the guarded
  reader (one reader at a time, a short budget) and never written: the
  server writes it, and the site mounts it read-only.
- postgres: the site's Postgres database holding Precedent and patch notes.

Reads use connections that cannot write (SQLite mode=ro with query_only,
Postgres read-only transactions). Each request runs one statement, enforced by
the database itself: Python's sqlite3 refuses a second statement, and Postgres
statements go through the extended protocol, which refuses several commands.
The text check in _check() is a second layer with clearer messages. Every
result stops at MAX_ROWS and every statement has a time limit. Secret-looking text values are masked in
results; that only keeps them off the screen, it is not access control.
"""
from __future__ import annotations

import os
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import psycopg

from src.coreprotect import reader as coreprotect
from src.skins import db as site_db

MAX_ROWS = 1000
MAX_SQL = 20_000
MAX_PAGE = 500
SITE_SECONDS = 10.0
COREPROTECT_SECONDS = 3.0
POSTGRES_TIMEOUT = "10s"
# Matched against result column names; only text values are masked.
SECRET = re.compile(r"(^|_)(token|secret|password|nonce)(_|$)|api_?key", re.IGNORECASE)
MASK = "••••••"
# JavaScript loses integer precision past 2^53, so larger ones travel as text.
SAFE_INTEGER = 2 ** 53 - 1
# The audit log is append-only by trigger; this also stops dropping it or its triggers.
PROTECTED = "admin_audit"
# Statements the studio never runs. Transaction and session control would let a read
# leave its read-only transaction or end an edit early; VACUUM INTO and COPY write files.
REFUSED = {"BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE", "PREPARE",
           "SET", "RESET", "DISCARD", "VACUUM", "ATTACH", "DETACH", "COPY"}
# Postgres reads run through a server-side cursor, which only takes a query.
POSTGRES_READS = {"SELECT", "WITH", "VALUES", "TABLE"}
# SQLite pragmas a read may call with an argument; they only describe the schema.
INFO_PRAGMAS = {"table_info", "table_xinfo", "index_list", "index_info", "index_xinfo", "foreign_key_list"}


class StudioError(Exception):
    def __init__(self, code: str, status: int = 400, message: str = ""):
        super().__init__(code)
        self.code, self.status, self.message = code, status, message


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    engine: str
    writable: bool
    detail: str


@dataclass
class Result:
    columns: list[str]
    rows: list[list]
    truncated: bool
    changes: int | None
    elapsed_ms: int

    def json(self) -> dict:
        return {"columns": self.columns, "rows": self.rows, "truncated": self.truncated,
                "changes": self.changes, "elapsed_ms": self.elapsed_ms, "limit": MAX_ROWS}


def sources() -> list[Source]:
    # PG-MIGRATION: until the database studio area converts, "site" is province.db. Accounts, the
    # audit log, characters, Discord links, codes, skins and drinks are in Postgres; their SQLite tables
    # are stale leftovers. The studio's PR moves this source to Postgres under the province_studio role.
    found = [Source("site", "Site", "sqlite", True,
                    "province.db: legacy tables. Characters, accounts, Discord links, skins, drinks, "
                    "chronicle and ledger are in Postgres; their tables here are stale")]
    config = coreprotect.CoreProtectConfig.from_env()
    if config.path:
        label = config.label or config.server.title()
        found.append(Source("coreprotect", f"CoreProtect · {label}", "sqlite", False,
                            "Blocks, containers, chat, commands and sessions. Read-only."))
    if os.environ.get("DATABASE_URL", "").strip():
        found.append(Source("postgres", "Precedent and patch notes", "postgres", True,
                            "The site's Postgres, public schema"))
    return found


def source(source_id: str) -> Source:
    for item in sources():
        if item.id == source_id:
            return item
    raise StudioError("unknown_database", 404)


# --------------------
# Values
# --------------------

def _cell(column: str, value):
    if value is None or isinstance(value, (bool, float)):
        return value
    if isinstance(value, int):
        return value if abs(value) <= SAFE_INTEGER else str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        data = bytes(value)
        return {"blob": len(data), "hex": data[:32].hex()}
    if isinstance(value, str):
        return MASK if value and SECRET.search(column) else value
    return str(value)


def _result(columns: list[str], rows, truncated: bool, changes: int | None, started: float) -> Result:
    return Result(columns, [[_cell(c, v) for c, v in zip(columns, row)] for row in rows], truncated,
                  changes, round((time.monotonic() - started) * 1000))


def quote_name(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


# --------------------
# Statement checks
# --------------------

def _code(sql: str, engine: str) -> str:
    """The SQL with comments, strings and quoted names blanked, so only code is left to inspect."""
    quotes = {"'": "'", '"': '"'} | ({"`": "`", "[": "]"} if engine == "sqlite" else {})
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            # Postgres also ends a line comment at a carriage return; SQLite only at a newline.
            ends = [k for k in (sql.find("\n", i), sql.find("\r", i) if engine == "postgres" else -1) if k >= 0]
            j = min(ends) if ends else n
        elif sql.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if engine == "postgres" and sql.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif sql.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
        elif c in quotes:
            close = quotes[c]
            # Postgres E'...' strings take backslash escapes.
            escapes = (engine == "postgres" and c == "'" and i > 0 and sql[i - 1] in "eE"
                       and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] == "_")))
            j = i + 1
            while j < n:
                if escapes and sql[j] == "\\":
                    j += 2
                elif sql[j] == close:
                    if close != "]" and sql.startswith(close * 2, j):
                        j += 2
                    else:
                        j += 1
                        break
                else:
                    j += 1
        elif (engine == "postgres" and c == "$" and not (i and (sql[i - 1].isalnum() or sql[i - 1] == "_"))
              and (tag := re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:]))):
            end = sql.find(tag[0], i + len(tag[0]))
            j = n if end < 0 else end + len(tag[0])
        else:
            out.append(c)
            i += 1
            continue
        out.append(" ")
        i = j
    return "".join(out)


def _check(sql: str, engine: str, write: bool) -> None:
    code = re.sub(r"[;\s]+$", "", _code(sql, engine))
    words = re.findall(r"[A-Za-z_]+", code.upper())
    if not words:
        raise StudioError("empty_query")
    first = words[0]
    if engine == "sqlite" and first == "CREATE" and "TRIGGER" in words[1:4]:
        raise StudioError("not_allowed", 403, "Triggers can’t be created from the studio.")
    if first in REFUSED:
        raise StudioError("not_allowed", 403, f"{first.title()} statements aren’t allowed in the studio.")
    if ";" in code:
        raise StudioError("one_statement", 400, "Run one statement at a time.")
    if engine == "postgres" and not write and first not in POSTGRES_READS:
        raise StudioError("read_only", 400, "Read mode runs queries (SELECT, WITH, VALUES, TABLE). "
                                            "Switch to Edit to change data.")


# --------------------
# SQLite
# --------------------

def _authorizer(write: bool):
    def check(action: int, first, second, *_):
        if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_TRANSACTION,
                      sqlite3.SQLITE_SAVEPOINT, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_CREATE_TEMP_TRIGGER):
            # A stored trigger would later run without this check, e.g. writing the audit log.
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_PRAGMA and (
            first == "writable_schema" or (second is not None and first not in INFO_PRAGMAS)
        ):
            return sqlite3.SQLITE_DENY
        if write and first == "sqlite_sequence" and action in (
            sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE,
        ):
            # A maxed-out counter would make every later audit insert fail.
            return sqlite3.SQLITE_DENY
        if write and PROTECTED in (first, second) and action in (
            sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_DROP_TABLE,
            sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_DROP_TRIGGER, sqlite3.SQLITE_CREATE_TRIGGER,
            # An index on the audit log could make every later audit insert fail.
            sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX,
        ):
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    return check


def _site(sql: str, *, write: bool = False) -> Result:
    path = Path(site_db.DB_PATH)
    if not path.is_file():
        raise StudioError("database_unavailable", 503)
    started = time.monotonic()
    deadline = started + SITE_SECONDS
    conn = sqlite3.connect(f"file:{quote(str(path))}?mode={'rw' if write else 'ro'}", uri=True,
                           isolation_level=None, timeout=5)
    try:
        conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        if write:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("BEGIN IMMEDIATE")
        else:
            conn.execute("PRAGMA query_only = 1")
        conn.set_authorizer(_authorizer(write))
        cursor = conn.execute(sql)
        columns = [d[0] for d in cursor.description or ()]
        rows = cursor.fetchmany(MAX_ROWS + 1) if cursor.description else []
        changes = conn.total_changes if write else None
        cursor.close()
        # The authorizer refuses transaction control, so lift it for the studio's own.
        conn.set_authorizer(None)
        if write:
            conn.execute("COMMIT")
        return _result(columns, rows[:MAX_ROWS], len(rows) > MAX_ROWS, changes, started)
    except sqlite3.Error as exc:
        conn.set_authorizer(None)
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise _sqlite_error(exc) from None
    finally:
        conn.close()


def _sqlite_error(exc: sqlite3.Error) -> StudioError:
    text = str(exc)
    if "interrupted" in text.lower():
        return StudioError("timeout", 408, "The query ran past its time limit and was stopped.")
    if "not authorized" in text.lower():
        return StudioError("not_allowed", 403, "That statement isn’t allowed here.")
    return StudioError("sql_error", 400, text)


def _coreprotect(sql: str) -> Result:
    started = time.monotonic()
    config = coreprotect.CoreProtectConfig.from_env()
    try:
        with coreprotect.Reader(config, coreprotect.Budget(COREPROTECT_SECONDS)) as r:
            columns, rows, truncated = r.query(sql, MAX_ROWS)
    except coreprotect.Unavailable as exc:
        if exc.code == "timeout":
            raise StudioError("timeout", 408, "CoreProtect queries stop after 3 seconds so the server can keep "
                                              "writing. Add a LIMIT or filter on an indexed column.") from None
        if exc.code == "busy":
            raise StudioError("busy", 409, "Another CoreProtect read is running. Try again.") from None
        if exc.code == "error" and exc.message:
            raise _sqlite_error(sqlite3.Error(exc.message)) from None
        raise StudioError("database_unavailable", 503) from None
    return _result(columns, rows, truncated, None, started)


# --------------------
# Postgres
# --------------------

def _postgres(sql: str, *, write: bool = False) -> Result:
    started = time.monotonic()
    try:
        # UTF-8 so the text Postgres parses is the text _check() inspected.
        conn = psycopg.connect(os.environ.get("DATABASE_URL", "").strip(), connect_timeout=5, client_encoding="utf8")
    except psycopg.OperationalError:
        raise StudioError("database_unavailable", 503) from None
    try:
        conn.read_only = not write
        conn.execute(f"SET LOCAL statement_timeout = '{POSTGRES_TIMEOUT}'")
        if write:
            # Pipeline mode sends the edit through the extended protocol as one unnamed
            # statement, so Postgres refuses several commands and keeps no prepared statement.
            with conn.pipeline():
                cursor = conn.execute(sql, prepare=False)
            columns = [d.name for d in cursor.description or ()]
            rows = cursor.fetchmany(MAX_ROWS + 1) if cursor.description else []
            changes = cursor.rowcount
            conn.commit()
        else:
            # A server-side cursor is DECLARE ... CURSOR FOR <query>, sent as one prepared
            # statement: Postgres takes one query and sends rows as they are fetched.
            with conn.cursor(name="studio") as cursor:
                cursor.itersize = MAX_ROWS + 1
                cursor.execute(sql)
                rows = cursor.fetchmany(MAX_ROWS + 1)
                columns = [d.name for d in cursor.description or ()]
                changes = None
            conn.rollback()
        return _result(columns, rows[:MAX_ROWS], len(rows) > MAX_ROWS, changes, started)
    except StudioError:
        conn.rollback()
        raise
    except psycopg.Error as exc:
        conn.rollback()
        if isinstance(exc, psycopg.errors.QueryCanceled):
            raise StudioError("timeout", 408, "The query ran past its time limit and was stopped.") from None
        if isinstance(exc, psycopg.errors.ReadOnlySqlTransaction):
            raise StudioError("read_only", 400, "This is a read query. Switch to Edit to change data.") from None
        raise StudioError("sql_error", 400, (exc.diag.message_primary or str(exc)).strip()) from None
    finally:
        conn.close()


# --------------------
# What the routes call
# --------------------

def run(source_id: str, sql: str, *, write: bool = False) -> Result:
    item = source(source_id)
    sql = sql.strip()
    if not sql:
        raise StudioError("empty_query")
    if len(sql) > MAX_SQL:
        raise StudioError("query_too_long")
    if write and not item.writable:
        raise StudioError("read_only_database", 403)
    _check(sql, item.engine, write)
    if item.id == "site":
        return _site(sql, write=write)
    if item.id == "coreprotect":
        return _coreprotect(sql)
    return _postgres(sql, write=write)


SQLITE_SCHEMA = """
SELECT m.name, m.type, p.name, p.type, p."notnull", p.pk
FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p
WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid
"""

POSTGRES_SCHEMA = """
SELECT c.relname, CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END,
       a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)),
       GREATEST(c.reltuples, 0)::bigint
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY c.relname, a.attnum
"""


def schema(source_id: str, *, counts: bool = True) -> dict:
    """Tables and views with their columns and a rough row count (None when unknown)."""
    item = source(source_id)
    tables: dict[str, dict] = {}
    if item.engine == "postgres":
        for name, kind, column, kind_of, notnull, pk, rows in run(item.id, POSTGRES_SCHEMA).rows:
            table = tables.setdefault(name, {"name": name, "kind": kind, "rows": rows if kind == "table" else None,
                                             "columns": []})
            table["columns"].append({"name": column, "type": kind_of, "notnull": bool(notnull), "pk": bool(pk)})
        return {"tables": list(tables.values())}
    for name, kind, column, kind_of, notnull, pk in run(item.id, SQLITE_SCHEMA).rows:
        table = tables.setdefault(name, {"name": name, "kind": kind, "rows": None, "columns": []})
        table["columns"].append({"name": column, "type": kind_of or "", "notnull": bool(notnull), "pk": bool(pk)})
    names = [t["name"] for t in tables.values() if t["kind"] == "table"] if counts else []
    if names:
        # max(rowid) is one index probe, so it stays cheap on CoreProtect's largest tables.
        probes = " UNION ALL ".join(
            f"SELECT {i}, (SELECT coalesce(max(rowid), 0) FROM {quote_name(name)})" for i, name in enumerate(names))
        try:
            for i, rows in run(item.id, probes).rows:
                tables[names[i]]["rows"] = rows
        except StudioError:
            pass  # A WITHOUT ROWID table has no rowid; the counts stay unknown.
    return {"tables": list(tables.values())}


def browse(source_id: str, table: str, *, offset: int = 0, limit: int = 100, order: str | None = None,
           descending: bool = False, where: str = "") -> dict:
    known = {t["name"]: t for t in schema(source_id, counts=False)["tables"]}
    if table not in known:
        raise StudioError("unknown_table", 404)
    if order is not None and order not in {c["name"] for c in known[table]["columns"]}:
        raise StudioError("unknown_column")
    limit = max(1, min(limit, MAX_PAGE))
    offset = max(0, offset)
    sql = f"SELECT * FROM {quote_name(table)}"
    if where.strip():
        sql += f" WHERE {where.strip()}"
    if order:
        sql += f" ORDER BY {quote_name(order)} {'DESC' if descending else 'ASC'}"
    sql += f" LIMIT {limit} OFFSET {offset}"
    return {**run(source_id, sql).json(), "sql": sql}


def overview(query_counts: dict[str, int] | None = None) -> dict:
    counts = query_counts or {}
    databases = []
    for item in sources():
        entry = {"id": item.id, "name": item.name, "engine": item.engine, "writable": item.writable,
                 "detail": item.detail, "queries": counts.get(item.id, 0), "available": True,
                 "tables": None, "size_bytes": None}
        try:
            entry.update(_measure(item))
        except StudioError as exc:
            entry.update(available=False, error=exc.code)
        databases.append(entry)
    return {"databases": databases}


def _measure(item: Source) -> dict:
    if item.engine == "postgres":
        [[tables, size]] = run(item.id, """
            SELECT count(*), coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            WHERE c.relkind IN ('r', 'p', 'v', 'm')""").rows
        return {"tables": tables, "size_bytes": size}
    [[tables]] = run(item.id, "SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'view') "
                              "AND name NOT LIKE 'sqlite_%'").rows
    path = Path(site_db.DB_PATH if item.id == "site" else coreprotect.CoreProtectConfig.from_env().path or "")
    size = sum(p.stat().st_size for p in (path, path.with_name(path.name + "-wal")) if p.is_file())
    return {"tables": tables, "size_bytes": size}
