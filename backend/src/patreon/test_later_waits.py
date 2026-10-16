"""R2 reviewer regressions, promoted from /tmp/sol-review-patreon-r2-probes.py.

The SHARE table locks are controlled test interference, not normal application
DML. The failure-writer case exercises the actual _sync_failure transaction.
All expiry clocks advance only after pg_stat_activity reports the real wait.
"""
from datetime import timedelta
import pytest
from src import database as pg
from src.auth import testing
from src.auth.test_locking import ROW, Run, lock_wait
from src.patreon import linking, service as s
from src.patreon.test_expiry_locking import clock
from src.patreon.test_locking import pending_link
from src.patreon.test_service import CONFIG, FakeClient, member, sync
from src.luckperms import changes, mirror
from src.luckperms.test_luckperms import ALICE, BOB, app, bridge, env, staff, submit

pytestmark = pytest.mark.usefixtures('database', 'postgres')


def entitlement_rows():
    tables = ("patreon_members", "patreon_links", "patreon_desired", "patreon_applied", "patreon_changes", "patreon_brake_approvals")
    return {table: testing.rows(f"SELECT * FROM {table} ORDER BY 1, 2") for table in tables}


@pytest.mark.parametrize("phase", ["link", "outbox", "error_after_link"])
def test_confirmation_expiring_behind_later_link_write(clock, monkeypatch, phase):
    monkeypatch.setenv('PATREON_ENABLED', '1')
    monkeypatch.setenv('PATREON_APPLY', '1')
    sync([member()])
    assert s.create_or_update_link('1', '111', method='staff', config=CONFIG) == 'ok'
    pending_link('confirm-token')
    expiry = clock.now + timedelta(seconds=1)
    testing.execute('UPDATE patreon_pending_links SET expires_at = %s', (expiry,))
    before = entitlement_rows()
    if phase == 'error_after_link':
        real_link = s.create_or_update_link
        def fail_after_write(*args, **kwargs):
            real_link(*args, **kwargs)
            raise RuntimeError('confirmation failure')
        monkeypatch.setattr(s, 'create_or_update_link', fail_after_write)
    table = 'patreon_changes' if phase == 'outbox' else 'patreon_links'
    with pg.connect() as conn:
        conn.execute(f"SELECT * FROM {table} FOR UPDATE")
        run = Run(lambda: linking.confirm_link('confirm-token'))
        lock_wait(run, ROW)
        clock.now = expiry
    run.join()
    assert run.error is None and run.value == {'status': 'expired', 'tier': ''}
    assert entitlement_rows() == before
    assert testing.value('SELECT used_at FROM patreon_pending_links') is None


@pytest.mark.parametrize("table,kinds", [("patreon_members", ROW), ("patreon_changes", ROW), ("patreon_changes", {"relation"})])
def test_sync_expiring_behind_later_member_write(clock, table, kinds):
    sync([member()])
    before = entitlement_rows()
    with pg.connect() as conn:
        conn.execute(f"LOCK TABLE {table} IN SHARE MODE" if kinds == {"relation"} else f"SELECT * FROM {table} FOR UPDATE")
        run = Run(lambda: s.sync_now(config=CONFIG, client=FakeClient([member(tier='ascended')])))
        lock_wait(run, kinds)
        clock.now = testing.value("SELECT expires_at FROM patreon_leases WHERE name = 'sync'")
    run.join()
    assert run.error is None
    assert run.value == {'ok': False, 'detail': 'patreon_sync_failed'}
    assert entitlement_rows() == before


@pytest.mark.parametrize("phase", ["sent", "pending", "candidate"])
def test_poll_pending_ttl_after_later_change_wait(app, bridge, staff, monkeypatch, phase):
    tips = [{'op': 'add_node', 'node': {'key': 'tips.off'}}]
    overdue = None
    if phase != 'candidate':
        overdue = submit(app, staff['root'], 'user', BOB, tips).json()['id']
        if phase == 'sent':
            assert changes.fetch_for_bridge()
        column = 'sent_at' if phase == 'sent' else 'created_at'
        age = changes.RESULT_WAIT_SECONDS if phase == 'sent' else changes.PENDING_TTL_SECONDS
    live = submit(app, staff['admin'], 'user', ALICE, tips).json()['id']
    if overdue is not None:
        testing.execute(f'UPDATE lp_changes SET {column} = %s WHERE id = %s',
                        (mirror._stamp() - timedelta(seconds=age + 1), overdue))
    now = changes.time.time()
    testing.execute('UPDATE lp_changes SET created_at = %s WHERE id = %s',
                    (mirror._stamp(now) - timedelta(seconds=changes.PENDING_TTL_SECONDS - 1), live))
    monkeypatch.setattr(changes.time, 'time', lambda: now)
    with pg.connect() as conn:
        conn.execute('SELECT id FROM lp_changes WHERE id = %s FOR UPDATE', (overdue or live,))
        run = Run(changes.fetch_for_bridge)
        lock_wait(run, ROW)
        now += 2
    run.join()
    assert run.error is None and run.value == []
    assert testing.value('SELECT status FROM lp_changes WHERE id = %s', (live,)) == 'expired'


def test_sync_expiring_behind_actual_failure_writer(clock, monkeypatch):
    from src.auth.test_locking import Gate
    sync([member()])
    before = entitlement_rows()
    gate = Gate(monkeypatch, 'UPDATE patreon_sync_state SET last_sync_at')
    failed = Run(s._sync_failure)
    assert gate.reached.wait(10), failed.error
    class NearDeadline(FakeClient):
        def members(self):
            clock.now = testing.value("SELECT expires_at FROM patreon_leases WHERE name = 'sync'") - timedelta(milliseconds=500)
            return self.rows
    run = Run(lambda: s.sync_now(config=CONFIG, client=NearDeadline([member(tier='ascended')])))
    try:
        lock_wait(run, ROW)
        clock.now = testing.value("SELECT expires_at FROM patreon_leases WHERE name = 'sync'")
    finally:
        gate.release.set()
    failed.join()
    run.join()
    assert failed.error is None and run.error is None
    assert run.value == {'ok': False, 'detail': 'patreon_sync_failed'}
    assert entitlement_rows() == before


@pytest.mark.parametrize('kind', ['oauth', 'confirm', 'cancel', 'renew', 'token_refresh'])
def test_expiry_after_subsequent_update_table_wait(clock, monkeypatch, kind):
    import hashlib
    from urllib.parse import parse_qs, urlsplit
    import httpx
    from src.patreon.test_locking import _refresher
    from src.patreon.client import PatreonError
    expiry = clock.now + timedelta(seconds=1)
    if kind == 'oauth':
        monkeypatch.setenv('PATREON_CLIENT_ID', 'id')
        url = linking.start_link(discord_user_id='111', discord_username='name')['authorize_url']
        token = parse_qs(urlsplit(url).query)['state'][0]
        testing.execute('UPDATE patreon_oauth_states SET expires_at = %s', (expiry,))
        table, work = 'patreon_oauth_states', lambda: linking.consume_state(token)
    elif kind in ('confirm', 'cancel'):
        monkeypatch.setenv('PATREON_ENABLED', '1')
        monkeypatch.setenv('PATREON_APPLY', '1')
        sync([member(discord=None)])
        pending_link('t')
        testing.execute('UPDATE patreon_pending_links SET expires_at = %s', (expiry,))
        table = 'patreon_pending_links'
        work = lambda: (linking.confirm_link if kind == 'confirm' else linking.cancel_link)('t')
    elif kind == 'renew':
        owner = s.acquire_lease()
        testing.execute('UPDATE patreon_leases SET expires_at = %s', (expiry,))
        table, work = 'patreon_leases', lambda: s.renew_lease('sync', owner)
    else:
        for key, value in {'PATREON_CREATOR_ACCESS_TOKEN': 'seed', 'PATREON_CREATOR_REFRESH_TOKEN': 'seed-refresh'}.items():
            monkeypatch.setenv(key, value)
        def handler(request):
            testing.execute("UPDATE patreon_leases SET expires_at = %s WHERE name = 'token_refresh'", (expiry,))
            return httpx.Response(200, json={'access_token': 'new', 'refresh_token': 'new-refresh', 'expires_in': 3600})
        client = _refresher(handler)
        client._tokens()
        table, work = 'patreon_tokens', client.refresh_tokens
    with pg.connect() as conn:
        conn.execute(f'LOCK TABLE {table} IN SHARE MODE')
        run = Run(work)
        lock_wait(run, {'relation'})
        clock.now = expiry
    run.join()
    if kind in ('oauth', 'confirm', 'cancel'):
        assert run.error is None
    if kind == 'oauth':
        assert run.value is None
        assert testing.value('SELECT used_at FROM patreon_oauth_states') is None
    elif kind in ('confirm', 'cancel'):
        assert run.value['status'] == 'expired'
        assert testing.value('SELECT used_at FROM patreon_pending_links') is None
    elif kind == 'renew':
        assert isinstance(run.error, s.ServiceError)
        assert testing.value('SELECT expires_at FROM patreon_leases') == expiry
    else:
        assert isinstance(run.error, PatreonError)
        assert testing.value('SELECT refresh_token FROM patreon_tokens') == 'seed-refresh'


@pytest.mark.parametrize("kind", ["renew", "token_refresh"])
def test_deadlines_after_a_table_write_lock_wait_get_the_full_ttl(clock, monkeypatch, kind):
    from src.patreon.test_locking import _refresher
    import httpx
    if kind == 'renew':
        owner = s.acquire_lease()
        table = 'patreon_leases'
        work = lambda: s.renew_lease('sync', owner)
        seconds = s.LEASE_SECONDS
    else:
        monkeypatch.setenv('PATREON_CREATOR_ACCESS_TOKEN', 'seed')
        monkeypatch.setenv('PATREON_CREATOR_REFRESH_TOKEN', 'seed-refresh')
        client = _refresher(lambda request: httpx.Response(200, json={
            'access_token': 'new', 'refresh_token': 'new-refresh', 'expires_in': 3600}))
        client._tokens()
        table, work, seconds = 'patreon_tokens', client.refresh_tokens, 3600
    with pg.connect() as conn:
        conn.execute(f'LOCK TABLE {table} IN SHARE MODE')
        run = Run(work)
        lock_wait(run, {'relation'})
        clock.now += timedelta(seconds=30)
    assert run.join().error is None
    assert testing.value(f'SELECT expires_at FROM {table}') == clock.now + timedelta(seconds=seconds)


def test_valid_confirmation_error_keeps_spend_but_rolls_back_link(clock, monkeypatch):
    monkeypatch.setenv('PATREON_ENABLED', '1')
    monkeypatch.setenv('PATREON_APPLY', '1')
    sync([member()])
    assert s.create_or_update_link('1', '111', method='staff', config=CONFIG) == 'ok'
    pending_link('confirm-token')
    before = entitlement_rows()
    real_link = s.create_or_update_link
    def fail_after_write(*args, **kwargs):
        real_link(*args, **kwargs)
        raise RuntimeError('confirmation failure')
    monkeypatch.setattr(s, 'create_or_update_link', fail_after_write)
    with pg.connect() as conn:
        conn.execute("SELECT * FROM patreon_links FOR UPDATE")
        run = Run(lambda: linking.confirm_link('confirm-token'))
        lock_wait(run, ROW)
    assert run.join().error is None and run.value == {'status': 'error', 'tier': ''}
    assert entitlement_rows() == before
    assert testing.value('SELECT used_at IS NOT NULL FROM patreon_pending_links')


def test_timeout_read_refreshes_its_clock_after_another_settlement(app, bridge, staff, monkeypatch):
    tips = [{'op': 'add_node', 'node': {'key': 'tips.off'}}]
    overdue = submit(app, staff['root'], 'user', BOB, tips).json()['id']
    assert changes.fetch_for_bridge()
    live = submit(app, staff['admin'], 'user', ALICE, tips).json()['id']
    now = changes.time.time()
    testing.execute('UPDATE lp_changes SET sent_at = %s WHERE id = %s',
                    (mirror._stamp(now) - timedelta(seconds=changes.RESULT_WAIT_SECONDS + 1), overdue))
    testing.execute('UPDATE lp_changes SET created_at = %s WHERE id = %s',
                    (mirror._stamp(now) - timedelta(seconds=changes.PENDING_TTL_SECONDS - 1), live))
    monkeypatch.setattr(changes.time, 'time', lambda: now)
    with pg.connect() as conn:
        conn.execute('SELECT id FROM lp_changes WHERE id = %s FOR UPDATE', (overdue,))
        run = Run(lambda: changes.get_change(live))
        lock_wait(run, ROW)
        now += 2
    assert run.join().error is None and run.value['status'] == 'expired'
