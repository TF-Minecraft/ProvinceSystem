"""The baseline schema: parity with schema.sql, types, collation and admin_audit."""

import re
import sqlite3

import psycopg
import pytest

from src import database
from src.database.testing import tables

# Postgres types each SQLite affinity may become.
_ALLOWED = {
    "INTEGER": {"bigint", "integer", "boolean"},
    "REAL": {"double precision"},
    "TEXT": {"text", "timestamptz", "jsonb"},
}
_PG_TYPE = {"timestamp with time zone": "timestamptz"}
# Constraints Postgres adds for read-check-write paths that SQLite serialised
# with BEGIN IMMEDIATE instead.
_NEW_UNIQUE = {
    ("microsoft_link_states", ("user_id",)),
}
_ON_DELETE = {"a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE", "n": "SET NULL", "d": "SET DEFAULT"}
_CAST = re.compile(r"::(?:text|jsonb|integer|bigint|boolean)\b")


def _expr(text: str, booleans=()) -> str:
    """An SQL expression in one spelling, so SQLite's and Postgres's can be compared."""
    text = re.sub(r"(\w+) = ANY \(ARRAY\[(.*?)\]\)", r"\1 IN (\2)", text)
    text = _CAST.sub("", text)
    for column in booleans:
        text = re.sub(rf"\b{column} = 1\b", column, text)
        text = re.sub(rf"\b{column} = 0\b", f"NOT {column}", text)
    text = text.lower().replace("!=", "<>").replace("both from", "")
    return re.sub(r"[\s()]", "", text)


def _default(value: str | None) -> str | None:
    if value is None:
        return None
    value = {"false": "0", "true": "1"}.get(_CAST.sub("", value), _CAST.sub("", value))
    return value.strip("'") if re.fullmatch(r"'-?\d+'", value) else value


def _checks(create_sql: str) -> list[str]:
    """The CHECK expressions in a SQLite CREATE TABLE statement."""
    out = []
    for match in re.finditer(r"\bCHECK\s*\(", create_sql):
        depth, i = 1, match.end()
        while depth:
            depth += {"(": 1, ")": -1}.get(create_sql[i], 0)
            i += 1
        out.append(create_sql[match.end():i - 1])
    return out


@pytest.fixture
def sqlite_schema(tmp_path, monkeypatch):
    from src.skins import db

    monkeypatch.setattr(db, "DB_PATH", tmp_path / "province.db")
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for name in ("SKINS_DIR", "WARDROBE_DIR", "DRINKS_DIR"):
        monkeypatch.setattr(db, name, tmp_path / name.lower())
    db.migrate()
    conn = sqlite3.connect(tmp_path / "province.db")
    try:
        yield conn
    finally:
        conn.close()


def _sqlite_tables(conn) -> dict:
    out = {}
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name")]
    for table in names:
        columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
        uniques = set()
        for index in conn.execute(f"PRAGMA index_list({table})").fetchall():
            _, name, unique, origin, partial = index
            if unique and not partial and origin != "pk":
                uniques.add(tuple(r[2] for r in conn.execute(f"PRAGMA index_info({name})")))
        create_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (table,)).fetchone()[0]
        partial = {name: sql.split(" WHERE ", 1)[1] for name, sql in conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql LIKE '% WHERE %'",
            (table,))}
        out[table] = {
            "columns": [(c[1], c[2].upper()) for c in columns],
            "not_null": {c[1] for c in columns if c[3] or c[5]},
            "defaults": {c[1]: c[4] for c in columns},
            "pk": tuple(c[1] for c in sorted(columns, key=lambda c: c[5]) if c[5]),
            "unique": uniques,
            "fk": {(f[3], f[2], f[4], f[6]) for f in conn.execute(f"PRAGMA foreign_key_list({table})")},
            "checks": _checks(create_sql),
            "partial": partial,
        }
    return out


def _pg_tables(conn) -> dict:
    out = {}
    for table in tables(conn):
        columns = conn.execute(
            "SELECT column_name, data_type, is_nullable, collation_name, column_default "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position", (table,)).fetchall()
        keys = conn.execute(
            """
            SELECT c.contype, i.indisunique, array_agg(a.attname ORDER BY k.n) AS cols, i.indpred IS NOT NULL AS partial
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
            LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid AND c.conrelid = t.oid
            WHERE t.relname = %s AND t.relnamespace = 'public'::regnamespace
            GROUP BY i.indexrelid, c.contype, i.indisunique, i.indpred
            """, (table,)).fetchall()
        fks = conn.execute(
            """
            SELECT a.attname AS col, f.relname AS ref, af.attname AS ref_col, c.confdeltype AS on_delete
            FROM pg_constraint c
            JOIN pg_class f ON f.oid = c.confrelid
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
            WHERE c.contype = 'f' AND c.conrelid = %s::regclass
            """, (table,)).fetchall()
        out[table] = {
            "columns": [(c["column_name"], _PG_TYPE.get(c["data_type"], c["data_type"])) for c in columns],
            "not_null": {c["column_name"] for c in columns if c["is_nullable"] == "NO"},
            "collations": {c["column_name"]: c["collation_name"] for c in columns},
            "pk": next((tuple(k["cols"]) for k in keys if k["contype"] == "p"), ()),
            "unique": {tuple(k["cols"]) for k in keys if k["indisunique"] and k["contype"] != "p" and not k["partial"]},
            "fk": {(f["col"], f["ref"], f["ref_col"], _ON_DELETE[f["on_delete"]]) for f in fks},
            "defaults": {c["column_name"]: c["column_default"] for c in columns},
            "checks": [r["def"][len("CHECK "):] for r in conn.execute(
                "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = %s::regclass "
                "AND contype = 'c'", (table,))],
            "partial": {r["name"]: r["pred"] for r in conn.execute(
                "SELECT c.relname AS name, pg_get_expr(i.indpred, i.indrelid) AS pred FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = %s::regclass "
                "AND i.indpred IS NOT NULL", (table,))},
        }
    return out


@pytest.fixture
def schemas(sqlite_schema):
    with database.connect() as conn:
        return _sqlite_tables(sqlite_schema), _pg_tables(conn)


pytestmark = pytest.mark.usefixtures("postgres")


def test_same_tables_and_columns_as_schema_sql(schemas):
    old, new = schemas
    assert sorted(new) == sorted(old)
    for table, spec in old.items():
        assert [c for c, _ in new[table]["columns"]] == [c for c, _ in spec["columns"]], table
        for (column, sqlite_type), (_, pg_type) in zip(spec["columns"], new[table]["columns"]):
            assert pg_type in _ALLOWED[sqlite_type], f"{table}.{column}: {sqlite_type} -> {pg_type}"


def test_same_keys_and_nullability(schemas):
    old, new = schemas
    for table, spec in old.items():
        assert new[table]["pk"] == spec["pk"], table
        assert new[table]["not_null"] == spec["not_null"] | set(spec["pk"]), table
        assert spec["unique"] <= new[table]["unique"], table
        assert spec["fk"] <= new[table]["fk"], table
        extra = {(table, cols) for cols in new[table]["unique"] - spec["unique"]}
        assert extra <= _NEW_UNIQUE, extra


def test_same_defaults_checks_and_partial_indexes(schemas):
    old, new = schemas
    for table, spec in old.items():
        booleans = [c for c, ty in new[table]["columns"] if ty == "boolean"]
        assert {c: _default(d) for c, d in new[table]["defaults"].items()} == spec["defaults"], table
        assert sorted(_expr(c) for c in new[table]["checks"]) == sorted(
            _expr(c, booleans) for c in spec["checks"]), table
        for name, predicate in spec["partial"].items():
            assert _expr(new[table]["partial"].get(name, "missing")) == _expr(predicate, booleans), name


def test_text_sorts_by_code_point(schemas):
    _, new = schemas
    loose = [f"{t}.{c}" for t, spec in new.items() for c, ty in spec["columns"]
             if ty == "text" and spec["collations"][c] != "C"]
    assert loose == []
    with database.connect() as conn:
        for i, name in enumerate(["a", "é", "Z", "_", "B"]):
            conn.execute("INSERT INTO lp_users (uuid, name) VALUES (%s, %s)", (str(i), name))
        names = [r["name"] for r in conn.execute("SELECT name FROM lp_users ORDER BY name")]
        conn.execute("INSERT INTO lp_users (uuid, name) VALUES ('x', 'ÉA')")
        folded = conn.execute("SELECT lower(name) AS name FROM lp_users WHERE uuid = 'x'").fetchone()["name"]
    assert names == ["B", "Z", "_", "a", "é"]
    assert folded == "Éa"


def test_seed_rows():
    with database.connect() as conn:
        rows = conn.execute("SELECT * FROM patreon_sync_state").fetchall()
    assert rows == [{"id": 1, "last_sync_at": None, "last_sync_ok": None,
                     "consecutive_failures": 0, "brake_held": False}]


def test_identity_columns_take_explicit_ids():
    with database.connect() as conn:
        conn.execute("INSERT INTO codes (id, code_hash, player_uuid, created_at, expires_at) "
                     "VALUES (41, 'h1', 'p', now(), now())")
        conn.execute("SELECT setval(pg_get_serial_sequence('codes', 'id'), 41)")
        row = conn.execute("INSERT INTO codes (code_hash, player_uuid, created_at, expires_at) "
                           "VALUES ('h2', 'p', now(), now()) RETURNING id, revoked, scope").fetchone()
    assert row == {"id": 42, "revoked": False, "scope": "skin"}


def test_foreign_keys_are_enforced():
    with pytest.raises(database.ForeignKeyViolation):
        with database.connect() as conn:
            conn.execute("INSERT INTO sessions (token_hash, code_id, player_uuid, expires_at, created_at) "
                         "VALUES ('t', 99, 'p', now(), now())")


def _audit(conn):
    return conn.execute(
        "INSERT INTO admin_audit (created_at, actor_type, action, outcome, detail_json) "
        "VALUES (now(), 'system', 'test', 'ok', %s) RETURNING id", (database.Jsonb({"database": "site"}),)
    ).fetchone()["id"]


@pytest.mark.parametrize("statement", [
    "UPDATE admin_audit SET reason = 'changed'",
    "DELETE FROM admin_audit",
    "TRUNCATE admin_audit",
    "INSERT INTO admin_audit (id, created_at, actor_type, action, outcome) VALUES (1, now(), 'system', 'x', 'ok') "
    "ON CONFLICT (id) DO UPDATE SET action = 'x'",
])
def test_admin_audit_is_append_only(statement):
    with database.connect() as conn:
        audit_id = _audit(conn)
    with pytest.raises(psycopg.errors.RaiseException, match="admin_audit is append-only"):
        with database.connect() as conn:
            conn.execute(statement)
    with database.connect() as conn:
        rows = conn.execute("SELECT id, reason, detail_json FROM admin_audit").fetchall()
    assert rows == [{"id": audit_id, "reason": None, "detail_json": {"database": "site"}}]


def test_reset_empties_tables_and_restores_seeds(postgres_session):
    with database.connect() as conn:
        _audit(conn)
        conn.execute("UPDATE patreon_sync_state SET brake_held = true")
    with pytest.raises(RuntimeError):
        with database.connect() as conn:
            conn.execute("INSERT INTO player_warnings (player_uuid, reason, created_at) VALUES ('p', 'r', now())")
            raise RuntimeError
    postgres_session()
    with database.connect() as conn:
        # The rolled-back insert advanced the sequence of a table that stayed empty.
        assert conn.execute("INSERT INTO player_warnings (player_uuid, reason, created_at) "
                            "VALUES ('p', 'r', now()) RETURNING id").fetchone()["id"] == 1
    with database.connect() as conn:
        assert conn.execute("SELECT count(*) AS n FROM admin_audit").fetchone()["n"] == 0
        assert conn.execute("SELECT brake_held FROM patreon_sync_state").fetchone()["brake_held"] is False
        assert _audit(conn) == 1
