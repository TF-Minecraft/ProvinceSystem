import json
import sqlite3

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
    assert written[0]["outcome"] == "ok" and "Renamed" in json.loads(written[0]["detail_json"])["sql"]
    assert all(r["outcome"] == "failed" for r in written[1:])


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
    assert c.get("/admin/database/supabase/schema").status_code == 404
    assert query(c, "SELECT 1", "nope").status_code == 404


class FakeCursor:
    def __init__(self, log, rows):
        self.log, self.rows, self.description, self.rowcount = log, rows, None, -1

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql):
        self.log.append(sql)
        if sql.startswith("SELECT"):
            self.description = [("name",), ("token",)]
            self.rowcount = len(self.rows)

    def fetchmany(self, n):
        return self.rows[:n]


class FakeConnection:
    def __init__(self, log):
        self.log, self.session = log, None

    def set_session(self, **kwargs):
        self.session = kwargs

    def cursor(self):
        return FakeCursor(self.log, [("case", "secret")])

    def commit(self):
        self.log.append("COMMIT")

    def rollback(self):
        self.log.append("ROLLBACK")

    def close(self):
        pass


def test_postgres_reads_run_in_read_only_transactions(monkeypatch):
    log, connections = [], []

    def connect(dsn, **_):
        connections.append(FakeConnection(log))
        return connections[-1]
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://example")
    monkeypatch.setattr(studio.psycopg2, "connect", connect)
    result = studio.run("supabase", "SELECT name, token FROM precedent_cases")
    assert connections[0].session == {"readonly": True, "autocommit": False}
    assert log == ["SET LOCAL statement_timeout = '10s'", "SELECT name, token FROM precedent_cases", "ROLLBACK"]
    assert result.rows == [["case", studio.MASK]]
    studio.run("supabase", "UPDATE precedent_cases SET title = 'x'", write=True)
    assert connections[1].session == {"readonly": False, "autocommit": False} and log[-1] == "COMMIT"

