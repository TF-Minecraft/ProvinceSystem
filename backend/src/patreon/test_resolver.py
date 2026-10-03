from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import pytest
from src.patreon.client import decode_members
from src.patreon.config import Config
from src.patreon.resolver import entitled_tier, iso, resolve

NOW = datetime(2026, 10, 3, tzinfo=timezone.utc)
CONFIG = Config()
LINK = {"discord_user_id": "123", "player_uuid": "abc"}


def member(tiers=(), status="active_patron", **kwargs):
    ids = {"noble": "25226332", "gilded": "25226340", "ascended": "25226353", "free": "25226095", "knight": "25226469"}
    return {"tiers": [{"id": ids[t]} for t in tiers], "patron_status": status, **kwargs}


@pytest.mark.parametrize("tiers,expected", [([], None), (["free"], None), (["knight", "free"], None), (["noble", "free", "knight"], "noble"), (["noble", "ascended", "gilded"], "ascended"), (["gilded", "free"], "gilded")])
def test_highest_mapped_tier(tiers, expected):
    assert resolve(member(tiers), LINK, NOW, CONFIG)["tier_key"] == expected


@pytest.mark.parametrize("gifted,trial,charge", [(True, False, None), (False, True, None), (False, False, "Declined"), (False, False, "Paid")])
def test_entitlement_does_not_depend_on_charge(gifted, trial, charge):
    state = resolve(member(["noble"], is_gifted=gifted, is_free_trial=trial, last_charge_status=charge), LINK, NOW, CONFIG)
    assert state["targets"] == {"discord": ("123", "noble"), "luckperms": ("abc", "noble")}


@pytest.mark.parametrize("elapsed,expected", [(0, "gilded"), (6, "gilded"), (7, None), (8, None)])
def test_declined_grace_boundary(elapsed, expected):
    state = resolve(member(["free"], "declined_patron", last_tier="gilded", declined_since=iso(NOW)), LINK, NOW + timedelta(days=elapsed), CONFIG)
    assert state["tier_key"] == expected and state["declined_since"] == iso(NOW)
    assert state["grace_until"] == iso(NOW + timedelta(days=7))


def test_first_decline_and_recovery():
    state = resolve(member([], "declined_patron", last_tier="noble"), LINK, NOW, CONFIG)
    assert state["declined_since"] == iso(NOW)
    recovered = resolve(member(["ascended"], last_tier="noble", declined_since=iso(NOW)), LINK, NOW, CONFIG)
    assert recovered["last_tier"] == "ascended" and recovered["declined_since"] is None and recovered["grace_until"] is None
    assert resolve(member([], "declined_patron"), LINK, NOW, CONFIG)["tier_key"] is None


@pytest.mark.parametrize("status", ["former_patron", None, "active_patron"])
def test_no_tier_clears_history(status):
    state = resolve(member(["free"], status, last_tier="noble", declined_since=iso(NOW)), LINK, NOW, CONFIG)
    assert state["tier_key"] is None and state["last_tier"] is None and state["declined_since"] is None


@pytest.mark.parametrize("old,new", [("noble", "ascended"), ("ascended", "noble")])
def test_upgrade_and_downgrade(old, new):
    assert resolve(member([new], last_tier=old), LINK, NOW, CONFIG)["last_tier"] == new


@pytest.mark.parametrize("link,targets", [(None, {}), ({"active": False, **LINK}, {}), ({"discord_user_id": "123"}, {"discord": ("123", "noble")}), ({"player_uuid": "abc"}, {"luckperms": ("abc", "noble")}), ({"discord_user_id": "123", "resolved_player_uuid": "abc"}, {"discord": ("123", "noble"), "luckperms": ("abc", "noble")}), ({"player_uuid": "abc", "resolved_discord_user_id": "123"}, {"discord": ("123", "noble"), "luckperms": ("abc", "noble")})])
def test_link_targets_and_purity(link, targets):
    m = member(["noble"])
    before = deepcopy((m, link))
    assert resolve(m, link, NOW, CONFIG)["targets"] == targets
    assert (m, link) == before


def test_title_fallback():
    assert entitled_tier({"tiers": [{"id": "changed", "title": "Noble Tier"}]}, CONFIG) == "noble"


def test_real_fixture_gifted_members_are_entitled():
    data = json.loads(Path(__file__).with_name("test_data").joinpath("members_page_anonymised.json").read_text())
    members = decode_members(data)
    assert len(members) == 154
    gifted = [m for m in members if m["is_gifted"] and entitled_tier(m, CONFIG) and m["last_charge_status"] is None]
    assert gifted
    for m in gifted:
        assert resolve(m, LINK, NOW, CONFIG)["tier_key"] == entitled_tier(m, CONFIG)


def test_every_combination_of_mapped_and_unmapped_tiers():
    from itertools import combinations
    keys = ("free", "knight", "noble", "gilded", "ascended")
    ranks = {"noble": 1, "gilded": 2, "ascended": 3}
    for count in range(len(keys) + 1):
        for tiers in combinations(keys, count):
            expected = max((t for t in tiers if t in ranks), key=ranks.get, default=None)
            assert resolve(member(tiers), LINK, NOW, CONFIG)["tier_key"] == expected


def test_zero_grace_is_immediate_and_never_extends_first_decline():
    from dataclasses import replace
    c = replace(CONFIG, grace_days=0)
    assert resolve(member([], "declined_patron", last_tier="noble"), LINK, NOW, c)["tier_key"] is None
    past = NOW - timedelta(days=6)
    state = resolve(member([], "declined_patron", last_tier="noble", declined_since=iso(past)), LINK, NOW, CONFIG)
    assert state["grace_until"] == iso(past + timedelta(days=7))
