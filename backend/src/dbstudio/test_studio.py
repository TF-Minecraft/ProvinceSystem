import contextlib
import os
import sqlite3
from types import SimpleNamespace

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

import pytest

from src.auth.test_admin import ORIGIN, account, app, audit_rows, client, env  # noqa: F401
from src.dbstudio import studio
from src.database.studio_role import provision, StudioRoleError


@pytest.fixture(scope="session")
def studio_login(postgres_session):
    role = f"studio_test_{os.getpid()}"
    password = "studio-test-password"
    provision(postgres_session.url, role, password)
    try:
        yield make_conninfo(postgres_session.url, user=role, password=password)
    finally:
        with psycopg.connect(postgres_session.url, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
            conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


@pytest.fixture(autouse=True)
def studio_url(studio_login, monkeypatch):
    monkeypatch.setenv("DATABASE_STUDIO_URL", studio_login)


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
    # The accounts tests' Postgres (DATABASE_URL) is listed too.
    site = next(d for d in overview.json()["databases"] if d["id"] == "site")
    assert site["id"] == "site" and site["writable"] and site["available"] and site["tables"] > 10


def link(env, name):
    from src import database
    with database.connect() as conn:
        conn.execute("INSERT INTO discord_links (player_uuid, discord_user_id, minecraft_name, linked_at) "
                     "VALUES (%s, %s, %s, '2026-10-01T00:00:00Z')", (f"uuid-{name.lower()}", f"id-{name}", name))


def test_reads_cannot_write_and_are_audited(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    link(env, "RoryMC")
    result = query(c, "SELECT player_uuid, minecraft_name FROM discord_links ORDER BY player_uuid")
    assert result.status_code == 200
    body = result.json()
    assert body["columns"] == ["player_uuid", "minecraft_name"] and body["rows"][0][1] == "RoryMC"
    assert body["changes"] is None
    refused = query(c, "UPDATE discord_links SET minecraft_name = 'x'")
    assert refused.status_code == 400 and "Read mode" in refused.json()["detail"]
    rows = [r for r in audit_rows(env) if r["action"].startswith("database.")]
    assert [(r["action"], r["outcome"]) for r in rows] == [("database.read", "ok"), ("database.read", "failed")]
    assert rows[0]["detail_json"]["sql"] == "SELECT player_uuid, minecraft_name FROM discord_links ORDER BY player_uuid"
    assert c.get("/admin/database").json()["databases"][0]["queries"] == 2


def test_root_edits_are_audited_but_the_audit_log_is_protected(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    link(env, "RoryMC")
    edited = query(c, "UPDATE discord_links SET minecraft_name = 'Renamed' WHERE minecraft_name = 'RoryMC'", write=True)
    assert edited.status_code == 200 and edited.json()["changes"] == 1
    assert query(c, "SELECT minecraft_name FROM discord_links").json()["rows"] == [["Renamed"]]
    for sql in ("DELETE FROM admin_audit", "UPDATE admin_audit SET outcome = 'x'", "DROP TABLE admin_audit",
                "ALTER TABLE admin_audit DISABLE TRIGGER ALL"):
        refused = query(c, sql, write=True)
        assert refused.status_code == 403, sql
    written = [r for r in audit_rows(env) if r["action"] == "database.write"]
    # Each edit is logged as requested before it runs, then with its outcome.
    assert [r["outcome"] for r in written] == ["requested", "ok"] + ["requested", "failed"] * 4
    assert "Renamed" in written[0]["detail_json"]["sql"]


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
    body = query(c, "SELECT 'abc' AS token_hash, 9007199254740993 AS big, decode('00ff', 'hex') AS raw, 1.5::float8 AS f").json()
    assert body["rows"][0] == [studio.MASK, "9007199254740993", {"blob": 2, "hex": "00ff"}, 1.5]


def test_jsonb_values_keep_json_format_and_secrets_stay_masked(app, env):
    c = client(app, account(env, "rory", "root")[1])
    body = query(c, "SELECT '{\"x\":[1,true]}'::jsonb AS payload, "
                    "'{\"secret\":\"hidden\"}'::jsonb AS token_json, "
                    "'2026-10-01T00:00:00Z'::timestamptz AS created_at").json()
    assert body["rows"] == [['{"x":[1,true]}', studio.MASK, "2026-10-01T00:00:00+00:00"]]


def test_results_stop_at_the_row_limit(app, env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(studio, "MAX_ROWS", 5)
    c = client(app, account(env, "rory", "root")[1])
    body = query(c, "SELECT i FROM generate_series(1, 50) n(i)").json()
    assert len(body["rows"]) == 5 and body["truncated"] and body["limit"] == 5


def test_slow_queries_are_stopped(app, env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(studio, "POSTGRES_TIMEOUT", "50ms")
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
    assert c.get("/admin/database/nowhere/schema").status_code == 404
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
    monkeypatch.setenv("DATABASE_STUDIO_URL", "postgresql://example")
    monkeypatch.setattr(studio.psycopg, "connect", connect)
    result = studio.run("site", "SELECT name, token FROM precedent_cases")
    assert connections[0].read_only is True
    assert log == ["SET LOCAL statement_timeout = '10s'", "DECLARE studio: SELECT name, token FROM precedent_cases",
                   "ROLLBACK"]
    assert result.rows == [["case", studio.MASK]]
    log.clear()
    studio.run("site", "UPDATE precedent_cases SET title = 'x'", write=True)
    assert connections[1].read_only is False
    assert log == ["SET LOCAL statement_timeout = '10s'", "PIPELINE", "UPDATE precedent_cases SET title = 'x'", "COMMIT"]


@pytest.fixture
def real_postgres(postgres, studio_login):
    with psycopg.connect(postgres, autocommit=True) as conn:
        conn.execute("CREATE TABLE studio_probe (id int, v text)")
        conn.execute("INSERT INTO studio_probe VALUES (1, 'orig')")
    provision(postgres, f"studio_test_{os.getpid()}", "studio-test-password")

    def value():
        with psycopg.connect(postgres) as conn:
            return conn.execute("SELECT v FROM studio_probe").fetchone()[0]

    try:
        yield value
    finally:
        with psycopg.connect(postgres, autocommit=True) as conn:
            conn.execute("DROP TABLE studio_probe")


@pytest.mark.parametrize("write", [False, True])
def test_real_postgres_refuses_hidden_statements(real_postgres, monkeypatch, write):
    # Sol's second payload: a carriage return ends the comment for Postgres. With the text
    # check out of the way, Postgres itself must still refuse the extra commands.
    monkeypatch.setattr(studio, "_check", lambda *_: None)
    sql = "SELECT 1 --\r; COMMIT; BEGIN READ WRITE; UPDATE studio_probe SET v = 'changed'; COMMIT"
    with pytest.raises(studio.StudioError) as refused:
        studio.run("site", sql, write=write)
    assert "multiple commands" in refused.value.message
    assert real_postgres() == "orig"


def test_real_postgres_reads_and_edits(real_postgres):
    assert studio.run("site", "SELECT id, v FROM studio_probe").rows == [[1, "orig"]]
    with pytest.raises(studio.StudioError) as refused:
        studio.run("site", "WITH x AS (UPDATE studio_probe SET v = 'cte' RETURNING 1) SELECT * FROM x")
    assert refused.value.code == "sql_error"
    edited = studio.run("site", "UPDATE studio_probe SET v = 'edited' RETURNING id, v", write=True)
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
    monkeypatch.setenv("DATABASE_STUDIO_URL", "postgresql://example")
    monkeypatch.setattr(studio.psycopg, "connect", lambda *a, **k: pytest.fail("connected"))
    with pytest.raises(studio.StudioError) as refused:
        studio.run("site", sql, write=write)
    assert refused.value.code == code


@pytest.mark.parametrize("sql", [
    "SELECT 'a;b', \"c;d\" FROM t -- ;",
    "SELECT $$a;b$$, $tag$ ; $tag$ /* /* ; */ ; */",
    "WITH x AS (SELECT 1) SELECT * FROM x;",
    "SELECT 1;;  ",
])
def test_semicolons_inside_strings_and_comments_are_fine(sql):
    studio._check(sql, "postgres", False)


@pytest.mark.parametrize("statement", [
    "DELETE FROM admin_audit",
    "INSERT INTO admin_audit (created_at, actor_type, action, outcome) VALUES (now(), 'system', 'forged', 'ok')",
    "UPDATE admin_audit SET outcome = 'forged'",
    "TRUNCATE admin_audit",
    "DROP TABLE admin_audit CASCADE",
    "ALTER TABLE admin_audit DISABLE TRIGGER ALL",
    "DROP FUNCTION admin_audit_append_only() CASCADE",
    "DELETE FROM schema_migrations",
    "SELECT setval('admin_audit_id_seq', 9223372036854775807)",
    "SELECT set_config('role', 'postgres', false)",
    "SELECT set_config('session_authorization', 'postgres', false)",
    "SELECT set_config('session_replication_role', 'replica', false)",
    "ALTER ROLE postgres SUPERUSER",
    "CREATE TABLE public.studio_unowned (id int)",
    "CREATE TRIGGER forged AFTER UPDATE ON discord_links FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only()",
    "CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
])
def test_restricted_login_protects_the_database_even_without_the_text_check(
    app, env, monkeypatch, statement,
):
    c = client(app, account(env, "rory", "root")[1])
    monkeypatch.setattr(studio, "_check", lambda *_: None)
    assert query(c, statement, write=True).status_code == 403
    assert [r["outcome"] for r in audit_rows(env) if r["action"] == "database.write"] == ["requested", "failed"]


def test_studio_never_falls_back_to_the_database_owner(app, env, monkeypatch):
    c = client(app, account(env, "rory", "root")[1])
    monkeypatch.delenv("DATABASE_STUDIO_URL")
    assert query(c, "SELECT 1").status_code == 503


def test_provisioning_is_repeatable_and_refuses_an_owner(postgres, studio_login):
    provision(postgres, f"studio_test_{os.getpid()}", "studio-test-password")
    with pytest.raises(StudioRoleError):
        provision(postgres, "postgres", "unused")


def test_provisioning_refuses_public_grants_that_bypass_restrictions(postgres, studio_login):
    with psycopg.connect(postgres, autocommit=True) as conn:
        conn.execute("GRANT INSERT ON admin_audit TO PUBLIC")
        try:
            with pytest.raises(StudioRoleError, match="grants.*bypass"):
                provision(postgres, f"studio_test_{os.getpid()}", "studio-test-password")
        finally:
            conn.execute("REVOKE INSERT ON admin_audit FROM PUBLIC")


def test_provisioning_refuses_create_on_other_persistent_schemas(postgres, studio_login):
    with psycopg.connect(postgres, autocommit=True) as conn:
        conn.execute("CREATE SCHEMA studio_other")
        try:
            conn.execute("GRANT USAGE, CREATE ON SCHEMA studio_other TO PUBLIC")
            with pytest.raises(StudioRoleError, match="grants.*bypass"):
                provision(postgres, f"studio_test_{os.getpid()}", "studio-test-password")
        finally:
            conn.execute("DROP SCHEMA studio_other CASCADE")


@pytest.mark.parametrize("privilege", ["TRUNCATE", "TRIGGER", "REFERENCES", "REFERENCES (player_uuid)"])
def test_provisioning_refuses_definition_privileges_on_ordinary_tables(postgres, studio_login, privilege):
    with psycopg.connect(postgres, autocommit=True) as conn:
        conn.execute(f"GRANT {privilege} ON codes TO PUBLIC")
        try:
            with pytest.raises(StudioRoleError, match="grants.*bypass"):
                provision(postgres, f"studio_test_{os.getpid()}", "studio-test-password")
        finally:
            conn.execute(f"REVOKE {privilege} ON codes FROM PUBLIC")


@pytest.mark.parametrize("grantee", ["PUBLIC", "studio"])
@pytest.mark.parametrize(("table", "privilege"), [
    ("admin_audit", "INSERT (created_at, actor_type, action, outcome)"),
    ("schema_migrations", "UPDATE (checksum)"),
])
def test_provisioning_repairs_direct_and_refuses_public_column_grants(postgres, studio_login, grantee, table, privilege):
    role = f"studio_test_{os.getpid()}"
    target = sql.Identifier(role) if grantee == "studio" else sql.SQL("PUBLIC")
    with psycopg.connect(postgres, autocommit=True) as conn:
        conn.execute(sql.SQL("GRANT {} ON {} TO {}").format(sql.SQL(privilege), sql.Identifier(table), target))
        try:
            if grantee == "PUBLIC":
                with pytest.raises(StudioRoleError, match="grants.*bypass"):
                    provision(postgres, role, "studio-test-password")
            else:
                provision(postgres, role, "studio-test-password")
                assert conn.execute(
                    "SELECT has_any_column_privilege(%s, %s, 'INSERT, UPDATE')", (role, table),
                ).fetchone() == (False,)
        finally:
            conn.execute(sql.SQL("REVOKE {} ON {} FROM {}").format(sql.SQL(privilege), sql.Identifier(table), target))


def test_studio_inserts_can_allocate_an_identity_without_resetting_it(app, env):
    c = client(app, account(env, "rory", "root")[1])
    result = query(c, "INSERT INTO users (discord_user_id, created_at, updated_at, last_login_at) "
                      "VALUES ('studio-insert', now(), now(), now()) RETURNING id", write=True)
    assert result.status_code == 200, result.text
    assert result.json()["changes"] == 1 and isinstance(result.json()["rows"][0][0], int)


def test_edits_cannot_index_the_audit_log(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    # Sol: an index whose expression overflows would make every later audit insert fail.
    refused = query(c, "CREATE INDEX block_audit ON admin_audit(abs(-9223372036854775808)) WHERE id > 0", write=True)
    assert refused.status_code == 403
    link(env, "RoryMC")
    assert query(c, "UPDATE discord_links SET minecraft_name = 'Still logged'", write=True).status_code == 200
    assert [r["outcome"] for r in audit_rows(env) if r["action"] == "database.write"][-2:] == ["requested", "ok"]


def test_schema_and_list_loads_are_audited(app, env):  # noqa: F811
    c = client(app, account(env, "rory", "root")[1])
    assert c.get("/admin/database").status_code == 200
    assert c.get("/admin/database/site/schema").status_code == 200
    assert c.get("/admin/database/nowhere/schema").status_code == 404
    rows = [(r["action"], r["outcome"]) for r in audit_rows(env) if r["action"].startswith("database.")]
    assert rows == [("database.list", "ok"), ("database.schema", "ok"), ("database.schema", "failed")]
    # Only reads and edits count as queries.
    assert c.get("/admin/database").json()["databases"][0]["queries"] == 0


def test_postgres_comment_ends_at_a_carriage_return():
    with pytest.raises(studio.StudioError) as refused:
        studio._check("SELECT 1 --\r; COMMIT; BEGIN READ WRITE; UPDATE t SET v = 'x'", "postgres", False)
    assert refused.value.code == "one_statement"
