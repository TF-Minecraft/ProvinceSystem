import contextlib
import json
import os
import sqlite3
from types import SimpleNamespace

import pytest

from src.auth.test_admin import ORIGIN, account, app, audit_rows, client, env  # noqa: F401
from src.dbstudio import studio


@pytest.fixture
def coreprotect_db(tmp_path, monkeypatch):
    path = tmp_path / "database.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE co_user (rowid INTEGER PRIMARY KEY, time INTEGER, user TEXT, uuid TEXT);
        CREATE TABLE co_block (rowid INTEGER PRIMARY KEY, time INTEGER, user INTEGER, x INTEGER, y INTEGER,
                               z INTEGER, type INTEGER, data INTEGER, meta BLOB, action INTEGER);
        CREATE INDEX block_user_index ON co_block(user, time);
    """)
    conn.executemany("INSERT INTO co_user (time, user, uuid) VALUES (?, ?, ?)",
                     [(1, "Alice", "a-uuid"), (2, "Bob", "b-uuid")])
    conn.executemany("INSERT INTO co_block (time, user, x, y, z, type, data, meta, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     [(t, 1, t, 64, -t, 3, 0, b"\x00\x01", 1) for t in range(1, 21)])
    conn.commit()
    conn.close()
    monkeypatch.setenv("COREPROTECT_DB", str(path))
    monkeypatch.setenv("COREPROTECT_SERVER", "main")
    return path


def query(c, sql, database="site", write=False):
    return c.post(f"/admin/database/{database}/query", json={"sql": sql, "write": write}, headers=ORIGIN)


def test_only_root_can_use_the_studio(app, env):  # noqa: F811
    for role in ("player", "mod", "admin"):
        c = client(app, account(env, f"user-{role}", role)[1])
        assert c.get("/admin/database").status_code == 403
        assert query(c, "SELECT 1").status_code == 403
    c = client(app, account(env, "rory", "root")[1])
    overview = c.get("/admin/database")
    assert overview.status_code == 200 and overview.headers["cache-control"] == "no-store"
    [site] = overview.json()["databases"]
    assert site["id"] == "site" and site["writable"] and site["available"] and site["tables"] > 10


def test_reads_cannot_write_and_are_audited(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    result = query(c, "SELECT id, role FROM users ORDER BY id")
    assert result.status_code == 200
    body = result.json()
    assert body["columns"] == ["id", "role"] and body["rows"][0][1] == "root" and body["changes"] is None
    refused = query(c, "UPDATE users SET role = 'player'")
    assert refused.status_code == 400 and "readonly" in refused.json()["detail"]
    rows = [r for r in audit_rows(env) if r["action"].startswith("database.")]
    assert [(r["action"], r["outcome"]) for r in rows] == [("database.read", "ok"), ("database.read", "failed")]
    assert json.loads(rows[0]["detail_json"])["sql"] == "SELECT id, role FROM users ORDER BY id"
    assert c.get("/admin/database").json()["databases"][0]["queries"] == 2


def test_root_edits_are_audited_but_the_audit_log_is_protected(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    edited = query(c, "UPDATE users SET discord_global_name = 'Renamed' WHERE discord_username = 'rory'", write=True)
    assert edited.status_code == 200 and edited.json()["changes"] == 1
    assert query(c, "SELECT discord_global_name FROM users").json()["rows"] == [["Renamed"]]
    for sql in ("DELETE FROM admin_audit", "UPDATE admin_audit SET outcome = 'x'", "DROP TABLE admin_audit",
                "DROP TRIGGER IF EXISTS admin_audit_no_update"):
        refused = query(c, sql, write=True)
        assert refused.status_code == 403, sql
    written = [r for r in audit_rows(env) if r["action"] == "database.write"]
    # Each edit is logged as requested before it runs, then with its outcome.
    assert [r["outcome"] for r in written] == ["requested", "ok"] + ["requested", "failed"] * 4
    assert "Renamed" in json.loads(written[0]["detail_json"])["sql"]


def test_writes_need_the_sites_origin(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    assert c.post("/admin/database/site/query", json={"sql": "SELECT 1"}).status_code == 403


def test_attach_is_refused(app, env, tmp_path):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    for write in (False, True):
        refused = query(c, f"ATTACH DATABASE '{tmp_path / 'other.db'}' AS other", write=write)
        assert refused.status_code == 403
    assert not (tmp_path / "other.db").exists()


def test_secrets_are_masked_and_values_travel_safely(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    body = query(c, "SELECT token_hash, 9007199254740993 AS big, x'00ff' AS raw, 1.5 AS f FROM user_sessions").json()
    assert body["rows"][0] == [studio.MASK, "9007199254740993", {"blob": 2, "hex": "00ff"}, 1.5]


def test_results_stop_at_the_row_limit(app, env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(studio, "MAX_ROWS", 5)
    c = client(app, account(env, "rory", "root")[1])
    body = query(c, "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n LIMIT 50) SELECT i FROM n").json()
    assert len(body["rows"]) == 5 and body["truncated"] and body["limit"] == 5


def test_slow_queries_are_stopped(app, env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(studio, "SITE_SECONDS", 0.05)
    c = client(app, account(env, "rory", "root")[1])
    slow = query(c, "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n")
    assert slow.status_code == 408


def test_one_statement_at_a_time(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    refused = query(c, "SELECT 1; SELECT 2")
    assert refused.status_code == 400 and "one statement" in refused.json()["detail"]


def test_coreprotect_is_read_only_with_schema_and_browsing(app, env, coreprotect_db):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    databases = {d["id"]: d for d in c.get("/admin/database").json()["databases"]}
    assert databases["coreprotect"]["name"] == "CoreProtect · Main" and not databases["coreprotect"]["writable"]
    assert databases["coreprotect"]["tables"] == 2 and databases["coreprotect"]["size_bytes"] > 0
    schema = c.get("/admin/database/coreprotect/schema").json()
    tables = {t["name"]: t for t in schema["tables"]}
    assert tables["co_block"]["rows"] == 20 and tables["co_user"]["columns"][0] == {
        "name": "rowid", "type": "INTEGER", "notnull": False, "pk": True}
    assert schema["database"]["writable"] is False
    assert query(c, "DELETE FROM co_user", "coreprotect", write=True).status_code == 403
    assert query(c, "DELETE FROM co_user", "coreprotect").status_code == 400
    page = c.post("/admin/database/coreprotect/browse", headers=ORIGIN, json={
        "table": "co_block", "limit": 3, "offset": 2, "order": "time", "descending": True, "where": "x > 5"}).json()
    assert [row[1] for row in page["rows"]] == [18, 17, 16]
    assert page["sql"] == 'SELECT * FROM "co_block" WHERE x > 5 ORDER BY "time" DESC LIMIT 3 OFFSET 2'
    assert page["rows"][0][8] == {"blob": 2, "hex": "0001"}
    assert c.post("/admin/database/coreprotect/browse", headers=ORIGIN,
                  json={"table": "co_missing"}).status_code == 404
    assert c.post("/admin/database/coreprotect/browse", headers=ORIGIN,
                  json={"table": "co_block", "order": "nope"}).status_code == 400


def test_coreprotect_queries_have_a_short_budget(app, env, coreprotect_db, monkeypatch):  # noqa: F811
    monkeypatch.setattr(studio, "COREPROTECT_SECONDS", 0.05)
    c = client(app, account(env, "rory", "root")[1])
    slow = query(c, "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n",
                 "coreprotect")
    assert slow.status_code == 408 and "3 seconds" in slow.json()["detail"]


def test_unknown_database(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    assert c.get("/admin/database/postgres/schema").status_code == 404
    assert query(c, "SELECT 1", "nope").status_code == 404


class FakeCursor:
    def __init__(self, log, rows, name=None):
        self.log, self.rows, self.name, self.description, self.rowcount = log, rows, name, None, -1
        self.itersize = 100

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql):
        self.log.append(f"DECLARE {self.name}: {sql}" if self.name else sql)
        if not sql.startswith("SET"):
            self.description = [SimpleNamespace(name="name"), SimpleNamespace(name="token")]
            self.rowcount = len(self.rows)
        return self

    def fetchmany(self, n):
        return self.rows[:n]


class FakeConnection:
    def __init__(self, log):
        self.log, self.read_only = log, None

    @contextlib.contextmanager
    def pipeline(self):
        self.log.append("PIPELINE")
        yield

    def execute(self, sql, prepare=None):
        return FakeCursor(self.log, [("case", "secret")]).execute(sql)

    def cursor(self, name=None):
        return FakeCursor(self.log, [("case", "secret")], name)

    def commit(self):
        self.log.append("COMMIT")

    def rollback(self):
        self.log.append("ROLLBACK")

    def close(self):
        pass


def test_postgres_reads_use_a_read_only_server_cursor_and_edits_a_pipeline(monkeypatch):
    log, connections = [], []

    def connect(dsn, **_):
        connections.append(FakeConnection(log))
        return connections[-1]
    monkeypatch.setenv("DATABASE_URL", "postgresql://example")
    monkeypatch.setattr(studio.psycopg, "connect", connect)
    result = studio.run("postgres", "SELECT name, token FROM precedent_cases")
    assert connections[0].read_only is True
    assert log == ["SET LOCAL statement_timeout = '10s'", "DECLARE studio: SELECT name, token FROM precedent_cases",
                   "ROLLBACK"]
    assert result.rows == [["case", studio.MASK]]
    log.clear()
    studio.run("postgres", "UPDATE precedent_cases SET title = 'x'", write=True)
    assert connections[1].read_only is False
    assert log == ["SET LOCAL statement_timeout = '10s'", "PIPELINE", "UPDATE precedent_cases SET title = 'x'", "COMMIT"]


# Set STUDIO_TEST_POSTGRES to a throwaway database (it creates and drops a table) to run these.
REAL_POSTGRES = os.getenv("STUDIO_TEST_POSTGRES", "")


@pytest.fixture
def real_postgres(monkeypatch):
    if not REAL_POSTGRES:
        pytest.skip("STUDIO_TEST_POSTGRES is not set")
    monkeypatch.setenv("DATABASE_URL", REAL_POSTGRES)
    with studio.psycopg.connect(REAL_POSTGRES, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS studio_probe; CREATE TABLE studio_probe (id int, v text)")
        conn.execute("INSERT INTO studio_probe VALUES (1, 'orig')")
    yield lambda: studio.psycopg.connect(REAL_POSTGRES, autocommit=True).execute(
        "SELECT v FROM studio_probe").fetchone()[0]
    with studio.psycopg.connect(REAL_POSTGRES, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS studio_probe")


@pytest.mark.parametrize("write", [False, True])
def test_real_postgres_refuses_hidden_statements(real_postgres, monkeypatch, write):
    # Sol's second payload: a carriage return ends the comment for Postgres. With the text
    # check out of the way, Postgres itself must still refuse the extra commands.
    monkeypatch.setattr(studio, "_check", lambda *_: None)
    sql = "SELECT 1 --\r; COMMIT; BEGIN READ WRITE; UPDATE studio_probe SET v = 'changed'; COMMIT"
    with pytest.raises(studio.StudioError) as refused:
        studio.run("postgres", sql, write=write)
    assert "multiple commands" in refused.value.message
    assert real_postgres() == "orig"


def test_real_postgres_reads_and_edits(real_postgres):
    assert studio.run("postgres", "SELECT id, v FROM studio_probe").rows == [[1, "orig"]]
    with pytest.raises(studio.StudioError) as refused:
        studio.run("postgres", "WITH x AS (UPDATE studio_probe SET v = 'cte' RETURNING 1) SELECT * FROM x")
    assert refused.value.code == "sql_error"
    edited = studio.run("postgres", "UPDATE studio_probe SET v = 'edited' RETURNING id, v", write=True)
    assert edited.rows == [[1, "edited"]] and edited.changes == 1
    assert real_postgres() == "edited"


@pytest.mark.parametrize("sql,write,code", [
    # Sol's escape: leaving the read-only transaction and committing a write.
    ("COMMIT; BEGIN READ WRITE; UPDATE precedent_cases SET title = 'x'; COMMIT", False, "not_allowed"),
    ("SELECT 1; COMMIT; UPDATE precedent_cases SET title = 'x'", False, "one_statement"),
    ("SELECT E'\\\\'; COMMIT; SELECT '", False, "one_statement"),
    ("SELECT E'\\''; COMMIT", False, "one_statement"),
    ("SELECT 'a\\'; COMMIT; --'", False, "one_statement"),
    ("UPDATE precedent_cases SET title = 'x'", False, "read_only"),
    ("SET LOCAL default_transaction_read_only = off", True, "not_allowed"),
    ("COMMIT", True, "not_allowed"),
    ("/* hi */ begin", True, "not_allowed"),
])
def test_postgres_statements_that_could_escape_are_refused_before_connecting(monkeypatch, sql, write, code):
    monkeypatch.setenv("DATABASE_URL", "postgresql://example")
    monkeypatch.setattr(studio.psycopg, "connect", lambda *a, **k: pytest.fail("connected"))
    with pytest.raises(studio.StudioError) as refused:
        studio.run("postgres", sql, write=write)
    assert refused.value.code == code


@pytest.mark.parametrize("sql", [
    "SELECT 'a;b', \"c;d\" FROM t -- ;",
    "SELECT $$a;b$$, $tag$ ; $tag$ /* /* ; */ ; */",
    "WITH x AS (SELECT 1) SELECT * FROM x;",
    "SELECT 1;;  ",
])
def test_semicolons_inside_strings_and_comments_are_fine(sql):
    studio._check(sql, "postgres", False)


def test_sqlite_edits_cannot_plant_triggers_or_unlock_the_schema(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    for sql in (
        # Sol: a stored trigger would forge audit rows when the site later updates users.
        "CREATE TRIGGER forge AFTER UPDATE ON users BEGIN INSERT INTO admin_audit (created_at, actor_type, action, "
        "outcome) VALUES ('x', 'system', 'forged', 'ok'); END",
        "CREATE TEMP TRIGGER t AFTER UPDATE ON users BEGIN SELECT 1; END",
        "PRAGMA writable_schema = ON",
        "PRAGMA foreign_keys = OFF",
        "VACUUM INTO '/tmp/copy.db'",
        "BEGIN",
        "COMMIT",
        "SAVEPOINT s",
    ):
        assert query(c, sql, write=True).status_code == 403, sql
    with env.connect() as conn:
        assert conn.execute("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'forge'").fetchone()[0] == 0
    # Schema pragmas that only describe still work in reads.
    assert query(c, "PRAGMA table_info(users)").status_code == 200


def test_edits_cannot_touch_the_autoincrement_counters(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    # Sol: a maxed-out counter makes every later audit insert fail.
    refused = query(c, "UPDATE sqlite_sequence SET seq = 9223372036854775807 WHERE name = 'admin_audit'", write=True)
    assert refused.status_code == 403
    assert query(c, "SELECT name FROM sqlite_sequence WHERE name = 'admin_audit'").status_code == 200
    # Ordinary autoincrement inserts still update the counter.
    assert query(c, "CREATE TABLE studio_tmp (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)", write=True).status_code == 200
    assert query(c, "INSERT INTO studio_tmp (v) VALUES ('a')", write=True).json()["changes"] == 1


def test_edits_cannot_index_the_audit_log(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    # Sol: an index whose expression overflows would make every later audit insert fail.
    refused = query(c, "CREATE INDEX block_audit ON admin_audit(abs(-9223372036854775808)) WHERE id > 0", write=True)
    assert refused.status_code == 403
    assert query(c, "UPDATE users SET discord_global_name = 'Still logged'", write=True).status_code == 200
    assert [r["outcome"] for r in audit_rows(env) if r["action"] == "database.write"][-2:] == ["requested", "ok"]


def test_schema_and_list_loads_are_audited(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    assert c.get("/admin/database").status_code == 200
    assert c.get("/admin/database/site/schema").status_code == 200
    assert c.get("/admin/database/postgres/schema").status_code == 404
    rows = [(r["action"], r["outcome"]) for r in audit_rows(env) if r["action"].startswith("database.")]
    assert rows == [("database.list", "ok"), ("database.schema", "ok"), ("database.schema", "failed")]
    # Only reads and edits count as queries.
    assert c.get("/admin/database").json()["databases"][0]["queries"] == 0


def test_postgres_comment_ends_at_a_carriage_return():
    with pytest.raises(studio.StudioError) as refused:
        studio._check("SELECT 1 --\r; COMMIT; BEGIN READ WRITE; UPDATE t SET v = 'x'", "postgres", False)
    assert refused.value.code == "one_statement"
