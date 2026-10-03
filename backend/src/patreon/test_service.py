from dataclasses import replace
from datetime import timedelta
import json
import uuid
import pytest
from src.patreon import service as s
from src.patreon.config import Config
from src.patreon.resolver import iso, utcnow

CONFIG = Config(enabled=True, apply=True)


def player(n=1):
    return str(uuid.UUID(int=n))


def member(user="1", tier="noble", discord="111", status="active_patron", **kwargs):
    ids = {"noble": "25226332", "gilded": "25226340", "ascended": "25226353"}
    return {"member_id": "m" + user, "patreon_user_id": user, "email": f"patron{user}@example.com", "full_name": "Patron " + user, "tiers": [{"id": ids[tier]}] if tier else [], "patron_status": status, "discord_user_id": discord, **kwargs}


class FakeClient:
    def __init__(self, rows, fail=False):
        self.rows, self.fail = rows, fail
    def members(self):
        if self.fail:
            raise RuntimeError("sensitive@example.com secret-token")
        return self.rows
    def member(self, member_id):
        return next(m for m in self.rows if m["member_id"] == member_id)


def sync(rows, config=CONFIG):
    result = s.sync_now(config=config, client=FakeClient(rows))
    assert result["ok"], result
    return result


def changes(target="discord", config=CONFIG):
    return s.list_changes(target, config=config)["changes"]


def ack(rows, target="discord", config=CONFIG):
    return s.ack_changes(target, [r["id"] for r in rows], config=config)


def snapshot(database):
    with database.connect() as conn:
        return {table: [tuple(r) for r in conn.execute("SELECT * FROM " + table)] for table in ("patreon_members", "patreon_applied", "patreon_desired", "patreon_changes", "patreon_links")}


def test_auto_link_and_ack_only_applied(database):
    sync([member(is_gifted=True, last_charge_status=None)])
    assert s.status(discord_user_id="111", config=CONFIG)["is_gifted"]
    assert s.roster("discord", config=CONFIG)["members"] == []
    rows = changes()
    assert rows[0]["add_tier"] == "noble" and rows[0]["remove_tiers"] == []
    ack(rows)
    assert s.roster("discord", config=CONFIG)["members"] == [{"discord_user_id": "111", "tier_key": "noble"}]
    assert changes() == []
    ack(rows)
    assert changes() == []


def test_pending_change_coalesces_and_removes_only_acknowledged(database):
    sync([member()])
    sync([member(tier="ascended")])
    rows = changes()
    assert len(rows) == 1 and rows[0]["add_tier"] == "ascended" and rows[0]["remove_tiers"] == []
    ack(rows)
    sync([member(tier="gilded")])
    row = changes()[0]
    assert row["remove_tiers"] == ["ascended"] and row["dm"] == "tier_changed"
    ack([row])
    sync([member(tier=None, status="former_patron")])
    row = changes()[0]
    assert row["remove_tiers"] == ["gilded"] and row["add_tier"] is None and row["dm"] == "perks_ended"
    ack([row])
    assert s.roster("discord", config=CONFIG)["members"][0]["tier_key"] is None


def test_dispatched_row_immutable_and_stale_ack_replans_latest(database):
    sync([member()])
    old = changes()
    sync([member(tier="ascended")])
    assert changes() == old
    ack(old)
    newer = changes()
    assert newer[0]["id"] != old[0]["id"] and newer[0]["add_tier"] == "ascended" and newer[0]["remove_tiers"] == ["noble"]
    ack(newer)
    ack(old)
    assert changes() == [] and s.roster("discord", config=CONFIG)["members"][0]["tier_key"] == "ascended"


def test_dispatched_grant_then_unlink_removes_after_ack(database):
    sync([member()])
    old = changes()
    assert s.unlink(discord_user_id="111", config=CONFIG) == {"unlinked": True}
    ack(old)
    end = changes()
    assert end[0]["remove_tiers"] == ["noble"] and end[0]["add_tier"] is None
    ack(end)
    assert not s.status(discord_user_id="111", config=CONFIG)["linked"]


def test_failed_sync_retains_members_applied_and_no_sensitive_logs(database, caplog):
    sync([member()])
    ack(changes())
    before = snapshot(database)
    for _ in range(3):
        assert not s.sync_now(config=CONFIG, client=FakeClient([], fail=True))["ok"]
        assert snapshot(database) == before
    assert s.health(CONFIG)["consecutive_failures"] == 3 and s.alerts()["alerts"][0]["kind"] == "sync_failed"
    assert "sensitive@example.com" not in caplog.text and "secret-token" not in caplog.text
    sync([member()])
    assert s.health(CONFIG)["consecutive_failures"] == 0


def test_declined_notification_once_then_expiry(database):
    sync([member()])
    ack(changes())
    declined = member(tier=None, status="declined_patron")
    sync([declined])
    notification = changes()
    assert notification[0]["dm"] == "payment_declined" and notification[0]["grace_until"]
    assert notification[0]["remove_tiers"] == [] and notification[0]["add_tier"] is None
    ack(notification)
    sync([declined])
    assert changes() == []
    with database.connect() as conn:
        conn.execute("UPDATE patreon_members SET declined_since=?", (iso(utcnow() - timedelta(days=8)),))
    s.recompute_link("1", config=CONFIG)
    ended = changes()
    assert ended[0]["remove_tiers"] == ["noble"] and ended[0]["dm"] == "perks_ended"
    ack(ended)
    s.recompute_link("1", config=CONFIG)
    assert changes() == []


def test_declined_grace_without_acknowledged_grant(database):
    sync([member()])
    sync([member(tier=None, status="declined_patron")])
    notification = changes()
    assert notification[0]["dm"] == "payment_declined" and notification[0]["add_tier"] is None
    ack(notification)
    grant = changes()
    assert grant[0]["add_tier"] == "noble" and grant[0]["dm"] is None


def test_shadow_then_apply_next_sync(database, caplog):
    shadow = replace(CONFIG, apply=False)
    sync([member()], shadow)
    assert changes(config=shadow) == []
    with database.connect() as conn:
        assert conn.execute("SELECT count(*) FROM patreon_changes").fetchone()[0] == 0
    assert "shadow" in caplog.text and "example.com" not in caplog.text
    sync([member()])
    assert changes()[0]["add_tier"] == "noble"


def test_brake_holds_reductions_persists_and_allows_additions(database):
    sync([member(str(i), tier="ascended", discord=str(100+i)) for i in range(10)])
    ack(changes())
    reduced = [member(str(i), tier="noble" if i < 5 else "ascended", discord=str(100+i)) for i in range(10)] + [member("20", discord="120")]
    sync(reduced)
    assert s.health(CONFIG)["brake_held"]
    rows = changes()
    assert rows and all(r["remove_tiers"] == [] for r in rows)
    ack(rows)
    for item in s.roster("discord", config=CONFIG)["members"]:
        if int(item["discord_user_id"]) < 105:
            assert item["tier_key"] == "ascended"
    sync(reduced)
    assert s.health(CONFIG)["brake_held"] and changes() == [] and s.alerts()["alerts"][0]["kind"] == "brake_held"
    s.release_brake(config=CONFIG)
    removals = changes()
    assert len(removals) == 5 and all(r["remove_tiers"] == ["ascended"] for r in removals)
    ack(removals)
    assert changes() == []


@pytest.mark.parametrize("count,lowered,held", [(20, 5, False), (20, 6, True), (10, 4, False)])
def test_brake_threshold(database, count, lowered, held):
    sync([member(str(i), discord=str(100+i)) for i in range(count)])
    ack(changes())
    sync([member(str(i), tier=None if i < lowered else "noble", discord=str(100+i)) for i in range(count)])
    assert s.health(CONFIG)["brake_held"] is held


def test_uniqueness_cooldown_force_and_tombstone(database):
    assert s.create_or_update_link("1", "111", method="oauth", config=CONFIG) == "ok"
    assert s.create_or_update_link("2", "111", method="staff", force=True, config=CONFIG) == "already_linked"
    assert s.create_or_update_link("1", "222", config=CONFIG) == "relink_cooldown"
    assert s.create_or_update_link("1", "222", force=True, config=CONFIG) == "ok"
    s.unlink(discord_user_id="222", config=CONFIG)
    assert s.create_or_update_link("1", "333", config=CONFIG) == "relink_cooldown"
    assert s.create_or_update_link("1", "333", now=utcnow() + timedelta(days=31), config=CONFIG) == "ok"


@pytest.mark.parametrize("stored_half", ["discord", "uuid"])
def test_missing_half_filled_from_discord_links_at_compute(database, stored_half):
    sync([member(discord=None)])
    args = {"discord_user_id": "111"} if stored_half == "discord" else {"player_uuid": player()}
    assert s.create_or_update_link("1", config=CONFIG, **args) == "ok"
    s.recompute_link("1", config=CONFIG)
    with database.connect() as conn:
        conn.execute("INSERT INTO discord_links(player_uuid,discord_user_id,linked_at) VALUES (?,?,?)", (player(), "111", iso(utcnow())))
    s.recompute_link("1", config=CONFIG)
    assert changes("discord")[0]["discord_user_id"] == "111" and changes("luckperms")[0]["player_uuid"] == player()
    assert s.status(player_uuid=player(), config=CONFIG)["has_discord"]


def test_implicit_half_cannot_control_another_link(database):
    assert s.create_or_update_link("1", "111", config=CONFIG) == "ok"
    assert s.create_or_update_link("2", player_uuid=player(), config=CONFIG) == "ok"
    with database.connect() as conn:
        conn.execute("INSERT INTO discord_links(player_uuid,discord_user_id,linked_at) VALUES (?,?,?)", (player(), "111", iso(utcnow())))
    sync([member("1"), member("2", tier="ascended", discord=None)])
    assert changes("discord")[0]["add_tier"] == "noble" and changes("luckperms")[0]["add_tier"] == "ascended"


def test_import_dry_run_merge_seed_and_only_owned_removals(database):
    sync([member()])
    before = snapshot(database)
    links = [{"player_uuid": player(), "patreon_email": "PATRON1@example.com"}, {"player_uuid": player(2), "patreon_email": "missing@example.com"}]
    grants = [{"player_uuid": player(), "tier_key": "ascended"}]
    dry = s.import_links(links, grants, config=CONFIG)
    assert len(dry["merged"]) == 1 and len(dry["unmatched"]) == 1 and dry["grants_seeded"] == 1 and snapshot(database) == before
    real = s.import_links(links, grants, dry_run=False, config=CONFIG)
    assert real == dry
    row = changes("luckperms")[0]
    assert row["add_tier"] == "noble" and row["remove_tiers"] == ["ascended"]
    assert s.status(player_uuid=player(), config=CONFIG)["method"] == "import"
    assert s.lookup(email="patron1@example.com", config=CONFIG)["member"]["email"]


def test_lease_exclusion_and_expiry(database):
    owner = s.acquire_lease()
    assert owner and s.acquire_lease() is None
    assert s.sync_now(config=CONFIG, client=FakeClient([]))["detail"] == "patreon_sync_busy"
    with database.connect() as conn:
        conn.execute("UPDATE patreon_leases SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    newer = s.acquire_lease()
    assert newer and newer != owner
    s.release_lease("sync", owner)
    with pytest.raises(s.ServiceError):
        s.renew_lease("sync", owner)
    assert s.acquire_lease() is None
    s.release_lease("sync", newer)


def test_member_refresh_and_absent_members(database):
    sync([member()])
    ack(changes())
    result = s.refresh_member("m1", client=FakeClient([member(tier="ascended")]), config=CONFIG)
    assert result["ok"] and changes()[0]["add_tier"] == "ascended"
    ack(changes())
    sync([])
    assert changes()[0]["remove_tiers"] == ["ascended"]


def test_cross_target_acks_and_cancelled_rows_do_not_grant(database):
    sync([member()])
    with database.connect() as conn:
        old_id = conn.execute("SELECT id FROM patreon_changes").fetchone()[0]
    sync([member(tier="ascended")])
    assert s.ack_changes("discord", [old_id], config=CONFIG)["acked"] == []
    row = changes()[0]
    assert s.ack_changes("luckperms", [row["id"]], config=CONFIG)["acked"] == [] and s.roster("discord", config=CONFIG)["members"] == []


def test_link_success_after_auto_link_is_idempotent(database):
    sync([member()])
    ack(changes())
    assert s.create_or_update_link("1", "111", method="oauth", config=CONFIG) == "ok"
    s.recompute_link("1", config=CONFIG, link_success=True)
    success = changes()
    assert success[0]["dm"] == "link_success" and success[0]["add_tier"] is None
    ack(success)
    s.recompute_link("1", config=CONFIG, link_success=True)
    assert changes() == []
    sync([member(tier="ascended")])
    ack(changes())
    s.recompute_link("1", config=CONFIG, link_success=True)
    assert changes() == []


def test_transaction_failure_after_fetch_rolls_back_all_members(database, monkeypatch):
    sync([member()])
    ack(changes())
    before = snapshot(database)
    original = s._store_member
    def fail_second(conn, m, now, config):
        if m["patreon_user_id"] == "2":
            raise ValueError("bad data")
        original(conn, m, now, config)
    monkeypatch.setattr(s, "_store_member", fail_second)
    result = s.sync_now(config=CONFIG, client=FakeClient([member(tier="ascended"), member("2", discord="222")]))
    assert not result["ok"] and snapshot(database) == before


def test_lost_sync_lease_does_not_write(database):
    class LostLeaseClient(FakeClient):
        def members(self):
            with database.connect() as conn:
                conn.execute("UPDATE patreon_leases SET owner='another-process' WHERE name='sync'")
            return self.rows
    before = snapshot(database)
    assert not s.sync_now(config=CONFIG, client=LostLeaseClient([member()]))["ok"]
    assert snapshot(database) == before


def test_loop_leader_excluded_and_stops_cleanly(database, monkeypatch):
    import asyncio
    monkeypatch.setenv("PATREON_ENABLED", "1")
    owner = s.acquire_lease("sync_loop")
    called = []
    monkeypatch.setattr(s, "sync_now", lambda **kwargs: called.append(True))
    async def run():
        stop = asyncio.Event()
        task = asyncio.create_task(s.sync_loop(stop))
        await asyncio.sleep(.02)
        stop.set()
        await task
    asyncio.run(run())
    assert called == []
    s.release_lease("sync_loop", owner)
    asyncio.run(run())
    assert called == [True]
    assert s.acquire_lease("sync_loop")


def test_existing_discord_pair_is_dynamic_not_copied(database):
    with database.connect() as conn:
        conn.execute("INSERT INTO discord_links(player_uuid,discord_user_id,linked_at) VALUES (?,?,?)", (player(), "111", iso(utcnow())))
    sync([member()])
    with database.connect() as conn:
        assert conn.execute("SELECT player_uuid FROM patreon_links").fetchone()[0] is None
        conn.execute("UPDATE discord_links SET player_uuid=?", (player(2),))
    sync([member()])
    ranks = changes("luckperms")
    assert len(ranks) == 1 and ranks[0]["player_uuid"] == player(2)


def test_released_brake_does_not_rehold_the_same_unacked_transition(database):
    original = [member(str(i), discord=str(100+i)) for i in range(10)]
    reduced = [member(str(i), tier=None if i < 5 else "noble", discord=str(100+i)) for i in range(10)]
    sync(original)
    ack(changes())
    sync(reduced)
    assert s.health(CONFIG)["brake_held"]
    s.release_brake(config=CONFIG)
    sync(reduced)
    assert not s.health(CONFIG)["brake_held"] and len(changes()) == 5
    ack(changes())
    sync(original)
    ack(changes())
    sync([member(str(i), tier=None if i >= 5 else "noble", discord=str(100+i)) for i in range(10)])
    assert s.health(CONFIG)["brake_held"]


def test_dms_sent_when_suppress_off(database, monkeypatch):
    monkeypatch.delenv("PATREON_SUPPRESS_DMS", raising=False)
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    monkeypatch.setenv("PATREON_SUPPRESS_DMS", "0")
    config = Config.from_env()
    assert config.suppress_dms is False
    sync([member()], config)
    row = changes(config=config)[0]
    assert row["add_tier"] == "noble" and row["dm"] == "tier_granted"


def test_suppress_dms_hides_outgoing_dm_and_ack_consumes_it(database, monkeypatch):
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    monkeypatch.setenv("PATREON_SUPPRESS_DMS", "1")
    config = Config.from_env()
    assert config.suppress_dms is True
    sync([member()], config)
    outgoing = changes(config=config)
    assert outgoing[0]["add_tier"] == "noble" and outgoing[0]["remove_tiers"] == [] and outgoing[0]["dm"] is None
    with database.connect() as conn:
        stored = conn.execute("SELECT dm, dm_suppressed FROM patreon_changes").fetchone()
        assert stored["dm"] == "tier_granted" and stored["dm_suppressed"] == 1
    monkeypatch.setenv("PATREON_SUPPRESS_DMS", "0")
    revealed = Config.from_env()
    assert changes(config=revealed)[0]["dm"] is None
    ack(outgoing, config=revealed)
    s.recompute_link("1", config=revealed)
    assert changes(config=revealed) == []
    sync([member(tier=None, status="declined_patron")], config)
    declined = changes(config=config)
    assert declined[0]["dm"] is None and declined[0]["add_tier"] is None and declined[0]["grace_until"]
    ack(declined, config=config)
    assert changes(config=revealed) == []


def test_schema_migration_idempotent_and_upgrades_desired_history(database):
    with database.connect() as conn:
        conn.execute("DROP TABLE patreon_desired")
        conn.execute("CREATE TABLE patreon_desired(target TEXT,subject TEXT,tier_key TEXT,grace_until TEXT,dm TEXT,generation INTEGER,PRIMARY KEY(target,subject))")
    database.migrate()
    database.migrate()
    sync([member()])
    assert changes()[0]["add_tier"] == "noble"


def test_dm_suppressed_column_migrates(database):
    with database.connect() as conn:
        conn.execute("DROP TABLE patreon_changes")
        conn.execute("CREATE TABLE patreon_changes(id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, subject TEXT NOT NULL, add_tier TEXT, remove_json TEXT NOT NULL, dm TEXT, grace_until TEXT, generation INTEGER NOT NULL, created_at TEXT NOT NULL, dispatched_at TEXT, acked_at TEXT, cancelled_at TEXT)")
    database.migrate()
    sync([member()])
    assert changes()[0]["dm"] == "tier_granted"


def test_import_conflicts_simulated_sequentially_and_invalid_grants_rollback(database):
    sync([member("1", discord=None), member("2", discord=None)])
    links = [{"player_uuid": player(), "patreon_email": "patron1@example.com"}, {"player_uuid": player(), "patreon_email": "patron2@example.com"}]
    before = snapshot(database)
    report = s.import_links(links, [], config=CONFIG)
    assert len(report["linked"]) == 1 and report["conflicts"][0]["detail"] == "already_linked" and snapshot(database) == before
    with pytest.raises(s.ServiceError, match="invalid_import_grant"):
        s.import_links(links, [{"player_uuid": player(), "tier_key": "legacy"}], dry_run=False, config=CONFIG)
    assert snapshot(database) == before


def test_auto_link_only_when_no_link_row_exists(database):
    sync([member(), member("2", discord="222")])
    s.unlink(discord_user_id="111", config=CONFIG)
    s.unlink(discord_user_id="222", config=CONFIG)
    sync([member(discord="444"), member("2", discord="222"), member("3", discord="333")])
    assert not s.status(discord_user_id="111", config=CONFIG)["linked"]
    assert not s.status(discord_user_id="444", config=CONFIG)["linked"]
    assert not s.status(discord_user_id="222", config=CONFIG)["linked"]
    assert s.status(discord_user_id="333", config=CONFIG)["method"] == "auto_discord"
    assert s.create_or_update_link("1", "111", method="oauth", config=CONFIG) == "ok"
    assert s.staff_link(patreon_user_id="2", discord_user_id="222", config=CONFIG) == {"result": "ok"}
    sync([member(discord="444"), member("2", discord="555"), member("3", discord="333")])
    assert s.status(discord_user_id="111", config=CONFIG)["method"] == "oauth"
    assert s.status(discord_user_id="222", config=CONFIG)["method"] == "staff"
    assert not s.status(discord_user_id="444", config=CONFIG)["linked"]
    assert not s.status(discord_user_id="555", config=CONFIG)["linked"]
