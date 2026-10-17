"""Copy real SQLite files into isolated PG17 databases, including failure paths."""
from contextlib import closing
from datetime import datetime, timezone
import json
import sqlite3

import psycopg
import pytest

from src.database import migrate
from src.scripts.tools import copy_province_db as copy

UTC = timezone.utc
NOW = "2026-10-16T12:34:56Z"


@pytest.fixture
def legacy(tmp_path):
    path = tmp_path / "province.db"
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript(copy.LEGACY_SCHEMA.read_text())
    return path


def insert(path, table, **values):
    names = ", ".join(copy._quote(name) for name in values)
    marks = ", ".join("?" for _ in values)
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.execute(f"INSERT INTO {copy._quote(table)} ({names}) VALUES ({marks})", tuple(values.values()))


def code(path, **extra):
    insert(path, "codes", **dict(code_hash="hash", player_uuid="player", created_at=NOW,
                                expires_at="2026-10-17T12:34:56+00:00", **extra))


def assert_unmigrated(url):
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT to_regclass('public.schema_migrations')").fetchone() == (None,)


def test_round_trip_preserves_types_duplicates_counters_and_new_writes(legacy, scratch_database, tmp_path):
    url = scratch_database
    code(legacy, id=4)
    insert(legacy, "sessions", token_hash="session", code_id=4, player_uuid="player",
           created_at="2026-10-16T12:34:56.123+00:00", expires_at="2026-10-17T12:34:56.123456Z")
    insert(legacy, "character_roster", player_uuid="player", realm_id="main", character_id="one",
           name="Élodie", status="ALIVE", created_at="1700000000", updated_at=NOW,
           sheet_json='{"z":1.0,"a":{"n":123456789012345678901234567890,"f":1e-8}}')
    insert(legacy, "map_ledger_days", map_id="main", day="1", captured_at="2026-10-16T12:34:56.9999995Z",
           captured_at_ts=1, complete=1, globals='{"amount":1e2,"zero":-0.0}')
    for _ in range(2):
        insert(legacy, "lp_user_nodes", uuid="player", key="example", value=1, contexts='{"server":"dev"}', expiry=0)
    insert(legacy, "admin_audit", id=9, created_at=NOW, actor_type="system", action="copy", outcome="ok")
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE sqlite_sequence SET seq=99 WHERE name='codes'")
    original = legacy.read_bytes()
    with psycopg.connect(url) as conn:
        conn.execute("CREATE TABLE precedent_keep (body text)")
        conn.execute("INSERT INTO precedent_keep VALUES ('untouched')")
    report = copy.to_postgres(legacy, url)
    assert len(report.checks) == 61 and all(check.matches for check in report.checks)
    assert report.rounded_rows == 1
    copy.to_postgres(legacy, url, verify_only=True)
    assert legacy.read_bytes() == original
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT created_at, revoked FROM codes").fetchone() == (datetime(2026, 10, 16, 12, 34, 56, tzinfo=UTC), False)
        assert conn.execute("SELECT captured_at, complete FROM map_ledger_days").fetchone() == (datetime(2026, 10, 16, 12, 34, 57, tzinfo=UTC), True)
        assert conn.execute("SELECT created_at FROM character_roster").fetchone() == ("1700000000",)
        assert conn.execute("SELECT body FROM precedent_keep").fetchone() == ("untouched",)
        assert conn.execute("SELECT count(*) FROM lp_user_nodes").fetchone() == (2,)
        # A post-cutover write must survive rollback, with the deleted-id high-water mark.
        assert conn.execute("INSERT INTO codes(code_hash,player_uuid,created_at,expires_at) "
                            "VALUES ('new','new',%s,%s) RETURNING id", (NOW, NOW)).fetchone() == (100,)
        conn.execute("INSERT INTO admin_audit(created_at,actor_type,action,outcome) VALUES (%s,'system','new','ok')", (NOW,))
    rollback = tmp_path / "rollback.db"
    restored = copy.to_sqlite(rollback, url)
    assert len(restored.checks) == 61 and all(check.matches for check in restored.checks)
    assert rollback.stat().st_mode & 0o777 == 0o600
    with closing(sqlite3.connect(rollback)) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT seq FROM sqlite_sequence WHERE name='codes'").fetchone() == (100,)
        assert conn.execute("SELECT count(*) FROM admin_audit").fetchone() == (2,)
        sheet = conn.execute("SELECT sheet_json FROM character_roster").fetchone()[0]
        assert sheet == '{"a":{"f":0.00000001,"n":123456789012345678901234567890},"z":1.0}'
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='precedent_keep'").fetchall() == []
    copy.to_postgres(rollback, url, verify_only=True)


@pytest.mark.parametrize(("value", "expected"), [
    ("2026-10-16T12:34:56Z", (56, 0)),
    ("2026-10-16T12:34:56.123Z", (56, 123000)),
    ("2026-10-16T12:34:56.123456+00:00", (56, 123456)),
    ("2026-10-16T12:34:56.0000005Z", (56, 0)),
    ("2026-10-16T12:34:56.0000015Z", (56, 2)),
    ("2026-10-16T12:34:56.1234565Z", (56, 123456)),
    ("2026-10-16T12:34:56.1234575Z", (56, 123458)),
    ("2026-10-16T12:34:56.123456789Z", (56, 123457)),
    ("2026-10-16T12:34:56.9999995Z", (57, 0)),
])
def test_timestamp_rounding_matches_postgres(value, expected, scratch_database):
    converted = copy._timestamp(value)
    assert (converted.second, converted.microsecond) == expected
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT %s::timestamptz", (value,)).fetchone() == (converted,)


@pytest.mark.parametrize(("column", "value"), [
    ("code_hash", "secret\x00value"),
    ("revoked", 2),
    ("revoked", 0.5),
    ("created_at", "2026-10-16 12:34:56Z"),
    ("created_at", "2026-10-16T12:34:56+01:00"),
    ("created_at", "2026-10-16T12:34:56.1234567890Z"),
    ("created_at", "2026-02-30T12:34:56Z"),
])
def test_invalid_values_fail_before_target_migrations(legacy, scratch_database, column, value):
    code(legacy)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute(f"UPDATE codes SET {copy._quote(column)}=?", (value,))
    with pytest.raises(copy.CopyError, match=f"codes rowid 1, column {column}:"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


@pytest.mark.parametrize("value", ['{"a":NaN}', '{"a":Infinity}', '{"a":-Infinity}',
                                  '{"a":"\\u0000"}', '{"\\u0000":"a"}', '{"a":"\\ud800"}',
                                  '{"a":1e131072}', '{"a":1e-16384}', '{"a":1e9999999999999999999}',
                                  '{"a":0e1073741824}', '{"a":0.0e1073741824}', '{"a":0e-16384}', '{broken'])
def test_invalid_json_fails_before_target_migrations(legacy, scratch_database, value):
    insert(legacy, "admin_audit", created_at=NOW, actor_type="system", action="copy", outcome="ok", detail_json=value)
    with pytest.raises(copy.CopyError, match="admin_audit rowid 1, column detail_json:"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


def test_invalid_utf8_is_refused_without_exposing_value(legacy, scratch_database):
    code(legacy)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE codes SET code_hash=CAST(x'736563726574ff' AS TEXT)")
    with pytest.raises(copy.CopyError, match="codes rowid 1, column code_hash: invalid text") as exc:
        copy.to_postgres(legacy, scratch_database)
    assert "secret" not in str(exc.value)
    assert_unmigrated(scratch_database)


def test_invalid_counter_and_foreign_key_fail_before_migrations(legacy, scratch_database):
    code(legacy)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE sqlite_sequence SET seq=-1 WHERE name='codes'")
    with pytest.raises(copy.CopyError, match="invalid sqlite_sequence"):
        copy.to_postgres(legacy, scratch_database)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE sqlite_sequence SET seq=1 WHERE name='codes'")
    insert(legacy, "sessions", token_hash="s", code_id=999, player_uuid="p", created_at=NOW, expires_at=NOW)
    with pytest.raises(copy.CopyError, match="sessions rowid 1: foreign_key_check"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


def test_out_of_range_integer_fails_before_migrations(legacy, scratch_database):
    # SQLite INTEGER affinity stores this overflowing decimal as a float.
    insert(legacy, "lp_state", id=1, generated_at="9223372036854775808")
    with pytest.raises(copy.CopyError, match="column generated_at: expected a signed 64-bit integer"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


def test_deleted_identity_high_water_survives_even_when_table_is_empty(legacy, scratch_database, tmp_path):
    code(legacy, id=500)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("DELETE FROM codes")
    copy.to_postgres(legacy, scratch_database)
    rollback = tmp_path / "rollback.db"
    copy.to_sqlite(rollback, scratch_database)
    code(rollback)
    with closing(sqlite3.connect(rollback)) as conn:
        assert conn.execute("SELECT id FROM codes").fetchone() == (501,)
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("INSERT INTO codes(code_hash,player_uuid,created_at,expires_at) "
                            "VALUES ('new','new',%s,%s) RETURNING id", (NOW, NOW)).fetchone() == (501,)


@pytest.mark.parametrize("table", ["patreon_alerts", "will_requests", "lp_changes"])
def test_new_partial_unique_constraints_are_checked_before_migrations(legacy, scratch_database, table):
    rows = {
        "patreon_alerts": dict(kind="same", message="alert", created_at=NOW),
        "will_requests": dict(realm_id="main", character_id="one", account_uuid="p", base_revision=0,
                              created_at=NOW, status="pending"),
        "lp_changes": dict(created_at=NOW, actor_user_id=1, target_type="user", target="one",
                           description="change", ops_json="[]", reason="test"),
    }
    for index in range(2):
        insert(legacy, table, **rows[table], **({"id": str(index)} if table == "will_requests" else {}))
    with pytest.raises(copy.CopyError, match=f"{table} rowid 2: duplicate open rows"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


def test_lowercase_links_required_and_newest_microsoft_state_kept(legacy, scratch_database):
    insert(legacy, "discord_links", player_uuid="ABC", discord_user_id="one", linked_at=NOW)
    with pytest.raises(copy.CopyError, match="column player_uuid: expected lower case"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE discord_links SET player_uuid='abc'")
    for state in ("first", "newest"):
        insert(legacy, "microsoft_link_states", state_hash=state, session_id=1, user_id=1,
               code_verifier="verifier", expires_at=NOW)
    report = copy.to_postgres(legacy, scratch_database)
    assert report.discarded_microsoft_states == 1
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT state_hash FROM microsoft_link_states").fetchall() == [("newest",)]


def test_target_refuses_existing_rows_and_checks_verification_mismatches(legacy, scratch_database):
    code(legacy)
    copy.to_postgres(legacy, scratch_database)
    with pytest.raises(copy.CopyError, match="target site tables must be empty"):
        copy.to_postgres(legacy, scratch_database)
    with psycopg.connect(scratch_database) as conn:
        conn.execute("UPDATE codes SET player_uuid='changed'")
    with pytest.raises(copy.CopyError, match="SHA-256 mismatch: codes"):
        copy.to_postgres(legacy, scratch_database, verify_only=True)
    with psycopg.connect(scratch_database) as conn:
        conn.execute("UPDATE codes SET player_uuid='player'")
        conn.execute("SELECT setval('codes_id_seq', 123, true)")
    with pytest.raises(copy.CopyError, match="codes: identity high-water mark differs"):
        copy.to_postgres(legacy, scratch_database, verify_only=True)


def test_late_copy_failure_rolls_back_all_rows_and_retry_succeeds(legacy, scratch_database, monkeypatch):
    code(legacy)
    insert(legacy, "admin_audit", created_at=NOW, actor_type="system", action="copy", outcome="ok")
    migrate.migrate(scratch_database)
    insert(legacy, "sessions", token_hash="s", code_id=1, player_uuid="p", created_at=NOW, expires_at=NOW)
    require_current = copy._require_current

    def reject_after_schema_verification(conn, tables):
        require_current(conn, tables)
        # Inject a real COPY error after preflight. A drifted target would now
        # be refused before loading, so install this inside the copy transaction.
        conn.execute("ALTER TABLE sessions ADD CONSTRAINT reject_source CHECK(false)")

    monkeypatch.setattr(copy, "_require_current", reject_after_schema_verification)
    with pytest.raises(psycopg.errors.CheckViolation):
        copy.to_postgres(legacy, scratch_database)
    monkeypatch.setattr(copy, "_require_current", require_current)
    with psycopg.connect(scratch_database) as conn:
        for table in copy.specifications():
            assert conn.execute(f'SELECT count(*) FROM "{table.name}"').fetchone() == (0,)
        assert conn.execute("SELECT 1 FROM pg_constraint WHERE conname='reject_source'").fetchall() == []
    assert all(check.matches for check in copy.to_postgres(legacy, scratch_database).checks)


def test_rollback_does_not_replace_existing_or_publish_unverified_file(legacy, scratch_database, tmp_path, monkeypatch):
    copy.to_postgres(legacy, scratch_database)
    target = tmp_path / "rollback.db"
    target.write_bytes(b"keep me")
    with pytest.raises(copy.CopyError, match="already exists"):
        copy.to_sqlite(target, scratch_database)
    assert target.read_bytes() == b"keep me"
    target.unlink()

    def fail(*_args, **_kwargs):
        raise copy.CopyError("verification failed")

    monkeypatch.setattr(copy, "_verify", fail)
    with pytest.raises(copy.CopyError, match="verification failed"):
        copy.to_sqlite(target, scratch_database)
    assert not target.exists() and list(tmp_path.glob(".province-rollback-*")) == []


def test_rollback_publish_refuses_a_concurrently_created_destination(legacy, scratch_database, tmp_path, monkeypatch):
    copy.to_postgres(legacy, scratch_database)
    target = tmp_path / "rollback.db"
    original_link = copy.os.link

    def race(source, destination):
        target.write_bytes(b"created by another operator")
        original_link(source, destination)

    monkeypatch.setattr(copy.os, "link", race)
    with pytest.raises(FileExistsError):
        copy.to_sqlite(target, scratch_database)
    assert target.read_bytes() == b"created by another operator"
    assert list(tmp_path.glob(".province-rollback-*")) == []


def test_legacy_tables_and_retired_column_are_archived_privately(legacy, scratch_database, tmp_path):
    insert(legacy, "discord_links", player_uuid="p", discord_user_id="d", linked_at=NOW)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("ALTER TABLE discord_links ADD COLUMN player_key TEXT")
        conn.execute("UPDATE discord_links SET player_key='retired-value'")
        conn.execute('CREATE TABLE "../../escape"(old BLOB)')
        conn.execute('INSERT INTO "../../escape" VALUES (?)', (b"binary\x00",))
    archive = tmp_path / "archive"
    report = copy.to_postgres(legacy, scratch_database, archive_legacy=archive)
    assert report.legacy == ["../../escape", "discord_links.player_key"]
    assert archive.stat().st_mode & 0o777 == 0o700
    files = sorted(archive.iterdir())
    assert [p.name for p in files] == ["legacy-0001.json", "legacy-0002.json"]
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in files)
    data = [json.loads(p.read_text()) for p in files]
    assert data[0]["rows"] == [[{"blob_hex": "62696e61727900"}]]
    assert data[1]["legacy_columns"] == ["player_key"]
    assert data[1]["rows"][0][-1] == "retired-value"
    # Identical retry is safe; mismatched archives and permissive directories refuse.
    with closing(copy._open_sqlite(legacy)) as conn:
        source = copy._source(conn, copy.specifications())
        copy._archive(conn, source, archive)
        files[0].write_text("different")
        with pytest.raises(copy.CopyError, match="different or non-private"):
            copy._archive(conn, source, archive)
        archive.chmod(0o755)
        with pytest.raises(copy.CopyError, match="must be private"):
            copy._archive(conn, source, archive)


def test_unknown_column_and_native_shape_drift_are_refused(legacy, scratch_database):
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("ALTER TABLE codes ADD COLUMN surprise TEXT")
    with pytest.raises(copy.CopyError, match="source columns do not match"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("ALTER TABLE codes DROP COLUMN surprise")
    migrate.migrate(scratch_database)
    with psycopg.connect(scratch_database) as conn:
        conn.execute("ALTER TABLE codes ADD COLUMN surprise TEXT")
    with pytest.raises(copy.CopyError, match="native schema no longer matches"):
        copy.to_postgres(legacy, scratch_database)
    with psycopg.connect(scratch_database) as conn:
        conn.execute("ALTER TABLE codes DROP COLUMN surprise")
        conn.execute("UPDATE schema_migrations SET checksum='different'")
    with pytest.raises(copy.CopyError, match="migration history does not match"):
        copy.to_postgres(legacy, scratch_database, verify_only=True)


def test_cli_reports_all_tables_and_errors_hide_source_values(legacy, scratch_database, capsys):
    assert copy.main(["to-postgres", "--sqlite", str(legacy), "--database-url", scratch_database]) == 0
    output = capsys.readouterr().out
    assert "verified 61 tables" in output and "source_rows\ttarget_rows\tsha256" in output
    code(legacy, code_plaintext="private-value")
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE codes SET code_hash=?", ("private-value\x00",))
    with pytest.raises(SystemExit) as exc:
        copy.main(["to-postgres", "--sqlite", str(legacy), "--database-url", scratch_database])
    assert exc.value.code == 1
    error = capsys.readouterr().err
    assert "codes rowid 1, column code_hash" in error
    assert "private-value" not in error and scratch_database not in error


def test_cli_connection_errors_do_not_echo_connection_credentials(legacy, capsys, monkeypatch):
    def fail(*_args, **_kwargs):
        raise psycopg.OperationalError("password=private-credential")

    monkeypatch.setattr(copy, "to_postgres", fail)
    with pytest.raises(SystemExit) as exc:
        copy.main(["to-postgres", "--sqlite", str(legacy), "--database-url", "password=private-credential"])
    assert exc.value.code == 1
    assert capsys.readouterr().err == "copy failed: Postgres OperationalError\n"


@pytest.mark.parametrize("value", [
    '{"a":"\\u0000","a":1}',
    '{"a":"\\ud800","a":1}',
    '{"a":{"\\u0000":1},"a":1}',
    '{"a":["\\u0000"],"a":1}',
    '{"a":1e131072,"a":1}',
])
def test_overwritten_json_members_are_validated_before_migrations(legacy, scratch_database, value):
    insert(legacy, "admin_audit", created_at=NOW, actor_type="system", action="copy", outcome="ok", detail_json=value)
    with pytest.raises(copy.CopyError, match="column detail_json:"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


def test_valid_duplicate_json_keys_keep_postgres_last_value_semantics(legacy, scratch_database):
    insert(legacy, "admin_audit", created_at=NOW, actor_type="system", action="copy", outcome="ok",
           detail_json='{"a":[{"x":1}],"a":2}')
    assert all(check.matches for check in copy.to_postgres(legacy, scratch_database).checks)
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT detail_json FROM admin_audit").fetchone() == ({"a": 2},)


@pytest.mark.parametrize("number", ["0e131072", "-0e131072", "0e1073741823", "0.00e1073741823"])
def test_exact_zero_json_exponents_match_postgres_and_round_trip(legacy, scratch_database, tmp_path, number):
    value = '{"n":' + number + '}'
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT %s::jsonb", (value,)).fetchone() == ({"n": 0},)
    insert(legacy, "admin_audit", created_at=NOW, actor_type="system", action="copy", outcome="ok", detail_json=value)
    original = legacy.read_bytes()
    assert all(check.matches for check in copy.to_postgres(legacy, scratch_database).checks)
    copy.to_postgres(legacy, scratch_database, verify_only=True)
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT detail_json FROM admin_audit").fetchone() == ({"n": 0},)
    rollback = tmp_path / "rollback.db"
    assert all(check.matches for check in copy.to_sqlite(rollback, scratch_database).checks)
    copy.to_postgres(rollback, scratch_database, verify_only=True)
    assert legacy.read_bytes() == original


def test_duplicate_sequence_names_fail_before_migrations(legacy, scratch_database):
    code(legacy)
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("UPDATE sqlite_sequence SET seq=500 WHERE name='codes'")
        conn.execute("INSERT INTO sqlite_sequence VALUES ('codes', 1)")
    with pytest.raises(copy.CopyError, match="sqlite_sequence.*duplicate"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


@pytest.mark.parametrize("storage", ["VIRTUAL", "STORED"])
def test_generated_source_columns_cannot_be_silently_dropped(legacy, scratch_database, storage):
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute(f"ALTER TABLE codes ADD COLUMN surprise TEXT GENERATED ALWAYS AS ('extra') {storage}")
    code(legacy)
    with pytest.raises(copy.CopyError, match="codes: source columns do not match"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


def test_retired_source_column_must_not_be_generated(legacy, scratch_database):
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.execute("ALTER TABLE discord_links ADD COLUMN player_key TEXT GENERATED ALWAYS AS (player_uuid) VIRTUAL")
    with pytest.raises(copy.CopyError, match="discord_links: source columns do not match"):
        copy.to_postgres(legacy, scratch_database)
    assert_unmigrated(scratch_database)


@pytest.mark.parametrize("change", [
    "ALTER TABLE codes ALTER COLUMN scope SET DEFAULT 'profile'",
    "ALTER SEQUENCE codes_id_seq INCREMENT BY 3",
    "DROP INDEX idx_patreon_alerts_open",
    "ALTER TABLE admin_audit DISABLE TRIGGER admin_audit_no_change",
    "ALTER TABLE sessions DISABLE TRIGGER ALL",
    "ALTER TABLE sessions DROP CONSTRAINT sessions_code_id_fkey",
    "CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger LANGUAGE plpgsql "
    "AS 'BEGIN RETURN NEW; END'",
])
def test_behavioral_native_schema_drift_is_refused(legacy, scratch_database, change):
    code(legacy)
    migrate.migrate(scratch_database)
    with psycopg.connect(scratch_database) as conn:
        conn.execute(change)
    with pytest.raises(copy.CopyError, match="native schema.*differ"):
        copy.to_postgres(legacy, scratch_database)
    with psycopg.connect(scratch_database) as conn:
        assert conn.execute("SELECT count(*) FROM codes").fetchone() == (0,)


def test_legacy_archive_includes_standalone_indexes_and_triggers(legacy, scratch_database, tmp_path):
    with closing(sqlite3.connect(legacy)) as conn, conn:
        conn.executescript("""
            CREATE TABLE retired (name TEXT, value INTEGER);
            CREATE UNIQUE INDEX retired_name ON retired(name);
            CREATE TRIGGER retired_increment AFTER INSERT ON retired BEGIN
                UPDATE retired SET value = value + 1 WHERE rowid = NEW.rowid;
            END;
            INSERT INTO retired VALUES ('old', 0);
        """)
    archive = tmp_path / "archive"
    copy.to_postgres(legacy, scratch_database, archive_legacy=archive)
    payload = json.loads((archive / "legacy-0001.json").read_text())
    assert {obj["name"] for obj in payload.get("objects", [])} == {"retired_name", "retired_increment"}
    with closing(sqlite3.connect(":memory:")) as restored:
        restored.execute(payload["sql"])
        restored.executemany("INSERT INTO retired VALUES (?, ?)", payload["rows"])
        for obj in payload["objects"]:
            restored.execute(obj["sql"])
        assert restored.execute("SELECT value FROM retired").fetchone() == (1,)
        with pytest.raises(sqlite3.IntegrityError):
            restored.execute("INSERT INTO retired VALUES ('old', 0)")
        restored.execute("INSERT INTO retired VALUES ('new', 0)")
        assert restored.execute("SELECT value FROM retired WHERE name='new'").fetchone() == (1,)
