"""The site schema: collation, seeds, identities, foreign keys and the append-only admin_audit."""

import psycopg
import pytest

from src import database

pytestmark = pytest.mark.usefixtures("postgres")


def test_text_sorts_by_code_point():
    with database.connect() as conn:
        loose = [f"{r['table_name']}.{r['column_name']}" for r in conn.execute(
            "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' "
            "AND data_type = 'text' AND collation_name IS DISTINCT FROM 'C' AND table_name <> 'schema_migrations'")]
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
        conn.execute("INSERT INTO login_codes (id, code_hash, player_uuid, created_at, expires_at) "
                     "VALUES (41, 'h1', 'p', now(), now())")
        conn.execute("SELECT setval(pg_get_serial_sequence('login_codes', 'id'), 41)")
        row = conn.execute("INSERT INTO login_codes (code_hash, player_uuid, created_at, expires_at) "
                           "VALUES ('h2', 'p', now(), now()) RETURNING id, revoked, scope").fetchone()
    assert row == {"id": 42, "revoked": False, "scope": "skin"}


def test_foreign_keys_are_enforced():
    with pytest.raises(database.ForeignKeyViolation):
        with database.connect() as conn:
            conn.execute("INSERT INTO code_sessions (token_hash, code_id, player_uuid, expires_at, created_at) "
                         "VALUES ('t', 99, 'p', now(), now())")


def _audit(conn):
    return conn.execute(
        "INSERT INTO admin_audit (created_at, actor_type, action, outcome, detail) "
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
        rows = conn.execute("SELECT id, reason, detail FROM admin_audit").fetchall()
    assert rows == [{"id": audit_id, "reason": None, "detail": {"database": "site"}}]


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
