"""Patreon responses to the plugin, the Discord bot and staff, byte for byte as the SQLite code sent them.

EXPECTED was recorded from the SQLite version (origin/postgres at 7d2a1ee7) with
the same requests and the clock frozen at NOW. Times keep the `isoformat()` form
(`…+00:00`, with microseconds), booleans stay booleans and `active` stays 0/1.
"""
import json
from datetime import datetime, timezone

import pytest

from src.patreon import client as patreon_client, linking, service as s
from src.patreon.test_routes import PLUGIN, STAFF, api  # noqa: F401
from src.patreon.test_service import member, player

pytestmark = pytest.mark.usefixtures("postgres")

NOW = datetime(2026, 10, 16, 10, 0, 0, 123456, tzinfo=timezone.utc)

EXPECTED = {
    'alerts': (200, '{"alerts":[{"id":1,"kind":"sync_failed","message":"Patreon sync failed three or more consecutive times; existing perks retained.","created_at":"2026-10-16T10:00:00.123456+00:00"}]}'),
    'first /patreon/plugin/rank-changes': (200, '{"changes":[{"id":3,"player_uuid":"00000000-0000-0000-0000-000000000001","add_tier":"noble","remove_tiers":[]},{"id":5,"player_uuid":"00000000-0000-0000-0000-000000000002","add_tier":"ascended","remove_tiers":[]}]}'),
    'first /patreon/plugin/roster': (200, '{"tier_keys":["noble","gilded","ascended"],"members":[]}'),
    'first /patreon/staff/role-changes': (200, '{"changes":[{"id":1,"discord_user_id":"111","add_tier":"noble","remove_tiers":[],"dm":"tier_granted","tier_name":"Noble"},{"id":4,"discord_user_id":"222","add_tier":"ascended","remove_tiers":[],"dm":"link_success","tier_name":"Ascended"}]}'),
    'first /patreon/staff/roster': (200, '{"tier_keys":["noble","gilded","ascended"],"members":[]}'),
    'first /patreon/status?discord_user_id=222': (200, '{"linked":true,"method":"staff","patreon_name":"Patron 2","tier_key":"ascended","tier_name":"Ascended","patron_status":"active_patron","is_gifted":true,"grace_until":null,"has_discord":true,"has_minecraft":true}'),
    'first /patreon/status?discord_user_id=nobody': (200, '{"linked":false,"method":null,"patreon_name":null,"tier_key":null,"tier_name":null,"patron_status":null,"is_gifted":false,"grace_until":null,"has_discord":false,"has_minecraft":false}'),
    'first /patreon/status?player_uuid=00000000-0000-0000-0000-000000000001': (200, '{"linked":true,"method":"auto_discord","patreon_name":"Patron 1","tier_key":"noble","tier_name":"Noble","patron_status":"active_patron","is_gifted":false,"grace_until":null,"has_discord":true,"has_minecraft":true}'),
    'health failing': (200, '{"enabled":true,"apply":true,"last_sync_at":"2026-10-16T10:00:00.123456+00:00","last_sync_ok":false,"consecutive_failures":3,"brake_held":false,"members":1,"links":1,"entitled_linked":1,"entitled_unlinked":0}'),
    'rank ack': (200, '{"acked":[3,5]}'),
    'role ack': (200, '{"acked":[1,4]}'),
    'second /patreon/plugin/rank-changes': (200, '{"changes":[]}'),
    'second /patreon/plugin/roster': (200, '{"tier_keys":["noble","gilded","ascended"],"members":[{"player_uuid":"00000000-0000-0000-0000-000000000001","tier_key":"noble"},{"player_uuid":"00000000-0000-0000-0000-000000000002","tier_key":"ascended"}]}'),
    'second /patreon/staff/alerts': (200, '{"alerts":[]}'),
    'second /patreon/staff/health': (200, '{"enabled":true,"apply":true,"last_sync_at":"2026-10-16T10:00:00.123456+00:00","last_sync_ok":true,"consecutive_failures":0,"brake_held":false,"members":2,"links":2,"entitled_linked":2,"entitled_unlinked":0}'),
    'second /patreon/staff/role-changes': (200, '{"changes":[{"id":6,"discord_user_id":"111","add_tier":null,"remove_tiers":[],"dm":"payment_declined","tier_name":null,"grace_until":"2026-10-23T10:00:00.123456+00:00"}]}'),
    'second /patreon/staff/unlinked': (200, '{"members":[]}'),
    'second /patreon/status?discord_user_id=111': (200, '{"linked":true,"method":"auto_discord","patreon_name":"Patron 1","tier_key":"noble","tier_name":"Noble","patron_status":"declined_patron","is_gifted":false,"grace_until":"2026-10-23T10:00:00.123456+00:00","has_discord":true,"has_minecraft":true}'),
    'second /patreon/status?player_uuid=00000000-0000-0000-0000-000000000001': (200, '{"linked":true,"method":"auto_discord","patreon_name":"Patron 1","tier_key":"noble","tier_name":"Noble","patron_status":"declined_patron","is_gifted":false,"grace_until":"2026-10-23T10:00:00.123456+00:00","has_discord":true,"has_minecraft":true}'),
}

# The SQLite reply. jsonb keeps its own key order, so the member object's keys now come
# in a different order; every value is the same.
LOOKUP = '{"found":true,"member":{"member_id":"m1","patreon_user_id":"1","email":"patron1@example.com","full_name":"Patron 1","tiers":[{"id":"25226332"}],"patron_status":"active_patron","discord_user_id":"111","last_tier":"noble","declined_since":null},"link":{"patreon_user_id":"1","discord_user_id":"111","player_uuid":null,"method":"auto_discord","active":1,"linked_at":"2026-10-16T10:00:00.123456+00:00","person_changed_at":"2026-10-16T10:00:00.123456+00:00"},"tier_key":"noble"}'


class Members:
    heartbeat = None

    def __init__(self, *rows):
        self.rows = rows

    def members(self):
        if not self.rows:
            raise RuntimeError("down")
        return list(self.rows)


@pytest.fixture(autouse=True)
def frozen(monkeypatch):
    for module in (s, linking, patreon_client):
        monkeypatch.setattr(module, "utcnow", lambda: NOW)


def test_plugin_and_bot_see_the_same_bytes(api, database):
    seen = {}

    def keep(name, response):
        seen[name] = (response.status_code, response.content.decode())

    with database.connect() as conn:
        conn.execute("INSERT INTO discord_links(player_uuid,discord_user_id,linked_at) VALUES (%s,%s,%s)",
                     (player(), "111", "2026-10-01T00:00:00Z"))
        conn.commit()
    s.sync_now(client=Members(member(), member("2", tier="ascended", discord="222", is_gifted=True)))
    s.staff_link(patreon_user_id="2", player_uuid=player(2), force=True)
    for path, headers in [("/patreon/status?player_uuid=" + player(), PLUGIN), ("/patreon/status?discord_user_id=222", STAFF),
                          ("/patreon/status?discord_user_id=nobody", STAFF),
                          ("/patreon/plugin/rank-changes", PLUGIN), ("/patreon/plugin/roster", PLUGIN),
                          ("/patreon/staff/role-changes", STAFF), ("/patreon/staff/roster", STAFF)]:
        keep("first " + path, api.get(path, headers=headers))
    ranks = json.loads(seen["first /patreon/plugin/rank-changes"][1])["changes"]
    roles = json.loads(seen["first /patreon/staff/role-changes"][1])["changes"]
    keep("rank ack", api.post("/patreon/plugin/rank-changes/ack", headers=PLUGIN, json={"ids": [r["id"] for r in ranks] + [999]}))
    keep("role ack", api.post("/patreon/staff/role-changes/ack", headers=STAFF, json={"ids": [r["id"] for r in roles]}))
    # Patron 1's payment is declined: a grace period, with its end in the DM row and the status.
    s.sync_now(client=Members(member(tier=None, status="declined_patron"), member("2", tier="ascended", discord="222", is_gifted=True)))
    for path, headers in [("/patreon/status?discord_user_id=111", STAFF), ("/patreon/status?player_uuid=" + player(), PLUGIN),
                          ("/patreon/staff/role-changes", STAFF), ("/patreon/plugin/rank-changes", PLUGIN),
                          ("/patreon/plugin/roster", PLUGIN), ("/patreon/staff/health", STAFF), ("/patreon/staff/alerts", STAFF),
                          ("/patreon/staff/unlinked", STAFF)]:
        keep("second " + path, api.get(path, headers=headers))
    assert seen == {k: v for k, v in EXPECTED.items() if k.startswith(("first", "second", "rank", "role"))}


def test_alerts_health_and_lookup_keep_their_form(api):
    s.sync_now(client=Members(member()))
    for _ in range(3):
        s.sync_now(client=Members())
    assert (api.get("/patreon/staff/alerts", headers=STAFF).status_code,
            api.get("/patreon/staff/alerts", headers=STAFF).content.decode()) == EXPECTED["alerts"]
    response = api.get("/patreon/staff/health", headers=STAFF)
    assert (response.status_code, response.content.decode()) == EXPECTED["health failing"]
    lookup = api.get("/patreon/staff/lookup?discord_user_id=111", headers=STAFF)
    assert lookup.json() == json.loads(LOOKUP)
    assert '"active":1,"linked_at":"2026-10-16T10:00:00.123456+00:00"' in lookup.text
