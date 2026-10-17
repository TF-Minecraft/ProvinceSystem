"""Copy site data between SQLite and Postgres, with verification and rollback.

Run from backend/; DATABASE_URL may replace --database-url. Stop the backend
before either copy. Precedent and patch notes are outside this tool's tables.

    python -m src.scripts.tools.copy_province_db to-postgres --sqlite province.db
    python -m src.scripts.tools.copy_province_db to-postgres --sqlite province.db --verify-only
    python -m src.scripts.tools.copy_province_db to-sqlite --sqlite rollback.db

The import validates every source value before migrations or row writes. It
requires empty site tables, loads and verifies in one transaction, and preserves
AUTOINCREMENT high-water marks. Rollback publishes a new SQLite file only after
verification. Neither direction overwrites a source or an existing SQLite file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, DecimalException, ROUND_HALF_EVEN
from pathlib import Path
from urllib.parse import quote

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src import database
from src.database import migrate as migrations

LEGACY_SCHEMA = Path(__file__).resolve().parents[2] / "database" / "legacy_sqlite.sql"
_TABLE = re.compile(r"CREATE TABLE (\w+) \(\n(.*?)^\);", re.M | re.S)
_COLUMN = re.compile(r'^\s+"?(\w+)"? (double precision|timestamptz|bigint|integer|boolean|jsonb|text)\b(.*)$', re.M)
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|\+00:00)\Z")
_KINDS = {"timestamp with time zone": "timestamptz"}
_OPTIONS = "-c search_path=public -c TimeZone=UTC -c lock_timeout=5s -c statement_timeout=60s"
# Retired before the current SQLite schema; no runtime reader or writer remains.
_LEGACY_COLUMNS = {"discord_links": {"player_key"}}
# Generated from the migrations on PG17. Refresh with _native_fingerprint when
# intentionally changing the copy schema; the rollback shape must stay compatible.
_NATIVE_SCHEMA_SHA256 = "9e2b64f0cdbf823714636271a028150505be575897c4449f5d2e1a26e9dbe60e"


class CopyError(RuntimeError):
    pass


@dataclass(frozen=True)
class Column:
    name: str
    kind: str
    required: bool
    identity: bool = False


@dataclass(frozen=True)
class Table:
    name: str
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]
    parents: frozenset[str]


@dataclass(frozen=True)
class JsonValue:
    raw: str
    canonical: str
    ordered: str


@dataclass
class Source:
    rows: dict[str, list[tuple[int, tuple]]]
    sequences: dict[str, int]
    legacy: list[str]
    rounded_rows: int = 0
    discarded_microsoft_states: int = 0
    legacy_columns: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class Check:
    table: str
    source_rows: int
    target_rows: int
    source_sha256: str
    target_sha256: str

    @property
    def matches(self) -> bool:
        return self.source_rows == self.target_rows and self.source_sha256 == self.target_sha256


@dataclass
class Report:
    checks: list[Check]
    legacy: list[str]
    rounded_rows: int
    discarded_microsoft_states: int


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def specifications() -> list[Table]:
    """The frozen rollback shape and the native types declared by migrations."""
    native = {}
    for migration in migrations.discover():
        for name, body in _TABLE.findall(migration.sql):
            native[name] = {name: (kind, "GENERATED" in rest) for name, kind, rest in _COLUMN.findall(body)}
    with closing(sqlite3.connect(":memory:")) as legacy:
        legacy.executescript(LEGACY_SCHEMA.read_text(encoding="utf-8"))
        names = {row[0] for row in legacy.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence'"
        )}
        if names != set(native):
            raise CopyError("the migration tables no longer match the offline rollback schema")
        tables = []
        for name in sorted(names):
            info = legacy.execute(f"PRAGMA table_info({_quote(name)})").fetchall()
            if {row[1] for row in info} != set(native[name]):
                raise CopyError(f"{name}: the native and rollback columns differ")
            columns = tuple(Column(row[1], native[name][row[1]][0], bool(row[3] or row[5]),
                                   native[name][row[1]][1]) for row in info)
            primary = tuple(row[1] for row in sorted(info, key=lambda row: row[5]) if row[5])
            parents = frozenset(row[2] for row in legacy.execute(f"PRAGMA foreign_key_list({_quote(name)})"))
            tables.append(Table(name, columns, primary, parents))
    ordered: list[Table] = []
    while tables:
        ready = [table for table in tables if table.parents <= {t.name for t in ordered}]
        if not ready:
            raise CopyError("the site schema has a foreign-key cycle")
        ordered.extend(ready)
        tables = [table for table in tables if table not in ready]
    return ordered


def _text(value) -> str:
    if not isinstance(value, str):
        raise ValueError("expected text")
    value.encode("utf-8", errors="strict")
    if "\x00" in value:
        raise ValueError("NUL is not representable in Postgres")
    return value


def _json_text(value, *, canonical: bool) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(_text(key), ensure_ascii=False) + ":" +
                              _json_text(value[key], canonical=canonical) for key in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_json_text(item, canonical=canonical) for item in value) + "]"
    if isinstance(value, Decimal):
        if (not value.is_finite() or (value and value.adjusted() >= 131072)
                or value.as_tuple().exponent < -16383):
            raise ValueError("JSON number is outside Postgres numeric limits")
        text = format(value, "f")
        if canonical:
            if not value:
                return "0"
            if "." in text:
                text = text.rstrip("0").rstrip(".")
        return text
    if isinstance(value, str):
        value = _text(value)
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _json(value) -> JsonValue:
    raw = _text(value)

    def refuse_constant(_):
        raise ValueError("non-finite JSON number")

    def number(raw):
        # Postgres bounds the written exponent before applying fractional scale,
        # even for zero, which otherwise has no integer-digit limit.
        exponent = raw.lower().partition("e")[2]
        if exponent and abs(int(exponent)) >= (1 << 30):
            raise ValueError("JSON number is outside Postgres numeric limits")
        return Decimal(raw)

    def validate_member(value):
        if isinstance(value, list):
            for item in value:
                validate_member(item)
        elif not isinstance(value, dict):
            # Nested objects have already passed object_members. Do not lose an
            # invalid earlier value when JSONB keeps the last duplicate key.
            _json_text(value, canonical=True)

    def object_members(pairs):
        for key, value in pairs:
            _text(key)
            validate_member(value)
        return dict(pairs)

    parsed = json.loads(raw, parse_int=Decimal, parse_float=number, parse_constant=refuse_constant,
                        object_pairs_hook=object_members)
    return JsonValue(raw, _json_text(parsed, canonical=True), _json_text(parsed, canonical=False))


def _timestamp(value) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("timestamp has no UTC offset")
        return value.astimezone(timezone.utc)
    match = _TIME.fullmatch(_text(value))
    if not match:
        raise ValueError("expected an ISO UTC timestamp (at most nanoseconds)")
    base = datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    fraction = match[1] or "0"
    micros = int((Decimal("0." + fraction) * 1_000_000).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))
    return base + timedelta(microseconds=micros)


def _value(column: Column, value):
    if value is None:
        if column.required:
            raise ValueError("NULL in a required column")
        return None
    if column.kind == "text":
        return _text(value)
    if column.kind == "timestamptz":
        return _timestamp(value)
    if column.kind == "jsonb":
        return _json(value)
    if column.kind == "boolean":
        if not isinstance(value, (int, bool)) or value not in (0, 1):
            raise ValueError("expected a 0/1 flag")
        return bool(value)
    if column.kind in {"bigint", "integer"}:
        bits = 64 if column.kind == "bigint" else 32
        if type(value) is not int or not -(2 ** (bits - 1)) <= value < 2 ** (bits - 1):
            raise ValueError(f"expected a signed {bits}-bit integer")
        return value
    if column.kind == "double precision":
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("expected a finite number")
        return float(value)
    raise ValueError("unsupported native column type")


def _typed(table: Table, rowid, values) -> tuple:
    out = []
    for column, value in zip(table.columns, values):
        try:
            out.append(_value(column, value))
        except (ValueError, TypeError, OverflowError, RecursionError, DecimalException) as exc:
            # Location is useful; the actual value may contain credentials.
            reason = str(exc) if type(exc) is ValueError else f"invalid {column.kind}"
            raise CopyError(f"{table.name} rowid {rowid}, column {column.name}: {reason}") from None
    return tuple(out)


def _open_sqlite(path: Path):
    conn = sqlite3.connect(f"file:{quote(str(path.resolve()))}?mode=ro", uri=True)
    conn.text_factory = lambda raw: raw.decode("utf-8", errors="surrogateescape")
    conn.execute("BEGIN")
    return conn


def _source(conn: sqlite3.Connection, tables: list[Table]) -> Source:
    integrity = conn.execute("PRAGMA integrity_check").fetchall()
    if integrity != [("ok",)]:
        raise CopyError("SQLite integrity_check failed")
    foreign = conn.execute("PRAGMA foreign_key_check").fetchone()
    if foreign:
        raise CopyError(f"{foreign[0]} rowid {foreign[1]}: foreign_key_check failed")
    names = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence'"
    )}
    expected = {table.name for table in tables}
    if missing := expected - names:
        raise CopyError(f"SQLite is missing site tables: {', '.join(sorted(missing))}")
    sequences = {}
    for name, high_water in conn.execute("SELECT name, seq FROM sqlite_sequence"):
        if name in sequences:
            raise CopyError("sqlite_sequence: duplicate counter names")
        sequences[name] = high_water
    source = Source({}, sequences, sorted(names - expected))
    for table in tables:
        info = conn.execute(f"PRAGMA table_xinfo({_quote(table.name)})").fetchall()
        actual = {row[1] for row in info}
        wanted = {c.name for c in table.columns}
        extra = actual - wanted
        if wanted - actual or extra - _LEGACY_COLUMNS.get(table.name, set()) or any(row[6] for row in info):
            raise CopyError(f"{table.name}: source columns do not match the rollback schema")
        if extra:
            source.legacy_columns[table.name] = tuple(sorted(extra))
        columns = ", ".join(_quote(c.name) for c in table.columns)
        rows = []
        for row in conn.execute(f"SELECT rowid, {columns} FROM {_quote(table.name)}"):
            values = _typed(table, row[0], row[1:])
            if any(c.kind == "timestamptz" and isinstance(v, str) and
                   (m := _TIME.fullmatch(v)) and len(m[1] or "") > 6 for c, v in zip(table.columns, row[1:])):
                source.rounded_rows += 1
            rows.append((row[0], values))
        if table.name == "microsoft_link_states":
            user = next(i for i, c in enumerate(table.columns) if c.name == "user_id")
            newest = {values[user]: rowid for rowid, values in sorted(rows)}
            kept = [(rowid, values) for rowid, values in rows if rowid == newest[values[user]]]
            source.discarded_microsoft_states = len(rows) - len(kept)
            rows = kept
        source.rows[table.name] = rows
    _new_constraints(source, tables)
    return source


def _new_constraints(source: Source, tables: list[Table]) -> None:
    rules = {
        "patreon_alerts": (("kind",), lambda row: row["acked_at"] is None),
        "will_requests": (("realm_id", "character_id"), lambda row: row["status"] == "pending"),
        "lp_changes": (("target_type", "target"), lambda row: row["status"] in {"pending", "sent"}),
    }
    for table in tables:
        seen = set()
        for rowid, values in source.rows[table.name]:
            row = dict(zip((c.name for c in table.columns), values))
            if table.name == "discord_links" and row["player_uuid"] != row["player_uuid"].lower():
                raise CopyError(f"discord_links rowid {rowid}, column player_uuid: expected lower case")
            if table.name not in rules:
                continue
            keys, applies = rules[table.name]
            if applies(row):
                key = tuple(row[name] for name in keys)
                if key in seen:
                    raise CopyError(f"{table.name} rowid {rowid}: duplicate open rows for {','.join(keys)}")
                seen.add(key)


def _require_current(conn, tables: list[Table]) -> None:
    expected = {m.version: m.checksum for m in migrations.discover()}
    try:
        actual = {r["version"]: r["checksum"] for r in conn.execute("SELECT version, checksum FROM schema_migrations")}
    except psycopg.errors.UndefinedTable:
        raise CopyError("the target needs the current site migrations") from None
    if actual != expected:
        raise CopyError("the target's migration history does not match the current files")
    for table in tables:
        columns = conn.execute(
            "SELECT column_name, data_type, is_nullable, is_identity FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position", (table.name,),
        ).fetchall()
        actual = [(c["column_name"], _KINDS.get(c["data_type"], c["data_type"]),
                   c["is_nullable"] == "NO", c["is_identity"] == "YES") for c in columns]
        expected_columns = [(c.name, c.kind, c.required, c.identity) for c in table.columns]
        if actual != expected_columns:
            raise CopyError(f"{table.name}: native schema no longer matches the rollback shape")
    if _native_fingerprint(conn, tables) != _NATIVE_SCHEMA_SHA256:
        raise CopyError("native schema defaults, constraints, indexes, triggers or sequences differ from the copy schema")


def _native_fingerprint(conn, tables: list[Table]) -> str:
    """Migration-owned definitions and enforcement state, without physical OIDs."""
    site = ("WITH site AS (SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relname = ANY(%s)) ")
    queries = {
        "tables": "SELECT relname, relkind::text, relpersistence::text, relrowsecurity, relforcerowsecurity FROM site",
        "columns": """
            SELECT c.relname, a.attname, a.attnum, format_type(a.atttypid, a.atttypmod) AS type,
                   a.attnotnull, a.attidentity::text, a.attgenerated::text,
                   cn.nspname AS collation_schema, co.collname, pg_get_expr(d.adbin, d.adrelid) AS default_expr
            FROM site c JOIN pg_attribute a ON a.attrelid = c.oid
            LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
            LEFT JOIN pg_collation co ON co.oid = a.attcollation
            LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
            WHERE a.attnum > 0 AND NOT a.attisdropped
        """,
        "constraints": """
            SELECT c.relname, k.conname, k.contype::text, k.convalidated, k.condeferrable, k.condeferred,
                   pg_get_constraintdef(k.oid, false) AS definition
            FROM site c JOIN pg_constraint k ON k.conrelid = c.oid
        """,
        "indexes": """
            SELECT c.relname, pg_get_indexdef(i.indexrelid, 0, false) AS definition,
                   i.indisvalid, i.indisready, i.indislive, i.indisunique, i.indisprimary,
                   i.indisexclusion, i.indimmediate, i.indnullsnotdistinct
            FROM site c JOIN pg_index i ON i.indrelid = c.oid
        """,
        "triggers": """
            SELECT c.relname, t.tgisinternal, t.tgenabled::text, t.tgtype, t.tgdeferrable, t.tginitdeferred,
                   k.conname, other.relname AS related_table, other_ns.nspname AS related_schema,
                   p.proname, pn.nspname AS function_schema,
                   CASE WHEN t.tgisinternal THEN NULL ELSE pg_get_triggerdef(t.oid, false) END AS definition
            FROM site c JOIN pg_trigger t ON t.tgrelid = c.oid
            JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
            LEFT JOIN pg_constraint k ON k.oid = t.tgconstraint
            LEFT JOIN pg_class other ON other.oid = t.tgconstrrelid
            LEFT JOIN pg_namespace other_ns ON other_ns.oid = other.relnamespace
        """,
        "trigger_functions": """
            SELECT DISTINCT pg_get_functiondef(p.oid) AS definition
            FROM site c JOIN pg_trigger t ON t.tgrelid = c.oid JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE NOT t.tgisinternal
        """,
        "sequences": """
            SELECT c.relname, a.attname, format_type(s.seqtypid, NULL) AS type,
                   s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle
            FROM site c JOIN pg_attribute a ON a.attrelid = c.oid
            JOIN pg_depend d ON d.refobjid = c.oid AND d.refobjsubid = a.attnum
              AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'i'
            JOIN pg_sequence s ON s.seqrelid = d.objid
        """,
        "rules": """
            SELECT c.relname, r.ev_enabled::text, pg_get_ruledef(r.oid, false) AS definition
            FROM site c JOIN pg_rewrite r ON r.ev_class = c.oid
        """,
    }
    def encoded(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    manifest = {name: sorted((dict(row) for row in conn.execute(site + query, ([t.name for t in tables],))),
                             key=encoded) for name, query in queries.items()}
    return hashlib.sha256(encoded(manifest).encode("utf-8")).hexdigest()


def _read_pg(conn, table: Table) -> list[tuple]:
    columns = sql.SQL(", ").join(
        sql.SQL("{}::text AS {}").format(sql.Identifier(c.name), sql.Identifier(c.name))
        if c.kind == "jsonb" else sql.Identifier(c.name) for c in table.columns
    )
    rows = conn.execute(sql.SQL("SELECT {} FROM public.{}").format(columns, sql.Identifier(table.name))).fetchall()
    return [_typed(table, i, (row[c.name] for c in table.columns)) for i, row in enumerate(rows, 1)]


def _canonical(value):
    if isinstance(value, JsonValue):
        return value.canonical
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="microseconds")
    if isinstance(value, bool):
        return int(value)
    return value


def _digest(table: Table, rows: list[tuple]) -> str:
    canonical = [tuple(_canonical(value) for value in row) for row in rows]
    encode = lambda row: json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if table.primary_key:
        indices = [next(i for i, c in enumerate(table.columns) if c.name == name) for name in table.primary_key]
        canonical.sort(key=lambda row: tuple(row[i] for i in indices))
    else:
        canonical.sort(key=encode)
    digest = hashlib.sha256()
    for row in canonical:
        digest.update(encode(row) + b"\n")
    return digest.hexdigest()


def _verify(conn, source: Source, tables: list[Table]) -> list[Check]:
    checks = []
    for table in tables:
        before = [values for _rowid, values in source.rows[table.name]]
        after = _read_pg(conn, table)
        checks.append(Check(table.name, len(before), len(after), _digest(table, before), _digest(table, after)))
    if wrong := [check.table for check in checks if not check.matches]:
        raise CopyError(f"row count or SHA-256 mismatch: {', '.join(wrong)}")
    return checks


def _sequence(conn, table: Table, column: Column) -> tuple[str, int]:
    name = conn.execute("SELECT pg_get_serial_sequence(%s, %s) AS name", (f"public.{table.name}", column.name)).fetchone()["name"]
    # pg_get_serial_sequence produces a quoted, schema-qualified identifier.
    row = conn.execute(sql.SQL("SELECT last_value, is_called FROM {}").format(sql.SQL(name))).fetchone()
    return name, row["last_value"] if row["is_called"] else 0


def _high_water(source: Source, table: Table, column: Column) -> int:
    index = next(i for i, c in enumerate(table.columns) if c.name == column.name)
    old = source.sequences.get(table.name, 0)
    if type(old) is not int or not 0 <= old < 2 ** 63:
        raise CopyError(f"{table.name}: invalid sqlite_sequence high-water mark")
    return max(old, 0, *(row[index] for _rowid, row in source.rows[table.name]))


def _sequences(conn, source: Source, tables: list[Table], *, write: bool) -> None:
    for table in tables:
        for column in table.columns:
            if not column.identity:
                continue
            name, current = _sequence(conn, table, column)
            wanted = _high_water(source, table, column)
            if write:
                conn.execute("SELECT setval(%s::regclass, %s, %s)", (name, max(wanted, 1), wanted > 0))
            elif current != wanted:
                raise CopyError(f"{table.name}: identity high-water mark differs")


def _excluded(source: Source) -> list[str]:
    return sorted(source.legacy + [f"{table}.{column}" for table, columns in source.legacy_columns.items()
                                   for column in columns])


def _archive(conn, source: Source, directory: Path) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise CopyError("the legacy archive directory must be private (mode 0700)")
    # Include the complete original table when it contains a retired column,
    # retaining its keys, values and DDL together without affecting the import.
    names = sorted(source.legacy + list(source.legacy_columns))
    for index, name in enumerate(names):
        cursor = conn.execute(f"SELECT * FROM {_quote(name)}")
        payload = {"table": name, "columns": [c[0] for c in cursor.description], "rows": cursor.fetchall(),
                   "sql": conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()[0]}
        payload["objects"] = [dict(zip(("type", "name", "sql"), row)) for row in conn.execute(
            "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? "
            "AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name", (name,),
        )]
        if name in source.legacy_columns:
            payload["legacy_columns"] = source.legacy_columns[name]
        encoded = json.dumps(payload, ensure_ascii=True, default=lambda value: {"blob_hex": value.hex()},
                             separators=(",", ":")).encode("utf-8")
        path = directory / f"legacy-{index + 1:04d}.json"
        fd, temporary = tempfile.mkstemp(prefix=".legacy-", dir=directory)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.stat().st_mode & 0o077 or path.read_bytes() != encoded:
                    raise CopyError("the legacy archive already contains different or non-private data") from None
        finally:
            os.unlink(temporary)
    _sync_directory(directory)


def _sync_directory(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def to_postgres(path: Path, url: str, *, verify_only: bool = False,
                archive_legacy: Path | None = None) -> Report:
    tables = specifications()
    with closing(_open_sqlite(path)) as old:
        source = _source(old, tables)
        # Validate counters before any target write as well as the row values.
        for table in tables:
            for column in table.columns:
                if column.identity:
                    _high_water(source, table, column)
        if archive_legacy is not None:
            if verify_only:
                raise CopyError("--verify-only does not write a legacy archive")
            _archive(old, source, archive_legacy)
        if not verify_only:
            migrations.migrate(url, seed=False)
        with psycopg.connect(url, row_factory=dict_row, options=_OPTIONS) as conn:
            if verify_only:
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            else:
                database.advisory_lock(conn, "province:copy")
                conn.execute(sql.SQL("LOCK TABLE {} IN ACCESS EXCLUSIVE MODE").format(
                    sql.SQL(", ").join(sql.Identifier("public", table.name) for table in tables)))
            _require_current(conn, tables)
            if not verify_only:
                for table in tables:
                    if conn.execute(sql.SQL("SELECT EXISTS (SELECT 1 FROM public.{}) AS used").format(
                            sql.Identifier(table.name))).fetchone()["used"]:
                        raise CopyError(f"{table.name}: target site tables must be empty")
                for table in tables:
                    if not source.rows[table.name]:
                        continue
                    columns = sql.SQL(", ").join(sql.Identifier(c.name) for c in table.columns)
                    with conn.cursor() as cursor, cursor.copy(sql.SQL("COPY public.{} ({}) FROM STDIN").format(
                            sql.Identifier(table.name), columns)) as copy:
                        for _rowid, row in source.rows[table.name]:
                            copy.write_row(tuple(Jsonb(v.raw, dumps=lambda raw: raw) if isinstance(v, JsonValue)
                                                 else v for v in row))
            checks = _verify(conn, source, tables)
            if not verify_only:
                for table in tables:
                    conn.execute(sql.SQL("ANALYZE public.{}").format(sql.Identifier(table.name)))
            _sequences(conn, source, tables, write=not verify_only)
    return Report(checks, _excluded(source), source.rounded_rows, source.discarded_microsoft_states)


def to_sqlite(path: Path, url: str) -> Report:
    if path.exists():
        raise CopyError("the rollback SQLite file already exists")
    tables = specifications()
    with psycopg.connect(url, row_factory=dict_row, options=_OPTIONS) as conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        _require_current(conn, tables)
        source = Source({table.name: list(enumerate(_read_pg(conn, table), 1)) for table in tables}, {}, [])
        for table in tables:
            for column in table.columns:
                if column.identity:
                    source.sequences[table.name] = _sequence(conn, table, column)[1]
        fd, temporary = tempfile.mkstemp(prefix=".province-rollback-", suffix=".db", dir=path.parent)
        os.close(fd)
        try:
            with closing(sqlite3.connect(temporary)) as old:
                old.executescript(LEGACY_SCHEMA.read_text(encoding="utf-8"))
                old.execute("PRAGMA foreign_keys = ON")
                with old:
                    for table in tables:
                        names = ", ".join(_quote(c.name) for c in table.columns)
                        placeholders = ", ".join("?" for _ in table.columns)
                        rows = []
                        for _rowid, row in source.rows[table.name]:
                            rows.append(tuple(v.ordered if isinstance(v, JsonValue) else
                                              v.isoformat().replace("+00:00", "Z") if isinstance(v, datetime) else
                                              int(v) if isinstance(v, bool) else v for v in row))
                        old.executemany(f"INSERT INTO {_quote(table.name)} ({names}) VALUES ({placeholders})", rows)
                    for name, high in source.sequences.items():
                        old.execute("DELETE FROM sqlite_sequence WHERE name = ?", (name,))
                        old.execute("INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)", (name, high))
                restored = _source(old, tables)
                checks = _verify(conn, restored, tables)
                _sequences(conn, restored, tables, write=False)
            # A hard link publishes atomically and refuses a destination created
            # concurrently. The temporary file is on the same filesystem.
            with open(temporary, "rb") as handle:
                os.fsync(handle.fileno())
            os.link(temporary, path)
            _sync_directory(path.parent)
        finally:
            os.unlink(temporary)
    return Report(checks, [], 0, 0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="direction", required=True)
    for direction in ("to-postgres", "to-sqlite"):
        command = sub.add_parser(direction)
        command.add_argument("--sqlite", required=True, type=Path)
        command.add_argument("--database-url", help="defaults to DATABASE_URL")
        if direction == "to-postgres":
            command.add_argument("--verify-only", action="store_true")
            command.add_argument("--archive-legacy", type=Path)
    args = parser.parse_args(argv)
    try:
        url = args.database_url or database.database_url()
        report = (to_postgres(args.sqlite, url, verify_only=args.verify_only, archive_legacy=args.archive_legacy)
                  if args.direction == "to-postgres" else to_sqlite(args.sqlite, url))
    except (CopyError, migrations.MigrationError, database.NotConfiguredError, OSError, sqlite3.Error, psycopg.Error) as exc:
        message = ((exc.diag.message_primary or f"Postgres {type(exc).__name__}")
                   if isinstance(exc, psycopg.Error) else str(exc))
        parser.exit(1, f"copy failed: {message}\n")
    print("table\tsource_rows\ttarget_rows\tsha256")
    for check in report.checks:
        print(f"{check.table}\t{check.source_rows}\t{check.target_rows}\t{check.source_sha256}")
    print(f"verified {len(report.checks)} tables; rounded rows: {report.rounded_rows}; "
          f"older Microsoft states skipped: {report.discarded_microsoft_states}")
    if report.legacy:
        print("legacy data excluded: " + ", ".join(report.legacy))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
