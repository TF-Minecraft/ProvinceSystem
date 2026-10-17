"""0002 on data written at 0001: renamed entitlement tables, account times and spent code plaintext."""

from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from src.database import migrate


def _at(version: str, url: str, monkeypatch) -> None:
    files = [m for m in migrate.discover() if m.version <= version]
    monkeypatch.setattr(migrate, "discover", lambda directory=None: files)
    migrate.migrate(url)
    monkeypatch.undo()


def test_0002_keeps_account_data_and_clears_spent_plaintext(scratch_database, monkeypatch):
    url = scratch_database
    _at("0001", url, monkeypatch)
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO character_player_meta (player_uuid, max_alive_characters, eighteen, real_age_set, "
                     "account_created_at_epoch, name_colour_stops, wardrobe_skin_slots, kit_cooldowns_json, updated_at) "
                     "VALUES ('a', 5, true, true, 1789844555, 20, 3, '{\"k\": 1}', now()), "
                     "('b', NULL, NULL, false, 0, NULL, NULL, NULL, now())")
        conn.execute("INSERT INTO rpc_player_meta (player_uuid, realm_id, skin_kinds_json, permission_flags_json, updated_at) "
                     "VALUES ('a', 'main', '[\"book\"]', '{\"tfmc.map.staff\": true}', now())")
        for code_id, extra in enumerate(["open", "revoked", "expired", "redeemed", "used"], start=1):
            conn.execute(
                "INSERT INTO codes (id, code_hash, code_plaintext, player_uuid, scope, created_at, expires_at, "
                "redeemed_at, revoked) VALUES (%s, %s, %s, 'a', 'skin', now(), now() + %s::interval, %s, %s)",
                (code_id, extra, extra, "-1 hour" if extra == "expired" else "1 hour",
                 datetime.now(timezone.utc) if extra == "redeemed" else None, extra == "revoked"))
        conn.execute("INSERT INTO submissions (id, player_uuid, code_id, kind, slug, display_name, status, dir_path, "
                     "created_at) VALUES ('s', 'a', 5, 'book', 'b', 'B', 'pending', 'd', now())")
    migrate.migrate(url)
    with psycopg.connect(url, row_factory=dict_row) as conn:
        accounts = conn.execute("SELECT * FROM character_account_meta ORDER BY player_uuid").fetchall()
        entitlements = conn.execute("SELECT skin_kinds, permission_flags FROM web_entitlements").fetchone()
        kept = [r["code_plaintext"] for r in conn.execute("SELECT code_plaintext FROM codes WHERE code_plaintext IS NOT NULL")]
    assert set(accounts[0]) == {"player_uuid", "is_adult", "real_age_set", "account_created_at",
                                "kit_cooldown_seconds_remaining", "kit_cooldown_hours", "kit_cooldowns", "updated_at"}
    assert (accounts[0]["is_adult"], accounts[0]["kit_cooldowns"]) == (True, {"k": 1})
    assert accounts[0]["account_created_at"] == datetime.fromtimestamp(1789844555, timezone.utc)
    assert accounts[1]["account_created_at"] is None
    assert entitlements == {"skin_kinds": ["book"], "permission_flags": {"tfmc.map.staff": True}}
    assert kept == ["open"]
