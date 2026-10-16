"""The Patreon locking recipes, each raced on two connections against the real Postgres.

X4: every transaction that runs `_compute`/`_plan` (or reads and rewrites the
links and outboxes) opens with the `patreon` advisory lock. The leases are taken
by one upsert (C), held FOR UPDATE while a sync or token refresh writes, the
token write is a compare-and-set, `_sync_failure` counts under its UPDATE's row
lock and `alert()` keeps one open alert per kind with ON CONFLICT. Single-use
OAuth states and confirmations are compare-and-set UPDATEs. No Patreon call is
made while a transaction is open. The race helpers are the accounts ones.
"""
import hashlib
import threading
from datetime import timedelta

import httpx
import pytest

from src import database
from src.auth import testing
from src.auth.test_locking import ADVISORY, ROW, Gate, Run, held, lock_wait, race
from src.patreon import linking
from src.patreon import service as s
from src.patreon.client import PatreonClient, PatreonError
from src.patreon.resolver import utcnow
from src.patreon.test_service import CONFIG, FakeClient, changes, member, sync

pytestmark = pytest.mark.usefixtures("database", "postgres")


def open_transactions() -> list[dict]:
    """The site's other connections to this database that sit inside a transaction, and advisory locks held."""
    return testing.rows(
        "SELECT pid, state FROM pg_stat_activity WHERE datname = current_database() "
        "AND application_name = 'provincesystem' AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%%' "
        "UNION ALL SELECT pid, 'advisory' FROM pg_locks WHERE locktype = 'advisory' AND granted "
        "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())")


class OutsideTransactions(FakeClient):
    """A Patreon client that checks no transaction is open whenever it is called."""

    def __init__(self, rows):
        super().__init__(rows)
        self.calls = 0

    def members(self):
        self.calls += 1
        assert open_transactions() == []
        return super().members()

    def member(self, member_id):
        self.calls += 1
        assert open_transactions() == []
        return super().member(member_id)

    def close(self):
        pass


def pending_link(token: str, user: str = "1", discord: str = "111") -> None:
    testing.execute(
        "INSERT INTO patreon_pending_links (token_hash, patreon_user_id, patreon_name, discord_user_id, target_kind, "
        "target_name, expires_at) VALUES (%s, %s, 'Patron', %s, 'discord', 'name', %s)",
        (hashlib.sha256(token.encode()).hexdigest(), user, discord, utcnow() + timedelta(minutes=5)))


# --------------------
# X4: the patreon lock at every site
# --------------------

def _confirm():
    pending_link("confirm-token")
    return lambda: linking.confirm_link("confirm-token")


X4_SITES = {
    "create_or_update_link": lambda: lambda: s.create_or_update_link("9", "999", config=CONFIG),
    "recompute_link": lambda: lambda: s.recompute_link("1", config=CONFIG),
    "unlink": lambda: lambda: s.unlink(discord_user_id="111", config=CONFIG),
    "release_brake": lambda: lambda: s.release_brake(config=CONFIG),
    "staff_link": lambda: lambda: s.staff_link(patreon_user_id="1", discord_user_id="111", config=CONFIG),
    "import_links": lambda: lambda: s.import_links([], [], dry_run=False, config=CONFIG),
    "list_changes": lambda: lambda: s.list_changes("discord", config=CONFIG),
    "ack_changes": lambda: lambda: s.ack_changes("discord", [1], config=CONFIG),
    "sync_now": lambda: lambda: s.sync_now(config=CONFIG, client=FakeClient([member()])),
    "refresh_member": lambda: lambda: s.refresh_member("m1", config=CONFIG, client=FakeClient([member()])),
    "confirm_link": _confirm,
}


@pytest.mark.parametrize("site", X4_SITES)
def test_every_recompute_takes_the_patreon_lock_first(site, monkeypatch):
    monkeypatch.setenv("PATREON_APPLY", "1")
    sync([member()])
    fn = X4_SITES[site]()
    run = held(lambda conn: database.advisory_lock(conn, s.PATREON_LOCK), fn, ADVISORY)
    assert run.error is None, run.error
    if isinstance(run.value, dict) and "ok" in run.value:
        assert run.value["ok"], run.value


def test_a_dispatch_never_sends_a_change_being_cancelled(monkeypatch):
    """A sync replanning a subject cancels its undispatched change; the outbox waits and sends the new one."""
    sync([member()])
    old = testing.value("SELECT id FROM patreon_changes")
    gate = Gate(monkeypatch, "UPDATE patreon_changes SET cancelled_at")
    one, two = race(gate, lambda: sync([member(tier="ascended")]), lambda: changes(), ADVISORY)
    assert one.error is None and two.error is None
    assert [c["add_tier"] for c in two.value] == ["ascended"] and two.value[0]["id"] != old
    assert testing.rows("SELECT dispatched_at, cancelled_at IS NOT NULL AS cancelled FROM patreon_changes WHERE id = %s",
                        (old,)) == [{"dispatched_at": None, "cancelled": True}]


def test_two_patrons_cannot_claim_one_discord_account(monkeypatch):
    gate = Gate(monkeypatch, "INSERT INTO patreon_links")
    one, two = race(gate, lambda: s.create_or_update_link("1", "111", config=CONFIG),
                    lambda: s.create_or_update_link("2", "111", config=CONFIG), ADVISORY)
    assert (one.value, two.value) == ("ok", "already_linked")


# --------------------
# Leases: C to take one, A while writing under one
# --------------------

def test_an_expired_lease_is_taken_once(monkeypatch):
    s.acquire_lease()
    testing.execute("UPDATE patreon_leases SET expires_at = %s", (utcnow() - timedelta(seconds=1),))
    gate = Gate(monkeypatch, "INSERT INTO patreon_leases")
    one, two = race(gate, s.acquire_lease, s.acquire_lease, ROW)
    assert one.value and two.value is None
    assert testing.value("SELECT owner FROM patreon_leases") == one.value


def _hold_during(calls, statement, params):
    """Run `calls` on a thread; when it signals, hold `statement` uncommitted until it waits on it."""
    reached, holding = threading.Event(), threading.Event()
    run = Run(lambda: calls(reached, holding))
    assert reached.wait(10), run.error
    with database.connect() as conn:
        conn.execute(statement, params)
        holding.set()
        lock_wait(run, ROW)
    return run.join()


def test_a_sync_stores_nothing_once_its_lease_is_taken_over():
    """The sync lease row is read FOR UPDATE: a takeover in flight is waited for and seen."""
    sync([member()])
    before = testing.rows("SELECT * FROM patreon_members")

    def sync_with(reached, holding):
        class Paused(FakeClient):
            def members(self):
                reached.set()
                assert holding.wait(10)
                return self.rows
        return s.sync_now(config=CONFIG, client=Paused([member(tier="ascended")]))

    run = _hold_during(sync_with, "UPDATE patreon_leases SET owner = 'other-worker' WHERE name = 'sync'", ())
    assert run.value == {"ok": False, "detail": "patreon_sync_failed"}
    assert testing.rows("SELECT * FROM patreon_members") == before


def test_a_sync_rechecks_lease_expiry_after_waiting_for_the_patreon_lock(monkeypatch):
    sync([member()])
    before = testing.rows("SELECT * FROM patreon_members")
    now = utcnow()
    monkeypatch.setattr(s, "utcnow", lambda: now)
    with database.transaction(lock=s.PATREON_LOCK):
        run = Run(lambda: s.sync_now(config=CONFIG, client=FakeClient([member(tier="ascended")])))
        lock_wait(run, ADVISORY)
        now += timedelta(seconds=s.LEASE_SECONDS + 1)
    assert run.join().error is None and run.value == {"ok": False, "detail": "patreon_sync_failed"}
    assert testing.rows("SELECT * FROM patreon_members") == before


@pytest.fixture
def creator_tokens(monkeypatch):
    for key, value in {"PATREON_CREATOR_ACCESS_TOKEN": "seed-access", "PATREON_CREATOR_REFRESH_TOKEN": "seed-refresh",
                       "PATREON_CLIENT_ID": "client", "PATREON_CLIENT_SECRET": "secret"}.items():
        monkeypatch.setenv(key, value)


def _refresher(handler):
    config = CONFIG.__class__(enabled=True, apply=True, api_base="https://stub.invalid", campaign_id="1")
    return PatreonClient(config, http=httpx.Client(transport=httpx.MockTransport(handler)))


def test_a_token_refresh_waits_for_a_lease_takeover(creator_tokens):
    """The token_refresh lease row is read FOR UPDATE before the tokens are written."""
    def refresh(reached, holding):
        def handler(request):
            assert open_transactions() == []
            reached.set()
            assert holding.wait(10)
            return httpx.Response(200, json={"access_token": "new", "refresh_token": "new-refresh", "expires_in": 3600})
        client = _refresher(handler)
        client._tokens()
        return client.refresh_tokens()

    run = _hold_during(refresh, "UPDATE patreon_leases SET owner = 'other-worker' WHERE name = 'token_refresh'", ())
    assert isinstance(run.error, PatreonError) and "lease_lost" in str(run.error)
    assert testing.value("SELECT refresh_token FROM patreon_tokens") == "seed-refresh"


def test_a_token_refresh_never_overwrites_tokens_rotated_meanwhile(creator_tokens):
    """Compare-and-set: tokens rotated since the refresh read them stay."""
    def refresh(reached, holding):
        def handler(request):
            assert open_transactions() == []
            reached.set()
            assert holding.wait(10)
            return httpx.Response(200, json={"access_token": "stale", "refresh_token": "stale-refresh", "expires_in": 3600})
        client = _refresher(handler)
        client._tokens()
        return client.refresh_tokens()

    run = _hold_during(refresh, "UPDATE patreon_tokens SET access_token = 'other-access', refresh_token = 'other-refresh'", ())
    assert run.error is None and run.value["refresh_token"] == "other-refresh"
    assert testing.value("SELECT refresh_token FROM patreon_tokens") == "other-refresh"


# --------------------
# _sync_failure and alert()
# --------------------

def test_two_failures_count_twice_and_alert_once(monkeypatch):
    testing.execute("UPDATE patreon_sync_state SET consecutive_failures = 1")
    gate = Gate(monkeypatch, "UPDATE patreon_sync_state SET last_sync_at")
    one, two = race(gate, s._sync_failure, s._sync_failure, ROW)
    assert one.error is None and two.error is None
    assert testing.value("SELECT consecutive_failures FROM patreon_sync_state") == 3
    assert [a["kind"] for a in s.alerts()["alerts"]] == ["sync_failed"]


def test_an_alert_raised_twice_at_once_is_kept_once():
    """C: the second insert waits on the first's open alert, then does nothing."""
    def raise_alert():
        with database.connect() as conn:
            s.alert(conn, "sync_failed", "second")
    run = held(lambda conn: s.alert(conn, "sync_failed", "first"), raise_alert, ROW)
    assert run.error is None
    assert [(a["kind"], a["message"]) for a in s.alerts()["alerts"]] == [("sync_failed", "first")]
    s.ack_alerts([a["id"] for a in s.alerts()["alerts"]])
    raise_alert()
    assert [a["message"] for a in s.alerts()["alerts"]] == ["second"]


# --------------------
# Single-use states and confirmations: B
# --------------------

def test_an_oauth_state_is_spent_once(monkeypatch):
    monkeypatch.setenv("PATREON_CLIENT_ID", "client-id")
    token = linking.start_link(discord_user_id="111", discord_username="name")["authorize_url"].split("state=")[1]
    gate = Gate(monkeypatch, "UPDATE patreon_oauth_states SET used_at")
    one, two = race(gate, lambda: linking.consume_state(token), lambda: linking.consume_state(token), ROW)
    assert one.value["discord_user_id"] == "111" and two.value is None


def test_two_confirmations_link_once(monkeypatch):
    """linking.py:174 used to ignore the UPDATE's row count, so both confirms linked."""
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    sync([member(discord=None)])
    pending_link("confirm-token")
    gate = Gate(monkeypatch, "UPDATE patreon_pending_links SET used_at")
    confirm = lambda: linking.confirm_link("confirm-token")  # noqa: E731
    one, two = race(gate, confirm, confirm, ROW)
    assert (one.value, two.value) == ({"status": "ok", "tier": "noble"}, {"status": "expired", "tier": ""})
    assert [c["dm"] for c in changes()] == ["link_success"]


def test_a_cancel_and_a_confirm_cannot_both_spend_a_token(monkeypatch):
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    sync([member(discord=None)])
    pending_link("confirm-token")
    gate = Gate(monkeypatch, "UPDATE patreon_pending_links SET used_at")
    one, two = race(gate, lambda: linking.cancel_link("confirm-token"), lambda: linking.confirm_link("confirm-token"), ROW)
    assert one.value == {"status": "ok"} and two.value["status"] == "expired"
    assert testing.value("SELECT count(*) FROM patreon_links") == 0


# --------------------
# No Patreon call inside a transaction
# --------------------

def test_patreon_is_called_with_no_transaction_open(monkeypatch):
    sync([member()])
    client = OutsideTransactions([member(tier="ascended")])
    assert s.sync_now(config=CONFIG, client=client)["ok"]
    assert s.refresh_member("m1", config=CONFIG, client=client)["ok"]
    # A confirmation for a patron not yet stored syncs them first, after committing the link.
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    newcomer = OutsideTransactions([member(), member("2", discord=None)])
    monkeypatch.setattr(linking, "build_client", lambda config=None: newcomer)
    pending_link("confirm-token", user="2", discord="222")
    assert linking.confirm_link("confirm-token") == {"status": "ok", "tier": "noble"}
    assert (client.calls, newcomer.calls) == (2, 1)
