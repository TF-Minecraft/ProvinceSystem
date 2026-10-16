"""Expiry and new deadlines are evaluated after real lock waits, without sleeps."""
import hashlib
import threading
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from src import database
from src.auth import testing
from src.auth.test_locking import ADVISORY, ROW, Run, lock_wait
from src.patreon import client as client_module, linking, service as s
from src.patreon.client import PatreonError
from src.patreon.resolver import iso, utcnow
from src.patreon.test_locking import creator_tokens, open_transactions, pending_link, _refresher  # noqa: F401
from src.patreon.test_service import CONFIG, FakeClient, member, sync

pytestmark = pytest.mark.usefixtures("database", "postgres")


@pytest.fixture
def clock(monkeypatch):
    clock = SimpleNamespace(now=utcnow())
    for module in (s, linking, client_module):
        monkeypatch.setattr(module, "utcnow", lambda: clock.now)
    return clock


def wait_then_advance(clock, statement, params, work, until, kinds=ROW):
    with database.connect() as conn:
        # This is the test lock holder, not an application transaction making HTTP.
        conn.execute("SET LOCAL application_name = 'expiry_test_holder'")
        conn.execute(statement, params)
        run = Run(work)
        lock_wait(run, kinds)
        clock.now = until
    return run.join()


def test_acquisition_after_wait_takes_expired_lease_with_a_full_ttl(clock):
    old = s.acquire_lease()
    expires = testing.value("SELECT expires_at FROM patreon_leases WHERE name = 'sync'")
    run = wait_then_advance(clock, "SELECT name FROM patreon_leases WHERE name = 'sync' FOR UPDATE", (),
                            s.acquire_lease, expires)
    assert run.error is None and run.value and run.value != old
    assert testing.rows("SELECT owner, expires_at FROM patreon_leases") == [
        {"owner": run.value, "expires_at": clock.now + timedelta(seconds=s.LEASE_SECONDS)}]


def test_acquisition_waiting_for_an_insert_starts_a_full_ttl(clock):
    run = wait_then_advance(
        clock, "INSERT INTO patreon_leases (name, owner, expires_at) VALUES ('sync', 'previous', %s)",
        (clock.now - timedelta(seconds=1),), s.acquire_lease, clock.now + timedelta(seconds=30))
    assert run.error is None and run.value and run.value != "previous"
    assert testing.value("SELECT expires_at FROM patreon_leases") == clock.now + timedelta(seconds=s.LEASE_SECONDS)


def test_acquisition_waiting_for_release_starts_a_full_ttl(clock):
    owner = s.acquire_lease()
    run = wait_then_advance(clock, "DELETE FROM patreon_leases WHERE owner = %s", (owner,),
                            s.acquire_lease, clock.now + timedelta(seconds=30))
    assert run.error is None and run.value and run.value != owner
    assert testing.value("SELECT expires_at FROM patreon_leases") == clock.now + timedelta(seconds=s.LEASE_SECONDS)


def test_renewal_waiting_past_expiry_cannot_revive_the_lease(clock):
    owner = s.acquire_lease()
    expires = testing.value("SELECT expires_at FROM patreon_leases")
    run = wait_then_advance(clock, "SELECT name FROM patreon_leases WHERE name = 'sync' FOR UPDATE", (),
                            lambda: s.renew_lease("sync", owner), expires)
    assert isinstance(run.error, s.ServiceError) and str(run.error) == "patreon_lease_lost"
    assert testing.rows("SELECT owner, expires_at FROM patreon_leases") == [{"owner": owner, "expires_at": expires}]


def test_live_renewal_after_wait_starts_a_full_ttl(clock):
    owner = s.acquire_lease()
    run = wait_then_advance(clock, "SELECT name FROM patreon_leases WHERE name = 'sync' FOR UPDATE", (),
                            lambda: s.renew_lease("sync", owner), clock.now + timedelta(seconds=30))
    assert run.error is None
    assert testing.value("SELECT expires_at FROM patreon_leases") == clock.now + timedelta(seconds=s.LEASE_SECONDS)


def test_renewal_revalidates_owner_after_wait(clock):
    owner = s.acquire_lease()
    expires = testing.value("SELECT expires_at FROM patreon_leases")
    run = wait_then_advance(clock, "UPDATE patreon_leases SET owner = 'replacement' WHERE name = 'sync'", (),
                            lambda: s.renew_lease("sync", owner), clock.now + timedelta(seconds=30))
    assert isinstance(run.error, s.ServiceError) and str(run.error) == "patreon_lease_lost"
    assert testing.rows("SELECT owner, expires_at FROM patreon_leases") == [{"owner": "replacement", "expires_at": expires}]


@pytest.mark.parametrize("action", ["oauth", "confirm", "cancel"])
def test_a_credential_expiring_while_its_row_is_locked_is_refused(clock, monkeypatch, action):
    monkeypatch.setenv("PATREON_CLIENT_ID", "client-id")
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    sync([member(discord=None)])
    if action == "oauth":
        url = linking.start_link(discord_user_id="111", discord_username="name")["authorize_url"]
        token = parse_qs(urlsplit(url).query)["state"][0]
        table, key, work = "patreon_oauth_states", "state_hash", lambda: linking.consume_state(token)
    else:
        token = "confirm-token"
        pending_link(token)
        table, key = "patreon_pending_links", "token_hash"
        work = lambda: (linking.confirm_link if action == "confirm" else linking.cancel_link)(token)
    digest = hashlib.sha256(token.encode()).hexdigest()
    expires = clock.now + timedelta(seconds=30)
    testing.execute(f"UPDATE {table} SET expires_at = %s WHERE {key} = %s", (expires, digest))
    run = wait_then_advance(clock, f"SELECT {key} FROM {table} WHERE {key} = %s FOR UPDATE", (digest,), work, expires)
    assert run.error is None
    expected = None if action == "oauth" else {"status": "expired", **({"tier": ""} if action == "confirm" else {})}
    assert run.value == expected
    assert testing.value(f"SELECT used_at FROM {table} WHERE {key} = %s", (digest,)) is None
    assert testing.value("SELECT count(*) FROM patreon_links") == 0
    assert testing.value("SELECT count(*) FROM patreon_changes") == 0


def after_http_wait(clock, work, statement, advance):
    reached, proceed = threading.Event(), threading.Event()
    run = Run(lambda: work(reached, proceed))
    assert reached.wait(10), run.error
    with database.connect() as conn:
        conn.execute(statement)
        proceed.set()
        lock_wait(run, ROW)
        advance()
    return run.join()


@pytest.mark.parametrize("locked_table", ["patreon_leases", "patreon_tokens"])
def test_token_refresh_expiring_behind_either_row_lock_is_refused(clock, creator_tokens, locked_table):
    def refresh(reached, proceed):
        def handler(request):
            assert open_transactions() == []
            reached.set()
            assert proceed.wait(10)
            return httpx.Response(200, json={"access_token": "late", "refresh_token": "late-refresh", "expires_in": 3600})
        return _refresher(handler).refresh_tokens()

    def expire():
        clock.now = testing.value("SELECT expires_at FROM patreon_leases WHERE name = 'token_refresh'")

    clause = "name = 'token_refresh'" if locked_table == "patreon_leases" else "id = 1"
    run = after_http_wait(clock, refresh, f"SELECT * FROM {locked_table} WHERE {clause} FOR UPDATE", expire)
    assert isinstance(run.error, PatreonError) and str(run.error) == "patreon_token_refresh_lease_lost"
    assert testing.value("SELECT refresh_token FROM patreon_tokens") == "seed-refresh"


def test_token_deadline_is_computed_after_the_token_row_wait(clock, creator_tokens):
    def refresh(reached, proceed):
        def handler(request):
            assert open_transactions() == []
            reached.set()
            assert proceed.wait(10)
            return httpx.Response(200, json={"access_token": "new", "refresh_token": "new-refresh", "expires_in": 3600})
        return _refresher(handler).refresh_tokens()

    def advance():
        clock.now += timedelta(seconds=30)

    run = after_http_wait(clock, refresh, "SELECT id FROM patreon_tokens WHERE id = 1 FOR UPDATE", advance)
    assert run.error is None and run.value["refresh_token"] == "new-refresh"
    assert run.value["expires_at"] == iso(clock.now + timedelta(seconds=3600))


def test_sync_lease_expiring_behind_its_row_lock_is_refused(clock):
    def fetch(reached, proceed):
        class Paused(FakeClient):
            def members(self):
                assert open_transactions() == []
                reached.set()
                assert proceed.wait(10)
                return self.rows
        return s.sync_now(config=CONFIG, client=Paused([member()]))

    def expire():
        clock.now = testing.value("SELECT expires_at FROM patreon_leases WHERE name = 'sync'")

    run = after_http_wait(clock, fetch, "SELECT name FROM patreon_leases WHERE name = 'sync' FOR UPDATE", expire)
    assert run.error is None and run.value == {"ok": False, "detail": "patreon_sync_failed"}
    assert testing.value("SELECT count(*) FROM patreon_members") == 0


def test_sync_stores_the_time_after_waiting_for_the_patreon_lock(clock):
    run = wait_then_advance(clock, "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (s.PATREON_LOCK,),
                            lambda: sync([member()]), clock.now + timedelta(seconds=30), ADVISORY)
    assert run.error is None and run.value["ok"]
    assert testing.value("SELECT updated_at FROM patreon_members") == clock.now


def test_oauth_state_minted_after_cleanup_wait_has_a_full_ttl(clock, monkeypatch):
    monkeypatch.setenv("PATREON_CLIENT_ID", "client-id")
    linking.start_link(discord_user_id="111", discord_username="name")
    testing.execute("UPDATE patreon_oauth_states SET expires_at = %s", (clock.now - timedelta(seconds=1),))
    run = wait_then_advance(clock, "SELECT state_hash FROM patreon_oauth_states FOR UPDATE", (),
                            lambda: linking.start_link(discord_user_id="222", discord_username="name"),
                            clock.now + timedelta(seconds=30))
    assert run.error is None and run.value["expires_at"] == iso(clock.now + linking.STATE_TTL)


def test_confirmation_minted_after_cleanup_wait_has_a_full_ttl(clock, monkeypatch):
    monkeypatch.setenv("PATREON_CLIENT_ID", "client-id")
    pending_link("old-token")
    testing.execute("UPDATE patreon_pending_links SET expires_at = %s", (clock.now - timedelta(seconds=1),))
    url = linking.start_link(discord_user_id="111", discord_username="name")["authorize_url"]
    token = parse_qs(urlsplit(url).query)["state"][0]

    class Identity:
        def exchange_authorization_code(self, code):
            assert open_transactions() == []
            return {"access_token": "access"}

        def identity(self, access):
            assert open_transactions() == []
            return {"id": "1", "attributes": {"full_name": "Patron"}}

        def close(self):
            pass

    monkeypatch.setattr(linking, "build_client", lambda config: Identity())
    run = wait_then_advance(clock, "SELECT token_hash FROM patreon_pending_links FOR UPDATE", (),
                            lambda: linking.finish_callback("code", token, denied=False), clock.now + timedelta(seconds=30))
    assert run.error is None and run.value[0] == "pending"
    assert testing.value("SELECT expires_at FROM patreon_pending_links") == clock.now + linking.CONFIRM_TTL


def test_confirmation_expiring_while_waiting_for_the_patreon_lock_cannot_link(clock, monkeypatch):
    monkeypatch.setenv("PATREON_ENABLED", "1")
    monkeypatch.setenv("PATREON_APPLY", "1")
    sync([member(discord=None)])
    pending_link("confirm-token")
    expires = clock.now + timedelta(seconds=30)
    testing.execute("UPDATE patreon_pending_links SET expires_at = %s", (expires,))
    run = wait_then_advance(clock, "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (s.PATREON_LOCK,),
                            lambda: linking.confirm_link("confirm-token"), expires, ADVISORY)
    assert run.error is None and run.value == {"status": "expired", "tier": ""}
    assert testing.value("SELECT used_at FROM patreon_pending_links") is None
    assert testing.value("SELECT count(*) FROM patreon_links") == 0


def test_link_time_is_computed_after_the_patreon_lock_wait(clock):
    run = wait_then_advance(clock, "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (s.PATREON_LOCK,),
                            lambda: s.create_or_update_link("1", "111", config=CONFIG),
                            clock.now + timedelta(seconds=30), ADVISORY)
    assert run.error is None and run.value == "ok"
    assert testing.value("SELECT linked_at FROM patreon_links") == clock.now
