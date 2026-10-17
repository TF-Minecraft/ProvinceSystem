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
from src.database.studio_role import main as provision_main, provision, StudioRoleError


@pytest.fixture(scope="session")
def studio_login(postgres_session):
    role = f"studio_test_{os.getpid()}"
    password = "studio-test-password"
    provision(postgres_session.url, role, password, restrict_large_objects=True)
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
    assert body["rows"] == [['{"x": [1, true]}', studio.MASK, "2026-10-01T00:00:00+00:00"]]


@pytest.mark.parametrize("kind", ["json", "jsonb"])
@pytest.mark.parametrize("write", [False, True])
@pytest.mark.parametrize("value", [
    pytest.param('"abc"', id="string"),
    pytest.param('null', id="null"),
    pytest.param('true', id="boolean"),
    pytest.param('12345678901234567890.12345678901234567890', id="decimal"),
    pytest.param('{"n":1' + '0' * 400 + '.5}', id="large-fraction"),
])
def test_json_display_preserves_postgres_text_for_all_value_types(app, env, kind, write, value):
    c = client(app, account(env, "rory", "root")[1])
    literal = sql.Literal(value).as_string()
    response = query(c, f"SELECT {literal}::{kind} AS payload, ({literal}::{kind})::text AS expected, "
                        f"NULL::{kind} AS sql_null, {literal}::{kind} AS token_json", write=write)
    assert response.status_code == 200
    payload, expected, sql_null, masked = response.json()["rows"][0]
    assert isinstance(payload, str) and payload == expected
    assert sql_null is None and masked == studio.MASK


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
        self.adapters = psycopg.adapt.AdaptersMap(psycopg.adapters)

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


@pytest.mark.parametrize("schema", ["public", "studio_other"])
@pytest.mark.parametrize("privilege", ["TRUNCATE", "TRIGGER", "REFERENCES", "REFERENCES (player_uuid)", "MAINTAIN"])
def test_provisioning_refuses_definition_privileges_on_ordinary_tables(postgres, studio_login, privilege, schema):
    table = sql.Identifier(schema, "codes")
    with psycopg.connect(postgres, autocommit=True) as conn:
        if schema != "public":
            conn.execute("CREATE SCHEMA studio_other")
            conn.execute("GRANT USAGE ON SCHEMA studio_other TO PUBLIC")
            conn.execute("CREATE TABLE studio_other.codes (player_uuid text)")
        conn.execute(sql.SQL("GRANT {} ON {} TO PUBLIC").format(sql.SQL(privilege), table))
        try:
            with pytest.raises(StudioRoleError, match="grants.*bypass"):
                provision(postgres, f"studio_test_{os.getpid()}", "studio-test-password")
        finally:
            conn.execute(sql.SQL("REVOKE {} ON {} FROM PUBLIC").format(sql.SQL(privilege), table))
            if schema != "public":
                conn.execute("DROP SCHEMA studio_other CASCADE")


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


@pytest.fixture
def studio_sandbox(scratch_database, monkeypatch):
    role, password = f"studio_r2_{os.getpid()}", "studio-r2-password"
    login = make_conninfo(scratch_database, user=role, password=password)
    with psycopg.connect(scratch_database, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE ROLE {} LOGIN NOINHERIT PASSWORD {}").format(
            sql.Identifier(role), sql.Literal(password)))
        conn.execute("CREATE TABLE admin_audit (id int, action text)")
        conn.execute("CREATE TABLE schema_migrations (id int, checksum text)")
        conn.execute("INSERT INTO schema_migrations VALUES (1, 'original')")
        conn.execute("CREATE TABLE ordinary (id int GENERATED ALWAYS AS IDENTITY, v text)")
        conn.execute('CREATE SCHEMA "studio other"')
        conn.execute('GRANT USAGE ON SCHEMA "studio other" TO PUBLIC')
    monkeypatch.setenv("DATABASE_STUDIO_URL", login)
    try:
        yield SimpleNamespace(url=scratch_database, role=role, password=password, login=login)
    finally:
        with psycopg.connect(scratch_database, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
            conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


@pytest.mark.parametrize("kind", ["inheritance", "partition"])
def test_protected_descendants_stay_read_only_recursively(studio_sandbox, monkeypatch, kind):
    db = studio_sandbox
    with psycopg.connect(db.url, autocommit=True) as conn:
        if kind == "inheritance":
            conn.execute('CREATE TABLE "studio other".audit_child () INHERITS (admin_audit)')
            conn.execute('CREATE TABLE audit_leaf () INHERITS ("studio other".audit_child)')
        else:
            conn.execute("DROP TABLE admin_audit")
            conn.execute("CREATE TABLE admin_audit (id int, action text) PARTITION BY RANGE (id)")
            conn.execute('CREATE TABLE "studio other".audit_child PARTITION OF admin_audit '
                         'FOR VALUES FROM (0) TO (100) PARTITION BY RANGE (id)')
            conn.execute('CREATE TABLE audit_leaf PARTITION OF "studio other".audit_child '
                         'FOR VALUES FROM (0) TO (100)')
        provision(db.url, db.role, db.password, restrict_large_objects=True)
        monkeypatch.setattr(studio, "_check", lambda *_: None)
        for statement in ("INSERT INTO audit_leaf VALUES (1, 'forged')",
                          "UPDATE audit_leaf SET action = 'forged'", "DELETE FROM audit_leaf"):
            with pytest.raises(studio.StudioError) as refused:
                studio.run("site", statement, write=True)
            assert refused.value.status == 403
        assert conn.execute("SELECT * FROM admin_audit").fetchall() == []
        assert studio.run("site", "SELECT * FROM audit_leaf").rows == []
        assert studio.run("site", "INSERT INTO ordinary(v) VALUES ('ok') RETURNING id", write=True).rows == [[1]]
        provision(db.url, db.role, db.password)
        assert studio.run("site", "UPDATE ordinary SET v = 'updated' RETURNING v", write=True).rows == [["updated"]]
        assert studio.run("site", "DELETE FROM ordinary", write=True).changes == 1


@pytest.mark.parametrize("root", ["admin_audit", "schema_migrations"])
@pytest.mark.parametrize("privilege", ["INSERT", "UPDATE (id)", "TRUNCATE", "TRIGGER", "REFERENCES", "REFERENCES (id)", "MAINTAIN"])
def test_provisioning_checks_effective_grants_on_descendants_in_other_schemas(studio_sandbox, root, privilege):
    db = studio_sandbox
    with psycopg.connect(db.url, autocommit=True) as conn:
        conn.execute(sql.SQL('CREATE TABLE "studio other".child () INHERITS ({})').format(sql.Identifier(root)))
        conn.execute('CREATE TABLE "studio other".leaf () INHERITS ("studio other".child)')
        conn.execute(sql.SQL('GRANT {} ON "studio other".leaf TO PUBLIC').format(sql.SQL(privilege)))
        with pytest.raises(StudioRoleError, match="grants.*bypass"):
            provision(db.url, db.role, db.password, restrict_large_objects=True)
        assert conn.execute(
            "SELECT has_any_column_privilege(%s, '\"studio other\".leaf', 'INSERT, UPDATE, REFERENCES') "
            "OR has_table_privilege(%s, '\"studio other\".leaf', 'TRUNCATE, TRIGGER, REFERENCES, MAINTAIN')", (db.role, db.role),
        ).fetchone() == (True,)


def test_provisioning_refuses_materialized_view_maintenance(studio_sandbox):
    db = studio_sandbox
    with psycopg.connect(db.url, autocommit=True) as conn:
        conn.execute("CREATE MATERIALIZED VIEW cached AS SELECT v FROM ordinary")
        conn.execute("GRANT MAINTAIN ON cached TO PUBLIC")
        with pytest.raises(StudioRoleError, match="grants.*bypass"):
            provision(db.url, db.role, db.password, restrict_large_objects=True)


@pytest.mark.parametrize(("source", "schema"), [
    ("schema_migrations", "public"), ("admin_audit", "public"),
    ("descendant", "studio other"), ("ordinary", "studio other"),
])
@pytest.mark.parametrize("column_grant", [False, True])
def test_provisioning_refuses_writable_user_views(studio_sandbox, source, schema, column_grant):
    db = studio_sandbox
    with psycopg.connect(db.url, autocommit=True) as conn:
        if source == "descendant":
            conn.execute("CREATE TABLE audit_child () INHERITS (admin_audit)")
            conn.execute("CREATE TABLE audit_leaf () INHERITS (audit_child)")
            source = "audit_leaf"
        conn.execute(sql.SQL("CREATE VIEW studio_base AS SELECT * FROM {}").format(sql.Identifier(source)))
        view = sql.Identifier(schema, "studio_view")
        conn.execute(sql.SQL("CREATE VIEW {} AS SELECT * FROM studio_base").format(view))
        provision(db.url, db.role, db.password, restrict_large_objects=True)
        privilege = "UPDATE (checksum)" if source == "schema_migrations" else "INSERT (id, action)"
        if source == "ordinary":
            privilege = "INSERT (v)"
        if not column_grant:
            privilege = privilege.split()[0]
        conn.execute(sql.SQL("GRANT {} ON {} TO PUBLIC").format(sql.SQL(privilege), view))
        # These owner-created nested views really are writable at the login
        # boundary; provisioning must refuse them even outside public.
        if source == "schema_migrations":
            statement = sql.SQL("UPDATE {} SET checksum = 'tampered'").format(view)
        elif source == "ordinary":
            statement = sql.SQL("INSERT INTO {}(v) VALUES ('test')").format(view)
        else:
            statement = sql.SQL("INSERT INTO {}(id, action) VALUES (42, 'forged')").format(view)
        assert studio.run("site", statement.as_string(conn), write=True).changes == 1
        if source == "schema_migrations":
            assert conn.execute("SELECT checksum FROM schema_migrations").fetchone() == ("tampered",)
        elif source != "ordinary":
            assert conn.execute("SELECT action FROM admin_audit").fetchone() == ("forged",)
        with pytest.raises(StudioRoleError, match="grants.*bypass"):
            provision(db.url, db.role, db.password)


def test_public_views_are_read_only_and_refresh_removes_direct_column_grants(studio_sandbox):
    db = studio_sandbox
    with psycopg.connect(db.url, autocommit=True) as conn:
        conn.execute("CREATE VIEW migration_alias AS SELECT * FROM schema_migrations")
        conn.execute("CREATE VIEW audit_alias AS SELECT * FROM admin_audit")
        provision(db.url, db.role, db.password, restrict_large_objects=True)
        conn.execute(sql.SQL("GRANT UPDATE (checksum) ON migration_alias TO {}").format(sql.Identifier(db.role)))
        conn.execute(sql.SQL("GRANT INSERT (id, action) ON audit_alias TO {}").format(sql.Identifier(db.role)))
        provision(db.url, db.role, db.password)
        for statement in ("UPDATE migration_alias SET checksum = 'tampered'",
                          "INSERT INTO audit_alias VALUES (1, 'forged')"):
            with pytest.raises(studio.StudioError) as refused:
                studio.run("site", statement, write=True)
            assert refused.value.status == 403
        assert studio.run("site", "SELECT checksum FROM migration_alias").rows == [["original"]]
        assert studio.run("site", "SELECT count(*) FROM pg_catalog.pg_settings").rows[0][0] > 0


LO_FUNCTIONS = ["lo_create(oid)", "lo_creat(integer)", "lo_from_bytea(oid,bytea)",
                "lo_import(text)", "lo_import(text,oid)"]


def test_stock_constructor_access_requires_explicit_setup(studio_sandbox):
    db = studio_sandbox
    with psycopg.connect(db.url) as conn:
        before = conn.execute("SELECT oid, proacl FROM pg_proc ORDER BY oid").fetchall()
        with pytest.raises(StudioRoleError, match="restrict-large-objects"):
            provision(db.url, db.role, db.password)
        assert conn.execute("SELECT oid, proacl FROM pg_proc ORDER BY oid").fetchall() == before
        # The pre-existing login is still usable; refusal did not silently
        # change PUBLIC grants for other logins.
        with psycopg.connect(db.login) as login:
            assert login.execute("SELECT lo_create(0) > 0").fetchone() == (True,)
            login.rollback()


@pytest.mark.parametrize("statement", [
    "SELECT lo_create(0)", "SELECT lo_creat(-1)", "SELECT lo_from_bytea(0, decode('6162', 'hex'))",
    "SELECT lo_import('/etc/hostname')", "SELECT lo_import('/etc/hostname', 0)",
])
def test_edit_select_cannot_create_owned_large_objects(studio_sandbox, statement):
    db = studio_sandbox
    provision(db.url, db.role, db.password, restrict_large_objects=True)
    with pytest.raises(studio.StudioError) as refused:
        studio.run("site", statement, write=True)
    assert refused.value.status == 403
    with psycopg.connect(db.url) as conn:
        assert conn.execute("SELECT count(*) FROM pg_largeobject_metadata").fetchone() == (0,)
    provision(db.url, db.role, db.password)


@pytest.mark.parametrize("function", LO_FUNCTIONS)
@pytest.mark.parametrize("grantee", ["PUBLIC", "studio"])
def test_provisioning_refuses_effective_constructor_access(studio_sandbox, function, grantee):
    db = studio_sandbox
    provision(db.url, db.role, db.password, restrict_large_objects=True)
    with psycopg.connect(db.url, autocommit=True) as conn:
        target = sql.SQL("PUBLIC") if grantee == "PUBLIC" else sql.Identifier(db.role)
        conn.execute(sql.SQL("GRANT EXECUTE ON FUNCTION pg_catalog.{} TO {}").format(sql.SQL(function), target))
        with pytest.raises(StudioRoleError, match="constructor grants.*bypass"):
            provision(db.url, db.role, db.password)
        if grantee == "studio":
            with pytest.raises(StudioRoleError, match="constructor grants.*bypass"):
                provision(db.url, db.role, db.password, restrict_large_objects=True)
        assert conn.execute("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (db.role, function)).fetchone() == (True,)


def test_explicit_setup_preserves_owner_direct_grants_and_unrelated_functions(studio_sandbox, monkeypatch):
    db = studio_sandbox
    owner = f"studio_owner_{os.getpid()}"
    other = f"studio_other_{os.getpid()}"
    with psycopg.connect(db.url, autocommit=True) as conn:
        original_owner = conn.execute("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()").fetchone()[0]
        conn.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD 'test-owner'").format(sql.Identifier(owner)))
        conn.execute(sql.SQL("CREATE ROLE {}").format(sql.Identifier(other)))
        conn.execute(sql.SQL("ALTER DATABASE {} OWNER TO {}").format(sql.Identifier(conn.info.dbname), sql.Identifier(owner)))
        try:
            conn.execute(sql.SQL("GRANT EXECUTE ON FUNCTION lo_creat(integer) TO {}").format(sql.Identifier(other)))
            before = conn.execute("SELECT oid, proacl FROM pg_proc WHERE proname NOT IN "
                                  "('lo_create', 'lo_creat', 'lo_from_bytea', 'lo_import') ORDER BY oid").fetchall()
            monkeypatch.setenv("DATABASE_URL", db.url)
            monkeypatch.setenv("DATABASE_STUDIO_PASSWORD", db.password)
            assert provision_main(["--role", db.role, "--restrict-large-objects"]) == 0
            assert provision_main(["--role", db.role]) == 0
            assert conn.execute("SELECT oid, proacl FROM pg_proc WHERE proname NOT IN "
                                "('lo_create', 'lo_creat', 'lo_from_bytea', 'lo_import') ORDER BY oid").fetchall() == before
            with psycopg.connect(make_conninfo(db.url, user=owner, password="test-owner")) as owner_conn:
                for statement in ("SELECT lo_create(0)", "SELECT lo_creat(-1)", "SELECT lo_from_bytea(0, 'abc')"):
                    assert owner_conn.execute(statement).fetchone()[0] > 0
                owner_conn.rollback()
            assert conn.execute("SELECT has_function_privilege(%s, 'lo_import(text)', 'EXECUTE')", (owner,)).fetchone() == (False,)
            assert conn.execute("SELECT has_function_privilege(%s, 'lo_creat(integer)', 'EXECUTE')", (other,)).fetchone() == (True,)
        finally:
            conn.execute(sql.SQL("ALTER DATABASE {} OWNER TO {}").format(sql.Identifier(conn.info.dbname), sql.Identifier(original_owner)))
            conn.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(owner)))
            conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(owner)))
            conn.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(other)))
            conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(other)))


def test_existing_large_object_ownership_is_refused_and_preserved(studio_sandbox):
    db = studio_sandbox
    with psycopg.connect(db.login) as login:
        oid = login.execute("SELECT lo_from_bytea(0, 'keep')").fetchone()[0]
    for explicit in (False, True):
        with pytest.raises(StudioRoleError, match="own nothing"):
            provision(db.url, db.role, db.password, restrict_large_objects=explicit)
    with psycopg.connect(db.url) as conn:
        assert bytes(conn.execute("SELECT lo_get(%s)", (oid,)).fetchone()[0]) == b"keep"


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
