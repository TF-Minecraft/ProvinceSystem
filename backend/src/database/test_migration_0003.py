"""0003 on data written at 0002: renamed tables, epoch times as timestamptz, the view tag split."""

from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from src.database import migrate


def _at(version: str, url: str, monkeypatch) -> None:
    files = [m for m in migrate.discover() if m.version <= version]
    monkeypatch.setattr(migrate, "discover", lambda directory=None: files)
    migrate.migrate(url)
    monkeypatch.undo()


def _utc(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds, timezone.utc)


def test_0003_converts_times_and_keeps_rows(scratch_database, monkeypatch):
    url = scratch_database
    _at("0002", url, monkeypatch)
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO character_roster (player_uuid, realm_id, character_id, name, status, created_at, "
                     "updated_at) VALUES ('p', 'main', 'a', 'A', 'ALIVE', '1789836703', now()), "
                     "('p', 'main', 'b', 'B', 'ALIVE', 'not a time', now()), ('p', 'main', 'c', 'C', 'ALIVE', NULL, now())")
        conn.execute("INSERT INTO map_chronicle_snapshots (map_id, day, realm_id, captured_at, bytes, manifest) "
                     "VALUES ('main', '2026-10-01', 'main', 1789776019, 1, '{}')")
        conn.execute("INSERT INTO map_chronicle_snapshots_archive (map_id, day, realm_id, captured_at, bytes, manifest, "
                     "archived_at) VALUES ('main', '2026-09-01', 'main', 1788296699, 1, '{}', 1789837545)")
        conn.execute("INSERT INTO map_chronicle_wipes (map_id, wiped_at, wiped_by, day_count, reason, restored_at) "
                     "VALUES ('main', 1789837545, 'staff', 1, 'r', NULL)")
        conn.execute("INSERT INTO lp_state (id, generated_at) VALUES (1, 1792237088)")
        conn.execute("INSERT INTO map_ledger_days (map_id, day, captured_at, captured_at_ts, complete, schema_version, "
                     "faction_count, guild_count, globals) VALUES ('main', '2026-10-01', to_timestamp(1789776019.5), "
                     "1789776019, true, 1, 0, 0, '{}')")
        for code_id, minted in enumerate([None, "site", "staff_view:40"], start=1):
            conn.execute("INSERT INTO codes (id, code_hash, player_uuid, scope, created_at, expires_at, minted_via) "
                         "VALUES (%s, %s, 'p', 'profile', now(), now(), %s)", (code_id, f"h{code_id}", minted))
        conn.execute("INSERT INTO lp_user_nodes (uuid, key, value, contexts, expiry) VALUES "
                     "('u', 'group.noble', true, '{}', 0), ('u', 'group.noble', true, '{}', 1792470737)")
    migrate.migrate(url)
    with psycopg.connect(url, row_factory=dict_row) as conn:
        roster = {r["character_id"]: r["created_at"] for r in conn.execute("SELECT * FROM character_roster")}
        snapshot = conn.execute("SELECT captured_at FROM map_chronicle_snapshots").fetchone()
        archive = conn.execute("SELECT captured_at, archived_at FROM map_chronicle_snapshots_archive").fetchone()
        wipe = conn.execute("SELECT wiped_at, restored_at FROM map_chronicle_wipes").fetchone()
        generated = conn.execute("SELECT generated_at FROM lp_state").fetchone()["generated_at"]
        day = conn.execute("SELECT * FROM map_ledger_days").fetchone()
        codes = conn.execute("SELECT id, minted_via, view_session_id FROM login_codes ORDER BY id").fetchall()
        nodes = conn.execute("SELECT count(*) AS n FROM lp_user_nodes").fetchone()["n"]
    assert roster == {"a": _utc(1789836703), "b": None, "c": None}
    assert snapshot["captured_at"] == _utc(1789776019)
    assert archive == {"captured_at": _utc(1788296699), "archived_at": _utc(1789837545)}
    assert wipe == {"wiped_at": _utc(1789837545), "restored_at": None}
    assert generated == _utc(1792237088)
    assert "captured_at_ts" not in day
    assert [(c["minted_via"], c["view_session_id"]) for c in codes] == [(None, None), ("site", None), ("staff_view", 40)]
    assert nodes == 2
